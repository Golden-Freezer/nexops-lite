export interface DailySalesInput {
  date: string;
  sales_qty: number;
  revenue: number;
  margin: number;
}

export interface DailyAdInput {
  date: string;
  ad_units: number | null;
  delivered_ad_cost: number | null;
}

export interface DailyExcelAdInput {
  date: string;
  billable_sum: number;
}

export interface SettingEventInput {
  setting_key: "daily_budget" | "target_roas";
  setting_value: number;
  effective_on: string;
  effective_at?: string | null;
}

export interface DailyNoteInput {
  date: string;
  note: string;
}

export type AdCostBasis =
  | "settled_excel"
  | "provisional_tablemetric"
  | "missing";

export interface DailyOpsRow {
  date: string;
  sales_qty: number | null;
  revenue: number | null;
  margin: number | null;
  ad_cost: number | null;
  ad_cost_basis: AdCostBasis;
  ad_cost_delta: number | null;
  ad_units: number | null;
  organic_qty: number | null;
  roas_pct: number | null;
  net_profit: number | null;
  organic_rate: number | null;
  budget: number | null;
  target_roas: number | null;
  setting_changed_on_date: boolean;
  note: string | null;
}

export interface BuildDailyOpsParams {
  dates: string[];
  sales: DailySalesInput[];
  ad: DailyAdInput[];
  excelAd: DailyExcelAdInput[];
  excelCoveredDates: string[];
  settings: SettingEventInput[];
  notes: DailyNoteInput[];
}

function indexByDate<T extends { date: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.date, row]));
}

/** VAT 제외 광고비에 10%를 더한 뒤 원 단위로 반올림한다. */
function toVatIncludedCost(cost: number): number {
  return Math.round(cost * 1.1);
}

function settingAsOf(
  settings: SettingEventInput[],
  key: SettingEventInput["setting_key"],
  date: string,
): number | null {
  let latest: SettingEventInput | null = null;

  for (const setting of settings) {
    if (setting.setting_key !== key || setting.effective_on > date) continue;
    if (
      latest == null ||
      setting.effective_on > latest.effective_on ||
      (setting.effective_on === latest.effective_on &&
        (setting.effective_at ?? "") > (latest.effective_at ?? ""))
    )
      latest = setting;
  }

  return latest?.setting_value ?? null;
}

/** 날짜별 선집계 원천을 엑셀의 상품별 일일 운영행 공식으로 결합한다. */
export function buildDailyOps(params: BuildDailyOpsParams): DailyOpsRow[] {
  const salesByDate = indexByDate(params.sales);
  const adByDate = indexByDate(params.ad);
  const excelAdByDate = indexByDate(params.excelAd);
  const notesByDate = indexByDate(params.notes);
  const excelCoveredDates = new Set(params.excelCoveredDates);

  return params.dates.map((date) => {
    const sales = salesByDate.get(date);
    const ad = adByDate.get(date);
    const excelAd = excelAdByDate.get(date);
    const isExcelCovered = excelCoveredDates.has(date);

    // 커버된 날짜에는 캠페인 행이 없어도 정산 광고비 0으로 확정한다.
    const excelCost =
      excelAd != null
        ? toVatIncludedCost(excelAd.billable_sum)
        : isExcelCovered
          ? 0
          : null;
    const provisionalCost =
      ad?.delivered_ad_cost != null
        ? toVatIncludedCost(ad.delivered_ad_cost)
        : null;

    let adCost: number | null;
    let adCostBasis: AdCostBasis;
    if (isExcelCovered) {
      adCost = excelCost;
      adCostBasis = "settled_excel";
    } else if (provisionalCost != null) {
      adCost = provisionalCost;
      adCostBasis = "provisional_tablemetric";
    } else {
      adCost = null;
      adCostBasis = "missing";
    }

    const salesQty = sales?.sales_qty ?? 0;
    const revenue = sales?.revenue ?? 0;
    const margin = sales?.margin ?? 0;
    const adUnits = ad?.ad_units ?? null;
    const organicQty = adUnits == null ? null : salesQty - adUnits;

    return {
      date,
      sales_qty: salesQty,
      revenue,
      margin,
      ad_cost: adCost,
      ad_cost_basis: adCostBasis,
      ad_cost_delta:
        excelCost != null && provisionalCost != null
          ? excelCost - provisionalCost
          : null,
      ad_units: adUnits,
      organic_qty: organicQty,
      roas_pct:
        adCost == null || adCost === 0 ? null : (revenue / adCost) * 100,
      net_profit: adCost == null ? null : margin - adCost,
      organic_rate:
        organicQty == null || salesQty === 0 ? null : organicQty / salesQty,
      budget: settingAsOf(params.settings, "daily_budget", date),
      target_roas: settingAsOf(params.settings, "target_roas", date),
      setting_changed_on_date: params.settings.some(
        (setting) => setting.effective_on === date,
      ),
      note: notesByDate.get(date)?.note ?? null,
    };
  });
}
