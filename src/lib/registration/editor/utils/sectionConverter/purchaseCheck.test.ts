import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import { ProSectionType } from '../../types/section'
import { checkMobileReadability } from '../mobileReadability'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '../buildEditorDocument'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import {
  PURCHASE_CHECK_TITLE,
  keepBeforeCta,
  mergeRows,
  missingRows,
  placePurchaseCheck,
  purchaseRows,
  shownTextsOf,
  type SpecRow,
} from './purchaseCheck'
import { renderR1 as render } from './__fixtures__/r1Render'
import p02 from './__fixtures__/r1-p02-d10ea762.json'
import p03 from './__fixtures__/r1-p03-f2d72bd0.json'
import p07 from './__fixtures__/r1-p07-8e7006a3.json'

// 구매 전 확인 — 후킹에서 뺀 구성·사이즈·옵션 값이 실제로 그려진 글에 없으면 스펙 표(없으면 CTA 바로 앞 '구매 전 확인' 표)에 싣는다

const spec = {
  source: 'products',
  axes: [
    { kind: 'design', name: '디자인', values: ['데이지', '체리'] },
    { kind: 'size', name: '사이즈', values: ['S', 'L'] },
  ],
  variants: [
    { label: '20개 데이지(S)', values: { design: '데이지', size: 'S', quantity: '20개' } },
    { label: '20개 체리(L)', values: { design: '체리', size: 'L', quantity: '20개' } },
  ],
}
const plain = (rows: SpecRow[]) => rows.map(({ label, value }) => ({ label, value }))

describe('purchaseRows — 입력 값만, 상품명은 싣지 않는다', () => {
  it('등록 옵션 구조: 같은 수량은 구성, 사이즈 축, 디자인 축(사이즈 입력은 축이 있으면 겹쳐 싣지 않는다)', () => {
    expect(plain(purchaseRows({ productName: '구디백', optionSpec: spec, size: '30x10cm' }))).toEqual([
      { label: '구성', value: '20개' },
      { label: '사이즈', value: 'S, L' },
      { label: '디자인', value: '데이지, 체리' },
    ])
  })

  it('옵션 구조가 없으면 옵션명 그대로와 사이즈 입력(길어도 싣는다), 많으면 n가지(낱낱의 값은 판정용으로 남김), 값이 없으면 빈 목록', () => {
    const longSize = '가로 8.5cm × 세로 8cm × 높이 4cm, 손잡이 지름 3cm, 실리콘 돌기 길이 1cm'
    expect(plain(purchaseRows({ productName: '브러쉬', colorOptions: ['1개 세이지 그린'], size: longSize }))).toEqual([
      { label: '옵션', value: '1개 세이지 그린' },
      { label: '사이즈', value: longSize },
    ])
    const many = Array.from({ length: 10 }, (_, i) => `옵션${i + 1}`)
    const [row] = purchaseRows({ colorOptions: many })
    expect(row).toEqual({ label: '옵션', value: '10가지', items: many })
    expect(purchaseRows({ productName: '이름만' })).toEqual([])
    expect(purchaseRows(undefined)).toEqual([])
  })
})

describe('purchaseRows — 목록 줄이기·구성 판정 경계', () => {
  it('값이 적어도 이어 붙인 글이 80자를 넘으면 n가지(낱낱의 값은 판정용으로 남김)', () => {
    const long = [
      '로즈 핑크 실크 리본 장식 대형 선물 상자',
      '민트 그린 실크 리본 장식 대형 선물 상자',
      '라벤더 실크 리본 장식 대형 선물 상자',
      '아이보리 실크 리본 장식 대형 선물 상자',
    ]
    expect(purchaseRows({ colorOptions: long })).toEqual([{ label: '옵션', value: '4가지', items: long }])
  })

  it('수량 축이 없고 옵션마다 수량이 다르면 구성 행을 만들지 않는다(구성이 모호)', () => {
    const mixed = {
      ...spec,
      variants: [
        { label: '20개 데이지(S)', values: { design: '데이지', size: 'S', quantity: '20개' } },
        { label: '30개 체리(L)', values: { design: '체리', size: 'L', quantity: '30개' } },
      ],
    }
    expect(purchaseRows({ optionSpec: mixed }).map((r) => r.label)).toEqual(['사이즈', '디자인'])
  })
})

describe('missingRows — 그려진 글에 보이는 행은 뺀다', () => {
  const rows: SpecRow[] = [
    { label: '디자인', value: '데이지, 체리' },
    { label: '사이즈', value: 'S, L' },
    { label: '옵션', value: '1개 세이지 그린' },
  ]

  it('낱낱의 값이 모두 보여야 보인다 — 공백·줄바꿈 없는 공백·문장부호 무시, 짧은 값 뒤 조사는 허용', () => {
    expect(missingRows(rows, ['데이지와 체리 두 가지', 'S/L 사이즈', '1개 세이지 그린'])).toEqual([])
    expect(missingRows(rows, ['데이지 무늬', 'S/L 사이즈', '세이지 그린 색'])).toEqual([rows[0], rows[2]])
  })

  it('글끼리 이어 붙인 자리·긴 숫자 속 부분·영문 소유격·단위 m은 보인다고 보지 않는다', () => {
    expect(missingRows([{ label: '디자인', value: '데이지' }], ['봄 데이', '지금 담아요'])).toHaveLength(1)
    expect(missingRows([{ label: '구성', value: '20개' }], ['120개 대용량'])).toHaveLength(1)
    expect(missingRows([{ label: '구성', value: '20개' }], ['20개입 한 봉'])).toHaveLength(0)
    expect(missingRows([{ label: '사이즈', value: 'S' }], ["Kid's 전용"])).toHaveLength(1)
    expect(missingRows([{ label: '사이즈', value: 'M' }], ['길이 1.5 m'])).toHaveLength(1)
    expect(missingRows([{ label: '사이즈', value: 'S, L' }], ['S 사이즈와 L 사이즈'])).toHaveLength(0)
  })

  it('짧은 값은 다른 낱말의 뒷부분이면 보인다고 보지 않는다 — XL의 L, 초소형의 소형', () => {
    expect(missingRows([{ label: '사이즈', value: 'L' }], ['XL 사이즈'])).toHaveLength(1)
    expect(missingRows([{ label: '사이즈', value: '소형' }], ['초소형 사이즈'])).toHaveLength(1)
    expect(missingRows([{ label: '사이즈', value: '소형' }], ['소형 사이즈'])).toHaveLength(0)
  })

  it('숨긴 글 요소(isVisible false)는 그려진 글로 보지 않는다', () => {
    const section = {
      id: 's',
      sectionType: ProSectionType.POINT_DIV,
      elements: [
        { type: 'text', isVisible: false, textProps: { content: '데이지, 체리' } },
        { type: 'text', isVisible: true, textProps: { content: 'S/L 사이즈' } },
      ],
    } as unknown as CanvasSection
    expect(shownTextsOf([section])).toEqual(['S/L 사이즈'])
    expect(missingRows([{ label: '디자인', value: '데이지, 체리' }], shownTextsOf([section]))).toHaveLength(1)
  })

  it('곱셈 기호 ×와 x를 같게 보고, n가지로 줄인 행은 낱낱의 값으로 판정한다', () => {
    expect(missingRows([{ label: '사이즈', value: '8.5cm x 8cm' }], ['8.5cm×8cm 손바닥 크기'])).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => `색${i + 1}`)
    expect(missingRows([{ label: '옵션', value: '10가지', items: many }], [many.join(' · ')])).toEqual([])
  })
})

describe('배치 — 기존 표에 더하기, 없으면 CTA 바로 앞', () => {
  const sec = (sectionType: string, id = sectionType) =>
    ({ id, sectionType, elements: [], canvas: { width: 860, height: 100 } }) as unknown as CanvasSection
  const build = (patch: { specRows: SpecRow[]; title?: string }) => [
    { ...sec(ProSectionType.SPEC_TABLE, 'built'), patch } as unknown as CanvasSection,
  ]
  const missing = [{ label: '사이즈', value: 'S, L' }]

  it('스펙 표가 있으면 그 자리에서 기존 행 + 빠진 행으로 다시 짓는다(같은 이름은 "… 옵션")', () => {
    const base = [{ label: '사이즈', value: '30x10cm' }]
    const { sections, added } = placePurchaseCheck(
      [sec(ProSectionType.HOOK_3STEP), sec(ProSectionType.SPEC_TABLE), sec(ProSectionType.CTA)],
      missing,
      base,
      build
    )
    expect(added).toBeNull()
    expect(sections.map((s) => s.id)).toEqual([ProSectionType.HOOK_3STEP, 'built', ProSectionType.CTA])
    expect((sections[1] as unknown as { patch: { specRows: SpecRow[] } }).patch.specRows).toEqual([
      { label: '사이즈', value: '30x10cm' },
      { label: '사이즈 옵션', value: 'S, L' },
    ])
    expect(mergeRows([], missing)).toEqual(missing)
  })

  it('스펙 표가 없으면 첫 CTA 앞에 넣고, 안전장치가 CTA를 끝으로 옮겨도 다시 그 바로 앞에 붙인다', () => {
    const { sections, added } = placePurchaseCheck(
      [sec(ProSectionType.HOOK_3STEP), sec(ProSectionType.CTA), sec(ProSectionType.POINT_DIV)],
      missing,
      [],
      build
    )
    expect(sections.map((s) => s.id)).toEqual([
      ProSectionType.HOOK_3STEP,
      'built',
      ProSectionType.CTA,
      ProSectionType.POINT_DIV,
    ])
    // applySafetyGuards처럼 CTA를 끝으로 옮긴 뒤
    const moved = [sections[0], sections[1], sections[3], sections[2]]
    expect(keepBeforeCta(moved, added!.id).map((s) => s.id)).toEqual([
      ProSectionType.HOOK_3STEP,
      ProSectionType.POINT_DIV,
      'built',
      ProSectionType.CTA,
    ])
    expect(placePurchaseCheck([sec(ProSectionType.HOOK_3STEP)], [], [], build).added).toBeNull()
  })

  it('스펙 표가 없어도 입력 행이 있으면 빠진 행이 없어도 표를 넣는다 — 제목은 기본, 입력 행이 실은 값은 빠진 행에서 뺀다', () => {
    const base = [{ label: '상품명', value: '구디백' }, { label: '색상/수량', value: 'S, L' }]
    const patchOf = (s: CanvasSection) => (s as unknown as { patch: { specRows: SpecRow[]; title?: string } }).patch
    const none = placePurchaseCheck([sec(ProSectionType.HOOK_3STEP), sec(ProSectionType.CTA)], [], base, build)
    expect(none.sections.map((s) => s.id)).toEqual([ProSectionType.HOOK_3STEP, 'built', ProSectionType.CTA])
    expect(none.added?.id).toBe('built')
    expect(patchOf(none.sections[1])).toEqual({ specRows: base })
    const overlap = placePurchaseCheck([sec(ProSectionType.CTA)], [...missing, { label: '구성', value: '20개' }], base, build)
    expect(patchOf(overlap.sections[0]).specRows).toEqual([...base, { label: '구성', value: '20개' }])
  })

  it('스펙 표가 있고 빠진 행이 없으면 그대로 둔다', () => {
    const input = [sec(ProSectionType.SPEC_TABLE), sec(ProSectionType.CTA)]
    expect(placePurchaseCheck(input, [], [{ label: '상품명', value: '구디백' }], build)).toEqual({ sections: input, added: null })
  })
})

describe('재렌더 — 구매 전 확인 구간', () => {
  const tables = (sections: CanvasSection[]) => sections.filter((s) => s.sectionType === ProSectionType.SPEC_TABLE)
  const texts = (s: CanvasSection) => s.elements.filter((e) => e.type === 'text').map((e) => e.textProps!.content)
  const body = (sections: CanvasSection[]) =>
    sections.filter((s) => s.sectionType !== ProSectionType.DIVIDER).map((s) => s.sectionType)

  for (const [key, f] of [
    ['P03', p03],
    ['P07', p07],
  ] as const) {
    it(`R1 ${key}: 골격에 스펙 표가 없어도 CTA 바로 앞(거터 사이)에 상품 정보 표 — 옵션은 색상/수량 행으로 한 번, 제목에 수치 없음, M1~M7 0`, async () => {
      const { doc } = await render(f)
      const [table] = tables(doc.sections)
      expect(tables(doc.sections)).toHaveLength(1)
      const order = body(doc.sections)
      expect(order.indexOf(ProSectionType.SPEC_TABLE)).toBe(order.indexOf(ProSectionType.CTA) - 1)
      const t = texts(table)
      expect(t[0]).toBe('제품 스펙')
      expect(/\d/.test(t[0])).toBe(false)
      expect(t).toEqual(expect.arrayContaining(['상품명', f.spec_sheet.productName, '색상/수량', '1개 세이지 그린']))
      expect(t).not.toContain('옵션')
      expect(t.filter((x) => x === '1개 세이지 그린')).toHaveLength(1)
      expect(checkMobileReadability(doc).violations).toEqual([])
    })
  }

  it('R1 P07에서 CTA 뒤에 섹션이 있어 안전장치가 CTA를 끝으로 옮겨도, 상품 정보 표는 CTA 바로 앞에 남는다', async () => {
    const order = ['hook_3step', 'main_cut', 'point_div', 'product_exposure', 'cta', 'sub_div']
    const { doc } = await render({ ...p07, section_plan: { ...p07.section_plan, section_order: order } } as typeof p07)
    const seq = body(doc.sections)
    expect(seq.at(-1)).toBe(ProSectionType.CTA)
    expect(seq.indexOf(ProSectionType.SPEC_TABLE)).toBe(seq.indexOf(ProSectionType.CTA) - 1)
    expect(seq.indexOf(ProSectionType.SUB_DIV)).toBeLessThan(seq.indexOf(ProSectionType.SPEC_TABLE))
  })

  it('R1 P02: 구성·사이즈·디자인 값이 모두 그려진 글에 있어도 상품 정보 표는 든다(오너 지시 11-01)', async () => {
    const { doc } = await render(p02)
    expect(tables(doc.sections)).toHaveLength(1)
    expect(texts(tables(doc.sections)[0])[0]).toBe('제품 스펙')
    expect(missingRows(purchaseRows(p02.spec_sheet), shownTextsOf(doc.sections))).toEqual([])
  })

  it('R1 P03에 스펙 표가 있으면 옵션이 그 표의 색상/수량 행으로 들어간다 — 제목은 "제품 스펙" 그대로, 표는 하나, 소재 앞', async () => {
    const order = [...p03.section_plan.section_order.slice(0, -1), 'spec_table', 'cta']
    const f = {
      ...p03,
      spec_sheet: { ...p03.spec_sheet, material: '실리콘' },
      section_plan: { ...p03.section_plan, section_order: order, activated_sections: order },
    } as typeof p03
    const { doc } = await render(f)
    const [table] = tables(doc.sections)
    expect(tables(doc.sections)).toHaveLength(1)
    const t = texts(table)
    expect(t[0]).toBe('제품 스펙')
    expect(t.indexOf('1개 세이지 그린')).toBeLessThan(t.indexOf('실리콘'))
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('Track S(기존 스펙 표 행): 옵션명이 그려진 글에 없으면 기존 표에 옵션 행을 더하고 모바일 M1~M7 0', async () => {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-s'))
    job.spec_sheet = { ...job.spec_sheet, colorOptions: ['라벤더 퍼플', '민트 그린'] }
    const doc = await buildEditorDocument(job.id, {
      ...assembleEditorDataResponse(job, null),
      is_new: true,
      sections_data: [],
    })
    const found = tables(doc.sections)
    expect(found).toHaveLength(1)
    expect(texts(found[0])).toEqual(expect.arrayContaining(['라벤더 퍼플, 민트 그린']))
    expect(texts(found[0])[0]).not.toBe(PURCHASE_CHECK_TITLE)
    expect(checkMobileReadability(doc).violations).toEqual([])
  })
})
