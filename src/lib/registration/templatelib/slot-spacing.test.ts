/**
 * 칸 카피 띄어쓰기 가드(J64) — 공백을 지워 붙인 줄이 한 페이지에 몰리면 그 줄을 고칠 곳으로 낸다. 줄 하나·바르게 붙는 낱말로는 내지 않는다. 순수.
 */

import { describe, expect, it } from 'vitest'
import { asksFix, dropsText, type CopySlot, type CopyValues } from './slot-copy'
import { isSquashedLine, pageSpacingProblems, SPACING_PAGE_MIN, type SpacingSection } from './slot-spacing'

const headline: CopySlot = { name: 'headline', required: true, facts: 0, maxChars: 20 }
const sub: CopySlot = { name: 'sub', required: false, facts: 0, maxChars: 40 }
const tags: CopySlot = { name: 'tags', required: false, facts: 0, maxChars: 8, tags: { min: 1, max: 3 } }
const step: CopySlot = { name: 'step', required: false, facts: 0, maxChars: 6 }
const items: CopySlot = { name: 'items', required: false, facts: 0, list: { min: 1, max: 3, fields: [{ name: 'item', required: true, facts: 0, maxChars: 30 }] } }

/** J59 켬 잡 c5555eff 칸 글(제목·보조·캡션) — 렌더까지 붙은 채 갔다 */
const J59_ON: Array<Record<string, string>> = [
  { headline: '두피구석까지\n실리콘미세모', sub: '적당한탄성마사지설계' },
  { headline: '한손에잡히는\n남녀공용\n휴대형브러시', sub: '틈새 물때 걱정을 줄인\n일체형 구조로 깔끔하게 관리해요.' },
  { headline: '손으로감아도\n두피가덜씻겨\n찝찝하셨나요' },
  { headline: '직접써본분들의\n생생한사용후기' },
  { headline: '한눈에살펴보는\n상품기본정보' },
  { headline: '거품낸두피에\n직접문질러본모습' },
  { headline: '매일감는두피를\n산뜻하게바꿔보세요' },
]
const pageOf = (rows: Array<Record<string, unknown>>, slots: CopySlot[] = [headline, sub]) => {
  const sections: SpacingSection[] = rows.map((_, index) => ({ index, slots }))
  const values = new Map(rows.map((row, index) => [index, row as CopyValues]))
  return pageSpacingProblems(sections, values)
}
const flat = (out: ReturnType<typeof pageSpacingProblems>) => [...out.values()].flat()

describe('붙은 줄 판정', () => {
  it('공백 없는 줄에 붙은 한글 6자+ 덩어리가 있으면 붙은 줄이다', () => {
    expect(isSquashedLine('직접써본분들의')).toBe(true)
    expect(isSquashedLine('  두피구석까지 ')).toBe(true)
    expect(isSquashedLine('85mmx80mm')).toBe(false)
    expect(isSquashedLine('남녀공용')).toBe(false)
    expect(isSquashedLine('직접 써본 분들의')).toBe(false)
    expect(isSquashedLine('틈새 물때 걱정을 줄인')).toBe(false)
  })
})

describe('페이지 띄어쓰기 문제', () => {
  it('J59 켬 페이지 — 붙은 줄마다 spacing 문제가 나오고, 띄어 쓴 줄은 나오지 않는다', () => {
    const problems = flat(pageOf(J59_ON))
    expect(problems.length).toBe(16)
    expect(problems.every((p) => p.kind === 'spacing')).toBe(true)
    expect(problems.map((p) => p.detail)).toContain("'적당한탄성마사지설계' — 페이지에 띄어쓰기 없는 줄 16개")
    expect(problems.some((p) => p.detail.includes('틈새'))).toBe(false)
    // 섹션 번호를 지킨다 — 고치기 콜이 그 섹션만 다시 쓴다
    expect([...pageOf(J59_ON).keys()]).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('바르게 붙는 한 낱말 줄이 하한보다 적은 페이지는 내지 않는다(끔 잡 808be0b1 꼴 4줄)', () => {
    const off = [{ headline: '손가락만으론\n덜 감긴 듯\n찝찝하셨나요?' }, { headline: '남녀공용으로\n이럴 때 권해드려요' }, { headline: '한 손에 감기는\n일체형 그립', sub: '남녀공용이라' }]
    expect(pageOf(off).size).toBe(0)
    const justBelow = J59_ON.flatMap((row) => row.headline.split('\n')).filter(isSquashedLine).slice(0, SPACING_PAGE_MIN - 1)
    expect(pageOf(justBelow.map((line) => ({ headline: line }))).size).toBe(0)
    const atMin = J59_ON.flatMap((row) => row.headline.split('\n')).filter(isSquashedLine).slice(0, SPACING_PAGE_MIN)
    expect(flat(pageOf(atMin.map((line) => ({ headline: line })))).length).toBe(SPACING_PAGE_MIN)
  })

  it('이름표·소구 이름 칸(공백 없는 낱말 규칙)은 세지 않고, 목록 항목 칸은 센다', () => {
    const word = '매일샴푸시간'
    expect(pageOf(Array.from({ length: 8 }, () => ({ tags: [word, word], step: '편안한그립감' })), [tags, step]).size).toBe(0)
    const listed = flat(pageOf(Array.from({ length: 6 }, () => ({ items: [{ item: '보관이간편한휴대용' }] })), [items]))
    expect(listed.map((p) => p.slot)).toEqual(Array(6).fill('items.item'))
  })

  it('spacing은 고치기 콜을 부르고 글은 지우지 않는다 — 고쳐도 남으면 경고만', () => {
    expect(asksFix('spacing')).toBe(true)
    expect(dropsText('spacing')).toBe(false)
  })
})
