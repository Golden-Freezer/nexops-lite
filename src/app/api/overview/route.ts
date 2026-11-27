import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { fetchPnlRows, aggregatePnl } from "@/lib/analytics/pnl-aggregator";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { kstTodayStr, kstDateStr } from "@/lib/analytics/date-buckets";
import type { BusinessOverview, OverviewData } from "@/lib/analytics/types";

/**
 * GET /api/overview — 전 사업장 합산+비교 (읽기 전용)
 *
 * 격리 설계: X-Business-Id 헤더를 읽지 않는다. userId 소유 businesses 목록을
 * 서버에서 조회해 각 business_id별로 집계한다 (fail-open 경로 재사용 금지).
 * 이 라우트에 쓰기 메서드는 만들지 않는다.
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || kstDateStr(-29);
    const endDate = searchParams.get("endDate") || kstTodayStr();

    const supabase = createAdminClient();

    const { data: bizList, error: bizError } = await fetchAllRows(() =>
      supabase
        .from("businesses")
        .select("id, business_name")
        .eq("user_id", userId)
        .order("business_name", { ascending: true })
        .order("id", { ascending: true }),
    );
    if (bizError) {
      return NextResponse.json(
        { error: `사업자 조회 실패: ${bizError.message}` },
        { status: 500 },
      );
    }

    const emptyCombined = {
      revenue: 0,
      margin: 0,
      adSpend: 0,
      expenses: 0,
      netProfit: 0,
      marginRate: 0,
      stockAlertCount: 0,
      pendingPurchaseCount: 0,
    };

    if (!bizList || bizList.length === 0) {
      const data: OverviewData = {
        period: { startDate, endDate },
        combined: emptyCombined,
        businesses: [],
      };
      return NextResponse.json({ data });
    }

    // 매입 진행중 상태 목록 (기존 dashboard 라우트와 동일)
    const PENDING_STATUSES = [
      "ordered",
      "paid_1688",
      "collecting",
      "processing",
      "shipped",
      "customs",
      "domestic",
    ];

    const businesses: BusinessOverview[] = await Promise.all(
      bizList.map(async (biz): Promise<BusinessOverview> => {
        const rows = await fetchPnlRows(
          supabase,
          userId,
          biz.id,
          startDate,
          endDate,
        );
        const { summary } = aggregatePnl(rows, startDate, endDate, "daily");

        // 매입 진행 건수
        const { count: pendingCount, error: pendingError } = await supabase
          .from("purchases")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("business_id", biz.id)
          .in("status", PENDING_STATUSES);
        if (pendingError) {
          throw new Error(`매입 진행 건수 조회 실패: ${pendingError.message}`);
        }

        // 재고 소진 (v1 단순화): 판매중 상품 중 coupang_stock <= 0
        const { data: invRows, error: inventoryError } = await fetchAllRows(
          () =>
            supabase
              .from("inventory")
              .select(
                "product_id, coupang_stock, products!inner(business_id, user_id, is_refurbished, sales_status)",
              )
              .eq("products.user_id", userId)
              .eq("products.business_id", biz.id)
              .order("product_id", { ascending: true }),
        );
        if (inventoryError) {
          throw new Error(`재고 소진 조회 실패: ${inventoryError.message}`);
        }
        type InvRow = {
          product_id: string;
          coupang_stock: number | null;
          products: {
            business_id: string | null;
            user_id: string;
            is_refurbished: boolean | null;
            sales_status: string | null;
          } | null;
        };
        let stockAlertCount = 0;
        for (const row of (invRows || []) as InvRow[]) {
          const p = row.products;
          if (!p || p.business_id !== biz.id) continue;
          const salesStatus = p.sales_status || "active";
          if (
            p.is_refurbished ||
            ["paused", "discontinued"].includes(salesStatus)
          )
            continue;
          if ((Number(row.coupang_stock) || 0) <= 0) stockAlertCount += 1;
        }

        const revenue = summary.totalRevenue;
        const margin = summary.totalMargin;
        return {
          businessId: biz.id,
          businessName: biz.business_name,
          revenue,
          margin,
          adSpend: summary.totalAdSpend,
          expenses: summary.totalExpenses,
          netProfit: summary.netProfit,
          marginRate: revenue > 0 ? (margin / revenue) * 100 : 0,
          stockAlertCount,
          pendingPurchaseCount: pendingCount || 0,
        };
      }),
    );

    const combined = businesses.reduce(
      (acc, b) => ({
        revenue: acc.revenue + b.revenue,
        margin: acc.margin + b.margin,
        adSpend: acc.adSpend + b.adSpend,
        expenses: acc.expenses + b.expenses,
        netProfit: acc.netProfit + b.netProfit,
        marginRate: 0, // 아래에서 합산값으로 재계산
        stockAlertCount: acc.stockAlertCount + b.stockAlertCount,
        pendingPurchaseCount: acc.pendingPurchaseCount + b.pendingPurchaseCount,
      }),
      { ...emptyCombined },
    );
    combined.marginRate =
      combined.revenue > 0 ? (combined.margin / combined.revenue) * 100 : 0;

    const data: OverviewData = {
      period: { startDate, endDate },
      combined,
      businesses,
    };
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "전체 현황 집계 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
