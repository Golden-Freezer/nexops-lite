/**
 * 저가 컷 강등(rating_bg·USP 아이콘 폴백) — PDP는 Claude·GPT만(오너 2026-10-29, pdp-llm-subscription-backend). 이전의
 * gemini-3.1-flash-image 고정을 버리고 구독(로컬 — codex-image) 잡은 잡 모델 그대로, API 잡은 gpt-image-2로 강등한다.
 * 품질은 low(pdp-cost-time-followup — 장당 $0.011 = 이미지 $0.006 실호출 교차 검산 + 프롬프트 입력 약 $0.005, 이전 medium $0.053).
 * 골든은 생성 호출의 모델만 기록하므로 품질·단가는 여기서 고정한다.
 */

import { describe, expect, it } from 'vitest'
import { estimateImageCostUsd, IMAGE_COST_USD } from '@/lib/agents/image/types'
import { estimateEditorRegen } from './pdp-image-regen'
import { buildImageTasks, LOW_COST_SECTIONS, lowCostCut } from './pdp-image-tasks'
import type { PdpJobRow } from './pdp-state'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const isLowCost = (section: string) => LOW_COST_SECTIONS.has(section) || section.startsWith('usp_icons:')
/** 강등 전 단가(gemini-3.1-flash-image 장당) — 강등이 이보다 비싸지면 안 된다 */
const PREVIOUS_FLASH_USD = 0.067

describe('lowCostCut', () => {
  it('구독(로컬) 잡은 잡 모델 그대로, API 잡은 gpt-image-2 low', () => {
    expect(lowCostCut({ image_model: 'codex-image' })).toEqual({})
    expect(lowCostCut({ image_model: 'gpt-image-2' })).toEqual({ model: 'gpt-image-2', quality: 'low' })
    expect(lowCostCut({ image_model: 'gemini-3-pro-image' })).toEqual({ model: 'gpt-image-2', quality: 'low' })
  })

  it('gpt-image-2 low 단가는 이미지 $0.006(공식 단가표·실측) + 프롬프트 입력 약 $0.005 = $0.011 — 미등록 최고 단가로 계상되지 않는다', () => {
    expect(IMAGE_COST_USD['gpt-image-2'].low).toBe(0.011)
    expect(estimateImageCostUsd('gpt-image-2', 'low')).toBe(0.011)
  })

  it('강등 단가는 단가표에 등록된 값이고, 잡 high보다 싸며 이전 flash 강등보다 비싸지 않다', () => {
    const cut = lowCostCut({ image_model: 'gpt-image-2' })
    const registered = IMAGE_COST_USD[cut.model!][cut.quality!]
    expect(registered).toBeDefined()
    expect(estimateImageCostUsd(cut.model!, cut.quality!)).toBe(registered)
    expect(registered!).toBeLessThan(estimateImageCostUsd('gpt-image-2', 'high'))
    expect(registered!).toBeLessThanOrEqual(PREVIOUS_FLASH_USD)
  })
})

describe('buildImageTasks — 저가 컷', () => {
  const tasksFor = (imageModel: PdpJobRow['image_model']) => {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-s'))
    return buildImageTasks({ ...job, image_model: imageModel })
  }

  it('API 잡: rating_bg·아이콘 컷만 gpt-image-2 low, 나머지 컷은 잡 모델·품질 그대로 — Gemini는 없다', () => {
    const tasks = tasksFor('gpt-image-2')
    const low = tasks.filter((t) => isLowCost(t.section))
    expect(low.length).toBeGreaterThan(0)
    for (const t of low)
      expect({ model: t.model, quality: t.quality }, t.section).toEqual({ model: 'gpt-image-2', quality: 'low' })
    for (const t of tasks.filter((t) => !isLowCost(t.section))) expect(t.quality, t.section).toBeUndefined()
    expect(tasks.some((t) => String(t.model ?? '').startsWith('gemini'))).toBe(false)
  })

  it('codex-image 잡: 저가 컷도 모델·품질 지정 없이 잡 모델(구독 0원)', () => {
    const low = tasksFor('codex-image').filter((t) => isLowCost(t.section))
    expect(low.length).toBeGreaterThan(0)
    for (const t of low) {
      expect(t, t.section).not.toHaveProperty('model')
      expect(t, t.section).not.toHaveProperty('quality')
    }
  })

  it('편집기 재생성 추정도 컷 품질을 따른다(잡 high보다 싸게)', () => {
    const job = { image_model: 'gpt-image-2', image_quality: 'high' } as PdpJobRow
    const cut = estimateEditorRegen(job, lowCostCut(job))
    expect(cut).toMatchObject({ quality: 'low', imageUsd: 0.011 })
    const full = estimateEditorRegen(job, {})
    expect(full).toMatchObject({ quality: 'high', imageUsd: 0.211 })
    expect(cut.imageUsd).toBeLessThan(full.imageUsd)
  })
})
