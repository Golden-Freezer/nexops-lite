import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStockAlerts } from "@/lib/inventory/stock";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { kstDateStr, kstTodayStr } from "@/lib/analytics/date-buckets";
import {
  buildPurchaseLeadTimeMap,
  calculateReorderPlan,
  resolveLeadTimeProfile,
  type PurchaseLeadTimeRow,
} from "@/lib/inventory/reorder";
import type { InventoryItem } from "@/types/inventory";
import {
  businessSettingsFromRow,
  defaultBusinessSettings,
  isWithinInventoryAlertThreshold,
} from "@/lib/settings/config";

/** GET /api/inventory/alerts - 위험/경고 재고 알림 목록 */
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
    let settings = defaultBusinessSettings(businessId);
    const { data: settingsRow, error: settingsError } = await supabase
      .from("business_settings")
      .select("inventory_alert_threshold_days, inventory_notifications_enabled")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) {
      return NextResponse.json(
        { error: `알림 설정 조회 실패: ${settingsError.message}` },
        { status: 500 },
      );
    }
    settings = businessSettingsFromRow(businessId, settingsRow);
    if (!settings.inventoryNotificationsEnabled) {
      return NextResponse.json({ data: [] });
    }

    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("inventory")
        .select(
          "*, products!inner(product_name, option_name, coupang_display_name, barcode, sku, keyword, user_id, lead_time_weeks, business_id, is_refurbished, sales_status)",
        )
        .eq("products.user_id", userId)
        .eq("products.business_id", businessId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false }),
    );
    if (error) {
      return NextResponse.json(
        { error: `재고 알림 조회 실패: ${error.message}` },
        { status: 500 },
      );
    }

    const inventoryRows = data ?? [];
    const productIds = inventoryRows.map(
      (row: any) => row.product_id as string,
    );
    const salesMap = new Map<string, number>();
    let purchaseLeadTimeRows: PurchaseLeadTimeRow[] = [];

    if (productIds.length > 0) {
      const [salesResult, purchaseResult] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from("sales_transactions")
            .select("id, product_id, order_quantity, order_date")
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .eq("status", "confirmed")
            .gte("order_date", kstDateStr(-14))
            .order("order_date", { ascending: true })
            .order("id", { ascending: true }),
        ),
        fetchAllRows(() =>
          supabase
            .from("purchases")
            .select(
              "id, product_id, order_date, arrival_date, lead_time_weeks, suppliers(name, lead_time_days, is_active)",
            )
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .order("order_date", { ascending: false })
            .order("id", { ascending: false }),
        ),
      ]);
      if (salesResult.error) {
        return NextResponse.json(
          { error: `알림 판매 집계 조회 실패: ${salesResult.error.message}` },
          { status: 500 },
        );
      }
      if (purchaseResult.error) {
        return NextResponse.json(
          { error: `알림 리드타임 조회 실패: ${purchaseResult.error.message}` },
          { status: 500 },
        );
      }
      const salesRows = salesResult.data;
      for (const sale of (salesRows ?? []) as any[]) {
        const productId = sale.product_id as string;
        salesMap.set(
          productId,
          (salesMap.get(productId) ?? 0) + (Number(sale.order_quantity) || 0),
        );
      }
      purchaseLeadTimeRows = (purchaseResult.data ??
        []) as PurchaseLeadTimeRow[];
    }

    const purchaseLeadTimeMap = buildPurchaseLeadTimeMap(purchaseLeadTimeRows);
    const today = kstTodayStr();
    const items: InventoryItem[] = (data ?? []).map((row: any) => {
      const product = row.products || {};
      const currentStock =
        row.coupang_stock != null
          ? Number(row.coupang_stock) || 0
          : Number(row.current_stock) || 0;
      const avgDailySales =
        Math.round(((salesMap.get(row.product_id) ?? 0) / 14) * 10) / 10;
      const leadTime = resolveLeadTimeProfile(
        purchaseLeadTimeMap.get(row.product_id),
        product.lead_time_weeks,
      );
      const reorderPlan = calculateReorderPlan(
        currentStock,
        avgDailySales,
        leadTime.leadTimeDays,
        today,
      );
      const noReorder =
        product.is_refurbished ||
        ["paused", "discontinued"].includes(product.sales_status || "active");
      const withinAlertWindow = isWithinInventoryAlertThreshold(
        reorderPlan.daysUntilReorder,
        settings.inventoryAlertThresholdDays,
      );
      const stockStatus = noReorder
        ? "normal"
        : reorderPlan.stockStatus === "normal" && withinAlertWindow
          ? "warning"
          : reorderPlan.stockStatus;

      return {
        id: row.id,
        productId: row.product_id,
        productName:
          product.coupang_display_name ||
          product.product_name ||
          product.option_name ||
          "",
        optionName: product.option_name || null,
        barcode: product.barcode || null,
        sku: product.sku ?? null,
        productGrade: null,
        isRefurbished: product.is_refurbished || false,
        currentStock,
        coupangStock: currentStock,
        avgSales7d: 0,
        avgSales14d: avgDailySales,
        avgSales30d: 0,
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
        avgCostKrw: 0,
        stockValue: 0,
        daysOfSupply: reorderPlan.daysOfSupply,
        stockStatus,
        salesStatus: product.sales_status || "active",
      };
    });

    const alerts = getStockAlerts(items);
    return NextResponse.json({ data: alerts });
  } catch (error) {
    return NextResponse.json(
      { error: "재고 알림 조회 중 오류" },
      { status: 500 },
    );
  }
}
