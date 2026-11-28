/**
 * K 상품 정보 표(K2) — 오너 11-02 11:45 'K는 상품 정보 섹션이 너무 길다', 통합 결정(권장 조합):
 * 왼쪽 정렬 칸은 좌우 표, 가운데 정렬·카드 칸은 쌓기 조임, 치수 칸은 사진·도식 나란히. 줄 간격 1.7·이름 36은 그대로다.
 * K10(오너 11-02 17:39 '스펙 표는 폰트 사이즈를 줄여 가능하면 1줄, 2줄이 되더라도 칸 높이는 가능한 동일하게'): 값은 TABLE 45, 행 높이 맞춤(even).
 */
import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { checkMobileReadability, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { approxTextWidth, keepFactUnits } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { K_SPACE, K_TYPE, renderTemplate } from './engine'
import { ctxOf } from './engine.fixture'
import { templateById, templatesOf } from './library'
import { lintTemplate } from './lint'
import { sampleSlots } from './sample'
import type { SlotValues, Template } from './template-types'

const cell = (id: string) => templateById(id) as Template
const ROWS = [
  { label: '상품명', value: '페어넥스 강아지 밥그릇 고양이 식기 2구' },
  { label: '브랜드', value: '페어넥스' },
  { label: '색상/수량', value: '1개 세이지 그린' },
  { label: '사이즈', value: '34cm x 19.5cm x 12.5cm' },
  { label: '소재', value: '도자기(그릇)' },
  { label: '원산지', value: '중국' },
  { label: '사용연령', value: '만 14세 이상' },
]
const values = (over: SlotValues = {}): SlotValues => ({ rows: ROWS, ...over }) as unknown as SlotValues
const render = (id: string, slots: SlotValues) => renderTemplate(cell(id), slots, ctxOf())!
const asSection = (result: ReturnType<typeof render>): CanvasSection =>
  ({
    id: 's',
    sectionType: 'spec_table',
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_k_spec',
    canvas: { width: 860, height: result.height, backgroundColor: result.background },
    elements: result.elements,
  }) as unknown as CanvasSection
const byName = (els: CanvasElement[], name: string) => els.filter((e) => e.name === name).sort((a, b) => a.transform.y - b.transform.y)
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const middle = (e: CanvasElement) => e.transform.y + e.transform.height / 2
/** 글 상자가 구분선을 가로지르지 않고, 글끼리 겹치지 않는다 */
function assertNoCross(els: CanvasElement[]) {
  const texts = els.filter((e) => e.type === 'text')
  for (const rule of byName(els, 'designcut-rule')) {
    for (const t of texts) expect(t.transform.y < rule.transform.y && bottom(t) > rule.transform.y, `${t.textProps?.content} · 선 ${rule.transform.y}`).toBe(false)
  }
  texts.forEach((a, i) =>
    texts.slice(i + 1).forEach((b) => {
      const x = Math.min(a.transform.x + a.transform.width, b.transform.x + b.transform.width) - Math.max(a.transform.x, b.transform.x)
      const y = Math.min(bottom(a), bottom(b)) - Math.max(a.transform.y, b.transform.y)
      expect(x > 0 && y > 0, `${a.textProps?.content} · ${b.textProps?.content}`).toBe(false)
    })
  )
}

describe('좌우 표(왼쪽 정렬 칸)', () => {
  it('이름은 값 옆 장식 이름표로 그리고 행 가운데에 둔다 — 한 표의 이름은 한 묶음이다(K10)', () => {
    const out = render('spec_table.line-rows', values())
    const names = byName(out.elements, TABLE_NAME_ELEMENT)
    const vals = byName(out.elements, 'designcut-value')
    expect(names.map((n) => n.textProps?.content)).toEqual(ROWS.map((r) => r.label))
    names.forEach((name, i) => {
      expect(name.transform.x).toBe(60)
      expect(vals[i].transform.x).toBe(60 + 216 + K_SPACE.columnGap)
      expect(Math.abs(middle(name) - middle(vals[i])), name.textProps?.content).toBeLessThanOrEqual(1)
    })
    expect(new Set(names.map((n) => n.groupId)).size).toBe(1)
    // 값은 표 값 크기 45(오너 11-02 17:39), 줄 간격은 본문 1.7 그대로(오너 10-31)
    expect(vals.every((v) => v.textProps?.fontSize === 45 && v.textProps?.lineHeight === 1.7)).toBe(true)
  })

  it('행 높이 맞춤을 끈 좌우 표는 이름을 값 첫 줄 높이에 맞춰 내린다(K2)', () => {
    const t = cell('spec_table.line-rows')
    const flow = t.flow.map((n) => (n.kind === 'repeat' ? { ...n, even: undefined } : n))
    const out = renderTemplate({ ...t, flow } as Template, values(), ctxOf())!
    const names = byName(out.elements, TABLE_NAME_ELEMENT)
    const vals = byName(out.elements, 'designcut-value')
    const drop = Math.round((K_TYPE.TABLE.size * K_TYPE.TABLE.lineHeight - K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight) / 2)
    names.forEach((name, i) => expect(name.transform.y - vals[i].transform.y).toBe(drop))
  })

  it('모바일 검사에서 2열 본문(M6)·장식 규칙(M5)·장식 밀도(M7) 위반을 만들지 않는다', () => {
    const out = render('spec_table.line-rows', values({ special: [{ label: '입구', value: '조임끈' }] } as SlotValues))
    const rules = checkMobileReadability({ sections: [asSection(out)] }).violations.map((v) => v.rule)
    expect(rules.filter((r) => r === 'M5' || r === 'M6' || r === 'M7')).toEqual([])
  })

  it('6자 넘는 이름은 이름 칸에서 두 줄이 되고, 리플로 뒤에도 구분선·다음 행을 덮지 않는다', () => {
    const special = [{ label: '사용 가능 온도', value: '영하 20도에서 영상 120도까지' }]
    const out = render('spec_table.line-rows', values({ special } as SlotValues))
    const long = byName(out.elements, TABLE_NAME_ELEMENT).find((n) => n.textProps?.content === '사용 가능 온도')!
    expect(long.transform.height).toBeGreaterThanOrEqual(Math.round(K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight * 2))
    assertNoCross(out.elements)
    const section = asSection(out)
    // 편집기 첫 실측 — 추정보다 10px씩 작게 재진다(K1 리플로 평균과 같은 방향)
    for (const el of section.elements) if (el.type === 'text') el.measuredHeight = el.transform.height - 10
    reflowSectionLayout(section)
    assertNoCross(section.elements)
  })

  it('두 줄로 추정한 이름이 실측 한 줄로 줄어도 아래 행을 두 번 끌어올리지 않는다 — 이름·값을 한 상자로 묶는다', () => {
    // 아래에 구분선이 있는 가운데 행이어야 드러난다(묶지 않으면 이름·값 줄어든 몫을 둘 다 아래로 전한다)
    const rows = ROWS.map((row, i) => (i === 2 ? { ...row, label: '사용 가능 온도' } : row))
    const section = asSection(render('spec_table.line-rows', values({ rows } as SlotValues)))
    for (const el of section.elements) {
      if (el.type !== 'text') continue
      el.measuredHeight = el.name === TABLE_NAME_ELEMENT ? Math.round(K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight) : el.transform.height - 10
    }
    reflowSectionLayout(section)
    assertNoCross(section.elements)
  })

  it('편집기에서 이름을 길게 고쳐도(실측 두 줄) 줄 상자가 함께 늘어 아래 행을 덮지 않는다', () => {
    const section = asSection(render('spec_table.line-rows', values()))
    const name = byName(section.elements, TABLE_NAME_ELEMENT)[2]
    name.textProps = { ...name.textProps!, content: '색상 및 구성 수량' }
    name.measuredHeight = Math.round(K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight * 2) + 10
    reflowSectionLayout(section)
    assertNoCross(section.elements)
  })
})

describe('쌓기 조임(가운데 정렬·카드·띠 상자 칸)', () => {
  it('이름 아래 8에 값을 두고, 이름표가 아니라 본문 글로 그린다', () => {
    for (const id of ['spec_table.center-lines', 'spec_table.card-panel', 'spec_table.dark-band', 'spec_table.tint-band-photo']) {
      const out = render(id, values({ photo: 'a' } as SlotValues))
      expect(byName(out.elements, TABLE_NAME_ELEMENT)).toHaveLength(0)
      const labels = byName(out.elements, 'designcut-label')
      const vals = byName(out.elements, 'designcut-value')
      // 통합 결정 값: 이름·값 사이 8(전 16)
      labels.forEach((label, i) => expect(vals[i].transform.y - bottom(label)).toBe(8))
      assertNoCross(out.elements)
    }
  })
})

describe('상자(panel) 안 표 — 1.2배 표본 리플로', () => {
  // render-check 41406647460: 1.2배 표본 이름 '가나다라 마바'가 두 줄로 추정됐다가 한 줄로 재지면, 띠 상자 안 좌우 표는 상자 식구 전체가 끌려 올라가
  // 값끼리 8건 겹쳤다(K2는 두 칸을 쌓기로 돌림). K8에서 리플로가 상자 안 상자를 묶어 상자 안 좌우 표도 겹치지 않는다
  it('표 칸 전부: 1.2배 표본 글에서 이름이 한 줄로 재져도 행끼리 겹치지 않는다', () => {
    const oneLine = Math.round(K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight)
    const cells = templatesOf('spec_table')
    expect(cells.length).toBeGreaterThanOrEqual(23)
    for (const t of cells) {
      const section = asSection(render(t.id, sampleSlots(t, { mode: 'full', factor: 1.2 })))
      for (const el of section.elements) {
        if (el.type === 'text') el.measuredHeight = el.name === TABLE_NAME_ELEMENT ? oneLine : el.transform.height
      }
      reflowSectionLayout(section)
      assertNoCross(section.elements)
    }
  })

  it('띠·카드 상자 안 좌우 표: 이름이 한 줄로 재져도 행끼리 겹치지 않고, 상자가 식구를 감싸고, 아래 요소는 한 번만 옮긴다', () => {
    const open = cell('spec_table.line-rows')
    const oneLine = Math.round(K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight)
    for (const fill of ['T', 'D'] as const) {
      const boxed = { ...open, flow: [{ kind: 'panel', fill, bleed: true, nodes: open.flow }] } as Template
      expect(lintTemplate(boxed).filter((v) => v.detail.includes('상자 안 좌우 표'))).toHaveLength(0)
      const section = asSection(renderTemplate(boxed, sampleSlots(boxed, { mode: 'full', factor: 1.2 }), ctxOf())!)
      const panel = byName(section.elements, 'designcut-panel')[0]
      expect(byName(section.elements, 'designcut-row').length).toBeGreaterThan(0)
      const tail = { ...panel, id: 'tail', name: 'tail', containerOf: undefined, transform: { ...panel.transform, y: bottom(panel) + 40, height: 10 } }
      section.elements.push(tail as CanvasElement)
      const gapToTail = tail.transform.y - bottom(panel)
      for (const el of section.elements) {
        if (el.type === 'text') el.measuredHeight = el.name === TABLE_NAME_ELEMENT ? oneLine : el.transform.height + 20
      }
      reflowSectionLayout(section)
      assertNoCross(section.elements)
      const inside = section.elements.filter((e) => panel.containerOf!.includes(e.id))
      expect(bottom(panel)).toBeGreaterThanOrEqual(Math.max(...inside.map(bottom)))
      expect(tail.transform.y - bottom(panel), fill).toBe(gapToTail)
    }
  })
})

describe('좁은 값 칸의 치수 묶기', () => {
  // render-check 41406647460: line-rows·pair-top의 '16.5cm x 20.7cm(데이지 S)'가 묶인 채 괄호 글까지 한 덩어리(keep-all)가 되어
  // 값 칸 500을 넘어 오른쪽 여백 밖까지 나갔다. #572의 16자 상한만으로는 붙은 글을 모른다
  const NB = '16.5cm\u00A0x\u00A020.7cm'

  it('묶은 덩어리(붙은 글 포함)가 칸보다 넓으면 묶지 않고, 들어가면 묶는다 — 폭을 모르면 전과 같다', () => {
    const fit = { size: K_TYPE.BODY.size, width: 500 }
    expect(keepFactUnits('16.5cm x 20.7cm(데이지 S)', fit)).toBe('16.5cm x 20.7cm(데이지 S)')
    expect(keepFactUnits('16.5cm x 20.7cm(데이지 S)', { ...fit, width: 740 })).toContain(NB)
    expect(keepFactUnits('16.5cm x 20.7cm 데이지 S', fit)).toContain(NB)
    expect(keepFactUnits('16.5cm x 20.7cm(데이지 S)')).toContain(NB)
  })

  it('표 칸 전부: 값 글의 끊을 수 없는 덩어리가 칸 폭을 넘지 않는다', () => {
    const rows = ROWS.map((row) => (row.label === '사이즈' ? { ...row, value: '16.5cm x 20.7cm(데이지 S)' } : row))
    for (const t of templatesOf('spec_table')) {
      const out = render(t.id, { ...sampleSlots(t, { mode: 'full', factor: 1 }), rows } as unknown as SlotValues)
      const vals = byName(out.elements, 'designcut-value')
      expect(vals.some((v) => v.textProps?.content?.startsWith('16.5cm')), t.id).toBe(true)
      for (const v of vals) {
        for (const run of (v.textProps?.content ?? '').split(/[ \n]/)) {
          expect(approxTextWidth(run, v.textProps!.fontSize!), `${t.id} ${run}`).toBeLessThanOrEqual(v.transform.width)
        }
      }
    }
  })
})

describe('rows·special 사이 구분선(K8 N-K1)', () => {
  // 실제 글 표에서 rows 끝(사용연령·원산지)과 special 첫 줄(입구·구성) 사이 선이 빠졌다 — 반복 칸은 자기 항목 사이에만 선을 긋고, 두 목록 사이는 blockGap뿐이었다
  const special = [
    { label: '입구', value: '조임끈' },
    { label: '투명도', value: '반투명' },
  ]
  const texts = (els: CanvasElement[]) => els.filter((e) => e.type === 'text')
  /** 선마다 위 글 끝까지·아래 글 시작까지 간격 */
  const ruleGaps = (els: CanvasElement[]) =>
    byName(els, 'designcut-rule').map((rule) => {
      const above = texts(els).filter((t) => bottom(t) <= rule.transform.y)
      const below = texts(els).filter((t) => t.transform.y >= bottom(rule))
      return {
        above: rule.transform.y - Math.max(...above.map(bottom)),
        below: below.length ? Math.min(...below.map((t) => t.transform.y)) - bottom(rule) : null,
      }
    })

  it('special이 있으면 rows 끝과 special 첫 줄 사이에도 행 사이와 같은 선·간격을 둔다', () => {
    // K10 행 높이 맞춤 뒤: 글은 행 가운데라 선까지 tableGap 이상이고, 행 높이가 같아 선 간격(rows 안·rows→special)이 모두 같다
    for (const id of ['spec_table.line-rows', 'spec_table.center-lines', 'spec_table.dark-band', 'spec_table.tint-band-photo']) {
      const out = render(id, values({ photo: 'a', special } as SlotValues))
      const gaps = ruleGaps(out.elements)
      expect(gaps, id).toHaveLength(ROWS.length + special.length - 1)
      for (const gap of gaps) {
        expect(gap.above, id).toBeGreaterThanOrEqual(K_SPACE.tableGap)
        expect(gap.below!, id).toBeGreaterThanOrEqual(K_SPACE.tableGap)
      }
      const rules = byName(out.elements, 'designcut-rule').map((r) => r.transform.y)
      expect(new Set(rules.slice(1).map((y, i) => y - rules[i])).size, id).toBe(1)
    }
  })

  it('special이 비면 끝에 선이 남지 않는다', () => {
    for (const id of ['spec_table.line-rows', 'spec_table.center-lines', 'spec_table.dark-band']) {
      const gaps = ruleGaps(render(id, values()).elements)
      expect(gaps, id).toHaveLength(ROWS.length - 1)
      expect(gaps.every((g) => g.below !== null), id).toBe(true)
    }
  })

  it('special을 따로 카드에 담는 칸은 잇지 않는다', () => {
    for (const id of ['spec_table.household-rows-special-card', 'spec_table.pet-scene-rows-special-card']) {
      const out = render(id, values({ photo: 'a', special } as SlotValues))
      expect(byName(out.elements, 'designcut-rule'), id).toHaveLength(ROWS.length - 1 + special.length - 1)
    }
  })

  it('린트: 앞에 구분선 있는 반복이 없는 joinRule은 위반이다', () => {
    const t = cell('spec_table.line-rows')
    const flow = t.flow.filter((n) => !(n.kind === 'repeat' && n.slot === 'rows'))
    const hits = (x: Template) => lintTemplate(x).filter((v) => v.rule === 'space' && v.detail.includes('joinRule'))
    expect(hits({ ...t, flow } as Template)).toHaveLength(1)
    expect(hits(t)).toHaveLength(0)
  })
})

describe('치수 칸 사진·치수 글 나란히(적용 K14)', () => {
  const dims = (width: string, height: string) => values({ photo: 'a', width, height } as SlotValues)

  it('사진은 반 칸이고 치수 이름표는 옆 반 칸에 둔다 — 제품 경계를 모르면 치수선이 없다', () => {
    const out = render('spec_table.dimension', dims('가로 34cm', '세로 19.5cm'))
    const [photo] = byName(out.elements, 'designcut-scene')
    const half = Math.floor((740 - K_SPACE.columnGap) / 2)
    expect(photo.transform.width).toBe(half)
    expect(out.elements.filter((e) => e.name.startsWith('annotation-leader-'))).toEqual([])
    const chips = out.elements.filter((e) => e.name.startsWith('annotation-chip-'))
    expect(chips.length).toBe(2)
    for (const chip of chips) {
      expect(chip.transform.x).toBeGreaterThanOrEqual(photo.transform.x + half + K_SPACE.columnGap)
      expect(chip.transform.x + chip.transform.width).toBeLessThanOrEqual(800)
    }
  })

  it('긴 치수 이름표도 칸을 넘거나 사진과 겹치지 않는다', () => {
    const out = render('spec_table.dimension', dims('가로 1234.5cm', '세로 1234.5cm'))
    const [photo] = byName(out.elements, 'designcut-scene')
    for (const chip of out.elements.filter((e) => e.name.startsWith('annotation-chip-'))) {
      expect(chip.transform.x).toBeGreaterThanOrEqual(60)
      expect(chip.transform.x + chip.transform.width).toBeLessThanOrEqual(800)
      const beside = chip.transform.x >= photo.transform.x + photo.transform.width
      expect(beside || chip.transform.y >= bottom(photo)).toBe(true)
    }
  })
})
