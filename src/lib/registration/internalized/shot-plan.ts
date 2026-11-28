/**
 * R3 촬영 계획(PDP-DR-PLAN §3) — 잡 스위치 shotplan(기본 off, Track I)이 켜진 잡만 쓴다. 순수·결정론(LLM 없음).
 * - 역할 의도·금지 한 줄(ROLE_INTENT·ROLE_AVOID, 각 120자 이하) — 컷이 무엇을 보여 주고 무엇을 피할지
 * - 페이지 거리·앵글 계획 — 설계 골격의 섹션 순서대로 컷에 거리·앵글을 주고, 같은 거리·같은 앵글이 이어지지 않게 한다
 *   (첫 화면 중간 → 문제 넓게 → 피처 근접·매크로 교대 → 사용 넓게 → 마무리 중간). 컷 지시가 축을 못 박는 컷(pro 차별 컷·크기
 *   컷)은 계획에서 빼고, 블록 첫 줄에 '컷 지시가 정한 앵글·거리가 이긴다'고 적는다(연출 블록 우선 문구와 같은 방향)
 * - 잡 단위 출연(인물·옷 톤·반려동물·소품) — 모든 컷이 같은 값을 받는다. 코덱스가 지시 없는 인물 나이·성별, 옷 색, 반려동물 색,
 *   소파·쿠션 같은 소품을 지어 넣었다(B 코덱스 재작성 조사 #307). 소품은 세트 기술(scene-set)에 적힌 것 + 컷 지시가 부르는 것만
 * D2(designcut2) 잡의 상품 컷(hero·features·cta)은 D2 장면 블록이 거리를 주므로 여기서는 앵글만 준다(거리 지시 중복 방지).
 */

import { SECTION_IMAGE_MAPPING } from '../editor/constants/sectionConfig'
import type { Role16 } from '../corpus-v2'
import type { PdpJobRow, StrategyContract } from '../pdp-state'
import { pick } from '../scene-set'

export const SHOT_PLAN_BLOCK_MAX_CHARS = 600

/** 역할 의도 — 이 컷이 페이지에서 맡는 일 */
export const ROLE_INTENT: Partial<Record<Role16, string>> = {
  product_intro: 'Show the whole product clearly and attractively — the first look a shopper can trust.',
  problem: 'Show the everyday inconvenience this product solves, warm and relatable.',
  usp_feature: 'Prove one feature visibly — the part that makes the claim true is the focus.',
  brand_story: 'Set a calm mood that belongs to the same set and season as the rest of the page.',
  how_to_guide: 'Show one clear step of use with the product and hands.',
  // 사이즈 컷은 손·비교 소품 없이 치수 화살표를 얹는다(개정 5, pdp-image-tasks) — 그 규칙과 같은 방향
  size_spec: 'Show the true size and proportions of the product alone, clean enough for dimension marks.',
  target_recommendation: 'Show who it suits in a believable moment of real use.',
}

/** 역할 금지 — 이 컷에서 하지 말 것 */
export const ROLE_AVOID: Partial<Record<Role16, string>> = {
  product_intro: 'Cropped or hidden product, busy scenes competing with it, invented accessories or extra units.',
  problem: 'Showing the product, exaggerated distress, dirty or unsafe-looking scenes.',
  usp_feature: 'A generic beauty shot that proves nothing; repeating the framing of the cut before.',
  brand_story: 'Unrelated objects, a different room or season, any text or logo.',
  how_to_guide: 'Several steps in one image, unclear hand positions, extra products.',
  size_spec: 'Distorted perspective or wide-angle stretch that misleads the scale.',
  target_recommendation: 'Celebrity look-alikes, exaggerated ad poses or smiles.',
}

/** 상품이 나와야 뜻이 통하는 역할 — 상품 없는 장면 컷(비교 장면 등)에는 이 역할의 의도·금지를 주지 않는다 */
const PRODUCT_ROLES: ReadonlySet<Role16> = new Set<Role16>(['product_intro', 'usp_feature', 'size_spec'])

export type ShotDistance = 'wide' | 'medium_wide' | 'medium' | 'close' | 'macro'
export type ShotAngle = 'eye_level' | 'three_quarter' | 'top_down' | 'side'

export const DISTANCE_PHRASE: Record<ShotDistance, string> = {
  wide: 'wide shot — the room around the subject, the main subject still large and clear',
  medium_wide: 'medium-wide shot — the subject with generous surroundings',
  medium: 'medium shot — the whole product with some surroundings',
  close: 'close-up — the key part fills most of the frame',
  macro: 'macro — a tight detail of material or mechanism',
}

export const ANGLE_PHRASE: Record<ShotAngle, string> = {
  eye_level: 'eye-level straight view',
  three_quarter: '45-degree three-quarter view',
  top_down: 'top-down overhead view',
  side: 'side view',
}

export const SHOT_PLAN_PRIORITY = 'Page defaults — where the cut instructions above fix the angle or distance, follow them.'

/**
 * 태스크(앞부분) → 거리 선호 순서. 앞 컷과 같으면 다음 후보. 컷 지시가 앵글·구도를 못 박는 pro 차별 컷(premium_hero 낮은 앵글,
 * product_exposure 각도 바꾸기, direction_hint 더 넓게, concept_mood 위에서 본 플랫레이)과 크기 컷(정면 눈높이)은 표에 없다 — 계획 밖
 */
const DISTANCE_PREF: Record<string, ShotDistance[]> = {
  hero: ['medium', 'medium_wide'],
  problem: ['wide', 'medium_wide'],
  empathy_scene: ['wide', 'medium_wide'],
  solution: ['medium', 'medium_wide'],
  key_benefit_visual: ['close', 'medium'],
  comparison_scene: ['medium', 'medium_wide'],
  usage: ['wide', 'medium_wide'],
  long_scene: ['wide', 'medium_wide'],
  howto: ['medium', 'close'],
  cta: ['medium', 'medium_wide'],
}

/** 거리 → 어울리는 앵글 순서. 앞 컷과 같으면 다음 후보 */
const ANGLE_PREF: Record<ShotDistance, ShotAngle[]> = {
  wide: ['eye_level', 'three_quarter'],
  medium_wide: ['three_quarter', 'eye_level'],
  medium: ['three_quarter', 'eye_level'],
  close: ['three_quarter', 'top_down'],
  macro: ['top_down', 'side'],
}

/** 섹션 이미지 키(feature_00·howto_00·conversion_cta) → 태스크 앞부분 */
function taskBaseOfImageKey(imageKey: string): string {
  if (/^feature_\d+$/.test(imageKey)) return 'features'
  if (/^howto_\d+$/.test(imageKey)) return 'howto'
  return imageKey === 'conversion_cta' ? 'cta' : imageKey
}

const baseOf = (section: string) => section.split(':')[0]
/** 컷 번호(features:2 → 2). 번호가 아니면(plate:T3c) 0 */
function indexOf(section: string): number {
  const n = Number(section.split(':')[1] ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * 컷을 페이지 순서로 — 설계 골격 섹션 순서에서 그 컷을 쓰는 첫 섹션의 자리, 같은 자리면 컷 번호 순. 페이지에 자리가 없는 컷
 * (여분 풀)은 맨 뒤, 원래 순서 그대로
 */
export function orderByPage(sections: readonly string[], sectionOrder: readonly string[]): string[] {
  const rank = new Map<string, number>()
  sectionOrder.forEach((key, i) => {
    const imageKey = SECTION_IMAGE_MAPPING[key]?.imageKey
    if (!imageKey) return
    const base = taskBaseOfImageKey(imageKey)
    if (!rank.has(base)) rank.set(base, i)
  })
  const at = (section: string) => rank.get(baseOf(section)) ?? Number.MAX_SAFE_INTEGER
  return sections
    .map((section, i) => ({ section, i, at: at(section) }))
    .sort((a, b) =>
      a.at !== b.at
        ? a.at - b.at
        : a.at === Number.MAX_SAFE_INTEGER
          ? a.i - b.i
          : indexOf(a.section) - indexOf(b.section) || a.i - b.i
    )
    .map((x) => x.section)
}

export interface PlannedShot {
  distance: ShotDistance
  angle: ShotAngle
}

/**
 * 페이지 순서의 컷 목록 → 컷별 거리·앵글. 표에 없는 컷(그래픽·아이콘·플레이트·축을 못 박는 컷)은 빼고 잇는다. 피처는 번호로
 * 근접·매크로를 번갈아 시작하고, 앞 컷과 같은 거리·같은 앵글은 다음 후보로 바꾼다
 */
export function planPageShots(ordered: readonly string[]): Map<string, PlannedShot> {
  const plan = new Map<string, PlannedShot>()
  let prev: PlannedShot | null = null
  for (const section of ordered) {
    const base = baseOf(section)
    const prefs: ShotDistance[] | undefined =
      base === 'features' ? (indexOf(section) % 2 === 0 ? ['close', 'macro'] : ['macro', 'close']) : DISTANCE_PREF[base]
    if (!prefs) continue
    const distance = prefs.find((d) => d !== prev?.distance) ?? prefs[0]
    const angles = ANGLE_PREF[distance]
    const angle = angles.find((a) => a !== prev?.angle) ?? angles[0]
    prev = { distance, angle }
    plan.set(section, prev)
  }
  return plan
}

/**
 * 컷 하나의 촬영 계획 블록 — 우선순위 한 줄, 역할 의도·금지(상품 없는 장면 컷은 상품 역할의 의도·금지를 빼고), 거리(D2 상품 컷은
 * 빼고)·앵글. 줄이 하나도 없으면 null. 문구가 고정이라 600자를 넘지 않는다(시험이 묶는다)
 */
export function buildShotPlanBlock(
  role: Role16 | null,
  shot: PlannedShot | undefined,
  options: { omitDistance?: boolean; effectOnly?: boolean } = {}
): string | null {
  const roleLines = role && !(options.effectOnly && PRODUCT_ROLES.has(role))
  const lines = [
    roleLines && ROLE_INTENT[role] ? `Intent: ${ROLE_INTENT[role]}` : '',
    roleLines && ROLE_AVOID[role] ? `Avoid: ${ROLE_AVOID[role]}` : '',
    shot && !options.omitDistance ? `Distance: ${DISTANCE_PHRASE[shot.distance]}.` : '',
    shot ? `Angle: ${ANGLE_PHRASE[shot.angle]}.` : '',
  ].filter(Boolean)
  return lines.length > 0 ? ['[Page shot plan]', SHOT_PLAN_PRIORITY, ...lines].join('\n') : null
}

export interface CastInput {
  category: string
  /** 상품명 + 핵심 특징 — 반려동물 종·상품 성별(남성용·여성용)을 읽는다 */
  productText: string
  /** 타깃 서술(스펙 타깃 페르소나·전략 페르소나·리서치 타깃 통찰) — 성별·나이대를 읽는다 */
  targetText: string
  /** 학부모 대리 구매형 판정 잡 — 어른 손만, 아이는 어디에도 없다(parent-proxy 이미지 블록과 같은 방향) */
  parentProxy: boolean
  seed: string
}

export interface ShotCast {
  people: string
  clothing: string
  pets: string
  props: string
}

const CLOTHING_TONES = ['off-white', 'oatmeal beige', 'light grey', 'soft taupe']
/** 상품 성별 — 상품명이 정하면 타깃 서술보다 앞선다(남성용 상품에 여성 모델이 나오지 않게) */
const PRODUCT_FEMALE = /여성용|여자용|우먼|레이디스|\bwomen'?s\b|\bladies\b/i
const PRODUCT_MALE = /남성용|남자용|맨즈|\bmen'?s\b/i
/** 타깃 서술 성별 — '여자친구·남자친구'(선물 받는 사람)와 '신부전' 같은 낱말에 걸리지 않게 좁게 */
const TARGET_FEMALE = /여성|여자(?!친구)|엄마|주부|아내/
const TARGET_MALE = /남성|남자(?!친구)|아빠|남편/
/** 반려동물 종 — pet 카테고리 잡에서만 읽는다(핫도그·불도그 클립·캣아이 선글라스·강아지 인형에 걸리지 않게) */
const PET_SPECIES: Array<{ pattern: RegExp; species: string; colors: string[] }> = [
  {
    pattern: /강아지|반려견|애견|애완견|댕댕|견용|소형견|중형견|대형견|노견|퍼피|도그|\bdogs?\b|\bpupp(?:y|ies)\b/i,
    species: 'dog',
    colors: ['cream-colored', 'light brown', 'white'],
  },
  {
    pattern: /고양이|반려묘|냥|묘용|캣|\bcats?\b|\bkittens?\b/i,
    species: 'cat',
    colors: ['cream-colored', 'grey tabby', 'white'],
  },
]

function genderOf(input: CastInput): 'woman' | 'man' | null {
  const product = PRODUCT_MALE.test(input.productText) ? 'man' : PRODUCT_FEMALE.test(input.productText) ? 'woman' : null
  if (product) return product
  const female = TARGET_FEMALE.test(input.targetText)
  const male = TARGET_MALE.test(input.targetText)
  return female === male ? null : female ? 'woman' : 'man'
}

/**
 * 인물 — 학부모 대리 구매형은 어른 손만. 그 밖은 한 사람으로 고정한다(문제·사용 장면은 표정·시선을 요구한다): 상품명·타깃
 * 서술의 성별과 나이대, 모르면 30대 여성(국내 생활용품 주 구매층 — 지어내는 값이지만 컷마다 다르게 지어내는 것보다 낫다)
 */
function personOf(input: CastInput): string {
  if (input.parentProxy) return 'adult hands only — no faces, and no children anywhere'
  const who = genderOf(input) ?? 'woman'
  const decade = /([2-6])0대/.exec(input.targetText)?.[1] ?? '3'
  const pronoun = who === 'man' ? 'his' : 'her'
  return `one adult ${who} in ${pronoun} ${decade}0s — the same person in every cut that shows a person (hands-only cuts show ${pronoun} hands)`
}

function petOf(input: CastInput): string {
  if (input.category !== 'pet') return 'no pets or animals'
  const pet = PET_SPECIES.find((p) => p.pattern.test(input.productText))
  if (!pet) return 'only the kind of animal this product is for, one animal that looks the same in every cut'
  const size = pet.species === 'dog' ? (/대형견/.test(input.productText) ? 'large ' : /중형견/.test(input.productText) ? 'medium-sized ' : 'small ') : ''
  return `one ${pick(pet.colors, input.seed, 'pet')} ${size}${pet.species} — the same animal in every cut; no other animals`
}

/** 잡 → 출연 입력. 상품 글은 세트 입력(sceneSetInputOf)과 같은 값 */
export function shotCastInputOf(
  job: Pick<PdpJobRow, 'id' | 'analysis' | 'spec_sheet' | 'research_result'>,
  strategy: Pick<StrategyContract, 'target_persona'>,
  parentProxy: boolean
): CastInput {
  return {
    category: job.analysis.detected_category || job.spec_sheet.category || 'household',
    productText: [job.spec_sheet.productName, ...(job.spec_sheet.keyFeatures ?? [])].filter(Boolean).join(' '),
    targetText: [job.spec_sheet.targetPersona, strategy.target_persona, job.research_result?.target_insights]
      .filter(Boolean)
      .join(' '),
    parentProxy,
    seed: job.id,
  }
}

/** 잡 → 출연. 같은 잡이면 늘 같다(seed = 잡 ID) */
export function buildShotCast(input: CastInput): ShotCast {
  return {
    people: personOf(input),
    // 착용 상품의 색을 덮지 않게 '상품이 아닌 옷'만 정한다
    clothing: `clothing other than the product in plain solid ${pick(CLOTHING_TONES, input.seed, 'clothing')} — no logos, prints or text`,
    pets: petOf(input),
    props:
      'the props named in "Set description" plus only what a cut\'s instructions name — no other furniture, sofas, cushions, ' +
      'rugs or decorations unless they are the product itself',
  }
}

export function describeShotCast(cast: ShotCast): string {
  return `people: ${cast.people}; clothing: ${cast.clothing}; pets: ${cast.pets}; props: ${cast.props}`
}
