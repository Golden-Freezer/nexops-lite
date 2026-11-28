/**
 * K spec 정본 고정(결정 카드 c27, 하네스 J23 — 가정 C5 'K 옵션 칩 원천 = spec 정본', 스위치 specfixed 기본 off). 순수·결정론.
 *
 * - 옵션 칩: K 입력(lineInputsOf)은 등록 옵션 구조(optionSpec, 변형 2개 이상)가 있으면 그것을 쓰고, 없으면 카피 최상위 options 칸을 읽는다.
 *   그 칸은 카피 결과에 없어(11-09 DB 읽기 전용, 11-01 뒤 K 잡 57개 모두 없음) 옵션 칩이 늘 비었다. 켜진 잡은 그 자리에서 판매자 입력
 *   (optionSpec 변형 이름 → colorOptions)을 이름만으로 쓴다. 입력에도 옵션이 없으면 지금 그대로다.
 * - 고정 값 줄: K 칸 카피 프롬프트에 크기·소재·옵션 수를 판매자 입력 그대로 쓰라는 줄을 준다. 메인 카피는 소재·크기(상품 사실 블록)와
 *   등록 옵션 구조의 옵션 수(사실 값 블록)를 이미 받으므로, 등록 옵션 구조가 없는 잡에만 옵션 수 한 줄을 더한다.
 * 규제 표현이 든 값은 줄로 넘기지 않는다(이 줄은 '이 값을 쓴다'는 지시라 넘기면 카피가 그 표현을 사실로 옮긴다).
 */

import { claimSafeFactRows } from '../eval/claim-lexicon'
import { isOptionSpec } from '../options/option-spec'
import type { PdpSpecSheet } from '../pdp-state'

/** 옵션 이름 상한 — 옵션 칩 상한(designcut-inputs MAX_OPTION_CHIPS)과 같다 */
export const SPEC_OPTION_MAX = 12
/** 줄에 이름까지 적는 옵션 수 상한 — 넘으면 개수만 적는다 */
const OPTION_NAMES_IN_LINE = 6

const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** 판매자 입력 옵션 이름 — 등록 옵션 구조 변형 이름을 먼저, 없으면 colorOptions. 빈 값·같은 이름은 한 번, 상한까지 */
export function specOptionLabels(spec: Pick<PdpSpecSheet, 'optionSpec' | 'colorOptions'>): string[] {
  const source: unknown[] = isOptionSpec(spec.optionSpec) && spec.optionSpec.variants.length > 0 ? spec.optionSpec.variants.map((variant) => variant.label) : (spec.colorOptions ?? [])
  return [...new Set(source.map(oneLine).filter(Boolean))].slice(0, SPEC_OPTION_MAX)
}

const optionRow = (labels: readonly string[]) => ({
  label: `옵션 ${labels.length}개`,
  value: labels.length <= OPTION_NAMES_IN_LINE ? labels.join('/') : '',
})

const lineOf = (row: { label: string; value: string }) => (row.value ? `- ${row.label}: ${row.value}` : `- ${row.label}`)

/** K 칸 카피 고정 값 줄 — 크기·소재·옵션 수. 값이 없는 것은 줄이 없다 */
export function specFixedLines(spec: PdpSpecSheet, optionLabels: readonly string[]): string[] {
  const rows = [
    ...(oneLine(spec.size) ? [{ label: '크기', value: oneLine(spec.size) }] : []),
    ...(oneLine(spec.material) ? [{ label: '소재', value: oneLine(spec.material) }] : []),
    ...(optionLabels.length > 0 ? [optionRow(optionLabels)] : []),
  ]
  return claimSafeFactRows(rows, spec.certificationInfo).map(lineOf)
}

/** 메인 카피 옵션 수 블록 — 등록 옵션 구조가 없는 잡(사실 값 블록이 없는 잡)에만 부른다. 옵션이 없으면 빈 글 */
export function buildSpecOptionCountBlock(spec: PdpSpecSheet): string {
  const labels = specOptionLabels(spec)
  const lines = labels.length > 0 ? claimSafeFactRows([optionRow(labels)], spec.certificationInfo).map(lineOf) : []
  if (lines.length === 0) return ''
  return ['## [사실 값 — 옵션 수는 이 값만 쓴다]', ...lines, '- 위 개수와 다른 옵션 수를 쓰지 않는다.'].join('\n')
}
