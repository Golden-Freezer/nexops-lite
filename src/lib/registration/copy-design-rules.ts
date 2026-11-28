/**
 * D 라인 카피 규칙(적용 T1-16 D·T1-45 D) — 디자인 컷 잡에서만 붙는다(pdp-pipeline의 designcutEnabled). R 프롬프트는 바이트까지 그대로다(R 코드 동결, 오너 2026-11-02).
 * - 후킹 기본값: 첫 화면은 쓰는 장면·약속·수치 중 하나로 연다. 고민 시작은 고민이 곧 구매 이유일 때 허용한다(연구 A1 #5: 먼저 읽히는 것에 고민 4%). 효과는 V2 전까지 재지 못했다.
 *   D2 첫 화면은 제목·보조 말고 mainIntro.hook도 그린다(heroText). R17-L 저장 11잡에서 질문형은 제목·보조 0건, hook 5건이라 hook을 함께 가리킨다.
 * - 고민-POINT 짝: 고민 줄마다 답이 되는 POINT 하나, 입력에 없는 고민 금지, 질문 → 전환 한 줄 → 효익(연구 A1 #12·L6 #9). POINT 순서는 건드리지 않는다.
 * 체감 효익은 막지 않는다. 규제 표현 규칙은 기존 주장 범위 블록이 맡는다.
 */

import { ACCENT_MAX_CHARS, acceptAccent } from './editor/utils/sectionConverter/designCut/accent'
import type { CopywritingResult } from './pdp-state'

/** Stage 1 전략 지시의 hook_mode 덮어쓰기 — '호기심'·'공감'과 값이 없을 때만 바꾼다. 충격·증거·권위는 이미 사실로 연다 */
export const DESIGN_HOOK_MODE_BLOCKS: Readonly<Record<string, string>> = {
  curiosity:
    "후킹 모드는 '호기심'입니다. 답을 숨기는 질문 대신 쓰는 장면·약속·수치 중 하나로 첫 화면 카피를 여세요. 수치는 입력에 있는 값만 쓰세요. 고민 질문은 그 고민이 곧 구매 이유일 때만 쓰세요.",
  empathy: "후킹 모드는 '공감'입니다. 타겟이 이 상품을 쓰는 장면이나 겪는 상황으로 첫 화면 카피를 여세요. 고민 질문은 그 고민이 곧 구매 이유일 때만 쓰세요.",
  default: '첫 화면 카피는 쓰는 장면·약속·수치 중 하나로 여세요. 수치는 입력에 있는 값만 쓰세요.',
}

const RULES = [
  'mainIntro.hook과 mainIntro.benefitHeadline은 쓰는 장면·약속·수치 중 하나로 시작한다. 수치는 입력에 있는 값만 쓴다. 고민 질문은 그 고민이 곧 구매 이유일 때만 쓰고, 답을 숨기는 미완성 문장은 쓰지 않는다.',
  'problem.empathyLines 한 줄마다 답이 되는 pointCards 하나가 있어야 한다. 같은 번호끼리 짝을 맞추되 pointCards 순서는 바꾸지 않고 고민 줄을 고친다.',
  '입력(상품 정보·후기·고민 분석)에 없는 고민을 쓰지 않는다. 답할 카드가 없는 고민은 답할 수 있는 고민으로 바꾼다.',
  'problem.question → solution.declaration(전환 한 줄) → pointCards 효익 순서로 읽히게 쓴다. 쓰면서 느끼는 효익은 살린다.',
]

/** Stage 2 쓰기 지시(디자인 컷 잡) — 사실 값 블록보다 앞에 붙는다 */
export const DESIGN_COPY_WRITE_BLOCK = ['## [첫 화면과 고민-POINT 짝]', ...RULES.map((rule) => `- ${rule}`)].join('\n')

const FIRST_SCREEN_FIELDS = ['hook', 'benefitHeadline', 'subBenefit'] as const
/** 물음표나 묻는 끝말. 낱말 근사라 '있죠' 같은 말은 세지 않는다 */
const QUESTION = /[?？]\s*$|(?:나요|까요|까|인가요|신가요|던가요)\s*$/

/** 첫 화면 칸 중 질문으로 끝나는 칸 — 저장 글과 V2 글을 비교하는 재기 함수다. 고민 시작은 허용이라 고칠 곳에 넣지 않는다 */
export function firstScreenQuestions(copy: CopywritingResult | null | undefined): Array<(typeof FIRST_SCREEN_FIELDS)[number]> {
  const intro = copy?.mainIntro
  return FIRST_SCREEN_FIELDS.filter((field) => {
    const text = intro?.[field]
    return typeof text === 'string' && QUESTION.test(text.trim())
  })
}

/**
 * 제목 강조 구절 쓰기 지시(적용 T1-17 D, 연구 A2 6-1) — 디자인 컷 잡의 Stage 2에만 붙는다. 모델은 제목마다 강조할 구절을 고르고, 디자인 컷
 * 계획이 제목의 부분 문자열·8자 이하·제목 전체 아님을 다시 검사한다. 어기거나 빠진 제목은 지금 규칙(수량 → POINT 낱말)으로 칠한다
 */
export const DESIGN_ACCENT_WRITE_BLOCK = [
  '## [제목 강조 구절]',
  '- 답 JSON 최상위에 "headlineAccents"를 더한다. 키는 큰 제목으로 쓰는 칸의 글 그대로(mainIntro.benefitHeadline·problem.question·solution.declaration·pointCards[].title·detailPoints[].claim·closingCta.headline), 값은 그 제목 안에서 색으로 강조할 구절 하나다.',
  `- 구절은 제목 글자를 그대로 옮긴 일부이고, 공백을 빼고 ${ACCENT_MAX_CHARS}자 이하이며, 제목 전체는 안 된다. 고객이 얻는 효익이나 입력에 있는 수치가 담긴 말을 고른다.`,
  '- 강조할 말이 없는 제목은 넣지 않는다. 구절을 위해 제목을 바꾸지 않는다.',
  '- 예: "headlineAccents": {"아침 준비가 5분 빨라져요": "5분 빨라져요"}',
].join('\n')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bare = (s: string) => s.replace(/[\s\u00A0]+/g, '')

/**
 * Stage 3가 headlineAccents 칸을 빼고 답하면 Stage 2 값을 이어 붙인다(검수는 다른 칸을 고치는 단계다). Stage 3가 제목을 고쳤으면 키가 맞지 않아
 * 그 제목은 지금 규칙으로 돌아간다. 디자인 컷 잡(designRules)에서만 부른다
 */
export function keepStage2Accents(stage3: Record<string, unknown>, stage2: Record<string, unknown>): Record<string, unknown> {
  return isRecord(stage2.headlineAccents) && !isRecord(stage3.headlineAccents) ? { ...stage3, headlineAccents: stage2.headlineAccents } : stage3
}

/** 계획 제목의 강조 구절 — 키는 공백을 빼고 맞춘다. 맞는 키가 없거나 구절이 검사를 못 넘으면 null(지금 규칙) */
export function headlineAccentOf(headline: string | null | undefined, accents: unknown): string | null {
  if (!headline || !isRecord(accents)) return null
  const key = bare(headline)
  const hit = Object.entries(accents).find(([title]) => bare(title) === key)
  return hit ? acceptAccent(headline, hit[1]) : null
}
