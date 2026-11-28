/**
 * K 컷 거리·높이·사람 박자(shotvary, 오너 2026-11-06 ④ — 블라인드 메모 P07 '비슷한 각도에서 비슷한 장면', P08 '똑같은 얼굴 표정').
 * 세션 B 설계(work/pdp-b/variety/DESIGN.md F1~F4). 무대(shot-stage)를 정한 뒤 컷마다 카메라 거리·높이를, 사람이 나올 수 있는 컷에는 몸 범위·
 * 동작 단계·얼굴을 정한다. 지금은 사람 컷이 모두 같은 사용 기본 프롬프트(카테고리 고정 장면·표정·35mm 렌즈)에서 시작하고 Camera 줄에
 * 거리·사람 칸이 없어 같은 장면·같은 미소가 되풀이됐다. 한 세트·한 사람·빛·상품 동일성은 그대로다(헌장·세트·대표 컷 참조·Refs).
 * 순수·결정론(seed = 잡 ID). 프롬프트 문장도 여기 둔다 — shot-brief가 읽는다(이 파일은 shot-brief를 끌어오지 않는다).
 * K6 확인 판 P07(세션 B work/pdp-b/shotvary/P07-REPEAT.md): 웃는 얼굴이 상한 2를 넘어 5장, 마무리 사진이 대표 컷 판박이(지문 거리 3)였다 —
 * 대표 컷 사람을 계획 0번으로 세고(HERO_PERSON), 마무리 사진(cta)은 얼굴 없는 몸 범위만 받는다(CTA_FRAMINGS).
 * 운영 P08(세션 A work/pdp-a/p08-repeat/FINDING.md): 사람 계획 밖 손·사용 구도 컷이 대표 컷 웃는 사람을 다시 그렸고(①), 상품 단독 컷이
 * 원천 사진 자세 그대로였다(②) — 사람 계획을 몸을 부르는 구도까지 넓히고(isBodyCut, 손만 경로는 손만 고정), 상품 단독 컷에 보이는 쪽(turn)을 준다.
 */

import { hasEnrichmentFeature } from '../enrichment-switch'
import { DISTANCE_PHRASE, type ShotDistance } from '../internalized/shot-plan'
import type { HeroKind, PdpJobRow } from '../pdp-state'
import { pick } from '../scene-set'

export type CameraHeight = 'eye_level' | 'standing' | 'table' | 'overhead'
export interface ShotCamera {
  distance: ShotDistance
  height: CameraHeight
}

/** 사람 컷의 몸 범위 — hands는 손·팔뚝만, nobody는 사람 없이 상품(반려 잡은 반려동물과 상품)만 */
export type PersonFraming = 'environment' | 'waist_up' | 'over_shoulder' | 'profile' | 'back' | 'hands' | 'nobody'
/** 동작 단계 — 쓰기 직전·쓰는 순간·쓴 뒤 */
export type PersonBeat = 'before' | 'during' | 'after'
export type PersonFace = 'none' | 'focused' | 'soft_smile' | 'laugh' | 'glance_away'
export interface ShotPerson {
  framing: PersonFraming
  beat: PersonBeat
  face: PersonFace
}

/**
 * 상품이 카메라에 보이는 쪽(사람이 안 나오는 상품 컷만) — side 옆면, top 윗면(눕힘), tilt 기울여 위·안쪽, back 반대쪽, flip 뒤집어 밑면.
 * back은 원천 사진이 2장 이상인 잡만, flip은 밑면 목적 컷만 받는다(원천 사진에 없는 면을 지어내지 않게)
 */
export type ProductTurn = 'side' | 'top' | 'tilt' | 'back' | 'flip'

export interface ShotVariety {
  camera?: ShotCamera
  person?: ShotPerson
  turn?: ProductTurn
}

/** shotvary 기록 잡 — 스위치가 templatelib 없이 기록하지 않지만 이미지 단계는 둘 다 본다 */
export function shotvaryEnabled(job: Pick<PdpJobRow, 'analysis'>): boolean {
  return hasEnrichmentFeature(job.analysis, 'shotvary') && hasEnrichmentFeature(job.analysis, 'templatelib')
}

/**
 * 얼굴이 나올 수 있는 K 컷 — 사용 기본 프롬프트(사람·표정 줄)를 받고 손만 컷으로 바뀌지 않는 컷이다. shot-brief의 shotRouteOf(base 'usage')·
 * isHandsOnly(action·in_hand)와 같은 판정이다(시험이 맞춘다). 고민 컷은 고민 프롬프트의 표정 지시를 그대로 둔다
 */
const PERSON_PURPOSES: ReadonlySet<string> = new Set(['scene', 'state', 'scale'])
export const isPersonCut = (shot: { purpose: string; composition: string }): boolean => PERSON_PURPOSES.has(shot.purpose) && shot.composition !== 'in_hand'
/** 구도가 몸을 부르는 컷 — 손에 든·쓰는·착용 구도는 목적과 상관없이 사람(손)이 나온다(운영 P08: 계획 밖 in_hand·in_use 컷이 대표 컷 사람을 그렸다) */
const BODY_COMPOSITIONS: ReadonlySet<string> = new Set(['in_hand', 'in_use', 'worn'])
/** 사람 계획을 받는 컷 — 얼굴이 나올 수 있는 컷 + 몸을 부르는 구도의 컷. 고민 컷은 고민 프롬프트의 사람·표정 그대로 둔다 */
export const isBodyCut = (shot: { purpose: string; composition: string }): boolean =>
  shot.purpose !== 'problem' && (isPersonCut(shot) || BODY_COMPOSITIONS.has(shot.composition))
/** 손만 경로 — shot-brief isHandsOnly와 같은 판정(목적 action 또는 구도 in_hand). 몸 범위는 손만·얼굴 없음으로 고정한다 */
export const isHandsCut = (shot: { purpose: string; composition: string }): boolean => shot.purpose === 'action' || shot.composition === 'in_hand'

/** 구도가 받는 거리·높이 — 구도 줄이 이미 정한 축(top=바로 위, side=탁자 높이, front=눈높이)은 그 값만 */
const CAMERA_OPTIONS: Readonly<Record<string, { distances: readonly ShotDistance[]; heights: readonly CameraHeight[] }>> = {
  front: { distances: ['medium', 'medium_wide', 'close'], heights: ['eye_level'] },
  angle45: { distances: ['medium', 'close', 'medium_wide'], heights: ['standing', 'eye_level', 'table'] },
  side: { distances: ['medium', 'close'], heights: ['table'] },
  top: { distances: ['medium', 'close'], heights: ['overhead'] },
  flatlay: { distances: ['medium_wide', 'medium'], heights: ['overhead'] },
  closeup: { distances: ['close', 'macro'], heights: ['eye_level', 'standing', 'table'] },
  in_hand: { distances: ['close', 'medium'], heights: ['eye_level', 'standing'] },
  in_use: { distances: ['wide', 'medium_wide', 'medium'], heights: ['eye_level', 'standing', 'table'] },
  worn: { distances: ['medium', 'medium_wide', 'close'], heights: ['eye_level', 'table'] },
  group: { distances: ['medium_wide', 'medium'], heights: ['standing', 'eye_level', 'overhead'] },
}
const DEFAULT_CAMERA = { distances: ['medium', 'close'] as const, heights: ['eye_level', 'standing'] as const }
/** 배경이 사라지는 근접 무대 — 거리는 근접·매크로만 */
const MACRO_DISTANCES: readonly ShotDistance[] = ['close', 'macro']

/** 몸 범위가 부르는 거리 — 구도가 받는 거리와 겹치는 값을 먼저 쓴다 */
const FRAMING_DISTANCES: Readonly<Record<PersonFraming, readonly ShotDistance[]>> = {
  environment: ['wide', 'medium_wide'],
  waist_up: ['medium', 'medium_wide'],
  over_shoulder: ['medium', 'close'],
  profile: ['medium', 'medium_wide'],
  back: ['medium_wide', 'wide'],
  hands: ['close', 'medium'],
  nobody: ['medium', 'medium_wide', 'wide'],
}

/**
 * 구도가 받는 몸 범위 — 쓰는 장면·착용 구도는 사람이 보이고, 근접·위에서 본 구도는 손만 또는 사람 없이, 그 밖(정면·비스듬히·옆·여러 개)은
 * 둘을 섞는다. 사람을 지우는 것이 목적이 아니다 — 오너 P09 '모델 컷·분위기는 2.6이 낫다'. 얼굴 수는 아래 상한이 묶는다
 */
const FRAMING_OPTIONS: Readonly<Record<string, readonly PersonFraming[]>> = {
  in_use: ['environment', 'waist_up', 'over_shoulder', 'profile', 'back'],
  worn: ['waist_up', 'profile', 'back', 'over_shoulder'],
  closeup: ['hands', 'nobody'],
  top: ['hands', 'nobody'],
  flatlay: ['hands', 'nobody'],
}
const PRODUCT_FRAMINGS: readonly PersonFraming[] = ['waist_up', 'hands', 'profile', 'nobody']
const FACE_FRAMINGS: ReadonlySet<PersonFraming> = new Set(['environment', 'waist_up', 'profile'])
const FACES: readonly PersonFace[] = ['focused', 'soft_smile', 'glance_away', 'laugh']
const SMILES: ReadonlySet<PersonFace> = new Set(['soft_smile', 'laugh'])
const BEATS: readonly PersonBeat[] = ['during', 'before', 'after']

/** 한 쪽 상한(설계 판단, 유료 확인 판에서 다시 본다) — 같은 (거리, 높이) 쌍, 같은 얼굴, 웃는 얼굴(옅은 미소+웃음) */
export const SAME_CAMERA_MAX = 2
export const SAME_FACE_MAX = 2
export const SMILE_MAX = 2
/** 얼굴이 보이는 사람 컷 상한 — 사람 컷의 절반(적어도 한 장) */
export const visibleFaceMax = (personCuts: number): number => Math.max(1, Math.floor(personCuts / 2))

const rotate = <T,>(list: readonly T[], seed: string, salt: string): T[] => {
  if (list.length === 0) return []
  const start = list.indexOf(pick(list, seed, salt))
  return [...list.slice(start), ...list.slice(0, start)]
}

/** 앞에서부터 순위가 가장 낮은 값 — 순위가 같으면 앞의 값(결정론) */
function lowest<T>(candidates: readonly T[], rank: (value: T) => number[]): T {
  let best = candidates[0]
  let bestRank = rank(best)
  for (const value of candidates.slice(1)) {
    const score = rank(value)
    const diff = score.findIndex((v, i) => v !== bestRank[i])
    if (diff >= 0 && score[diff] < bestRank[diff]) {
      best = value
      bestRank = score
    }
  }
  return best
}

/**
 * 대표 컷이 그리는 사람 — 대표 컷 생활 프롬프트에는 몸 범위·표정 줄이 없고 분위기가 'warm, relatable'이라 쓰는 장면은 장소 안 전신·옅은 미소,
 * 착용은 허리 위·옅은 미소로 나온다(K6 P07 대표 컷). 계획 0번으로 세워 웃는 얼굴·같은 얼굴·얼굴 보이는 컷 상한과 이웃 몸 범위 금지에 넣는다.
 * 대표 컷 프롬프트는 바꾸지 않는다. studio는 사람이 없다
 */
export const HERO_PERSON: Readonly<Partial<Record<HeroKind, ShotPerson>>> = {
  in_use: { framing: 'environment', beat: 'during', face: 'soft_smile' },
  worn: { framing: 'waist_up', beat: 'during', face: 'soft_smile' },
}
/** 마무리 사진(cta 섹션)의 몸 범위 — 사람 대표 컷 잡은 얼굴 없는 몸 범위만 받아 대표 컷 판박이를 막는다(K6 P07 마무리 사진이 대표 컷과 지문 거리 3) */
export const CTA_FRAMINGS: ReadonlySet<PersonFraming> = new Set(['back', 'over_shoulder', 'hands', 'nobody'])

export interface VarietyContext {
  /** 반려 카테고리 — 사람 없는 컷은 반려동물과 상품이다. 사람 컷이 둘 이상이면 한 장 이상 둔다 */
  pet: boolean
  seed: string
  /** 대표 컷 유형(계획 기록의 hero.kind) — 사람 대표 컷이면 HERO_PERSON을 계획 0번으로 센다. 없으면 대표 컷을 세지 않는다 */
  heroKind?: HeroKind
  /** 원천 사진 수 — 2장 이상이면 상품 반대쪽(back)도 보인다. 없으면 1장으로 본다(지어내지 않는 쪽) */
  sourcePhotos?: number
}

/**
 * 사람 컷의 몸 범위·얼굴 — 이웃 같은 몸 범위 금지, 얼굴 상한(같은 얼굴·웃는 얼굴·얼굴 보이는 컷), 반려 잡은 반려만 컷 한 장 이상.
 * 사람 대표 컷은 0번 자리로 상한·이웃 판정에 들어가고(기록에는 안 남는다), 마무리 사진은 얼굴 없는 몸 범위만 받는다
 */
function planPeople(shots: ReadonlyArray<{ purpose: string; composition: string; section?: string }>, ctx: VarietyContext): Map<number, ShotPerson> {
  const people = shots.flatMap((shot, at) => (isBodyCut(shot) ? [{ shot, at }] : []))
  // 손만 컷은 몸 범위가 정해져 있어 얼굴 상한·반려만 바꾸기에서 뺀다
  const free = people.filter(({ shot }) => !isHandsCut(shot))
  const hero = ctx.heroKind ? HERO_PERSON[ctx.heroKind] : undefined
  const faceMax = visibleFaceMax(free.length + (hero ? 1 : 0))
  const out = new Map<number, ShotPerson>()
  const placed: ShotPerson[] = hero ? [hero] : []
  const faces = rotate(FACES, ctx.seed, 'face')
  const beats = rotate(BEATS, ctx.seed, 'beat')
  people.forEach(({ shot, at }, i) => {
    if (isHandsCut(shot)) {
      const hands: ShotPerson = { framing: 'hands', beat: beats[i % beats.length], face: 'none' }
      placed.push(hands)
      out.set(at, hands)
      return
    }
    const base = FRAMING_OPTIONS[shot.composition] ?? PRODUCT_FRAMINGS
    const all = rotate(ctx.pet && !base.includes('nobody') ? [...base, 'nobody' as const] : base, ctx.seed, `framing:${shot.composition}`)
    const closing = hero && shot.section === 'cta' ? all.filter((framing) => CTA_FRAMINGS.has(framing)) : []
    const options = closing.length > 0 ? closing : all
    const prev = placed.at(-1)
    const shown = placed.filter((p) => p.face !== 'none').length
    const faceOf = (framing: PersonFraming): PersonFace | null => {
      if (!FACE_FRAMINGS.has(framing)) return 'none'
      if (shown >= faceMax) return null
      const smiles = placed.filter((p) => SMILES.has(p.face)).length
      const fits = faces.filter((face) => placed.filter((p) => p.face === face).length < SAME_FACE_MAX && (!SMILES.has(face) || smiles < SMILE_MAX))
      return fits.length > 0 ? lowest(fits, (face) => [prev?.face === face ? 1 : 0, placed.filter((p) => p.face === face).length]) : null
    }
    const framing = lowest(options, (value) => [faceOf(value) === null ? 1 : 0, prev?.framing === value ? 1 : 0, placed.filter((p) => p.framing === value).length])
    const person: ShotPerson = { framing, beat: beats[i % beats.length], face: faceOf(framing) ?? 'none' }
    placed.push(person)
    out.set(at, person)
  })
  // 반려 잡 — 사람 컷이 둘 이상인데 반려만 컷이 없으면 마지막 사람 컷 하나를 반려만으로 바꾼다(얼굴 수는 줄기만 한다)
  if (ctx.pet && free.length >= 2 && !placed.some((p) => p.framing === 'nobody')) {
    const last = free.at(-1)!
    out.set(last.at, { ...out.get(last.at)!, framing: 'nobody', face: 'none' })
  }
  return out
}

/**
 * 페이지 컷 → 컷별 카메라·사람 박자. 치수 칸 컷(사이즈 단독)은 비운다. 이웃 컷끼리 같은 (거리, 높이)를 피하고 한 쌍은 한 쪽에 SAME_CAMERA_MAX번까지,
 * 사람 컷은 몸 범위가 부르는 거리를 먼저 쓴다. stage는 shot-stage 값(근접 무대는 근접·매크로만)
 */
export function assignShotVariety(
  shots: ReadonlyArray<{ purpose: string; composition: string; section?: string; sizeCut?: true; stage?: { name: string } }>,
  ctx: VarietyContext
): ShotVariety[] {
  const people = planPeople(shots, ctx)
  const cameras: ShotCamera[] = []
  const turned: ProductTurn[] = []
  const turns = rotate((ctx.sourcePhotos ?? 1) >= 2 ? ALL_TURNS : SAFE_TURNS, ctx.seed, 'turn')
  return shots.map((shot, at) => {
    if (shot.sizeCut) return {}
    const options = CAMERA_OPTIONS[shot.composition] ?? DEFAULT_CAMERA
    const person = people.get(at)
    const wanted = person ? FRAMING_DISTANCES[person.framing] : []
    const fitting = options.distances.filter((d) => shot.stage?.name !== 'macro' || MACRO_DISTANCES.includes(d))
    const distances = rotate(fitting.length > 0 ? fitting : MACRO_DISTANCES, ctx.seed, `distance:${at}`)
    const heights = rotate(options.heights, ctx.seed, `height:${at}`)
    const prev = cameras.at(-1)
    const pairs = distances.flatMap((distance) => heights.map((height) => ({ distance, height })))
    const camera = lowest(pairs, (c) => [
      prev && prev.distance === c.distance && prev.height === c.height ? 1 : 0,
      cameras.filter((x) => x.distance === c.distance && x.height === c.height).length >= SAME_CAMERA_MAX ? 1 : 0,
      wanted.length > 0 && !wanted.includes(c.distance) ? 1 : 0,
      prev?.distance === c.distance ? 1 : 0,
      prev?.height === c.height ? 1 : 0,
    ])
    cameras.push(camera)
    // 사람이 안 나오는 상품 컷(사람 계획 없음·반려만)은 보이는 쪽을 정한다 — 이웃끼리 다르고, 적게 쓴 쪽 먼저. 밑면 목적은 뒤집기 고정
    const productOnly = shot.purpose !== 'problem' && (!person || person.framing === 'nobody')
    const turn = productOnly
      ? shot.purpose === 'underside'
        ? ('flip' as const)
        : lowest(turns, (t) => [turned.at(-1) === t ? 1 : 0, turned.filter((x) => x === t).length])
      : undefined
    if (turn) turned.push(turn)
    return { camera, ...(person ? { person } : {}), ...(turn ? { turn } : {}) }
  })
}

/** 원천 사진에 없는 면을 요구하지 않는 쪽(원천 1장 잡) / 2장 이상이면 반대쪽도 */
const SAFE_TURNS: readonly ProductTurn[] = ['side', 'top', 'tilt']
const ALL_TURNS: readonly ProductTurn[] = [...SAFE_TURNS, 'back']

// ─── 프롬프트 문장(shot-brief가 Camera·Person·Visible 줄에 쓴다, 그리지 않는 참고 글) ───

const HEIGHT_PHRASE: Readonly<Record<CameraHeight, string>> = {
  eye_level: 'camera at eye level',
  standing: 'camera at standing height looking slightly down',
  table: 'camera low at table height',
  overhead: 'camera straight overhead',
}

/** Camera 줄 뒤에 붙는 거리·높이 */
export const cameraPhrase = (camera: ShotCamera): string => `${DISTANCE_PHRASE[camera.distance]}; ${HEIGHT_PHRASE[camera.height]}`

const TURN_PHRASE: Readonly<Record<ProductTurn, string>> = {
  side: 'the product is turned so one of its sides faces the camera',
  top: 'the product is laid down so its top surface faces the camera',
  tilt: 'the product is tilted toward the camera so more of its top or inside shows',
  back: 'the product is turned around so its other side faces the camera',
  flip: 'the product is turned over so its underside faces the camera',
}
/** 보이는 쪽만 바꾸고 구조는 첫 장 그대로 — Camera 줄 뒤에 붙는다 */
export const TURN_KEEP = 'its structure, parts and state stay exactly as in the first image — only the side facing the camera changes'
export const turnPhrase = (turn: ProductTurn): string => `${TURN_PHRASE[turn]}; ${TURN_KEEP}`

/** 넓은 컷의 상품 비중 하한(오너 P09 메모 '사용 장면의 제품 일관성' — 멀어져도 상품이 작아지거나 가려지지 않게) */
const WIDE_DISTANCES: ReadonlySet<ShotDistance> = new Set(['wide', 'medium_wide'])
export const WIDE_PRODUCT_FLOOR = 'In this wider view the product still takes at least 25% of the frame — whole, in sharp focus and never covered by hands, people or pets.'
export const isWideCamera = (camera: ShotCamera | undefined): boolean => Boolean(camera && WIDE_DISTANCES.has(camera.distance))

const FRAMING_PHRASE: Readonly<Record<Exclude<PersonFraming, 'hands' | 'nobody'>, string>> = {
  environment: 'seen whole within the place, small enough that the place reads around them',
  waist_up: 'from the waist up, turned three-quarters to the camera',
  over_shoulder: 'from behind one shoulder, the camera looking past them at the product — the face out of frame',
  profile: 'in side profile',
  back: 'seen from behind — the face out of frame',
}
const BEAT_PHRASE: Readonly<Record<PersonBeat, string>> = {
  before: 'the moment just before use, getting it ready',
  during: 'the moment of use',
  after: 'just after use, relaxed',
}
const FACE_PHRASE: Readonly<Record<PersonFace, string>> = {
  none: 'the face does not show',
  focused: 'a calm, focused look at what the hands are doing, no smile',
  soft_smile: 'a slight, natural smile',
  laugh: 'laughing naturally at something just off-frame',
  glance_away: 'a relaxed look away from the product, toward the window or the room, no smile',
}
const SAME_PERSON = 'the same one person as the other cuts of this page — same face, hair and clothing; only the moment changes'

/** Person 줄 — 몸 범위·동작 단계·얼굴. 사람 없는 컷은 반려 잡이면 같은 반려동물과 상품만 */
export function personLine(person: ShotPerson, pet: boolean): string {
  const beat = BEAT_PHRASE[person.beat]
  if (person.framing === 'nobody') {
    const who = pet ? 'only the same pet as the other cuts with the product' : 'the product on its own in its place'
    return `Person: no person in this cut — no face, hands or body anywhere in the frame; ${who}, ${beat}.`
  }
  if (person.framing === 'hands') return `Person: only the hands and forearms of ${SAME_PERSON} — no face or head in the frame; ${beat}.`
  return `Person: ${SAME_PERSON}. In this cut: ${FRAMING_PHRASE[person.framing]}; ${beat}; ${FACE_PHRASE[person.face]}.`
}

/**
 * 사람 컷 기본 프롬프트에서 컷마다 같던 줄을 뺀다(F2) — 카테고리 고정 장면·장소·표정, 35mm 렌즈, '상호작용 순간'. 장소는 Stage 줄, 거리는 Camera 줄,
 * 몸 범위·표정은 Person 줄이 정한다. 뒤에 붙는 블록으로 덮지 않고 지운다(withoutFaceFocus 선례 — 위쪽 고정 줄이 이겼다).
 * 'Human Subject Quality Rules' 묶음(손가락·피부·시선 품질 규칙)은 남긴다
 */
const FIXED_SCENE_LINES = /^- (?:Scene|Environment|Expression|Lens): .*(?:\r?\n|$)/gm
const INTERACTION_LINE = /^- Focus on the interaction moment[^\n]*(?:\r?\n|$)/m
export const withoutFixedScene = (prompt: string): string => prompt.replace(FIXED_SCENE_LINES, '').replace(INTERACTION_LINE, '')

/**
 * 대표 컷 참조 안내 덧붙임(F4) — 대표 컷이 사람 장면이면 모든 컷이 그 사람·자세·구도를 따라 그렸다(P07). 정체성·옷·빛만 받는다.
 * 상품은 '입은 것'에서 뺀다(K7 P09, 세션 A work/pdp-a/p09-strap/FINDING.md) — 'what they wear'가 착용 상품(스트랩)까지 대표 컷에서 받게 해
 * 대표 컷 한 장이 빠뜨린 두 줄 끈 구간이 사람 착용 컷 다수로 퍼졌다. 상품 구조는 첫 장(원본 사진)·식별 카드에서만 받는다
 */
export const VARY_PRODUCT_EXCLUDED =
  "The product is NOT part of what the LAST image fixes, even when the person wears or holds it — take the product's structure, parts and state " +
  'only from the FIRST attached image and the product identity description, never from the product shown in the LAST image.'
export const VARY_REFERENCE_TEXT =
  'For this cut the LAST attached image fixes only who the person is (face and hair) and their clothing, plus the light and color — never copy its pose, ' +
  `expression, camera angle, camera distance or arrangement; follow the Camera and Person lines of the shot direction instead. ${VARY_PRODUCT_EXCLUDED}`

/**
 * 사람이 보이지 않는 vary 컷의 맨 끝 참조 안내(①-b, 운영 P08) — '사람을 정한다'는 글이 Person 줄 없는 컷에서 '이 사람을 그려라'로 읽혀
 * 손·사용 구도 컷이 대표 컷의 웃는 사람을 다시 그렸다. 사람이 보이는 Person 줄이 있는 컷만 VARY_REFERENCE_TEXT를 받는다
 */
export const VARY_LIGHT_TEXT =
  'For this cut the LAST attached image sets only the light and color — do not draw its person, face, pose, camera angle or arrangement; ' +
  'a person appears only as the Person line of the shot direction says, and not at all when there is no Person line.'
/** vary 컷의 첫 장 안내(②-b) — 원천 사진은 구조·부품·상태만 정하고 각도·보이는 쪽은 묶지 않는다(운영 P08 상품 컷이 모두 원천 사진 자세였다) */
export const FIRST_ANGLE_TEXT =
  'For this cut the FIRST attached image fixes the structure, parts and state — not the camera angle or which side faces the camera; follow the Camera line instead.'
/** 사람이 보이는 몸 범위 — 이 컷만 대표 컷에서 사람·옷을 받는다 */
const PERSON_SHOWN: ReadonlySet<PersonFraming> = new Set(['environment', 'waist_up', 'over_shoulder', 'profile', 'back'])
export type VaryRefs = 'person' | 'light'
export const varyRefsOf = (person: ShotPerson | undefined): VaryRefs => (person && PERSON_SHOWN.has(person.framing) ? 'person' : 'light')
/** 참조 안내 덧붙임 — 'person'은 사람·옷·빛, 'light'는 빛·색만. 둘 다 첫 장 각도 풀기를 앞에 둔다 */
export const varyReferenceText = (refs: VaryRefs): string => `${FIRST_ANGLE_TEXT} ${refs === 'person' ? VARY_REFERENCE_TEXT : VARY_LIGHT_TEXT}`
