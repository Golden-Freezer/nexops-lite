/**
 * 컨셉 모서리(적용 T1-28, 연구 A3 #9 'shape 연결') — `concept.shape`를 K 엔진의 모서리 값으로 바꾼다.
 * 값은 연구 원문 그대로다: square 카드 8·사진 0, soft 카드 24·사진 12·캡슐 32, round 카드 36·사진 24·캡슐 999, mix는 soft.
 * 원문에 값이 없는 칸(square 캡슐, 모든 말풍선·칩)은 넣지 않는다 — 조립(compose)이 지금 값(아트 디렉션·모티프 모서리)을 그대로 쓴다.
 * square는 카드 8이라 엔진 isSharp(카드 8 이하)가 사진을 직각 틀로 그린다 — 사진 0과 같다.
 */

import type { DesigncutPlan } from '../pdp-state'
import type { Concept } from './concepts'

export type TemplateRadius = NonNullable<DesigncutPlan['templateRadius']>

const SOFT: TemplateRadius = { card: 24, photo: 12, capsule: 32 }

export const CONCEPT_RADIUS: Readonly<Record<Concept['shape'], TemplateRadius>> = {
  square: { card: 8, photo: 0 },
  soft: SOFT,
  round: { card: 36, photo: 24, capsule: 999 },
  mix: SOFT,
}

export const shapeRadius = (shape: Concept['shape']): TemplateRadius => ({ ...CONCEPT_RADIUS[shape] })
