/**
 * Stage 3 무결성(keep·기록 칸)과 '고칠 곳'이 가리키는 최상위 칸 — 순수 함수만(pdp-stage3-fix-effective).
 */

import { describe, expect, it } from 'vitest'
import type { CopywritingResult } from './pdp-state'
import { enforceStage3FieldIntegrity } from './pdp-copy-rules'
import { stage3FixTargets } from './stage3-fix-targets'

const stage2 = { summary: '요약', solution: { summary: '해결' }, howTo: [{ step: '1' }] } as unknown as CopywritingResult

describe('enforceStage3FieldIntegrity — 기록 칸과 keep', () => {
  it('객체가 아니면 Stage 2 그대로 — parsed other, 신고 없음', () => {
    const r = enforceStage3FieldIntegrity(stage2, [1, 2])
    expect(r).toMatchObject({ result: stage2, parsed: 'other', reported: null, changedRatio: 0, changedTopLevel: [] })
  })

  it('미신고면 응답 그대로·비율 0 — 실제로 바뀐 칸(더해진 칸 포함)은 기록에 남는다', () => {
    const r = enforceStage3FieldIntegrity(stage2, { ...stage2, summary: '새 요약', extra: 1 })
    expect(r).toMatchObject({ parsed: 'object', reported: null, changedRatio: 0, driftRestoredFields: [], keptFields: [] })
    expect(r.changedTopLevel.sort()).toEqual(['extra', 'summary'])
  })

  it('빈 신고면 바뀐 칸을 되돌린다 — keep에 든 칸만 남기고 신고로 센다', () => {
    const final = { ...stage2, summary: '새 요약', solution: { summary: '새 해결' }, _changed_fields: [] }
    const plain = enforceStage3FieldIntegrity(stage2, final)
    expect(plain).toMatchObject({ reported: [], driftRestoredFields: ['summary', 'solution'], keptFields: [], changedRatio: 0, changedTopLevel: [] })
    const kept = enforceStage3FieldIntegrity(stage2, final, { keep: new Set(['solution']) })
    expect(kept).toMatchObject({ driftRestoredFields: ['summary'], keptFields: ['solution'], changedTopLevel: ['solution'] })
    expect(kept.changedRatio).toBeCloseTo(1 / 3)
    expect((kept.result as unknown as { _changed_fields?: unknown })._changed_fields).toBeUndefined()
  })

  it('신고 경로는 최상위 칸으로 세고 그대로 쓴다 — keep은 신고된 칸에 영향 없음', () => {
    const r = enforceStage3FieldIntegrity(
      stage2,
      { ...stage2, howTo: [{ step: '2' }], _changed_fields: ['howTo[0].step'] },
      { keep: new Set(['howTo']) }
    )
    expect(r).toMatchObject({ reported: ['howTo[0].step'], keptFields: [], driftRestoredFields: [], changedTopLevel: ['howTo'] })
    expect(r.changedRatio).toBeCloseTo(1 / 3)
  })
})

describe('stage3FixTargets — 고칠 곳이 가리키는 최상위 칸', () => {
  it('반복 섹션은 최상위 칸으로(특징 묶음은 둘, 첫 화면 묶음은 마지막 띠까지), 위치는 첫 마디로', () => {
    const t = stage3FixTargets({
      repeats: [{ phrase: '손가락 대신', sections: ['features', 'summary'] }],
      rhythm: {
        headFields: 1,
        bodyFields: 1,
        headLong: [{ path: 'mainIntro.hook', text: 'x' }],
        badBreaks: [],
        longSentences: [{ path: 'detailPoints[2].proof', text: 'y' }],
        crowded: [],
      },
      rules: { guideEndings: [{ path: 'closingCta.headline', text: '살펴보세요' }], hookType: { words: ['브러쉬'], source: 'copy', present: false } },
    } as unknown as Parameters<typeof stage3FixTargets>[0])
    expect([...t].sort()).toEqual(['closingCta', 'detailPoints', 'mainIntro', 'pointCards', 'summary'])
  })

  it('흐름 — 되풀이 문구·특징·수치 섹션, 제목 되풀이·마지막 띠 위치, 답 없는 고민은 답할 섹션까지(답한 고민은 빼고)', () => {
    const t = stage3FixTargets({
      flow: {
        phrases: [{ phrase: 'a b', sections: ['mainIntro', 'solution'] }],
        features: [{ title: '끈', sections: ['keyMessageCopy'] }],
        numbers: [{ token: '20매', sections: ['compareSummary'] }],
        restated: [{ path: 'conceptCopy.subCopy', title: 't', body: 'b' }],
        closingEcho: [],
        concerns: [
          { path: 'problem.question', text: 'q', keywords: ['k'], answered: false },
          { path: 'problem.empathyLines[0]', text: 'e', keywords: ['k'], answered: true },
        ],
        mismatched: [{ path: 'detailPoints[4]', claim: 'c', proof: 'p' }],
      },
    } as unknown as Parameters<typeof stage3FixTargets>[0])
    expect([...t].sort()).toEqual(
      ['closingCta', 'compareSummary', 'conceptCopy', 'detailPoints', 'howTo', 'keyMessageCopy', 'mainIntro', 'pointCards', 'problem', 'solution'].sort()
    )
    expect(stage3FixTargets({}).size).toBe(0)
  })
})
