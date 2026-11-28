import { describe, expect, it } from 'vitest'
import { flowOf, mergeReferenceBatches, readReferenceBatch, type ReferenceBatch } from './reference-insights'

const batch = (over: Partial<ReferenceBatch> = {}): ReferenceBatch => ({
  transcript: [],
  sections: [],
  strengths: [],
  weaknesses: [],
  lastRole: null,
  ...over,
})

describe('readReferenceBatch — 모델 응답 한 묶음', () => {
  it('sections가 없으면 예외(호출기가 재시도·실패로 처리)', () => {
    expect(() => readReferenceBatch(null)).toThrow('sections')
    expect(() => readReferenceBatch({ transcript: [] })).toThrow('sections')
  })

  it('받아쓰기·관찰·마지막 역할을 읽는다', () => {
    const b = readReferenceBatch({
      transcript: [{ unit: 1, text: ' 첫 화면 문구 ' }, { text: '둘째' }, 'x'],
      sections: [{ role: 'hook' }],
      observations: { strengths: ['큰 제목'], weaknesses: ['근거 부족'] },
      last_role: 'usp',
    })
    expect(b.transcript).toEqual([
      { unit: 1, text: '첫 화면 문구' },
      { unit: 2, text: '둘째' },
    ])
    expect([b.strengths, b.weaknesses, b.lastRole]).toEqual([['큰 제목'], ['근거 부족'], 'usp'])
  })
})

describe('flowOf — 역할 순서(같은 역할 연속은 ×n)', () => {
  it('hook → problem → usp ×3 → cta', () => {
    expect(flowOf(['hook', 'problem', 'usp', 'usp', 'usp', 'cta'])).toBe('hook → problem → usp ×3 → cta')
    expect(flowOf([])).toBe('')
  })
})

describe('mergeReferenceBatches — 묶음 합치기와 검사', () => {
  it('어휘 밖 역할·레이아웃은 other, 위치는 0~100, 시작 순으로 정렬', () => {
    const { insights } = mergeReferenceBatches([
      batch({ sections: [{ start: 40, end: 60, role: 'usp', layout: 'two_column', density: 'high', appeals: ['세척 편의'] }] }),
      batch({ sections: [{ start: -5, end: 12, role: '후킹', layout: '?', visual: '제품 단독 컷, 흰 바탕' }, { start: 70, end: 10, role: 'cta' }] }),
    ])
    expect(insights.sections.map((s) => [s.start, s.end, s.role, s.layout, s.density])).toEqual([
      [0, 12, 'other', 'other', 'medium'],
      [40, 60, 'usp', 'two_column', 'high'],
    ])
    expect(insights.flow).toBe('other → usp')
  })

  it('받아쓴 원문을 15자 넘게 옮긴 글 칸은 버린다 — 원문 자체는 transcript에 남긴다', () => {
    const copied = '물에 헹구기만 하면 끝나는 간편한 세척 구조'
    const merged = mergeReferenceBatches([
      batch({
        transcript: [{ unit: 1, text: copied }],
        sections: [{ start: 0, end: 20, role: 'usp', layout: 'full_photo', visual: copied, move: '주장→근거', appeals: [copied, '세척 편의'] }],
        strengths: [copied, '첫 화면에 제품이 크게 보인다'],
      }),
    ])
    const s = merged.insights.sections[0]
    expect([s.visual, s.move, s.appeals]).toEqual(['', '주장→근거', ['세척 편의']])
    expect(merged.insights.strengths).toEqual(['첫 화면에 제품이 크게 보인다'])
    expect(merged.dropped).toBe(3)
    expect(merged.transcript).toBe(copied)
  })

  it('관찰은 중복을 빼고 4개까지, 규제 표현 의심은 수치만', () => {
    const merged = mergeReferenceBatches([
      batch({ transcript: [{ unit: 1, text: '99.9% 살균되는 소재' }], strengths: ['a', 'b', 'c'] }),
      batch({ transcript: [{ unit: 1, text: '통증 치료에 좋아요' }], strengths: ['a', 'd', 'e'] }),
    ])
    expect(merged.insights.strengths).toEqual(['a', 'b', 'c', 'd'])
    expect(merged.insights.regulatedSuspects).toBe(2)
  })
})
