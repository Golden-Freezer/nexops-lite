/**
 * K 컷 지시(A4 #7, 분석 2차 10절) — 계획의 컷 하나를 이미지 프롬프트 블록으로 옮긴다. 생성 직전 장면 블록 뒤에 붙어 거리·구도 지시를 이긴다.
 * 지금 있는 줄: Purpose·Camera·Stage·Refs·Contact·Visible·Show·Size·Frame·Never. Stage는 계획이 정한 무대(shot-stage)이고, Frame은 사진 위 글 칸과 원·아치 틀 칸에만 붙는다.
 * A4 10절 11줄 중 Look(페이지 공통 광원 방향·색 온도·세트·사람)은 스타일 헌장이 모든 K 컷에 이미 붙고(assemblePrompt) 컨셉 쇼룸 바탕은 Stage 줄이라 따로 두지 않는다.
 * Refs는 참조 역할 문구(REFERENCE_ROLES_TEXT)가 첫 장·마지막 장만 말해 가운데 참조 역할을 상품 컷에 적는다(적용 K6 ③ T1-53).
 * 순수 함수이고 템플릿 라이브러리를 읽지 않는다(이미지 태스크가 스위치와 상관없이 이 파일을 읽는다). 글은 그리지 않는 참고 글이다.
 */

import { COPY_ZONE_KEEP_CLEAR } from '../internalized/hero-copy-zone'
import type { ImageOverlay } from './template-types'
import type { ShotStage } from './shot-stage'
import type { ShotQuantity } from './input-values'
import { cameraPhrase, isWideCamera, personLine, turnPhrase, WIDE_PRODUCT_FLOOR, type ProductTurn, type ShotCamera, type ShotPerson } from './shot-variety'

/** 계획이 적어 둔 컷 하나 — 생성 단계와 값 합치기가 같은 키를 쓴다 */
export interface LineShot {
  key: string
  section: string
  purpose: string
  composition: string
  /** 슬롯이 받는 첫 비율 — 크기 인자로 보낸다(문장으로 쓰지 않는다) */
  aspect: string
  /** 이 칸의 글 — 없으면 빈 글 */
  show: string
  /** 어디서 찍는가(shot-stage) — 계획이 정해 글로 남긴다 */
  stage?: ShotStage
  /** 사진 위 글이 얹히는 쪽 — 사진 위 글 칸만 있고, 그 쪽을 비운다 */
  overlayAnchor?: ImageOverlay['anchor']
  /** 페이지가 사진을 깎는 틀 — 원·아치 칸만 있고, 잘리는 자리를 비운다 */
  clipShape?: 'circle' | 'arch'
  /** 치수 칸 사진(적용 K14) — 제품 경계에 치수선을 긋는 칸이라 사이즈 단독 컷으로 만들고 경계를 잰다 */
  sizeCut?: true
  /** 카메라 거리·높이(shotvary 잡만, shot-variety) — Camera 줄 뒤에 붙는다. 없으면 Camera 줄이 지금 그대로다 */
  camera?: ShotCamera
  /** 사람 컷의 몸 범위·동작 단계·얼굴(shotvary 잡만) — Person 줄이 된다 */
  person?: ShotPerson
  /** 사람이 안 나오는 상품 컷의 보이는 쪽(shotvary 잡만) — Camera 줄 끝에 붙는다 */
  turn?: ProductTurn
}

/** 어떤 기존 프롬프트 위에 얹고 바탕을 어떻게 할지 — scene은 잡의 공용 세트, solid는 헌장의 단색 바탕이다 */
export interface ShotRoute {
  base: 'feature' | 'usage' | 'problem'
  stage: 'scene' | 'solid'
  /** 상품이 나오지 않는 컷 — 상품 참조를 붙이지 않고 상품 일치 게이트를 보지 않는다 */
  effectOnly: boolean
}

const SOLID_PRODUCT: ShotRoute = { base: 'feature', stage: 'solid', effectOnly: false }
const SCENE_PRODUCT: ShotRoute = { base: 'usage', stage: 'scene', effectOnly: false }

const ROUTES: Readonly<Record<string, ShotRoute>> = {
  problem: { base: 'problem', stage: 'scene', effectOnly: true },
  scene: SCENE_PRODUCT,
  action: SCENE_PRODUCT,
  state: SCENE_PRODUCT,
  scale: SCENE_PRODUCT,
  feature_proof: { base: 'feature', stage: 'scene', effectOnly: false },
  // 시연 컷(J57) — 사람이 상품을 직접 써 보는 장면이라 사용 컷 길
  demo: SCENE_PRODUCT,
}

export const shotRouteOf = (purpose: string): ShotRoute => ROUTES[purpose] ?? SOLID_PRODUCT

/** 헌장의 바탕 줄을 세트로 바꾸는 컷인가 — 다른 장소 컷도 세트 줄 위에서 Stage 줄이 덮는다. 무대 기록이 없으면 목적으로 정한다 */
export const usesSetBackground = (shot: Pick<LineShot, 'purpose' | 'stage'>): boolean =>
  shot.stage ? shot.stage.name === 'life' || shot.stage.name === 'place' : shotRouteOf(shot.purpose).stage === 'scene'

/** 바탕이 세트와 일부러 다른 컷인가 — 게이트가 바탕 차이로 일관성을 깎지 않게 알린다 */
export const isStagedCut = (shot: Pick<LineShot, 'stage'>): boolean => Boolean(shot.stage) && shot.stage?.name !== 'life'

const NO_HAND = 'The product rests on its surface — no hand holds it.'

export const PURPOSE_LINES: Readonly<Record<string, string>> = {
  hero: 'Show the whole product as the one clear subject of this section.',
  feature_proof: 'Show the one feature named below working or clearly visible — the part it names is the focus, and the meaning reads from the picture alone.',
  scene: 'Show the product in use in a real place where it belongs — not a held-up product shot.',
  action: 'Show the feature at the moment of use — one adult hand operating it (no face), the working part clearly visible.',
  state: 'Show the same product in a different state named below (empty or filled, open or closed, folded or unfolded). The structure stays exactly as in the reference.',
  texture: `Macro close-up of the material and surface finish under soft raking light; the texture fills the frame. ${NO_HAND}`,
  underside: `Show what the other cuts of this page hide — the bottom, the inside or the opening — turned toward the camera. ${NO_HAND}`,
  scale: 'Show the true size through contact: in an adult hand, on the body part or in the place it is used. No rulers, arrows or numbers.',
  quantity: 'Lay out what the buyer receives, as in the reference, repeated in neat even rows. For seven or more pieces show a neat stack or bundle — the count does not need to be readable.',
  color: 'Show only the color options seen in the reference photos, in the same light, slightly staggered front to back, not overlapping. Never invent a color.',
  group: 'Show only the components seen in the reference, evenly spaced along a gentle diagonal line with room around each.',
  package: 'Show the product with its packaging exactly as seen in the reference. Never invent packaging.',
  ingredient: 'Show the product with a few small pieces of only the ingredient named below placed around it, never covering the product.',
  problem: 'Show the everyday inconvenience named below — without this product.',
  // 직접 해 보는 시연(J57, demoshot 잡의 compare.demo-try만) — 동작은 아래 칸 글·Use 줄(상품 사실)에서만. 지어낸 성능 증거(숫자·그래프·인증·시험 완료 글)는 그리지 않는다
  demo: "Show one adult directly trying the product the way its facts below say it is used (striking, rubbing, pulling or pressing it), caught at the moment of the try, the product and its working part clearly visible. No numbers, percentages, graphs, certification marks or 'test complete' text.",
}

/**
 * 체감 결과 한 장면(effectshot 잡만, 하네스 J53·통합 decide 32) — 효능 문구가 풀린 뒤(J50) 칸 글이 '매끈·개운·정리됨' 같은 체감 결과를 말하면
 * 기능·사용 컷이 그 결과를 사용 직후 한 장면으로 보여 준다. 숫자·분할 전후는 그리지 않는다(지어낸 성능 증거, 콜라주 금지). 꺼진 잡은 Purpose 줄이 그대로다.
 * K 컷 지시는 MS 맞추기가 덜지 않는 블록이라(상한 5,000자) 한 문장을 짧게 둔다 — J65로 153자 → 86자. MS 2k 컷은 이 문장 때문에 다른 블록이
 * 더 덜리면 문장만 뺀다(effect-shot-fit)
 */
export const EFFECT_SHOT_LINE = 'If text names a felt result, show it just after use; no numbers or split before/after.'

/** 체감 결과 문장을 받는 컷 목적 — 상품이 일하는 장면이 보이는 기능·사용 컷 */
export const EFFECT_SHOT_PURPOSES: ReadonlySet<string> = new Set(['feature_proof', 'action'])

/**
 * 고민 실물 컷(problemobject 잡만, 하네스 J56·통합 decide 35) — 고민 섹션 컷이 사람 표정 대신 불편을 만드는 낡은 일반 물건을 가까이 보여 준다
 * (경쟁 상세 '녹슨 족집게 근접', J52 ②-7). 우리 상품이 아니다(J49) — 이 컷은 참조 사진이 없어 다르게 그리라는 말은 글로만 준다.
 * 실제 브랜드·고통 표정·혐오(곰팡이·오물)는 그리지 않는다. 고민 컷은 MS 맞추기가 덜지 않는 컷 지시라 짧게 둔다. 꺼진 잡은 Purpose 줄이 그대로다
 * J61(J59 확인 판 뒤, 통합 decide 39·41): 켬 잡 P03 고민 컷이 우리 상품과 닮은 브러시에 곰팡이 같은 때를 그렸다. 같은 꼴을 부르던 예시
 * ('flattened bristles, rust')와 때를 허락하는 듯한 '상품 청결 규칙은 적용 안 됨'을 빼고, 같은 쓰임·다른 모양·재질·색·부품 없음, 낡음만·깨끗함
 * (섹션 글이 물때·얼룩을 말해도)을 적는다. 끔 기본 고민 컷보다 MS 덜어 내기가 더 나가지 않게 앞 문장(310자)보다 짧게 둔다
 */
export const PROBLEM_OBJECT_LINE =
  'Show a worn old generic item for the same job, causing the inconvenience below: unlike this product in shape, material and color, none of its parts. Worn (bent, faded, scratched) yet clean: no mold, grime, stains or rust, even if the text says so. No logo; no pained face.'

/** 고민 실물 컷이 되는 섹션 — 고민 섹션만(비교 왼쪽 칸 compare는 고객의 전후 장면이라 그대로) */
export const PROBLEM_OBJECT_SECTIONS: ReadonlySet<string> = new Set(['problem_empathy', 'problem_raise'])

/** 고민 실물 컷인가 — 켜진 잡(호출부가 스위치를 본다)의 고민 섹션 problem 컷만 */
export const isProblemObjectCut = (shot: Pick<LineShot, 'purpose' | 'section'>, enabled: boolean): boolean =>
  enabled && shot.purpose === 'problem' && PROBLEM_OBJECT_SECTIONS.has(shot.section)

/** 반려동물 고민 컷 — 근심하는 보호자·아픈 동물처럼 읽힌다(P07 render-check). 다른 카테고리 고민 컷은 기존 문구 그대로다 */
const PET_PROBLEM =
  'Show it through objects, hands or the place. No worried, sad or distressed face: if a person appears, the face stays out of frame. The pet stays calm and unharmed.'

/** 기존 고민 프롬프트의 얼굴 중심 줄을 뺀다 — 'ABSOLUTE' 규칙이라 뒤에 붙는 지시로 덮이지 않는다 */
export const withoutFaceFocus = (prompt: string): string => prompt.replace(/^- Facial Expression:.*(\r?\n|$)/m, '').replace(/^SCENE FOCUS RULE \(ABSOLUTE\):.*(\r?\n|$)/m, '')

/** 반려동물 고민 컷인가 — 기존 프롬프트의 얼굴 줄을 뺄지 태스크가 본다 */
export const isPetProblem = (purpose: string, category: string | null | undefined) => purpose === 'problem' && category === 'pet'

/**
 * 제품군별 사진 한 문장(적용 K6 T1-80 ①, A6 #12 표 5·L6 #7, 통합 11-03 16:3x) — 판매 상위 페이지 근거가 있는 제품군만, 맞는 목적 컷의 Purpose 줄 끝에 붙인다.
 * 제품군마다 한 문장이다. 근거가 없는 제품군(뷰티 도구·폰 소품·문구·포장·반려·원예 등)은 붙이지 않아 컷 지시가 그대로다. D 카테고리 지시(CATEGORY_IMAGE_DIRECTIVES)는 받지 않는다.
 * 값은 판단이고 시험 상품에 근거 제품군이 거의 없어 실제 효과는 V2에서 본다. 신선 식품은 입력에 이름이 있는 재료만 적는다
 */
const FAMILY_SHOTS: Readonly<Record<string, { purposes: readonly string[]; line: (names: readonly string[]) => string }>> = {
  apparel: { purposes: ['texture', 'feature_proof'], line: () => 'For this garment, show the fabric weave, seams and finishing clearly.' },
  cosmetic: { purposes: ['texture'], line: () => 'Show the formula itself as a small swatch or drop beside the container.' },
  device: { purposes: ['feature_proof', 'underside'], line: () => 'Show the buttons, ports or controls clearly.' },
  fresh: { purposes: ['texture', 'scene'], line: (names) => `Show the fresh food itself${names.length > 0 ? ` (${names.join(', ')})` : ''} with its natural color and surface, as it comes.` },
  processed: { purposes: ['scene', 'action'], line: () => 'Show the food prepared and served in a bowl or on a plate, ready to eat.' },
  kitchen_storage: { purposes: ['scene', 'action'], line: () => 'Show it holding real food or kitchen items, as it is used.' },
  bedding_fabric: { purposes: ['scene'], line: () => 'Show it in a real, tidy room where it is used.' },
  home_decor: { purposes: ['scene'], line: () => 'Show it in a real, tidy room where it is used.' },
  sports_support: { purposes: ['scene', 'action'], line: () => 'Show it worn on the body part it supports.' },
}

/** 컷 목적에 붙는 제품군 문장 — 근거 없는 제품군이거나 맞지 않는 목적이면 없다 */
export function familyShotLine(family: string | null | undefined, purpose: string, ingredients: readonly string[] = []): string | null {
  const entry = family ? FAMILY_SHOTS[family] : undefined
  return entry && entry.purposes.includes(purpose) ? entry.line(ingredients) : null
}

/** 제품군 문장이 있는 제품군 — 시험이 쓴다 */
export const FAMILY_SHOT_FAMILIES: readonly string[] = Object.keys(FAMILY_SHOTS)
/** 손과 상품만 나오는 컷인가 — 기존 사용 프롬프트의 얼굴 지시를 뺄지 태스크가 본다 */
export const isHandsOnly = (shot: Pick<LineShot, 'purpose' | 'composition'>) => shot.purpose === 'action' || shot.composition === 'in_hand'

const COMPOSITION_LINES: Readonly<Record<string, string>> = {
  front: 'eye-level front view',
  angle45: 'three-quarter view',
  side: 'table-height side view',
  top: 'straight overhead view',
  flatlay: 'overhead flat lay with clean space between items',
  // 확대 컷은 소품과 함께 찍히면 상품이 실물보다 크게 읽힌다(K4 오너 지적 11-05) — 가장자리가 프레임 밖으로 나가는 확대 구도, 큰 일상 소품 없음
  closeup: 'close-up — the key part fills the frame and the product edges run past the frame, with no full-size everyday objects (cups, books, phones) beside it',
  in_hand: 'one adult hand holds it',
  in_use: 'used in its real place',
  worn: 'worn on the body part it is for, face not needed',
  group: 'several pieces together',
}

export const HANDLED: ReadonlySet<string> = new Set(['in_hand', 'in_use', 'worn'])
/** 손·몸이 나오는 컷의 접촉 줄 — K 컷 지시와 D 목적 블록(적용 D4 ⓑ)이 같은 문장을 쓴다 */
export const CONTACT_LINE = 'Contact: hands grip the real holding part of the product and never pass through it; the product sits on surfaces with a contact shadow.'
/** 프레임 안 상품 비중(A4 10절, 힉 눈대중 참고값) */
const VISIBLE_SHARE: Readonly<Record<string, string>> = {
  in_hand: 'the product takes about 30 to 50% of the frame',
  in_use: 'the product takes about 30 to 50% of the frame',
  worn: 'the product takes about 30 to 50% of the frame',
  closeup: 'the key part fills most of the frame',
}
const SOLO_SHARE = 'the product takes about 40 to 70% of the frame'

const lineOf = (label: string, text: string) => `${label}: ${text}`

/** 가운데 참조의 역할(A4 10절 Refs) — 첫 장(구조 정본)·마지막 장(대표 컷 빛·색)은 참조 역할 문구가 말한다. 상품이 나오는 컷만 */
const REFS_LINE = lineOf(
  'Refs',
  'any attached images between the first and the last show this same product from other sides, its labels or its photographed options — use them only to get those details right; the structure follows the first image.'
)

const SHOT_HEADER = '[Shot direction]'
/** K 컷 지시 마지막 줄 — MS 맞추기(ms-prompt-fit)가 이 줄이 있는 컷에서 겹치는 글자 금지 블록을 덜 때 찾는다 */
export const K_NEVER_LINE =
  'Never: added text, numbers or logos beyond what is printed on the product itself; parts, colors or quantities not in the reference photos; collage or poster layouts; review-snapshot looks; real brands.'
/**
 * 사진 위 글 칸에서 비우는 비율(%) — 막의 상한(overlay.ts OVERLAY_SCRIM_MAX)과 같은 값이다. 막은 사진 높이의 46~58%라(2:3, 계산값) 첫 화면 글자 자리(33%)로는
 * 제품이 막에 가린다(render-check 41335489167·41335080249). 이 파일이 막 계산을 끌어오지 않게 값을 따로 두고 시험이 맞춘다.
 */
export const OVERLAY_CLEAR_PERCENT = 60
/** 비운 쪽을 뺀 자리 안에서 크게 — 프레임 비중 값은 그 자리에 들어가지 않는다 */
const OVERLAY_SHARE = 'the product is as large as fits in the part the Frame line leaves open'
const FRAME_ZONES: Readonly<Record<ImageOverlay['anchor'], { zone: string; open: string; calm: string }>> = {
  top: { zone: 'top', open: 'bottom', calm: 'one even tone of wall or softly out-of-focus background' },
  bottom: { zone: 'bottom', open: 'top', calm: 'one even tone of table, floor or softly out-of-focus foreground' },
}

function frameLine(anchor: ImageOverlay['anchor']): string {
  const { zone, open, calm } = FRAME_ZONES[anchor]
  const clear = `${zone} ${OVERLAY_CLEAR_PERCENT}%`
  return lineOf(
    'Frame',
    `Leave the ${clear} of the frame as a calm, low-detail part of the set — ${calm}, ${COPY_ZONE_KEEP_CLEAR} ` +
      `Everything that matters in the picture, including any product, hand or person, stays in the ${open} ${100 - OVERLAY_CLEAR_PERCENT}% and does not cross into the ${clear}.`
  )
}

/** 원·아치 칸 — 페이지가 모서리를 깎으므로 잘리는 자리에 중요한 것을 두지 않는다. 원은 네 모서리, 아치는 위 두 모서리다 */
export const CLIP_LINES: Readonly<Record<NonNullable<LineShot['clipShape']>, string>> = {
  circle: 'The page shows this picture inside a circle that touches all four edges, so the four corners disappear. Everything that matters stays inside that central circle.',
  arch: 'The page rounds the top of this picture into a full arch, so the two top corners disappear. Everything that matters stays below and inside that curve.',
}

/**
 * 대표 컷 실물 크기 줄(K4 오너 지적 11-05) — 대표 컷은 컷 지시 대신 아래 블록만 받아 치수가 한 줄도 가지 않았고, '크게' 지시에 맞추려 손·소품 옆에서
 * 상품을 키웠다(50mm 스티커가 머그 옆 접시 크기, 내측 3.2cm 클립이 손바닥만 한 고리). 치수가 없으면 지금처럼 없다
 */
const heroSizeLines = (size?: string | null): string[] => (size?.trim() ? [trueScaleLine(size.trim())] : [])

/** 대표 컷용 — 대표 컷은 기존 첫 화면 프롬프트로 만들어 다른 줄이 필요 없다. 첫 화면 사진 유형 블록은 이 뒤에 붙지만 자리를 말하지 않는다 */
export const buildFrameBrief = (anchor: ImageOverlay['anchor'], size?: string | null): string =>
  [
    SHOT_HEADER,
    'This block wins over every instruction above about where things sit in the frame and how much of the frame the product fills.',
    frameLine(anchor),
    ...heroSizeLines(size),
  ].join('\n')

/**
 * 사진 위 글이 없는 첫 화면 대표 컷(적용 K13, 오너 11-04 18:11 ③) — 후킹은 제품이 크게 보이는 컷이고 쓰는 장면·구성은 히어로 칸이 맡는다.
 * 첫 화면 사진 넓이(0.55)는 틀 넓이라, 쓰는 장면 컷은 값이 높아도 제품이 작을 수 있어 컷 지시로 막는다. 크게는 가까이 찍어서다 — 상품을 키우지 않는다
 */
export const heroLargeBrief = (size?: string | null): string => {
  const sizeLines = heroSizeLines(size)
  return [
    SHOT_HEADER,
    'This block wins over every instruction above about how much of the frame the product fills.',
    lineOf(
      'Size',
      `The product is the largest subject and fills at least half of the frame, whole and in sharp focus. If it is worn or held, frame close on that part of the body so the product stays the largest subject.${sizeLines.length > 0 ? ' Get there by framing closer, not by making the product bigger than it is.' : ''}`
    ),
    ...sizeLines,
  ].join('\n')
}

/** 치수 없는 대표 컷 블록 — 옛 상수와 글자까지 같다(시험이 확인) */
export const HERO_LARGE_BRIEF = heroLargeBrief()

/**
 * 후킹 약속 줄(hookhero 잡만, 결정 카드 c09·J21 — 기본 off) — 첫 화면 headline을 대표 컷 지시에 참고로만 넘긴다. 다른 컷 지시의 섹션 글 줄과 같이
 * 'reference only, never drawn as text'로 글자를 그리지 않게 한다. 꺼진 잡은 대표 컷 지시에 이 줄이 없다
 */
export const heroPromiseLine = (hook: string): string =>
  `First-screen promise (reference only, never drawn as text): ${hook}\nShow the scene, moment or result this promise names, with the product as the main subject.`

/** 입력 치수를 손에 빗댈 기준(cm, A4 4절 설계 입력) — 7cm까지 손가락 폭, 13cm까지 손바닥 폭, 그 위는 손 길이 */
const FINGER_CM = 1.8
const PALM_CM = 8.5
const HAND_CM = 18
const FINGER_MAX_CM = 7
const PALM_MAX_CM = 13
/** 손가락 하나보다 확실히 좁은 값 */
const UNDER_FINGER_CM = FINGER_CM * 0.75
/** 한 줄에 옮기는 치수 수 */
const HAND_TERMS_MAX = 3
const UNIT_CM: Readonly<Record<string, number>> = { mm: 0.1, cm: 1, m: 100 }

function handTerm(cm: number): string {
  const count = (value: number, name: string) => `about ${value} adult ${name}${value === 1 ? '' : 's'}`
  const halves = (value: number) => Math.max(1, Math.round(value * 2) / 2)
  if (cm < UNDER_FINGER_CM) return 'narrower than an adult finger'
  if (cm <= FINGER_MAX_CM) return count(Math.round(cm / FINGER_CM), 'finger width')
  if (cm <= PALM_MAX_CM) return count(halves(cm / PALM_CM), 'palm width')
  return count(halves(cm / HAND_CM), 'hand length')
}

/**
 * 보이는 크기가 아닌 치수 이름 — 펼친 길이·둘레는 놓인 상품의 크기가 아니다. 손에 빗대면 모델이 그 수를 보이는 크기로 그린다
 * (K4 P08 '펼침 7.3cm' 클립이 지름 7cm 고리로 그려짐, 11-05). 치수 바로 앞 이름만 본다
 */
const NOT_SHOWN_LABEL = /(펼침|펼친|펼쳤을|둘레|unfolded|circumference)\s*(길이|때)?\s*[:=]?\s*$/i
/** 치수 바로 앞에서 이름을 찾는 글자 수 */
const LABEL_WINDOW = 12

/** 사양 크기 글의 치수를 손에 빗댄 말 — 모델이 손 옆 크기를 눈대중으로 그려 어긋난다(P11 50mm가 약 6~8cm, 눈대중). 보이는 크기가 아닌 치수는 뺀다. 치수가 없으면 null */
export function handTermsOf(size: string): string | null {
  const parts = [...size.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m)(?![a-z])/gi)]
    .filter((match) => !NOT_SHOWN_LABEL.test(size.slice(Math.max(0, (match.index ?? 0) - LABEL_WINDOW), match.index)))
    .slice(0, HAND_TERMS_MAX)
    .map(([text, value, unit]) => `${text.replace(/\s/g, '')} is ${handTerm(Number(value) * UNIT_CM[unit.toLowerCase()])}`)
  return parts.length > 0 ? parts.join('; ') : null
}

/** 크기 줄을 싣는 컷 — 손·몸·사람이 나와 상품과 크기가 견주어지는 컷이다. 고민 컷은 상품이 없다 */
export const SIZE_PURPOSES: ReadonlySet<string> = new Set(['scale', 'action', 'scene'])

/** 크기 줄 — K 컷 지시와 D 목적 블록(적용 D4 ⓑ)이 같은 문장을 쓴다 */
export function sizeLine(size: string): string {
  const terms = handTermsOf(size)
  return `Real size (reference only, never drawn as text): ${size}. ${terms ? `In hand terms, ${terms}. ` : ''}Keep hands and objects in true proportion to it.`
}

/** 크게 보이는 방법 — 상품을 키우지 않고 카메라를 가까이(K4 오너 지적 11-05: 대표·확대 컷에서 상품이 소품·손보다 실물 이상으로 커짐) */
export const TRUE_SCALE_CAMERA =
  'Anything else in the frame — hands, people, surfaces, packaging, props — keeps its own real size next to the product. To show the product larger, move the camera closer; never enlarge the product itself.'

/** K 대표 컷·손이 없는 K 상품 컷의 크기 줄 — 바탕 소품과 견주어지므로 싣는다. 손·사용·장면 컷과 D 목적 블록은 sizeLine 그대로 */
export const trueScaleLine = (size: string): string => `${sizeLine(size)} ${TRUE_SCALE_CAMERA}`

/**
 * 손·몸·사람 옆 K 컷의 가까이 찍기(오너 블라인드 메모 11-06, 설계 S3) — 이 구도는 '상품이 화면의 30~50%'를 요구하는데 크기 줄(sizeLine)에
 * 가까이 찍기 문장이 없어, 손·머리 옆에서 그 비중을 채우려 상품을 키웠다(K5 P05 9.6cm 빗이 약 20cm로 4/4, P08 손 컷 3/6). D 목적 블록은 sizeLine 그대로
 */
export const HANDS_TRUE_SCALE =
  'Hands, heads and bodies keep their real size next to the product. To make the product fill its share of the frame, move the camera closer — never enlarge the product itself.'

/** 소품 실물 크기(설계 S2) — K5 P08 클립 컷이 토마토 줄기·지지대를 실물보다 굵게 그리고 그것을 감싸며 커졌다(판정 글 5/6). 상품군별 수치는 넣지 않는다 */
export const PROPS_TRUE_SCALE = 'Things the product holds, wraps or sits on keep their real size — never thicken or enlarge them to fit the product.'

/** 사양 크기 글의 한국어 치수 이름 — 영어 지시 안에서 뜻이 전해지지 않았다(K5 P08 '내측 3.2cm'을 바깥 크기로, '펼침 7.3cm'을 놓인 크기로) */
const SIZE_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/내측|안쪽|내경/, 'the inner opening — the outside of the product is larger by its wall'],
  [/펼쳤을\s*때|펼침|펼친/, 'opened or unfolded — that size applies only when the product is pictured opened'],
  [/접었을\s*때|접힘|접은/, 'folded — that size applies only when the product is pictured folded'],
  [/둘레/, 'circumference — not a length the product shows'],
]

/** 치수 이름 풀이 줄(설계 S1) — 이름이 없으면 null(줄 없음) */
export function sizeWordsLine(size: string): string | null {
  const found = SIZE_WORDS.flatMap(([re, meaning]) => {
    const hit = size.match(re)
    return hit ? [`${hit[0]} = ${meaning}`] : []
  })
  return found.length > 0 ? `Size words (reference only, never drawn as text): ${found.join('; ')}.` : null
}

/** K 컷 지시의 크기 줄들 — 손·몸·사람 옆 컷(nearBody)은 sizeLine + 손 쪽 가까이 찍기, 그 밖은 trueScaleLine. 뒤에 치수 이름 풀이(있을 때)·소품 실물 크기 */
export function kSizeLines(size: string, nearBody: boolean): string[] {
  const words = sizeWordsLine(size)
  return [nearBody ? `${sizeLine(size)} ${HANDS_TRUE_SCALE}` : trueScaleLine(size), ...(words ? [words] : []), PROPS_TRUE_SCALE]
}

/**
 * 수량 컷이 보여 줄 수(적용 K6 R-B7) — 구성 칸이 정한 수는 정확히, 옵션마다 다른 수는 가장 큰 수 이하로. 수를 모르거나 7 이상이면 붙이지 않는다(shotQuantityOf)
 */
function countSentence(quantity: ShotQuantity): string {
  return 'exact' in quantity ? `Show exactly ${quantity.exact} ${quantity.noun} — no more, no fewer.` : `Show no more than ${quantity.max} ${quantity.noun}.`
}

/**
 * 컷 하나의 지시 블록. size는 사양 크기 — 상품이 나오는 컷(효과 컷 밖)이 읽고 그리지 않는다. quantity는 수량 컷만 읽는다.
 * family는 상품 제품군(judgeProductFamily), ingredients는 입력에 이름이 적힌 재료(namedIngredientsOf) — 제품군 문장만 읽는다.
 * effectShot은 effectshot 잡만 true — 기능·사용 컷 Purpose 줄 끝에 체감 결과 문장(EFFECT_SHOT_LINE)을 붙인다.
 * problemObject는 고민 실물 컷(isProblemObjectCut)만 true — problem 컷 Purpose 첫 문장을 PROBLEM_OBJECT_LINE으로 바꾼다
 * showBeat는 showbeat 잡의 섹션마다 한 컷만 — 칸 글이 말한 동작·설계를 보이라는 한 문장(show-beat showBeatLine)을 Purpose 줄 끝에 붙인다
 */
export function buildShotBrief(
  shot: LineShot,
  context: {
    size?: string | null
    category?: string | null
    quantity?: ShotQuantity | null
    family?: string | null
    ingredients?: readonly string[]
    effectShot?: boolean
    problemObject?: boolean
    showBeat?: string
  } = {}
): string {
  const route = shotRouteOf(shot.purpose)
  const handled = HANDLED.has(shot.composition)
  const size = context.size?.trim()
  const family = familyShotLine(context.family, shot.purpose, context.ingredients)
  const lines = [
    SHOT_HEADER,
    'This block wins over every instruction above about framing, angle, distance, props, the people shown and how much of the frame the product fills.',
    lineOf('Purpose', `${context.problemObject && shot.purpose === 'problem' ? PROBLEM_OBJECT_LINE : (PURPOSE_LINES[shot.purpose] ?? PURPOSE_LINES.hero)}${isPetProblem(shot.purpose, context.category) ? ` ${PET_PROBLEM}` : ''}${shot.purpose === 'quantity' && context.quantity ? ` ${countSentence(context.quantity)}` : ''}${family ? ` ${family}` : ''}${context.effectShot && EFFECT_SHOT_PURPOSES.has(shot.purpose) ? ` ${EFFECT_SHOT_LINE}` : ''}${context.showBeat ? ` ${context.showBeat}` : ''}`),
    lineOf('Camera', `${COMPOSITION_LINES[shot.composition] ?? COMPOSITION_LINES.front}${shot.camera ? ` — ${cameraPhrase(shot.camera)}` : ''}${shot.turn ? `; ${turnPhrase(shot.turn)}` : ''}`),
    ...(shot.person ? [personLine(shot.person, context.category === 'pet')] : []),
    ...(shot.stage ? [shot.stage.line] : []),
    ...(route.effectOnly
      ? []
      : [
          REFS_LINE,
          ...(handled ? [CONTACT_LINE] : []),
          lineOf('Visible', `${shot.overlayAnchor ? OVERLAY_SHARE : (VISIBLE_SHARE[shot.composition] ?? SOLO_SHARE)}. Keep what matters away from the top and bottom edges — the page crops them a little.${isWideCamera(shot.camera) ? ` ${WIDE_PRODUCT_FLOOR}` : ''}`),
        ]),
    ...(shot.show ? [`Text of this section (reference only, never drawn as text): ${shot.show}`] : []),
    // 실물 크기(K4 오너 지적 11-05) — 손·사용·장면 컷은 지금 문장 그대로, 그 밖의 상품 컷도 바탕 소품과 견주어지므로 크기 줄 + 가까이 찍기
    // 손·몸 옆 컷도 가까이 찍기, 치수 이름 풀이·소품 실물 크기(오너 메모 11-06 설계 S1~S3) — 치수가 없으면 지금처럼 줄이 없다
    ...(size && !route.effectOnly ? kSizeLines(size, handled || SIZE_PURPOSES.has(shot.purpose)) : []),
    ...(shot.overlayAnchor ? [frameLine(shot.overlayAnchor)] : []),
    ...(shot.clipShape ? [lineOf('Frame', CLIP_LINES[shot.clipShape])] : []),
    K_NEVER_LINE,
  ]
  return lines.join('\n')
}
