/**
 * K7-c 3b-1 사진 위 글 칸 4개(T1-46·T2-08 — 통합 11-04 03:0x: key_message·concept_desc·cta·event_offer, main_cut은 na, hook은 3b-2).
 * 엔진·린트는 그대로이고 칸 JSON만 더한다. 같은 섹션 카테고리 사진 위 글 칸과 화면(사진 위 글 위치)이 겹치지 않고, 사실 수는 같은 섹션 기존 칸과 같다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateById } from './library'
import { lineShotsOf } from './line-plan'
import { lintTemplate } from './lint'
import { lintCategoryTemplates, screenKey } from './lint-category'
import { OVERLAY_SECTIONS } from './overlay'
import type { OrderedSection } from './selection-order'
import { buildShotBrief, OVERLAY_CLEAR_PERCENT } from './shot-brief'
import { deriveSignature, signatureKey } from './signature'
import type { ImageOverlay, Template } from './template-types'

/** 새 칸 → 사실 수를 맞춘 같은 섹션 기존 칸 */
const NEW_CELLS: Readonly<Record<string, string>> = {
  'key_message.overlay-top-center': 'key_message.overlay-top-left',
  'concept_desc.overlay-bottom-story': 'concept_desc.food-scene-overlay-story',
  'cta.overlay-bottom-center': 'cta.fashion-worn-overlay-top',
  'event_offer.overlay-top-left': 'event_offer.accent-bleed',
}
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const overlayOf = (t: Template): ImageOverlay | undefined => {
  const top = t.flow[0]
  return top?.kind === 'image' && top.bleed ? top.overlay : undefined
}
const isCategory = (t: Template) => (t.fit?.categories?.length ?? 0) > 0

describe('K7-c 3b-1 — 사진 위 글 칸 4개', () => {
  it('4칸 모두 린트 위반 0이고, 흐름 맨 위 풀폭 사진 위 글(사진 위 글 섹션 6종 안, W·N)이다', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      expect(lintTemplate(t), id).toEqual([])
      expect(overlayOf(t), id).toBeDefined()
      expect(OVERLAY_SECTIONS, id).toContain(t.section)
      expect(t.surfaces, id).toEqual(['W', 'N'])
    }
  })

  it('같은 섹션 카테고리 사진 위 글 칸과 글 위치가 달라 화면이 겹치지 않고, 같은 섹션 공용과 모양이 다르다(전수 린트는 library.test)', () => {
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const categoryOverlays = TEMPLATES.filter((other) => other.section === t.section && isCategory(other) && overlayOf(other))
      for (const other of categoryOverlays) {
        expect(overlayOf(other)!.anchor, `${id} ↔ ${other.id}`).not.toBe(overlayOf(t)!.anchor)
        expect(screenKey(other.flow, other.slots), `${id} ↔ ${other.id}`).not.toBe(screenKey(t.flow, t.slots))
      }
      const commons = TEMPLATES.filter((other) => other.section === t.section && !isCategory(other) && other.id !== id)
      for (const other of commons) expect(signatureKey(deriveSignature(other)), `${id} ↔ ${other.id}`).not.toBe(signatureKey(deriveSignature(t)))
    }
    expect(lintCategoryTemplates(TEMPLATES)).toEqual([])
  })

  it('사실 수는 같은 섹션 기존 칸과 같다 — 사실 예산 물결을 키우지 않는다', () => {
    for (const [id, near] of Object.entries(NEW_CELLS)) expect(cell(id).needs.facts, id).toEqual(cell(near).needs.facts)
  })

  it('혜택 칸은 offer 근거로 잠기고, 혜택 글은 입력 그대로다(모델 글은 사실 0)', () => {
    const t = cell('event_offer.overlay-top-left')
    expect(t.needs.evidence).toContain('offer')
    const offer = t.slots.offer
    expect(offer).toMatchObject({ type: 'text', required: true, source: 'input', input: 'offer.info', facts: 1 })
    for (const [name, def] of Object.entries(t.slots)) {
      if (def.type === 'text' && def.source !== 'input') expect(def.facts, name).toBe(0)
    }
  })

  it('컷 지시 — 새 칸의 컷은 글 쪽을 비우는 Frame 줄을 싣는다(장부 T1-46 \'K 잡 컷 미확인\')', () => {
    const photo = [{ slot: 'photo', purpose: 'scene', composition: 'in_use' }] as unknown as OrderedSection['shots']
    for (const id of Object.keys(NEW_CELLS)) {
      const t = cell(id)
      const anchor = overlayOf(t)!.anchor
      const [made] = lineShotsOf([{ section: t.section, templateId: id, shots: photo } as unknown as OrderedSection], new Map(), [])
      expect(made.overlayAnchor, id).toBe(anchor)
      expect(buildShotBrief(made), id).toContain(`Frame: Leave the ${anchor} ${OVERLAY_CLEAR_PERCENT}%`)
    }
  })
})
