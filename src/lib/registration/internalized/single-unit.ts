/**
 * D 추가 컷 '한 개만'(적용 D5 P2 ①, R-B9 P10·R-B7) — R17-L P10은 단품(보호대 1개)인데 '자세히 보기' 추가 컷(각도·질감)이 보호대 2개를
 * 한 구성처럼 놓았다. 단품 상품의 추가 컷 지시 끝에 K 수량 컷(templatelib shot-brief countSentence)과 같은 말투로 '정확히 1개'를 붙인다.
 * 옵션 최대 수량 상한('6개 이하')으로는 막지 못한다(P10 옵션 1~6개).
 */

import { classifyOptionLabel, isOptionSpec } from '../options/option-spec'
import type { PdpSpecSheet } from '../pdp-state'

/** 구성 칸의 수 — K 입력 값(templatelib input-values quantityOf)과 같은 꼴: 숫자 + 개·매·장·입·세트로 시작 */
const SET_ROW = /^\s*(\d+)\s*(개|매|장|입|세트)/
/** 옵션 수량 값이 낱개 하나인가 — 팩·박스·롤처럼 한 단위에 여럿이 들 수 있는 단위는 단품으로 보지 않는다 */
const OPTION_ONE = /^\s*1\s*(개입|개|매입|매|장|입|구|ea|EA|P|p|세트|셋트|set|SET|쌍|켤레)\s*$/

/** 수량 단위 → 영어 낱말(K countNoun과 같다) — 세트는 set, 쌍·켤레는 pair, 나머지는 piece */
function nounOf(unit: string): string {
  if (/세트|셋트|set/i.test(unit)) return 'set'
  if (/쌍|켤레/.test(unit)) return 'pair'
  return 'piece'
}

/** 등록 옵션의 수량 값 — 구조화된 옵션(optionSpec)의 수량 축, 없으면 옵션 이름(colorOptions)에서 수량 조각 */
function optionQuantities(spec: PdpSpecSheet): string[] {
  if (isOptionSpec(spec.optionSpec)) return spec.optionSpec.axes.filter((axis) => axis.kind === 'quantity').flatMap((axis) => axis.values)
  return (spec.colorOptions ?? []).flatMap((label) => {
    const quantity = typeof label === 'string' ? classifyOptionLabel(label).quantity : undefined
    return quantity ? [quantity] : []
  })
}

const countOf = (value: string) => Number(/\d+/.exec(value)?.[0] ?? 0)

/**
 * 단품이면 '정확히 1개' 문장, 아니면 null.
 * 구성 칸이 있으면 그 칸만 본다 — 숫자 + 개·매·장·입·세트로 시작하고 그 수가 1일 때만 단품이다. 2 이상이거나 숫자로 시작하지 않는
 * 구성(부품 이름 나열 — R17-L P06 '슬리커 브러쉬·미세빗(대)·미세빗(소)'는 옵션이 '1개'여도 3개 구성)은 옵션을 보지 않고 null.
 * 구성 칸이 없으면 옵션 수량 값 가운데 가장 작은 수(옵션 축은 작은 수부터 — 첫 값)가 낱개 하나일 때다. 수량 옵션이 없으면 null.
 */
export function singleUnitSentence(spec: PdpSpecSheet): string | null {
  const row = (spec.extraSpecs ?? []).find((e) => e.key === '구성')
  if (row?.value?.trim()) {
    const set = SET_ROW.exec(row.value)
    return set && Number(set[1]) === 1 ? exactlyOne(nounOf(set[2])) : null
  }
  const values = optionQuantities(spec).filter((value) => countOf(value) >= 1)
  if (values.length === 0) return null
  const first = values.reduce((a, b) => (countOf(b) < countOf(a) ? b : a))
  const one = OPTION_ONE.exec(first)
  return one ? exactlyOne(nounOf(one[1])) : null
}

const exactlyOne = (noun: string) => `Show exactly 1 ${noun} — no more, no fewer.`
