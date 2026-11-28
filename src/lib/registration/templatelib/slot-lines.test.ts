/**
 * 칸 폭·끝 줄 — 폭은 실제 렌더와 대조한다(흐름 계산이 엔진과 어긋나면 줄 수 검사가 틀린다).
 */

import { describe, expect, it } from 'vitest'
import { keepFactUnits } from '../editor/utils/sectionConverter/designCut/build'
import { K_TYPE, renderTemplate } from './engine'
import { TEMPLATES } from './library'
import { mockSlots } from './mock'
import { copySlotsOf, checkCopyValues, dropProblemValues, dropsText, asksFix } from './slot-copy'
import { isOrphanLine, lastLineOf, lineCharsOf, slotLinesOf } from './slot-lines'
import type { FlowNode } from './template-types'
import { colorsOf } from '../editor/utils/sectionConverter/designCut/tokens'
import type { PdpSpecSheet } from '../pdp-state'

const text = (slot: string, over: Record<string, unknown> = {}) => ({ kind: 'text', slot, token: 'BODY', ...over })

describe('slotLinesOf', () => {
  it('칸 폭 — 기본·직접 지정·행·판·반복·사진 위 글', () => {
    const flow = [
      text('a'),
      text('b', { w: 300 }),
      { kind: 'row', columns: [{ w: 358, nodes: [text('c', { token: 'H3' })] }] },
      { kind: 'panel', fill: 'C', nodes: [text('d')] },
      { kind: 'panel', fill: 'C', bleed: true, nodes: [text('e')] },
      { kind: 'repeat', slot: 'items', columns: 2, nodes: [text('title')] },
      { kind: 'image', slot: 'p', bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [text('over')] } },
    ] as unknown as FlowNode[]
    const lines = slotLinesOf(flow)
    expect(lines.get('a')).toEqual({ token: 'BODY', width: 740 })
    expect(lines.get('b')?.width).toBe(300)
    expect(lines.get('c')).toEqual({ token: 'H3', width: 358 })
    expect(lines.get('d')?.width).toBe(660)
    expect(lines.get('e')?.width).toBe(740)
    expect(lines.get('items.title')?.width).toBe(358)
    expect(lines.get('over')?.width).toBe(740)
  })

  it('같은 칸을 두 노드가 쓰면 좁은 쪽이다', () => {
    expect(slotLinesOf([text('a'), text('a', { w: 200 }), text('a', { w: 500 })] as unknown as FlowNode[]).get('a')?.width).toBe(200)
  })

  it('실제 라이브러리 전수 — 렌더된 글자 상자 폭이 흐름 계산과 같다', () => {
    const colors = colorsOf({ palette: { accent: '#335544', accentText: '#335544', deep: '#223322', tint: '#EEF2EE', ink: '#111111', mode: 'color' }, motif: { badge: 'SOFT' } } as never)
    let compared = 0
    const wrong: string[] = []
    for (const template of TEMPLATES) {
      const lines = slotLinesOf(template.flow as readonly FlowNode[])
      const widths = new Map<string, number[]>()
      for (const [key, line] of lines) {
        const name = key.split('.').at(-1) as string
        widths.set(name, [...(widths.get(name) ?? []), line.width])
      }
      const result = renderTemplate(template, mockSlots(template), { colors, radius: 16 as never, image: () => 'https://x/a.png', bg: template.surfaces[0] } as never)
      if (!result) continue
      for (const element of result.elements as Array<{ name?: string; transform: { width: number } }>) {
        const slot = /^designcut-(.+)$/.exec(element.name ?? '')?.[1]
        const known = slot ? widths.get(slot) : undefined
        if (!known) continue
        compared++
        if (!known.includes(element.transform.width)) wrong.push(`${template.id} ${slot} 렌더 ${element.transform.width} 계산 ${known.join('/')}`)
      }
    }
    expect(compared).toBeGreaterThan(300)
    expect(wrong).toEqual([])
  })
})

describe('끝 줄', () => {
  const body = K_TYPE.BODY

  it('한 줄이면 끝 줄 판정이 없고, 두 줄이면 끝 줄 글을 돌려준다', () => {
    expect(lastLineOf('짧은 글', body, 740)).toBeNull()
    expect(lastLineOf('가나다라마바사아자차 가나다라마바사아자차 가나다', body, 52 * 10 + 1)).toBe('가나다')
  })

  it('3자 이하 끝 줄만 외톨이다 — 공백은 세지 않는다', () => {
    const width = 52 * 10 + 1
    expect(isOrphanLine('가나다라마바사아자차 끝이다', body, width)).toBe(true)
    expect(isOrphanLine('가나다라마바사아자차 끝이 났다', body, width)).toBe(false)
    expect(isOrphanLine('가나다라마바사아자차 끝이었다', body, width)).toBe(false)
  })

  it('모델이 \\n으로 끊은 마지막 문단만 본다', () => {
    expect(isOrphanLine('가나다라마바사아자차\n끝', body, 740)).toBe(false)
  })

  it('치수는 묶인 채로 잰다 — 값만 끝 줄에 남지 않는다', () => {
    const width = 52 * 10 + 1
    expect(lastLineOf('가나다라마바사아자차 깊이 5cm', body, width)).toBe('깊이 5cm')
  })

  it('한 줄 글자 수 어림', () => {
    expect(lineCharsOf(K_TYPE.BODY, 380)).toBe(7)
    expect(lineCharsOf(K_TYPE.BODY, 740)).toBe(14)
  })
})

describe('치수 묶기', () => {
  it('이름과 값, 곱 표기를 줄바꿈 없는 공백으로 묶고 글자는 그대로다', () => {
    expect(keepFactUnits('깊이 5cm')).toBe('깊이 5cm')
    expect(keepFactUnits('30 x 20cm')).toBe('30 x 20cm')
    expect(keepFactUnits('가로 30 x 세로 40cm')).toBe('가로 30 x 세로 40cm')
    expect(keepFactUnits('30x20 cm')).toBe('30x20 cm')
    expect(keepFactUnits('가로 30 x 세로 40 x 높이 10cm').replace(/ /g, ' ')).toBe('가로 30 x 세로 40 x 높이 10cm')
  })

  it('너무 긴 곱 표기는 x에서 끊을 수 있게 둔다 — 좁은 칸에서 넘치지 않게', () => {
    const shown = keepFactUnits('가로 30 x 세로 40 x 높이 10cm')
    expect(shown).toContain(' x ')
    expect(shown).toContain('가로 30')
  })

  it('치수가 아닌 말은 건드리지 않는다', () => {
    expect(keepFactUnits('높이 조절이 쉬워요')).toBe('높이 조절이 쉬워요')
    expect(keepFactUnits('폭넓은 쓰임 2 가지')).toBe('폭넓은 쓰임 2 가지')
    expect(keepFactUnits('Box 2 x large')).toBe('Box 2 x large')
  })
})

describe('copySlotsOf·checkCopyValues — 전 칸 줄 수', () => {
  const spec = { certificationInfo: '' } as unknown as PdpSpecSheet
  const template = {
    section: 'point_div',
    flow: [
      { kind: 'text', slot: 'headline', token: 'H2' },
      { kind: 'repeat', slot: 'items', columns: 2, nodes: [{ kind: 'text', slot: 'body', token: 'BODY' }] },
    ],
    slots: {
      headline: { type: 'text', required: true, source: 'copy', facts: 0, maxChars: 40, maxLines: 1 },
      items: { type: 'list', required: false, source: 'copy', min: 2, max: 2, fields: { body: { type: 'text', required: true, source: 'copy', facts: 0, maxChars: 40, maxLines: 2 } } },
    },
  } as never

  it('흐름이 있으면 칸·목록 칸에 토큰과 폭을 싣고, 없으면 예전과 같다', () => {
    const slots = copySlotsOf(template)
    expect(slots[0]).toMatchObject({ lineToken: 'H2', lineWidth: 740 })
    expect(slots[0].strictLines).toBeUndefined()
    expect(slots[1].list?.fields[0]).toMatchObject({ lineToken: 'BODY', lineWidth: 358 })
    const bare = copySlotsOf({ ...(template as object), flow: undefined } as never)
    expect(bare[0].lineToken).toBeUndefined()
  })

  it('줄 수 초과는 lines로 잡고 글을 지우지 않는다. 첫 화면 칸만 length로 지운다', () => {
    const slots = copySlotsOf(template)
    const long = '가나다라마바사아자 차카타파하가나다라 마바사아자차카'
    const problems = checkCopyValues(slots, { headline: long }, spec)
    const over = problems.find((p) => p.slot === 'headline' && p.kind === 'lines')
    expect(over?.detail).toMatch(/2줄|3줄/)
    expect(dropsText('lines')).toBe(false)
    expect(dropProblemValues({ headline: long }, problems).headline).toBe(long)
    const hook = copySlotsOf({ ...(template as object), section: 'hook_3step' } as never)
    expect(hook[0]).toMatchObject({ strictLines: true, lineToken: 'HOOK', lineWidth: 740 })
    // 글자 수 상한(12자) 안이어도 줄 수를 넘기면 첫 화면은 length다
    const hookProblems = checkCopyValues(hook, { headline: '가나다라 마바사아 자차카타' }, spec)
    expect(hookProblems).toContainEqual({ slot: 'headline', kind: 'length', detail: '3줄(상한 2줄)' })
  })

  it('목록 칸 줄 수도 잰다', () => {
    const slots = copySlotsOf(template)
    // 칸 폭 358이라 넘친다. 전체 폭 740이면 2줄이라 폭을 안 보면 못 잡는다
    const problems = checkCopyValues(slots, { headline: '짧은 제목', items: [{ body: '가나다라마바 사아자차카타 파하가나다라 마바사아자차' }] }, spec)
    expect(problems.some((p) => p.slot === 'items.body' && p.kind === 'lines')).toBe(true)
  })

  it('외톨이 줄은 기록만 — 고치기 콜을 부르지 않고 지우지도 않는다', () => {
    const slots = copySlotsOf(template)
    const orphaned = '가나다라마바사아자차 끝'
    const problems = checkCopyValues(slots, { headline: orphaned }, spec).filter((p) => p.kind === 'orphan')
    expect(problems).toHaveLength(1)
    expect(asksFix('orphan')).toBe(false)
    expect(asksFix('lines')).toBe(true)
    expect(dropProblemValues({ headline: orphaned }, problems).headline).toBe(orphaned)
  })

  it('규제 표현은 여전히 지운다', () => {
    expect(dropsText('claim')).toBe(true)
    expect(dropsText('length')).toBe(true)
    expect(dropsText('number')).toBe(true)
  })
})
