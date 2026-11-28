/**
 * K 사진 아닌 정보 칸(infocells 스위치, 세션 B — 오너 2026-11-06 ④ P07 '차트·그래프·픽토그램') — 입력 근거가 있는 정지 도식 템플릿(사실 타일·사용 순서 도식·구성 타일)을
 * 켠 잡에만 연다. 템플릿은 needs.evidence에 INFOCELLS_EVIDENCE를 적고, 그 근거는 select-line(lineEvidenceOf)이 스위치 잡에만 세운다. 꺼진 잡은 근거 잠금으로
 * 후보가 0이라 선택·컷·렌더가 바이트까지 같다. 이름·숫자는 입력 글 그대로다 — 성능 수치·경쟁 비교·시간/효과 그래프는 없다. 순수·결정론.
 */

import { COLOR_QUANTITY_LABEL, productInfoRows } from '../product-info-rows'
import type { FactIconName, IconName } from './icons'

/** 정보 칸 근거 이름 — 스펙에서 나오지 않고 스위치로만 선다(selection-facts evidenceOf에는 없다) */
export const INFOCELLS_EVIDENCE = 'infocells'
/** 쪽당 정보 칸 상한(설계 I4 '근거가 있을 때 2~3개') — 순서 풀이가 넘는 후보를 다음 후보로 넘긴다 */
export const INFO_CELL_MAX = 3

/** 정보 칸 템플릿인가 — 근거 잠금 이름으로 가른다 */
export const isInfoCell = (t: { needs: { evidence: readonly string[] } }): boolean => t.needs.evidence.includes(INFOCELLS_EVIDENCE)

/**
 * 정보 칸 카피 안내(K6 P05 — 제목 '덮개로 감싸 깔끔하게 휴대'가 아래 사실 줄과 어긋남) — 카피 모델은 코드가 채우는 입력 줄을 못 보므로, 그 칸이 무엇을 싣는지와
 * 제목·한 줄이 그 줄을 묶는 말이라는 것을 섹션 설명 뒤 한 줄로 알린다. 새 사실·장점을 더하라는 말은 없다(규제 표현·숫자 검사는 그대로). 정보 칸 섹션에만 붙는다
 */
const INFO_CELL_COPY_NOTES: Readonly<Record<string, string>> = {
  'sub_div.fact-icons':
    '  칸 안내: 이 섹션 아래에는 코드가 상품 정보 표의 기본 정보(사이즈·소재 같은 이름과 값)를 아이콘 줄로 입력 그대로 싣는다. headline은 그 기본 정보를 묶어 소개하는 짧은 말로 쓰고, 줄에 없는 장점·쓰는 장면을 새로 말하지 않는다.',
  'how_to.flow-steps':
    '  칸 안내: 이 섹션 아래에는 입력된 사용 순서 단계가 번호와 화살표로 그대로 실린다. headline은 그 순서를 여는 짧은 말로 쓰고, 단계에 없는 동작·효과를 새로 말하지 않는다.',
  'product_exposure.parts-tiles':
    '  칸 안내: 이 섹션 아래에는 입력된 구성품 이름이 번호와 이름표로 그대로 실린다. caption은 그 구성을 소개하는 짧은 말로 쓰고, 이름에 없는 구성품·수량을 새로 말하지 않는다.',
}

/** 정보 칸 템플릿의 카피 안내 줄 — 정보 칸이 아니면 null(카피 프롬프트가 지금 그대로다) */
export const infoCellCopyNote = (templateId: string): string | null => (Object.prototype.hasOwnProperty.call(INFO_CELL_COPY_NOTES, templateId) ? INFO_CELL_COPY_NOTES[templateId] : null)

type FactIcon = IconName | FactIconName

/** 특별한 내용 행 이름(공백 뺌, 앞부분 일치) → 아이콘. 용량·호환처럼 뜻이 정해진 그림이 없는 행은 싣지 않는다 */
const SPECIAL_ROW_ICONS: ReadonlyArray<readonly [RegExp, FactIcon]> = [
  [/^(구성품?|세트구성)/, 'set'],
  [/^(세탁|관리방법)/, 'clean'],
  [/^보관방법/, 'storage'],
  [/^(전원|정격|소비전력|배터리)/, 'power'],
  [/^(유통기한|소비기한|사용기한)/, 'time'],
]

/**
 * 표 행 하나의 아이콘 — 상품명·브랜드·사용연령(고정 표기)은 그림으로 말할 사실이 아니라 null.
 * 원산지도 싣지 않는다(오너 2026-11-06 21:38 "'쓰기 전 꼭 확인할 정보' 세션에는 원산지는 넣지 마라" — 운영 P08 ea485268 k9_sub_div).
 * 원산지는 맨 아래 상품 정보 표(productInfoRows 필수 7행)에 그대로 있다. origin 아이콘 그림은 옛 잡 기록을 다시 그릴 때 쓰여 남긴다
 */
function factIconOf(label: string, value: string): FactIcon | null {
  if (label === '사이즈') return 'size'
  if (label === '소재') return 'material'
  // 색상/수량 — 값이 수량만이면(숫자로 시작) 구성 그림, 색·디자인 이름이 있으면 색 그림
  if (label === COLOR_QUANTITY_LABEL) return /^\d/.test(value) ? 'set' : 'color'
  const key = label.replace(/\s+/g, '')
  return SPECIAL_ROW_ICONS.find(([pattern]) => pattern.test(key))?.[1] ?? null
}

export interface FactTile {
  icon: FactIcon
  label: string
  value: string
}

/**
 * 사실 타일 — 상품 정보 표 행(productInfoRows, 규제 표현 행은 이미 빠졌다)을 표 순서대로, 아이콘이 정해진 행만 이름·값 그대로 싣는다. 같은 아이콘은 첫 행 한 번이다.
 * 표는 페이지 끝에 늘 있어 이 칸은 요약이다 — 칸 수·글자 상한은 부르는 쪽(input-values)이 맞춘다
 */
export function factTiles(spec: object): FactTile[] {
  const seen = new Set<FactIcon>()
  return productInfoRows(spec).flatMap((row) => {
    const icon = factIconOf(row.label, row.value)
    if (!icon || seen.has(icon)) return []
    seen.add(icon)
    return [{ icon, label: row.label, value: row.value }]
  })
}
