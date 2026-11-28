/**
 * 경쟁 장치 템플릿(partsbands 스위치, 하네스 J54 — 통합 decide 32, J52 대조표 ②-2) — 쿠팡 경쟁 가위 01~06처럼 구성품이 셋 이상이면
 * 번호 구성 템플릿이 컨셉 점수와 상관없이 그 섹션 후보 앞자리다. 꺼진 잡(partsLead 없음)은 후보가 지금과 같다. AI 단계 없음(유료 0).
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON } from '../enrichment-switch'
import { CONCEPTS } from './concepts'
import { lineInputsOf, requiredInputsFit } from './input-values'
import { TEMPLATES } from './library'
import { candidatesFor, isNumberedParts, PARTS_LEAD_MIN, type SelectionProfile } from './selection'
import { evidenceOf } from './selection-facts'
import type { TemplateMeta } from './template-meta'
import type { Template } from './template-types'

const library = TEMPLATES as unknown as TemplateMeta[]
const numbered = library.filter(isNumberedParts)
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const withParts = (value: string) => ({ ...BASE, extraSpecs: [{ key: '구성품', value }] }) as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)

const profile = (spec: PdpSpecSheet, partsLead: boolean): SelectionProfile => ({
  key: 'P-scissors',
  categoryKey: 'household',
  photoCount: 10,
  productHex: null,
  evidence: evidenceOf(spec),
  drawable: (t) => requiredInputsFit(t as unknown as Template, inputsOf(spec)),
  ...(partsLead ? { partsLead: true } : {}),
})

describe('번호 구성 템플릿 판정', () => {
  it('구성품 목록(parts.items)과 번호 원이 있는 템플릿만 — parts-numbered·parts-side·parts-tiles가 든다', () => {
    const ids = numbered.map((t) => t.id)
    for (const id of ['product_exposure.parts-numbered', 'product_exposure.parts-side', 'product_exposure.parts-tiles']) expect(ids, id).toContain(id)
    expect(ids.every((id) => !id.startsWith('option_gallery.'))).toBe(true)
  })

  it('앞자리 문턱은 구성품 셋이다', () => {
    expect(PARTS_LEAD_MIN).toBe(3)
  })
})

describe('partsbands 켬(partsLead) — 구성품 셋 이상이면 컨셉과 상관없이 번호 구성 템플릿이 첫 후보다', () => {
  const three = withParts('본체, 받침, 덮개')

  it('모든 컨셉에서 product_exposure 첫 후보가 번호 구성 템플릿이다', () => {
    for (const concept of CONCEPTS) {
      const list = candidatesFor('product_exposure', library, profile(three, true), concept)
      if (list.length === 0) continue
      expect(isNumberedParts(list[0]), concept.id).toBe(true)
    }
  })

  it('끈 잡(partsLead 없음)은 앞자리를 주지 않는다 — 컨셉에 따라 번호 구성 템플릿이 첫 후보가 아니다', () => {
    let notFirst = 0
    for (const concept of CONCEPTS) {
      const off = candidatesFor('product_exposure', library, profile(three, false), concept)
      if (off.length > 0 && !isNumberedParts(off[0])) notFirst++
    }
    expect(notFirst).toBeGreaterThan(0)
  })

  it('구성품을 그릴 수 없으면(이름 하나·없음) 켜도 번호 구성 템플릿이 후보에 없다', () => {
    for (const spec of [BASE, withParts('본체 하나')]) {
      for (const concept of CONCEPTS.slice(0, 5)) {
        const list = candidatesFor('product_exposure', library, profile(spec, true), concept)
        expect(list.some(isNumberedParts), concept.id).toBe(false)
      }
    }
  })
})

describe('스위치', () => {
  it('partsbands는 기본 off이고 K4 운영 전환 목록에 없다', () => {
    expect(ENRICHMENT_DEFAULTS.partsbands).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('partsbands')
  })
})
