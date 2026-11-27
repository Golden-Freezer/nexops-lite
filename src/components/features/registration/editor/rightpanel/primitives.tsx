'use client';

// editor/rightpanel/primitives.tsx — D4 분할: 원본 RightPanel.tsx 1555~1843행 순수 이동 (2026-07-04)

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--text-disabled)]">
      <span className="text-3xl">{icon}</span>
      <p className="text-xs leading-relaxed">{message}</p>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide border-b border-[var(--border-subtle)] pb-1">
      {title}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide border-b border-[var(--border-subtle)] pb-1 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
      >
        {title}
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

/** 숫자 input 스피너 숨김 CSS (인라인) */
const hideSpinnerStyle: React.CSSProperties = {
  MozAppearance: 'textfield',
  appearance: 'textfield' as React.CSSProperties['appearance'],
};
const hideSpinnerCss = `
  input[data-no-spin]::-webkit-inner-spin-button,
  input[data-no-spin]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;

/** 글로벌 스피너 숨김 — 한 번만 삽입 */
let spinnerCssInjected = false;
function ensureSpinnerCss() {
  if (spinnerCssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = hideSpinnerCss;
  document.head.appendChild(style);
  spinnerCssInjected = true;
}

function PropertyInput({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  /** 슬라이더/±버튼/방향키 증감 폭 (기본 1) — 각도·blur 등 큰 범위는 5~10 권장 */
  step?: number;
}) {
  const hasRange = min !== undefined && max !== undefined;

  // 로컬 문자열 state — 직접 입력 시 validation 지연
  const [localStr, setLocalStr] = useState<string | null>(null);
  const isEditing = localStr !== null;

  useEffect(() => { ensureSpinnerCss(); }, []);

  const commitValue = (raw: string) => {
    const v = parseInt(raw);
    if (!isNaN(v)) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
      onChange(clamped);
    }
    setLocalStr(null);
  };

  const increment = (delta: number) => {
    const next = Math.round(value) + delta;
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
    onChange(clamped);
  };

  return (
    <div className="flex items-center gap-1">
      <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">{label}</label>
      {hasRange && (
        <>
          <button
            onClick={() => increment(-step)}
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] text-xs font-bold shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--editor-brand)]"
            title={`-${step}`}
          >−</button>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.round(value)}
            onChange={(e) => onChange(parseInt(e.target.value))}
            className="flex-1 h-1 accent-[var(--editor-brand)] cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--editor-brand)]"
          />
          <button
            onClick={() => increment(step)}
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] text-xs font-bold shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--editor-brand)]"
            title={`+${step}`}
          >+</button>
        </>
      )}
      <input
        type="text"
        inputMode="numeric"
        data-no-spin=""
        value={isEditing ? localStr : String(Math.round(value))}
        onFocus={(e) => {
          setLocalStr(String(Math.round(value)));
          e.target.select();
        }}
        onChange={(e) => setLocalStr(e.target.value)}
        onBlur={(e) => commitValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setLocalStr(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            increment(step);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            increment(-step);
          }
        }}
        style={hideSpinnerStyle}
        className={`${hasRange ? 'w-12' : 'flex-1'} h-7 bg-[var(--surface-elevated)] rounded border border-[var(--border-default)] text-xs px-1 text-center outline-none focus:border-[var(--editor-brand)]`}
      />
      {unit && <span className="text-[10px] text-[var(--text-disabled)]">{unit}</span>}
    </div>
  );
}

function FloatPropertyInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const hasRange = min !== undefined && max !== undefined;

  // 로컬 문자열 state — 직접 입력 시 validation 지연
  const [localStr, setLocalStr] = useState<string | null>(null);
  const isEditing = localStr !== null;

  useEffect(() => { ensureSpinnerCss(); }, []);

  const commitValue = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
      onChange(clamped);
    }
    setLocalStr(null);
  };

  const increment = (delta: number) => {
    const next = parseFloat((value + delta).toFixed(2));
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
    onChange(clamped);
  };

  return (
    <div className="flex items-center gap-1">
      <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">{label}</label>
      {hasRange && (
        <>
          <button
            onClick={() => increment(-step)}
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] text-xs font-bold shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--editor-brand)]"
            title={`-${step}`}
          >−</button>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="flex-1 h-1 accent-[var(--editor-brand)] cursor-pointer"
          />
          <button
            onClick={() => increment(step)}
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] text-xs font-bold shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--editor-brand)]"
            title={`+${step}`}
          >+</button>
        </>
      )}
      <input
        type="text"
        inputMode="decimal"
        data-no-spin=""
        value={isEditing ? localStr : String(parseFloat(value.toFixed(1)))}
        onFocus={(e) => {
          setLocalStr(String(parseFloat(value.toFixed(1))));
          e.target.select();
        }}
        onChange={(e) => setLocalStr(e.target.value)}
        onBlur={(e) => commitValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setLocalStr(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            increment(step);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            increment(-step);
          }
        }}
        style={hideSpinnerStyle}
        className={`${hasRange ? 'w-12' : 'flex-1'} h-7 bg-[var(--surface-elevated)] rounded border border-[var(--border-default)] text-xs px-1 text-center outline-none focus:border-[var(--editor-brand)]`}
      />
      {unit && <span className="text-[10px] text-[var(--text-disabled)]">{unit}</span>}
    </div>
  );
}

function SmallToggle({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer',
        active ? 'bg-[var(--editor-brand-tint)] text-[var(--editor-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export { EmptyState, SectionHeader, CollapsibleSection, PropertyInput, FloatPropertyInput, SmallToggle };
