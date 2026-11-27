export type FocusProductStatus = "active" | "paused_seasonal" | "discontinued";

export interface FocusProduct {
  id: string;
  coupang_exposure_id: string;
  campaign_id: string;
  product_id: string | null;
  label: string | null;
  is_active: boolean;
  status?: FocusProductStatus;
  product_name: string | null;
  valid_from?: string;
  valid_to?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CampaignSuggestion {
  product_id: string;
  product_name: string;
  coupang_exposure_id: string | null;
  product_grade: string | null;
  score: number;
}

export interface ProductPickOption {
  coupang_exposure_id: string;
  product_name: string;
  product_grade: string | null;
  product_id: string;
}

export interface CampaignCatalogCandidate {
  campaign_id: string;
  name: string | null;
  budget: number | null;
  roas_target: number | null;
  created_at_source: string | null;
  suggestions: CampaignSuggestion[];
}

export interface RankTarget {
  id: string;
  vendor_item_id: string;
  option_label: string | null;
  keyword: string;
  is_active?: boolean;
  valid_from?: string;
  valid_to?: string | null;
}

export type RankSource = "keyword_ranking" | "manual";

export interface RankDaily {
  target_id: string;
  metric_date: string;
  rank: number | null;
  page: number | null;
  position_in_page: number | null;
  found: boolean | null;
  source: RankSource;
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

export interface FocusDailyTotals {
  sales_qty: number;
  revenue: number;
  margin: number;
  ad_cost: number;
  net_profit: number;
  ad_units: number;
  provisionalDays: number;
}

export interface DailyResponse {
  rows: DailyOpsRow[];
  month: { year: number; month: number };
  focus: {
    exposureId: string;
    campaignId: string;
    productName: string | null;
    label: string | null;
  };
  totals: FocusDailyTotals;
  freshness: { adDailyLastObservedAt: string | null };
}

export type {
  AdAnalysisSummary,
  ChangeImpact,
  ChangeImpactMetrics,
  SettingChangePoint,
} from "@/lib/focus/ad-analysis";
