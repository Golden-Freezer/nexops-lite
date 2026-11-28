/**
 * 첫 화면 사진 유형(herotype, 오너 지적 2026-11-01) — 후킹 다음 사진을 실사용·착용·스튜디오 중 상품에 맞게 고른다. P09 스트랩·P10 무릎 보호대처럼 쓰는 모습이
 * 효익인 상품이 스튜디오 컷으로 나왔다(10잡 모두 'Premium studio'). 입력(heroImageMode)이 있으면 그 값을 따르고, 없으면 규칙으로 고른다. 추가 콜 없음. 순수.
 *
 * 사람이 나오면 안전 거부가 늘 수 있고 첫 화면 실패는 잡 실패다(#416). 그래서 실패하면 내려간다: 고른 유형 → 손·손목만 → 스튜디오.
 */

import type { HeroKind, PdpSpecSheet } from './pdp-state'

/** 내려가는 단계 — 0 고른 유형, 1 손·손목만, 2 스튜디오 */
export const HERO_STUDIO_LEVEL = 2

/** 몸에 걸치거나 끼우는 상품 낱말 — 카테고리보다 먼저 본다(P09 폰 스트랩은 digital 카테고리다) */
const WORN_RE = /보호대|아대|스트랩|손목밴드|헤어밴드|장갑|양말|모자|벨트|마스크|신발|슬리퍼|티셔츠|바지|자켓|재킷|머플러|목걸이|팔찌|반지|귀걸이|백팩|크로스백/
/** 생김새·인쇄가 효익인 카테고리 — 손이 가리면 오히려 안 보인다 */
const STUDIO_CATEGORIES: ReadonlySet<string> = new Set(['stationery', 'packaging', 'food'])

export interface HeroKindChoice {
  kind: HeroKind
  /** 왜 이 유형인지 — 판독용 기록 */
  reason: string
}

/** 입력값 → 유형. 입력이 없으면 null */
function kindOfInput(mode: PdpSpecSheet['heroImageMode']): HeroKind | null {
  if (mode === 'lifestyle') return 'in_use'
  return mode ? 'studio' : null
}

export function heroKindOf(spec: Pick<PdpSpecSheet, 'heroImageMode' | 'productName'>, category: string, textBearing: boolean): HeroKindChoice {
  const input = kindOfInput(spec.heroImageMode)
  if (input) return { kind: input, reason: `입력 ${spec.heroImageMode}` }
  if (textBearing) return { kind: 'studio', reason: '인쇄물 — 글자·그림이 보여야 한다' }
  const worn = WORN_RE.exec(spec.productName ?? '')
  if (worn) return { kind: 'worn', reason: `착용 상품(${worn[0]})` }
  if (category === 'fashion') return { kind: 'worn', reason: '패션 카테고리' }
  if (STUDIO_CATEGORIES.has(category)) return { kind: 'studio', reason: `${category} 카테고리` }
  return { kind: 'in_use', reason: '쓰는 모습이 효익' }
}

const HEADER = '[First-screen photo type]'
const RULE = 'This block wins over any studio, isolated-product or no-hands wording above. The product stays complete, clearly identifiable and the main subject of the frame.'
const LINES: Readonly<Record<Exclude<HeroKind, 'studio'>, string>> = {
  in_use:
    'Show the product at the moment of real use in the place it is actually used, so the viewer can picture the benefit. An adult hand or body part may appear; the face is not needed and may fall out of frame.',
  worn: 'Show the product worn or attached exactly as intended on an adult, cropped to the body part it sits on, in everyday clothes and a natural everyday setting. The face is not needed and may fall out of frame.',
}
const HANDS_ONLY =
  'Show the product being used by one adult hand only. Nothing of the body beyond the hand and wrist is visible: no face, no torso, no legs, no bare skin other than the hand. Plain everyday setting.'

/** 프롬프트에 붙일 블록 — 스튜디오면 없다(기존 프롬프트 그대로) */
export function heroKindBlock(kind: HeroKind, level: number): string {
  if (kind === 'studio' || level >= HERO_STUDIO_LEVEL) return ''
  return [HEADER, RULE, level >= 1 ? HANDS_ONLY : LINES[kind]].join('\n')
}

/** 실제로 쓴 유형 — 끝까지 내려갔으면 스튜디오다 */
export const heroKindAt = (kind: HeroKind, level: number): HeroKind => (level >= HERO_STUDIO_LEVEL ? 'studio' : kind)
