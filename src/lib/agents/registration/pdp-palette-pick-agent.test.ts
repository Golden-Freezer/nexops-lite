/**
 * K 색 조합 비전 고르기 콜(결정 카드 c28, 하네스 J26) — 라우트 design/palette-pick·agent registration/pdp-palette-pick로, 원본 사진 1장 뒤에
 * 견본 3장과 글을 붙여 보낸다. 실패는 던지지 않고 value null. 공급자 호출(callLlm)은 모의(유료 호출 0), 견본 PNG는 로컬 sharp
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ callLlm: vi.fn() }))
vi.mock('../llm', () => ({ callLlm: (...a: unknown[]) => h.callLlm(...a) }))

import sharp from 'sharp'
import { pickPaletteByVision, swatchImageOf } from './pdp-palette-pick-agent'
import { PDP_MODEL_ROUTES } from '@/lib/registration/pdp-model-routes'
import { CONCEPTS } from '@/lib/registration/templatelib/concepts'
import { buildPalettePickPrompt, PALETTE_PICK_SYSTEM, paletteCandidatesOf } from '@/lib/registration/templatelib/palette-pick'

const PHOTO = { mediaType: 'image/jpeg' as const, data: 'PHOTO' }
const RUN = { userId: 'user-1', stage: 'images/templatelib' }
const candidates = paletteCandidatesOf(CONCEPTS[0], '#2f6fd0')
const INPUT = { product: '데이지 머리끈', candidates }
const swatch = vi.fn(async (set: (typeof candidates)[number]) => ({ mediaType: 'image/png' as const, data: `SW-${set.id}` }))

beforeEach(() => {
  h.callLlm.mockReset()
  swatch.mockClear()
})

describe('pickPaletteByVision', () => {
  it('design/palette-pick 라우트·agent 이름·runContext로 사진 1장 + 견본 3장 + 글을 보내고 고른 번호를 돌려준다', async () => {
    h.callLlm.mockImplementation(async (_route, _req, parse: (t: string) => unknown) => ({
      success: true,
      data: parse('{"pick":"C","reason":"차분한 바탕"}'),
      usage: { cost: 0.004 },
    }))
    const out = await pickPaletteByVision(PHOTO, INPUT, RUN, { swatch })
    expect(out).toEqual({ value: { index: 2, reason: '차분한 바탕' }, usedFallback: false, error: null, costUsd: 0.004 })
    const [route, req] = h.callLlm.mock.calls[0]
    expect(route).toEqual(PDP_MODEL_ROUTES['design/palette-pick'])
    expect(req).toMatchObject({ system: PALETTE_PICK_SYSTEM, agentName: 'registration/pdp-palette-pick', runContext: RUN, timeoutMs: 45_000 })
    const content = req.messages[0].content
    expect(content.map((b: { type: string }) => b.type)).toEqual(['image', 'image', 'image', 'image', 'text'])
    expect(content.slice(0, 4).map((b: { source: { data: string } }) => b.source.data)).toEqual(['PHOTO', ...candidates.map((set) => `SW-${set.id}`)])
    expect(content[0].source.media_type).toBe('image/jpeg')
    expect(content[4].text).toBe(buildPalettePickPrompt(INPUT))
  })

  it('콜이 실패하면 value null·까닭·든 비용(던지지 않는다)', async () => {
    h.callLlm.mockResolvedValue({ success: false, error: new Error('색 고르기 답이 후보 밖: D'), usage: { cost: 0.002 } })
    const out = await pickPaletteByVision(PHOTO, INPUT, RUN, { swatch })
    expect(out).toEqual({ value: null, usedFallback: true, error: '색 고르기 답이 후보 밖: D', costUsd: 0.002 })
  })

  it('견본을 못 만들면 부르지 않고 value null', async () => {
    const broken = vi.fn(async () => {
      throw new Error('sharp 없음')
    })
    const out = await pickPaletteByVision(PHOTO, INPUT, RUN, { swatch: broken })
    expect(h.callLlm).not.toHaveBeenCalled()
    expect(out).toEqual({ value: null, usedFallback: true, error: '견본 만들기 실패: sharp 없음', costUsd: 0 })
  })
})

describe('swatchImageOf', () => {
  it('견본 SVG를 300×200 PNG로 바꾼다', async () => {
    const image = await swatchImageOf(candidates[0])
    expect(image.mediaType).toBe('image/png')
    const meta = await sharp(Buffer.from(image.data, 'base64')).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 300, height: 200 })
  })
})
