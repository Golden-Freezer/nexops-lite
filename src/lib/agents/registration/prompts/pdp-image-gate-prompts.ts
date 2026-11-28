/**
 * PDP 파이프라인 5단계(이미지 생성) — Vision 게이트 + 식별카드 + 재생성 지시문 —
 * NEXFIT agents/image_generation_agent.py(`_vision_score_consistency`) + agents/image_identity.py
 * (`IDENTITY_CARD_PROMPT`) + agents/image_gate_policy.py(전체) 번역.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 영문 본문은 의미·문구 변경 없이 그대로 옮긴다. 예외: 식별카드 프롬프트는 상품 정확성
 * 수정(2026-10-31, 통합 결정)으로 인쇄 무늬·위치 항목과 여러 장 변형을 더했다(상수 옆 주석).
 * Vision 게이트 프롬프트는 원문 자체에 이미 JSON 응답 형식 지시가 내장되어 있어(원본 f-string
 * 말미) Phase 1 thumbnail-gate-prompts.ts처럼 별도로 append할 필요가 없다 — 원문 그대로 보존.
 */

// NEXFIT agents/image_generation_agent.py:446-469 (`_vision_score_consistency` 내부 f-string)
// LLM 콜(`_genai_call`)·이미지 첨부 조립은 호출부(images 단계 에이전트) 책임 — 여기는 텍스트만 조립.
// partsCheck(기본 off, 재현 H6 비교 전용 — 운영 게이트는 켜지 않는다): 끈·매듭·손잡이 같은 부품 수·구조가 참조와 같은지 따로 묻는다.
// same_product는 모양·색·로고·재질만 물어 P02 R12-L '끈과 매듭이 두 벌'인 컷이 통과했다(2026-11-01)
const PARTS_CHECK_CRITERIA =
  '- parts_match: count each functional part of the product in the reference (cords, knots, handles, straps, zippers, lids, drawers, compartments). ' +
  'false if the cut shows a part duplicated, added or structurally different from the reference — for example a pouch with one cord on each side ' +
  'drawn with a second cord and a second knot on each side. Parts hidden by hands or by the crop are not missing. ' +
  'If the product is not visible in the cut, use true.\n' +
  '- parts_reason: short reason if parts_match is false, else empty string.\n'

// useCheck(K 라인 사람·손 컷만, 점검 고침 3 게이트 쪽 — 오너 11-07 00:1x 승인): 쥐는 곳·작동면·방향·착용 부위가 원본·설명과 맞는지 묻는다.
// 같은 상품이어도 거꾸로 쥐거나(P06 빗) 다른 부위에 차면 사용 장면이 틀린다
const USE_CHECK_CRITERIA =
  '- use_correct: if hands or a person hold, use or wear the product in the cut, is it used the way the reference photos show it is used — held at its grip, ' +
  'the working side facing the right way, worn on the right body part, in the right orientation? false if it is held by the wrong part, upside down or reversed, ' +
  'worn on the wrong body part, or used in a way the product cannot work. If no hands or person touch the product, use true.\n' +
  '- use_reason: short reason if use_correct is false, else empty string.\n'

/** 기대 쓰는 법 글 상한 — 식별 카드 USE 줄 상한(IDENTITY_USE_MAX_CHARS 200)과 같다 */
const EXPECTED_USE_MAX_CHARS = 200

/**
 * 기대 쓰는 법(usegate 잡, 결정 카드 c08·J19) — 식별 카드 USE 줄(사진 판독, c02 design_prompts.identity_use)을 판정에 싣는 글.
 * 비었으면 null(부르는 쪽이 줄을 붙이지 않는다 — use_correct 기준이 지금 그대로)
 */
export function gateExpectedUseOf(use: string | null | undefined): string | null {
  const text = (use ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()
  return text ? text.slice(0, EXPECTED_USE_MAX_CHARS) : null
}

/** use_correct 기준 뒤 한 줄 — 원본 사진 속 모습과 함께 이 쓰는 법과도 맞춰 본다 */
const expectedUseCriteria = (use: string) =>
  `- Expected use (read earlier from the reference photos): ${use} — judge use_correct against this as well; false if the cut contradicts it.\n`

// referenceCount(기본 1, 재현 H6 비교 전용): 원본 여러 장을 함께 준다 — 정면에서 한 줄로 보이는 끈이 근접 사진에서는 두 가닥 고리다(P02 features:5 오탐, 2026-11-01)
const MULTI_REFERENCE_NOTE =
  'Use all reference photos together: a close-up may show detail that the front view hides ' +
  '(for example a cord that looks like one line from the front may be a loop of two strands). ' +
  'A part is duplicated only if the cut shows more of it than the references do.\n'

// stagedCut(K 컷 중 바탕이 세트와 일부러 다른 컷만): 일관성 점수에서 바탕 차이를 빼라고 알린다. 다른 판정 칸은 글자까지 같다(시험이 고정한다).
// 기본 문구는 바탕 톤까지 함께 재서, 무대를 바꾸면 상품이 같아도 0.7 아래로 떨어져 재생성이 는다(R16·R17 재생성 사유의 대부분이 consistency)
const STAGED_CONSISTENCY =
  '- consistency: 0.0-1.0 score combining product identity and lighting consistency with the reference. ' +
  'The background, floor and place of this cut differ from the reference on purpose: do not lower this score for them.\n'

// lineCut(K 라인 컷만 — D 운영 게이트는 켜지 않는다): same_product가 모양·색·로고·재질만 물어 빗살 배열이 나선→사각 고리로 바뀐 컷이
// 통과했다(K4 P04, 2026-11-05). 구멍·통풍구·홈·빗살의 배열도 같은 상품의 조건으로 묻는다
const LINE_SAME_PRODUCT =
  '- same_product: is it clearly the SAME product as the reference ' +
  '(shape, color, logo, material, and the layout of holes, vents, slots or bristles)? true/false. ' +
  'A different pattern or arrangement of those openings (for example a spiral drawn as square rings) makes it false; ' +
  'openings hidden by hands or by the crop are not different. If the product is not visible in the cut, use true.\n'

/** 판정에 싣는 실제 치수 글 상한 — 입력 칸 글을 그대로 넣으므로 줄바꿈을 펴고 자른다 */
const REAL_SIZE_MAX_CHARS = 120

// realSize(K 라인 컷이고 입력 치수가 있을 때만): 게이트가 크기를 보지 않아 소품·손 옆에서 커진 상품이 통과했다(K4 P08·P11, 2026-11-05).
// 같은 콜에 칸 둘을 더한다(추가 호출 없음). 크기 단서가 없거나 상품을 가까이 잘라 찍었으면 막지 않는다
const sizeCriteria = (realSize: string) =>
  `- size_plausible: the product's real size is "${realSize}". Judge only the size it appears to have next to things of known size in the same cut — ` +
  'hands, fingers, people, cups, phones, books, furniture. false if it looks 1.5 times or more larger or smaller than its real size. ' +
  'A size given for the unfolded or opened state applies only when the product is pictured unfolded or opened; a circumference is not a length it shows. ' +
  // 안쪽 치수(오너 메모 11-06 설계 S4) — K5 P08 '내측 3.2cm' 고리를 바깥 약 4cm로 그린 컷(1.25배)까지 미달로 봤다. 판정은 #834대로 기록만 한다
  'An inner size (내측, 안쪽, inner) is the opening only — the outside is larger by the wall, so compare the outside with the opening plus that wall. ' +
  'A close crop that only frames the product closer is fine. ' +
  'If nothing in the cut gives a size cue, or the product is not visible, use true.\n' +
  '- size_reason: short reason if size_plausible is false, else empty string.\n'

/** 입력 치수 글 → 판정에 싣는 글. 비었으면 null */
export function gateRealSizeOf(size: string | null | undefined): string | null {
  const text = (size ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()
  return text ? text.slice(0, REAL_SIZE_MAX_CHARS) : null
}

export function buildVisionGatePrompt(
  cutNames: string[],
  {
    partsCheck = false,
    useCheck = false,
    referenceCount = 1,
    stagedCut = false,
    lineCut = false,
    realSize,
    expectedUse,
  }: {
    partsCheck?: boolean
    useCheck?: boolean
    referenceCount?: number
    stagedCut?: boolean
    lineCut?: boolean
    realSize?: string | null
    /** 기대 쓰는 법(usegate 잡, J19) — useCheck일 때만 use_correct 기준 뒤에 한 줄. 없으면 지금 그대로 */
    expectedUse?: string | null
  } = {}
): string {
  const many = referenceCount > 1
  const size = lineCut ? gateRealSizeOf(realSize) : null
  const expected = useCheck ? gateExpectedUseOf(expectedUse) : null
  return (
    'You are a product-photo QA judge for a Korean e-commerce detail page.\n' +
    (many
      ? `The FIRST ${referenceCount} attached images are REFERENCE photos of the same single product from different angles. `
      : 'The FIRST attached image is the REFERENCE product photo. ') +
    `The following ${cutNames.length} images are generated cuts, in this exact order: ` +
    cutNames.join(', ') +
    '.\n' +
    'For EACH generated cut, judge:\n' +
    (lineCut
      ? LINE_SAME_PRODUCT
      : '- same_product: is it clearly the SAME product as the reference ' +
        '(shape, color, logo, material)? true/false. If the product is not visible in the cut, use true.\n') +
    '- background_tone_hex: the dominant background color of the cut as #RRGGBB.\n' +
    (stagedCut
      ? STAGED_CONSISTENCY
      : '- consistency: 0.0-1.0 score combining product identity and lighting/background-tone ' +
        'consistency with the reference and with a single cohesive page style.\n') +
    '- has_artifact: true if the cut has ANY of these defects, else false:\n' +
    '   (a) dirty stains, mold-like brown/gray blotches, or grime on the product ' +
    '(critical for a hygiene product) — clean foam, lather, water droplets or a foamy wet brush from normal use are not stains;\n' +
    '   (b) a REAL-WORLD brand name or company logo readable on any item ' +
    '(e.g. a real shampoo/cosmetic brand label) — the product itself is unbranded;\n' +
    '   (c) garbled, misspelled, or gibberish Korean/English text rendered in the image;\n' +
    "   (d) printed brand name or a generic word (such as 'WASHBAG', 'BAG') stamped on " +
    "the PRODUCT's own surface / transparent panel — the product must be blank/unbranded.\n" +
    '- artifact_reason: short reason if has_artifact is true, else empty string.\n' +
    (partsCheck ? PARTS_CHECK_CRITERIA : '') +
    (partsCheck && many ? MULTI_REFERENCE_NOTE : '') +
    (useCheck ? USE_CHECK_CRITERIA : '') +
    (expected ? expectedUseCriteria(expected) : '') +
    (size ? sizeCriteria(size) : '') +
    'Respond with ONLY a JSON array, no markdown:\n' +
    '[{"cut": "<name>", "same_product": true, "background_tone_hex": "#FFFFFF", ' +
    `"consistency": 0.85, "has_artifact": false, "artifact_reason": ""${partsCheck ? ', "parts_match": true, "parts_reason": ""' : ''}${useCheck ? ', "use_correct": true, "use_reason": ""' : ''}` +
    `${size ? ', "size_plausible": true, "size_reason": ""' : ''}}]`
  )
}

export interface VisionGateCutScore {
  cut: string
  same_product: boolean
  background_tone_hex: string
  consistency: number
  has_artifact: boolean
  artifact_reason: string
  /** partsCheck 호출에만 — 부품 수·구조가 참조와 같은지 */
  parts_match?: boolean
  parts_reason?: string
  /** useCheck 호출에만(K 사람·손 컷) — 쥐는 곳·작동면·방향·착용 부위가 맞는지 */
  use_correct?: boolean
  use_reason?: string
  /** K 라인 컷에 실제 치수를 실은 호출에만 — 손·흔한 물건 대비 크기가 실제와 1.5배 안인지 */
  size_plausible?: boolean
  size_reason?: string
}

// NEXFIT agents/image_identity.py:83-93 — 인라인이었으므로 프롬프트 파일로 승격(§7.0 규칙).
// 상품 정확성(2026-10-31, P07 그릇 바닥 무늬 빠짐): 인쇄된 그림·아이콘·무늬와 그 위치를 (6)으로 적고 상한 40→50단어.
// 'branding'은 그림 무늬까지 빼게 읽혀 'brand names, logos'로 좁힌다(브랜드 로고는 계속 빼고 상품 무늬는 적는다)
export const IDENTITY_CARD_PROMPT =
  'You are cataloguing a product photo so another image model can redraw the SAME product.\n' +
  'Look at the attached reference photo and describe ONLY what is actually visible.\n' +
  'Prioritise, in this order: (1) handle / grip / cutout shape, (2) opening mechanism and whether ' +
  'it is open or closed, (3) number of tiers, drawers, compartments or set pieces, (4) material and ' +
  'finish, (5) exact colors of each part, (6) pictures, icons or patterns printed on the product and ' +
  "exactly where each one is (e.g. 'black paw print on the floor of the left bowl').\n" +
  'Rules: English only, at most 50 words, one line, comma-separated noun phrases. ' +
  "State counts as numbers (e.g. '2-tier', '1 drawer'). Never guess a feature you cannot see. " +
  'Do not mention background, lighting, brand names, logos or marketing language.\n' +
  'Answer with the description only, no preamble.'

// NEXFIT agents/image_identity.py:95 — 식별카드 응답 길이 상한(`_clean_identity_text`가 강제). 50단어에 맞춰 400 → 500
export const IDENTITY_CARD_MAX_CHARS = 500

/** 인쇄물 식별카드가 읽는 원천 사진 최대 장수(P01 — 사진마다 도안이 다르다) */
export const IDENTITY_CARD_MAX_PHOTOS = 4
/** 인쇄물이 아닌 상품의 전 사진 식별카드(idcardall)가 읽는 원천 사진 최대 장수 */
export const IDENTITY_CARD_ALL_MAX_PHOTOS = 8
/** 여러 장 식별카드 응답 길이 상한 — 공통 형태 + 도안 최대 4개 */
export const IDENTITY_CARD_MULTI_MAX_CHARS = 1000

/**
 * 전 사진 식별카드(idcardall, 재분석 5절) — 첫 사진만 읽으면 다른 사진의 부품이 카드에 없어 생성 모델 재량이 된다(P07 다리 끝 캡).
 * 다만 원본끼리 어긋나는 상품이 있어(P07 캡 등 오너 답 대기, 통합 13:37) 한 장에만 있는 특징을 확정으로 적지 않는다: 첫 사진에 있거나 두 장 이상에 있어야 확정이고,
 * 나머지는 UNCERTAIN 뒤에 적어 카드에서 빼고 기록만 한다(readIdentityCard). 첫 사진이 지금 기준 사진이고 게이트도 첫 사진과 비교한다
 */
export function buildIdentityCardAllPhotosPrompt(photoCount: number): string {
  return (
    `You are cataloguing ${photoCount} photos of ONE product so another image model can redraw the SAME product.\n` +
    'The first photo is the reference. Describe ONLY what is actually visible and confirmed: a feature is confirmed when it shows in ' +
    'the first photo or in at least two of the photos.\n' +
    'Prioritise, in this order: (1) handle / grip / cutout shape, (2) opening mechanism and whether it is open or closed, ' +
    '(3) number of tiers, drawers, compartments or set pieces, (4) small end parts such as caps, tips, feet, clips and how they differ ' +
    'in color from the main body, (5) material and finish, (6) exact colors of each part, (7) pictures, icons or patterns printed on ' +
    "the product and exactly where each one is (e.g. 'black paw print on the floor of the left bowl').\n" +
    'The same unit can appear in several photos: count it once and never add up units across photos.\n' +
    "If a feature shows in only one later photo, or the photos disagree about a part, keep the first photo's version in the description " +
    "and do not state the other as fact. After the description, list each such item as 'UNCERTAIN: item; item', or write 'UNCERTAIN: none'.\n" +
    "Rules: English only, at most 80 words before UNCERTAIN, one line, comma-separated noun phrases. State counts as numbers (e.g. '2-tier', '1 drawer'). " +
    'Never guess a feature you cannot see. Do not mention background, lighting, brand names, logos or marketing language.\n' +
    'Answer with the description only, no preamble.'
  )
}

/**
 * 인쇄물 여러 장 식별카드(상품 정확성 2026-10-31, P01 스티커에 원본에 없는 도안) — 첫 사진만 읽으면 다른 사진의 도안이 카드에 없어
 * 생성 모델이 여러 장 장면의 빈 자리를 지어낸 도안으로 채운다. 공통 형태 한 번 + 사진 순서대로 도안마다 한 줄
 */
export function buildIdentityCardMultiPrompt(photoCount: number): string {
  return (
    `You are cataloguing ${photoCount} photos of ONE printed product so another image model can redraw it without ` +
    'inventing new artwork.\n' +
    'First describe the shared physical form in a few noun phrases — shape, number of sheets or pieces in the set (as a ' +
    'number), material, finish and exact colors of each part. Then list every printed ' +
    "design in photo order as 'Design 1: ...; Design 2: ...' — for each, its main picture, characters, motifs, colors " +
    "and where the lettering sits. When a photo repeats an earlier design, write 'Design k: same as Design j'.\n" +
    'Rules: English only, at most 120 words, one line. Never guess what you cannot see. ' +
    'Do not mention background, lighting, brand names, logos or marketing language.\n' +
    'Answer with the description only, no preamble.'
  )
}

/**
 * 상태 구분 문장(idcardall 잡만, 오너 블라인드 메모 11-06 P05) — 원본 사진이 같은 상품을 펼침·접힘으로 함께 보여 주면 카드가 두 상태를
 * 한 문장에 묶고('shown open and folded closed') 접힌 상태에서 무엇이 무엇을 감싸는지 적지 않아, 생성 모델이 한 그림에 두 상태를 섞거나
 * (덮개가 하나 더 생긴 세 갈래) 작은 걸쇠를 갈고리로 키웠다(2.6·NB2.1 두 판 같은 꼴 — 모델이 아닌 입력 쪽). 상태가 하나인 상품은 쓸 일이 없다
 */
export const IDENTITY_STATES_RULE =
  'If the reference shows this one product in more than one state (for example unfolded and folded, or open and closed), it is still ONE product: ' +
  "list its parts once, then each state as 'State <name>: ...' — where the moving part goes and which part holds, wraps or covers which. " +
  'Say plainly when there is no separate cover, case or extra part, and keep small latches, pins and tips as small, few parts.'

/** 인쇄물이 아닌 카드 프롬프트(한 장·전 사진)의 'Rules:' 줄 앞에 상태 구분 문장을 끼운다. Rules 줄이 정확히 하나가 아니면 끝에 붙인다 */
export function withIdentityStates(prompt: string): string {
  const at = prompt.indexOf('\nRules:')
  if (at < 0 || prompt.indexOf('\nRules:', at + 1) >= 0) return `${prompt}\n${IDENTITY_STATES_RULE}`
  return `${prompt.slice(0, at)}\n${IDENTITY_STATES_RULE}${prompt.slice(at)}`
}

/** 식별 카드 세 프롬프트(한 장·전 사진·인쇄물 여러 장)의 끝맺음 줄 */
const IDENTITY_ANSWER_LINE = 'Answer with the description only, no preamble.'

/**
 * 쓰는 법 줄(usefacts 잡만, 결정 카드 c02·하네스 J18) — 카드는 생김새만 적어, 손·착용·사용 컷의 Use 재료가 카드 머리말 240자가 됐다
 * (K8 55/55, 실제 카드 표본 10/11). 같은 콜에 USE 줄을 따로 묻고(+30~60토큰) readIdentityCard가 꺼내 카드와 따로 둔다
 */
export const IDENTITY_USE_RULE =
  "Then, on its own line, write 'USE: ' and at most 25 words on how this product is really used: which part the hand grips or holds, " +
  'which side, face or end does the work and which way it faces, and where it is worn or attached. ' +
  "Write only what the photos show or the product's form makes certain, and write 'USE: none' when they do not. The USE line is not part of the description."

/** USE 줄을 묻는 카드의 끝맺음 줄 */
export const IDENTITY_USE_ANSWER_LINE = 'Answer with the description and the USE line only, no preamble.'

/** 카드 프롬프트 끝맺음 줄 자리에 USE 줄 요청을 끼운다. 끝맺음 줄이 없으면 끝에 붙인다 */
export function withIdentityUse(prompt: string): string {
  const at = prompt.lastIndexOf(IDENTITY_ANSWER_LINE)
  if (at < 0) return `${prompt}\n${IDENTITY_USE_RULE}\n${IDENTITY_USE_ANSWER_LINE}`
  return `${prompt.slice(0, at)}${IDENTITY_USE_RULE}\n${IDENTITY_USE_ANSWER_LINE}${prompt.slice(at + IDENTITY_ANSWER_LINE.length)}`
}

/**
 * 사진 역할 한 줄(photoroles 잡, 결정 카드 c12) — 부르는 쪽(source-photo-roles identityRoleLine)이 만든 줄을 'Rules:' 줄 앞에 끼운다.
 * Rules 줄이 정확히 하나가 아니면 끝에 붙인다(상태 구분 문장과 같은 규칙). 빈 줄이면 그대로
 */
export function withIdentityRoles(prompt: string, roleLine: string): string {
  const line = roleLine.trim()
  if (!line) return prompt
  const at = prompt.indexOf('\nRules:')
  if (at < 0 || prompt.indexOf('\nRules:', at + 1) >= 0) return `${prompt}\n${line}`
  return `${prompt.slice(0, at)}\n${line}${prompt.slice(at)}`
}

// ─────────────────────────────────────────────────────────────────
// 게이트 미달 재생성 지시문 — NEXFIT agents/image_gate_policy.py 전량
// 순수 텍스트 함수만 둔다 — 다른 모듈에 의존하지 않는다(원본 파일 docstring 원칙 그대로).
// ─────────────────────────────────────────────────────────────────

/** scale — K 라인 크기 판정 미달(실물 크기 11-05). NEXFIT 원본에 없는 사유라 size_plausible 칸으로만 정해진다(사유 글로 추측하지 않는다) */
export type GateFailureCode = 'baked_text' | 'baked_text_preserve' | 'structure' | 'stain' | 'brand' | 'scale' | 'use' | 'consistency'

export interface GateScoreRow {
  same_product?: boolean
  artifact_reason?: string | null
  /** K 라인 크기 판정 — false만 사유가 된다. 칸이 없으면(D 라인·예전 기록) 지금과 같다 */
  size_plausible?: boolean
  size_reason?: string | null
  /** K 라인 부품 판정(partsCheck) — false만 사유가 된다(structure). 칸이 없으면 지금과 같다 */
  parts_match?: boolean
  parts_reason?: string | null
  /** K 라인 사람·손 컷 사용 판정(useCheck) — false만 사유가 된다(use) */
  use_correct?: boolean
  use_reason?: string | null
}

// NEXFIT image_gate_policy.py:12-22 — 사유 분류 키워드(vision 판정의 artifact_reason, 영문/한글 혼재)
const GATE_TEXT_MARKERS = [
  'text',
  'letter',
  'word',
  'typo',
  'writing',
  'caption',
  'label',
  'korean',
  'hangul',
  'gibberish',
  'garbled',
  'misspell',
  '글자',
  '문자',
  '한글',
]
const GATE_STRUCTURE_MARKERS = [
  'shape',
  'structure',
  'different product',
  'not the same',
  'component',
  'part',
  'count',
  'tier',
  'drawer',
  'handle',
  'missing',
  'extra',
  '구조',
  '형태',
  '부품',
]
const GATE_STAIN_MARKERS = ['stain', 'dirt', 'grime', 'mold', 'blotch', 'discolor', '얼룩', '곰팡이']
const GATE_BRAND_MARKERS = ['brand', 'logo', 'trademark', '브랜드', '로고']

// NEXFIT image_gate_policy.py:24-54
const GATE_DIRECTIVES: Record<GateFailureCode, string> = {
  baked_text:
    'PREVIOUS ATTEMPT FAILED — rendered text appeared in the image. ' +
    'Do NOT draw any characters, words, numbers, captions, labels or watermarks anywhere ' +
    'in this image. No lettering on the product, the props, or the background.',
  baked_text_preserve:
    'PREVIOUS ATTEMPT FAILED — the lettering came out wrong. Reproduce the printed wording ' +
    'and artwork ON THE PRODUCT exactly as it appears in the reference image, character for ' +
    'character, and add no other text anywhere else in the frame.',
  structure:
    'PREVIOUS ATTEMPT FAILED — the product structure did not match the reference. ' +
    'Keep the number of tiers, drawers, parts and set pieces identical to the reference, ' +
    'keep moving parts (drawers, lids, hinges) in the same assembled state, and invent no ' +
    'components that are not visible in the reference.',
  stain:
    'PREVIOUS ATTEMPT FAILED — the product looked soiled. Render the product pristine and ' +
    'brand-new: no stains, dirt, grime, discoloration or mold-like marks anywhere. Clean foam, lather and water droplets from normal use may stay.',
  brand:
    'PREVIOUS ATTEMPT FAILED — a real-world brand name or logo appeared. All props, packaging ' +
    'and surfaces must be generic and unbranded, with no readable company names or logos.',
  // 실물 크기 11-05 — NEXFIT 원본 밖의 사유. 크기 줄은 컷 지시에 이미 있어 여기서는 키우지 말라는 것만 다시 말한다
  scale:
    'PREVIOUS ATTEMPT FAILED — the product was drawn at the wrong size next to hands, people or other objects. ' +
    'Keep the product at its real size and every hand, person and prop at theirs; to show the product larger, ' +
    'move the camera closer instead of enlarging the product.',
  // 점검 고침 3(오너 11-07) — NEXFIT 원본 밖의 사유. 쥐는 곳·작동면·방향·착용 부위
  use:
    'PREVIOUS ATTEMPT FAILED — the product was held, used or worn the wrong way. Hold it at its grip, keep its working side ' +
    'facing the way the reference photos show, and wear it on the body part it is made for, in the same orientation.',
  consistency:
    'PREVIOUS ATTEMPT FAILED — the generated product drifted from the reference. Match the ' +
    "reference product's shape, proportions, color and material exactly, and keep the page's " +
    'lighting and background tone consistent.',
}

/** 게이트 판정 행 → 사유 코드(baked_text | structure | stain | brand | scale | consistency). image_gate_policy.py:57-72 + K 라인 scale */
export function classifyGateFailure(scoreRow: GateScoreRow | null | undefined): Exclude<GateFailureCode, 'baked_text_preserve'> {
  const row = scoreRow ?? {}
  const reason = String(row.artifact_reason ?? '').toLowerCase()

  if (GATE_TEXT_MARKERS.some((marker) => reason.includes(marker))) return 'baked_text'
  if (GATE_STAIN_MARKERS.some((marker) => reason.includes(marker))) return 'stain'
  if (GATE_BRAND_MARKERS.some((marker) => reason.includes(marker))) return 'brand'
  if (GATE_STRUCTURE_MARKERS.some((marker) => reason.includes(marker))) return 'structure'
  if (row.same_product === false) return 'structure'
  if (row.parts_match === false) return 'structure'
  if (row.use_correct === false) return 'use'
  if (row.size_plausible === false) return 'scale'
  return 'consistency'
}

/** 재생성 프롬프트에 덧붙일 사유 반영 지시문. 판정 정보가 없으면 빈 문자열. image_gate_policy.py:75-82 */
export function buildRegenDirective(scoreRow: GateScoreRow | null | undefined, textBearing = false): string {
  if (!scoreRow) return ''
  let code: GateFailureCode = classifyGateFailure(scoreRow)
  if (code === 'baked_text' && textBearing) code = 'baked_text_preserve'
  const directive = GATE_DIRECTIVES[code] ?? ''
  // K 라인 부품·사용 판정은 무엇이 틀렸는지 한 줄을 더 싣는다(칸이 없는 D·예전 기록은 지금 글 그대로)
  const detail = code === 'structure' && scoreRow.parts_match === false ? scoreRow.parts_reason : code === 'use' ? scoreRow.use_reason : null
  const specific = String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return specific ? `${directive} Specifically: ${specific}.` : directive
}

/** 프롬프트 말미에 사유 지시문을 부착(중복 부착 방지). image_gate_policy.py:85-90 */
export function applyRegenDirective(prompt: string, scoreRow: GateScoreRow | null | undefined, textBearing = false): string {
  const directive = buildRegenDirective(scoreRow, textBearing)
  if (!directive || prompt.includes(directive)) return prompt
  return `${prompt}\n\n${directive}`
}
