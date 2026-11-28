/**
 * K 여백 호흡 3단계(K9 개선 #11) — K–K 경계를 좁음 88·보통 120·넓음 150으로 맞춘다. 띠·사진이 끝에 닿은 쪽은 그대로, K가 아닌 섹션과의 경계도 그대로. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { renderTemplate } from '@/lib/registration/templatelib/engine'
import { TEMPLATES, templateById } from '@/lib/registration/templatelib/library'
import { sampleContext, sampleSlots } from '@/lib/registration/templatelib/sample'
import { breathLevel, breatheKSeams, K_BREATH, K_SEAM_MAX } from './k-breath'

/** 실제 템플릿을 표본 글(필수만)로 그린 K 섹션 */
const kSection = (id: string): CanvasSection => {
  const t = templateById(id)!
  const out = renderTemplate(t, sampleSlots(t, { mode: 'required' }), sampleContext())!
  return { id, sectionType: 'x', groupType: 'modules', order: 0, isVisible: true, layoutId: `designcut_k_${id}`, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements } as unknown as CanvasSection
}
const blank = (sec: CanvasSection) => {
  const content = sec.elements.filter((e) => e.transform.height > 0 && !(e.type === 'shape' && e.transform.width >= 688 && e.transform.height >= sec.canvas.height * 0.8))
  return { head: Math.min(...content.map((e) => e.transform.y)), tail: sec.canvas.height - Math.max(...content.map((e) => e.transform.y + e.transform.height)) }
}
const meta = (section: string, zone: 'intro' | 'problem' | 'value' | 'trust' | 'decision' = 'value') => ({ section, order: { zone, notNextTo: [] } }) as never

describe('경계 단계', () => {
  it('구역이 바뀌거나 풀폭 사진 뒤면 넓음, 표·목록 뒤와 POINT 연속은 좁음, 나머지는 보통이다', () => {
    expect(breathLevel(meta('problem_raise', 'problem'), meta('sub_div'), false)).toBe('wide')
    expect(breathLevel(meta('sub_div'), meta('concept_desc'), true)).toBe('wide')
    expect(breathLevel(meta('point_list_div'), meta('sub_div'), false)).toBe('narrow')
    expect(breathLevel(meta('point_div'), meta('point_div'), false)).toBe('narrow')
    expect(breathLevel(meta('sub_div'), meta('concept_desc'), false)).toBe('normal')
    // 장 시작이 표 뒤보다 먼저다
    expect(breathLevel(meta('faq', 'trust'), meta('cta', 'decision'), false)).toBe('wide')
    expect(K_BREATH).toEqual({ narrow: 88, normal: 120, wide: 150 })
    expect(K_SEAM_MAX).toBe(300)
  })
})

describe('K–K 경계 맞추기', () => {
  const plain = TEMPLATES.filter((t) => t.surfaces.includes('W'))
  const pick = (section: string) => plain.find((t) => t.section === section && (() => { const s = kSection(t.id); const b = blank(s); return b.head >= 100 && b.tail >= 100 })())!.id

  it('같은 구역 보통 경계는 그대로 120 + 120이다', () => {
    const [a, b] = [kSection(pick('sub_div')), kSection(pick('concept_desc'))]
    const [x, y] = breatheKSeams([a, b])
    expect(blank(x).tail).toBe(K_BREATH.normal)
    expect(blank(y).head).toBe(K_BREATH.normal)
  })

  it('구역이 바뀌면 150 + 150, 목록 뒤면 88 + 88 — 높이는 바뀐 만큼만 달라지고 요소 간격은 그대로다', () => {
    const [a, b] = [kSection(pick('problem_raise')), kSection(pick('sub_div'))]
    const [x, y] = breatheKSeams([a, b])
    expect(blank(x).tail + blank(y).head).toBe(K_SEAM_MAX)
    expect(y.canvas.height - b.canvas.height).toBe(K_BREATH.wide - blank(b).head)
    expect(y.elements[1].transform.y - y.elements[0].transform.y).toBe(b.elements[1].transform.y - b.elements[0].transform.y)
    const [p, q] = breatheKSeams([kSection(pick('point_list_div')), kSection(pick('sub_div'))])
    expect(blank(p).tail + blank(q).head).toBe(K_BREATH.narrow * 2)
  })

  it('띠·사진이 섹션 끝에 닿은 쪽은 늘리지 않는다(띠 밖 빈 줄 없음)', () => {
    const reaches = (s: CanvasSection) => s.elements.some((e) => e.transform.width >= 860 && e.transform.y + e.transform.height >= s.canvas.height - 2)
    const startsAt = (s: CanvasSection) => s.elements.some((e) => e.transform.width >= 860 && e.transform.y <= 2)
    const sections = TEMPLATES.filter((t) => t.order.zone === 'value').map((t) => kSection(t.id))
    const endFlush = sections.find(reaches)!
    const topFlush = sections.find(startsAt)!
    expect(endFlush && topFlush).toBeTruthy()
    const next = kSection(pick('sub_div'))
    const [x, y] = breatheKSeams([endFlush, next])
    expect(x.canvas.height).toBe(endFlush.canvas.height)
    expect(blank(y).head).toBe(K_BREATH.wide)
    const [, z] = breatheKSeams([kSection(pick('sub_div')), topFlush])
    expect(z).toEqual(topFlush)
  })

  it('K가 아닌 섹션과의 경계는 그대로다', () => {
    const k = kSection(pick('sub_div'))
    const kept = { ...k, layoutId: 'designcut_T2' } as CanvasSection
    expect(breatheKSeams([kept, k])).toEqual([kept, k])
  })
})
