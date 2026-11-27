import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertProduct } from "@/lib/supabase/typed-queries";
import { calculateMargin } from "@/lib/calc/margin";
import { getSkuPrefix, generateSku } from "@/lib/utils/sku-generator";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

/** GET /api/products - 소싱 리스트 또는 상품 관리 목록 */
export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const { searchParams } = new URL(request.url);
    const sourceType = searchParams.get("sourceType");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const category = searchParams.get("category");
    const purpose = searchParams.get("purpose");
    const inventoryStatusFilter = searchParams.get("inventoryStatus");

    // purpose=product일 때 Excel '01.상품' 필드 포함 조회
    const isProductView = purpose === "product";

    if (isProductView) {
      let businessId: string;
      try {
        businessId = await requireOwnedBusinessId(userId);
      } catch (r) {
        return r as NextResponse;
      }

      // product 뷰: select('*')로 전체 컬럼 조회 후 계산 필드 산출
      const buildPQuery = () => {
        let q = supabase
          .from("products")
          .select("*")
          .eq("user_id", userId)
          .eq("purpose", "product")
          .order("seq", { ascending: true });
        // service-role 조회는 반드시 현재 사용자가 소유한 사업장으로 한정한다.
        q = q.eq("business_id", businessId);
        if (status) q = q.eq("status", status);
        // 검색: 화면에 표시되는 필드 전체 (쿠팡 노출 상품명·옵션명·바코드·SKU·옵션ID 포함)
        if (search) {
          const fields = [
            "keyword",
            "product_name",
            "coupang_display_name",
            "option_name",
            "barcode",
            "sku",
            "coupang_option_id",
          ];
          q = q.or(fields.map((f) => `${f}.ilike.%${search}%`).join(","));
        }
        if (category) q = q.ilike("category_path", `${category}%`);
        return q;
      };

      // PostgREST max_rows(기본 1000) 캡을 우회하여 전체 조회
      const { data: pData, error: pError } = await fetchAllRows(buildPQuery);
      if (pError) {
        return NextResponse.json(
          { error: `조회 실패: ${pError.message}` },
          { status: 500 },
        );
      }

      const products = (pData || []) as unknown as Record<string, unknown>[];
      const productIds = products.map((p) => p.id as string);

      // 배치 쿼리: 재고수량
      const stockMap = new Map<string, number>();
      if (productIds.length > 0) {
        const { data: invRows } = await supabase
          .from("inventory")
          .select("product_id, coupang_stock")
          .in("product_id", productIds);
        for (const row of (invRows || []) as Record<string, unknown>[]) {
          stockMap.set(
            row.product_id as string,
            Number(row.coupang_stock) || 0,
          );
        }
      }

      // 배치 쿼리: 이동평균 원가 (inventory_state SSOT)
      const avgCostMap = new Map<string, number>();
      if (productIds.length > 0) {
        const { data: stateRows } = await supabase
          .from("inventory_state")
          .select("product_id, avg_cost_krw")
          .in("product_id", productIds);
        for (const row of (stateRows || []) as Record<string, unknown>[]) {
          const cost = Number(row.avg_cost_krw);
          if (cost > 0) avgCostMap.set(row.product_id as string, cost);
        }
      }

      // 배치 쿼리: 매입 이력 집계 (상품별 건수, 총수량) + 리드타임 자동계산 (발주일→입고일)
      const purchaseStatsMap = new Map<
        string,
        { count: number; totalQty: number }
      >();
      const leadAccMap = new Map<string, { sumWeeks: number; count: number }>();
      if (productIds.length > 0) {
        const { data: purchaseRows } = await supabase
          .from("purchases")
          .select("product_id, quantity, status, order_date, arrival_date")
          .in("product_id", productIds)
          .neq("status", "cancelled");
        for (const row of (purchaseRows || []) as Record<string, unknown>[]) {
          const pid = row.product_id as string;
          const prev = purchaseStatsMap.get(pid) || { count: 0, totalQty: 0 };
          purchaseStatsMap.set(pid, {
            count: prev.count + 1,
            totalQty: prev.totalQty + (Number(row.quantity) || 0),
          });

          // 입고완료 건의 (입고일 - 발주일) 평균 → 리드타임 자동계산 (products-io 스킬 §5)
          if (row.status === "arrived" && row.order_date && row.arrival_date) {
            const days =
              (new Date(row.arrival_date as string).getTime() -
                new Date(row.order_date as string).getTime()) /
              86400000;
            if (days >= 0) {
              const acc = leadAccMap.get(pid) || { sumWeeks: 0, count: 0 };
              leadAccMap.set(pid, {
                sumWeeks: acc.sumWeeks + days / 7,
                count: acc.count + 1,
              });
            }
          }
        }
      }

      // 배치 쿼리: 최근 13일 판매수량
      const salesMap = new Map<string, number>();
      if (productIds.length > 0) {
        const thirteenDaysAgo = new Date();
        thirteenDaysAgo.setDate(thirteenDaysAgo.getDate() - 13);
        const { data: salesRows } = await supabase
          .from("sales_transactions")
          .select("product_id, order_quantity")
          .in("product_id", productIds)
          .eq("status", "confirmed")
          .gte("order_date", thirteenDaysAgo.toISOString().split("T")[0]);
        for (const row of (salesRows || []) as Record<string, unknown>[]) {
          const pid = row.product_id as string;
          salesMap.set(
            pid,
            (salesMap.get(pid) || 0) + (Number(row.order_quantity) || 0),
          );
        }
      }

      // 계산 필드 조합
      const items = products.map((p) => {
        const stockQuantity = stockMap.get(p.id as string) ?? null;
        const totalQty13d = salesMap.get(p.id as string) || 0;
        const weeklyAvgSales =
          totalQty13d > 0
            ? Math.round((totalQty13d / (13 / 7)) * 10) / 10
            : null;
        const inventoryWeeks =
          stockQuantity != null && weeklyAvgSales && weeklyAvgSales > 0
            ? Math.round((stockQuantity / weeklyAvgSales) * 10) / 10
            : null;
        // 리드타임: 매입 이력 평균 → 수동값 → 기본 2주 (2026-07-05 CEO 결정)
        const leadAcc = leadAccMap.get(p.id as string);
        const autoLeadWeeks =
          leadAcc && leadAcc.count > 0
            ? Math.round((leadAcc.sumWeeks / leadAcc.count) * 10) / 10
            : null;
        const manualLeadWeeks =
          p.lead_time_weeks != null ? Number(p.lead_time_weeks) : null;
        const leadTimeWeeks = autoLeadWeeks ?? manualLeadWeeks ?? 2;
        const leadTimeSource: "auto" | "manual" | "default" =
          autoLeadWeeks != null
            ? "auto"
            : manualLeadWeeks != null
              ? "manual"
              : "default";
        let purchaseRequired: number | null = null;
        if (weeklyAvgSales != null && weeklyAvgSales < 1) {
          purchaseRequired = 0;
        } else if (
          weeklyAvgSales != null &&
          inventoryWeeks != null &&
          inventoryWeeks < leadTimeWeeks
        ) {
          purchaseRequired = Math.ceil(
            weeklyAvgSales * Math.max(leadTimeWeeks, 4) - (stockQuantity || 0),
          );
        } else {
          purchaseRequired = 0;
        }
        const inventoryStatus: "재고부족" | "재고과잉" | "-" =
          purchaseRequired != null && purchaseRequired > 0
            ? "재고부족"
            : inventoryWeeks != null && inventoryWeeks > 8.5
              ? "재고과잉"
              : "-";

        const commissionRate =
          p.commission_rate != null ? Number(p.commission_rate) : null;
        const unitCostDefault =
          p.unit_cost_default != null ? Number(p.unit_cost_default) : null;
        const fulfillmentFee =
          p.fulfillment_fee_default != null
            ? Number(p.fulfillment_fee_default)
            : null;

        // 이동평균 원가 (SSOT), 없으면 unit_cost_default fallback
        const avgCostKrw = avgCostMap.get(p.id as string) ?? null;
        const effectiveCost = avgCostKrw ?? unitCostDefault;

        // 예상마진 계산 (VAT 제외, 공급가액 기준)
        // 최종판매가 = 판매가 - 할인쿠폰
        // 수수료 = 최종판매가 × 수수료율 (쿠폰 차감 후 기준)
        const listedPrice = p.condition_value
          ? Number(p.condition_value)
          : null;
        const couponDiscount =
          p.seller_discount_coupon != null
            ? Number(p.seller_discount_coupon)
            : 0;
        const sellingPrice =
          listedPrice != null ? listedPrice - couponDiscount : null;
        let estimatedMargin: number | null = null;
        let estimatedMarginRate: number | null = null;
        let minRoas: number | null = null;
        // 수수료 금액은 판매가 기준(sellingPrice × commissionRate)이 원칙 — 원가 기준 계산은
        // 수수료율 정의 자체를 위반해 값이 부정확했다(audit §1-10/1-12). sellingPrice가 없으면
        // 정확한 값을 낼 수 없으므로 잘못된 근사치 대신 null을 반환한다.
        let commissionAmount: number | null = null;
        if (
          sellingPrice &&
          sellingPrice > 0 &&
          effectiveCost != null &&
          commissionRate != null
        ) {
          // 표준 마진 공식(lib/calc/margin.ts calculateMargin)과 통일 — 목록 자체 계산식이
          // 수수료VAT·입출고VAT·부가세를 누락해 마진 과대·최소ROAS 과소로 표시되던 문제 (audit §5-3)
          const calc = calculateMargin({
            sellingPrice,
            unitCost: effectiveCost,
            fulfillmentFee: fulfillmentFee ?? 0,
            commissionRate,
          });
          estimatedMargin = calc.margin;
          estimatedMarginRate = Math.round(calc.marginRate * 1000) / 1000;
          minRoas = Number.isFinite(calc.minRoas)
            ? Math.round(calc.minRoas * 10) / 10
            : null;
          commissionAmount = calc.commissionAmount;
        }

        // 매입 이력
        const purchaseStats = purchaseStatsMap.get(p.id as string) || {
          count: 0,
          totalQty: 0,
        };

        return {
          id: p.id,
          seq: p.seq,
          keyword: p.keyword,
          productName: p.product_name,
          sku: p.sku || null,
          status: p.status,
          barcode: p.barcode || null,
          coupangProductId: p.coupang_product_id || null,
          coupangDisplayName: p.coupang_display_name || null,
          vendorProductId: p.vendor_product_id || null,
          coupangOptionId: p.coupang_option_id || null,
          optionName: p.option_name || null,
          conditionValue: p.condition_value || null,
          returnResaleInfo: p.return_resale_info || null,
          coupangExposureId: p.coupang_exposure_id || null,
          commissionRate,
          fulfillmentFeeDefault: fulfillmentFee,
          unitCostDefault: unitCostDefault,
          sellerDiscountCoupon:
            p.seller_discount_coupon != null
              ? Number(p.seller_discount_coupon)
              : null,
          leadTimeWeeks,
          leadTimeSource,
          commissionAmount,
          stockQuantity,
          weeklyAvgSales,
          inventoryWeeks,
          purchaseRequired,
          inventoryStatus,
          avgCostKrw,
          purchaseCount: purchaseStats.count,
          totalPurchaseQty: purchaseStats.totalQty,
          estimatedMargin,
          estimatedMarginRate,
          minRoas,
          isRefurbished: p.is_refurbished || false,
          productGrade: p.product_grade || null,
          salesStatus: p.sales_status || "active",
        };
      });

      const filtered = inventoryStatusFilter
        ? items.filter((i) => i.inventoryStatus === inventoryStatusFilter)
        : items;

      return NextResponse.json({ data: filtered });
    }

    // ── sourcing 뷰: 기존 로직 ──
    const buildSQuery = () => {
      let q = supabase
        .from("products")
        .select(
          `
          id, seq, keyword, product_name, category_path, sku, options, status, purpose, updated_at,
          product_costs (
            unit_cost, selling_price, margin, margin_rate,
            min_roas, fulfillment_fee, commission_rate,
            supplier_id,
            suppliers ( user_id, name, source_type, url, negotiated_price, shipping_fee )
          )
        `,
        )
        .eq("user_id", userId)
        .order("seq", { ascending: true });
      if (purpose) q = q.eq("purpose", purpose);
      if (status) q = q.eq("status", status);
      if (search)
        q = q.or(`keyword.ilike.%${search}%,product_name.ilike.%${search}%`);
      if (category) q = q.ilike("category_path", `${category}%`);
      return q;
    };

    // PostgREST max_rows(기본 1000) 캡을 우회하여 전체 조회
    const { data: sData, error: sError } = await fetchAllRows(buildSQuery);
    if (sError) {
      return NextResponse.json(
        { error: `조회 실패: ${sError.message}` },
        { status: 500 },
      );
    }

    const collectedKeywords = new Set<string>();
    {
      const { data: kwRows } = await supabase
        .from("keyword_rankings")
        .select("keyword")
        .eq("user_id", userId)
        .limit(2000);
      for (const row of (kwRows || []) as Array<{ keyword: string }>) {
        if (row.keyword) collectedKeywords.add(row.keyword);
      }
    }

    const items: Record<string, unknown>[] = [];
    for (const p of (sData || []) as Record<string, unknown>[]) {
      const costs = Array.isArray(p.product_costs) ? p.product_costs : [];

      const hasRankingData =
        !!p.keyword && collectedKeywords.has(p.keyword as string);

      if (costs.length === 0) {
        items.push({
          id: p.id,
          seq: p.seq,
          sku: p.sku || null,
          keyword: p.keyword,
          productName: p.product_name,
          categoryPath: p.category_path,
          purpose: p.purpose || "sourcing",
          unitCost: 0,
          sellingPrice: 0,
          margin: 0,
          marginRate: 0,
          minRoas: null,
          fulfillmentFee: null,
          commissionRate: null,
          supplierName: null,
          supplierUrl: null,
          negotiatedPrice: null,
          shippingFee: null,
          sourceType: null,
          status: p.status,
          updatedAt: p.updated_at,
          hasRankingData,
        });
      } else {
        for (const cost of costs as Record<string, unknown>[]) {
          const embeddedSupplier = (cost.suppliers || {}) as Record<
            string,
            unknown
          >;
          // service-role 조인이 타 사용자의 과거 오염 supplier_id를 따라가더라도
          // 공급처 상세를 응답으로 노출하지 않는다.
          const supplier =
            embeddedSupplier.user_id === userId ? embeddedSupplier : {};
          items.push({
            id: p.id,
            seq: p.seq,
            sku: p.sku || null,
            keyword: p.keyword,
            productName: p.product_name,
            categoryPath: p.category_path,
            purpose: p.purpose || "sourcing",
            unitCost: cost.unit_cost || 0,
            sellingPrice: cost.selling_price || 0,
            margin: cost.margin || 0,
            marginRate: cost.margin_rate || 0,
            minRoas: cost.min_roas || null,
            fulfillmentFee: cost.fulfillment_fee || null,
            commissionRate: cost.commission_rate || null,
            supplierName: supplier.name || null,
            supplierUrl: supplier.url || null,
            negotiatedPrice: supplier.negotiated_price || null,
            shippingFee: supplier.shipping_fee || null,
            sourceType: supplier.source_type || null,
            status: p.status,
            updatedAt: p.updated_at,
            hasRankingData,
          });
        }
      }
    }

    const filtered = sourceType
      ? items.filter((i) => i.sourceType === sourceType)
      : items;

    return NextResponse.json({ data: filtered });
  } catch (error) {
    return NextResponse.json(
      { error: "상품 목록 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

/** POST /api/products - 상품 신규 등록 */
export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const body = await request.json();
    const purpose = body.purpose || "sourcing";
    // 운영 상품만 사업장에 귀속된다. 소싱 후보는 사업장 공유 자료이므로
    // 사업장 헤더를 요구하지 않고 business_id를 항상 NULL로 저장한다.
    let businessId: string | null = null;
    if (purpose === "product") {
      try {
        businessId = await requireOwnedBusinessId(userId);
      } catch (r) {
        return r as NextResponse;
      }
    }

    // seq/SKU 채번 (사용자 범위) — 부분 유니크 인덱스 (user_id, seq)/(user_id, sku) 충돌 시
    // 재시도할 수 있도록 함수로 분리한다 (audit §1-13)
    const computeNextSeqAndSku = async (): Promise<{
      nextSeq: number;
      sku: string | null;
    }> => {
      const { data: maxSeqRow } = await supabase
        .from("products")
        .select("seq")
        .eq("user_id", userId)
        .not("seq", "is", null)
        .order("seq", { ascending: false })
        .limit(1);
      const nextSeq =
        maxSeqRow && maxSeqRow.length > 0
          ? ((maxSeqRow[0] as Record<string, unknown>).seq as number) + 1
          : 1;

      // SKU 자동 생성 (purpose='product'이고, body.sku가 없고 categoryPath가 있는 경우)
      // 소싱 후보(purpose='sourcing')에는 SKU 불필요
      let sku = body.sku || null;
      if (!sku && purpose === "product" && body.categoryPath) {
        const major = body.categoryPath.split(" > ")[0]?.trim();
        if (major) {
          const prefix = getSkuPrefix(major);
          const { data: existing } = await supabase
            .from("products")
            .select("sku")
            .eq("user_id", userId)
            .like("sku", `${prefix}-%`)
            .order("sku", { ascending: false })
            .limit(1);

          let currentMax = 0;
          if (existing && existing.length > 0) {
            const lastSku = (existing[0] as Record<string, unknown>)
              .sku as string;
            const parts = lastSku.split("-");
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num)) currentMax = num;
          }
          sku = generateSku(prefix, currentMax);
        }
      }
      return { nextSeq, sku };
    };

    const buildInsertPayload = (seq: number, sku: string | null) => ({
      keyword: body.keyword,
      product_name: body.productName,
      category_path: body.categoryPath,
      commission_rate: body.commissionRate,
      sale_type: body.saleType || "로켓그로스",
      status: body.status || "draft",
      search_tags: body.searchTags || [],
      coupang_product_url: body.coupangProductUrl || null,
      notes: body.notes || null,
      sku: sku,
      purpose: purpose,
      seq: seq,
      user_id: userId,
      business_id: purpose === "product" ? businessId : null,
      // Excel '01.상품' 신규 필드 (migration 후 database.ts 재생성 전까지 타입 우회)
      barcode: body.barcode || null,
      coupang_product_id: body.coupangProductId || null,
      coupang_display_name: body.coupangDisplayName || null,
      vendor_product_id: body.vendorProductId || null,
      coupang_option_id: body.coupangOptionId || null,
      option_name: body.optionName || null,
      condition_value: body.conditionValue || null,
      return_resale_info: body.returnResaleInfo || null,
      coupang_exposure_id: body.coupangExposureId || null,
      fulfillment_fee_default: body.fulfillmentFeeDefault ?? null,
      unit_cost_default: body.unitCostDefault ?? null,
      seller_discount_coupon: body.sellerDiscountCoupon ?? 0,
      lead_time_weeks: body.leadTimeWeeks ?? 2,
    });

    const { nextSeq, sku } = await computeNextSeqAndSku();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error } = await insertProduct(
      supabase,
      buildInsertPayload(nextSeq, sku) as any,
    );

    // 23505 = unique_violation. 동시 요청 경합으로 (user_id, seq)/(user_id, sku) 충돌 시
    // 1회 재채번 후 재시도한다 (audit §1-13) — 부분 유니크 인덱스는 오너 승인 완료, remote 적용 대기.
    if (error && error.code === "23505") {
      const retry = await computeNextSeqAndSku();
      ({ data, error } = await insertProduct(
        supabase,
        buildInsertPayload(retry.nextSeq, retry.sku) as any,
      ));
    }

    if (error) {
      console.error("[POST /api/products] Supabase error:", error);
      return NextResponse.json(
        { error: `등록 실패: ${error.message}`, details: error },
        { status: 500 },
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error("[POST /api/products] error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "상품 등록 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
