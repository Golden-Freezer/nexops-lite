"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { AdAnalysisSummary, ChangeImpactMetrics } from "@/types/focus";

interface FocusAdAnalysisProps {
  focusProductId: string;
  months?: number;
}

const formatWon = (value: number) =>
  `${Math.round(value).toLocaleString("ko-KR")}원`;
const formatNumber = (value: number | null) =>
  value == null
    ? "—"
    : value.toLocaleString("ko-KR", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      });
const formatPercent = (value: number | null) =>
  value == null ? "—" : `${formatNumber(value)}%`;
const formatSetting = (
  value: number | null,
  settingKey: "daily_budget" | "target_roas",
) =>
  value == null
    ? "—"
    : settingKey === "daily_budget"
      ? formatWon(value)
      : formatPercent(value);

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function Trend({ delta }: { delta: number | null }) {
  if (delta == null)
    return <span className="text-xs text-slate-400">비교 데이터 부족</span>;
  const positive = delta > 0;
  const negative = delta < 0;
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${positive ? "text-blue-600" : negative ? "text-red-600" : "text-slate-500"}`}
    >
      <Icon className="h-4 w-4" /> {delta > 0 ? "+" : ""}
      {formatPercent(delta)}p
    </span>
  );
}

function MetricSet({
  label,
  metrics,
}: {
  label: string;
  metrics: ChangeImpactMetrics;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-600">
        {label} {metrics.days}일
      </p>
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-slate-400">평균 ROAS</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-700">
            {formatPercent(metrics.avg_roas_pct)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">일평균 광고전환</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-700">
            {formatNumber(metrics.avg_ad_units)}건
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">순익 합계</dt>
          <dd
            className={`mt-0.5 font-semibold tabular-nums ${metrics.total_net_profit < 0 ? "text-red-600" : metrics.total_net_profit > 0 ? "text-blue-600" : "text-slate-700"}`}
          >
            {formatWon(metrics.total_net_profit)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function FocusAdAnalysis({
  focusProductId,
  months = 3,
}: FocusAdAnalysisProps) {
  const [summary, setSummary] = useState<AdAnalysisSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      focusProductId,
      months: String(months),
    });
    setLoading(true);
    setError(null);
    setSummary(null);

    apiFetch(`/api/focus/analysis?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await parseJson(response);
        if (!response.ok)
          throw new Error(
            String(json.error || "광고 성과 분석 조회에 실패했습니다."),
          );
        if (!controller.signal.aborted)
          setSummary(json.data as AdAnalysisSummary);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "광고 성과 분석 조회에 실패했습니다.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [focusProductId, months, reloadKey]);

  return (
    <details open className="rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700">
        <BarChart3 className="h-4 w-4 text-emerald-500" />
        광고 성과 분석
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
          최근 {months}개월
        </span>
      </summary>

      <div className="border-t border-slate-100 p-4">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
          </div>
        ) : error ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-sm text-red-600">
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </span>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="inline-flex items-center gap-1 font-medium hover:text-red-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
            </button>
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
              <span>
                {summary.period.start || "—"} ~ {summary.period.end || "—"}
              </span>
              <span>광고비 확인 {summary.coverage.days_with_ad_cost}일</span>
              {summary.notes.map((note) => (
                <span
                  key={note}
                  className={`rounded-full px-2 py-1 font-medium ${note.startsWith("잠정") ? "bg-amber-100 text-amber-700" : note.startsWith("결측") ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-600"}`}
                >
                  {note}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <article className="rounded-lg border border-slate-100 p-3">
                <p className="text-xs font-medium text-slate-500">ROAS 추세</p>
                <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-slate-400">최근 7일</p>
                    <p className="text-xl font-semibold tabular-nums text-slate-800">
                      {formatPercent(summary.roas_trend.recent7_avg_roas_pct)}
                    </p>
                  </div>
                  <Trend delta={summary.roas_trend.delta_pct} />
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  이전 7일{" "}
                  {formatPercent(summary.roas_trend.prior7_avg_roas_pct)}
                </p>
              </article>

              <article className="rounded-lg border border-slate-100 p-3">
                <p className="text-xs font-medium text-slate-500">
                  판매 기여 비중
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-400">자연 판매</p>
                    <p className="text-lg font-semibold text-emerald-600">
                      {formatPercent(
                        summary.organic.avg_organic_rate == null
                          ? null
                          : summary.organic.avg_organic_rate * 100,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">광고 판매</p>
                    <p className="text-lg font-semibold text-slate-700">
                      {formatPercent(
                        summary.organic.avg_ad_share == null
                          ? null
                          : summary.organic.avg_ad_share * 100,
                      )}
                    </p>
                  </div>
                </div>
              </article>

              <article className="col-span-2 rounded-lg border border-slate-100 p-3 md:col-span-1">
                <p className="text-xs font-medium text-slate-500">기간 합계</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div>
                    <dt className="text-slate-400">매출</dt>
                    <dd className="mt-1 font-semibold text-slate-700">
                      {formatWon(summary.totals.revenue)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">광고비</dt>
                    <dd className="mt-1 font-semibold text-slate-700">
                      {formatWon(summary.totals.ad_cost)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">순익</dt>
                    <dd
                      className={`mt-1 font-semibold ${summary.totals.net_profit < 0 ? "text-red-600" : summary.totals.net_profit > 0 ? "text-blue-600" : "text-slate-700"}`}
                    >
                      {formatWon(summary.totals.net_profit)}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-600">
                설정 변경 임팩트
              </h3>
              {summary.change_impacts.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                  비교 가능한 예산·목표 ROAS 변경 데이터가 없습니다.
                </p>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {summary.change_impacts.map((impact, index) => (
                    <article
                      key={`${impact.change.setting_key}-${impact.change.date}-${index}`}
                      className="rounded-lg border border-slate-100 p-3"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-700">
                          {impact.change.setting_key === "daily_budget"
                            ? "일예산 변경"
                            : "목표 ROAS 변경"}
                        </span>
                        <span className="text-slate-400">
                          {impact.change.date}
                        </span>
                        <span className="ml-auto tabular-nums text-slate-500">
                          {formatSetting(
                            impact.change.from,
                            impact.change.setting_key,
                          )}{" "}
                          →{" "}
                          {formatSetting(
                            impact.change.to,
                            impact.change.setting_key,
                          )}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <MetricSet label="변경 전" metrics={impact.before} />
                        <MetricSet label="변경 후" metrics={impact.after} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </details>
  );
}
