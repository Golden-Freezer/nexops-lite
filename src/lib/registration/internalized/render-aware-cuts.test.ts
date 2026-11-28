import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '../pdp-state'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { buildImageTaskPlan, buildImageTasks, buildKnownImageTasks } from '../pdp-image-tasks'
import { matchDesignEntries, type FeatureSubject } from './render-aware-cuts'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'split', 'lean', 'audience']

/** A-track-i 고정물(특징 카드: 원터치 작동·화려한 컬러·10개 대용량·간편 정리) + 기록 기능 + 설계 골격 */
function job(features: string[], edit: (j: PdpJobRow) => void = () => {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  j.copy_sections = { ...j.copy_sections, final: { ...j.copy_sections.final! } }
  edit(j)
  return j
}

// 설계 단계 특징 3개(10개 대용량 없음) — 번호로 고르면 features:2(10개 대용량)가 '간편 정리' 프롬프트를, features:3이 카피를 받는다
const DESIGN = [
  { title: '원터치로 바로 터지는 작동', positive: 'DESIGN-ONE hands pressing the popper' },
  { title: '화려한 컬러 꽃가루가 흩날리는 장면', positive: 'DESIGN-COLOR confetti burst' },
  { title: '간편 정리 — 종이 꽃가루는 쓸어 담기 쉽다', positive: 'DESIGN-TIDY sweeping paper confetti' },
]
const withDesign = (j: PdpJobRow) => {
  j.design_prompts = { ...(j.design_prompts ?? {}), feature_prompts: DESIGN } as PdpJobRow['design_prompts']
}
const promptOf = (j: PdpJobRow, section: string) => buildImageTasks(j).find((t) => t.section === section)?.prompt ?? ''

describe('① 피처 컷 프롬프트는 그 특징과 낱말이 맞는 설계 항목 — 번호로 고르지 않는다', () => {
  it('R9 94489858 형태: 설계 3개(끈·반투명 데이지·20매) ↔ 특징 4개 — 입체 바닥은 맞는 항목이 없다', () => {
    const subjects: FeatureSubject[] = ['끈 포장', '반투명 데이지', '입체 바닥 구조', '20매 소량 구성'].map((title) => ({
      title,
      description: '',
      from: 'card',
    }))
    const titles = [
      '끈만 당기면 끝나는 1초 포장 — 별도 리본·테이프 없이 완성되는 간편함',
      '반투명 데이지 디자인으로 내용물은 살짝 보이고 포장 완성도는 높이는 감성 구디백',
      '20매 소량 구성으로 어린이집·행사·생일 답례품을 가성비 있게 준비',
    ]
    expect(matchDesignEntries(subjects, titles)).toEqual([0, 1, -1, 2])
  })

  it('중복 정리 잡: 10개 대용량 컷은 카피 프롬프트, 간편 정리 컷이 간편 정리 설계 프롬프트를 받는다', () => {
    const j = job(ON, withDesign)
    expect(promptOf(j, 'features:0')).toContain('DESIGN-ONE')
    expect(promptOf(j, 'features:1')).toContain('DESIGN-COLOR')
    expect(promptOf(j, 'features:2')).not.toMatch(/DESIGN-/)
    expect(promptOf(j, 'features:3')).toContain('DESIGN-TIDY')
    expect(buildImageTaskPlan(j).report).toMatchObject({ design: 3, copy: 1 })
  })

  it('중복 정리 기록이 없는 잡(대조군·Track S)은 예전처럼 번호로 고른다', () => {
    const j = job(ON.filter((f) => f !== 'persuasion'), withDesign)
    expect(promptOf(j, 'features:2')).toContain('DESIGN-TIDY')
    expect(promptOf(j, 'features:3')).not.toMatch(/DESIGN-/)
  })
})

describe('② 렌더가 그리지 않을 컷은 만들지 않는다(lean 기록 중복 정리 잡)', () => {
  // 컷 배정 시험이라 길이 채움을 끈다 — 채움 섹션(point_list_div)이 피처 컷 자리를 하나 쓴다
  beforeEach(() => vi.stubEnv('NEXOPS_PDP_SECTION_TARGET', '1,18'))
  afterEach(() => vi.unstubAllEnvs())

  const LONG = [...ON, 'long']
  const sections = (j: PdpJobRow) => buildImageTasks(j).map((t) => t.section)

  it('추가 특징 새 관점이 앞 문장 되풀이로 빠져 남는 컷이 필요 없으면 매크로 컷(5·6번)을 만들지 않는다 — 사후 재생성 목록에는 남는다', () => {
    // 고정물: dp4·dp5는 특징 3·2의 주 항목이라 핵심 포인트 칸에 실리고, 추가 특징 새 관점 dp1의 자기 컷(features:1)은 이미 쓰여
    // 남는 컷 features:4·5가 그 자리에 들어간다(렌더가 그린다 — 만든다)
    const base = job(LONG)
    expect(sections(base)).toEqual(expect.arrayContaining(['features:4', 'features:5']))
    // R9 94489858 형태: 새 관점(dp1·dp2)이 훅을 되풀이해 빠지면 추가 특징은 특징 4의 주 항목 하나 — 남는 컷 자리가 없다
    const repeated = job(LONG, (j) => {
      const copy = j.copy_sections.final!
      copy.detailPoints = copy.detailPoints!.map((p, i) => (i === 1 || i === 2 ? { ...p, claim: copy.mainIntro!.hook } : p))
    })
    expect(sections(repeated)).not.toContain('features:4')
    expect(sections(repeated)).not.toContain('features:5')
    expect(buildKnownImageTasks(repeated).map((t) => t.section)).toEqual(expect.arrayContaining(['features:4', 'features:5']))
    // 고정물 사용 장면 태그(생일파티·기념일이벤트·파티소품)는 모두 추천 대상 글에 보여 렌더가 장면 섹션을 짓지 않는다 — 장면 컷도 없다
    expect(buildImageTaskPlan(repeated).report.skipped).toEqual([
      'features:4',
      'features:5',
      'long_scene:0',
      'long_scene:1',
      'long_scene:2',
    ])
  })

  it('사용 장면 태그가 페이지 글에 이미 보이면 그 번호 컷만 빼고(키 번호 그대로), 남는 태그가 2개 미만이면 하나도 만들지 않는다', () => {
    const tagged = (hook: string) =>
      job(LONG, (j) => {
        const copy = j.copy_sections.final!
        copy.usageSceneTags = ['#캠핑', '#차박', '#피크닉']
        copy.mainIntro = { ...copy.mainIntro, hook }
      })
    const scenes = (j: PdpJobRow) => sections(j).filter((s) => s.startsWith('long_scene:'))
    expect(scenes(tagged('축하는 한 손으로'))).toEqual(['long_scene:0', 'long_scene:1', 'long_scene:2'])
    expect(scenes(tagged('피크닉에서도 한 손으로'))).toEqual(['long_scene:0', 'long_scene:1'])
    expect(scenes(tagged('캠핑·피크닉에서도 한 손으로'))).toEqual([])
    expect(buildImageTaskPlan(tagged('피크닉에서도 한 손으로')).report.skipped).toEqual(['long_scene:2'])
  })

  it('lean이 꺼진 잡은 빼지 않는다', () => {
    const j = job(
      LONG.filter((f) => f !== 'lean'),
      (x) => {
        x.copy_sections.final!.usageSceneTags = ['#캠핑', '#차박', '#피크닉']
        x.copy_sections.final!.mainIntro = { ...x.copy_sections.final!.mainIntro, hook: '캠핑·피크닉에서도 한 손으로' }
      }
    )
    expect(sections(j).filter((s) => s.startsWith('long_scene:'))).toHaveLength(3)
    expect(buildImageTaskPlan(j).report.skipped).toEqual([])
  })
})
