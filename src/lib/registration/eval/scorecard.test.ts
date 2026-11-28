import { describe, expect, it } from 'vitest'
// 점수 JSON이 보고서 입력 형식과 맞는지 함께 확인한다
import { itemRows, summarizeRounds } from '../../../../scripts/pdp-eval/report.mjs'
import {
  adjustR8,
  audienceFit,
  buildScorecard,
  combineJudges,
  combineJudgesV2,
  mergePenalties,
  PASS_LINE,
  recordsBelowLine,
  RUBRIC_KEYS,
  RUBRIC_V2_KEYS,
  scoreAuto,
  type JudgeResult,
  type PageMeasurement,
  type ProductMatch,
  type RubricKey,
} from './scorecard'
import { findRegulatedClaims } from './claim-lexicon'

const allPass = Array.from({ length: 8 }, (_, i) => ({ id: `R${i + 1}`, pass: true }))
const zeroMobile = { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0, M7: 0 }

function measurement(overrides: Partial<PageMeasurement> = {}): PageMeasurement {
  return {
    order: ['main_cut', 'point_div', 'cta'],
    persuasion: { source: 'record', grammar: 'G1', lengthTarget: [7, 10], rules: allPass },
    objections: [
      { objection: '고민1', answeredBy: 'hidden_page', status: 'answered' },
      { objection: '고민2', answeredBy: null, note: '인증 근거 없음', status: 'noted' },
      { objection: '고민3', answeredBy: 'point_div', status: 'answered' },
    ],
    layouts: { categories: {}, applied: 0, repeats: [], assigned: 0, guardDropped: [] },
    annotations: { targetCuts: 4, targets: 4, decorated: 4 },
    mobile: { counts: zeroMobile },
    claims: [],
    claimEvidence: '',
    ...overrides,
  }
}

function judge(scores: number | number[], violations: JudgeResult['violations'] = []): JudgeResult {
  const list = Array.isArray(scores) ? scores : RUBRIC_KEYS.map(() => scores)
  const items = Object.fromEntries(RUBRIC_KEYS.map((k, i) => [k, { score: list[i], reason: '이유' }])) as JudgeResult['items']
  return { label: 'XK7P', items, violations, summary: '강점·약점' }
}

describe('scoreAuto — 자동 지표 40점', () => {
  it('모두 통과하면 40점', () => {
    expect(scoreAuto(measurement())).toEqual({
      total: 40,
      items: { persuasion: 12, objections: 8, mobile: 14, rhythm: 3, annotations: 3 },
      complete: true,
    })
  })

  it('설득 규칙은 통과 1개당 1.5점', () => {
    const rules = allPass.map((r, i) => ({ ...r, pass: i >= 3 }))
    expect(scoreAuto(measurement({ persuasion: { source: 'derived', grammar: 'G4', lengthTarget: [7, 10], rules } })).items.persuasion).toBe(7.5)
  })

  it('고민 응답률 — 응답·사유 기록은 인정, 침묵만 빠진다. 고민이 없으면 만점', () => {
    const silent = measurement().objections.map((o, i) => (i === 0 ? { ...o, status: 'silent' as const } : o))
    expect(scoreAuto(measurement({ objections: silent })).items.objections).toBe(5.33)
    expect(scoreAuto(measurement({ objections: [] })).items.objections).toBe(8)
  })

  it('모바일은 위반 0인 규칙당 2점, 미측정이면 null·complete=false', () => {
    expect(scoreAuto(measurement({ mobile: { counts: { ...zeroMobile, M1: 12, M6: 3 } } })).items.mobile).toBe(10)
    const unmeasured = scoreAuto(measurement({ mobile: null }))
    expect(unmeasured.items.mobile).toBeNull()
    expect(unmeasured.complete).toBe(false)
    expect(unmeasured.total).toBe(26)
  })

  it('배치 리듬은 인접 중복 0이면 3, 하나라도 있으면 0', () => {
    const layouts = { categories: {}, applied: 2, repeats: ['a→b(split)'], assigned: 2, guardDropped: [] }
    expect(scoreAuto(measurement({ layouts })).items.rhythm).toBe(0)
  })

  it('강조 장식은 장식된 대상 비율 × 3, 잡에 대상 컷이 없으면 깎지 않는다', () => {
    expect(scoreAuto(measurement({ annotations: { targetCuts: 6, targets: 4, decorated: 1 } })).items.annotations).toBe(0.75)
    expect(scoreAuto(measurement({ annotations: { targetCuts: 0, targets: 0, decorated: 0 } })).items.annotations).toBe(3)
  })

  it('대상 컷이 있는데 렌더에서 하나도 못 찾으면 0점(매칭 실패를 만점으로 숨기지 않는다)', () => {
    expect(scoreAuto(measurement({ annotations: { targetCuts: 3, targets: 0, decorated: 0 } })).items.annotations).toBe(0)
  })
})

describe('combineJudges — (평균 − 1) ÷ 4 × 60', () => {
  it('모두 5점이면 60, 모두 1점이면 0', () => {
    expect(combineJudges({ claude: judge(5), codex: judge(5) }).judgeScore).toBe(60)
    expect(combineJudges({ claude: judge(1), codex: judge(1) }).judgeScore).toBe(0)
  })

  it('T7a 실측 B 잡(손계산 27.2/60)과 같다', () => {
    const codex = judge([4, 3, 2, 2, 4, 3, 4, 1])
    const claude = judge([4, 2, 2, 2, 4, 4, 3, 1])
    expect(combineJudges({ claude, codex })).toEqual({ judgeScore: 27.19, mean: 2.81, used: ['claude', 'codex'], disagreements: [] })
  })

  it('2점 넘게 갈린 항목만 표시한다(2점 차이는 표시하지 않음)', () => {
    const claude = judge([5, 5, 4, 3, 3, 3, 3, 3])
    const codex = judge([2, 3, 4, 3, 3, 3, 3, 3])
    expect(combineJudges({ claude, codex }).disagreements).toEqual(['r1' as RubricKey])
  })

  it('심사위원이 하나면 그 점수만, 없으면 null', () => {
    expect(combineJudges({ codex: judge(3) })).toMatchObject({ judgeScore: 30, used: ['codex'], disagreements: [] })
    expect(combineJudges({})).toEqual({ judgeScore: null, mean: null, used: [], disagreements: [] })
  })
})

describe('mergePenalties — 자동 검사 + 심사위원 지적', () => {
  // 친환경은 규제 묶음의 인증·인허가(절대 환경 표시)다
  const eco = { kind: 'certification' as const, terms: ['친환경'], sections: ['point_div'] }

  it('같은 주장은 1건으로 합치고 출처를 모은다, 어디에도 안 붙는 지적은 새 건(출처 하나면 판정 갈림)', () => {
    const { penalties, split } = mergePenalties(
      [eco],
      {
        claude: judge(3, [{ text: '친환경적인 종이 소재로', kind: 'eco', screen: 3 }]),
        codex: judge(3, [
          { text: '친환경적인 종이 소재로 자연스러운 포장', kind: 'eco', screen: 3 },
          { text: '두피 열감 진정', kind: 'efficacy', screen: 2 },
        ]),
      },
      ''
    )
    expect(penalties).toEqual([{ text: '친환경', kind: 'certification', sources: ['auto', 'claude', 'codex'], source: 'auto+claude+codex' }])
    expect(split).toEqual([{ text: '두피 열감 진정', kind: 'medical', sources: ['codex'], source: 'codex' }])
  })

  it('과반 — 출처(자동·Claude·코덱스) 둘 이상이 짚은 주장만 감점, 하나면 판정 갈림(R5r′ P03 한 명 지적 흔들림)', () => {
    const one = mergePenalties([], { claude: judge(3, [{ text: '무독성 잉크', kind: 'safety', screen: 1 }]), codex: judge(3) }, '')
    expect(one.penalties).toEqual([])
    expect(one.split.map((p) => p.source)).toEqual(['claude'])
    const autoOnly = mergePenalties([eco], { claude: judge(3), codex: judge(3) }, '')
    expect(autoOnly.penalties).toEqual([])
    expect(autoOnly.split.map((p) => p.source)).toEqual(['auto'])
    const autoAndJudge = mergePenalties([eco], { claude: judge(3), codex: judge(3, [{ text: '친환경 종이', kind: 'eco', screen: 2 }]) }, '')
    expect(autoAndJudge.penalties.map((p) => p.source)).toEqual(['auto+codex'])
    expect(autoAndJudge.split).toEqual([])
  })

  it('심사위원끼리 문구가 겹치면 1건', () => {
    const { penalties } = mergePenalties(
      [],
      {
        claude: judge(3, [{ text: '무독성 잉크', kind: 'safety', screen: 1 }]),
        codex: judge(3, [{ text: '무독성 잉크로 아이도 안심', kind: 'safety', screen: 1 }]),
      },
      ''
    )
    expect(penalties).toHaveLength(1)
    expect(penalties[0].sources).toEqual(['claude', 'codex'])
  })

  it('스펙 근거로 뒷받침되는 표현만 waived, 같은 종류라도 다른 표현은 남는다(자동만이면 판정 갈림), other는 notes로만', () => {
    const result = mergePenalties(
      [
        { kind: 'certification', terms: ['KC 인증'], sections: ['certification'] },
        { kind: 'certification', terms: ['FDA 승인'], sections: ['point_div'] },
        { kind: 'certification', terms: ['100% 안전'], sections: ['point_div'] },
      ],
      { codex: judge(3, [{ text: '과장된 비교', kind: 'other', screen: 4 }]) },
      'KC 안전확인 신고 완료'
    )
    expect(result.waived.map((p) => p.text)).toEqual(['KC 인증'])
    expect(result.split.map((p) => p.text)).toEqual(['FDA 승인', '100% 안전'])
    expect(result.penalties).toEqual([])
    expect(result.notes).toEqual([{ text: '과장된 비교', source: 'codex' }])
  })

  it('면제된 표현의 묶음이 같은 지적의 다른 표현을 끌어안지 않는다 — KC 인증은 면제, 친환경은 따로(verifier 재현)', () => {
    const { split, waived } = mergePenalties(
      [{ kind: 'certification', terms: ['KC 인증'], sections: ['certification'] }],
      { claude: judge(3, [{ text: 'KC 인증 완료된 친환경 소재', kind: 'eco', screen: 2 }]) },
      'KC 안전확인 신고 완료'
    )
    expect(waived.map((p) => p.text)).toEqual(['KC 인증'])
    expect(split).toEqual([{ text: '친환경', kind: 'certification', sources: ['claude'], source: 'claude' }])
  })

  it('심사위원이 종류를 다르게 적어도 사전 표현이 같으면 같은 묶음', () => {
    const { penalties } = mergePenalties([eco], { codex: judge(3, [{ text: '친환경 종이', kind: 'efficacy', screen: 3 }]) }, '')
    expect(penalties).toEqual([{ text: '친환경', kind: 'certification', sources: ['auto', 'codex'], source: 'auto+codex' }])
  })

  it('지적 하나의 같은 종류 표현 여럿은 1건, 두 심사위원이 같은 문장을 지적해도 1건', () => {
    const text = '친환경 생분해 소재'
    const { penalties } = mergePenalties(
      [],
      { claude: judge(3, [{ text, kind: 'eco', screen: 2 }]), codex: judge(3, [{ text, kind: 'eco', screen: 2 }]) },
      ''
    )
    expect(penalties).toEqual([{ text: '친환경 · 생분해', kind: 'certification', sources: ['claude', 'codex'], source: 'claude+codex' }])
  })

  it('사전 표현이 없는 지적은 근거 면제를 받지 않는다', () => {
    const { split, waived } = mergePenalties([], { codex: judge(3, [{ text: '공식 마크처럼 보이는 표시', kind: 'certification', screen: 1 }]) }, 'KC 안전확인')
    expect(split.map((p) => p.text)).toEqual(['공식 마크처럼 보이는 표시'])
    expect(waived).toEqual([])
  })

  it('문장부호만인 지적은 다른 묶음에 붙지 않는다', () => {
    const { penalties, split } = mergePenalties([eco], { codex: judge(3, [{ text: '!!', kind: 'eco', screen: 1 }]) }, '')
    expect(penalties).toEqual([])
    expect(split).toHaveLength(2)
  })

  describe('규제 묶음(2026-10-30 오너 지시) — 지적 종류를 규제 묶음으로 옮기고 규제 표현으로 붙인다', () => {
    /** 묶음만 본다 — 감점(출처 둘 이상)과 판정 갈림(하나)을 합친 순서 */
    const groupsOf = (r: ReturnType<typeof mergePenalties>) => [...r.penalties, ...r.split]
    const same = (claude: string, codex: string, kind = 'efficacy') =>
      groupsOf(
        mergePenalties(
          [],
          {
            claude: judge(3, [{ text: claude, kind, screen: 2 }]),
            codex: judge(3, [{ text: codex, kind, screen: 2 }]),
          },
          ''
        )
      )

    it('efficacy는 medical, safety·certification·eco는 certification으로 센다', () => {
      const result = mergePenalties(
        [],
        {
          claude: judge(3, [
            { text: '미백 크림처럼 환해지는', kind: 'efficacy', screen: 2 },
            { text: '무독성 잉크', kind: 'safety', screen: 3 },
          ]),
          codex: judge(3, [
            { text: '미백 효과', kind: 'efficacy', screen: 2 },
            { text: '무독성 소재', kind: 'eco', screen: 3 },
          ]),
        },
        ''
      )
      expect(result.penalties.map((p) => [p.text, p.kind, p.source])).toEqual([
        ['미백', 'medical', 'claude+codex'],
        ['무독성', 'certification', 'claude+codex'],
      ])
    })

    it('자동 검사가 잡은 규제 표현을 심사위원도 지적하면 1건(L0 P10)', () => {
      const auto = { kind: 'medical' as const, terms: ['통증'], sections: ['point_div'] }
      const { penalties } = mergePenalties([auto], { claude: judge(3, [{ text: '허리 통증완화에 도움', kind: 'efficacy', screen: 1 }]) }, '')
      expect(penalties).toEqual([{ text: '통증', kind: 'medical', sources: ['auto', 'claude'], source: 'auto+claude' }])
    })

    it('트러블 지적 — 심사위원 둘이면 전처럼 1건, 한 명이어도 페이지에 있으면 자동과 합쳐 감점(전에는 판정 갈림)', () => {
      const text = '쓰고 나서 피부트러블이 사라졌어요'
      const v = [{ text, kind: 'efficacy' as const, screen: 18 }]
      const auto = findRegulatedClaims([{ section: 'faq', text }])
      expect(auto).toEqual([{ kind: 'medical', terms: ['트러블이 사라'], sections: ['faq'] }])
      expect(mergePenalties(auto, { claude: judge(1, v), codex: judge(1, v) }, '').penalties).toEqual([
        { text: '트러블이 사라', kind: 'medical', sources: ['auto', 'claude', 'codex'], source: 'auto+claude+codex' },
      ])
      expect(mergePenalties(auto, { claude: judge(1, v), codex: judge(5) }, '').penalties).toEqual([
        { text: '트러블이 사라', kind: 'medical', sources: ['auto', 'claude'], source: 'auto+claude' },
      ])
      const alone = mergePenalties(auto, { claude: judge(5), codex: judge(5) }, '')
      expect(alone.penalties).toEqual([])
      expect(alone.split).toEqual([{ text: '트러블이 사라', kind: 'medical', sources: ['auto'], source: 'auto' }])
    })

    it('규제 표현이 없는 지적은 문구 포함 관계로 묶는다 — 심사위원 순서와 상관없이 1건(L0 P03)', () => {
      const long = '두피 열감 진정 / 민감한 두피 열감까지 진정'
      const short = '민감한 두피 열감까지 진정'
      expect(same(long, short)).toHaveLength(1)
      expect(same(short, long)).toHaveLength(1)
    })
  })
})

describe('adjustR8 — r8 과반 보정(한 심사위원만 짚은 규제 표현)', () => {
  const r8 = (score: number, violations: JudgeResult['violations'] = []) =>
    judge([4, 4, 4, 4, 4, 4, 4, score], violations)
  const scores = (m: ReturnType<typeof mergePenalties>, j: Parameters<typeof mergePenalties>[1]) => {
    const { judges, adjusted } = adjustR8(j, m.penalties, m.split)
    return { claude: judges.claude?.items.r8.score, codex: judges.codex?.items.r8.score, adjusted }
  }

  it('판정 갈림만 짚은 심사위원의 r8은 짚지 않은 쪽 값으로 바꾼다(R6b P07 코덱스 1 → 5)', () => {
    const judges = { claude: r8(5), codex: r8(1, [{ text: '턱드름 때문에 식기를 바꿨어요', kind: 'efficacy', screen: 6 }]) }
    const m = mergePenalties([], judges, '')
    expect(m.split.map((p) => p.source)).toEqual(['codex'])
    expect(scores(m, judges)).toEqual({ claude: 5, codex: 5, adjusted: [{ judge: 'codex', from: 1, to: 5 }] })
  })

  it('짚지 않은 쪽 r8이 같거나 낮으면 5로 둔다', () => {
    const judges = { claude: r8(1), codex: r8(1, [{ text: '무독성 잉크', kind: 'safety', screen: 2 }]) }
    const m = mergePenalties([], judges, '')
    expect(scores(m, judges)).toMatchObject({ claude: 1, codex: 5 })
  })

  it('감점이 된 지적(자동 검사와 겹침)이거나 두 심사위원이 모두 짚었으면 그대로', () => {
    const viol = [{ text: '친환경 소재', kind: 'eco', screen: 2 }]
    const withAuto = { claude: r8(5), codex: r8(1, viol) }
    const auto = [{ kind: 'certification' as const, terms: ['친환경'], sections: ['cta'] }]
    expect(scores(mergePenalties(auto, withAuto, ''), withAuto)).toEqual({ claude: 5, codex: 1, adjusted: [] })
    const both = { claude: r8(1, [{ text: '무독성 잉크', kind: 'safety', screen: 2 }]), codex: r8(1, viol) }
    expect(scores(mergePenalties([], both, ''), both)).toEqual({ claude: 1, codex: 1, adjusted: [] })
  })

  it('buildScorecard — 보정한 r8로 심사 점수를 내고 보정 전 값을 함께 싣는다', () => {
    const judges = { claude: r8(5), codex: r8(1, [{ text: '턱드름 때문에 식기를 바꿨어요', kind: 'efficacy', screen: 6 }]) }
    const card = buildScorecard({ product: 'P07', round: 'R6', jobId: 'job', label: 'U6KA' }, measurement(), judges)
    // r1~r7 4점 + r8 5·1 → 평균 3.875(43.13), 보정 뒤 5·5 → 4.125(46.88)
    expect(card.judgeScoreBeforeR8).toBe(43.13)
    expect(card.judgeScore).toBe(46.88)
    expect(card.r8Adjustments).toEqual([{ judge: 'codex', from: 1, to: 5 }])
    expect(card.judges.codex!.items.r8.score).toBe(1)
    expect(card.penalties).toEqual([])
    expect(card.total).toBe(86.88)
  })
})

describe('buildScorecard — 점수 JSON 한 건', () => {
  const meta = { product: 'P01', round: 'R1', jobId: 'job-1', label: 'XK7P', costUsd: 1.2, durationMin: 30, captureDir: '/tmp/cap' }

  it('총점 = 자동 + 심사 − 감점 10점/건(출처 둘 이상)', () => {
    const card = buildScorecard(meta, measurement({ claims: [{ kind: 'certification', terms: ['친환경'], sections: ['cta'] }] }), {
      claude: judge(4, [{ text: '친환경 소재', kind: 'eco', screen: 3 }]),
      codex: judge(4),
    })
    expect(card.auto.total).toBe(40)
    expect(card.judgeScore).toBe(45)
    expect(card.penaltyPoints).toBe(-10)
    expect(card.total).toBe(75)
    expect(card.splitClaims).toEqual([])
    expect(card.complete).toBe(true)
    expect(card.missing).toEqual([])
  })

  it('출처 하나만 짚은 주장은 감점하지 않고 splitClaims에 남긴다', () => {
    const card = buildScorecard(meta, measurement({ claims: [{ kind: 'certification', terms: ['친환경'], sections: ['cta'] }] }), {
      claude: judge(4),
      codex: judge(4),
    })
    expect(card.penalties).toEqual([])
    expect(card.total).toBe(85)
    expect(card.splitClaims.map((p) => p.source)).toEqual(['auto'])
  })

  it('심사가 없거나 모바일 미측정이면 총점을 비우고 빠진 것을 적는다', () => {
    expect(buildScorecard(meta, measurement()).total).toBeNull()
    const card = buildScorecard(meta, measurement({ mobile: null }), { codex: judge(4) })
    expect(card.total).toBeNull()
    expect(card.missing).toEqual(['mobile', 'judge:claude'])
  })

  it('심사위원이 하나뿐이면 총점을 비운다(심사 점수만 싣는다 — 보고서 평균에 섞이지 않게)', () => {
    const card = buildScorecard(meta, measurement(), { codex: judge(4) })
    expect(card.judgeScore).toBe(45)
    expect(card.total).toBeNull()
    expect(card.missing).toEqual(['judge:claude'])
  })

  it('report.mjs 입력 형식과 맞는다(라운드 요약·항목 표)', () => {
    const card = buildScorecard(meta, measurement(), { claude: judge(4), codex: judge(5) })
    const program = { title: 't', rounds: ['R1'], products: [{ id: 'P01', name: 'p' }], entries: [card], changes: [] }
    const [summary] = summarizeRounds(program)
    expect(summary).toMatchObject({ round: 'R1', n: 1, avgTotal: card.total, avgAuto: 40, avgJudge: card.judgeScore, costUsd: 1.2 })
    const rows = itemRows(program) as Array<{ key: string; byRound: Record<string, number> }>
    expect(rows.find((r) => r.key === 'mobile')!.byRound.R1).toBe(14)
    expect(rows.find((r) => r.key === 'r1')!.byRound.R1).toBe(4.5)
  })
})

describe('buildScorecard — 이미지 사용률(W5, 보고용)', () => {
  const meta = { product: 'P01', round: 'R1', jobId: 'job-1', label: 'XK7P', costUsd: 1.2, durationMin: 30, captureDir: '/tmp/cap' }

  it('측정에 사용률이 있으면 detail에 그대로 남기고, 없으면 키가 없다(점수는 같다)', () => {
    const images = { generated: 10, used: 8, rate: 0.8 }
    const withImages = buildScorecard(meta, measurement({ images }))
    const without = buildScorecard(meta, measurement())
    expect(withImages.detail.images).toEqual(images)
    expect(without.detail).not.toHaveProperty('images')
    expect(withImages.total).toBe(without.total)
  })
})

/** 채점 v2 심사 결과 — r1~r8은 v1Score 하나, r9·r10은 따로 */
function judgeV2(v1Score: number, r9: number, r10: number, violations: JudgeResult['violations'] = []): JudgeResult {
  const base = judge(v1Score, violations)
  return { ...base, items: { ...base.items, r9: { score: r9, reason: '이유' }, r10: { score: r10, reason: '이유' } } }
}
const MATCH_PASS: ProductMatch = { pass: true, differences: [], summary: '같은 상품' }
const MATCH_FAIL: ProductMatch = { pass: false, differences: [{ screen: 2, aspect: 'count', text: '구성 수가 다르다' }], summary: '다르다' }

describe('채점 v2 — r9·r10, 상품 일치, 합격선(PDP-DR-PLAN §0)', () => {
  const meta = { product: 'P01', round: 'R9', jobId: 'job-1', label: 'XK7P', costUsd: 1.2, durationMin: 30, captureDir: '/tmp/cap' }

  it('v1 총점·심사 점수는 r1~r8로만 낸다 — r9·r10이 낮아도 v1은 같다(v1 점수가 이어진다)', () => {
    const v1 = buildScorecard(meta, measurement(), { claude: judge(4), codex: judge(4) })
    const v2 = buildScorecard(meta, measurement(), { claude: judgeV2(4, 1, 1), codex: judgeV2(4, 1, 1) })
    expect(v2.total).toBe(v1.total)
    expect(v2.judgeScore).toBe(v1.judgeScore)
    expect(v2.disagreements).toEqual([])
    expect(v1.v2).toBeNull()
    expect(RUBRIC_V2_KEYS).toEqual([...RUBRIC_KEYS, 'r9', 'r10'])
  })

  it('v2 총점은 심사 10항목 평균 환산, r9·r10 평균(designMean)과 10항목 차이를 함께 낸다', () => {
    // r1~r8 4점 16개 + r9 5·1, r10 2·4 → 평균 3.8 → 42. 자동 40 + 42 = 82. r9는 4점 차이라 표시, r10은 2점이라 표시 안 함
    const card = buildScorecard(meta, measurement(), { claude: judgeV2(4, 5, 2), codex: judgeV2(4, 1, 4) })
    expect(card.v2).toEqual({ total: 82, judgeScore: 42, judgeMean: 3.8, designMean: 3, disagreements: ['r9'] })
    expect(card.total).toBe(85)
  })

  it('쓴 심사위원 하나라도 r9·r10이 없으면 v2를 내지 않는다(예전 8항목 결과와 섞이지 않게)', () => {
    const card = buildScorecard(meta, measurement(), { claude: judgeV2(4, 4, 4), codex: judge(4) }, { productMatch: MATCH_PASS })
    expect(card.v2).toBeNull()
    expect(card.pass).toEqual({ v1: true, v2: null })
    expect(combineJudgesV2({ claude: judgeV2(4, 4, 4) })).toMatchObject({ judgeScore: 45, designMean: 4 })
    expect(combineJudgesV2({})).toBeNull()
  })

  it('v2 총점도 v1처럼 모바일·두 심사위원이 다 있을 때만', () => {
    const card = buildScorecard(meta, measurement({ mobile: null }), { claude: judgeV2(4, 4, 4), codex: judgeV2(4, 4, 4) })
    expect(card.v2).toMatchObject({ total: null, judgeScore: 45, designMean: 4 })
    expect(card.pass).toEqual({ v1: null, v2: null })
  })

  it('합격선 v1 — 총점 80·심사 42·감점 0, 총점이 없으면 null', () => {
    expect(PASS_LINE).toEqual({ total: 80, judge: 42, penalties: 0, designMean: 3.5, records: { r12: 2.5, r13: 3.0, r14: 3.5 } })
    expect(buildScorecard(meta, measurement(), { claude: judge(4), codex: judge(4) }).pass.v1).toBe(true)
    // 심사 평균 3.5 → 37.5 < 42(총점 77.5)
    expect(buildScorecard(meta, measurement(), { claude: judge(3), codex: judge(4) }).pass.v1).toBe(false)
    // 두 심사위원이 같은 규제 표현을 짚으면 감점 1건 — 총점 90·심사 60이어도 불합격
    const flagged = [{ text: '친환경 소재', kind: 'eco', screen: 3 }]
    const penalized = buildScorecard(meta, measurement(), { claude: judge(5, flagged), codex: judge(5, flagged) })
    expect(penalized.total).toBe(90)
    expect(penalized.pass.v1).toBe(false)
    expect(buildScorecard(meta, measurement(), { codex: judge(4) }).pass).toEqual({ v1: null, v2: null })
  })

  it('합격선 v2 기록 항목(J16) — 기록이 있는 항목만 두 심사 평균이 하한(r12 2.5·r13 3.0·r14 3.5) 이상이어야 하고, 기록이 없으면 지금 판정 그대로·v1은 보지 않는다', () => {
    const withRecords = (r12: number, r13: number, r14: number) => {
      const base = judgeV2(4, 4, 3)
      return { ...base, items: { ...base.items, r12: { score: r12, reason: '' }, r13: { score: r13, reason: '' }, r14: { score: r14, reason: '' } } }
    }
    const card = (claude: ReturnType<typeof withRecords>, codex: ReturnType<typeof withRecords>) => buildScorecard(meta, measurement(), { claude, codex }, { productMatch: MATCH_PASS })
    // 하한 그대로(r12 2.5·r13 3·r14 3.5)는 합격
    const edge = card(withRecords(2, 3, 3), withRecords(3, 3, 4))
    expect(edge.records).toMatchObject({ r12: { mean: 2.5 }, r13: { mean: 3 }, r14: { mean: 3.5 } })
    expect(edge.recordsBelow).toEqual([])
    expect(edge.pass).toEqual({ v1: true, v2: true })
    // r13 첫 화면 효익 장면 2.5 < 3 — v2만 불합격, 아래 항목을 남긴다
    const low = card(withRecords(4, 2, 5), withRecords(4, 3, 5))
    expect(low.recordsBelow).toEqual(['r13'])
    expect(low.pass).toEqual({ v1: true, v2: false })
    // 기록이 없는 예전 심사 — 지금 판정 그대로
    const old = buildScorecard(meta, measurement(), { claude: judgeV2(4, 4, 3), codex: judgeV2(4, 4, 3) }, { productMatch: MATCH_PASS })
    expect(old.records).toEqual({})
    expect(old.recordsBelow).toEqual([])
    expect(old.pass).toEqual({ v1: true, v2: true })
    expect(recordsBelowLine({ r14: { mean: 3 } })).toEqual(['r14'])
    expect(recordsBelowLine(null)).toEqual([])
  })

  it('합격선 v2 — 같은 선 + 상품 일치 통과 + r9·r10 평균 3.5 이상, 상품 일치 결과가 없으면 null', () => {
    // r9 4·4, r10 3·3 → designMean 3.5, 평균 3.9 → 43.5, v2 총점 83.5
    const judges = { claude: judgeV2(4, 4, 3), codex: judgeV2(4, 4, 3) }
    const passed = buildScorecard(meta, measurement(), judges, { productMatch: MATCH_PASS })
    expect(passed.v2).toMatchObject({ total: 83.5, judgeScore: 43.5, designMean: 3.5 })
    expect(passed.pass).toEqual({ v1: true, v2: true })
    expect(passed.productMatch).toEqual(MATCH_PASS)
    expect(buildScorecard(meta, measurement(), judges).pass).toEqual({ v1: true, v2: null })
    expect(buildScorecard(meta, measurement(), judges, { productMatch: MATCH_FAIL }).pass).toEqual({ v1: true, v2: false })
    // r9·r10 평균 3.25 < 3.5 — 총점·심사가 넘어도 v2 불합격
    const lowDesign = buildScorecard(meta, measurement(), { claude: judgeV2(4, 3, 3), codex: judgeV2(4, 4, 3) }, { productMatch: MATCH_PASS })
    expect(lowDesign.v2).toMatchObject({ total: 82.75, designMean: 3.25 })
    expect(lowDesign.pass).toEqual({ v1: true, v2: false })
  })

  it('report.mjs — r9·r10 항목 평균, v2 총점, 합격 수를 싣는다(예전 8항목 잡은 r9·r10 빈칸)', () => {
    const card = buildScorecard(meta, measurement(), { claude: judgeV2(4, 4, 3), codex: judgeV2(4, 4, 3) }, { productMatch: MATCH_PASS })
    const old = buildScorecard({ ...meta, product: 'P02' }, measurement(), { claude: judge(4), codex: judge(4) })
    const program = { title: 't', rounds: ['R9'], products: [{ id: 'P01', name: 'p' }, { id: 'P02', name: 'q' }], entries: [card, old], changes: [] }
    const [summary] = summarizeRounds(program)
    expect(summary).toMatchObject({ avgTotalV2: 83.5, passV1: { passed: 2, judged: 2 }, passV2: { passed: 1, judged: 1 } })
    const rows = itemRows(program) as Array<{ key: string; byRound: Record<string, number> }>
    expect(rows.find((r) => r.key === 'r9')!.byRound.R9).toBe(4)
    expect(rows.find((r) => r.key === 'r10')!.byRound.R9).toBe(3)
  })
})

describe('r11 대상 적합 — 기록만(점수·총점·합격선 밖)', () => {
  const meta = { product: 'P02', round: 'R10', jobId: 'job', label: 'XK7P' }
  const withAudience = (j: JudgeResult, r11: number): JudgeResult => ({ ...j, items: { ...j.items, r11: { score: r11, reason: '이유' } } })

  it('매긴 심사위원의 점수와 평균을 남기고, 없으면 null', () => {
    expect(audienceFit({ claude: withAudience(judgeV2(4, 4, 4), 5), codex: withAudience(judgeV2(4, 4, 4), 2) })).toEqual({
      mean: 3.5,
      scores: { claude: 5, codex: 2 },
    })
    expect(audienceFit({ claude: withAudience(judgeV2(4, 4, 4), 4), codex: judgeV2(4, 4, 4) })).toEqual({ mean: 4, scores: { claude: 4 } })
    expect(audienceFit({ claude: judgeV2(4, 4, 4), codex: judgeV2(4, 4, 4) })).toBeNull()
  })

  it('r11이 1이든 5든 심사 점수·v2 총점·합격선이 같다', () => {
    const low = buildScorecard(meta, measurement(), { claude: withAudience(judgeV2(5, 5, 5), 1), codex: withAudience(judgeV2(5, 5, 5), 1) })
    const high = buildScorecard(meta, measurement(), { claude: withAudience(judgeV2(5, 5, 5), 5), codex: withAudience(judgeV2(5, 5, 5), 5) })
    const none = buildScorecard(meta, measurement(), { claude: judgeV2(5, 5, 5), codex: judgeV2(5, 5, 5) })
    for (const card of [low, high]) {
      expect(card.judgeScore).toBe(none.judgeScore)
      expect(card.total).toBe(none.total)
      expect(card.v2).toEqual(none.v2)
      expect(card.pass).toEqual(none.pass)
      expect(card.disagreements).toEqual(none.disagreements)
    }
    expect(low.audience).toEqual({ mean: 1, scores: { claude: 1, codex: 1 } })
    expect(none.audience).toBeNull()
  })
})
