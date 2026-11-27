"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { RankDaily, RankTarget } from "@/types/focus";

interface FocusRankGridProps {
  targets: RankTarget[];
  daily: RankDaily[];
  dates: string[];
  disabled: boolean;
  onRemove: (target: RankTarget) => void;
  onReload: () => void;
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return String(body.error || fallback);
  } catch {
    return fallback;
  }
}

function RankCell({
  targetId,
  date,
  observation,
  disabled,
  onSaved,
}: {
  targetId: string;
  date: string;
  observation?: RankDaily;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(observation?.rank?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(observation?.rank?.toString() ?? "");
  }, [observation]);

  const save = async () => {
    if (disabled) return;
    const original = observation?.rank?.toString() ?? "";
    if (value === original || saving) return;
    if (value === "") {
      setValue(original);
      if (observation?.source === "manual") {
        window.alert(
          "수동 순위는 관측 이력으로 삭제하지 않습니다. 올바른 순위를 입력해 정정해 주세요.",
        );
      }
      return;
    }

    const rank = Number(value);
    if (!Number.isSafeInteger(rank) || rank < 1) {
      setValue(original);
      window.alert("순위는 1 이상의 정수로 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/focus/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_id: targetId,
          metric_date: date,
          rank,
          found: true,
        }),
      });
      if (!response.ok)
        throw new Error(
          await responseError(response, "수동 순위 저장에 실패했습니다."),
        );
      onSaved();
    } catch (reason) {
      setValue(original);
      window.alert(
        reason instanceof Error
          ? reason.message
          : "수동 순위 저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const pageLabel =
    observation?.page && observation.position_in_page
      ? `${observation.page}페이지 ${observation.position_in_page}위`
      : observation?.found === false
        ? "수집 범위 내 미노출"
        : "순위 미수집";

  return (
    <td
      className={`border-l border-slate-100 p-0 text-center ${observation?.source === "manual" ? "bg-blue-50/60" : ""}`}
    >
      <input
        type="number"
        min={1}
        inputMode="numeric"
        aria-label={`${date} 수동 순위`}
        title={`${pageLabel} · ${observation?.source === "manual" ? "수동" : "자동/미수집"}`}
        value={value}
        disabled={saving || disabled}
        placeholder="—"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(observation?.rank?.toString() ?? "");
            event.currentTarget.blur();
          }
        }}
        className="h-9 w-11 bg-transparent px-1 text-center text-[11px] tabular-nums text-slate-700 outline-none placeholder:text-slate-300 focus:bg-emerald-50 disabled:opacity-50"
      />
    </td>
  );
}

export function FocusRankGrid({
  targets,
  daily,
  dates,
  disabled,
  onRemove,
  onReload,
}: FocusRankGridProps) {
  const dailyByCell = useMemo(
    () =>
      new Map(daily.map((row) => [`${row.target_id}:${row.metric_date}`, row])),
    [daily],
  );

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="sticky left-0 z-10 min-w-60 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold">
              옵션 · 키워드
            </th>
            {dates.map((date) => (
              <th
                key={date}
                className="min-w-11 border-b border-slate-200 px-1 py-2 text-center font-medium"
              >
                {Number(date.slice(8))}일
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {targets.map((target) => (
            <tr
              key={target.id}
              className={
                target.is_active === false ? "bg-slate-50/70" : undefined
              }
            >
              <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-700">
                      {target.option_label || target.vendor_item_id}
                    </p>
                    <p className="truncate text-[10px] text-slate-400">
                      {target.keyword} · {target.vendor_item_id}
                    </p>
                    {target.is_active === false && (
                      <p className="text-[10px] font-medium text-amber-600">
                        추적 종료
                        {target.valid_to ? ` · ${target.valid_to}` : ""}
                      </p>
                    )}
                  </div>
                  {target.is_active !== false && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemove(target)}
                      aria-label="타겟 추적 종료"
                      title="과거 순위 기록을 보존하고 추적만 종료합니다."
                      className="text-slate-300 hover:text-amber-500 disabled:opacity-50"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </td>
              {dates.map((date) => (
                <RankCell
                  key={date}
                  targetId={target.id}
                  date={date}
                  observation={dailyByCell.get(`${target.id}:${date}`)}
                  disabled={disabled || target.is_active === false}
                  onSaved={onReload}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
