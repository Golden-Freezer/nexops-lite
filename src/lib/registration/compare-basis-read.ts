/**
 * 비교 근거 읽기(적용 C5 ②) — 입력 칸 읽기(input-slots-read inputSlotsOf)와 K 칸 채우기(templatelib/input-values)가 같은 값을 받는 한 곳이다.
 * input-slots-read는 templatelib/input-values를 부르므로, 거꾸로 부를 수 있게 비교 근거 거르기만 따로 둔다.
 *
 * 깎아내리기 금지(오너 '비교 상대는 기존 제품'·통합 11-04 01:14 ②·03:3x ⑥) — 기존 칸에 이런 말이 있으면 그 행을 뺀다.
 * 타사 이름은 입력에 브랜드 목록이 없어 이름으로 못 맞춘다. 그래서 표식(타사·경쟁사·A사·○○사·®·™·©)만 본다.
 * 영문 대문자 고유명사 꼴은 USB·LED·PP 같은 정상 값을 지워 쓰지 않는다(통합 03:3x ⑥)
 */

import { isFactClaimSafe } from './eval/claim-lexicon'
import { cleanCompareBasis, cleanCompareSource, type CompareBasisRow } from './input-slots'
import type { PdpSpecSheet } from './pdp-state'

const DISPARAGING = /나쁨|나쁜|불편|약함|약한|약해|떨어짐|떨어지는|싸구려|저가형|불량|허접|조잡|최악|형편없|쉽게\s*(?:망가|부서|찢어|끊어)|금방\s*(?:망가|부서|찢어|끊어)/
export const RIVAL_MARK = /타사|경쟁사|[A-Za-z○◯◎●△□]{1,3}\s?사(?![가-힣])|[®™©]/

const fairRow = (row: CompareBasisRow) => !DISPARAGING.test(row.other ?? '') && !RIVAL_MARK.test(`${row.label} ${row.ours} ${row.other ?? ''}`)

/** 페이지에 실어도 되는 비교 행 — 정리(cleanCompareBasis) 뒤 깎아내리는 행·타사 표식 행·규제 표현 행을 뺀다. 순서는 입력 그대로 */
export function pageCompareBasis(spec: Pick<PdpSpecSheet, 'compareBasis' | 'certificationInfo'>): CompareBasisRow[] {
  const safe = (text: string) => isFactClaimSafe(text, spec.certificationInfo)
  return cleanCompareBasis(spec.compareBasis).filter((row) => fairRow(row) && safe(`${row.label} ${row.ours} ${row.other ?? ''}`))
}

/** 페이지에 실어도 되는 비교 출처 — 규제 표현·타사 표식이 있으면 null */
export function pageCompareSource(spec: Pick<PdpSpecSheet, 'compareSource' | 'certificationInfo'>): string | null {
  const source = cleanCompareSource(spec.compareSource)
  return source && isFactClaimSafe(source, spec.certificationInfo) && !RIVAL_MARK.test(source) ? source : null
}
