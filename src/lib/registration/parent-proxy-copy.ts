/**
 * 학부모 대리 구매형(parent_proxy) 2단계 — 기본 페르소나·카피 지시·이미지 지시·산출 뒤 검사. 순수 함수, LLM 0.
 * 판정·기록은 parent-proxy.ts, 연결(analysis 기록·단계 spec·카피 재작성·이미지 grounding)은 pdp-enrichment-stage·pdp-pipeline·
 * pdp-image-stage가 한다. 기록(analysis.enrichment.audience)이 있는 잡만 달라진다.
 *
 * 오너 결정 (A, 2026-10-30): '어린이집·유치원 답례' 같은 말은 구매 상황 설명(추천 대상·사용 장면)으로만 쓰고, 아이가 쓰거나 반응하는
 * 장면은 쓰지 않는다. 연령 게이트(ageGate)가 켜진 잡은 게이트 규칙이 우선이라 행사 이름도 쓰지 않고, 검사·재작성은 게이트가 맡는다.
 * 체감 효익은 살린다(준비 시간·인원수·이름 쓰기·마무리를 구체적으로).
 */

import type { AudienceRecord } from './parent-proxy'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

/** targetPersona가 빈 잡에 넣는 기본 페르소나 — 게이트 잡은 아이·기관 낱말 없이 */
export const PARENT_PROXY_PERSONA =
  '어린이집·유치원 생일·행사 답례품을 반 인원수만큼 준비하는 학부모 — 바쁜 중에도 짧은 시간에 정성 있어 보이게 포장을 끝내고 싶다'
export const PARENT_PROXY_PERSONA_GATED =
  '생일·행사 답례품을 단체 인원수만큼 준비하는 학부모 — 바쁜 중에도 짧은 시간에 정성 있어 보이게 포장을 끝내고 싶다'

/** 기록 잡이고 targetPersona가 비었을 때만 기본 페르소나를 채운 spec — 아니면 같은 객체(저장하지 않는다, 단계 입력용) */
export function withAudiencePersona(spec: PdpSpecSheet, audience: AudienceRecord | null): PdpSpecSheet {
  if (!audience || spec.targetPersona?.trim()) return spec
  return { ...spec, targetPersona: audience.ageGate ? PARENT_PROXY_PERSONA_GATED : PARENT_PROXY_PERSONA }
}

/** 카피 grounding 블록 — 연령 블록 앞에 둔다(게이트 잡은 연령 블록이 마지막에 우선한다) */
export function buildParentProxyCopyBlock(audience: AudienceRecord | null): string | null {
  if (!audience) return null
  const scene = audience.ageGate
    ? '- 생일·행사 답례는 "준비하는 어른의 상황"으로만 쓴다(연령 제한 블록의 금지어는 행사 이름에도 쓰지 않는다).'
    : '- "어린이집·유치원 생일 답례" 같은 말은 구매 상황 설명(추천 대상·사용 장면)으로만 쓴다.'
  return [
    '[학부모 대리 구매형 — 화자·장면] 이 상품은 학부모가 답례품으로 준비해 건네는 물건이다(어린이 KC 인증 제품 아님).',
    '- 화자와 주어는 준비하는 어른이다. 고민·해결·사용법·추천 대상을 모두 어른이 준비하는 장면으로 쓴다.',
    scene,
    '- 아이가 상품을 쓰거나 만지는 문장("아이와 함께 붙여요"), 아이 반응을 단정하는 문장("아이들이 좋아해요")을 쓰지 않는다.',
    '- imageHint·사용 장면 태그에 아이를 등장시키지 않는다 — 어른의 손과 준비된 답례품(줄지어 놓인 꾸러미 등)만.',
    '- 리뷰 인용은 아이 반응보다 준비한 어른의 편의가 담긴 문장을 먼저 고른다.',
    '- 학부모의 편의를 상품 사실 범위 안에서 구체적으로: 준비 시간, 반 인원수에 맞는 수량, 이름 쓰기, 마무리 방법.',
    '- 섹션 주제: 고민=준비 시간·인원수·이름 쓰기, 해결=간단한 마무리, 사용법=준비 순서, 옵션=인원수에 맞는 수량, 추천 대상=학부모 상황.',
  ].join('\n')
}

/** 이미지 grounding 블록 글 — MS 지시 맞추기(ms-prompt-shorten)가 같은 글을 찾아 짧은 판으로 바꾼다 */
export const PARENT_PREP_IMAGE_BLOCK =
  '[PARENT-PREP SCENE - MANDATORY] Parents prepare this product as party favors to hand out. ' +
  "Show only adults' hands and the prepared result (e.g. sealed favor bags lined up on a table, bundles packed in a carry bag). " +
  'Do NOT depict children, kids, babies, or minors anywhere in the image, including the background, photos on walls, or reflections. ' +
  'No classroom or party scenes with children.'

/**
 * 상품 없는 컷(목적 problem — 고민·비교 왼쪽, J49 decide 24)의 학부모 장면 블록 — '준비된 결과(답례 봉투 등)' 예시가 상품을 불러 빼고,
 * 어른 손만·아이 금지는 그대로 둔다. 원래 블록보다 짧아 MS 짧은 판(ms-prompt-shorten parent)이 없어도 된다
 */
export const PARENT_PREP_NO_PRODUCT_BLOCK =
  '[PARENT-PREP SCENE - MANDATORY] Adults prepare party favors to hand out. ' +
  "Show only adults' hands. " +
  'Do NOT depict children, kids, babies, or minors anywhere in the image, including the background, photos on walls, or reflections. ' +
  'No classroom or party scenes with children.'

/** 바탕 블록 속 학부모 장면 블록을 상품 없는 컷 판으로 — 블록이 없으면(학부모 대리 잡이 아님) 받은 글 그대로 */
export function withoutPreparedResult(grounding: string): string {
  return grounding.split(PARENT_PREP_IMAGE_BLOCK).join(PARENT_PREP_NO_PRODUCT_BLOCK)
}

/** 이미지 grounding 블록 — 전 컷 공통(연출 컷·플레이트 포함). 아이는 배경에도 두지 않는다 */
export function buildParentProxyImageBlock(audience: AudienceRecord | null): string | null {
  if (!audience) return null
  return PARENT_PREP_IMAGE_BLOCK
}

// ── 산출 뒤 검사 ──

/** 아이 지칭 — '아이' 복합어(아이템·아이보리…)·'딸기'·'아기자기'·'어린이집'(행사 맥락)은 뺀다 */
const CHILD = '(?:우리\\s*)?(?:아이(?!템|디|폰|콘|스|섀|라이너|메이크|보리|고)들?|자녀|아들|딸(?!기)|어린이(?!집)|아기(?!자기)|유아|꼬마)'
/** 조사는 낱말에 붙어 있고 뒤가 띄어쓰기·문장부호여야 한다 — '아이 이름'의 '이'·'아이 과자'의 '과'를 조사로 읽지 않게 */
const PARTICLE_END = '(?=[\\s,.!?~#]|$)'
const SUBJECT = `${CHILD}(?:이|가|도|는|들이|들도|들은)${PARTICLE_END}\\s*(?:\\S+\\s*){0,2}?`
const USE_VERB = '(?:붙|꾸미|꾸며|만들|가지고|놀|사용|쓰|써|떼|뜯|고르|골라|열어|색칠)'
const REACTION = '(?:좋아|신나|신이|즐거|즐겨|행복|기뻐|웃|반하|반해|설레|만족|환호|감동)'
/** 아이가 함께 쓰는 사람·쓰는 사람·반응하는 사람으로 나오는 문장 — 좁게 잡는다('아이 생일 답례'·'아이 이름 쓰기'는 걸리지 않는다) */
const CHILD_USE_PATTERNS: Array<{ kind: Exclude<ChildUseKind, '이미지 지시'>; re: RegExp }> = [
  { kind: '함께 사용', re: new RegExp(`${CHILD}(?:와|과|랑|이랑|하고)(?=[\\s,.!?~#]|함께|같이|나란히|$)`) },
  { kind: '아이 사용', re: new RegExp(`${SUBJECT}${USE_VERB}`) },
  { kind: '아이 반응', re: new RegExp(`${SUBJECT}${REACTION}`) },
]
const CHILD_ANY = new RegExp(`${CHILD}|어린이집|유치원|\\b(?:child|children|kid|kids|toddler|baby|babies|kindergarten)\\b`, 'i')
/** 이미지 지시 칸 — 아이가 나오기만 해도 위반 */
const IMAGE_HINT_KEYS = new Set(['imageHint', 'image_hint', 'imagePrompt'])
/** 리뷰 원문 발췌는 재작성할 수 없어 검사하지 않는다(연령 게이트 잡은 게이트가 지운다) */
const SKIP_KEYS = new Set(['reviewHighlights'])

export type ChildUseKind = '함께 사용' | '아이 사용' | '아이 반응' | '이미지 지시'

export interface ChildUseFinding {
  section: string
  kind: ChildUseKind
  sentence: string
}

/** 글 한 줄이 아이가 함께 쓰거나·쓰거나·반응하는 문장인가 — 그 종류, 아니면 null. K 칸 글 가드(결정 카드 c03)도 같은 판정을 쓴다 */
export function childUseKindOf(text: string): Exclude<ChildUseKind, '이미지 지시'> | null {
  return CHILD_USE_PATTERNS.find((p) => p.re.test(text))?.kind ?? null
}

function collect(value: unknown, section: string, key: string, out: ChildUseFinding[]): void {
  if (typeof value === 'string') {
    const sentence = value.length > 80 ? `${value.slice(0, 80)}…` : value
    if (IMAGE_HINT_KEYS.has(key)) {
      if (CHILD_ANY.test(value)) out.push({ section, kind: '이미지 지시', sentence })
      return
    }
    const kind = childUseKindOf(value)
    if (kind) out.push({ section, kind, sentence })
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, section, key, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!SKIP_KEYS.has(k)) collect(v, section, k, out)
    }
  }
}

/** 최종 카피에서 아이 사용·반응 단정 문장과 아이가 나오는 이미지 지시를 찾는다(리뷰 발췌 제외) */
export function findChildUseLines(copy: CopywritingResult): ChildUseFinding[] {
  const out: ChildUseFinding[] = []
  for (const [section, value] of Object.entries(copy)) {
    if (!SKIP_KEYS.has(section)) collect(value, section, section, out)
  }
  return out
}

/** 재작성 지시 — 걸린 문장을 보여 주고 같은 소구를 준비하는 어른 시점으로 다시 쓰게 한다(1회) */
export function buildParentProxyRewriteDirective(findings: ChildUseFinding[]): string {
  const lines = findings.slice(0, 15).map((f) => `- [${f.section}] "${f.sentence}" (${f.kind})`)
  return (
    '[학부모 시점 재작성 지시] 아래 문장은 아이가 상품을 쓰거나 반응하는 장면, 또는 아이가 나오는 이미지 지시다. ' +
    '같은 소구를 준비하는 어른의 편의(준비 시간·인원수·이름 쓰기·마무리)로 다시 쓰고, 이미지 지시는 어른의 손과 준비된 답례품만 보이게 고쳐라. ' +
    '행사 이름은 구매 상황 설명으로만 남겨도 된다:\n' +
    lines.join('\n')
  )
}
