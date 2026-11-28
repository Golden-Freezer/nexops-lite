import { describe, expect, it } from 'vitest'
import { buildSlotCopyPrompt, type SlotCopySection } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { PdpSpecSheet } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { ctxOf, templateOf, textSlot } from './engine.fixture'
import { iconChoices, iconFragment, ICON_NAME_MAX, ICON_NAMES, ICON_SIZES, isIconName } from './icons'
import { TEMPLATES } from './library'
import { lintTemplate } from './lint'
import { skeletonKey } from './lint-category'
import { mockSlots } from './mock'
import { sampleContext, sampleSlots } from './sample'
import { checkCopyValues, copySlotsOf, readCopyValues } from './slot-copy'
import type { FlowNode, SurfaceName, Template } from './template-types'

/** 기준 값은 시험에 고정한다 — 코드 상수를 가져오면 변이를 못 잡는다 */
const MIN_CONTRAST = 3
const SIZES = [96, 128, 160]
const iconSlot = textSlot({ choices: 'icon', facts: 0, maxChars: 7, maxLines: 1 })
const SURFACES: SurfaceName[] = ['W', 'N', 'T', 'D', 'P']
const flowOf = (over: Partial<Extract<FlowNode, { kind: 'icon' }>> = {}): FlowNode[] => [{ kind: 'icon', slot: 'icon', size: 128, ...over }]
const iconTemplate = (over: Partial<Extract<FlowNode, { kind: 'icon' }>> = {}, section: Template['section'] = 'sub_div'): Template =>
  templateOf({ id: `${section}.icon-test`, section, surfaces: SURFACES, flow: flowOf(over), slots: { icon: iconSlot } })
const render = (t: Template, value: string, ctx = ctxOf()) => renderTemplate(t, { icon: value }, ctx)!
const drawn = (t: Template, value: string, ctx = ctxOf()) => render(t, value, ctx).elements
const named = (elements: CanvasElement[], name: string) => elements.filter((e) => e.name === name)

describe('아이콘 사전', () => {
  it('이름마다 선 그림 조각이 있다', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(12)
    for (const name of ICON_NAMES) {
      expect(iconFragment(name), name).toMatch(/^<(path|circle|rect|line|polyline|polygon|ellipse) /)
      expect(iconFragment(name), name).not.toMatch(/<script|on\w+=|href=/)
    }
  })

  it('인증·안전·효능을 암시하는 그림은 넣지 않는다', () => {
    for (const banned of ['shield', 'shieldCheck', 'safe', 'safety', 'badge', 'certified', 'award', 'medal', 'heart', 'pill', 'medical', 'star', 'leaf', 'health']) {
      expect(isIconName(banned), banned).toBe(false)
    }
  })

  it('없는 이름과 객체 기본 속성은 그림이 없다', () => {
    for (const name of ['', 'nope', 'constructor', 'toString', '__proto__', 'WATER']) expect(iconFragment(name), name).toBeNull()
  })

  it('이름 상한과 크기 3종이 정해져 있다', () => {
    expect(ICON_NAME_MAX).toBe(7)
    expect([...ICON_SIZES]).toEqual(SIZES)
  })
})

describe('아이콘 그리기', () => {
  it('아는 이름만 그린다 — 빈 값·모르는 이름은 요소 없음, 높이도 안 쓴다', () => {
    const t = templateOf({
      id: 'sub_div.icon-test',
      flow: [{ kind: 'text', slot: 'title', token: 'BODY' }, ...flowOf({ disc: true })],
      slots: { title: textSlot(), icon: iconSlot },
    })
    const out = (icon: string | undefined) => renderTemplate(t, { title: '글', ...(icon === undefined ? {} : { icon }) }, ctxOf())!
    expect(named(out('water').elements, 'designcut-icon')).toHaveLength(1)
    expect(named(out('water').elements, 'designcut-icon-disc')).toHaveLength(1)
    for (const value of [undefined, '', 'nope']) {
      expect(named(out(value).elements, 'designcut-icon'), String(value)).toHaveLength(0)
      expect(named(out(value).elements, 'designcut-icon-disc'), String(value)).toHaveLength(0)
      expect(out(value).height, String(value)).toBeLessThan(out('water').height)
    }
    // 그릴 것이 아이콘뿐인데 값이 없으면 칸 자체가 없다
    expect(renderTemplate(iconTemplate(), { icon: 'nope' }, ctxOf())).toBeNull()
  })

  it('원 바탕은 크기대로, 그림은 안쪽 여백만큼 작게 그린다', () => {
    const [disc] = named(drawn(iconTemplate({ disc: true, size: 160 }), 'water'), 'designcut-icon-disc')
    const [icon] = named(drawn(iconTemplate({ disc: true, size: 160 }), 'water'), 'designcut-icon')
    expect(disc.transform.width).toBe(160)
    expect(disc.transform.height).toBe(160)
    expect(icon.transform.width).toBeLessThan(160)
    expect(named(drawn(iconTemplate({ size: 96 }), 'water'), 'designcut-icon-disc')).toHaveLength(0)
  })

  it('가운데 정렬은 칸 가운데, 기본은 왼쪽이다', () => {
    const xOf = (align?: 'left' | 'center') => named(drawn(iconTemplate({ align, size: 96 }), 'water'), 'designcut-icon')[0].transform.x
    expect(xOf('center')).toBe(60 + Math.round((740 - 96) / 2))
    expect(xOf()).toBe(60)
  })

  it('전 색 조합·바탕에서 대비가 3 이상이다 — 그려진 색으로 잰다', () => {
    const sets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)
    expect(sets.length).toBeGreaterThan(1000)
    for (const set of sets) {
      for (const bg of SURFACES) {
        const ctx = ctxOf({ colors: set.colors, bg })
        for (const disc of [false, true]) {
          const out = render(iconTemplate({ disc }), 'water', ctx)
          const ink = /stroke="([^"]+)"/.exec(named(out.elements, 'designcut-icon')[0].svgProps!.svgString)![1]
          const fill = disc ? named(out.elements, 'designcut-icon-disc')[0].shapeProps!.fill! : out.background
          expect(contrastRatio(parseColor(ink)!, parseColor(fill)!), `${set.id} ${bg} disc=${disc}`).toBeGreaterThanOrEqual(MIN_CONTRAST)
        }
      }
    }
  })
})

describe('아이콘 린트', () => {
  const details = (t: Template) => lintTemplate(t).map((v) => v.detail).join('|')

  it('칸은 choices icon이어야 하고, 크기는 3종만, 칸 폭을 넘으면 안 된다', () => {
    expect(details(templateOf({ id: 'sub_div.x', flow: flowOf(), slots: { icon: textSlot() } }))).toContain('choices icon')
    expect(details(iconTemplate({ size: 100 }))).toContain('아이콘 크기 100')
    const narrow = templateOf({ id: 'sub_div.y', flow: [{ kind: 'row', columns: [{ w: 88, nodes: flowOf({ size: 96 }) }, { w: 628, nodes: [] }] }], slots: { icon: iconSlot } })
    expect(details(narrow)).toContain('칸 폭 88px를 넘음')
  })

  it('아이콘 이름을 글로 찍지 못한다', () => {
    expect(details(templateOf({ id: 'sub_div.z', flow: [{ kind: 'text', slot: 'icon', token: 'BODY' }], slots: { icon: iconSlot } }))).toContain('아이콘 이름을 글로 찍음')
  })

  it('첫 화면에는 쓸 수 없다', () => {
    expect(details(iconTemplate({}, 'hook_3step'))).toContain('첫 화면에 icon 금지')
  })

  it('뼈대에 아이콘이 드러나 사진 칸과 구분된다', () => {
    expect(skeletonKey(flowOf())).toBe('icon')
  })
})

describe('아이콘 칸 글', () => {
  const template = { section: 'sub_div', slots: { icon: { type: 'text', required: true, source: 'copy', facts: 0, maxChars: 7, maxLines: 1, choices: 'icon' }, memo: { type: 'text', required: false, source: 'copy', facts: 1, maxChars: 20 } } } as never
  const rows = {
    section: 'sub_div',
    slots: { items: { type: 'list', required: true, min: 2, max: 3, fields: { icon: { type: 'text', required: true, source: 'copy', facts: 0, choices: 'icon' }, title: { type: 'text', required: true, source: 'copy', facts: 1 } } } },
  } as never
  const spec = { material: '면' } as unknown as PdpSpecSheet

  it('사전 밖 값은 읽을 때 버린다', () => {
    const slots = copySlotsOf(template)
    expect(readCopyValues(slots, { icon: 'water', memo: '글' })).toEqual({ icon: 'water', memo: '글' })
    expect(readCopyValues(slots, { icon: '방패', memo: '글' })).toEqual({ memo: '글' })
    expect(readCopyValues(slots, { icon: 'constructor' })).toEqual({})
  })

  it('필수 아이콘이 사전 밖이면 빠진 칸으로 고치기 콜에 간다', () => {
    const slots = copySlotsOf(template)
    const problems = checkCopyValues(slots, readCopyValues(slots, { icon: '방패' }), spec)
    expect(problems.map((p) => `${p.slot}:${p.kind}`)).toContain('icon:missing')
  })

  it('목록 항목의 아이콘이 사전 밖이면 그 항목을 버린다', () => {
    const slots = copySlotsOf(rows)
    expect(readCopyValues(slots, { items: [{ icon: 'water', title: '방수' }, { icon: '방패', title: '안전' }] })).toEqual({ items: [{ icon: 'water', title: '방수' }] })
  })

  it('아이콘 이름은 글 검사를 받지 않는다 — 글자 수·숫자·규제 낱말과 무관하다', () => {
    const inList = copySlotsOf(rows)
    const listValues = readCopyValues(inList, { items: [{ icon: 'water', title: '방수' }, { icon: 'carry', title: '휴대' }] })
    expect(checkCopyValues(inList, listValues, spec).filter((p) => p.slot.endsWith('.icon'))).toEqual([])
    // 글자 수 상한이 이름보다 짧아도 글로 재지 않는다 — 칸 하나·목록 칸 모두
    const tight = (slots: ReturnType<typeof copySlotsOf>) => slots.map((s) => ({ ...s, maxChars: 1, list: s.list ? { ...s.list, fields: s.list.fields.map((f) => (f.choices ? { ...f, maxChars: 1 } : f)) } : undefined }))
    expect(checkCopyValues(tight(copySlotsOf(template)), { icon: 'water' }, spec).filter((p) => p.slot === 'icon')).toEqual([])
    expect(checkCopyValues(tight(inList), listValues, spec).filter((p) => p.slot.endsWith('.icon'))).toEqual([])
  })

  const input = { product: { category: 'x', usps: [], pains: [] }, guideline: { persona: '', tone: '' }, facts: ['방수'] } as never as Parameters<typeof buildSlotCopyPrompt>[0]
  const section = (slots: SlotCopySection['slots']): SlotCopySection => ({ index: 0, section: 'sub_div', factSlots: 1, slots })

  it('아이콘 칸이 있는 콜에만 이름 목록과 지어내기 금지가 붙는다 — 다른 페이지 프롬프트는 그대로다', () => {
    const plain = buildSlotCopyPrompt({ ...input, sections: [section(copySlotsOf({ section: 'sub_div', slots: { memo: { type: 'text', required: false, source: 'copy', facts: 1 } } } as never))] })
    expect(plain).not.toContain('아이콘')
    for (const t of [template, rows]) {
      const prompt = buildSlotCopyPrompt({ ...input, sections: [section(copySlotsOf(t))] })
      expect(prompt).toContain(iconChoices())
      expect(prompt).toContain('입력에 없는 기능을 아이콘으로 말하지 않는다')
      expect(prompt).toContain('icon(필수, 아이콘 이름 하나, 사실 없음)')
    }
  })
})

describe('아이콘 템플릿', () => {
  const ids = ['point_list_div.icon-trio', 'point_list_div.icon-grid', 'sub_div.icon-rows']

  it('라이브러리에 있고 전수 검사를 지나며 표본에 아이콘이 그려진다', () => {
    for (const id of ids) {
      const t = TEMPLATES.find((x) => x.id === id)!
      expect(t, id).toBeDefined()
      expect(lintTemplate(t), id).toEqual([])
      const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext())!
      const icons = named(out.elements, 'designcut-icon').map((e) => e.svgProps!.svgString)
      expect(icons.length, id).toBeGreaterThanOrEqual(2)
      // 표본·목업은 항목마다 다른 그림이다
      expect(new Set(icons).size, id).toBe(icons.length)
      const mock = renderTemplate(t, mockSlots(t), sampleContext())!
      const mockIcons = named(mock.elements, 'designcut-icon').map((e) => e.svgProps!.svgString)
      expect(mockIcons.length, id).toBeGreaterThanOrEqual(2)
      expect(new Set(mockIcons).size, id).toBe(mockIcons.length)
    }
  })

  // 색 조합 1,040개(서로 다른 색 1,036)를 칸마다 그려 재는 무거운 시험이다. 한 덩어리였을 때 단독 2.2초, 넓은 실행에서 기본 5초를 넘어
  // 시간 초과로 흔들렸다. 템플릿별로 나누고 다른 전수 시험처럼 제한 시간을 둔다(범위는 그대로)
  it.each(ids)(
    '전 색 조합에서 실제 칸의 아이콘 대비가 3 이상이다 — %s',
    (id) => {
      const sets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)
      expect(sets.length).toBeGreaterThan(1000)
      const t = TEMPLATES.find((x) => x.id === id)!
      let measured = 0
      for (const set of sets) {
        for (const bg of t.surfaces) {
          const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext({ colors: set.colors, bg }))!
          const discs = named(out.elements, 'designcut-icon-disc')
          named(out.elements, 'designcut-icon').forEach((icon, i) => {
            const ink = /stroke="([^"]+)"/.exec(icon.svgProps!.svgString)![1]
            const fill = discs.length ? discs[i].shapeProps!.fill! : out.background
            expect(contrastRatio(parseColor(ink)!, parseColor(fill)!), `${id} ${set.id} ${bg}`).toBeGreaterThanOrEqual(MIN_CONTRAST)
            measured += 1
          })
        }
      }
      // 아이콘이 그려지지 않아 잴 것이 없으면 통과처럼 보인다 — 조합마다 2개 이상을 쟀는지 본다
      expect(measured).toBeGreaterThanOrEqual(sets.length * t.surfaces.length * 2)
    },
    60000
  )

  it('아이콘 칸은 사실 예산을 쓰지 않는다', () => {
    for (const id of ids) {
      const t = TEMPLATES.find((x) => x.id === id)!
      const defs = Object.values(t.slots).flatMap((s) => (s.type === 'list' ? Object.values(s.fields) : [s]))
      for (const def of defs) if (def.type === 'text' && def.choices) expect(def.facts, id).toBe(0)
    }
  })
})
