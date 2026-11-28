/**
 * 템플릿 조합 라인(K) 컨셉 44개(계획 PDP-KLINE-PLAN §4, docs/plans/pdp-enrichment/K-CONCEPTS.md). 정본은 concepts.json이다.
 * 이름은 내부 분류용이라 카피에 쓰지 않는다. 축은 Kobayashi 3축(warm·soft·clear, -2~2)과 Aaker 5차원(1~5)이다.
 * 색은 color-sets.ts가 이 값에서 만들고, 글꼴은 font-pairs.ts의 짝 이름으로 가리킨다. 순수·결정론.
 */

import type { EmphasisStyle } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import raw from './concepts.json'
import type { FontPairId } from './font-pairs'

export const CONCEPT_FAMILY_IDS = ['trust', 'cute', 'minimal', 'premium', 'nature', 'active', 'trendy', 'season'] as const
export type ConceptFamilyId = (typeof CONCEPT_FAMILY_IDS)[number]

export interface LchValue {
  l: number
  c: number
  h: number
}

export interface ConceptAccent extends LchValue {
  id: string
}

export interface Concept {
  id: string
  name: string
  family: ConceptFamilyId
  /** 가이드라인 모델에 보여 줄 분위기 낱말 */
  mood: string[]
  axes: { warm: number; soft: number; clear: number }
  aaker: { sincerity: number; excitement: number; competence: number; sophistication: number; ruggedness: number }
  /** 잘 맞는 카테고리(PDP_CATEGORY_KEYS) */
  categories: string[]
  /** 고르면 안 되는 카테고리 */
  categoryBlock: string[]
  density: 'low' | 'mid' | 'high'
  shape: 'round' | 'soft' | 'square' | 'mix'
  price: 'value' | 'mid' | 'premium'
  /** 기대는 신뢰 장치 */
  trust: 'review' | 'spec' | 'origin' | 'none'
  /** 짙은 면 비중 — light는 쓰지 않는 쪽, dark는 많이 쓰는 쪽(순서 풀이의 바탕 리듬이 본다) */
  rhythm: 'light' | 'mixed' | 'dark'
  /**
   * 제목 강조 방식(적용 K4 T1-18, 연구 A2 #13·6-3) — band는 밝은 면에서 형광 띠, color는 색 글자(색 글자를 못 만드는 색 조합 highlight는 띠).
   * 짙은 면은 둘 다 색 글자다. 놀이·부드러움 쪽이 band, 신뢰·고급 쪽이 color(concepts.test가 지킨다)
   */
  emphasisStyle: EmphasisStyle
  baseHue: number
  /** 바탕 색의 채도 상한 */
  baseChroma: number
  /** 짙은 면 색 — null이면 짙은 면이 없는 컨셉(아동·답례 쪽, PALETTE2 '짙은 전환 면 없음') */
  deep: LchValue | null
  accents: [ConceptAccent, ConceptAccent, ConceptAccent]
  fontPair: FontPairId
  /** 이 카테고리에서만 쓰는 글꼴 짝 — 손맛 컨셉의 식품 손글씨(연구 A6: 식품 손글씨 20~21%). 다른 카테고리 페이지는 그대로다 */
  fontPairByCategory?: Partial<Record<string, FontPairId>>
}

export const CONCEPT_FAMILIES = raw.families as Array<{ id: ConceptFamilyId; name: string }>
export const CONCEPTS = raw.concepts as unknown as Concept[]

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]))

/** 이 카테고리에서 쓰는 컨셉 — 카테고리 글꼴 짝이 있으면 fontPair에 얹는다. 계획·기록·재조립이 모두 concept.fontPair만 읽는다 */
export function conceptForCategory(concept: Concept, categoryKey: string): Concept {
  const fontPair = concept.fontPairByCategory?.[categoryKey]
  return fontPair ? { ...concept, fontPair } : concept
}

export function conceptById(id: string): Concept | undefined {
  return BY_ID.get(id)
}
