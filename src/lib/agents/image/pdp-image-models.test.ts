/**
 * 상세페이지 이미지 모델 선택지 — 라이트 새 PDP 잡은 codex-image 하나만 받는다. 기존 잡의 표시용 레지스트리는 유지한다.
 */

import { describe, expect, it } from 'vitest'
import {
  ALL_IMAGE_MODELS,
  IMAGE_MODELS,
  PDP_IMAGE_MODELS,
  estimateImageCostUsd,
  isImageModel,
  isPdpImageModel,
  USAGE_PRICED_MODELS,
} from './types'

describe('PDP 이미지 모델 선택지', () => {
  it('PDP 새 잡 선택지는 codex-image 하나뿐이고 원격 모델은 거부한다', () => {
    expect(PDP_IMAGE_MODELS).toEqual([
      expect.objectContaining({ id: 'codex-image', provider: 'local' }),
    ])
    expect(isPdpImageModel('codex-image')).toBe(true)
    for (const v of ['gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-2.5-flare', 'gemini-3-pro-image', 'gemini-3.1-flash-image', '', 1, null]) {
      expect(isPdpImageModel(v), String(v)).toBe(false)
    }
  })

  it('썸네일 스튜디오·소싱 이미지 생성 선택지는 그대로(gemini-3-pro-image 포함, 2.5·2.6 없음)', () => {
    expect(IMAGE_MODELS.map((m) => m.id)).toEqual(['gpt-image-2', 'gemini-3-pro-image'])
    expect(isImageModel('gemini-3-pro-image')).toBe(true)
    expect(isImageModel('gpt-image-2.5-sunburst')).toBe(false)
    expect(isImageModel('gpt-image-2.6-sunburst')).toBe(false)
  })

  it('2.5 예약 단가는 R8 실측 위쪽 값 — high도 gpt-image-2 high 단가표보다 낮다(실제 계상은 usage)', () => {
    expect(estimateImageCostUsd('gpt-image-2.5-sunburst', 'medium')).toBe(0.07)
    expect(estimateImageCostUsd('gpt-image-2.5-sunburst', 'high')).toBe(0.12)
    expect(estimateImageCostUsd('gpt-image-2.5-sunburst', 'xhigh')).toBe(0.18)
    expect(estimateImageCostUsd('gpt-image-2.5-sunburst', 'max')).toBe(0.3)
    expect(estimateImageCostUsd('gpt-image-2.5-sunburst', 'high')).toBeLessThan(estimateImageCostUsd('gpt-image-2', 'high'))
    expect(USAGE_PRICED_MODELS.has('gpt-image-2.5-sunburst')).toBe(true)
    expect(USAGE_PRICED_MODELS.has('gpt-image-2')).toBe(false)
  })

  it('2.6은 토큰 단가가 2.5와 같아 예약 단가도 같고, 실제 계상은 usage다', () => {
    for (const q of ['medium', 'high', 'xhigh', 'max'] as const) {
      expect(estimateImageCostUsd('gpt-image-2.6-sunburst', q), q).toBe(estimateImageCostUsd('gpt-image-2.5-sunburst', q))
    }
    expect(USAGE_PRICED_MODELS.has('gpt-image-2.6-sunburst')).toBe(true)
    expect(ALL_IMAGE_MODELS.find((m) => m.id === 'gpt-image-2.6-sunburst')).toMatchObject({ provider: 'openai' })
  })

  it('기존 Gemini 잡은 계속 읽고 재생성 단가를 낸다(하위 호환)', () => {
    expect(ALL_IMAGE_MODELS.find((m) => m.id === 'gemini-3-pro-image')).toMatchObject({ provider: 'gemini' })
    expect(estimateImageCostUsd('gemini-3-pro-image', 'high')).toBe(0.134)
  })
})
