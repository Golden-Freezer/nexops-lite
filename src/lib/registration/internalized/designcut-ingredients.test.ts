/**
 * D2 ③ 성분·원재료 표(R-W8) — 추가 스펙 원재료·성분 칸에 이름이 2~8개 있는 D2 잡에만 T9 표 한 섹션(long:ingredients)을 사용법 뒤,
 * 관리·주의 표 앞에 둔다. 이름은 입력 그대로(규제 표현 거름), 제목은 입력 칸에 따라 '성분'·'원재료' 고정 낱말이다.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability } from '../editor/utils/mobileReadability'
import { readDesignCut, type CutSection } from '../editor/utils/sectionConverter/designCut/contract'
import { colorsOf, radiusOf } from '../editor/utils/sectionConverter/designCut/tokens'
import { buildPurchaseTable } from '../editor/utils/sectionConverter/designCut/templatesInfo'
import { buildT9 } from '../editor/utils/sectionConverter/designCut/templatesLong'
import { designCutPlanForB } from '../editor/utils/sectionConverter/designCut/designCut.fixture'
import { buildDesigncutPlan } from './designcut-plan'
import { D2_SECTION_TARGET, factsTailOf } from './designcut-fill'
import { LONG_INGREDIENTS_KEY, LONG_NOTICE_KEY, ingredientTitleOf } from './designcut-long'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...ON, 'designcut2']
const RAW = [{ key: '원재료명', value: '밀가루(국산), 설탕, 버터' }]
const NAMES = ['밀가루', '설탕', '버터']

function job(features: string[], spec: Record<string, unknown> = {}, opts: { long?: string[] } = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, extraSpecs: [], ...spec } as PdpJobRow['spec_sheet']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  // designlong 기록 — 설계 단계가 고른 표 종류(['care']면 관리 표를 짓는다)
  if (opts.long) j.section_plan = { ...j.section_plan, long: { version: 1, kinds: opts.long, excluded: [] } } as PdpJobRow['section_plan']
  return j
}
const planOf = (j: PdpJobRow) => buildDesigncutPlan(j)!
const table = (p: DesigncutPlan) => p.sections.find((s) => s.key === LONG_INGREDIENTS_KEY)
const rowsOf = (p: DesigncutPlan) => (table(p)?.modules.find((m) => m.type === 'M9')?.data as { rows: Array<{ label: string; value: string }> }).rows
const valuesOf = (p: DesigncutPlan) => rowsOf(p).map((r) => r.value)

describe('성분·원재료 표 — 이름이 2~8개일 때만(D2 ③)', () => {
  it('원재료 칸 이름 → T9 표(INGREDIENTS·원재료), 줄마다 이름 그대로(괄호 안 원산지·함량은 뺌)', () => {
    const p = planOf(job(D2, { extraSpecs: RAW }))
    expect(table(p)).toMatchObject({ template: 'T9', text: { eyebrow: 'INGREDIENTS', headline: '원재료' } })
    expect(rowsOf(p)).toEqual(NAMES.map((value) => ({ label: '원재료', value })))
  })

  it("제목 — 성분 계열 칸에서만 나오면 '성분', 원재료 칸이 섞이거나 원재료뿐이면 '원재료'", () => {
    const component = [{ key: '주 성분', value: '정제수, 글리세린' }]
    expect(ingredientTitleOf({ extraSpecs: component })).toBe('성분')
    expect(ingredientTitleOf({ extraSpecs: [...component, ...RAW] })).toBe('원재료')
    expect(ingredientTitleOf({ extraSpecs: RAW })).toBe('원재료')
    // 성분 칸에 이름이 없으면(참조 문구) 원재료 칸 이름만 — 제목도 원재료
    expect(ingredientTitleOf({ extraSpecs: [{ key: '성분', value: '상세페이지 참조' }, ...RAW] })).toBe('원재료')
    const p = planOf(job(D2, { extraSpecs: component }))
    expect(table(p)?.text.headline).toBe('성분')
    expect(rowsOf(p)).toEqual([
      { label: '성분', value: '정제수' },
      { label: '성분', value: '글리세린' },
    ])
  })

  it('규제 표현이 든 이름은 뺀다 — 남은 이름이 2개 미만이면 표가 없다', () => {
    expect(valuesOf(planOf(job(D2, { extraSpecs: [{ key: '원재료', value: '면, 폴리에스터, 항균 원사' }] })))).toEqual(['면', '폴리에스터'])
    expect(table(planOf(job(D2, { extraSpecs: [{ key: '원재료', value: '면, 항균 원사' }] })))).toBeUndefined()
  })

  it('이름 1개·9개 이상·전성분·소재뿐이면 짓지 않고, 8개는 짓는다 — 일부만 싣지 않는다', () => {
    const many = (n: number) => [{ key: '원재료', value: Array.from({ length: n }, (_, i) => `재료${i + 1}`).join(', ') }]
    expect(table(planOf(job(D2, { extraSpecs: many(1) })))).toBeUndefined()
    expect(valuesOf(planOf(job(D2, { extraSpecs: many(2) })))).toHaveLength(2)
    expect(valuesOf(planOf(job(D2, { extraSpecs: many(8) })))).toHaveLength(8)
    expect(table(planOf(job(D2, { extraSpecs: many(9) })))).toBeUndefined()
    expect(table(planOf(job(D2, { extraSpecs: [{ key: '전성분', value: '정제수, 글리세린' }, { key: '소재', value: '면, 폴리' }] })))).toBeUndefined()
  })

  it('입력이 없으면 계획이 그대로다', () => {
    const p = planOf(job(D2))
    expect(table(p)).toBeUndefined()
    expect(planOf(job(D2, { extraSpecs: [] }))).toEqual(p)
  })

  it('D2가 아닌 디자인 컷 잡(D1·designlong)은 이름이 있어도 짓지 않는다', () => {
    expect(table(planOf(job(ON, { extraSpecs: RAW })))).toBeUndefined()
    expect(table(planOf(job([...ON, 'designlong'], { extraSpecs: RAW }, { long: [] })))).toBeUndefined()
  })

  it('자리는 사용법(T5) 바로 뒤, 주의·보관·관리 표보다 앞 — 끝 두 자리·섹션 수 목표 그대로', () => {
    const notices = [{ kind: 'caution', text: '불 가까이에 두지 마세요' }]
    const p = planOf(job(D2, { extraSpecs: RAW, noticeItems: notices }))
    const t5 = p.sections.find((s) => s.template === 'T5')!
    expect(t5).toBeDefined()
    const at = p.order.indexOf(LONG_INGREDIENTS_KEY)
    expect(p.order.slice(at - 1, at + 2)).toEqual([t5.key, LONG_INGREDIENTS_KEY, LONG_NOTICE_KEY])
    const care = planOf(job([...D2, 'designlong'], { extraSpecs: [...RAW, { key: '주의사항', value: '물에 오래 담가 두지 마세요' }] }, { long: ['care'] }))
    const i = care.order.indexOf(LONG_INGREDIENTS_KEY)
    expect(care.order.slice(i - 1, i + 2)).toEqual([care.sections.find((s) => s.template === 'T5')!.key, LONG_INGREDIENTS_KEY, 'long:care'])
    expect(factsTailOf(p)).toEqual(factsTailOf(planOf(job(D2, { noticeItems: notices }))))
    const fill = [...D2, 'fillacts']
    const withTable = planOf(job(fill, { extraSpecs: RAW }))
    const plain = planOf(job(fill))
    expect(withTable.order).toContain(LONG_INGREDIENTS_KEY)
    expect(factsTailOf(withTable)).toEqual(factsTailOf(plain))
    expect(factsTailOf(withTable).ok).toBe(true)
    expect(withTable.sections.length).toBeLessThanOrEqual(Math.max(D2_SECTION_TARGET, plain.sections.length))
    expect(withTable.sections.length - plain.sections.length).toBeLessThanOrEqual(1)
  })
})

describe('성분·원재료 표 — 편집기', () => {
  it('이름만 줄마다 그리고 줄 이름(제목 낱말)은 되풀이하지 않는다, 판독 위반이 없다', async () => {
    const j = job(D2, { extraSpecs: RAW })
    const withPlan = { ...j, section_plan: { ...j.section_plan, designcut: planOf(j) } } as PdpJobRow
    const d = await buildEditorDocument(withPlan.id, assembleEditorDataResponse(withPlan, null))
    const sec = d.sections.find((s) => s.elements.some((e) => e.name === 'designcut-ingredient-0'))!
    expect(sec).toBeDefined()
    const names = sec.elements.filter((e) => /^designcut-ingredient-\d+$/.test(e.name)).map((e) => e.textProps?.content)
    expect(names).toEqual(NAMES)
    expect(sec.elements.filter((e) => /^designcut-ingredient-rule-\d+$/.test(e.name))).toHaveLength(NAMES.length)
    expect(sec.elements.some((e) => e.name.startsWith('designcut-purchase-label-'))).toBe(false)
    expect(sec.elements.filter((e) => e.textProps?.content === '원재료')).toHaveLength(1)
    // 이 섹션만 판독한다 — M3(첫 화면 상품 이미지)은 페이지 첫 화면 규칙이라 섹션 하나에는 맞지 않는다
    const own = checkMobileReadability({ sections: [sec] }).violations.filter((v) => v.rule !== 'M3')
    expect(own.map((v) => `${v.rule}:${v.element}:${v.detail}`)).toEqual([])
  })

  it('이름 목록 분기는 long:ingredients만 — 같은 행의 다른 T9 표는 사실 표 그대로', () => {
    const plan = readDesignCut({ designcut: designCutPlanForB() })!
    const base = { colors: colorsOf(plan), radius: radiusOf(plan.motif), image: () => null }
    const rows = NAMES.map((value) => ({ label: '원재료', value }))
    const section = (key: string) =>
      ({
        key,
        role: key,
        template: 'T9',
        bg: 'N',
        chapter: null,
        plateKey: null,
        plateAspect: null,
        productImageKey: null,
        productAlpha: false,
        text: { eyebrow: null, headline: '원재료', sub: null },
        modules: { rows },
      }) as CutSection
    const names = (r: ReturnType<typeof buildT9>) => r!.elements.map((e) => e.name)
    const care = { ...base, section: section('long:care') }
    expect(names(buildT9(care))).toEqual(names(buildPurchaseTable(care, rows)))
    expect(names(buildT9({ ...base, section: section(LONG_INGREDIENTS_KEY) })).filter((n) => n.startsWith('designcut-purchase-'))).toEqual([])
  })
})
