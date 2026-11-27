"use client";

import { useState, useCallback, useRef } from "react";
import type {
  Purchase,
  PurchaseForm,
  PurchaseMutationOptions,
  PurchaseMutationResult,
  Expense,
  ExpenseForm,
} from "@/types/purchases";
import { apiFetch } from "@/lib/api-client";

export interface PurchaseFilters {
  status?: string;
  productId?: string;
  startDate?: string;
  endDate?: string;
}

export function usePurchases() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutatingPurchaseIds, setMutatingPurchaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingOperationIds = useRef(new Map<string, string>());

  const setPurchaseMutating = useCallback((id: string, mutating: boolean) => {
    setMutatingPurchaseIds((current) => {
      const next = new Set(current);
      if (mutating) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const isPurchaseMutating = useCallback(
    (id: string) => mutatingPurchaseIds.has(id),
    [mutatingPurchaseIds],
  );

  const fetchPurchases = useCallback(async (filters?: PurchaseFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.productId) params.set("productId", filters.productId);
      if (filters?.startDate) params.set("startDate", filters.startDate);
      if (filters?.endDate) params.set("endDate", filters.endDate);
      const url = `/api/purchases${params.toString() ? `?${params}` : ""}`;
      const res = await apiFetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPurchases(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "매입 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const addPurchase = useCallback(
    async (form: PurchaseForm) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        await fetchPurchases();
        return json.data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "매입 등록 실패");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fetchPurchases],
  );

  const updatePurchase = useCallback(
    async (
      id: string,
      updates: Partial<PurchaseForm>,
      options: PurchaseMutationOptions,
    ): Promise<PurchaseMutationResult | null> => {
      const operationKey = `patch:${id}:${options.expectedUpdatedAt}:${JSON.stringify(updates)}`;
      const operationId =
        options.operationId ??
        pendingOperationIds.current.get(operationKey) ??
        crypto.randomUUID();
      pendingOperationIds.current.set(operationKey, operationId);
      setLoading(true);
      setPurchaseMutating(id, true);
      setError(null);
      try {
        const res = await apiFetch("/api/purchases", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            operationId,
            expectedUpdatedAt: options.expectedUpdatedAt,
            ...updates,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 409 && json.code === "STALE_PURCHASE") {
            pendingOperationIds.current.delete(operationKey);
            await fetchPurchases();
          }
          throw new Error(json.error || "매입 수정 실패");
        }
        await fetchPurchases();
        pendingOperationIds.current.delete(operationKey);
        return {
          data: json.data,
          mutation: json.mutation,
        } as PurchaseMutationResult;
      } catch (err) {
        setError(err instanceof Error ? err.message : "매입 수정 실패");
        return null;
      } finally {
        setPurchaseMutating(id, false);
        setLoading(false);
      }
    },
    [fetchPurchases, setPurchaseMutating],
  );

  const deletePurchase = useCallback(
    async (
      id: string,
      options: PurchaseMutationOptions,
    ): Promise<PurchaseMutationResult | null> => {
      const operationKey = `delete:${id}:${options.expectedUpdatedAt}`;
      const operationId =
        options.operationId ??
        pendingOperationIds.current.get(operationKey) ??
        crypto.randomUUID();
      pendingOperationIds.current.set(operationKey, operationId);
      setLoading(true);
      setPurchaseMutating(id, true);
      setError(null);
      try {
        const params = new URLSearchParams({
          id,
          operationId,
          expectedUpdatedAt: options.expectedUpdatedAt,
        });
        const res = await apiFetch(`/api/purchases?${params}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 404) {
            pendingOperationIds.current.delete(operationKey);
            await fetchPurchases();
            // 첫 DELETE가 커밋된 뒤 응답만 유실된 경우 목표 상태는 이미 달성됐다.
            return { data: null, mutation: null, recovered: true };
          }
          if (res.status === 409 && json.code === "STALE_PURCHASE") {
            pendingOperationIds.current.delete(operationKey);
            await fetchPurchases();
          }
          throw new Error(json.error || "매입 삭제 실패");
        }
        await fetchPurchases();
        pendingOperationIds.current.delete(operationKey);
        return {
          data: null,
          mutation: json.mutation,
        } as PurchaseMutationResult;
      } catch (err) {
        setError(err instanceof Error ? err.message : "매입 삭제 실패");
        return null;
      } finally {
        setPurchaseMutating(id, false);
        setLoading(false);
      }
    },
    [fetchPurchases, setPurchaseMutating],
  );

  return {
    purchases,
    loading,
    error,
    setError,
    fetchPurchases,
    addPurchase,
    updatePurchase,
    deletePurchase,
    isPurchaseMutating,
  };
}

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(
    async (startDate?: string, endDate?: string, category?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        if (category) params.set("category", category);
        const url = `/api/expenses${params.toString() ? `?${params}` : ""}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setExpenses(json.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "지출 조회 실패");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const uploadExpenseReceipt = useCallback(
    async (expenseId: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("expenseId", expenseId);
      const res = await apiFetch("/api/expenses/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return {
        ...(json.data as { receiptPath: string }),
        warning: typeof json.warning === "string" ? json.warning : undefined,
      };
    },
    [],
  );

  const addExpense = useCallback(
    async (form: ExpenseForm, receiptFile?: File | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        let receiptUploadError: string | undefined;
        if (receiptFile && json.data?.id) {
          try {
            await uploadExpenseReceipt(json.data.id, receiptFile);
          } catch (uploadError) {
            receiptUploadError =
              uploadError instanceof Error
                ? uploadError.message
                : "증빙 업로드 실패";
            setError(
              `지출은 저장됐지만 증빙 업로드에 실패했습니다: ${receiptUploadError}`,
            );
          }
        }
        await fetchExpenses();
        return { data: json.data, receiptUploadError };
      } catch (err) {
        setError(err instanceof Error ? err.message : "지출 등록 실패");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fetchExpenses, uploadExpenseReceipt],
  );

  const updateExpense = useCallback(
    async (id: string, updates: Partial<ExpenseForm>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/expenses", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...updates }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        await fetchExpenses();
        return json.data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "지출 수정 실패");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fetchExpenses],
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/expenses?id=${id}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        await fetchExpenses();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "지출 삭제 실패");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fetchExpenses],
  );

  return {
    expenses,
    loading,
    error,
    setError,
    fetchExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    uploadExpenseReceipt,
  };
}
