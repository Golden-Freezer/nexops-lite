/**
 * D2 형태 변형(layoutVariant — SPACING-LAYOUT.md ②) — 큰 POINT scene·zigzag·grid, 자세히 보기 zigzag·list. 장면 모드에서만 바뀌고 그 밖은
 * 지금 그리기 그대로. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { buildPalette2 } from '@/lib/registration/internalized/art-palette'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { CONTENT_W, MARGIN, SCENE_SPACE, W } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const PARENT = { enrichment: { version: 1, features: [], audience: { kind: 'parent_proxy', version: 1, basis: 'name_tags', terms: ['어린이집'], ageGate: false } } }
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
type DetailItem = { title: string; description: string | null; imageKey: string | null }
const DETAIL: DetailItem[] = [
  { title: '20매 넉넉한 구성', description: '어린이집 한 반 답례품을 한 번에 준비할 수 있어요', imageKey: 'features:2' },
  { title: '안이 비치는 반투명 소재', description: '간식을 넣으면 은은하게 비쳐 보여요', imageKey: 'features:4' },
  { title: '조임끈으로 간편하게', description: null, imageKey: 'features:5' },
]

type Opts = {
  art?: boolean
  corners?: 'soft' | 'sharp'
  variants?: boolean
  /** 큰 POINT 1~3장 변형 이름(기본 계획 순서 scene → zigzag → grid) */
  pointVariants?: string[]
  detail?: string
  detailItems?: DetailItem[]
  playful?: boolean
  images?: typeof IMAGES
  /** 모든 사진의 실제 가로/세로(없으면 비율 미상 → 3:4) */
  aspect?: number
}
/** 고정물 계획 — 큰 POINT 1~3장에 계획과 같은 변형(scene → zigzag → grid), 자세히 보기(T11)를 POINT 뒤에 */
const planOf = ({ art = true, corners = 'soft', variants = true, pointVariants, detail, detailItems = DETAIL, playful = false }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  if (art) plan.artDirection = { ...ART, corners, ...(playful ? { palette2: buildPalette2(PARENT, null, '#D9622B', '#1A1A1A') } : {}) }
  const points = plan.sections.filter((s) => s.key.startsWith('point_div:'))
  if (variants) points.forEach((s, i) => Object.assign(s, { layoutVariant: (pointVariants ?? ['scene', 'zigzag', 'grid'])[i] }))
  if (detail) {
    const base = points[0]
    plan.sections.push({
      ...base,
      key: 'detail:more',
      role: 'usp_feature',
      template: 'T11',
      bg: 'W',
      chapter: null,
      plateKey: null,
      productImageKey: null,
      pointIndex: null,
      text: { eyebrow: 'DETAIL', headline: '자세히 보기', sub: null },
      modules: [{ type: 'M11', data: { items: detailItems } }],
      layoutVariant: detail,
    } as unknown as (typeof plan.sections)[number])
    plan.order.splice(plan.order.indexOf('point_div:2') + 1, 0, 'detail:more')
  }
  return plan
}
const compose = (opts: Opts = {}) => {
  const images = opts.images ?? IMAGES
  const imageAspects = opts.aspect ? Object.fromEntries([images.hero, ...images.features].map((u) => [u, opts.aspect!])) : null
  return composeDesignCut([], readDesignCut({ designcut: planOf(opts) })!, { images, sectionOrder: [], imageAspects })
}
const points = (out: CanvasSection[]) => out.filter((s) => s.layoutId === 'designcut_T3a')
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const one = (sec: CanvasSection, name: string) => {
  const [el] = named(sec, name)
  expect(el, name).toBeDefined()
  return el
}
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
/** id(무작위 — 요소 id·SVG 그라데이션 id)를 뺀 그리기 결과 — 같은 배치인지 비교한다 */
const shape = (out: CanvasSection[]) =>
  JSON.stringify(out.map((s) => ({ ...s, id: '', elements: s.elements.map((e) => ({ ...e, id: '', containerOf: e.containerOf?.length })) }))).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )

describe('큰 POINT 형태 변형(T3a) — 장면 모드', () => {
  it('1장 scene은 풀폭 장면 사진 그대로, 2장 zigzag는 오른쪽 사진 카드 680 + 왼쪽 아래로 48 어긋난 옅은 강조색 판', () => {
    const [scene, zigzag] = points(compose())
    expect(one(scene, 'designcut-scene').transform).toMatchObject({ x: 0, width: W })
    const photo = one(zigzag, 'designcut-scene')
    expect(photo.transform).toMatchObject({ x: W - MARGIN - 680, width: 680 })
    const plate = one(zigzag, 'designcut-zigzag-plate')
    expect(plate.transform).toMatchObject({ x: photo.transform.x - 48, y: photo.transform.y + 48, width: 680, height: photo.transform.height })
    expect(plate.zIndex).toBeLessThan(photo.zIndex)
    expect(plate.shapeProps?.fill).toMatch(/^rgba\(43, 108, 217, 0\.16\)$/)
    const textBottom = Math.max(...zigzag.elements.filter((e) => e.type === 'text').map(bottom))
    expect(photo.transform.y - textBottom).toBe(SCENE_SPACE.photoGap)
    // 판 아래 여백은 장면 모드 섹션 아래 여백(120)
    expect(zigzag.canvas.height - bottom(plate)).toBe(SCENE_SPACE.bottom)
  })

  it('3장 grid — 머리 아래 본문 폭 사진 타일', () => {
    const grid = points(compose())[2]
    expect(one(grid, 'designcut-chapter-number').textProps!.content).toBe('03')
    const photo = one(grid, 'designcut-scene')
    expect(photo.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
    expect(photo.transform.y - bottom(one(grid, 'designcut-sub'))).toBe(SCENE_SPACE.photoGap)
    // 사진 타일 아래는 장면 모드 아래 여백 120, 본문 폭 타일이라 페이드를 붙이지 않는다
    expect(grid.canvas.height - bottom(photo)).toBe(SCENE_SPACE.bottom)
    expect(named(grid, 'designcut-fade')).toEqual([])
  })

  it('큰 POINT 셋은 카피 자리가 같다 — 캡슐·번호·제목·설명의 위치와 크기가 칸마다 같고 사진 배치만 다르다(오너 지시 11-01)', () => {
    const [scene, zigzag, grid] = points(compose())
    const head = (sec: CanvasSection) =>
      ['designcut-chapter-bg', 'designcut-chapter-text', 'designcut-chapter-number', 'designcut-headline', 'designcut-sub'].map((name) => {
        const { x, y, width } = one(sec, name).transform
        // 제목 줄 수는 글 길이마다 다르다(92에서 픽스처 둘째 POINT 제목이 한 줄 적다) — 설명은 제목 아래 간격으로 본다
        return { name, x, y: name === 'designcut-sub' ? y - bottom(one(sec, 'designcut-headline')) : y, width }
      })
    const sameCopy = (sec: CanvasSection, other: CanvasSection) => {
      const texts = (s: CanvasSection) => head(s).map((h) => ({ ...h, size: one(s, h.name).textProps?.fontSize, lh: one(s, h.name).textProps?.lineHeight }))
      expect(texts(sec)).toEqual(texts(other))
    }
    sameCopy(zigzag, scene)
    sameCopy(grid, scene)
    // 사진 배치는 다르다
    const photos = [scene, zigzag, grid].map((s) => {
      const { x, width } = one(s, 'designcut-scene').transform
      return `${x}:${width}`
    })
    expect(new Set(photos).size).toBe(3)
  })

  it('가로 사진(4:3)도 상품 컷 높이 500 이상 — zigzag 510·grid 555', () => {
    const [, zigzag, grid] = points(compose({ aspect: 4 / 3 }))
    expect(one(zigzag, 'designcut-scene').transform.height).toBe(510)
    expect(one(grid, 'designcut-scene').transform.height).toBe(555)
    expect(checkMobileReadability({ sections: [zigzag, grid] }).violations.filter((v) => v.rule === 'M5')).toEqual([])
  })

  it('제품 컷 URL이 빠진 POINT는 대표 컷(hero)으로 같은 변형을 그린다', () => {
    const images = { ...IMAGES, features: IMAGES.features.map((u, i) => (i === 1 ? '' : u)) }
    const zigzag = points(compose({ images }))[1]
    expect(one(zigzag, 'designcut-scene').framedImageProps?.src).toBe(IMAGES.hero)
    expect(named(zigzag, 'designcut-zigzag-plate')).toHaveLength(1)
  })

  it('판독 규칙 — 변형 섹션에 글자 하한·대비·상품 컷 높이·2열(M1·M2·M5·M6) 위반 없음, 사진은 장식(T4) 대상 액자(SOFT 둥근·SHARP 직각)', () => {
    for (const corners of ['soft', 'sharp'] as const) {
      const out = points(compose({ corners }))
      const report = checkMobileReadability({ sections: out })
      expect(report.violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule)), corners).toEqual([])
      for (const sec of out.slice(1)) {
        expect(one(sec, 'designcut-scene').framedImageProps?.frameId, corners).toBe(corners === 'soft' ? 'roundedRect' : 'rect')
        expect(one(sec, 'designcut-scene').transform.height, corners).toBeGreaterThanOrEqual(500)
      }
      expect(one(out[1], 'designcut-zigzag-plate').shapeProps?.borderRadius, corners).toBe(corners === 'soft' ? 16 : 0)
    }
  })

  it('zigzag — 정사각 사진 600을 왼쪽 60·오른쪽 200으로 번갈아, 번호·제목·설명은 그 사진과 같은 축 아래(나란한 글 없음)', () => {
    const t11 = compose({ detail: 'zigzag' }).find((s) => s.layoutId === 'designcut_T11')!
    const photos = DETAIL.map((_, i) => one(t11, `designcut-detail-photo-${i}`))
    expect(photos.map((p) => p.transform.x)).toEqual([MARGIN, W - MARGIN - 600, MARGIN])
    for (const [i, p] of photos.entries()) {
      expect(p.transform).toMatchObject({ width: 600, height: 600 })
      for (const name of [`designcut-detail-no-${i}`, `designcut-detail-title-${i}`]) {
        expect(one(t11, name).transform.x, name).toBe(p.transform.x)
        expect(one(t11, name).transform.y, name).toBeGreaterThan(bottom(p))
      }
    }
    expect(named(t11, 'designcut-detail-desc-2')).toEqual([])
    const headBottom = bottom(one(t11, 'designcut-headline'))
    expect(photos[0].transform.y - headBottom).toBe(SCENE_SPACE.photoGap)
    expect(checkMobileReadability({ sections: [t11] }).violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule))).toEqual([])
  })

  it('list(컷이 빠진 항목) — 기본 목록 그리기(본문 폭 사진·글만 항목), 사진 앞 간격은 장면 모드 88', () => {
    const items = DETAIL.map((d, i) => (i === 1 ? { ...d, imageKey: null } : d))
    const t11 = compose({ detail: 'list', detailItems: items }).find((s) => s.layoutId === 'designcut_T11')!
    const first = one(t11, 'designcut-detail-photo-0')
    expect(first.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
    expect(first.transform.y - bottom(one(t11, 'designcut-headline'))).toBe(SCENE_SPACE.photoGap)
    expect(named(t11, 'designcut-detail-photo-1')).toEqual([])
    // 계획이 zigzag인데 URL이 빠졌어도 기본 목록으로
    const fallback = compose({ detail: 'zigzag', detailItems: items }).find((s) => s.layoutId === 'designcut_T11')!
    expect(one(fallback, 'designcut-detail-photo-0').transform.width).toBe(CONTENT_W)
  })
})

describe('형태 변형 범위', () => {
  it('장면 모드가 아니면(아트 디렉션 없는 v2) 변형을 무시한다 — 변형 칸이 없는 계획과 같은 배치', () => {
    expect(shape(compose({ art: false, detail: 'zigzag' }))).toBe(shape(compose({ art: false, variants: false, detail: 'list' })))
  })

  it('해당 템플릿에 없는 변형 이름(큰 POINT list·card, 자세히 보기 grid)은 지금 그리기', () => {
    const out = compose({ pointVariants: ['list', 'card', 'scene'], detail: 'grid' })
    for (const sec of points(out)) expect(one(sec, 'designcut-scene').transform).toMatchObject({ x: 0, width: W })
    const t11 = out.find((s) => s.layoutId === 'designcut_T11')!
    expect(one(t11, 'designcut-detail-photo-0').transform.width).toBe(CONTENT_W)
  })

  it('바탕 교대 — 흰 띠 여백으로 끝나는 grid 다음 섹션은 스튜디오 면, 풀폭 사진으로 끝나는 scene 다음은 흰 면', () => {
    // 고정물에서 POINT 다음 섹션은 해결 막 첫 섹션(짙은 전환 면 자리)이라 짙은 면이 없는 palette2 playful로 본다
    const t11Bg = (variants: boolean) =>
      compose({ variants, detail: 'list', playful: true }).find((s) => s.layoutId === 'designcut_T11')!.canvas.backgroundColor
    expect(t11Bg(true)).toBe(buildPalette2(PARENT, null, '#D9622B', '#1A1A1A').colors!.studio)
    expect(t11Bg(false)).toBe('#FFFFFF')
  })

  it('전체 문서 — 변형을 켠 장면 모드 문서에 연속 빈 영역(M4) 위반 없음', () => {
    const out = compose({ detail: 'zigzag' })
    expect(checkMobileReadability({ sections: out }).violations.filter((v) => v.rule === 'M4')).toEqual([])
  })

  it('장면 모드에서 변형 칸이 없는 계획은 지금 그리기(scene·기본 목록) 그대로', () => {

    const out = points(compose({ variants: false }))
    for (const sec of out) {
      expect(one(sec, 'designcut-scene').transform).toMatchObject({ x: 0, width: W })
      expect(named(sec, 'designcut-zigzag-plate')).toEqual([])
      expect(named(sec, 'designcut-grid-number')).toEqual([])
    }
  })
})
