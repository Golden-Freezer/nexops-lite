/**
 * 세트 기술(R2 촬영 일관성, PDP-DR-PLAN §3) — 잡 하나의 모든 장면 컷이 같은 세트(바닥·벽 재질, 창 방향, 계절감, 소품 2~3) 안에서
 * 찍히게 한다. 순수·결정론(LLM 없음)이라 같은 잡이면 늘 같은 세트다(seed = 잡 ID).
 * D2 아트 디렉션(C1)과 같은 생성기를 쓴다(A·B 합의 2026-10-31): R2(scene 스위치)는 describeSceneSet으로 스타일 헌장 setDesc를 채우고,
 * D2는 section_plan.designcut.artDirection.set으로 쓴다. 표 내용은 먼저 만든 쪽(B)이 정했고 A가 검토했다(소품이 상품·구성품으로
 * 읽히지 않게 상품명과 같은 종류 소품 빼기, 포장 카테고리 중립 소품, 밝은 뉴트럴 벽·받침면만).
 * 적용 D4 ⓒ부터 D2 세트의 바닥·소품은 K 세트 어휘(아래 LINE_SURFACES 표, buildD2SceneSet)다. R2·끈 잡은 위 표 그대로다.
 */

import { CONTEXTS, DEFAULT_CONTEXTS } from '@/lib/agents/registration/prompts/pdp-plate-prompts'
import { parseColor } from './editor/utils/mobileReadability'
import { rgbToLch } from './internalized/designcut-palette'
import type { DesignPalette, PdpJobRow } from './pdp-state'

export interface SceneSetInput {
  category: string
  palette: Partial<Pick<DesignPalette, 'bgMain' | 'primary' | 'secondary'>>
  /** 스타일 헌장 광원 — 창 방향을 같게 둔다 */
  light: { direction: string }
  /** 상품명 + 핵심 특징 — 상품과 같은 종류 소품을 빼는 데만 쓴다 */
  productText: string
  seed: string
}

export interface SceneSet {
  floor: string
  wall: string
  window: string
  season: string
  props: string[]
}

/** 소품 하나 — kinds는 상품명에 나오면 그 소품을 빼는 한글 종류 낱말(상품·구성품으로 오인되지 않게) */
interface Prop {
  en: string
  kinds: string[]
}
const prop = (en: string, ...kinds: string[]): Prop => ({ en, kinds })

/** 바닥(받침면) 재질 — 카테고리 장소(CONTEXTS) 앞에 붙는다. 밝은 뉴트럴만(페이지 흰 기본과 이어지게) */
const SURFACES: Record<string, string[]> = {
  household: ['light oak', 'white quartz', 'pale ash wood'],
  food: ['pale maple', 'light oak', 'white marble'],
  beauty: ['white marble', 'travertine stone', 'matte white ceramic'],
  stationery: ['light birch', 'pale oak', 'white matte laminate'],
  digital: ['matte white laminate', 'light oak', 'pale concrete'],
  fashion: ['pale oak', 'white lacquered wood', 'natural linen-covered'],
  pet: ['light oak', 'whitewashed wood', 'pale beige stone'],
  packaging: ['light oak', 'pale birch', 'white linen-covered'],
}
const DEFAULT_SURFACES = ['light oak', 'white quartz', 'pale ash wood']
const WALLS = ['warm white plaster wall', 'soft greige painted wall', 'off-white limewash wall', 'pale beige matte wall']

/** 소품 — 작고 뒤로 물러나 있는 것. 상품과 같은 종류면 빠진다(아래 kinds) */
const PROPS: Record<string, Prop[]> = {
  household: [prop('a folded linen towel', '타월', '수건'), prop('a small potted green plant', '화분', '식물'), prop('a ceramic tray', '트레이', '쟁반'), prop('a clear glass jar', '병', '용기', '보관')],
  food: [prop('a linen napkin', '냅킨'), prop('a wooden cutting board', '도마'), prop('a small bunch of fresh herbs', '허브'), prop('a ceramic plate', '접시')],
  beauty: [prop('a folded white towel', '타월', '수건'), prop('a small ceramic dish', '접시', '트레이'), prop('a eucalyptus sprig', '유칼립투스'), prop('a round hand mirror', '거울')],
  stationery: [prop('a closed notebook', '노트', '수첩'), prop('a ceramic pen cup', '펜꽂이', '연필꽂이', '컵'), prop('a small potted succulent', '화분', '다육'), prop('a short stack of paper', '종이', '메모지')],
  digital: [prop('a closed notebook', '노트', '수첩'), prop('a ceramic mug', '머그', '컵'), prop('a small potted succulent', '화분', '다육'), prop('a small wooden tray', '트레이', '쟁반')],
  fashion: [prop('a folded knit sweater', '니트', '스웨터'), prop('a woven basket', '바구니'), prop('a small vase of dried flowers', '화병', '꽃병'), prop('a wooden hanger', '옷걸이')],
  pet: [prop('a soft folded blanket', '담요'), prop('a woven basket', '바구니'), prop('a small potted plant', '화분', '식물'), prop('a rope toy', '장난감')],
  // 포장 상품 옆의 리본·포장지는 '함께 오는 구성'으로 읽힌다 — 포장과 무관한 중립 소품만
  packaging: [prop('a small potted plant', '화분', '식물'), prop('a stoneware plate', '접시'), prop('a closed hardcover book', '책', '노트'), prop('a woven basket', '바구니')],
}
const DEFAULT_PROPS = [prop('a small potted plant', '화분', '식물'), prop('a ceramic tray', '트레이', '쟁반'), prop('a folded linen cloth', '천', '린넨'), prop('a woven basket', '바구니')]

/**
 * K 세트 어휘(A4 5절) — 끈 잡·R은 위 표를 그대로 쓴다. D2도 적용 D4 ⓒ부터 이 표다(buildD2SceneSet). 위 표는 바닥 8키 중 7키에 오크, 소품 8키 모두에 식물 계열이라 상품이 달라도 페이지 인상이 비슷했다.
 * 값은 위 표에서 오크·식물을 뺀 것에 조사 문서가 적은 재질·소품만 더했다(종이결·소쿠리, A4 5절). 벽은 그대로다 — 생활 무대는 '지금의 세트, 바닥 재질을 넓힘'이다.
 */
const LINE_SURFACES: Record<string, string[]> = {
  household: ['white quartz', 'pale ash wood', 'matte white laminate', 'pale beige stone'],
  food: ['pale maple', 'white marble', 'paper-grain-covered', 'natural linen-covered'],
  beauty: ['white marble', 'travertine stone', 'matte white ceramic'],
  stationery: ['light birch', 'white matte laminate', 'paper-grain-covered'],
  digital: ['matte white laminate', 'pale concrete', 'white quartz'],
  fashion: ['white lacquered wood', 'natural linen-covered', 'pale beige stone'],
  pet: ['whitewashed wood', 'pale beige stone', 'pale ash wood'],
  packaging: ['pale birch', 'white linen-covered', 'white quartz'],
}
const DEFAULT_LINE_SURFACES = ['white quartz', 'pale ash wood', 'matte white laminate']
const PLANT_PROP = /plant|succulent|herb|eucalyptus|flower/i
const withoutPlants = (list: readonly Prop[]) => list.filter((p) => !PLANT_PROP.test(p.en))
/** 위 표에 없는 K 소품 — 식품 소쿠리(A4 5절 판매 페이지 관찰) */
const LINE_PROPS_EXTRA: Record<string, Prop[]> = { food: [prop('a woven bamboo basket', '소쿠리', '바구니')] }
/** 세트 소품 상한 — A4 5절 '컷마다 2개 이하'. 소품은 사진마다 눈에 들어와 위 표의 2~3개보다 줄인다 */
const LINE_PROP_MAX = 2
/** 입력에 이름이 적힌 부속 — 제품에서 나온 것이 먼저다(A4 5절). 참조 사진과 다르게 그리지 않게 묶는다 */
const partProp = (name: string) => `the ${name} that comes with this product, exactly as in the reference photos`

export const SCENE_SEASON = 'season-neutral — no holiday or seasonal decorations'
/** 벽에 바탕색 톤을 붙이는 조건 — 밝은 뉴트럴만(PDP-DR-PLAN C3: L* ≥ 94, C* ≤ 6). 짙은 브랜드색이면 벽이 색 면이 된다 */
const LIGHT_NEUTRAL = { minL: 94, maxC: 6 }

/** FNV-1a 32비트 — 같은 seed면 같은 값(세트 고르기 전용) */
function hash(seed: string, salt: string): number {
  let h = 0x811c9dc5
  for (const ch of `${salt}:${seed}`) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
export const pick = <T,>(list: readonly T[], seed: string, salt: string): T => list[hash(seed, salt) % list.length]

/** 헌장 광원 방향 → 창이 있는 쪽(위·왼쪽 같은 낱말에서 좌우를 읽는다. 못 읽으면 왼쪽 — 기본 광원 top-left와 같다) */
export function windowSideOf(direction: string): string {
  const d = direction.toLowerCase()
  if (d.includes('right')) return 'right'
  if (d.includes('left')) return 'left'
  if (d.includes('back')) return 'back'
  if (d.includes('front')) return 'front'
  return 'left'
}

/** 밝은 뉴트럴 바탕색인가(L* ≥ 94, C* ≤ 6) — 못 읽는 색은 아니다 */
export function isLightNeutral(hex: string | undefined): boolean {
  const rgb = hex ? parseColor(hex) : null
  if (!rgb) return false
  const { l, c } = rgbToLch(rgb)
  return l >= LIGHT_NEUTRAL.minL && c <= LIGHT_NEUTRAL.maxC
}

/** 상품과 같은 종류 소품을 뺀 후보 — 2개가 안 되면 기본 중립 소품(역시 걸러서)으로 채운다 */
function propPool(props: readonly Prop[], fallback: readonly Prop[], productText: string): Prop[] {
  const clean = (list: readonly Prop[]) => list.filter((p) => !p.kinds.some((k) => productText.includes(k)))
  const pool = clean(props)
  for (const extra of clean(fallback)) {
    if (pool.length >= 2) break
    if (!pool.some((p) => p.en === extra.en)) pool.push(extra)
  }
  return pool
}

/** 잡 → 세트 입력. 광원 방향은 pdp-image-tasks styleLightingOf와 같은 값(lighting_params.direction, 없으면 top-left) */
export function sceneSetInputOf(job: Pick<PdpJobRow, 'id' | 'analysis' | 'spec_sheet' | 'copy_sections' | 'design_prompts'>): SceneSetInput {
  const lighting = (job.design_prompts?.lighting_params ?? {}) as Record<string, unknown>
  return {
    category: job.analysis.detected_category || job.spec_sheet.category || 'household',
    palette: job.copy_sections.final?.designPalette ?? {},
    light: { direction: typeof lighting.direction === 'string' ? lighting.direction : 'top-left' },
    productText: [job.spec_sheet.productName, ...(job.spec_sheet.keyFeatures ?? [])].filter(Boolean).join(' '),
    seed: job.id,
  }
}

const placeOf = ({ category, seed }: Pick<SceneSetInput, 'category' | 'seed'>) => pick(CONTEXTS[category] ?? DEFAULT_CONTEXTS, seed, 'place')

export function buildSceneSet(input: SceneSetInput): SceneSet {
  const { category, seed } = input
  const place = placeOf(input)
  const surface = pick(SURFACES[category] ?? DEFAULT_SURFACES, seed, 'surface')
  const wallBase = pick(WALLS, seed, 'wall')
  const bg = input.palette.bgMain?.trim()
  const pool = propPool(PROPS[category] ?? DEFAULT_PROPS, DEFAULT_PROPS, input.productText)
  const start = pool.length ? hash(seed, 'props') % pool.length : 0
  const count = Math.min(pool.length, 2 + (hash(seed, 'count') % 2))
  return {
    floor: `${surface} ${place}`,
    wall: bg && isLightNeutral(bg) ? `${wallBase} (tone close to ${bg})` : wallBase,
    window: `soft window light from the ${windowSideOf(input.light.direction)} — the same side as the key light`,
    season: SCENE_SEASON,
    props: Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length].en),
  }
}

/**
 * K 잡의 세트 — 기준 세트에서 바닥 재질과 소품만 K 어휘로 바꾼다. 장소·벽·창·계절은 그대로다(세트 밖 장소를 고르는 무대가 이 장소를 뺀다).
 * parts는 입력에 이름이 적힌 부속이다. 없으면 표에서 고른다.
 */
export function buildLineSceneSet(base: SceneSet, input: SceneSetInput, parts: readonly string[] = []): SceneSet {
  const { category, seed } = input
  const surface = pick(LINE_SURFACES[category] ?? DEFAULT_LINE_SURFACES, seed, 'surface')
  const pool = propPool(
    [...withoutPlants(PROPS[category] ?? DEFAULT_PROPS), ...(LINE_PROPS_EXTRA[category] ?? [])],
    withoutPlants(DEFAULT_PROPS),
    input.productText
  )
  const own = parts.slice(0, LINE_PROP_MAX).map(partProp)
  const start = pool.length ? hash(seed, 'props') % pool.length : 0
  const rest = Array.from({ length: Math.min(pool.length, LINE_PROP_MAX - own.length) }, (_, i) => pool[(start + i) % pool.length].en)
  return { ...base, floor: `${surface} ${placeOf(input)}`, props: [...own, ...rest] }
}

/**
 * D2 잡의 세트(적용 D4 ⓒ, R-P7 일부) — K와 같은 어휘 표(오크·식물 뺀 바닥, 식물 뺀 소품 2개 상한)로 한 표를 쓴다.
 * 장소·벽(벽 톤 입력은 컷 바탕색)·창·계절은 기준 세트 그대로다. 입력 부속 소품은 K만 넣는다(D는 표에서 고른다).
 * D는 페이지 한 세트라 유채·짙은·정반대 색 면은 컷 세트가 아니라 섹션 바탕(팔레트) 몫이다
 */
export function buildD2SceneSet(input: SceneSetInput): SceneSet {
  return buildLineSceneSet(buildSceneSet(input), input)
}

/** 스타일 헌장 setDesc 한 줄 */
export function describeSceneSet(set: SceneSet): string {
  return (
    `one continuous set shared by every scene cut of this page — ${set.floor} against a ${set.wall}; ${set.window}; ${set.season}; ` +
    `small props kept secondary (never covering or resembling the product): ${set.props.join(', ')}`
  )
}
