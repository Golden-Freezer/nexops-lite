'use client'

/**
 * 레퍼런스 입력(13_REFERENCE_INPUT PR③) — 기존 상세페이지 캡처·PDF를 **분석용으로만** 받는다(오너 조건 2026-10-30).
 * - 긴 캡처는 브라우저에서 폭 860 띠 JPEG로 줄여 보내고(Vercel 요청 본문 상한), PDF는 4MB 이하만 그대로 보낸다(reference-browser).
 * - 서버는 구조·흐름·소구 유형만 읽어 돌려주고 파일을 저장하지 않는다. 결과는 spec.referenceInputs(3개 이하)에 넣는다.
 * - 자사 기존 페이지(own)는 '현행 페이지 진단'(흐름·잘하는 점·고칠 점)을 오너에게 보여 준다.
 * 접어 둔 칸이다 — 리서치 반영은 기능 스위치(references) 켜진 잡만이고, 원문 가드는 레퍼런스가 있으면 늘 걸린다.
 */

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileImage, Loader2, X } from 'lucide-react'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { fetchReferenceAnalysis } from '@/lib/registration/references/reference-browser'
import {
  REFERENCE_LIMITS,
  REFERENCE_ROLE_LABELS,
  type ReferenceInput,
  type ReferenceKind,
  type ReferenceRole,
} from '@/lib/registration/references/reference-types'

export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  own: '자사 기존 페이지',
  competitor: '경쟁 상세페이지',
  other: '기타 참고 페이지',
}

/** 흐름 표시 — 저장된 영문 역할 흐름('hook → usp ×3 → cta')을 한국어 이름으로. 모르는 낱말은 그대로 둔다 */
export function flowLabel(flow: string): string {
  return flow
    .split(' → ')
    .map((part) => {
      const [, role, times = ''] = /^(\w+)( ×\d+)?$/.exec(part) ?? []
      return role && role in REFERENCE_ROLE_LABELS ? `${REFERENCE_ROLE_LABELS[role as ReferenceRole]}${times}` : part
    })
    .join(' → ')
}

/** 결과 한 줄 — 구간 수·흐름·비용 */
export function referenceSummary(ref: ReferenceInput): string {
  const flow = ref.insights.flow ? flowLabel(ref.insights.flow) : '흐름 없음'
  return `구간 ${ref.insights.sections.length} · ${flow} · $${ref.costUsd.toFixed(2)}`
}

/** 분석 결과 추가 → spec 패치(3개 상한, 같은 id는 바꿔 넣는다) */
export function addReferencePatch(spec: PdpSpecSheet, ref: ReferenceInput): Partial<PdpSpecSheet> {
  const rest = (spec.referenceInputs ?? []).filter((r) => r.id !== ref.id)
  return { referenceInputs: [...rest, ref].slice(-REFERENCE_LIMITS.perJob) }
}

/** 빼기 → spec 패치(마지막을 빼면 필드를 지운다) */
export function removeReferencePatch(spec: PdpSpecSheet, id: string): Partial<PdpSpecSheet> {
  const left = (spec.referenceInputs ?? []).filter((r) => r.id !== id)
  return { referenceInputs: left.length > 0 ? left : undefined }
}

function OwnDiagnosis({ reference }: { reference: ReferenceInput }) {
  const { flow, strengths, weaknesses } = reference.insights
  return (
    <div className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
      <div className="font-semibold">현행 페이지 진단</div>
      <div>흐름: {flow ? flowLabel(flow) : '—'}</div>
      {strengths.length > 0 && <div>잘하는 점: {strengths.join(' / ')}</div>}
      {weaknesses.length > 0 && <div>고칠 점: {weaknesses.join(' / ')}</div>}
    </div>
  )
}

export function PdpReferenceFiles({
  spec,
  onChange,
  disabled,
}: {
  spec: PdpSpecSheet
  onChange: (patch: Partial<PdpSpecSheet>) => void
  disabled?: boolean
}) {
  const refs = spec.referenceInputs ?? []
  const [open, setOpen] = useState(refs.length > 0)
  const [kind, setKind] = useState<ReferenceKind>('own')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const full = refs.length >= REFERENCE_LIMITS.perJob

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      onChange(addReferencePatch(spec, await fetchReferenceAnalysis(kind, file)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '레퍼런스를 분석하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left font-medium text-slate-600"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        레퍼런스 (기존 상세페이지 분석 전용){refs.length > 0 ? ` · ${refs.length}개` : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-400">
            기존 상세페이지 캡처·PDF의 구조·흐름·소구 유형만 읽어 기획에 참고합니다. 글·이미지는 카피와 이미지에 쓰지 않고 저장하지
            않습니다. 긴 캡처는 브라우저에서 줄여 보냅니다(1회 약 $0.08, PDF는 4MB 이하, 최대 {REFERENCE_LIMITS.perJob}개).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span>레퍼런스 종류</span>
              <select
                aria-label="레퍼런스 종류"
                value={kind}
                onChange={(e) => setKind(e.target.value as ReferenceKind)}
                disabled={busy || disabled}
                className="rounded border border-slate-300 bg-white px-1 py-0.5 text-slate-600"
              >
                {(Object.keys(REFERENCE_KIND_LABELS) as ReferenceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {REFERENCE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy || disabled || full}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileImage className="h-3.5 w-3.5" />}
              {busy ? '분석 중…' : full ? `${REFERENCE_LIMITS.perJob}개까지` : '캡처·PDF 선택'}
            </button>
            <input
              ref={inputRef}
              type="file"
              aria-label="레퍼런스 파일"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) upload(file)
              }}
            />
          </div>
          {refs.map((ref) => (
            <div key={ref.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
              <div className="flex items-center gap-1 text-slate-600">
                <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px]">{REFERENCE_KIND_LABELS[ref.kind]}</span>
                <span className="truncate">{ref.fileName}</span>
                <span className="shrink-0 text-slate-400">({referenceSummary(ref)})</span>
                <button
                  type="button"
                  onClick={() => onChange(removeReferencePatch(spec, ref.id))}
                  disabled={busy || disabled}
                  className="ml-auto shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-50"
                  aria-label={`레퍼런스 빼기 ${ref.fileName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {ref.kind === 'own' && <OwnDiagnosis reference={ref} />}
              {ref.warnings.length > 0 && <div className="mt-1 text-[11px] text-amber-700">{ref.warnings.join(' · ')}</div>}
            </div>
          ))}
          {error && (
            <div role="alert" className="text-red-600">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
