/**
 * 주장 범위(R2) — R1 감점 잡의 저장된 카피 단계 입력으로 프롬프트를 다시 조립해 금지 지시가 들어가는지 본다.
 * - P03 두피 브러시 f2d72bd0: 효능 감점 4건(−40) — 신체 접촉 상품의 결과 주장·근거 없는 비교
 * - P07 반려동물 식기 8e7006a3: 성능 결과 감점 3건("밀림 최소화"·"흔들림 적게"·"밀림을 줄인") — 입력에 없는 기능
 * LLM은 모의(callAgent·callOpenAiChat 캔드 응답), 유료 호출 0.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as Array<{ agent: string; user: string }>, cardCount: 4 }))

async function respond(options: Record<string, unknown>, parser: (text: string) => unknown) {
  const agent = String(options.agentName ?? '')
  const messages = (options.messages ?? []) as Array<{ content: string }>
  h.calls.push({ agent, user: messages.map((m) => m.content).join('\n') })
  const titles = ['실리콘 돌기', '원형 헤드', '손잡이', '세이지 그린'].slice(0, h.cardCount)
  const copy = {
    mainIntro: { brandAndName: '페어넥스 · 브러쉬', benefitHeadline: '헤드라인' },
    pointCards: titles.map((title) => ({ title, description: '설명' })),
  }
  const text = agent === 'registration/pdp-copy-retry-pointcards' ? '[]' : JSON.stringify(copy)
  return { success: true, data: parser(text), usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, duration: 0 }
}

vi.mock('@/lib/agents/_base', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/_base')>()),
  callAgent: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))
vi.mock('@/lib/agents/openai-chat', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/openai-chat')>()),
  callOpenAiChat: (o: Record<string, unknown>, p: (t: string) => unknown) => respond(o, p),
}))

import p03 from './__fixtures__/r1/p03-f2d72bd0.json'
import p07 from './__fixtures__/r1/p07-8e7006a3.json'
import {
  CLAIM_GUARD_QUALITY_GATE_LEAD,
  buildClaimGuardBlock,
  effectKeywordsIn,
  isBodyContactProduct,
} from '@/lib/agents/registration/prompts/pdp-claim-guard-prompts'
import { runPdpCopywriting } from '@/lib/agents/registration/pdp-copy-agent'
import { resolveClaimGuardBlock, resolveInternalizedCopyBlock } from './pdp-enrichment-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'
import type { PdpJobRow, PdpSpecSheet } from './pdp-state'

const GUARD_HEAD = '[주장 범위 — 의학·인증 효능은 쓰지 않고, 체감 효능은 사실과 함께 쓴다]'
const BODY_LINE = '상품명에 "마사지"·"보호대" 같은 말이 있어도 의학·치료 효과로 풀어 쓰지 않는다'
const PERFORMANCE_LINE = '"밀림 최소화", "흔들림 적게", "~을 줄인", "~ 방지"'

type R1Fixture = typeof p03 | typeof p07

function r1Job(fixture: R1Fixture, features: string[] = fixture.section_plan.enrichment.features): PdpJobRow {
  return {
    id: 'r1-job',
    generation_track: fixture.generation_track,
    mode: fixture.mode,
    spec_sheet: fixture.spec_sheet,
    analysis: { ...fixture.analysis, enrichment: { version: 1, features } },
    research_result: fixture.research_result,
    section_plan: fixture.section_plan,
  } as unknown as PdpJobRow
}

/** 파이프라인 stepCopywriting과 같은 조립 — 설득 흐름 블록 + 주장 범위, Stage 2·3·보충에도 주장 범위 */
async function assemble(job: PdpJobRow, withGuard = true) {
  const guard = resolveClaimGuardBlock(job)!
  const base = resolveInternalizedCopyBlock(job, job.analysis.detected_category ?? '')!
  const out = await runPdpCopywriting({
    specSheet: job.spec_sheet as PdpSpecSheet,
    mode: job.mode,
    analysis: job.analysis,
    research: job.research_result,
    sectionPlan: job.section_plan,
    strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    ...(withGuard ? { groundingBlock: `${base}\n\n${guard}`, stageGuardBlock: guard } : { groundingBlock: base }),
  })
  expect(out.success).toBe(true)
  return (name: string) => h.calls.find((c) => c.agent === `registration/pdp-copy-${name}`)?.user ?? ''
}

beforeEach(() => {
  h.calls = []
  h.cardCount = 4
})

describe('신체 접촉 판정·효과성 키워드', () => {
  it('분석 카테고리 beauty이거나 상품명에 사람·반려동물 몸에 닿는 낱말이 있으면 신체 접촉 상품이다', () => {
    expect(isBodyContactProduct({ productName: p03.spec_sheet.productName, category: 'beauty' })).toBe(true)
    expect(isBodyContactProduct({ productName: '실리콘 두피 브러쉬', category: 'household' })).toBe(true)
    // 실테스트 P10 무릎 보호대(fashion)·P06 강아지 빗(pet) — 1차 낱말 목록의 미탐
    expect(isBodyContactProduct({ productName: '페어넥스 슬개골 러닝 무릎 보호대', category: 'fashion' })).toBe(true)
    expect(isBodyContactProduct({ productName: '페어넥스 강아지빗 브러쉬 털갈이 슬리커', category: 'pet' })).toBe(true)
    // 몸에 닿지 않는 상품
    expect(
      isBodyContactProduct({
        productName: p07.spec_sheet.productName,
        category: 'pet',
        keywords: p07.analysis.keywords,
      })
    ).toBe(false)
    expect(
      isBodyContactProduct({ productName: '페어넥스 구디백 포장봉투 선물 파우치 반투명', category: 'packaging' })
    ).toBe(false)
    expect(isBodyContactProduct({ productName: '탁상용 선풍기', category: 'digital', keywords: ['시원한 바람'] })).toBe(
      false
    )
  })

  it('R3: 상품 자체가 몸에 닿아 쓰일 때만 — 물건용·기기용·물건 부위 보호대·검색 키워드는 판정에 쓰지 않는다', () => {
    const body = (productName: string, category = 'household', keywords: string[] = []) =>
      isBodyContactProduct({ productName, category, keywords })
    // verifier 낮음의 오탐 — 몸이 아니라 물건에 쓰는 상품
    for (const name of [
      '가구 모서리 보호대 투명 실리콘',
      '케이블 보호대 정리',
      '샤워커튼 고리 12개',
      '샤워기 거치대 흡착',
      '관절 인형 옷 세트',
      '면도기 거치대',
      '목욕 장난감 물총',
      '그루밍 테이블 매트',
      '헤어드라이기 거치대',
      '샴푸 디스펜서 3구',
      '뷰티 파우치 포장봉투',
      '허리 높이 스탠딩 책상',
      '자동차 바디 커버',
      '기둥 보호대 쿠션',
      '계단 보호대 미끄럼',
      // '세트'는 물건 묶음일 수 있다 — 본품 구성 표지로 보지 않는다(2차 verifier)
      '면도기 거치대 세트',
      '칫솔 케이스 세트 3개',
    ])
      expect(body(name), name).toBe(false)
    // 실테스트 P09 핸드폰 스트랩 — 검색 키워드 '핸드폰 손목스트랩'이 들어와도 기기용
    expect(body('페어넥스 핸드폰 스마트폰 도난방지 스트랩', 'digital', ['핸드폰 손목스트랩'])).toBe(false)
    // 몸에 닿아 쓰이는 상품은 그대로
    for (const name of [
      '샤워기 필터 헤드',
      '미세모 칫솔 10개',
      '때타올 이태리 2장',
      '전동 면도기',
      '손목 보호대 압박',
      // R3 verifier 낮음 — 본품에 딸린 구성·'문'·'차량' 앞머리 때문에 빠지던 상품
      '음파 전동칫솔 휴대용 케이스 포함',
      '전동 면도기 충전 거치대 포함',
      '음파 전동칫솔 케이스 증정',
      '마사지 볼 수납 파우치 포함',
      '손목 받침대 키보드 쿠션',
      '병원 전문 마사지건',
      '차량 목베개',
      '샤워기 헤드 홀더 일체형 필터',
    ])
      expect(body(name), name).toBe(true)
  })

  it('P03 분석 키워드 중 규제 사전(의학·인증)이 잡는 것만 고른다 — 체감 효능 낱말은 고르지 않는다(J50)', () => {
    expect(effectKeywordsIn(p03.analysis.keywords)).toEqual(['혈액순환'])
    expect(effectKeywordsIn(['모공 노폐물', '두피 개운', '각질 제거', '보습', '세정력', '세정 효능', '피부결'])).toEqual([])
    expect(effectKeywordsIn(['혈액순환 마사지', '미백 크림', '탈모 예방', '여드름 완화', '면역력'])).toEqual([
      '혈액순환 마사지',
      '미백 크림',
      '탈모 예방',
      '여드름 완화',
      '면역력',
    ])
  })

  it('J50 효능 문구 부활(오너 11-10): 효과 약속 금지 문장은 없고, 체감 효능은 사실과 함께 쓰게 한다 — 의학·인증 효능 금지는 그대로', () => {
    const block = buildClaimGuardBlock({
      productName: '실리콘 바디 브러쉬',
      category: 'beauty',
      keywords: ['모공 노폐물', '두피 개운', '각질 제거'],
    })
    expect(block).not.toContain('효과를 약속하지 않는다')
    expect(block).not.toContain('결과·변화·효과를 약속하지 않는다')
    expect(block).not.toContain('검색어일 뿐')
    expect(block).toContain('"실리콘 돌기가 모공 속 노폐물까지 쓸어내요"')
    expect(block).toContain('그때 느끼는 체감 효능으로 답한다. 의학·기능성 효능과 보장·단정은 쓰지 않는다')
    expect(block).toContain('질병·통증의 치료·완화·예방, 혈행·혈액순환·면역, 기능성 화장품 효능(미백·주름 개선·탈모 완화·탈모 예방), 인증·임상·테스트 완료')
    expect(block).toContain(PERFORMANCE_LINE)
  })

  it('몸에 닿지 않는 상품은 해결 칸·성능 결과·비교 규칙만 — 결과 주장 금지 줄과 키워드 줄은 없다', () => {
    const block = buildClaimGuardBlock({ productName: '탁상용 선풍기', category: 'digital', keywords: ['시원한 바람'] })
    expect(block).toContain(GUARD_HEAD)
    expect(block).toContain('기능·구성(무엇이 들어 있고 어떻게 작동하고 어떻게 쓰는지)과 그때 느끼는 체감 효능으로 답한다')
    expect(block).toContain(PERFORMANCE_LINE)
    expect(block).toContain('"~와는 구조부터 달라요"')
    expect(block).not.toContain(BODY_LINE)
    expect(block).not.toContain('검색어일 뿐')
  })

  it('상품명·옵션의 용도 이름(도난방지·엉킴방지)은 그대로 쓰게 한다 — 결과를 늘려 약속하지만 않는다(P09·P04)', () => {
    const block = buildClaimGuardBlock({ productName: '페어넥스 핸드폰 스마트폰 도난방지 스트랩', category: 'digital' })
    expect(block).toContain('상품명·옵션에 들어 있는 용도 이름("도난방지 스트랩", "엉킴방지 빗" 등)은')
    expect(block).toContain('그 결과를 늘려 약속하지는 않는다')
  })
})

describe('P03 f2d72bd0(두피 브러시) 입력으로 다시 조립', () => {
  it('주장 범위 블록: mainIntro 포함 인증·의학·기능성 효능 금지 + 사용 감각은 사실과 함께 + 분석 효과 키워드 명시', () => {
    const block = resolveClaimGuardBlock(r1Job(p03))!
    expect(block).toContain(BODY_LINE)
    expect(block).toContain('mainIntro(hook·benefitHeadline·subBenefit)를 포함한 모든 필드에서')
    expect(block).toContain('시원함·개운함·편안함 같은 사용 감각과 노폐물·각질 제거·피부결 같은 체감 효능은 상품 사실(소재·구조·사용법)과 함께 구체적으로 쓴다')
    expect(block).toContain('"혈액순환"는 의학·인증 효능 표현이라 검색어일 뿐')
    // 반대 지시는 열거만이 아니라 일반형으로 덮는다(뷰티 '변화된 모습'·비교 강도 '간접 비교' 포함)
    expect(block).toContain('결과·변화·효과·효익 반복·간접 비교를 쓰라는 내용이 있어도')
  })

  it('설득 흐름: 해결 칸은 기능·구성, 미응답 고민("단순 브러쉬 대비 실제 효과의 차별성")은 비교로도 답하지 않는다', () => {
    const block = resolveInternalizedCopyBlock(r1Job(p03), 'beauty')!
    expect(block).toContain('기능·구성(무엇이 어떻게 작동하는지)과 그때의 체감 효능으로 답하고, 의학·기능성 효능과 보장·단정은 쓰지 않는다')
    expect(block).not.toContain('결과·효과를 약속하지 않는다')
    expect(block).toContain(
      '"단순 브러쉬 대비 실제 효과의 차별성" → 응답하지 않는다. 유형 미분류 — 미응답 기록 — 이 고민에 대한 주장을 만들지 마라(비교·차별성·효과 문장으로 돌려 답하는 것도 금지)'
    )
  })

  it('설득 플래너 기록이 없는 잡은 주장 범위 블록이 없다(기존 프롬프트 그대로)', () => {
    expect(resolveClaimGuardBlock(r1Job(p03, ['vocab', 'layouts']))).toBeNull()
  })

  it('Stage 1·2·3 모두에 블록 — Stage 3는 검수 기준 위반으로 보고 _changed_fields에 적게 한다', async () => {
    const byStage = await assemble(r1Job(p03))
    for (const stage of ['stage1', 'stage2', 'stage3']) {
      expect(byStage(stage), stage).toContain(GUARD_HEAD)
      expect(byStage(stage), stage).toContain(BODY_LINE)
    }
    expect(byStage('stage3')).toContain(CLAIM_GUARD_QUALITY_GATE_LEAD)
    expect(byStage('stage2')).not.toContain(CLAIM_GUARD_QUALITY_GATE_LEAD)

    // 금지 범위를 넘기지 않으면 Stage 2·3 프롬프트는 기존 그대로
    h.calls = []
    const without = await assemble(r1Job(p03), false)
    expect(without('stage2')).not.toContain(GUARD_HEAD)
    expect(without('stage3')).not.toContain(GUARD_HEAD)
  })

  it('pointCards 보충 생성(유효 카드 4개 미만)에도 같은 블록', async () => {
    h.cardCount = 2
    const byStage = await assemble(r1Job(p03))
    expect(byStage('retry-pointcards')).toContain(GUARD_HEAD)
    expect(byStage('retry-pointcards')).toContain(BODY_LINE)
  })
})

describe('P07 8e7006a3(반려동물 식기) 입력으로 다시 조립', () => {
  it('감점 문장은 입력에 없는 기능의 성능 결과다 — 상품 정보에 바닥·패드·미끄럼 기능이 없다', () => {
    const input = JSON.stringify(p07.spec_sheet)
    for (const word of ['바닥', '패드', '미끄럼', '실리콘']) expect(input).not.toContain(word)
    expect(p07.flagged_copy['detailPoints[3].proof']).toBe('안정적인 바닥 설계로 밀림 최소화')
  })

  it('몸에 닿지 않는 상품이라 결과 주장 금지 줄은 없고, 성능 결과 줄이 Stage 1·2·3에 들어간다', async () => {
    const block = resolveClaimGuardBlock(r1Job(p07))!
    expect(block).toContain(PERFORMANCE_LINE)
    expect(block).toContain('상품 정보에 없는 기능(바닥 설계·미끄럼 방지 처리 등)은 만들지 않는다')
    expect(block).not.toContain(BODY_LINE)
    const byStage = await assemble(r1Job(p07))
    for (const stage of ['stage1', 'stage2', 'stage3']) expect(byStage(stage), stage).toContain(PERFORMANCE_LINE)
  })
})
