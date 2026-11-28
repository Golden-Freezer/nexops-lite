/**
 * lean 기본 on(W5 안 쓰는 컷 빼기, W5b 뒤 통합 결정 2026-10-30) — R 라인 기록 잡은 이미지 태스크만 줄고, 편집기에 렌더되는 사진 URL은
 * 모든 컷을 만들었을 때와 같다(순서 포함). 기록 없는 잡(Track S·ENRICHMENT off 대조군·구 잡)은 태스크가 그대로다.
 * K4 운영 전환(2026-11-06) 뒤 기본 기록은 디자인 컷 잡이라 lean이 없다. 이 시험은 K4 전 R 잡·로컬 R 대조군(K4_SWITCHED_ON을 SKIP)의 기록으로 잰다.
 * 골든 저장 잡으로 오프라인 비교한다 — LLM·DB 없음. R5 실잡 7개 시뮬레이션(쓰인 컷 제거 0, 평균 −4.0컷)과 같은 방식이다.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { K4_SWITCHED_ON, buildEnrichmentRecord, resolveEnabledFeatures, type EnrichmentFeature } from '../enrichment-switch'
import { buildImageTasks } from '../pdp-image-tasks'
import type { PdpJobRow } from '../pdp-state'
import { TRACK_I_KEYS, TRACK_I_VARIANT_KEYS, TRACK_S_KEYS, fixtureToJob, loadEnrichmentFixture } from './golden-harness'

/** R 라인 기록 — K4 전 기본값(로컬 R 대조군과 같은 값) */
const R_ENV = { NEXOPS_PDP_ENRICHMENT_SKIP: K4_SWITCHED_ON.join(',') }
const DEFAULT_FEATURES = buildEnrichmentRecord(resolveEnabledFeatures(R_ENV))!.features
const WITHOUT_LEAN = DEFAULT_FEATURES.filter((f) => f !== 'lean')

const withRecord = (job: PdpJobRow, features: EnrichmentFeature[]): PdpJobRow =>
  ({ ...job, analysis: { ...job.analysis, enrichment: { version: 1, features } } }) as PdpJobRow

/** 편집기 첫 빌드에서 보이는 사진 src — 보이는 섹션·요소만, 문서 순서 그대로 */
async function shownImages(job: PdpJobRow): Promise<string[]> {
  const doc = await buildEditorDocument(job.id, {
    ...assembleEditorDataResponse(job, null),
    is_new: true,
    sections_data: [],
  })
  return doc.sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .flatMap((s) => s.elements.filter((el) => el.isVisible).map((el) => el.imageProps?.src ?? el.framedImageProps?.src))
    .filter((src): src is string => Boolean(src))
}

describe('lean 기본 on — R 라인 잡은 태스크만 줄고 렌더 사진은 같다', () => {
  it('R 라인 기록에 lean이 있고, K4 운영 기본(디자인 컷 잡)에는 lean이 없다', () => {
    expect(DEFAULT_FEATURES).toContain('lean')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).not.toContain('lean')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('designcut')
  })

  /** 모든 컷과 lean으로 남긴 컷을 비교 — 줄어든 장수를 돌려준다 */
  async function compareLean(base: PdpJobRow): Promise<number> {
    const full = withRecord(base, WITHOUT_LEAN)
    const lean = withRecord(base, DEFAULT_FEATURES)
    const all = buildImageTasks(full)
    const kept = buildImageTasks(lean)
    const keptKeys = new Set(kept.map((t) => t.section))
    expect(kept).toEqual(all.filter((t) => keptKeys.has(t.section)))

    const before = await shownImages(full)
    expect(before.length).toBeGreaterThan(0)
    const leanJob = { ...lean, section_images: lean.section_images.filter((e) => keptKeys.has(e.section)) }
    expect(await shownImages(leanJob)).toEqual(before)
    return all.length - kept.length
  }

  for (const key of [...TRACK_I_KEYS, ...TRACK_I_VARIANT_KEYS]) {
    it(`${key}: 안 쓰는 컷만 빠지고(남은 태스크 순서·내용 그대로), 남긴 컷으로 렌더한 사진 URL이 모든 컷일 때와 같다`, async () => {
      expect(await compareLean(fixtureToJob(loadEnrichmentFixture(key)))).toBeGreaterThan(0)
    })
  }

  // 저장 잡 골격은 모두 sub_div가 있어 여분 풀이 통째로 남는다(1~2컷만 빠짐) — 많이 빠지는 골격도 고정한다
  const SKELETONS: Record<string, (order: string[]) => string[]> = {
    'sub_div 없음': (order) => order.filter((k) => k !== 'sub_div'),
    '최소 골격': () => ['hook_3step', 'main_cut', 'problem_raise', 'solution_guide', 'point_div', 'cta'],
    '사용 단계 포함 최소 골격': () => [
      'hook_3step',
      'problem_raise',
      'point_div',
      'hidden_page',
      'key_message',
      'direction_suggest',
      'convert_div',
      'cta',
    ],
  }
  for (const [name, skeleton] of Object.entries(SKELETONS)) {
    it(`A-track-i ${name}: 여러 컷이 빠져도 렌더 사진 URL은 같다`, async () => {
      const base = fixtureToJob(loadEnrichmentFixture('A-track-i'))
      const order = skeleton(base.section_plan.section_order ?? [])
      const job = { ...base, section_plan: { ...base.section_plan, section_order: order, activated_sections: order } }
      expect(await compareLean(job as PdpJobRow)).toBeGreaterThanOrEqual(3)
    })
  }

  it('기록 없는 잡(Track S·대조군·구 잡)은 태스크가 그대로다', () => {
    for (const key of [...TRACK_S_KEYS, ...TRACK_I_KEYS]) {
      const base = fixtureToJob(loadEnrichmentFixture(key))
      expect(base.analysis.enrichment, key).toBeUndefined()
      expect(buildImageTasks(base), key).toEqual(buildImageTasks(withRecord(base, WITHOUT_LEAN)))
    }
  })
})
