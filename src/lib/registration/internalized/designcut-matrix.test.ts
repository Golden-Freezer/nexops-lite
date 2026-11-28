/**
 * D2 사이즈 행렬 표(T1-65·T2-30·T2-31 부분) — C1 입력 행렬(sizeMatrix)이 있는 D2 잡에만 T9 표 한 섹션(long:matrix)을 사이즈(T6) 바로 앞에 둔다.
 * 편집기는 값이 모두 3자 이하이고 칸에 들면 격자(값 열 4개씩), 아니면 사이즈마다 행 블록이다. 끝 두 자리(사이즈 → 상품 정보)는 그대로다.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { TABLE_NAME_ELEMENT, checkMobileReadability } from '../editor/utils/mobileReadability'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { designcutJobFromD1 } from '../editor/utils/sectionConverter/designCut/designCut.fixture'
import { buildDesigncutPlan } from './designcut-plan'
import { D2_SECTION_TARGET, factsTailOf } from './designcut-fill'
import { LONG_MATRIX_KEY } from './designcut-long'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...ON, 'designcut2']
const FILL = [...D2, 'fillacts']
const MATRIX = {
  columns: ['어깨', '가슴', '총장'],
  rows: [
    { label: 'S', values: ['40', '90', '65'] },
    { label: 'M', values: ['42', '95', '67'] },
  ],
}
const WIDE = {
  columns: ['어깨', '가슴', '총장', '소매', '허리', '밑단'],
  rows: [
    { label: 'S', values: ['40', '90', '65', '58', '76', '50'] },
    { label: 'M', values: ['42', '95', '67', '60', '80', '52'] },
  ],
}
const LONG_VALUE = {
  columns: ['어깨', '가슴'],
  rows: [
    { label: 'S', values: ['40~41', '90'] },
    { label: 'M', values: ['42~43', '95'] },
  ],
}

function job(features: string[], spec: Record<string, unknown> = {}, opts: { long?: string[] } = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, extraSpecs: [], ...spec } as PdpJobRow['spec_sheet']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  // designlong 기록 — 설계 단계가 고른 표 종류
  if (opts.long) j.section_plan = { ...j.section_plan, long: { version: 1, kinds: opts.long, excluded: [] } } as PdpJobRow['section_plan']
  return j
}
const planOf = (j: PdpJobRow) => buildDesigncutPlan(j)!
const table = (p: DesigncutPlan) => p.sections.find((s) => s.key === LONG_MATRIX_KEY)
const m9 = (p: DesigncutPlan) => table(p)?.modules.find((m) => m.type === 'M9')?.data as { rows: Array<{ label: string; value: string }>; matrix?: unknown }
const t6Key = (p: DesigncutPlan) => p.sections.find((s) => s.template === 'T6')?.key

describe('사이즈 행렬 표 — 입력이 있을 때만(D2)', () => {
  it("입력 행렬 → T9 표(SIZE·사이즈표), 행은 사이즈마다 '치수 값 · …', 행렬은 그대로 — 자리는 사이즈(T6) 바로 앞", () => {
    const p = planOf(job(D2, { sizeMatrix: MATRIX }))
    expect(table(p)).toMatchObject({ template: 'T9', text: { eyebrow: 'SIZE', headline: '사이즈표' } })
    expect(m9(p).rows).toEqual([
      { label: 'S', value: '어깨 40 · 가슴 90 · 총장 65' },
      { label: 'M', value: '어깨 42 · 가슴 95 · 총장 67' },
    ])
    expect(m9(p).matrix).toEqual(MATRIX)
    const t6 = t6Key(p)
    expect(t6).toBeDefined()
    expect(p.order[p.order.indexOf(LONG_MATRIX_KEY) + 1]).toBe(t6)
  })

  it('사이즈(T6)가 없으면 상품 정보 표 바로 앞', () => {
    const p = planOf(job(D2, { sizeMatrix: MATRIX, size: undefined }))
    expect(t6Key(p)).toBeUndefined()
    expect(p.order[p.order.indexOf(LONG_MATRIX_KEY) + 1]).toBe('long:info')
  })

  it('끝 두 자리(사이즈 → 상품 정보)·섹션 수 목표 그대로 — 채움 페이지도 행렬은 사이즈 바로 앞으로 따라간다', () => {
    const p = planOf(job(D2, { sizeMatrix: MATRIX }))
    expect(factsTailOf(p)).toEqual(factsTailOf(planOf(job(D2))))
    const withTable = planOf(job(FILL, { sizeMatrix: MATRIX }))
    const plain = planOf(job(FILL))
    expect(factsTailOf(withTable)).toEqual(factsTailOf(plain))
    expect(factsTailOf(withTable).ok).toBe(true)
    const at = withTable.order.indexOf(LONG_MATRIX_KEY)
    expect(withTable.order[at + 1]).toBe(t6Key(withTable))
    expect(withTable.order.slice(at + 1)).toEqual(plain.order.slice(-factsTailOf(plain).last.length))
    expect(withTable.sections.length).toBeLessThanOrEqual(Math.max(D2_SECTION_TARGET, plain.sections.length))
    expect(withTable.sections.length - plain.sections.length).toBeLessThanOrEqual(1)
  })

  it('입력이 없거나 틀린 행렬(값 수가 머리와 다름)·규제 표현이 든 행렬이면 계획이 그대로다', () => {
    const p = planOf(job(D2))
    expect(table(p)).toBeUndefined()
    expect(planOf(job(D2, { sizeMatrix: { columns: ['어깨', '가슴'], rows: [{ label: 'S', values: ['40'] }] } }))).toEqual(p)
    expect(planOf(job(D2, { sizeMatrix: { columns: ['어깨', '항균'], rows: [{ label: 'S', values: ['40', '90'] }] } }))).toEqual(p)
  })

  it('D2가 아닌 디자인 컷 잡은 짓지 않는다', () => {
    expect(table(planOf(job(ON, { sizeMatrix: MATRIX })))).toBeUndefined()
    // designlong 잡(긴 막은 짓지만 D2 아님)도 짓지 않는다
    expect(table(planOf(job([...ON, 'designlong'], { sizeMatrix: MATRIX }, { long: [] })))).toBeUndefined()
  })
})

describe('사이즈 행렬 — 계약', () => {
  it('저장 계획을 읽을 때 행렬을 지키고, 틀린 행렬은 버리되 표 행은 남긴다', () => {
    const plan = planOf(job(D2, { sizeMatrix: MATRIX }))
    const read = readDesignCut({ designcut: plan })!
    const sec = read.sections.find((s) => s.key === LONG_MATRIX_KEY)!
    expect(sec.modules).toEqual([{ type: 'M9', data: { rows: m9(plan).rows, matrix: MATRIX } }])
    const broken = {
      ...plan,
      sections: plan.sections.map((s) =>
        s.key === LONG_MATRIX_KEY ? { ...s, modules: [{ type: 'M9', data: { rows: m9(plan).rows, matrix: { columns: ['어깨'], rows: [{ label: 'S', values: ['40', '90'] }] } } }] } : s
      ),
    }
    const again = readDesignCut({ designcut: broken })!.sections.find((s) => s.key === LONG_MATRIX_KEY)!
    expect(again.modules).toEqual([{ type: 'M9', data: { rows: m9(plan).rows } }])
  })
})

describe('사이즈 행렬 — 편집기', () => {
  async function docOf(features: string[], spec: Record<string, unknown>) {
    const j = job(features, spec)
    const withPlan = { ...j, section_plan: { ...j.section_plan, designcut: planOf(j) } } as PdpJobRow
    return buildEditorDocument(withPlan.id, assembleEditorDataResponse(withPlan, null))
  }
  const own = (sec: Parameters<typeof checkMobileReadability>[0]['sections'][number]) =>
    checkMobileReadability({ sections: [sec] })
      .violations.filter((v) => v.rule !== 'M3')
      .map((v) => `${v.rule}:${v.element}:${v.detail}`)
  // 사이즈표 섹션 — 제목으로 찾는다(상품 정보 표도 사실 표 이름을 쓴다)
  const matrixSection = (d: Awaited<ReturnType<typeof docOf>>) => d.sections.find((s) => s.elements.some((e) => e.textProps?.content === '사이즈표'))

  it('값이 모두 3자 이하면 격자 — 머리·사이즈 이름은 표 이름 한 묶음, 값은 칸마다, 판독 위반 없음', async () => {
    const d = await docOf(D2, { sizeMatrix: MATRIX })
    const sec = matrixSection(d)!
    expect(sec).toBeDefined()
    const names = sec.elements.filter((e) => e.name === TABLE_NAME_ELEMENT)
    expect(names.map((e) => e.textProps?.content)).toEqual(['어깨', '가슴', '총장', 'S', 'M'])
    expect(new Set(names.map((e) => e.groupId)).size).toBe(1)
    const values = sec.elements.filter((e) => /^designcut-matrix-value-/.test(e.name)).map((e) => e.textProps?.content)
    expect(values).toEqual(['40', '90', '65', '42', '95', '67'])
    // 값은 자기 머리와 같은 열(가운데 맞춤 칸)
    const head = names.find((e) => e.textProps?.content === '가슴')!
    const cell = sec.elements.find((e) => e.name === 'designcut-matrix-value-1-1')!
    expect(cell.transform.x).toBe(head.transform.x)
    expect(sec.elements.some((e) => e.name.startsWith('designcut-purchase-label-'))).toBe(false)
    expect(own(sec)).toEqual([])
  })

  it('값 열이 4개를 넘으면 4개씩 나눈 덩어리를 아래로 쌓는다', async () => {
    const sec = matrixSection(await docOf(D2, { sizeMatrix: WIDE }))!
    const names = sec.elements.filter((e) => e.name === TABLE_NAME_ELEMENT).map((e) => e.textProps?.content)
    expect(names).toEqual(['어깨', '가슴', '총장', '소매', 'S', 'M', '허리', '밑단', 'S', 'M'])
    expect(sec.elements.filter((e) => /^designcut-matrix-value-/.test(e.name))).toHaveLength(12)
    const first = sec.elements.find((e) => e.name === 'designcut-matrix-value-1-3')!
    const second = sec.elements.find((e) => e.name === 'designcut-matrix-value-0-4')!
    expect(second.transform.y).toBeGreaterThan(first.transform.y)
    expect(own(sec)).toEqual([])
  })

  it('값이 3자를 넘거나 머리가 칸에 안 들면 사이즈마다 행 블록(사실 표) — 판독 위반 없음', async () => {
    const sec = matrixSection(await docOf(D2, { sizeMatrix: LONG_VALUE }))!
    expect(sec.elements.some((e) => /^designcut-matrix-/.test(e.name))).toBe(false)
    const text = (name: string) => (sec.elements.find((e) => e.name === name)?.textProps?.content ?? '').replace(/ /g, ' ')
    expect([text('designcut-purchase-label-0'), text('designcut-purchase-label-1')]).toEqual(['S', 'M'])
    expect([text('designcut-purchase-value-0'), text('designcut-purchase-value-1')]).toEqual(['어깨 40~41 · 가슴 90', '어깨 42~43 · 가슴 95'])
    expect(own(sec)).toEqual([])
    const wideHead = { columns: ['허리단면둘레', '가슴'], rows: [{ label: 'S', values: ['38', '90'] }] }
    const rowsSec = matrixSection(await docOf(D2, { sizeMatrix: wideHead }))!
    expect(rowsSec.elements.some((e) => /^designcut-matrix-/.test(e.name))).toBe(false)
  })

  it('사이즈·상품 정보가 맨 끝인 계획(factsLast): 구매 전 확인 표는 행렬 앞 — 끝이 마무리 → 구매 전 확인 → 사이즈표 → 사이즈 → 상품 정보', async () => {
    const j = designcutJobFromD1('A-track-i')
    const raw = j.section_plan.designcut!
    const size = raw.sections.find((s) => s.template === 'T6')!.key
    const cta = raw.sections.find((s) => s.template === 'T8')!
    const t9 = (key: string, eyebrow: string, headline: string, data: { rows: Array<{ label: string; value: string }>; matrix?: typeof MATRIX }) => ({
      ...cta,
      key,
      role: 'long_expansion',
      template: 'T9' as const,
      productImageKey: null,
      text: { eyebrow, headline, sub: null },
      modules: [{ type: 'M9' as const, data }],
    })
    const info = t9('long:info', 'INFO', '상품 정보', { rows: [{ label: '소재', value: '면' }] })
    const matrix = t9(LONG_MATRIX_KEY, 'SIZE', '사이즈표', { rows: [{ label: 'S', value: '어깨 40' }], matrix: MATRIX })
    const order = [...raw.order.filter((k) => k !== size), LONG_MATRIX_KEY, size, 'long:info']
    j.section_plan = { ...j.section_plan, designcut: { ...raw, sections: [...raw.sections, matrix, info], order, factsLast: true } }
    const doc = await buildEditorDocument(j.id, assembleEditorDataResponse(j, null))
    const tail = doc.sections.filter((s) => s.layoutId !== 'divider').slice(-5)
    expect(tail.map((s) => s.layoutId)).toEqual(['designcut_T8', 'designcut_purchase', 'designcut_T9', 'designcut_T6', 'designcut_T9'])
    expect(tail[2].elements.some((e) => /^designcut-matrix-value-/.test(e.name))).toBe(true)
  })
})
