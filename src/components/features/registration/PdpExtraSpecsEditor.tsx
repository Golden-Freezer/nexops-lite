'use client'

/**
 * 추가 스펙 행 편집기(W3, PDP-W2W3-CONTRACT v1 §1) — 항목명·값을 행으로 더하고 지운다(12행, key 20·value 60자).
 * 입력 중에는 행을 그대로 두고, 빈 행 삭제·같은 키 정리는 잡 생성 라우트의 normalizeSpecInputs(W2a)가 저장 전에 한다.
 * 쓰임(아래 안내 문구): 모든 카피 콜·편집기 카피 재생성의 상품 사실 블록(spec-facts — 규격·숫자는 이 값만)과 긴 상세페이지 확장 표
 * (long-sections). 기본 스펙 표(dedupe specRowsFromInput)는 이 칸을 읽지 않는다.
 */

import { Plus, X } from 'lucide-react'
import {
  EXTRA_SPEC_KEY_MAX,
  EXTRA_SPEC_MAX_ROWS,
  EXTRA_SPEC_VALUE_MAX,
  type ExtraSpec,
} from '@/lib/registration/pdp-input-assist'

/** 추가 스펙 쓰임 안내 — 카피의 상품 사실(규격·숫자는 이 값만)과 긴 상세페이지 표 근거. 기본 스펙 표에는 들어가지 않는다 */
export const EXTRA_SPECS_NOTE =
  '카피를 쓸 때 상품 사실로 넘깁니다(규격·숫자는 이 값만 씁니다). 긴 상세페이지 표의 근거도 됩니다. 항목명이나 값이 빈 행은 저장할 때 빠집니다.'

const INPUT =
  'min-w-0 border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50'

export function PdpExtraSpecsEditor({
  rows,
  onChange,
  disabled,
  draft,
}: {
  rows: ExtraSpec[]
  onChange: (rows: ExtraSpec[]) => void
  disabled?: boolean
  /** 등록 초안에서 채운 행이면 '(초안)' 표시 — 오너가 고치면 상위가 끈다 */
  draft?: boolean
}) {
  const update = (index: number, patch: Partial<ExtraSpec>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const full = rows.length >= EXTRA_SPEC_MAX_ROWS
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-500">
      <span>{draft ? '추가 스펙 (항목명 · 값) (초안)' : '추가 스펙 (항목명 · 값)'}</span>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="항목명 (예: 용량)"
            maxLength={EXTRA_SPEC_KEY_MAX}
            disabled={disabled}
            aria-label={`추가 스펙 ${i + 1} 항목명`}
            className={`${INPUT} w-36 shrink-0`}
          />
          <input
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="값 (예: 500ml)"
            maxLength={EXTRA_SPEC_VALUE_MAX}
            disabled={disabled}
            aria-label={`추가 스펙 ${i + 1} 값`}
            className={`${INPUT} flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            disabled={disabled}
            aria-label={`추가 스펙 ${i + 1} 지우기`}
            className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: '', value: '' }])}
        disabled={disabled || full}
        className="inline-flex w-fit items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" />
        {full ? `추가 스펙은 ${EXTRA_SPEC_MAX_ROWS}행까지` : '추가 스펙 항목'}
      </button>
      <span className="text-[11px] text-slate-400">{EXTRA_SPECS_NOTE}</span>
    </div>
  )
}
