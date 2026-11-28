/**
 * K7-c (가) 주의·보관 섹션 notice(T1-39·T2-04 짙은 머리 띠 줄, T2-05 옅은 상자 + 경고 표식, T2-06 종류 아이콘 줄 — 통합 11-04 01:2x 승인, 판단 5개 ⓐ).
 * 입력 주의·보관 줄과 추가 스펙 관리 행(D T9와 같은 읽기)에서 상품 정보 표 특수 행이 이미 싣는 글을 빼고, 있을 때만 연다. 줄은 입력 그대로 넣고 넘치거나 길면 그 칸을 고르지 않는다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { availableEvidence, hasNoticeInput } from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import { INPUT_SLOT_SAMPLE, withSampleInputSlots } from '../__fixtures__/input-slots.sample'
import { inputSlotsOf } from '../input-slots-read'
import { NOTICE_ROW_LABEL } from '../internalized/designcut-long'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { fillInputSlots, lineInputsOf, namedNoticesOf, NOTICE_KIND_LABEL, pageNoticesOf, requiredInputsFit, TABLE_SPECIAL_MAX } from './input-values'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import { defaultComposition, INPUT_INFO_SECTIONS, repairComposition } from './selection'
import { evidenceOf } from './selection-facts'
import { REQUIRED_SECTIONS } from './selection-order'
import { K_SECTIONS } from './template-meta'
import type { Template } from './template-types'

const NEW_CELLS = ['notice.band-head-rows', 'notice.warn-box', 'notice.icon-rows']
const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const BASE = { productName: '표본 상품' } as unknown as PdpSpecSheet
const inputsOf = (spec: PdpSpecSheet) => lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const withNotices = (items: Array<{ kind: string; text: string }>, extra: Array<{ key: string; value: string }> = []) =>
  ({ ...BASE, noticeItems: items, extraSpecs: extra }) as unknown as PdpSpecSheet
const itemsOf = (id: string, spec: PdpSpecSheet) => fillInputSlots(cell(id), inputsOf(spec)).items as Array<Record<string, string>> | undefined

describe('K7-c (가) — 주의·보관 섹션', () => {
  it('섹션 칸이 셋이고 모두 근거 notice로 잠겨 있다', () => {
    expect(templatesOf('notice').map((t) => t.id).sort()).toEqual([...NEW_CELLS].sort())
    for (const id of NEW_CELLS) expect(cell(id).needs.evidence, id).toEqual(['notice'])
  })

  it.each(NEW_CELLS)('%s — 린트 위반 0', (id) => {
    expect(lintTemplate(cell(id)).map((v) => `${v.rule}:${v.detail}`)).toEqual([])
  })

  it.each(NEW_CELLS)('%s — 입력이 없으면 고르지 않는다', (id) => {
    expect(requiredInputsFit(cell(id), inputsOf(BASE))).toBe(false)
    expect(evidenceOf(BASE).has('notice')).toBe(false)
  })

  it('입력 상한 전부(6줄 × 80자)를 받는 칸이 있다 — 입력이 있으면 섹션이 조용히 빠지지 않는다', () => {
    const full = withNotices(Array.from({ length: 6 }, (_, i) => ({ kind: 'caution', text: `${i + 1}${'가'.repeat(79)}` })))
    expect(namedNoticesOf(full)).toHaveLength(6)
    expect(itemsOf('notice.band-head-rows', full)).toHaveLength(6)
  })

  it('줄 이름은 D 주의·보관 표와 같고, 글은 입력 그대로다', () => {
    expect(NOTICE_KIND_LABEL).toEqual(NOTICE_ROW_LABEL)
    const sample = withSampleInputSlots(BASE)
    expect(itemsOf('notice.band-head-rows', sample)?.map((item) => item.text)).toEqual(pageNoticesOf(sample).map((item) => item.text))
    expect(itemsOf('notice.band-head-rows', sample)?.map((item) => item.kind)).toEqual(pageNoticesOf(sample).map((item) => NOTICE_ROW_LABEL[item.kind]))
  })

  it('상품 정보 표 특수 행이 싣는 관리 글은 빼고, 표가 못 싣는 관리 행은 싣는다(⑤)', () => {
    // '관리 방법'은 표 특수 행(product-info-rows SPECIAL_INFO_KEY)이 싣는다 — 같은 글을 두 번 두지 않는다
    const onlyTable = withNotices([], [{ key: '관리 방법', value: '찬물에 손세탁해요' }])
    expect(namedNoticesOf(onlyTable)).toHaveLength(1)
    expect(pageNoticesOf(onlyTable)).toEqual([])
    expect(evidenceOf(onlyTable).has('notice')).toBe(false)
    // '주의사항'은 표가 싣지 않는다 — notice가 싣는다
    const caution = withNotices([], [{ key: '주의사항', value: '불 가까이 두지 마세요' }])
    expect(pageNoticesOf(caution).map((item) => item.text)).toEqual(['불 가까이 두지 마세요'])
    expect(evidenceOf(caution).has('notice')).toBe(true)
  })

  it('상품 정보 표 특수 행 수는 모든 spec_table 칸의 특수 행 목록 상한과 같다', () => {
    for (const t of templatesOf('spec_table')) {
      const special = Object.values(t.slots).find((slot) => slot.type === 'list' && slot.input === 'spec.special')
      expect(special && special.type === 'list' ? special.max : undefined, t.id).toBe(TABLE_SPECIAL_MAX)
    }
  })

  it('아이콘 줄 — 보관·관리 줄은 종류 아이콘을 싣고, 주의 줄이 하나라도 있으면 고르지 않는다(주의는 중립 아이콘이 없다)', () => {
    const calm = withNotices([{ kind: 'storage', text: '서늘한 곳에 보관해요' }, { kind: 'care', text: '물로 헹궈 말려요' }])
    expect(itemsOf('notice.icon-rows', calm)?.map((item) => item.icon)).toEqual(['storage', 'clean'])
    expect(itemsOf('notice.icon-rows', withSampleInputSlots(BASE))).toBeUndefined()
    expect(itemsOf('notice.warn-box', withSampleInputSlots(BASE))?.length).toBeGreaterThan(0)
  })

  it('칸보다 긴 줄이 하나라도 있으면 그 칸은 비우고, 상한이 큰 칸이 받는다', () => {
    const long = withNotices([{ kind: 'storage', text: '가'.repeat(70) }, { kind: 'care', text: '짧은 관리' }])
    expect(itemsOf('notice.warn-box', long)).toBeUndefined()
    expect(itemsOf('notice.band-head-rows', long)).toHaveLength(2)
  })

  it('D 주의·보관 읽기(inputSlotsOf.notices)는 그대로다 — 입력 줄 다음 추가 스펙 관리 행', () => {
    const sample = withSampleInputSlots(BASE)
    expect(inputSlotsOf(sample).notices).toEqual([...INPUT_SLOT_SAMPLE.noticeItems, { kind: 'care', text: '표본 관리 행입니다' }])
  })

  it('자리 — 기본 구성·입력 정보 섹션에서 성분보다 앞이라 넘치면 성분이 먼저 빠지고, 자리가 하나면 주의가 든다. 상품 정보 표는 늘 남는다(통합 01:2x ①)', () => {
    // GIF 칸(motion_band)은 motionband 스위치 잡에만 열려 이 자리 시험 밖이다 — 맨 뒤 자리는 motion-band-section.test가 본다
    const open = (K_SECTIONS as unknown as string[]).filter((s) => s !== 'motion_band')
    expect(INPUT_INFO_SECTIONS.map((s) => s.section)).toEqual(['how_to', 'notice', 'ingredients', 'motion_band'])
    const comp = defaultComposition(open)
    expect(comp.slice(-2)).toEqual(['notice', 'ingredients'])
    const full = repairComposition(comp, new Set(['review', 'ingredient', 'usage', 'notice']), open)
    expect(full.removed.slice(0, 2)).toEqual(['ingredients', 'notice'])
    expect(full.sections).toContain('spec_table')
    const base = comp.filter((s) => s !== 'notice' && s !== 'ingredients')
    const drop = base.findIndex((s) => !(REQUIRED_SECTIONS as readonly string[]).includes(s) && s !== 'review')
    const room = base.filter((_, i) => i !== drop)
    expect(room).toHaveLength(21)
    const one = repairComposition(room, new Set(['ingredient', 'notice']), open)
    expect(one.sections).toContain('notice')
    expect(one.sections).not.toContain('ingredients')
    expect(one.sections).toContain('spec_table')
  })

  it('하네스 H0 notice 근거는 K보다 넓다 — K가 열면 H0도 연다', () => {
    const cases = [BASE, withSampleInputSlots(BASE), withNotices([], [{ key: '관리 방법', value: '찬물에 손세탁해요' }]), withNotices([], [{ key: '주의사항', value: '불 가까이 두지 마세요' }])]
    for (const spec of cases) {
      if (evidenceOf(spec).has('notice')) expect(hasNoticeInput(spec)).toBe(true)
      expect(availableEvidence(spec).has('notice')).toBe(hasNoticeInput(spec))
    }
  })
})
