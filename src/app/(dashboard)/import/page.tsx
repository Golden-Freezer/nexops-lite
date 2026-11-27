"use client";

import { kstTodayStr } from "@/lib/analytics/date-buckets";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  XCircle,
  Package,
  Warehouse,
  Megaphone,
  BarChart3,
  Info,
  ChevronLeft,
  ChevronRight,
  Calendar,
  RefreshCw,
} from "lucide-react";
import type { ImportType } from "@/types/import";
import { useImport } from "@/hooks/useImport";
import {
  extractDateFromFilename,
  validateStatisticsDateRange,
} from "@/lib/import/parser";
import { apiFetch } from "@/lib/api-client";
import {
  runImportForDisplay,
  type ImportDisplayResult,
} from "@/lib/import/display-result";
import { detectImportType } from "@/lib/import/detect-type";
import {
  partialSafeSalesGapByDate,
  type SafeSalesGapHistoryItem,
} from "@/lib/import/safe-gap-ui";

interface DetectedFile {
  file: File;
  detectedType: ImportType | null;
  selectedType: ImportType | null;
  date: string | null;
  error: string | null; // 차단 사유
}

const TYPE_CONFIG: Record<
  ImportType,
  {
    label: string;
    desc: string;
    icon: React.ElementType;
    color: string;
    bg: string;
    dot: string;
  }
> = {
  sales: {
    label: "판매 통계",
    desc: "Statistics 파일",
    icon: BarChart3,
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
    dot: "bg-blue-500",
  },
  inventory_health: {
    label: "재고 건강",
    desc: "inventory_health_sku_info",
    icon: Warehouse,
    color: "text-green-700",
    bg: "bg-green-50 border-green-200",
    dot: "bg-green-500",
  },
  ad_billing: {
    label: "광고 정산",
    desc: "dailySettlement",
    icon: Megaphone,
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
    dot: "bg-purple-500",
  },
  ad_report: {
    label: "광고 보고서",
    desc: "매출 성장 광고 보고서",
    icon: BarChart3,
    color: "text-fuchsia-700",
    bg: "bg-fuchsia-50 border-fuchsia-200",
    dot: "bg-fuchsia-500",
  },
  ledger: {
    label: "판매장부",
    desc: "그로스판매장부 (전체)",
    icon: FileSpreadsheet,
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    dot: "bg-amber-500",
  },
  product: {
    label: "상품 마스터",
    desc: "01.상품 시트",
    icon: Package,
    color: "text-slate-700",
    bg: "bg-slate-50 border-slate-200",
    dot: "bg-slate-500",
  },
  purchase: {
    label: "매입 내역",
    desc: "DB_구매 시트",
    icon: Package,
    color: "text-slate-700",
    bg: "bg-slate-50 border-slate-200",
    dot: "bg-slate-500",
  },
};

const MANUAL_TYPES: ImportType[] = [
  "sales",
  "inventory_health",
  "ad_billing",
  "ad_report",
  "ledger",
  "product",
  "purchase",
];

// ── Import 캘린더 ──
function ImportCalendar() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<
    Record<string, { sales: number; ads: number; health: number }>
  >({});
  const [dataMonth, setDataMonth] = useState<string | null>(null);
  const [safeGapHistory, setSafeGapHistory] = useState<
    SafeSalesGapHistoryItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const calendarRequestIdRef = useRef(0);

  const fetchCalendar = useCallback(async (m: string) => {
    const requestId = ++calendarRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [res, safeGapRes] = await Promise.all([
        apiFetch(`/api/import/calendar?month=${m}`),
        apiFetch(`/api/import/safe-sales-gap?month=${m}`),
      ]);
      const [json, safeGapJson] = await Promise.all([
        res.json(),
        safeGapRes.json(),
      ]);
      if (!res.ok) throw new Error(json.error || 'Import 캘린더 조회 실패');
      if (!safeGapRes.ok)
        throw new Error(safeGapJson.error || "부분 백필 이력 조회 실패");
      if (!Array.isArray(safeGapJson.data?.history)) {
        throw new Error("부분 백필 이력 응답 형식이 올바르지 않습니다.");
      }
      if (requestId === calendarRequestIdRef.current) {
        setData(json.data || {});
        setSafeGapHistory(safeGapJson.data.history);
        setDataMonth(m);
      }
    } catch (reason) {
      if (requestId === calendarRequestIdRef.current) {
        setError(
          reason instanceof Error ? reason.message : "Import 캘린더 조회 실패",
        );
      }
    } finally {
      if (requestId === calendarRequestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCalendar(month);
    return () => {
      calendarRequestIdRef.current += 1;
    };
  }, [month, fetchCalendar]);

  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  // 달력 그리드
  const calendarGrid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1).getDay(); // 0=일요일
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = kstTodayStr();

    const cells: { day: number | null; date: string; isToday: boolean }[] = [];
    for (let i = 0; i < firstDay; i++)
      cells.push({ day: null, date: "", isToday: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, date, isToday: date === today });
    }
    return cells;
  }, [month]);

  const [y, m] = month.split("-").map(Number);
  const monthLabel = `${y}년 ${m}월`;
  // 월 변경 직후 이전 월 데이터를 새 월의 데이터처럼 계산하지 않는다.
  const calendarData = dataMonth === month ? data : {};
  const partialGapByDate = useMemo(
    () => partialSafeSalesGapByDate(dataMonth === month ? safeGapHistory : []),
    [dataMonth, month, safeGapHistory],
  );
  const partialGapDates = [...partialGapByDate.keys()].sort();

  // 통계 요약
  const salesDays = Object.values(calendarData).filter(
    (d) => d.sales > 0,
  ).length;
  const adsDays = Object.values(calendarData).filter((d) => d.ads > 0).length;
  const healthDays = Object.values(calendarData).filter(
    (d) => d.health > 0,
  ).length;
  const totalDays = new Date(y, m, 0).getDate();

  // 빈 날짜 감지 (오늘 이전 기준)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const missingSalesDates: string[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dateObj = new Date(date);
    if (dateObj >= today) break;
    if (!calendarData[date]?.sales) missingSalesDates.push(date);
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">
            Import 캘린더
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => changeMonth(-1)}
            className="p-1 hover:bg-slate-100 rounded"
          >
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          </button>
          <span className="text-sm font-medium text-slate-700 w-24 text-center">
            {monthLabel}
          </span>
          <button
            onClick={() => changeMonth(1)}
            className="p-1 hover:bg-slate-100 rounded"
          >
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* 범례 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500" /> 판매 (
          {salesDays}/{totalDays}일)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-purple-500" /> 광고 (
          {adsDays}일)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500" /> 재고 (
          {healthDays}일)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500" /> 판매만 부분
          적용 ({partialGapDates.length}일)
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-center"
        >
          <p className="text-xs font-medium text-red-700">
            Import 캘린더를 불러오지 못했습니다.
          </p>
          <p className="mt-1 text-[10px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void fetchCalendar(month)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
          </button>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 text-center mb-1">
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
              <div
                key={d}
                className={`text-[10px] font-medium py-1 ${d === "일" ? "text-red-400" : d === "토" ? "text-blue-400" : "text-slate-400"}`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-[2px]">
            {calendarGrid.map((cell, i) => {
              if (!cell.day) return <div key={i} />;
              const d = calendarData[cell.date];
              const hasSales = d?.sales > 0;
              const hasAds = d?.ads > 0;
              const hasHealth = d?.health > 0;
              const hasAny = hasSales || hasAds || hasHealth;
              const isSunday = i % 7 === 0;
              const isSaturday = i % 7 === 6;
              const isPast = new Date(cell.date) < today;
              const isMissingSales = isPast && !hasSales;
              const partialGap = partialGapByDate.get(cell.date);

              return (
                <div
                  key={i}
                  className={`relative rounded-md p-1 min-h-[40px] text-center transition-colors ${
                    partialGap
                      ? "bg-amber-50 ring-1 ring-amber-300"
                      : cell.isToday
                        ? "bg-brand-50 ring-1 ring-brand-300"
                        : isMissingSales && hasAny
                          ? "bg-slate-50"
                          : isMissingSales
                            ? "bg-red-50/40"
                            : hasAny
                              ? "bg-slate-50"
                              : ""
                  }`}
                  title={
                    partialGap
                      ? `판매 전용 부분 백필 ${partialGap.insertedCount}건 · 재고/정산 미적용`
                      : hasAny
                        ? `판매:${d?.sales || 0} 광고:${d?.ads || 0} 재고:${d?.health || 0}`
                        : isPast
                          ? "데이터 없음"
                          : ""
                  }
                >
                  <span
                    className={`text-[11px] font-medium ${
                      cell.isToday
                        ? "text-brand-700"
                        : isSunday
                          ? "text-red-400"
                          : isSaturday
                            ? "text-blue-400"
                            : "text-slate-600"
                    }`}
                  >
                    {cell.day}
                  </span>
                  {/* 도트 표시 */}
                  {hasAny && (
                    <div className="flex justify-center gap-[2px] mt-0.5">
                      {hasSales && (
                        <span className="w-[5px] h-[5px] rounded-full bg-blue-500" />
                      )}
                      {hasAds && (
                        <span className="w-[5px] h-[5px] rounded-full bg-purple-500" />
                      )}
                      {hasHealth && (
                        <span className="w-[5px] h-[5px] rounded-full bg-green-500" />
                      )}
                      {partialGap && (
                        <span className="w-[5px] h-[5px] rounded-full bg-amber-500" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {partialGapDates.length > 0 && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
            >
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
                <AlertCircle className="h-3.5 w-3.5" /> 판매 전용 부분 백필{" "}
                {partialGapDates.length}일
              </p>
              <p className="mt-0.5 text-[10px] text-amber-700">
                판매 원장만 신규 삽입되었습니다. 재고·정산 파생 상태는 아직
                적용되지 않았습니다.
              </p>
              <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700">
                {partialGapDates.slice(0, 5).map((date) => {
                  const item = partialGapByDate.get(date)!;
                  return (
                    <li key={item.batchId}>
                      {date.slice(5)} · 판매 {item.insertedCount}건 · 재고/정산
                      미적용
                    </li>
                  );
                })}
                {partialGapDates.length > 5 && (
                  <li>외 {partialGapDates.length - 5}일</li>
                )}
              </ul>
            </div>
          )}

          {/* 빈 날짜 경고 */}
          {missingSalesDates.length > 0 && missingSalesDates.length <= 10 && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> 판매 데이터 누락{" "}
                {missingSalesDates.length}일
              </p>
              <p className="text-[10px] text-red-500 mt-0.5">
                {missingSalesDates
                  .slice(0, 7)
                  .map((d) => d.slice(5))
                  .join(", ")}
                {missingSalesDates.length > 7 &&
                  ` 외 ${missingSalesDates.length - 7}일`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 메인 페이지 ──
export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ImportDisplayResult[]>([]);

  const { importFile, reset: resetImport } = useImport();

  const addFiles = useCallback((newFiles: File[]) => {
    const detected: DetectedFile[] = newFiles
      .filter((f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))
      .map((f) => {
        const detectedType = detectImportType(f.name);
        // Statistics 여러 날짜 파일 차단
        const multiDateRange = validateStatisticsDateRange(f.name);
        const error = multiDateRange
          ? `여러 날짜 취합 파일 (${multiDateRange}). 일별 파일로 업로드하세요.`
          : null;
        return {
          file: f,
          detectedType,
          selectedType: error ? null : detectedType,
          date: extractDateFromFilename(f.name),
          error,
        };
      });
    if (detected.length === 0) return;
    setFiles((prev) => [...prev, ...detected]);
    setResults([]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    if (fileRef.current) fileRef.current.value = "";
  };

  // 드래그 앤 드롭 (다중 파일 지원, dragCounter로 flickering 방지)
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const items = e.dataTransfer.items;
    const fileList: File[] = [];
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const f = items[i].getAsFile();
          if (f) fileList.push(f);
        }
      }
    } else if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        fileList.push(e.dataTransfer.files[i]);
      }
    }
    if (fileList.length > 0) addFiles(fileList);
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  const setFileType = (idx: number, type: ImportType) => {
    setFiles((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, selectedType: type } : f)),
    );
  };

  const hasErrors = files.some((f) => f.error);
  const canImport =
    files.length > 0 && files.every((f) => f.selectedType) && !hasErrors;
  const undetected = files.filter((f) => !f.detectedType && !f.error);
  const errorFiles = files.filter((f) => f.error);

  const grouped = files.reduce(
    (acc, f) => {
      const type = f.selectedType || "unknown";
      if (!acc[type]) acc[type] = [];
      acc[type].push(f);
      return acc;
    },
    {} as Record<string, DetectedFile[]>,
  );

  // 일괄 임포트
  const handleImportAll = async () => {
    if (!canImport) return;
    setProcessing(true);
    setResults([]);
    const importResults: typeof results = [];
    const typeOrder: ImportType[] = [
      "sales",
      "inventory_health",
      "ad_billing",
      "ad_report",
      "ledger",
      "product",
      "purchase",
    ];

    for (const type of typeOrder) {
      const group = grouped[type];
      if (!group || group.length === 0) continue;
      const sorted = [...group].sort((a, b) =>
        a.file.name.localeCompare(b.file.name),
      );
      for (const df of sorted) {
        resetImport();
        importResults.push(
          await runImportForDisplay(df.file.name, TYPE_CONFIG[type].label, () =>
            importFile(df.file, type),
          ),
        );
      }
    }
    setResults(importResults);
    setProcessing(false);
  };

  const handleReset = () => {
    setFiles([]);
    setResults([]);
    resetImport();
  };
  const totalSuccess = results.reduce((s, r) => s + r.success, 0);
  const totalError = results.reduce((s, r) => s + r.error, 0);

  return (
    <>
      <Header title="데이터 Import" />
      <div className="max-w-full px-4 lg:px-6 py-4 space-y-3">
        {/* 상단: Import 영역 + 캘린더 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 좌측: 파일 업로드 (2/3) */}
          <div className="lg:col-span-2 space-y-3">
            {/* 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700">
                <p className="font-medium">
                  쿠팡윙·NexOps 장부 파일을 드래그하여 한 번에 Import
                </p>
                <p className="text-blue-600 mt-0.5 flex flex-wrap gap-x-1.5">
                  <span className="font-mono">Statistics-*</span> (판매)
                  <span className="text-blue-300">|</span>
                  <span className="font-mono">inventory_health_*</span> (재고)
                  <span className="text-blue-300">|</span>
                  <span className="font-mono">dailySettlement-*</span> (광고)
                  <span className="text-blue-300">|</span>
                  <span className="font-mono">pa_total_campaign_*</span> (광고 보고서)
                  <span className="text-blue-300">|</span>
                  <span className="font-mono">DB_구매</span> (매입)
                </p>
              </div>
            </div>

            {/* 드롭 영역 */}
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => !processing && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                isDragging
                  ? "border-brand-400 bg-brand-50 scale-[1.01]"
                  : processing
                    ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                    : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/50"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              {isDragging ? (
                <>
                  <Upload className="w-12 h-12 mx-auto mb-2 text-brand-500 animate-bounce" />
                  <p className="text-sm font-medium text-brand-600">
                    여기에 놓으세요
                  </p>
                </>
              ) : files.length > 0 ? (
                <>
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <p className="text-sm text-slate-600">
                    {files.length}개 파일 선택됨 — 추가 파일을 드래그하거나 클릭
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-600">
                    파일을 드래그하거나 클릭하여 선택
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    xlsx 파일 여러 개를 한 번에 드래그할 수 있습니다
                  </p>
                </>
              )}
            </div>
          </div>

          {/* 우측: 캘린더 (1/3) */}
          <div>
            <ImportCalendar />
          </div>
        </div>

        {/* 감지된 파일 목록 */}
        {files.length > 0 && results.length === 0 && !processing && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-slate-700">
                {files.length}개 파일
              </span>
              {Object.entries(grouped).map(([type, group]) => {
                if (type === "unknown") return null;
                const cfg = TYPE_CONFIG[type as ImportType];
                if (!cfg) return null;
                return (
                  <span
                    key={type}
                    className={`text-[10px] px-2 py-1 rounded-full border ${cfg.bg}`}
                  >
                    {cfg.label} {group.length}개
                  </span>
                );
              })}
              {undetected.length > 0 && (
                <span className="text-[10px] px-2 py-1 rounded-full border bg-red-50 border-red-200 text-red-600">
                  미감지 {undetected.length}개
                </span>
              )}
              {errorFiles.length > 0 && (
                <span className="text-[10px] px-2 py-1 rounded-full border bg-red-50 border-red-200 text-red-700 font-medium">
                  차단 {errorFiles.length}개
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
              {files.map((df, idx) => {
                const cfg = df.selectedType
                  ? TYPE_CONFIG[df.selectedType]
                  : null;
                const Icon = cfg?.icon || FileSpreadsheet;
                return (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-[160px]">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${cfg?.color || "text-slate-400"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs truncate ${df.error ? "text-red-600 line-through" : "text-slate-700"}`}
                        >
                          {df.file.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {df.error ? (
                            <span className="text-[10px] text-red-600 font-medium">
                              {df.error}
                            </span>
                          ) : (
                            <>
                              {df.date && (
                                <span className="text-[10px] text-slate-400">
                                  {df.date}
                                </span>
                              )}
                              {df.detectedType && (
                                <span className="text-[10px] text-green-600">
                                  자동감지
                                </span>
                              )}
                              {!df.detectedType && (
                                <span className="text-[10px] text-red-500">
                                  수동 선택 필요
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={df.selectedType || ""}
                        onChange={(e) =>
                          setFileType(idx, e.target.value as ImportType)
                        }
                        disabled={!!df.error}
                        className={`h-7 px-2 border rounded text-xs ${df.selectedType ? "border-slate-200 text-slate-700" : "border-red-300 text-red-600 bg-red-50"}`}
                      >
                        <option value="">타입 선택</option>
                        {MANUAL_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_CONFIG[t].label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-slate-400 w-12 text-right">
                        {(df.file.size / 1024).toFixed(0)}KB
                      </span>
                      <button
                        onClick={() => removeFile(idx)}
                        className="p-1 hover:bg-slate-200 rounded"
                      >
                        <X className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={handleReset}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                전체 취소
              </button>
              <button
                onClick={handleImportAll}
                disabled={!canImport || processing}
                className="h-9 px-6 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" /> {files.length}개 파일 임포트
              </button>
            </div>
          </div>
        )}

        {/* 처리 중 */}
        {processing && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-3" />
            <p className="text-sm text-slate-600">
              파일을 처리하고 있습니다...
            </p>
            <p className="text-xs text-slate-400 mt-1">창을 닫지 마세요</p>
          </div>
        )}

        {/* 결과 */}
        {results.length > 0 && (
          <div className="space-y-3">
            <div
              className={`rounded-xl border p-4 ${totalError > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {totalError > 0 ? (
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
                <span className="text-sm font-semibold text-slate-800">
                  Import 완료 — {totalSuccess}건 성공
                  {totalError > 0 ? `, ${totalError}건 오류` : ""}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {results.length}개 파일 처리됨
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {results.map((r, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  {r.error > 0 ? (
                    <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-slate-700 truncate min-w-0">
                        {r.file}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {r.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {r.success}건 성공
                      {r.error > 0 ? ` / ${r.error}건 오류` : ""}
                    </p>
                    {r.errors.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {r.errors.map((e, j) => (
                          <li key={j} className="text-[10px] text-red-500">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.warnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {r.warnings.map((warning, j) => (
                          <li key={j} className="text-[10px] text-amber-600">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleReset}
              className="w-full py-2.5 rounded-lg text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              다시 임포트
            </button>
          </div>
        )}

        {/* 빈 상태 가이드 */}
        {files.length === 0 && results.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {MANUAL_TYPES.map((type) => {
              const cfg = TYPE_CONFIG[type];
              const Icon = cfg.icon;
              return (
                <div key={type} className={`rounded-xl border p-4 ${cfg.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    <span className={`text-sm font-semibold ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{cfg.desc}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {type === "sales" &&
                      "파일명: Statistics-날짜~날짜_(0).xlsx"}
                    {type === "inventory_health" &&
                      "파일명: inventory_health_sku_info_날짜.xlsx"}
                    {type === "ad_billing" &&
                      "파일명: A*-dailySettlement-날짜-날짜.xlsx"}
                    {type === "ad_report" &&
                      "파일명: A*_pa_total_campaign_날짜_날짜.xlsx"}
                    {type === "ledger" && "파일명: *그로스판매장부*.xlsx"}
                    {type === "product" && "파일명: 01_상품.xlsx"}
                    {type === "purchase" &&
                      "파일명: DB_구매.xlsx (예정일·실입고일 분리)"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
