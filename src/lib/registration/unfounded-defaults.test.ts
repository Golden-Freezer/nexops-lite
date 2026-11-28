/**
 * 근거 없는 기본값 제거(P0-1, 2026-10-30 오너 지시 — "별점 5점 같은 근거 없는 기본값은 빼야 한다").
 * 입력이 비어도 기본값·폴백·프롬프트 예시가 배송·반품 약속, 시험·검증 사칭, 재구매·만족 통계, 지어낸 수치를 만들지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { getDefaultCopyData } from '@/lib/agents/registration/pdp-copy-defaults'
import {
  PREMIUM_COPYWRITING_PROMPT,
  buildRetryPointcardsPrompt,
} from '@/lib/agents/registration/prompts/pdp-copy-prompts'
import {
  STAGE2_STORYTELLING_PROMPT,
  STAGE3_QUALITY_GATE_PROMPT,
} from '@/lib/agents/registration/prompts/pdp-copy-pro-prompts'
import { applyFeatureOwnershipToStage3 } from '@/lib/agents/registration/prompts/pdp-internalized-prompts'
import { deriveV43Fields, generateFallbackPointcards } from './pdp-copy-rules'
import { syntheticFullCopyJob } from './__golden__/golden-harness'
import { assembleEditorDataResponse } from './editor-data'
import { buildEditorDocument } from './editor/utils/buildEditorDocument'
import { ctaContent } from './editor/utils/sectionConverter/dedupe'
import { endsWithGuide } from './copy-rule-check'
import { buildNumberSources, findUnsupportedNumbers } from './copy-numbers'
import { generateEventBannerCopy } from './pdp-pro-copy-templates'
import type { CopywritingResult, PdpSpecSheet, StrategyContract } from './pdp-state'

/** 입력 없이 기본값이 만들면 안 되는 말 */
const UNFOUNDED =
  /무료\s*반품|빠른\s*배송|내일\s*도착|\d+일\s*(무료|이내)?\s*(반품|환불|교환)|보장합니다|검증된|테스트를\s*통과|\d+명\s*중\s*\d+명|재구매|최고의|최적의|모든\s*문제|★/

describe('카피 기본값·폴백', () => {
  it('LLM 실패 기본 카피(getDefaultCopyData) — 배송·반품 부제 없음, 시험·검증·최상급 없음, 근거는 입력 소재만', () => {
    const spec = { productName: '구디백', brandName: '페어넥스' } as PdpSpecSheet
    const copy = getDefaultCopyData(spec)
    expect(JSON.stringify(copy)).not.toMatch(UNFOUNDED)
    expect(copy.closingCta?.subtext).toBe('')
    expect(copy.detailPoints?.[0].proof).toBe('')
    expect(getDefaultCopyData({ ...spec, material: '실리콘' } as PdpSpecSheet).detailPoints?.[0].proof).toBe(
      '실리콘 소재'
    )
  })

  it('핵심 카드 폴백 — 시험 통과·재구매 통계·소재 품질·효과 약속 카드를 채우지 않는다(모자라면 모자란 대로)', () => {
    const cards = generateFallbackPointcards('구디백', [], '', 6)
    expect(JSON.stringify(cards)).not.toMatch(UNFOUNDED)
    expect(cards.map((c) => c.title)).toEqual(['구디백 핵심 효과', '간편한 사용법'])
  })

  it('FAQ 기본 답·CTA 변형(deriveV43Fields) — 배송·반품·품질을 약속하지 않고, 부제가 없으면 이성 변형을 만들지 않는다', () => {
    const copy = { closingCta: { headline: '지금 담아보세요', subtext: '' } } as CopywritingResult
    const derived = deriveV43Fields(copy, {} as StrategyContract, ['배송은 언제 와요?', '가격이 비싸지 않나요?'])
    expect(JSON.stringify(derived.objection_handlers)).not.toMatch(UNFOUNDED)
    expect(derived.objection_handlers.find((h) => /배송/.test(h.objection ?? ''))?.answer).toContain(
      '배송 안내를 확인해 주세요'
    )
    expect(derived.cta_variants).toEqual([{ type: 'emotion', copy: '지금 담아보세요' }])
    expect(JSON.stringify(derived.sections)).not.toMatch(UNFOUNDED)
    // 카피에 부제가 있으면 그 부제로 이성 변형
    const withSub = deriveV43Fields(
      { closingCta: { headline: '지금 담아보세요', subtext: '오늘 3시 전 주문은 당일 출고' } } as CopywritingResult,
      {} as StrategyContract,
      []
    )
    expect(withSub.cta_variants).toEqual([
      { type: 'emotion', copy: '지금 담아보세요' },
      { type: 'rational', copy: '오늘 3시 전 주문은 당일 출고' },
    ])
  })
})

describe('프롬프트 예시 — 지어낸 배송 약속·수치·규제 표현 예시 없음', () => {
  it('카피 프롬프트의 CTA 부제 지시는 배송·반품·보증·혜택을 입력 사실만, detailPoints 근거는 상품 정보에 있는 것만', () => {
    expect(PREMIUM_COPYWRITING_PROMPT).not.toMatch(/무료\s*반품|내일\s*도착|기술적 근거 \+ 수치|말도 안 되는 결과/)
    expect(PREMIUM_COPYWRITING_PROMPT).toContain(
      '입력(제품 정보·이벤트·혜택)에 있는 사실만 쓴다(입력에 없는 약속을 지어내지 않는다)'
    )
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('상품 정보에 있는 근거(소재·구조, 수치는 입력 값만)')
  })

  it('완판 배너는 입력 완판 차수만 — 예시 숫자(7차)를 지어내게 하지 않는다', () => {
    expect(PREMIUM_COPYWRITING_PROMPT).not.toMatch(/7차 완판|숫자 필수/)
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('N은 입력 완판 차수, 입력에 없으면 빈 문자열')
  })

  it('핵심 카드 보충 프롬프트 — 수치는 제품 특징 입력에 있는 값만(예시에 99.9% 항균·48시간 없음)', () => {
    const prompt = buildRetryPointcardsPrompt({ productName: '구디백', features: [], existingTitles: [], needCount: 2 })
    expect(prompt).not.toMatch(/99\.9%|48시간|구체적 수치나 효과 포함/)
    expect(prompt).toContain('수치는 제품 특징 입력에 있는 값만 쓴다')
  })

  it('Stage 3 — 키워드 분리 예시에 지어낸 수치가 없고, 비어 있는 CTA 부제를 배송·반품 문구로 채우지 않는다. 기록 잡 치환은 그대로 걸린다', () => {
    expect(STAGE3_QUALITY_GATE_PROMPT).not.toMatch(/180g|40%\s*경량화|무료\s*반품/)
    expect(STAGE3_QUALITY_GATE_PROMPT).toContain('입력에 없는 배송·반품·보증 약속이 있으면 지운다')
    expect(STAGE3_QUALITY_GATE_PROMPT).toContain('5번의 빈 필드 기본값 채우기 대상이 아니다')
    const recorded = applyFeatureOwnershipToStage3(STAGE3_QUALITY_GATE_PROMPT, '(배정)')
    expect(recorded).not.toContain('- 예시: pointCards')
  })
})

describe('편집기 인증 섹션 — 인증 카피가 있을 때만', () => {
  async function certTexts(withCopy: boolean) {
    const job = syntheticFullCopyJob()
    if (!withCopy) {
      const { certificationCopy: _cert, ...rest } = job.copy_sections.final!
      void _cert
      job.copy_sections = { ...job.copy_sections, final: rest }
    }
    const response = assembleEditorDataResponse(job, null)
    const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] })
    const cert = doc.sections.find((s) => s.sectionType === 'certification')
    return cert ? cert.elements.filter((e) => e.type === 'text').map((e) => e.textProps!.content) : null
  }

  it('인증 카피(인증 입력이 있을 때 카피 단계가 만든다)가 없으면 섹션을 켜지 않는다 — "정품 인증"을 지어내지 않는다', async () => {
    expect(await certTexts(false)).toBeNull()
    const texts = (await certTexts(true))!
    expect(texts[0]).toBe('KC 인증')
    expect(texts.join(' ')).not.toContain('정품 인증')
  })
})

describe('P1-1a 안내형 끝말 — 바꾼 예시·폴백도 근거 없는 약속·입력에 없는 숫자가 없다', () => {
  /** P0-1 사전에 더해 기간·평생 약속(통합 지시 — '내일 도착'·'평생 사용' 같은 약속이 끼지 않게) */
  const PROMISE = /평생|영구|당일\s*(?:발송|출고|도착)|무상\s*(?:교체|수리)|\d+년\s*(?:사용|보증)/
  const spec = { productName: '구디백', brandName: '페어넥스' } as PdpSpecSheet
  const PROMPT_EXAMPLE = '사료와 물, 한 그릇에 나눠 담아요'

  function newTexts(): string[] {
    const defaults = getDefaultCopyData(spec)
    const editorCta = ctaContent(
      { mainIntro: { title: '구디백' } } as unknown as Parameters<typeof ctaContent>[0],
      false
    ).ctaHeadline as string
    return [
      defaults.closingCta!.headline!,
      ...defaults.pointCards!.map((c) => c.description!),
      ...generateFallbackPointcards('구디백', ['실리콘 손잡이'], '', 1).map((c) => c.description),
      editorCta,
      PROMPT_EXAMPLE,
    ]
  }

  it('카피 프롬프트 — CTA 예시가 안내형(~만나보세요)을 시키지 않고, 종류 낱말 칸과 안내형 금지 원칙이 있다', () => {
    expect(PREMIUM_COPYWRITING_PROMPT).not.toContain("'~해보세요' '~만나보세요' 형태")
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('"productType": "상품 종류 낱말 — 상품명에 있는 낱말 그대로 하나')
    expect(PREMIUM_COPYWRITING_PROMPT).toContain('7. **제목·CTA는 안내가 아니라 이유로 끝낸다**')
    expect(PREMIUM_COPYWRITING_PROMPT).toContain(PROMPT_EXAMPLE)
    expect(STAGE2_STORYTELLING_PROMPT).toContain('7. mainIntro.productType 낱말(상품 종류)을 첫 화면')
    expect(STAGE2_STORYTELLING_PROMPT).not.toContain('직접 경험해보세요')
    expect(STAGE3_QUALITY_GATE_PROMPT).toContain('### 3-4. 안내형 끝말·첫 화면 상품 종류')
    expect(STAGE3_QUALITY_GATE_PROMPT).not.toContain('지금 바로 경험해보세요')
  })

  it('바꾼 폴백·편집기 CTA·프롬프트 예시 — 안내형 끝말·근거 없는 약속(P0-1 사전)·입력에 없는 숫자(P0-2)가 없다', () => {
    const sources = buildNumberSources(spec)
    const texts = newTexts()
    expect(texts).toContain('지금 구디백 담아두세요')
    for (const text of texts) {
      expect(endsWithGuide(text), text).toBe(false)
      expect(text).not.toMatch(UNFOUNDED)
      expect(text).not.toMatch(PROMISE)
      expect(findUnsupportedNumbers({ summary: text }, sources), text).toEqual([])
    }
  })

  it('이벤트 부제 기본값 — 사은품·기간 한정·묶음은 안내형 대신 비운다(조건은 제목의 입력 문구 그대로)', () => {
    const sub = (eventBannerInfo: string) => generateEventBannerCopy({ ...spec, eventBannerInfo })?.sub_copy
    expect(sub('3만원 이상 구매 시 사은품 증정')).toBe('')
    expect(sub('10/31까지 한정')).toBe('')
    expect(sub('1+1 묶음')).toBe('')
  })
})
