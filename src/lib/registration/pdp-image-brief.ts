/**
 * 이미지 브리프 정리(E4)·지시 격리(P1-5) — 조립이 끝난 컷 프롬프트를 생성 직전에 한 번 다듬는다. 잡 스위치 brief(기본 off)가
 * 켜진 잡만 쓴다(pdp-image-stage generateSection). 근거: 코덱스 이미지 내부 보고서(2026-10-30) §4 '브리프가 중복되고 서로 충돌'.
 *
 * 원문 상수는 고치지 않는다(NEXFIT 이식 원본 보존). 조립 결과에서 겹치거나 서로 부딪히는 줄만 걷어내고, 우선순위 한 줄을 더한다.
 * 단계(실제로 바꾼 단계만 steps에 남는다):
 * - checklist: 'VERIFICATION CHECKLIST … REGENERATE' — 한 번에 한 장 만드는 생성기는 스스로 다시 만들지 못한다(재생성은 게이트 몫)
 * - generic-consistency: 상품별 일관성 규칙이 있으면 일반 규칙 블록을 뺀다
 * - printed-logo: 인쇄 디자인 보존 상품이면 '인쇄 글자를 지우라'는 LOGO/LABEL 규칙을 보존 쪽으로 바꾼다
 * - duplicate: 같은 블록·같은 문단이 두 번 이상이면 처음 것만 남긴다
 * - aspect: 크기 인자를 지키는 생성기(OpenAI·코덱스)면 'Aspect Ratio' 줄을 뺀다(3:4 줄이 1024x1536과 부딪혔다)
 * - text-layout: 모바일 글자 크기·역할별 글자 px 레시피 블록 — 사진 컷 안에는 글자를 두지 않는다(글자는 HTML)
 * - lighting: 스타일 헌장이 있으면 일반 조명·색온도 줄을 빼고, 다른 줄과 다르면 헌장을 따르라고 적는다
 * - identity: 식별 카드가 있으면 장면 묘사와 다를 때 식별 카드·첫 참조 사진을 따르라고 적는다
 * - isolate: 글자 규칙을 끝의 TEXT RULE 한 곳으로 모으고, 나머지를 '그리지 말 것' 지시 블록으로 감싼다(P1-5).
 *   글자 규칙이 없는 프롬프트는 감싸지 않는다(그 컷의 글자 방침을 이 함수가 새로 정하지 않는다)
 */

import {
  IP_PROTECTION_RULES,
  KOREAN_CONTEXT_GUARD,
  KOREAN_MODEL_INSTRUCTION,
  NO_TEXT_INSTRUCTION,
  NO_TEXT_PHRASES,
  PRINTED_DESIGN_PRESERVE_INSTRUCTION,
  PRODUCT_CONSISTENCY_RULES,
} from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { DIRECTOR_LIGHT_RULE } from './pdp-image-light'

export type BriefTidyStep =
  | 'checklist'
  | 'generic-consistency'
  | 'printed-logo'
  | 'duplicate'
  | 'aspect'
  | 'text-layout'
  | 'lighting'
  | 'identity'
  | 'isolate'

export interface BriefTidyOptions {
  /** 생성기가 크기 인자를 지키는지 — OpenAI·코덱스는 참, Gemini는 크기를 받지 않아 비율 줄을 남긴다 */
  sizeHonored: boolean
}

export interface BriefTidyResult {
  prompt: string
  steps: BriefTidyStep[]
}

const CONSISTENCY_HEADER = 'PRODUCT CONSISTENCY RULES (ABSOLUTE):'
/** 일반 일관성 규칙 본문(체크리스트 앞까지) — 상품별 규칙이 따로 있을 때 뺀다 */
const GENERIC_CONSISTENCY = PRODUCT_CONSISTENCY_RULES.split('VERIFICATION CHECKLIST')[0].trim()
const CHECKLIST = /^[ \t]*VERIFICATION CHECKLIST[^\n]*\n(?:[ \t]*-[^\n]*\n|[ \t]*\n)*?[ \t]*If ANY checklist fails[^\n]*(?:\n|$)/gim
const LOGO_RULE = /^([ \t]*)3\. LOGO\/LABEL:[^\n]*(?:\n[ \t]{2,}(?!\d+\.)[^\n]*)*/gm
const PRINTED_LOGO_RULE = '3. LOGO/LABEL: Keep the printed artwork and lettering exactly as in the reference (see TEXT RULE).'
const ASPECT_LINE = /^[ \t]*(?:- )?Aspect Ratio:[ \t]*\d+(?:\.\d+)?:\d+[^\n]*(?:\n|$)/gim
/** 글자 배치용 코퍼스 블록 머리(corpus.ts·corpus-v2.ts) — 사진 컷과 무관 */
const TEXT_LAYOUT_HEADS = ['[모바일 판독 기준]', '[실측 디자인 레시피', '[카테고리 집계 연출 패턴']
const MARKET_PREAMBLE_HEAD = '아래는 시장 관행 참고 자료다.'
/** 전문 사진 지시(PHOTOGRAPHY_BASE_COMMON)의 일반 조명·색온도 줄 — 스타일 헌장과 부딪힌다 */
const GENERIC_LIGHTING_LINES = [
  '- Lighting: large softbox at 45-degree angle (key), white reflector fill, strip/rim light for edge separation',
  '- Color temperature: 5500K daylight balanced, no color cast',
]
const CHARTER_HEAD = 'GLOBAL STYLE CHARTER'
const CHARTER_LAST = 'This image is one of many images on a single product page sharing this exact charter.'
const CHARTER_WINS = 'Where any other line of this brief names a light source, color temperature or background, follow this charter.'
const IDENTITY_WINS =
  'Where the scene description differs from this identity (shape, legs or stands, part count), follow this identity and the first reference photo.'
/** 글자를 허용하는 일반 줄 — TEXT RULE 한 곳과 부딪힌다(사진 지시·소품 규칙) */
const TEXT_PERMIT_LINES = [
  '- Text on products must be legible and correctly spelled (or omitted entirely)',
  '- Any text that appears must be generic Korean (Hangul), correctly spelled, or omitted.',
  '- Do NOT include Chinese characters (Hanzi/Kanji), Japanese text, or non-Korean text.',
]
/** 장면 연출 머리의 내부 섹션 이름(예: how_to_guide) — 그려질 수 있는 메타데이터라 뺀다 */
const SHOT_HEADER = /^\[Shot direction — [^\]\n]+\]$/gm
export const BRIEF_NOTES_OPEN =
  'BRIEF NOTES — direction for you, not image content. Do not draw words from these notes as visible text ' +
  '(product names, Korean phrases, section names, mood words, hex codes, numbers); letters appear only as the TEXT RULE below allows.'
export const BRIEF_NOTES_CLOSE = 'END OF BRIEF NOTES'
export const TEXT_RULE_HEAD = 'TEXT RULE (the only rule for letters in this image):'

/** 블록이 여러 번 나오면 처음 것만 남긴다 */
function keepFirst(text: string, block: string): string {
  const at = text.indexOf(block)
  if (at < 0) return text
  const end = at + block.length
  return text.slice(0, end) + text.slice(end).split(block).join('')
}

const paragraphs = (text: string) => text.split(/\n[ \t]*\n/)
const dropLines = (text: string, lines: readonly string[]) =>
  text
    .split('\n')
    .filter((line) => !lines.includes(line.trim()))
    .join('\n')

function dedupeParagraphs(text: string): string {
  const seen = new Set<string>()
  return paragraphs(text)
    .filter((p) => {
      const key = p.replace(/\s+/g, ' ').trim()
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n\n')
}

function dropTextLayout(text: string): string {
  const kept = paragraphs(text).filter((p) => !TEXT_LAYOUT_HEADS.some((head) => p.trim().startsWith(head)))
  // 시장 자료 머리말 뒤에 아무것도 남지 않으면 머리말도 뺀다
  const last = kept.findLastIndex((p) => p.trim())
  if (last >= 0 && kept[last].trim().startsWith(MARKET_PREAMBLE_HEAD)) kept.splice(last, 1)
  return kept.join('\n\n')
}

function charterWins(text: string): string {
  if (!text.includes(CHARTER_HEAD)) return text
  const out = dropLines(text, GENERIC_LIGHTING_LINES)
  // 빛 정리(light)가 연출 감독 줄을 이 컷의 빛 정본으로 둔 컷은 '헌장을 따르라'를 더하지 않는다(결정 카드 c15 — 두 규칙이 부딪힌다)
  if (out.includes(CHARTER_WINS) || out.includes(DIRECTOR_LIGHT_RULE) || !out.includes(CHARTER_LAST)) return out
  return out.replace(CHARTER_LAST, `${CHARTER_LAST}\n${CHARTER_WINS}`)
}

function identityWins(text: string): string {
  if (text.includes(IDENTITY_WINS)) return text
  return text.replace(/^PRODUCT IDENTITY \([^\n]*/m, (line) => `${line.trimEnd()} ${IDENTITY_WINS}`)
}

/** 이 프롬프트의 글자 규칙 — 인쇄 디자인 보존이 일괄 금지보다 앞선다(applyTextPolicy와 같은 판단) */
function textRuleOf(text: string): string | null {
  if (text.includes(PRINTED_DESIGN_PRESERVE_INSTRUCTION)) return PRINTED_DESIGN_PRESERVE_INSTRUCTION
  return NO_TEXT_PHRASES.some((phrase) => text.includes(phrase)) ? NO_TEXT_INSTRUCTION : null
}

function isolate(text: string): string {
  const rule = textRuleOf(text)
  if (!rule) return text
  let body = text
  for (const block of [PRINTED_DESIGN_PRESERVE_INSTRUCTION, ...NO_TEXT_PHRASES, KOREAN_CONTEXT_GUARD]) body = body.split(block).join('')
  body = dropLines(body, TEXT_PERMIT_LINES).replace(SHOT_HEADER, '[Shot direction]')
  return [BRIEF_NOTES_OPEN, tidyBlankLines(body), BRIEF_NOTES_CLOSE, `${TEXT_RULE_HEAD}\n${rule}`].join('\n\n')
}

function tidyBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 조립된 컷 프롬프트 → 정리된 브리프. 같은 입력이면 같은 출력(두 번 돌려도 그대로) */
export function tidyImageBrief(prompt: string, options: BriefTidyOptions): BriefTidyResult {
  const steps: BriefTidyStep[] = []
  let text = tidyBlankLines(prompt)
  if (text.startsWith(BRIEF_NOTES_OPEN)) return { prompt: text, steps }
  const printed = text.includes(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
  const run = (step: BriefTidyStep, fn: (t: string) => string) => {
    const next = tidyBlankLines(fn(text))
    if (next !== text) steps.push(step)
    text = next
  }
  run('checklist', (t) => t.replace(CHECKLIST, ''))
  run('generic-consistency', (t) => (t.split(CONSISTENCY_HEADER).length > 2 ? t.split(GENERIC_CONSISTENCY).join('') : t))
  run('printed-logo', (t) => (printed ? t.replace(LOGO_RULE, (_m, indent: string) => `${indent}${PRINTED_LOGO_RULE}`) : t))
  run('duplicate', (t) =>
    dedupeParagraphs(
      [PRINTED_DESIGN_PRESERVE_INSTRUCTION, IP_PROTECTION_RULES, NO_TEXT_INSTRUCTION, KOREAN_MODEL_INSTRUCTION, KOREAN_CONTEXT_GUARD].reduce(
        keepFirst,
        t
      )
    )
  )
  run('aspect', (t) => (options.sizeHonored ? t.replace(ASPECT_LINE, '') : t))
  run('text-layout', dropTextLayout)
  run('lighting', charterWins)
  run('identity', identityWins)
  run('isolate', isolate)
  return { prompt: text, steps }
}
