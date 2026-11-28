/**
 * 슬롯 값 판단 — 빈 값, 필수 슬롯, 사실 수(15_TEMPLATE_LINE §4). 엔진·선택 단계·검사기가 같은 기준을 쓴다. 순수·결정론.
 */

import type { ListSlot, SlotDef, SlotItem, SlotValue, SlotValues, Template } from './template-types'

/** 공백만 있는 글자도 빈 값이다 */
export const textOf = (value: SlotValue): string | null => (typeof value === 'string' && value.trim() ? value : null)

/** 필수 칸이 빠지지 않은 항목만 — 채울 사실이 없는 항목은 그리지 않는다. 입력 상한(inputMax, K14)까지 그린다 — 받은 옵션 사진을 앞 몇 장만 보여 주지 않는다 */
export function listItems(def: ListSlot, value: SlotValue): SlotItem[] {
  if (!Array.isArray(value)) return []
  const items = value.filter((item): item is SlotItem => typeof item === 'object' && item !== null)
  const required = Object.entries(def.fields).filter(([, field]) => field.required)
  return items.filter((item) => required.every(([name]) => textOf(item[name]))).slice(0, def.inputMax ?? def.max)
}

/** 이름표 글자 수 — 장식 라벨 12자 상한 ÷ 스트레스 1.2. 표본과 카피 검사가 같은 값을 쓴다 */
export const TAG_MAX_CHARS = 10

/** tags 슬롯 값 — 빈 글자를 뺀 문자열 목록 */
export function stringList(value: SlotValue): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

function isSlotEmpty(def: SlotDef, value: SlotValue): boolean {
  if (def.type !== 'list') return !textOf(value) && stringList(value).length === 0
  // 문자열 목록(tags) 슬롯은 항목 칸이 없다
  if (Object.keys(def.fields).length === 0) return stringList(value).length < def.min
  return listItems(def, value).length < def.min
}

/**
 * 입력 칸인가(source 'input' — 코드가 판매자 입력을 그대로 옮긴 값, 칸 카피 모델이 쓰지 않는다). field를 주면 목록 항목의 그 필드를 본다 —
 * 입력 목록이면 필드도 입력이다. 템플릿에 없는 칸·사진 칸은 아니다(J47 사실 감사가 모델이 쓴 칸만 보게)
 */
export function isInputValue(template: Pick<Template, 'slots'>, slot: string, field?: string): boolean {
  const def = template.slots[slot]
  if (!def || def.type === 'image') return false
  if (def.source === 'input') return true
  if (def.type !== 'list' || field === undefined) return false
  const fieldDef = def.fields[field]
  return fieldDef?.type === 'text' && fieldDef.source === 'input'
}

/** 비어 있는 필수 슬롯 이름 — 하나라도 있으면 그리지 않는다(다음 후보로) */
export function missingSlots(template: Template, slots: SlotValues): string[] {
  return Object.entries(template.slots)
    .filter(([name, def]) => def.required && isSlotEmpty(def, slots[name]))
    .map(([name]) => name)
}

/** 필수 사진 수 — 필수 사진 슬롯 + 필수 목록의 min개 × 필수 사진 칸 */
export function requiredPhotos(template: Pick<Template, 'slots'>): number {
  let count = 0
  for (const def of Object.values(template.slots)) {
    if (def.type === 'image' && def.required) count += 1
    if (def.type === 'list' && def.required) count += def.min * Object.values(def.fields).filter((f) => f.type === 'image' && f.required).length
  }
  return count
}

const factsOf = (def: SlotDef) => (def.type === 'text' ? def.facts : 0)
const itemFacts = (fields: ListSlot['fields'], requiredOnly: boolean) =>
  Object.values(fields).reduce((sum, field) => sum + (!requiredOnly || field.required ? factsOf(field) : 0), 0)

/**
 * 이 템플릿이 소비하는 사실 수 — min은 필수만(목록은 min개 × 필수 칸), max는 전부(목록은 max개 × 전체 칸).
 * 선택 단계가 상품의 사실 예산과 맞춘다. 필수가 아닌 목록은 비울 수 있어 min에 들지 않는다.
 */
export function factRange(template: Pick<Template, 'slots'>): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const def of Object.values(template.slots)) {
    if (def.type === 'list') {
      if (def.required) min += def.min * itemFacts(def.fields, true)
      max += def.max * itemFacts(def.fields, false)
      continue
    }
    if (def.required) min += factsOf(def)
    max += factsOf(def)
  }
  return { min, max }
}
