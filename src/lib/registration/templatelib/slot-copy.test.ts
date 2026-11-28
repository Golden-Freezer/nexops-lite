/**
 * K 라인 슬롯 카피 검사 — 칸 뽑기, 읽기, 상한·규제·숫자, 지우기, 사실 칸 맞추기. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import type { PdpSpecSheet } from '../pdp-state'
import { TEMPLATES } from './library'
import { tpl } from './selection.fixture'
import { asksFix, checkCopyValues, copySlotsOf, dropProblemValues, dropsText, fitToFactSlots, hookCopyLimits, readCopyValues, requiredCopyFilled, sectionText, type CopySlot, type CopyValues } from './slot-copy'
import { TAG_MAX_CHARS } from './slots'
import type { MetaSlot } from './template-meta'

const text = (over: Partial<Extract<MetaSlot, { type: 'text' }>> = {}): MetaSlot => ({ type: 'text', required: false, source: 'copy', facts: 1, maxChars: 10, maxLines: 2, ...over })
const spec = { material: '면', size: '10cm' } as unknown as PdpSpecSheet

const template = tpl('a.b', {
  slots: {
    headline: text({ required: true, maxChars: 8 }),
    sub: text(),
    rating: text({ source: 'input', required: true }),
    photo: { type: 'image', required: true, purpose: ['scene'], composition: ['front'] },
    steps: {
      type: 'list',
      required: true,
      min: 2,
      max: 3,
      fields: {
        title: { type: 'text', required: true, source: 'copy', facts: 1, maxChars: 6 },
        note: { type: 'text', required: false, source: 'copy', facts: 0 },
        count: { type: 'text', required: false, source: 'input', facts: 1 },
      },
    },
    rows: { type: 'list', required: true, source: 'input', min: 1, max: 7, fields: { value: { type: 'text', required: true, source: 'input', facts: 1 } } },
    inputOnly: { type: 'list', required: false, min: 1, max: 2, fields: { value: { type: 'text', required: true, source: 'input', facts: 1 } } },
    inputList: { type: 'list', required: false, source: 'input', min: 1, max: 2, fields: { note: { type: 'text', required: false, source: 'copy', facts: 0 } } },
  },
})
const slots = copySlotsOf(template)

describe('칸 뽑기', () => {
  it('카피 칸만 — 입력값 칸·사진 칸·입력값만 있는 목록은 뺀다', () => {
    expect(slots.map((s) => s.name)).toEqual(['headline', 'sub', 'steps'])
    expect(slots[0]).toEqual({ name: 'headline', required: true, facts: 1, maxChars: 8, maxLines: 2 })
    expect(slots[2].list).toEqual({
      min: 2,
      max: 3,
      fields: [
        { name: 'title', required: true, facts: 1, maxChars: 6 },
        { name: 'note', required: false, facts: 0 },
      ],
    })
    expect(slots[2].facts).toBe(1)
  })
})

describe('이름표 칸', () => {
  const tagged = tpl('petit_div.a', {
    slots: {
      tags: { type: 'list', required: false, min: 1, max: 3, fields: {} },
      shots: { type: 'list', required: true, min: 2, max: 2, fields: { photo: { type: 'image', required: true, purpose: ['scene'], composition: ['front'] } } },
    },
  })
  const tagSlots = copySlotsOf(tagged)

  it('항목 칸 없는 목록만 이름표로 뽑고, 사진만 있는 목록은 뺀다', () => {
    expect(tagSlots).toEqual([{ name: 'tags', required: false, facts: 0, maxChars: TAG_MAX_CHARS, tags: { min: 1, max: 3 } }])
  })

  it('낱말 앞에 # 하나로 맞추고, 빈 값·겹침을 버리고, 상한까지만 받는다', () => {
    expect(readCopyValues(tagSlots, { tags: ['자취 생', '##집들이', ' #자취생 ', '', 3, '선물', '캠핑'] })).toEqual({ tags: ['#자취생', '#집들이', '#선물'] })
    expect(readCopyValues(tagSlots, { tags: 'x' })).toEqual({})
    expect(readCopyValues(tagSlots, { tags: ['#', '  '] })).toEqual({})
  })

  it('한 개씩 검사하고, 걸린 것만 지운다 — 지우는 중에 번호가 밀리지 않는다', () => {
    const long = `#${'가'.repeat(TAG_MAX_CHARS)}`
    const value: CopyValues = { tags: [long, '#KC인증완료', '#자취생', '#25cm'] }
    const problems = checkCopyValues(tagSlots, value, spec)
    expect(problems.map((p) => [p.slot, p.kind])).toEqual([
      ['tags.0', 'length'],
      ['tags.1', 'claim'],
      ['tags.3', 'number'],
    ])
    expect(dropProblemValues(value, problems)).toEqual({ tags: ['#자취생'] })
  })

  it('모두 걸리면 칸을 지워 엔진이 그리지 않는다', () => {
    const value: CopyValues = { tags: ['#KC인증완료'] }
    expect(dropProblemValues(value, checkCopyValues(tagSlots, value, spec))).toEqual({})
  })

  it('필수 이름표가 비면 빠진 칸이고, 항목 목록과 함께 있어도 서로 섞이지 않는다', () => {
    const required = copySlotsOf(tpl('a.b', { slots: { tags: { type: 'list', required: true, min: 2, max: 3, fields: {} } } }))
    expect(checkCopyValues(required, { tags: ['#자취생'] }, spec)).toEqual([{ slot: 'tags', kind: 'missing', detail: '항목 2개 이상' }])
    const both: CopyValues = { tags: ['#자취생'], steps: [{ title: '하나' }, { title: '둘' }] }
    expect(sectionText([...tagSlots, ...slots], both)).toBe('#자취생 하나 둘')
  })

  it('사실 예산을 쓰지 않아 사실 칸 0개에서도 남는다', () => {
    expect(fitToFactSlots(tagSlots, { tags: ['#자취생', '#선물'] }, 0)).toEqual({ tags: ['#자취생', '#선물'] })
  })

  it('라이브러리의 이름표 칸은 정해진 7개고 카피 칸으로 나온다', () => {
    const owners = TEMPLATES.filter((t) => Object.values(t.slots).some((s) => s.type === 'list' && s.source !== 'input' && Object.keys(s.fields).length === 0))
    expect(owners.map((t) => t.id).sort()).toEqual([
      // 제목 아래 낱말 칩 줄(적용 K1 R-W10)
      'concept_desc.title-chips',
      'cta.beauty-photo-tags',
      'direction_suggest.fashion-title-mosaic-tags',
      'petit_div.hashtag-grid',
      'point_div.beauty-proof-tags',
      'point_div.fashion-stagger-tags',
      'sub_div.title-chips',
    ])
    for (const owner of owners) expect(copySlotsOf(owner).map((s) => s.name), owner.id).toContain('tags')
  })
})

describe('목록 항목 안 필수 칸', () => {
  const rows: CopySlot[] = [{ name: 'rows', required: true, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'from', required: true, facts: 0 }, { name: 'to', required: true, facts: 1 }, { name: 'note', required: false, facts: 0 }] } }]
  const missing = (value: CopyValues) => checkCopyValues(rows, value, spec).filter((p) => p.kind === 'missing').length

  it('필수 칸이 빠진 항목은 세지 않는다', () => {
    expect(missing({ rows: [{ from: '가', to: '나' }, { from: '다', to: '라' }] })).toBe(0)
    expect(missing({ rows: [{ from: '가' }, { from: '다' }] })).toBe(1)
    expect(missing({ rows: [{ to: '나' }, { to: '라' }] })).toBe(1)
    expect(missing({ rows: [{ from: '가', to: '나' }, { from: '다' }] })).toBe(1)
  })

  it('선택 칸이 빠져도 항목은 온전하다', () => {
    expect(missing({ rows: [{ from: '가', to: '나' }, { from: '다', to: '라', note: '마' }] })).toBe(0)
  })

  it('선택 목록은 항목이 모자라도 빠진 칸이 아니다', () => {
    const optional: CopySlot[] = [{ ...rows[0], required: false }]
    expect(checkCopyValues(optional, { rows: [{ from: '가' }] }, spec).filter((p) => p.kind === 'missing')).toEqual([])
  })
})

describe("'이런 고민' 문구(오너 지시 11-01)", () => {
  const slot: CopySlot[] = [{ name: 'headline', required: true, facts: 0, maxChars: 40 }]

  it.each(['이런 고민 있으세요?', '이런고민 해보셨나요'])('%s는 고칠 곳으로 잡고, 못 고치면 지운다', (value) => {
    const problems = checkCopyValues(slot, { headline: value }, spec)
    expect(problems).toEqual([{ slot: 'headline', kind: 'phrase', detail: value }])
    expect(dropProblemValues({ headline: value }, problems)).toEqual({})
  })

  it('고민이라는 낱말만으로는 잡지 않는다', () => {
    expect(checkCopyValues(slot, { headline: '정리 고민, 끝낼 때예요' }, spec)).toEqual([])
  })
})

describe('다른 상품 언급', () => {
  const slot: CopySlot[] = [{ name: 'to', required: false, facts: 1, maxChars: 40 }]

  it.each(['일반', '일반 제품은 금방 망가져요', '일반 브러시는 아파요', '기존 옷걸이는 휘어요', '타사 대비 튼튼해요', '시중 제품과 달라요', '경쟁 상품보다 좋아요', '다른 제품은 못 해요', '다른 거 필요 없어요', '저가 제품과 달라요', '싸구려와 달라요', '보통 제품보다 커요'])('%s — 막는다', (value) => {
    expect(checkCopyValues(slot, { to: value }, spec)).toEqual([{ slot: 'to', kind: 'compare', detail: value }])
  })

  it.each(['엉키지 않아요', '손이 편해요', '이전', '이후', '가방 속에서 엉켜서 불편했어요', '금방 끝나요', '일반 세탁 가능해요', '일반적으로 쓰기 좋아요', '다른 색도 있어요', '최저가로 만나요', '남들과 다른 하루'])('%s — 체감 효익·장면은 막지 않는다', (value) => {
    expect(checkCopyValues(slot, { to: value }, spec)).toEqual([])
  })

  it('걸린 글은 고치기 뒤에도 남으면 지운다 — 목록 항목은 그 칸만', () => {
    const rows: CopySlot[] = [{ name: 'rows', required: true, facts: 1, list: { min: 1, max: 3, fields: [{ name: 'from', required: true, facts: 0 }, { name: 'to', required: true, facts: 1 }] } }]
    const value: CopyValues = { rows: [{ from: '일반 제품은 약해요', to: '오래 써요' }] }
    expect(dropProblemValues(value, checkCopyValues(rows, value, spec))).toEqual({ rows: [{ to: '오래 써요' }] })
  })
})

describe('첫 화면 상한', () => {
  const hook = tpl('hook_3step.a', {
    section: 'hook_3step',
    slots: {
      count: text({ maxChars: 4, maxLines: 1 }),
      headline: text({ required: true, maxChars: 99, maxLines: 5 }),
      sub: text({ maxChars: 99, maxLines: 3 }),
    },
  })
  const hookSlots = copySlotsOf(hook)
  const { headline, sub } = hookCopyLimits()
  const field = (name: string) => hookSlots.find((s) => s.name === name)!

  it('큰 제목 2줄·보조 1줄, 글자 수는 토큰에서 구한다 — 템플릿 상한이 커도 씌운다', () => {
    expect(headline.lines).toBe(2)
    expect(sub.lines).toBe(1)
    expect(field('headline')).toMatchObject({ maxChars: headline.perLine * 2, maxLines: 2, lineToken: 'HOOK' })
    expect(field('sub')).toMatchObject({ maxChars: sub.perLine, maxLines: 1, lineToken: 'BODY' })
  })

  it('템플릿 상한이 더 작으면 그 값, 규칙에 없는 칸은 그대로', () => {
    const small = copySlotsOf(tpl('hook_3step.b', { section: 'hook_3step', slots: { headline: text({ maxChars: 5 }) } }))
    expect(small[0].maxChars).toBe(5)
    expect(field('count')).toEqual({ name: 'count', required: false, facts: 1, maxChars: 4, maxLines: 1 })
  })

  it('첫 화면이 아니면 줄 수를 재지 않는다', () => {
    const other = copySlotsOf(tpl('a.b', { slots: { headline: text({ maxChars: 99, maxLines: 1 }) } }))
    expect(other[0].lineToken).toBeUndefined()
    expect(checkCopyValues(other, { headline: '가'.repeat(50) }, spec)).toEqual([])
  })

  it('제목 3줄·보조 2줄은 길이 문제다 — 고치기 콜로 간다', () => {
    // 공백 뺀 글자 수는 상한 안이지만 줄이 넘친다
    const three = `${'가'.repeat(2)}\n${'가'.repeat(2)}\n${'가'.repeat(2)}`
    const problems = checkCopyValues(hookSlots, { headline: three }, spec)
    expect(problems).toEqual([{ slot: 'headline', kind: 'length', detail: '3줄(상한 2줄)' }])
    const twoLines = checkCopyValues(hookSlots, { headline: '가', sub: `가\n가` }, spec)
    expect(twoLines).toEqual([{ slot: 'sub', kind: 'length', detail: '2줄(상한 1줄)' }])
  })

  it('줄당 글자에 맞는 글은 통과하고, 글자 수를 넘으면 글자 수 문제다', () => {
    const fit = `${'가'.repeat(headline.perLine)}\n${'가'.repeat(headline.perLine)}`
    expect(checkCopyValues(hookSlots, { headline: fit, sub: '가'.repeat(sub.perLine) }, spec)).toEqual([])
    const over = checkCopyValues(hookSlots, { headline: '가', sub: '가'.repeat(sub.perLine + 1) }, spec)
    expect(over[0]).toEqual({ slot: 'sub', kind: 'length', detail: `${sub.perLine + 1}자(상한 ${sub.perLine}자)` })
  })
})

describe('읽기', () => {
  it('아는 칸만 읽고, 빈 값·글자가 아닌 값을 버리고, 앞뒤 공백을 지운다', () => {
    expect(readCopyValues(slots, { headline: ' 제목 ', sub: '  ', other: '모름', steps: 'x' })).toEqual({ headline: '제목' })
    expect(readCopyValues(slots, { headline: 3 })).toEqual({})
    expect(readCopyValues(slots, null)).toEqual({})
  })

  it('목록은 필수 칸이 빠진 항목을 버리고 상한까지만 받는다', () => {
    const rows = [{ title: '하나', note: '메모', count: '입력' }, { note: '제목 없음' }, null, { title: '둘' }, { title: '셋' }, { title: '넷' }]
    expect(readCopyValues(slots, { steps: rows }).steps).toEqual([{ title: '하나', note: '메모' }, { title: '둘' }, { title: '셋' }])
  })

  it('필수 칸이 없는 목록도 빈 항목은 버린다', () => {
    const list: CopySlot[] = [{ name: 'tips', required: false, facts: 0, list: { min: 1, max: 2, fields: [{ name: 'a', required: false, facts: 0 }] } }]
    expect(readCopyValues(list, { tips: [{ a: '' }, { b: 'x' }] })).toEqual({})
    expect(readCopyValues(list, { tips: [{ a: '값' }] })).toEqual({ tips: [{ a: '값' }] })
  })
})

describe('검사', () => {
  const ok = { headline: '엉키지 않아요', steps: [{ title: '하나' }, { title: '둘' }] }

  it('문제가 없으면 빈 목록이다 — 체감 효익은 막지 않는다', () => {
    expect(checkCopyValues(slots, ok, spec)).toEqual([])
  })

  it('글자 수는 공백을 빼고 센다, 넘으면 문제다 — 항목 칸도 본다', () => {
    expect(checkCopyValues(slots, { ...ok, headline: '가 나 다 라 마 바 사 아' }, spec)).toEqual([])
    expect(checkCopyValues(slots, { ...ok, headline: '가'.repeat(13) }, spec)).toEqual([{ slot: 'headline', kind: 'length', detail: '13자(상한 8자)' }])
    const long = { ...ok, steps: [{ title: '가'.repeat(10) }, { title: '둘' }] }
    expect(checkCopyValues(slots, long, spec)).toEqual([{ slot: 'steps.title', kind: 'length', detail: '10자(상한 6자)' }])
  })

  it('필수 칸이 상한 1.5배 안에서 넘치면 over다 — 고치기는 청하고 글은 지우지 않는다(K14)', () => {
    expect(checkCopyValues(slots, { ...ok, headline: '가'.repeat(12) }, spec)).toEqual([{ slot: 'headline', kind: 'over', detail: '12자(상한 8자)' }])
    const long = { ...ok, steps: [{ title: '가'.repeat(9) }, { title: '둘' }] }
    expect(checkCopyValues(slots, long, spec)).toEqual([{ slot: 'steps.title', kind: 'over', detail: '9자(상한 6자)' }])
    expect(dropsText('over')).toBe(false)
    expect(asksFix('over')).toBe(true)
    const value = { ...ok, headline: '가'.repeat(12) }
    expect(dropProblemValues(value, checkCopyValues(slots, value, spec))).toEqual(value)
  })

  it('선택 칸·필수 아닌 목록의 칸·첫 화면 칸은 조금 넘쳐도 length다', () => {
    expect(checkCopyValues(slots, { ...ok, sub: '가'.repeat(11) }, spec)).toEqual([{ slot: 'sub', kind: 'length', detail: '11자(상한 10자)' }])
    const optional: CopySlot[] = [{ name: 'tips', required: false, facts: 0, list: { min: 1, max: 2, fields: [{ name: 'a', required: true, facts: 0, maxChars: 4 }] } }]
    expect(checkCopyValues(optional, { tips: [{ a: '가나다라마' }] }, spec)).toEqual([{ slot: 'tips.a', kind: 'length', detail: '5자(상한 4자)' }])
    const hook = TEMPLATES.find((t) => t.section === 'hook_3step' && copySlotsOf(t).some((s) => s.name === 'headline' && s.required))!
    const headline = copySlotsOf(hook).find((s) => s.name === 'headline')!
    const value = { headline: '가'.repeat(headline.maxChars! + 1) }
    expect(checkCopyValues([headline], value, spec).map((p) => p.kind)).toContain('length')
    expect(checkCopyValues([headline], value, spec).map((p) => p.kind)).not.toContain('over')
  })

  it('글 칸이 다 찼는가 — 필수 칸·목록 최소 수를 본다. 선택 칸과 칸 없는 템플릿은 보지 않는다', () => {
    expect(requiredCopyFilled(slots, ok)).toBe(true)
    expect(requiredCopyFilled(slots, { steps: ok.steps })).toBe(false)
    expect(requiredCopyFilled(slots, { ...ok, steps: [{ title: '하나' }] })).toBe(false)
    expect(requiredCopyFilled([], {})).toBe(true)
  })

  it('상한이 없는 칸은 길이를 보지 않는다', () => {
    const value: CopyValues = { ...ok, steps: [{ title: '하나', note: '가'.repeat(100) }, { title: '둘' }] }
    expect(checkCopyValues(slots, value, spec)).toEqual([])
  })

  it('규제 표현은 문제다 — 인증 입력이 있으면 그 인증은 괜찮다', () => {
    const value = { ...ok, sub: 'KC 인증 완료' }
    expect(checkCopyValues(slots, value, spec)).toEqual([{ slot: 'sub', kind: 'claim', detail: 'KC 인증 완료' }])
    expect(checkCopyValues(slots, value, { ...spec, certificationInfo: 'KC 인증' } as PdpSpecSheet)).toEqual([])
    const relief = { ...ok, sub: '두통 완화' }
    expect(checkCopyValues(slots, relief, spec).map((p) => p.kind)).toEqual(['claim'])
  })

  it('입력에 없는 숫자는 문제다, 입력에 있는 숫자는 괜찮다', () => {
    expect(checkCopyValues(slots, { ...ok, sub: '10cm 크기' }, spec)).toEqual([])
    expect(checkCopyValues(slots, { ...ok, sub: '25cm 크기' }, spec)).toEqual([{ slot: 'sub', kind: 'number', detail: '25cm' }])
  })

  it('필수 칸이 빠지거나 목록이 최소보다 적으면 문제다', () => {
    expect(checkCopyValues(slots, { steps: ok.steps }, spec)).toEqual([{ slot: 'headline', kind: 'missing', detail: '필수 칸' }])
    expect(checkCopyValues(slots, { headline: '제목', steps: [{ title: '하나' }] }, spec)).toEqual([{ slot: 'steps', kind: 'missing', detail: '항목 2개 이상' }])
    expect(checkCopyValues(slots, { headline: '제목' }, spec)).toEqual([{ slot: 'steps', kind: 'missing', detail: '항목 2개 이상' }])
  })
})

describe('지우기', () => {
  it('걸린 칸만 지운다 — 빠진 칸과 사실 반복은 그대로 둔다', () => {
    const values = { headline: '제목', sub: '부제' }
    expect(dropProblemValues(values, [{ slot: 'sub', kind: 'claim', detail: '' }])).toEqual({ headline: '제목' })
    expect(dropProblemValues(values, [{ slot: 'sub', kind: 'missing', detail: '' }])).toEqual(values)
    expect(dropProblemValues(values, [{ slot: 'sub', kind: 'repeat', detail: '' }])).toEqual(values)
    expect(values).toEqual({ headline: '제목', sub: '부제' })
  })

  it('항목 칸은 그 칸만 지우고, 비는 항목은 뺀다, 모두 비면 목록을 지운다', () => {
    const values: CopyValues = { steps: [{ title: '하나', note: '메모' }, { title: '둘' }] }
    expect(dropProblemValues(values, [{ slot: 'steps.note', kind: 'length', detail: '' }])).toEqual({ steps: [{ title: '하나' }, { title: '둘' }] })
    expect(dropProblemValues(values, [{ slot: 'steps.title', kind: 'length', detail: '' }])).toEqual({ steps: [{ note: '메모' }] })
    expect(dropProblemValues({ steps: [{ title: '둘' }] }, [{ slot: 'steps.title', kind: 'claim', detail: '' }])).toEqual({})
    expect(dropProblemValues({ headline: '글' }, [{ slot: 'headline.x', kind: 'claim', detail: '' }])).toEqual({ headline: '글' })
  })
})

describe('사실 칸 맞추기', () => {
  const full = { headline: '제목', sub: '부제', steps: [{ title: '하나' }, { title: '둘' }, { title: '셋' }] }

  it('예산 안이면 그대로다', () => {
    expect(fitToFactSlots(slots, full, 5)).toEqual(full)
    expect(fitToFactSlots(slots, full, 9)).toEqual(full)
  })

  it('뒤 칸부터 줄인다 — 목록은 최소 수까지, 그다음 선택 칸, 필수 칸은 지우지 않는다', () => {
    expect(fitToFactSlots(slots, full, 4)).toEqual({ headline: '제목', sub: '부제', steps: full.steps.slice(0, 2) })
    expect(fitToFactSlots(slots, full, 3)).toEqual({ headline: '제목', steps: full.steps.slice(0, 2) })
    expect(fitToFactSlots(slots, full, 0)).toEqual({ headline: '제목', steps: full.steps.slice(0, 2) })
  })

  it('사실을 쓰지 않는 선택 칸은 지우지 않는다', () => {
    const list: CopySlot[] = [
      { name: 'sub', required: false, facts: 1 },
      { name: 'cap', required: false, facts: 0 },
    ]
    expect(fitToFactSlots(list, { cap: '말', sub: '사실' }, 0)).toEqual({ cap: '말' })
  })

  it('필수가 아닌 목록은 최소보다 적어지면 함께 지운다', () => {
    const list: CopySlot[] = [{ name: 'tips', required: false, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'a', required: true, facts: 1 }] } }]
    const items = [{ a: '하나' }, { a: '둘' }, { a: '셋' }]
    expect(fitToFactSlots(list, { tips: items }, 2)).toEqual({ tips: items.slice(0, 2) })
    expect(fitToFactSlots(list, { tips: items }, 1)).toEqual({})
    expect(fitToFactSlots(list, { tips: items }, 0)).toEqual({})
  })

  it('필수 목록을 넘겨 지운 뒤에도 남은 사실은 앞 칸이 줄인다', () => {
    const list: CopySlot[] = [
      { name: 'first', required: false, facts: 1 },
      { name: 'tips', required: false, facts: 1, list: { min: 2, max: 3, fields: [{ name: 'a', required: true, facts: 1 }] } },
    ]
    expect(fitToFactSlots(list, { first: '앞', tips: [{ a: '하나' }, { a: '둘' }] }, 1)).toEqual({ first: '앞' })
    expect(fitToFactSlots(list, { first: '앞', tips: [{ a: '하나' }, { a: '둘' }] }, 0)).toEqual({})
  })

  it('입력을 바꾸지 않는다', () => {
    const value = { headline: '제목', steps: [{ title: '하나' }, { title: '둘' }, { title: '셋' }] }
    fitToFactSlots(slots, value, 0)
    expect(value.steps).toHaveLength(3)
  })
})

describe('섹션 글', () => {
  it('칸과 항목 글을 잇는다', () => {
    expect(sectionText(slots, { headline: '제목', steps: [{ title: '하나', note: '메모' }, { title: '둘' }] })).toBe('제목 하나 메모 둘')
    expect(sectionText(slots, {})).toBe('')
  })
})
