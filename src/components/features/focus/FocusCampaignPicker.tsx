"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import {
  FocusProductCombobox,
  ProductGradeBadge,
} from "@/components/features/focus/FocusProductCombobox";
import { apiFetch } from "@/lib/api-client";
import type {
  CampaignCatalogCandidate,
  FocusProduct,
  ProductPickOption,
} from "@/types/focus";

interface CandidateSelection {
  checked: boolean;
  productId: string;
}

interface BatchSummary {
  success: number;
  failed: string[];
  skipped: number;
  refreshError: string | null;
}

interface FocusCampaignPickerProps {
  onClose: () => void;
  onRegistered: (product: FocusProduct) => Promise<void>;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const currencyFormatter = new Intl.NumberFormat("ko-KR");

export function FocusCampaignPicker({
  onClose,
  onRegistered,
}: FocusCampaignPickerProps) {
  const [candidates, setCandidates] = useState<CampaignCatalogCandidate[]>([]);
  const [products, setProducts] = useState<ProductPickOption[]>([]);
  const [selections, setSelections] = useState<
    Record<string, CandidateSelection>
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSummary(null);

    apiFetch("/api/focus/campaigns?onlyRegisterable=1", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await parseJson(response);
        if (!response.ok)
          throw new Error(
            String(json.error || "캠페인 목록 조회에 실패했습니다."),
          );

        const nextCandidates =
          (json.candidates as CampaignCatalogCandidate[] | undefined) ?? [];
        const nextProducts =
          (json.products as ProductPickOption[] | undefined) ?? [];
        const availableProductIds = new Set(
          nextProducts.map((product) => product.product_id),
        );

        setCandidates(nextCandidates);
        setProducts(nextProducts);
        setSelections(
          Object.fromEntries(
            nextCandidates.map((candidate) => {
              const suggestedProductId =
                candidate.suggestions.find((suggestion) =>
                  availableProductIds.has(suggestion.product_id),
                )?.product_id ?? "";
              return [
                candidate.campaign_id,
                { checked: false, productId: suggestedProductId },
              ];
            }),
          ),
        );
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : "캠페인 목록 조회에 실패했습니다.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey]);

  const selectedCount = useMemo(
    () =>
      candidates.filter((candidate) => {
        const selection = selections[candidate.campaign_id];
        return (
          selection?.checked &&
          products.some((product) => product.product_id === selection.productId)
        );
      }).length,
    [candidates, products, selections],
  );

  const updateSelection = (
    campaignId: string,
    patch: Partial<CandidateSelection>,
  ) => {
    setSelections((current) => {
      const previous = current[campaignId] ?? { checked: false, productId: "" };
      return {
        ...current,
        [campaignId]: { ...previous, ...patch },
      };
    });
  };

  const registerSelected = async () => {
    const selected = candidates.filter(
      (candidate) => selections[candidate.campaign_id]?.checked,
    );
    if (selected.length === 0) return;

    setSubmitting(true);
    setError(null);
    setSummary(null);
    const succeeded: Array<{ campaignId: string; product: FocusProduct }> = [];
    const failed: string[] = [];
    let skipped = 0;

    for (const candidate of selected) {
      const product = products.find(
        (item) =>
          item.product_id === selections[candidate.campaign_id]?.productId,
      );
      if (!product) {
        skipped += 1;
        continue;
      }

      try {
        const response = await apiFetch("/api/focus/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: product.product_id,
            coupang_exposure_id: product.coupang_exposure_id,
            campaign_id: candidate.campaign_id,
            label: product.product_name,
          }),
        });
        const json = await parseJson(response);
        if (!response.ok) throw new Error(String(json.error || "등록 실패"));
        succeeded.push({
          campaignId: candidate.campaign_id,
          product: json.data as FocusProduct,
        });
      } catch (reason) {
        const name = candidate.name || candidate.campaign_id;
        const message = reason instanceof Error ? reason.message : "등록 실패";
        failed.push(`${name}: ${message}`);
      }
    }

    const succeededIds = new Set(succeeded.map((item) => item.campaignId));
    if (succeededIds.size > 0) {
      setCandidates((current) =>
        current.filter((candidate) => !succeededIds.has(candidate.campaign_id)),
      );
      setSelections((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([campaignId]) => !succeededIds.has(campaignId),
          ),
        ),
      );
    }

    let refreshError: string | null = null;
    if (succeeded.length > 0) {
      try {
        await onRegistered(succeeded[succeeded.length - 1].product);
      } catch (reason) {
        refreshError =
          reason instanceof Error
            ? reason.message
            : "목록 새로고침에 실패했습니다.";
      }
    }

    setSummary({ success: succeeded.length, failed, skipped, refreshError });
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="mt-4">
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="inline-flex shrink-0 items-center gap-1 font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
          </button>
        </div>
      )}

      {!error && candidates.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          등록 가능한 운영 중 판매 캠페인이 없습니다.
        </div>
      )}

      {candidates.length > 0 && (
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {candidates.map((candidate) => {
            const selection = selections[candidate.campaign_id] ?? {
              checked: false,
              productId: "",
            };
            const selectedProduct =
              products.find(
                (product) => product.product_id === selection.productId,
              ) ?? null;

            return (
              <article
                key={candidate.campaign_id}
                className={`rounded-xl border p-4 ${selection.checked ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selection.checked}
                    onChange={(event) =>
                      updateSelection(candidate.campaign_id, {
                        checked: event.target.checked,
                      })
                    }
                    aria-label={`${candidate.name || candidate.campaign_id} 포함`}
                    className="mt-1 h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                  <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
                    <section>
                      <p className="text-[11px] font-medium text-slate-400">
                        캠페인 정보
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800">
                        {candidate.name || "(캠페인명 없음)"}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        ID {candidate.campaign_id}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
                          예산{" "}
                          {candidate.budget == null
                            ? "-"
                            : `${currencyFormatter.format(candidate.budget)}원`}
                        </span>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">
                          목표 ROAS{" "}
                          {candidate.roas_target == null
                            ? "-"
                            : `${candidate.roas_target}%`}
                        </span>
                      </div>
                    </section>
                    <section>
                      <label className="text-[11px] font-medium text-slate-500">
                        상품 선택
                      </label>
                      <div className="mt-1">
                        <FocusProductCombobox
                          options={products}
                          value={selection.productId}
                          onChange={(product) =>
                            updateSelection(candidate.campaign_id, {
                              productId: product?.product_id ?? "",
                            })
                          }
                        />
                      </div>
                      {selectedProduct && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-mono">
                            {selectedProduct.coupang_exposure_id}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {selectedProduct.product_name}
                          </span>
                          <ProductGradeBadge
                            grade={selectedProduct.product_grade}
                          />
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {summary && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p className="inline-flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            등록 {summary.success}건 · 실패 {summary.failed.length}건 · 상품
            미선택 {summary.skipped}건
          </p>
          {summary.failed.map((message, index) => (
            <p key={`${index}-${message}`} className="mt-1 text-red-600">
              {message}
            </p>
          ))}
          {summary.refreshError && (
            <p className="mt-1 text-amber-700">
              목록 새로고침 실패: {summary.refreshError}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="h-9 rounded-lg border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={registerSelected}
          disabled={submitting || selectedCount === 0}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "순차 등록 중..." : `${selectedCount}개 일괄 등록`}
        </button>
      </div>
    </div>
  );
}
