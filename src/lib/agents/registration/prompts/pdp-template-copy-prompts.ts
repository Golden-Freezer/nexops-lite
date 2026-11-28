/**
 * K 라인 슬롯 카피 프롬프트(M5, H5) — 레이아웃은 정해져 있고 칸 안의 글만 쓴다. 칸 상한·사실 칸은 코드가 다시 검사한다(templatelib/slot-copy.ts).
 */

import { iconChoices } from '@/lib/registration/templatelib/icons'
import { K_TYPE } from '@/lib/registration/templatelib/engine'
import { ACCENT_MAX_CHARS } from '@/lib/registration/editor/utils/sectionConverter/designCut/accent'
import { ACCENT_KEY, HOOK_SECTION, hookCopyLimits, type CopyField, type CopySlot, type SlotProblem } from '@/lib/registration/templatelib/slot-copy'
import { lineCharsOf } from '@/lib/registration/templatelib/slot-lines'
import { POINT_STEP_SLOT } from '@/lib/registration/templatelib/template-types'
import { parseRegistrationJson } from '../llm-json'
import { CONCERN_PAIR_RULE, CONCERN_SECTIONS, COPY_COMMON_RULES, sectionGuideLine } from './pdp-template-copy-guide'
import { planBlock, sectionExtras, storyBlock, type SlotCopyPlan, type SlotCopyStory } from './pdp-template-copy-story'
import { SECTION_PURPOSES, type Guideline, type TemplateProductBrief } from './pdp-template-prompts'

export const SLOT_COPY_SYSTEM =
  'You write Korean copy for fixed slots of an e-commerce detail page. Use only the listed facts, never exceed slot limits, and respond only with the requested JSON.'

export interface SlotCopySection {
  index: number
  section: string
  /** 이 섹션이 새로 말할 사실 수 */
  factSlots: number
  slots: readonly CopySlot[]
  /** 템플릿 칸 안내 한 줄(정보 칸만, templatelib/info-cells infoCellCopyNote) — 없으면 섹션 설명이 지금 그대로다 */
  note?: string
}

export interface SlotCopyInput {
  product: TemplateProductBrief
  guideline: Pick<Guideline, 'persona' | 'tone'>
  /** 기획 1장(pageplan 잡만, 결정 카드 c10·J28 — 기본 off) — 약속·고객·첫 화면 약속 블록과 섹션 번호마다 할 말. 없으면 프롬프트가 이 칸 전과 글자까지 같다 */
  pagePlan?: SlotCopyPlan
  /** 원문 카피 줄(copystory 잡만, J36·J28 — 기본 off) — 섹션 번호마다 앞 단계 카피 줄. 없으면 프롬프트가 이 칸 전과 글자까지 같다 */
  copyStory?: SlotCopyStory
  /** 실을 수 있는 사실 — 규제 표현이 든 값은 이미 빠졌다 */
  facts: readonly string[]
  /** 판매자 입력 그대로 쓸 값 줄('- 크기: …', specfixed 잡만, 결정 카드 c27·J23 — 기본 off). 없거나 비면 프롬프트가 이 칸 전과 글자까지 같다 */
  fixedValues?: readonly string[]
  sections: readonly SlotCopySection[]
  /**
   * 첫 화면 사진이 보여 줄 것(hookhero 잡만, 결정 카드 c09·J21 — 기본 off). 있으면 첫 화면 규칙에 '이 사진과 같은 약속' 한 줄이 붙는다.
   * 없으면 프롬프트가 이 칸 전과 글자까지 같다
   */
  heroShot?: string
  /**
   * 화면 글 가드 블록(결정 카드 c03) — 학부모 대리 구매·후기 사용 범위·연령 제한 블록(D 카피와 같은 함수, kline-copy-guard.ts). 규칙 뒤에 붙는다.
   * 없는 잡은 프롬프트가 바이트 그대로다
   */
  guardBlock?: string
}

/** 아이콘 칸은 글자 수가 아니라 이름 하나다 */
const fieldLimits = (field: CopyField) =>
  field.choices === 'icon'
    ? ['아이콘 이름 하나']
    : [
        field.maxChars !== undefined ? `${field.maxChars}자` : null,
        field.maxLines !== undefined ? `${field.maxLines}줄` : null,
        field.lineToken && field.lineWidth !== undefined ? `한 줄 ${lineCharsOf(K_TYPE[field.lineToken], field.lineWidth)}자` : null,
      ]
const describeField = (field: CopyField) =>
  `${field.name}(${[field.required ? '필수' : '선택', field.accent ? '강조' : null, ...fieldLimits(field), field.facts > 0 ? `사실 ${field.facts}` : '사실 없음']
    .filter(Boolean)
    .join(', ')})`

function describeSlot(slot: CopySlot): string {
  if (slot.tags) return `  - ${slot.name}: 이름표 글 목록 ${slot.tags.min}~${slot.tags.max}개${slot.required ? '(필수)' : '(선택)'}, 한 개 ${slot.maxChars}자, 사실 없음`
  if (!slot.list) return `  - ${describeField(slot)}`
  return `  - ${slot.name}: 목록 ${slot.list.min}~${slot.list.max}개${slot.required ? '(필수)' : '(선택)'}, 항목마다 ${slot.list.fields.map(describeField).join(' · ')}`
}

function describeSection(section: SlotCopySection): string {
  const guide = sectionGuideLine(section.section)
  return [
    `[${section.index}] ${section.section} — ${SECTION_PURPOSES[section.section] ?? section.section} — 사실 칸 ${section.factSlots}개`,
    ...(guide ? [guide] : []),
    ...(section.note ? [section.note] : []),
    ...section.slots.map(describeSlot),
  ].join('\n')
}

/** 첫 화면 규칙 — 이번 콜에 첫 화면이 있을 때만(고치기 콜이 다른 섹션만 부를 때는 빠진다) */
function hookRule(sections: readonly SlotCopySection[], heroShot?: string): string {
  if (!sections.some((section) => section.section === HOOK_SECTION)) return ''
  const { headline, sub } = hookCopyLimits()
  // hookhero 잡만 — 첫 화면 글과 대표 사진이 같은 약속을 하게 한다(사진에 없는 장면·효익을 약속하지 않는다)
  const shot = heroShot ? `\n- 첫 화면 사진은 ${heroShot}이다. 첫 화면 headline은 이 사진이 보여 줄 장면과 같은 약속 하나로 쓰고, 사진에 나오지 않는 장면·효익을 약속하지 않는다.` : ''
  return `\n- 첫 화면(${HOOK_SECTION})은 1~3초 안에 읽혀야 한다. headline은 ${headline.lines}줄까지, 한 줄 ${headline.perLine}자 안팎으로 쓰고 두 줄이면 의미 단위에서 \\n으로 끊는다. sub는 ${sub.lines}줄이고 없어도 되면 뺀다. 글자 수는 칸에 적힌 상한을 지키고, 문장을 늘어놓지 않는다.${shot}`
}

/** 고민 칸이 있는 콜에만 붙는다 — 다른 페이지의 프롬프트를 바꾸지 않는다 */
const pairRule = (sections: readonly SlotCopySection[]) => (sections.some((section) => CONCERN_SECTIONS.has(section.section)) ? `\n- ${CONCERN_PAIR_RULE}` : '')

/** 비교 칸이 있는 콜에만 붙는다 — 칸 이름은 템플릿의 비교 칸 이름이다 */
const COMPARE_SLOTS = new Set(['from'])
const compareRule = (sections: readonly SlotCopySection[]) =>
  sections.some((section) => section.slots.some((slot) => COMPARE_SLOTS.has(slot.name) || slot.list?.fields.some((field) => COMPARE_SLOTS.has(field.name))))
    ? "\n- 비교 칸은 다른 상품이 아니라 고객의 전후 장면이다. 이름표('우리 제품'·'기존 제품')는 코드가 붙이므로 쓰지 않는다. from에는 고객이 겪던 불편을 다른 상품 탓 없이 쓰고, to에는 이 상품을 쓴 뒤 달라진 점을 쓴다."
    : ''

/** 아이콘 칸이 있는 콜에만 붙는다 — 다른 페이지의 프롬프트를 바꾸지 않는다 */
const hasIcon = (sections: readonly SlotCopySection[]) =>
  sections.some((section) => section.slots.some((slot) => slot.choices === 'icon' || slot.list?.fields.some((field) => field.choices === 'icon')))
const iconRule = (sections: readonly SlotCopySection[]) =>
  hasIcon(sections)
    ? `\n- '아이콘 이름 하나'로 적힌 칸은 이 이름 중 하나만 괄호 없이 영어 그대로 쓴다: ${iconChoices()}. 실을 수 있는 사실이나 쓰는 장면에 있는 것만 고른다. 입력에 없는 기능을 아이콘으로 말하지 않는다. 맞는 이름이 없으면 선택 칸은 비운다.`
    : ''

/** 이름표 칸이 있는 콜에만 붙는다 — 다른 페이지의 프롬프트를 바꾸지 않는다 */
const hasTags = (sections: readonly SlotCopySection[]) => sections.some((section) => section.slots.some((slot) => slot.tags))
const tagRule = (sections: readonly SlotCopySection[]) =>
  hasTags(sections) ? '\n- 이름표 칸은 고객이 쓰는 장면이나 대상을 공백 없는 낱말로 쓴다. 문장으로 쓰지 않고 #은 붙이지 않는다(코드가 붙인다). 글자 수 상한은 # 한 자를 포함한다.' : ''

/** 소구 이름 칸이 있는 콜에만 붙는다(K1 R-W7) — POINT 머리 진행 표시의 탭 이름이다. 비면 코드가 점 줄로 그린다 */
const hasStep = (sections: readonly SlotCopySection[]) => sections.some((section) => section.slots.some((slot) => slot.name === POINT_STEP_SLOT))
const stepRule = (sections: readonly SlotCopySection[]) =>
  hasStep(sections)
    ? `\n- ${POINT_STEP_SLOT} 칸은 그 POINT가 말하는 효익을 공백 없는 낱말 하나로 쓴다. 코드가 페이지 POINT의 ${POINT_STEP_SLOT}을 모아 POINT 머리에 탭으로 보인다. POINT끼리 같은 낱말을 쓰지 않고, 사실을 새로 싣지 않는다. 마땅한 낱말이 없으면 비운다.`
    : ''

/**
 * POINT 본문 칸이 있는 콜에만 붙는다(K4 ①, 통합 11-05 11:39) — 본문은 사실 칸을 쓰지 않는 칸이라(사실 없음) 제목이 말한 사실을 풀어 쓴다.
 * 새 사실을 실으면 사실 예산·반복 검사를 비켜 가므로 막는다
 */
const POINT_SECTION_ID = 'point_div'
const POINT_BODY_SLOT = 'sub'
const hasPointBody = (sections: readonly SlotCopySection[]) =>
  sections.some((section) => section.section === POINT_SECTION_ID && section.slots.some((slot) => slot.name === POINT_BODY_SLOT && !slot.list))
const pointBodyRule = (sections: readonly SlotCopySection[]) =>
  hasPointBody(sections)
    ? `\n- POINT(${POINT_SECTION_ID})의 ${POINT_BODY_SLOT}는 그 POINT 제목이 말한 사실을 고객이 겪는 장면이나 체감으로 풀어 쓰는 두 줄 본문이다. 새 사실·수치·소재·기능을 더하지 않고, 제목 낱말을 되풀이하지 않는다. 풀어 쓸 말이 없으면 뺀다.`
    : ''

/** 강조 칸이 있는 콜에만 붙는다(T1-17) — 모델이 제목 안의 강조 구절을 고르고 코드가 최종 글로 검사한다. 어기면 지금 규칙(수량·POINT 낱말) */
const hasAccent = (sections: readonly SlotCopySection[]) => sections.some((section) => section.slots.some((slot) => slot.accent))
const accentRule = (sections: readonly SlotCopySection[]) =>
  hasAccent(sections)
    ? `\n- '강조'가 붙은 칸이 있는 섹션은 slots에 "${ACCENT_KEY}"를 더해 그 칸 글 안에서 색으로 강조할 구절 하나를 글자 그대로 쓴다. 공백을 빼고 ${ACCENT_MAX_CHARS}자 이하이고 칸 글 전체는 안 된다. 고객이 얻는 효익이나 위 사실에 있는 수치가 담긴 말을 고른다. 강조할 말이 없으면 ${ACCENT_KEY}를 뺀다.`
    : ''

/**
 * 고정 값 블록(specfixed 잡만, J23) — 크기·소재·옵션 수는 판매자 입력 글자 그대로 쓴다. 줄이 없으면 빈 글이라 앞 줄과 '## 규칙' 사이가 지금처럼 빈 줄 하나다
 */
function fixedValuesBlock(lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) return ''
  return `
## 고정 값(판매자 입력 — 쓸 때는 글자·숫자·단위를 그대로 쓴다)
${lines.join('\n')}
- 크기·소재·옵션 수를 반올림·환산하거나 다른 말로 바꾸지 않는다. 위에 없는 크기·소재·옵션 수는 쓰지 않는다.
`
}

export function buildSlotCopyPrompt(input: SlotCopyInput, fixes: ReadonlyMap<number, readonly SlotProblem[]> = new Map()): string {
  const facts = input.facts.length > 0 ? input.facts.map((fact, i) => `${i + 1}. ${fact}`).join('\n') : '(없음 — 사실을 쓰지 말고 장면과 느낌으로만 쓴다)'
  const fixRows = [...fixes].flatMap(([index, problems]) => problems.map((p) => `- [${index}] ${p.slot}: ${PROBLEM_LABEL[p.kind]} (${p.detail})`))
  return `상세페이지 섹션마다 글자 칸을 채운다. 레이아웃은 정해져 있고 칸 안의 글만 쓴다.

## 상품
- 카테고리: ${input.product.category}
- 고객: ${input.guideline.persona || input.product.persona || '(입력 없음)'}
- 말투: ${input.guideline.tone || '(자연스러운 존댓말)'}
- 장점 후보: ${input.product.usps.join(', ') || '(없음)'}
- 고민: ${input.product.pains.join(', ') || '(없음)'}${planBlock(input.pagePlan)}${storyBlock(input.copyStory)}

## 실을 수 있는 사실(사실은 이 목록에서만 쓴다)
${facts}
${fixedValuesBlock(input.fixedValues)}
## 규칙
- 목록에 없는 수치·소재·크기·인증을 지어내지 않는다.
- 한 사실은 페이지 전체에서 2곳까지만 쓴다. 같은 말을 다른 말로 되풀이하지 않는다.
- 섹션의 사실 칸 수만큼만 새 사실을 쓴다. 0개면 사실 없이 사용 장면·느낌·권유로 쓴다.
- 고객이 실제로 쓰는 장면과 체감 효익을 살린다(예: 엉키지 않아요, 손이 편해요, 모공 속 노폐물까지 쓸어내요).
- 비교 자료가 없으므로 일반 제품·기존 제품·타사처럼 다른 상품을 가리키거나 깎아내리지 않는다. 우리 쪽 장점과 고객이 쓰는 장면만 쓴다.
- 쓰면 안 되는 것은 인증·시험 사칭, 질병·의학 효능, 기능성 화장품 효능, 살균·무독성 같은 절대 안전 표시다.
- '이런 고민'이라는 말은 쓰지 않는다.
- 글자 수 상한은 공백을 뺀 수다. 넘기지 않는다. 칸의 줄 수와 '한 줄 N자' 안에서 쓴다.
- 띄어쓰기는 맞춤법대로 지킨다. '한 줄 N자'는 띄어쓰기를 포함한 어림이라, 넘치면 낱말을 줄이거나 바꾸고 공백을 지워 맞추지 않는다.
- 제목은 의미 단위에서 끊는다. 두 줄이 되면 \\n으로 끊고, 조사나 3자 이하 낱말만 끝 줄에 남기지 않는다.
- 치수·용량은 이름·값·단위를 떨어뜨리지 않는다(예: 가로 30cm, 30x20cm).
- 필수 칸은 반드시 채운다. 쓸 말이 없는 선택 칸은 키를 빼고 지어내서 채우지 않는다.
${COPY_COMMON_RULES.map((rule) => `- ${rule}`).join('\n')}
- 첫 화면 제목에는 상품명·옵션명을 쓰지 않고 쓰는 장면·약속·수치 중 하나로 시작한다. 수치는 위 사실에 있는 값만 쓴다. 고민으로 시작해도 되지만 기본은 아니다.${pairRule(input.sections)}${hookRule(input.sections, input.heroShot)}${tagRule(input.sections)}${iconRule(input.sections)}${compareRule(input.sections)}${accentRule(input.sections)}${stepRule(input.sections)}${pointBodyRule(input.sections)}${input.guardBlock ? `\n\n${input.guardBlock}` : ''}

## 섹션
${input.sections.map((section) => describeSection(section) + sectionExtras(section.index, input.pagePlan, input.copyStory)).join('\n')}
${fixRows.length > 0 ? `\n## 고칠 곳(앞서 쓴 글의 문제다. 이 칸들을 고쳐 위 섹션 전체를 다시 쓴다)\n${fixRows.join('\n')}\n` : ''}
## 답
JSON 하나만 쓴다. 위에 나온 섹션 번호만 쓰고, 칸 이름은 그대로 쓴다.
{"sections":[{"index":0,"slots":{"칸 이름":"글","목록 칸 이름":[{"항목 칸 이름":"글"}]${hasTags(input.sections) ? ',"이름표 칸 이름":["글"]' : ''}${hasAccent(input.sections) ? `,"${ACCENT_KEY}":"강조 구절"` : ''}}}]}`
}

const PROBLEM_LABEL: Readonly<Record<SlotProblem['kind'], string>> = {
  length: '글자 수 초과',
  over: '글자 수 초과 — 상한 안으로 줄인다',
  lines: '줄 수 초과 — 칸 폭에 맞게 줄인다',
  orphan: '끝 줄에 3자 이하만 남음 — 의미 단위로 끊거나 줄인다',
  claim: '규제 표현',
  number: '입력에 없는 숫자',
  missing: '빠진 필수 칸',
  phrase: "쓰지 않는 문구('이런 고민')",
  repeat: '사실 반복',
  echo: '같은 말 반복 — 첫머리·말을 바꿔 쓴다',
  compare: '다른 상품 언급',
  ending: '같은 끝말이 세 섹션 연속 — 끝말을 바꾼다',
  exclaim: '느낌표가 페이지에 2번을 넘음 — 뺀다',
  pair: '답이 되는 POINT가 없는 고민 — 답할 수 있는 고민으로 바꾼다',
  origin: '원산지·제조국 — 상품 정보 표에만 싣는 정보다. 이 칸에서 빼고 쓰는 장면·효익으로 쓴다',
  age: '연령 제한 상품에 어린이 표현 — 어린이·아이가 쓰거나 나오는 장면 없이 어른이 쓰는 장면으로 쓴다',
  child: '아이가 쓰거나 반응하는 문장 — 준비하는 어른의 편의로 쓴다',
  reproduce: '다른 상품 후기 문장과 겹침 — 옮기지 말고 새 표현으로 쓴다',
  material: 'ABS·PP·플라스틱 같은 흔한 소재 — 장점이 아니라 상품 정보 표에만 싣는다. 이 칸에서 빼고 쓰는 장면·효익으로 쓴다',
  spacing: '띄어쓰기 빠짐 — 맞춤법대로 띄어 쓰고, 길면 공백을 지우지 말고 낱말을 줄인다',
}

/** 섹션 번호 → 모델이 쓴 칸(검사 전). 쓸 수 있는 섹션이 하나도 없으면 실패다 */
export function parseSlotCopy(raw: string, sections: readonly SlotCopySection[]): Map<number, unknown> {
  if (!raw.trim()) throw new Error('슬롯 카피 응답이 비어 있습니다')
  const parsed = parseRegistrationJson(raw) as { sections?: unknown } | null
  if (!parsed || typeof parsed !== 'object') throw new Error(`슬롯 카피 응답 JSON 파싱 실패 (len=${raw.length}, head=${raw.slice(0, 80)}, tail=${raw.slice(-80)})`)
  const rows = Array.isArray(parsed.sections) ? (parsed.sections as Array<{ index?: unknown; slots?: unknown }>) : []
  const out = new Map<number, unknown>()
  for (const row of rows) {
    const section = sections.find((s) => s.index === row?.index)
    if (section && row.slots && !out.has(section.index)) out.set(section.index, row.slots)
  }
  if (out.size === 0) throw new Error('슬롯 카피에 쓸 수 있는 섹션이 없습니다')
  return out
}
