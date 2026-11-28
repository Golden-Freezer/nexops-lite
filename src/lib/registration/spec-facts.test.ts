/**
 * 상품 사실 블록·떠넘기는 문장 제거(W2b, PDP-W2W3 계약 v1 §3) — 블록은 새 입력 필드가 있는 잡·기록 잡만(그 밖은 빈 문자열 =
 * 프롬프트 불변), 떠넘기는 말은 R5 P07 실제 문구로 고정한다. 사실을 말하는 꼴('확인된')·다른 절·원래 빈 줄은 남기고, 리뷰 원문·
 * 옵션명·상품명은 고치지 않는다. 글이 빈 카드는 빼고, 비우면 섹션이 사라지는 칸은 남긴다.
 */

import { describe, expect, it } from 'vitest'
import type { PdpSpecSheet } from './pdp-state'
import {
  buildSpecFactsBlock,
  hasNewSpecFacts,
  specFactLines,
  stripDeflections,
  stripDeflectionText,
} from './spec-facts'

const spec = (over: Record<string, unknown> = {}) =>
  ({ productName: '강아지 밥그릇 2구', material: '스테인리스', ...over }) as PdpSpecSheet

describe('buildSpecFactsBlock', () => {
  it('새 입력 필드도 없고 기록 잡도 아니면 빈 문자열(프롬프트 불변) — 소재·크기만 있어도', () => {
    expect(hasNewSpecFacts(spec())).toBe(false)
    // 새 필드는 하나만 있어도 켠다(무게만·원산지만·추가 스펙만)
    expect(hasNewSpecFacts(spec({ weight: '180g' }))).toBe(true)
    expect(hasNewSpecFacts(spec({ origin: '중국' }))).toBe(true)
    expect(hasNewSpecFacts(spec({ extraSpecs: [{ key: '용량', value: '350ml' }] }))).toBe(true)
    expect(buildSpecFactsBlock(spec({ size: '30cm' }), { recorded: false })).toBe('')
    expect(hasNewSpecFacts(spec({ extraSpecs: [{ key: '', value: '빈 키' }], weight: '  ' }))).toBe(false)
  })

  it('새 입력 필드가 있으면 소재·크기·무게·원산지·추가 스펙을 사실로 싣고 규칙을 붙인다', () => {
    const s = spec({ size: '30 x 15cm', weight: '180g', origin: '중국', extraSpecs: [{ key: '용량', value: '350ml' }] })
    expect(hasNewSpecFacts(s)).toBe(true)
    expect(specFactLines(s)).toEqual([
      '- 소재: 스테인리스',
      '- 크기: 30 x 15cm',
      '- 무게: 180g',
      '- 원산지: 중국',
      '- 용량: 350ml',
    ])
    const block = buildSpecFactsBlock(s, { recorded: false })
    expect(block.split('\n')[0]).toBe('## [상품 사실 — 소재·크기·무게·원산지·규격 숫자는 이 값만 쓴다]')
    expect(block).toContain('- 무게: 180g')
    expect(block).toContain("'선택 가이드'·'브랜드 정보'")
    // 스펙 표는 실제로 있을 수 있다 — 없다고 단정하지 않고 가리키지 말라고만 한다
    expect(block).toContain('아래에 스펙 표가 있어도 카피에서 가리키지 않고')
    expect(block).not.toContain('표가 없다')
  })

  it('기록 잡은 사실이 하나도 없어도 규칙을 넣는다(R5 P07 — 소재·규격이 비어 떠넘겼다)', () => {
    const block = buildSpecFactsBlock({ productName: '강아지 밥그릇 2구' } as PdpSpecSheet, { recorded: true })
    expect(block).toContain('- 등록된 소재·크기·무게·원산지 정보가 없다.')
    expect(block).toContain('지어내지 않고')
  })
})

describe('stripDeflectionText', () => {
  it('R5 P07 실제 문구 — 한 줄 안이면 그 문장, 줄바꿈을 넘으면 두 줄', () => {
    expect(stripDeflectionText('소재·규격은 상세 정보 확인\n아이에게 맞는지 먼저 체크')).toBe(
      '아이에게 맞는지 먼저 체크'
    )
    expect(stripDeflectionText('하단 상세 정보에서 사이즈를 확인해 담아보세요')).toBe('')
    expect(stripDeflectionText('페어넥스 제품 정보를\n구매 전에 살펴보세요')).toBe('')
    expect(stripDeflectionText('두 칸이 이어져요. 상세페이지를 참고해 주세요. 매일 씻기 쉬워요.')).toBe(
      '두 칸이 이어져요. 매일 씻기 쉬워요.'
    )
  })

  it('걸린 절만 뺀다 — 앞 절과 연령 고지는 남는다', () => {
    expect(stripDeflectionText('스테인리스 304 소재라 녹 걱정이 적고, 자세한 규격은 상세 정보를 확인하세요')).toBe(
      '스테인리스 304 소재라 녹 걱정이 적고'
    )
    expect(
      stripDeflectionText('본 제품은 만 14세 이상 사용 가능한 제품입니다 · 구매 전 상세 정보를 확인해 주세요')
    ).toBe('본 제품은 만 14세 이상 사용 가능한 제품입니다')
  })

  it('사실을 말하는 꼴(확인된·확인되는·확인한)과 확인 낱말만 있는 글은 그대로', () => {
    for (const plain of [
      '상세 스펙 30×15cm, 실측으로 확인된 크기예요',
      '복잡한 상세 설명 없이도 한눈에 확인되는 구조',
      '제품 정보 그대로, 직접 확인한 소재만 담았어요',
      '제품 정보를 꼼꼼히 살펴본 분들이 고른 컵',
      '색상은 사진으로 확인해 보세요',
      '사료 칸과 물 칸이 나란히\n한 번에 놓는 구조',
    ]) {
      expect(stripDeflectionText(plain)).toBe(plain)
    }
  })

  it('정규식이 놓치던 꼴(제품 사양·아래 표·상세 이미지·상품 상세)도 잡는다', () => {
    expect(stripDeflectionText('제품 사양을 확인하세요')).toBe('')
    expect(stripDeflectionText('아래 표를 참고해 주세요')).toBe('')
    expect(stripDeflectionText('상세 이미지에서 확인')).toBe('')
    expect(stripDeflectionText('상품 상세에서 확인하세요')).toBe('')
  })

  it('원래 빈 줄(문단 구분)은 남긴다', () => {
    expect(stripDeflectionText('첫 문단이에요\n\n상세 정보에서 확인하세요\n마지막 줄')).toBe(
      '첫 문단이에요\n\n마지막 줄'
    )
  })
})

describe('stripDeflections', () => {
  const copy = {
    title: '상세 정보를 확인하세요 컵',
    closingCta: {
      headline: '상세 정보 확인하고 내게 맞는 구성 고르기',
      subtext: '하단 상세 정보에서 사이즈를 확인해 담아보세요',
    },
    pointCards: [
      { title: '2구 구성', description: '사료 칸과 물 칸이 나란히' },
      { title: '선택 가이드', description: '소재·규격은 상세 정보 확인\n아이에게 맞는지 먼저 체크' },
      { title: '브랜드 정보', description: '페어넥스 제품 정보를\n구매 전에 살펴보세요' },
    ],
    reviewHighlights: [{ text: '상세 정보 확인하고 샀어요', author: '구매고객' }],
    colorOptions: { options: ['상세 정보 확인용'] },
  }

  it('바뀐 칸을 기록하고, 글이 빈 카드는 빼고(정보 없는 카드), 비우면 CTA가 사라지는 머리말은 남긴다', () => {
    const { copy: out, removed, dropped, kept } = stripDeflections(copy)
    expect(removed.map((r) => r.path)).toEqual([
      'closingCta.subtext',
      'pointCards[1].description',
      'pointCards[2].description',
    ])
    expect(dropped).toEqual(['pointCards[2]'])
    expect(kept).toEqual(['closingCta.headline'])
    expect(out.closingCta).toEqual({ headline: copy.closingCta.headline, subtext: '' })
    expect(out.pointCards).toEqual([
      { title: '2구 구성', description: '사료 칸과 물 칸이 나란히' },
      { title: '선택 가이드', description: '아이에게 맞는지 먼저 체크' },
    ])
  })

  it('리뷰 원문·옵션명·상품명은 보지 않고, 입력은 그대로', () => {
    const { copy: out } = stripDeflections(copy)
    expect(out.title).toBe(copy.title)
    expect(out.reviewHighlights).toEqual(copy.reviewHighlights)
    expect(out.colorOptions).toEqual(copy.colorOptions)
    expect(copy.pointCards).toHaveLength(3)
    expect(copy.closingCta.subtext).toBe('하단 상세 정보에서 사이즈를 확인해 담아보세요')
  })
})
