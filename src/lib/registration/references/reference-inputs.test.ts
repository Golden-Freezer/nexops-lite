import { describe, expect, it } from 'vitest'
import { specSheetPromptJson, type PdpJobRow, type PdpSpecSheet } from '../pdp-state'
import { competitorEchoGuard } from '../pdp-review-stage'
import { findCopyEchoes } from '../reviews/competitor-echo'
import { checkCopySimilarity, loadCorpusCheck, mergeCorpusChecks } from '../similarity-gate'
import { readReferenceInputs, referenceCorpusCheck, referenceGuardTexts } from './reference-inputs'
import type { ReferenceInput } from './reference-types'

const COMPETITOR_LINE = '물에 헹구기만 하면 끝나는 간편한 세척 구조라서 매일 쓰기 좋아요'
const OWN_LINE = '두 아이 밥상을 나란히 차리는 일체형 이구 식기로 준비해요'

const ref = (over: Partial<ReferenceInput> = {}): ReferenceInput => ({
  id: 'r1',
  kind: 'competitor',
  fileName: 'page.png',
  source: 'image',
  units: 4,
  insights: { version: 1, sections: [{ start: 0, end: 20, role: 'hook', layout: 'full_photo', visual: '제품 단독', move: '공감→약속', appeals: ['세척 편의'], density: 'low' }], flow: 'hook', strengths: [], weaknesses: [], regulatedSuspects: 0 },
  transcript: COMPETITOR_LINE,
  costUsd: 0.08,
  analyzedAt: '2026-10-30T00:00:00.000Z',
  warnings: [],
  ...over,
})
const spec = (referenceInputs: unknown): PdpSpecSheet => ({ productName: '식기', referenceInputs } as unknown as PdpSpecSheet)

describe('readReferenceInputs — 모양 확인과 상한', () => {
  it('모양이 틀린 항목은 버리고 잡당 3개까지', () => {
    const list = [ref({ id: 'a' }), { kind: 'competitor' }, ref({ id: 'b', kind: 'x' as never }), ref({ id: 'c' }), ref({ id: 'd' }), ref({ id: 'e' })]
    expect(readReferenceInputs(spec(list)).map((r) => r.id)).toEqual(['a', 'c', 'd'])
    expect(readReferenceInputs(spec('x'))).toEqual([])
    expect(readReferenceInputs(undefined)).toEqual([])
  })

  it('어휘 밖 구간은 빼고 글 칸·원문을 상한으로 자른다', () => {
    const r = ref({ transcript: '가'.repeat(30_000) })
    ;(r.insights.sections as unknown[]).push({ start: 0, end: 1, role: '모름', layout: 'table' })
    const [read] = readReferenceInputs(spec([r]))
    expect(read.insights.sections).toHaveLength(1)
    expect(read.transcript).toHaveLength(20_000)
  })

  it('프롬프트 스펙 JSON에 들어가지 않는다', () => {
    expect(specSheetPromptJson(spec([ref()]))).not.toContain('referenceInputs')
  })
})

describe('가드 — own이 아닌 레퍼런스 원문은 재현 가드·유사도 검사에, own 원문은 재현 가드에서 뺀다', () => {
  it('guard 글: texts = 경쟁·기타, exclude = own', () => {
    const g = referenceGuardTexts(spec([ref(), ref({ id: 'o', kind: 'own', transcript: OWN_LINE }), ref({ id: 'x', kind: 'other', transcript: '' })]))
    expect(g).toEqual({ texts: [COMPETITOR_LINE], exclude: [OWN_LINE] })
  })

  it('재현 가드 — 레퍼런스 문장을 옮긴 카피 섹션을 찾고, own 문장은 찾지 않는다', () => {
    const job = { spec_sheet: spec([ref(), ref({ id: 'o', kind: 'own', transcript: OWN_LINE })]) } as PdpJobRow
    const guard = competitorEchoGuard(job)!
    const hits = findCopyEchoes({ mainIntro: { title: COMPETITOR_LINE }, closingCta: { headline: OWN_LINE } } as never, guard)
    expect(hits).toEqual(expect.arrayContaining([expect.stringContaining('mainIntro')]))
    expect(hits.some((h) => h.includes('closingCta'))).toBe(false)
  })

  it('레퍼런스·경쟁사 리뷰가 없는 잡은 재현 가드가 없다(예전과 같음)', () => {
    expect(competitorEchoGuard({ spec_sheet: spec(undefined) } as PdpJobRow)).toBeNull()
    expect(referenceCorpusCheck(spec(undefined))).toBeNull()
  })

  it('유사도 검사 — 잡 단위 임시 코퍼스가 레퍼런스 문장과 비슷한 카피 문장을 잡는다', () => {
    const corpus = mergeCorpusChecks(loadCorpusCheck('none'), referenceCorpusCheck(spec([ref()])))
    const findings = checkCopySimilarity({ mainIntro: { title: `${COMPETITOR_LINE}!` } } as never, corpus)
    expect(findings.map((f) => f.section)).toEqual(['mainIntro'])
    expect(checkCopySimilarity({ mainIntro: { title: OWN_LINE } } as never, corpus)).toEqual([])
  })
})
