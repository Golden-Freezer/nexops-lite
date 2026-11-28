/**
 * 디자인 컷 계획의 입력 읽기(designcut-plan.ts에서 나눔) — 스펙 사이즈 글의 치수와 옵션 섹션(T7) 칩. 순수 함수, 입력 값을 그대로 옮긴다
 * (치수·색을 지어내지 않는다 — 못 읽으면 빈 목록·null).
 */

import type { PdpJobRow } from '../pdp-state'
import { unifyChips } from './designcut-structure'
import { optionSpecOf } from './persuasion-signals'
import { isRealOptionPhoto } from '../options/option-photo-guard'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 옵션 칩 상한(편집기 T7 그리드) */
const MAX_OPTION_CHIPS = 12
/** 옵션 칩 색(이름 사전에 있을 때만 — 없으면 null, 편집기가 번호 원) */
const COLOR_NAMES: Array<[string, string]> = [
  ['스카이블루', '#7DD3FC'],
  ['아이보리', '#F4EFE3'],
  ['블랙', '#1A1A1A'],
  ['검정', '#1A1A1A'],
  ['화이트', '#FFFFFF'],
  ['흰색', '#FFFFFF'],
  ['베이지', '#D9C7A7'],
  ['그레이', '#9CA3AF'],
  ['회색', '#9CA3AF'],
  ['네이비', '#1F2A44'],
  ['블루', '#2563EB'],
  ['파랑', '#2563EB'],
  ['레드', '#DC2626'],
  ['빨강', '#DC2626'],
  ['핑크', '#F472B6'],
  ['분홍', '#F472B6'],
  ['그린', '#16A34A'],
  ['초록', '#16A34A'],
  ['민트', '#6EE7B7'],
  ['옐로우', '#FACC15'],
  ['노랑', '#FACC15'],
  ['오렌지', '#F97316'],
  ['브라운', '#8B5E3C'],
  ['갈색', '#8B5E3C'],
  ['퍼플', '#7C3AED'],
  ['보라', '#7C3AED'],
  ['카키', '#6B7140'],
  ['실버', '#C0C0C0'],
  ['골드', '#C9A227'],
]

type SizeDim = { axis: 'w' | 'h' | 'd'; value: number; unit: string }

const SIZE_UNIT = '(mm|cm|m|inch|in)'
const SIZE_MEASURE = new RegExp(`\\d+(?:\\.\\d+)?\\s*${SIZE_UNIT}`, 'i')

/** AxBxC 표기 — 단위가 없으면(수량 등) null. text는 입력에서 읽은 부분 */
function productFormDims(raw: string): { dims: SizeDim[]; text: string } | null {
  const num = '(\\d+(?:\\.\\d+)?)'
  const sep = '\\s*[x×*]\\s*'
  const triple = new RegExp(`${num}\\s*${SIZE_UNIT}?${sep}${num}\\s*${SIZE_UNIT}?(?:${sep}${num}\\s*${SIZE_UNIT}?)?`, 'i')
  const t = triple.exec(raw)
  const tripleUnit = t ? [t[6], t[4], t[2]].find(Boolean) : undefined
  if (!t || !tripleUnit) return null
  const axes: Array<'w' | 'h' | 'd'> = ['w', 'h', 'd']
  const dims = [t[1], t[3], t[5]]
    .map((v, i) => (v ? { axis: axes[i], value: Number(v), unit: tripleUnit.toLowerCase() } : null))
    .filter((d): d is SizeDim => d !== null)
  return { dims, text: t[0] }
}

const AXIS_WORDS: ReadonlyArray<[string, SizeDim['axis']]> = [
  ['가로|폭|너비', 'w'],
  ['세로|높이', 'h'],
  ['깊이|두께', 'd'],
]

/**
 * 방향이 확실한 치수만(sizecut, R15 P09) — AxBxC 또는 가로·세로·깊이 낱말. '고리 21.4cm, 펼침 37.3cm'·'길이 7.3cm'·'지름 50mm'처럼 방향을 모르면 빈 목록이고
 * 호출자가 입력 글을 그대로 적는다. 방향 있는 값과 모르는 값이 섞여도('길이 30cm, 폭 5cm') 빈 목록이다 — 일부만 적으면 치수가 사라진다
 */
export function parseAxisDims(raw: string | undefined): SizeDim[] {
  if (!raw) return []
  const product = productFormDims(raw)
  if (product) return SIZE_MEASURE.test(raw.replace(product.text, '')) ? [] : product.dims
  let rest = raw
  const dims: SizeDim[] = []
  for (const [words, axis] of AXIS_WORDS) {
    const m = new RegExp(`(?:${words})\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${SIZE_UNIT}`, 'i').exec(rest)
    if (!m) continue
    dims.push({ axis, value: Number(m[1]), unit: m[2].toLowerCase() })
    rest = rest.replace(m[0], '')
  }
  return SIZE_MEASURE.test(rest) ? [] : dims
}

/**
 * spec.size에서 치수(숫자+단위) — 가로·세로·깊이 키워드 또는 AxBxC 표기. 못 읽으면 빈 목록(치수를 만들지 않는다).
 * AxBxC는 단위가 끝에 하나('16.5 x 20.7cm')여도, 값마다('16.5cm x 20.7cm') 있어도 읽는다 — 단위는 마지막에 적힌 것. 예전 식은 끝 단위만
 * 받아 값마다 단위가 붙은 입력(R10-L-P02 '16.5cm x 20.7cm(데이지 S)')이 '첫 숫자+단위'로 떨어져 가로 한 축만 남았다
 */
export function parseSizeDims(raw: string | undefined): SizeDim[] {
  if (!raw) return []
  const unit = SIZE_UNIT
  const product = productFormDims(raw)
  if (product) return product.dims
  const keyed: Array<[RegExp, 'w' | 'h' | 'd']> = [
    [new RegExp(`(?:가로|폭|너비|길이|지름|직경)\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'i'), 'w'],
    [new RegExp(`(?:세로|높이)\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'i'), 'h'],
    [new RegExp(`(?:깊이|두께)\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'i'), 'd'],
  ]
  const dims = keyed
    .map(([re, axis]) => {
      const m = re.exec(raw)
      return m ? { axis, value: Number(m[1]), unit: m[2].toLowerCase() } : null
    })
    .filter((d): d is SizeDim => d !== null)
  if (dims.length > 0) return dims
  const single = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, 'i').exec(raw)
  return single ? [{ axis: 'w', value: Number(single[1]), unit: single[2].toLowerCase() }] : []
}

const colorByName = (label: string) => COLOR_NAMES.find(([name]) => label.includes(name))?.[1] ?? null

function chips(options: unknown[] | undefined): Array<{ label: string; color: string | null }> {
  return (options ?? [])
    .map(str)
    .filter((s): s is string => s !== null)
    .map((label) => ({ label, color: colorByName(label) }))
}

/**
 * 옵션 섹션(T7) 칩 — 등록 옵션 구조(options 기록)가 있으면 등록 옵션명 그대로 + 실물 사진(variants.sourceImage, 없으면 null —
 * 사진 없는 변형은 그리지 않고 이름만), 없으면 카피 colorOptions(기존). 실물 사진은 편집기 옵션 섹션·K 라인업과 같은 기준(isRealOptionPhoto —
 * 공개 http(s)이고 생성 실패·자리표시 URL 아님)만 — 그 밖의 값은 사진 없는 변형으로 본다(D2 ③ 따로 절)
 */
export function optionChips(job: PdpJobRow, copyOptions: unknown[] | undefined, d2: boolean) {
  const spec = optionSpecOf(job.spec_sheet, job.analysis)
  if (!spec) return chips(copyOptions)
  const all = spec.variants
    .slice(0, MAX_OPTION_CHIPS)
    .map((v) => ({ label: v.label, color: colorByName(v.label), image: isRealOptionPhoto(v.sourceImage) ? v.sourceImage! : null }))
  // D2 — 사진 없는 옵션이 섞이면 모두 이름만(칩 형태 통일, 통합 배정 ⑤)
  return d2 ? unifyChips(all) : all
}
