/**
 * 진행 표시(적용 K1 R-W7 구역 진행 표시·T2-52 옵션 전환 띠) — POINT 머리 캡슐 줄과 패션 옵션 띠. 이름은 모델 글·입력 그대로이고
 * 없으면 점 줄로 내려가며 짓지 않는다(오너 11-02 '값이 있을 때만'). LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { CutBuilder } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import type { PdpSpecSheet } from '../pdp-state'
import { K_TYPE, renderTemplate } from './engine'
import { ctxOf, templateOf } from './engine.fixture'
import { fillInputSlots, type LineInputs } from './input-values'
import { lintTemplate } from './lint'
import { TEMPLATES, templateById } from './library'
import { sampleContext, sampleSlots } from './sample'
import { sectionSlotValues, slotCopySections } from './section-values'
import { assignShots, type OrderedSection } from './selection-order'
import { copySlotsOf, type CopyValues } from './slot-copy'
import { STEPS, STEPS_REST_WEIGHT, drawSteps, stepsLook } from './steps'
import { POINT_STEP_SLOT, type Template } from './template-types'

type El = { name: string; groupId?: string; containerOf?: string[]; id: string; transform: { x: number; y: number; width: number; height: number }; textProps?: { content?: string; color?: string; fontWeight?: number } }
const els = (out: { elements: unknown[] }) => out.elements as El[]
const stepEls = (out: { elements: unknown[] }) => els(out).filter((e) => e.name.includes('step'))
const textsOf = (out: { elements: unknown[] }) => stepEls(out).filter((e) => e.name.startsWith('annotation-label-step')).map((e) => e.textProps?.content)
// 진행 표시는 기본 머리(point-standard)에만 — 가운데 머리(point-center, K4 T1-31)는 캡슐이 가운데라 탭을 두지 않는다(point-center.test)
const POINTS = (TEMPLATES as unknown as Template[]).filter((t) => t.section === 'point_div' && t.headStyle === 'point-standard')
const LABEL = K_TYPE.LABEL
const ink = { text: '#1A1A1A', band: '#EEEEEE', fill: '#2F6FED', onFill: '#FFFFFF', muted: '#5A5A5A', accent: '#1F4FB0', dot: '#2F6FED', radius: 999 }

describe('진행 표시 모양 고르기', () => {
  it('항목이 둘보다 적거나 지금 칸이 밖이면 그리지 않는다', () => {
    expect(stepsLook({ names: ['보습'], current: 0 }, 540, LABEL)).toBeNull()
    expect(stepsLook({ names: ['보습', '진정'], current: 2 }, 540, LABEL)).toBeNull()
    expect(stepsLook({ names: ['보습', '진정'], current: -1 }, 540, LABEL)).toBeNull()
  })

  it('이름이 모두 있고 칸에 들어가면 탭, 하나라도 없으면 지금 이름+점, 지금 이름도 없으면 점 줄', () => {
    expect(stepsLook({ names: ['보습', '진정', '순함'], current: 1 }, 540, LABEL)).toBe('tabs')
    expect(stepsLook({ names: ['보습', null, '순함'], current: 0 }, 540, LABEL)).toBe('named')
    expect(stepsLook({ names: ['보습', null, '순함'], current: 1 }, 540, LABEL)).toBe('dots')
    expect(stepsLook({ names: [null, null, null], current: 1 }, 540, LABEL)).toBe('dots')
  })

  it('이름이 칸보다 길면 자르지 않고 지금 이름+점 줄로 내려간다(1.2배 표본 5자)', () => {
    expect(stepsLook({ names: ['가나다라마', '바사아자차', '카타파하거'], current: 1 }, 537, LABEL)).toBe('named')
    expect(stepsLook({ names: ['가나다라', '바사아자', '카타파하'], current: 1 }, 537, LABEL)).toBe('tabs')
  })
})

describe('진행 표시 그리기', () => {
  it('탭은 옅은 띠 위 칸이고 지금 칸만 강조색 채움 + 굵은 onAccent 글자, 나머지는 옅은 보통 굵기 글자, 한 묶음이다', () => {
    const b = new CutBuilder()
    const bottom = drawSteps(b, { names: ['보습', '진정', '순함'], current: 1 }, { x: 260, y: 100, w: 540, band: false, group: 'g' }, ink, LABEL)
    expect(bottom).toBe(100 + STEPS.h)
    const all = els(b)
    expect(all.map((e) => e.name)).toEqual([
      'designcut-steps-band',
      'annotation-label-step-0',
      'designcut-steps-current',
      'annotation-label-step-1',
      'annotation-label-step-2',
    ])
    expect(new Set(all.map((e) => e.groupId))).toEqual(new Set(['g']))
    const [, , card, current] = all
    expect(card.containerOf).toEqual([current.id])
    expect((card as unknown as { shapeProps: { fill: string } }).shapeProps.fill).toBe(ink.fill)
    expect(current.textProps?.color).toBe(ink.onFill)
    expect(current.textProps?.fontWeight).toBe(LABEL.weight)
    for (const rest of [all[1], all[4]]) {
      expect(rest.textProps?.color).toBe(ink.muted)
      expect(rest.textProps?.fontWeight).toBe(STEPS_REST_WEIGHT)
    }
    expect(LABEL.weight).toBeGreaterThan(STEPS_REST_WEIGHT)
    // 글 상자가 지금 칸 카드 안에 든다(전수 검사 '상자 밖')
    expect(current.transform.y).toBeGreaterThanOrEqual(card.transform.y)
    expect(current.transform.y + current.transform.height).toBeLessThanOrEqual(card.transform.y + card.transform.height)
  })

  it('띠가 아니면 점 줄은 오른쪽 끝에, 지금 이름은 그 바로 왼쪽에 오른쪽 맞춤이다', () => {
    const b = new CutBuilder()
    drawSteps(b, { names: ['보습', null, '순함'], current: 0 }, { x: 260, y: 0, w: 540, band: false, group: 'g' }, ink, LABEL)
    const [name, dots] = els(b)
    expect(name.name).toBe('annotation-label-step')
    expect(dots.name).toBe('designcut-steps-dots')
    expect(dots.transform.x + dots.transform.width).toBe(800)
    expect(name.transform.x + name.transform.width).toBe(dots.transform.x - STEPS.nameGap)
  })

  it('점 줄만일 때는 띠·글이 없다 — 지금 점만 긴 알약이다', () => {
    const b = new CutBuilder()
    drawSteps(b, { names: [null, null, null], current: 2 }, { x: 260, y: 0, w: 540, band: false, group: 'g' }, ink, LABEL)
    const all = els(b)
    expect(all.map((e) => e.name)).toEqual(['designcut-steps-dots'])
    const svg = (all[0] as unknown as { svgProps: { svgString: string } }).svgProps.svgString
    expect(svg.match(/<rect /g)).toHaveLength(3)
    expect(svg).toContain(`width="${STEPS.current}" height="${STEPS.dot}" rx="${STEPS.dot / 2}" fill="${ink.dot}"`)
  })
})

describe('POINT 머리 진행 표시(R-W7)', () => {
  it('point_div 24개(household 원 사진 칸·stationery 판 깐 재질 칸·pet 본문 폭 쓰는 장면 칸·digital 모자이크 칸·공용 사진 뒤 굵은 한 줄 칸·packaging 두 장 줄 칸 더함) 모두 POINT 캡슐 줄에 진행 표시를 단다 — 머리 구조는 그대로, 소구 이름은 모델 글 4자·사실 0·선택', () => {
    expect(POINTS).toHaveLength(24)
    for (const t of POINTS) {
      expect(t.flow[0], t.id).toEqual({ kind: 'capsule', label: 'POINT', gapAfter: 'rowGap', steps: { slot: 'progress', current: 'chapter', name: POINT_STEP_SLOT } })
      expect(t.headStyle, t.id).toBe('point-standard')
      expect(t.slots.progress, t.id).toMatchObject({ type: 'list', required: false, source: 'input', input: 'point.steps', min: 2, max: 3 })
      const step = copySlotsOf(t as never).find((slot) => slot.name === POINT_STEP_SLOT)
      expect(step, t.id).toMatchObject({ name: POINT_STEP_SLOT, required: false, facts: 0, maxChars: 4, maxLines: 1 })
      expect(copySlotsOf(t as never).some((slot) => slot.name === 'progress'), t.id).toBe(false)
    }
  })

  it('진행 값이 있어도 섹션 높이가 그대로다 — 값이 없으면 진행 표시를 그리지 않는다', () => {
    for (const t of POINTS) {
      const values = sampleSlots(t, { mode: 'full' })
      const withSteps = renderTemplate(t, values, sampleContext())!
      const without = renderTemplate(t, { ...values, progress: [] }, sampleContext())!
      expect(withSteps.height, t.id).toBe(without.height)
      expect(stepEls(withSteps).length, t.id).toBeGreaterThan(0)
      expect(stepEls(without), t.id).toHaveLength(0)
      // 캡슐 줄 안(높이 64)에 든다
      const capsule = els(withSteps).find((e) => e.name === 'designcut-capsule-bg')!
      for (const e of stepEls(withSteps)) {
        expect(e.transform.y, `${t.id} ${e.name}`).toBeGreaterThanOrEqual(capsule.transform.y)
        expect(e.transform.y + e.transform.height, `${t.id} ${e.name}`).toBeLessThanOrEqual(capsule.transform.y + capsule.transform.height)
        expect(e.transform.x, `${t.id} ${e.name}`).toBeGreaterThan(capsule.transform.x + capsule.transform.width)
      }
    }
  })

  it('이 섹션 소구 이름이 지금 칸 이름보다 먼저다', () => {
    const t = templateById('point_div.scene-band') as Template
    const values = { ...sampleSlots(t, { mode: 'full' }), chapter: '2', progress: [{ name: '보습' }, { name: '진정' }, { name: '순함' }], step: '촉촉' }
    expect(textsOf(renderTemplate(t, values, sampleContext())!)).toEqual(['보습', '촉촉', '순함'])
  })
})

const inputs: LineInputs = { spec: {} as PdpSpecSheet, cards: [], options: [] }
const rowOf = (id: string): OrderedSection => {
  const t = templateById(id) as Template
  return { section: t.section, templateId: id, bg: 'W', shots: assignShots([t])[0] }
}

/** 필수 글 칸을 채운 값 — 필수 글이 빈 POINT는 안 그려져 번호·진행에서 빠진다(적용 K14) */
const fullCopyOf = (templateId: string): CopyValues => {
  const t = templateById(templateId) as Template
  return Object.fromEntries(copySlotsOf(t).filter((slot) => slot.required).map((slot) => [slot.name, slot.list ? Array.from({ length: slot.list.min }, () => Object.fromEntries(slot.list!.fields.map((field) => [field.name, '글']))) : '글'])) as CopyValues
}

describe('POINT 진행 값(사실 0·지어내지 않음)', () => {
  const sections = [rowOf('hook_3step.center-bleed'), rowOf('point_div.scene-band'), rowOf('sub_div.title-chips'), rowOf('point_div.side-card'), rowOf('point_div.tile-pair')]

  it('페이지 POINT마다 항목 하나 — 모델이 쓴 소구 이름만 싣고, 없거나 4자를 넘으면 빈 항목이다(자르지 않는다)', () => {
    const copy = new Map<number, CopyValues>([
      [1, { ...fullCopyOf(sections[1].templateId), headline: '가', step: '보습' }],
      [3, { ...fullCopyOf(sections[3].templateId), headline: '나', step: '아주촉촉한' }],
      [4, { ...fullCopyOf(sections[4].templateId), headline: '다' }],
    ])
    const values = sectionSlotValues(sections, 3, copy.get(3)!, inputs, copy)
    expect(values.chapter).toBe('2')
    expect(values.progress).toEqual([{ name: '보습' }, {}, {}])
    // 페이지 글이 없으면 이 섹션 이름만 안다
    expect(sectionSlotValues(sections, 1, copy.get(1)!, inputs).progress).toEqual([{ name: '보습' }, {}, {}])
    // POINT가 아닌 섹션은 진행 값이 없다
    expect(sectionSlotValues(sections, 2, {}, inputs, copy).progress).toBeUndefined()
  })

  it('필수 글이 빈 POINT는 안 그려지므로 탭에 이름이 남지 않고 번호도 건너뛰지 않는다(적용 K14, K2 P05·P08 탭 3·POINT 2)', () => {
    const copy = new Map<number, CopyValues>([
      [1, { ...fullCopyOf(sections[1].templateId), step: '보습' }],
      [3, { step: '남지않음' }],
      [4, { ...fullCopyOf(sections[4].templateId), step: '가벼움' }],
    ])
    const values = sectionSlotValues(sections, 4, copy.get(4)!, inputs, copy)
    expect(values.progress).toEqual([{ name: '보습' }, { name: '가벼움' }])
    expect(values.chapter).toBe('2')
    // 안 그려지는 그 POINT 자신은 번호가 없다
    expect(sectionSlotValues(sections, 3, copy.get(3)!, inputs, copy).chapter).toBeUndefined()
    // 렌더까지 — 그려진 POINT의 탭 글이 남은 POINT 이름뿐이다
    const row = sections[1]
    const template = templateById(row.templateId) as Template
    const out = renderTemplate(template, { ...sampleSlots(template, { mode: 'full' }), ...sectionSlotValues(sections, 1, copy.get(1)!, inputs, copy) }, sampleContext())!
    expect(textsOf(out)).not.toContain('남지않음')
    expect(textsOf(out)).toEqual(expect.arrayContaining(['보습', '가벼움']))
  })

  it('POINT가 하나뿐이면 진행 목록을 비운다(최소 2)', () => {
    const t = templateById('point_div.scene-band') as Template
    expect(fillInputSlots(t, inputs, 1, ['보습']).progress).toBeUndefined()
    expect(fillInputSlots(t, inputs, 1, ['보습', null]).progress).toEqual([{ name: '보습' }, {}])
  })

  it('소구 이름 규칙 줄은 step 칸이 있는 콜에만 붙는다', () => {
    const brief = { category: '생활', persona: null, summary: '', keywords: [], usps: [], pains: [] }
    const prompt = (rows: OrderedSection[]) => buildSlotCopyPrompt({ product: brief, guideline: { persona: '', tone: '' }, facts: [], sections: slotCopySections(rows) })
    const rule = `${POINT_STEP_SLOT} 칸은 그 POINT가 말하는 효익을 공백 없는 낱말 하나로 쓴다.`
    expect(prompt(sections)).toContain(rule)
    expect(prompt(sections)).toContain('사실을 새로 싣지 않는다')
    expect(prompt([rowOf('hook_3step.center-bleed'), rowOf('sub_div.title-chips')])).not.toContain(rule)
  })
})

describe('옵션 전환 띠(T2-52)', () => {
  const t = templateById('option_gallery.fashion-switch-band') as Template

  it('패션 전용 칸이고 옵션마다 띠 → 그 옵션 사진이다 — 띠의 지금 탭이 그 옵션 이름이다', () => {
    expect(t.fit.categories).toEqual(['fashion'])
    const values = { headline: '색을 골라 보세요', swatches: [{ photo: 'a', name: '블랙' }, { photo: 'b', name: '아이보리' }, { photo: 'c', name: '베이지' }] }
    const out = renderTemplate(t, values, ctxOf({ image: (key) => (key ? `https://img.test/${key}.png` : null) }))!
    const bands = els(out).filter((e) => e.name === 'designcut-steps-band')
    const current = els(out).filter((e) => e.name === 'designcut-steps-current')
    expect(bands).toHaveLength(3)
    expect(current).toHaveLength(3)
    const nameIn = (card: El) => els(out).find((e) => e.id === card.containerOf?.[0])?.textProps?.content
    expect(current.map(nameIn)).toEqual(['블랙', '아이보리', '베이지'])
    // 띠 묶음이 장식 하나다(M7)
    expect(new Set(stepEls(out).map((e) => e.groupId)).size).toBe(1)
  })

  it('이름이 띠 칸보다 길면 지금 이름+점 줄로 그린다', () => {
    const values = { headline: '색', swatches: [{ photo: 'a', name: '라이트그레이' }, { photo: 'b', name: '다크네이비' }, { photo: 'c', name: '아이보리' }] }
    const out = renderTemplate(t, values, ctxOf({ image: (key) => (key ? `https://img.test/${key}.png` : null) }))!
    expect(textsOf(out)).toEqual(['라이트그레이', '다크네이비', '아이보리'])
    expect(els(out).filter((e) => e.name === 'designcut-steps-dots')).toHaveLength(3)
  })
})

describe('지금 탭 위계 대비(통합 11-02 보완)', () => {
  // 색 조합 1,037벌을 바탕마다 칸째 그려 재는 무거운 시험이다. 한 덩어리였을 때 단독 1.8~3.3초, 넓은 실행에서 기본 5초를 넘어 시간 초과로 흔들렸다
  // (--testTimeout=1500으로 같은 'Test timed out' 재현). icons.test(#579)처럼 바탕별로 나누고 제한 시간을 둔다 — 범위(모든 컨셉 색 조합 × W·N·T·D)는 그대로다
  const base = templateById('point_div.scene-band') as Template
  const t: Template = { ...base, surfaces: ['W', 'N', 'T', 'D'] }
  const values = { ...sampleSlots(t, { mode: 'full' }), chapter: '2', progress: [{ name: '보습' }, { name: '진정' }, { name: '순함' }] }
  const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
  const sets = CONCEPTS.flatMap((concept) => colorSetsOf(concept).sets)

  it('바탕 4종·모든 컨셉 색 조합을 잰다', () => {
    expect(t.surfaces).toEqual(['W', 'N', 'T', 'D'])
    expect(sets.length).toBeGreaterThan(1000)
  })

  it.each(t.surfaces)(
    '모든 컨셉 색 조합·바탕 %s에서 지금 칸 글자는 강조색 면 위, 나머지는 띠 위 대비 4.5 이상이다',
    (bg) => {
      let low = Infinity
      let checked = 0
      for (const set of sets) {
        const out = renderTemplate(t, values, sampleContext({ colors: set.colors, bg }))!
        const shapes = els(out) as Array<El & { shapeProps?: { fill: string } }>
        const band = shapes.find((e) => e.name === 'designcut-steps-band')!.shapeProps!.fill
        const card = shapes.find((e) => e.name === 'designcut-steps-current')!
        for (const text of stepEls(out).filter((e) => e.name.startsWith('annotation-label-step'))) {
          const onCard = card.containerOf?.includes(text.id)
          const r = ratio(text.textProps!.color!, onCard ? card.shapeProps!.fill : band)
          low = Math.min(low, r)
          checked++
          expect(r, `${set.id} ${bg} ${text.name}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      // 탭 글자가 그려지지 않아 잴 것이 없으면 통과처럼 보인다 — 조합마다 탭 3개 이상을 쟀는지 본다
      expect(checked).toBeGreaterThanOrEqual(sets.length * 3)
      expect(low).toBeGreaterThanOrEqual(4.5)
    },
    60000
  )
})

describe('린트', () => {
  it('진행 표시는 반복 칸 안에만, POINT 이름 칸은 step이다', () => {
    const outside = templateOf({ flow: [{ kind: 'steps', field: 'name' }], slots: { name: { type: 'text', required: false, source: 'copy', facts: 0, maxChars: 4, maxLines: 1, claimRisk: 'none' } } })
    expect(lintTemplate(outside).map((v) => v.detail)).toContain('진행 표시(steps)는 반복 칸 안에만 — 밖에서는 목록이 없어 그리지 않는다')
    const point = templateById('point_div.scene-band') as Template
    const renamed = JSON.parse(JSON.stringify(point)) as Template
    const head = renamed.flow[0] as { steps: { name: string } }
    head.steps.name = 'headline'
    expect(lintTemplate(renamed).map((v) => v.detail)).toContain(`소구 이름 칸은 ${POINT_STEP_SLOT}(카피 프롬프트 규칙이 이 이름에 붙는다)`)
    expect(lintTemplate(point)).toEqual([])
  })
})
