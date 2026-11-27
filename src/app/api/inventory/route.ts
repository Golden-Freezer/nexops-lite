import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { kstTodayStr } from "@/lib/analytics/date-buckets";
import {
  buildPurchaseLeadTimeMap,
  calculateReorderPlan,
  resolveLeadTimeProfile,
  type PurchaseLeadTimeRow,
} from "@/lib/inventory/reorder";

/** GET /api/inventory - 재고 현황 (7/14/30일 판매 데이터 포함) */
export async function GET() {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    const buildQuery = () => {
      const q = supabase
        .from("inventory")
        .select(
          "*, products!inner(id, product_name, option_name, coupang_display_name, barcode, sku, keyword, user_id, lead_time_weeks, business_id, product_grade, is_refurbished, sales_status)",
        )
        .eq("products.user_id", userId)
        .eq("products.business_id", businessId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false });
      return q;
    };

    // PostgREST max_rows(기본 1000) 캡을 우회하여 전체 조회
    const { data, error } = await fetchAllRows(buildQuery);
    if (error)
      return NextResponse.json(
        { error: `재고 조회 실패: ${error.message}` },
        { status: 500 },
      );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const productIds = rows.map((r: any) => r.product_id as string);

    // 7/14/30일 판매 데이터 한번에 조회 (최근 30일)
    const salesMap = new Map<
      string,
      { d7: number; d14: number; d30: number }
    >();
    if (productIds.length > 0) {
      const now = new Date();
      const d30ago = new Date(now.getTime() - 30 * 86400000)
        .toISOString()
        .split("T")[0];

      const { data: salesRows, error: salesError } = await fetchAllRows(() =>
        supabase
          .from("sales_transactions")
          .select("id, product_id, order_quantity, order_date")
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .eq("status", "confirmed")
          .gte("order_date", d30ago)
          .order("order_date", { ascending: true })
          .order("id", { ascending: true }),
      );
      if (salesError) {
        return NextResponse.json(
          { error: `판매 집계 조회 실패: ${salesError.message}` },
          { status: 500 },
        );
      }

      const d7ago = new Date(now.getTime() - 7 * 86400000)
        .toISOString()
        .split("T")[0];
      const d14ago = new Date(now.getTime() - 14 * 86400000)
        .toISOString()
        .split("T")[0];

      for (const s of (salesRows || []) as any[]) {
        const pid = s.product_id as string;
        const qty = Number(s.order_quantity) || 0;
        const date = s.order_date as string;
        const prev = salesMap.get(pid) || { d7: 0, d14: 0, d30: 0 };
        prev.d30 += qty;
        if (date >= d14ago) prev.d14 += qty;
        if (date >= d7ago) prev.d7 += qty;
        salesMap.set(pid, prev);
      }
    }

    // 이동평균 원가 조회
    const avgCostMap = new Map<string, number>();
    if (productIds.length > 0) {
      // .in() URL 길이 한계를 피하기 위해 상품 ID를 나누고, 각 묶음도 전체 페이징한다.
      for (let offset = 0; offset < productIds.length; offset += 500) {
        const ids = productIds.slice(offset, offset + 500);
        const { data: stateRows, error: stateError } = await fetchAllRows(() =>
          supabase
            .from("inventory_state")
            .select("product_id, avg_cost_krw")
            .in("product_id", ids)
            .order("product_id", { ascending: true }),
        );
        if (stateError) {
          return NextResponse.json(
            { error: `재고 원가 조회 실패: ${stateError.message}` },
            { status: 500 },
          );
        }
        for (const r of (stateRows || []) as any[]) {
          const cost = Number(r.avg_cost_krw);
          if (cost > 0) avgCostMap.set(r.product_id, cost);
        }
      }
    }

    // 상품별 공급처/실입고 리드타임 후보 조회
    const purchaseLeadTimeMap = new Map();
    if (productIds.length > 0) {
      const { data: purchaseRows, error: purchaseError } = await fetchAllRows(
        () =>
          supabase
            .from("purchases")
            .select(
              "id, product_id, order_date, arrival_date, lead_time_weeks, suppliers(name, lead_time_days, is_active)",
            )
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .order("order_date", { ascending: false })
            .order("id", { ascending: false }),
      );
      if (purchaseError) {
        return NextResponse.json(
          { error: `매입 리드타임 조회 실패: ${purchaseError.message}` },
          { status: 500 },
        );
      }
      const resolved = buildPurchaseLeadTimeMap(
        (purchaseRows ?? []) as PurchaseLeadTimeRow[],
      );
      for (const [productId, summary] of resolved) {
        purchaseLeadTimeMap.set(productId, summary);
      }
    }

    const today = kstTodayStr();
    const items = rows.map((row: any) => {
      const product = row.products || {};
      const productName =
        product.coupang_display_name ||
        product.product_name ||
        product.keyword ||
        "";
      const coupangStock = Number(row.coupang_stock) || 0;
      const currentStock = Number(row.current_stock) || 0;
      const leadTime = resolveLeadTimeProfile(
        purchaseLeadTimeMap.get(row.product_id),
        product.lead_time_weeks,
      );

      const sales = salesMap.get(row.product_id) || { d7: 0, d14: 0, d30: 0 };
      const avgSales7d = Math.round((sales.d7 / 7) * 10) / 10;
      const avgSales14d = Math.round((sales.d14 / 14) * 10) / 10;
      const avgSales30d = Math.round((sales.d30 / 30) * 10) / 10;

      // 기본 기준: 14일 (클라이언트에서 전환)
      const avgDailySales = avgSales14d;

      const reorderPlan = calculateReorderPlan(
        coupangStock,
        avgDailySales,
        leadTime.leadTimeDays,
        today,
      );

      // 발주 불필요 조건: 반품 상품 / 판매중지 / 판매종료
      const salesStatus = product.sales_status || "active";
      const noReorder =
        product.is_refurbished ||
        ["paused", "discontinued"].includes(salesStatus);

      let stockStatus: "danger" | "warning" | "normal" | "overstock" = "normal";
      if (noReorder) {
        // 발주 불필요 상품: danger/warning 판정 안 함
        if (
          reorderPlan.reorderPoint > 0 &&
          coupangStock > reorderPlan.reorderPoint * 3
        )
          stockStatus = "overstock";
      } else {
        stockStatus = reorderPlan.stockStatus;
      }

      const avgCostKrw = avgCostMap.get(row.product_id) || 0;
      const stockValue = coupangStock * avgCostKrw;

      return {
        id: row.id,
        productId: row.product_id,
        productName,
        optionName: product.option_name || null,
        barcode: product.barcode || null,
        sku: product.sku ?? null,
        productGrade: product.product_grade || null,
        isRefurbished: product.is_refurbished || false,
        coupangStock,
        currentStock,
        avgSales7d,
        avgSales14d,
        avgSales30d,
        avgDailySales,
        reorderPoint: reorderPlan.reorderPoint,
        safetyStock: reorderPlan.safetyStock,
        leadTimeDays: leadTime.leadTimeDays,
        leadTimeWeeks: leadTime.leadTimeWeeks,
        leadTimeSource: leadTime.leadTimeSource,
        supplierName: leadTime.supplierName,
        daysUntilReorder: reorderPlan.daysUntilReorder,
        reorderDate: reorderPlan.reorderDate,
        lastInboundAt: row.last_inbound_at,
        daysOfSupply: reorderPlan.daysOfSupply,
        stockStatus,
        salesStatus,
        avgCostKrw,
        stockValue,
      };
    });

    return NextResponse.json({ data: items });
  } catch (error) {
    return NextResponse.json(
      { error: "재고 목록 조회 중 오류" },
      { status: 500 },
    );
  }
}
