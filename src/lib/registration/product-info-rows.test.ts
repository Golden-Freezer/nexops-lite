import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from './__fixtures__/pdp-products'
import { AGE_LABEL, AGE_VALUE, isAgeExempt, isListedInfoLabel, missingRequiredInfo, productInfoRows, REQUIRED_INFO_LABELS, specWithDetectedExempt } from './product-info-rows'
import { buildAvailableSections } from './pdp-composer-sections'
import { specSheetPromptJson } from './pdp-state'
import { legacySpecRows } from './editor/utils/sectionConverter/convert'
import { specRowsFromInput } from './editor/utils/sectionConverter/dedupe'
import { infoRows } from './internalized/designcut-long'
import { fillInputSlots, lineInputsOf } from './templatelib/input-values'
import { SPEC_ROWS_INPUT, SPEC_SPECIAL_INPUT } from './templatelib/template-types'

const FULL = {
  productName: '구디백',
  brandName: '페어넥스',
  colorOptions: ['데이지', '체리'],
  size: '20x25cm',
  material: 'PE',
  origin: '중국',
}
const labels = (rows: Array<{ label: string }>) => rows.map((r) => r.label)
const valueOf = (rows: Array<{ label: string; value: string }>, label: string) => rows.find((r) => r.label === label)?.value

describe('productInfoRows — 필수 행', () => {
  it('오너가 정한 순서 그대로다', () => {
    expect(labels(productInfoRows(FULL))).toEqual([...REQUIRED_INFO_LABELS])
    expect(labels(productInfoRows(FULL))).toEqual(['상품명', '브랜드', '색상/수량', '사이즈', '소재', '원산지', '사용연령'])
  })

  it('값이 비면 지어내지 않고 그 행만 뺀다', () => {
    const rows = productInfoRows({ productName: '구디백', material: ' ', size: '20cm' })
    expect(labels(rows)).toEqual(['상품명', '사이즈', '사용연령'])
  })

  it('입력 값이 하나도 없으면 사용연령만 있는 표를 만들지 않는다', () => {
    expect(productInfoRows({})).toEqual([])
    expect(productInfoRows(undefined)).toEqual([])
  })

  it('무게·등록 속성은 자동으로 늘어놓지 않는다', () => {
    const rows = productInfoRows({ ...FULL, weight: '120g', extraSpecs: [{ key: '무늬', value: '데이지' }, { key: '프레임 소재', value: 'ABS' }, { key: '높이 조절', value: '4단' }] })
    expect(labels(rows)).toEqual([...REQUIRED_INFO_LABELS])
  })
})

describe('productInfoRows — 사용연령', () => {
  it('값은 무조건 만 14세 이상 — minAgeYears를 읽지 않는다', () => {
    for (const minAgeYears of [undefined, 3, 8, 14, 19]) {
      expect(valueOf(productInfoRows({ ...FULL, minAgeYears }), '사용연령')).toBe(AGE_VALUE)
    }
    expect(AGE_VALUE).toBe('만 14세 이상')
  })

  it('입력을 바꾸지 않는다 — minAgeYears가 생기지 않는다(연령 게이트·색이 바뀌지 않게)', () => {
    const spec = { ...FULL }
    productInfoRows(spec)
    expect(spec).toEqual(FULL)
    expect(spec).not.toHaveProperty('minAgeYears')
  })

  it('사람이 쓰지 않는 카테고리만 뺀다 — 반려동물. 식물·원예는 사람이 쓰므로 유지한다(오너 11-01)', () => {
    expect(labels(productInfoRows({ ...FULL, category: 'pet' }))).not.toContain(AGE_LABEL)
    expect(labels(productInfoRows({ ...FULL, category: 'household', categoryDetail: 'garden' }))).toContain(AGE_LABEL)
    expect(labels(productInfoRows({ ...FULL, category: 'garden' }))).toContain(AGE_LABEL)
    expect(labels(productInfoRows({ ...FULL, category: 'stationery' }))).toContain(AGE_LABEL)
  })

  it('상품명 낱말로 판정하지 않는다 — 어린이집·아이 표현도, 카테고리 없는 강아지 상품명도 표기한다', () => {
    for (const productName of ['어린이집 생일 답례 스티커', '아이 간식 구디백', '강아지 고양이 식기', '식물 고정 클립']) {
      expect(isAgeExempt({ ...FULL, productName }), productName).toBe(false)
      expect(valueOf(productInfoRows({ ...FULL, productName }), AGE_LABEL), productName).toBe(AGE_VALUE)
    }
  })

  it('카테고리가 비어 있으면 표기한다 — 프로토타입 이름 같은 값에 걸리지 않는다', () => {
    expect(isAgeExempt({})).toBe(false)
    expect(isAgeExempt({ category: ' ' })).toBe(false)
    expect(isAgeExempt({ category: 'constructor' })).toBe(false)
  })

  describe('식품(오너 2026-11-02 — 식품 표에 사용연령 제외)·자동 감지한 반려동물(오너 2026-11-01)', () => {
    const OTHER_ROWS = labels(productInfoRows(FULL)).filter((l) => l !== AGE_LABEL)

    it('식품은 사용연령 행만 빠지고 다른 행은 그대로다 — 직접 입력한 식품도 같다', () => {
      for (const category of ['food', ' food ', '식품']) {
        expect(labels(productInfoRows({ ...FULL, category })), category).toEqual(OTHER_ROWS)
      }
      expect(isAgeExempt({ category: 'food' })).toBe(true)
    })

    it('다른 카테고리는 전처럼 표기한다 — 식물·원예 세부 칸은 오너 11-01 답대로 유지', () => {
      for (const category of ['fashion', 'digital', 'beauty', 'stationery', 'packaging', 'household', 'garden', '건강식품', '']) {
        expect(valueOf(productInfoRows({ ...FULL, category }), AGE_LABEL), category).toBe(AGE_VALUE)
      }
      expect(valueOf(productInfoRows({ ...FULL, category: 'household', categoryDetail: 'garden' }), AGE_LABEL)).toBe(AGE_VALUE)
    })

    it('상품명·세부 칸의 낱말로는 판정하지 않는다 — 카테고리가 식품일 때만', () => {
      expect(valueOf(productInfoRows({ ...FULL, productName: '식품 보관 용기', category: 'household' }), AGE_LABEL)).toBe(AGE_VALUE)
      expect(valueOf(productInfoRows({ ...FULL, categoryDetail: '소스' }), AGE_LABEL)).toBe(AGE_VALUE)
    })

    it('연령 게이트 값은 건드리지 않는다 — minAgeYears가 있어도 행만 빠지고 입력은 그대로다', () => {
      const spec = { ...FULL, category: 'food', minAgeYears: 19 }
      expect(labels(productInfoRows(spec))).toEqual(OTHER_ROWS)
      expect(spec.minAgeYears).toBe(19)
    })

    it('R·D·K 표 경로가 모두 같은 판정을 쓴다 — 자동 감지한 식품·반려동물도 표가 같다', () => {
      const food = { ...FULL, category: 'food' }
      const detected = { ...FULL, detectedCategory: 'food' }
      const pet = { ...FULL, category: 'pet' }
      const detectedPet = { ...FULL, detectedCategory: 'pet' }
      const household = { ...FULL, category: 'household' }
      const paths: Array<[string, (spec: object) => Array<{ label?: string }>]> = [
        ['R 편집기 표', (s) => legacySpecRows(s as never)],
        ['R 중복 정리 표', (s) => specRowsFromInput(s as never)],
        ['R 조립 표', (s) => (buildAvailableSections('premium', {}, {}, s as never).spec_table as unknown as { spec_rows: Array<{ label: string }> }).spec_rows],
        ['D 표', (s) => infoRows(s as never)],
        [
          'K 표',
          (s) => {
            const cell = (input: string, maxChars: number) => ({ type: 'text', required: true, source: 'input', input, facts: 1, maxChars })
            const template = {
              slots: {
                rows: { type: 'list', required: true, source: 'input', input: SPEC_ROWS_INPUT, min: 1, max: 8, fields: { label: cell(`${SPEC_ROWS_INPUT}.label`, 10), value: cell(`${SPEC_ROWS_INPUT}.value`, 40) } },
              },
            }
            const inputs = lineInputsOf({ spec_sheet: s, analysis: {}, copy_sections: {} } as never)
            return (fillInputSlots(template as never, inputs) as { rows: Array<{ label: string }> }).rows
          },
        ],
      ]
      for (const [name, rowsOf] of paths) {
        expect(rowsOf(food).map((r) => r.label), name).not.toContain(AGE_LABEL)
        expect(rowsOf(detected), name).toEqual(rowsOf(food))
        expect(rowsOf(pet).map((r) => r.label), name).not.toContain(AGE_LABEL)
        expect(rowsOf(detectedPet), name).toEqual(rowsOf(pet))
        expect(rowsOf(household).map((r) => r.label), name).toContain(AGE_LABEL)
      }
    })

    it('자동 감지한 반려동물·식품만 표시를 남긴다 — 사람이 고른 값과 다른 카테고리는 그대로', () => {
      const spec = { productName: '소스' }
      for (const detected of ['food', 'pet']) {
        expect(specWithDetectedExempt(spec, detected), detected).toEqual({ productName: '소스', detectedCategory: detected })
        expect(specWithDetectedExempt({ ...spec, category: ' ' }, detected), detected).toEqual({ productName: '소스', category: ' ', detectedCategory: detected })
        expect(specWithDetectedExempt({ ...spec, category: 'household' }, detected), detected).toBeNull()
        expect(specWithDetectedExempt({ ...spec, category: detected }, detected), detected).toBeNull()
      }
      expect(spec).toEqual({ productName: '소스' })
      for (const detected of ['fashion', 'digital', 'beauty', 'stationery', 'packaging', 'household', 'garden', '식품', undefined, 1]) {
        expect(specWithDetectedExempt(spec, detected), String(detected)).toBeNull()
      }
    })

    it('감지 값은 사람이 고른 카테고리가 없을 때만 본다 — 세부 칸이 한글인 입력도 행이 빠지고 세부 칸은 그대로다', () => {
      for (const detectedCategory of ['food', 'pet']) {
        expect(labels(productInfoRows({ ...FULL, detectedCategory })), detectedCategory).toEqual(OTHER_ROWS)
        expect(valueOf(productInfoRows({ ...FULL, category: 'household', detectedCategory }), AGE_LABEL), detectedCategory).toBe(AGE_VALUE)
      }
      const marked = specWithDetectedExempt({ ...FULL, categoryDetail: '건강식품' }, 'food')!
      expect(marked.categoryDetail).toBe('건강식품')
      expect(labels(productInfoRows(marked))).toEqual(OTHER_ROWS)
    })

    it('감지 표시는 category와 프롬프트에 들어가지 않는다 — 감지 콜과 프롬프트가 그대로다', () => {
      const spec = { productName: '소스' }
      for (const detected of ['food', 'pet']) {
        const marked = specWithDetectedExempt(spec, detected)!
        expect(marked, detected).not.toHaveProperty('category')
        expect(specSheetPromptJson(marked), detected).toBe(specSheetPromptJson(spec))
      }
    })
  })

  it('실제 11상품 — P06·P07은 행이 빠지고 나머지는 표기한다(P08은 오너 11-01로 유지)', () => {
    const exempt = ['P06', 'P07']
    const shown = ['P01', 'P02', 'P03', 'P04', 'P05', 'P08', 'P09', 'P10', 'P11']
    for (const id of exempt) expect(labels(productInfoRows(getPdpTestProduct(id).specSheet)), id).not.toContain(AGE_LABEL)
    for (const id of shown) expect(valueOf(productInfoRows(getPdpTestProduct(id).specSheet), AGE_LABEL), id).toBe(AGE_VALUE)
  })

  it('실제 11상품 — 판정 8종 카테고리와 minAgeYears는 그대로다(P08은 household 유지, 세부 칸만)', () => {
    const p08 = getPdpTestProduct('P08')
    expect(p08.specSheet.category).toBe('household')
    expect(p08.specSheet.categoryDetail).toBe('garden')
    expect(p08.evidencePath).toBe('v2')
    for (const id of ['P01', 'P02', 'P06', 'P07', 'P08', 'P11']) expect(getPdpTestProduct(id).specSheet.minAgeYears, id).toBeUndefined()
  })
})

describe('productInfoRows — 색상/수량·사이즈', () => {
  const axes = (extra: object) => ({
    source: 'manual',
    axes: [
      { kind: 'design', name: '디자인', values: ['데이지', '체리'] },
      { kind: 'quantity', name: '수량', values: ['20매', '50매'] },
    ],
    variants: [{ label: 'a', values: { design: '데이지', quantity: '20매' } }],
    ...extra,
  })

  it('옵션 구조의 디자인·색상과 수량을 한 행으로 합친다', () => {
    const rows = productInfoRows({ productName: 'a', optionSpec: axes({}) })
    expect(valueOf(rows, '색상/수량')).toBe('데이지, 체리 / 20매, 50매')
    expect(labels(rows)).not.toContain('구성')
    expect(labels(rows)).not.toContain('디자인')
  })

  it('옵션이 많으면 n가지로 줄인다', () => {
    const many = Array.from({ length: 9 }, (_, i) => `색${i}`)
    expect(valueOf(productInfoRows({ productName: 'a', colorOptions: many }), '색상/수량')).toBe('9가지')
  })

  it('옵션 구조가 없으면 색상 옵션, 그것도 없으면 색상 입력(예전 잡)', () => {
    expect(valueOf(productInfoRows({ productName: 'a', colorOptions: ['흰색'] }), '색상/수량')).toBe('흰색')
    expect(valueOf(productInfoRows({ name: 'a', color: '검정' }), '색상/수량')).toBe('검정')
    expect(valueOf(productInfoRows({ name: 'a', color: '검정' }), '상품명')).toBe('a')
  })

  it('사이즈는 입력 우선, 없으면 옵션 사이즈 축', () => {
    const option = { source: 'manual', axes: [{ kind: 'size', name: '크기', values: ['S', 'M'] }], variants: [{ label: 's', values: { size: 'S' } }] }
    expect(valueOf(productInfoRows({ productName: 'a', optionSpec: option }), '사이즈')).toBe('S, M')
    expect(valueOf(productInfoRows({ productName: 'a', size: '20cm', optionSpec: option }), '사이즈')).toBe('20cm')
  })
})

describe('productInfoRows — 특별한 내용', () => {
  it('허용 목록의 추가 스펙만 필수 행 뒤에 붙는다(사용연령 다음, 입력 순서)', () => {
    const rows = productInfoRows({
      ...FULL,
      extraSpecs: [
        { key: '구성품', value: '본체 1, 끈 2' },
        { key: '무늬', value: '데이지' },
        { key: '용량', value: '500ml' },
        { key: '소비 전력', value: '10W' },
        { key: '세탁 방법', value: '손세탁' },
      ],
    })
    expect(labels(rows)).toEqual([...REQUIRED_INFO_LABELS, '구성품', '용량', '소비 전력', '세탁 방법'])
  })

  it('자유 필드(extra)도 같은 목록으로 거른다 — 내부 값은 맞지 않는다', () => {
    const rows = productInfoRows({ ...FULL, extra: { hookMode: 'x', strategyHints: 'y', 호환: '아이폰', 색감: '파스텔' } })
    expect(valueOf(rows, '호환')).toBe('아이폰')
    expect(labels(rows)).not.toContain('hookMode')
    expect(labels(rows)).not.toContain('색감')
  })

  it('빼는 카테고리면 사용연령 없이 특별한 내용이 바로 온다', () => {
    const rows = productInfoRows({ ...FULL, category: 'pet', extraSpecs: [{ key: '용량', value: '300ml' }] })
    expect(labels(rows).slice(-2)).toEqual(['원산지', '용량'])
  })
})

describe('productInfoRows — 규제 표현', () => {
  it('규제 표현이 든 행은 뺀다, 사용연령은 남는다', () => {
    const rows = productInfoRows({ ...FULL, extraSpecs: [{ key: '구성', value: 'KC 인증 완료' }] })
    expect(labels(rows)).not.toContain('구성')
    expect(labels(rows)).toContain('사용연령')
  })
})

describe('missingRequiredInfo — H0 필수 행 빈 칸', () => {
  it('값이 없는 필수 칸을 순서대로 낸다, 사용연령은 고정이라 빈 칸이 아니다', () => {
    expect(missingRequiredInfo(FULL)).toEqual([])
    expect(missingRequiredInfo({ productName: 'a' })).toEqual(['브랜드', '색상/수량', '사이즈', '소재', '원산지'])
    expect(missingRequiredInfo({})).not.toContain('사용연령')
  })
})

describe('식품·화장품 표 낱말(적용 T1-81)', () => {
  const extra = (...rows: Array<[string, string]>) => ({ productName: '시험 상품', extraSpecs: rows.map(([key, value]) => ({ key, value })) })
  const labels = (spec: object) => productInfoRows(spec).map((row) => row.label)

  it('내용량·사용기한이 값이 있을 때만 표에 든다', () => {
    expect(labels(extra(['내용량', '500g'], ['사용기한', '제조일로부터 24개월']))).toEqual(expect.arrayContaining(['내용량', '사용기한']))
    expect(labels(extra(['내용량', ''], ['사용기한', ' ']))).not.toEqual(expect.arrayContaining(['내용량']))
    expect(labels(extra(['내용량', ''], ['사용기한', ' ']))).not.toContain('사용기한')
  })

  it('이미 있던 낱말은 그대로 통과한다', () => {
    for (const label of ['용량', '소비기한', '유통기한', '보관방법']) expect(labels(extra([label, '값']))).toContain(label)
  })

  it('법정표시 값은 표에 싣지 않는다 — 쿠팡 고시 칸에 맡긴다(오너 답)', () => {
    const rows = labels(extra(['식품유형', '과자'], ['원재료명', '밀가루'], ['영양정보', '100kcal'], ['전성분', '정제수'], ['품목보고번호', '123']))
    for (const label of ['식품유형', '원재료명', '영양정보', '전성분', '품목보고번호']) expect(rows).not.toContain(label)
  })

  it('K 표의 특별 행은 낱말이 늘어도 3행까지다 — 칸 상한을 올리지 않는다', () => {
    const cell = (input: string) => ({ type: 'text', required: true, source: 'input', input, facts: 1, maxChars: 40 })
    const template = { slots: { special: { type: 'list', required: false, source: 'input', input: SPEC_SPECIAL_INPUT, min: 1, max: 3, fields: { label: cell(`${SPEC_SPECIAL_INPUT}.label`), value: cell(`${SPEC_SPECIAL_INPUT}.value`) } } } }
    const spec = extra(['내용량', '500g'], ['소비기한', '12개월'], ['보관방법', '냉장'], ['구성', '2개입'])
    const inputs = lineInputsOf({ spec_sheet: spec, analysis: {}, copy_sections: {} } as never)
    const rows = (fillInputSlots(template as never, inputs) as { special: Array<{ label: string }> }).special
    expect(rows.map((row) => row.label)).toEqual(['내용량', '소비기한', '보관방법'])
  })

  it('채점의 표 행 검사도 같은 낱말을 허용한다', () => {
    expect(isListedInfoLabel('내용량')).toBe(true)
    expect(isListedInfoLabel('사용기한')).toBe(true)
    expect(isListedInfoLabel('식품유형')).toBe(false)
  })
})
