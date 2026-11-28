/**
 * 전수 검사 — 라이브러리의 모든 템플릿이 규격을 지키는지 CI에서 본다(15_TEMPLATE_LINE §7). 위반이면 라이브러리에 들어가지 못한다.
 */

import { describe, expect, it } from 'vitest'
import { CONCEPTS } from './concepts'
import { lintTemplateLibrary } from './lint'
import { TEMPLATES, templateById, templatesOf } from './library'
import { COMPARE_BASIS, COMPARE_INPUT_PREFIX, DEMO_PHOTOS_INPUT, USAGE_STEPS_INPUT, type FlowNode, type Template } from './template-types'
import { DEMO_EVIDENCE } from './demo-shot'

const report = lintTemplateLibrary()

describe('템플릿 라이브러리', () => {
  it('위반이 없다', () => {
    expect(report.violations).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('작성한 종류는 6개 이상이다', () => {
    for (const section of ['hook_3step', 'point_div', 'spec_table', 'review', 'cta', 'sub2_div_page', 'product_exposure', 'petit_div', 'problem_raise', 'problem_empathy', 'solution_guide', 'direction_suggest', 'compare', 'sub_div', 'key_message', 'main_cut', 'hidden_page', 'point_list_div', 'option_gallery', 'concept_desc', 'convert_div', 'certification', 'event_offer', 'perf_metric', 'faq'] as const) {
      expect(templatesOf(section).length).toBeGreaterThanOrEqual(6)
    }
  })

  it('id로 찾는다', () => {
    expect(templateById(TEMPLATES[0].id)).toBe(TEMPLATES[0])
    expect(templateById('point_div.none')).toBeUndefined()
  })

  it('사실 요구 0 변형이 있다 — 사실이 모자란 상품도 20섹션을 채운다', () => {
    for (const section of ['sub2_div_page', 'product_exposure', 'petit_div'] as const) {
      expect(templatesOf(section).filter((t) => t.needs.facts.min === 0).length).toBeGreaterThanOrEqual(4)
    }
  })

  it('고민 템플릿은 상품 없는 고민 사진 슬롯을 갖고, 해결 템플릿 사진은 손·상품 중심이다(재분석 A·C)', () => {
    // 목록 안 사진도 같은 규칙이다 — 칸이 목록이라고 목적이 느슨해지지 않는다
    const photosOf = (t: Template) => Object.values(t.slots).flatMap((s) => (s.type === 'list' ? Object.values(s.fields) : [s])).filter((s) => s.type === 'image')
    for (const section of ['problem_raise', 'problem_empathy'] as const) {
      for (const t of templatesOf(section)) {
        const photos = photosOf(t)
        expect(photos.length, t.id).toBeGreaterThan(0)
        expect(photos.every((s) => s.type === 'image' && s.purpose.includes('problem')), t.id).toBe(true)
      }
    }
    for (const section of ['solution_guide', 'direction_suggest', 'how_to'] as const) {
      for (const t of templatesOf(section)) {
        const photos = photosOf(t)
        expect(photos.length, t.id).toBeGreaterThan(0)
        expect(photos.every((s) => s.type === 'image' && s.purpose.includes('action')), t.id).toBe(true)
      }
    }
  })

  it('첫 화면은 큰 제목과 보조 한 줄뿐이다 — 번호 3단계는 해결 섹션에 있다', () => {
    expect(templateById('hook_3step.three-steps')).toBeUndefined()
    expect(templateById('solution_guide.steps')).toBeDefined()
    for (const t of templatesOf('hook_3step')) {
      expect(Object.values(t.slots).some((s) => s.type === 'list'), t.id).toBe(false)
      const sub = t.slots.sub
      if (sub?.type === 'text') expect(sub.maxLines, t.id).toBe(1)
    }
  })

  it('채움 섹션끼리 모양이 비슷한 짝은 이웃하지 않는다', () => {
    for (const [a, b] of [
      ['sub2_div_page.full-photo', 'product_exposure.hero-bleed'],
      ['sub2_div_page.two-stack', 'product_exposure.in-hand-closeup'],
      ['sub2_div_page.pair-caption', 'product_exposure.front-side-pair'],
      ['sub2_div_page.grid-thumbs', 'product_exposure.three-views'],
      ['sub2_div_page.grid-thumbs', 'product_exposure.swatch-grid'],
    ]) {
      expect(templateById(a)?.order.notNextTo, a).toContain(b)
      expect(templateById(b)?.order.notNextTo, b).toContain(a)
    }
  })

  it('비교 템플릿의 입력값 칸은 비교 근거 입력(compare.*)뿐이고 근거 잠금 칸에만 있다 — 경쟁사 값을 받는 자리가 없다(C5 ②, 타사 표식 행은 입력 읽기가 뺀다)', () => {
    for (const t of [...templatesOf('compare'), ...templatesOf('point_div')]) {
      const locked = t.needs.evidence.includes(COMPARE_BASIS)
      for (const [name, slot] of Object.entries(t.slots)) {
        if (slot.type === 'image') continue
        const inputs = [slot.source === 'input' ? slot.input : undefined, ...(slot.type === 'list' ? Object.values(slot.fields).map((f) => (f.type === 'text' && f.source === 'input' ? f.input : undefined)) : [])]
        for (const input of inputs.filter((v): v is string => typeof v === 'string' && v.startsWith(COMPARE_INPUT_PREFIX))) expect(locked, `${t.id}.${name} ${input}`).toBe(true)
        // 시연 칸(J57, 근거 demo 잠금)의 판매자 시험 사진 입력(demo.photos)만 예외다 — 우리 판매자의 사진이라 경쟁사 값이 아니다
        const own = (input: string) => input === DEMO_PHOTOS_INPUT && t.needs.evidence.includes(DEMO_EVIDENCE)
        if (t.section === 'compare') for (const input of inputs.filter(Boolean)) expect(String(input).startsWith(COMPARE_INPUT_PREFIX) || own(String(input)), `${t.id}.${name} ${input}`).toBe(true)
      }
    }
  })

  it("비교 이름표는 고정 글자 '우리 제품'·'기존 제품'뿐이다 — 모델이 쓰는 칸이 없고 다른 표기가 없다(오너 지시 11-01)", () => {
    const labels: string[] = []
    const scan = (nodes: readonly FlowNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'label') labels.push(node.label)
        if (node.kind === 'panel' || node.kind === 'repeat') scan(node.nodes)
        if (node.kind === 'row') for (const column of node.columns) scan(column.nodes)
      }
    }
    for (const t of TEMPLATES) {
      scan(t.flow)
      expect(Object.keys(t.slots), t.id).not.toContain('otherLabel')
      expect(Object.keys(t.slots), t.id).not.toContain('oursLabel')
    }
    expect(new Set(labels)).toEqual(new Set(['우리 제품', '기존 제품']))
    for (const id of ['compare.marks-table', 'compare.tile-duel', 'compare.vs-cards', 'point_div.compare-marks']) {
      expect(JSON.stringify(templateById(id)?.flow), id).toContain('기존 제품')
    }
  })

  it("비교의 '기존 제품' 칸 사진은 상품 없는 고민 장면뿐이다 — 우리 상품을 기존 제품으로 보여 주지 않는다", () => {
    const left = templateById('compare.tile-duel')?.slots.left
    expect(left?.type === 'image' && left.purpose).toEqual(['problem'])
  })

  it('비교표 기존 제품 칸은 중립 dash고 엑스는 고민 섹션에만 있다', () => {
    for (const id of ['compare.marks-table', 'compare.cross-check-lists', 'point_div.compare-marks']) {
      expect(JSON.stringify(templateById(id)?.flow), id).toContain('"value":"dash"')
    }
    const crossed = TEMPLATES.filter((t) => JSON.stringify(t.flow).includes('"value":"cross"')).map((t) => t.section)
    expect(new Set(crossed)).toEqual(new Set(['problem_raise']))
  })

  it('기존 제품과 나란히 놓거나 중립 표식을 쓰는 비교는 근거가 있는 상품에서만 고른다', () => {
    for (const id of ['compare.marks-table', 'compare.cross-check-lists', 'compare.tile-duel', 'compare.vs-cards', 'compare.side-rows', 'point_div.compare-marks']) {
      expect(templateById(id)?.needs.evidence, id).toContain('compare_basis')
    }
  })

  it('근거 없는 상품이 고를 비교 변형이 있다 — 대비를 강제하는 칸 없이 고객의 전후나 우리 장점만 말한다', () => {
    const free = templatesOf('compare').filter((t) => !t.needs.evidence.includes('compare_basis'))
    expect(free.length).toBeGreaterThanOrEqual(5)
    for (const t of free) {
      const names = Object.entries(t.slots).flatMap(([name, slot]) => (slot.type === 'list' ? [name, ...Object.keys(slot.fields)] : [name]))
      for (const name of ['from', 'to', 'oursLabel', 'otherLabel', 'others']) expect(names, t.id).not.toContain(name)
    }
  })

  it('짙은 컨셉(dark-performance·pro-navy)은 모든 섹션에 템플릿이 있고 짙은 면을 받을 수 있다', () => {
    const sections = new Set(TEMPLATES.map((t) => t.section))
    for (const concept of ['dark-performance', 'pro-navy']) {
      const fit = TEMPLATES.filter((t) => t.fit.concepts.includes(concept))
      expect(new Set(fit.map((t) => t.section)), concept).toEqual(sections)
      expect(fit.filter((t) => t.surfaces.includes('D')).length, concept).toBeGreaterThanOrEqual(13)
    }
  })

  it('자리 보정: 고민·후기는 짙은 면을, 후기·FAQ는 연한 면을 받을 수 있고 POINT·FAQ는 짙은 면을 안 받는다', () => {
    const openOf = (section: string, bg: 'T' | 'D') => TEMPLATES.filter((t) => t.section === section && t.surfaces.includes(bg)).length
    expect(openOf('problem_raise', 'D')).toBeGreaterThanOrEqual(10)
    expect(openOf('problem_empathy', 'D')).toBeGreaterThanOrEqual(8)
    expect(openOf('review', 'D')).toBeGreaterThanOrEqual(10)
    expect(openOf('review', 'T')).toBeGreaterThanOrEqual(10)
    expect(openOf('faq', 'T')).toBeGreaterThanOrEqual(6)
    expect(openOf('point_div', 'D')).toBe(0)
    expect(openOf('faq', 'D')).toBe(0)
  })

  it('바탕: 같은 색 상자가 있으면 그 바탕을 열지 않고, 첫 화면·표·인증은 밝은 W·N만, T는 후기·FAQ까지, 짙은 면은 전환·고민·후기 섹션에만 연다', () => {
    const turning = ['solution_guide', 'key_message', 'concept_desc', 'petit_div', 'convert_div', 'problem_raise', 'problem_empathy', 'review']
    const tintedTrust = ['review', 'faq']
    for (const t of TEMPLATES) {
      const flow = JSON.stringify(t.flow)
      for (const bg of ['T', 'D'] as const) {
        if (flow.includes(`"fill":"${bg}"`)) expect(t.surfaces, t.id).not.toContain(bg)
      }
      if (t.order.zone === 'intro' || (t.order.zone === 'trust' && !tintedTrust.includes(t.section))) expect(t.surfaces, t.id).not.toContain('T')
      if (!turning.includes(t.section)) expect(t.surfaces, t.id).not.toContain('D')
    }
    expect(TEMPLATES.filter((t) => t.surfaces.includes('T')).length).toBeGreaterThanOrEqual(200)
    expect(TEMPLATES.filter((t) => t.surfaces.includes('D')).length).toBeGreaterThan(30)
  })

  it('컨셉마다 고를 템플릿이 있다 — 빈 컨셉이 없다', () => {
    for (const concept of CONCEPTS) {
      expect(TEMPLATES.filter((t) => t.fit.concepts.includes(concept.id)).length, concept.id).toBeGreaterThanOrEqual(8)
    }
  })

  it('상품 정보 표는 섹션 끝이다 — 표 뒤에 사진을 두지 않아 페이지가 표로 끝난다(오너 지시 11-01)', () => {
    for (const t of templatesOf('spec_table')) {
      const last = t.flow.at(-1)
      const tail = last?.kind === 'panel' ? last.nodes.at(-1) : last
      expect(tail?.kind === 'repeat' ? tail.slot : tail?.kind, t.id).toBe('special')
    }
  })

  it('옵션 모아 보기는 옵션 근거가 있는 상품에서만 고르고, 사진·이름은 입력값만 쓴다', () => {
    for (const t of templatesOf('option_gallery')) {
      expect(t.needs.evidence, t.id).toContain('option')
      for (const [name, slot] of Object.entries(t.slots)) {
        if (slot.type === 'list') expect(slot.input, `${t.id}.${name}`).toMatch(/^option\./)
      }
    }
  })

  it('구매 권유는 새 사실을 쓰지 않는다', () => {
    for (const t of templatesOf('convert_div')) expect(t.needs.facts.max, t.id).toBe(0)
  })

  it('how_to는 쓰는 법 입력이 있을 때만 열리고, 입력에 순서가 없어 번호·화살표를 쓰지 않는다 — 순서 있는 사용 순서 입력(usage.steps) 칸만 번호', () => {
    expect(templatesOf('how_to').length).toBeGreaterThanOrEqual(4)
    for (const t of templatesOf('how_to')) {
      expect(t.needs.evidence, t.id).toContain('usage')
      const ordered = Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === USAGE_STEPS_INPUT && slot.required)
      expect(JSON.stringify(t.flow), t.id).not.toMatch(ordered ? /"value":"arrow[^"]*"/ : /"value":"(index|arrow[^"]*)"/)
    }
  })

  it('29종을 모두 작성했다', () => {
    expect(report.sections.filter((s) => s.count === 0)).toEqual([])
  })

  it('근거 잠금 섹션은 각자의 근거 이름을 쓰고, 근거 글은 입력값이다 — 모델이 인증·혜택·수치를 쓰지 않는다', () => {
    const want = { certification: 'certification', event_offer: 'offer', faq: 'faq' } as const
    for (const [section, evidence] of Object.entries(want)) {
      for (const t of templatesOf(section as keyof typeof want)) expect(t.needs.evidence, t.id).toContain(evidence)
    }
    // 성과 섹션은 평점 또는 우리 판매량(J51b) — 둘 중 하나는 꼭 적는다
    for (const t of templatesOf('perf_metric')) expect(t.needs.evidence.some((key) => key === 'rating' || key === 'sales'), t.id).toBe(true)
    const inputOf = (t: Template) => Object.values(t.slots).flatMap((s) => (s.type === 'image' ? [] : [s.input ?? '']))
    for (const t of templatesOf('certification')) {
      expect(inputOf(t).some((key) => key.startsWith('certification.')), t.id).toBe(true)
      for (const slot of Object.values(t.slots)) if (slot.type === 'text' && slot.source !== 'input') expect(slot.facts, t.id).toBe(0)
    }
    for (const t of templatesOf('event_offer')) {
      expect(inputOf(t), t.id).toContain('offer.info')
      for (const slot of Object.values(t.slots)) if (slot.type === 'text' && slot.source !== 'input') expect(slot.facts, t.id).toBe(0)
    }
  })

  it('세부 장점은 POINT 머리를 쓰지 않는다 — 페이지의 큰 POINT와 구분된다', () => {
    for (const t of templatesOf('sub_div')) {
      expect(JSON.stringify(t.flow), t.id).not.toContain('"label":"POINT"')
    }
  })

  it('소제목·컨셉·해결 섹션에 구조어 머리 변형이 2개 이상, 3단 머리(제목 → 보조 한 줄 H3 → 본문)가 있다(A2 9-1·T5, 개선 #12)', () => {
    const labelHead = (t: Template) => t.flow[0]?.kind === 'capsule' && Boolean(t.flow[0].label)
    const threeHead = (t: Template) => {
      const texts = t.flow.filter((n) => n.kind === 'text')
      return texts.length >= 3 && ['H1', 'H2'].includes(texts[0].token) && texts[1].token === 'H3' && texts[2].token === 'BODY'
    }
    for (const section of ['sub_div', 'concept_desc', 'solution_guide'] as const) {
      expect(templatesOf(section).filter(labelHead).length, section).toBeGreaterThanOrEqual(2)
    }
    for (const section of ['sub_div', 'solution_guide'] as const) expect(templatesOf(section).some(threeHead), section).toBe(true)
  })

  it('가치 쪽 섹션은 모델 글 제목이 있으면 강조 칸을 연다 — 강조색 띠 위·사진 위 글·반복 항목은 빼고(L10 후보 3 제목 낱말 글자색)', () => {
    const VALUE = new Set(['hook_3step', 'main_cut', 'sub_div', 'key_message', 'point_list_div', 'hidden_page', 'option_gallery', 'convert_div', 'concept_desc', 'solution_guide', 'cta', 'direction_suggest', 'compare'])
    const emphasized = (nodes: readonly FlowNode[]): boolean =>
      nodes.some((n) => {
        if (n.kind === 'text') return Boolean(n.emphasis)
        if (n.kind === 'panel' || n.kind === 'repeat') return emphasized(n.nodes)
        if (n.kind === 'row') return n.columns.some((c) => emphasized(c.nodes))
        return n.kind === 'image' && n.overlay ? emphasized(n.overlay.nodes) : false
      })
    const copyTitle = (t: Template, nodes: readonly FlowNode[]): boolean | null => {
      for (const n of nodes) {
        if (n.kind === 'text' && ['HOOK', 'H1', 'H2'].includes(n.token)) {
          const def = t.slots[n.slot]
          return def?.type === 'text' && def.source === 'copy'
        }
        if (n.kind === 'panel' && n.fill === 'A') return false
        const inner = n.kind === 'panel' ? copyTitle(t, n.nodes) : n.kind === 'row' ? n.columns.map((c) => copyTitle(t, c.nodes)).find((v) => v !== null) ?? null : null
        if (inner !== null) return inner
      }
      return null
    }
    const missing = TEMPLATES.filter((t) => VALUE.has(t.section) && copyTitle(t, t.flow) && !emphasized(t.flow)).map((t) => t.id)
    expect(missing).toEqual([])
  })

  it('첫 화면에 사용·착용 장면 변형이 있다', () => {
    const scene = templatesOf('hook_3step').filter((t) => Object.values(t.slots).some((s) => s.type === 'image' && s.composition.includes('worn')))
    expect(scene.length).toBeGreaterThan(0)
  })

  it('조사에서 나온 필수 변형이 있다', () => {
    for (const id of [
      'point_div.compare-marks',
      'spec_table.dimension',
      'point_div.principle',
      'hook_3step.count-cut',
      'product_exposure.swatch-grid',
      'hook_3step.two-photos',
      'hook_3step.dark-band',
    ]) {
      expect(templateById(id), id).toBeDefined()
    }
  })

  it('높이 보고를 낸다 — D 섹션 대비 비율과 20섹션 페이지 합', () => {
    expect(report.heights.avgTypical).toBeGreaterThan(0)
    expect(report.heights.ratioToD).toBeGreaterThan(0)
    expect(report.heights.page.atTarget).toBe(report.heights.avgTypical * 20)
    expect(report.heights.bySection.length).toBeGreaterThanOrEqual(8)
    expect(report.heights.withoutFillers.avgTypical).toBeGreaterThan(report.heights.avgTypical)
    expect(report.heights.withoutFillers.atTarget).toBe(report.heights.withoutFillers.avgTypical * 20)
  })
})
