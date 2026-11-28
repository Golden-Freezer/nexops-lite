/**
 * K7 4d 같은 축척 윤곽(T1-84·T2-32, T2-24 부분 — 통합 11-04 04:0x ③·06:0x ①~③) — 옵션 사이즈 표의 가로·세로 숫자를 한 축척으로 줄 세운다.
 * 읽기(scaleRows·scaleItems)·배치(scaleLayout)·그리기(scaleSet 노드)·린트·칸 2개(option_gallery.scale-set·spec_table.scale-set). LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from '../__fixtures__/pdp-products'
import type { SizeMatrix } from '../input-slots'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { ctxOf } from './engine.fixture'
import { fillInputSlots, lineInputsOf, requiredInputsFit } from './input-values'
import { TEMPLATES, templateById } from './library'
import { lintTemplate } from './lint'
import { lintCategoryTemplates } from './lint-category'
import { sampleSlots } from './sample'
import { scaleLayout, scaleRows, shownMm } from './scale-set'
import { deriveSignature, signatureKey } from './signature'
import type { FlowNode, ListSlot, Template } from './template-types'

/** 코드 상수를 가져오면 상수가 틀어져도 시험이 함께 움직인다 — 이름·숫자로 고정한다 */
const SVG = 'annotation-leader-scale'
const LABEL = 'designcut-scale-label'
const DIMS = 'designcut-scale-dims'
const CELLS = ['option_gallery.scale-set', 'spec_table.scale-set']
const W = 860

const cell = (id: string): Template => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}
const matrix = (columns: string[], rows: Array<[string, ...string[]]>): SizeMatrix => ({ columns, rows: rows.map(([label, ...values]) => ({ label, values })) })
const THREE = matrix(['가로', '세로'], [['S', '20cm', '24cm'], ['M', '26cm', '30cm'], ['L', '32cm', '36cm']])
const inputsOf = (spec: Partial<PdpSpecSheet>) => lineInputsOf({ spec_sheet: { productName: '표본', ...spec }, analysis: {}, copy_sections: { final: {} } } as unknown as PdpJobRow)
const draw = (t: Template, sizeMatrix: SizeMatrix) => renderTemplate(t, { ...sampleSlots(t, { mode: 'required' }), ...fillInputSlots(t, inputsOf({ sizeMatrix }), 1) }, ctxOf())
const named = (out: NonNullable<ReturnType<typeof draw>>, name: string) => out.elements.filter((el) => el.name === name)
/** svg 경로의 사각형(M x y H x V y H x Z)과 밑줄 */
const rectsOf = (svg: string) => [...svg.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+Z/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] }))
const sectionOf = (out: NonNullable<ReturnType<typeof draw>>, sectionType: string) =>
  ({ id: 's', sectionType, groupType: 'modules', order: 0, isVisible: true, layoutId: 'designcut_k_x', preserveBottomPad: true, canvas: { width: W, height: out.height, backgroundColor: out.background }, elements: out.elements }) as unknown as CanvasSection

describe('같은 축척 읽기 — scaleRows(가로·세로 열, 숫자 + 단위, 상한)', () => {
  it('가로·세로 열 숫자를 입력 글 그대로 읽는다 — 칸에 단위가 없으면 열 이름의 단위만 붙인다', () => {
    expect(scaleRows(THREE)).toEqual([
      { label: 'S', width: '가로 20cm', height: '세로 24cm' },
      { label: 'M', width: '가로 26cm', height: '세로 30cm' },
      { label: 'L', width: '가로 32cm', height: '세로 36cm' },
    ])
    expect(scaleRows(matrix(['가로(cm)', '높이(cm)', '무게'], [['소', '20', '30', '1kg'], ['대', '25.5', '40', '2kg']]))).toEqual([
      { label: '소', width: '가로 20cm', height: '높이 30cm' },
      { label: '대', width: '가로 25.5cm', height: '높이 40cm' },
    ])
    expect(scaleRows(matrix(['W', 'H'], [['S', '200mm', '30cm'], ['M', '25cm', '350mm']])).map((r) => [shownMm(r.width), shownMm(r.height)])).toEqual([
      [200, 300],
      [250, 350],
    ])
  })

  it('폭·길이 열은 읽지 않고, 축 열이 둘이면(세로·높이) 어느 쪽인지 몰라 비운다', () => {
    expect(scaleRows(matrix(['가로', '폭'], [['S', '20cm', '8cm'], ['M', '26cm', '9cm']]))).toEqual([])
    expect(scaleRows(matrix(['폭', '길이'], [['S', '20cm', '30cm'], ['M', '26cm', '40cm']]))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로', '높이'], [['S', '20cm', '30cm', '10cm'], ['M', '26cm', '40cm', '12cm']]))).toEqual([])
    // 가방 '가로 × 세로 × 폭' — 폭(깊이)은 빼고 가로·세로만
    expect(scaleRows(matrix(['가로', '세로', '폭'], [['S', '20cm', '30cm', '8cm'], ['M', '26cm', '40cm', '9cm']])).map((r) => r.width)).toEqual(['가로 20cm', '가로 26cm'])
  })

  it('단위가 하나라도 없거나 범위·여러 값이면 비운다(비율을 믿을 수 없다 — 숫자를 짓지 않는다)', () => {
    expect(scaleRows(matrix(['가로', '세로'], [['S', '20', '24'], ['M', '26', '30']]))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], [['S', '20cm', '24'], ['M', '26cm', '30cm']]))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], [['S', '20~22cm', '24cm'], ['M', '26cm', '30cm']]))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], [['S', '약 20cm', '24cm'], ['M', '26cm', '30cm']]))).toEqual([])
  })

  it('행 2~5·이름 3자 이하·축마다 큰 값 ÷ 작은 값 12 이하일 때만 — 하나라도 넘으면 목록 전체를 비운다(자르지 않음)', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i): [string, string, string] => [`S${i}`, `${20 + i}cm`, `${30 + i}cm`])
    expect(scaleRows(matrix(['가로', '세로'], rows(1)))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], rows(2)))).toHaveLength(2)
    expect(scaleRows(matrix(['가로', '세로'], rows(5)))).toHaveLength(5)
    expect(scaleRows(matrix(['가로', '세로'], rows(6)))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], [['XXXL', '20cm', '30cm'], ['M', '26cm', '40cm']]))).toEqual([])
    expect(scaleRows(matrix(['가로', '세로'], [['S', '1cm', '30cm'], ['M', '12cm', '40cm']]))).toHaveLength(2)
    expect(scaleRows(matrix(['가로', '세로'], [['S', '1cm', '30cm'], ['M', '13cm', '40cm']]))).toEqual([])
  })
})

describe('같은 축척 배치·그리기', () => {
  it('배치는 축척 하나 — 사각형 가로·세로 비가 입력 비와 같고(반올림 1px 안), 열 가운데에 놓인다', () => {
    const sizes = [{ w: 200, h: 240 }, { w: 260, h: 300 }, { w: 320, h: 360 }]
    const { colW, scale, boxes } = scaleLayout(sizes, 740, 24)
    expect(colW).toBe(Math.floor((740 - 48) / 3))
    sizes.forEach((s, i) => {
      expect(Math.abs(boxes[i].w - s.w * scale)).toBeLessThanOrEqual(1)
      expect(Math.abs(boxes[i].h - s.h * scale)).toBeLessThanOrEqual(1)
      expect(Math.abs(boxes[i].x * 2 + boxes[i].w - colW)).toBeLessThanOrEqual(1)
    })
    expect(Math.max(...boxes.map((b) => b.h))).toBeLessThanOrEqual(360)
    expect(Math.max(...boxes.map((b) => b.w))).toBeLessThanOrEqual(Math.round(colW * 0.8))
  })

  it('사각형은 바닥 맞춤·지시선 굵기 4, 열 이름표는 행마다 하나, 치수 줄은 입력 글 그대로다', () => {
    const out = draw(cell('option_gallery.scale-set'), THREE)!
    expect(out).not.toBeNull()
    const [svg] = named(out, SVG)
    const path = svg.svgProps?.svgString ?? ''
    expect(path).toContain('stroke-width="4"')
    const rects = rectsOf(path)
    expect(rects).toHaveLength(3)
    expect(new Set(rects.map((r) => r.y1)).size).toBe(1)
    // 가로 비 20:26:32·세로 비 24:30:36 그대로
    const ws = rects.map((r) => r.x1 - r.x0)
    const hs = rects.map((r) => r.y1 - r.y0)
    expect(Math.abs(ws[0] / ws[2] - 20 / 32)).toBeLessThan(0.02)
    expect(Math.abs(hs[0] / hs[2] - 24 / 36)).toBeLessThan(0.02)
    expect(named(out, LABEL).map((el) => el.textProps?.content)).toEqual(['S', 'M', 'L'])
    // 빌더가 숫자·단위를 한 줄에 묶으려고 공백을 붙임 공백으로 바꾼다 — 공백만 고르게 보고 글은 그대로 대조한다
    const flat = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ')
    expect(named(out, DIMS).map((el) => flat(el.textProps?.content))).toEqual(['S 가로 20cm · 세로 24cm', 'M 가로 26cm · 세로 30cm', 'L 가로 32cm · 세로 36cm'])
    expect(svg.groupId).toBeTruthy()
  })

  it('입력이 그릴 꼴이 아니면(사이즈 표 없음·단위 없음) 칸이 비어 그 칸은 후보에서 빠진다 — 엔진도 숫자를 못 읽는 항목이 있으면 도식·이름표·치수 줄을 그리지 않는다', () => {
    for (const id of CELLS) {
      expect(requiredInputsFit(cell(id), inputsOf({})), id).toBe(false)
      expect(requiredInputsFit(cell(id), inputsOf({ sizeMatrix: matrix(['가로', '세로'], [['S', '20', '24'], ['M', '26', '30']]) })), id).toBe(false)
      expect(requiredInputsFit(cell(id), inputsOf({ sizeMatrix: THREE })), id).toBe(true)
      // 규제 표현이 든 표는 사이즈 표 줄과 같이 통째로 뺀다
      expect(requiredInputsFit(cell(id), inputsOf({ sizeMatrix: matrix(['가로', '세로'], [['치료', '20cm', '24cm'], ['M', '26cm', '30cm']]) })), id).toBe(false)
    }
    const t = cell('option_gallery.scale-set')
    const broken = { ...sampleSlots(t, { mode: 'required' }), scale: [{ label: 'S', width: '가로 약간', height: '세로 24cm' }, { label: 'M', width: '가로 26cm', height: '세로 30cm' }] }
    const out = renderTemplate(t, broken, ctxOf())
    expect([SVG, LABEL, DIMS].map((name) => out?.elements.filter((el) => el.name === name).length ?? 0)).toEqual([0, 0, 0])
  })

  it('시험 상품 11개는 사이즈 표가 없어 새 칸 2개 모두 후보 밖이다(484쪽 그대로의 근거)', () => {
    for (const pid of PDP_TEST_PRODUCT_IDS) {
      const inputs = inputsOf(getPdpTestProduct(pid).specSheet)
      for (const id of CELLS) expect(requiredInputsFit(cell(id), inputs), `${pid} ${id}`).toBe(false)
    }
  })
})

describe('같은 축척 린트', () => {
  const scaleSlot = (): ListSlot => structuredClone(cell('option_gallery.scale-set').slots.scale as ListSlot)
  const fixture = (flow: FlowNode[], over: Partial<Template> = {}): Template => ({ ...structuredClone(cell('option_gallery.scale-set')), flow, ...over })
  const issues = (t: Template) => lintTemplate(t).map((v) => v.detail).filter((d) => d.includes('축척') || d.includes('표 내용'))

  it('새 칸 2개는 린트 0이고, 같은 섹션 공용 칸과 서명이 겹치지 않으며 카테고리 화면 검사도 0이다', () => {
    for (const id of CELLS) {
      const t = cell(id)
      expect(lintTemplate(t).map((v) => `${v.rule}:${v.detail}`), id).toEqual([])
      const others = TEMPLATES.filter((o) => o.section === t.section && o.id !== id && !(o.fit?.categories?.length ?? 0))
      for (const o of others) expect(signatureKey(deriveSignature(o)), `${id} ↔ ${o.id}`).not.toBe(signatureKey(deriveSignature(t)))
    }
    expect(lintCategoryTemplates(TEMPLATES)).toEqual([])
  })

  it('맨 위 단계·템플릿당 하나·옵션/상품 정보 표 섹션에만', () => {
    const title = cell('option_gallery.scale-set').flow[0]
    expect(issues(fixture([title, { kind: 'panel', fill: 'N', nodes: [{ kind: 'scaleSet', slot: 'scale' }] }]))).toContain('같은 축척 윤곽은 흐름 맨 위 단계에만(판·반복·가로 칸 안 금지)')
    expect(issues(fixture([title, { kind: 'scaleSet', slot: 'scale' }, { kind: 'scaleSet', slot: 'scale' }]))).toContain('같은 축척 윤곽 2개(템플릿당 하나)')
    expect(issues({ ...fixture(cell('option_gallery.scale-set').flow), section: 'sub_div', id: 'sub_div.scale-fixture', preview: 'mock/sub_div.scale-fixture.html' })).toContain('같은 축척 윤곽은 option_gallery·spec_table에만')
  })

  it('칸은 option.sizeScale 필수 목록 2~5, 항목은 이름(3자)·가로·세로 입력 셋', () => {
    const flow = cell('option_gallery.scale-set').flow
    const withSlot = (slot: ListSlot) => fixture(flow, { slots: { ...cell('option_gallery.scale-set').slots, scale: slot } })
    expect(issues(withSlot({ ...scaleSlot(), max: 6 }))).toContain('같은 축척 칸 scale은 option.sizeScale 필수 목록 2~5')
    expect(issues(withSlot({ ...scaleSlot(), required: false }))).toContain('같은 축척 칸 scale은 option.sizeScale 필수 목록 2~5')
    const wide = scaleSlot()
    if (wide.fields.label.type === 'text') wide.fields.label.maxChars = 4
    expect(issues(withSlot(wide))).toContain('같은 축척 이름 칸은 3자(열마다 한 줄 표식)')
    const noHeight = scaleSlot()
    delete noHeight.fields.height
    expect(issues(withSlot(noHeight))).toContain('같은 축척 칸 scale: 필수 입력 칸 size.scale.height 하나')
  })

  it('spec_table 목록 규칙 예외는 scaleSet이 읽는 option.sizeScale 목록 하나뿐이다 — 같은 목록이라도 노드가 안 읽으면 표 내용 위반', () => {
    const t = cell('spec_table.scale-set')
    const noNode = { ...structuredClone(t), flow: t.flow.filter((n) => n.kind !== 'scaleSet') }
    expect(issues(noNode)).toContain('scale: 표 내용은 special(spec.special, 선택)만')
    const otherInput = structuredClone(t)
    ;(otherInput.slots.scale as ListSlot).input = 'option.sizeRows'
    expect(issues(otherInput)).toContain('scale: 표 내용은 special(spec.special, 선택)만')
  })

  it('모든 컨셉 색 조합 × 칸 바탕에서 글자 대비(M2)·글자 하한(M1)·장식(M5)·2열(M6) 위반이 없다', () => {
    const sets = CONCEPTS.flatMap((c) => colorSetsOf(c).sets)
    expect(sets.length).toBeGreaterThan(500)
    const failures: string[] = []
    for (const id of CELLS) {
      const t = cell(id)
      const slots = sampleSlots(t, { mode: 'full' })
      for (const set of sets) {
        for (const bg of t.surfaces) {
          const out = renderTemplate(t, slots, ctxOf({ colors: set.colors, bg }))
          if (!out) {
            failures.push(`${id} ${set.id} ${bg} 그리지 못함`)
            continue
          }
          const bad = checkMobileReadability({ sections: [sectionOf(out, t.section)] }).violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule))
          for (const v of bad) failures.push(`${id} ${set.id} ${bg} ${v.rule} ${v.detail}`)
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
  }, 60_000)
})
