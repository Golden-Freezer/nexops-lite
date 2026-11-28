/**
 * K 슬롯 글 띄어쓰기 가드(하네스 J64, 통합 11-11 — J59 켬 잡 c5555eff). 칸 카피 모델이 '한 줄 N자'에 맞추려 공백을 지운 페이지를 잡는다.
 * 그 잡은 제목 줄이 '두피구석까지 / 실리콘미세모'·'직접써본분들의'처럼 통째로 붙어 렌더까지 갔다(같은 단계 끔 잡은 0줄).
 *
 * 줄 하나로는 못 가른다 — '번거로우신가요'·'폴리에스터입니다'처럼 바르게 붙는 한 낱말도 6~8자다(K 잡 109개 칸 글 읽기: 붙은 한글 7자+ 줄이
 * 켬 잡 12줄, 나머지 25줄). 붙여 쓰기는 한 페이지에 몰려 나오므로 페이지에서 센다: 공백 없는 줄에 붙은 한글 6자+ 덩어리가 있으면 한 줄,
 * 그런 줄이 SPACING_PAGE_MIN 이상인 페이지만 그 줄 모두를 고칠 곳으로 낸다(켬 잡 28줄, 나머지 108잡은 많아야 4줄).
 * 'spacing'은 고치기 콜을 부르지만 글은 지우지 않는다 — 고쳐도 남은 줄은 기록(경고)만 남고 페이지는 그대로 간다. 순수·결정론.
 */

import { POINT_STEP_SLOT } from './template-types'
import type { CopySlot, CopyValues, SlotProblem } from './slot-copy'

/** 붙은 한글 덩어리 길이 하한 — 이 길이 이상 덩어리가 있고 공백이 없는 줄을 센다 */
export const SPACING_RUN_MIN = 6
/** 페이지 하한 — 그런 줄이 이 수 이상이면 붙여 쓴 페이지다(K 잡 109개 읽기: 켬 잡 28, 나머지 최대 4) */
export const SPACING_PAGE_MIN = 6

const HANGUL_RUN = new RegExp(`[가-힣]{${SPACING_RUN_MIN},}`)

/** 공백 없이 붙은 줄인가 — 줄 안에 공백이 없고 붙은 한글 SPACING_RUN_MIN자+ 덩어리가 있다 */
export const isSquashedLine = (line: string): boolean => {
  const text = line.trim()
  return !/\s/.test(text) && HANGUL_RUN.test(text)
}

export interface SpacingSection {
  index: number
  slots: readonly CopySlot[]
}

/** 검사할 글 칸 — 이름표(공백 없는 낱말 규칙)·소구 이름(낱말 하나 규칙)·아이콘 칸은 뺀다 */
function linesOf(slots: readonly CopySlot[], values: CopyValues): Array<{ slot: string; line: string }> {
  return slots.flatMap((slot) => {
    if (slot.tags || slot.choices || slot.name === POINT_STEP_SLOT) return []
    const value = values[slot.name]
    const texts: Array<{ slot: string; text: string }> = slot.list
      ? (Array.isArray(value) ? value : []).flatMap((item) =>
          typeof item === 'string' ? [] : slot.list!.fields.filter((field) => !field.choices && typeof item[field.name] === 'string').map((field) => ({ slot: `${slot.name}.${field.name}`, text: item[field.name] }))
        )
      : typeof value === 'string'
        ? [{ slot: slot.name, text: value }]
        : []
    return texts.flatMap(({ slot: name, text }) => text.split('\n').map((line) => ({ slot: name, line })))
  })
}

/** 섹션 번호 → 띄어쓰기 문제. 붙은 줄이 SPACING_PAGE_MIN 미만인 페이지는 빈 값이다 */
export function pageSpacingProblems(sections: readonly SpacingSection[], values: ReadonlyMap<number, CopyValues>): Map<number, SlotProblem[]> {
  const squashed = sections.flatMap(({ index, slots }) =>
    linesOf(slots, values.get(index) ?? {})
      .filter(({ line }) => isSquashedLine(line))
      .map((row) => ({ index, ...row }))
  )
  const out = new Map<number, SlotProblem[]>()
  if (squashed.length < SPACING_PAGE_MIN) return out
  for (const { index, slot, line } of squashed) {
    const problem: SlotProblem = { slot, kind: 'spacing', detail: `'${line.trim()}' — 페이지에 띄어쓰기 없는 줄 ${squashed.length}개` }
    out.set(index, [...(out.get(index) ?? []), problem])
  }
  return out
}
