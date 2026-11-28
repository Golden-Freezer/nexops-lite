/**
 * 레퍼런스 입력 칸(13_REFERENCE_INPUT PR③) — 접힌 기본 모양, 결과 목록·자사 '현행 페이지 진단', spec 패치(3개 상한·빼기)를 고정한다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import type { ReferenceInput } from '@/lib/registration/references/reference-types'
import { PdpReferenceFiles, addReferencePatch, flowLabel, referenceSummary, removeReferencePatch } from './PdpReferenceFiles'

// 프로젝트 Vitest 변환은 classic JSX를 쓴다(PdpReviewFiles.test.tsx와 같은 처리)
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function reference(id: string, over: Partial<ReferenceInput> = {}): ReferenceInput {
  return {
    id,
    kind: 'competitor',
    fileName: `${id}.png`,
    source: 'image',
    units: 4,
    insights: {
      version: 1,
      sections: [
        { start: 0, end: 30, role: 'hook', layout: 'full_photo', visual: '제품 단독', move: '공감', appeals: [], density: 'low' },
        { start: 30, end: 100, role: 'usp', layout: 'two_column', visual: '사용 장면', move: '근거', appeals: [], density: 'medium' },
      ],
      flow: 'hook → usp',
      strengths: ['첫 화면에 제품이 크다'],
      weaknesses: ['구매 전 확인 정보가 없다'],
      regulatedSuspects: 0,
    },
    transcript: '받아쓴 원문',
    costUsd: 0.081,
    analyzedAt: '2026-10-30T00:00:00.000Z',
    warnings: [],
    ...over,
  } as ReferenceInput
}

const spec = (refs?: ReferenceInput[]) => ({ productName: 'x', referenceInputs: refs }) as PdpSpecSheet
const render = (refs?: ReferenceInput[]) =>
  renderToStaticMarkup(createElement(PdpReferenceFiles, { spec: spec(refs), onChange: () => {} }))

describe('PdpReferenceFiles', () => {
  it('레퍼런스가 없으면 접힌 제목만(파일 입력은 펼쳐야 나온다)', () => {
    const html = render()
    expect(html).toContain('레퍼런스 (기존 상세페이지 분석 전용)')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('레퍼런스 파일')
  })

  it('결과가 있으면 펼쳐 목록·요약을 보이고, 자사 페이지만 현행 페이지 진단을 붙인다', () => {
    const html = render([reference('own-1', { kind: 'own', warnings: ['캡처가 길어 16개 구간만 골라 읽었습니다.'] }), reference('c-1')])
    expect(html).toContain('레퍼런스 (기존 상세페이지 분석 전용) · 2개')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('자사 기존 페이지')
    expect(html).toContain('경쟁 상세페이지')
    expect(html).toContain('구간 2 · 후킹 → 핵심 장점 · $0.08')
    expect(html).toContain('흐름: 후킹 → 핵심 장점')
    expect(html).not.toContain('hook')
    expect(html.match(/현행 페이지 진단/g)).toHaveLength(1)
    expect(html).toContain('고칠 점: 구매 전 확인 정보가 없다')
    expect(html).toContain('캡처가 길어 16개 구간만 골라 읽었습니다.')
    expect(html).toContain('aria-label="레퍼런스 빼기 c-1.png"')
    // 받아쓴 원문은 화면에 보이지 않는다(가드 전용)
    expect(html).not.toContain('받아쓴 원문')
  })

  it('3개면 선택 버튼을 막는다', () => {
    const html = render([reference('a'), reference('b'), reference('c')])
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?3개까지/)
  })
})

describe('레퍼런스 spec 패치', () => {
  it('추가는 3개 상한(오래된 것부터 뺀다), 같은 id는 바꿔 넣는다', () => {
    const three = [reference('a'), reference('b'), reference('c')]
    expect(addReferencePatch(spec(three), reference('d')).referenceInputs!.map((r) => r.id)).toEqual(['b', 'c', 'd'])
    const replaced = addReferencePatch(spec(three), reference('b', { fileName: 'new.png' })).referenceInputs!
    expect(replaced.map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(replaced.at(-1)!.fileName).toBe('new.png')
    expect(addReferencePatch(spec(), reference('a')).referenceInputs).toHaveLength(1)
  })

  it('빼기 — 마지막을 빼면 필드를 지운다', () => {
    expect(removeReferencePatch(spec([reference('a'), reference('b')]), 'a').referenceInputs!.map((r) => r.id)).toEqual(['b'])
    expect(removeReferencePatch(spec([reference('a')]), 'a')).toStrictEqual({ referenceInputs: undefined })
  })

  it('요약 한 줄 — 흐름이 비면 흐름 없음', () => {
    const r = reference('a')
    expect(referenceSummary({ ...r, insights: { ...r.insights, flow: '' } })).toBe('구간 2 · 흐름 없음 · $0.08')
  })

  it('흐름 표시는 한국어 역할 이름(연속 ×n 유지, 모르는 낱말은 그대로)', () => {
    expect(flowLabel('hook → problem → usp ×3 → proof → cta')).toBe('후킹 → 문제 제기 → 핵심 장점 ×3 → 근거 → 구매 유도')
    expect(flowLabel('spec → option → shipping')).toBe('제원 → 옵션·구성 → 배송·교환')
    expect(flowLabel('hook → mystery')).toBe('후킹 → mystery')
  })
})
