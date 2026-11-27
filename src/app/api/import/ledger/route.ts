import { kstTodayStr } from '@/lib/analytics/date-buckets'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { resolveFulfillmentFallback } from '@/lib/import/fulfillment-fallback'
import { runImport, type RunImportResult } from '@/lib/import/process'
import { validateAdBillingRow, validatePurchaseRow } from '@/lib/import/validators'
import { syncDailySettlements } from '@/lib/settlement/auto-sync'
import type { ImportError, ParsedRow } from '@/types/import'

type AtomicLedgerImportType = 'purchase' | 'ad_billing'

interface PreparedAtomicLedgerRows {
  rows: Record<string, unknown>[]
  totalRows: number
}

function requiredFieldError(row: number, field: string, label: string): ImportError {
  return { row, field, message: `필수 컬럼 '${label}' 값이 비어있습니다.` }
}

/**
 * 클라이언트 조립 결과를 신뢰하지 않고 서버에서 같은 검증기를 다시 적용한다.
 * 광고 합계/전부 0원 행만 안전하게 제외하며, 그 외 오류는 파일 전체를 차단한다.
 */
function prepareAtomicLedgerRows(
  importType: AtomicLedgerImportType,
  rows: Record<string, unknown>[],
): PreparedAtomicLedgerRows {
  const validated = rows.map((raw, index) => {
    const rowIndex = index + 2
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
    const errors: ImportError[] = []

    if (importType === 'purchase' && !String(data.product_name_memo || '').trim()) {
      errors.push(requiredFieldError(rowIndex, 'product_name_memo', '상품명'))
    }
    if (importType === 'ad_billing'
      && String(data.campaign_id || '').trim()
      && !String(data.ad_date || '').trim()) {
      errors.push(requiredFieldError(rowIndex, 'ad_date', '날짜'))
    }

    const parsed: ParsedRow = {
      rowIndex,
      data,
      errors,
      isValid: errors.length === 0,
    }
    return importType === 'purchase'
      ? validatePurchaseRow(parsed)
      : validateAdBillingRow(parsed)
  })

  const invalidRows = validated.filter((row) => !row.isValid)
  if (importType === 'purchase' && invalidRows.length > 0) {
    const first = invalidRows[0].errors[0]?.message || '유효하지 않은 행'
    throw new Error(`매입 파일 ${invalidRows.length}행 검증 실패: ${first} 전체 파일은 반영되지 않았습니다.`)
  }

  if (importType === 'ad_billing') {
    const errorRows = invalidRows.filter((row) => row.errors.length > 0 || !row.skipReason)
    if (errorRows.length > 0) {
      const first = errorRows[0].errors[0]?.message || '유효하지 않은 광고 행'
      throw new Error(`광고 파일 ${errorRows.length}행 검증 실패: ${first} 기존 날짜 원장은 유지됩니다.`)
    }
  }

  const validRows = validated.filter((row) => row.isValid).map((row) => row.data)
  if (validRows.length === 0) {
    throw new Error(`유효한 데이터가 없습니다. 전체 ${validated.length}행 중 ${invalidRows.length}행 오류.`)
  }

  return { rows: validRows, totalRows: validated.length }
}

function toLedgerSheetResult(result: RunImportResult) {
  return {
    success: result.successCount,
    error: result.errorCount,
    errors: result.errors.map(({ row, message }) => `행 ${row}: ${message}`),
  }
}

/**
 * POST /api/import/ledger - 그로스판매장부 통합 Import
 * 클라이언트에서 시트별로 파싱한 데이터를 한번에 받아 순차 처리
 */
export async function POST(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (r) { return r as NextResponse }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as NextResponse }

    const body = await request.json()
    const { sheets, fileName } = body as {
      fileName: string
      sheets: {
        products?: Record<string, unknown>[]
        refurbished?: Record<string, unknown>[]
        sales?: Record<string, unknown>[]
        purchases?: Record<string, unknown>[]
        ads?: Record<string, unknown>[]
      }
    }

    let preparedPurchases: PreparedAtomicLedgerRows | null = null
    let preparedAds: PreparedAtomicLedgerRows | null = null
    try {
      if (sheets.purchases && sheets.purchases.length > 0) {
        preparedPurchases = prepareAtomicLedgerRows('purchase', sheets.purchases)
      }
      if (sheets.ads && sheets.ads.length > 0) {
        preparedAds = prepareAtomicLedgerRows('ad_billing', sheets.ads)
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '통합 장부 검증에 실패했습니다.' },
        { status: 400 },
      )
    }

    const results: Record<string, {
      success: number
      error: number
      errors: string[]
      fulfillmentFallback?: { applied: number; missingDefault: number }
    }> = {}

    // 이번 요청에서 신규 삽입한 행을 표시하는 태그 — 삽입 성공 후 구 데이터를 삭제할 때
    // 방금 넣은 행까지 지우지 않도록 구분한다(선삭제 후 삽입 실패 시 데이터 소실 방지, audit §1-6).
    const importBatchTag = crypto.randomUUID()

    // ── 1. 상품 (01_상품) ──
    if (sheets.products && sheets.products.length > 0) {
      const r = { success: 0, error: 0, errors: [] as string[] }
      const rows = sheets.products

      // seq 자동 부여: 기존 최대 seq + 1부터 시작
      let seqCounter = 1
      {
        const { data: maxSeqRow } = await supabase
          .from('products').select('seq').eq('user_id', userId)
          .not('seq', 'is', null).order('seq', { ascending: false }).limit(1)
        if (maxSeqRow && maxSeqRow.length > 0) seqCounter = (maxSeqRow[0].seq as number) + 1
      }

      const optionIds = [...new Set(rows.map((row) => String(row.coupang_option_id || '')).filter(Boolean))]
      const existingMap = new Map<string, string>()
      if (optionIds.length > 0) {
        // ★ business_id 한정 — 미한정 시 동일 옵션ID를 가진 타 사업장 상품이 잘못 매칭·업데이트됨 (audit §1-4)
        let existingQuery = supabase
          .from('products')
          .select('id, coupang_option_id')
          .eq('user_id', userId)
          .in('coupang_option_id', optionIds)
        existingQuery = businessId ? existingQuery.eq('business_id', businessId) : existingQuery.is('business_id', null)
        const { data: existing } = await existingQuery
        if (existing) {
          for (const p of existing) {
            if (p.coupang_option_id) existingMap.set(p.coupang_option_id, p.id)
          }
        }
      }

      for (const row of rows) {
        const optionId = String(row.coupang_option_id || '')
        if (!optionId) continue

        // 수수료율: "10.8%" → 0.108, "0.108" → 0.108
        let commissionRate: number | null = null
        if (row.commission_rate != null) {
          const rateStr = String(row.commission_rate).replace(/[%\s]/g, '')
          const rateNum = Number(rateStr)
          if (!isNaN(rateNum)) commissionRate = rateNum > 1 ? rateNum / 100 : rateNum
        }

        // 판매가격: "6,900" → 6900
        const sellingPrice = toNum(row.selling_price)

        // seq 자동 부여
        const nextSeq = seqCounter++

        const fields = {
          seq: nextSeq,
          coupang_product_id: row.coupang_product_id || null,
          coupang_exposure_id: row.coupang_exposure_id || null,
          coupang_option_id: optionId,
          barcode: row.barcode || null,
          sku: row.sku || null,
          coupang_display_name: row.coupang_display_name || null,
          product_name: row.product_name || null,
          option_name: row.option_name || null,
          condition_value: sellingPrice > 0 ? String(sellingPrice) : (row.condition_value || null),
          commission_rate: commissionRate,
          fulfillment_fee_default: toNum(row.fulfillment_fee_default) || null,
          unit_cost_default: toNum(row.unit_cost_default) || null,
          seller_discount_coupon: toNum(row.seller_discount_coupon) || null,
          lead_time_weeks: toNum(row.lead_time_weeks) || null,
          weekly_avg_sales: toNum(row.weekly_avg_sales) || null,
          product_grade: row.product_status_raw ? String(row.product_status_raw).trim() : null,
        }

        const existingId = existingMap.get(optionId)
        if (existingId) {
          // 재임포트 시 seq는 최초 등록 순서를 보존해야 하므로 update 경로에는 넣지 않는다
          // (매번 seq를 재부여하면 기존 상품 순번이 재임포트마다 바뀜, audit §1-12).
          const { seq: _seq, ...updateFields } = fields
          const { error: err } = await supabase.from('products').update(updateFields).eq('id', existingId)
          if (err) { r.error++; r.errors.push(`상품 수정 실패 (${optionId}): ${err.message}`) }
          else r.success++
        } else {
          const { error: err } = await supabase.from('products').insert({
            ...fields, user_id: userId, business_id: businessId, purpose: 'product',
          })
          if (err) { r.error++; r.errors.push(`상품 등록 실패 (${optionId}): ${err.message}`) }
          else r.success++
        }
      }

      // 상품 등록 후 재고수량이 있으면 inventory UPSERT
      // 상품 ID 재조회 (방금 INSERT한 것 포함)
      const allOptionIds = [...new Set(rows.map((row) => String(row.coupang_option_id || '')).filter(Boolean))]
      if (allOptionIds.length > 0) {
        let allProductsQuery = supabase
          .from('products')
          .select('id, coupang_option_id')
          .eq('user_id', userId)
          .in('coupang_option_id', allOptionIds)
        allProductsQuery = businessId ? allProductsQuery.eq('business_id', businessId) : allProductsQuery.is('business_id', null)
        const { data: allProducts } = await allProductsQuery

        if (allProducts) {
          const pidMap = new Map<string, string>()
          for (const p of allProducts) {
            if (p.coupang_option_id) pidMap.set(p.coupang_option_id, p.id)
          }

          for (const row of rows) {
            const optId = String(row.coupang_option_id || '')
            const pid = pidMap.get(optId)
            const stock = Number(row.coupang_stock) || 0
            if (pid && stock > 0) {
              await supabase.from('inventory').upsert({
                product_id: pid,
                coupang_stock: stock,
                current_stock: stock,
                last_health_sync: new Date().toISOString(),
              }, { onConflict: 'product_id' })
            }
          }
        }
      }

      results.products = r
    }

    // ── 1-2. 반품 재판매 상품 ──
    if (sheets.refurbished && sheets.refurbished.length > 0) {
      const r = { success: 0, error: 0, errors: [] as string[] }

      // 옵션ID로 원상품 매칭용 맵
      const optionToProductId = new Map<string, string>()
      {
        const optionIds = [...new Set(sheets.refurbished.map((row) => String(row.option_id || '')).filter(Boolean))]
        if (optionIds.length > 0) {
          // ★ business_id 한정 — 동일 옵션ID의 타 사업장 상품에 반품재판매 상품이 잘못 연결되는 것 방지 (audit §1-4)
          let prodsQuery = supabase
            .from('products').select('id, coupang_option_id')
            .eq('user_id', userId).in('coupang_option_id', optionIds)
          prodsQuery = businessId ? prodsQuery.eq('business_id', businessId) : prodsQuery.is('business_id', null)
          const { data: prods } = await prodsQuery
          if (prods) for (const p of prods) {
            if (p.coupang_option_id) optionToProductId.set(p.coupang_option_id, p.id)
          }
        }
      }

      // SKU ID 기준 UPSERT
      const skuIds = [...new Set(sheets.refurbished.map((row) => String(row.sku_id || '')).filter(Boolean))]
      const existingSkuMap = new Map<string, string>()
      if (skuIds.length > 0) {
        let existingSkuQuery = supabase
          .from('products').select('id, coupang_sku_id')
          .eq('user_id', userId).in('coupang_sku_id', skuIds)
        existingSkuQuery = businessId ? existingSkuQuery.eq('business_id', businessId) : existingSkuQuery.is('business_id', null)
        const { data: existing } = await existingSkuQuery
        if (existing) for (const p of existing) {
          if (p.coupang_sku_id) existingSkuMap.set(p.coupang_sku_id, p.id)
        }
      }

      for (const row of sheets.refurbished) {
        const skuId = String(row.sku_id || '')
        if (!skuId) continue

        const optionId = String(row.option_id || '')
        const parentId = optionToProductId.get(optionId) || null

        const commRate = row.commission_rate != null
          ? (Number(row.commission_rate) > 1 ? Number(row.commission_rate) / 100 : Number(row.commission_rate))
          : null

        const fields = {
          coupang_sku_id: skuId,
          coupang_option_id: optionId || null,
          coupang_exposure_id: row.exposure_id || null,
          coupang_display_name: row.product_name || null,
          product_name: row.product_name || null,
          option_name: row.option_name || null,
          product_grade: row.product_grade || null,
          is_refurbished: true,
          parent_product_id: parentId,
          commission_rate: commRate,
          fulfillment_fee_default: Number(row.fulfillment_fee) || null,
          unit_cost_default: Number(row.unit_cost) || null,
        }

        const existingId = existingSkuMap.get(skuId)
        if (existingId) {
          await supabase.from('products').update(fields).eq('id', existingId)
          r.success++
        } else {
          const { error: err } = await supabase.from('products').insert({
            ...fields, user_id: userId, business_id: businessId, purpose: 'product',
          })
          if (err) r.errors.push(`반품상품 실패 (SKU:${skuId}): ${err.message}`)
          else r.success++
        }
      }
      results.refurbished = r
    }

    // ── 2. 판매 (02_판매) ──
    if (sheets.sales && sheets.sales.length > 0) {
      const r = {
        success: 0,
        error: 0,
        errors: [] as string[],
        fulfillmentFallback: { applied: 0, missingDefault: 0 },
      }
      const rows = sheets.sales

      // option_id → product 매칭
      const optionIds = [...new Set(rows.map((row) => String(row.option_id || '')).filter(Boolean))]
      const productMap = new Map<string, {
        id: string
        fulfillment_fee_default: number | null
        fulfillment_fee_benefit_until: string | null
      }>()
      if (optionIds.length > 0) {
        // ★ business_id 한정 — 미한정 시 동일 옵션ID의 타 사업장 상품에 판매 행이 연결됨 (audit §1-4)
        let prodsQuery = supabase
          .from('products')
          .select('id, coupang_option_id, fulfillment_fee_default, fulfillment_fee_benefit_until')
          .eq('user_id', userId)
          .in('coupang_option_id', optionIds)
        prodsQuery = businessId ? prodsQuery.eq('business_id', businessId) : prodsQuery.is('business_id', null)
        const { data: prods } = await prodsQuery
        if (prods) {
          for (const p of prods) {
            if (p.coupang_option_id) productMap.set(p.coupang_option_id, p)
          }
        }
      }

      const insertRows = rows.map((row) => {
        const orderDate = serialToDate(row.order_date) || kstTodayStr()
        const optionId = String(row.option_id || '').trim()
        const product = productMap.get(optionId) || null
        const productId = product?.id || null
        const orderQuantity = toNum(row.order_quantity)
        const fulfillment = resolveFulfillmentFallback({
          sheetFee: row.fulfillment_fee,
          sheetVat: row.fulfillment_vat,
          defaultPerUnit: product?.fulfillment_fee_default,
          quantity: orderQuantity,
          orderDate,
          benefitUntil: product?.fulfillment_fee_benefit_until,
        })
        if (fulfillment.usedFallback) r.fulfillmentFallback!.applied++
        if (fulfillment.missingDefault) r.fulfillmentFallback!.missingDefault++

        const margin = fulfillment.usedFallback
          ? toNum(row.total_amount)
            - (toNum(row.unit_cost) * orderQuantity)
            - toNum(row.commission_fee)
            - toNum(row.commission_vat)
            - fulfillment.fee
            - fulfillment.vat
            - toNum(row.coupon_discount)
            - toNum(row.vat)
          : toNum(row.margin)

        return {
          user_id: userId,
          business_id: businessId,
          product_id: productId,
          order_date: orderDate,
          option_id: optionId || null,
          option_name: row.option_name || null,
          product_type: row.product_type || null,
          category: row.category || null,
          order_quantity: orderQuantity,
          total_amount: toNum(row.total_amount),
          gross_amount: toNum(row.gross_amount),
          gross_quantity: toNum(row.gross_quantity),
          cancel_amount: toNum(row.cancel_amount),
          cancel_quantity: toNum(row.cancel_quantity),
          coupon_discount: toNum(row.coupon_discount),
          commission_rate: toNum(row.commission_rate),
          commission_fee: toNum(row.commission_fee),
          commission_vat: toNum(row.commission_vat),
          settlement_amount: toNum(row.settlement_amount),
          fulfillment_fee: fulfillment.fee,
          fulfillment_vat: fulfillment.vat,
          payout_amount: toNum(row.payout_amount),
          unit_cost: toNum(row.unit_cost),
          vat: toNum(row.vat),
          margin,
          item_winner_rate: toNum(row.item_winner_rate),
          selling_price: toNum(row.selling_price),
          status: 'confirmed',
          source: 'coupang_import',
          import_batch_id: importBatchTag,
        }
      }).filter((row) =>
        row.order_quantity > 0 || row.total_amount > 0 ||
        row.cancel_amount > 0 || row.order_quantity < 0
      )

      if (insertRows.length > 0) {
        // 삽입을 먼저 시도(태그로 격리)하고, 성공했을 때만 같은 날짜의 구 데이터를 삭제한다.
        // 선삭제 후 삽입 실패 시 데이터가 복구 불가로 소실되는 문제 방지 (audit §1-6).
        const { error: err, count } = await supabase
          .from('sales_transactions')
          .insert(insertRows)
          .select('id', { count: 'exact', head: true })
        if (err) {
          r.errors.push(`판매 삽입 실패: ${err.message}`)
        } else {
          r.success = count || insertRows.length

          // ★ 반드시 현재 사업장(business_id)으로 한정 — 미한정 시 같은 날짜의 다른 사업장 데이터까지 삭제됨
          // ★ import_batch_id가 NULL인 구버전 행은 neq()로 매칭되지 않는다(NULL 비교는 항상 UNKNOWN) —
          //   is.null도 함께 매칭해야 태그 도입 이전 레거시 행이 영구히 남아 매출이 중복 집계되지 않는다.
          const dates = new Set(insertRows.map((row) => row.order_date))
          for (const date of dates) {
            let delQuery = supabase.from('sales_transactions').delete()
              .eq('user_id', userId)
              .eq('order_date', date)
              .eq('source', 'coupang_import')
              .or(`import_batch_id.is.null,import_batch_id.neq.${importBatchTag}`)
            delQuery = businessId ? delQuery.eq('business_id', businessId) : delQuery.is('business_id', null)
            const { error: delErr } = await delQuery
            if (delErr) {
              r.errors.push(`판매 기존데이터 삭제 실패 (${date}): ${delErr.message}`)
            } else {
              try {
                await syncDailySettlements(supabase, {
                  userId,
                  businessId,
                  orderDate: date,
                })
              } catch (settlementError) {
                const message = settlementError instanceof Error
                  ? settlementError.message
                  : '알 수 없는 자동 정산 오류'
                r.errors.push(`자동 정산 실패 (${date}): ${message}`)
              }
            }
          }
        }
      }
      results.sales = r
    }

    // ── 3. 매입 (DB_구매) ──
    if (preparedPurchases) {
      const result = await runImport(supabase, {
        userId,
        businessId,
        importType: 'purchase',
        fileName,
        rows: preparedPurchases.rows,
        totalRows: preparedPurchases.totalRows,
      })
      results.purchases = toLedgerSheetResult(result)
    }

    // ── 4. 광고 (DB_광고) ──
    if (preparedAds) {
      const result = await runImport(supabase, {
        userId,
        businessId,
        importType: 'ad_billing',
        fileName,
        rows: preparedAds.rows,
        totalRows: preparedAds.totalRows,
      })
      results.ads = toLedgerSheetResult(result)
    }

    return NextResponse.json({ data: results })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '통합 Import 오류' },
      { status: 500 }
    )
  }
}

function serialToDate(value: unknown): string | null {
  if (!value) return null
  const num = Number(String(value).replace(/[,\s]/g, ''))
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date((num - 25569) * 86400000)
    return d.toISOString().split('T')[0]
  }
  const str = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  // "2026년 05월 01일" 패턴
  const m1 = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`
  // "M/D/YY" 또는 "MM/DD/YY" 패턴 (예: 5/1/26 → 2026-05-01)
  const m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m2) {
    const year = m2[3].length === 2 ? `20${m2[3]}` : m2[3]
    return `${year}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  }
  // "YYYY.MM.DD" 또는 "YYYY/MM/DD"
  const m3 = str.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/)
  if (m3) return `${m3[1]}-${m3[2].padStart(2, '0')}-${m3[3].padStart(2, '0')}`
  return null
}

/** 숫자 정규화: 콤마/공백/원 제거 */
function toNum(value: unknown, defaultVal = 0): number {
  if (value === null || value === undefined || value === '') return defaultVal
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[,\s원₩]/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? defaultVal : num
}
