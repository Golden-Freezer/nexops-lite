/**
 * 적용 C5 ④ — 사용 방법 칸 주기 줄(R-D3 D): 조건 경계(2~6줄, 이름 한 줄·12자·240, 기간이 480에 장면 BODY_BOLD 두 줄 안), 계획 표지(입력 칸 schedule만 —
 * 효과 시간표·규제 표현 줄 뺀 값, 사용 방법 칸이 없거나 하나라도 안 맞으면 없음), 계약(T5의 형식 맞는 줄만), 조립(장면 모드만 — 단계 아래, 없으면 바이트 같음). LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import { markScheduleRows } from '@/lib/registration/internalized/designcut-structure'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { fitsScheduleRows, SCHEDULE_ROWS_MAX } from './scheduleRows'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const ROWS = [
  { label: '교체', period: '3개월마다' },
  { label: '사용', period: '1일 1회' },
  { label: '배송', period: '주문 후 2일' },
]

type Opts = { rows?: unknown; scene?: boolean }
/** 고정물 계획 — rows면 사용 방법 칸(T5)에 scheduleRows를 단다. 장면 모드(layout 2)면 아트 디렉션을 준다 */
const planOf = ({ rows, scene = true }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  if (scene) {
    plan.layout = 2
    plan.artDirection = ART
  }
  const sections = plan.sections.map((s) => (s.template === 'T5' && rows !== undefined ? { ...s, scheduleRows: rows } : s)) as typeof plan.sections
  return { ...plan, sections }
}
const compose = (opts: Opts = {}) =>
  composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf(opts))) })!, { images: IMAGES, sectionOrder: [] })
const howtoOf = (out: CanvasSection[]) => out.find((s) => s.layoutId === 'designcut_T5')!
const named = (sec: CanvasSection, name: string | RegExp) => sec.elements.filter((e) => (typeof name === 'string' ? e.name === name : name.test(e.name ?? '')))
const bottomOf = (e: { transform: { y: number; height: number } }) => e.transform.y + e.transform.height
/** id(무작위)를 뺀 섹션 — 같은 그리기인지 비교 */
const shapeOf = (sec: CanvasSection) =>
  JSON.stringify({ ...sec, id: '', elements: sec.elements.map((e) => ({ ...e, id: '', groupId: e.groupId ? 'g' : undefined, containerOf: e.containerOf?.length })) }).replace(
    /([a-z]+)_\d+_\d{10,}/g,
    '$1'
  )

describe('주기 줄 조건(fitsScheduleRows) — 경계', () => {
  it('2~6줄만 — 1줄·7줄은 안 그린다', () => {
    expect(fitsScheduleRows(ROWS.slice(0, 1))).toBe(false)
    expect(fitsScheduleRows(ROWS.slice(0, 2))).toBe(true)
    expect(fitsScheduleRows(Array.from({ length: SCHEDULE_ROWS_MAX }, (_, i) => ({ label: `주기${i}`, period: '1일 1회' })))).toBe(true)
    expect(fitsScheduleRows(Array.from({ length: SCHEDULE_ROWS_MAX + 1 }, (_, i) => ({ label: `주기${i}`, period: '1일 1회' })))).toBe(false)
  })

  it('이름은 한 줄·이름 칸 240, 기간은 줄바꿈 없이 두 줄 안 — 하나라도 안 맞으면 전체를 안 그린다', () => {
    expect(fitsScheduleRows([ROWS[0], { label: '가'.repeat(8), period: '1일 1회' }])).toBe(false)
    expect(fitsScheduleRows([ROWS[0], { label: '사용', period: '1일\n1회' }])).toBe(false)
    expect(fitsScheduleRows([ROWS[0], { label: '사용', period: '가'.repeat(20) }])).toBe(false)
    expect(fitsScheduleRows([ROWS[0], { label: '  ', period: '1일 1회' }])).toBe(false)
  })
})

describe('계획 표지(markScheduleRows)', () => {
  const sections = () => [{ template: 'T1' }, { template: 'T5' }, { template: 'T9' }] as Array<{ template: 'T1' | 'T5' | 'T9'; scheduleRows?: unknown }>
  const spec = (schedule?: unknown) => ({ productName: '표본', ...(schedule !== undefined ? { schedule } : {}) }) as unknown as PdpSpecSheet

  it('입력이 없으면 같은 목록을 돌려준다(저장 문서 바이트 같음)', () => {
    const list = sections()
    expect(markScheduleRows(list, spec())).toBe(list)
  })

  it('사용 방법 칸에만 효과 시간표 줄을 뺀 값을 단다', () => {
    const out = markScheduleRows(sections(), spec([{ label: '2주 사용', period: '피부 개선' }, ...ROWS.slice(0, 2)]))
    expect(out.find((s) => s.template === 'T5')?.scheduleRows).toEqual(ROWS.slice(0, 2))
    expect(out.filter((s) => s.scheduleRows !== undefined)).toHaveLength(1)
  })

  it('뺀 뒤 2줄 미만이거나 사용 방법 칸이 없으면 그대로', () => {
    const list = sections()
    expect(markScheduleRows(list, spec([{ label: '4주 뒤', period: '탈모 감소' }, ROWS[0]]))).toBe(list)
    const noHowto = [{ template: 'T1' }, { template: 'T9' }] as Array<{ template: 'T1' | 'T9' }>
    expect(markScheduleRows(noHowto, spec(ROWS))).toBe(noHowto)
  })
})

describe('계약(readDesignCut) — T5의 형식 맞는 줄만', () => {
  const t5Of = (rows: unknown) => readDesignCut({ designcut: JSON.parse(JSON.stringify(planOf({ rows }))) })!.sections.find((s) => s.template === 'T5')!
  it('2줄 이상이고 이름·기간 글이 다 있으면 둔다, 아니면 칸이 없다', () => {
    expect(t5Of(ROWS).scheduleRows).toEqual(ROWS)
    expect(t5Of(ROWS.slice(0, 1)).scheduleRows).toBeUndefined()
    expect(t5Of([ROWS[0], { label: '사용' }]).scheduleRows).toBeUndefined()
    expect(t5Of('교체 3개월').scheduleRows).toBeUndefined()
  })
})

describe('조립 — 사용 방법 칸 단계 아래 주기 줄', () => {
  it('장면 모드면 단계 아래에 줄마다 이름(표 이름 한 묶음)·기간을 그리고 칸이 길어진다', () => {
    const base = howtoOf(compose())
    const sec = howtoOf(compose({ rows: ROWS }))
    const periods = named(sec, /^designcut-schedule-period-\d$/)
    expect(periods.map((e) => e.textProps?.content)).toEqual(ROWS.map((r) => r.period))
    const names = named(sec, TABLE_NAME_ELEMENT).filter((e) => ROWS.some((r) => r.label === e.textProps?.content))
    expect(names).toHaveLength(ROWS.length)
    expect(new Set(names.map((e) => e.groupId)).size).toBe(1)
    const lastStep = Math.max(...named(sec, /^designcut-step-(title|desc)-\d$/).map(bottomOf))
    expect(Math.min(...periods.map((e) => e.transform.y))).toBeGreaterThan(lastStep)
    expect(sec.canvas.height).toBeGreaterThan(base.canvas.height)
  })

  it('줄이 없거나 장면 모드가 아니면 지금 그리기와 같다', () => {
    expect(shapeOf(howtoOf(compose({ rows: undefined })))).toBe(shapeOf(howtoOf(compose())))
    expect(shapeOf(howtoOf(compose({ rows: ROWS, scene: false })))).toBe(shapeOf(howtoOf(compose({ scene: false }))))
  })
})
