"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { ProductPickOption } from "@/types/focus";

interface FocusProductComboboxProps {
  options: ProductPickOption[];
  value: string;
  onChange: (product: ProductPickOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

function gradeClass(grade: string | null): string {
  if (grade === "NEW") return "bg-green-100 text-green-700";
  if (grade?.startsWith("반품-")) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function optionLabel(product: ProductPickOption): string {
  return `${product.coupang_exposure_id} · ${product.product_name}`;
}

export function ProductGradeBadge({ grade }: { grade: string | null }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${gradeClass(grade)}`}
    >
      {grade || "등급 없음"}
    </span>
  );
}

export function FocusProductCombobox({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "노출ID 또는 상품명 검색",
}: FocusProductComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected =
    options.find((product) => product.product_id === value) ?? null;

  useEffect(() => {
    if (!open) setQuery(selected ? optionLabel(selected) : "");
  }, [open, selected]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    if (!keyword || (selected && query === optionLabel(selected)))
      return options.slice(0, 100);

    return options
      .filter(
        (product) =>
          product.product_name.toLocaleLowerCase("ko-KR").includes(keyword) ||
          product.coupang_exposure_id
            .toLocaleLowerCase("ko-KR")
            .includes(keyword),
      )
      .slice(0, 100);
  }, [options, query, selected]);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected) onChange(null);
          }}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-xs text-slate-700 outline-none focus:border-emerald-400 disabled:bg-slate-50"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          aria-label="상품 목록 열기"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              검색 결과가 없습니다.
            </p>
          ) : (
            filtered.map((product) => (
              <button
                key={`${product.coupang_exposure_id}-${product.product_id}`}
                type="button"
                role="option"
                aria-selected={product.product_id === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(product);
                  setQuery(optionLabel(product));
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50"
              >
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${product.product_id === value ? "text-emerald-600" : "text-transparent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-slate-500">
                    {product.coupang_exposure_id}
                  </span>
                  <span className="block truncate text-xs text-slate-800">
                    {product.product_name}
                  </span>
                </span>
                <ProductGradeBadge grade={product.product_grade} />
              </button>
            ))
          )}
          {filtered.length === 100 && (
            <p className="px-3 py-2 text-center text-[10px] text-slate-400">
              검색 결과 상위 100개를 표시합니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
