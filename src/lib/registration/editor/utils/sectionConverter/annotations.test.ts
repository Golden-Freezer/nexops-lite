import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../../types/canvas'
import { ProSectionType } from '../../types/section'
import { loadLayoutPresets } from '../../data/layouts'
import { applyLayoutPresetIfSafe } from '../applyLayoutPreset'
import { exportHtml } from '../exportUtils/htmlBuilders'
import { checkMobileReadability, isAnnotationElement } from '../mobileReadability'
import {
  applyImageAnnotations,
  imageDrawRect,
  projectAnchor,
  zoomCropRect,
  type AnnotationRenderStats,
  type ImageAnnotationMap,
} from './annotations'
import { makeImageEl, makeTextEl } from './elements'

const URL_A = 'https://cdn.test/feature-0.png'
const URL_B = 'https://cdn.test/howto-0.png'
const PALETTE = {
  primary: '#1A1A2E',
  secondary: '#E94560',
  bgMain: '#FFFFFF',
  bgSub: '#F7F7F7',
  textMain: '#333333',
  textHighlight: '#1A1A2E',
}

let seq = 0
function section(type: string, height: number, elements: CanvasElement[]): CanvasSection {
  seq++
  return {
    id: `s${seq}`,
    sectionType: type as ProSectionType,
    groupType: 'usp',
    order: seq,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height, backgroundColor: '#ffffff' },
    elements,
  }
}
const cut = (src: string, y: number, width = 860, height = 600, x = 0) =>
  makeImageEl('cut', src, 'main', x, y, width, height, 1)
const title = (y: number) =>
  makeTextEl('title', '한 번에 끝나는 정리', 'h2', 60, y, 740, '#1a1a1a', 'left', 3, { fontSize: 60, height: 80 })

const FEATURE: ImageAnnotationMap = {
  [URL_A]: {
    aspect: 0.75,
    items: [
      { kind: 'leader', anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'pointCards[0].title' },
      { kind: 'zoom', anchor: { x: 0.7, y: 0.66 }, zoomRect: { x: 0.6, y: 0.56, w: 0.2, h: 0.2 }, source: 'image' },
      { kind: 'label', anchor: { x: 0.3, y: 0.6 }, text: '10미터', source: 'spec.size' },
    ],
  },
}
const decorations = (s: CanvasSection) => new Set(s.elements.filter(isAnnotationElement).map((e) => e.groupId)).size

describe('K 첫 화면', () => {
  const hook = (y = 0) => ({ ...section('hook_3step', 900, [cut(URL_A, y)]), layoutId: 'designcut_k_hook_3step.center-bleed' })

  it('사진 이름표를 달지 않고, 같은 사진이 뒤에 있으면 거기에 단다', () => {
    const alone = applyImageAnnotations([hook()], FEATURE, PALETTE)
    expect(decorations(alone[0])).toBe(0)
    const withLater = applyImageAnnotations([hook(), section('point_div', 900, [cut(URL_A, 100)])], FEATURE, PALETTE)
    expect(decorations(withLater[0])).toBe(0)
    expect(decorations(withLater[1])).toBeGreaterThan(0)
  })

  it('다른 첫 화면 레이아웃은 그대로다', () => {
    expect(decorations(applyImageAnnotations([section('hook_3step', 900, [cut(URL_A, 0)])], FEATURE, PALETTE)[0])).toBeGreaterThan(0)
  })
})

describe('투영 — 원본 좌표 → 편집기 보이는 영역', () => {
  it('3:4 컷이 860×600 cover로 표시되면 세로 가운데 약 52%만 보인다 — 밖의 앵커는 null', () => {
    const el = cut(URL_A, 100)
    const draw = imageDrawRect(el, 0.75)
    expect(draw.w).toBe(860)
    expect(Math.round(draw.h)).toBe(1147)
    expect(projectAnchor(el, 0.75, { x: 0.5, y: 0.1 })).toBeNull()
    expect(projectAnchor(el, 0.75, { x: 0.5, y: 0.9 })).toBeNull()
    expect(projectAnchor(el, 0.75, { x: 0.5, y: 0.5 })).toEqual({ x: 430, y: 400 })
  })

  it('cropRect가 있으면 크롭 영역이 상자를 채운다(내보내기 buildImgStyleCss와 같은 규칙)', () => {
    const el = cut(URL_A, 0, 600, 600)
    el.imageProps!.cropRect = { x: 25, y: 25, width: 50, height: 50 }
    expect(projectAnchor(el, 1, { x: 0.5, y: 0.5 })).toEqual({ x: 300, y: 300 })
    expect(projectAnchor(el, 1, { x: 0.2, y: 0.5 })).toBeNull()
  })
})

describe('원형 확대 크롭 — 원본 픽셀 기준 정사각(중심 유지)', () => {
  it('3:4 원본의 0.2×0.2 영역은 가로를 넓혀 픽셀 정사각으로, 원형 프레임 안 cover가 더 자르지 않는다', () => {
    const crop = zoomCropRect({ x: 0.6, y: 0.4, w: 0.2, h: 0.2 }, 0.75)
    expect(crop).toEqual({ x: 56.67, y: 40, width: 26.67, height: 20 })
    expect((crop.width / 100) * 0.75).toBeCloseTo(crop.height / 100, 3)
    // 중심 유지 — 가장자리에 닿으면 이미지 안으로 민다
    expect(zoomCropRect({ x: 0.85, y: 0.05, w: 0.15, h: 0.15 }, 0.75)).toEqual({ x: 80, y: 5, width: 20, height: 15 })
    expect(zoomCropRect({ x: 0.9, y: 0.4, w: 0.1, h: 0.3 }, 0.75)).toMatchObject({ x: 60, width: 40, height: 30 })
    // 비율을 모르면 정사각 원본으로 본다
    expect(zoomCropRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, null)).toEqual({ x: 5, y: 10, width: 30, height: 30 })
  })
})

describe('applyImageAnnotations — 렌더', () => {
  it('라벨·지시선·원형 확대를 이미지 위에 얹는다(모바일 하한, z-order, 장식 = groupId 묶음, 편집 가능)', () => {
    const [out] = applyImageAnnotations(
      [section(ProSectionType.POINT_DIV, 800, [title(20), cut(URL_A, 120)])],
      FEATURE,
      PALETTE
    )
    const ann = out.elements.filter(isAnnotationElement)
    // 글 칩은 사진 한 장에 1개 — Vision이 먼저 고른 '원터치 작동'만, '10미터'는 뺀다
    expect(decorations(out)).toBe(2)
    const imageZ = out.elements.find((e) => e.name === 'cut')!.zIndex
    expect(ann.every((e) => e.zIndex > imageZ && !e.isLocked && e.groupId)).toBe(true)

    const labels = ann.filter((e) => e.name === 'annotation-label')
    expect(labels.map((e) => e.textProps!.content)).toEqual(['원터치 작동'])
    expect(labels.every((e) => e.type === 'badge' && e.textProps!.fontSize >= 32)).toBe(true)
    // 지시선은 글 칩(모서리)·원형 확대 2개
    const leaders = ann.filter((e) => e.name === 'annotation-leader')
    const groupOf = (pred: (e: CanvasElement) => boolean) => ann.find(pred)!.groupId
    expect(leaders.map((e) => e.groupId).sort()).toEqual(
      [groupOf((e) => e.textProps?.content === '원터치 작동'), groupOf((e) => e.name === 'annotation-zoom')].sort()
    )
    expect(leaders.every((e) => e.svgProps!.svgString.includes('stroke-width="4"'))).toBe(true)
    const zoom = ann.find((e) => e.name === 'annotation-zoom')!
    expect(zoom.type).toBe('framed-image')
    expect(zoom.transform.width).toBeGreaterThanOrEqual(260)
    expect(zoom.framedImageProps).toMatchObject({
      src: URL_A,
      frameId: 'circle',
      cropRect: zoomCropRect({ x: 0.6, y: 0.56, w: 0.2, h: 0.2 }, 0.75),
    })

    const report = checkMobileReadability({ sections: [out] })
    expect(report.violations.filter((v) => v.element?.startsWith('annotation-'))).toEqual([])
    expect(report.counts.M7).toBe(0)
  })

  it('보이는 영역 밖 앵커는 빼고, 같은 URL이 여러 섹션에 나오면 첫 출현에만 단다', () => {
    const outside: ImageAnnotationMap = {
      [URL_A]: {
        aspect: 0.75,
        items: [{ kind: 'label', anchor: { x: 0.5, y: 0.1 }, text: '원터치 작동', source: 'x' }],
      },
    }
    const [only] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)])], outside)
    expect(decorations(only)).toBe(0)

    const doc = applyImageAnnotations(
      [
        section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)]),
        section(ProSectionType.SUB_DIV, 800, [cut(URL_A, 100)]),
      ],
      FEATURE
    )
    expect(decorations(doc[0])).toBeGreaterThan(0)
    expect(decorations(doc[1])).toBe(0)

    // 역할 소유 섹션 우선 — features 컷은 sub_div가 앞에 있어도 point_div에 단다
    const owned = applyImageAnnotations(
      [
        section(ProSectionType.SUB_DIV, 800, [cut(URL_A, 100)]),
        section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)]),
      ],
      { [URL_A]: { ...FEATURE[URL_A], section: 'features:1' } }
    )
    expect([decorations(owned[0]), decorations(owned[1])]).toEqual([0, 2])
  })

  describe('글 칩 규칙(B 배치 점검 ②, 2026-10-30)', () => {
    const chip = (text: string, anchor = { x: 0.5, y: 0.5 }, kind: 'label' | 'leader' = 'label') => ({
      kind,
      anchor,
      text,
      source: 'x',
    })

    it('같은 섹션 글자나 메인컷 USP 칩과 같은 문구는 그리지 않는다(공백·문장부호·줄바꿈 없는 공백 무시)', () => {
      const stats: AnnotationRenderStats = { placed: 0, outOfView: 0, noRoom: 0, screenCap: 0, notShown: 0 }
      const usp = makeTextEl('usp_label_0', '원터치 작동', 'caption', 60, 40, 300, '#1a1a1a', 'left', 2, { height: 40 })
      const doc = applyImageAnnotations(
        [
          section(ProSectionType.MAIN_CUT, 400, [usp]),
          section(ProSectionType.POINT_DIV, 800, [title(20), cut(URL_A, 120)]),
          section(ProSectionType.SUB_DIV, 800, [cut(URL_B, 120)]),
        ],
        {
          [URL_A]: { aspect: 0.75, items: [chip('한 번에 끝나는 정리!')] },
          [URL_B]: { aspect: 0.75, items: [chip('원터치 작동', { x: 0.4, y: 0.5 }, 'leader')] },
        },
        PALETTE,
        stats
      )
      expect(doc.map(decorations)).toEqual([0, 0, 0])
      expect(stats.duplicate).toBe(2)
    })

    it('모서리 + 지시선을 먼저 고르고, 보이는 영역 가운데 50%와 겹치는 자리는 쓰지 않는다', () => {
      const [out] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)])], {
        [URL_A]: { aspect: 0.75, items: [chip('10미터')] },
      })
      const label = out.elements.find((e) => e.name === 'annotation-label')!.transform
      // 860×600 상자 전체가 보이는 영역 — 가운데 50%는 x 215~645, y 250~550
      const mid = { x: 215, y: 250, w: 430, h: 300 }
      const apart =
        label.x + label.width <= mid.x ||
        label.x >= mid.x + mid.w ||
        label.y + label.height <= mid.y ||
        label.y >= mid.y + mid.h
      expect(apart).toBe(true)
      expect(out.elements.some((e) => e.name === 'annotation-leader')).toBe(true)
    })

    it('사진 한 장에 글 칩은 1개 — 두 번째 글 칩은 screenCap으로 센다', () => {
      const stats: AnnotationRenderStats = { placed: 0, outOfView: 0, noRoom: 0, screenCap: 0, notShown: 0 }
      const [out] = applyImageAnnotations(
        [section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)])],
        { [URL_A]: { aspect: 0.75, items: [chip('10미터', { x: 0.3, y: 0.5 }), chip('원터치 작동', { x: 0.7, y: 0.5 })] } },
        PALETTE,
        stats
      )
      expect(out.elements.filter((e) => e.name === 'annotation-label').map((e) => e.textProps!.content)).toEqual(['10미터'])
      expect(stats).toMatchObject({ placed: 1, screenCap: 1 })
    })
  })

  it('글자와 겹치면 빈 모서리로 옮기고, 자리가 없으면 뺀다', () => {
    const over = makeTextEl('overlay', '사진 위 문구', 'body', 200, 330, 460, '#ffffff', 'center', 5, {
      fontSize: 45,
      height: 140,
    })
    const [moved] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100), over])], {
      [URL_A]: { aspect: 0.75, items: [FEATURE[URL_A].items[2]] },
    })
    const label = moved.elements.find((e) => e.name === 'annotation-label')!
    const t = over.transform
    const l = label.transform
    expect(l.x + l.width <= t.x || l.x >= t.x + t.width || l.y + l.height <= t.y || l.y >= t.y + t.height).toBe(true)

    const full = makeTextEl('cover', '전면 문구', 'body', 0, 100, 860, '#ffffff', 'center', 5, {
      fontSize: 45,
      height: 600,
    })
    const [blocked] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100), full])], FEATURE)
    expect(decorations(blocked)).toBe(0)
  })

  it('번호 배지는 보이는 영역 모서리에 72px 원(Vision 좌표 없이)', () => {
    const map: ImageAnnotationMap = {
      [URL_B]: { aspect: 1, items: [{ kind: 'number', anchor: { x: 0.1, y: 0.1 }, text: '2', source: 'howto[1]' }] },
    }
    const [out] = applyImageAnnotations(
      [section(ProSectionType.HIDDEN_PAGE, 600, [cut(URL_B, 50, 400, 400, 60)])],
      map,
      PALETTE
    )
    const badge = out.elements.find((e) => e.name === 'annotation-number')!
    expect(badge.type).toBe('badge')
    expect(badge.textProps!.content).toBe('2')
    expect(badge.transform).toMatchObject({ x: 80, y: 70, width: 72, height: 72 })
    expect(badge.shapeProps!.fill).toBe(PALETTE.primary)
  })

  it('폰 한 화면(1,860px) 안 장식은 3개까지 — 넘는 장식은 뺀다(M7)', () => {
    const map: ImageAnnotationMap = { ...FEATURE, [URL_B]: { ...FEATURE[URL_A] } }
    const doc = applyImageAnnotations(
      [
        section(ProSectionType.POINT_DIV, 700, [cut(URL_A, 50)]),
        section(ProSectionType.SUB_DIV, 700, [cut(URL_B, 50)]),
      ],
      map
    )
    expect(decorations(doc[0]) + decorations(doc[1])).toBe(3)
    expect(checkMobileReadability({ sections: doc }).counts.M7).toBe(0)
  })

  it('하한을 지킬 자리가 없으면 뺀다 — 300px 컷에 원형 확대(280)·12자 라벨(32px) 불가, 짧은 라벨은 500px 컷에 단다', () => {
    const long = { kind: 'label' as const, anchor: { x: 0.5, y: 0.5 }, text: '가나다라마바사아자차카타', source: 'x' }
    const [out] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 400, [cut(URL_A, 0, 300, 300)])], {
      [URL_A]: { aspect: 1, items: [FEATURE[URL_A].items[1], long] },
    })
    expect(decorations(out)).toBe(0)
    // 300px 컷은 짧은 라벨도 가운데 50%를 피할 모서리가 없다 — 500px 컷에는 단다
    const short = (side: number) =>
      decorations(
        applyImageAnnotations([section(ProSectionType.POINT_DIV, side + 100, [cut(URL_A, 0, side, side)])], {
          [URL_A]: { aspect: 1, items: [FEATURE[URL_A].items[2]] },
        })[0]
      )
    expect([short(300), short(500)]).toEqual([0, 1])
  })

  it('장식이 없으면 문서를 그대로 돌려준다(Track S·구 잡 표시 불변)', () => {
    const doc = [section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 100)])]
    expect(applyImageAnnotations(doc, undefined)).toBe(doc)
    expect(applyImageAnnotations(doc, {})).toBe(doc)
    expect(applyImageAnnotations(doc, { 'https://cdn.test/other.png': FEATURE[URL_A] })[0]).toBe(doc[0])
  })
})

describe('프리셋·내보내기', () => {
  it('프리셋 유실 가드·매칭에 장식이 끼지 않는다 — 장식을 단 섹션과 안 단 섹션의 적용 결과가 같다', async () => {
    const base = section(ProSectionType.POINT_DIV, 800, [title(20), cut(URL_A, 120)])
    const [annotated] = applyImageAnnotations([base], FEATURE)
    expect(decorations(annotated)).toBeGreaterThan(0)
    const presets = await loadLayoutPresets(ProSectionType.POINT_DIV)
    // 새 슬롯 요소 id의 시각 값만 지운다
    const stable = (s: CanvasSection | null) => JSON.stringify(s).replace(/_\d{13}/g, '_<t>')
    for (const preset of presets.slice(0, 4)) {
      const plain = applyLayoutPresetIfSafe(base, preset, PALETTE)
      const withAnn = applyLayoutPresetIfSafe(annotated, preset, PALETTE)
      expect(stable(withAnn), preset.id).toBe(stable(plain))
    }
  })

  it('내보내기 HTML에 지시선 SVG·원형 확대 프레임·라벨이 들어간다', () => {
    const [out] = applyImageAnnotations([section(ProSectionType.POINT_DIV, 800, [cut(URL_A, 120)])], FEATURE)
    const html = exportHtml([out], PALETTE)
    expect(html).toContain('<svg')
    expect(html).toContain('stroke-width="4"')
    expect(html).toContain('border-radius:50%')
    expect(html.split(URL_A).length - 1).toBe(2) // 원본 컷 + 원형 확대
    expect(html).toContain('원터치 작동')
  })
})
