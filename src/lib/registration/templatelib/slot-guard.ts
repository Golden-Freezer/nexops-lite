/**
 * K 칸 글 가드(결정 카드 c03, 하네스 harness-cards J02) — D 카피와 같은 판정으로 K 칸 글을 본다. 순수·결정론(LLM 0).
 * - 연령 제한 잡(만 14세 이상): 어린이 표현(compliance-gate findChildTerms)
 * - 학부모 대리 구매 기록 잡(연령 게이트 꺼짐): 아이가 함께 쓰거나·쓰거나·반응하는 문장(parent-proxy-copy childUseKindOf)
 * - 경쟁사 리뷰·레퍼런스 원문이 있는 잡: 정규화 15자 이상 겹침(competitor-echo hasEcho)
 * 걸린 칸은 고치기 콜에 알리고, 그래도 남으면 글을 지운다(dropsText — 규제 표현과 같은 길). 가드가 없는 잡은 검사하지 않는다.
 */

import { findChildTerms } from '../compliance-gate'
import { childUseKindOf } from '../parent-proxy-copy'
import { hasEcho, type EchoGuard } from '../reviews/competitor-echo'
import type { SlotProblem } from './slot-copy'

export interface SlotTextGuard {
  /** 연령 제한 잡의 최소 연령 — 아니면 null */
  minAge: number | null
  /** 학부모 대리 구매 기록 잡이고 연령 게이트가 꺼졌을 때만 — 게이트 잡은 연령 검사가 어린이 표현 전체를 막는다(D pdp-pipeline과 같다) */
  parentView: boolean
  /** 경쟁사 리뷰 재현 가드 조각 — 원문이 없는 잡은 null */
  echo: EchoGuard | null
}

/** 칸 글 하나의 가드 문제. 겹친 경쟁사 문장은 고치기 프롬프트에 다시 넣지 않는다(D buildEchoRewriteDirective와 같다) */
export function guardProblemsOf(slot: string, value: string, guard: SlotTextGuard): SlotProblem[] {
  const out: SlotProblem[] = []
  const terms = guard.minAge !== null ? findChildTerms(value) : []
  if (terms.length > 0) out.push({ slot, kind: 'age', detail: `${terms.join('·')} — ${value}` })
  const use = guard.parentView ? childUseKindOf(value) : null
  if (use) out.push({ slot, kind: 'child', detail: `${use} — ${value}` })
  if (guard.echo && hasEcho(value, guard.echo)) out.push({ slot, kind: 'reproduce', detail: '경쟁 상품 리뷰 문장과 15자 이상 겹침' })
  return out
}
