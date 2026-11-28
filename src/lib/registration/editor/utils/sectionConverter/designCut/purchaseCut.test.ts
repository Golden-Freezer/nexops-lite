/**
 * 디자인 컷 구매 전 확인 — 그린 글에 구성·사이즈·옵션 값이 없으면 디자인 컷 표를 첫 CTA 바로 앞에 넣고(없으면 끝),
 * 다 보이면 그대로 둔다. 판정은 #288(purchaseCheck.ts)과 같다.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import { readDesignCut } from './contract'
import { composeDesignCut, type DesignCutStats } from './compose'
import { insertPurchaseCheck } from './purchaseCut'
import { colorsOf, radiusOf, surfaceOf } from './tokens'
import { designCutPlanForB, designcutJobFromD1 } from './designCut.fixture'

const plan = readDesignCut({ designcut: designCutPlanForB() })!
const ctx = { colors: colorsOf(plan), radius: radiusOf(plan.motif), image: () => null }
const SPEC = { size: '가로 30 x 세로 40cm', colorOptions: ['데이지', '체리'] }

function sec(type: ProSectionType, contents: string[], background = '#FFFFFF'): CanvasSection {
  return {
    id: `s-${type}`,
    sectionType: type,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'x',
    canvas: { width: 860, height: 400, backgroundColor: background },
    elements: contents.map((content, i) => ({ id: `e${i}`, type: 'text', isVisible: true, textProps: { content } })),
  } as unknown as CanvasSection
}
const textsOf = (s: CanvasSection) => s.elements.map((e) => e.textProps?.content ?? '').filter(Boolean)

describe('insertPurchaseCheck', () => {
  it('자리 순서 — 준 자리가 먼저, 없으면 K 표 바로 앞, 그것도 없으면 첫 CTA 앞', () => {
    const body = sec(ProSectionType.POINT_DIV, ['두 송이 한 다발'])
    const cta = sec(ProSectionType.CTA, ['지금 만나 보세요'])
    const kTable = { ...sec(ProSectionType.SPEC_TABLE, ['상품 정보']), layoutId: 'designcut_k_spec_table.plain' }
    const layouts = (out: CanvasSection[]) => out.map((s) => s.layoutId)
    expect(layouts(insertPurchaseCheck([body, cta], SPEC, ctx).sections)).toEqual(['x', 'designcut_purchase', 'x'])
    expect(layouts(insertPurchaseCheck([body, cta, kTable], SPEC, ctx).sections)).toEqual(['x', 'x', 'designcut_purchase', kTable.layoutId])
    expect(layouts(insertPurchaseCheck([body, cta, kTable], SPEC, ctx, { at: 1 }).sections)).toEqual(['x', 'designcut_purchase', 'x', kTable.layoutId])
  })

  it('자리를 주면 그 자리에 놓는다 — 사이즈·상품 정보가 없는 페이지는 마무리 뒤 끝이다', () => {
    const sections = [sec(ProSectionType.MAIN_CUT, ['두 송이 한 다발']), sec(ProSectionType.CTA, ['지금 만나 보세요'])]
    const { sections: out } = insertPurchaseCheck(sections, SPEC, ctx, { at: sections.length })
    expect(out.map((s) => s.layoutId)).toEqual(['x', 'x', 'designcut_purchase'])
    expect(out[1].sectionType).toBe(ProSectionType.CTA)
  })

  it('빠진 옵션·사이즈 → 디자인 컷 표를 첫 CTA 바로 앞에(제목 구매 전 확인, 행 이름과 값)', () => {
    const sections = [sec(ProSectionType.MAIN_CUT, ['두 송이 한 다발']), sec(ProSectionType.CTA, ['지금 만나 보세요'])]
    const { sections: out, rows } = insertPurchaseCheck(sections, SPEC, ctx)
    expect(rows.map((r) => r.label)).toEqual(['옵션', '사이즈'])
    expect(out.map((s) => s.layoutId)).toEqual(['x', 'designcut_purchase', 'x'])
    expect(out[1].sectionType).toBe(ProSectionType.SPEC_TABLE)
    expect(textsOf(out[1])).toEqual(['구매 전 확인', '옵션', '데이지, 체리', '사이즈', '가로\u00A030\u00A0x\u00A0세로\u00A040cm'])
    expect(out[1].needsInitialReflow).toBe(false)
  })

  it('값이 이미 그려져 있으면 그대로(같은 배열)', () => {
    const sections = [
      sec(ProSectionType.POINT_DIV, ['데이지와 체리 두 가지']),
      sec(ProSectionType.SPEC_TABLE, ['가로 30 x 세로 40cm']),
      sec(ProSectionType.CTA, ['지금 만나 보세요']),
    ]
    const result = insertPurchaseCheck(sections, SPEC, ctx)
    expect(result.rows).toEqual([])
    expect(result.sections).toBe(sections)
  })

  it('일부만 빠지면 빠진 행만, CTA가 없으면 끝에', () => {
    const sections = [sec(ProSectionType.POINT_DIV, ['데이지와 체리 두 가지'])]
    const { sections: out, rows } = insertPurchaseCheck(sections, SPEC, ctx)
    expect(rows.map((r) => r.label)).toEqual(['사이즈'])
    expect(out.at(-1)!.layoutId).toBe('designcut_purchase')
  })

  it('바탕은 앞뒤 섹션과 다른 후보로(N → T → W)', () => {
    const neutral = surfaceOf('N', ctx.colors).fill
    const sections = [sec(ProSectionType.MAIN_CUT, ['한 다발'], neutral), sec(ProSectionType.CTA, ['지금'])]
    const { sections: out } = insertPurchaseCheck(sections, SPEC, ctx)
    expect(out[1].canvas.backgroundColor).not.toBe(neutral)
    expect(out[1].canvas.backgroundColor).toBe(surfaceOf('T', ctx.colors).fill)
  })

  it('spec_sheet가 없거나 판단 정보가 없으면 그대로', () => {
    const sections = [sec(ProSectionType.CTA, ['지금'])]
    expect(insertPurchaseCheck(sections, undefined, ctx).sections).toBe(sections)
    expect(insertPurchaseCheck(sections, { material: '면' }, ctx).sections).toBe(sections)
  })
})

describe('디자인 컷 편집기 문서 — 구매 전 확인', () => {
  it('사이즈·상품 정보가 맨 끝인 계획(factsLast): 끝 순서가 마무리 → 구매 전 확인 → 사이즈 → 상품 정보다', async () => {
    const job = designcutJobFromD1('A-track-i')
    const raw = job.section_plan.designcut!
    const size = raw.sections.find((s) => s.template === 'T6')!.key
    const cta = raw.sections.find((s) => s.template === 'T8')!
    const info = { ...cta, key: 'long:info', role: 'long_expansion', template: 'T9' as const, productImageKey: null, text: { eyebrow: 'INFO', headline: '상품 정보', sub: null }, modules: [{ type: 'M9' as const, data: { rows: [{ label: '소재', value: '면' }] } }] }
    const order = [...raw.order.filter((k) => k !== size), size, 'long:info']
    job.section_plan = { ...job.section_plan, designcut: { ...raw, sections: [...raw.sections, info], order, factsLast: true } }
    const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
    const tail = doc.sections.filter((s) => s.layoutId !== 'divider').slice(-4).map((s) => s.layoutId)
    expect(tail).toEqual(['designcut_T8', 'designcut_purchase', 'designcut_T6', 'designcut_T9'])
  })

  it('A-track-i(D1 실제 계획): 그린 글에 없는 판단 정보 표가 CTA 바로 앞, 모바일 위반 0', async () => {
    const job = designcutJobFromD1('A-track-i')
    const data = assembleEditorDataResponse(job, null)
    const stats: DesignCutStats = { rendered: 0, fallbacks: [] }
    composeDesignCut([], readDesignCut(job.section_plan)!, {
      images: data.generated_images as Record<string, string | string[]>,
      sectionOrder: [],
      stats,
      specSheet: job.spec_sheet as unknown as Record<string, unknown>,
    })
    expect(stats.purchaseCheck?.length).toBeGreaterThan(0)
    const doc = await buildEditorDocument(job.id, data)
    const at = doc.sections.findIndex((s) => s.layoutId === 'designcut_purchase')
    expect(at).toBeGreaterThan(0)
    expect(doc.sections.slice(at + 1).find((s) => s.layoutId !== 'divider')?.sectionType).toBe(ProSectionType.CTA)
    expect(textsOf(doc.sections[at])).toEqual(expect.arrayContaining(['구매 전 확인', ...stats.purchaseCheck!]))
    expect(checkMobileReadability(doc).violations).toEqual([])
  })
})
