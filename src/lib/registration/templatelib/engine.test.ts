import { describe, expect, it } from 'vitest'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { HOOK_STEP_SIZES, fitHookToken } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { CONTENT_W, HOOK_TYPE, SCENE_TYPE } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { K_HOOK_STEP_SIZES, K_TYPE, renderTemplate } from './engine'
import { COLORS, ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { templatesOf } from './library'
import { sampleSlots } from './sample'
import { factRange, missingSlots } from './slots'
import type { Template } from './template-types'

const point = (over: Partial<Template> = {}) =>
  templateOf({
    flow: [
      { kind: 'capsule', label: 'POINT', gapAfter: 'tightGap' },
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap' },
      { kind: 'text', slot: 'sub', token: 'BODY', gapAfter: 'photoGap' },
      { kind: 'image', slot: 'photo', w: 740 },
    ],
    slots: { headline: textSlot({ required: true }), sub: textSlot(), photo: imageSlot({ required: true }) },
    ...over,
  })

const named = (result: { elements: Array<{ name: string }> }, name: string) =>
  result.elements.filter((e) => e.name === name) as NonNullable<ReturnType<typeof renderTemplate>>['elements']

const asSection = (result: NonNullable<ReturnType<typeof renderTemplate>>, sectionType = 'point_div') =>
  ({
    id: 's',
    sectionType,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_k_x',
    canvas: { width: 860, height: result.height, backgroundColor: result.background },
    elements: result.elements,
  }) as unknown as CanvasSection


describe('평점', () => {
  const rated = (value?: boolean) =>
    templateOf({
      flow: [{ kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap' }, { kind: 'rating', slot: 'rating', value }],
      slots: { headline: textSlot({ required: true }), rating: textSlot({ source: 'input', input: 'review.rating', maxChars: 3, maxLines: 1 }) },
    })
  const starsOf = (value?: boolean) => named(renderTemplate(rated(value), { headline: '제목', rating: '4.6' }, ctxOf())!, 'designcut-rating')[0].textProps?.content

  it('요약은 별 옆에 숫자를 쓰고, 기본은 별만 그린다', () => {
    expect(starsOf(true)).toBe('★★★★★ 4.6')
    expect(starsOf()).toBe('★★★★★')
  })
})

describe('카드 색 C', () => {
  const template = (surfaces: Template['surfaces']) =>
    templateOf({
      surfaces,
      flow: [{ kind: 'panel', fill: 'C', nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }] }],
      slots: { headline: textSlot({ required: true, maxChars: 12, maxLines: 2 }) },
    })
  const drawn = (bg: Template['surfaces'][number], colors = COLORS) => {
    const out = renderTemplate(template([bg]), { headline: '제목' }, ctxOf({ bg, colors }))!
    return { panel: named(out, 'designcut-panel')[0].shapeProps?.fill, text: named(out, 'designcut-headline')[0].textProps?.color }
  }

  it('흰 바탕에서는 연한 면으로 풀린다', () => {
    expect(drawn('W').panel).toBe(COLORS.tint)
  })

  it.each(['T', 'N', 'D'] as const)('바탕 %s에서는 바탕색(W)으로 풀려 같은 색이 되지 않는다', (bg) => {
    expect(drawn(bg).panel).toBe(COLORS.base)
  })

  it('짙은 바탕의 카드 안 글자는 밝은 면의 글자색이다', () => {
    expect(drawn('D').text).toBe(COLORS.heading)
  })

  it('T가 흰색인 조합(soft)에서도 카드가 바탕과 같은 색이 되지 않는다', () => {
    const soft = { ...COLORS, base: '#F5F3F0', tint: '#FFFFFF' }
    expect(drawn('W', soft).panel).toBe('#FFFFFF')
    expect(drawn('T', soft).panel).toBe('#F5F3F0')
  })
})

describe('K 글자 크기', () => {
  it('K 크기는 그대로이고, D 장면 토큰은 보고서 적용 D1(#pdp-d-type-scale)로 K와 같은 크기다 — K는 D 표를 덮어써서 D 변경에 안 흔들린다', () => {
    expect([K_TYPE.HOOK.size, K_TYPE.H1.size, K_TYPE.H2.size, K_TYPE.H3.size, K_TYPE.BODY.size, K_TYPE.BODY_BOLD.size, K_TYPE.LABEL.size, K_TYPE.CAPTION.size]).toEqual([112, 92, 74, 62, 52, 52, 36, 36])
    expect([SCENE_TYPE.H1.size, SCENE_TYPE.H2.size, SCENE_TYPE.H3.size, SCENE_TYPE.BODY.size, SCENE_TYPE.LABEL.size]).toEqual([92, 74, 62, 52, 32])
    expect([HOOK_TYPE.calm.size, HOOK_TYPE.playful.size]).toEqual([112, 112])
  })

  it('본문은 400, 굵은 본문은 700으로 갈린다 — D 장면 본문도 400이다', () => {
    expect([K_TYPE.BODY.weight, K_TYPE.BODY_BOLD.weight]).toEqual([400, 700])
    expect(SCENE_TYPE.BODY.weight).toBe(400)
  })

  it('각주는 굵기 500, 줄 간격 1.5다', () => {
    expect([K_TYPE.CAPTION.weight, K_TYPE.CAPTION.lineHeight]).toEqual([500, 1.5])
  })

  describe('첫 화면 제목 줄임', () => {
    const newSize = (text: string) => fitHookToken(K_TYPE.HOOK, text, CONTENT_W, K_HOOK_STEP_SIZES).size
    const oldSize = (text: string) => fitHookToken(HOOK_TYPE.calm, text, CONTENT_W).size

    it('D 단계는 그대로이고 K만 108·104를 더한다', () => {
      expect(HOOK_STEP_SIZES).toEqual([100, 96, 92, 88, 84])
      expect(K_HOOK_STEP_SIZES.slice(0, 3)).toEqual([108, 104, 100])
    })

    it.each([
      ['12', '가나다라마바사아자차카타', 112],
      ['6+6', '가나다라마바 사아자차카타', 112],
      ['2×6', '가나 다라 마바 사아 자차 카타', 112],
      ['3×4', '가나다 라마바 사아자 차카타', 112],
      ['5+7', '가나다라마 바사아자차카타', 104],
      ['4+3+5', '가나다라 마바사 아자차카타', 100],
      ['4+4+4', '가나다라 마바사아 자차카타파', 88],
    ])('공백 뺀 12자 %s: 옛 104 토큰보다 작아지지 않는다', (_shape, text, size) => {
      expect(newSize(text)).toBe(size)
      expect(newSize(text)).toBeGreaterThanOrEqual(oldSize(text))
    })

    it('108·104 단계가 없으면 104에 들어가는 제목이 100으로 떨어진다 — 단계를 더한 이유', () => {
      const text = '가나다라마 바사아자차카타'
      expect(fitHookToken(K_TYPE.HOOK, text, CONTENT_W).size).toBe(100)
      expect(newSize(text)).toBe(104)
    })
  })

  it('줄 간격은 규격 그대로다 — 제목 1.45, 소제목 1.5, 본문 1.7', () => {
    expect([K_TYPE.H1.lineHeight, K_TYPE.H2.lineHeight, K_TYPE.H3.lineHeight, K_TYPE.BODY.lineHeight]).toEqual([1.45, 1.45, 1.5, 1.7])
  })
})

describe('renderTemplate 흐름', () => {
  it('위에서 아래로 쌓고 위아래 여백은 spacing 값이다', () => {
    const out = renderTemplate(point(), { headline: '짧은 제목', sub: '설명 한 줄', photo: 'hero' }, ctxOf())!
    const [capsule] = named(out, 'designcut-capsule-bg')
    const [headline] = named(out, 'designcut-headline')
    const [sub] = named(out, 'designcut-sub')
    const [photo] = named(out, 'designcut-scene')
    expect(capsule.transform.y).toBe(120)
    expect(headline.transform.y).toBe(120 + 64 + 16)
    expect(sub.transform.y).toBe(headline.transform.y + headline.transform.height + 48)
    expect(photo.transform.y).toBe(sub.transform.y + sub.transform.height + 88)
    expect(out.height).toBe(photo.transform.y + photo.transform.height + 120)
  })

  it('글이 길면 아래 요소를 민다 — 좌표를 고정하지 않는다', () => {
    const short = renderTemplate(point(), { headline: '짧은 제목', photo: 'hero' }, ctxOf())!
    const long = renderTemplate(point(), { headline: '아주 길게 늘어난 제목 '.repeat(4), photo: 'hero' }, ctxOf())!
    expect(named(long, 'designcut-scene')[0].transform.y).toBeGreaterThan(named(short, 'designcut-scene')[0].transform.y)
    expect(long.height).toBeGreaterThan(short.height)
  })

  it('색은 받은 색 조합과 바탕에서만 나온다', () => {
    const slots = { headline: '짧은 제목', photo: 'hero' }
    const white = renderTemplate(point(), slots, ctxOf({ bg: 'W' }))!
    const deep = renderTemplate(point(), slots, ctxOf({ bg: 'D' }))!
    expect(white.background).toBe('#FFFFFF')
    expect(deep.background).toBe(COLORS.deep)
    expect(named(deep, 'designcut-headline')[0].textProps?.color).toBe(COLORS.onDeep)
  })

  it('허용하지 않은 바탕이면 허용 목록의 첫째로 그린다', () => {
    const out = renderTemplate(point({ surfaces: ['N'] }), { headline: '제목', photo: 'hero' }, ctxOf({ bg: 'D' }))!
    expect(out.background).toBe(COLORS.neutral)
  })

  it('풀폭 사진으로 시작·끝나면 그쪽 여백이 0이다', () => {
    const t = templateOf({
      flow: [
        { kind: 'image', slot: 'top', bleed: true, gapAfter: 'photoGap' },
        { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
        { kind: 'image', slot: 'end', bleed: true },
      ],
      slots: { top: imageSlot(), headline: textSlot({ required: true }), end: imageSlot() },
    })
    const out = renderTemplate(t, { top: 'a', headline: '제목', end: 'b' }, ctxOf())!
    const photos = named(out, 'designcut-scene')
    expect(photos[0].transform).toMatchObject({ x: 0, y: 0, width: 860 })
    expect(out.height).toBe(photos[1].transform.y + photos[1].transform.height)
    // 끝 사진이 빠지면 글로 끝나므로 아래 여백이 돌아온다
    const noEnd = renderTemplate(t, { top: 'a', headline: '제목' }, ctxOf())!
    const headline = named(noEnd, 'designcut-headline')[0]
    expect(noEnd.height).toBe(headline.transform.y + headline.transform.height + 120)
  })
})

describe('빈 슬롯', () => {
  it('선택 슬롯이 비면 요소를 만들지 않고, 글→사진 간격은 유지한다', () => {
    const out = renderTemplate(point(), { headline: '제목', sub: '   ', photo: 'hero' }, ctxOf())!
    expect(named(out, 'designcut-sub')).toHaveLength(0)
    const [headline] = named(out, 'designcut-headline')
    expect(named(out, 'designcut-scene')[0].transform.y).toBe(headline.transform.y + headline.transform.height + 88)
  })

  it('끝 노드가 비면 간격이 끝에 남지 않는다', () => {
    const t = templateOf({
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
        { kind: 'text', slot: 'sub', token: 'BODY' },
      ],
      slots: { headline: textSlot({ required: true }), sub: textSlot() },
    })
    const out = renderTemplate(t, { headline: '제목' }, ctxOf())!
    const [headline] = named(out, 'designcut-headline')
    expect(out.height).toBe(headline.transform.y + headline.transform.height + 120)
  })

  it('필수 글자가 비거나 공백이면 null이다', () => {
    expect(renderTemplate(point(), { photo: 'hero' }, ctxOf())).toBeNull()
    expect(renderTemplate(point(), { headline: '  ', photo: 'hero' }, ctxOf())).toBeNull()
  })

  it('필수 사진의 키가 없거나 URL이 안 나오면 null이다', () => {
    expect(renderTemplate(point(), { headline: '제목' }, ctxOf())).toBeNull()
    expect(renderTemplate(point(), { headline: '제목', photo: 'hero' }, ctxOf({ image: () => null }))).toBeNull()
  })

  it('상자 안이 모두 비면 상자도 뺀다', () => {
    const t = templateOf({
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
        { kind: 'panel', fill: 'N', nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] },
      ],
      slots: { headline: textSlot({ required: true }), note: textSlot() },
    })
    expect(named(renderTemplate(t, { headline: '제목' }, ctxOf())!, 'designcut-panel')).toHaveLength(0)
    expect(named(renderTemplate(t, { headline: '제목', note: '메모' }, ctxOf())!, 'designcut-panel')).toHaveLength(1)
  })
})

describe('목록과 사실 수', () => {
  const list = templateOf({
    flow: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
      {
        kind: 'repeat',
        slot: 'items',
        rule: true,
        nodes: [
          { kind: 'text', slot: 'title', token: 'H3', gapAfter: 'tightGap' },
          { kind: 'text', slot: 'desc', token: 'BODY' },
        ],
      },
    ],
    slots: {
      headline: textSlot({ required: true, facts: 0 }),
      items: {
        type: 'list',
        required: true,
        min: 2,
        max: 3,
        fields: { title: textSlot({ required: true }), desc: textSlot() },
      },
    },
  })

  it('받은 개수만 그리고 max를 넘으면 자른다', () => {
    const two = renderTemplate(list, { headline: '제목', items: [{ title: '하나' }, { title: '둘' }] }, ctxOf())!
    expect(named(two, 'designcut-title')).toHaveLength(2)
    const many = [1, 2, 3, 4, 5].map((n) => ({ title: `항목 ${n}` }))
    expect(named(renderTemplate(list, { headline: '제목', items: many }, ctxOf())!, 'designcut-title')).toHaveLength(3)
  })

  it('필수 칸이 빈 항목은 빼고 세며, min보다 적으면 null이다', () => {
    expect(renderTemplate(list, { headline: '제목', items: [{ title: '하나' }, { title: ' ', desc: '설명만' }] }, ctxOf())).toBeNull()
    expect(missingSlots(list, { headline: '제목', items: [{ title: '하나' }] })).toEqual(['items'])
  })

  it('항목의 선택 칸이 비면 그 항목에서만 빠진다', () => {
    const out = renderTemplate(list, { headline: '제목', items: [{ title: '하나', desc: '설명' }, { title: '둘' }] }, ctxOf())!
    expect(named(out, 'designcut-desc')).toHaveLength(1)
  })

  it('사실 수를 슬롯에서 계산한다 — min은 필수만, max는 전부', () => {
    // 제목 0 + 목록 min 2 × 필수 칸(title 1) / max 3 × 전체 칸(title 1 + desc 1)
    expect(factRange(list)).toEqual({ min: 2, max: 6 })
    expect(factRange(point())).toEqual({ min: 1, max: 2 })
  })

  it('필수가 아닌 목록은 min에 들지 않는다', () => {
    const optional = templateOf({
      slots: { items: { type: 'list', required: false, min: 2, max: 4, fields: { title: textSlot({ required: true }) } } },
    })
    expect(factRange(optional)).toEqual({ min: 0, max: 4 })
  })
})

describe('노드', () => {
  it('상자는 안쪽을 감싸고 안쪽 바탕으로 글자색을 고른다', () => {
    const t = templateOf({
      flow: [{ kind: 'panel', fill: 'D', nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] }],
      slots: { note: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { note: '메모' }, ctxOf())!
    const [panel] = named(out, 'designcut-panel')
    const [note] = named(out, 'designcut-note')
    expect(panel.shapeProps?.fill).toBe(COLORS.deep)
    expect(note.textProps?.color).toBe(COLORS.onDeep)
    expect(note.transform.y).toBe(panel.transform.y + 40)
    expect(panel.transform.y + panel.transform.height).toBe(note.transform.y + note.transform.height + 40)
    expect(panel.containerOf).toContain(note.id)
  })

  it('풀폭 띠는 860이고 안쪽 위아래 여백은 spacing 값이다', () => {
    const t = templateOf({
      flow: [{ kind: 'panel', fill: 'D', bleed: true, nodes: [{ kind: 'text', slot: 'note', token: 'H1' }] }],
      slots: { note: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { note: '메모' }, ctxOf())!
    const [panel] = named(out, 'designcut-panel')
    const [note] = named(out, 'designcut-note')
    expect(panel.transform).toMatchObject({ x: 0, y: 0, width: 860 })
    expect(note.transform).toMatchObject({ x: 60, y: 120, width: 740 })
    expect(out.height).toBe(panel.transform.height)
  })

  it('풀폭 띠에 pad를 주면 안쪽 위아래 여백만 그 간격이다 — 섹션 여백(spacing)은 그대로(K11 머리 띠)', () => {
    const t = templateOf({
      flow: [
        { kind: 'panel', fill: 'D', bleed: true, pad: 'blockGap', gapAfter: 'blockGap', nodes: [{ kind: 'text', slot: 'note', token: 'H1' }] },
        { kind: 'text', slot: 'body', token: 'BODY' },
      ],
      slots: { note: textSlot({ required: true }), body: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { note: '메모', body: '본문' }, ctxOf())!
    const [panel] = named(out, 'designcut-panel')
    const [note] = named(out, 'designcut-note')
    const [body] = named(out, 'designcut-body')
    expect(note.transform.y).toBe(64)
    expect(panel.transform.y + panel.transform.height).toBe(note.transform.y + note.transform.height + 64)
    expect(body.transform.y).toBe(panel.transform.y + panel.transform.height + 64)
    expect(out.height).toBe(body.transform.y + body.transform.height + t.spacing.bottom)
  })

  it('가로 칸은 폭대로 나란히, 가운데 정렬이면 짧은 칸을 가운데로 민다', () => {
    const t = templateOf({
      flow: [
        {
          kind: 'row',
          valign: 'center',
          columns: [
            { w: 336, nodes: [{ kind: 'image', slot: 'photo' }] },
            { w: 380, nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] },
          ],
        },
      ],
      slots: { photo: imageSlot({ required: true }), note: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { photo: 'a', note: '메모' }, ctxOf())!
    const [photo] = named(out, 'designcut-scene')
    const [note] = named(out, 'designcut-note')
    expect(photo.transform).toMatchObject({ x: 60, width: 336 })
    expect(note.transform).toMatchObject({ x: 60 + 336 + 24, width: 380 })
    expect(Math.abs(note.transform.y + note.transform.height / 2 - (photo.transform.y + photo.transform.height / 2))).toBeLessThanOrEqual(1)
  })

  it('타일 줄(stretch)은 칸의 상자를 가장 긴 칸 높이로 맞추고 안쪽을 가운데로 옮긴다', () => {
    const t = templateOf({
      flow: [
        {
          kind: 'row',
          valign: 'stretch',
          columns: [
            { w: 200, nodes: [{ kind: 'panel', fill: 'A', nodes: [{ kind: 'text', slot: 'no', token: 'H3', align: 'center' }] }] },
            { w: 516, nodes: [{ kind: 'panel', fill: 'N', nodes: [{ kind: 'text', slot: 'title', token: 'H2' }] }] },
          ],
        },
      ],
      slots: { no: textSlot({ required: true }), title: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { no: '1', title: '두 줄 넘게 이어지는 조금 긴 제목입니다' }, ctxOf())!
    const [left, right] = named(out, 'designcut-panel')
    expect(left.transform.height).toBe(right.transform.height)
    const [no] = named(out, 'designcut-no')
    expect(Math.abs(no.transform.y + no.transform.height / 2 - (left.transform.y + left.transform.height / 2))).toBeLessThanOrEqual(1)
  })

  it('큰 제목은 2줄에 들어가는 크기로 줄인다', () => {
    const t = templateOf({
      flow: [{ kind: 'text', slot: 'headline', token: 'HOOK' }],
      slots: { headline: textSlot({ required: true, maxChars: 12, maxLines: 2 }) },
    })
    const sizeOf = (headline: string) => named(renderTemplate(t, { headline }, ctxOf())!, 'designcut-headline')[0].textProps?.fontSize
    expect(sizeOf('끈만 당기면\n구디백 완성')).toBe(112)
    // 줄당 8자 + 띄어쓰기라 112·108·104·100·96·92는 3줄, 88에서 2줄
    expect(sizeOf('두피 구석까지,\n탄성모로 부드럽게')).toBe(88)
  })

  it('사진 높이는 슬롯 최소 높이 이상이다', () => {
    const t = templateOf({
      flow: [{ kind: 'image', slot: 'photo', w: 336 }],
      slots: { photo: imageSlot({ required: true, aspect: ['4:3'], minHeight: 500 }) },
    })
    expect(named(renderTemplate(t, { photo: 'a' }, ctxOf())!, 'designcut-scene')[0].transform.height).toBe(500)
  })

  it('실제 비율을 슬롯 범위로 묶는다', () => {
    const t = templateOf({
      flow: [{ kind: 'image', slot: 'photo', w: 740 }],
      slots: { photo: imageSlot({ required: true, aspect: ['3:4', '4:3'], minHeight: 0 }) },
    })
    const height = (aspect: number) =>
      named(renderTemplate(t, { photo: 'a' }, ctxOf({ aspectOf: () => aspect }))!, 'designcut-scene')[0].transform.height
    expect(height(1)).toBe(740)
    expect(height(10)).toBe(Math.round(740 / (4 / 3)))
    expect(height(0.1)).toBe(Math.round(740 / (3 / 4)))
  })

  it('번호는 항목 순서, 체크·엑스는 슬롯 값으로 그린다', () => {
    const t = templateOf({
      flow: [
        {
          kind: 'repeat',
          slot: 'items',
          nodes: [
            { kind: 'mark', value: 'index' },
            { kind: 'mark', slot: 'ours' },
          ],
        },
      ],
      slots: {
        items: {
          type: 'list',
          required: true,
          min: 1,
          max: 3,
          fields: { ours: textSlot({ facts: 0, source: 'input', input: 'compare.ours' }) },
        },
      },
    })
    const out = renderTemplate(t, { items: [{ ours: 'check' }, { ours: 'cross' }] }, ctxOf())!
    expect(named(out, 'designcut-mark-number').map((e) => e.textProps?.content)).toEqual(['1', '2'])
    // 글자를 상자 식구로 묶으면 마운트 리플로우가 원 높이를 글자에 맞춰 줄여 납작해진다
    expect(named(out, 'designcut-mark').every((e) => !e.containerOf?.length && e.transform.width === e.transform.height)).toBe(true)
    for (const number of named(out, 'designcut-mark-number')) {
      const circle = named(out, 'designcut-mark').find((c) => c.transform.x === number.transform.x)
      expect(number.transform.height).toBeLessThanOrEqual(circle?.transform.height ?? 0)
    }
    expect(named(out, 'designcut-mark-check')).toHaveLength(1)
    expect(named(out, 'designcut-mark-cross')).toHaveLength(1)
  })

  it('중립 표식 dash는 원·테두리 없이 회색 줄표만 그리고 체크와 같은 칸을 차지한다', () => {
    const t = templateOf({
      flow: [{ kind: 'row', columns: [{ w: 156, nodes: [{ kind: 'mark', value: 'check', align: 'center' }] }, { w: 156, nodes: [{ kind: 'mark', value: 'dash', align: 'center' }] }] }],
      slots: {},
    })
    const out = renderTemplate(t, {}, ctxOf())!
    const dash = named(out, 'designcut-mark-dash')
    const check = named(out, 'designcut-mark-check')
    expect(dash).toHaveLength(1)
    expect(named(out, 'designcut-mark-cross')).toHaveLength(0)
    expect(named(out, 'designcut-mark')).toHaveLength(1)
    expect(dash[0].transform.width).toBe(check[0].transform.width)
    expect(dash[0].transform.y).toBe(check[0].transform.y)
  })

  it('이름표는 장식 라벨 규칙을 따르고 한 묶음이다', () => {
    const t = templateOf({
      flow: [{ kind: 'tags', slot: 'names' }],
      slots: { names: { type: 'list', required: true, min: 1, max: 12, fields: {} } },
    })
    const names = ['라이트 베이지', '딥 네이비', '올리브', '스카이 블루', '코랄 핑크', '차콜']
    const out = renderTemplate(t, { names }, ctxOf())!
    const labels = out.elements.filter((e) => e.name.startsWith('annotation-label-'))
    expect(labels).toHaveLength(6)
    expect(new Set(out.elements.map((e) => e.groupId)).size).toBe(1)
    // 폭을 넘으면 다음 줄로 내려가고, 어느 칸도 본문 폭을 넘지 않는다
    expect(new Set(labels.map((e) => e.transform.y)).size).toBeGreaterThan(1)
    expect(Math.max(...labels.map((e) => e.transform.x + e.transform.width))).toBeLessThanOrEqual(800)
  })

  it('반복 칸 안 이름표는 항목마다 하나이고, 전체가 장식 하나로 묶인다', () => {
    const t = templateOf({
      flow: [{ kind: 'repeat', slot: 'swatches', columns: 2, gap: 'blockGap', nodes: [{ kind: 'image', slot: 'photo', gapAfter: 'tightGap' }, { kind: 'tags', slot: 'name' }] }],
      slots: {
        swatches: {
          type: 'list', required: true, min: 2, max: 4,
          fields: {
            photo: { type: 'image', required: true, purpose: ['color'], composition: ['front'], aspect: ['3:4'], minHeight: 500 },
            name: { type: 'text', required: true, source: 'input', input: 'option.name', facts: 0, maxChars: 7, maxLines: 1, claimRisk: 'none' },
          },
        },
      },
    })
    const out = renderTemplate(t, { swatches: ['블랙', '라벤더', '세이지', '코랄'].map((name, i) => ({ photo: `p${i}`, name })) }, ctxOf())!
    const labels = out.elements.filter((e) => e.name.startsWith('annotation-label-'))
    const photos = named(out, 'designcut-scene')
    expect(labels.map((e) => e.textProps?.content)).toEqual(['블랙', '라벤더', '세이지', '코랄'])
    // 이름이 제 사진의 왼쪽 끝에 맞고 사진 바로 아래에 있다
    expect(photos).toHaveLength(4)
    const chips = out.elements.filter((e) => e.name.startsWith('annotation-chip-'))
    chips.forEach((chip, i) => {
      expect(chip.transform.x).toBe(photos[i].transform.x)
      expect(chip.transform.y).toBeGreaterThanOrEqual(photos[i].transform.y + photos[i].transform.height)
    })
    expect(new Set(labels.map((e) => e.groupId)).size).toBe(1)
    expect(checkMobileReadability({ sections: [asSection(out)] }).violations.filter((v) => ['M5', 'M6', 'M7'].includes(v.rule))).toEqual([])
  })

  it('별점은 입력값으로만 그린다 — 숫자가 아니면 그리지 않는다', () => {
    const t = templateOf({
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1' },
        { kind: 'rating', slot: 'rating' },
      ],
      slots: {
        headline: textSlot({ required: true }),
        rating: textSlot({ source: 'input', input: 'review.rating', facts: 1 }),
      },
    })
    const stars = (rating?: string) => named(renderTemplate(t, { headline: '제목', rating }, ctxOf())!, 'designcut-rating')
    expect(stars('4.6')[0].textProps?.content).toBe('★★★★★')
    expect(stars('3.2')[0].textProps?.content).toBe('★★★☆☆')
    expect(stars()).toHaveLength(0)
    expect(stars('많음')).toHaveLength(0)
    expect(stars('9')).toHaveLength(0)
  })

  it('치수 도면은 사진과 이름표를 그리고, 제품 경계를 모르면 치수선을 긋지 않는다(치수선은 dimension-lines.test)', () => {
    const t = templateOf({
      flow: [{ kind: 'dimension', slot: 'photo', widthSlot: 'width', heightSlot: 'height' }],
      slots: {
        photo: imageSlot({ required: true }),
        width: textSlot({ source: 'input', input: 'spec.size', facts: 1 }),
        height: textSlot({ source: 'input', input: 'spec.size', facts: 1 }),
      },
    })
    const out = renderTemplate(t, { photo: 'a', width: '가로 12cm', height: '높이 20cm' }, ctxOf())!
    expect(out.elements.filter((e) => e.name.startsWith('annotation-leader-'))).toEqual([])
    expect(named(out, 'designcut-scene')).toHaveLength(1)
    expect(out.elements.filter((e) => e.name.startsWith('annotation-label-')).map((e) => e.textProps?.content)).toEqual(['가로\u00A012cm', '높이\u00A020cm'])
    const groups = new Set(out.elements.filter((e) => e.name.startsWith('annotation-')).map((e) => e.groupId))
    expect(groups.size).toBe(1)
  })

  it('구조 라벨 외 고정 글자는 없다 — 슬롯이 비면 글자 요소가 생기지 않는다', () => {
    const out = renderTemplate(point(), { headline: '제목', photo: 'hero' }, ctxOf())!
    const shown = out.elements.flatMap((e) => (e.textProps ? [e.textProps.content] : []))
    expect(shown.sort()).toEqual(['POINT', '제목'].sort())
  })
})

describe('사진 옆 글 줄과 리플로우', () => {
  const rows = (nodes: Template['flow'] = []) =>
    templateOf({
      flow: [
        ...nodes,
        {
          kind: 'repeat',
          slot: 'items',
          rule: true,
          gap: 'blockGap',
          nodes: [{ kind: 'row', columns: [{ w: 380, nodes: [{ kind: 'text', slot: 'title', token: 'BODY' }] }, { w: 336, nodes: [{ kind: 'image', slot: 'photo' }] }] }],
        },
      ],
      slots: { items: { type: 'list', required: true, min: 2, max: 2, fields: { title: textSlot({ required: true, maxChars: 24, maxLines: 5 }), photo: imageSlot({ required: true, minHeight: 560 }) } } },
    })
  const items = { items: [{ title: '가나다라 마바사아 자차카타 파하거너', photo: 'a' }, { title: '가나다라 마바사아 자차카타 파하거너', photo: 'b' }] }
  const reflowed = (t: Template, measured: number) => {
    const section = asSection(renderTemplate(t, items, ctxOf())!)
    for (const el of section.elements) if (el.type === 'text') el.measuredHeight = measured
    reflowSectionLayout(section)
    return section.elements
  }

  it('글이 줄어도 구분선과 다음 줄이 사진을 덮지 않는다', () => {
    const els = reflowed(rows(), 60)
    const [first, second] = els.filter((el) => el.type === 'framed-image')
    const rule = els.find((el) => el.name === 'designcut-rule')!
    const firstBottom = first.transform.y + first.transform.height
    expect(rule.transform.y).toBeGreaterThanOrEqual(firstBottom)
    expect(second.transform.y).toBeGreaterThan(rule.transform.y)
  })

  it('글이 사진보다 길면 줄 높이는 글을 따른다', () => {
    const els = reflowed(rows(), 900)
    const [first] = els.filter((el) => el.type === 'framed-image')
    const rule = els.find((el) => el.name === 'designcut-rule')!
    expect(rule.transform.y).toBeGreaterThan(first.transform.y + 900)
  })

  it('상자 안의 가로 칸은 또 묶지 않는다 — 겹쳐 묶으면 아래를 두 번 민다', () => {
    const inPanel = templateOf({
      flow: [{ kind: 'panel', fill: 'N', nodes: [{ kind: 'row', columns: [{ w: 380, nodes: [{ kind: 'text', slot: 'title', token: 'BODY' }] }, { w: 256, nodes: [{ kind: 'image', slot: 'photo' }] }] }] }],
      slots: { title: textSlot({ required: true, maxChars: 24, maxLines: 5 }), photo: imageSlot({ required: true, minHeight: 340 }) },
    })
    expect(named(renderTemplate(inPanel, { title: '가나다', photo: 'a' }, ctxOf())!, 'designcut-row')).toHaveLength(0)
    expect(named(renderTemplate(rows(), items, ctxOf())!, 'designcut-row')).toHaveLength(2)
  })

  it('칸 안에 상자가 있는 가로 칸도 묶지 않는다 — 상자가 이미 아래로 높이 변화를 전한다', () => {
    const tiles = templateOf({
      flow: [
        {
          kind: 'row',
          valign: 'stretch',
          columns: [
            { w: 358, nodes: [{ kind: 'panel', fill: 'N', nodes: [{ kind: 'text', slot: 'label', token: 'BODY_BOLD', gapAfter: 'rowGap' }, { kind: 'image', slot: 'photo' }] }] },
            { w: 358, nodes: [{ kind: 'panel', fill: 'T', nodes: [{ kind: 'image', slot: 'other' }] }] },
          ],
        },
      ],
      slots: { label: textSlot({ required: true, facts: 0, maxChars: 2, maxLines: 1 }), photo: imageSlot({ required: true, minHeight: 380 }), other: imageSlot({ required: true, minHeight: 380 }) },
    })
    expect(named(renderTemplate(tiles, { label: '우리', photo: 'a', other: 'b' }, ctxOf())!, 'designcut-row')).toHaveLength(0)
  })
})

describe('비교 이름표', () => {
  const t = () =>
    templateOf({
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
        { kind: 'row', columns: [{ w: 358, nodes: [{ kind: 'label', label: '우리 제품', token: 'BODY_BOLD', color: 'accent' }] }, { w: 358, nodes: [{ kind: 'label', label: '기존 제품', token: 'BODY_BOLD' }] }] },
      ],
      slots: { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }) },
    })

  it('슬롯 없이 정해진 글자를 그리고, 나란히 놓아도 본문 2열 위반이 아니다', () => {
    const out = renderTemplate(t(), { headline: '가나다라' }, ctxOf())!
    const labels = named(out, 'annotation-label-compare')
    expect(labels.map((el) => el.textProps?.content)).toEqual(['우리 제품', '기존 제품'])
    expect(checkMobileReadability({ sections: [asSection(out, 'compare_div')] }).violations.filter((v) => v.rule === 'M6')).toEqual([])
  })

  it('이름표만으로는 필수 칸이 채워지지 않는다 — 필수 글이 비면 그리지 않는다', () => {
    expect(renderTemplate(t(), {}, ctxOf())).toBeNull()
  })
})

describe('POINT 단추 색', () => {
  it('페이지의 모든 POINT 단추가 강조색 하나다 — 번호·템플릿이 달라도 같다(오너 지시 11-01)', () => {
    const fills = templatesOf('point_div').flatMap((t) =>
      ['1', '2', '3'].flatMap((chapter) => {
        const out = renderTemplate(t, { ...sampleSlots(t, { mode: 'full' }), chapter }, ctxOf())
        return named(out!, 'designcut-capsule-bg').map((el) => el.shapeProps?.fill)
      })
    )
    expect(fills.length).toBeGreaterThanOrEqual(templatesOf('point_div').length * 3)
    expect([...new Set(fills)]).toEqual([COLORS.accent])
  })
})

describe('모바일 규칙', () => {
  const split = templateOf({
    flow: [
      { kind: 'capsule', label: 'POINT', gapAfter: 'tightGap' },
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
      {
        kind: 'row',
        columns: [
          { w: 336, nodes: [{ kind: 'image', slot: 'photo' }] },
          { w: 380, nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] },
        ],
      },
    ],
    slots: { headline: textSlot({ required: true }), photo: imageSlot({ required: true }), note: textSlot({ required: true }) },
  })

  it('사진 + 글 두 칸 템플릿이 M1·M2·M5·M6을 통과한다', () => {
    const out = renderTemplate(split, { headline: '짧은 제목', photo: 'a', note: '서른세 자 이내로 짧게 적은 설명 한 문장' }, ctxOf())!
    const { violations } = checkMobileReadability({ sections: [asSection(out)] })
    expect(violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule))).toEqual([])
  })

  it('글이 40자를 넘으면 M6이 잡는다 — 검사기가 이 규칙으로 템플릿을 거른다', () => {
    const out = renderTemplate(split, { headline: '제목', photo: 'a', note: '긴 글 '.repeat(21) }, ctxOf())!
    expect(checkMobileReadability({ sections: [asSection(out)] }).violations.map((v) => v.rule)).toContain('M6')
  })
})
