/**
 * 경쟁사 리뷰 재현 가드 — 산출 글이 경쟁사 리뷰 문장을 길게 옮겼는지(정규화 15자 n-gram 겹침) 검사한다.
 * 카피·리서치 프롬프트에는 경쟁사 원문이 들어가지 않으므로 여기는 다중 방어다(계약: 재현 가드).
 * 쓰는 곳: ① 경쟁사 분석 산출 항목 버리기 ② 카피 직후 섹션 재생성 지시 ③ 모든 게이트 뒤 남은 문장 지우기.
 * 순수 함수(LLM·DB 없음).
 */

import type { CopywritingResult } from '../pdp-state'
import { normalizeReviewText } from './review-sanitize'

/** 공백·문장부호를 뺀 글자 수 기준 — 짧은 공통 표현("사용하기 편해요")의 우연 일치는 잡지 않는다 */
export const ECHO_MIN_CHARS = 15

export interface EchoGuard {
  grams: Set<string>
}

function forEachGram(text: string, fn: (gram: string) => void): void {
  const norm = normalizeReviewText(text)
  for (let i = 0; i + ECHO_MIN_CHARS <= norm.length; i += 1) fn(norm.slice(i, i + ECHO_MIN_CHARS))
}

/**
 * 경쟁사 리뷰 본문·제목에서 15자 조각을 모은다. exclude(자사 리뷰 텍스트)에도 있는 조각은 뺀다 —
 * 자사 리뷰 인용이 경쟁사 리뷰의 흔한 표현과 우연히 겹쳐 재생성·삭제되는 일을 막는다. 조각이 없으면 null
 */
export function buildEchoGuard(texts: string[], exclude: string[] = []): EchoGuard | null {
  const grams = new Set<string>()
  for (const text of texts) forEachGram(text, (g) => grams.add(g))
  for (const text of exclude) forEachGram(text, (g) => grams.delete(g))
  return grams.size > 0 ? { grams } : null
}

export function hasEcho(text: string, guard: EchoGuard): boolean {
  const norm = normalizeReviewText(text)
  for (let i = 0; i + ECHO_MIN_CHARS <= norm.length; i += 1) {
    if (guard.grams.has(norm.slice(i, i + ECHO_MIN_CHARS))) return true
  }
  return false
}

/** 배열 항목이 지우기로 망가졌는가 — 글 한 줄이 통째로 비었거나, 객체의 글 칸 하나가 비었다(질문만 남은 FAQ 등) */
function emptiedByStrip(item: unknown, next: unknown): boolean {
  if (typeof item === 'string') return item !== '' && next === ''
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const after = next as Record<string, unknown>
  return Object.entries(item).some(([k, v]) => typeof v === 'string' && v !== '' && after[k] === '')
}

function valueHasEcho(value: unknown, guard: EchoGuard): boolean {
  if (typeof value === 'string') return hasEcho(value, guard)
  if (Array.isArray(value)) return value.some((v) => valueHasEcho(v, guard))
  if (value && typeof value === 'object') return Object.values(value).some((v) => valueHasEcho(v, guard))
  return false
}

/** 겹침이 있는 카피 최상위 섹션 이름(유사도 게이트와 같은 섹션 단위) */
export function findCopyEchoes(copy: CopywritingResult, guard: EchoGuard): string[] {
  return Object.entries(copy)
    .filter(([, value]) => valueHasEcho(value, guard))
    .map(([section]) => section)
}

/** 재생성 지시 — 섹션 이름만 적는다(겹친 문장을 다시 프롬프트에 넣지 않는다) */
export function buildEchoRewriteDirective(sections: string[]): string {
  return (
    '[경쟁 상품 리뷰 재현 금지 — 재작성 지시] 아래 섹션의 문장이 분석용 경쟁 상품 리뷰 문장과 길게 겹칩니다. ' +
    '이 섹션의 문장을 모두 새 표현으로 다시 쓰세요. 리뷰 문장을 옮기거나 다른 제품과 비교하지 마세요: ' +
    sections.join(', ')
  )
}

const SENTENCE_SPAN_RE = /[^.!?…\n]+(?:[.!?…]+\s*|\n|$)|\n/g

/** 겹친 문장을 지운다. 문장 경계를 넘는 겹침이 남으면 그 글은 통째로 비운다 */
function stripText(text: string, guard: EchoGuard): { text: string; removed: number } {
  if (!hasEcho(text, guard)) return { text, removed: 0 }
  let removed = 0
  const kept = (text.match(SENTENCE_SPAN_RE) ?? [text]).filter((span) => {
    if (!hasEcho(span, guard)) return true
    removed += 1
    return false
  })
  const out = kept.join('').trim()
  if (hasEcho(out, guard)) return { text: '', removed: removed + 1 }
  return { text: out, removed: Math.max(removed, 1) }
}

function stripValue(value: unknown, guard: EchoGuard, counter: { removed: number }): unknown {
  if (typeof value === 'string') {
    const r = stripText(value, guard)
    counter.removed += r.removed
    return r.text
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      const next = stripValue(item, guard, counter)
      // 글 한 줄이 통째로 비거나 항목의 글 칸이 비면(인용 {text}·FAQ {q, a}·카드 설명) 그 항목은 뺀다
      if (!emptiedByStrip(item, next)) out.push(next)
    }
    return out
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripValue(v, guard, counter)]))
  }
  return value
}

/** 남은 겹침 문장을 지운 새 카피와 섹션별 지운 문장 수 — 겹침이 없으면 같은 객체를 돌려준다 */
export function stripCopyEchoes(
  copy: CopywritingResult,
  guard: EchoGuard
): { copy: CopywritingResult; removed: Array<{ section: string; sentences: number }> } {
  const sections = findCopyEchoes(copy, guard)
  if (sections.length === 0) return { copy, removed: [] }
  const next: Record<string, unknown> = { ...copy }
  const removed: Array<{ section: string; sentences: number }> = []
  for (const section of sections) {
    const counter = { removed: 0 }
    next[section] = stripValue(next[section], guard, counter)
    removed.push({ section, sentences: counter.removed })
  }
  return { copy: next as CopywritingResult, removed }
}
