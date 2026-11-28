/**
 * L2 오프라인 재생 — T4 강조 장식(docs/plans/pdp-enrichment/01_TEST_PLAN.md L2 장식 행, 02 T4 완료 기준).
 * 기준 상품 A·B·C(Track I)를 T4 기본값 기록 잡으로 설계 단계를 다시 돌리고, Vision 응답은 고정 모의값으로 장식 단계를
 * 거친 뒤 편집기 문서를 만든다.
 *   ① S3 — 장식 대상 컷의 60% 이상이 편집기 보이는 영역 안에 장식 1개 이상
 *   ② 장식 포함 렌더의 M1~M7 위반 0(T3m 병합 시점 0에서 늘지 않음) ③ 경계·겹침 위반 0(이미지 상자 밖·글자와 겹침)
 *   ④ 목록 밖 문구는 문서에 없다 ⑤ 장식이 없는 잡(T3 기록·대조군)은 장식 요소 0
 * 무료·결정론(LLM·DB 없음). 수치는 RUN-LOG T4 절에 옮긴다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability, isAnnotationElement } from '../editor/utils/mobileReadability'
import {
  buildNumberAnnotations,
  selectAnnotationTargets,
  validateAnnotations,
  withAnnotationResult,
  type AnnotationTarget,
} from '../pdp-annotation-stage'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'

const KEYS: FixtureKey[] = ['A-track-i', 'B-track-i', 'C-track-i']
const T3_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'mobile']
const T4_FEATURES = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile']
const INVENTED = '목록 밖 새 문구'

function designedJob(key: FixtureKey, features: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}

/** 고정 모의 Vision 응답 — 지시선·원형 확대·라벨 + 목록 밖 문구 1개(버려져야 한다) */
function mockRows(t: AnnotationTarget): unknown[] {
  const [a, b] = t.labels
  if (!t.kinds.includes('zoom')) return [{ kind: 'label', text: a.text, x: 0.5, y: 0.5 }]
  return [
    { kind: 'label', text: INVENTED, x: 0.7, y: 0.35 },
    { kind: 'leader', text: a.text, x: 0.45, y: 0.45 },
    { kind: 'zoom', zoomRect: { x: 0.55, y: 0.45, w: 0.2, h: 0.2 } },
    ...(b ? [{ kind: 'label', text: b.text, x: 0.3, y: 0.62 }] : []),
  ]
}

function annotatedJob(key: FixtureKey): { job: PdpJobRow; targets: AnnotationTarget[] } {
  const job = designedJob(key, T4_FEATURES)
  const targets = selectAnnotationTargets(job)
  for (const t of targets) {
    const annotations = t.mode === 'number' ? buildNumberAnnotations(t) : validateAnnotations(mockRows(t), t)
    job.section_images = job.section_images.map((e) =>
      e.section === t.section ? withAnnotationResult(e, { annotations }) : e
    )
  }
  return { job, targets }
}

async function render(job: PdpJobRow) {
  return buildEditorDocument(job.id, { ...assembleEditorDataResponse(job, null), is_new: true, sections_data: [] })
}

const rectOf = (e: CanvasElement) => ({
  x: e.transform.x,
  y: e.transform.y,
  w: e.transform.width,
  h: e.transform.height,
})
const inside = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
const overlaps = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 문서 순서 첫 출현 이미지(렌더 규칙과 같다) */
function firstImage(sections: CanvasSection[], url: string): { section: CanvasSection; el: CanvasElement } | null {
  for (const section of sections.filter((s) => s.isVisible !== false))
    for (const el of section.elements)
      if (!isAnnotationElement(el) && el.isVisible !== false && el.type === 'image' && el.imageProps?.src === url)
        return { section, el }
  return null
}

/** 장식 본체(라벨·번호·원형 확대) — 지시선은 앵커까지 이어지는 선이라 본체 판정에서 뺀다 */
const bodies = (s: CanvasSection) => s.elements.filter((e) => isAnnotationElement(e) && e.name !== 'annotation-leader')

describe('L2 오프라인 재생 — T4 강조 장식(A·B·C Track I, 모의 Vision)', () => {
  for (const key of KEYS) {
    it(`${key}: S3 ≥ 60%, M1~M7 위반 0, 경계·겹침 위반 0, 목록 밖 문구 없음`, async () => {
      const { job, targets } = annotatedJob(key)
      expect(targets.length).toBeGreaterThan(0)
      const doc = await render(job)

      let decorated = 0
      for (const t of targets) {
        const hit = firstImage(doc.sections, t.url)
        if (hit && bodies(hit.section).some((b) => inside(rectOf(b), rectOf(hit.el)))) decorated++
      }
      const ratio = decorated / targets.length
      const report = checkMobileReadability(doc)

      const boundary: string[] = []
      for (const section of doc.sections) {
        const images = section.elements.filter((e) => e.type === 'image' && !isAnnotationElement(e))
        const texts = section.elements.filter(
          (e) => !isAnnotationElement(e) && (e.type === 'text' || e.type === 'badge') && e.textProps?.content?.trim()
        )
        for (const b of bodies(section)) {
          if (!images.some((img) => inside(rectOf(b), rectOf(img))))
            boundary.push(`${section.sectionType}:${b.name}:밖`)
          if (texts.some((t) => overlaps(rectOf(b), rectOf(t)))) boundary.push(`${section.sectionType}:${b.name}:겹침`)
        }
      }
      const html = JSON.stringify(doc.sections)
      // RUN-LOG T4 절 수치
      console.log(
        `[T4 L2] ${key} targets=${targets.length}(vision ${targets.filter((t) => t.mode === 'vision').length}) ` +
          `decorated=${decorated} S3=${ratio.toFixed(2)} decorations=${new Set(doc.sections.flatMap((s) => s.elements.filter(isAnnotationElement).map((e) => e.groupId))).size} ` +
          `violations=${report.violations.length} boundary=${boundary.length} screens=${report.phoneScreens.toFixed(1)}`
      )

      expect(ratio, `${key} S3 ${decorated}/${targets.length}`).toBeGreaterThanOrEqual(0.6)
      expect(report.violations, JSON.stringify(report.violations.slice(0, 5))).toEqual([])
      expect(boundary).toEqual([])
      expect(html).not.toContain(INVENTED)
    })

    it(`${key}: 장식이 없는 잡(T3 기록·대조군)은 장식 요소 0 — 편집기 응답에 annotations 키 없음`, async () => {
      for (const job of [designedJob(key, T3_FEATURES), fixtureToJob(loadEnrichmentFixture(key))]) {
        const response = assembleEditorDataResponse(job, null)
        expect('annotations' in response).toBe(false)
        const doc = await render(job)
        expect(doc.sections.flatMap((s) => s.elements).filter(isAnnotationElement)).toEqual([])
      }
    })
  }
})
