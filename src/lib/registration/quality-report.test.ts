/**
 * 품질 보고서 확장(설계 §4.6, pdp-enrichment T4b) — annotations·layouts 필드.
 * 장식 렌더 집계(영역 밖 제외 등)·편집기 최초 빌드 측정(가드 탈락)·배정 기록 llm·합성 후처리 연결과
 * Track S·기록 없는 Track I 불변, 측정 시간(Vercel 120초 대비)을 확인한다. LLM·DB 없음.
 */

import { describe, expect, it, vi } from 'vitest'
import { applyImageAnnotations, type AnnotationRenderStats } from './editor/utils/sectionConverter/annotations'
import { makeImageEl, makeTextEl } from './editor/utils/sectionConverter/elements'
import { assembleEditorDataResponse } from './editor-data'
import { buildEditorDocument } from './editor/utils/buildEditorDocument'
import type { CanvasSection } from './editor/types/canvas'
import { ProSectionType } from './editor/types/section'
import { assignLayouts } from './internalized/layout-assign'
import {
  annotationQualityReport,
  buildNumberAnnotations,
  selectAnnotationTargets,
  validateAnnotations,
  withAnnotationResult,
  type AnnotationTarget,
} from './pdp-annotation-stage'
import {
  applyDesignSkeleton,
  layoutQualityReport,
  resolveComposeTrackI,
  resolveDesignSkeleton,
} from './pdp-enrichment-stage'
import type { PdpJobRow } from './pdp-state'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { emptyEditorBuildStats, measureEditorBuild } from './quality-render-stats'
import {
  fixtureToJob,
  GOLDEN_NOW,
  loadEnrichmentFixture,
  normalizeEditorJson,
  sha256,
  type FixtureKey,
} from './__golden__/golden-harness'
import { getDesignVocab } from './design-vocab'

const T4_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile']

function designedJob(key: FixtureKey, features: string[] = T4_FEATURES): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}

/** 장식 단계를 고정 모의 Vision 응답으로 마친 잡(L2 재생과 같은 응답) */
function annotatedJob(key: FixtureKey): PdpJobRow {
  const job = designedJob(key)
  const rows = (t: AnnotationTarget) => {
    const [a, b] = t.labels
    if (!t.kinds.includes('zoom')) return [{ kind: 'label', text: a.text, x: 0.5, y: 0.5 }]
    return [
      { kind: 'leader', text: a.text, x: 0.45, y: 0.45 },
      { kind: 'zoom', zoomRect: { x: 0.55, y: 0.45, w: 0.2, h: 0.2 } },
      ...(b ? [{ kind: 'label', text: b.text, x: 0.3, y: 0.62 }] : []),
    ]
  }
  for (const t of selectAnnotationTargets(job)) {
    const annotations = t.mode === 'number' ? buildNumberAnnotations(t) : validateAnnotations(rows(t), t)
    job.section_images = job.section_images.map((e) =>
      e.section === t.section ? withAnnotationResult(e, { annotations }) : e
    )
  }
  return job
}

const URL_A = 'https://cdn.test/feature-0.png'
let seq = 0
function section(type: string, height: number, elements: CanvasSection['elements']): CanvasSection {
  seq++
  return {
    id: `q${seq}`,
    sectionType: type as ProSectionType,
    groupType: 'usp',
    order: seq,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height, backgroundColor: '#ffffff' },
    elements,
  }
}
const cut = (src: string, y: number, width = 860, height = 600) =>
  makeImageEl('cut', src, 'main', 0, y, width, height, 1)
const zero = (): AnnotationRenderStats => ({ placed: 0, outOfView: 0, noRoom: 0, screenCap: 0, notShown: 0 })

describe('장식 렌더 집계 — 영역 밖 제외·자리 없음·화면 상한·화면에 없음', () => {
  it('사유별로 장식 항목 수를 센다(넘기지 않으면 결과 문서 같음)', () => {
    const items = [
      { kind: 'label' as const, anchor: { x: 0.5, y: 0.1 }, text: '원터치 작동', source: 'x' }, // 3:4 cover에서 잘린 위쪽
      {
        kind: 'zoom' as const,
        anchor: { x: 0.5, y: 0.5 },
        zoomRect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
        source: 'image',
      },
      { kind: 'label' as const, anchor: { x: 0.3, y: 0.6 }, text: '10미터', source: 'spec.size' },
    ]
    const doc = [section(ProSectionType.POINT_DIV, 600, [cut(URL_A, 0, 500, 500)])]
    const map = {
      [URL_A]: { aspect: 0.75, items },
      'https://cdn.test/missing.png': { aspect: 1, items: items.slice(2) },
    }
    const stats = zero()
    const out = applyImageAnnotations(doc, map, null, stats)
    // 500×500 상자: 3:4 cover로 위쪽(0.1)은 잘림, 원형 확대(280)는 어느 모서리든 가리킨 지점을 덮어 자리 없음,
    // 짧은 라벨은 가운데 50% 밖 모서리에 그림
    expect(stats).toEqual({ placed: 1, outOfView: 1, noRoom: 1, screenCap: 0, notShown: 1 })
    expect(JSON.stringify(applyImageAnnotations(doc, map, null))).toBe(JSON.stringify(out))
  })

  it('폰 한 화면 3개 상한으로 뺀 장식은 screenCap', () => {
    // 사진당 글 칩은 1개라 둘째 장식은 원형 확대 — 두 컷 4개 중 화면 상한으로 1개를 뺀다
    const items = [
      { kind: 'leader' as const, anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'x' },
      {
        kind: 'zoom' as const,
        anchor: { x: 0.7, y: 0.62 },
        zoomRect: { x: 0.6, y: 0.52, w: 0.2, h: 0.2 },
        source: 'image',
      },
    ]
    const URL_B = 'https://cdn.test/feature-1.png'
    const stats = zero()
    applyImageAnnotations(
      [
        section(ProSectionType.POINT_DIV, 700, [cut(URL_A, 50)]),
        section(ProSectionType.SUB_DIV, 700, [cut(URL_B, 50)]),
      ],
      { [URL_A]: { aspect: 0.75, items }, [URL_B]: { aspect: 0.75, items } },
      null,
      stats
    )
    expect(stats.placed).toBe(3)
    expect(stats.screenCap).toBe(1)
  })
})

describe('편집기 최초 빌드 측정 — 레이아웃 런타임 가드·장식', () => {
  it('측정해도 문서가 같고, 시도 = 적용 + 유실 가드 탈락 + 모바일 되돌림', async () => {
    const job = annotatedJob('A-track-i')
    const response = { ...assembleEditorDataResponse(job, null), is_new: true, sections_data: [] }
    // 요소 id에 시각이 들어간다 — 골든 하네스처럼 시각을 고정하고 같은 정규화(normalizeEditorJson)로 비교한다
    const now = vi.spyOn(Date, 'now').mockReturnValue(GOLDEN_NOW)
    const plain = await buildEditorDocument(job.id, response)
    const stats = emptyEditorBuildStats()
    const measured = await buildEditorDocument(job.id, response, { stats })
    now.mockRestore()
    const stable = (d: typeof plain) => sha256(normalizeEditorJson(d.sections))
    expect(stable(measured)).toBe(stable(plain))
    const l = stats.layouts
    expect(l.tried).toBeGreaterThan(0)
    expect(l.applied + l.guardDropped + l.mobileReverted).toBe(l.tried)
    expect(stats.annotations.placed).toBeGreaterThan(0)
  })

  it('A·B·C 측정 시간 — compose 서버 실행에서 무시할 수준(Vercel 120초 대비)', async () => {
    const times: string[] = []
    for (const key of ['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]) {
      const job = annotatedJob(key)
      await measureEditorBuild(job) // 프리셋 JSON 첫 로드 제외(웜업)
      const { ms } = await measureEditorBuild(job)
      times.push(`${key} ${ms}ms`)
      expect(ms).toBeLessThan(5_000)
    }
    console.log(`[T4b] measureEditorBuild ${times.join(', ')}`)
  })
})

describe('배정 기록 llm — LLM 교체 수', () => {
  it('LLM이 고른 카테고리를 기록에 남기고, 보고서가 유지·교체·충돌 해소를 센다', () => {
    const job = designedJob('A-track-i')
    const order = job.section_plan.section_order!
    const persuasion = job.section_plan.internalized_skeleton!.persuasion!
    const llmSelections = { main_cut: 'card', point_div: 'split' }
    const { records } = assignLayouts({
      sectionOrder: order,
      stages: persuasion.stages,
      category: job.analysis.detected_category,
      vocab: getDesignVocab()!,
      llmSelections,
    })
    expect(records.find((r) => r.section === 'main_cut')).toMatchObject({ llm: 'card' })
    expect(
      records
        .filter((r) => r.llm)
        .map((r) => r.section)
        .sort()
    ).toEqual(['main_cut', 'point_div'])

    const withRecords = {
      ...job,
      section_plan: {
        ...job.section_plan,
        internalized_skeleton: {
          ...job.section_plan.internalized_skeleton!,
          persuasion: { ...persuasion, layouts: records },
        },
      },
    }
    const report = layoutQualityReport(withRecords, { tried: 4, applied: 2, guardDropped: 1, mobileReverted: 1 })!
    expect(report.sections).toBe(records.length)
    expect(report.assigned).toBe(records.filter((r) => r.category !== 'minimal').length)
    expect(report.llmReplaced).toBe(records.filter((r) => r.llm && r.llm !== r.category).length)
    expect(report.llmKept).toBe(records.filter((r) => r.source === 'llm').length)
    expect(report.conflictResolved).toBe(records.filter((r) => r.source === 'conflict').length)
    expect(report).toMatchObject({ tried: 4, applied: 2, guardDropped: 1, mobileReverted: 1 })
  })
})

describe('합성 후처리 — 기록 잡에만 annotations·layouts', () => {
  it('장식·배정 기록 잡: 잡 기록 수치 + 측정 수치', async () => {
    const job = annotatedJob('A-track-i')
    const { stats } = await measureEditorBuild(job)
    const report = resolveComposeTrackI(job, null, stats).qualityReport!
    const targets = selectAnnotationTargets(job)
    expect(report.annotations).toEqual(annotationQualityReport(job, stats.annotations))
    expect(report.annotations).toMatchObject({ targets: targets.length, done: targets.length, skipped: 0, failed: 0 })
    expect(report.annotations!.placed).toBe(stats.annotations.placed)
    expect(report.layouts).toEqual(layoutQualityReport(job, stats.layouts))
    expect(report.layouts!.tried).toBe(stats.layouts.tried)
    // 측정이 없으면 잡 기록 수치만
    const unmeasured = resolveComposeTrackI(job, null).qualityReport!
    expect(unmeasured.annotations).not.toHaveProperty('placed')
    expect(unmeasured.layouts).not.toHaveProperty('tried')
  })

  it('기능을 끈 기록 잡은 그 필드가 없고, 기록 없는 Track I·Track S 보고서는 그대로', () => {
    const noAnnotations = designedJob('A-track-i', ['vocab', 'persuasion', 'layouts', 'shots', 'mobile'])
    expect(resolveComposeTrackI(noAnnotations, null).qualityReport).not.toHaveProperty('annotations')
    const noLayouts = designedJob('A-track-i', ['vocab', 'persuasion'])
    expect(resolveComposeTrackI(noLayouts, null).qualityReport).not.toHaveProperty('layouts')

    const off = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    const offReport = resolveComposeTrackI(off, null).qualityReport
    expect(offReport).toBeDefined()
    expect(Object.keys(offReport!).sort()).toEqual(['skeleton_excluded', 'trust_gate'])
    expect(resolveComposeTrackI(fixtureToJob(loadEnrichmentFixture('A-track-s')), null)).toEqual({})
  })
})

describe('글자 장애물 — 측정 집계는 렌더 판단과 같다', () => {
  it('글자가 이미지 전체를 덮으면 모든 장식이 자리 없음', () => {
    const cover = makeTextEl('cover', '전면 문구', 'body', 0, 0, 860, '#ffffff', 'center', 5, {
      fontSize: 45,
      height: 600,
    })
    const stats = zero()
    applyImageAnnotations(
      [section(ProSectionType.POINT_DIV, 700, [cut(URL_A, 0), cover])],
      {
        [URL_A]: {
          aspect: 0.75,
          items: [{ kind: 'label', anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'x' }],
        },
      },
      null,
      stats
    )
    expect(stats).toEqual({ placed: 0, outOfView: 0, noRoom: 1, screenCap: 0, notShown: 0 })
  })
})
