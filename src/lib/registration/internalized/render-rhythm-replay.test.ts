/**
 * L2 오프라인 재생 — R4 렌더 리듬(NEXFIT 대비 비교, pdp-r4-render-rhythm). persuasion 기록 잡(디자인 컷 제외)을 그려
 *   ① M1~M7 위반 0 ② 내재화 테마는 행간·바탕을 건드리지 않고 크기를 내리지 않는다(테마를 뺀 같은 잡과 비교)
 *   ③ 톤 리듬이 더한 짙은 띠 ≤ 1 ④ 같은 톤 이웃 경계는 표시된다(거터 기본 바탕 또는 선, 전폭 사진이 붙은 경계 제외)
 *   ⑤ 섹션 안 간격(헤드라인→본문 60·글→사진 75) ⑥ 디자인 컷 잡은 R4 후처리를 받지 않는다
 * ⑦ R4 심사 결함 수정(pdp-render-fixes-r4): 빈 슬롯 글자 0·문제 제기 항목 강조 없음·전폭 사진 마감 하단 여백 0·프리셋 유실 0
 * 기록 없는 잡(Track S·대조군)은 골든(pdp-golden)이 고정한다. 대상: 기준 상품 A·B·C(T3 기록)와 R1 저장 잡 P02·P03·P07.
 * 무료·결정론(LLM·DB 없음).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../editor/types/canvas'
import type { DesignPalette } from '../editor/types/editor'
import { ProSectionType as S } from '../editor/types/section'
import { loadLayoutPresets } from '../editor/data/layouts'
import { applyLayoutPreset, isContentBearing } from '../editor/utils/applyLayoutPreset'
import { closePhotoBottoms } from '../editor/utils/applyLegibility'
import { MIN_TONE_DISTANCE, deepTone, toneDistance } from '../editor/utils/applyToneRhythm'
import { buildEditorDocument, type EditorBuildStats } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability } from '../editor/utils/mobileReadability'
import { designcutJobFromD1 } from '../editor/utils/sectionConverter/designCut/designCut.fixture'
import { createSectionElements } from '../editor/utils/sectionConverter/sections'
import { assembleEditorDataResponse } from '../editor-data'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'

const T3_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'mobile']
const R1_DIR = join(__dirname, '__fixtures__/designcut-v2')
const R1_JOBS = { P02: 'r1-p02-d10ea762', P03: 'r1-p03-f2d72bd0', P07: 'r1-p07-8e7006a3' } as const

function designedJob(key: FixtureKey): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features: T3_FEATURES } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}

/** R1 저장 잡 — 디자인 컷을 뺀 기록(R1 처리군 그대로) */
function r1Job(name: keyof typeof R1_JOBS): PdpJobRow {
  const row = JSON.parse(readFileSync(join(R1_DIR, `${R1_JOBS[name]}.json`), 'utf8')) as PdpJobRow
  const features = row.section_plan.enrichment!.features.filter((f) => f !== 'designcut')
  return { ...row, section_plan: { ...row.section_plan, enrichment: { ...row.section_plan.enrichment!, features } } }
}

async function render(job: PdpJobRow, theme = true) {
  const response = assembleEditorDataResponse(job, null)
  return buildEditorDocument(job.id, {
    ...response,
    ...(theme ? {} : { internalized_theme: null }),
    is_new: true,
    sections_data: [],
  })
}

const CASES: Array<[string, () => PdpJobRow]> = [
  ...(['A-track-i', 'B-track-i', 'C-track-i'] as FixtureKey[]).map((k) => [k, () => designedJob(k)] as [string, () => PdpJobRow]),
  ...(Object.keys(R1_JOBS) as Array<keyof typeof R1_JOBS>).map((k) => [`R1 ${k}`, () => r1Job(k)] as [string, () => PdpJobRow]),
]

const visibleBody = (sections: CanvasSection[]) => sections.filter((s) => s.isVisible !== false)
const flat = (s: CanvasSection, palette: DesignPalette) =>
  s.canvas.backgroundColor.startsWith('linear-gradient') ? palette.bgMain : s.canvas.backgroundColor
/** 전폭 사진이 경계에 붙어 있는가(선 대신 사진 가장자리가 경계를 보인다) */
const photoAt = (s: CanvasSection, side: 'top' | 'bottom') =>
  s.elements.some(
    (e) =>
      e.isVisible !== false &&
      (e.type === 'image' || e.type === 'framed-image') &&
      e.transform.width >= s.canvas.width * 0.9 &&
      (side === 'top' ? e.transform.y <= 2 : e.transform.y + e.transform.height >= s.canvas.height - 2)
  )

describe('L2 오프라인 재생 — R4 렌더 리듬(persuasion 기록 잡)', () => {
  for (const [label, make] of CASES) {
    it(`${label}: M1~M7 위반 0`, async () => {
      const report = checkMobileReadability(await render(make()))
      expect(report.violations, JSON.stringify(report.violations.slice(0, 5))).toEqual([])
    })

    it(`${label}: 테마는 행간·바탕을 건드리지 않고 크기를 내리지 않는다`, async () => {
      const job = make()
      const [themed, plain] = [await render(job), await render(job, false)]
      expect(themed.sections.length).toBe(plain.sections.length)
      themed.sections.forEach((s, i) => {
        const p = plain.sections[i]
        expect(s.canvas.backgroundColor, `${label} #${i} ${s.sectionType}`).toBe(p.canvas.backgroundColor)
        expect(s.elements.length).toBe(p.elements.length)
        s.elements.forEach((el, j) => {
          if (el.type !== 'text') return
          const base = p.elements[j].textProps!
          expect(el.textProps!.lineHeight, `${label} ${el.name}`).toBe(base.lineHeight)
          expect(el.textProps!.fontSize, `${label} ${el.name}`).toBeGreaterThanOrEqual(base.fontSize)
        })
      })
    })

    it(`${label}: 짙은 띠는 하나 이하, 같은 톤 이웃 경계는 표시된다`, async () => {
      const doc = await render(make())
      const palette = doc.sourceData.designPalette
      const sections = visibleBody(doc.sections)
      // 거터는 앞 섹션 바탕을 이어 받으므로 세지 않는다
      const deep = sections.filter((s) => s.sectionType !== S.DIVIDER && s.canvas.backgroundColor === deepTone(palette.primary))
      expect(deep.length, deep.map((s) => s.sectionType).join(',')).toBeLessThanOrEqual(1)

      let prev: CanvasSection | null = null
      let gutters: CanvasSection[] = []
      const unmarked: string[] = []
      for (const s of sections) {
        if (s.sectionType === S.DIVIDER) {
          gutters.push(s)
          continue
        }
        if (prev && toneDistance(flat(prev, palette), flat(s, palette)) < MIN_TONE_DISTANCE) {
          const marked =
            s.elements.some((e) => e.name === 'rhythm_seam') ||
            gutters.some((g) => g.canvas.height > 0 && toneDistance(g.canvas.backgroundColor, flat(prev!, palette)) >= MIN_TONE_DISTANCE) ||
            photoAt(prev, 'bottom') ||
            photoAt(s, 'top')
          if (!marked) unmarked.push(`${prev.sectionType}→${s.sectionType}`)
        }
        prev = s
        gutters = []
      }
      expect(unmarked).toEqual([])
    })
  }

  it('섹션 안 간격 — render_rhythm이면 헤드라인→본문 60·글→사진 75(기본 90·110)', () => {
    const palette = r1Job('P02').copy_sections.final!.designPalette as unknown as DesignPalette
    const content = { hook: '후킹', benefitHeadline: '헤드라인', subBenefit: '부제' }
    const build = (rhythm: boolean) =>
      createSectionElements(S.HOOK_3STEP, content, 'https://img.test/h.png', palette, rhythm ? { rhythm: true } : {})
    const y = (els: ReturnType<typeof build>, name: string) => els.find((e) => e.name === name)!.transform.y
    const [on, off] = [build(true), build(false)]
    expect(y(off, 'sub_benefit') - y(on, 'sub_benefit')).toBe(30)
    expect(y(off, 'hero_image') - y(on, 'hero_image')).toBe(65)
  })

  it('문제 제기 질문 헤드라인 — render_rhythm이면 상자를 잰 행간(1.4)으로 그린다(리플로우 없는 캡처 넘침 48px 해소)', () => {
    const palette = r1Job('P02').copy_sections.final!.designPalette as unknown as DesignPalette
    const content = { question: '두피, 오늘도 그냥 넘어가셨나요?', empathyLines: ['샴푸는 그냥 씻기만 해요', '두피 관리는 늘 미뤄요'] }
    const question = (rhythm: boolean) =>
      createSectionElements(S.PROBLEM_RAISE, content, null, palette, rhythm ? { rhythm: true } : {}).find(
        (e) => e.name === 'problem_question'
      )!
    const [on, off] = [question(true), question(false)]
    expect(on.textProps!.lineHeight).toBe(1.4)
    expect(on.transform.height).toBe(off.transform.height) // 상자는 그대로, 글자가 상자에 맞는다
    expect(off.textProps!.lineHeight).not.toBe(1.4) // 기본(Track S·대조군)은 그대로
  })

  it('디자인 컷 잡은 R4 후처리를 받지 않는다 — 같은 톤 경계 선 0', async () => {
    const doc = await render(designcutJobFromD1('A-track-i'))
    expect(doc.sections.some((s) => s.layoutId.startsWith('designcut_'))).toBe(true)
    expect(doc.sections.flatMap((s) => s.elements).some((e) => e.name === 'rhythm_seam')).toBe(false)
  })
})

/** R4 심사 결함(pdp-render-fixes-r4) 확인용 — 프리셋 유실 집계까지 받는다 */
async function renderWithStats(job: PdpJobRow) {
  const response = assembleEditorDataResponse(job, null)
  const stats: EditorBuildStats = { layouts: { tried: 0, applied: 0, guardDropped: 0, mobileReverted: 0 }, annotations: {} as EditorBuildStats['annotations'] }
  const doc = await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] }, { stats })
  return { doc, stats }
}
const isPhoto = (e: CanvasElement) => e.type === 'image' || e.type === 'framed-image'
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height

describe('R4 렌더 결함 수정(pdp-render-fixes-r4) — 04번만 강조·빈 띠', () => {
  for (const [label, make] of CASES) {
    it(`${label}: 빈 글자 요소 0, 문제 제기 항목 강조 없음, 전폭 사진으로 끝나는 섹션은 하단 여백 0, 프리셋 유실 0`, async () => {
      const { doc, stats } = await renderWithStats(make())
      const body = visibleBody(doc.sections)
      const empty = body.flatMap((s) =>
        s.elements.filter((e) => e.type === 'text' && e.isVisible !== false && !(e.textProps?.content ?? '').trim()).map((e) => `${s.sectionType}.${e.name}`)
      )
      expect(empty).toEqual([])
      for (const s of body.filter((x) => x.sectionType === S.PROBLEM_RAISE)) {
        const steps = s.elements.filter((e) => /^step_text_\d$/.test(e.name))
        expect(new Set(steps.map((e) => e.textProps!.fontWeight)).size, 'step 굵기').toBe(1)
        expect(s.elements.filter((e) => /^step_bg_\d$/.test(e.name)).every((e) => e.shapeProps?.fill === 'transparent')).toBe(true)
      }
      for (const s of body) {
        const content = s.elements.filter((e) => e.isVisible !== false && e.transform.height > 0 && e.type !== 'shape')
        if (content.length === 0) continue
        const bottom = Math.max(...content.map(bottomOf))
        const closing = content.some((e) => isPhoto(e) && e.transform.x <= 0 && e.transform.width >= s.canvas.width && bottomOf(e) >= bottom - 1)
        if (closing) expect(s.canvas.height, `${s.sectionType} 사진 아래 여백`).toBe(Math.ceil(bottom))
      }
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)
    })
  }

  it('문제 제기 목록 — 기록 없는 잡(대조군·구 잡)은 마지막 항목 강조를 그대로 둔다', () => {
    const palette = r1Job('P02').copy_sections.final!.designPalette as unknown as DesignPalette
    const content = { question: '선물 쌀 때 봉투 크기, 또 고민하세요?', empathyLines: ['사이즈 맞는지 몰라요', '비닐은 성의 없어요', '색이 안 맞아요', '많이 사면 다 못 써요'] }
    const weights = (rhythm: boolean) =>
      createSectionElements(S.PROBLEM_RAISE, content, null, palette, rhythm ? { rhythm: true } : {})
        .filter((e) => /^step_text_\d$/.test(e.name))
        .map((e) => e.textProps!.fontWeight)
    expect(weights(true)).toEqual([400, 400, 400, 400])
    expect(weights(false)).toEqual([400, 400, 400, 700])
  })

  it('빈 슬롯 생략은 최초 자동 적용 옵션에서만 — 편집기에서 고른 레이아웃은 채워 넣을 빈 칸을 둔다', async () => {
    const palette = r1Job('P02').copy_sections.final!.designPalette as unknown as DesignPalette
    const elements = createSectionElements(S.SOLUTION_GUIDE, { summary: 'S, L 사이즈와 두 가지 색상으로 고를 수 있어요' }, 'https://img.test/s.png', palette, { rhythm: true })
    const section = {
      id: 'sol', sectionType: S.SOLUTION_GUIDE, groupType: 'problem', order: 0, isVisible: true, layoutId: 'solution_guide_layout_01',
      canvas: { width: 860, height: 1400, backgroundColor: '#742707' }, elements,
    } as unknown as CanvasSection
    const preset = (await loadLayoutPresets(S.SOLUTION_GUIDE)).find((p) => p.id === 'solution_guide_layout_03')!
    const emptyTexts = (s: CanvasSection) => s.elements.filter((e) => e.type === 'text' && !(e.textProps?.content ?? '').trim())
    const kept = applyLayoutPreset(section, preset, palette)
    const omitted = applyLayoutPreset(section, preset, palette, { omitEmptySlots: true })
    expect(emptyTexts(kept).length).toBeGreaterThan(0)
    expect(emptyTexts(omitted)).toEqual([])
    expect(omitted.elements.filter(isContentBearing).length).toBe(kept.elements.filter(isContentBearing).length)
    expect(Object.keys(omitted.slotAssignments ?? {}).every((id) => omitted.elements.some((e) => e.id === id))).toBe(true)
    expect(omitted.canvas.height).toBeLessThan(kept.canvas.height)
  })

  it('closePhotoBottoms — 글자로 끝나는 섹션·좁은 사진·사용자가 높이를 고친 섹션은 그대로', () => {
    const el = (name: string, type: string, y: number, height: number, width = 860, x = 0) =>
      ({ id: name, name, type, isVisible: true, transform: { x, y, width, height, rotation: 0 }, imageProps: { src: 'https://img.test/p.png' } }) as unknown as CanvasElement
    const sec = (elements: CanvasElement[], extra: Record<string, unknown> = {}) =>
      ({ id: 's', sectionType: S.PROBLEM_RAISE, canvas: { width: 860, height: 2000, backgroundColor: '#FFF' }, elements, ...extra }) as unknown as CanvasSection
    const photoLast = sec([el('t', 'text', 140, 100), el('p', 'image', 300, 1000), el('bg', 'shape', 0, 2000)])
    const [closed] = closePhotoBottoms([photoLast])
    expect(closed.canvas.height).toBe(1300)
    expect(closed.elements.find((e) => e.name === 'bg')!.transform.height).toBe(1300) // 전면 배경 도형은 새 높이에 맞춘다
    const textLast = sec([el('p', 'image', 140, 800), el('t', 'text', 960, 100)])
    const narrow = sec([el('p', 'image', 140, 800, 740, 60)])
    const userSized = sec([el('p', 'image', 140, 800)], { userAdjustedHeight: true })
    for (const s of [textLast, narrow, userSized]) expect(closePhotoBottoms([s])[0]).toBe(s)
  })
})
