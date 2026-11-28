/**
 * 학부모 대리 구매형(parent_proxy) 2단계 순수 함수 — 기본 페르소나, 카피·이미지 지시, 산출 뒤 아이 사용·반응 검사(좁게: 행사 맥락은 통과).
 * 문장은 R6a P01·P02 실제 산출에서 걸렸던 꼴을 본떴다(리뷰 원문 아님).
 */

import { describe, expect, it } from 'vitest'
import { findChildTerms } from './compliance-gate'
import type { AudienceRecord } from './parent-proxy'
import {
  PARENT_PREP_IMAGE_BLOCK,
  PARENT_PREP_NO_PRODUCT_BLOCK,
  PARENT_PROXY_PERSONA,
  PARENT_PROXY_PERSONA_GATED,
  buildParentProxyCopyBlock,
  buildParentProxyImageBlock,
  buildParentProxyRewriteDirective,
  findChildUseLines,
  withAudiencePersona,
  withoutPreparedResult,
} from './parent-proxy-copy'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

const audience = (ageGate = false): AudienceRecord => ({ kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['구디백'], ageGate })
const spec = (over: Partial<PdpSpecSheet> = {}): PdpSpecSheet => ({ productName: '구디백 포장봉투', ...over })

describe('withAudiencePersona — 빈 targetPersona에만 기본 학부모 페르소나', () => {
  it('기록 잡이고 비었으면 채우고, 게이트 잡은 아이·기관 낱말이 없는 페르소나', () => {
    expect(withAudiencePersona(spec(), audience()).targetPersona).toBe(PARENT_PROXY_PERSONA)
    expect(withAudiencePersona(spec({ targetPersona: '  ' }), audience()).targetPersona).toBe(PARENT_PROXY_PERSONA)
    expect(withAudiencePersona(spec(), audience(true)).targetPersona).toBe(PARENT_PROXY_PERSONA_GATED)
    expect(findChildTerms(PARENT_PROXY_PERSONA_GATED)).toEqual([])
  })

  it('오너가 쓴 페르소나·기록 없는 잡은 같은 객체(저장 바이트 불변)', () => {
    const owned = spec({ targetPersona: '사무실 간식 나눔 담당자' })
    expect(withAudiencePersona(owned, audience())).toBe(owned)
    const plain = spec()
    expect(withAudiencePersona(plain, null)).toBe(plain)
  })
})

describe('지시 블록', () => {
  it('기록 없는 잡은 null — 카피·이미지 프롬프트 그대로', () => {
    expect(buildParentProxyCopyBlock(null)).toBeNull()
    expect(buildParentProxyImageBlock(null)).toBeNull()
  })

  it('카피: 화자는 준비하는 어른, 행사 이름은 구매 상황으로만, 아이 사용·반응·아이 imageHint 금지, 편의 구체화', () => {
    const block = buildParentProxyCopyBlock(audience())!
    expect(block).toContain('[학부모 대리 구매형 — 화자·장면]')
    expect(block).toContain('구매 상황 설명(추천 대상·사용 장면)으로만')
    expect(block).toContain('아이 반응을 단정하는 문장')
    expect(block).toContain('imageHint')
    expect(block).toContain('준비 시간, 반 인원수에 맞는 수량, 이름 쓰기, 마무리 방법')
  })

  it('게이트 잡의 카피 블록은 행사 이름 허용 줄 대신 게이트 금지어를 따르라고 한다', () => {
    const block = buildParentProxyCopyBlock(audience(true))!
    expect(block).not.toContain('어린이집·유치원 생일 답례')
    expect(block).toContain('연령 제한 블록의 금지어')
  })

  it('이미지: 어른 손·준비된 결과물만, 아이는 배경에도 없게', () => {
    const block = buildParentProxyImageBlock(audience())!
    expect(block).toContain("adults' hands")
    expect(block).toContain('including the background')
  })
})

describe('findChildUseLines — 아이가 쓰거나 반응하는 문장·아이가 나오는 이미지 지시', () => {
  it('함께 사용·아이 사용·아이 반응·이미지 지시를 찾는다(사용 장면 태그 포함)', () => {
    const copy = {
      pointCards: [{ title: '한 장 꾸밈', description: '아이와 함께 붙여볼 수 있어요' }],
      usageSceneTags: ['#생일답례', '#아이와함께붙이기'],
      detailPoints: [
        { claim: '아이가 직접 붙여요', imageHint: '아이와 엄마가 스티커 붙이는 장면' },
        { claim: '받는 아이들이 좋아해요', imageHint: "children's birthday party table" },
      ],
    } as CopywritingResult
    const kinds = findChildUseLines(copy).map((f) => `${f.section}:${f.kind}`)
    expect(kinds).toEqual([
      'pointCards:함께 사용',
      'usageSceneTags:함께 사용',
      'detailPoints:아이 사용',
      'detailPoints:이미지 지시',
      'detailPoints:아이 반응',
      'detailPoints:이미지 지시',
    ])
  })

  it('행사 맥락·아이 이름 쓰기·반 친구 나눔·복합어는 통과하고, 리뷰 발췌는 검사하지 않는다', () => {
    const copy = {
      mainIntro: { benefitHeadline: '어린이집 생일 답례, 10분이면 준비 끝' },
      problem: { empathyLines: ['우리 아이 생일 답례 고르기 막막하죠', '반 인원수만큼 이름 쓰기 번거로워요'] },
      solution: { summary: '아이 이름을 한 줄 적어 반 친구들에게 건네요', declaration: '아이 이름 써서 붙여요' },
      pointCards: [
        { title: '아이템 구성', description: '아이보리 색 봉투에 딸기 그림' },
        { title: '넉넉한 크기', description: '아이 과자 담기 좋은 봉투, 아기자기한 무늬' },
      ],
      detailPoints: [{ claim: '끈만 당기면 마무리', imageHint: '테이블 위에 줄지어 놓인 봉인된 답례 봉투와 어른의 손' }],
      reviewHighlights: [{ text: '아이가 너무 좋아했어요' }],
    } as CopywritingResult
    expect(findChildUseLines(copy)).toEqual([])
  })

  it('재작성 지시는 걸린 문장·종류를 보여 주고 준비하는 어른 시점으로 다시 쓰게 한다', () => {
    const directive = buildParentProxyRewriteDirective([{ section: 'pointCards', kind: '함께 사용', sentence: '아이와 함께 붙여요' }])
    expect(directive).toContain('[학부모 시점 재작성 지시]')
    expect(directive).toContain('- [pointCards] "아이와 함께 붙여요" (함께 사용)')
    expect(directive).toContain('어른의 손과 준비된 답례품만')
  })
})

describe('withoutPreparedResult — 상품 없는 컷(J49)의 학부모 장면 블록', () => {
  it("'준비된 결과(답례 봉투)' 예시만 빼고 어른 손·아이 금지는 그대로, 블록 밖 글은 바이트 그대로", () => {
    const grounding = `BEFORE

${PARENT_PREP_IMAGE_BLOCK}

AFTER`
    const out = withoutPreparedResult(grounding)
    expect(out).toBe(`BEFORE

${PARENT_PREP_NO_PRODUCT_BLOCK}

AFTER`)
    expect(out).not.toContain('prepared result')
    expect(out).not.toContain('this product')
    expect(out).toContain("Show only adults' hands.")
    expect(out).toContain('Do NOT depict children, kids, babies, or minors anywhere in the image')
    expect(PARENT_PREP_NO_PRODUCT_BLOCK.length).toBeLessThan(PARENT_PREP_IMAGE_BLOCK.length)
  })

  it('학부모 대리 잡이 아니면(블록 없음) 받은 글 그대로', () => {
    expect(withoutPreparedResult('GROUNDING ONLY')).toBe('GROUNDING ONLY')
    expect(withoutPreparedResult('')).toBe('')
  })
})
