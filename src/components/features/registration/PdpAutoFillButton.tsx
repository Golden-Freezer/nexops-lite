'use client'

/**
 * 페르소나·톤 자동 작성(W3, PDP-W2W3-CONTRACT v1 §2-2·§4) — 상품 정보로 제안을 받아 빈 칸만 채우고,
 * 이미 쓴 칸은 제안을 보여 '바꾸기'로 고르게 한다(오너가 고친다 — NEXFIT은 무조건 덮어썼다).
 * API(A)는 제안만 돌려준다. 상품명이 없으면 버튼을 막는다(이미지는 선택). 호출은 API 과금이라 비용을 함께 보여 준다.
 */

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import {
  planAutoFill,
  type AutoFillField,
  type AutoFillResponse,
  type AutoFillSuggestions,
} from '@/lib/registration/pdp-input-assist'

export const AUTO_FILL_LABELS: Record<AutoFillField, string> = {
  targetPersona: '타겟 페르소나',
  brandVoiceGuide: '브랜드 보이스',
  brandHexColor: '브랜드 컬러',
}

export const AUTO_FILL_BUDGET_MESSAGE = '이번 달 AI 예산 한도에 걸려 지금은 자동 작성을 할 수 없습니다.'

/** 기본 호출 — POST /api/registration/pdp/auto-fill. 실패는 서버 error 문구로 던지고, 예산 막힘(409 budget)은 고정 문구로 */
export async function requestAutoFill(body: unknown): Promise<AutoFillResponse> {
  const res = await fetch('/api/registration/pdp/auto-fill', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Partial<AutoFillResponse> & { error?: string; code?: string }
  if (res.status === 409 && json.code === 'budget') throw new Error(AUTO_FILL_BUDGET_MESSAGE)
  if (!res.ok || !json.suggestions) throw new Error(json.error || `자동 작성 실패(${res.status})`)
  return json as AutoFillResponse
}

type Conflict = { field: AutoFillField; current: string; suggested: string }

export function PdpAutoFillButton({
  productName,
  current,
  buildRequest,
  onApply,
  disabled,
  request = requestAutoFill,
}: {
  productName: string
  /** 지금 칸 값 — 빈 칸만 채우는 판단에 쓴다 */
  current: Partial<Record<AutoFillField, string | undefined>>
  /** 요청 본문(계약 §2-2) — 화면이 지금 spec으로 만든다 */
  buildRequest: () => unknown
  onApply: (patch: AutoFillSuggestions) => void
  disabled?: boolean
  request?: (body: unknown) => Promise<AutoFillResponse>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [cost, setCost] = useState<number | null>(null)
  // 서버가 뺀 제안·읽지 못한 사진 등 안내(계약 v1.1 warnings) — 한 줄씩
  const [warnings, setWarnings] = useState<string[]>([])
  const blocked = !productName.trim()

  const run = async () => {
    if (busy || blocked) return
    setBusy(true)
    setError('')
    setConflicts([])
    setWarnings([])
    try {
      const res = await request(buildRequest())
      const plan = planAutoFill(current, res.suggestions)
      if (Object.keys(plan.fill).length > 0) onApply(plan.fill)
      setConflicts(plan.conflicts)
      setCost(res.costUsd)
      setWarnings((res.warnings ?? []).filter((w) => typeof w === 'string' && w.trim()))
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '자동 작성 실패')
    } finally {
      setBusy(false)
    }
  }

  const resolve = (field: AutoFillField, value?: string) => {
    if (value !== undefined) onApply({ [field]: value } as AutoFillSuggestions)
    setConflicts((list) => list.filter((c) => c.field !== field))
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs text-slate-500">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={disabled || busy || blocked}
          title={blocked ? '상품명을 먼저 입력해 주세요' : undefined}
          className="inline-flex items-center gap-1 rounded border border-brand-300 bg-brand-50 px-2 py-1 text-brand-600 hover:bg-brand-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? '작성 중…' : 'AI로 페르소나·톤 채우기'}
        </button>
        <span className="text-[11px] text-slate-400">
          빈 칸만 채웁니다. API 과금(월 예산 안){cost !== null ? ` · 이번 비용 $${cost.toFixed(4)}` : ''}
        </span>
      </div>
      {conflicts.length > 0 && (
        <ul aria-label="이미 쓴 칸의 제안" className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-2">
          {conflicts.map((c) => (
            <li key={c.field} className="flex flex-col gap-1">
              <span className="text-slate-600">
                {AUTO_FILL_LABELS[c.field]} 제안: <span className="text-slate-800">{c.suggested}</span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolve(c.field, c.suggested)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:border-brand-400"
                >
                  바꾸기
                </button>
                <button type="button" onClick={() => resolve(c.field)} className="rounded px-2 py-0.5 text-slate-500 hover:text-slate-700">
                  그대로 두기
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul aria-label="자동 작성 안내" className="flex flex-col gap-0.5 text-[11px] text-amber-700">
          {warnings.map((w, i) => (
            <li key={`${i}-${w}`}>{w}</li>
          ))}
        </ul>
      )}
      {error && (
        <div role="alert" className="text-red-600">
          {error}
        </div>
      )}
    </div>
  )
}
