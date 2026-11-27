"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Receipt,
  Loader2,
  X,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  LayoutDashboard,
  List,
  CreditCard,
  DollarSign,
  BarChart3,
  PieChart,
  TrendingUp,
  Paperclip,
  Store,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { ChartTooltipContent } from "@/components/ui/chart";
import { Header } from "@/components/layout/Header";
import { useExpenses } from "@/hooks/usePurchases";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHOD_LABELS,
} from "@/types/purchases";
import { EXPENSE_EXPORT_COLUMNS } from "@/lib/export/excel";
import { ExportButton } from "@/components/shared/ExportButton";
import { PeriodSelector } from "@/components/features/settlement/PeriodSelector";
import {
  ExpenseFormModal,
  type ExpenseRecord,
} from "@/components/features/expenses/ExpenseFormModal";
import { ExpenseVendorsTab } from "@/components/features/expenses/ExpenseVendorsTab";
import { getDefaultPeriod } from "@/hooks/useReport";
import type { PeriodFilter } from "@/types/settlement";

const CATEGORY_COLORS: Record<string, string> = {
  포장재: "bg-blue-100 text-blue-700",
  물류비: "bg-indigo-100 text-indigo-700",
  사무용품: "bg-slate-100 text-slate-700",
  외주용역비: "bg-purple-100 text-purple-700",
  통신비: "bg-cyan-100 text-cyan-700",
  임차료: "bg-amber-100 text-amber-700",
  샘플비: "bg-teal-100 text-teal-700",
  마케팅: "bg-rose-100 text-rose-700",
  기타: "bg-slate-100 text-slate-600",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EX = any;
type SortDir = "asc" | "desc" | null;

function sortItems(items: EX[], key: string, dir: SortDir): EX[] {
  if (!dir || !key) return items;
  return [...items].sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (va == null) va = dir === "asc" ? Infinity : -Infinity;
    if (vb == null) vb = dir === "asc" ? Infinity : -Infinity;
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    return va < vb
      ? dir === "asc"
        ? -1
        : 1
      : va > vb
        ? dir === "asc"
          ? 1
          : -1
        : 0;
  });
}

// ── 대시보드 탭 ──
function ExpenseDashboard({
  expenses,
  period,
}: {
  expenses: EX[];
  period: PeriodFilter;
}) {
  const fmt = (v: number) => v.toLocaleString("ko-KR");
  const fmtShort = (v: number) =>
    Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}만` : fmt(v);

  // 선택된 기간으로 필터링한 지출 (기간 관련 집계에 사용)
  const periodExpenses = expenses.filter((e: EX) => {
    const d = e.expense_date || "";
    return d >= period.periodStart && d <= period.periodEnd;
  });

  const totalAmount = periodExpenses.reduce(
    (s: number, e: EX) => s + (Number(e.amount) || 0),
    0,
  );
  const totalVat = periodExpenses.reduce(
    (s: number, e: EX) => s + (Number(e.vat_amount) || 0),
    0,
  );

  // 이번 달 지출
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthExpenses = expenses.filter((e: EX) =>
    (e.expense_date || "").startsWith(thisMonth),
  );
  const monthTotal = monthExpenses.reduce(
    (s: number, e: EX) => s + (Number(e.amount) || 0),
    0,
  );

  // 지난달 지출 (전월 대비)
  const lastMonth = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0")}`;
  const lastMonthTotal = expenses
    .filter((e: EX) => (e.expense_date || "").startsWith(lastMonth))
    .reduce((s: number, e: EX) => s + (Number(e.amount) || 0), 0);
  const monthChange =
    lastMonthTotal > 0
      ? ((monthTotal - lastMonthTotal) / lastMonthTotal) * 100
      : 0;

  // 결제수단별 (선택 기간 기준)
  const byMethod = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of periodExpenses) {
      const m = e.payment_method || "card";
      map[m] = (map[m] || 0) + (Number(e.amount) || 0);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [periodExpenses]);

  // 카테고리별 집계 (선택 기간 기준)
  const byCategory = useMemo(() => {
    const map: Record<string, { count: number; amount: number }> = {};
    for (const e of periodExpenses) {
      const cat = e.category || "기타";
      const prev = map[cat] || { count: 0, amount: 0 };
      map[cat] = {
        count: prev.count + 1,
        amount: prev.amount + (Number(e.amount) || 0),
      };
    }
    return Object.entries(map).sort((a, b) => b[1].amount - a[1].amount);
  }, [periodExpenses]);
  const maxCatAmount = byCategory.length > 0 ? byCategory[0][1].amount : 1;

  // 월별 추이 (최근 6개월)
  const monthlyData = useMemo(() => {
    const months: {
      key: string;
      label: string;
      count: number;
      amount: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${d.getMonth() + 1}월`;
      const mExpenses = expenses.filter((e: EX) =>
        (e.expense_date || "").startsWith(key),
      );
      months.push({
        key,
        label,
        count: mExpenses.length,
        amount: mExpenses.reduce(
          (s: number, e: EX) => s + (Number(e.amount) || 0),
          0,
        ),
      });
    }
    return months;
  }, [expenses, now]);
  const maxMonthAmount = Math.max(...monthlyData.map((m) => m.amount), 1);

  return (
    <div className="space-y-4">
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
              <Receipt className="w-4 h-4 text-slate-600" />
            </div>
            <span className="text-xs text-slate-500">총 지출 건수</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {periodExpenses.length}
            <span className="text-sm font-normal text-slate-400 ml-0.5">
              건
            </span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-red-500" />
            </div>
            <span className="text-xs text-slate-500">총 지출액</span>
          </div>
          <p className="text-2xl font-bold text-slate-800 font-mono">
            {fmtShort(totalAmount)}
            <span className="text-sm font-normal text-slate-400 ml-0.5">
              원
            </span>
          </p>
          {totalVat > 0 && (
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
              VAT {fmtShort(totalVat)}원
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-xs text-slate-500">이번 달 지출</span>
          </div>
          <p className="text-2xl font-bold text-slate-800 font-mono">
            {fmtShort(monthTotal)}
            <span className="text-sm font-normal text-slate-400 ml-0.5">
              원
            </span>
          </p>
          {lastMonthTotal > 0 && (
            <p
              className={`text-[10px] mt-0.5 ${monthChange > 0 ? "text-red-500" : "text-blue-600"}`}
            >
              전월 대비 {monthChange > 0 ? "+" : ""}
              {monthChange.toFixed(0)}%
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-purple-600" />
            </div>
            <span className="text-xs text-slate-500">결제수단별</span>
          </div>
          <div className="space-y-1">
            {byMethod.map(([method, amount]) => (
              <div
                key={method}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-600">
                  {EXPENSE_PAYMENT_METHOD_LABELS[method] || method}
                </span>
                <span className="font-mono text-slate-700">
                  {fmtShort(amount)}원
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 카테고리별 지출 비율 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4" /> 카테고리별 지출
          </h3>
          {byCategory.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              지출 데이터가 없습니다.
            </p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map(([cat, data]) => {
                const pct =
                  totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0;
                const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS["기타"];
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${color}`}
                        >
                          {cat}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {data.count}건
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-700">
                          {fmtShort(data.amount)}원
                        </span>
                        <span className="text-[10px] text-slate-400 w-10 text-right">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full transition-all"
                        style={{
                          width: `${(data.amount / maxCatAmount) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 월별 지출 추이 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> 월별 지출 추이 (최근 6개월)
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#e2e8f0"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => fmtShort(v)}
                tick={{ fontSize: 10 }}
                width={45}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(l: string) => l}
                    formatter={(v: number) => `${v.toLocaleString("ko-KR")}원`}
                  />
                }
              />
              <Bar dataKey="amount" name="지출" radius={[4, 4, 0, 0]}>
                {monthlyData.map((m) => (
                  <Cell
                    key={m.key}
                    fill={m.key === thisMonth ? "#f87171" : "#fecaca"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── 메인 페이지 ──
export default function ExpensesPage() {
  const {
    expenses,
    loading,
    error,
    setError,
    fetchExpenses,
    addExpense,
    updateExpense,
    uploadExpenseReceipt,
  } = useExpenses();
  const [activeTab, setActiveTab] = useState<"dashboard" | "list" | "vendors">(
    "dashboard",
  );

  // 대시보드 기간 필터 (이번 달 1일~오늘)
  const [dashPeriod, setDashPeriod] =
    useState<PeriodFilter>(getDefaultPeriod());

  // 필터
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // 정렬 + 페이지네이션
  const [sortKey, setSortKey] = useState<string>("expense_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(
    null,
  );

  const loadExpenses = useCallback(() => {
    fetchExpenses(
      filterStartDate || undefined,
      filterEndDate || undefined,
      filterCategory || undefined,
    );
  }, [fetchExpenses, filterStartDate, filterEndDate, filterCategory]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // 필터 + 정렬
  const filtered = useMemo(() => {
    let list = [...expenses];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (e: EX) =>
          (e.description || "").toLowerCase().includes(q) ||
          (e.category || "").toLowerCase().includes(q) ||
          (e.notes || "").toLowerCase().includes(q),
      );
    }
    return sortItems(list, sortKey, sortDir);
  }, [expenses, searchQuery, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalAmount = filtered.reduce(
    (s: number, e: EX) => s + (Number(e.amount) || 0),
    0,
  );

  const toggleSort = (key: string) => {
    if (sortKey === key)
      setSortDir(
        sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc",
      );
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const SortIcon = ({ col }: { col: string }) => (
    <span className="inline-flex flex-col ml-0.5 -space-y-1">
      <ChevronUp
        className={`w-3 h-3 ${sortKey === col && sortDir === "asc" ? "text-brand-600" : "text-slate-300"}`}
      />
      <ChevronDown
        className={`w-3 h-3 ${sortKey === col && sortDir === "desc" ? "text-brand-600" : "text-slate-300"}`}
      />
    </span>
  );

  const openNew = () => {
    setSelectedExpense(null);
    setModalOpen(true);
  };
  const openEdit = (e: EX) => {
    setSelectedExpense(e as ExpenseRecord);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setSelectedExpense(null);
  };

  const thCls =
    "px-2 py-2 text-[11px] font-medium text-slate-500 whitespace-nowrap cursor-pointer select-none hover:text-slate-700";

  return (
    <>
      <Header title="지출 관리" />
      <div className="max-w-full px-4 lg:px-6 py-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg flex justify-between">
            {error}
            <button onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 탭 */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === "dashboard" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> 대시보드
          </button>
          <button
            onClick={() => setActiveTab("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === "list" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <List className="w-3.5 h-3.5" /> 목록
          </button>
          <button
            onClick={() => setActiveTab("vendors")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === "vendors" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Store className="w-3.5 h-3.5" /> 거래처
          </button>
        </div>

        {/* 대시보드 탭 */}
        {activeTab === "dashboard" && !loading && (
          <>
            <PeriodSelector value={dashPeriod} onChange={setDashPeriod} />
            <ExpenseDashboard expenses={expenses} period={dashPeriod} />
          </>
        )}

        {/* 목록 탭 */}
        {activeTab === "list" && (
          <>
            {/* 필터 */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">필터</span>
                <div className="relative w-full min-w-[200px] flex-1 sm:ml-2 sm:max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(0);
                    }}
                    placeholder="내용 / 카테고리 검색"
                    className="w-full h-8 pl-8 pr-3 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                    className="h-8 px-2 border border-slate-200 rounded text-xs text-slate-600"
                  >
                    <option value={15}>15개</option>
                    <option value={30}>30개</option>
                    <option value={50}>50개</option>
                    <option value={100}>100개</option>
                  </select>
                  <ExportButton
                    data={filtered}
                    columns={EXPENSE_EXPORT_COLUMNS}
                    filename="NexOps_지출내역"
                    sheetName="지출"
                    disabled={filtered.length === 0}
                  />
                  <button
                    onClick={openNew}
                    className="flex items-center gap-1 px-3 h-8 bg-brand-500 text-white rounded text-xs font-medium hover:bg-brand-600"
                  >
                    <Plus className="w-3.5 h-3.5" /> 등록
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select
                  value={filterCategory}
                  onChange={(e) => {
                    setFilterCategory(e.target.value);
                    setPage(0);
                  }}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">전체 카테고리</option>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm"
                />
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            </div>

            {loading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            )}

            {!loading && (
              <>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>총 {filtered.length}건</span>
                  {totalAmount > 0 && (
                    <span>
                      합계 {Math.ceil(totalAmount).toLocaleString()}원
                    </span>
                  )}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div
                    className="overflow-auto"
                    style={{ maxHeight: "calc(100vh - 300px)" }}
                  >
                    <table className="w-full min-w-[800px] text-[11px]">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          <th
                            className={`text-left ${thCls}`}
                            onClick={() => toggleSort("expense_date")}
                          >
                            날짜
                            <SortIcon col="expense_date" />
                          </th>
                          <th
                            className={`text-left ${thCls}`}
                            onClick={() => toggleSort("category")}
                          >
                            카테고리
                            <SortIcon col="category" />
                          </th>
                          <th
                            className={`text-left ${thCls}`}
                            onClick={() => toggleSort("description")}
                          >
                            내용
                            <SortIcon col="description" />
                          </th>
                          <th
                            className={`text-right ${thCls}`}
                            onClick={() => toggleSort("amount")}
                          >
                            공급가액
                            <SortIcon col="amount" />
                          </th>
                          <th
                            className={`text-right ${thCls}`}
                            onClick={() => toggleSort("vat_amount")}
                          >
                            VAT
                            <SortIcon col="vat_amount" />
                          </th>
                          <th
                            className={`text-center ${thCls}`}
                            onClick={() => toggleSort("payment_method")}
                          >
                            결제수단
                            <SortIcon col="payment_method" />
                          </th>
                          <th className={`text-center ${thCls}`}>증빙</th>
                          <th className={`text-left ${thCls}`}>메모</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paged.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-2 py-12 text-center">
                              <Receipt className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                              <p className="text-xs text-slate-400">
                                {expenses.length === 0
                                  ? "등록된 지출 내역이 없습니다."
                                  : "검색 결과가 없습니다."}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          paged.map((e: EX) => {
                            const catColor =
                              CATEGORY_COLORS[e.category] ||
                              CATEGORY_COLORS["기타"];
                            const hasReceipt = !!e.receipt_path;
                            return (
                              <tr
                                key={e.id}
                                className="hover:bg-slate-50 cursor-pointer"
                                onClick={() => openEdit(e)}
                              >
                                <td className="px-2 py-2 text-slate-600 whitespace-nowrap">
                                  {e.expense_date}
                                </td>
                                <td className="px-2 py-2">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${catColor}`}
                                  >
                                    {e.category}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-slate-800 max-w-[200px]">
                                  <div className="truncate">
                                    {e.description || "-"}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-right font-mono font-medium">
                                  {Math.ceil(
                                    Number(e.amount || 0),
                                  ).toLocaleString()}
                                </td>
                                <td className="px-2 py-2 text-right text-slate-400 font-mono">
                                  {Number(e.vat_amount || 0) > 0
                                    ? Math.ceil(
                                        Number(e.vat_amount),
                                      ).toLocaleString()
                                    : "-"}
                                </td>
                                <td className="px-2 py-2 text-center text-slate-500">
                                  {EXPENSE_PAYMENT_METHOD_LABELS[
                                    e.payment_method
                                  ] ||
                                    e.payment_method ||
                                    "-"}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  {hasReceipt ? (
                                    <Paperclip className="w-3.5 h-3.5 text-brand-500 mx-auto" />
                                  ) : (
                                    <span className="text-slate-300">-</span>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-slate-400 max-w-[100px]">
                                  <div className="truncate">
                                    {e.notes || "-"}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <button
                      onClick={() => setPage(0)}
                      disabled={page === 0}
                      className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30"
                    >
                      처음
                    </button>
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30"
                    >
                      이전
                    </button>
                    <span className="text-xs text-slate-500">
                      {page + 1} / {totalPages} ({filtered.length}건)
                    </span>
                    <button
                      onClick={() =>
                        setPage(Math.min(totalPages - 1, page + 1))
                      }
                      disabled={page >= totalPages - 1}
                      className="h-7 px-3 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30"
                    >
                      다음
                    </button>
                    <button
                      onClick={() => setPage(totalPages - 1)}
                      disabled={page >= totalPages - 1}
                      className="h-7 px-2 border border-slate-200 rounded text-xs text-slate-600 disabled:opacity-30"
                    >
                      마지막
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "vendors" && <ExpenseVendorsTab />}
      </div>

      <ExpenseFormModal
        open={modalOpen}
        expense={selectedExpense}
        loading={loading}
        onClose={closeModal}
        onError={setError}
        onRefresh={async () => {
          await fetchExpenses(
            filterStartDate || undefined,
            filterEndDate || undefined,
            filterCategory || undefined,
          );
        }}
        onAdd={addExpense}
        onUpdate={updateExpense}
        onUploadReceipt={uploadExpenseReceipt}
      />
    </>
  );
}
