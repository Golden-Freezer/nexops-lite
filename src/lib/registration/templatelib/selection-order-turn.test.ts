/**
 * K 라인 채움 돌리기(적용 K12 개선 #5) — turn 순위·여유 높이·모자란 손 컷·컷 몫·흰 바탕 거름. 템플릿은 시험용 가짜 메타데이터다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { conceptById } from './concepts'
import { one, tpl } from './selection.fixture'
import { FILLER_MAX, PAGE_SHOT_MAX, RENDER_HEIGHT_RATIO, solveOrder } from './selection-order'
import { PAGE_MIN_HEIGHT, type TemplateMeta } from './template-meta'

const concept = conceptById('clean-trust')!

describe('채움 돌리기(개선 #5)', () => {
  const page = (n: number, height: number, slots?: TemplateMeta['slots']) =>
    Array.from({ length: n }, (_, i) => one(`s${i}`, tpl(`s${i}.t`, { section: `s${i}`, height, ...(slots ? { slots } : {}) })))
  const enoughAt = (n: number) => Math.ceil(PAGE_MIN_HEIGHT / RENDER_HEIGHT_RATIO / n)
  /** 목록 순서가 turn 값이다 — 앞일수록 먼저 돌아온다 */
  const turnOf = (ids: readonly string[]) => (template: Pick<TemplateMeta, 'id'>) => ids.indexOf(template.id)
  const fillerIds = (r: { sections: Array<{ filler?: boolean; templateId: string }> }) => r.sections.filter((s) => s.filler).map((s) => s.templateId)
  const photos = (n: number, composition = ['front']): TemplateMeta['slots'] => ({
    must: { type: 'text', required: true, source: 'copy', facts: 0 },
    ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { type: 'image' as const, required: true, purpose: ['scene'], composition }])),
  })

  it('조건이 같으면 turn 값이 작은 채움을 고른다 — turn이 없으면 옛 순위(첫 후보)다', () => {
    const base = page(19, enoughAt(18))
    const fillers = [one('f', tpl('f.a'), tpl('f.b'), tpl('f.c'))]
    expect(fillerIds(solveOrder(base, concept, { fillers }))).toEqual(['f.a'])
    expect(fillerIds(solveOrder(base, concept, { fillers, fillerTurn: turnOf(['f.b', 'f.c', 'f.a']) }))).toEqual(['f.b'])
    expect(fillerIds(solveOrder(base, concept, { fillers, fillerTurn: turnOf(['f.c', 'f.a', 'f.b']) }))).toEqual(['f.c'])
  })

  it('turn보다 남은 채움 칸으로 나눈 여유 높이(합격점 + 500)를 맞추는 채움이 먼저다', () => {
    // 본문 26,197 — 여유까지 1,868을 네 칸으로 나누면 467이라 360짜리는 모자라다(여유 0이면 342라 맞는다)
    const r = solveOrder(page(19, enoughAt(20)), concept, {
      fillers: [one('f', tpl('f.small', { height: 400 }), tpl('f.tall', { height: 2000 }))],
      fillerTurn: turnOf(['f.small', 'f.tall']),
    })
    expect(fillerIds(r)).toEqual(['f.tall'])
    expect(r.height.meetsRequired).toBe(true)
  })

  it('아직 모자란 손 컷 최소 장 수를 채우는 채움을 turn보다 먼저 고른다', () => {
    const r = solveOrder(page(19, enoughAt(18), photos(1, ['closeup'])), concept, {
      fillers: [one('f', tpl('f.front', { slots: photos(1, ['front']) }), tpl('f.hand', { slots: photos(1, ['in_hand']) }))],
      fillerTurn: turnOf(['f.front', 'f.hand']),
    })
    expect(fillerIds(r)).toEqual(['f.hand'])
  })

  it('컷 몫 — 앞 채움이 남은 컷을 다 써 뒤 칸에 글만 있는 짧은 채움이 들어가지 않게 한다(P07)', () => {
    // 본문 컷 25 — 상한 32까지 남은 7컷을 채움 네 칸이 나눠 쓴다. 몫을 안 보면 4·3컷 채움이 먼저 와 셋째부터 글만 있는 채움이다
    const base = [...page(15, enoughAt(20), photos(1)), one('big', tpl('big.t', { height: enoughAt(20), slots: photos(10) }))]
    const r = solveOrder(base, concept, {
      fillers: [
        one('h4', tpl('h4.t', { height: 2000, slots: photos(4) })),
        one('h3', tpl('h3.t', { height: 2000, slots: photos(3) })),
        ...['a', 'b', 'c', 'd'].map((k) => one(`l${k}`, tpl(`l${k}.t`, { height: 2000, slots: photos(1) }))),
        one('text', tpl('text.t', { height: 600 })),
      ],
      fillerTurn: turnOf(['h4.t', 'h3.t', 'la.t', 'lb.t', 'lc.t', 'ld.t', 'text.t']),
    })
    expect(fillerIds(r)).toHaveLength(FILLER_MAX)
    expect(fillerIds(r)).not.toContain('text.t')
    expect(fillerIds(r)).not.toContain('h3.t')
    expect(r.sections.reduce((sum, s) => sum + s.shots.length, 0)).toBeLessThanOrEqual(PAGE_SHOT_MAX)
    expect(r.height.meetsRequired).toBe(true)
  })

  it('흰 바탕 연속을 W_MAX_RUN 넘게 새로 늘리는 채움은 버리고 다음 후보를 쓴다(P09 밝은 리듬)', () => {
    const base = Array.from({ length: 19 }, (_, i) => one(`s${i}`, tpl(`s${i}.t`, { section: `s${i}`, height: enoughAt(18), surfaces: ['W'] })))
    const fillers = [one('f', tpl('f.white', { surfaces: ['W'] }), tpl('f.tint', { surfaces: ['W', 'T', 'N'] }))]
    const light = { rhythm: 'light' as const }
    expect(fillerIds(solveOrder(base, light, { fillers, fillerTurn: turnOf(['f.white', 'f.tint']) }))).toEqual(['f.tint'])
    expect(fillerIds(solveOrder(base, light, { fillers }))).toEqual(['f.tint'])
  })
})
