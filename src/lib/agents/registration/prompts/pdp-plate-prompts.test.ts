/**
 * 디자인 컷 배경 플레이트 프롬프트(D1) — 08_DESIGN_CUTS.md §2.4 골격·§3 템플릿 지시·§8 금지.
 * 2026-10-28 개정: 제품 누끼가 없으면(기본) 받침·테이블 없이 사진 배경 계열 벽 + 컷과 같은 광원.
 */

import { describe, expect, it } from 'vitest'
import { buildPlatePrompt, type PlateTemplate } from './pdp-plate-prompts'

const palette = { accent: '#F5539E', deep: '#702346', tint: '#FEECF2' }
const photoPalette = { accent: '#B78936', deep: '#745A32', tint: '#FEEDED', photoBackground: '#F7CECF' }
const lighting = { direction: 'top-right', shadowAngle: 30, temperature: 'warm (~5200K)' }
const TEMPLATES: PlateTemplate[] = ['T1', 'T3a', 'T3c', 'T6', 'T8']

describe('buildPlatePrompt', () => {
  it.each(TEMPLATES)('%s: 글자·제품·사람 금지(NO TEXT)와 팔레트 hex, 한글 없음', (template) => {
    const prompt = buildPlatePrompt({ template, palette, category: 'household', chapter: 1 })
    expect(prompt).toContain('STRICT: NO TEXT.')
    expect(prompt).toContain('no product, no people, no hands')
    expect(prompt).toContain(palette.tint)
    expect(/[가-힣]/.test(prompt)).toBe(false)
  })

  it('누끼 있음(productAlpha true): 받침 선·글자 안전 띠를 이미지 높이 %로 못 박는다(편집기 크롭 창 §2.3과 같은 값)', () => {
    const at = (template: PlateTemplate) =>
      buildPlatePrompt({ template, palette, category: 'household', chapter: 1, productAlpha: true })
    expect(at('T1')).toContain('podium top edge sits at 78% of image height')
    expect(at('T1')).toContain('upper 33%')
    expect(at('T1')).toContain(`dominant ${palette.deep} and ${palette.accent}`)
    expect(at('T8')).toContain('77.5% of image height')
    expect(at('T3a')).toContain('surface top edge sits at 79% of image height')
    expect(at('T3c')).toContain('from 38% to 69% of image height')
    expect(at('T6')).toContain('centered empty area 70% of the width')
  })

  it.each(['T1', 'T3a'] as PlateTemplate[])(
    '%s 누끼 없음(기본): 받침·테이블 지시 없이 금지 문구, 벽은 사진 배경색, 짙은 색은 주조색이 아니다',
    (template) => {
      const prompt = buildPlatePrompt({ template, palette: photoPalette, category: 'packaging', chapter: 1 })
      expect(prompt).not.toMatch(/podium top edge|surface top edge|a low round podium|tabletop/)
      expect(prompt).toContain('NO podium, NO pedestal, NO table')
      expect(prompt).toContain(`dominant ${photoPalette.photoBackground}`)
      expect(prompt).not.toContain(`dominant ${photoPalette.deep}`)
      expect(prompt).toContain('central 60% width')
    }
  )

  it.each(['T3c', 'T8'] as PlateTemplate[])(
    '%s 흰 글자가 얹히는 짙은 바탕 템플릿: 누끼가 없어도 짙은 무대(받침 없음) — 밝은 벽이면 흰 글자 대비가 무너진다',
    (template) => {
      const prompt = buildPlatePrompt({ template, palette: photoPalette, category: 'packaging', chapter: 1 })
      expect(prompt).toContain(`dominant ${photoPalette.deep} and ${photoPalette.accent}`)
      expect(prompt).not.toContain(`dominant ${photoPalette.photoBackground}`)
      expect(prompt).not.toMatch(/podium top edge|a low round podium/)
    }
  )

  it('사진 배경색이 없으면(카피 팔레트 기록) 벽은 tint', () => {
    const prompt = buildPlatePrompt({ template: 'T1', palette, category: 'household' })
    expect(prompt).toContain(`dominant ${palette.tint}`)
  })

  it('광원·색온도는 제품 컷 스타일 헌장 값 — 없으면 기존 왼쪽 위 부드러운 빛', () => {
    const withLight = buildPlatePrompt({ template: 'T3c', palette: photoPalette, category: 'beauty', lighting })
    expect(withLight).toContain(
      'soft key light from top-right, shadows falling at 30 degrees, warm (~5200K) color temperature'
    )
    expect(withLight).not.toContain('from upper left')
    expect(buildPlatePrompt({ template: 'T3c', palette, category: 'beauty' })).toContain('key light from upper left')
  })

  it('T3a는 POINT마다 장면 맥락·밝기를 바꾼다(같은 제품 컷 반복 완화)', () => {
    const one = buildPlatePrompt({ template: 'T3a', palette, category: 'household', chapter: 1 })
    const two = buildPlatePrompt({ template: 'T3a', palette, category: 'household', chapter: 2 })
    expect(one).not.toBe(two)
    expect(one).toContain('kitchen counter')
    expect(two).toContain('bathroom shelf')
  })
})
