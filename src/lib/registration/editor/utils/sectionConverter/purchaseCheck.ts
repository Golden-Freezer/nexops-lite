// sectionConverter/purchaseCheck.ts — 구매 전 확인 구간 (2026-10-30 통합 결정, #278 후속)
//
// 후킹(첫 화면)에서 상품명·옵션 사실 줄(R3 heroFacts)을 뺀 뒤, 그 줄이 싣던 구매 판단 정보(구성·사이즈·디자인/색상 옵션)가
// 페이지에 실제로 그려진 글에 없으면 스펙 표에 싣는다. 스펙 표가 없으면 CTA 바로 앞에 '구매 전 확인' 표를 둔다 — 확인 정보는
// 행동 바로 앞에 둔다(상세페이지 마법사 비교). 값은 입력(spec_sheet 등록 옵션 구조·옵션명·사이즈)에 있는 것만 싣고, 상품명은
// 싣지 않는다(쿠팡 상품명이 페이지 위에 있다). 표 제목에는 수치를 쓰지 않는다.
// '보인다'는 섹션을 다 지은 뒤 글 요소로 판정한다 — 원본 카피는 중복 정리 교체·섹션 탈락·그리는 개수 제한 전이라 보이지 않는
// 글까지 셌다(#288 검수).

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import { claimSafeFactRows } from '@/lib/registration/eval/claim-lexicon'
import { isOptionSpec, type OptionAxisKind } from '@/lib/registration/options/option-spec'
import { str } from './helpers'

export interface SpecRow {
  label: string
  value: string
  /** 값이 'n가지'로 줄었을 때 판정에 쓰는 낱낱의 값 */
  items?: string[]
}

export const PURCHASE_CHECK_TITLE = '구매 전 확인'

const LIST_MAX = 8
const LIST_CHARS_MAX = 80

/** 옵션 값 목록 → '데이지, 체리', 많거나 길면 'n가지'(낱낱의 값은 items로 남긴다) */
function listOf(values: readonly string[]): Pick<SpecRow, 'value' | 'items'> | null {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))]
  if (unique.length === 0) return null
  const joined = unique.join(', ')
  return unique.length <= LIST_MAX && joined.length <= LIST_CHARS_MAX
    ? { value: joined, items: unique }
    : { value: `${unique.length}가지`, items: unique }
}

/** 구매 판단 정보 행 — 등록 옵션 구조가 있으면 축별(구성·사이즈·디자인·색상), 없으면 옵션명, 사이즈 입력은 따로. 규제 표현이 든 행은 뺀다 */
export function purchaseRows(specSheet: Record<string, unknown> | undefined): SpecRow[] {
  if (!specSheet) return []
  const rows: SpecRow[] = []
  let sizeFromOptions = false
  const spec = specSheet.optionSpec
  if (isOptionSpec(spec)) {
    const axisOf = (kind: OptionAxisKind) => spec.axes.find((a) => a.kind === kind)
    // 구성: 수량 축이 있으면 그 값, 없으면 모든 옵션이 같은 수량일 때 그 수량
    const quantity = axisOf('quantity')
    const sameQuantity = [...new Set(spec.variants.map((v) => v.values.quantity ?? ''))]
    const quantityList = quantity
      ? listOf(quantity.values)
      : sameQuantity.length === 1 && sameQuantity[0]
        ? listOf(sameQuantity)
        : null
    if (quantityList) rows.push({ label: '구성', ...quantityList })
    const size = axisOf('size')
    const sizeList = size ? listOf(size.values) : null
    if (sizeList) {
      rows.push({ label: size!.name || '사이즈', ...sizeList })
      sizeFromOptions = true
    }
    for (const kind of ['design', 'color'] as const) {
      const axis = axisOf(kind)
      const list = axis ? listOf(axis.values) : null
      if (list) rows.push({ label: axis!.name, ...list })
    }
  } else {
    const list = listOf(Array.isArray(specSheet.colorOptions) ? specSheet.colorOptions.map(str) : [])
    if (list) rows.push({ label: '옵션', ...list })
  }
  // 사이즈 입력은 길어도 싣는다(값 칸이 줄을 바꾼다) — 옵션 사이즈 축이 이미 있으면 겹쳐 싣지 않는다
  const sizeText = str(specSheet.size).trim()
  if (sizeText && !sizeFromOptions) rows.push({ label: '사이즈', value: sizeText })
  return claimSafeFactRows(rows, specSheet.certificationInfo)
}

/** 비교용 — 소문자, 곱셈 기호는 x로, 공백(줄바꿈 없는 공백 포함)·문장부호·기호 제거 */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[×✕*]/g, 'x')
    .replace(/[\s\p{P}\p{S}]/gu, '')

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 짧은 값 뒤에 붙어도 낱말로 보는 조사 */
const PARTICLE_AFTER = '(?:와|과|이|가|을|를|은|는|로|으로|의|도|만|에|및)'

/** 섹션의 글 요소(보이는 것만)에 그려진 글 */
export function shownTextsOf(sections: readonly CanvasSection[]): string[] {
  const textOf = (el: CanvasElement) => (el.isVisible === false ? '' : (el.textProps?.content ?? ''))
  return sections.flatMap((s) => s.elements.map(textOf)).filter(Boolean)
}

/**
 * 그려진 글에 이미 보이는 행은 뺀다 — 낱낱의 값이 모두 보여야 보인다고 본다. 글마다 따로 보고(글끼리 이어 붙인 자리에서 맞추지
 * 않는다), 숫자로 시작하는 값은 앞이 숫자가 아닐 때만('120개'의 '20개'는 아님), 두 글자 이하 값('S'·'L')은 대소문자까지 같고
 * 앞뒤가 글자·숫자가 아닌 낱말일 때만(조사가 붙는 것은 허용) 보인다고 본다
 */
export function missingRows(rows: readonly SpecRow[], shownTexts: readonly string[]): SpecRow[] {
  const normalized = shownTexts.map(normalize)
  const isShown = (item: string) => {
    const key = normalize(item)
    if (!key) return true
    if (key.length > 2) {
      const pattern = new RegExp(`${/^\d/.test(key) ? '(?<!\\d)' : ''}${escape(key)}`, 'u')
      return normalized.some((t) => pattern.test(t))
    }
    const word = new RegExp(`(?<![\\p{L}\\p{N}'’])${escape(item.trim())}(?=$|[^\\p{L}\\p{N}]|${PARTICLE_AFTER})`, 'u')
    return shownTexts.some((t) => word.test(t))
  }
  return rows.filter((row) => (row.items ?? row.value.split(', ')).some((item) => !isShown(item)))
}

/** 기존 표 행 뒤에 더한다 — 같은 이름의 행이 이미 있으면 '… 옵션'으로 구분한다(입력 사이즈와 사이즈 축 등) */
export function mergeRows(base: readonly SpecRow[], added: readonly SpecRow[]): SpecRow[] {
  const labels = new Set(base.map((r) => r.label))
  return [...base, ...added.map((r) => (labels.has(r.label) ? { ...r, label: `${r.label} 옵션` } : r))]
}

/**
 * 상품 정보 표는 늘 있어야 한다(오너 지시 2026-11-01) — 골격에 스펙 표가 없는 잡도 입력 행(baseRows)이 있으면 그 표를 첫 CTA 바로 앞에 짓는다(이때 입력 행이 싣는 값은
 * 빠진 행에서 뺀다). 입력 행이 없을 때만 예전처럼 빠진 행으로 '구매 전 확인' 표를 짓는다.
 * 구매 전 확인 배치 — 빠진 행이 있으면 스펙 표가 있을 때 그 표를 기존 행 + 빠진 행으로 다시 짓고, 없으면 '구매 전 확인' 표를 지어
 * 첫 CTA 바로 앞(CTA가 없으면 끝)에 넣는다. 새로 넣은 표는 added로 돌려준다(안전장치가 CTA를 옮긴 뒤 다시 붙이려고)
 */
export function placePurchaseCheck(
  sections: CanvasSection[],
  missing: readonly SpecRow[],
  baseRows: readonly SpecRow[],
  buildSpec: (patch: { specRows: SpecRow[]; title?: string }) => CanvasSection[]
): { sections: CanvasSection[]; added: CanvasSection | null } {
  const at = sections.findIndex((s) => s.sectionType === ProSectionType.SPEC_TABLE)
  if (at >= 0) {
    if (missing.length === 0) return { sections, added: null }
    const rebuilt = buildSpec({ specRows: mergeRows(baseRows, missing) })
    return { sections: [...sections.slice(0, at), ...rebuilt, ...sections.slice(at + 1)], added: null }
  }
  if (missing.length === 0 && baseRows.length === 0) return { sections, added: null }
  const patch =
    baseRows.length > 0
      ? { specRows: mergeRows(baseRows, missingRows(missing, baseRows.map((r) => r.value))) }
      : { specRows: [...missing], title: PURCHASE_CHECK_TITLE }
  const [table] = buildSpec(patch)
  if (!table) return { sections, added: null }
  const cta = sections.findIndex((s) => s.sectionType === ProSectionType.CTA)
  const pos = cta === -1 ? sections.length : cta
  return { sections: [...sections.slice(0, pos), table, ...sections.slice(pos)], added: table }
}

/**
 * 새로 넣은 표(id)를 마지막 CTA 바로 앞으로 — 안전장치(applySafetyGuards)가 CTA를 맨 끝으로 옮긴 뒤에도 붙어 있게. 이미지 배정·
 * 빈 섹션 거르기가 섹션 객체를 새로 만들 수 있어 id로 찾는다
 */
export function keepBeforeCta(sections: CanvasSection[], tableId: string | null): CanvasSection[] {
  const table = tableId ? sections.find((s) => s.id === tableId) : undefined
  if (!table) return sections
  const rest = sections.filter((s) => s !== table)
  const cta = rest.findLastIndex((s) => s.sectionType === ProSectionType.CTA)
  if (cta === -1) return sections
  return [...rest.slice(0, cta), table, ...rest.slice(cta)]
}
