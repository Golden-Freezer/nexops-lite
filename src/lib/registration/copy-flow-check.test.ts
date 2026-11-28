/**
 * 카피 흐름 검사(P1-1b) — 되풀이 특징·수치·제목 되풀이·마지막 띠의 첫 화면 반복·답 없는 고민을 결정론으로 센다. 재료는 R9 심사 메모
 * (24KA·SB5X·5DWM r2·r4)에 나온 꼴이다. 첫 화면과 마지막 띠 한 쌍은 한 곳으로 센다(통합 보정). 순수 함수 시험(호출 0).
 */

import { describe, expect, it } from 'vitest'
import { findCrossSectionRepeats } from './copy-repeats'
import { buildFlowFixBlock, concernKeywords, concernPointPairs, copyFlowCounts, copyFlowRecord, findCopyFlowIssues, FLOW_FIX_LIMITS } from './copy-flow-check'
import type { OptionSpec } from './options/option-spec'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

const SPEC: PdpSpecSheet = { productName: '데이지 끈 간식 파우치 20매' }
const intro = (extra: Record<string, string> = {}) => ({ productType: '파우치', benefitHeadline: '하나씩 나눠 담는 간식 파우치', ...extra })
const flow = (copy: CopywritingResult, spec: PdpSpecSheet = SPEC) => findCopyFlowIssues(copy, spec)

describe('되풀이 특징 — 특징 제목 낱말 2개 이상이 특징 섹션 밖 두 곳 이상에', () => {
  it("'끈 당겨 마감'이 첫 화면·요약·추천 대상에서 다시 나오면 되풀이(마지막 띠는 첫 화면과 한 곳)", () => {
    const copy: CopywritingResult = {
      mainIntro: intro({ hook: '담고 끈을 당겨 마감해요' }),
      pointCards: [{ title: '끈 당겨 마감', description: '리본 없이 입구를 모아요' }],
      summary: '끈을 당겨 바로 마감하는 간식 파우치',
      recommendedTargets: ['끈을 당겨 빠르게 포장하고 싶은 분'],
      closingCta: { headline: '끈 당겨 마감까지 한 번에', subtext: '지금 담아 두세요' },
    }
    expect(flow(copy).features).toEqual([{ title: '끈 당겨 마감', sections: ['mainIntro', 'recommendedTargets', 'summary'] }])
  })

  it('첫 화면과 마지막 띠에서만 다시 말하면 되풀이가 아니다 — 마지막 띠의 효익 재정리는 정상 설득 패턴', () => {
    const copy: CopywritingResult = {
      mainIntro: intro({ hook: '담고 끈을 당겨 마감해요' }),
      pointCards: [{ title: '끈 당겨 마감', description: '리본 없이 입구를 모아요' }],
      closingCta: { headline: '끈 당겨 마감까지 한 번에' },
    }
    expect(flow(copy).features).toEqual([])
  })
})

describe('되풀이 수치 — 단위 붙은 숫자가 세 섹션 이상', () => {
  const base: CopywritingResult = {
    mainIntro: intro({ subBenefit: '20매 넉넉하게' }),
    closingCta: { headline: '20매 한 번에 준비해요' },
    summary: '20매 구성으로 반 전체에',
  }
  it('첫 화면·마지막 띠(한 곳)와 요약만이면 아니고, 비교 요약에도 나오면 되풀이', () => {
    expect(flow(base).numbers).toEqual([])
    expect(flow({ ...base, compareSummary: '20매로 나눠 담아요' }).numbers).toEqual([
      { token: '20매', sections: ['compareSummary', 'mainIntro', 'summary'] },
    ])
  })

  it('옵션 값인 수량은 섹션마다 나오는 게 정상이라 세지 않는다', () => {
    const optionSpec: OptionSpec = {
      axes: [{ kind: 'quantity', name: '수량', values: ['20매', '40매'] }],
      variants: [
        { label: '20매', values: { quantity: '20매' } },
        { label: '40매', values: { quantity: '40매' } },
      ],
      source: 'products',
    }
    expect(flow({ ...base, compareSummary: '20매로 나눠 담아요' }, { ...SPEC, optionSpec }).numbers).toEqual([])
  })
})

describe('제목 되풀이 — 설명이 제목 낱말을 되풀이하고 새 말이 적다', () => {
  it("'바닥이 잡힌 입체 형태예요 / 바닥이 잡혀 있는 입체 구조'는 되풀이, 근거·장면을 더한 설명은 아니다", () => {
    const copy: CopywritingResult = {
      mainIntro: intro(),
      pointCards: [
        { title: '바닥이 잡힌 입체 형태예요', description: '바닥이 잡혀 있는 입체 구조' },
        { title: '바닥이 잡힌 입체 형태', description: '간식을 세워 담아도 쓰러지지 않아요' },
      ],
      detailPoints: [{ claim: '은은하게 비치는 데이지', proof: '간식이 은은하게 비치는 데이지 무늬', benefit: '열기 전부터 설레요' }],
    }
    expect(flow(copy).restated.map((r) => r.path)).toEqual(['pointCards[0]', 'detailPoints[0].proof'])
  })
})

describe('마지막 띠가 첫 화면과 같은 말', () => {
  it('같은 낱말 묶음을 그대로 되풀이하면 센다 — 다른 말로 다시 정리하면 세지 않는다', () => {
    const echoed: CopywritingResult = {
      mainIntro: intro({ hook: '끈만 당기면 포장 끝' }),
      closingCta: { headline: '끈만 당기면 오늘 준비 끝', subtext: '지금 담아 두세요' },
    }
    expect(flow(echoed).closingEcho).toEqual([{ path: 'closingCta.headline', text: '끈만 당기면 오늘 준비 끝', phrase: '끈 당기면' }])
    const reworded: CopywritingResult = { ...echoed, closingCta: { headline: '반 친구 몫까지 오늘 미리 챙겨 두세요' } }
    expect(flow(reworded).closingEcho).toEqual([])
  })
})

describe('답 없는 고민 — 고민의 핵심 낱말이 뒤 섹션 어디에도 없다', () => {
  const problem = {
    question: '아이 이름은 어떻게 챙기나요?',
    empathyLines: ['리본 묶기가 번거로워요', '이름도 하나씩 챙겨요'],
    // 깊은 공감 줄은 답할 고민이 아니라 보지 않는다
    empathyDeepLines: ['특별한 날인데 아쉬워요'],
  }
  const base: CopywritingResult = {
    mainIntro: intro({ hook: '선물 포장, 아직도 리본 묶으세요?' }),
    problem,
    detailPoints: [{ claim: '끈 당겨 마감', proof: '리본 없이 입구를 모아요' }],
  }

  it("'이름도 하나씩 챙겨요'(R9 24KA r2)처럼 뒤에서 답하지 않은 고민을 찾는다 — 첫 화면의 물음 문장도 고민으로 본다", () => {
    const concerns = flow(base).concerns
    expect(concerns.map((c) => [c.path, c.answered])).toEqual([
      ['problem.question', false],
      ['problem.empathyLines[0]', true],
      ['problem.empathyLines[1]', false],
      ['mainIntro.hook', true],
    ])
    expect(concerns[2].keywords).toEqual(['이름'])
  })

  it('뒤 섹션(사용법 등)이 그 낱말로 답하면 답한 것이다 — 첫 화면·고민 섹션 자신은 답으로 보지 않는다', () => {
    const answered = flow({ ...base, howTo: [{ step: '이름표 붙이기', description: '이름 스티커를 붙여요' }] }).concerns
    expect(answered.every((c) => c.answered)).toBe(true)
    const selfOnly = flow({ ...base, mainIntro: intro({ subBenefit: '아이 이름까지 챙겨요' }) }).concerns
    expect(selfOnly.find((c) => c.path === 'problem.empathyLines[1]')?.answered).toBe(false)
  })
})

describe('주장과 근거가 같은 낱말을 쓰지 않는 포인트(후보)', () => {
  it("R9-P02 dp5 '선생님께 건넬 간식도 담아요' / '데이지 무늬의 반투명 디자인'은 걸리고, 같은 낱말로 받치는 짝은 걸리지 않는다", () => {
    const copy: CopywritingResult = {
      mainIntro: intro(),
      detailPoints: [
        { claim: '반투명이라 간식이 보여요', proof: '반투명 소재라 담은 간식이 은은하게 비쳐요' },
        { claim: '선생님께 건넬 간식도 담아요', proof: '데이지 무늬의 반투명 디자인' },
        { claim: '끈 당겨 마감', proof: '' },
      ],
    }
    expect(flow(copy).mismatched).toEqual([
      { path: 'detailPoints[1]', claim: '선생님께 건넬 간식도 담아요', proof: '데이지 무늬의 반투명 디자인' },
    ])
    // 다른 말로 받치는 정상 짝도 걸리는 후보라 기록에만 남기고 Stage 3 고칠 곳에는 넣지 않는다
    expect(copyFlowCounts(flow(copy)).mismatched).toBe(1)
    expect(buildFlowFixBlock(flow(copy))).toBe('')
  })
})

describe('기존 반복 검사와의 관계', () => {
  it('문구 반복은 같은 2-그램 검사를 쓰되 첫 화면·마지막 띠를 한 곳으로 센다(기존 기록·블록은 그대로)', () => {
    const copy: CopywritingResult = {
      mainIntro: intro({ hook: '끈 당겨 포장 끝' }),
      closingCta: { headline: '끈 당겨 오늘 끝' },
      summary: '끈 당겨 마감하는 파우치',
    }
    expect(findCrossSectionRepeats(copy).map((r) => r.phrase)).toContain('끈 당겨')
    expect(flow(copy).phrases).toEqual([])
  })
})

describe('기록과 Stage 3 고칠 곳', () => {
  const copy: CopywritingResult = {
    mainIntro: intro({ hook: '담고 끈을 당겨 마감해요' }),
    problem: { empathyLines: ['이름도 하나씩 챙겨요'] },
    pointCards: [{ title: '바닥이 잡힌 입체 형태예요', description: '바닥이 잡혀 있는 입체 구조' }],
    summary: '끈을 당겨 바로 마감하는 20매 구성',
    compareSummary: '20매 끈을 당겨 마감',
    recommendedTargets: ['20매로 반 전체 준비'],
    closingCta: { headline: '담고 끈을 당겨 끝내요' },
  }

  it('수는 종류마다, before는 Stage 2 산출, fix는 flow 잡 — 예시는 짧게', () => {
    const findings = flow(copy)
    const counts = copyFlowCounts(findings)
    expect(counts).toMatchObject({ numbers: 1, restated: 1, closing_echo: 1, unanswered: 1 })
    expect(copyFlowRecord(findings)).toEqual({
      version: 1,
      counts,
      examples: expect.objectContaining({ numbers: ['20매'], restated: ['pointCards[0]'], unanswered: ['이름도 하나씩 챙겨요'] }),
    })
    const recorded = copyFlowRecord(findings, findings, true)
    expect(recorded.before).toEqual(counts)
    expect(recorded.fix).toBe(true)
  })

  it('걸린 것이 없으면 빈 블록(프롬프트 불변), 있으면 종류별 줄 — 마지막 띠는 지우지 말고 다른 말로, 고민은 답하기 → 바꾸기 → 빼기 순', () => {
    expect(buildFlowFixBlock(flow({ mainIntro: intro() }))).toBe('')
    const block = buildFlowFixBlock(flow(copy))
    expect(block.startsWith('## [흐름 — 고칠 곳(결정론 검사)]')).toBe(true)
    expect(block).toContain('첫 화면과 마지막 띠(closingCta)는 핵심 효익을 다시 정리해도 되지만 같은 문장·같은 낱말 묶음을 그대로 되풀이하지 않는다')
    expect(block).toContain('지어내지 않고')
    expect(block).toContain("- 되풀이 수치: '20매'")
    expect(block).toContain('- 제목 되풀이: [pointCards[0]]')
    const closing = block.split('\n').find((l) => l.startsWith('- 마지막 띠가 첫 화면과 같은 말'))!
    expect(closing).toContain('구매 이유 요약이나 다른 말로')
    expect(closing).not.toMatch(/지운다|뺀다/)
    const concern = block.split('\n').find((l) => l.startsWith('- 답 없는 고민'))!
    expect(concern.indexOf('입력 사실로 답한다')).toBeLessThan(concern.indexOf('답할 수 있는 고민으로 바꾼다'))
    expect(concern.indexOf('답할 수 있는 고민으로 바꾼다')).toBeLessThan(concern.indexOf('이 줄을 뺀다'))
  })

  it('종류마다 상한까지만 넘긴다', () => {
    const many: CopywritingResult = {
      mainIntro: intro(),
      problem: { empathyLines: ['가방 정리', '도시락 준비', '우산 챙김', '신발 세탁', '물병 세척'].map((t) => `${t}이 어려워요`) },
    }
    const lines = buildFlowFixBlock(flow(many)).split('\n').filter((l) => l.startsWith('- 답 없는 고민'))
    expect(lines).toHaveLength(FLOW_FIX_LIMITS.unanswered)
  })
})

describe('고민 줄과 POINT의 짝(concernPointPairs) — 재기 전용', () => {
  const base: CopywritingResult = {
    mainIntro: intro(),
    problem: { empathyLines: ['바닥 얼룩이 남아요', '손잡이가 미끄러워요', '이런 때 있죠'] },
    pointCards: [{ title: '얼룩 없이 닦이는 바닥', description: '물로 헹궈요' }],
  }

  it('POINT가 같은 낱말로 답한 줄만 짝으로 세고, 핵심 낱말이 없는 줄은 세지 않는다', () => {
    expect(concernPointPairs(base, SPEC)).toEqual({ lines: 2, paired: 1 })
  })

  it('상세 포인트의 주장·근거도 답으로 본다', () => {
    expect(concernPointPairs({ ...base, detailPoints: [{ claim: '손잡이 고무', proof: '젖어도 잡혀요' }] }, SPEC)).toEqual({ lines: 2, paired: 2 })
  })

  it('고민 줄이 없으면 0이다', () => {
    expect(concernPointPairs({ mainIntro: intro() }, SPEC)).toEqual({ lines: 0, paired: 0 })
  })

  it('K 쪽 낱말 거름이 기존 답 없는 고민 판정과 같은 낱말을 고른다', () => {
    expect(flow(base).concerns.map((c) => c.keywords)).toEqual([concernKeywords('바닥 얼룩이 남아요'), concernKeywords('손잡이가 미끄러워요')])
  })
})
