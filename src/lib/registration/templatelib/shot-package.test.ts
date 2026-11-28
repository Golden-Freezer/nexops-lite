/**
 * 포장 컷 한 장 보장(J58, 통합 decide 35·38) — photoroles 잡에서 포장 역할 사진이 있으면 배정에 package 컷을 한 장 둔다.
 * 포장 사진이 없거나 스위치가 꺼진 잡은 배정·기록이 바이트 그대로다. AI 단계는 가짜다(유료 호출 0)
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { PdpJobRow } from '../pdp-state'
import { CONCEPTS } from './concepts'
import { lineInputsOf } from './input-values'
import { TEMPLATES } from './library'
import { selectLineInputOf, selectTemplateLine, type SelectLineInput, type TemplateAgents } from './select-line'
import { assignShotRows, isTouchScale, type ShotContext, type ShotSlot } from './shot-assign'
import type { TemplateMeta } from './template-meta'
import { yieldToEventLoop } from './__test__/yield'

const slot = (composition: string[], purpose: string[], name = 'photo'): ShotSlot => ({ slot: name, def: { type: 'image', required: true, purpose, composition } })
const context = (over: Partial<ShotContext> = {}): ShotContext => ({ heroKind: 'studio', multiple: true, hasSize: false, ...over })
const PACK = context({ packagePhoto: true })
const purposes = (rows: ReturnType<typeof assignShotRows>) => rows.flat().map((s) => s.purpose)
const packages = (rows: ReturnType<typeof assignShotRows>) => purposes(rows).filter((p) => p === 'package').length

describe('forcePackage — 배정 규칙', () => {
  const hook = slot(['front'], ['hero'])

  it('(가) 포장 목적을 받는 칸을 뒤쪽부터 고르고, 그 칸의 구도는 그대로다', () => {
    // 동률이면 목록 앞 목적을 고르므로 각 칸 맨 앞 목적이 처음 쓰이게 둔다 — 끈 배정에는 포장이 없다
    const rows = [[hook], [slot(['front'], ['feature_proof', 'package'])], [slot(['closeup'], ['texture'])], [slot(['top'], ['scene', 'package'])]]
    const sections = ['key_message', 'point_div', 'point_div', 'point_div']
    const off = assignShotRows(rows, context(), sections)
    expect(packages(off)).toBe(0)
    const on = assignShotRows(rows, PACK, sections)
    expect(packages(on)).toBe(1)
    expect(on[3][0]).toEqual({ ...off[3][0], purpose: 'package' })
    expect(on.slice(0, 3)).toEqual(off.slice(0, 3))
  })

  it('(나) 받는 칸이 없으면 구성·정보·마무리 섹션의 상품 칸을 뒤쪽부터 — 그 밖 섹션 칸은 쓰지 않는다', () => {
    const rows = [[hook], [slot(['front'], ['feature_proof'])], [slot(['angle45'], ['group', 'hero'])], [slot(['side'], ['feature_proof'])]]
    const off = assignShotRows(rows, context(), ['key_message', 'main_cut', 'cta', 'point_div'])
    const on = assignShotRows(rows, PACK, ['key_message', 'main_cut', 'cta', 'point_div'])
    expect(packages(on)).toBe(1)
    expect(on[2][0]).toEqual({ ...off[2][0], purpose: 'package' })
    expect(on[3]).toEqual(off[3])
    // 섹션 id가 없으면(목록 없음) (나)는 고를 곳이 없다
    expect(assignShotRows(rows, PACK)).toEqual(off)
  })

  it('(가)가 (나)보다 먼저다 — 받는 칸이 앞에 있어도 그 칸을 쓴다', () => {
    const rows = [[hook], [slot(['front'], ['feature_proof', 'package'])], [slot(['angle45'], ['hero'])]]
    const on = assignShotRows(rows, PACK, ['key_message', 'point_div', 'cta'])
    expect(on[1][0].purpose).toBe('package')
    expect(on[2][0].purpose).not.toBe('package')
  })

  it('첫 컷·크기 컷·치수 컷·고민·비교·착용 칸은 바꾸지 않고, 바꿀 칸이 없으면 그대로다', () => {
    const sections = ['main_cut', 'main_cut', 'spec_table', 'cta', 'cta', 'cta']
    const rows = [
      [slot(['front'], ['hero', 'package'])],
      [slot(['in_hand'], ['hero'])],
      [slot(['front'], ['scale'])],
      [slot(['in_use'], ['problem', 'package'])],
      [slot(['front'], ['compare', 'package'])],
      [slot(['worn'], ['hero'])],
    ]
    const sized = context({ hasSize: true, heroKind: 'worn' })
    const off = assignShotRows(rows, sized, sections)
    expect(off[1][0]).toMatchObject({ purpose: 'scale', composition: 'in_hand' })
    expect(off[2][0].purpose).toBe('scale')
    const on = assignShotRows(rows, { ...sized, packagePhoto: true }, sections)
    expect(on).toEqual(off)
    expect(on.flat().filter(isTouchScale)).toHaveLength(1)
  })

  it('이미 포장 컷이 있으면 아무것도 바꾸지 않는다', () => {
    const rows = [[hook], [slot(['front'], ['package'])], [slot(['angle45'], ['hero'])]]
    const sections = ['key_message', 'spec_table', 'cta']
    const off = assignShotRows(rows, context(), sections)
    expect(packages(off)).toBe(1)
    expect(assignShotRows(rows, PACK, sections)).toEqual(off)
  })

  it('packagePhoto가 없거나 false면 섹션 목록과 상관없이 지금 배정 그대로다', () => {
    const rows = [[hook], [slot(['front'], ['feature_proof', 'package'])], [slot(['angle45'], ['group', 'hero'])]]
    const before = assignShotRows(rows, context())
    expect(assignShotRows(rows, context(), ['key_message', 'main_cut', 'cta'])).toEqual(before)
    expect(assignShotRows(rows, context({ packagePhoto: false }), ['key_message', 'main_cut', 'cta'])).toEqual(before)
  })
})

describe('시험 상품 전 컨셉 — 포장 컷', () => {
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const agentsFor = (conceptId: string) =>
    ({
      guideline: async () => free({ persona: '', tone: '', concept: { id: conceptId, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }: { slots: Array<{ index: number; candidates: Array<{ id: string }> }> }) => free(slots.map((s) => ({ index: s.index, templateId: s.candidates[0].id, reason: '' }))),
    }) as unknown as TemplateAgents

  it('11상품 × 44컨셉: 끈 잡은 바이트 그대로, 켠 잡은 템플릿 그대로·한 칸만 package로 바뀌고 첫 컷·크기 컷은 그대로다', async () => {
    let pages = 0
    let forced = 0
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const product = getPdpTestProduct(id)
      const inputs = lineInputsOf({ spec_sheet: product.specSheet, analysis: {}, copy_sections: { final: { options: product.specSheet.colorOptions ?? [] } } } as unknown as PdpJobRow)
      const base: SelectLineInput = {
        key: id,
        categoryKey: product.categoryKey,
        productHex: null,
        spec: product.specSheet,
        templates: TEMPLATES as unknown as TemplateMeta[],
        inputs,
        product: { category: product.categoryKey, persona: null, summary: '', keywords: [], usps: [], pains: [] },
      }
      for (const concept of CONCEPTS) {
        await yieldToEventLoop()
        const label = `${id}·${concept.id}`
        const off = await selectTemplateLine(base, agentsFor(concept.id))
        const offFalse = await selectTemplateLine({ ...base, packagePhoto: false }, agentsFor(concept.id))
        expect(JSON.stringify(offFalse.order), label).toBe(JSON.stringify(off.order))
        expect(JSON.stringify(offFalse.record), label).toBe(JSON.stringify(off.record))
        const on = await selectTemplateLine({ ...base, packagePhoto: true }, agentsFor(concept.id))
        pages++
        expect(on.order.sections.map((s) => s.templateId), label).toEqual(off.order.sections.map((s) => s.templateId))
        const before = off.order.sections.flatMap((s) => s.shots)
        const after = on.order.sections.flatMap((s) => s.shots)
        expect(after.length, label).toBe(before.length)
        const changed = after.flatMap((shot, i) => (JSON.stringify(shot) === JSON.stringify(before[i]) ? [] : [i]))
        expect(changed.length, label).toBeLessThanOrEqual(1)
        for (const i of changed) {
          expect(after[i], label).toEqual({ ...before[i], purpose: 'package' })
          expect(i, label).not.toBe(0)
          expect(before[i].purpose, label).not.toBe('scale')
        }
        if (changed.length === 1) forced++
        if (before.some((s) => s.purpose === 'package')) expect(changed, label).toEqual([])
        expect(after.filter(isTouchScale).length, label).toBe(before.filter(isTouchScale).length)
      }
    }
    expect(pages).toBe(PDP_TEST_PRODUCT_IDS.length * CONCEPTS.length)
    // 켠 잡 대부분에 포장 컷이 생긴다(바꿀 칸이 없는 페이지만 그대로)
    expect(forced).toBeGreaterThan(pages / 2)
  }, 240000)
})

describe('selectLineInputOf — packagePhoto', () => {
  const item = getPdpTestProduct('P08')
  const PHOTO_A = 'https://cdn.example.com/registration/uploads/a.jpg'
  const PHOTO_B = 'https://cdn.example.com/registration/uploads/b.jpg'
  const jobOf = (features: string[], roles?: Array<{ url: string; role: string }>) =>
    ({
      id: 'job-package',
      cost_pool: 'test',
      source_images: [PHOTO_A, PHOTO_B],
      spec_sheet: { ...item.specSheet, ...(roles ? { sourcePhotoRoles: roles } : {}) },
      analysis: { detected_category: item.categoryKey, raw_summary: '요약 한 줄', enrichment: { version: 1, features } },
      copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
      section_plan: {},
    }) as unknown as PdpJobRow
  const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
  const packaged = [{ url: PHOTO_B, role: 'package' }]

  it('photoroles 켠 잡에 원천 안 포장 역할 사진이 있을 때만 켜진다', () => {
    expect(selectLineInputOf(jobOf(['templatelib', 'photoroles'], packaged), LIBRARY).packagePhoto).toBe(true)
    expect(selectLineInputOf(jobOf(['templatelib'], packaged), LIBRARY)).not.toHaveProperty('packagePhoto')
    expect(selectLineInputOf(jobOf(['templatelib', 'photoroles'], [{ url: PHOTO_B, role: 'option' }]), LIBRARY)).not.toHaveProperty('packagePhoto')
    expect(selectLineInputOf(jobOf(['templatelib', 'photoroles']), LIBRARY)).not.toHaveProperty('packagePhoto')
    // 원천에 없는 주소의 포장 역할은 세지 않는다
    expect(selectLineInputOf(jobOf(['templatelib', 'photoroles'], [{ url: 'https://elsewhere.example.com/x.jpg', role: 'package' }]), LIBRARY)).not.toHaveProperty('packagePhoto')
  })

  it('포장 사진이 없는 photoroles 잡의 입력은 스위치를 끈 잡과 packagePhoto 말고 같다', () => {
    const on = selectLineInputOf(jobOf(['templatelib', 'photoroles'], [{ url: PHOTO_B, role: 'option' }]), LIBRARY)
    const off = selectLineInputOf(jobOf(['templatelib'], [{ url: PHOTO_B, role: 'option' }]), LIBRARY)
    expect(JSON.stringify(on)).toBe(JSON.stringify(off))
  })
})
