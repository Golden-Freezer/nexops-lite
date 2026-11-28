/**
 * 후기 속 실제 질문(reviewfaq) — 산출 검사(원문 대조·완결된 말·평점·규제·숫자), 표 앞줄, 설계 기록, 스위치 범위. 결정론(LLM 없음).
 * 시험 후기는 지어낸 글이다(실제 후기를 리포에 옮기지 않는다).
 */

import { describe, expect, it } from 'vitest'
import { resolveEnabledFeatures } from '../enrichment-switch'
import {
  decideLongSections,
  FAQ_MAX_ROWS,
  longTables,
  readLongRecord,
  REVIEW_ANSWER_SOURCE,
} from '../long-sections'
import { withReviewFaq, type DesignSkeletonDecision } from '../pdp-enrichment-stage'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import {
  hasReviewFaqMaterial,
  isDrawbackAnswer,
  REVIEW_FAQ_MAX_ITEMS,
  validateReviewFaq,
  type ReviewFaqItem,
} from './review-faq'

const REVIEWS = [
  '리뷰 전체: 4건 (텍스트 리뷰 4건)',
  '[리뷰1] 평점 5/5 · 도움 3 · 작성 2026.10',
  '내용: 바닥이 미끄러울까 걱정했는데 무거워서 밀리지 않아요. 색도 예뻐요.',
  '[리뷰2] 평점 5/5 · 도움 0',
  '내용: 설거지가 번거로울까 고민했는데 그릇이 분리돼서 씻기 편해요.',
  '[리뷰3] 평점 2/5 · 도움 0',
  '내용: 크기가 작을까 싶었는데 역시 너무 작아서 아쉬워요.',
  '[리뷰4] 평점 5/5 · 도움 0',
  '내용: 탈모가 심할까 걱정했는데 탈모가 나아진 느낌이에요.',
  '[리뷰5] 평점 5/5 · 도움 0',
  '내용: 뚜껑이 헐거울까 걱정했는데 뚜껑이 꼭 맞아서 좋아요.',
  '[리뷰6] 평점 4/5 · 도움 0',
  '내용: 색이 다를까 고민했는데 사진과 똑같아서 좋아요.',
].join('\n')

const SPEC = { productName: '시험 그릇', size: '가로 10cm' } as PdpSpecSheet
const GOOD = { worry: '바닥이 미끄러울까 걱정했는데', question: '바닥에서 밀리지 않나요?', answer: '무거워서 밀리지 않아요.' }
const GOOD2 = { worry: '설거지가 번거로울까 고민했는데', question: '설거지가 번거롭지 않나요?', answer: '그릇이 분리돼서 씻기 편해요.' }
const GOOD3 = { worry: '뚜껑이 헐거울까 걱정했는데', question: '뚜껑이 헐겁지 않나요?', answer: '뚜껑이 꼭 맞아서 좋아요.' }
const GOOD4 = { worry: '색이 다를까 고민했는데', question: '색이 사진과 같나요?', answer: '사진과 똑같아서 좋아요.' }

describe('산출 검사 — 실제 후기로 확인되는 것만', () => {
  it('걱정·답이 원문 그대로면 질문과 답만 남기고 걱정은 싣지 않는다', () => {
    expect(validateReviewFaq([GOOD, GOOD2], REVIEWS, SPEC)).toEqual({
      items: [
        { question: GOOD.question, answer: GOOD.answer },
        { question: GOOD2.question, answer: GOOD2.answer },
      ],
      dropped: 0,
    })
  })

  it.each([
    ['답이 원문에 없다', { ...GOOD, answer: '전혀 밀리지 않고 아주 튼튼해요.' }],
    ['걱정이 원문에 없다(지어낸 질문)', { ...GOOD, worry: '강아지가 잘 먹을지 걱정했는데' }],
    ['말이 끝나지 않은 답', { ...GOOD, answer: '바닥이 미끄러울까 걱정했는데 무거워서' }],
    ['낱말 가운데서 시작한 답', { ...GOOD, answer: '거워서 밀리지 않아요.' }],
    ['물음표가 없는 질문', { ...GOOD, question: '바닥에서 밀리지 않아요' }],
    ['너무 긴 질문', { ...GOOD, question: `${'아주 '.repeat(12)}밀리지 않나요?` }],
    ['규제 표현이 든 질문', { ...GOOD, question: '탈모가 나아지나요?' }],
    ['규제 표현이 든 답', { worry: '탈모가 심할까 걱정했는데', question: '두피에 괜찮나요?', answer: '탈모가 나아진 느낌이에요.' }],
    ['입력에 없는 숫자를 지어낸 질문', { ...GOOD, question: '바닥에서 3kg까지 버티나요?' }],
    ['불만 후기(평점 2)의 답', { ...GOOD, answer: '역시 너무 작아서 아쉬워요.' }],
    ['불만 후기(평점 2)를 걱정으로 삼아 좋은 후기로 덮음', { ...GOOD, worry: '크기가 작을까 싶었는데', question: '크기가 작지 않나요?' }],
    ['객체가 아니다', 'string'],
  ])('뺀다: %s', (_name, raw) => {
    expect(validateReviewFaq([raw], REVIEWS, SPEC)).toEqual({ items: [], dropped: 1 })
  })

  it('후기 원문이어도 트러블이 없어졌다는 답과 트러블 관리를 묻는 질문은 뺀다, 생기지 않았다는 경험은 남긴다(R17 P03, 지어낸 글)', () => {
    const reviews = [
      '리뷰 전체: 2건 (텍스트 리뷰 2건)',
      '[리뷰1] 평점 5/5 · 도움 0',
      '내용: 피부가 예민할까 걱정했는데 쓰고 나서 피부트러블이 사라졌어요.',
      '[리뷰2] 평점 5/5 · 도움 0',
      '내용: 자극이 있을까 걱정했는데 트러블 없이 잘 쓰고 있어요.',
    ].join('\n')
    const worry = '피부가 예민할까 걱정했는데'
    const safe = { worry: '자극이 있을까 걱정했는데', question: '피부에 자극은 없나요?', answer: '트러블 없이 잘 쓰고 있어요.' }
    expect(validateReviewFaq([{ worry, question: '피부가 예민해도 괜찮나요?', answer: '쓰고 나서 피부트러블이 사라졌어요.' }], reviews, SPEC)).toEqual({ items: [], dropped: 1 })
    expect(validateReviewFaq([{ ...safe, question: '피부 트러블 관리에 도움이 되나요?' }], reviews, SPEC)).toEqual({ items: [], dropped: 1 })
    expect(validateReviewFaq([safe], reviews, SPEC)).toEqual({ items: [{ question: safe.question, answer: safe.answer }], dropped: 0 })
  })

  it('연령 제한 잡(만 14세 이상)은 어린이 표현이 든 질문·답을 뺀다 — 제한 없는 잡은 그대로(결정 카드 c03, 지어낸 글)', () => {
    const reviews = ['리뷰 전체: 1건 (텍스트 리뷰 1건)', '[리뷰1] 평점 5/5 · 도움 0', '내용: 무거울까 걱정했는데 아이도 혼자 들 만큼 가벼워요.'].join('\n')
    const kid = { worry: '무거울까 걱정했는데', question: '들기에 무겁지 않나요?', answer: '아이도 혼자 들 만큼 가벼워요.' }
    expect(validateReviewFaq([kid], reviews, { ...SPEC, minAgeYears: 14 })).toEqual({ items: [], dropped: 1 })
    expect(validateReviewFaq([{ ...GOOD, question: '키즈 방에서도 밀리지 않나요?' }], REVIEWS, { ...SPEC, minAgeYears: 14 })).toEqual({ items: [], dropped: 1 })
    expect(validateReviewFaq([GOOD], REVIEWS, { ...SPEC, minAgeYears: 14 }).items).toHaveLength(1)
    expect(validateReviewFaq([kid], reviews, SPEC).items).toEqual([{ question: kid.question, answer: kid.answer }])
  })

  it('같은 질문·같은 답은 한 번, 상한을 넘으면 뒤 항목은 뺀 수로 센다', () => {
    const dup = validateReviewFaq([GOOD, { ...GOOD2, question: GOOD.question }, { ...GOOD2, answer: GOOD.answer }], REVIEWS, SPEC)
    expect(dup.items).toHaveLength(1)
    expect(dup.dropped).toBe(2)
    const capped = validateReviewFaq([GOOD, GOOD2, GOOD3, GOOD4], REVIEWS, SPEC)
    expect(capped.items.map((i) => i.question)).toEqual([GOOD, GOOD2, GOOD3].slice(0, REVIEW_FAQ_MAX_ITEMS).map((i) => i.question))
    expect(capped.dropped).toBe(1)
  })

  it('평점을 알 수 없는 붙여 넣은 원문은 평점으로 빼지 않는다(글 맨 앞의 답도 낱말 첫머리다)', () => {
    const pasted = '무거워서 밀리지 않아요. 바닥이 미끄러울까 걱정했는데 잘 샀어요.'
    expect(validateReviewFaq([GOOD], pasted, SPEC).items).toHaveLength(1)
  })

  it('부를 재료: 글 후기 3건 이상, 붙여 넣은 원문은 글이 있으면', () => {
    expect(hasReviewFaqMaterial(undefined)).toBe(false)
    expect(hasReviewFaqMaterial('   ')).toBe(false)
    expect(hasReviewFaqMaterial(REVIEWS)).toBe(true)
    expect(hasReviewFaqMaterial('[리뷰1] 평점 5/5 · 도움 0\n내용: 좋아요 정말 좋아요')).toBe(false)
    expect(hasReviewFaqMaterial('좋아요 정말 좋아요')).toBe(true)
  })
})

describe('답이 아쉬움·불만·단점을 말하면 뺀다(K4 P01 — 평점 높은 후기 안의 아쉬운 문장, 지어낸 글)', () => {
  it.each([
    ['아쉬움', '뚜껑이 조금 약해서 아쉬워요.'],
    ['불편', '손잡이가 불편해요.'],
    ['별로', '색은 별로예요.'],
    ['어렵다', '조립이 어려워요.'],
    ['단점', '단점은 좀 무겁다는 거예요.'],
    ['바라는 점', '조금 더 컸으면 좋겠어요.'],
    ['바라는 점(더 좋을)', '받침이 있으면 더 좋을 것 같아요.'],
    ['지금 아쉬운 점 뒤의 칭찬', '가격은 아쉬운데 색은 예뻐요.'],
    ['구매를 막는 말', '기대 이하예요.'],
  ])('단점으로 본다: %s', (_name, answer) => {
    expect(isDrawbackAnswer(answer)).toBe(true)
  })

  it.each([
    ['부정(않)', '전혀 불편하지 않아요.'],
    ['부정(없)', '단점이 없어요.'],
    ['부정(못)', '단점은 못 느꼈어요.'],
    ['부정(아니)', '여닫기 어려운 정도는 아니에요.'],
    ['부정(뒤에 않)', '별로 무겁지 않아요.'],
    ['앞에 안', '안 힘들어요.'],
    ['기대', '어려울 줄 알았는데 쉬워요.'],
    ['지난 일이 풀림', '설거지가 힘들었는데 이건 쉬워요.'],
    ['지난 일이 풀림(던데)', '조립이 어렵던데 이건 간단해요.'],
    ['낱말 가운데 약', '예약해서 받았는데 좋아요.'],
    ['보통 답', '무거워서 밀리지 않아요.'],
  ])('단점으로 보지 않는다: %s', (_name, answer) => {
    expect(isDrawbackAnswer(answer)).toBe(false)
  })

  it('평점 5점 후기 안의 아쉬운 문장은 답에서 빠지고, 같은 후기의 걱정을 푼 문장은 남는다', () => {
    const reviews = [
      '리뷰 전체: 1건 (텍스트 리뷰 1건)',
      '[리뷰1] 평점 5/5 · 도움 0',
      '내용: 뚜껑이 헐거울까 걱정했는데 뚜껑이 꼭 맞아서 흔들리지 않아요. 다만 손잡이가 조금 약해서 아쉬워요.',
    ].join('\n')
    const worry = '뚜껑이 헐거울까 걱정했는데'
    const question = '뚜껑이 헐겁지 않나요?'
    const bad = { worry, question, answer: '다만 손잡이가 조금 약해서 아쉬워요.' }
    const good = { worry, question, answer: '뚜껑이 꼭 맞아서 흔들리지 않아요.' }
    expect(validateReviewFaq([bad], reviews, SPEC)).toEqual({ items: [], dropped: 1 })
    expect(validateReviewFaq([bad, good], reviews, SPEC)).toEqual({ items: [{ question, answer: good.answer }], dropped: 1 })
  })

  it('기존 정상 답은 그대로 남는다(전후 같음)', () => {
    expect(validateReviewFaq([GOOD, GOOD2, GOOD3], REVIEWS, SPEC).items).toHaveLength(3)
  })
})

const FAQ_SPEC = { size: '가로 10cm', material: '도자기', usageLocation: '거실', certificationInfo: 'KC' }
const OBJECTIONS = [{ objection: '크기가 궁금' }, { objection: '소재가 궁금' }, { objection: '어디서 쓰기 좋을지' }]
const ITEMS: ReviewFaqItem[] = [
  { question: GOOD.question, answer: GOOD.answer },
  { question: GOOD2.question, answer: GOOD2.answer },
]

describe('구매 전 질문 표 — 후기 질문이 앞줄', () => {
  it('없으면 예전과 같고, 있으면 앞줄이며 답에 후기임을 밝힌다', () => {
    const before = longTables(['faq'], FAQ_SPEC, OBJECTIONS, [], false)
    expect(longTables(['faq'], FAQ_SPEC, OBJECTIONS, [], false, [])).toEqual(before)
    const [table] = longTables(['faq'], FAQ_SPEC, OBJECTIONS, [], false, ITEMS)
    expect(table.rows[0]).toEqual({
      label: `Q. ${GOOD.question}`,
      value: `A. "${GOOD.answer}" — ${REVIEW_ANSWER_SOURCE}`,
      items: [GOOD.answer],
    })
    expect(table.rows[1].label).toBe(`Q. ${GOOD2.question}`)
    expect(table.rows.slice(2)).toEqual(before[0].rows)
  })

  it('페이지에 이미 보이는 답은 뺀다(후기 카드와 겹침), 표는 상한까지만', () => {
    const [shown] = longTables(['faq'], FAQ_SPEC, OBJECTIONS, [GOOD.answer], false, ITEMS)
    expect(shown.rows.map((r) => r.label)).not.toContain(`Q. ${GOOD.question}`)
    const spec = { ...FAQ_SPEC, extraSpecs: [{ key: '구성품', value: '그릇 2개' }, { key: '세척 방법', value: '물로 씻어요' }] }
    const objections = [...OBJECTIONS, { objection: '세척 관리가 궁금' }, { objection: '인증 안전이 궁금' }]
    const three = [...ITEMS, { question: '색이 사진과 같나요?', answer: '색도 예뻐요.' }]
    const [capped] = longTables(['faq'], spec, objections, [], false, three)
    expect(capped.rows.length).toBe(FAQ_MAX_ROWS)
    expect(capped.rows.slice(0, 3).map((r) => r.label)).toEqual(three.map((i) => `Q. ${i.question}`))
  })

  it('기록: 고정 질문만으로 모자란 잡도 후기 질문으로 표가 서고, 읽기를 거쳐도 같다', () => {
    const none = decideLongSections({}, [])
    expect(none.kinds).not.toContain('faq')
    expect(none).not.toHaveProperty('reviewFaq')
    expect(none).not.toHaveProperty('reviewFaqStats')
    const stats = { kept: 2, dropped: 1 }
    const record = decideLongSections({}, [], ITEMS, stats)
    expect(record.kinds).toContain('faq')
    expect(readLongRecord(JSON.parse(JSON.stringify(record)))).toEqual(record)
    // 답이 하나면 최소 행 수(2)에 못 미친다
    expect(decideLongSections({}, [], ITEMS.slice(0, 1)).kinds).not.toContain('faq')
    // 형식이 깨진 항목은 버린다
    const broken = readLongRecord({ ...record, reviewFaq: [{ question: '물음?' }, null, ITEMS[0]] })
    expect(broken?.reviewFaq).toEqual([ITEMS[0]])
  })
})

describe('설계 단계 연결', () => {
  const decision = {
    skeleton: null,
    persuasion: { objectionCoverage: [] },
    groundingBlock: '',
    enrichment: null,
    long: decideLongSections({}, []),
  } as unknown as DesignSkeletonDecision
  const job = { spec_sheet: {} } as PdpJobRow
  const faq = { items: ITEMS, stats: { kept: 2, dropped: 0 } }

  it('콜 결과가 있으면 판정에 넣어 기록하고, 없으면 결정을 그대로 둔다', () => {
    const merged = withReviewFaq(job, decision, faq)
    expect(merged.long?.reviewFaq).toEqual(ITEMS)
    expect(merged.long?.reviewFaqStats).toEqual(faq.stats)
    expect(merged.long?.kinds).toContain('faq')
    expect(withReviewFaq(job, decision, null)).toBe(decision)
    const noLong = { ...decision, long: undefined }
    expect(withReviewFaq(job, noLong, faq)).toBe(noLong)
  })
})

describe('스위치 범위', () => {
  it('기본 on(K4 운영 전환), designlong과 함께 켜질 때만 기록한다', () => {
    expect(resolveEnabledFeatures({})).toContain('reviewfaq')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('reviewfaq')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designlong' })).not.toContain('reviewfaq')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('reviewfaq')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'designlong' })).toContain('reviewfaq')
  })
})
