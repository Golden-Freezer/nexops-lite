// K 표 이름(K2) — 표 이름은 장식 이름표 규칙으로 그리지만 내용이라, 편집기에서 레이아웃 프리셋을 적용해도 걷어내지 않는다.
// 다른 장식(치수선·치수 이름표)은 전처럼 걷어낸다.

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../types/canvas'
import type { DesignPalette } from '../types/editor'
import { ProSectionType } from '../types/section'
import { loadLayoutPresets } from '../data/layouts'
import { renderTemplate } from '../../templatelib/engine'
import { ctxOf } from '../../templatelib/engine.fixture'
import { templateById } from '../../templatelib/library'
import type { SlotValues, Template } from '../../templatelib/template-types'
import { applyLayoutPreset } from './applyLayoutPreset'
import { TABLE_NAME_ELEMENT } from './mobileReadability'

const palette: DesignPalette = {
  primary: '#DE788C', secondary: '#8B9E6B', bgMain: '#FFFFFF', bgSub: '#F5F5F5', textMain: '#1A1A1A', textHighlight: '#DE788C',
}
const NAMES = ['상품명', '브랜드', '사이즈', '원산지']

function tableSection(): CanvasSection {
  const slots = { photo: 'a', width: '가로 34cm', height: '세로 19.5cm', rows: NAMES.map((label) => ({ label, value: `${label} 값` })) } as unknown as SlotValues
  const out = renderTemplate(templateById('spec_table.dimension') as Template, slots, ctxOf())!
  return {
    id: 'spec', sectionType: ProSectionType.SPEC_TABLE, groupType: 'modules', order: 0, isVisible: true, layoutId: 'designcut_k_spec',
    canvas: { width: 860, height: out.height, backgroundColor: out.background }, elements: out.elements,
  } as CanvasSection
}

describe('레이아웃 프리셋과 표 이름', () => {
  it('spec_table 프리셋 전부: 표 이름은 남고, 치수선·치수 이름표 장식은 걷어낸다', async () => {
    const section = tableSection()
    expect(section.elements.filter((e) => e.name === TABLE_NAME_ELEMENT)).toHaveLength(NAMES.length)
    const presets = await loadLayoutPresets(ProSectionType.SPEC_TABLE)
    expect(presets.length).toBeGreaterThan(0)
    for (const preset of presets) {
      const after = applyLayoutPreset(section, preset, palette)
      const texts = after.elements.flatMap((e) => (e.textProps ? [e.textProps.content] : []))
      for (const name of NAMES) expect(texts, preset.id).toContain(name)
      expect(after.elements.some((e) => e.name.startsWith('annotation-leader-') || e.name.startsWith('annotation-chip-')), preset.id).toBe(false)
    }
  })
})
