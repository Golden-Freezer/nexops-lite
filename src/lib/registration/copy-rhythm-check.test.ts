/**
 * 카피 리듬 검사(rhythm, 오너 지시 10-31) — 제목 칸의 긴 줄·어색한 줄바꿈, 본문 칸의 긴 문장·많은 문장을 결정론으로 센다.
 * 순수 함수 시험(호출 0).
 */

import { describe, expect, it } from 'vitest'
import {
  BODY_SENTENCE_COUNT_MAX,
  buildRhythmFixBlock,
  copyRhythmCounts,
  copyRhythmRecord,
  findCopyRhythmIssues,
  HEAD_LINE_MAX,
  RHYTHM_FIX_LIMITS,
  RHYTHM_WRITE_BLOCK,
} from './copy-rhythm-check'
import type { CopywritingResult } from './pdp-state'

const issues = (copy: CopywritingResult) => findCopyRhythmIssues(copy)

describe('제목 칸 — 한 줄이 길면 센다(두 줄이면 의미 단위 \\n)', () => {
  it(`한 줄 ${HEAD_LINE_MAX}자를 넘는 제목은 걸리고, 의미 단위에서 끊은 제목은 걸리지 않는다`, () => {
    const long = issues({ mainIntro: { benefitHeadline: '끈만 당기면 포장이 끝나는 답례 파우치' } })
    expect(long.headLong).toEqual([{ path: 'mainIntro.benefitHeadline', text: '끈만 당기면 포장이 끝나는 답례 파우치', detail: '21자' }])
    expect(issues({ mainIntro: { benefitHeadline: '끈만 당기면\n포장 끝' } }).headLong).toEqual([])
  })

  it('카드 제목·주장·Pro 카피 제목·마무리·핵심 메시지도 제목 칸이다 — 본문 칸은 줄 길이로 세지 않는다', () => {
    const long = '하나씩 나눠 담아 반 친구 몫까지 한 번에'
    const f = issues({
      pointCards: [{ title: long, description: long }],
      detailPoints: [{ claim: long, proof: long }],
      directionHint: { headline: long, subCopy: long },
      closingCta: { headline: long, subtext: long },
      keyMessageVariations: { top: long },
    })
    expect(f.headLong.map((r) => r.path)).toEqual([
      'pointCards[0].title',
      'detailPoints[0].claim',
      'directionHint.headline',
      'closingCta.headline',
      'keyMessageVariations.top',
    ])
    expect(f.headFields).toBe(5)
    expect(f.bodyFields).toBe(4)
  })
})

describe('어색한 줄바꿈 — 조사·어미(또는 한두 글자)만 다음 줄로', () => {
  it("'포장\\n을 끝내요'·한 글자만 남은 줄은 걸리고, 의미 단위에서 끊은 줄·지시어 '이'로 여는 줄은 걸리지 않는다", () => {
    const f = issues({
      mainIntro: { hook: '끈만 당기면 포장\n을 끝내요', benefitHeadline: '반 친구 몫까지\n끝', subBenefit: '오늘부터\n이 파우치 하나로 준비해요' },
      pointCards: [{ title: '끈만 당기면\n포장 끝', description: '리본 없이\n입구를 모아요' }],
    })
    expect(f.badBreaks.map((r) => r.path)).toEqual(['mainIntro.hook', 'mainIntro.benefitHeadline'])
  })
})

describe('본문 칸 — 긴 문장·많은 문장', () => {
  it('40자를 넘는 문장은 긴 문장으로 세고 그 문장을 남긴다', () => {
    const sentence = '끈을 당기기만 하면 입구가 모여서 리본을 묶지 않아도 반 친구 몫 답례품 포장을 한 번에 끝낼 수 있어요.'
    const f = issues({ pointCards: [{ title: '끈만 당기면', description: `${sentence} 비쳐서 예뻐요.` }] })
    expect(f.longSentences).toEqual([{ path: 'pointCards[0].description', text: `${sentence} 비쳐서 예뻐요.`, detail: sentence }])
  })

  it(`문장이 ${BODY_SENTENCE_COUNT_MAX}개를 넘는 본문은 걸린다 — 줄바꿈도 문장 경계로 본다`, () => {
    const f = issues({
      detailPoints: [
        { claim: '끈 당겨 마감', proof: '끈을 당겨요. 입구가 모여요.\n리본이 필요 없어요. 바로 건네요.', benefit: '포장이 빨라요. 손이 덜 가요.' },
      ],
    })
    expect(f.crowded).toEqual([
      { path: 'detailPoints[0].proof', text: '끈을 당겨요. 입구가 모여요.\n리본이 필요 없어요. 바로 건네요.', detail: '4문장' },
    ])
  })

  it('목록 칸이 배열이 아니거나 칸이 객체가 아니어도 던지지 않는다(측정용 — 카피 단계를 멈추지 않게)', () => {
    const odd = { pointCards: '배열 아님', detailPoints: { 0: '객체' }, howTo: null, mainIntro: '문자열' } as unknown as CopywritingResult
    expect(() => issues(odd)).not.toThrow()
    expect(copyRhythmCounts(issues(odd))).toMatchObject({ head_fields: 0, body_fields: 0 })
  })
})

describe('기록과 프롬프트 블록', () => {
  const copy: CopywritingResult = {
    mainIntro: { benefitHeadline: '끈만 당기면 포장이 끝나는 답례 파우치', hook: '반 친구 몫까지\n끝' },
    pointCards: [{ title: '끈만 당기면', description: '끈을 당겨요. 입구가 모여요. 리본이 필요 없어요. 바로 건네요.' }],
  }

  it('수는 종류마다(본 칸 수 포함), before는 Stage 2 산출, fix는 rhythm 잡 — 예시는 위치만', () => {
    const f = issues(copy)
    expect(copyRhythmCounts(f)).toEqual({ head_fields: 3, body_fields: 1, head_long: 1, bad_breaks: 1, long_sentences: 0, crowded: 1 })
    expect(copyRhythmRecord(f)).toEqual({
      version: 1,
      counts: copyRhythmCounts(f),
      examples: { head_long: ['mainIntro.benefitHeadline'], bad_breaks: ['mainIntro.hook'], long_sentences: [], crowded: ['pointCards[0].description'] },
    })
    const recorded = copyRhythmRecord(f, f, true)
    expect(recorded.before).toEqual(copyRhythmCounts(f))
    expect(recorded.fix).toBe(true)
  })

  it('고칠 곳 블록 — 걸린 것이 없으면 빈 문자열, 있으면 종류별 줄과 규칙(내용은 그대로 두고 문장 모양만)', () => {
    expect(buildRhythmFixBlock(issues({ mainIntro: { benefitHeadline: '끈만 당기면\n포장 끝' } }))).toBe('')
    const block = buildRhythmFixBlock(issues(copy))
    expect(block.startsWith('## [리듬 — 고칠 곳(결정론 검사)]')).toBe(true)
    expect(block).toContain("- 긴 제목: [mainIntro.benefitHeadline] '끈만 당기면 포장이 끝나는 답례 파우치' — 한 줄 21자")
    expect(block).toContain("- 어색한 줄바꿈: [mainIntro.hook] '반 친구 몫까지⏎끝'")
    expect(block).toContain('- 문장이 많은 본문: [pointCards[0].description] — 4문장')
    expect(block).toContain('내용(사실·수치·효익)은 그대로 두고 문장 모양만 바꾼다')
    expect(block).toContain('_changed_fields')
  })

  it('종류마다 상한까지만 넘긴다', () => {
    const many: CopywritingResult = { pointCards: Array.from({ length: 8 }, () => ({ title: '하나씩 나눠 담아 반 친구 몫까지 한 번에' })) }
    const lines = buildRhythmFixBlock(issues(many)).split('\n').filter((l) => l.startsWith('- 긴 제목'))
    expect(lines).toHaveLength(RHYTHM_FIX_LIMITS.headLong)
  })

  it('Stage 2 쓰기 지시 — 섹션마다 한 가지·짧은 제목과 의미 단위 줄바꿈·한 문장 한 정보', () => {
    expect(RHYTHM_WRITE_BLOCK.startsWith('## [리듬 — 짧은 문장·의미 단위 줄바꿈]')).toBe(true)
    expect(RHYTHM_WRITE_BLOCK).toContain("섹션마다 '이 섹션이 알려 줄 한 가지'를 먼저 정하고")
    expect(RHYTHM_WRITE_BLOCK).toContain(`한 줄 12~${HEAD_LINE_MAX}자 안팎`)
    expect(RHYTHM_WRITE_BLOCK).toContain('조사·어미만 다음 줄로 넘기지 않는다')
    expect(RHYTHM_WRITE_BLOCK).toContain('본문은 한 문장에 한 정보로 쓴다')
    expect(RHYTHM_WRITE_BLOCK).toContain('usageSceneTags는 사진 제목으로도 나온다')
  })
})
