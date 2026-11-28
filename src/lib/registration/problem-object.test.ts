/**
 * 고민 실물 컷(하네스 J56, 통합 decide 35 — 오너 11-11 00:5x '고민 실물 컷 스위치 뒤로 만들어 확인').
 * 스위치 problemobject(기본 off): 켠 K 잡의 고민 섹션 problem 컷만 얼굴 줄·SCENE FOCUS 가드를 빼고 Purpose를 상표 없는 낡은 일반 물건 근접으로.
 * 비교 왼쪽 칸은 그대로, 게이트는 J49 상품 없는 컷 그대로(녹·닳음은 재생성 사유가 아니다). 순수 함수·태스크 짜기만 본다(이미지·LLM·DB 0).
 * J61: 문장을 같은 쓰임·다른 모양·깨끗함으로 고치고 짧게, 사용 구도 고민 실물 컷은 우리 상품 쓰는 법 줄(useCut)을 받지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures, type EnrichmentFeature } from './enrichment-switch'
import { isNoProductGateFailure } from './pdp-image-stage'
import { buildImageTasks } from './pdp-image-tasks'
import type { PdpJobRow } from './pdp-state'
import { buildShotBrief, isProblemObjectCut, PROBLEM_OBJECT_LINE, PURPOSE_LINES, type LineShot } from './templatelib/shot-brief'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const problem = (section: string): LineShot => ({ key: `k_${section}`, section, purpose: 'problem', composition: 'top', aspect: '3:4', show: '털이 자꾸 엉켜요' })
const purposeOf = (brief: string) => brief.split('\n').find((line) => line.startsWith('Purpose: '))!

describe('problemobject 컷 지시', () => {
  it('고민 섹션 problem 컷만 대상 — 비교 왼쪽 칸·다른 목적·꺼진 잡은 아니다', () => {
    expect(isProblemObjectCut(problem('problem_empathy'), true)).toBe(true)
    expect(isProblemObjectCut(problem('problem_raise'), true)).toBe(true)
    expect(isProblemObjectCut(problem('compare'), true)).toBe(false)
    expect(isProblemObjectCut({ purpose: 'scene', section: 'problem_empathy' }, true)).toBe(false)
    expect(isProblemObjectCut(problem('problem_empathy'), false)).toBe(false)
  })

  it('켜면 Purpose 첫 문장이 낡은 일반 물건 근접으로 바뀌고, 꺼진 판은 옵션이 없을 때와 바이트가 같다', () => {
    const off = buildShotBrief(problem('problem_empathy'))
    expect(buildShotBrief(problem('problem_empathy'), { problemObject: false })).toBe(off)
    expect(purposeOf(off)).toBe(`Purpose: ${PURPOSE_LINES.problem}`)
    const on = buildShotBrief(problem('problem_empathy'), { problemObject: true })
    expect(purposeOf(on)).toBe(`Purpose: ${PROBLEM_OBJECT_LINE}`)
    expect(on.replace(PROBLEM_OBJECT_LINE, PURPOSE_LINES.problem)).toBe(off)
    // 반려 고민 컷 문장은 그대로 뒤에 붙는다
    expect(purposeOf(buildShotBrief(problem('problem_empathy'), { problemObject: true, category: 'pet' }))).toMatch(new RegExp(`^Purpose: ${PROBLEM_OBJECT_LINE.replace(/[()]/g, '\\$&')} Show it through objects`))
  })

  it('문장은 같은 쓰임의 다른 모양·재질·색 물건, 낡음만·깨끗함(섹션 글이 때를 말해도), 로고·고통 표정 없음을 적는다(J61)', () => {
    for (const word of ['for the same job', 'unlike this product in shape, material and color', 'none of its parts', 'yet clean', 'no mold, grime, stains or rust', 'even if the text says so', 'No logo', 'no pained face'])
      expect(PROBLEM_OBJECT_LINE).toContain(word)
    // 같은 꼴을 부르던 예시와 때를 허락하는 듯한 문장은 없다(J59 켬 P03 — 닮은 브러시·곰팡이 같은 때)
    for (const word of ['bristles', 'rust, scratches', 'cleanliness rules do not apply']) expect(PROBLEM_OBJECT_LINE).not.toContain(word)
  })

  it('문장은 J56 문장(310자)보다 짧다', () => {
    expect(PROBLEM_OBJECT_LINE.length).toBeLessThanOrEqual(280)
  })
})

describe('problemobject 태스크(buildImageTasks)', () => {
  const SHOTS = [
    { key: 'k2_photo_0', section: 'problem_empathy', purpose: 'problem', composition: 'top', aspect: '3:4', show: '털이 자꾸 엉켜요' },
    { key: 'k7_left_0', section: 'compare', purpose: 'problem', composition: 'top', aspect: '3:4', show: '예전 빗' },
    { key: 'k1_photo_0', section: 'point_div', purpose: 'feature_proof', composition: 'front', aspect: '1:1', show: '한 번에 정리' },
  ]
  function jobOf(features: EnrichmentFeature[]): PdpJobRow {
    const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
    return {
      ...job,
      analysis: { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis'],
      section_plan: { ...job.section_plan, templatelib: { shots: SHOTS } } as PdpJobRow['section_plan'],
    }
  }
  const lineTasks = (features: EnrichmentFeature[]) => new Map(buildImageTasks(jobOf(features)).filter((task) => task.shotBrief).map((task) => [task.section, task]))

  it('켜진 잡은 고민 섹션 컷만 바뀐다 — 얼굴 줄·SCENE FOCUS 가드가 빠지고 컷 지시에 새 문장, 비교 왼쪽 칸·기능 컷은 꺼진 잡과 같다', () => {
    const off = lineTasks(['templatelib'])
    const on = lineTasks(['templatelib', 'problemobject'])
    expect([...on.keys()]).toEqual([...off.keys()])
    expect(on.get('k7_left_0')).toEqual(off.get('k7_left_0'))
    expect(on.get('k1_photo_0')).toEqual(off.get('k1_photo_0'))
    const before = off.get('k2_photo_0')!
    const after = on.get('k2_photo_0')!
    expect(before.prompt).toContain('SCENE FOCUS RULE (ABSOLUTE)')
    expect(before.prompt).toMatch(/^- Facial Expression:/m)
    expect(after.prompt).not.toContain('SCENE FOCUS RULE')
    expect(after.prompt).not.toMatch(/^- Facial Expression:/m)
    expect(after.shotBrief).toContain(PROBLEM_OBJECT_LINE)
    // 상품 없는 컷 표지(J49)는 그대로 — 게이트가 글자·브랜드만 본다
    expect(after.noProductCut).toBe(true)
    expect(after.effectOnly).toBe(true)
    // 지시 글·컷 지시 말고는 태스크가 같다
    expect({ ...after, prompt: '', shotBrief: '' }).toEqual({ ...before, prompt: '', shotBrief: '' })
  })

  it('켜진 잡 고민 컷 지시(바탕 + 컷 지시)는 꺼진 잡보다 짧다 — MS 덜어 내기가 끔보다 더 나가지 않는다(J61, J59 켬 k2는 Prop/branding까지 덜렸다)', () => {
    const lengthOf = (task: { prompt: string; shotBrief?: string }) => task.prompt.length + (task.shotBrief?.length ?? 0)
    const off = lineTasks(['templatelib']).get('k2_photo_0')!
    const on = lineTasks(['templatelib', 'problemobject']).get('k2_photo_0')!
    expect(lengthOf(on)).toBeLessThan(lengthOf(off) - 300)
  })

  it('사용 구도(in_use·in_hand)의 상품 없는 고민 컷은 스위치와 상관없이 실물 쓰는 법 표지(useCut)를 받지 않는다 — 상품 컷은 그대로(J61)', () => {
    const handled = SHOTS.map((shot) => ({ ...shot, composition: shot.purpose === 'problem' ? 'in_use' : 'in_hand' }))
    const tasksOf = (features: EnrichmentFeature[]) => {
      const job = jobOf(features)
      const withHandled = { ...job, section_plan: { ...job.section_plan, templatelib: { shots: handled } } } as PdpJobRow
      return new Map(buildImageTasks(withHandled).filter((task) => task.shotBrief).map((task) => [task.section, task]))
    }
    const off = tasksOf(['templatelib'])
    const on = tasksOf(['templatelib', 'problemobject'])
    for (const tasks of [off, on]) {
      expect(tasks.get('k2_photo_0')!.noProductCut).toBe(true)
      expect(tasks.get('k2_photo_0')!.useCut).toBeUndefined()
      // 비교 왼쪽 칸도 목적 problem이라 상품 없는 컷이다 — 같은 규칙
      expect(tasks.get('k7_left_0')!.useCut).toBeUndefined()
      // 상품이 나오는 사용 구도 컷은 그대로 쓰는 법 줄을 받는다
      expect(tasks.get('k1_photo_0')!.useCut).toBe(true)
    }
    expect(on.get('k7_left_0')).toEqual(off.get('k7_left_0'))
  })

  it('녹·닳음·얼룩 같은 결함 사유는 상품 없는 컷의 재생성 사유가 아니다(J49 게이트 그대로)', () => {
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'rust and stains on the old tweezers' })).toBe(false)
    expect(isNoProductGateFailure({ has_artifact: true, artifact_reason: 'a real brand logo is readable' })).toBe(true)
  })
})

describe('problemobject 스위치', () => {
  it('기본 off·K4 밖, 운영(Vercel·작업자)은 EXTRA로도 켜지지 않고 로컬 EXTRA로 K 잡에서만 기록한다', () => {
    expect(ENRICHMENT_DEFAULTS.problemobject).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('problemobject')
    expect(resolveEnabledFeatures({})).not.toContain('problemobject')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'problemobject' })).not.toContain('problemobject')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'problemobject' })).not.toContain('problemobject')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'problemobject' })
    expect(on).toContain('problemobject')
    expect(on.filter((f) => f !== 'problemobject')).toEqual(resolveEnabledFeatures({}))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'problemobject', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('problemobject')
  })
})
