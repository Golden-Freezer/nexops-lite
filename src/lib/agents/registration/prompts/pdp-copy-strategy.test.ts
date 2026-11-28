/**
 * 카피 전략 지시 블록(buildStrategyDirectionBlock) — 기록 잡 사실형 변형(R4 pdp-r4-copy-flow). 원문 지시는 그대로이고,
 * factOnly일 때 입력에 없는 사실을 부르는 지시(가격 환산·손해 구체화·재구매 뉘앙스·수치/인증 앞당기기)만 바뀐다.
 */

import { describe, expect, it } from 'vitest'
import { DESIGN_HOOK_MODE_BLOCKS } from '@/lib/registration/copy-design-rules'
import { buildStrategyDirectionBlock } from './pdp-copy-prompts'

const dp = { price_resistance: 'high', giftability: 'high', urgency_level: 'high', repeatability: 'repeat' } as const
const hook = { clarity: 0.8, relevance: 0.85, novelty: 0.55, proof: 0.4 }

describe('buildStrategyDirectionBlock — 기록 잡 사실형(factOnly)', () => {
  it('원문: 가격 환산·손해·재구매·수치 앞당기기 지시가 그대로 나온다(NEXFIT strategy_blocks.py)', () => {
    const block = buildStrategyDirectionBlock({}, dp, hook)
    expect(block).toContain('하루 ○원, 1회 사용당 비용')
    expect(block).toContain('지금 해결하지 않으면 커지는 불편·손해')
    expect(block).toContain('떨어지기 전에, 쟁여두는')
    expect(block).toContain('수치·인증 등 근거를 앞당겨 배치하세요')
  })

  it('factOnly: 네 지시만 사실형으로 바뀌고 나머지 성향·진단 지시는 원문 그대로', () => {
    const plain = buildStrategyDirectionBlock({}, dp, hook)
    const block = buildStrategyDirectionBlock({}, dp, hook, '', '', { factOnly: true })
    expect(block).not.toContain('하루 ○원, 1회 사용당 비용')
    expect(block).toContain('가격·할인·비용 환산(하루 ○원 등)은 쓰지 말고')
    expect(block).not.toContain('커지는 불편·손해')
    expect(block).toContain('입력에 없는 손해 금액·수치는 만들지 마세요')
    expect(block).not.toContain('쟁여두는')
    expect(block).toContain('소모·교체 근거(구성 수량·소모품·교체 주기)가 있을 때만')
    expect(block).not.toContain('수치·인증 등 근거를 앞당겨')
    expect(block).toContain('입력에 없는 수치·인증은 만들지 마세요')
    // 바뀌지 않는 줄 — 선물·신선도
    for (const line of ['선물 적합성이 높은 상품입니다. 최소 1곳에서', '후킹 진단: 신선도가 낮습니다. 흔한 카테고리'])
      expect(block).toContain(line)
    expect(block.split('\n').length).toBe(plain.split('\n').length)
  })

  it('없는 진단 항목은 지시를 켜지 않는다(빈 값에 기본값을 붙이지 않는다)', () => {
    const block = buildStrategyDirectionBlock({}, {}, { proof: 0.9 }, '', '', { factOnly: true })
    expect(block).toBe('')
  })
})

describe('buildStrategyDirectionBlock — 전략 계약 블록 사실형(factOnly, R4 copy-bridge)', () => {
  const contract = {
    page_goal: 'conversion_max',
    persuasion_axis: 'function',
    hook_mode: 'proof',
    purchase_context: 'self_use',
    involvement_level: 'high',
    comparison_intensity: 'medium',
    proof_sensitivity: 'high',
  } as const

  it('원문(NEXFIT strategy_blocks.py) — 숫자·인증·사회적 증거는 입력에 있는 것만(P0-1 근거 없는 기본값 제거), 나머지는 그대로', () => {
    const block = buildStrategyDirectionBlock(contract, {}, {})
    for (const line of [
      '입력에 있는 사회적 증거·수치',
      '수치·소재·성능 근거를 문장 앞머리에',
      '입력(판매량·평점·인증 정보)에 있는 구체적 숫자를 넣으세요',
      "'당신의 일상이 어떻게 달라지는지'",
      '반론(가격·품질 의심)',
      '기존 제품 대비 차별점을 1~2곳에서 간접 비교로',
      '입력에 있는 수치·소재·인증 중 하나 이상의 proof를 짝지으세요',
    ])
      expect(block).toContain(line)
    expect(block).not.toMatch(/숫자를 반드시 포함|proof를 반드시/)
  })

  it('factOnly: 같은 계약 키마다 사실형 한 줄 — 비교·입력 밖 숫자·결과 약속·가격이 빠진다', () => {
    const plain = buildStrategyDirectionBlock(contract, {}, {})
    const block = buildStrategyDirectionBlock(contract, {}, {}, '', '', { factOnly: true })
    for (const line of [
      '입력에 있는 사회적 증거·수치',
      '구체적 숫자를 넣으세요',
      '어떻게 달라지는지',
      '간접 비교',
      '가격·품질 의심',
    ])
      expect(block).not.toContain(line)
    for (const line of [
      '사회적 증거·수치는 입력에 있는 것만 쓰세요',
      '입력에 없는 수치·성능은 만들지 마세요',
      '판매량·평점·인증은 입력에 있을 때만 쓰세요',
      '체감 효능은 상품 사실과 함께 쓰고, 의학·인증 효능과 보장·단정은 쓰지 마세요',
      '가격은 언급하지 마세요',
      '다른 제품과 비교하지 말고',
      '입력에 없는 수치·인증은 만들지 마세요',
    ])
      expect(block).toContain(line)
    expect(block.split('\n').length).toBe(plain.split('\n').length)
  })

  it('J50 효능 문구 부활(오너 11-10): 계약 다섯 문장이 효과 약속을 막지 않고 의학·인증 효능·보장만 막는다', () => {
    const keys = [
      { persuasion_axis: 'emotion' },
      { hook_mode: 'shock' },
      { purchase_context: 'self_use' },
      { purchase_context: 'urgent_problem' },
      { involvement_level: 'low' },
    ] as const
    for (const c of keys) {
      const block = buildStrategyDirectionBlock(c, {}, {}, '', '', { factOnly: true })
      expect(block, JSON.stringify(c)).not.toMatch(/결과는 약속하지|효과를 약속하지|효과·결과를 단정|효과·결과는 약속|기분·몸을 바꾼다/)
      expect(block, JSON.stringify(c)).toContain('의학·인증 효능')
    }
  })

  it('충돌이 없는 계약 값(밀도·선물 맥락·호기심 후킹)은 factOnly여도 원문 그대로', () => {
    const calm = { page_length_target: 'persuasive', purchase_context: 'gift', hook_mode: 'curiosity' } as const
    expect(buildStrategyDirectionBlock(calm, {}, {}, '', '', { factOnly: true })).toBe(
      buildStrategyDirectionBlock(calm, {}, {})
    )
  })
})

describe('buildStrategyDirectionBlock — 사실형 보강(R4 copy-bridge verifier)', () => {
  it('저관여·충격 후킹·시즌의 효과 약속·단정·압박 지시도 사실형으로 바뀐다', () => {
    const contract = { involvement_level: 'low', hook_mode: 'shock', purchase_context: 'seasonal' } as const
    const plain = buildStrategyDirectionBlock(contract, {}, {})
    expect(plain).toContain('즉각적 효익')
    expect(plain).toContain('단정적 선언이나 반전 장면')
    expect(plain).toContain("'지금 사야 하는 이유'")
    const block = buildStrategyDirectionBlock(contract, {}, {}, '', '', { factOnly: true })
    for (const line of ['즉각적 효익', '단정적 선언', "'지금 사야 하는 이유'"]) expect(block).not.toContain(line)
    for (const line of ['핵심 기능 한 줄', '예상을 깨는 사실 한 줄', "할인·마감·'지금 사야' 같은 압박은 쓰지 마세요"])
      expect(block).toContain(line)
  })
})

describe('buildStrategyDirectionBlock — 디자인 컷 후킹 기본값(hookModes)', () => {
  it('호기심·공감을 장면·약속·수치로 바꾸고, 충격·증거·권위는 그대로 둔다', () => {
    const design = (hook_mode?: string) => buildStrategyDirectionBlock({ hook_mode } as never, {}, {}, '', '', { factOnly: true, hookModes: DESIGN_HOOK_MODE_BLOCKS })
    expect(design('curiosity')).toContain('쓰는 장면·약속·수치 중 하나로 첫 화면 카피를 여세요')
    expect(design('curiosity')).not.toContain('미완성 문장으로 스크롤을 유도')
    expect(design('empathy')).toContain('고민 질문은 그 고민이 곧 구매 이유일 때만 쓰세요')
    for (const mode of ['shock', 'proof', 'authority']) {
      expect(design(mode)).toBe(buildStrategyDirectionBlock({ hook_mode: mode } as never, {}, {}, '', '', { factOnly: true }))
    }
  })

  it('값이 없으면 기본값 줄을 넣는다', () => {
    expect(buildStrategyDirectionBlock({}, {}, {}, '', '', { hookModes: DESIGN_HOOK_MODE_BLOCKS })).toContain('첫 화면 카피는 쓰는 장면·약속·수치 중 하나로 여세요')
  })

  it('hookModes를 안 넘기는 R 잡은 다섯 모드 모두 바이트까지 원문이다', () => {
    for (const hook_mode of ['shock', 'curiosity', 'proof', 'empathy', 'authority']) {
      const plain = buildStrategyDirectionBlock({ hook_mode } as never, {}, {})
      expect(plain).toBe(buildStrategyDirectionBlock({ hook_mode } as never, {}, {}, '', '', {}))
      expect(plain).not.toContain('곧 구매 이유')
    }
    expect(buildStrategyDirectionBlock({ hook_mode: 'curiosity' } as never, {}, {})).toContain('미완성 문장으로 스크롤을 유도')
    expect(buildStrategyDirectionBlock({}, {}, {})).toBe('')
  })
})
