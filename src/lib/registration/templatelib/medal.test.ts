/**
 * 원형 배지(적용 K1 R-D1) — 자리 6칸, 사진 안에 그려 높이를 바꾸지 않는지, 값이 없거나 원에 안 들어가면 사진만 두는지,
 * 입력 그대로(평점 반올림 없음·리뷰 수 입력 있을 때만, 인증은 입력 이름만 — 인증 사칭 금지 잠금), 원 위 글자 대비 4.5, 린트 규칙을 본다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability, contrastRatio, isAnnotationElement, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import type { PdpSpecSheet } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { BADGE_TYPE, renderTemplate } from './engine'
import { certificationNames, fillInputSlots, type LineInputs } from './input-values'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { skeletonKey } from './lint-category'
import { BADGE, BADGE_INPUTS, BADGE_MIN_PHOTO, badgeInk, badgeLayout, isBadgeElement, isBadgeInput } from './medal'
import { sampleContext, sampleSlots } from './sample'
import type { FlowNode, ImageNode, Template } from './template-types'

const DISC = 'designcut-badge-disc'
const PLAN: Record<string, ['tl' | 'tr', string]> = {
  'certification.check-card': ['tr', 'badge.certification'],
  'certification.photo-first': ['tr', 'badge.certification'],
  'main_cut.scale-plate': ['tr', 'badge.rating'],
  'main_cut.plate-note': ['tr', 'badge.rating'],
  'main_cut.offset-right': ['tl', 'badge.rating'],
}

const imagesOf = (nodes: readonly FlowNode[]): ImageNode[] =>
  nodes.flatMap((n) => {
    if (n.kind === 'image') return [n]
    if (n.kind === 'row') return n.columns.flatMap((c) => imagesOf(c.nodes))
    if (n.kind === 'panel' || n.kind === 'repeat') return imagesOf(n.nodes)
    return []
  })
const withBadge = TEMPLATES.filter((t) => imagesOf(t.flow).some((n) => n.badge))
/** 배지를 뺀 템플릿 — 높이·요소 비교 기준 */
const withoutBadge = (t: Template): Template => {
  const copy = structuredClone(t)
  for (const n of imagesOf(copy.flow)) delete n.badge
  delete copy.slots.badge
  return copy
}
/** 배지 칸만 바꾼 템플릿 */
const edited = (t: Template, change: (photo: ImageNode, copy: Template) => void): Template => {
  const copy = structuredClone(t)
  change(imagesOf(copy.flow).find((n) => n.badge)!, copy)
  return copy
}
const full = (t: Template) => sampleSlots(t, { mode: 'full' })
const draw = (t: Template, values = full(t)) => renderTemplate(t, values, sampleContext())!
const named = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name)
const spec = (over: Partial<PdpSpecSheet>): LineInputs => ({ spec: over as PdpSpecSheet, cards: [], options: [] })

describe('자리', () => {
  it('certification 2칸(인증 이름)·main_cut 3칸(평점)에만 있고, 칸은 선택·입력·사실 0·6자 한 줄이다. 폭 336 사진(side-center)은 뺐다', () => {
    expect(BADGE_MIN_PHOTO).toBe(480)
    expect(templateById('certification.side-center')!.slots.badge).toBeUndefined()
    expect(withBadge.map((t) => t.id).sort()).toEqual(Object.keys(PLAN).sort())
    for (const t of withBadge) {
      const [corner, input] = PLAN[t.id]
      const photo = imagesOf(t.flow).find((n) => n.badge)!
      expect(photo.badge, t.id).toEqual({ slot: 'badge', corner })
      expect(t.slots.badge, t.id).toEqual({ type: 'text', required: false, source: 'input', input, facts: 0, maxChars: BADGE.maxChars, maxLines: 1, claimRisk: 'none' })
    }
  })

  it('후기 수는 배지 입력이 아니다(빨리 낡는다) — 허용 입력은 평점·구성·인증 셋', () => {
    expect(Object.keys(BADGE_INPUTS).sort()).toEqual(['badge.certification', 'badge.quantity', 'badge.rating'])
    expect(isBadgeInput('review.count')).toBe(false)
    expect(isBadgeInput('review.rating')).toBe(false)
  })
})

describe('그리기', () => {
  it('값이 있으면 원·이름표·값을 사진 위쪽 모서리 안에 그리고, 높이·나머지 요소는 배지 없을 때와 같다', () => {
    for (const t of withBadge) {
      const out = draw(t)
      const base = draw(withoutBadge(t), full(withoutBadge(t)))
      expect(out.height, t.id).toBe(base.height)
      const [disc] = named(out.elements, DISC)
      expect(disc, t.id).toBeDefined()
      const layout = badgeLayout(PLAN[t.id][1] as Parameters<typeof badgeLayout>[0], String(full(t).badge), BADGE_TYPE)!
      const texts = out.elements.filter((e) => isBadgeElement(e) && e.type === 'text')
      expect(texts.map((e) => [e.textProps?.content, e.textProps?.fontSize]), t.id).toEqual(layout.lines.map((l) => [l.text, l.token.size]))
      expect(out.elements.filter(isBadgeElement)[0].name, t.id).toBe('designcut-badge-disc')
      const photo = out.elements.find((e) => e.type === 'framed-image')!.transform
      const d = disc.transform
      expect([d.width, d.height]).toEqual([BADGE.size, BADGE.size])
      expect(d.y, t.id).toBeGreaterThan(photo.y)
      expect(d.x >= photo.x && d.x + d.width <= photo.x + photo.width && d.y + d.height <= photo.y + photo.height, t.id).toBe(true)
      const corner = PLAN[t.id][0]
      if (corner === 'tl') expect(d.x - photo.x, t.id).toBeLessThan(photo.x + photo.width - d.x - d.width)
      else expect(d.x - photo.x, t.id).toBeGreaterThan(photo.x + photo.width - d.x - d.width)
      // 글자는 원 상자 안, 한 묶음
      for (const text of out.elements.filter((e) => isBadgeElement(e) && e.type === 'text')) {
        const x = text.transform
        expect(x.x >= d.x && x.y >= d.y && x.x + x.width <= d.x + d.width && x.y + x.height <= d.y + d.height, `${t.id} ${text.name}`).toBe(true)
        expect(text.groupId).toBe(disc.groupId)
      }
      // 배지 밖 요소는 배지 없을 때와 같은 자리다(보이지 않는 묶음 상자 하나만 더해질 수 있다)
      const rest = out.elements.filter((e) => !isBadgeElement(e) && e.name !== 'designcut-row').map((e) => [e.name, e.transform.x, e.transform.y, e.transform.width, e.transform.height])
      const restBase = base.elements.filter((e) => e.name !== 'designcut-row').map((e) => [e.name, e.transform.x, e.transform.y, e.transform.width, e.transform.height])
      expect(rest, t.id).toEqual(restBase)
    }
  })

  it('값이 없거나 원 한 줄에 안 들어가면(한글 5자 이상·7자) 그리지 않고 요소가 배지 없을 때와 같다', () => {
    for (const t of withBadge) {
      const base = draw(withoutBadge(t), full(withoutBadge(t))).elements.map((e) => e.name)
      const values = full(t)
      delete values.badge
      expect(draw(t, values).elements.map((e) => e.name), t.id).toEqual(base)
      for (const long of ['가나다라마', '가나다라마바', '1234567']) expect(draw(t, { ...full(t), badge: long }).elements.map((e) => e.name), `${t.id} ${long}`).toEqual(base)
    }
  })

  it('이름표(45·줄 간격 1.7)+값 두 줄이 원에 들어가면 두 줄, 아니면 값 한 줄(평점은 ★ 앞붙임), 그것도 안 되면 없음', () => {
    const lay = (input: Parameters<typeof badgeLayout>[0], value: string) =>
      badgeLayout(input, value, BADGE_TYPE)?.lines.map((l) => `${l.text}@${l.token.size}/${l.token.lineHeight}`) ?? null
    expect(BADGE_TYPE.label.size).toBe(45)
    expect(lay('badge.certification', 'KC')).toEqual(['인증@45/1.7', 'KC@48/1.2'])
    expect(lay('badge.rating', '5')).toEqual(['평점@45/1.7', '5@56/1.2'])
    expect(lay('badge.rating', '4.8')).toEqual(['★ 4.8@48/1.2'])
    expect(lay('badge.rating', '4.85')).toEqual(['★ 4.85@40/1.2'])
    expect(lay('badge.quantity', '20개')).toEqual(['20개@56/1.2'])
    expect(lay('badge.certification', '인증이름')).toEqual(['인증이름@36/1.2'])
    expect(lay('badge.certification', '가나다라마')).toBeNull()
    expect(lay('badge.quantity', '1234567')).toBeNull()
  })

  it('모바일 판독 규칙(M6 2열 본문 등)을 예외 없이 지킨다 — 5칸 × W·N × 두 줄·한 줄 값', () => {
    const sectionOf = (t: Template, out: ReturnType<typeof draw>): CanvasSection =>
      ({ id: t.id, sectionType: t.section, groupType: 'modules', order: 0, isVisible: true, layoutId: `designcut_k_${t.id}`, canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements }) as unknown as CanvasSection
    for (const t of withBadge) {
      for (const bg of ['W', 'N'] as const) {
        for (const badge of ['KC', '5', '4.85', '20개', '인증이름']) {
          const out = renderTemplate(t, { ...full(t), badge }, sampleContext({ bg }))!
          const fits = badgeLayout(PLAN[t.id][1] as Parameters<typeof badgeLayout>[0], badge, BADGE_TYPE) !== null
          expect(out.elements.some(isBadgeElement), `${t.id} ${badge}`).toBe(fits)
          const report = checkMobileReadability({ sections: [sectionOf(t, out)] })
          const onBadge = report.violations.filter((v) => JSON.stringify(v).includes('designcut-badge'))
          expect(onBadge, `${t.id} ${bg} ${badge}`).toEqual([])
          expect(report.violations.filter((v) => v.rule === 'M6'), `${t.id} ${bg} ${badge}`).toEqual([])
        }
      }
    }
  })

  it('뼈대 키·화면 단계 키에 들지 않고, 강조 장식(M7)으로 세지 않는다', () => {
    for (const t of withBadge) expect(skeletonKey(t.flow), t.id).toBe(skeletonKey(withoutBadge(t).flow))
    for (const e of draw(withBadge[0]).elements.filter(isBadgeElement)) expect(isAnnotationElement(e)).toBe(false)
  })
})

describe('색 — 원 위 글자 대비 4.5, 못 넘으면 짙은 면', () => {
  it('모든 컨셉 색 조합에서 대비 4.5 이상이다(원은 사진 위라 바탕 W·N·T·D와 무관하다)', () => {
    const kinds = { accent: 0, deep: 0, other: 0 }
    for (const concept of CONCEPTS) {
      for (const set of colorSetsOf(concept).sets) {
        const ink = badgeInk(set.colors)
        expect(contrastRatio(parseColor(ink.text)!, parseColor(ink.fill)!), `${concept.id}`).toBeGreaterThanOrEqual(4.5)
        if (ink.fill === set.colors.accent) kinds.accent += 1
        else if (ink.fill === set.colors.deep) kinds.deep += 1
        else kinds.other += 1
      }
    }
    expect(kinds.accent).toBeGreaterThan(0)
    expect(kinds.other).toBe(0)
  })

  it('강조색과 그 위 글자가 4.5 미만이면 짙은 면으로 바꾼다', () => {
    const c = { accent: '#F2C94C', onAccent: '#FFFFFF', deep: '#1F2A44', onDeep: '#FFFFFF' }
    expect(badgeInk(c)).toEqual({ fill: '#1F2A44', text: '#FFFFFF' })
    expect(badgeInk({ ...c, accent: '#2B6CD9' })).toEqual({ fill: '#2B6CD9', text: '#FFFFFF' })
  })
})

describe('입력 그대로 — 지어내지 않는다', () => {
  const cert = templateById('certification.check-card')!
  const main = templateById('main_cut.scale-plate')!

  it('평점은 입력 값 그대로(반올림 없음)이고 리뷰 수 입력이 있을 때만이다. 수는 그리지 않는다', () => {
    expect(fillInputSlots(main, spec({ rating: 4.85, reviewCount: 120 })).badge).toBe('4.85')
    expect(fillInputSlots(main, spec({ rating: 4.8 })).badge).toBeUndefined()
    expect(fillInputSlots(main, spec({ rating: 4.8, reviewCount: 0 })).badge).toBeUndefined()
    // 리뷰 파일 집계 평균(계산값)은 쓰지 않는다
    expect(fillInputSlots(main, spec({ reviewFiles: { own: { stats: { rating_counts: { 5: 10, 4: 2 } } } } } as unknown as Partial<PdpSpecSheet>)).badge).toBeUndefined()
    const out = draw(main, { ...full(main), badge: '4.85' })
    expect(out.elements.filter(isBadgeElement).map((e) => e.textProps?.content).filter(Boolean)).toEqual(['★ 4.85'])
  })

  it('인증은 입력 인증 이름의 첫 이름 그대로다 — 입력에 없는 인증은 그리지 않는다(인증 사칭 금지)', () => {
    expect(fillInputSlots(cert, spec({ certificationInfo: 'KC인증, HACCP' })).badge).toBe('KC인증')
    expect(fillInputSlots(cert, spec({ certificationInfo: '' })).badge).toBeUndefined()
    expect(fillInputSlots(cert, spec({})).badge).toBeUndefined()
    for (const info of ['HACCP', '친환경 인증; KC', 'KC·FDA', 'GMP\nISO22000']) {
      const value = fillInputSlots(cert, spec({ certificationInfo: info })).badge
      if (value !== undefined) expect(certificationNames({ certificationInfo: info })[0], info).toBe(value)
    }
  })

  it('구성은 입력 구성 칸의 수량만이다', () => {
    const t = edited(main, (_photo, copy) => {
      copy.slots.badge = { ...copy.slots.badge, input: 'badge.quantity' } as Template['slots'][string]
    })
    expect(fillInputSlots(t, spec({ extraSpecs: [{ key: '구성', value: '20개입 (본품)' }] })).badge).toBe('20개')
    expect(fillInputSlots(t, spec({ extraSpecs: [{ key: '구성', value: '본품 외' }] })).badge).toBeUndefined()
  })
})

describe('린트', () => {
  const main = templateById('main_cut.scale-plate')!
  const badgeIssues = (t: Template) => lintTemplate(t).filter((v) => /배지/.test(v.detail)).map((v) => v.detail)

  it('지금 6칸은 배지 위반이 없다', () => {
    for (const t of withBadge) expect(badgeIssues(t), t.id).toEqual([])
  })

  it('섹션·칸 형식·입력·선택·글자·사진 폭·틀·위쪽 사진 위 글·개수·반복·다른 칸의 배지 입력을 막는다', () => {
    expect(badgeIssues({ ...main, section: 'sub_div' })).toHaveLength(1)
    const slot = (over: object) => edited(main, (_p, c) => void (c.slots.badge = { ...c.slots.badge, ...over } as Template['slots'][string]))
    expect(badgeIssues(slot({ source: 'copy' }))).toHaveLength(1)
    expect(badgeIssues(slot({ input: 'review.count' }))).toHaveLength(1)
    expect(badgeIssues(slot({ required: true }))).toHaveLength(1)
    expect(badgeIssues(slot({ maxChars: 7 }))).toHaveLength(1)
    expect(badgeIssues(edited(main, (p) => void (delete p.bleed, (p.w = 400))))).toHaveLength(1)
    expect(badgeIssues(edited(main, (p) => void (p.frame = 'circle')))).toHaveLength(1)
    expect(badgeIssues(edited(main, (p) => void (p.overlay = { anchor: 'top', ink: 'light', nodes: [] })))).toHaveLength(1)
    const two = edited(main, (_p, c) => void c.flow.push({ kind: 'image', slot: 'photo', badge: { slot: 'badge', corner: 'tl' } }))
    expect(badgeIssues(two).some((d) => d.includes('하나'))).toBe(true)
    const inRepeat = edited(main, (_p, c) => {
      c.slots.items = { type: 'list', required: false, min: 1, max: 2, fields: { shot: { type: 'image', required: true, purpose: ['scene'], composition: ['front'], aspect: ['1:1'], minHeight: 300 } } }
      c.flow.push({ kind: 'repeat', slot: 'items', nodes: [{ kind: 'image', slot: 'shot', badge: { slot: 'badge', corner: 'tl' } }] })
    })
    expect(badgeIssues(inRepeat).some((d) => d.includes('반복'))).toBe(true)
    const stray = edited(main, (_p, c) => {
      c.slots.extra = { ...c.slots.badge } as Template['slots'][string]
      c.flow.push({ kind: 'text', slot: 'extra', token: 'LABEL' })
    })
    expect(badgeIssues(stray).some((d) => d.includes('extra'))).toBe(true)
  })
})
