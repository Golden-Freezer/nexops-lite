import { describe, expect, it } from 'vitest'
import { loadLayoutPresets } from '@/lib/registration/editor/data/layouts'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import { ANNOTATION_NAME_PREFIX } from '@/lib/registration/editor/utils/mobileReadability'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import { planPersuasionSkeleton } from '../internalized/persuasion-planner'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { measureAnnotations, measureLayouts, measurePage } from './page-measure'
import { renderJobHtml } from './render-capture'
import { buildScorecard, MOBILE_RULE_IDS } from './scorecard'

const FIXTURES: FixtureKey[] = ['A-track-i', 'B-track-i', 'C-track-i', 'A-track-s', 'B-track-s', 'C-track-s']

async function measureFixture(key: FixtureKey, mutate?: (job: PdpJobRow) => void) {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  mutate?.(job)
  const { doc } = await renderJobHtml(job)
  return { job, doc, m: await measurePage(job, doc) }
}

function planFor(job: PdpJobRow) {
  return planPersuasionSkeleton({
    specSheet: job.spec_sheet,
    analysis: job.analysis,
    strategyContract: mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, []),
    research: job.research_result,
    category: job.analysis.detected_category,
    snapshotV2: getCorpusSnapshotV2(job.analysis.detected_category),
    vocab: getDesignVocab()!,
  })
}

/** 설득 기록만 얹는다(섹션 구성은 그대로) — 같은 페이지에 기록 유무만 다르다 */
function attachRecordOnly(job: PdpJobRow) {
  const plan = planFor(job)
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion'] } }
  job.section_plan = { ...job.section_plan, internalized_skeleton: { roles: plan.roles, excluded: plan.excluded, persuasion: plan.persuasion } }
  return plan
}

/** 설득 플래너 골격과 기록을 얹은 개선판 잡(T2 오프라인 재생과 같은 구성). features로 mobile 하한 기록 여부를 정한다 */
function withPersuasionSkeleton(job: PdpJobRow, features: string[] = ['vocab', 'persuasion']) {
  const plan = attachRecordOnly(job)
  job.section_plan = {
    ...job.section_plan,
    activated_sections: plan.activatedSections.map(String),
    section_order: plan.sectionOrder.map(String),
    enrichment: { version: 1, features, vocabHash: 'test' },
  } as PdpJobRow['section_plan']
  return plan
}

function el(partial: Partial<CanvasElement> & Pick<CanvasElement, 'type' | 'name'>): CanvasElement {
  return {
    id: partial.name,
    transform: { x: 0, y: 0, width: 860, height: 600, rotation: 0 },
    zIndex: 1,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    ...partial,
  } as CanvasElement
}

function section(sectionType: string, elements: CanvasElement[], extra: Partial<CanvasSection> = {}): CanvasSection {
  return {
    id: `${sectionType}-${elements.length}`,
    sectionType,
    groupType: 'usp',
    order: 0,
    isVisible: true,
    layoutId: `${sectionType}_layout_01`,
    canvas: { width: 860, height: 800, backgroundColor: '#fff' },
    elements,
    ...extra,
  } as CanvasSection
}

const image = (src: string, name = 'main-image') => el({ type: 'image', name, imageProps: { src } as CanvasElement['imageProps'] })
const mark = (name: string, y: number) => el({ type: 'shape', name: `${ANNOTATION_NAME_PREFIX}${name}`, transform: { x: 100, y, width: 120, height: 40, rotation: 0 } })
const totalViolations = (counts: Partial<Record<string, number>>) => MOBILE_RULE_IDS.reduce((sum, id) => sum + (counts[id] ?? 0), 0)

describe('measurePage — 기준 잡 픽스처 6건(대조군)', () => {
  it.each(FIXTURES)('%s: R1~R8·상위 고민·모바일·장식 대상을 잰다(결정론)', async (key) => {
    const { job, doc, m } = await measureFixture(key)
    expect(m.persuasion.source).toBe('derived')
    expect(m.persuasion.rules.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
    expect(m.objections.length).toBe(Math.min(3, job.analysis.objection_priority?.length ?? 0))
    expect(m.order).not.toContain(S.DIVIDER)
    expect(Object.keys(m.mobile!.counts).sort()).toEqual([...MOBILE_RULE_IDS])
    expect(m.annotations.targetCuts).toBeGreaterThanOrEqual(m.annotations.targets)
    expect(m.annotations.targets).toBeGreaterThan(0)
    expect(m.annotations.decorated).toBe(0)
    expect(m.layouts.guardDropped.length).toBeLessThanOrEqual(m.layouts.assigned)
    expect(await measurePage(job, doc)).toEqual(m)
  })

  // 기준선 고정 — 값이 바뀌면 점수 규칙이나 편집기 렌더가 바뀐 것이다(RUN-LOG 세션 B 절과 같은 값).
  // Track I(기록 없음)만 고정한다. Track S는 T3m이 모바일 하한을 적용하므로(2026-10-27 오너 결정, 02 T3m) 값이 바뀐다 —
  // f07b9a5 기준 Track S 3건은 각 21점(6·8·4·3·0)으로 RUN-LOG에만 남긴다.
  it('세로 길이를 잰다 — 그려진 섹션 전부의 합, 25,000 통과·27,565(780 파일 25,000) 합격점을 점수표에 표시만 한다', async () => {
    const { m, doc } = await measureFixture('A-track-i')
    const sum = doc.sections.filter((s) => s.isVisible && s.canvas.height >= 10).reduce((n, s) => n + s.canvas.height, 0)
    expect(m.pageHeight).toBe(sum)
    const card = (pageHeight: number) => buildScorecard({ product: 'A', round: 'x', jobId: 'j', label: 'l' }, { ...m, pageHeight })
    const short = card(24_999)
    expect(short).toMatchObject({ pageHeight: 24_999, pageHeightVerdict: 'fail', pageHeightShort: true })
    expect(card(25_000)).toMatchObject({ pageHeightVerdict: 'pass', pageHeightShort: false })
    expect(card(27_564)).toMatchObject({ pageHeightVerdict: 'pass', pageHeightShort: false })
    const long = card(27_565)
    expect(long).toMatchObject({ pageHeight: 27_565, pageHeightVerdict: 'mark', pageHeightShort: false })
    expect(long.auto).toEqual(short.auto)
    const old = { ...m }
    delete old.pageHeight
    expect(buildScorecard({ product: 'A', round: 'x', jobId: 'j', label: 'l' }, old)).not.toHaveProperty('pageHeight')
  })

  it('자동 점수 기준선 — Track I 3건(모바일 포함, 심사 없음)', async () => {
    const rows: Record<string, unknown> = {}
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]) {
      const { m } = await measureFixture(key)
      const card = buildScorecard({ product: key, round: 'baseline', jobId: key, label: key }, m)
      // 심사 없이 자동 검사만 잡은 주장은 출처 하나라 감점이 아니라 판정 갈림(split)이다
      rows[key] = { ...card.auto.items, total: card.auto.total, penalties: card.penalties.length, split: card.splitClaims.length }
    }
    expect(rows).toEqual({
      'A-track-i': { persuasion: 4.5, objections: 5.33, mobile: 4, rhythm: 3, annotations: 0, total: 16.83, penalties: 0, split: 0 },
      'B-track-i': { persuasion: 9, objections: 8, mobile: 4, rhythm: 3, annotations: 0, total: 24, penalties: 0, split: 1 },
      'C-track-i': { persuasion: 9, objections: 8, mobile: 4, rhythm: 3, annotations: 0, total: 24, penalties: 0, split: 0 },
    })
  })

  it('B Track I: 근거 없는 친환경 표현을 자동 검사가 규제 표현(인증·인허가)으로 잡는다(T7a 두 심사위원 지적과 같은 표현)', async () => {
    const { m } = await measureFixture('B-track-i')
    expect(m.claims.map((c) => c.kind)).toContain('certification')
    expect(m.claimEvidence).toBe('')
  })

  it('B Track S: 치수 근거 없이 렌더된 spec_table을 R3가 잡는다', async () => {
    const { m } = await measureFixture('B-track-s')
    const r3 = m.persuasion.rules.find((r) => r.id === 'R3')!
    expect(r3.pass).toBe(false)
    expect(r3.detail).toContain(S.SPEC_TABLE)
  })
})

describe('measurePage — 대조군·개선판 같은 잣대', () => {
  it.each(['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[])(
    '%s: 같은 페이지에 설득 기록만 얹으면 설득·고민 점수가 같다',
    async (key) => {
      const control = (await measureFixture(key)).m
      const recorded = (await measureFixture(key, attachRecordOnly)).m
      expect(recorded.persuasion.source).toBe('record')
      expect(recorded.order).toEqual(control.order)
      expect(recorded.objections).toEqual(control.objections)
      expect(recorded.persuasion.rules).toEqual(control.persuasion.rules)
    }
  )

  it('근거가 없어 응답할 수 없는 고민은 대조군도 사유 기록으로 인정한다(C 소재·환경, A 안전)', async () => {
    expect((await measureFixture('C-track-i')).m.objections[0].status).toBe('noted')
    expect((await measureFixture('A-track-i')).m.objections[2].status).toBe('noted')
  })

  it('계획된 응답 섹션이 렌더되지 않으면 대체 섹션으로 인정한다(sub_div → point_div)', async () => {
    const { m } = await measureFixture('B-track-i', (job) => {
      job.section_plan = {
        ...job.section_plan,
        activated_sections: (job.section_plan.activated_sections ?? []).filter((s) => s !== 'sub_div'),
        section_order: (job.section_plan.section_order ?? []).filter((s) => s !== 'sub_div'),
      }
    })
    expect(m.order).not.toContain(S.SUB_DIV)
    expect(m.objections.every((o) => o.status === 'answered')).toBe(true)
  })

  it('개선판 골격: 기록의 문법을 쓰고, 렌더 후 섹션이 R1~R8을 통과하며 상위 고민에 침묵이 없다', async () => {
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]) {
      let plan!: ReturnType<typeof withPersuasionSkeleton>
      const { m } = await measureFixture(key, (job) => {
        plan = withPersuasionSkeleton(job)
      })
      expect(m.persuasion.source, key).toBe('record')
      expect(m.persuasion.grammar, key).toBe(plan.persuasion.grammar)
      expect(m.persuasion.rules.filter((r) => !r.pass), key).toEqual([])
      expect(m.objections.every((o) => o.status !== 'silent'), key).toBe(true)
    }
  })

  it('mobile 하한은 section_plan.enrichment.features에 mobile이 있는 잡에만 — 점수표 문서도 같은 조건으로 만들어진다', async () => {
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]) {
      const off = (await measureFixture(key, (job) => withPersuasionSkeleton(job))).m
      const on = (await measureFixture(key, (job) => withPersuasionSkeleton(job, ['vocab', 'persuasion', 'mobile']))).m
      expect(on.order, key).toEqual(off.order)
      expect(totalViolations(on.mobile!.counts), key).toBeLessThan(totalViolations(off.mobile!.counts))
    }
  })

  it('모바일 검사기를 바꿔 끼우면 그 결과를 그대로 싣는다', async () => {
    const job = fixtureToJob(loadEnrichmentFixture('C-track-i'))
    const { doc } = await renderJobHtml(job)
    const counts = { M1: 3, M2: 0, M3: 0, M4: 1, M5: 0, M6: 0, M7: 0 }
    const m = await measurePage(job, doc, { mobileCheck: () => ({ counts, phoneScreens: 9.5 }) })
    expect(m.mobile).toEqual({ counts, phoneScreens: 9.5 })
  })
})

describe('measureAnnotations — 대상 컷 위 장식', () => {
  const job = {
    section_images: [
      { section: 'features:0', url: 'https://img/f0.png' },
      { section: 'features:1', url: 'https://img/f1.png' },
      { section: 'howto:0', url: 'https://img/h0.png', error: 'failed' },
      { section: 'hero', url: 'https://img/hero.png' },
    ],
  } as unknown as PdpJobRow

  it('대상 이미지 위에 장식 요소가 있으면 장식됨, 밖에 있으면 아님. 대상 밖 컷과 오류 컷은 세지 않는다', () => {
    const result = measureAnnotations(job, [
      section('point_div', [image('https://img/f0.png'), mark('label-0', 100)]),
      section('sub_div', [image('https://img/f1.png'), mark('label-1', 700)]),
      section('main_cut', [image('https://img/hero.png'), mark('label-2', 100)]),
    ])
    expect(result).toEqual({ targetCuts: 2, targets: 2, decorated: 1 })
  })

  it('같은 URL은 1개, 장식은 어느 출현에 있든 인정한다(렌더러가 고른 소유 섹션). 장식 확대 자체는 대상이 아니다', () => {
    const zoom = el({
      type: 'framed-image',
      name: `${ANNOTATION_NAME_PREFIX}zoom-0`,
      framedImageProps: { src: 'https://img/f0.png' } as CanvasElement['framedImageProps'],
      transform: { x: 500, y: 200, width: 260, height: 260, rotation: 0 },
    })
    const result = measureAnnotations(job, [
      section('point_list_div', [image('https://img/f0.png')]),
      section('point_div', [image('https://img/f0.png'), zoom]),
      section('hidden_page', [image('https://img/h0.png')]),
    ])
    expect(result).toEqual({ targetCuts: 2, targets: 1, decorated: 1 })
  })
})

describe('measureLayouts — 실제로 적용된 프리셋만', () => {
  it('slotAssignments가 있는 섹션만 프리셋 카테고리, 인접 같은 카테고리는 중복', async () => {
    const preset = (await loadLayoutPresets(S.POINT_DIV)).find((p) => !p.id.endsWith('_layout_01') && p.category !== 'minimal')!
    const applied = { layoutId: preset.id, slotAssignments: { a: 'b' } }
    const result = await measureLayouts([
      section(S.POINT_DIV, [], applied),
      section(S.POINT_DIV, [], applied),
      section(S.SUB_DIV, [], { layoutId: 'sub_div_layout_05' }),
    ])
    expect(result.sequence).toEqual([preset.category, preset.category, 'minimal'])
    expect(result.applied).toBe(2)
    expect(result.repeats).toEqual([`${S.POINT_DIV}→${S.POINT_DIV}(${preset.category})`])
  })

  it('S2 보고: 배정(minimal·PRESET_EXEMPT 제외) 중 렌더에 반영되지 않은 섹션', async () => {
    const preset = (await loadLayoutPresets(S.POINT_DIV)).find((p) => !p.id.endsWith('_layout_01') && p.category !== 'minimal')!
    const result = await measureLayouts(
      [section(S.POINT_DIV, [], { layoutId: preset.id, slotAssignments: { a: 'b' } }), section(S.SUB_DIV, []), section(S.CTA, [])],
      { [S.POINT_DIV]: preset.category, [S.SUB_DIV]: 'split', [S.CTA]: 'bold', [S.HIDDEN_PAGE]: 'card' }
    )
    expect(result.assigned).toBe(2)
    expect(result.guardDropped).toEqual([`${S.SUB_DIV}(split→minimal)`])
  })
})

describe('measurePage — 긴 상세페이지 확장 섹션', () => {
  it('확장 섹션은 규칙 판정 순서에서 빠지고 섹션 수(R6)에만 들며, 상한을 그려진 수만큼 넓힌다 — 없으면 예전 그대로', async () => {
    const { job, doc, m } = await measureFixture('A-track-i', attachRecordOnly)
    const body = doc.sections.filter((s) => s.sectionType !== S.DIVIDER)
    const base = body[body.length - 1]
    const extra: CanvasSection = { ...base, id: 'long-faq', sectionType: S.SPEC_TABLE, expansion: 'faq', order: base.order - 0.5 }
    const m2 = await measurePage(job, { ...doc, sections: [...doc.sections, extra] })
    expect(m2.order).toEqual(m.order)
    expect(m2.expansions).toEqual(['faq'])
    expect(m2.persuasion.lengthTarget).toEqual([m.persuasion.lengthTarget[0], m.persuasion.lengthTarget[1] + 1])
    expect(m.expansions).toBeUndefined()
  })
})
