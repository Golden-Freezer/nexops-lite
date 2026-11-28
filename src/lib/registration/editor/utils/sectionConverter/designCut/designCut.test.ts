import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import {
  backdropBehindText,
  checkMobileReadability,
  contrastRatio,
  mobileContrastNeedFor,
  parseColor,
} from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { flattenModules, readDesignCut } from './contract'
import { composeDesignCut, resolveImage, type DesignCutStats } from './compose'
import { designCutJobB, designCutJobFromFixture, designCutPlanForB, designcutJobFromD1 } from './designCut.fixture'

async function build(options: Parameters<typeof designCutJobB>[0] = {}) {
  const job = designCutJobB(options)
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}

const layouts = (sections: CanvasSection[]) =>
  sections.map((s) => (s.layoutId.startsWith('designcut_') ? s.layoutId.slice(10) : s.sectionType))

describe('readDesignCut — D1 계약 읽기', () => {
  it('기록이 없거나 version이 다르거나 섹션이 0이면 null(기존 편집기 문서 그대로)', () => {
    expect(readDesignCut(null)).toBeNull()
    expect(readDesignCut({ section_order: [] })).toBeNull()
    expect(readDesignCut({ designcut: { ...designCutPlanForB(), version: 2 } })).toBeNull()
    expect(readDesignCut({ designcut: { ...designCutPlanForB(), sections: [] } })).toBeNull()
  })

  it("저장 계획의 '이런 고민'은 다시 그릴 때 뺀다 — 라벨은 통째로, 문장은 그 말만(오너 지시 11-01)", () => {
    const raw = designCutPlanForB()
    raw.sections[0].text = { eyebrow: '이런 고민', headline: '이런 고민 있으신가요?', sub: '이런 고민, 금방 풀려요' }
    const { text } = readDesignCut({ designcut: raw })!.sections[0]
    expect(text).toMatchObject({ eyebrow: null, headline: '고민 있으신가요?', sub: '고민, 금방 풀려요' })
    raw.sections[0].text = { eyebrow: 'CHECK', headline: '정리 고민', sub: null }
    expect(readDesignCut({ designcut: raw })!.sections[0].text).toMatchObject({ eyebrow: 'CHECK', headline: '정리 고민', sub: null })
  })

  it('모듈 [{type,data}]를 종류별로 읽고, 틀린 섹션·값은 버린다', () => {
    const raw = designCutPlanForB()
    raw.sections.push({ key: '', template: 'T9' } as never)
    const plan = readDesignCut({ designcut: raw })!
    expect(plan.sections).toHaveLength(11)
    const t1 = plan.sections[0]
    expect(flattenModules(t1.modules).chips).toEqual([
      { label: '카네이션', color: '#E8A0A8', image: null },
      { label: '크라프트', color: '#C8A27A', image: null },
    ])
    expect(flattenModules(plan.sections.find((s) => s.key === 'point_div:0')!.modules).chapter).toBe(1)
    expect(flattenModules(plan.sections.find((s) => s.template === 'T6')!.modules).dims).toHaveLength(2)
    expect(plan.kept).toEqual(['product_exposure', 'problem_empathy'])
    expect(plan.order).toHaveLength(13)
  })
})

describe('resolveImage — section_images 키 → generated_images', () => {
  const images = {
    hero: 'h.png',
    features: ['f0.png', 'f1.png'],
    howToImages: ['h0.png'],
    'plate:main_cut': 'p.png',
    'plate:cta': 'https://placehold.co/600x400?text=Generation+Failed',
  }
  it.each([
    ['hero', 'h.png'],
    ['features:abc', null],
    ['features:1', 'f1.png'],
    ['howto:0', 'h0.png'],
    ['plate:main_cut', 'p.png'],
    ['features:9', null],
    ['plate:cta', null],
    [null, null],
  ])('%s → %s', (key, url) => expect(resolveImage(images, key)).toBe(url))
})

describe('디자인 컷 편집기 문서(B Track I + 손으로 넣은 기록)', () => {
  it('계약의 order 순서로 템플릿과 kept를 그리고, omitted·order 밖 섹션은 그리지 않는다', async () => {
    const doc = await build()
    expect(layouts(doc.sections)).toEqual([
      'T1',
      'product_exposure',
      'T2',
      'problem_empathy',
      'T3a',
      'T3a',
      // 손으로 넣은 기록의 point_div:2는 T3b — POINT는 장 머리·제목 → 사진 한 순서라 T3a로 그린다(B 배치 점검 ①)
      'T3a',
      'T4',
      'T5',
      'T3c',
      'T6',
      'T7',
      'T8',
    ])
    expect(doc.sections.map((s) => s.order)).toEqual(doc.sections.map((_, i) => i))
  })

  it('모바일 검사 M1~M7 위반 0(kept 섹션 포함 문서 전체)', async () => {
    const doc = await build()
    const report = checkMobileReadability(doc)
    expect(report.violations).toEqual([])
  })

  it('플레이트가 없어도(§2.5 대체) 위반 0이고 플레이트를 쓰는 분위기 섹션(T3c)만 그라데이션이 된다', async () => {
    const doc = await build({ withPlates: false })
    expect(checkMobileReadability(doc).violations).toEqual([])
    expect(doc.sections.find((s) => s.layoutId === 'designcut_T3c')!.canvas.backgroundColor).toMatch(/^linear-gradient/)
    // 상품 섹션은 플레이트와 무관하게 사진 배경색(측정값이 없으면 tint)
    expect(doc.sections.find((s) => s.layoutId === 'designcut_T1')!.canvas.backgroundColor).toBe('#FBF0E8')
  })

  it('글자는 모두 편집기 텍스트 요소이고 본문 하한 45를 지킨다(장식 라벨 32·캡션 28 제외)', async () => {
    const doc = await build()
    const texts = doc.sections
      .filter((s) => s.layoutId.startsWith('designcut_'))
      .flatMap((s) => s.elements.filter((e) => e.type === 'text'))
    expect(texts.length).toBeGreaterThan(30)
    for (const t of texts) {
      const p = t.textProps!
      if (p.typoLevel === 'body') expect(p.fontSize).toBeGreaterThanOrEqual(45)
      if (p.typoLevel === 'caption') expect(p.fontSize).toBeGreaterThanOrEqual(32)
    }
    // SVG에는 글자를 넣지 않는다
    const svgs = doc.sections.flatMap((s) => s.elements.filter((e) => e.type === 'svg'))
    for (const s of svgs) expect(s.svgProps!.svgString).not.toMatch(/<text/)
  })

  it('T3a 제품 사진만 T4 장식 대상(roundedRect 액자), 나머지 제품·플레이트는 장식 대상이 아니다', async () => {
    const doc = await build()
    const products = doc.sections.flatMap((s) =>
      s.elements
        .filter((e) => e.name === 'designcut-product')
        .map((e) => ({ layout: s.layoutId, frame: e.framedImageProps!.frameId }))
    )
    expect(products.filter((p) => p.frame === 'roundedRect').map((p) => p.layout)).toEqual([
      'designcut_T3a',
      'designcut_T3a',
      'designcut_T3a',
    ])
    expect(products.filter((p) => p.frame !== 'roundedRect').every((p) => p.frame === 'designcut')).toBe(true)
  })

  it('장 번호는 압축 머리 POINT 01·02·03 순서이고, 마운트 reflow는 위에서 아래로만 쌓은 T2(말풍선)만 켠다', async () => {
    const doc = await build()
    const numbers = doc.sections.flatMap((s) =>
      s.elements.filter((e) => e.name === 'designcut-chapter-text').map((e) => e.textProps!.content)
    )
    expect(numbers).toEqual(['POINT 01', 'POINT 02', 'POINT 03'])
    const cuts = doc.sections.filter((s) => s.layoutId.startsWith('designcut_'))
    expect(cuts.filter((s) => s.needsInitialReflow).map((s) => s.layoutId)).toEqual(['designcut_T2'])
  })

  it('T2 말풍선은 리플로우로 상자가 실측 글 높이에 맞게 줄고 아래 말풍선이 따라 올라간다(B 배치 점검 ⑨)', async () => {
    const doc = await build()
    const sec = doc.sections.find((s) => s.layoutId === 'designcut_T2')!
    const store = useEditorStore
    store.getState().initDocument(structuredClone({ ...doc, sections: [sec] }))
    try {
      const [bubble0, text0] = ['designcut-bubble-0', 'designcut-bubble-text-0'].map(
        (n) => store.getState().document!.sections[0].elements.find((e) => e.name === n)!
      )
      const next0 = store.getState().document!.sections[0].elements.find((e) => e.name === 'designcut-bubble-1')!
      const before = { bubbleH: bubble0.transform.height, nextY: next0.transform.y, height: sec.canvas.height }
      // 글 추정이 실측보다 40px 크다 — 편집기 마운트 실측(setMeasuredHeight)과 같은 입력
      const measured = text0.transform.height - 40
      const shrink = 40
      expect(measured).toBeGreaterThanOrEqual(20)
      store.getState().setMeasuredHeight(sec.id, text0.id, measured)
      store.getState().reflowSection(sec.id)
      const after = store.getState().document!.sections[0]
      const get = (n: string) => after.elements.find((e) => e.name === n)!.transform
      expect(get('designcut-bubble-0').height).toBe(before.bubbleH - shrink)
      expect(get('designcut-bubble-1').y).toBe(before.nextY - shrink)
      expect(after.canvas.height).toBeLessThan(before.height)
    } finally {
      store.getState().clearDocument()
    }
  })

  it('필수 데이터가 없으면 대체한다 — 일반 키는 기존 섹션, usp 조각은 T3a(대표 컷)로·기존 POINT 전체를 다시 넣지 않는다', async () => {
    const plan = designCutPlanForB()
    plan.sections[0].productImageKey = 'features:99' as never
    plan.sections[1].modules = [{ type: 'M2a', data: { lines: ['한 줄뿐'] } }] as never
    plan.sections[3].productImageKey = 'features:97' as never
    plan.sections[4].productImageKey = 'features:98' as never
    const job = designCutJobB({ plan })
    const data = assembleEditorDataResponse(job, null)
    const doc = await buildEditorDocument(job.id, data)
    const order = layouts(doc.sections)
    expect(order[0]).toBe('main_cut')
    expect(order).toContain('problem_raise')
    // POINT 3개 모두 디자인 컷 T3a로 남고, 기존 point_div(POINT 전체)는 들어오지 않는다
    expect(order.filter((x) => x === 'T3a')).toHaveLength(3)
    expect(order).not.toContain('point_div')
    const stats: DesignCutStats = { rendered: 0, fallbacks: [] }
    composeDesignCut([], readDesignCut(job.section_plan)!, {
      images: data.generated_images as Record<string, string | string[]>,
      sectionOrder: [],
      stats,
    })
    expect(stats.fallbacks.map((f) => `${f.key}:${f.to}`)).toEqual([
      'main_cut:none',
      'problem_raise:none',
      'point_div:1:T3a',
      'point_div:2:T3a',
    ])
  })

  it('sub(설명 줄)가 있으면 T3a·T4·T7에도 그린다', async () => {
    const doc = await build()
    const subs = doc.sections.flatMap((s) =>
      s.elements.filter((e) => e.name === 'designcut-sub').map(() => s.layoutId.replace('designcut_', ''))
    )
    expect(subs).toEqual(expect.arrayContaining(['T1', 'T3a', 'T4', 'T3c', 'T7', 'T8']))
    expect(subs.filter((t) => t === 'T3a')).toHaveLength(3)
  })

  it('바탕 유형(bg)을 따른다 — T4 W는 흰 바탕, D는 짙은 바탕', async () => {
    for (const [bg, expected] of [
      ['W', '#FFFFFF'],
      ['D', '#4A2414'],
    ] as const) {
      const plan = designCutPlanForB()
      plan.sections[5].bg = bg
      const job = designCutJobB({ plan })
      const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
      expect(doc.sections.find((s) => s.layoutId === 'designcut_T4')!.canvas.backgroundColor).toBe(expected)
      expect(checkMobileReadability(doc).violations).toEqual([])
    }
  })

  it('SHARP 문법이면 T3a 제품 사진이 직각 액자(rect)이고 여전히 장식 대상이다', async () => {
    const plan = designCutPlanForB()
    plan.motif = { badge: 'SHARP' }
    const job = designCutJobB({ plan })
    const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
    const frames = doc.sections
      .filter((s) => s.layoutId === 'designcut_T3a')
      .map((s) => s.elements.find((e) => e.name === 'designcut-product')!.framedImageProps!.frameId)
    expect(frames).toEqual(['rect', 'rect', 'rect'])
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('스크림·말풍선·결론 띠·캡슐은 감싸는 글자를 containerOf로 연결한다(편집 뒤 reflow에서 함께 늘어남)', async () => {
    const doc = await build()
    const containers = doc.sections.flatMap((s) => s.elements.filter((e) => e.containerOf?.length))
    const names = new Set(containers.map((e) => e.name.replace(/-\d+$/, '')))
    for (const n of [
      'designcut-scrim',
      'designcut-bubble',
      'designcut-conclusion',
      'designcut-header',
      'designcut-eyebrow-bg',
    ])
      expect(names).toContain(n)
    for (const sec of doc.sections) {
      const ids = new Set(sec.elements.map((e) => e.id))
      for (const e of sec.elements) for (const id of e.containerOf ?? []) expect(ids.has(id)).toBe(true)
    }
  })

  it('designcut 기록이 없는 잡은 그대로다(같은 잡에서 기록만 뺀 문서와 섹션 구성이 같다)', async () => {
    const withCut = designCutJobB()
    const without = { ...withCut, section_plan: { ...withCut.section_plan, designcut: undefined } }
    const doc = await buildEditorDocument(without.id, assembleEditorDataResponse(without, null))
    expect(doc.sections.some((s) => s.layoutId.startsWith('designcut_'))).toBe(false)
  })
})

describe('A·B·C 픽스처(각 잡 카피로 만든 기록) — 모바일 검사 위반 0', () => {
  it.each([
    ['A-track-i', true],
    ['B-track-i', true],
    ['C-track-i', true],
    ['A-track-i', false],
    ['B-track-i', false],
    ['C-track-i', false],
  ] as const)('%s 플레이트 %s', async (key, withPlates) => {
    const job = designCutJobFromFixture(key, withPlates)
    const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
    expect(doc.sections.filter((s) => s.layoutId.startsWith('designcut_')).length).toBeGreaterThanOrEqual(6)
    expect(checkMobileReadability(doc).violations).toEqual([])
  })
})

it('글자가 길어 섹션이 늘어나도 플레이트가 섹션 끝까지 덮는다(아래 바탕 띠 없음) — 플레이트는 분위기 섹션(T3c)에만', async () => {
  const doc = await build()
  const sec = doc.sections.find((s) => s.layoutId === 'designcut_T3c')!
  const plate = sec.elements.find((e) => e.name === 'designcut-plate')!
  expect(plate.transform.y + plate.transform.height).toBeGreaterThanOrEqual(sec.canvas.height)
  const withPlate = doc.sections.filter((s) => s.elements.some((e) => e.name === 'designcut-plate'))
  expect(withPlate.map((s) => s.layoutId)).toEqual(['designcut_T3c'])
})

describe('조립 규칙', () => {
  const images = { hero: 'https://x/h.png', features: ['https://x/f0.png'] }
  const plan = () => readDesignCut({ designcut: designCutPlanForB(false) })!

  it('order의 중복·omitted는 건너뛰고, sections에 없는 키는 kept일 때만 그린다', () => {
    const p = plan()
    p.order = ['main_cut', 'main_cut', 'perf_rating', 'unknown_key', 'cta']
    const out = composeDesignCut([], p, { images, sectionOrder: [] })
    expect(out.map((s) => s.layoutId)).toEqual(['designcut_T1', 'designcut_T8'])
  })

  it('order가 없으면 section_order로 순서를 정한다(분할 키는 기본 키 위치)', () => {
    const p = plan()
    p.order = []
    p.sections = p.sections.filter((s) => ['cta', 'point_div:0', 'main_cut'].includes(s.key))
    const out = composeDesignCut([], p, { images, sectionOrder: ['main_cut', 'point_div', 'cta'] })
    expect(out.map((s) => s.layoutId)).toEqual(['designcut_T1', 'designcut_T3a', 'designcut_T8'])
  })

  it('M4 값이 숫자 문자열이어도 읽고, 0 이하·숫자 아님은 버린다', () => {
    const raw = designCutPlanForB()
    const t6 = raw.sections.find((s) => s.template === 'T6')!
    t6.modules = [
      {
        type: 'M4',
        data: {
          dims: [
            { axis: 'w', value: '5', unit: 'cm' },
            { axis: 'h', value: 'abc', unit: 'cm' },
            { axis: 'd', value: 0, unit: 'cm' },
          ],
        },
      },
    ] as never
    const parsed = readDesignCut({ designcut: raw })!.sections.find((s) => s.template === 'T6')!
    expect(flattenModules(parsed.modules).dims).toEqual([{ axis: 'w', value: 5, unit: 'cm' }])
  })

  it('치수가 없는 T6는 그리지 않는다(치수 생성 금지)', () => {
    const p = plan()
    const t6 = p.sections.find((s) => s.template === 'T6')!
    t6.modules = t6.modules.filter((m) => m.type !== 'M4')
    const stats: DesignCutStats = { rendered: 0, fallbacks: [] }
    composeDesignCut([], p, { images, sectionOrder: [], stats })
    expect(stats.fallbacks).toContainEqual({ key: 'spec_table', template: 'T6', to: 'none' })
  })

  it('경계 빈 바탕: kept 섹션 위 여백이 커도 디자인 컷 쪽을 깎아 합 180 이하로 둔다(kept는 그대로)', () => {
    const p = plan()
    p.order = ['problem_raise', 'problem_empathy']
    p.kept = ['problem_empathy']
    const kept = {
      id: 'kept-1',
      sectionType: 'problem_empathy',
      groupType: 'problem',
      order: 0,
      isVisible: true,
      layoutId: 'problem_empathy_layout_01',
      canvas: { width: 860, height: 600, backgroundColor: '#FFFFFF' },
      elements: [
        {
          id: 'k-t',
          type: 'text',
          name: 't',
          transform: { x: 60, y: 150, width: 740, height: 80, rotation: 0 },
          zIndex: 1,
          isLocked: false,
          isVisible: true,
          opacity: 1,
        },
      ],
    } as unknown as CanvasSection
    const out = composeDesignCut([kept], p, { images, sectionOrder: [] })
    const t2 = out[0]
    const bottom = Math.max(...t2.elements.map((e) => e.transform.y + e.transform.height))
    expect(t2.canvas.height - bottom + 150).toBeLessThanOrEqual(180)
    expect(out[1].elements[0].transform.y).toBe(150)
  })
})

it('고민 말풍선(M2a)은 앞뒤 따옴표를 떼고 그린다(후기 인용으로 보이지 않게)', async () => {
  const plan = designCutPlanForB()
  plan.sections[1].modules = [
    { type: 'M2a', data: { lines: ["'포장이 늘 평범해 보여요'", '“문구가 막막해요”'] } },
  ] as never
  const job = designCutJobB({ plan })
  const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  const texts = doc.sections
    .find((s) => s.layoutId === 'designcut_T2')!
    .elements.filter((e) => e.name.startsWith('designcut-bubble-text'))
    .map((e) => e.textProps!.content)
  expect(texts).toEqual(['포장이 늘 평범해 보여요', '문구가 막막해요'])
})

it('고민 말풍선(M2a)은 상한 28자 줄도 끝까지 그리고 바탕이 글을 품으며 서로 겹치지 않는다', async () => {
  const lines = ['포장할 때마다 너무 번거로워요', '문구를 뭐라고 써야 할지 매번 막막해져요', '여러 개를 한꺼번에 쌀 때마다 시간이 오래 걸려서요']
  const plan = designCutPlanForB()
  plan.sections[1].modules = [{ type: 'M2a', data: { lines } }] as never
  const job = designCutJobB({ plan })
  const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  const els = doc.sections.find((s) => s.layoutId === 'designcut_T2')!.elements
  const at = (name: string) => els.find((e) => e.name === name)!
  lines.forEach((line, i) => {
    const text = at(`designcut-bubble-text-${i}`)
    const bubble = at(`designcut-bubble-${i}`)
    expect(text.textProps!.content).toBe(line)
    expect(text.transform.y).toBeGreaterThanOrEqual(bubble.transform.y)
    expect(text.transform.y + text.transform.height).toBeLessThanOrEqual(bubble.transform.y + bubble.transform.height)
    if (i > 0) {
      const prev = at(`designcut-bubble-${i - 1}`)
      expect(bubble.transform.y).toBeGreaterThanOrEqual(prev.transform.y + prev.transform.height)
    }
  })
})

/**
 * 검사기는 그라데이션 바탕의 대비를 판정하지 않는다(M2 공백) — 플레이트 없는 문서에서 그라데이션 양 끝 색과 글자색 대비를 직접 본다.
 * 글자 뒤에 판정 가능한 도형 바탕이 있으면(캡슐·말풍선 등) 검사기가 이미 본 것이라 건너뛴다.
 */
function gradientContrastFailures(sections: CanvasSection[]): string[] {
  const fails: string[] = []
  for (const sec of sections.filter(
    (s) => s.layoutId.startsWith('designcut_') && s.canvas.backgroundColor.includes('gradient')
  )) {
    const stops = (sec.canvas.backgroundColor.match(/#[0-9a-f]{6}/gi) ?? []).map((h) => parseColor(h)!)
    for (const el of sec.elements.filter((e) => e.type === 'text' && e.textProps?.content.trim())) {
      if (backdropBehindText(el, sec) !== null) continue
      // 반투명 도형(알약·스크림)이 글자를 감싸면 그 도형 색을 바탕으로 본다(검사기는 이 경우를 판정하지 않는다)
      const t = el.transform
      const surface = sec.elements
        .filter((q) => q.type === 'shape' && q.zIndex < el.zIndex && q.shapeProps?.fill)
        .filter((q) => {
          const r = q.transform
          return r.x <= t.x && r.x + r.width >= t.x + t.width && r.y <= t.y && r.y + r.height >= t.y + t.height
        })
        .sort((a, b) => b.zIndex - a.zIndex)[0]
      const rgb = surface?.shapeProps!.fill!.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
      const backs = rgb ? [[Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as [number, number, number]] : stops
      const fg = parseColor(el.textProps!.color)!
      const worst = Math.min(...backs.map((bg) => contrastRatio(fg, bg)))
      if (worst < mobileContrastNeedFor(el)) fails.push(`${sec.layoutId}:${el.name}:${worst.toFixed(2)}`)
    }
  }
  return fails
}

it.each([
  ['기본 바탕', {}],
  ['정보형 템플릿 전부 짙은 바탕(D)', { T2: 'D', T4: 'D', T5: 'D', T6: 'D', T7: 'D' }],
  ['T6 사진 바탕(P)', { T6: 'P' }],
] as const)('플레이트가 없을 때 그라데이션 바탕 위 글자 대비 — %s', async (_label, bgs) => {
  const plan = designCutPlanForB(false)
  for (const sec of plan.sections) {
    const bg = (bgs as Record<string, string>)[sec.template]
    if (bg) sec.bg = bg
  }
  const job = designCutJobB({ withPlates: false, plan })
  const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  expect(gradientContrastFailures(doc.sections)).toEqual([])
  expect(checkMobileReadability(doc).violations).toEqual([])
})

describe('D1 실제 계획(buildDesigncutPlan)으로 그린 편집기 문서', () => {
  it.each([
    ['A-track-i', true],
    ['B-track-i', true],
    ['C-track-i', true],
    ['A-track-i', false],
    ['B-track-i', false],
    ['C-track-i', false],
  ] as const)(
    '%s 플레이트 %s — 배정 섹션이 모두 템플릿으로 그려지고 모바일 위반·그라데이션 대비 실패 0',
    async (key, withPlates) => {
      const job = designcutJobFromD1(key, withPlates)
      const plan = readDesignCut(job.section_plan)!
      const data = assembleEditorDataResponse(job, null)
      const stats: DesignCutStats = { rendered: 0, fallbacks: [] }
      composeDesignCut([], plan, {
        images: data.generated_images as Record<string, string | string[]>,
        sectionOrder: [],
        stats,
      })
      expect(stats.fallbacks).toEqual([])
      const doc = await buildEditorDocument(job.id, data)
      // 구매 전 확인 표(designcut_purchase)는 계획 밖에서 compose가 넣는다(purchaseCut.test.ts)
      const planned = doc.sections.filter((s) => s.layoutId.startsWith('designcut_') && s.layoutId !== 'designcut_purchase')
      expect(planned).toHaveLength(plan.sections.length)
      expect(checkMobileReadability(doc).violations).toEqual([])
      expect(gradientContrastFailures(doc.sections)).toEqual([])
    }
  )
})
