/**
 * 전수 검사기 자체 시험 — 규칙마다 일부러 어긴 템플릿을 잡아내는지 본다. 통과만 보면 검사기가 아무것도 안 잡아도 모른다.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { lintKPageColors } from './color-lint'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { K_TYPE } from './engine'
import { imageSlot, templateOf, textSlot } from './engine.fixture'
import { fillMeta } from './fill'
import { darkYellowIn, lintTemplate, lintTemplateLibrary, typeScaleIssues, type LintRule } from './lint'
import { conceptCoverage, skeletonKey, skeletonReport } from './lint-category'
import { deriveSignature, signatureKey } from './signature'
import type { FlowNode, Signature, Template, TextSlot } from './template-types'

const baseFlow: FlowNode[] = [
  { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap' },
  { kind: 'text', slot: 'sub', token: 'BODY', gapAfter: 'photoGap' },
  { kind: 'image', slot: 'photo' },
]
const valid = (over: Partial<Template> = {}) =>
  fillMeta(
    templateOf({
      flow: baseFlow,
      slots: {
        headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }),
        sub: textSlot({ maxChars: 24, maxLines: 3 }),
        photo: imageSlot({ required: true }),
      },
      ...over,
    })
  )

const rulesOf = (t: Template) => lintTemplate(t).map((v) => v.rule)
const expectRule = (t: Template, rule: LintRule) => expect(rulesOf(t), JSON.stringify(lintTemplate(t).slice(0, 3))).toContain(rule)

describe('lintTemplate — 통과', () => {
  it('규격을 지킨 템플릿은 위반이 없다', () => {
    expect(lintTemplate(valid())).toEqual([])
  })
})

describe('lintTemplate — 어긴 템플릿을 잡는다', () => {
  it('meta: 형식·칸 누락', () => {
    expectRule({ ...valid(), id: 'POINT 하나' }, 'meta')
    expectRule({ ...valid(), id: 'review.other' }, 'meta')
    expectRule({ ...valid(), name: ' ' }, 'meta')
    expectRule({ ...valid(), preview: 'mock/다른.html' }, 'meta')
    expectRule({ ...valid(), fit: { ...valid().fit, concepts: ['없는-컨셉'] } }, 'meta')
    expectRule({ ...valid(), fit: { ...valid().fit, personaTags: [] } }, 'meta')
  })

  it('meta: 없는 슬롯을 쓰거나 슬롯을 쓰지 않으면 잡는다', () => {
    expectRule(valid({ flow: [...baseFlow, { kind: 'text', slot: 'ghost', token: 'BODY' }] }), 'meta')
    expectRule(valid({ slots: { ...valid().slots, unused: textSlot() } }), 'meta')
    expectRule(valid({ flow: [{ kind: 'image', slot: 'headline' }, ...baseFlow.slice(1)] }), 'meta')
  })

  it('type: 토큰·라벨 규칙', () => {
    expectRule(valid({ flow: [{ kind: 'text', slot: 'headline', token: 'H1' }, { kind: 'text', slot: 'sub', token: 'LABEL' }, { kind: 'image', slot: 'photo' }] }), 'type')
    expectRule(valid({ flow: [{ kind: 'text', slot: 'headline', token: 'DISPLAY' }, ...baseFlow.slice(1)] }), 'type')
    expectRule(valid({ flow: [{ kind: 'capsule', label: '최고' as never, gapAfter: 'rowGap' }, ...baseFlow] }), 'type')
  })

  it('type: 머리 라벨 — 고민 섹션은 캡슐 없이, 소제목·컨셉·해결은 CHECK·DETAIL·TIP만(개선 #12)', () => {
    const head = (section: string, label: FlowNode & { kind: 'capsule' }) => valid({ id: `${section}.x`, section: section as Template['section'], flow: [label, ...baseFlow] })
    const labelIssues = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'type' && /머리 라벨|고민 섹션에 캡슐/.test(v.detail))
    for (const section of ['sub_div', 'concept_desc', 'solution_guide']) {
      for (const label of ['CHECK', 'DETAIL', 'TIP'] as const) expect(labelIssues(head(section, { kind: 'capsule', label, gapAfter: 'rowGap' })), `${section} ${label}`).toEqual([])
      expect(labelIssues(head(section, { kind: 'capsule', label: 'POINT', gapAfter: 'rowGap' })), section).toHaveLength(1)
    }
    expect(labelIssues(head('problem_raise', { kind: 'capsule', label: 'CHECK', gapAfter: 'rowGap' }))).toHaveLength(1)
    expect(labelIssues(head('problem_empathy', { kind: 'capsule', label: 'TIP', gapAfter: 'rowGap' }))).toHaveLength(1)
    expect(labelIssues(head('key_message', { kind: 'capsule', label: 'POINT', gapAfter: 'rowGap' }))).toEqual([])
  })

  it('space: 여백 범위·좌우 여백·칸 합', () => {
    expectRule({ ...valid(), spacing: { top: 100, titleGap: 48, photoGap: 88, bottom: 120 } }, 'space')
    expectRule({ ...valid(), spacing: { top: 120, titleGap: 80, photoGap: 88, bottom: 120 } }, 'space')
    expectRule({ ...valid(), spacing: { top: 120, titleGap: 48, photoGap: 60, bottom: 120 } }, 'space')
    expectRule({ ...valid(), spacing: { top: 0, titleGap: 48, photoGap: 88, bottom: 120 } }, 'space')
    expectRule(valid({ flow: [...baseFlow.slice(0, 2), { kind: 'image', slot: 'photo', x: 20, w: 800 }] }), 'space')
    expectRule(
      valid({
        flow: [
          ...baseFlow.slice(0, 2),
          { kind: 'row', columns: [{ w: 500, nodes: [{ kind: 'image', slot: 'photo' }] }, { w: 500, nodes: [] }] },
        ],
      }),
      'space'
    )
  })

  it('space: 풀폭으로 시작하면 위 여백 0을 허용한다', () => {
    const t = valid({ flow: [{ kind: 'image', slot: 'photo', bleed: true, gapAfter: 'photoGap' }, ...baseFlow.slice(0, 2)] })
    expect(rulesOf({ ...t, spacing: { ...t.spacing, top: 0 } })).not.toContain('space')
  })

  describe('lines', () => {
    const original = K_TYPE.BODY
    afterEach(() => {
      K_TYPE.BODY = original
    })
    it('토큰 줄 간격이 규격을 벗어나면 잡는다', () => {
      K_TYPE.BODY = { ...original, lineHeight: 1.45 }
      expectRule(valid(), 'lines')
    })
  })

  describe('글자 위계', () => {
    const original = { ...K_TYPE }
    afterEach(() => {
      Object.assign(K_TYPE, original)
    })

    it('지금 토큰은 위반이 없다', () => {
      expect(typeScaleIssues()).toEqual([])
    })

    it.each([
      ['H1 비율', 'H1', 84],
      ['H2 비율', 'H2', 68],
      ['HOOK 비율', 'HOOK', 100],
      ['소제목 하한', 'H3', 56],
      ['본문 하한', 'BODY_BOLD', 40],
      ['라벨 비율', 'LABEL', 30],
      ['각주 하한', 'CAPTION', 32],
      ['각주 비율', 'CAPTION', 48],
    ] as const)('%s가 무너지면 잡는다', (_label, name, size) => {
      K_TYPE[name] = { ...original[name], size }
      expect(typeScaleIssues().length).toBeGreaterThan(0)
    })

    it('본문을 키워 비율이 무너져도 잡는다', () => {
      K_TYPE.BODY = { ...original.BODY, size: 60 }
      expect(typeScaleIssues().some((issue) => issue.startsWith('H1'))).toBe(true)
    })
  })

  it('color: 풀폭 상자에 카드 색 C를 쓰면 잡는다', () => {
    const inner: FlowNode[] = [{ kind: 'text', slot: 'headline', token: 'H1' }, baseFlow[2]]
    const panel = (bleed: boolean): FlowNode[] => [{ kind: 'panel', fill: 'C', bleed, nodes: inner }]
    expect(lintTemplate(valid({ flow: panel(true) })).filter((v) => v.detail.includes('카드 색'))).toHaveLength(1)
    expect(lintTemplate(valid({ flow: panel(false) })).filter((v) => v.detail.includes('카드 색'))).toHaveLength(0)
  })

  it('meta: 띠 안쪽 여백(pad)은 풀폭 띠에만 — 카드에 주면 잡는다(K11)', () => {
    const inner: FlowNode[] = [{ kind: 'text', slot: 'headline', token: 'H1' }, baseFlow[2]]
    const panel = (bleed: boolean): FlowNode[] => [{ kind: 'panel', fill: 'D', bleed, pad: 'blockGap', nodes: inner }]
    expect(lintTemplate(valid({ flow: panel(false) })).filter((v) => v.detail.includes('pad는'))).toHaveLength(1)
    expect(lintTemplate(valid({ flow: panel(true) })).filter((v) => v.detail.includes('pad는'))).toHaveLength(0)
  })

  describe('CAPTION', () => {
    const captionFlow: FlowNode[] = [...baseFlow, { kind: 'text', slot: 'note', token: 'CAPTION' }]
    const withNote = (maxLines: number, over: Partial<Template> = {}) =>
      valid({ flow: captionFlow, slots: { ...valid().slots, note: textSlot({ maxChars: 20, maxLines }) }, ...over })

    it('2줄까지 쓸 수 있고 3줄이면 잡는다', () => {
      expect(rulesOf(withNote(2))).not.toContain('type')
      expectRule(withNote(3), 'type')
    })

    it('첫 화면에는 쓸 수 없다', () => {
      expectRule(withNote(2, { section: 'hook_3step' }), 'hook')
    })
  })

  it('chars: 글자 수 상한이 폭을 넘거나 줄 수를 넘으면 잡는다', () => {
    expectRule(valid({ slots: { ...valid().slots, headline: textSlot({ required: true, maxChars: 40, maxLines: 3 }) } }), 'chars')
    expectRule(valid({ slots: { ...valid().slots, headline: textSlot({ required: true, maxChars: 20, maxLines: 2 }) } }), 'chars')
  })

  it('type: 반복 칸 안 이름표가 칸 폭을 넘거나 두 줄이면 잡는다', () => {
    const swatches = (name: Record<string, unknown>) =>
      valid({
        flow: [
          { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
          { kind: 'repeat', slot: 'swatches', columns: 2, gap: 'blockGap', nodes: [{ kind: 'image', slot: 'photo', gapAfter: 'tightGap' }, { kind: 'tags', slot: 'name' }] },
        ],
        slots: {
          headline: valid().slots.headline,
          swatches: { type: 'list', required: true, min: 2, max: 4, fields: { photo: imageSlot({ required: true, aspect: ['3:4'] }), name: { ...textSlot({ required: true }), ...name } as TextSlot } },
        },
      })
    const typeRules = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'type' && v.detail.startsWith('name:'))
    // 2열 칸 폭 358: 7자 × 1.2 → 8자 344px는 들어가고, 8자 × 1.2 → 10자 416px는 넘는다
    expect(typeRules(swatches({ maxChars: 7, maxLines: 1 }))).toEqual([])
    expect(typeRules(swatches({ maxChars: 8, maxLines: 1 })).map((v) => v.detail)).toEqual(['name: 이름표 416px가 칸 폭 358px를 넘음'])
    expect(typeRules(swatches({ maxChars: 7, maxLines: 2 })).map((v) => v.detail)).toEqual(['name: 이름표는 한 줄'])
  })

  it('stress: 최대 글자 × 1.2에서 M6을 넘기면 잡는다', () => {
    const t = valid({
      flow: [
        { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
        {
          kind: 'row',
          columns: [
            { w: 336, nodes: [{ kind: 'image', slot: 'photo' }] },
            { w: 380, nodes: [{ kind: 'text', slot: 'sub', token: 'BODY' }] },
          ],
        },
      ],
      slots: {
        headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }),
        // 상한 안(폭 380 ÷ 52 × 6줄 = 42자)이지만 × 1.2 = 42자라 2열 40자를 넘는다
        sub: textSlot({ required: true, maxChars: 35, maxLines: 6 }),
        photo: imageSlot({ required: true, aspect: ['2:3'] }),
      },
    })
    expect(lintTemplate(t).some((v) => v.rule === 'stress' && v.detail.includes('M6'))).toBe(true)
  })

  it('space: 글자가 있는 가로 칸의 가운데 맞춤을 잡는다 — 리플로우 뒤 어긋난다', () => {
    const row = (valign: 'center' | undefined): FlowNode => ({
      kind: 'row',
      valign,
      columns: [
        { w: 336, nodes: [{ kind: 'image', slot: 'photo' }] },
        { w: 380, nodes: [{ kind: 'text', slot: 'sub', token: 'BODY' }] },
      ],
    })
    const slots = { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }), sub: textSlot({ maxChars: 24, maxLines: 5 }), photo: imageSlot({ required: true, aspect: ['2:3'] }) }
    const head: FlowNode = { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' }
    const spaceOf = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'space' && v.detail.includes('가운데'))
    expect(spaceOf(valid({ flow: [head, row('center')], slots }))).toHaveLength(1)
    expect(spaceOf(valid({ flow: [head, row(undefined)], slots }))).toEqual([])
  })

  it('stress: 글자가 사진과 겹치면 잡는다', () => {
    const t = valid({
      flow: [
        {
          kind: 'row',
          columns: [
            { w: 500, nodes: [{ kind: 'image', slot: 'photo' }] },
            { w: 216, nodes: [{ kind: 'text', slot: 'headline', token: 'H3', x: 100, w: 400 }] },
          ],
        },
      ],
      slots: { headline: textSlot({ required: true, maxChars: 8, maxLines: 2 }), photo: imageSlot({ required: true }) },
    })
    expect(lintTemplate(t).some((v) => v.detail.includes('겹침'))).toBe(true)
  })

  it('empty: 필수 슬롯이 하나도 없으면 잡는다', () => {
    expectRule(
      valid({
        slots: {
          headline: textSlot({ maxChars: 16, maxLines: 3 }),
          sub: textSlot({ maxChars: 24, maxLines: 3 }),
          photo: imageSlot(),
        },
      }),
      'empty'
    )
  })

  it('color: 흐름에 색 값을 쓰면 잡는다', () => {
    const flow = [...baseFlow.slice(0, 2), { kind: 'image', slot: 'photo', note: '#FF0000' } as unknown as FlowNode]
    expectRule(valid({ flow }), 'color')
  })

  it('color: 어두운 노랑 글자를 찾는다', () => {
    const el = (color: string, richContent?: string) =>
      ({ name: 'x', textProps: { color, richContent } }) as never
    expect(darkYellowIn({ elements: [el('#8C630C')] })).toHaveLength(1)
    expect(darkYellowIn({ elements: [el('#1A1A1A', '<span style="color:#8C630C">글</span>')] })).toHaveLength(1)
    expect(darkYellowIn({ elements: [el('#1A1A1A')] })).toHaveLength(0)
    // 밝은 노랑 면은 글자가 아니므로 대상이 아니다, 밝은 노랑 글자도 어두운 노랑이 아니다
    expect(darkYellowIn({ elements: [el('#F2C230')] })).toHaveLength(0)
  })

  it('photo: 구도·목적·비율 칸과 높이 500', () => {
    expectRule(valid({ slots: { ...valid().slots, photo: imageSlot({ required: true, composition: [] }) } }), 'photo')
    expectRule(valid({ slots: { ...valid().slots, photo: imageSlot({ required: true, purpose: [] }) } }), 'photo')
    expectRule(valid({ slots: { ...valid().slots, photo: imageSlot({ required: true, aspect: ['4:3'], minHeight: 0 }) }, flow: [...baseFlow.slice(0, 2), { kind: 'image', slot: 'photo', w: 340 }] }), 'photo')
    expectRule({ ...valid(), needs: { ...valid().needs, photos: 3 } }, 'photo')
  })

  it('signature: 적은 값이 흐름과 다르면 잡는다', () => {
    expectRule({ ...valid(), signature: { columns: 2, photo: 'grid', align: 'center', container: 'band' } }, 'signature')
  })

  it('evidence: 근거 잠금 섹션과 수치 슬롯', () => {
    expectRule({ ...valid(), id: 'review.x', section: 'review', preview: 'mock/review.x.html' }, 'evidence')
    const metric = { ...valid({ section: 'perf_metric', id: 'perf_metric.x' }), preview: 'mock/perf_metric.x.html' }
    expectRule({ ...metric, needs: { ...metric.needs, evidence: ['rating'] } }, 'evidence')
  })

  it('facts: 사실 수가 슬롯 계산과 다르면 잡는다', () => {
    expectRule({ ...valid(), needs: { ...valid().needs, facts: { min: 0, max: 9 } } }, 'facts')
  })

  it('hook: 상품명 슬롯·HOOK 토큰', () => {
    const hook = (slots: Template['slots'], flow: FlowNode[]) =>
      valid({ id: 'hook_3step.x', section: 'hook_3step', order: { zone: 'intro', notNextTo: [] }, slots, flow })
    expectRule(hook(valid().slots, baseFlow), 'hook')
    const withName = hook(
      { productName: textSlot({ required: true, maxChars: 16, maxLines: 2 }), photo: imageSlot({ required: true }) },
      [{ kind: 'text', slot: 'productName', token: 'HOOK', gapAfter: 'photoGap' }, { kind: 'image', slot: 'photo' }]
    )
    expect(lintTemplate(withName).some((v) => v.rule === 'hook' && v.detail.includes('productName'))).toBe(true)
  })

  it('hook: 글의 양 — 제목 2줄·보조 한 줄 하나, 목록·번호·위 작은 글 금지', () => {
    const hook = (slots: Template['slots'], flow: FlowNode[]) =>
      valid({ id: 'hook_3step.x', section: 'hook_3step', order: { zone: 'intro', notNextTo: [] }, slots, flow })
    const headline = textSlot({ required: true, maxChars: 12, maxLines: 2 })
    const sub = textSlot({ maxChars: 12, maxLines: 1 })
    const photo = imageSlot({ required: true })
    const title: FlowNode = { kind: 'text', slot: 'headline', token: 'HOOK', gapAfter: 'titleGap' }
    const line: FlowNode = { kind: 'text', slot: 'sub', token: 'BODY', gapAfter: 'photoGap' }
    const image: FlowNode = { kind: 'image', slot: 'photo', bleed: true }
    const hookRules = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'hook')
    expect(hookRules(hook({ headline, sub, photo }, [title, line, image]))).toEqual([])
    // 첫 화면 가장 큰 사진 0.55 아래 — 여백 둔 사진(적용 K13)
    expect(hookRules(hook({ headline, sub, photo }, [title, line, { kind: 'image', slot: 'photo' }])).map((v) => v.detail).join()).toContain('첫 화면 가장 큰 사진')
    // 보조가 두 줄이거나 길다
    expectRule(hook({ headline, sub: textSlot({ maxChars: 12, maxLines: 2 }), photo }, [title, line, image]), 'hook')
    expectRule(hook({ headline, sub: textSlot({ maxChars: 20, maxLines: 1 }), photo }, [title, line, image]), 'hook')
    // 제목이 길다
    expectRule(hook({ headline: textSlot({ required: true, maxChars: 14, maxLines: 2 }), sub, photo }, [title, line, image]), 'hook')
    // 보조 글이 둘이다
    const second: FlowNode = { kind: 'text', slot: 'more', token: 'BODY', gapAfter: 'photoGap' }
    expectRule(hook({ headline, sub, more: textSlot({ maxChars: 12, maxLines: 1 }), photo }, [title, line, second, image]), 'hook')
    // 번호 나열
    const steps: FlowNode = { kind: 'repeat', slot: 'steps', nodes: [{ kind: 'text', slot: 'title', token: 'H3' }] }
    const list = hook({ headline, steps: { type: 'list', required: true, min: 2, max: 3, fields: { title: textSlot({ required: true, maxChars: 12, maxLines: 2 }) } }, photo }, [title, steps, image])
    expect(lintTemplate(list).some((v) => v.rule === 'hook' && v.detail.includes('repeat'))).toBe(true)
    // 위 작은 글(캡슐)
    const eyebrow: FlowNode = { kind: 'capsule', label: 'BEST', gapAfter: 'tightGap' }
    expect(lintTemplate(hook({ headline, sub, photo }, [eyebrow, title, line, image])).some((v) => v.rule === 'hook' && v.detail.includes('capsule'))).toBe(true)
  })

  it('evidence: 고민 섹션 밖에서는 근거가 있어도 엑스를 못 쓰고, 중립 dash는 비교 근거가 있어야 한다', () => {
    const slots = { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }), photo: imageSlot({ required: true }) }
    const flow: FlowNode[] = [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
      { kind: 'mark', value: 'cross', gapAfter: 'photoGap' },
      { kind: 'image', slot: 'photo' },
    ]
    const crossOf = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'evidence' && v.detail.includes('엑스'))
    const base = valid({ id: 'compare.x', section: 'compare', slots, flow })
    expect(crossOf(base)).toHaveLength(1)
    expect(crossOf({ ...base, needs: { ...base.needs, evidence: ['compare_basis'] } })).toHaveLength(1)
    expect(crossOf(valid({ id: 'problem_raise.x', section: 'problem_raise', slots, flow }))).toEqual([])
    const dashFlow: FlowNode[] = flow.map((node) => (node.kind === 'mark' ? { ...node, value: 'dash' as const } : node))
    const dashOf = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'evidence' && v.detail.includes('dash'))
    const dashBase = valid({ id: 'compare.y', section: 'compare', slots, flow: dashFlow })
    expect(dashOf(dashBase).length).toBeGreaterThan(0)
    expect(dashOf({ ...dashBase, needs: { ...dashBase.needs, evidence: ['compare_basis'] } })).toEqual([])
  })

  it('evidence: 기존 제품과 나란히 놓는 칸은 비교 근거가 있어야 한다', () => {
    const headline = textSlot({ required: true, maxChars: 16, maxLines: 3 })
    const line = textSlot({ required: true, facts: 0, maxChars: 16, maxLines: 3 })
    const flowOf = (slot: string): FlowNode[] => [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
      { kind: 'text', slot, token: 'BODY' },
    ]
    const contrastOf = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'evidence' && v.detail.includes('나란히'))
    const labelled = valid({ id: 'compare.x', section: 'compare', slots: { headline, otherLabel: line }, flow: flowOf('otherLabel') })
    expect(contrastOf(labelled)).toHaveLength(1)
    expect(contrastOf({ ...labelled, needs: { ...labelled.needs, evidence: ['compare_basis'] } })).toEqual([])
    const from = { headline, from: line }
    expect(contrastOf(valid({ id: 'compare.y', section: 'compare', slots: from, flow: flowOf('from') }))).toHaveLength(1)
    // 고객의 전후 칸은 비교 섹션 밖에서 막지 않는다
    expect(contrastOf(valid({ id: 'direction_suggest.y', section: 'direction_suggest', slots: from, flow: flowOf('from') }))).toEqual([])
  })

  it("evidence·type: '기존 제품' 이름표는 비교 근거가 있어야 하고, 정해진 글자만 쓴다", () => {
    const slots = { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }) }
    const flow = (label: string): FlowNode[] => [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'blockGap' },
      { kind: 'label', label } as FlowNode,
    ]
    const of = (t: Template, rule: string, word: string) => lintTemplate(t).filter((v) => v.rule === rule && v.detail.includes(word))
    const base = valid({ id: 'compare.x', section: 'compare', slots, flow: flow('기존 제품') })
    expect(of(base, 'evidence', '이름표')).toHaveLength(1)
    expect(of({ ...base, needs: { ...base.needs, evidence: ['compare_basis'] } }, 'evidence', '이름표')).toEqual([])
    expect(of(valid({ id: 'compare.y', section: 'compare', slots, flow: flow('우리 제품') }), 'evidence', '이름표')).toEqual([])
    expect(of(valid({ id: 'compare.z', section: 'compare', slots, flow: flow('일반 제품') }), 'type', '비교 이름표')).toHaveLength(1)
  })

  it('specRows: 상품 정보 표는 rows·special만', () => {
    const spec = (slots: Template['slots'], flow: FlowNode[]) => valid({ id: 'spec_table.x', section: 'spec_table', slots, flow })
    const rowFields = { label: textSlot({ required: true, facts: 0, maxChars: 8, maxLines: 1 }), value: textSlot({ required: true, maxChars: 20, maxLines: 3 }) }
    const nodes: FlowNode[] = [{ kind: 'text', slot: 'label', token: 'LABEL' }, { kind: 'text', slot: 'value', token: 'BODY' }]
    expectRule(spec(valid().slots, baseFlow), 'specRows')
    const notInput = spec({ rows: { type: 'list', required: true, min: 1, max: 7, fields: rowFields } }, [{ kind: 'repeat', slot: 'rows', nodes }])
    expectRule(notInput, 'specRows')
    const extra = spec(
      {
        rows: { type: 'list', required: true, source: 'input', input: 'spec.rows', min: 1, max: 7, fields: rowFields },
        more: { type: 'list', required: false, min: 1, max: 3, fields: rowFields },
      },
      [{ kind: 'repeat', slot: 'rows', gapAfter: 'blockGap', nodes }, { kind: 'repeat', slot: 'more', nodes }]
    )
    expectRule(extra, 'specRows')
    const good = spec({ rows: { type: 'list', required: true, source: 'input', input: 'spec.rows', min: 1, max: 7, fields: rowFields } }, [{ kind: 'repeat', slot: 'rows', nodes }])
    expect(rulesOf(good)).not.toContain('specRows')
  })

  it('headStyle: point_div는 정해진 머리로 시작해야 한다', () => {
    const point = (over: Partial<Template> = {}) => valid({ id: 'point_div.x', section: 'point_div', ...over })
    // headStyle이 없거나, 있어도 흐름이 그 머리로 시작하지 않으면 잡는다
    expectRule(point(), 'headStyle')
    expectRule({ ...point(), headStyle: 'point-standard' }, 'headStyle')
    const head: FlowNode[] = [
      { kind: 'capsule', label: 'POINT', gapAfter: 'tightGap' },
      {
        kind: 'row',
        gap: 10,
        gapAfter: 'titleGap',
        columns: [
          { w: 150, nodes: [{ kind: 'text', slot: 'chapter', token: 'DISPLAY', format: 'two' }] },
          { w: 580, nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }] },
        ],
      },
      { kind: 'text', slot: 'sub', token: 'BODY', gapAfter: 'photoGap' },
      { kind: 'image', slot: 'photo' },
    ]
    const good = point({
      flow: head,
      headStyle: 'point-standard',
      slots: {
        chapter: textSlot({ facts: 0, source: 'input', input: 'chapter', maxChars: 2, maxLines: 1 }),
        headline: textSlot({ required: true, maxChars: 12, maxLines: 3 }),
        sub: textSlot({ maxChars: 24, maxLines: 3 }),
        photo: imageSlot({ required: true }),
      },
    })
    expect(rulesOf(good)).not.toContain('headStyle')
    expect(lintTemplate(good)).toEqual([])
    // point_div가 아닌 섹션에는 쓰지 않는다
    expectRule({ ...valid(), headStyle: 'point-standard' as const }, 'headStyle')
  })

  it('height: 적은 높이가 계산과 다르면 잡는다', () => {
    expectRule({ ...valid(), estimatedHeight: { min: 100, max: 200 } }, 'height')
    expectRule({ ...valid(), height: 99 }, 'height')
  })
})

describe('deriveSignature', () => {
  const sig = (flow: FlowNode[]): Signature => deriveSignature({ flow })
  const image = (extra: object = {}): FlowNode => ({ kind: 'image', slot: 'p', ...extra })
  const title: FlowNode = { kind: 'text', slot: 't', token: 'H1' }

  it('사진 위치를 읽는다', () => {
    expect(sig([title]).photo).toBe('none')
    expect(sig([title, image()]).photo).toBe('inset')
    expect(sig([image({ bleed: true }), title]).photo).toBe('bleed-top')
    expect(sig([title, image({ bleed: true })]).photo).toBe('bleed-bottom')
    expect(sig([title, image({ x: 120, w: 680 })]).photo).toBe('offset')
    expect(sig([{ kind: 'row', columns: [{ w: 336, nodes: [image()] }, { w: 380, nodes: [title] }] }]).photo).toBe('side')
    expect(sig([{ kind: 'row', columns: [{ w: 358, nodes: [image()] }, { w: 358, nodes: [image()] }] }]).photo).toBe('pair')
    expect(sig([{ kind: 'repeat', slot: 'l', columns: 3, nodes: [image()] }]).photo).toBe('grid')
  })

  it('열 수·정렬·용기를 읽는다', () => {
    expect(sig([{ kind: 'repeat', slot: 'l', columns: 3, nodes: [title] }]).columns).toBe(3)
    expect(sig([{ kind: 'text', slot: 't', token: 'H1', align: 'center' }]).align).toBe('center')
    expect(sig([{ kind: 'panel', fill: 'D', bleed: true, nodes: [title] }]).container).toBe('band')
    expect(sig([{ kind: 'panel', fill: 'N', nodes: [title] }]).container).toBe('card')
    expect(sig([{ kind: 'panel', fill: 'T', radius: 'bubble', nodes: [title] }]).container).toBe('bubble')
    expect(sig([{ kind: 'repeat', slot: 'l', rule: true, nodes: [title] }]).container).toBe('table')
    expect(sig([{ kind: 'row', columns: [{ w: 200, nodes: [{ kind: 'panel', fill: 'A', nodes: [title] }] }] }]).container).toBe('tile')
    expect(sig([title, image({ plate: { dx: -48, dy: 48 } })]).container).toBe('plate')
  })

  it('키는 네 칸을 잇는다', () => {
    expect(signatureKey({ columns: 2, photo: 'side', align: 'left', container: 'none' })).toBe('2|side|left|none')
  })
})

const shapeKeyOf = (t: Template) => signatureKey(deriveSignature(t))

describe('skeletonKey', () => {
  const key = (nodes: FlowNode[]) => skeletonKey(nodes)
  const text = (over: Partial<Extract<FlowNode, { kind: 'text' }>> = {}): FlowNode => ({ kind: 'text', slot: 'a', token: 'BODY', ...over })

  it('글 칸 이름·여백·명시한 왼쪽 정렬은 뼈대가 아니다', () => {
    expect(key([text({ slot: 'other', gapAfter: 'photoGap' })])).toBe(key([text()]))
    expect(key([text({ align: 'left' })])).toBe(key([text()]))
  })

  it.each<[string, FlowNode[], FlowNode[]]>([
    ['글자 단계', [text()], [text({ token: 'H1' })]],
    ['정렬', [text()], [text({ align: 'center' })]],
    ['순서', [text(), { kind: 'image', slot: 'p' }], [{ kind: 'image', slot: 'p' }, text()]],
    ['판 색', [{ kind: 'panel', fill: 'T', nodes: [text()] }], [{ kind: 'panel', fill: 'N', nodes: [text()] }]],
    ['풀폭 띠', [{ kind: 'panel', fill: 'T', nodes: [text()] }], [{ kind: 'panel', fill: 'T', bleed: true, nodes: [text()] }]],
    ['반복 열', [{ kind: 'repeat', slot: 'l', columns: 2, nodes: [text()] }], [{ kind: 'repeat', slot: 'l', columns: 3, nodes: [text()] }]],
    ['반복 구분선', [{ kind: 'repeat', slot: 'l', nodes: [text()] }], [{ kind: 'repeat', slot: 'l', rule: true, nodes: [text()] }]],
    ['가로 칸 묶음', [{ kind: 'row', columns: [{ w: 300, nodes: [text()] }, { w: 300, nodes: [text()] }] }], [{ kind: 'row', columns: [{ w: 300, nodes: [text(), text()] }] }]],
    ['가로 칸 안', [{ kind: 'row', columns: [{ w: 300, nodes: [text()] }] }], [{ kind: 'row', columns: [{ w: 300, nodes: [text({ token: 'H1' })] }] }]],
    ['판 안', [{ kind: 'panel', fill: 'T', nodes: [text()] }], [{ kind: 'panel', fill: 'T', nodes: [text({ token: 'H1' })] }]],
    ['반복 안', [{ kind: 'repeat', slot: 'l', nodes: [text()] }], [{ kind: 'repeat', slot: 'l', nodes: [text({ token: 'H1' })] }]],
  ])('%s이 다르면 뼈대가 다르다', (_name, a, b) => {
    expect(key(a)).not.toBe(key(b))
  })
})

describe('skeletonReport', () => {
  const inset = valid({ id: 'sub_div.inset' })
  const bleed = valid({ id: 'sub_div.bleed', flow: [baseFlow[0], baseFlow[1], { kind: 'image', slot: 'photo', bleed: true }] })
  const elsewhere = { ...inset, id: 'key_message.same', section: 'key_message', preview: 'mock/key_message.same.html' } as Template

  it('공용끼리 같은 뼈대는 막지 않고 묶음으로 보고한다', () => {
    expect(shapeKeyOf(inset)).not.toBe(shapeKeyOf(bleed))
    const violations = lintTemplateLibrary([inset, bleed]).violations.filter((v) => v.rule === 'category' || v.rule === 'signature')
    expect(violations).toEqual([])
    const report = skeletonReport([inset, bleed])
    expect(report.withinSection.map((g) => g.templates)).toEqual([[inset.id, bleed.id]])
    expect(report.acrossSections).toEqual([])
  })

  it('섹션을 넘어 같은 묶음은 따로 낸다', () => {
    const report = skeletonReport([inset, elsewhere])
    expect(report.withinSection).toEqual([])
    expect(report.acrossSections.map((g) => g.templates)).toEqual([[inset.id, elsewhere.id]])
  })

  it('카테고리 템플릿은 보고에 넣지 않는다', () => {
    const category = { ...bleed, fit: { ...bleed.fit, categories: ['household'] } }
    expect(skeletonReport([inset, category]).withinSection).toEqual([])
  })
})

describe('lintTemplateLibrary', () => {
  const first = valid({ id: 'sub_div.a' })

  it('색 경고 보고 — 컨셉마다 색 조합 전부를 lintKPageColors로 세고, 위반에 넣지 않는다(L10 후보 7)', () => {
    const report = lintTemplateLibrary([first])
    expect(report.colors.byConcept.map((c) => c.concept)).toEqual(CONCEPTS.map((c) => c.id))
    expect(report.colors.sets).toBe(CONCEPTS.reduce((sum, c) => sum + colorSetsOf(c).sets.length, 0))
    const warned = CONCEPTS.reduce((sum, c) => sum + colorSetsOf(c).sets.filter((s) => lintKPageColors(s.colors, first.fit.concepts.includes(c.id) ? [first] : []).length > 0).length, 0)
    expect(report.colors.warned).toBe(warned)
    expect(report.violations.filter((v) => /유채|장식/.test(v.detail))).toEqual([])
  })
  const other = fillMeta(
    templateOf({
      id: 'sub_div.b',
      flow: [{ kind: 'image', slot: 'photo', bleed: true, gapAfter: 'photoGap' }, { kind: 'text', slot: 'headline', token: 'H1' }],
      slots: { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }), photo: imageSlot({ required: true }) },
    })
  )

  describe('카테고리 템플릿', () => {
    const ofCategory = (id: string, categories: string[], over: Partial<Template['fit']> = {}, base: Template = first): Template => ({
      ...base,
      id,
      preview: `mock/${id}.html`,
      fit: { ...base.fit, concepts: ['clean-trust', 'natural-wood', 'pastel-baby'], categories, ...over },
    })
    const scenePhoto = imageSlot({ required: true, purpose: ['scale'] })
    const rules = (list: Template[]) => lintTemplateLibrary(list).violations.filter((v) => v.rule === 'category' || v.rule === 'signature')

    /** first와 서명은 같고 뼈대와 화면 단계만 다른 흐름(제목 없이 작은 글뿐이다). 보조 글 단계만 다르면 화면 단계에서 같아 사진 목적과 상관없이 막힌다 */
    const sameShape: FlowNode[] = [{ kind: 'text', slot: 'headline', token: 'BODY_BOLD', gapAfter: 'titleGap' }, baseFlow[1], baseFlow[2]]

    it('공용과 뼈대+글자 단계가 같으면 사진 목적·구도가 달라도 막는다', () => {
      const details = (t: Template) => rules([first, t]).map((v) => v.detail).join()
      expect(details(ofCategory('sub_div.c', ['household']))).toContain('뼈대')
      expect(details(ofCategory('sub_div.d', ['household'], {}, valid({ slots: { ...first.slots, photo: scenePhoto } })))).toContain(`공용 ${first.id}와 뼈대`)
      const worn = imageSlot({ required: true, purpose: (first.slots.photo as { purpose: string[] }).purpose, composition: ['worn'] })
      expect(details(ofCategory('sub_div.w0', ['household'], {}, valid({ slots: { ...first.slots, photo: worn } })))).toContain('뼈대')
    })

    it('다른 섹션 공용과 뼈대가 같은 것은 막지 않는다', () => {
      const elsewhere = { ...first, id: 'key_message.base', section: 'key_message', preview: 'mock/key_message.base.html' } as Template
      expect(rules([elsewhere, ofCategory('sub_div.c', ['household'], {}, valid({ slots: { ...first.slots, photo: scenePhoto } }))])).toEqual([])
    })

    it('서명이 같고 뼈대가 다르면 사진 목적이 달라야 한다 — 같으면 fit만 다른 복제다', () => {
      const clone = ofCategory('sub_div.c', ['household'], {}, valid({ flow: sameShape }))
      expect(shapeKeyOf(clone)).toBe(shapeKeyOf(first))
      expect(rules([first, clone]).map((v) => v.detail).join()).toContain('복제')
      const differs = ofCategory('sub_div.d', ['household'], {}, valid({ flow: sameShape, slots: { ...first.slots, photo: scenePhoto } }))
      expect(rules([first, differs])).toEqual([])
    })

    it('사진 목적은 등록값만 쓰고, 재료 목적만 있는 칸은 막는다', () => {
      const photoOf = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'photo').map((v) => v.detail).join()
      expect(photoOf(valid({ slots: { ...first.slots, photo: imageSlot({ required: true, purpose: ['bogus'] }) } }))).toContain('등록 안 된 목적 bogus')
      expect(photoOf(valid({ slots: { ...first.slots, photo: imageSlot({ required: true, purpose: ['ingredient'] }) } }))).toContain('입력 없는 상품')
      expect(photoOf(valid({ slots: { ...first.slots, photo: imageSlot({ required: true, purpose: ['ingredient', 'feature_proof'] }) } }))).toEqual('')
      for (const purpose of ['state', 'package']) expect(photoOf(valid({ slots: { ...first.slots, photo: imageSlot({ required: true, purpose: [purpose] }) } }))).toEqual('')
    })

    it('착용 구도도 복제 검사에 든다 — 모양·목적이 같아도 착용이면 공용 복제가 아니다', () => {
      const worn = ofCategory('sub_div.w', ['household'], {}, valid({ flow: sameShape, slots: { ...first.slots, photo: imageSlot({ required: true, purpose: (first.slots.photo as { purpose: string[] }).purpose, composition: ['worn'] }) } }))
      expect(rules([first, worn])).toEqual([])
    })

    it('칸별 컨셉 덮기는 카테고리 템플릿이 있는 칸만 보고한다', () => {
      expect(conceptCoverage([first])).toEqual([])
      const one = ofCategory('sub_div.k', ['household'], {}, valid({ slots: { ...first.slots, photo: scenePhoto } }))
      const [cell] = conceptCoverage([first, one])
      expect(cell).toMatchObject({ category: 'household', section: one.section })
      expect(cell.covered).toBeLessThan(cell.total)
      expect(cell.missing).not.toContain('natural-wood')
    })

    it('카테고리가 겹치면 모양이 달라야 하고, 겹치지 않으면 흐름이나 사진 목적이 달라야 한다', () => {
      const a = ofCategory('sub_div.e', ['household'], {}, valid({ slots: { ...first.slots, photo: scenePhoto } }))
      const overlap = ofCategory('sub_div.f', ['household', 'pet'], {}, a)
      expect(rules([a, overlap]).filter((v) => v.rule === 'signature')).toHaveLength(1)
      const clone = ofCategory('sub_div.g', ['packaging'], {}, a)
      expect(rules([a, clone]).map((v) => v.detail).join()).toContain('키끼리')
      const otherPurpose = ofCategory('sub_div.g2', ['packaging'], {}, valid({ slots: { ...first.slots, photo: imageSlot({ required: true, purpose: ['package'] }) } }))
      expect(rules([a, otherPurpose])).toEqual([])
      const otherFlow = ofCategory('sub_div.g3', ['packaging'], {}, { ...a, flow: [...a.flow].reverse() })
      expect(rules([a, otherFlow]).map((v) => v.detail).join()).not.toContain('키끼리')
    })

    it('fit.concepts에 그 카테고리의 컨셉이 있어야 한다', () => {
      const none = ofCategory('sub_div.h', ['food'], { concepts: ['clean-trust'] }, valid({ slots: { ...first.slots, photo: scenePhoto } }))
      expect(rules([none]).map((v) => v.detail).join()).toContain('food 컨셉')
    })

    it('칸 값을 본다 — 없는 카테고리, 다른 카테고리의 제품군, 카테고리 없는 제품군·family, family 형식', () => {
      const base = valid({ slots: { ...first.slots, photo: scenePhoto } })
      const details = (t: Template) => rules([t]).map((v) => v.detail).join()
      expect(details(ofCategory('sub_div.i', ['sports'], {}, base))).toContain('없는 카테고리')
      expect(details(ofCategory('sub_div.j', ['household'], { productFamilies: ['pet_food'] }, base))).toContain('제품군이 아님')
      expect(details(ofCategory('sub_div.k', [], { productFamilies: ['pet_food'] }, base))).toContain('fit.categories도 필요')
      expect(details({ ...base, id: 'sub_div.l', family: 'food-warm' })).toContain('카테고리 템플릿에만')
      expect(details({ ...ofCategory('sub_div.m', ['household'], {}, base), family: 'Food Warm' })).toContain('family 형식')
    })
  })

  it('같은 섹션에서 모양이 같으면 잡는다', () => {
    const twin = { ...first, id: 'sub_div.twin', preview: 'mock/sub_div.twin.html' }
    const report = lintTemplateLibrary([first, twin])
    expect(report.ok).toBe(false)
    expect(report.counts.signature).toBe(1)
    expect(report.violations[0].detail).toContain('sub_div.a')
  })

  it('id가 겹치면 잡는다', () => {
    expect(lintTemplateLibrary([first, first]).violations.some((v) => v.detail === 'id 중복')).toBe(true)
  })

  it('모양이 다르면 통과하고, 섹션별 개수와 높이를 보고한다', () => {
    const report = lintTemplateLibrary([first, other])
    expect(report.violations).toEqual([])
    expect(report.total).toBe(2)
    expect(report.sections.find((s) => s.section === 'sub_div')).toEqual({ section: 'sub_div', count: 2, target: 15 })
    expect(report.sections).toHaveLength(29)
    const typical = Math.round((first.height + other.height) / 2)
    expect(Math.abs(report.heights.avgTypical - typical)).toBeLessThanOrEqual(10)
    expect(report.heights.ratioToD).toBeCloseTo(report.heights.avgTypical / 1900, 1)
    expect(report.heights.page.atTarget).toBe(report.heights.avgTypical * 20)
    expect(report.heights.page.required).toBe(27565)
    expect(report.heights.page.meetsAtTarget).toBe(report.heights.avgTypical * 20 >= 27565)
    expect(report.heights.bySection.map((s) => s.section)).toEqual(['sub_div'])
  })

  it('빈 라이브러리도 보고를 낸다', () => {
    const report = lintTemplateLibrary([])
    expect(report.ok).toBe(true)
    expect(report.heights.avgTypical).toBe(0)
  })
})
