'use client'

/**
 * 생성 화면 '배치' 칸(R03) — 잡마다 새 배치(기본)·지금 배치를 고른다. 같은 상품을 두 배치로 만들어 비교할 수 있다.
 * 라이트 기본값은 지금 배치다(PdpForm useState). 390px에서 라디오 두 개가 한 줄에 들어간다.
 */

import { PDP_MODEL_BATCHES, PDP_MODEL_BATCH_LABELS, type PdpModelBatch } from '@/lib/registration/pdp-model-batch'
import { SectionTitle } from './PdpFormFields'

/** 설명 한 줄 — 라이트는 두 배치 모두 이 PC의 Codex(ChatGPT 구독)로 만든다. 시간은 원목도마 실측(지금 배치 약 32분) */
export const PDP_BATCH_HINT: Readonly<Record<PdpModelBatch, string>> = {
  now: '이 PC의 Codex(ChatGPT 구독)로 만듭니다 — API 요금 0원 · 약 30~40분.',
  new: '기획·사실 확인·연출 단계를 더 거쳐 이 PC의 Codex로 만듭니다 — API 요금 0원 · 지금 배치보다 오래 걸립니다.',
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
