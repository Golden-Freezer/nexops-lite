"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { kstTodayStr } from "@/lib/analytics/date-buckets";
import { calculateExpenseTotal, calculateExpenseVat } from "@/lib/calc/expense";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type ExpenseForm,
} from "@/types/purchases";
import { ExpenseVendorSelect } from "./ExpenseVendorSelect";

export interface ExpenseRecord {
  id: string;
  expense_date?: string;
  expenseDate?: string;
  category: string;
  description?: string | null;
  amount: number;
  vat_amount?: number | null;
  vatAmount?: number | null;
  payment_method?: string | null;
  paymentMethod?: string | null;
  vendor_id?: string | null;
  vendorId?: string | null;
  receipt_path?: string | null;
  notes?: string | null;
}

interface AddExpenseResult {
  data: { id: string };
  receiptUploadError?: string;
}

interface ExpenseFormModalProps {
  open: boolean;
  expense: ExpenseRecord | null;
  loading: boolean;
  onClose: () => void;
  onError: (message: string | null) => void;
  onRefresh: () => Promise<void>;
  onAdd: (
    form: ExpenseForm,
    receiptFile?: File | null,
  ) => Promise<AddExpenseResult | null>;
  onUpdate: (id: string, form: ExpenseForm) => Promise<unknown | null>;
  onUploadReceipt: (
    expenseId: string,
    file: File,
  ) => Promise<{ receiptPath: string; warning?: string }>;
}

function createEmptyForm(): ExpenseForm {
  return {
    expenseDate: kstTodayStr(),
    category: "기타",
    description: "",
    amount: 0,
    vatAmount: 0,
    paymentMethod: "card",
    vendorId: null,
    notes: "",
  };
}

function toForm(expense: ExpenseRecord | null): ExpenseForm {
  if (!expense) return createEmptyForm();
  return {
    expenseDate: expense.expense_date || expense.expenseDate || kstTodayStr(),
    category: expense.category,
    description: expense.description || "",
    amount: Number(expense.amount) || 0,
    vatAmount: Number(expense.vat_amount ?? expense.vatAmount) || 0,
    paymentMethod: expense.payment_method || expense.paymentMethod || "card",
    vendorId: expense.vendor_id || expense.vendorId || null,
    notes: expense.notes || "",
  };
}

export function ExpenseFormModal({
  open,
  expense,
  loading,
  onClose,
  onError,
  onRefresh,
  onAdd,
  onUpdate,
  onUploadReceipt,
}: ExpenseFormModalProps) {
  const [form, setForm] = useState<ExpenseForm>(createEmptyForm);
  const [persistedId, setPersistedId] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [vatTouched, setVatTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(expense));
    setPersistedId(expense?.id || null);
    setReceiptPath(expense?.receipt_path || null);
    setSelectedFile(null);
    setVatTouched(Boolean(expense));
    setLocalError(null);
  }, [expense, open]);

  const totalAmount = useMemo(
    () => calculateExpenseTotal(form.amount, form.vatAmount || 0),
    [form.amount, form.vatAmount],
  );

  if (!open) return null;

  const handleAmountChange = (amount: number) => {
    setForm((current) => ({
      ...current,
      amount,
      vatAmount: vatTouched ? current.vatAmount : calculateExpenseVat(amount),
    }));
  };

  const recalculateVat = () => {
    setVatTouched(false);
    setForm((current) => ({
      ...current,
      vatAmount: calculateExpenseVat(current.amount),
    }));
  };

  const uploadSelectedReceipt = async (expenseId: string) => {
    if (!selectedFile) return true;
    setUploading(true);
    try {
      const uploaded = await onUploadReceipt(expenseId, selectedFile);
      setReceiptPath(uploaded.receiptPath);
      setSelectedFile(null);
      setLocalError(uploaded.warning || null);
      await onRefresh();
      return true;
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "증빙 업로드 실패";
      setLocalError(
        `지출 행은 저장되었습니다. 증빙만 재시도해 주세요: ${message}`,
      );
      return false;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (form.amount <= 0) {
      setLocalError("공급가액을 입력하세요.");
      return;
    }
    setLocalError(null);

    if (persistedId) {
      const updated = await onUpdate(persistedId, form);
      if (!updated) return;
      if (selectedFile && !(await uploadSelectedReceipt(persistedId))) return;
      onClose();
      return;
    }

    const result = await onAdd(form, selectedFile);
    if (!result) return;
    if (result.receiptUploadError) {
      setPersistedId(result.data.id);
      setLocalError(
        `지출 행은 저장되었습니다. 증빙만 재시도해 주세요: ${result.receiptUploadError}`,
      );
      return;
    }
    onClose();
  };

  const handleViewReceipt = async () => {
    if (!persistedId) return;
    setViewingReceipt(true);
    try {
      const res = await apiFetch(`/api/expenses/${persistedId}/receipt`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      window.open(json.data.url, "_blank", "noopener,noreferrer");
    } catch (viewError) {
      onError(
        viewError instanceof Error ? viewError.message : "증빙 조회 실패",
      );
    } finally {
      setViewingReceipt(false);
    }
  };

  const handleDeleteReceipt = async () => {
    if (!persistedId || !confirm("증빙 파일을 삭제하시겠습니까?")) return;
    try {
      const res = await apiFetch(
        `/api/expenses/upload?expenseId=${persistedId}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setReceiptPath(null);
      if (typeof json.warning === "string") onError(json.warning);
      await onRefresh();
    } catch (deleteError) {
      onError(
        deleteError instanceof Error ? deleteError.message : "증빙 삭제 실패",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-700">
            {persistedId ? "지출 수정" : "지출결의서 등록"}
          </h3>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {localError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {localError}
              {persistedId && selectedFile && (
                <button
                  type="button"
                  onClick={() => uploadSelectedReceipt(persistedId)}
                  disabled={uploading}
                  className="ml-2 font-semibold text-brand-700 underline"
                >
                  {uploading ? "재시도 중..." : "증빙만 재시도"}
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ExpenseVendorSelect
              value={form.vendorId}
              onSelect={(vendor) =>
                setForm((current) => ({
                  ...current,
                  vendorId: vendor?.id || null,
                  category: vendor?.default_category || current.category,
                  paymentMethod:
                    vendor?.default_payment_method || current.paymentMethod,
                }))
              }
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                지출일 *
              </label>
              <input
                type="date"
                value={form.expenseDate}
                onChange={(e) =>
                  setForm({ ...form, expenseDate: e.target.value })
                }
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                카테고리 *
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                결제수단
              </label>
              <select
                value={form.paymentMethod || "card"}
                onChange={(e) =>
                  setForm({ ...form, paymentMethod: e.target.value })
                }
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                {EXPENSE_PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.paymentMethod === "coupang_deduction" && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              이 지출은 순이익 계산에 포함되지 않습니다(쿠팡 정산에서 이미
              차감됨).
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                공급가액(원) *
              </label>
              <input
                type="number"
                value={form.amount || ""}
                onChange={(e) => handleAmountChange(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-right text-sm"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-600">
                  VAT
                </label>
                {vatTouched && (
                  <button
                    type="button"
                    onClick={recalculateVat}
                    className="flex items-center gap-1 text-[10px] text-brand-600"
                  >
                    <RotateCcw className="h-3 w-3" /> 10% 재계산
                  </button>
                )}
              </div>
              <input
                type="number"
                value={form.vatAmount ?? ""}
                onChange={(e) => {
                  setVatTouched(true);
                  setForm({ ...form, vatAmount: Number(e.target.value) });
                }}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-right text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>공급가액</span>
              <span>{form.amount.toLocaleString("ko-KR")}원</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>VAT</span>
              <span>{(form.vatAmount || 0).toLocaleString("ko-KR")}원</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-700">
              <span>총액</span>
              <span>{totalAmount.toLocaleString("ko-KR")}원</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              내용(적요)
            </label>
            <input
              value={form.description || ""}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="지출 내역"
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              메모
            </label>
            <input
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="비고"
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
              <Paperclip className="h-3 w-3" /> 증빙 파일
            </label>
            {receiptPath ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <FileText className="h-5 w-5 flex-shrink-0 text-brand-500" />
                <p className="min-w-0 flex-1 truncate text-xs text-slate-700">
                  증빙 파일 첨부됨
                </p>
                <button
                  onClick={handleViewReceipt}
                  disabled={viewingReceipt}
                  className="flex h-7 items-center gap-1 rounded border border-brand-200 px-2 text-xs text-brand-600"
                >
                  <ExternalLink className="h-3 w-3" />{" "}
                  {viewingReceipt ? "불러오는 중..." : "보기"}
                </button>
                <button
                  onClick={handleDeleteReceipt}
                  className="flex h-7 items-center gap-1 rounded border border-red-200 px-2 text-xs text-red-600"
                >
                  <Trash2 className="h-3 w-3" /> 삭제
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 hover:border-brand-400">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 text-slate-400" />
                )}
                <span className="text-xs text-slate-500">
                  {selectedFile
                    ? selectedFile.name
                    : "저장과 동시에 첨부할 파일 선택 (최대 10MB)"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  accept="image/*,.pdf,.xls,.xlsx,.doc,.docx,.csv,.txt"
                  onChange={(e) => {
                    setSelectedFile(e.target.files?.[0] || null);
                    setLocalError(null);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
          {persistedId ? (
            <button
              type="button"
              disabled
              title="회계·세무 원장 보존을 위해 지출 내역 삭제가 잠겨 있습니다."
              className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-4 text-sm text-slate-400"
            >
              <Lock className="h-3.5 w-3.5" /> 삭제 잠금
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-9 rounded-lg border border-slate-200 px-4 text-sm text-slate-600"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || uploading}
              className="h-9 rounded-lg bg-brand-500 px-6 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading || uploading
                ? "저장 중..."
                : persistedId
                  ? "수정"
                  : "등록"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
