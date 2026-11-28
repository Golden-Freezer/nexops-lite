// 옵션 카드 섹션과 프리셋(R3·R4) — 옵션 카드 섹션에는 프리셋을 적용하지 않고(카드 배치 보존), 다른 섹션에서 슬롯으로 옮긴 사진은
// 카드 사진 모서리(borderRadii)를 뗀다.

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../types/canvas'
import type { DesignPalette } from '../types/editor'
import { ProSectionType } from '../types/section'
import { loadLayoutPresets } from '../data/layouts'
import { parseOptionLabels } from '../../options/option-spec'
import { FAIRNEX_OPTION_LABELS } from '../../options/__fixtures__/fairnex-option-labels'
import { applyLayoutPreset, applyLayoutPresetIfSafe, isOptionGallerySection } from './applyLayoutPreset'
import { buildOptionGalleryElements } from './sectionConverter/optionGallery'

const palette: DesignPalette = {
  primary: '#DE788C', secondary: '#8B9E6B', bgMain: '#FFFFFF', bgSub: '#F5F5F5', textMain: '#1A1A1A', textHighlight: '#DE788C',
}

function optionSection(): CanvasSection {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P01)
  const withPhotos = { ...spec, variants: spec.variants.map((v) => ({ ...v, sourceImage: `https://cdn.test/${encodeURIComponent(v.label)}.jpg` })) }
  const r = buildOptionGalleryElements({ spec: withPhotos, palette, startY: 200 })
  return {
    id: 'opt', sectionType: ProSectionType.PETIT_DIV, groupType: 'modules', order: 0, isVisible: true, layoutId: 'petit_div_layout_01',
    canvas: { width: 860, height: 200 + r.height + 80, backgroundColor: '#FFFFFF' }, elements: r.elements,
  } as CanvasSection
}

describe('옵션 카드 섹션 — 프리셋을 적용하지 않는다(R4, 카드 배치 보존)', () => {
  it('petit_div 프리셋 10종 모두: 직접 적용은 섹션 그대로, 초기 자동 적용(IfSafe)은 null(빌더 배치 유지)', async () => {
    const section = optionSection()
    expect(isOptionGallerySection(section)).toBe(true)
    const presets = await loadLayoutPresets(ProSectionType.PETIT_DIV)
    expect(presets.length).toBeGreaterThan(0)
    for (const preset of presets) {
      expect(applyLayoutPreset(section, preset, palette)).toBe(section)
      expect(applyLayoutPresetIfSafe(section, preset, palette)).toBeNull()
    }
  })

  it('옵션 카드가 아닌 섹션(이벤트 옵션 option_title·option_0·option_img, petit_div 알약 petit_opt_*)은 그대로 프리셋 대상', () => {
    const plain = {
      elements: [{ name: 'option_title' }, { name: 'option_0' }, { name: 'option_img' }, { name: 'petit_opt_0' }, { name: 'petit_img' }],
    } as CanvasSection
    expect(isOptionGallerySection(plain)).toBe(false)
  })
})

describe('프리셋 적용 — 슬롯으로 옮긴 사진은 모서리 반경을 뗀다(R3)', () => {
  it('반경 있는 사진이 옵션 카드가 아닌 섹션에서 슬롯을 받으면 borderRadii가 없다', async () => {
    // 옵션 카드 이름을 떼어 일반 섹션으로 만든다(반경 있는 사진만 남김)
    const gallery = optionSection()
    const section = {
      ...gallery,
      elements: gallery.elements.map((e) => ({ ...e, name: e.name.replace(/^option_/, 'item_') })),
    } as CanvasSection
    expect(isOptionGallerySection(section)).toBe(false)
    let slotted = 0
    for (const preset of await loadLayoutPresets(ProSectionType.PETIT_DIV)) {
      const out = applyLayoutPreset(section, preset, palette)
      for (const el of out.elements.filter((e) => e.type === 'image' && e.imageProps)) {
        if (el.name.startsWith('item_card_img_')) continue
        slotted++
        expect(el.imageProps!.borderRadii).toBeUndefined()
      }
    }
    expect(slotted).toBeGreaterThan(0)
  })
})
