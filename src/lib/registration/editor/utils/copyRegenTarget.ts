/**
 * 편집기 카피 재생성 UI(묶음 5 카피) 계산 — 순수 함수. 서버 계약은 pdp-copy-regen.ts(#204) — 무거운 import가 없는 계약 파일이라
 * 상한·어조 상수도 그대로 들여온다(서버 요청 검사와 같은 값).
 * - 대상: 잠기지 않은 글자 요소(type 'text')이고 지금 텍스트가 1~300자. 섹션의 sectionType을 그대로 보낸다.
 * - 반영: content만 후보로 바꾸고 richContent(부분 색·크기 강조 HTML)는 지운다 — 후보는 평문이고 꺾쇠가 남을 수 있다
 *   (content는 innerText로 그려진다). 위치·폭·글꼴은 그대로이고 높이는 재측정이 맞춘다(호출부).
 * - 결과: 'ok'이고 후보가 있을 때만 고를 수 있다. 'rejected'·'failed'는 이전 카피를 그대로 두고 사유만 보여 준다.
 */

import type { CanvasElement, CanvasSection } from '../types/canvas'
import type { ProSectionType } from '../types/section'
import {
  COPY_REGEN_ELEMENT_MAX_CHARS,
  COPY_REGEN_NOTE_MAX_CHARS,
  COPY_REGEN_TEXT_MAX_CHARS,
  type CopyRegenBlock,
  type CopyRegenEstimate,
  type CopyRegenRequestBody,
  type CopyRegenResponse,
  type CopyRegenTone,
} from '@/lib/registration/pdp-copy-regen'

/** 서버가 한 번에 주는 후보 수(메인·대안1·대안2) */
export const COPY_REGEN_MAX_CANDIDATES = 3

/** 키 = 서버 COPY_REGEN_TONES(시험 고정) — 화면 순서도 이 순서 */
export const COPY_REGEN_TONE_LABELS = {
  emotional: '감성',
  functional: '기능',
  balanced: '균형',
} satisfies Record<CopyRegenTone, string>

export const COPY_REGEN_TONE_ORDER = Object.keys(COPY_REGEN_TONE_LABELS) as CopyRegenTone[]

/** 이미지 생성 중(409 busy·busyKind 'images')은 따로 알린다 — 이미지가 끝나면 다시 받을 수 있다 */
export const COPY_REGEN_IMAGES_BUSY = '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요. 이미지 생성이 끝나면 카피를 다시 받을 수 있습니다.'

export interface CopyRegenTarget {
  sectionId: string
  elementId: string
  sectionType: ProSectionType
  elementName: string
  currentText: string
  /** 부분 강조(richContent)가 있으면 후보를 넣을 때 빠진다 — 화면이 미리 알린다 */
  hasRichText: boolean
}

/** 우클릭한 요소가 카피 재생성 대상이면 보낼 값, 아니면 null */
export function copyRegenTargetOf(
  sections: readonly CanvasSection[],
  sectionId: string | null | undefined,
  elementId: string | null | undefined,
): CopyRegenTarget | null {
  if (!sectionId || !elementId) return null
  const section = sections.find((s) => s.id === sectionId)
  const el = section?.elements.find((e) => e.id === elementId)
  if (!section || !el || el.type !== 'text' || el.isLocked || !el.textProps) return null
  const text = el.textProps.content ?? ''
  if (!text.trim() || text.length > COPY_REGEN_TEXT_MAX_CHARS) return null
  return {
    sectionId,
    elementId,
    sectionType: section.sectionType,
    // 서버는 식별자 모양 이름만 프롬프트에 싣고 나머지(한글 이름 등)는 뺀다 — 60자 넘으면 400이라 여기서 자른다
    elementName: (el.name ?? '').trim().slice(0, COPY_REGEN_ELEMENT_MAX_CHARS),
    currentText: text,
    hasRichText: Boolean(el.textProps.richContent),
  }
}

/** POST 본문 — 비운 선택값은 넣지 않는다(서버 기본값을 쓴다) */
export function copyRegenBody(target: CopyRegenTarget, opts: { tone?: CopyRegenTone | null; note?: string }): CopyRegenRequestBody {
  const note = opts.note?.trim().slice(0, COPY_REGEN_NOTE_MAX_CHARS)
  return {
    sectionType: target.sectionType,
    ...(target.elementName ? { elementName: target.elementName } : {}),
    currentText: target.currentText,
    ...(opts.tone ? { tone: opts.tone } : {}),
    ...(note ? { note } : {}),
  }
}

/** 고른 후보를 넣는 패치. 글자 요소가 아니거나 이미 같은 평문이면 null */
export function copyTextPatch(el: CanvasElement, text: string): Partial<CanvasElement> | null {
  if (el.type !== 'text' || !el.textProps || !text.trim()) return null
  if (el.textProps.content === text && !el.textProps.richContent) return null
  return { textProps: { ...el.textProps, content: text, richContent: undefined } }
}

export type CopyRegenOutcome =
  | { kind: 'candidates'; candidates: string[]; filtered: number; costUsd: number }
  | { kind: 'none'; message: string; details: string[]; costUsd: number }

/** POST 200 → 화면 결과. 'ok'라도 후보가 비면 고를 것이 없는 결과로 본다 */
export function copyRegenOutcome(res: CopyRegenResponse): CopyRegenOutcome {
  const candidates = res.status === 'ok' ? res.candidates.filter((c) => c.trim()).slice(0, COPY_REGEN_MAX_CANDIDATES) : []
  if (candidates.length > 0) return { kind: 'candidates', candidates, filtered: res.rejected.length, costUsd: res.costUsd }
  const fallback = res.status === 'failed' ? '후보를 만들지 못했습니다.' : '후보가 모두 검사에서 걸러졌습니다.'
  return {
    kind: 'none',
    message: res.message || fallback,
    details: res.rejected.map((r) => r.detail).filter(Boolean),
    costUsd: res.costUsd,
  }
}

/** 막힌 사유(사전 조회 blocked·POST 409) → 화면 문구와 이미지 생성 중 여부 */
export function copyRegenBlockText(block: { code?: string; busyKind?: CopyRegenBlock['busyKind']; error: string }): { text: string; imagesBusy: boolean } {
  if (block.code === 'busy' && block.busyKind === 'images') return { text: COPY_REGEN_IMAGES_BUSY, imagesBusy: true }
  return { text: block.error, imagesBusy: false }
}

export const formatUsd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`

/** 확인 전 비용 안내 문구(줄 단위) — 카피 재생성은 늘 API 과금(billed: true)이다 */
export function copyRegenCostLines(estimate: CopyRegenEstimate): string[] {
  return [
    `모델 ${estimate.model} · 후보 최대 ${COPY_REGEN_MAX_CANDIDATES}개를 한 번에 받습니다`,
    `한 번 받을 때 최대 약 ${formatUsd(estimate.maxUsd)}(API 과금, 월 예산 안에서만 실행)`,
  ]
}
