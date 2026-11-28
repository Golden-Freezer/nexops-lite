'use client'

/**
 * 생성 화면 '배치' 칸(R03) — 잡마다 새 배치(기본)·지금 배치를 고른다. 같은 상품을 두 배치로 만들어 비교할 수 있다.
 * 기본값은 켜기(R09, 오너 승인 2026-11-08 21:0x) 뒤 새 배치다(PdpForm useState). 390px에서 라디오 두 개가 한 줄에 들어간다.
 */

import { PDP_MODEL_BATCHES, PDP_MODEL_BATCH_LABELS, type PdpModelBatch } from '@/lib/registration/pdp-model-batch'
import { SectionTitle } from './PdpFormFields'

/**
 * 설명 한 줄 — 잡당 API·시간은 R08 1차 블라인드 실측(2026-11-08): 새 배치 3잡 원장 6.67·5.34·5.08(평균 약 $5.7)·잡 약 20~25분,
 * 지금 배치 3잡 평균 약 $3.7·약 10분(오너 켜기 질문 글과 같은 값)
 */
export const PDP_BATCH_HINT: Readonly<Record<PdpModelBatch, string>> = {
  now: '켜기 전 단계별 모델(Sonnet 중심, 이미지 gpt-image-2.6)로 만듭니다 — 잡당 API 약 $3.7·약 10분.',
  new: '오너가 고른 단계별 모델(설계·카피 Opus·Sol, 게이트·식별 카드 Argon, 이미지 MS 2k)로 만듭니다 — 잡당 API 약 $5.7·약 20~25분.',
}

export function PdpFormBatch({
  batch,
  onChange,
  disabled,
}: {
  batch: PdpModelBatch
  onChange: (batch: PdpModelBatch) => void
  disabled?: boolean
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <SectionTitle>배치</SectionTitle>
      <div role="radiogroup" aria-label="모델 배치" className="flex items-center gap-2">
        {PDP_MODEL_BATCHES.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={batch === b}
            onClick={() => onChange(b)}
            disabled={disabled}
            className={`text-xs px-4 py-1.5 rounded-full border whitespace-nowrap disabled:opacity-50 ${
              batch === b ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {PDP_MODEL_BATCH_LABELS[b]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">{PDP_BATCH_HINT[batch]}</p>
    </section>
  )
}
