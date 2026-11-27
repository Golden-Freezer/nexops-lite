import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { kstDateStr } from "@/lib/analytics/date-buckets";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  buildDailyOps,
  type DailyAdInput,
  type DailyExcelAdInput,
  type DailyNoteInput,
  type DailySalesInput,
  type SettingEventInput,
} from "@/lib/focus/daily-aggregator";
import {
  buildAdAnalysis,
  type SettingChangePoint,
} from "@/lib/focus/ad-analysis";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMonths(value: string | null): number | null {
  if (value == null) return 3;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 24
    ? parsed
    : null;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addNullable(current: number | null, value: unknown): number | null {
  if (value == null) return current;
  return (current ?? 0) + numeric(value);
}

function buildDateSpine(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function analysisStartDate(endDate: string, months: number): string {
  const year = Number(endDate.slice(0, 4));
  const month = Number(endDate.slice(5, 7));
  const start = new Date(Date.UTC(year, month - months, 1));
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function deriveChangePoints(
  settings: SettingEventInput[],
  startDate: string,
  endDate: string,
): SettingChangePoint[] {
  const points: SettingChangePoint[] = [];
  const keys: SettingEventInput["setting_key"][] = [
    "daily_budget",
    "target_roas",
  ];

  for (const settingKey of keys) {
    const latestByDate = new Map<string, SettingEventInput>();
    for (const setting of settings) {
      if (setting.setting_key !== settingKey) continue;
      const current = latestByDate.get(setting.effective_on);
      if (
        current == null ||
        (setting.effective_at ?? "") > (current.effective_at ?? "")
      ) {
        latestByDate.set(setting.effective_on, setting);
      }
    }

    const segments = [...latestByDate.values()].sort((left, right) =>
      left.effective_on.localeCompare(right.effective_on),
    );
    let previous: number | null = null;
    for (const segment of segments) {
      const next = segment.setting_value;
      if (
        next !== previous &&
        segment.effective_on >= startDate &&
        segment.effective_on <= endDate
      ) {
        points.push({
          date: segment.effective_on,
          setting_key: settingKey,
          from: previous,
          to: next,
        });
      }
      previous = next;
    }
  }

  return points.sort((left, right) =>
    left.date === right.date
      ? left.setting_key.localeCompare(right.setting_key)
      : left.date.localeCompare(right.date),
  );
}

/** 최근 여러 달의 주력상품 일별 데이터로 광고 성과 요약을 반환한다. */
export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (response) {
      return response as NextResponse;
    }

    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (response) {
      return response as NextResponse;
    }

    const { searchParams } = new URL(request.url);
    const focusProductId = searchParams.get("focusProductId")?.trim() || "";
    const months = parseMonths(searchParams.get("months"));
    if (!UUID_PATTERN.test(focusProductId) || months == null) {
      return NextResponse.json(
        { error: "focusProductId와 months(1~24)를 올바르게 입력해 주세요." },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const { data: focusProduct, error: focusError } = await supabase
      .from("focus_products")
      .select("coupang_exposure_id, campaign_id")
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

    const exposureId = focusProduct.coupang_exposure_id as string;
    const campaignId = focusProduct.campaign_id as string;
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
    const endDate = kstDateStr(-1);
    const startDate = analysisStartDate(endDate, months);
    const dates = buildDateSpine(startDate, endDate);

    const { data: siblingProducts, error: productsError } = await supabase
      .from("products")
      .select("id")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("coupang_exposure_id", exposureId);
    if (productsError)
      throw new Error(`노출 상품 조회 실패: ${productsError.message}`);

    const productIds: string[] = (siblingProducts || []).map(
      (product: { id: string }) => product.id,
    );
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

    const [
      salesResult,
      adDailyResult,
      excelAdResult,
      excelCoverageResult,
      settingsResult,
      notesResult,
    ] = await Promise.all([
      salesPromise,
      adDailyPromise,
      excelAdPromise,
      excelCoveragePromise,
      settingsPromise,
      notesPromise,
    ]);

    if (salesResult.error)
      throw new Error(`판매 조회 실패: ${salesResult.error.message}`);
    if (adDailyResult.error)
      throw new Error(`광고 일별 조회 실패: ${adDailyResult.error.message}`);
    if (excelAdResult.error)
      throw new Error(`광고 정산 조회 실패: ${excelAdResult.error.message}`);
    if (excelCoverageResult.error)
      throw new Error(
        `광고 정산 커버리지 조회 실패: ${excelCoverageResult.error.message}`,
      );
    if (settingsResult.error)
      throw new Error(
        `광고 설정 이력 조회 실패: ${settingsResult.error.message}`,
      );
    if (notesResult.error)
      throw new Error(`일별 비고 조회 실패: ${notesResult.error.message}`);

    const salesByDate = new Map<string, DailySalesInput>();
    for (const record of salesResult.data || []) {
      const current = salesByDate.get(record.order_date) || {
        date: record.order_date,
        sales_qty: 0,
        revenue: 0,
        margin: 0,
      };
      current.sales_qty += numeric(record.order_quantity);
      current.revenue += numeric(record.total_amount);
      current.margin += numeric(record.margin);
      salesByDate.set(record.order_date, current);
    }

    const adByDate = new Map<string, DailyAdInput>();
    for (const record of adDailyResult.data || []) {
      const current = adByDate.get(record.metric_date) || {
        date: record.metric_date,
        ad_units: null,
        delivered_ad_cost: null,
      };
      current.ad_units = addNullable(
        current.ad_units,
        record.ad_attributed_units,
      );
      current.delivered_ad_cost = addNullable(
        current.delivered_ad_cost,
        record.delivered_ad_cost,
      );
      adByDate.set(record.metric_date, current);
    }

    const excelAdByDate = new Map<string, DailyExcelAdInput>();
    for (const record of excelAdResult.data || []) {
      const current = excelAdByDate.get(record.ad_date) || {
        date: record.ad_date,
        billable_sum: 0,
      };
      current.billable_sum += numeric(record.billable_amount);
      excelAdByDate.set(record.ad_date, current);
    }

    const settings: SettingEventInput[] = (settingsResult.data || [])
      .filter(
        (record) =>
          record.setting_key === "daily_budget" ||
          record.setting_key === "target_roas",
      )
      .map((record) => ({
        setting_key: record.setting_key as SettingEventInput["setting_key"],
        setting_value: numeric(record.setting_value),
        effective_on: record.effective_on,
        effective_at: record.effective_at,
      }));
    const notes: DailyNoteInput[] = (notesResult.data || []).map(
      (record: { metric_date: string; note: string }) => ({
        date: record.metric_date,
        note: record.note,
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
            (record: { ad_date: string }) => record.ad_date,
          ),
        ),
      ],
      settings,
      notes,
    });
    const changePoints = deriveChangePoints(settings, startDate, endDate);

    return NextResponse.json({ data: buildAdAnalysis(rows, changePoints) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
