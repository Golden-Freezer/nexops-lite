/**
 * K 라인 슬롯 카피 검사(M5, 15_TEMPLATE_LINE §4) — 템플릿의 카피 칸을 뽑고, 모델이 쓴 글을 칸 상한·규제 표현·입력에 없는 숫자로 검사하고, 사실 칸 수에 맞춰 줄인다.
 * 입력값 칸(후기·표·평점)은 코드가 채우므로 여기서 다루지 않는다. 순수·결정론.
 */

import type { CopywritingResult, PdpSpecSheet } from '../pdp-state'
import { isFactClaimSafe } from '../eval/claim-lexicon'
import { buildNumberSources, findUnsupportedNumbers } from '../copy-numbers'
import { acceptAccent } from '../editor/utils/sectionConverter/designCut/accent'
import { cutTextLines } from '../editor/utils/sectionConverter/designCut/build'
import { CONTENT_W } from '../editor/utils/sectionConverter/designCut/tokens'
import { K_TYPE } from './engine'
import { isIconName } from './icons'
import { hasWorryPhrase } from '@/lib/registration/pdp-copy-labels'
import { mentionsOrigin } from './origin-text'
import { mentionsCommonMaterial } from '../common-material'
import { guardProblemsOf, type SlotTextGuard } from './slot-guard'
import { isOrphanLine, lineCharsOf, slotLinesOf, type SlotLine } from './slot-lines'
import { TAG_MAX_CHARS } from './slots'
import type { MetaListSlot, MetaTextSlot, TemplateMeta } from './template-meta'
import type { FlowNode, TokenName } from './template-types'

export interface CopyField {
  name: string
  required: boolean
  maxChars?: number
  maxLines?: number
  /** 줄 수를 이 글자 토큰과 폭으로 잰다 — 템플릿 흐름에 글자 노드가 있는 칸 */
  lineToken?: TokenName
  lineWidth?: number
  /** 첫 화면 칸 — 줄 수를 넘기면 글을 지운다. 다른 칸은 고치기만 청하고 지우지 않는다 */
  strictLines?: boolean
  facts: number
  /** icon이면 값은 사전의 이름만 받는다(hex는 입력 칸에만 있어 카피 칸으로 오지 않는다 — 타입만 같게 둔다, 적용 C5 ③) */
  choices?: 'icon' | 'hex'
  /** 제목 강조 칸(맨 위 칸만, 템플릿 흐름의 emphasis) — 모델이 이 칸 글 안의 강조 구절을 _accent로 고른다(T1-17) */
  accent?: true
}

export interface CopySlot extends CopyField {
  /** 목록 칸 — 항목 수와 항목 안의 카피 칸 */
  list?: { min: number; max: number; fields: CopyField[] }
  /** 이름표 칸 — 항목 칸 없이 글자만 받는 목록. 사실 예산을 쓰지 않는다 */
  tags?: { min: number; max: number }
}

export type CopyItem = Record<string, string>
export type CopyValues = Record<string, string | string[] | CopyItem[]>

const itemsOf = (value: CopyValues[string] | undefined): CopyItem[] =>
  Array.isArray(value) ? (value as Array<string | CopyItem>).filter((row): row is CopyItem => typeof row !== 'string') : []
const tagsOf = (value: CopyValues[string] | undefined): string[] =>
  Array.isArray(value) ? (value as Array<string | CopyItem>).filter((row): row is string => typeof row === 'string') : []

export interface SlotProblem {
  slot: string
  /**
   * origin — 원산지·제조국을 쓴 칸(R09b, 원산지는 상품 정보 표에만): 고치기를 청하고, 남으면 규제 표현처럼 글을 지운다.
   * age·child·reproduce — K 칸 글 가드(결정 카드 c03, slot-guard.ts): 연령 제한 잡의 어린이 표현·학부모 대리 구매 잡의 아이 사용·반응·경쟁사 리뷰 재현. origin과 같은 길이다
   * material — ABS·PP·플라스틱 같은 흔한 소재를 쓴 칸(J38 오너 11-10, 상품 정보 표에만): origin과 같은 길이다
   * spacing — 공백을 지워 붙여 쓴 줄이 몰린 페이지의 그 줄(J64, slot-spacing.ts): 고치기를 청하고, 남아도 글을 지우지 않는다(경고만)
   */
  kind:
    | 'length'
    | 'over'
    | 'lines'
    | 'orphan'
    | 'claim'
    | 'number'
    | 'missing'
    | 'repeat'
    | 'echo'
    | 'compare'
    | 'phrase'
    | 'ending'
    | 'exclaim'
    | 'pair'
    | 'origin'
    | 'age'
    | 'child'
    | 'reproduce'
    | 'material'
    | 'spacing'
  detail: string
}

/** 기록만 하는 종류 — 외톨이 줄, 같은 끝말, 느낌표, 짝 없는 고민(slot-notes.ts) */
const NOTE_KINDS: ReadonlySet<SlotProblem['kind']> = new Set(['orphan', 'ending', 'exclaim', 'pair'])

/**
 * 고쳐도 안 되면 글을 지우는 문제인가. 줄 수·끝 줄은 글이 틀린 것이 아니고 엔진이 칸을 늘려 그릴 수 있어, 지우면 섹션만 빠진다.
 * 필수 칸이 조금 넘친 글(over)도 그렇다 — 고치기를 청하되 남아도 지우지 않는다. 사실 반복·같은 말 반복(echo)도 글이 틀린 것이 아니다. 빠진 칸은 지울 글이 없다.
 * 띄어쓰기 빠짐(spacing, J64)도 뜻은 맞는 글이라 지우지 않는다 — 지우면 제목 칸이 비어 섹션이 빠진다.
 */
export const dropsText = (kind: SlotProblem['kind']) =>
  kind !== 'missing' && kind !== 'repeat' && kind !== 'echo' && kind !== 'lines' && kind !== 'over' && kind !== 'spacing' && !NOTE_KINDS.has(kind)
/** 고치기 콜을 부르는 문제인가 — 외톨이 줄과 페이지 기록은 기록만 한다. 다른 문제로 다시 쓸 때는 함께 알린다 */
export const asksFix = (kind: SlotProblem['kind']) => !NOTE_KINDS.has(kind)

/**
 * 다른 상품을 가리키는 말 — 비교 자료 없이 '일반 제품은 안 된다'로 읽히는 글을 막는다(법률 판단이 아니라 근거 없는 비교를 피하는 규칙이다).
 * '일반 세탁'·'다른 색'처럼 상품을 가리키지 않는 말과 고객의 고민·장면·우리 장점은 막지 않는다. 비교 자료 입력이 생기면 그 근거가 있을 때 연다.
 */
const OTHER_PRODUCT =
  /(?<![가-힣])(?:일반(?!적|\s*(?:세탁|가정|쓰레기|우편|모드|사용))|기존|시중|타사|경쟁(?:사|\s*(?:제품|상품|브랜드)|$)|보통\s*(?:제품|상품)|다른\s*(?:제품|상품|브랜드|것|거|걸|건)|저가|값싼\s*(?:제품|상품)|싸구려)/
export const namesOtherProduct = (value: string) => OTHER_PRODUCT.test(value)

const copyField = (name: string, slot: MetaTextSlot, line?: SlotLine): CopyField => ({
  name,
  required: slot.required,
  facts: slot.facts,
  ...(slot.maxChars !== undefined ? { maxChars: slot.maxChars } : {}),
  ...(slot.maxLines !== undefined ? { maxLines: slot.maxLines } : {}),
  ...(slot.choices ? { choices: slot.choices } : {}),
  ...(line && !slot.choices ? { lineToken: line.token, lineWidth: line.width } : {}),
})

const listFields = (slot: MetaListSlot, listName: string, lines: ReadonlyMap<string, SlotLine>): CopyField[] =>
  Object.entries(slot.fields).flatMap(([name, field]) => (field.type === 'text' && field.source !== 'input' ? [copyField(name, field, lines.get(`${listName}.${name}`))] : []))

export const HOOK_SECTION = 'hook_3step'
/** 첫 화면 글 상한(오너 지시 11-01: 후킹은 1~3초에 읽히게 글을 적게) — 큰 제목 2줄 + 보조 1줄 */
const HOOK_LINES: Readonly<Record<string, { token: TokenName; lines: number }>> = {
  headline: { token: 'HOOK', lines: 2 },
  sub: { token: 'BODY', lines: 1 },
}
const lineChars = (token: TokenName) => lineCharsOf(K_TYPE[token], CONTENT_W)

/** 프롬프트에 주는 값 — 글자 수는 토큰에서 구해 글씨 크기가 바뀌면 함께 바뀐다 */
export function hookCopyLimits() {
  return {
    headline: { lines: HOOK_LINES.headline.lines, perLine: lineChars(HOOK_LINES.headline.token) },
    sub: { lines: HOOK_LINES.sub.lines, perLine: lineChars(HOOK_LINES.sub.token) },
  }
}

/** 첫 화면 칸에 상한을 씌운다 — 템플릿 상한이 더 작으면 그 값을 쓴다. 규칙에 없는 칸(count 등)은 그대로다 */
function withHookLimit(field: CopyField): CopyField {
  const rule = HOOK_LINES[field.name]
  if (!rule) return field
  const cap = lineChars(rule.token) * rule.lines
  return { ...field, maxChars: Math.min(field.maxChars ?? cap, cap), maxLines: rule.lines, lineToken: rule.token, lineWidth: CONTENT_W, strictLines: true }
}

/** 모델이 채울 칸 — 입력값 칸과 사진 칸은 뺀다. 목록은 항목 안에 카피 칸이 있거나 항목 칸이 아예 없는 이름표일 때만. 흐름이 있으면 칸마다 토큰·폭을 싣는다 */
export function copySlotsOf(template: Pick<TemplateMeta, 'slots'> & Partial<Pick<TemplateMeta, 'section' | 'flow'>>): CopySlot[] {
  const lines: ReadonlyMap<string, SlotLine> = template.flow ? slotLinesOf(template.flow as readonly FlowNode[]) : new Map()
  return Object.entries(template.slots).flatMap(([name, slot]): CopySlot[] => {
    if (slot.type === 'text') {
      if (slot.source === 'input') return []
      const line = lines.get(name)
      const base = copyField(name, slot, line)
      const field: CopyField = line?.emphasis && !slot.choices ? { ...base, accent: true } : base
      return [template.section === HOOK_SECTION ? withHookLimit(field) : field]
    }
    if (slot.type !== 'list' || slot.source === 'input') return []
    // 항목 칸이 아예 없으면 이름표 목록이다(사진 칸만 있는 목록은 항목 칸이 있어 여기 들지 않는다)
    if (Object.keys(slot.fields).length === 0) return [{ name, required: slot.required, facts: 0, maxChars: TAG_MAX_CHARS, tags: { min: slot.min, max: slot.max } }]
    const fields = listFields(slot, name, lines)
    if (fields.length === 0) return []
    return [{ name, required: slot.required, facts: fields.reduce((sum, field) => sum + field.facts, 0), list: { min: slot.min, max: slot.max, fields } }]
  })
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
/** 칸 값 읽기 — 아이콘 칸은 사전의 이름만 받고 나머지는 버린다(필수 칸이면 missing으로 고치기 콜이 간다) */
const fieldValue = (field: CopyField, raw: unknown) => {
  const value = text(raw)
  return field.choices === 'icon' && !isIconName(value) ? '' : value
}
/** 글자 수 상한은 공백을 뺀 수다(규격 §4) */
const charCount = (value: string) => value.replace(/\s+/g, '').length
/**
 * 필수 칸 글이 이 배수 안에서 넘치면 지우지 않는다(over, 적용 K14) — 지우면 섹션이 통째로 빠진다. 590 템플릿의 필수 칸 435개에 1.5배 글을 넣어
 * 그려지지 않는 칸 0·섹션 밖 글 0·새로 사진과 겹침 0(계산 탐침, 렌더 아님). 첫 화면 칸은 글을 적게 두는 칸이라 그대로 지운다(strictLines)
 */
const OVER_ROOM = 1.5
/** 이름표 모양을 코드가 맞춘다 — 공백 없는 낱말 앞에 # 하나. 글자가 없으면 빈 값이다 */
const tagText = (value: unknown) => {
  const word = text(value).replace(/\s+/g, '').replace(/^#+/, '')
  return word ? `#${word}` : ''
}

/** 모델 답에서 아는 칸만 글자로 읽는다 — 모르는 칸·빈 값은 버리고, 목록은 필수 칸이 빠진 항목을 버리고 상한까지만 받는다 */
export function readCopyValues(slots: readonly CopySlot[], raw: unknown): CopyValues {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: CopyValues = {}
  for (const slot of slots) {
    if (slot.tags) {
      const rows = Array.isArray(source[slot.name]) ? (source[slot.name] as unknown[]) : []
      const tags = [...new Set(rows.map(tagText).filter(Boolean))].slice(0, slot.tags.max)
      if (tags.length > 0) out[slot.name] = tags
      continue
    }
    if (!slot.list) {
      const value = fieldValue(slot, source[slot.name])
      if (value) out[slot.name] = value
      continue
    }
    const rows = Array.isArray(source[slot.name]) ? (source[slot.name] as unknown[]) : []
    const items = rows.flatMap((row): CopyItem[] => {
      const item: CopyItem = {}
      for (const field of slot.list!.fields) {
        const value = fieldValue(field, (row as Record<string, unknown> | null)?.[field.name])
        if (value) item[field.name] = value
      }
      return slot.list!.fields.every((field) => !field.required || item[field.name]) && Object.keys(item).length > 0 ? [item] : []
    })
    if (items.length > 0) out[slot.name] = items.slice(0, slot.list.max)
  }
  return out
}

/** 검사할 글 — [칸 이름, 글, 상한] */
function textsOf(slots: readonly CopySlot[], values: CopyValues): Array<{ slot: string; value: string; required?: boolean } & Pick<CopyField, 'maxChars' | 'maxLines' | 'lineToken' | 'lineWidth' | 'strictLines'>> {
  return slots.flatMap((slot) => {
    const value = values[slot.name]
    // 이름표는 한 개씩 지울 수 있게 칸 이름에 자리 번호를 붙인다
    if (slot.tags) return tagsOf(value).map((tag, i) => ({ slot: `${slot.name}.${i}`, value: tag, maxChars: slot.maxChars }))
    // 아이콘 이름은 글이 아니라 규제·숫자·반복 검사를 받지 않는다(읽을 때 사전으로 걸렀다)
    if (slot.choices) return []
    const limits = ({ maxChars, maxLines, lineToken, lineWidth, strictLines }: CopyField) => ({ maxChars, maxLines, lineToken, lineWidth, strictLines })
    if (!slot.list) return typeof value === 'string' ? [{ slot: slot.name, value, required: slot.required, ...limits(slot) }] : []
    return itemsOf(value).flatMap((item) =>
      slot.list!.fields.flatMap((field) => (item[field.name] && !field.choices ? [{ slot: `${slot.name}.${field.name}`, value: item[field.name], required: slot.required && field.required, ...limits(field) }] : []))
    )
  })
}

/** 빠진 필수 칸 — 필수 칸이 빠진 항목은 엔진이 그리지 않으므로 세지 않는다. 항목 수만 보면 그려지지 않는 목록이 온전하게 잡힌다 */
function missingSlots(slots: readonly CopySlot[], values: CopyValues): SlotProblem[] {
  return slots.flatMap((slot): SlotProblem[] => {
    if (!slot.required) return []
    const value = values[slot.name]
    const least = slot.tags?.min ?? slot.list?.min
    const filled = slot.list ? itemsOf(value).filter((item) => slot.list!.fields.every((field) => !field.required || item[field.name])).length : tagsOf(value).length
    const short = least !== undefined ? filled < least : !value
    return short ? [{ slot: slot.name, kind: 'missing', detail: least !== undefined ? `항목 ${least}개 이상` : '필수 칸' }] : []
  })
}

/** 글 칸이 다 찼는가 — 아니면 엔진이 그 템플릿을 그리지 않아 섹션이 빠진다. 사진·입력값 칸은 보지 않는다 */
export const requiredCopyFilled = (slots: readonly CopySlot[], values: CopyValues) => missingSlots(slots, values).length === 0

/**
 * 칸 값 검사 — 글자 수 상한, 줄 수, 끝 줄 외톨이, 규제 표현, 입력에 없는 숫자, 빠진 필수 칸. 체감 효익은 막지 않는다(사전에 든 규제 표현만 본다).
 * guard가 있으면 칸 글 가드(연령·아이 사용·경쟁사 재현, slot-guard.ts)도 본다 — 없으면 지금과 같다
 */
export function checkCopyValues(slots: readonly CopySlot[], values: CopyValues, spec: PdpSpecSheet, guard?: SlotTextGuard): SlotProblem[] {
  const problems: SlotProblem[] = []
  const sources = buildNumberSources(spec)
  for (const { slot, value, required, maxChars, maxLines, lineToken, lineWidth, strictLines } of textsOf(slots, values)) {
    if (maxChars !== undefined && charCount(value) > maxChars) {
      const soft = required && !strictLines && charCount(value) <= maxChars * OVER_ROOM
      problems.push({ slot, kind: soft ? 'over' : 'length', detail: `${charCount(value)}자(상한 ${maxChars}자)` })
    }
    // 공백 뺀 글자 수가 맞아도 띄어쓰기·영문 때문에 줄이 넘칠 수 있어, 그리는 토큰과 칸 폭으로 줄 수를 잰다
    const width = lineWidth ?? CONTENT_W
    const lines = lineToken && maxLines !== undefined ? cutTextLines(value, K_TYPE[lineToken], width) : 0
    if (maxLines !== undefined && lines > maxLines) problems.push({ slot, kind: strictLines ? 'length' : 'lines', detail: `${lines}줄(상한 ${maxLines}줄)` })
    if (lineToken && isOrphanLine(value, K_TYPE[lineToken], width)) problems.push({ slot, kind: 'orphan', detail: '끝 줄이 3자 이하' })
    if (!isFactClaimSafe(value, spec.certificationInfo)) problems.push({ slot, kind: 'claim', detail: value })
    if (namesOtherProduct(value)) problems.push({ slot, kind: 'compare', detail: value })
    if (hasWorryPhrase(value)) problems.push({ slot, kind: 'phrase', detail: value })
    if (mentionsOrigin(value, spec.origin)) problems.push({ slot, kind: 'origin', detail: value })
    if (mentionsCommonMaterial(value)) problems.push({ slot, kind: 'material', detail: value })
    const numbers = findUnsupportedNumbers({ [slot]: value } as unknown as CopywritingResult, sources)
    if (numbers.length > 0) problems.push({ slot, kind: 'number', detail: numbers.map((n) => n.token).join(', ') })
    if (guard) problems.push(...guardProblemsOf(slot, value, guard))
  }
  problems.push(...missingSlots(slots, values))
  return problems
}

/** 고치지 못한 칸을 지운다 — 칸 상한·규제·숫자에 걸린 글을 그대로 내보내지 않는다. 필수 칸이 비면 엔진이 그 템플릿을 그리지 않는다 */
export function dropProblemValues(values: CopyValues, problems: readonly SlotProblem[]): CopyValues {
  const out: CopyValues = { ...values }
  // 이름표는 자리 번호로 찾으므로 다 모은 뒤 한 번에 지운다(지우는 중에 번호가 밀리지 않게)
  const badTags = new Map<string, Set<number>>()
  for (const { slot, kind } of problems) {
    if (!dropsText(kind)) continue
    const [name, field] = slot.split('.')
    const value = out[name]
    if (!field) {
      delete out[name]
      continue
    }
    if (!Array.isArray(value)) continue
    if (tagsOf(value).length > 0) {
      badTags.set(name, (badTags.get(name) ?? new Set<number>()).add(Number(field)))
      continue
    }
    const items = itemsOf(value).map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== field)))
    const rest = items.filter((item) => Object.keys(item).length > 0)
    if (rest.length > 0) out[name] = rest
    else delete out[name]
  }
  for (const [name, bad] of badTags) {
    const rest = tagsOf(out[name]).filter((_, i) => !bad.has(i))
    if (rest.length > 0) out[name] = rest
    else delete out[name]
  }
  return out
}

/** 항목 하나가 쓰는 사실 수 */
const itemFacts = (slot: CopySlot, item: CopyItem) => slot.list!.fields.reduce((sum, field) => sum + (item[field.name] ? field.facts : 0), 0)

/**
 * 사실 칸 수에 맞춰 줄인다 — 뒤 칸부터 선택 칸을 지우고, 목록은 뒤 항목부터 뺀다(필수 목록은 최소 수까지). 필수 칸은 지우지 않는다.
 * 순서 풀이가 필수 칸 몫을 먼저 줬으므로 정상이면 예산 안에 든다.
 */
export function fitToFactSlots(slots: readonly CopySlot[], values: CopyValues, factSlots: number): CopyValues {
  const out: CopyValues = { ...values }
  const used = (slot: CopySlot) => {
    const value = out[slot.name]
    if (!slot.list) return value ? slot.facts : 0
    return itemsOf(value).reduce((sum, item) => sum + itemFacts(slot, item), 0)
  }
  let total = slots.reduce((sum, slot) => sum + used(slot), 0)
  for (const slot of [...slots].reverse()) {
    if (total <= factSlots) break
    if (!slot.list) {
      if (slot.required || !out[slot.name] || slot.facts === 0) continue
      total -= slot.facts
      delete out[slot.name]
      continue
    }
    const items = out[slot.name]
    if (!Array.isArray(items)) continue
    const floor = slot.required ? slot.list.min : 0
    const kept = itemsOf(items)
    while (total > factSlots && kept.length > floor && itemFacts(slot, kept[kept.length - 1]) > 0) total -= itemFacts(slot, kept.pop()!)
    // 필수가 아닌 목록은 최소 수보다 적으면 엔진이 그리지 않으므로 함께 지운다
    if (kept.length === 0 || (!slot.required && kept.length < slot.list.min)) delete out[slot.name]
    else out[slot.name] = kept
  }
  return out
}

/** 모델 답의 강조 구절 예약 칸 — 칸 이름이 아니라 readCopyValues가 읽지 않는다 */
export const ACCENT_KEY = '_accent'

/**
 * 섹션의 강조 구절(T1-17) — 모델이 _accent로 고른 구절이 최종 강조 칸 글(고치기·지우기 뒤)의 부분 문자열·공백 뺀 2~8자·글 전체 아님을
 * 넘으면 그 구절, 아니면 null(엔진이 지금 규칙으로 고른다). 강조 칸이 없는 섹션도 null이다
 */
export function sectionAccent(slots: readonly CopySlot[], values: CopyValues, raw: unknown): string | null {
  const field = slots.find((slot) => slot.accent && !slot.list && !slot.tags)
  const value = field ? values[field.name] : undefined
  return typeof value === 'string' ? acceptAccent(value, raw) : null
}

/** 섹션 글 전체 — 페이지 단위 사실 반복 검사(factOveruse)에 넘긴다 */
export function sectionText(slots: readonly CopySlot[], values: CopyValues): string {
  return textsOf(slots, values)
    .map((row) => row.value)
    .join(' ')
}
