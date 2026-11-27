"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw } from "lucide-react";
import { FocusRankGrid } from "@/components/features/focus/FocusRankGrid";
import { apiFetch } from "@/lib/api-client";
import type { RankDaily, RankTarget } from "@/types/focus";

interface FocusRankPanelProps {
  focusProductId: string;
  year: number;
  month: number;
}

interface OptionCandidate {
  vendor_item_id: string;
  option_label: string;
}

interface RankPayload {
  targets: RankTarget[];
  daily: RankDaily[];
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function daysInMonth(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`,
  );
}

export function FocusRankPanel({
  focusProductId,
  year,
  month,
}: FocusRankPanelProps) {
  const [targets, setTargets] = useState<RankTarget[]>([]);
  const [daily, setDaily] = useState<RankDaily[]>([]);
  const [options, setOptions] = useState<OptionCandidate[]>([]);
  const [vendorItemId, setVendorItemId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dates = useMemo(() => daysInMonth(year, month), [year, month]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const rankParams = new URLSearchParams({
          focusProductId,
          year: String(year),
          month: String(month),
          includeInactive: "1",
        });
        const targetParams = new URLSearchParams({
          focusProductId,
          includeInactive: "1",
        });
        const [rankResponse, targetResponse] = await Promise.all([
          apiFetch(`/api/focus/rank?${rankParams.toString()}`, { signal }),
          apiFetch(`/api/focus/rank/targets?${targetParams.toString()}`, {
            signal,
          }),
        ]);
        const [rankJson, targetJson] = await Promise.all([
          parseJson(rankResponse),
          parseJson(targetResponse),
        ]);
        if (!rankResponse.ok)
          throw new Error(
            String(rankJson.error || "월간 순위 조회에 실패했습니다."),
          );
        if (!targetResponse.ok)
          throw new Error(
            String(targetJson.error || "옵션 후보 조회에 실패했습니다."),
          );
        const rankData = rankJson.data as RankPayload | undefined;
        const targetData = targetJson.data as
          | { options?: OptionCandidate[] }
          | undefined;
        setTargets(rankData?.targets ?? []);
        setDaily(rankData?.daily ?? []);
        setOptions(targetData?.options ?? []);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : "옵션별 순위 조회에 실패했습니다.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [focusProductId, month, year],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => {
    if (!options.some((option) => option.vendor_item_id === vendorItemId)) {
      setVendorItemId(options[0]?.vendor_item_id ?? "");
    }
  }, [options, vendorItemId]);

  const addTarget = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vendorItemId || !keyword.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const selectedOption = options.find(
        (option) => option.vendor_item_id === vendorItemId,
      );
      const response = await apiFetch("/api/focus/rank/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus_product_id: focusProductId,
          vendor_item_id: vendorItemId,
          option_label: selectedOption?.option_label,
          keyword: keyword.trim(),
        }),
      });
      const json = await parseJson(response);
      if (!response.ok)
        throw new Error(String(json.error || "순위 타겟 등록에 실패했습니다."));
      setKeyword("");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "순위 타겟 등록에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const removeTarget = async (target: RankTarget) => {
    if (
      !window.confirm(
        `“${target.option_label || target.vendor_item_id} / ${target.keyword}” 추적을 종료할까요? 과거 순위 기록은 보존됩니다.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/focus/rank/targets?id=${encodeURIComponent(target.id)}`,
        { method: "DELETE" },
      );
      const json = await parseJson(response);
      if (!response.ok)
        throw new Error(String(json.error || "순위 타겟 종료에 실패했습니다."));
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "순위 타겟 종료에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">옵션별 순위</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">
            셀을 편집하면 수동값으로 저장되며 자동 수집값보다 우선합니다. 빈
            값은 —로 표시됩니다.
          </p>
        </div>
        <form
          onSubmit={addTarget}
          className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto"
        >
          <select
            value={vendorItemId}
            onChange={(event) => setVendorItemId(event.target.value)}
            disabled={saving || options.length === 0}
            aria-label="옵션 선택"
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 sm:w-56"
          >
            {options.length === 0 && (
              <option value="">등록 가능한 옵션 없음</option>
            )}
            {options.map((option) => (
              <option key={option.vendor_item_id} value={option.vendor_item_id}>
                {option.option_label} ({option.vendor_item_id})
              </option>
            ))}
          </select>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="타겟 키워드"
            aria-label="타겟 키워드"
            className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-emerald-400 sm:w-40"
          />
          <button
            type="submit"
            disabled={saving || !vendorItemId || !keyword.trim()}
            className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md bg-emerald-500 px-3 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 sm:w-auto"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            타겟 등록
          </button>
        </form>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="inline-flex items-center gap-1 font-medium"
          >
            <RefreshCw className="h-3 w-3" /> 다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
        </div>
      ) : targets.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-slate-400">
          옵션과 키워드를 선택해 첫 순위 타겟을 등록하세요.
        </div>
      ) : (
        <FocusRankGrid
          targets={targets}
          daily={daily}
          dates={dates}
          disabled={saving}
          onRemove={(target) => void removeTarget(target)}
          onReload={() => setReloadKey((value) => value + 1)}
        />
      )}
    </section>
  );
}
