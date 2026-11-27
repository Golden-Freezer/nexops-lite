import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  buildDailyOps,
  type DailyAdInput,
  type DailyExcelAdInput,
  type DailyNoteInput,
  type DailyOpsRow,
  type DailySalesInput,
  type SettingEventInput,
} from "@/lib/focus/daily-aggregator";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function buildDateSpine(year: number, month: number): string[] {
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return Array.from(
    { length: getDaysInMonth(year, month) },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`,
  );
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addNullable(current: number | null, value: unknown): number | null {
  if (value == null) return current;
  return (current ?? 0) + numeric(value);
}

function buildTotals(rows: DailyOpsRow[]) {
  return rows.reduce(
    (totals, row) => {
      totals.sales_qty += row.sales_qty ?? 0;
      totals.revenue += row.revenue ?? 0;
      totals.margin += row.margin ?? 0;
      totals.ad_cost += row.ad_cost ?? 0;
      totals.net_profit += row.net_profit ?? 0;
      totals.ad_units += row.ad_units ?? 0;
      if (row.ad_cost_basis === "provisional_tablemetric")
        totals.provisionalDays += 1;
      return totals;
    },
    {
      sales_qty: 0,
      revenue: 0,
      margin: 0,
      ad_cost: 0,
      net_profit: 0,
      ad_units: 0,
      provisionalDays: 0,
    },
  );
}

/** 주력상품의 월간 일별 운영 지표를 날짜 spine에 맞춰 반환한다. */
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

    const { searchParams } = new URL(request.url);
    const year = parseInteger(searchParams.get("year"));
    const month = parseInteger(searchParams.get("month"));
    if (
      year === null ||
      year < 1 ||
      year > 9999 ||
      month === null ||
      month < 1 ||
      month > 12
    ) {
      return NextResponse.json(
        { error: "year와 month는 올바른 연월이어야 합니다." },
        { status: 400 },
      );
    }

    const focusProductId = searchParams.get("focusProductId")?.trim() || null;
    let exposureId = searchParams.get("exposureId")?.trim() || "";
    let campaignId = searchParams.get("campaignId")?.trim() || "";
    let linkedProductId: string | null = null;
    let label: string | null = null;

    if (focusProductId) {
      if (!UUID_PATTERN.test(focusProductId)) {
        return NextResponse.json(
          { error: "focusProductId는 올바른 UUID여야 합니다." },
          { status: 400 },
        );
      }

      const { data: focusProduct, error: focusError } = await supabase
        .from("focus_products")
        .select("coupang_exposure_id, campaign_id, product_id, label")
        .eq("id", focusProductId)
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (focusError)
        throw new Error(`주력상품 조회 실패: ${focusError.message}`);
      if (!focusProduct) {
        return NextResponse.json(
          { error: "주력상품을 찾을 수 없습니다." },
          { status: 404 },
        );
      }

      exposureId = focusProduct.coupang_exposure_id;
      campaignId = focusProduct.campaign_id;
      linkedProductId = focusProduct.product_id;
      label = focusProduct.label;
    } else if (!exposureId || !campaignId) {
      return NextResponse.json(
        { error: "focusProductId 또는 exposureId와 campaignId가 필요합니다." },
        { status: 400 },
      );
    }

    const { data: campaign, error: campaignError } = await supabase
      .from("focus_campaign_catalog")
      .select("campaign_id")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (campaignError)
      throw new Error(`캠페인 소속 확인 실패: ${campaignError.message}`);
    if (!campaign) {
      return NextResponse.json(
        { error: "현재 사업장에 속한 캠페인을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const dates = buildDateSpine(year, month);
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // 같은 노출ID의 모든 옵션 상품을 묶어 판매량과 매출을 합산한다.
    const { data: siblingProducts, error: productsError } = await supabase
      .from("products")
      .select("id, product_name")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("coupang_exposure_id", exposureId);

    if (productsError)
      throw new Error(`노출 상품 조회 실패: ${productsError.message}`);

    const productIds: string[] = (siblingProducts || []).map(
      (product: { id: string }) => product.id,
    );
    let productName: string | null = null;
    if (linkedProductId) {
      productName =
        (siblingProducts || []).find(
          (product: { id: string; product_name: string | null }) =>
            product.id === linkedProductId,
        )?.product_name ?? null;

      if (productName === null) {
        const { data: linkedProduct, error: linkedProductError } =
          await supabase
            .from("products")
            .select("product_name")
            .eq("id", linkedProductId)
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .maybeSingle();
        if (linkedProductError) {
          throw new Error(
            `연결 상품명 조회 실패: ${linkedProductError.message}`,
          );
        }
        productName = linkedProduct?.product_name ?? null;
      }
    } else {
      productName =
        (siblingProducts || []).find(
          (product: { product_name: string | null }) =>
            Boolean(product.product_name),
        )?.product_name ?? null;
    }

    const salesPromise =
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : fetchAllRows(() =>
            supabase
              .from("sales_transactions")
              .select("order_date, order_quantity, total_amount, margin")
              .eq("user_id", userId)
              .eq("business_id", businessId)
              .in("product_id", productIds)
              .gte("order_date", startDate)
              .lte("order_date", endDate),
          );

    const adDailyPromise = supabase
      .from("focus_ad_daily")
      .select("metric_date, ad_attributed_units, delivered_ad_cost")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .gte("metric_date", startDate)
      .lte("metric_date", endDate);

    // 서비스 역할 조회이므로 원장 자체도 현재 사업장으로 한정한다.
    const excelAdPromise = fetchAllRows(() =>
      supabase
        .from("ad_campaigns")
        .select("ad_date, billable_amount")
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("campaign_id", campaignId)
        .gte("ad_date", startDate)
        .lte("ad_date", endDate),
    );
    const excelCoveragePromise = fetchAllRows(() =>
      supabase
        .from("ad_campaigns")
        .select("ad_date")
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .gte("ad_date", startDate)
        .lte("ad_date", endDate),
    );

    const settingsPromise = fetchAllRows(() =>
      supabase
        .from("ad_setting_change")
        .select("setting_key, setting_value, effective_on, effective_at")
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("campaign_id", campaignId)
        .lte("effective_on", endDate),
    );
    const notesPromise = supabase
      .from("focus_daily_note")
      .select("metric_date, note")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("coupang_exposure_id", exposureId)
      .gte("metric_date", startDate)
      .lte("metric_date", endDate);
    const freshnessPromise = supabase
      .from("focus_ad_daily")
      .select("last_observed_at")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .order("last_observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [
      salesResult,
      adDailyResult,
      excelAdResult,
      excelCoverageResult,
      settingsResult,
      notesResult,
      freshnessResult,
    ] = await Promise.all([
      salesPromise,
      adDailyPromise,
      excelAdPromise,
      excelCoveragePromise,
      settingsPromise,
      notesPromise,
      freshnessPromise,
    ]);

    if (salesResult.error)
      throw new Error(`판매 조회 실패: ${salesResult.error.message}`);
    if (adDailyResult.error)
      throw new Error(`광고 일별 조회 실패: ${adDailyResult.error.message}`);
    if (excelAdResult.error)
      throw new Error(`광고 엑셀 조회 실패: ${excelAdResult.error.message}`);
    if (excelCoverageResult.error) {
      throw new Error(
        `광고 엑셀 커버리지 조회 실패: ${excelCoverageResult.error.message}`,
      );
    }
    if (settingsResult.error)
      throw new Error(
        `광고 설정 이력 조회 실패: ${settingsResult.error.message}`,
      );
    if (notesResult.error)
      throw new Error(`일별 비고 조회 실패: ${notesResult.error.message}`);
    if (freshnessResult.error)
      throw new Error(
        `광고 최신성 조회 실패: ${freshnessResult.error.message}`,
      );

    const salesByDate = new Map<string, DailySalesInput>();
    for (const row of salesResult.data || []) {
      const current = salesByDate.get(row.order_date) || {
        date: row.order_date,
        sales_qty: 0,
        revenue: 0,
        margin: 0,
      };
      current.sales_qty += numeric(row.order_quantity);
      current.revenue += numeric(row.total_amount);
      current.margin += numeric(row.margin);
      salesByDate.set(row.order_date, current);
    }

    const adByDate = new Map<string, DailyAdInput>();
    for (const row of adDailyResult.data || []) {
      const current = adByDate.get(row.metric_date) || {
        date: row.metric_date,
        ad_units: null,
        delivered_ad_cost: null,
      };
      current.ad_units = addNullable(current.ad_units, row.ad_attributed_units);
      current.delivered_ad_cost = addNullable(
        current.delivered_ad_cost,
        row.delivered_ad_cost,
      );
      adByDate.set(row.metric_date, current);
    }

    const excelAdByDate = new Map<string, DailyExcelAdInput>();
    for (const row of excelAdResult.data || []) {
      const current = excelAdByDate.get(row.ad_date) || {
        date: row.ad_date,
        billable_sum: 0,
      };
      current.billable_sum += numeric(row.billable_amount);
      excelAdByDate.set(row.ad_date, current);
    }

    const settings: SettingEventInput[] = (settingsResult.data || [])
      .filter(
        (row) =>
          row.setting_key === "daily_budget" ||
          row.setting_key === "target_roas",
      )
      .map((row) => ({
        setting_key: row.setting_key as SettingEventInput["setting_key"],
        setting_value: numeric(row.setting_value),
        effective_on: row.effective_on,
        effective_at: row.effective_at,
      }));
    const notes: DailyNoteInput[] = (notesResult.data || []).map(
      (row: { metric_date: string; note: string }) => ({
        date: row.metric_date,
        note: row.note,
      }),
    );

    const rows = buildDailyOps({
      dates,
      sales: [...salesByDate.values()],
      ad: [...adByDate.values()],
      excelAd: [...excelAdByDate.values()],
      excelCoveredDates: [
        ...new Set<string>(
          (excelCoverageResult.data || []).map(
            (row: { ad_date: string }) => row.ad_date,
          ),
        ),
      ],
      settings,
      notes,
    });

    return NextResponse.json({
      data: {
        rows,
        month: { year, month },
        focus: {
          exposureId,
          campaignId,
          productName,
          label,
        },
        totals: buildTotals(rows),
        freshness: {
          adDailyLastObservedAt: freshnessResult.data?.last_observed_at ?? null,
        },
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
