/**
 * 구역 연결 표식(적용 R-W9) — 아래 여백 안에 그리고 템플릿 높이를 바꾸지 않는지, 색 대비(비텍스트 3, 못 넘으면 바탕 글자색), 여백 호흡(k-breath)
 * 뒤에도 원이 아래 끝에 붙는지, 린트 자리 규칙을 본다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { contrastRatio, isAnnotationElement, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { breatheKSeams, K_BREATH } from '@/lib/registration/editor/utils/sectionConverter/designCut/k-breath'
import { surfaceOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { textSlot, templateOf } from './engine.fixture'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { skeletonKey } from './lint-category'
import { sampleContext, sampleSlots } from './sample'
import type { FlowNode, Template } from './template-types'
import { isLinkElement, LINK, linkInk, relayoutLink } from './zone-link'

const LINE = 'designcut-link-line'
const ARROW = 'designcut-link-arrow'
const withLink = TEMPLATES.filter((t) => t.flow.at(-1)?.kind === 'link')
const drawn = (t: Template) => renderTemplate(t, sampleSlots(t, { mode: 'required' }), sampleContext())!
const withoutLink = (t: Template): Template => ({ ...t, flow: t.flow.filter((n) => n.kind !== 'link') })
const named = (els: CanvasElement[], name: string) => els.find((e) => e.name === name)

describe('자리', () => {
  it('convert_div 8칸에 있고, 풀폭 띠로 끝나는 accent-band·photo-light-band 2칸은 없다(아래 여백 0)', () => {
    expect(withLink.map((t) => t.id).sort()).toEqual(
      ['arch-center', 'bubble-center', 'check-card', 'grid-closing', 'plate-center', 'recommend-rows', 'rule-offset', 'tile-center'].map((n) => `convert_div.${n}`)
    )
    for (const id of ['convert_div.accent-band', 'convert_div.photo-light-band']) expect(templateById(id)!.flow.some((n) => n.kind === 'link')).toBe(false)
  })
})

describe('그리기', () => {
  it('높이·내용 요소는 link가 없을 때와 같고, 표식은 내용 끝 뒤 아래 여백 안·원은 끝 4px 안이다', () => {
    for (const t of withLink) {
      const out = drawn(t)
      const base = renderTemplate(withoutLink(t), sampleSlots(t, { mode: 'required' }), sampleContext())!
      expect(out.height, t.id).toBe(base.height)
      const content = out.elements.filter((e) => !isLinkElement(e))
      expect(content.length, t.id).toBe(base.elements.length)
      const end = Math.max(...content.map((e) => e.transform.y + e.transform.height))
      const [line, arrow] = [named(out.elements, LINE)!, named(out.elements, ARROW)!]
      expect(arrow.transform.y + arrow.transform.height, t.id).toBe(out.height - LINK.inset)
      expect(line.transform.y, t.id).toBe(end + LINK.gap)
      expect(line.transform.y + line.transform.height + LINK.lineGap, t.id).toBe(arrow.transform.y)
      expect(line.transform.height, t.id).toBeGreaterThanOrEqual(LINK.minLine)
      // 가운데·한 묶음
      expect(arrow.transform.x + arrow.transform.width / 2).toBe(430)
      expect(line.groupId).toBe(arrow.groupId)
    }
  })

  it('뼈대 키(같은 뼈대 반복·화면 단계 검사)에 들지 않는다 — 표식 하나로 다른 뼈대가 되지 않는다', () => {
    for (const t of withLink) expect(skeletonKey(t.flow), t.id).toBe(skeletonKey(withoutLink(t).flow))
  })

  it('폰 390(860의 0.45배)에서 원 약 25px·원 테두리와 꺾쇠 약 1.5px이고, 원+끝 4px는 가장 좁은 여백 88 안이다', () => {
    const phone = 390 / 860
    expect(Math.abs(LINK.arrow * phone - 25)).toBeLessThan(0.5)
    expect(Math.abs(LINK.stroke * phone - 1.5)).toBeLessThan(0.05)
    expect(LINK.gap + LINK.arrow + LINK.inset).toBeLessThanOrEqual(K_BREATH.narrow)
    const out = drawn(withLink[0]).elements
    const [line, arrow] = [named(out, LINE)!, named(out, ARROW)!]
    expect([arrow.transform.width, arrow.transform.height]).toEqual([LINK.arrow, LINK.arrow])
    expect(arrow.svgProps!.svgString.match(/stroke-width="([\d.]+)"/g)).toEqual([`stroke-width="${LINK.stroke}"`, `stroke-width="${LINK.stroke}"`])
    expect(line.transform.width).toBe(LINK.line)
    expect(line.svgProps!.svgString).toContain(`stroke-width="${LINK.line}"`)
    expect(line.svgProps!.svgString).toContain(`stroke-dasharray="0.1 ${LINK.dot}"`)
  })

  it('강조 장식(M7)으로 세지 않는다', () => {
    for (const e of drawn(withLink[0]).elements.filter(isLinkElement)) expect(isAnnotationElement(e)).toBe(false)
  })

  it('풀폭으로 끝나 아래 여백이 없으면 그리지 않는다', () => {
    const t = templateOf({
      id: 'convert_div.link-bleed',
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1' },
        { kind: 'panel', fill: 'D', bleed: true, nodes: [{ kind: 'text', slot: 'note', token: 'BODY' }] },
        { kind: 'link' },
      ],
      slots: { headline: textSlot({ required: true }), note: textSlot({ required: true }) },
    })
    const out = renderTemplate(t, { headline: '제목', note: '설명' }, sampleContext())!
    expect(out.elements.some(isLinkElement)).toBe(false)
  })
})

describe('색 — 비텍스트 대비 3, 못 넘으면 바탕 글자색', () => {
  it('모든 컨셉 색 조합 × W·N·T·D에서 표식 색은 바탕 대비 3 이상이고, 대체(바탕 글자색)가 실제로 일어나는 조합이 있다', () => {
    let fallbacks = 0
    let accents = 0
    for (const concept of CONCEPTS) {
      for (const set of colorSetsOf(concept).sets) {
        for (const bg of ['W', 'N', 'T', 'D'] as const) {
          const surf = surfaceOf(bg, set.colors)
          const ink = linkInk(surf, set.colors.accent)
          expect(contrastRatio(parseColor(ink)!, parseColor(surf.fill)!), `${concept.id} ${bg}`).toBeGreaterThanOrEqual(3)
          if (ink === set.colors.accent) accents += 1
          else {
            expect(ink).toBe(surf.text)
            fallbacks += 1
          }
        }
      }
    }
    expect(accents).toBeGreaterThan(0)
    expect(fallbacks).toBeGreaterThan(0)
  })

  it('강조색이 바탕과 거의 같으면 바탕 글자색으로 바꾼다(숨기지 않는다)', () => {
    expect(linkInk({ fill: '#FFFFFF', text: '#1A1A1A' }, '#FAFAFA')).toBe('#1A1A1A')
    expect(linkInk({ fill: '#FFFFFF', text: '#1A1A1A' }, '#2B6CD9')).toBe('#2B6CD9')
  })
})

describe('여백 호흡 뒤 다시 붙이기', () => {
  const kSection = (t: Template): CanvasSection => {
    const out = drawn(t)
    return { id: t.id, sectionType: t.section, groupType: 'modules', order: 0, isVisible: true, layoutId: `designcut_k_${t.id}`, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements } as unknown as CanvasSection
  }
  const contentTail = (s: CanvasSection) => s.canvas.height - Math.max(...s.elements.filter((e) => !isLinkElement(e) && e.isVisible !== false && e.transform.height > 0).map((e) => e.transform.y + e.transform.height))
  const next = (zone: string) => TEMPLATES.find((t) => t.order.zone === zone && t.surfaces.includes('W') && t.section !== 'convert_div' && t.flow.at(-1)?.kind !== 'link')!

  it('빈 여백은 link를 빼고 재므로 단계 값이 그대로이고, 원은 새 끝 4px 안·점선은 원 위까지다', () => {
    const t = withLink.find((x) => x.surfaces.includes('W'))!
    for (const zone of ['decision', 'trust']) {
      const [a] = breatheKSeams([kSection(t), kSection(next(zone))])
      const want = zone === t.order.zone ? K_BREATH.normal : K_BREATH.wide
      expect(contentTail(a), zone).toBe(want)
      const [line, arrow] = [named(a.elements, LINE)!, named(a.elements, ARROW)!]
      expect(arrow.transform.y + arrow.transform.height).toBe(a.canvas.height - LINK.inset)
      expect(line.isVisible).not.toBe(false)
      expect(line.transform.y + line.transform.height + LINK.lineGap).toBe(arrow.transform.y)
      expect(line.svgProps!.svgString).toContain(`height="${line.transform.height}"`)
    }
  })

  it('좁음 88에서도 원+4px가 들어가고(점선은 8 미만이라 숨김), 점선은 8 이상일 때만 보인다', () => {
    const sec = kSection(withLink[0])
    const end = sec.canvas.height - contentTail(sec)
    const narrow = relayoutLink({ ...sec, canvas: { ...sec.canvas, height: end + K_BREATH.narrow } })
    const arrow = named(narrow.elements, ARROW)!
    expect(arrow.isVisible).not.toBe(false)
    expect(arrow.transform.y).toBeGreaterThanOrEqual(end + LINK.gap)
    expect(arrow.transform.y + arrow.transform.height).toBe(narrow.canvas.height - LINK.inset)
    expect(named(narrow.elements, LINE)!.isVisible).toBe(false)
    const edge = end + LINK.gap + LINK.minLine + LINK.lineGap + LINK.arrow + LINK.inset
    const shown = relayoutLink({ ...sec, canvas: { ...sec.canvas, height: edge } })
    expect(named(shown.elements, LINE)!.isVisible).not.toBe(false)
    expect(named(shown.elements, LINE)!.transform.height).toBe(LINK.minLine)
    const tight = relayoutLink({ ...sec, canvas: { ...sec.canvas, height: edge - 1 } })
    expect(named(tight.elements, LINE)!.isVisible).toBe(false)
    expect(named(tight.elements, ARROW)!.isVisible).not.toBe(false)
  })

  it('표식이 없는 섹션은 그대로다', () => {
    const plain = kSection(next('trust'))
    expect(relayoutLink(plain)).toBe(plain)
  })
})

describe('린트', () => {
  const base = (flow: FlowNode[], over: Partial<Template> = {}) =>
    templateOf({ id: 'convert_div.link-lint', flow, slots: { headline: textSlot({ required: true }) }, ...over })
  const head: FlowNode = { kind: 'text', slot: 'headline', token: 'H1' }
  const details = (t: Template) => lintTemplate(t).filter((v) => v.detail.includes('구역 연결')).map((v) => v.detail)

  it('맨 끝 하나·아래 여백 120 이상이면 위반이 없다', () => {
    expect(details(base([head, { kind: 'link' }]))).toEqual([])
  })

  it('맨 끝이 아니거나 둘 이상·안쪽·gapAfter·아래 여백 부족·앞이 풀폭이면 위반이다', () => {
    expect(details(base([{ kind: 'link' }, head]))).toHaveLength(1)
    expect(details(base([head, { kind: 'link' }, { kind: 'link' }]))).toHaveLength(1)
    expect(details(base([{ kind: 'panel', fill: 'T', nodes: [head, { kind: 'link' }] }, { kind: 'link' }]))).toHaveLength(1)
    expect(details(base([head, { kind: 'link', gapAfter: 'itemGap' }]))).toHaveLength(1)
    const t = base([head, { kind: 'link' }])
    expect(details({ ...t, spacing: { ...t.spacing, bottom: 100 } })).toHaveLength(1)
    expect(details(base([head, { kind: 'panel', fill: 'D', bleed: true, nodes: [] }, { kind: 'link' }]))).toHaveLength(1)
  })
})
