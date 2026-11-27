import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { buildTaxWorkbook } from '@/lib/export/tax-workbook'
import { resolveAdAmounts } from '@/lib/ads/amounts'

/** GET /api/export/tax-package — 활성 사업자의 기간별 세무 참고 XLSX. 조회 전용. */
export async function GET(request: NextRequest) {
  try {
    let userId: string
    try { userId = await requireAuth() } catch (response) { return response as NextResponse }
    let businessId: string
    try { businessId = await requireOwnedBusinessId(userId) } catch (response) { return response as Response }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (!startDate || !endDate || startDate > endDate) {
      return NextResponse.json({ error: '올바른 startDate와 endDate가 필요합니다.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const [businessResult, salesResult, purchasesResult, expensesResult, adsResult] = await Promise.all([
      supabase
        .from('businesses')
        .select('business_name')
        .eq('id', businessId)
        .eq('user_id', userId)
        .maybeSingle(),
      fetchAllRows(() =>
        supabase
          .from('sales_transactions')
          .select('order_date, order_number, option_name, order_quantity, total_amount, cancel_amount, commission_fee, commission_vat, vat, status')
          .eq('user_id', userId)
          .eq('business_id', businessId)
          .gte('order_date', startDate)
          .lte('order_date', endDate)
          .order('order_date')
          .order('id')
      ),
      fetchAllRows(() =>
        supabase
          .from('purchases')
          .select('order_date, po_number, product_name_memo, quantity, total_amount_krw, customs_vat, status, products(product_name, option_name), suppliers(name)')
          .eq('user_id', userId)
          .eq('business_id', businessId)
          .eq('products.user_id', userId)
          .eq('products.business_id', businessId)
          .eq('suppliers.user_id', userId)
          .gte('order_date', startDate)
          .lte('order_date', endDate)
          .order('order_date')
          .order('id')
      ),
      fetchAllRows(() =>
        supabase
          .from('expenses')
          .select('expense_date, category, description, amount, vat_amount, payment_method')
          .eq('user_id', userId)
          .eq('business_id', businessId)
          .gte('expense_date', startDate)
          .lte('expense_date', endDate)
          .order('expense_date')
          .order('id')
      ),
      fetchAllRows(() =>
        supabase
          .from('ad_campaigns')
          .select('ad_date, campaign_name, spent_amount, billable_amount, vat_amount')
          .eq('user_id', userId)
          .eq('business_id', businessId)
          .gte('ad_date', startDate)
          .lte('ad_date', endDate)
          .order('ad_date')
          .order('id')
      ),
    ])

    const error = businessResult.error || salesResult.error || purchasesResult.error || expensesResult.error || adsResult.error
    if (error) return NextResponse.json({ error: `Export 데이터 조회 실패: ${error.message}` }, { status: 500 })

    const workbook = buildTaxWorkbook({
      businessName: businessResult.data?.business_name || 'NexOps 사업자',
      startDate,
      endDate,
      sales: (salesResult.data || []).map((row) => ({
        date: row.order_date,
        orderNumber: row.order_number,
        productName: row.option_name || '(상품명 없음)',
        quantity: Number(row.order_quantity) || 0,
        revenue: Number(row.total_amount) || 0,
        cancelAmount: Number(row.cancel_amount) || 0,
        commission: Number(row.commission_fee) || 0,
        commissionVat: Number(row.commission_vat) || 0,
        vat: Number(row.vat) || 0,
        status: row.status,
      })),
      purchases: (purchasesResult.data || []).map((row) => ({
        date: row.order_date,
        poNumber: row.po_number,
        supplierName: row.suppliers?.name || '(공급처 미지정)',
        productName:
          row.products?.product_name
          || row.product_name_memo
          || row.products?.option_name
          || '(상품명 없음)',
        quantity: Number(row.quantity) || 0,
        amount: Number(row.total_amount_krw) || 0,
        customsVat: Number(row.customs_vat) || 0,
        status: row.status,
      })),
      expenses: [
        ...(expensesResult.data || []).map((row) => ({
          date: row.expense_date,
          category: row.category,
          description: row.description || '',
          amount: Number(row.amount) || 0,
          vat: Number(row.vat_amount) || 0,
          paymentMethod: row.payment_method,
        })),
        ...(adsResult.data || []).map((row) => {
          const amounts = resolveAdAmounts(row)
          return {
            date: row.ad_date,
            category: '광고비',
            description: row.campaign_name || '쿠팡 광고',
            amount: amounts.accountingBase,
            vat: amounts.vat,
            paymentMethod: '쿠팡 광고센터',
          }
        }),
      ],
    })

    const filename = `NexOps_tax_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.xlsx`
    return new NextResponse(Uint8Array.from(workbook).buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '세무 자료 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
