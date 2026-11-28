/**
 * 고민 컷(problemcut) — T2에 고민 사진을 되살리고 해결 컷에서 얼굴·표정을 뺀다. 끄면 지금 그대로인지, 컷이 없으면 글만 남는지 본다. 실제 컷은 만들지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { buildImageTasks, EFFECT_ONLY_SECTIONS, solutionWithoutFace } from '../pdp-image-tasks'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { buildDesigncutPlan, problemcutEnabled } from './designcut-plan'

const BASE = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2']
const ON = [...BASE, 'problemcut']
const PHOTO = 'https://cdn.test/problem.png'

function jobOf(features: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}
const t2Of = (job: PdpJobRow) => buildDesigncutPlan(job)?.sections.find((s) => s.template === 'T2')
const sectionsOf = (job: PdpJobRow) => buildImageTasks(job).map((t) => t.section)

describe('계획', () => {
  it('켜면 T2가 고민 컷을 쓴다, 끄면 글만', () => {
    expect(t2Of(jobOf(ON))?.productImageKey).toBe('problem')
    expect(t2Of(jobOf(BASE))?.productImageKey).toBeNull()
  })

  it('D2가 아니면 켜지지 않는다', () => {
    const notD2 = jobOf(['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'problemcut'])
    expect(problemcutEnabled(notD2)).toBe(false)
    expect(t2Of(notD2)?.productImageKey ?? null).toBeNull()
  })
})

describe('태스크', () => {
  it('켜면 고민 컷을 상품 없는 컷으로 만들고, 끄면 만들지 않는다', () => {
    expect(EFFECT_ONLY_SECTIONS.has('problem')).toBe(true)
    expect(sectionsOf(jobOf(ON))).toContain('problem')
    expect(sectionsOf(jobOf(BASE))).not.toContain('problem')
  })

  it('켜도 새 컷은 고민 컷 하나다', () => {
    const on = sectionsOf(jobOf(ON))
    const off = sectionsOf(jobOf(BASE))
    expect(on.filter((s) => !off.includes(s))).toEqual(['problem'])
    expect(off.filter((s) => !on.includes(s))).toEqual([])
  })
})

describe('해결 컷 프롬프트', () => {
  const PROMPT = 'SOLUTION HERO IMAGE:\n- Mood: Bright\n- Facial Expression: Confident radiant smile\n- Background: Clean\nThe model must be a Korean adult. Do NOT generate children, babies, or minors.\nAspect Ratio: 3:4'

  it('표정 줄을 지우고 얼굴 금지 블록을 맨 끝에 붙인다 — 다른 줄은 그대로', () => {
    const out = solutionWithoutFace(PROMPT)
    expect(out).not.toContain('Facial Expression')
    expect(out).not.toContain('radiant smile')
    expect(out).not.toContain('The model must be')
    expect(out).toContain('- Mood: Bright\n- Background: Clean')
    expect(out).toContain('Do NOT generate children, babies, or minors.')
    expect(out.trimEnd().endsWith('no smile or other facial expression.')).toBe(true)
  })

  it('표정 줄이 없는 설계 프롬프트에도 블록이 붙는다', () => {
    expect(solutionWithoutFace('Bright lifestyle photo')).toContain('HANDS AND PRODUCT ONLY')
  })

  it('기존 해결 섹션을 그리는 잡(10잡 모두 이 경로)은 스위치에 따라 블록이 붙는다', () => {
    const solutionOf = (job: PdpJobRow) => buildImageTasks(job).find((t) => t.section === 'solution')?.prompt
    // POINT 제목을 빼면 체크 항목이 3개 안 돼 기존 해결 섹션(solution 컷)을 그린다
    const kept = (features: string[]) => {
      const job = jobOf(features)
      const cards = job.copy_sections.final!.pointCards!.slice(0, 3)
      return { ...job, copy_sections: { ...job.copy_sections, final: { ...job.copy_sections.final!, pointCards: cards } } } as PdpJobRow
    }
    expect(buildDesigncutPlan(kept(ON))!.kept).toContain('solution_guide')
    expect(solutionOf(kept(ON))).toContain('HANDS AND PRODUCT ONLY')
    expect(solutionOf(kept(BASE))).toBeDefined()
    expect(solutionOf(kept(BASE))).not.toContain('HANDS AND PRODUCT ONLY')
  })
})

describe('편집기 문서', () => {
  const docOf = (features: string[], photo: boolean) => {
    const job = jobOf(features)
    const plan = { ...buildDesigncutPlan(job)!, layout: 2 as const }
    const hero = job.section_images.find((s) => s.section === 'hero')!
    const rest = job.section_images.filter((s) => s.section !== 'problem')
    const full: PdpJobRow = {
      ...job,
      section_images: photo ? [...rest, { ...hero, section: 'problem', url: PHOTO }] : rest,
      section_plan: { ...job.section_plan, designcut: plan },
    }
    return buildEditorDocument(full.id, assembleEditorDataResponse(full, null))
  }
  const t2 = (doc: Awaited<ReturnType<typeof docOf>>) => doc.sections.find((s) => s.layoutId === 'designcut_T2')!

  it('켜면 글 아래 고민 사진이 놓이고 글과 겹치지 않는다', async () => {
    const doc = await docOf(ON, true)
    const sec = t2(doc)
    const [photo] = sec.elements.filter((e) => e.name === 'designcut-problem-photo')
    expect(JSON.stringify(photo)).toContain(PHOTO)
    expect(photo.transform.width).toBe(photo.transform.height)
    expect(photo.transform.y + photo.transform.height).toBeLessThanOrEqual(sec.canvas.height)
    for (const e of sec.elements.filter((x) => x.type === 'text')) expect(e.transform.y + e.transform.height, e.name).toBeLessThanOrEqual(photo.transform.y + 1)
    const types = String(sec.sectionType)
    expect(checkMobileReadability(doc).violations.filter((v) => v.section === types && /사진 위/.test(v.detail))).toEqual([])
  })

  it('컷이 없으면(실패) 글만 남고 섹션은 그대로 그린다', async () => {
    const sec = t2(await docOf(ON, false))
    expect(sec).toBeDefined()
    expect(sec.elements.filter((e) => e.name === 'designcut-problem-photo')).toEqual([])
  })

  it('끄면 컷 기록이 있어도 사진을 그리지 않는다', async () => {
    const sec = t2(await docOf(BASE, true))
    expect(sec.elements.filter((e) => e.name === 'designcut-problem-photo')).toEqual([])
  })
})
