/**
 * K 칸 카피 화면 글 가드(결정 카드 c03) — 잡에서 만든 블록·검사 재료와 칸 글 검사. 해당 없는 잡은 빈 객체(프롬프트·검사 그대로). LLM 0.
 */

import { describe, expect, it } from 'vitest'
import { REVIEW_CLAIM_BLOCK } from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import { buildAgeComplianceCopyBlock } from './compliance-gate'
import { slotCopyGuardOf } from './kline-copy-guard'
import type { PdpJobRow } from './pdp-state'
import { checkCopyValues, dropsText, type CopySlot } from './templatelib/slot-copy'
import { guardProblemsOf, type SlotTextGuard } from './templatelib/slot-guard'

const SHARED = '국물이 조금씩 새어 나와서 가방에 넣기가 불안했어요'
const competitorReviews = {
  version: 1 as const,
  fileName: 'c.xlsx',
  stats: { total_rows: 1, text_review_count: 1, rating_counts: {} },
  dropped: 0,
  removedNames: [],
  checkNames: [],
  items: [{ id: 1, rating: 2, helped: 0, title: '', body: `뚜껑을 세게 닫아도 ${SHARED}` }],
}
const AUDIENCE = { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['구디백'], ageGate: false }

function job(spec: Record<string, unknown> = {}, analysis: Record<string, unknown> = {}): PdpJobRow {
  return { spec_sheet: { productName: '도시락 가방', ...spec }, analysis } as unknown as PdpJobRow
}
const withAudience = (audience: Record<string, unknown>) => ({ enrichment: { version: 1, features: ['audience'], audience } })

describe('slotCopyGuardOf — 잡 → K 칸 카피 가드', () => {
  it('연령 제한·학부모·후기·경쟁사 리뷰가 없는 잡은 빈 객체다(K 프롬프트·검사가 바이트 그대로)', () => {
    expect(slotCopyGuardOf(job())).toEqual({})
  })

  it('연령 제한 잡: 칸용 연령 블록(고지는 상품 정보 표, 리뷰 인용 줄 없음)과 최소 연령 검사', () => {
    const out = slotCopyGuardOf(job({ minAgeYears: 14 }))
    expect(out.guardBlock).toBe(buildAgeComplianceCopyBlock({ minAgeYears: 14 } as PdpJobRow['spec_sheet'], { slots: true }))
    expect(out.guardBlock).toContain('[연령 제한')
    expect(out.guardBlock).toContain('상품 정보 표(사용연령 행)')
    expect(out.guardBlock).not.toContain('reviewHighlights')
    expect(out.guardBlock).not.toContain('고지 문구를 반드시 포함')
    expect(out.guard).toEqual({ minAge: 14, parentView: false, echo: null })
  })

  it('자사 리뷰만 있는 잡: 후기 사용 범위 블록만 붙고 검사는 없다', () => {
    expect(slotCopyGuardOf(job({ reviewsText: '잘 써요' }))).toEqual({ guardBlock: REVIEW_CLAIM_BLOCK })
  })

  it('학부모 대리 구매 잡(게이트 꺼짐): 화자·장면 블록과 아이 사용·반응 검사. 게이트 잡은 연령 검사가 맡는다', () => {
    const open = slotCopyGuardOf(job({}, withAudience(AUDIENCE)))
    expect(open.guardBlock).toContain('[학부모 대리 구매형 — 화자·장면]')
    expect(open.guard).toEqual({ minAge: null, parentView: true, echo: null })
    const gated = slotCopyGuardOf(job({ minAgeYears: 14 }, withAudience({ ...AUDIENCE, ageGate: true })))
    expect(gated.guard?.parentView).toBe(false)
    // D 1단 그라운딩과 같은 차례 — 연령 블록이 마지막(우선)
    expect(gated.guardBlock!.indexOf('[학부모')).toBeLessThan(gated.guardBlock!.indexOf('[연령 제한'))
  })

  it('경쟁사 리뷰가 있는 잡: 재현 검사 조각만 생기고 블록은 없다(프롬프트에 경쟁사 원문을 넣지 않는다)', () => {
    const out = slotCopyGuardOf(job({ competitorReviews }))
    expect(out.guardBlock).toBeUndefined()
    expect(out.guard?.echo).not.toBeNull()
  })
})

describe('guardProblemsOf·checkCopyValues — 칸 글 가드', () => {
  const OFF: SlotTextGuard = { minAge: null, parentView: false, echo: null }
  const spec = {} as PdpJobRow['spec_sheet']
  const slots: CopySlot[] = [{ name: 'headline', required: true, facts: 0, maxChars: 40 }]

  it('연령 제한 잡에서 어린이 표현을 찾는다 — 아이템·아이디어 같은 복합어는 걸지 않는다', () => {
    const guard = { ...OFF, minAge: 14 }
    expect(guardProblemsOf('headline', '아이 생일파티 답례로 딱', guard).map((p) => p.kind)).toEqual(['age'])
    expect(guardProblemsOf('headline', '키즈 파티에도', guard)[0].detail).toContain('키즈')
    expect(guardProblemsOf('headline', '꼭 필요한 아이템', guard)).toEqual([])
    expect(guardProblemsOf('headline', '아이 생일파티 답례로 딱', OFF)).toEqual([])
  })

  it('학부모 시점 잡은 아이가 쓰거나 반응하는 문장만 건다 — 아이 생일 답례·이름 쓰기는 그대로', () => {
    const guard = { ...OFF, parentView: true }
    expect(guardProblemsOf('headline', '아이들이 좋아해요', guard).map((p) => p.kind)).toEqual(['child'])
    expect(guardProblemsOf('headline', '아이와 함께 붙여요', guard)[0].detail).toContain('함께 사용')
    expect(guardProblemsOf('headline', '아이 생일 답례를 빠르게 준비해요', guard)).toEqual([])
  })

  it('경쟁사 리뷰와 15자 이상 겹치면 재현으로 건다 — 겹친 문장은 고칠 곳 글에 넣지 않는다', () => {
    const guard = { ...OFF, echo: slotCopyGuardOf(job({ competitorReviews })).guard!.echo }
    const hit = guardProblemsOf('headline', SHARED, guard)
    expect(hit.map((p) => p.kind)).toEqual(['reproduce'])
    expect(hit[0].detail).not.toContain(SHARED)
    expect(guardProblemsOf('headline', '가방에 넣어도 든든해요', guard)).toEqual([])
  })

  it('checkCopyValues는 guard가 있을 때만 가드 문제를 더하고, 가드 문제는 남으면 글을 지운다', () => {
    const values = { headline: '아이들이 좋아해요' }
    expect(checkCopyValues(slots, values, spec)).toEqual([])
    expect(checkCopyValues(slots, values, spec, { ...OFF, minAge: 14, parentView: true }).map((p) => p.kind)).toEqual(['age', 'child'])
    expect(['age', 'child', 'reproduce'].every((kind) => dropsText(kind as 'age'))).toBe(true)
  })
})
