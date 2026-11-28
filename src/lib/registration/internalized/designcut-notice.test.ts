/**
 * D2 ② 주의·보관 표(T1-39·T2-04 부분·T2-05) — C1 입력 칸(inputSlotsOf.notices: 입력한 주의·보관 줄 + 추가 스펙 관리 행)이 있는
 * D2 잡에만 T9 표 한 섹션(long:notice)을 사용법 뒤에 둔다. 값이 없거나 designlong 관리 표가 있으면 짓지 않는다.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability } from '../editor/utils/mobileReadability'
import { buildDesigncutPlan } from './designcut-plan'
import { D2_SECTION_TARGET, factsTailOf } from './designcut-fill'
import { LONG_FAQ_KEY, LONG_NOTICE_KEY } from './designcut-long'
import { readDesignCut, type CutSection } from '../editor/utils/sectionConverter/designCut/contract'
import { colorsOf, radiusOf } from '../editor/utils/sectionConverter/designCut/tokens'
import { buildPurchaseTable } from '../editor/utils/sectionConverter/designCut/templatesInfo'
import { FAQ_MARK, buildT9 } from '../editor/utils/sectionConverter/designCut/templatesLong'
import { designCutPlanForB } from '../editor/utils/sectionConverter/designCut/designCut.fixture'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const D2 = [...ON, 'designcut2']
const NOTICES = [
  { kind: 'caution', text: '불 가까이에 두지 마세요' },
  { kind: 'storage', text: '직사광선을 피해 서늘한 곳에 보관하세요' },
]

function job(features: string[], spec: Record<string, unknown> = {}, opts: { long?: string[] } = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  j.spec_sheet = { ...j.spec_sheet, extraSpecs: [], ...spec } as PdpJobRow['spec_sheet']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  // designlong 기록 — 설계 단계가 고른 표 종류(고정물 고민 유형과 무관하게 kinds를 정한다. ['care']면 관리 표를 짓는다)
  if (opts.long) j.section_plan = { ...j.section_plan, long: { version: 1, kinds: opts.long, excluded: [] } } as PdpJobRow['section_plan']
  return j
}
const planOf = (j: PdpJobRow) => buildDesigncutPlan(j)!
const notice = (p: DesigncutPlan) => p.sections.find((s) => s.key === LONG_NOTICE_KEY)
const rowsOf = (p: DesigncutPlan) => (notice(p)?.modules.find((m) => m.type === 'M9')?.data as { rows: Array<{ label: string; value: string }> }).rows

describe('주의·보관 표 — 값이 있을 때만(D2 ②)', () => {
  it('입력한 주의·보관 줄 다음 추가 스펙 관리 행 — 줄 이름은 종류 낱말, 같은 글은 한 번', () => {
    const p = planOf(
      job(D2, {
        noticeItems: NOTICES,
        extraSpecs: [{ key: '주의사항', value: '찬물에 손세탁' }],
      })
    )
    expect(notice(p)).toMatchObject({ template: 'T9', text: { eyebrow: 'NOTICE', headline: '주의·보관' } })
    expect(rowsOf(p)).toEqual([
      { label: '주의', value: '불 가까이에 두지 마세요' },
      { label: '보관', value: '직사광선을 피해 서늘한 곳에 보관하세요' },
      { label: '주의', value: '찬물에 손세탁' },
    ])
  })

  it('상품 정보 표가 이미 실은 관리·보관 행(세탁·관리방법·보관방법)은 되풀이하지 않는다', () => {
    const p = planOf(job(D2, { extraSpecs: [{ key: '보관방법', value: '서늘한 곳에 보관' }, { key: '세탁', value: '손세탁만' }] }))
    expect(notice(p)).toBeUndefined()
    const q = planOf(job(D2, { noticeItems: NOTICES, extraSpecs: [{ key: '보관방법', value: '서늘한 곳에 보관' }] }))
    expect(rowsOf(q).map((r) => r.value)).toEqual(NOTICES.map((n) => n.text))
  })

  it('입력·관리 행이 없으면 표가 없고 계획이 그대로다', () => {
    const p = planOf(job(D2))
    expect(notice(p)).toBeUndefined()
    expect(planOf(job(D2, { noticeItems: [] }))).toEqual(p)
    // 한 줄부터 짓는다(관리 표 최소 행 LONG_MIN_ROWS.care와 같다)
    expect(rowsOf(planOf(job(D2, { noticeItems: [NOTICES[1]] })))).toEqual([{ label: '보관', value: NOTICES[1].text }])
  })

  it('D2가 아닌 디자인 컷 잡은 입력이 있어도 짓지 않는다', () => {
    expect(notice(planOf(job(ON, { noticeItems: NOTICES })))).toBeUndefined()
    // designlong 잡(긴 막은 짓지만 D2 아님)도 관리 표가 없을 때 주의·보관 표를 짓지 않는다
    const long = planOf(job([...ON, 'designlong'], { noticeItems: NOTICES }, { long: [] }))
    expect(notice(long)).toBeUndefined()
  })

  it('designlong 기록이 관리 표를 지었으면 짓지 않는다 — 같은 행이 두 번 나오지 않는다', () => {
    const spec = { noticeItems: NOTICES, extraSpecs: [{ key: '주의사항', value: '물에 오래 담가 두지 마세요' }] }
    const p = planOf(job([...D2, 'designlong'], spec, { long: ['care'] }))
    expect(p.sections.some((s) => s.key === 'long:care')).toBe(true)
    expect(notice(p)).toBeUndefined()
  })

  it('자리는 사용법(T5) 바로 뒤 — 끝 두 자리 규칙 잡(fillacts)은 사이즈 → 상품 정보가 그대로 끝이고 섹션 수도 같다', () => {
    const p = planOf(job(D2, { noticeItems: NOTICES }))
    const at = p.order.indexOf(LONG_NOTICE_KEY)
    const t5 = p.sections.find((s) => s.template === 'T5')
    expect(at).toBeGreaterThan(-1)
    if (t5) expect(p.order[at - 1]).toBe(t5.key)
    expect(factsTailOf(p)).toEqual(factsTailOf(planOf(job(D2))))
    const fill = [...D2, 'fillacts']
    const withNotice = planOf(job(fill, { noticeItems: NOTICES }))
    const plain = planOf(job(fill))
    expect(withNotice.order).toContain(LONG_NOTICE_KEY)
    expect(factsTailOf(withNotice)).toEqual(factsTailOf(plain))
    expect(factsTailOf(withNotice).ok).toBe(true)
    // 섹션 수 목표(D2_SECTION_TARGET 20) 안 — 목표에 닿은 잡은 메시지 채움 몫이 하나 줄고, 카피가 모자란 잡은 표 하나만큼 는다
    expect(withNotice.sections.length).toBeLessThanOrEqual(Math.max(D2_SECTION_TARGET, plain.sections.length))
    expect(withNotice.sections.length - plain.sections.length).toBeLessThanOrEqual(1)
  })
})

describe('주의·보관 표 — 편집기 문서', () => {
  async function doc(spec: Record<string, unknown>) {
    const j = job(D2, spec)
    const withPlan = { ...j, section_plan: { ...j.section_plan, designcut: planOf(j) } } as PdpJobRow
    return buildEditorDocument(withPlan.id, assembleEditorDataResponse(withPlan, null))
  }

  it("'주의' 줄에만 경고 표식, 표는 모바일 판독 위반이 없다", async () => {
    const d = await doc({ noticeItems: [...NOTICES, { kind: 'caution', text: '어린이 손이 닿지 않는 곳에 두세요' }] })
    const sec = d.sections.find((s) => s.elements.some((e) => e.name === 'designcut-purchase-label-0') && s.elements.some((e) => e.textProps?.content === '주의·보관'))
    expect(sec).toBeDefined()
    const marks = sec!.elements.filter((e) => /^designcut-mark-\d+-bg$/.test(e.name)).map((e) => e.name.replace(/-bg$/, ''))
    expect(marks).toEqual(['designcut-mark-0', 'designcut-mark-2'])
    // 표식은 줄 이름 왼쪽, 이름은 표식 열 뒤
    const mark0 = sec!.elements.find((e) => e.name === 'designcut-mark-0-bg')!
    const label0 = sec!.elements.find((e) => e.name === 'designcut-purchase-label-0')!
    expect(label0.transform.x).toBeGreaterThanOrEqual(mark0.transform.x + mark0.transform.width)
    // 이 섹션만 판독한다 — M3(첫 화면 상품 이미지)은 페이지 첫 화면 규칙이라 섹션 하나에는 맞지 않는다
    const own = checkMobileReadability({ sections: [sec!] }).violations.filter((v) => v.rule !== 'M3')
    expect(own.map((v) => `${v.rule}:${v.element}:${v.detail}`)).toEqual([])
  })
})

describe('조건 1 — 줄마다 표식(rowMarks)을 넓혀도 기존 표는 그대로', () => {
  const plan = readDesignCut({ designcut: designCutPlanForB() })!
  const base = { colors: colorsOf(plan), radius: radiusOf(plan.motif), image: () => null }
  const section = (key: string): CutSection => ({
    key,
    role: key,
    template: key === 'purchase_check' ? 'T4' : 'T9',
    bg: 'N',
    chapter: null,
    plateKey: null,
    plateAspect: null,
    productImageKey: null,
    productAlpha: false,
    text: { eyebrow: null, headline: '표', sub: null },
    modules: {},
  })
  const ROWS = [
    { label: '구성', value: '본품 1개' },
    { label: '사이즈', value: '가로 30 x 세로 40cm' },
    { label: '주의', value: '불 가까이에 두지 마세요' },
  ]
  // 요소 id(uid: 종류_번호_시각)는 등장 순서 번호로 바꾼다 — 묶음 참조(containerOf)도 같은 번호가 된다. 이름·위치·글·색은 모두 비교
  const shape = (r: ReturnType<typeof buildPurchaseTable>) => {
    const seen = new Map<string, string>()
    const json = JSON.stringify(r).replace(/"([a-z]+)_\d+_\d+"/g, (m, kind: string) => {
      if (!seen.has(m)) seen.set(m, `"${kind}#${seen.size}"`)
      return seen.get(m)!
    })
    return JSON.parse(json)
  }

  it('구매 전 확인·FAQ(Q 표식) 표 — rowMarks가 없을 때와 모두 null·빈 배열일 때 요소가 같다', () => {
    const ctx = { ...base, section: section('purchase_check') }
    const plain = shape(buildPurchaseTable(ctx, ROWS))
    expect(shape(buildPurchaseTable(ctx, ROWS, { rowMarks: ROWS.map(() => null) }))).toEqual(plain)
    expect(shape(buildPurchaseTable(ctx, ROWS, { rowMarks: [] }))).toEqual(plain)
    const faq = shape(buildPurchaseTable(ctx, ROWS, { mark: FAQ_MARK }))
    expect(shape(buildPurchaseTable(ctx, ROWS, { mark: FAQ_MARK, rowMarks: ROWS.map(() => '!') }))).toEqual(faq)
  })

  it("long:care·long:faq T9는 표식 분기 전과 같은 그리기 — '주의' 줄이 있어도 long:notice 밖은 표식이 없다", () => {
    const care = { ...base, section: { ...section('long:care'), modules: { rows: ROWS } } as CutSection }
    expect(shape(buildT9(care))).toEqual(shape(buildPurchaseTable(care, ROWS)))
    expect(buildT9(care)!.elements.some((e) => e.name.startsWith('designcut-mark-'))).toBe(false)
    const faqRows = ROWS.map((r) => ({ label: r.label, value: r.value }))
    const faq = { ...base, section: { ...section(LONG_FAQ_KEY), modules: { rows: faqRows } } as CutSection }
    expect(shape(buildT9(faq))).toEqual(shape(buildPurchaseTable(faq, faqRows, { mark: FAQ_MARK })))
    const notice = { ...base, section: { ...section(LONG_NOTICE_KEY), modules: { rows: ROWS } } as CutSection }
    expect(buildT9(notice)!.elements.filter((e) => /^designcut-mark-\d+-bg$/.test(e.name)).map((e) => e.name)).toEqual(['designcut-mark-2-bg'])
  })
})
