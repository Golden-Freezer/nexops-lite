/**
 * 적용 D6 P3 — 채움 메시지(장 번호 없는 T3a) 머리 변형 band(T2-40 강조색 띠 안 제목)·rule(T2-53 짧은 선 + 가운데 제목). 계획 순환, 계약
 * (장 번호 칸은 버림), 조립(띠 안 제목만·설명은 띠 아래·선 가운데·대비), 큰 POINT 머리는 바이트 같음. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { messageHeadVariant } from '@/lib/registration/internalized/designcut-fill'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { CONTENT_W, MARGIN, SCENE_SPACE, W } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const TWO = '붙이기만 하면 감사 인사가 끝나요. 문구를 따로 고민하지 않아도 돼요.'

type Opts = { head?: string | null; layout?: string; sub?: string | null; corners?: 'soft' | 'sharp' }
/** 고정물 계획(장면 모드) — 둘째 POINT(point_div:1)를 장 번호 없는 메시지 칸으로 바꿔 머리 변형·형태를 준다 */
const planOf = ({ head = null, layout = 'grid', sub, corners = 'soft' }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  plan.artDirection = { ...ART, corners }
  const msg = plan.sections.find((s) => s.key === 'point_div:1')! as Record<string, unknown> & (typeof plan.sections)[number]
  Object.assign(msg, { chapter: null, pointIndex: null, role: 'fill_message', layoutVariant: layout, modules: [] })
  if (head) Object.assign(msg, { headVariant: head })
  if (sub !== undefined) msg.text = { ...msg.text, sub }
  return plan
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const t3a = (out: CanvasSection[]) => out.filter((s) => s.layoutId === 'designcut_T3a')
/** 장 번호 없는 칸 — 둘째 T3a(고정물 순서 point_div:0 → 1 → 2) */
const message = (out: CanvasSection[]) => t3a(out)[1]
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const one = (sec: CanvasSection, name: string) => {
  const [el] = named(sec, name)
  expect(el, name).toBeDefined()
  return el
}
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
/** id(무작위)를 뺀 요소 — 같은 그리기인지 비교 */
const shape = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', containerOf: e.containerOf?.length })) }).replace(/([a-z]+)_\d+_\d{10,}/g, '$1')

describe('메시지 머리 순환·계약', () => {
  it('메시지 순번대로 지금 머리 → band → rule을 돈다', () => {
    expect([1, 2, 3, 4, 5, 6].map(messageHeadVariant)).toEqual([null, 'band', 'rule', null, 'band', 'rule'])
  })

  it('계약은 장 번호 없는 칸의 band·rule만 읽고, 장 번호 칸·모르는 이름은 버린다', () => {
    const plan = planOf({ head: 'band' })
    const point = plan.sections.find((s) => s.key === 'point_div:0')! as Record<string, unknown>
    point.headVariant = 'rule'
    const read = readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!
    expect(read.sections.find((s) => s.key === 'point_div:1')!.headVariant).toBe('band')
    expect(read.sections.find((s) => s.key === 'point_div:0')).not.toHaveProperty('headVariant')
    const odd = planOf({ head: 'banner' })
    expect(readDesignCut({ designcut: JSON.parse(JSON.stringify(odd)) })!.sections.find((s) => s.key === 'point_div:1')).not.toHaveProperty('headVariant')
  })
})

describe('band(T2-40) — 강조색 띠 안 제목, 설명은 띠 아래', () => {
  it('띠는 풀폭 강조색이고 제목만 담는다, 설명은 띠 아래 48, 사진은 설명 아래 88', () => {
    const sec = message(compose({ head: 'band' }))
    const band = one(sec, 'designcut-head-band')
    const title = one(sec, 'designcut-headline')
    const sub = one(sec, 'designcut-sub')
    expect(band.transform).toMatchObject({ x: 0, width: W })
    expect(band.shapeProps?.fill?.toUpperCase()).toBe('#2B6CD9')
    expect(band.containerOf).toEqual([title.id])
    expect(title.transform.y - band.transform.y).toBe(48)
    expect(bottom(band) - bottom(title)).toBe(48)
    expect(sub.transform.y - bottom(band)).toBe(SCENE_SPACE.titleGap)
    expect(one(sec, 'designcut-scene').transform.y - bottom(sub)).toBe(SCENE_SPACE.photoGap)
    expect(band.zIndex).toBeLessThan(title.zIndex)
  })

  it('띠 안 제목 글자색은 띠 대비 4.5 이상(흰 글자가 모자라면 잉크), 강조 구절 색을 쓰지 않는다', () => {
    const sec = message(compose({ head: 'band' }))
    const report = checkMobileReadability({ sections: [sec] })
    expect(report.violations.filter((v) => v.rule === 'M2')).toEqual([])
    expect(one(sec, 'designcut-headline').textProps?.richContent ?? null).toBeNull()
  })

  it('cards 형태와 함께면 설명은 머리에 없고 카드가 띠 아래에 온다', () => {
    const sec = message(compose({ head: 'band', layout: 'cards', sub: TWO }))
    expect(named(sec, 'designcut-sub')).toEqual([])
    const firstCard = one(sec, 'designcut-point-card-0')
    expect(firstCard.transform.y - bottom(one(sec, 'designcut-head-band'))).toBe(SCENE_SPACE.titleGap)
  })
})

describe('rule(T2-53) — 짧은 선 + 가운데 제목·설명', () => {
  it('선은 가운데 80×6 강조색, 제목은 선 아래 32에 가운데, 설명도 가운데', () => {
    const sec = message(compose({ head: 'rule' }))
    const rule = one(sec, 'designcut-head-rule')
    expect(rule.transform).toMatchObject({ x: (W - 80) / 2, width: 80, height: 6, y: SCENE_SPACE.top })
    const title = one(sec, 'designcut-headline')
    expect(title.transform).toMatchObject({ x: MARGIN, width: CONTENT_W, y: SCENE_SPACE.top + 6 + 32 })
    expect(title.textProps?.textAlign).toBe('center')
    expect(one(sec, 'designcut-sub').textProps?.textAlign).toBe('center')
  })
})

describe('범위·판독', () => {
  it('머리 변형 칸이 없으면 지금 머리 그대로 — 같은 계획에서 칸만 뺀 것과 같다', () => {
    expect(shape(message(compose({ head: null })))).toBe(shape(message(compose({}))))
    expect(named(message(compose({})), 'designcut-head-band')).toEqual([])
  })

  it('큰 POINT(장 번호 있는 칸) 머리는 메시지 머리 변형과 상관없이 바이트 같다', () => {
    const [p0, , p2] = t3a(compose({ head: 'band' }))
    const [q0, , q2] = t3a(compose({ head: null }))
    expect(shape(p0)).toBe(shape(q0))
    expect(shape(p2)).toBe(shape(q2))
  })

  it('band·rule에 글자 하한·대비·상품 컷 높이·2열(M1·M2·M5·M6) 위반 없음, 문서 M4 없음', () => {
    for (const corners of ['soft', 'sharp'] as const) {
      for (const head of ['band', 'rule']) {
        const out = compose({ head, corners })
        const report = checkMobileReadability({ sections: [message(out)] })
        expect(report.violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule)), `${corners}·${head}`).toEqual([])
        expect(checkMobileReadability({ sections: out }).violations.filter((v) => v.rule === 'M4'), `${corners}·${head}`).toEqual([])
      }
    }
  })

  it('장면 모드가 아니면(아트 디렉션 없음) 머리 변형을 무시한다', () => {
    const plain = (head: string | null) => {
      const plan = planOf({ head })
      delete (plan as Record<string, unknown>).artDirection
      return message(composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!, { images: IMAGES, sectionOrder: [] }))
    }
    expect(shape(plain('band'))).toBe(shape(plain(null)))
  })
})
