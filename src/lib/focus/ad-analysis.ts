import type { DailyOpsRow } from "./daily-aggregator";

export interface SettingChangePoint {
  date: string;
  setting_key: "daily_budget" | "target_roas";
  from: number | null;
  to: number | null;
}

export interface ChangeImpactMetrics {
  days: number;
  avg_roas_pct: number | null;
  avg_ad_units: number | null;
  avg_organic_rate: number | null;
  total_ad_cost: number;
  total_revenue: number;
  total_net_profit: number;
}

export interface ChangeImpact {
  change: SettingChangePoint;
  before: ChangeImpactMetrics;
  after: ChangeImpactMetrics;
}

export interface AdAnalysisSummary {
  period: { start: string; end: string };
  coverage: {
    days_with_ad_cost: number;
    provisional_days: number;
    missing_days: number;
  };
  roas_trend: {
    recent7_avg_roas_pct: number | null;
    prior7_avg_roas_pct: number | null;
    delta_pct: number | null;
  };
  organic: {
    avg_organic_rate: number | null;
    avg_ad_share: number | null;
  };
  totals: {
    revenue: number;
    ad_cost: number;
    margin: number;
    net_profit: number;
    ad_units: number;
  };
  change_impacts: ChangeImpact[];
  notes: string[];
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function summarizeImpactRows(rows: DailyOpsRow[]): ChangeImpactMetrics {
  return {
    days: rows.length,
    avg_roas_pct: average(rows.map((row) => row.roas_pct)),
    avg_ad_units: average(rows.map((row) => row.ad_units)),
    avg_organic_rate: average(rows.map((row) => row.organic_rate)),
    total_ad_cost: rows.reduce((sum, row) => sum + (row.ad_cost ?? 0), 0),
    total_revenue: rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0),
    total_net_profit: rows.reduce((sum, row) => sum + (row.net_profit ?? 0), 0),
  };
}

function isImpactDay(row: DailyOpsRow): boolean {
  return row.ad_cost != null && row.roas_pct != null;
}

/** 일별 주력상품 운영 데이터를 광고 의사결정용 요약으로 변환한다. */
export function buildAdAnalysis(
  rows: DailyOpsRow[],
  changePoints: SettingChangePoint[],
): AdAnalysisSummary {
  const sortedRows = [...rows].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const recentRows = sortedRows.slice(-7);
  const priorRows = sortedRows.slice(-14, -7);
  const recentRoas = average(recentRows.map((row) => row.roas_pct));
  const priorRoas = average(priorRows.map((row) => row.roas_pct));
  const avgOrganicRate = average(sortedRows.map((row) => row.organic_rate));
  const provisionalDays = sortedRows.filter(
    (row) => row.ad_cost_basis === "provisional_tablemetric",
  ).length;
  const missingDays = sortedRows.filter(
    (row) => row.ad_cost == null || row.ad_cost_basis === "missing",
  ).length;

  const changeImpacts = changePoints.flatMap<ChangeImpact>((change) => {
    const beforeRows = sortedRows
      .filter((row) => row.date < change.date && isImpactDay(row))
      .slice(-7);
    const afterRows = sortedRows
      .filter((row) => row.date > change.date && isImpactDay(row))
      .slice(0, 7);

    if (beforeRows.length === 0 && afterRows.length === 0) return [];
    return [
      {
        change,
        before: summarizeImpactRows(beforeRows),
        after: summarizeImpactRows(afterRows),
      },
    ];
  });

  const notes: string[] = [];
  if (provisionalDays > 0) notes.push(`잠정 ${provisionalDays}일 포함`);
  if (missingDays > 0) notes.push(`결측 ${missingDays}일`);
  if (
    sortedRows.some((row) => row.organic_rate != null && row.organic_rate < 0)
  ) {
    notes.push("자연판매율 음수 포함: 광고 비중이 100%를 초과할 수 있습니다.");
  }

  return {
    period: {
      start: sortedRows[0]?.date ?? "",
      end: sortedRows.at(-1)?.date ?? "",
    },
    coverage: {
      days_with_ad_cost: sortedRows.filter((row) => row.ad_cost != null).length,
      provisional_days: provisionalDays,
      missing_days: missingDays,
    },
    roas_trend: {
      recent7_avg_roas_pct: recentRoas,
      prior7_avg_roas_pct: priorRoas,
      delta_pct:
        recentRoas == null || priorRoas == null ? null : recentRoas - priorRoas,
    },
    organic: {
      avg_organic_rate: avgOrganicRate,
      avg_ad_share: avgOrganicRate == null ? null : 1 - avgOrganicRate,
    },
    totals: {
      revenue: sortedRows.reduce((sum, row) => sum + (row.revenue ?? 0), 0),
      ad_cost: sortedRows.reduce((sum, row) => sum + (row.ad_cost ?? 0), 0),
      margin: sortedRows.reduce((sum, row) => sum + (row.margin ?? 0), 0),
      net_profit: sortedRows.reduce(
        (sum, row) => sum + (row.net_profit ?? 0),
        0,
      ),
      ad_units: sortedRows.reduce((sum, row) => sum + (row.ad_units ?? 0), 0),
    },
    change_impacts: changeImpacts,
    notes,
  };
}
