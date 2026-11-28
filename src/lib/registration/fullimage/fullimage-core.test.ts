/**
 * 통이미지 F-1 순수 함수 — 승인 카피 추출, 판독 응답 검증·대조·블록 매칭, 블록 → 텍스트 요소 명세.
 * 편집기에 들어가는 글은 승인 카피 원문이다(판독 글이 아님). 안 A·B가 같은 함수를 쓴다.
 */

import { describe, expect, it } from 'vitest'
import type { CopywritingResult } from '../pdp-state'
import { FULLIMAGE_SECTIONS, approvedLinesFor, type ApprovedLine } from './fullimage-types'
import { compareApprovedCopy, copyKey, matchBlocks, parseFullImageRead, type ReadBlock } from './fullimage-read'
import { FULLIMAGE_FLOOR, blockToTextSpec, fullImageSectionHeight, layoutBlocks } from './fullimage-layout'

const copy = {
  mainIntro: { benefitHeadline: '돌리기만 하면\n완성되는 파티', subBenefit: '돌리면 터지는 컬러 꽃가루, 간편하게 파티 분위기 완성' },
  mainCutCopy: { headline: '돌리면 끝, 준비는 없다', subCopy: '종이 압축공기 폭죽으로 컬러 한 방' },
  closingCta: { headline: '다가오는 파티, 지금 준비해보세요', subtext: '10개입 대용량 구성 · 만 14세 이상 사용 가능 제품' },
} as CopywritingResult

const block = (text: string, box: ReadBlock['box'], over: Partial<ReadBlock> = {}): ReadBlock => ({
  text, box, lines: 1, color: '#222222', weight: 700, family: 'sans', align: 'center', ...over,
})

describe('approvedLinesFor — 섹션 승인 카피(줄이지 않고, 넘치면 빼거나 G로)', () => {
  it('히어로·메인컷·CTA 칸을 역할과 함께 읽는다', () => {
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.hero, copy)).toEqual({
      lines: [
        { copyPath: 'mainIntro.benefitHeadline', text: '돌리기만 하면\n완성되는 파티', role: 'headline' },
        { copyPath: 'mainIntro.subBenefit', text: '돌리면 터지는 컬러 꽃가루, 간편하게 파티 분위기 완성', role: 'sub' },
      ],
      dropped: [],
      eligible: true,
    })
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.cta, copy).lines.map((l) => l.role)).toEqual(['headline', 'sub'])
  })

  it('넘치는 부제는 빼고, 제목이 없거나 넘치면·연령 고지 줄이 넘치면 G로(eligible=false)', () => {
    const longSub = { ...copy, mainIntro: { ...copy.mainIntro, subBenefit: '가'.repeat(40) } } as CopywritingResult
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.hero, longSub)).toMatchObject({ dropped: ['mainIntro.subBenefit'], eligible: true })
    const longHead = { ...copy, mainCutCopy: { headline: '나'.repeat(30) } } as CopywritingResult
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.main_cut, longHead).eligible).toBe(false)
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.main_cut, {} as CopywritingResult).eligible).toBe(false)
    const longNotice = { ...copy, closingCta: { headline: '지금 준비', subtext: `${'다'.repeat(30)} · 만 14세 이상 사용 가능 제품` } } as CopywritingResult
    expect(approvedLinesFor(FULLIMAGE_SECTIONS.cta, longNotice).eligible).toBe(false)
  })
})

describe('parseFullImageRead — 판독 응답 검증', () => {
  it('형식이 틀린 블록은 버리고 좌표는 0~1로 자르며, 굵기는 가까운 100 단위·색은 #RRGGBB만', () => {
    const read = parseFullImageRead({
      blocks: [
        { text: ' 돌리기만 하면 ', box: { x: -0.1, y: 0.1, w: 0.8, h: 0.08 }, lines: 1, color: '#aa3300', weight: 760, family: 'sans', align: 'left' },
        { text: '', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
        { text: '깨진 상자', box: { x: 0.1, y: 0.1, w: 0, h: 0.1 } },
        { text: '색 없음', box: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, color: 'red', family: 'serif', align: 'justify' },
      ],
      productMatches: true,
      issues: ['', '글자 잘림'],
    })!
    expect(read.blocks).toHaveLength(2)
    expect(read.blocks[0]).toMatchObject({ text: '돌리기만 하면', box: { x: 0, y: 0.1, w: 0.8, h: 0.08 }, color: '#AA3300', weight: 800, align: 'left' })
    expect(read.blocks[1]).toMatchObject({ color: '#111111', family: 'sans', align: 'center', box: { x: 0.9, y: 0.9 } })
    expect(read.blocks[1].box.w).toBeCloseTo(0.1)
    expect(read.issues).toEqual(['글자 잘림'])
  })

  it('응답 틀이 틀리면 null(판독 실패 → G)', () => {
    expect(parseFullImageRead(null)).toBeNull()
    expect(parseFullImageRead({ blocks: 'x', productMatches: true })).toBeNull()
    expect(parseFullImageRead({ blocks: [] })).toBeNull()
  })
})

describe('승인 카피 대조·블록 매칭', () => {
  const lines: ApprovedLine[] = [
    { copyPath: 'mainIntro.benefitHeadline', text: '돌리기만 하면\n완성되는 파티', role: 'headline' },
    { copyPath: 'mainIntro.subBenefit', text: '컬러 꽃가루로 파티 완성', role: 'sub' },
  ]
  const headA = block('돌리기만 하면', { x: 0.1, y: 0.1, w: 0.8, h: 0.08 }, { weight: 800, color: '#C2410C' })
  const headB = block('완성되는 파티!', { x: 0.15, y: 0.2, w: 0.7, h: 0.08 })
  const sub = block('컬러 꽃가루로 파티 완성', { x: 0.1, y: 0.32, w: 0.8, h: 0.05 }, { weight: 400 })

  it('키는 공백·문장부호를 뗀다 — 두 블록으로 나뉜 한 줄도 같은 줄로 대조한다', () => {
    expect(copyKey('돌리기만 하면,\n완성되는 파티!')).toBe('돌리기만하면완성되는파티')
    expect(compareApprovedCopy(lines, [headB, sub, headA])).toEqual({ missing: [], extra: [] })
  })

  it('빠진 줄은 missing, 승인 카피에 없는 글은 extra — 제품 인쇄 글자로 넘긴 글은 extra에서 뺀다', () => {
    const extra = block('국내 1위 인증', { x: 0.1, y: 0.8, w: 0.3, h: 0.04 })
    const brand = block('JIYAPICK', { x: 0.4, y: 0.6, w: 0.2, h: 0.03 })
    expect(compareApprovedCopy(lines, [headA, sub, extra, brand], ['JIYAPICK 10P'])).toEqual({
      missing: ['돌리기만 하면\n완성되는 파티'],
      extra: ['국내 1위 인증'],
    })
  })

  it('매칭: 줄마다 블록 상자를 합치고 줄 수를 더하며, 모양은 가장 큰 블록을 따른다. 글은 승인 원문', () => {
    const blocks = matchBlocks(lines, [headB, sub, headA])!
    expect(blocks[0]).toMatchObject({ copyPath: 'mainIntro.benefitHeadline', text: '돌리기만 하면\n완성되는 파티', lines: 2, weight: 800, color: '#C2410C' })
    expect(blocks[0].box.x).toBeCloseTo(0.1)
    expect(blocks[0].box.y).toBeCloseTo(0.1)
    expect(blocks[0].box.w).toBeCloseTo(0.8)
    expect(blocks[0].box.h).toBeCloseTo(0.18)
    expect(blocks[1]).toMatchObject({ role: 'sub', weight: 400 })
    expect(matchBlocks(lines, [headA, headB])).toBeNull()
  })
})

describe('블록 → 텍스트 요소 명세(캔버스 860)', () => {
  const base = { copyPath: 'mainIntro.benefitHeadline', text: '돌리기만 하면\n완성되는 파티', role: 'headline' as const, lines: 2, color: '#C2410C', weight: 800 as const, family: 'sans' as const, align: 'center' as const }

  it('크기는 상자 높이/줄 수/행간으로 어림하고, 글꼴은 화이트리스트(display는 700 고정)', () => {
    const aspect = 3 / 4
    const H = fullImageSectionHeight(aspect)
    expect(H).toBe(1147)
    const spec = blockToTextSpec({ ...base, box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 } }, aspect)
    expect(spec).toMatchObject({ x: 86, y: 115, width: 688, fontFamily: 'Pretendard', fontWeight: 800, textAlign: 'center', lineHeight: 1.25, raised: false })
    expect(spec.fontSize).toBe(Math.round((0.2 * H) / 2 / 1.25))
    expect(blockToTextSpec({ ...base, family: 'display', box: { x: 0, y: 0, w: 1, h: 0.2 } }, aspect)).toMatchObject({ fontFamily: 'GmarketSansBold', fontWeight: 700 })
    expect(blockToTextSpec({ ...base, family: 'rounded', box: { x: 0, y: 0, w: 1, h: 0.2 } }, aspect).fontFamily).toBe('Cafe24 Ssurround')
  })

  it('판독 크기가 역할 하한보다 작으면 하한까지 올리고 상자 높이를 줄 수에 맞춰 늘린다', () => {
    const spec = blockToTextSpec({ ...base, role: 'sub', lines: 1, box: { x: 0.1, y: 0.5, w: 0.8, h: 0.02 } }, 3 / 4)
    expect(spec.fontSize).toBe(FULLIMAGE_FLOOR.sub)
    expect(spec.raised).toBe(true)
    expect(spec.height).toBe(Math.ceil(45 * 1.45))
  })

  it('키운 상자가 아래 상자와 겹치면 아래를 밀고, 섹션을 넘친 수를 센다', () => {
    const head = { ...base, box: { x: 0.1, y: 0.05, w: 0.8, h: 0.05 } }
    const sub = { ...base, copyPath: 'mainIntro.subBenefit', role: 'sub' as const, lines: 1, box: { x: 0.1, y: 0.08, w: 0.8, h: 0.04 } }
    const { specs, raisedToFloor, overflow } = layoutBlocks([sub, head], 3 / 4)
    expect(specs.map((s) => s.copyPath)).toEqual(['mainIntro.benefitHeadline', 'mainIntro.subBenefit'])
    expect(specs[1].y).toBe(specs[0].y + specs[0].height + 12)
    expect(raisedToFloor).toBe(2)
    expect(overflow).toBe(0)
    expect(layoutBlocks([{ ...sub, box: { x: 0.1, y: 0.97, w: 0.8, h: 0.03 } }], 3 / 4).overflow).toBe(1)
  })
})
