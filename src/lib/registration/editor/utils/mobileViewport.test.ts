import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../types/canvas'
import { ProSectionType } from '../types/section'
import { isAnnotationElement, mobileFontFloor, PHONE_SCREEN_CANVAS_PX } from './mobileReadability'
import { DEFAULT_MOBILE_PREVIEW_WIDTH, layoutForMobile, visibleSectionsInOrder } from './mobileViewport'
import { R1_JOBS, renderR1 } from './sectionConverter/__fixtures__/r1Render'

/** 묶음 5 ① 이전 MobilePreview의 375px 계산 그대로 — 공통 함수로 옮겨도 결과가 같아야 한다 */
function legacy375(sections: CanvasSection[]) {
  const scale = 375 / 860
  const sorted = [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0)
  let cumulativeY = 0
  const warnings = []
  for (const section of sorted) {
    for (const el of section.elements) {
      const isText = el.type === 'text' || (el.type === 'badge' && isAnnotationElement(el))
      if (isText && el.textProps && el.isVisible && el.textProps.content?.trim()) {
        const srcSize = el.textProps.fontSize
        const floor = mobileFontFloor(el)
        if (srcSize < floor) {
          warnings.push({
            id: `${section.id}-${el.id}`,
            x: el.transform.x * scale,
            y: (cumulativeY + el.transform.y) * scale,
            width: Math.max(el.transform.width * scale, 16),
            height: Math.max(el.transform.height * scale, 12),
            sourceSize: srcSize,
            mobileSize: Math.round(srcSize * scale),
            floor,
          })
        }
      }
    }
    cumulativeY += section.canvas.height
  }
  return { sorted, warnings, totalHeight: cumulativeY * scale }
}

/** 하한 경고가 실제로 생기도록 글자를 줄인 사본 — R1 문서는 모바일 하한이 적용돼 경고가 거의 없다 */
function shrinkText(sections: CanvasSection[]): CanvasSection[] {
  return sections.map((s) => ({
    ...s,
    elements: s.elements.map((el) => (el.textProps ? { ...el, textProps: { ...el.textProps, fontSize: 20 } } : el)),
  }))
}

function section(id: string, order: number, patch: Partial<CanvasSection> = {}): CanvasSection {
  return {
    id,
    sectionType: ProSectionType.HOOK_3STEP,
    groupType: 'hook',
    order,
    isVisible: true,
    layoutId: 'default',
    canvas: { width: 860, height: 100, backgroundColor: '#ffffff' },
    elements: [],
    ...patch,
  }
}

describe('visibleSectionsInOrder', () => {
  it('순서대로 세우고 divider·숨김·높이 0 섹션을 뺀다', () => {
    const out = visibleSectionsInOrder([
      section('c', 3),
      section('a', 1),
      section('hidden', 2, { isVisible: false }),
      section('div', 4, { sectionType: ProSectionType.DIVIDER }),
      section('zero', 5, { canvas: { width: 860, height: 0, backgroundColor: '#fff' } }),
    ])
    expect(out.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

describe('layoutForMobile — R1 저장 잡 재렌더', () => {
  for (const [key, f] of R1_JOBS) {
    it(`${key}: 375px는 예전 미리보기 계산과 같고, 390px은 같은 경고를 배율만 바꿔 놓으며, 프리셋 가드 탈락은 0`, async () => {
      const { doc, stats } = await renderR1(f)
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)

      const sections = shrinkText(doc.sections)
      const old = legacy375(sections)
      const visible = visibleSectionsInOrder(sections)
      expect(visible.map((s) => s.id)).toEqual(old.sorted.map((s) => s.id))

      const at375 = layoutForMobile(visible, 375)
      expect(old.warnings.length).toBeGreaterThan(0)
      expect(at375.warnings).toEqual(old.warnings)
      expect(at375.totalHeight).toBeCloseTo(old.totalHeight, 6)

      const at390 = layoutForMobile(visible, 390)
      expect(at390.warnings.map((w) => w.id)).toEqual(old.warnings.map((w) => w.id))
      expect(at390.warnings.map((w) => w.floor)).toEqual(old.warnings.map((w) => w.floor))
      for (const [i, w] of at390.warnings.entries()) expect(w.y).toBeCloseTo((old.warnings[i].y * 390) / 375, 6)
      expect(at390.totalHeight).toBeCloseTo((old.totalHeight * 390) / 375, 6)
    })
  }
})

describe('layoutForMobile — 첫 화면 경계', () => {
  it('기본 폭은 검사기와 같은 390이고, 첫 화면 끝은 캔버스 1,860px의 표시 위치다', () => {
    expect(DEFAULT_MOBILE_PREVIEW_WIDTH).toBe(390)
    const { firstScreenY, scale } = layoutForMobile([section('a', 1)], 390)
    expect(scale).toBeCloseTo(390 / 860, 10)
    expect(firstScreenY).toBeCloseTo((PHONE_SCREEN_CANVAS_PX * 390) / 860, 6)
  })
})
