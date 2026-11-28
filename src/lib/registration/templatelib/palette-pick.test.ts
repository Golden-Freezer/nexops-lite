/**
 * K 색 조합 비전 고르기 순수 함수(결정 카드 c28, 하네스 J26) — 후보(사진 색 순서 앞 3개)·견본 SVG·프롬프트·답 읽기. 모델 콜 없음
 */

import { describe, expect, it } from 'vitest'
import { colorSetsOf, rankForPhoto } from './color-sets'
import { CONCEPTS } from './concepts'
import { buildPalettePickPrompt, PALETTE_PICK_COUNT, paletteCandidatesOf, parsePalettePick, swatchSvgOf } from './palette-pick'
import { pickPalette } from './selection'

const concept = CONCEPTS[0]
const PHOTO = '#2f6fd0'

describe('paletteCandidatesOf', () => {
  it('규칙(pickPalette)과 같은 컨셉·같은 사진 색 순서의 앞 3개다', () => {
    const candidates = paletteCandidatesOf(concept, PHOTO)
    expect(PALETTE_PICK_COUNT).toBe(3)
    expect(candidates).toHaveLength(3)
    expect(candidates).toEqual(rankForPhoto(colorSetsOf(concept).sets, PHOTO).sets.slice(0, 3))
    expect(candidates.every((set) => set.conceptId === concept.id)).toBe(true)
  })

  it('사진 색이 없으면 조합 목록 앞 3개다', () => {
    expect(paletteCandidatesOf(concept, null)).toEqual(colorSetsOf(concept).sets.slice(0, 3))
  })

  it('모든 컨셉에서 후보가 2개 이상이고 규칙 색과 같은 강조색 줄에서 시작한다', () => {
    for (const c of CONCEPTS) {
      const candidates = paletteCandidatesOf(c, PHOTO)
      expect(candidates.length, c.id).toBeGreaterThanOrEqual(2)
      expect(candidates[0].accent, c.id).toBe(pickPalette(c, { key: 'k', productHex: PHOTO })!.accent)
    }
  })
})

describe('swatchSvgOf', () => {
  it('바탕·옅은 면·강조·짙은 면·글자색 띠 5개, 글자 없음', () => {
    const [set] = paletteCandidatesOf(concept, PHOTO)
    const svg = swatchSvgOf(set)
    const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])
    expect(fills).toEqual([set.colors.base, set.colors.tint, set.colors.accent, set.colors.deep, set.colors.ink])
    expect(svg).toContain('width="300" height="200"')
    expect(svg).not.toContain('<text')
  })
})

describe('buildPalettePickPrompt', () => {
  it('사진이 image 1, 견본이 A·B·C = image 2·3·4이고 후보 값과 답 형식을 싣는다', () => {
    const candidates = paletteCandidatesOf(concept, PHOTO)
    const prompt = buildPalettePickPrompt({ product: '데이지 머리끈', candidates })
    expect(prompt).toContain('Product: 데이지 머리끈')
    expect(prompt).toContain('Image 1 is the original product photo')
    candidates.forEach((set, i) => {
      expect(prompt).toContain(`${'ABC'[i]} = image ${i + 2}: background ${set.colors.base}, light panel ${set.colors.tint}, accent ${set.colors.accent}`)
    })
    expect(prompt).toContain('{"pick": "A" | "B" | "C"')
  })

  it('후보가 2개면 답은 A·B만, 상품 설명이 없으면 그렇다고 적는다', () => {
    const prompt = buildPalettePickPrompt({ product: '', candidates: paletteCandidatesOf(concept, PHOTO).slice(0, 2) })
    expect(prompt).toContain('{"pick": "A" | "B", ')
    expect(prompt).not.toContain('C = image')
    expect(prompt).toContain('Product: (no description)')
  })
})

describe('parsePalettePick', () => {
  it('글자를 번호로, 이유는 200자까지', () => {
    expect(parsePalettePick('{"pick":"b","reason":" 상품 파랑과 어울린다 "}', 3)).toEqual({ index: 1, reason: '상품 파랑과 어울린다' })
    expect(parsePalettePick('```json\n{"pick": "A"}\n```', 3)).toEqual({ index: 0, reason: '' })
    expect(parsePalettePick(JSON.stringify({ pick: 'C', reason: '가'.repeat(300) }), 3).reason).toHaveLength(200)
  })

  it('후보 밖·빈 답·형식 오류는 던진다(콜 실패 → 규칙 색)', () => {
    expect(() => parsePalettePick('{"pick":"C"}', 2)).toThrow('후보 밖')
    expect(() => parsePalettePick('{"pick":"D"}', 3)).toThrow('후보 밖')
    expect(() => parsePalettePick('{"reason":"x"}', 3)).toThrow('후보 밖')
    expect(() => parsePalettePick('{"pick":1}', 3)).toThrow('후보 밖')
  })
})
