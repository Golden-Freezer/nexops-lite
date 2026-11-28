/**
 * K 라인 선택 규칙이 읽는 템플릿 칸 — 정본 형식은 15_TEMPLATE_LINE.md §2와 A의 template-types.ts다. 거기 Template이 이 모양에 그대로 들어온다.
 * 섹션 29종과 근거 잠금은 하네스 H0(scripts/pdp-eval/stage-h0-core.mjs)와 같고, 시험이 둘을 대조한다.
 */

import type { DesigncutBg } from '../pdp-state'

export const K_SECTIONS = [
  'hook_3step',
  'main_cut',
  'problem_raise',
  'point_div',
  'sub_div',
  'review',
  'compare',
  'spec_table',
  'cta',
  'problem_empathy',
  'solution_guide',
  'key_message',
  'sub2_div_page',
  'hidden_page',
  'option_gallery',
  'petit_div',
  'faq',
  'certification',
  'event_offer',
  'perf_metric',
  'product_exposure',
  'direction_suggest',
  'concept_desc',
  'point_list_div',
  'convert_div',
  'how_to',
  'ingredients',
  'notice',
  'motion_band',
] as const
export type KSection = (typeof K_SECTIONS)[number]

/** 실제 자료가 없으면 고를 수 없는 섹션 */
export const EVIDENCE_LOCKED: readonly string[] = ['certification', 'event_offer', 'perf_metric', 'review', 'faq', 'ingredients', 'notice', 'motion_band']

/** 페이지 흐름 순서 — 이야기가 거꾸로 가지 않게 순서 풀이가 이 순서로 섹션을 놓는다 */
export const TEMPLATE_ZONES = ['intro', 'problem', 'value', 'trust', 'decision'] as const
export type TemplateZone = (typeof TEMPLATE_ZONES)[number]

/** 큰 POINT 섹션 */
export const POINT_SECTION = 'point_div'

/** 긴 페이지 기준 — 정본은 template-types.ts다 */
export { PAGE_MIN_HEIGHT, PAGE_PASS_HEIGHT, PAGE_SECTIONS } from './template-types'

export interface MetaTextSlot {
  type: 'text'
  required: boolean
  /** input이면 코드가 입력값을 넣는다 — 카피 예산을 쓰지 않는다 */
  source: 'copy' | 'input'
  facts: number
  /** 글자 수 상한(공백 제외) */
  maxChars?: number
  maxLines?: number
  /** icon이면 값은 아이콘 이름이다. hex면 입력 #RRGGBB(견본 색 칩, 적용 C5 ③) */
  choices?: 'icon' | 'hex'
}
export interface MetaImageSlot {
  type: 'image'
  required: boolean
  purpose: string[]
  /** 구도 — 페이지 안에서 다르게 배정한다 */
  composition: string[]
}
export interface MetaListSlot {
  type: 'list'
  required: boolean
  source?: 'copy' | 'input'
  input?: string
  min: number
  max: number
  fields: Record<string, MetaTextSlot | MetaImageSlot>
}
export type MetaSlot = MetaTextSlot | MetaImageSlot | MetaListSlot

export interface TemplateMeta {
  id: string
  section: string
  /** 사람이 읽는 내부 이름 — 선택 모델에 보여 준다. 카피에 쓰지 않는다 */
  name: string
  /** 놓일 수 있는 바탕 — 순서 풀이가 이 안에서 고른다 */
  surfaces: DesigncutBg[]
  slots: Record<string, MetaSlot>
  /** 모양 서명 — 같은 모양이 이어지는지 볼 때 쓴다 */
  signature: { columns: number; photo: string; align: string; container: string }
  needs: { photos: number; evidence: string[] }
  /** 대표 높이(860 폭, px) — 페이지 높이 합을 낼 때 쓴다 */
  height: number
  /** 머리 구조(point_div, A POINT_HEAD_STYLES) — 페이지 안 큰 POINT는 같은 값이다 */
  headStyle?: string
  /** 같은 모티프 계열을 묶는 값 — 페이지 family와 같으면 가점을 받는다. 공용 템플릿은 비운다 */
  family?: string
  fit: {
    concepts: string[]
    density: 'low' | 'mid' | 'high'
    categoryBlock: string[]
    /** 이 카테고리 상품에만 쓴다. 비면 공용이다 */
    categories?: string[]
    /** 이 제품군(product-family.ts) 상품에만 쓴다. 제품군 값이 없는 상품에는 쓰지 않는다 */
    productFamilies?: string[]
  }
  order: { zone: TemplateZone; notNextTo: string[] }
  /** 노드 — 풀폭 상자 색을 읽을 때만 본다(surface-budget.ts). 형식은 template-types.ts */
  flow?: readonly unknown[]
  check: { avgScore: number | null; usedIn: number }
}

export const signatureOf = (t: Pick<TemplateMeta, 'signature'>): string =>
  [t.signature.columns, t.signature.photo, t.signature.align, t.signature.container].join('|')
