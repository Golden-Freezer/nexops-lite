/**
 * 입력 칸 C5(오너 11-03 22:47 승인 ②, 통합 11-04 01:14·03:3x 결정) — 비교 근거·출처·주기 칸의 정리 규칙, 읽기 거르기(규제 표현·깎아내리기·타사 표식·효과 시간표),
 * 견본 ↔ 옵션 짝, 화면 글 ↔ 값, 저장·프롬프트(값이 있어도 프롬프트 스펙 JSON 그대로). 그리는 부품은 없다(다음 PR). LLM·DB 없음
 */
import { describe, expect, it } from 'vitest'
import { INPUT_SLOT_SAMPLE } from './__fixtures__/input-slots.sample'
import { getPdpTestProduct, PDP_TEST_PRODUCT_IDS } from './__fixtures__/pdp-products'
import {
  cleanCompareBasis,
  cleanCompareSource,
  cleanSchedule,
  formatCompareLines,
  formatScheduleLines,
  INPUT_SLOT_KEYS,
  INPUT_SLOT_LIMITS,
  normalizeInputSlots,
  parseCompareLines,
  parseScheduleLines,
  type ColorSwatch,
} from './input-slots'
import { inputSlotsOf, pairedSwatches } from './input-slots-read'
import { specSheetPromptJson, type PdpSpecSheet } from './pdp-state'

const base = (patch: Partial<PdpSpecSheet> = {}): PdpSpecSheet => ({ productName: '시험 상품', ...patch })
const row = (label: string, ours: string, other?: string) => ({ label, ours, ...(other !== undefined ? { other } : {}) })

describe('정리 규칙', () => {
  it('비교 근거는 항목·우리 값이 있는 행만, 같은 항목은 한 번, 1~5행 — 상한을 넘는 글은 자르지 않고 버린다', () => {
    expect(INPUT_SLOT_LIMITS.compare).toMatchObject({ min: 1, max: 5, label: 12, value: 24, source: 40 })
    expect(cleanCompareBasis([row('소재', '실리콘', '플라스틱'), row('소재', '중복'), row('', '값'), row('무게', '')])).toEqual([row('소재', '실리콘', '플라스틱')])
    expect(cleanCompareBasis([row('무게', '120g', '')])).toEqual([row('무게', '120g')])
    expect(cleanCompareBasis(Array.from({ length: 7 }, (_, i) => row(`항목${i}`, '값')))).toHaveLength(5)
    expect(cleanCompareBasis([row('가'.repeat(13), '값')])).toEqual([])
    expect(cleanCompareBasis([row('소재', '가'.repeat(25))])).toEqual([])
    expect(cleanCompareSource('가'.repeat(40))).toBe('가'.repeat(40))
    expect([cleanCompareSource('가'.repeat(41)), cleanCompareSource('  '), cleanCompareSource(3)]).toEqual([null, null, null])
  })

  it('주기는 이름·기간이 다 있는 줄만, 2~6줄 — 하나뿐이면 없다', () => {
    expect(INPUT_SLOT_LIMITS.schedule).toMatchObject({ min: 2, max: 6, label: 16, period: 20 })
    expect(cleanSchedule([{ label: '사용', period: '1일 1회' }])).toEqual([])
    expect(cleanSchedule([{ label: '사용', period: '1일 1회' }, { label: '교체', period: '' }, { label: '세척', period: '주 1회' }])).toHaveLength(2)
    expect(cleanSchedule(Array.from({ length: 8 }, (_, i) => ({ label: `줄${i}`, period: '주 1회' })))).toHaveLength(6)
  })

  it('형식이 틀린 저장 값에도 던지지 않는다', () => {
    for (const bad of [null, 'x', 3, [null, 'a', 3], { 0: row('a', 'b') }]) {
      expect(cleanCompareBasis(bad)).toEqual([])
      expect(cleanSchedule(bad)).toEqual([])
    }
  })
})

describe('읽기 — 깎아내리기 금지·타사 표식·규제 표현·효과 시간표', () => {
  it('기존 칸에 깎아내리는 말이 있으면 그 행만 뺀다(비교 상대는 기존 제품, 중립)', () => {
    const slots = inputSlotsOf(base({ compareBasis: [row('손잡이', '실리콘', '불편한 플라스틱'), row('무게', '120g', '200g'), row('세척', '분리 세척', '쉽게 망가짐')] }))
    expect(slots.compareBasis).toEqual([row('무게', '120g', '200g')])
  })

  it('타사 표식(타사·경쟁사·A사·○○사·®·™)이 든 행은 뺀다 — USB·LED·PP 같은 영문 대문자 값은 남긴다', () => {
    const rows = [row('소재', 'PP', 'A사 제품'), row('충전', 'USB-C', '타사 5핀'), row('조명', 'LED', '○○사 형광등'), row('상표', 'Nexa®', '일반'), row('전원', 'LED 램프', 'USB 사용')]
    expect(inputSlotsOf(base({ compareBasis: rows })).compareBasis).toEqual([row('전원', 'LED 램프', 'USB 사용')])
    expect(inputSlotsOf(base({ compareBasis: [row('충전', 'USB-C', '마이크로 5핀')], compareSource: '경쟁사 비교 자료' })).compareSource).toBeNull()
    expect(inputSlotsOf(base({ compareBasis: [row('충전', 'USB-C')], compareSource: '자사 측정' })).compareSource).toBe('자사 측정')
  })

  it('규제 표현이 든 행·출처·주기는 표와 같은 규칙(isFactClaimSafe)으로 뺀다', () => {
    const slots = inputSlotsOf(
      base({
        compareBasis: [row('세균', '항균 99.9%', '일반'), row('무게', '120g', '200g')],
        compareSource: '건강기능식품 인증',
        schedule: [{ label: '교체', period: '3개월마다' }, { label: '사용', period: '1일 1회' }],
      })
    )
    expect(slots.compareBasis).toEqual([row('무게', '120g', '200g')])
    expect(slots.compareSource).toBeNull()
    expect(slots.schedule).toHaveLength(2)
  })

  it('주기에서 효과 시간표(기간 → 몸·피부 변화) 줄을 빼고, 남은 게 2개 미만이면 없다', () => {
    const effect = [{ label: '2주 후', period: '피부 개선' }, { label: '4주 뒤', period: '탈모 감소' }]
    expect(inputSlotsOf(base({ schedule: [...effect, { label: '교체', period: '3개월마다' }] })).schedule).toEqual([])
    expect(inputSlotsOf(base({ schedule: [effect[0], { label: '교체', period: '3개월마다' }, { label: '배송', period: '주문 후 2일' }] })).schedule).toEqual([
      { label: '교체', period: '3개월마다' },
      { label: '배송', period: '주문 후 2일' },
    ])
  })

  it('입력이 없으면 빈 값 — 시험 상품 11개에 새 칸 값이 없다', () => {
    expect(inputSlotsOf(base())).toMatchObject({ compareBasis: [], compareSource: null, schedule: [] })
    for (const id of PDP_TEST_PRODUCT_IDS) {
      const { specSheet } = getPdpTestProduct(id)
      expect(['compareBasis', 'compareSource', 'schedule'].filter((key) => key in specSheet), id).toEqual([])
    }
  })
})

describe('견본 ↔ 옵션 짝(pairedSwatches)', () => {
  const sw = (name: string, hex: string): ColorSwatch => ({ name, hex })
  const swatches = [sw('화이트', '#FFFFFF'), sw('네이비', '#1F2A44'), sw('레드', '#C0392B')]
  it('옵션 순서대로 이름이 맞는 견본만 — 공백·대소문자 무시, 옵션 이름에 견본 이름이 들면 맞음', () => {
    expect(pairedSwatches(swatches, ['데이지 네이비', '데이지화이트', '그린'])).toEqual([
      { ...swatches[1], option: '데이지 네이비' },
      { ...swatches[0], option: '데이지화이트' },
    ])
    expect(pairedSwatches([sw('Ivory', '#FFFFF0'), sw('Black', '#000000')], ['ivory', 'BLACK'])).toHaveLength(2)
  })
  it('짝이 2개 미만이면 빈 목록, 견본 하나는 한 옵션에만, 옵션 이름이 없으면 견본 그대로', () => {
    expect(pairedSwatches(swatches, ['화이트', '그린'])).toEqual([])
    expect(pairedSwatches([sw('화이트', '#FFFFFF'), sw('블랙', '#000000')], ['화이트 S', '화이트 M', '블랙'])).toEqual([
      { name: '화이트', hex: '#FFFFFF', option: '화이트 S' },
      { name: '블랙', hex: '#000000', option: '블랙' },
    ])
    expect(pairedSwatches(swatches, [])).toEqual(swatches)
    expect(pairedSwatches(swatches.slice(0, 1), [])).toEqual([])
  })
})

describe('화면 글 ↔ 값', () => {
  it.each([
    ['비교', parseCompareLines, formatCompareLines, '소재: 실리콘 | 플라스틱\n무게: 120g'],
    ['주기', parseScheduleLines, formatScheduleLines, '사용: 1일 1회\n교체: 3개월마다'],
  ] as Array<[string, (raw: string) => unknown, (value: never) => string, string]>)('%s 줄이 그대로 돌아온다', (_name, parse, format, raw) => {
    expect(format(parse(raw) as never)).toBe(raw)
  })
  it('앞말 없는 줄은 버린다', () => {
    expect(parseCompareLines('그냥 쓴 글')).toEqual([])
    expect(parseScheduleLines('사용 1일 1회\n교체 3개월')).toEqual([])
  })
})

describe('저장·프롬프트', () => {
  it('새 칸은 입력 칸 목록에 들고, 정리 결과가 비면 키를 지운다', () => {
    expect(INPUT_SLOT_KEYS).toEqual(expect.arrayContaining(['compareBasis', 'compareSource', 'schedule']))
    const out = normalizeInputSlots(base({ compareBasis: [row('', 'x')], compareSource: ' ', schedule: [{ label: '하나', period: '1회' }] }))
    for (const key of ['compareBasis', 'compareSource', 'schedule']) expect(out).not.toHaveProperty(key)
    expect(normalizeInputSlots(base({ ...INPUT_SLOT_SAMPLE })).compareBasis).toEqual(INPUT_SLOT_SAMPLE.compareBasis)
  })
  it('값이 있어도 프롬프트 스펙 JSON은 그대로다', () => {
    const spec = base({ material: '면' })
    expect(specSheetPromptJson({ ...spec, compareBasis: INPUT_SLOT_SAMPLE.compareBasis, compareSource: '자사 측정', schedule: INPUT_SLOT_SAMPLE.schedule })).toBe(specSheetPromptJson(spec))
  })
})
