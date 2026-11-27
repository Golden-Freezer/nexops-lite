import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { kstTodayStr, kstDateStr } from "@/lib/analytics/date-buckets";
import {
  buildPurchaseLeadTimeMap,
  calculateReorderPlan,
  resolveLeadTimeProfile,
  type PurchaseLeadTimeRow,
} from "@/lib/inventory/reorder";
import {
  businessSettingsFromRow,
  isWithinInventoryAlertThreshold,
} from "@/lib/settings/config";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { resolveAdAmounts } from "@/lib/ads/amounts";
import { exposeDashboardImportState } from "@/lib/import/safe-gap-consumer-state";

/** GET /api/dashboard - 대시보드 집계 데이터 (기간 필터: startDate, endDate) */
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
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (response) {
      return response as NextResponse;
    }
    const { data: settingsRow, error: settingsError } = await supabase
      .from("business_settings")
      .select("inventory_alert_threshold_days, inventory_notifications_enabled")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) {
      return NextResponse.json(
        { error: `사업장 설정 조회 실패: ${settingsError.message}` },
        { status: 500 },
      );
    }
    const businessSettings = businessSettingsFromRow(businessId, settingsRow);

    // 기간 필터 (미지정 시 최근 30일)
    const { searchParams } = new URL(request.url);
    // UTC 기준이면 KST 00~09시에 당일 매출이 누락된다 (audit §1-12)
    const todayStr = kstTodayStr();
    const startDate = searchParams.get("startDate") || kstDateStr(-30);
    const endDate = searchParams.get("endDate") || todayStr;
    // 재고 회전 속도 산정용 (현재 상태 기준, 기간 무관)
    const fourteenDaysAgo = kstDateStr(-14);

    const [
      salesResult,
      productsResult,
      purchasesResult,
      inventoryResult,
      purchaseLeadResult,
      adResult,
      recentImportsResult,
      expensesResult,
    ] = await Promise.all([
      // 기간 내 판매
      fetchAllRows(() =>
        supabase
          .from("sales_transactions")
          .select(
            "order_date, total_amount, order_quantity, margin, unit_cost, commission_fee, fulfillment_fee",
          )
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .gte("order_date", startDate)
          .lte("order_date", endDate)
          .eq("status", "confirmed")
          .order("order_date", { ascending: true })
          .order("id", { ascending: true }),
      ),

      // 상품 수
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("purpose", "product"),

      // 매입 대기
      supabase
        .from("purchases")
        .select(
          "id, status, order_date, quantity, unit_cost_krw, total_amount_krw, expected_arrival_date, payment1_status, payment2_status, payment3_status, products(product_name, option_name)",
        )
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("products.user_id", userId)
        .eq("products.business_id", businessId)
        .in("status", [
          "ordered",
          "paid_1688",
          "collecting",
          "processing",
          "shipped",
          "customs",
          "domestic",
        ])
        .order("order_date", { ascending: true })
        .limit(10),

      // 재고 현황 (inventory 테이블 기반)
      fetchAllRows(() =>
        supabase
          .from("inventory")
          .select(
            "product_id, coupang_stock, products!inner(id, product_name, option_name, coupang_display_name, lead_time_weeks, user_id, business_id, is_refurbished, sales_status)",
          )
          .eq("products.user_id", userId)
          .eq("products.business_id", businessId)
          .order("product_id", { ascending: true }),
      ),

      // 공급처/실입고 리드타임 후보
      fetchAllRows(() =>
        supabase
          .from("purchases")
          .select(
            "product_id, order_date, arrival_date, lead_time_weeks, suppliers(name, lead_time_days, is_active)",
          )
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .eq("suppliers.user_id", userId)
          .not("product_id", "is", null)
          .order("order_date", { ascending: false })
          .order("id", { ascending: true }),
      ),

      // 기간 내 광고비 (VAT 포함)
      fetchAllRows(() =>
        supabase
          .from("ad_campaigns")
          .select("ad_date, spent_amount, billable_amount, vat_amount")
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .gte("ad_date", startDate)
          .lte("ad_date", endDate)
          .order("ad_date", { ascending: true })
          .order("id", { ascending: true }),
      ),

      // 최근 Import 5건
      supabase
        .from("coupang_imports")
        .select(
          "id, import_type, file_name, row_count, success_count, status, summary, completed_at",
        )
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .order("completed_at", { ascending: false })
        .limit(5),

      // 기간 내 지출
      fetchAllRows(() =>
        supabase
          .from("expenses")
          .select("amount, payment_method")
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .gte("expense_date", startDate)
          .lte("expense_date", endDate)
          .order("expense_date", { ascending: true })
          .order("id", { ascending: true }),
      ),
    ]);

    const queryError =
      salesResult.error ||
      productsResult.error ||
      purchasesResult.error ||
      inventoryResult.error ||
      purchaseLeadResult.error ||
      adResult.error ||
      recentImportsResult.error ||
      expensesResult.error;
    if (queryError) {
      return NextResponse.json(
        { error: `대시보드 데이터 조회 실패: ${queryError.message}` },
        { status: 500 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sales = salesResult.data as any[];

    // 일별 매출 집계
    const dailySales = new Map<
      string,
      { revenue: number; quantity: number; margin: number }
    >();
    for (const s of sales) {
      const date = s.order_date;
      const prev = dailySales.get(date) || {
        revenue: 0,
        quantity: 0,
        margin: 0,
      };
      dailySales.set(date, {
        revenue: prev.revenue + (Number(s.total_amount) || 0),
        quantity: prev.quantity + (Number(s.order_quantity) || 0),
        margin: prev.margin + (Number(s.margin) || 0),
      });
    }
    const salesTrend = Array.from(dailySales.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    // 총합
    const totalRevenue = sales.reduce(
      (s, r) => s + (Number(r.total_amount) || 0),
      0,
    );
    const totalQuantity = sales.reduce(
      (s, r) => s + (Number(r.order_quantity) || 0),
      0,
    );
    const totalMargin = sales.reduce((s, r) => s + (Number(r.margin) || 0), 0);
    const totalCost = sales.reduce(
      (s, r) =>
        s + (Number(r.unit_cost) || 0) * (Number(r.order_quantity) || 0),
      0,
    );
    const totalCommission = sales.reduce(
      (s, r) => s + (Number(r.commission_fee) || 0),
      0,
    );
    const totalFulfillment = sales.reduce(
      (s, r) => s + (Number(r.fulfillment_fee) || 0),
      0,
    );
    // 광고비는 조정 후 청구 가능액(없을 때만 소진액) + VAT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalAdSpend = (adResult.data as any[]).reduce(
      (sum, row) => sum + resolveAdAmounts(row).accountingTotal,
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expenseRows = expensesResult.data as any[];
    const totalExpenses = expenseRows
      .filter((row) => row.payment_method !== "coupang_deduction")
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const coupangDeductionExpenses = expenseRows
      .filter((row) => row.payment_method === "coupang_deduction")
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    // 재고 경고: inventory 기반 + 14일 판매량으로 상태 계산 (재고관리 페이지와 동일 로직)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inventoryRows = inventoryResult.data as any[];
    const invProductIds = inventoryRows.map((r) => r.product_id as string);
    const purchaseLeadTimeMap = buildPurchaseLeadTimeMap(
      purchaseLeadResult.data as PurchaseLeadTimeRow[],
    );

    // 14일 판매량 조회
    const invSalesMap = new Map<string, number>();
    if (invProductIds.length > 0) {
      const { data: invSalesRows, error: invSalesError } = await fetchAllRows(
        () =>
          supabase
            .from("sales_transactions")
            .select("product_id, order_quantity")
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .in("product_id", invProductIds)
            .eq("status", "confirmed")
            .gte("order_date", fourteenDaysAgo)
            .order("order_date", { ascending: true })
            .order("id", { ascending: true }),
      );
      if (invSalesError) {
        return NextResponse.json(
          { error: `재고 판매량 조회 실패: ${invSalesError.message}` },
          { status: 500 },
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const s of (invSalesRows || []) as any[]) {
        const pid = s.product_id as string;
        invSalesMap.set(
          pid,
          (invSalesMap.get(pid) || 0) + (Number(s.order_quantity) || 0),
        );
      }
    }

    // 재고 상태 계산 (danger/warning만 필터)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stockAlerts: any[] = [];
    for (const row of inventoryRows) {
      const product = row.products || {};
      // 반품 상품 / 판매중지 / 판매종료 → 발주 불필요, 스킵
      const salesStatus = product.sales_status || "active";
      if (
        product.is_refurbished ||
        ["paused", "discontinued"].includes(salesStatus)
      )
        continue;

      const coupangStock = Number(row.coupang_stock) || 0;
      const leadTime = resolveLeadTimeProfile(
        purchaseLeadTimeMap.get(row.product_id),
        product.lead_time_weeks,
      );
      const totalQty14d = invSalesMap.get(row.product_id) || 0;
      const avgDailySales = Math.round((totalQty14d / 14) * 10) / 10;
      const reorderPlan = calculateReorderPlan(
        coupangStock,
        avgDailySales,
        leadTime.leadTimeDays,
        todayStr,
      );

      const withinAlertWindow = isWithinInventoryAlertThreshold(
        reorderPlan.daysUntilReorder,
        businessSettings.inventoryAlertThresholdDays,
      );
      if (
        businessSettings.inventoryNotificationsEnabled &&
        (reorderPlan.stockStatus === "danger" ||
          reorderPlan.stockStatus === "warning" ||
          withinAlertWindow)
      ) {
        const alertStatus =
          reorderPlan.stockStatus === "normal"
            ? "warning"
            : reorderPlan.stockStatus;
        stockAlerts.push({
          id: row.product_id,
          product_name:
            product.coupang_display_name || product.product_name || "",
          option_name: product.option_name || "",
          coupang_stock: coupangStock,
          avg_daily_sales: avgDailySales,
          reorder_point: reorderPlan.reorderPoint,
          reorder_date: reorderPlan.reorderDate,
          days_until_reorder: reorderPlan.daysUntilReorder,
          lead_time_days: leadTime.leadTimeDays,
          lead_time_source: leadTime.leadTimeSource,
          supplier_name: leadTime.supplierName,
          status: alertStatus,
        });
      }
    }
    // danger 우선, 재고 적은 순 정렬
    stockAlerts.sort((a, b) => {
      if (a.status !== b.status) return a.status === "danger" ? -1 : 1;
      return a.coupang_stock - b.coupang_stock;
    });

    return NextResponse.json({
      data: {
        totalRevenue,
        totalQuantity,
        totalMargin,
        totalCost,
        totalCommission,
        totalFulfillment,
        totalAdSpend,
        totalExpenses,
        coupangDeductionExpenses,
        productCount: productsResult.count || 0,
        stockAlertCount: stockAlerts.length,
        pendingPurchaseCount: (purchasesResult.data || []).length,
        salesTrend,
        pendingPurchases: purchasesResult.data || [],
        stockAlerts: stockAlerts.slice(0, 10),
        recentImports: (recentImportsResult.data || []).map(
          (row: Record<string, unknown>) => exposeDashboardImportState(row),
        ),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대시보드 조회 오류" },
      { status: 500 },
    );
  }
}
