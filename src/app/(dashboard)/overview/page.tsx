"use client";

import { useState, useEffect } from "react";
import { useCallback } from "react";
import { Building2, Loader2, ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { PeriodSelector } from "@/components/features/settlement/PeriodSelector";
import { getDefaultPeriod } from "@/hooks/useReport";
import { useOverview } from "@/hooks/useOverview";
import { KpiStatCard } from "@/components/charts/KpiStatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { fmtShort, fmtPct } from "@/lib/analytics/format";
import type { PeriodFilter } from "@/types/settlement";
import type { BusinessOverview } from "@/lib/analytics/types";

/** 전체 사업장 현황 — 조회 전용. 상세 진입은 기존 스위처 방식(localStorage + 전체 이동) */
export default function OverviewPage() {
  // 정적 프리렌더 시각과 브라우저 하이드레이션 시각이 다르면
  // 날짜 텍스트가 달라져 React #418이 발생한다. 클라이언트 마운트 후 기간을 확정한다.
  const [period, setPeriod] = useState<PeriodFilter | null>(null);
  const { data, loading, error, fetchOverview } = useOverview();

  const handlePeriodChange = useCallback((filter: PeriodFilter) => {
    setPeriod(filter);
  }, []);

  useEffect(() => {
    setPeriod(getDefaultPeriod());
  }, []);

  useEffect(() => {
    if (!period) return;
    fetchOverview(period.periodStart, period.periodEnd);
  }, [period, fetchOverview]);

  // 기존 스위처와 동일 키 사용 — 전체 새로고침 진입 (기존 패턴 유지)
  const handleEnter = (id: string) => {
    localStorage.setItem("nexops_current_business_id", id);
    window.location.href = "/";
  };

  if (!period || (loading && !data)) {
    return (
      <>
        <Header title="전체 사업장 현황" />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="전체 사업장 현황" />
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 space-y-4">
        {/* 기간 안내 — 타이틀은 Header로 이동 */}
        <p className="text-xs text-slate-400">
          {period.periodStart} ~ {period.periodEnd} · 조회 전용
        </p>

        {/* 기간 필터 */}
        <PeriodSelector value={period} onChange={handlePeriodChange} />

        {error && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
            <p className="text-xs text-slate-400 text-center py-6">{error}</p>
          </div>
        )}

        {data && data.businesses.length === 0 && !error && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center">
            <p className="text-sm text-slate-500 mb-2">
              등록된 사업자가 없습니다.
            </p>
            <a
              href="/settings"
              className="text-xs text-brand-600 hover:underline"
            >
              설정에서 사업자를 등록하세요 →
            </a>
          </div>
        )}

        {data && data.businesses.length > 0 && (
          <>
            {/* 합산 KPI 5장 */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiStatCard
                label="총매출"
                value={fmtShort(data.combined.revenue)}
                unit="원"
                note="(VAT포함)"
              />
              <KpiStatCard
                label="총마진"
                value={fmtShort(data.combined.margin)}
                unit="원"
                tone={data.combined.margin >= 0 ? "profit" : "loss"}
                deltaLabel={`마진율 ${fmtPct(data.combined.marginRate)}`}
              />
              <KpiStatCard
                label="총광고비"
                value={fmtShort(data.combined.adSpend)}
                unit="원"
                note="(VAT포함)"
              />
              <KpiStatCard
                label="총지출"
                value={fmtShort(data.combined.expenses)}
                unit="원"
              />
              <KpiStatCard
                label="총순이익"
                value={fmtShort(data.combined.netProfit)}
                unit="원"
                tone={data.combined.netProfit >= 0 ? "profit" : "loss"}
              />
            </div>

            {/* 사업장 비교 카드 */}
            <div className="grid lg:grid-cols-2 gap-3">
              {data.businesses.map((b) => (
                <BusinessCard
                  key={b.businessId}
                  biz={b}
                  onEnter={handleEnter}
                />
              ))}
            </div>

            {/* 사업장별 매출 비교 차트 — 사업장 1개면 생략 */}
            {data.businesses.length > 1 && (
              <ChartCard
                title="사업장별 매출 비교"
                subtitle={`${period.periodStart} ~ ${period.periodEnd}`}
              >
                <TrendChart
                  data={data.businesses.map((b) => ({
                    name: b.businessName,
                    revenue: b.revenue,
                    netProfit: b.netProfit,
                  }))}
                  xKey="name"
                  series={[
                    {
                      key: "revenue",
                      name: "매출",
                      type: "bar",
                      color: "var(--chart-muted)",
                    },
                    {
                      key: "netProfit",
                      name: "순이익",
                      type: "bar",
                      color: "var(--chart-profit)",
                    },
                  ]}
                  colorByValue={{
                    key: "netProfit",
                    positive: "var(--chart-profit)",
                    negative: "var(--chart-loss)",
                  }}
                  xTickFormatter={(v) => v}
                />
              </ChartCard>
            )}

            <p className="text-[10px] text-slate-400">
              이 페이지는 조회 전용입니다. 데이터 수정은 각 사업장 진입 후
              가능합니다.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** 사업장 비교 카드 — 카드 전체 클릭 시 해당 사업장으로 진입 */
function BusinessCard({
  biz,
  onEnter,
}: {
  biz: BusinessOverview;
  onEnter: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onEnter(biz.businessId)}
      className="text-left bg-white rounded-xl border border-slate-200 shadow-card p-5 hover:border-brand-300 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 min-w-0 truncate">
          <Building2 className="w-4 h-4 text-slate-400 shrink-0" /> <span className="truncate">{biz.businessName}</span>
        </span>
        <span className="flex items-center gap-0.5 text-xs text-slate-400 shrink-0">
          상세 <ArrowRight className="w-3 h-3" />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric label="매출" value={`${fmtShort(biz.revenue)}원`} />
        <Metric
          label="순이익"
          value={`${fmtShort(biz.netProfit)}원`}
          valueClass={biz.netProfit >= 0 ? "text-blue-600" : "text-red-600"}
        />
        <Metric label="마진율" value={fmtPct(biz.marginRate)} />
        <Metric label="광고비" value={`${fmtShort(biz.adSpend)}원`} />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            biz.stockAlertCount > 0
              ? "bg-amber-50 text-amber-600"
              : "bg-slate-100 text-slate-400"
          }`}
        >
          재고 소진 {biz.stockAlertCount}
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
          매입 진행 {biz.pendingPurchaseCount}
        </span>
      </div>
    </button>
  );
}

function Metric({
  label,
  value,
  valueClass = "text-slate-800",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-sm font-bold font-mono ${valueClass}`}>{value}</p>
    </div>
  );
}
