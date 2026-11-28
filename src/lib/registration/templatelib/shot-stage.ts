/**
 * K 컷 무대(A4 #6, 분석 2차 5절) — 컷마다 어디서 찍는지 정한다. 한 세트만 쓰면 컷 종류가 많아도 같은 사진처럼 보인다(R15 같은 세트 약 80~90%, 눈대중).
 * 계획 단계에서 정해 컷 기록에 글로 남긴다 — 이미지 태스크는 컨셉 표를 읽지 않는다. 표의 값은 설계 판단이고 K1에서 다시 본다. 순수.
 * 쇼룸 바탕은 계열의 첫 갈래 뒤에 바탕 갈래를 페이지 안 쇼룸 순서로 돌리고, 짙은 면(D) 섹션의 쇼룸 컷은 바탕만 어두운·중간 면이다(적용 K6 ② R-P7).
 */

import type { Colors } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { PLACE_RE } from '../internalized/shot-words'
import type { ConceptFamilyId } from './concepts'
import { shotRouteOf } from './shot-brief'

/** showroom 컨셉 바탕 · life 잡의 공용 세트 · place 세트 밖 다른 장소 · macro 배경이 사라지는 근접 */
export type StageName = 'showroom' | 'life' | 'place' | 'macro'

export interface ShotStage {
  name: StageName
  /** 프롬프트에 그대로 붙는 줄 */
  line: string
}

export interface StageContext {
  family: ConceptFamilyId
  colors: Pick<Colors, 'tint' | 'deep' | 'accent'>
  /** 세트 밖 장소 — 비면 장소 이름 없이 지시한다 */
  places: readonly string[]
}

interface Look {
  backdrop: string
  surface: string
  light: string
}

/** 컨셉 계열 8행(A4 5절) — 쇼룸 컷의 바탕·표면·빛 대비. 색은 페이지 색 조합에서 받는다 */
const LOOKS: Readonly<Record<ConceptFamilyId, (colors: StageContext['colors']) => Look>> = {
  trust: () => ({ backdrop: 'a plain light gray or white backdrop', surface: 'a matte board or quartz surface', light: 'even diffused light' }),
  cute: ({ tint }) => ({ backdrop: `a same-tone pastel plane close to ${tint}`, surface: 'soft fabric or paper', light: 'even diffused light' }),
  minimal: () => ({ backdrop: 'a white limewash wall', surface: 'a matte ceramic surface', light: 'a crisp defined shadow' }),
  premium: ({ deep }) => ({ backdrop: `a dark plane close to ${deep}`, surface: 'dark stone or a dark board', light: 'directional light from a low angle' }),
  nature: () => ({ backdrop: 'a paper-grain or linen backdrop', surface: 'wood or stone', light: 'diagonal window light' }),
  active: () => ({ backdrop: 'an outdoor setting softly out of focus', surface: 'concrete or rough stone', light: 'strong daylight' }),
  trendy: ({ accent }) => ({ backdrop: `a strong flat color plane close to ${accent}`, surface: 'a matte colored board', light: 'a crisp defined shadow' }),
  season: ({ tint }) => ({ backdrop: `a seasonal color plane close to ${tint}`, surface: 'a simple seasonal surface', light: 'even diffused light' }),
}

type Variant = (colors: StageContext['colors']) => Partial<Look>
/** 제품 색에서 정하는 바탕 — 이미지 모델이 제품을 바탕 색으로 바꾸지 않게 바탕만이라고 적는다 */
const BACKDROP_ONLY = 'the backdrop only, the product keeps its exact colors'
const SAME_TONE: Variant = () => ({ backdrop: `a plane in the same color family as the product, one shade lighter or darker — ${BACKDROP_ONLY}` })
const CHROMA: Variant = ({ accent }) => ({ backdrop: `a saturated color plane close to ${accent}` })
const OPPOSITE: Variant = () => ({ backdrop: `a flat plane in the color opposite the product's main color — ${BACKDROP_ONLY}` })
const material =
  (texture: string): Variant =>
  () => ({ backdrop: `a ${texture} backdrop`, surface: `a ${texture} surface` })

/**
 * 바탕 갈래(적용 K6 ② R-P7, 최종 보고 L8 같은 톤 면·유채색 면·정반대 색 면·재질 표면) — 계열마다 분위기에 맞는 둘을 첫 갈래(LOOKS) 뒤에 둔다.
 * 바탕(재질은 표면까지)만 바꾸고 빛은 계열 값 그대로다(셋째 갈래만 빛 대비를 바꾼다, 아래). 나무결은 쓰지 않는다(식물·오크 쏠림 — K 세트도 뺐다, scene-set LINE_SURFACES)
 */
const VARIANTS: Readonly<Record<ConceptFamilyId, readonly Variant[]>> = {
  trust: [SAME_TONE, material('fine-grain matte stone')],
  cute: [SAME_TONE, CHROMA],
  minimal: [material('raw plaster'), SAME_TONE],
  premium: [material('fine-grain dark stone'), SAME_TONE],
  nature: [material('rough natural stone'), SAME_TONE],
  active: [CHROMA, OPPOSITE],
  trendy: [OPPOSITE, SAME_TONE],
  season: [CHROMA, material('linen-textured')],
}

/**
 * 셋째 쇼룸 갈래의 빛 대비(적용 K6 ③-b (b), 최종 보고 L8 창빛·강한 그림자) — 페이지 쇼룸 컷이 모두 같은 빛으로 보이지 않게 셋째 갈래만 대비를 바꾼다.
 * 고른 확산광 계열(trust·cute·season)은 사선 창빛, 그 밖은 또렷한 그림자다(이미 또렷한 그림자인 계열은 그대로). 광원·방향·색온도는 헌장이 정하고
 * Stage 줄 끝 KEEP_LIGHT가 그것을 지키게 한다 — 이 값은 대비만 바꾼다
 */
const DIFFUSED_LIGHT = 'even diffused light'
const contrastLight = (light: string) => (light === DIFFUSED_LIGHT ? 'diagonal window light' : 'a crisp defined shadow')
const CONTRAST_LOOK = 2

/** 계열의 쇼룸 갈래 — 첫 갈래는 A4 5절 표 그대로이고, 페이지 안 쇼룸 컷이 이 순서로 돈다 */
export function showroomLooks(family: ConceptFamilyId, colors: StageContext['colors']): Look[] {
  const base = LOOKS[family](colors)
  const looks = [base, ...VARIANTS[family].map((variant) => ({ ...base, ...variant(colors) }))]
  return looks.map((look, at) => (at === CONTRAST_LOOK ? { ...look, light: contrastLight(base.light) } : look))
}

/** 짙은 면(D) 섹션의 쇼룸 컷 바탕 — 밝은 스튜디오 컷은 짙은 면 위에서 가장자리가 액자처럼 뜬다(A 11-03 06:4x, #626 D 회차). 바탕만 바꾼다 */
const darkBackdrop = ({ deep }: StageContext['colors']) => `a dark or mid-tone plane close to ${deep}`

/** 헌장의 바탕·세트 줄과 참조 안내의 '배경 톤을 맞추라'를 함께 덮는다 — 이 줄은 그 뒤에 붙는다 */
const REPLACES = 'This replaces the Background and Set description lines above and anything the reference roles say about the background.'
const KEEP_LIGHT = "Keep the page's light direction and color temperature."

const HANDLED: ReadonlySet<string> = new Set(['in_hand', 'in_use', 'worn'])
const PLACE_PURPOSES: ReadonlySet<string> = new Set(['scene', 'problem'])
const LIFE_PURPOSES: ReadonlySet<string> = new Set(['action', 'state', 'scale'])

/** 컷 하나의 무대 — 목적이 먼저고, 목적이 정하지 않으면 구도로 정한다 */
export function stageNameOf(shot: { purpose: string; composition: string }): StageName {
  if (PLACE_PURPOSES.has(shot.purpose)) return 'place'
  if (LIFE_PURPOSES.has(shot.purpose)) return 'life'
  if (shot.purpose === 'texture') return 'macro'
  if (HANDLED.has(shot.composition)) return 'life'
  return shot.composition === 'closeup' ? 'macro' : 'showroom'
}

/** 페이지 값(A4 5절 완료 기준, 설계 판단) — 쇼룸 컷 최소 수와 한 무대 비율 상한 */
export const SHOWROOM_MIN = 5
export const STAGE_SHARE_MAX = 0.45

/** 페이지의 무대 — 쇼룸이 모자라거나 생활·근접이 넘치면 많은 쪽의 컷을 앞에서부터 쇼룸으로 옮긴다. 손·몸 컷과 근접 구도, 다른 장소 컷은 옮기지 않는다 */
export function pageStageNames(shots: ReadonlyArray<{ purpose: string; composition: string }>): StageName[] {
  const names = shots.map(stageNameOf)
  const count = (name: StageName) => names.filter((value) => value === name).length
  const movable = (at: number, from: StageName) => names[at] === from && !HANDLED.has(shots[at].composition) && shots[at].composition !== 'closeup'
  const needsMove = () => count('showroom') < SHOWROOM_MIN || Math.max(count('life'), count('macro')) > names.length * STAGE_SHARE_MAX
  while (needsMove()) {
    const [first, second]: StageName[] = count('life') >= count('macro') ? ['life', 'macro'] : ['macro', 'life']
    let at = names.findIndex((_, index) => movable(index, first))
    if (at < 0) at = names.findIndex((_, index) => movable(index, second))
    if (at < 0) break
    names[at] = 'showroom'
  }
  return names
}

/**
 * 다른 장소 컷의 제품(적용 K6 R-K18, 통합 11-03 15:1x) — 장소가 바뀌어도 제품은 첫 참조(구조 정본) 그대로다. K1 P07 다른 장소 컷 재생성 2건이 모두 상품 불일치였다.
 * 상품이 나오는 컷에만 붙인다 — 컷 지시가 상품 참조(Refs 줄)를 붙이는 조건과 같다(shotRouteOf effectOnly). 고민 장면은 상품 없이 그린다
 */
const SAME_PRODUCT = 'The product itself stays exactly as in the first reference image — same shape, colors, parts and printing; only the place around it changes.'

function placeLine(place: string | undefined, withProduct: boolean): string {
  const where = place ? `a real place that fits "${place}" — if the product is not used there, another real place where it is` : 'a real place where the product is used'
  return `Stage: ${where}, not the shared set — its floor, wall and props do not apply. ${withProduct ? `${SAME_PRODUCT} ` : ''}${REPLACES} ${KEEP_LIGHT}`
}

/**
 * 컷들의 무대 — 글이 장소를 말하면 그 장소이고, 아니면 다른 장소를 컷 순서대로 돌려 쓴다. 쇼룸 컷은 계열 갈래를 순서대로 돌리고, 컷이 짙은 면(bg 'D')
 * 섹션에 있으면 바탕만 어두운·중간 면이다. 같은 입력이면 늘 같은 값이다
 */
export function assignStages(shots: ReadonlyArray<{ purpose: string; composition: string; show?: string; bg?: string }>, context: StageContext): ShotStage[] {
  const looks = showroomLooks(context.family, context.colors)
  const names = pageStageNames(shots)
  let placed = 0
  let shown = 0
  return names.map((name, at) => {
    if (name === 'place') {
      const said = PLACE_RE.exec(shots[at].show ?? '')?.[0]
      const place = said ?? (context.places.length > 0 ? context.places[placed++ % context.places.length] : undefined)
      return { name, line: placeLine(place, !shotRouteOf(shots[at].purpose).effectOnly) }
    }
    if (name === 'life') return { name, line: 'Stage: the shared set in "Set description", with at most two small props.' }
    if (name === 'macro') return { name, line: `Stage: the background falls away to a soft blur, no props, light grazing across the surface. ${REPLACES} ${KEEP_LIGHT}` }
    const look = looks[shown++ % looks.length]
    const backdrop = shots[at].bg === 'D' ? darkBackdrop(context.colors) : look.backdrop
    return { name, line: `Stage: ${backdrop}, ${look.surface}, ${look.light}. No props, or one plain riser. ${REPLACES} ${KEEP_LIGHT}` }
  })
}
