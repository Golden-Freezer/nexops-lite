/**
 * 렌더가 그릴 컷만, 그 자리에 맞는 프롬프트로(pdp-render-aware-cuts, 2026-10-31) — 이미지 태스크(pdp-image-tasks)가 편집기 렌더
 * 규칙(중복 정리 dedupe.ts·사용 장면 longSections.ts)을 같은 함수로 미리 따른다. 규칙을 새로 쓰지 않는다.
 *
 * ① 피처 컷 i는 렌더가 그 컷을 붙이는 특징의 컷이다 — i < 특징 수면 특징 i(pointCards, dedupe pageFeatures), 아니면 detailPoints[i]
 *    (point_div 칸 k = features:k, 추가 특징 주 항목 = 그 특징 번호의 컷, 새 관점 = 항목 번호의 컷 — dedupe planImages).
 *    설계 feature_prompts 가운데 그 특징과 제목 낱말이 맞는 항목을 쓰고, 맞는 항목이 없으면 그 특징의 카피 프롬프트로 만든다.
 *    다른 특징의 설계 프롬프트를 번호로 가져다 쓰지 않는다(R9 94489858: 설계 특징 3개·특징 카드 4개라 번호로 고른 features:2 —
 *    '20매' 프롬프트 — 가 '입체 바닥' 칸에 붙었다).
 * ② 모든 후보 컷이 있다고 보고 중복 정리 계획을 한 번 세워, 계획이 그리지 않는 피처 컷은 만들지 않는다. 사용 장면 컷(long_scene:i)은
 *    계획이 기록한 페이지 글에 이미 보이는 태그를 뺀다(purchaseCheck missingRows — 렌더 장면 섹션과 같은 판정). 키 번호는 태그 순번
 *    그대로다(렌더가 태그 i ↔ long_scene:i로 읽는다). 남는 태그가 2개 미만이면 렌더가 섹션을 짓지 않으므로 하나도 만들지 않는다.
 *
 * 대상: ①은 persuasion 기록 잡 전부(디자인 컷 포함 — 디자인 컷 POINT도 장 순서·조각 번호로 features:i를 쓴다, 2026-10-31 통합 점검),
 * ②는 그 가운데 디자인 컷 계획이 없는 잡(디자인 컷은 자기 필터 designcutTaskFilter가 같은 일을 한다). Track S·대조군은 지금 그대로다.
 */

import type { CopywritingResult } from '../editor/types/editor'
import {
  covered,
  keywordsOf,
  matchFeatures,
  pageFeatures,
  planFeatureDedupe,
  sameWord,
} from '../editor/utils/sectionConverter/dedupe'
import { mapBackendSectionsToProTypes, resolveSectionOrder } from '../editor/utils/sectionConverter/convert'
import { missingRows } from '../editor/utils/sectionConverter/purchaseCheck'
import { LONG_MIN_ROWS } from '../long-sections'
import type { GeneratedImagesMap, PdpJobRow } from '../pdp-state'

/**
 * 피처 컷 i의 주제 — title·description은 설계 항목과 맞출 글(특징 i가 있으면 그 특징, 없으면 detailPoints[i]). from은 카피
 * 프롬프트 출처: card면 특징 글로, point면 detailPoints[i](주장·근거·imageHint — 예전 카피 프롬프트 그대로)로 만든다
 */
export interface FeatureSubject {
  title: string
  description: string
  from: 'card' | 'point'
}

/** ① 피처 프롬프트 맞춤 대상 — persuasion 기록 잡(설득 플래너 골격, 디자인 컷 포함) */
export function featurePromptMatchJob(job: PdpJobRow): boolean {
  return (job.section_plan?.enrichment?.features ?? []).includes('persuasion')
}

/** ② 렌더 인지 컷 빼기 대상 — 중복 정리 잡이고 디자인 컷 계획이 없는 잡만(buildEditorDocument의 featureDedupe·designCut 판정과 같은 기록) */
export function renderAwareJob(job: PdpJobRow, hasDesigncutPlan: boolean): boolean {
  return !hasDesigncutPlan && featurePromptMatchJob(job)
}

/**
 * 피처 컷 0..cap-1의 주제. 특징 i가 있으면 그 특징 글로 설계 항목을 맞추고, 카피 프롬프트는 matchFeatures가 detailPoints[i]를
 * 특징 i의 항목으로 볼 때만 그 항목(예전 그대로), 아니면 특징 글로 만든다. 특징이 없는 번호는 detailPoints[i]
 */
export function featureSubjects(copy: CopywritingResult, cap: number): FeatureSubject[] {
  const { features, points } = pageFeatures(copy)
  const owner = matchFeatures(features, points)
  return points.slice(0, cap).map((point, i) => {
    const card = features[i]
    if (!card) return { ...point, from: 'point' as const }
    return { title: card.title, description: card.description, from: owner[i] === i ? ('point' as const) : ('card' as const) }
  })
}

/**
 * 주제마다 고른 설계 항목 번호(없으면 -1). 제목 낱말이 하나 이상 겹쳐야 하고, 점수는 주제 제목 낱말 ×2 + 설명 낱말(matchFeatures와
 * 같은 꼴). 항목 절반 이상에 나오는 낱말(상품군 낱말)은 세지 않는다. 점수 높은 짝부터 하나씩 — 한 설계 항목은 한 컷에만
 */
export function matchDesignEntries(subjects: readonly FeatureSubject[], entryTitles: readonly string[]): number[] {
  const docs = [...entryTitles, ...subjects.map((s) => `${s.title} ${s.description}`)].map(keywordsOf)
  const specific = (w: string) => docs.filter((d) => d.some((x) => sameWord(w, x))).length * 2 < docs.length
  const entryWords = entryTitles.map((t) => keywordsOf(t).filter(specific))
  const pairs: Array<{ s: number; e: number; score: number }> = []
  subjects.forEach((sub, s) => {
    const title = keywordsOf(sub.title).filter(specific)
    const desc = keywordsOf(sub.description).filter(specific)
    entryWords.forEach((words, e) => {
      const titleHit = covered(title, words)
      if (titleHit > 0) pairs.push({ s, e, score: titleHit * 2 + covered(desc, words) })
    })
  })
  pairs.sort((a, b) => b.score - a.score || a.s - b.s || a.e - b.e)
  const picked = subjects.map(() => -1)
  const taken = new Set<number>()
  for (const p of pairs) {
    if (picked[p.s] >= 0 || taken.has(p.e)) continue
    picked[p.s] = p.e
    taken.add(p.e)
  }
  return picked
}

/** 후보 컷이 모두 성공했다고 본 생성 이미지 맵 — 값은 컷 키를 담은 자리표시(계획이 고른 컷을 키로 되읽는다) */
const PLACEHOLDER = 'https://render-aware.invalid/'
export function placeholderImages(sections: readonly string[], toMap: (s: Array<{ section: string; url: string }>) => GeneratedImagesMap) {
  return toMap(sections.map((section) => ({ section, url: `${PLACEHOLDER}${encodeURIComponent(section)}` })))
}
const sectionOfPlaceholder = (url: string) =>
  url.startsWith(PLACEHOLDER) ? decodeURIComponent(url.slice(PLACEHOLDER.length)) : null

export interface RenderAwareSelection {
  /** 만들 피처 컷 키(features:i) — 계획이 그리는 컷만 */
  features: Set<string>
  /** 만들 사용 장면 컷 키(long_scene:i) — 이미 보이는 태그를 뺀 번호만(2개 미만이면 빈 집합) */
  scenes: Set<string>
}

/**
 * 계획이 그릴 컷 — 편집기와 같은 섹션 순서(activated_sections·section_order → Pro 유형, resolveSectionOrder)로 중복 정리 계획을
 * 세운다. sceneTags는 longSceneTags 결과(키 번호 = 순번)
 */
export function selectRenderedCuts(
  job: PdpJobRow,
  candidates: readonly string[],
  sceneTags: readonly string[],
  toMap: (s: Array<{ section: string; url: string }>) => GeneratedImagesMap
): RenderAwareSelection {
  const copy = job.copy_sections.final as unknown as CopywritingResult
  const plan = job.section_plan
  const activated = mapBackendSectionsToProTypes(plan.activated_sections ?? []).map(String)
  const order = resolveSectionOrder(null, mapBackendSectionsToProTypes(plan.section_order ?? []).map(String), activated)
  const features = plan.enrichment?.features ?? []
  const dedupe = planFeatureDedupe(
    copy,
    order as Parameters<typeof planFeatureDedupe>[1],
    placeholderImages(candidates, toMap) as Record<string, string | string[]>,
    features.includes('mobile'),
    { split: features.includes('split') }
  )
  const drawn = new Set((dedupe.usedImages ?? []).map(sectionOfPlaceholder).filter((s): s is string => Boolean(s)))
  const unseen = (tag: string) => missingRows([{ label: '', value: tag, items: [tag] }], dedupe.shown ?? []).length > 0
  const scenes = sceneTags.map((tag, i) => (unseen(tag) ? `long_scene:${i}` : '')).filter(Boolean)
  return {
    features: new Set([...drawn].filter((s) => s.startsWith('features:'))),
    scenes: new Set(scenes.length >= LONG_MIN_ROWS.scenes ? scenes : []),
  }
}

/** 원장·로그용 한 줄 — 설계 항목과 맞춘 컷 / 카피로 만든 컷 / 안 만든 컷 */
export interface CutPlanReport {
  design: number
  copy: number
  skipped: string[]
}

export const cutPlanLine = (jobId: string, r: CutPlanReport) =>
  `[render-aware-cuts] job=${jobId} design=${r.design} copy=${r.copy} skipped=${r.skipped.length}${r.skipped.length ? ` (${r.skipped.join(',')})` : ''}`
