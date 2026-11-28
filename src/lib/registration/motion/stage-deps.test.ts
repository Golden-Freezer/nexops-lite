/**
 * GIF 칸 바깥 호출 묶음(motion/stage-deps.ts) — generateImage를 가짜로 바꿔 GIF 요청 꼴만 본다(유료 GIF 호출·네트워크 0).
 * 고정(세션 B ③ P6): 프레임 768²·9프레임·200ms·2.6 high·참조 첨부, 그 크기·프레임이 시트 한도(animationRequestError) 안.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { generateImage } from '@/lib/agents/image/generate'
import { animationRequestError, type GenImageInput } from '@/lib/agents/image/types'
import { buildEnrichmentRecord } from '../enrichment-switch'
import { buildMotionCell } from './stage'
import { MOTION_MODEL, MOTION_SHEET_MODEL, motionDepsOf, motionEngineValuesOf, motionRefModelOf, type MotionRunValues } from './stage-deps'

vi.mock('@/lib/agents/image/generate', () => ({ generateImage: vi.fn(async () => ({ base64: 'R0lG', mimeType: 'image/gif', costUsd: 0.13 })) }))
vi.mock('@/lib/agents/registration/pdp-image-agent', () => ({ judgeImageGate: vi.fn() }))
vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({ fetchImageAsBase64: vi.fn() }))
vi.mock('../storage', () => ({ uploadPdpImage: vi.fn() }))

describe('motionDepsOf — GIF 요청 꼴', () => {
  it('2.6 high에 프레임 768²·9프레임·200ms·호출 상한을 넘기고, 그 요청은 부르기 전 검사(시트 2,304²)를 통과한다', async () => {
    const deps = motionDepsOf({
      db: {} as SupabaseClient,
      userId: 'u',
      jobId: 'j',
      section: 'k17_clip_0',
      sourceRefs: [{ data: 'cmVm', mediaType: 'image/jpeg' }],
      runContext: {} as never,
      runStart: Date.now(),
      budgetMs: 280_000,
      agentName: 'registration/pdp-image',
    })
    expect(await deps.generateGif('PROMPT', 190_000)).toEqual({ base64: 'R0lG', costUsd: 0.13 })
    const input = vi.mocked(generateImage).mock.calls[0][0] as GenImageInput
    expect(input).toMatchObject({
      prompt: 'PROMPT',
      model: 'gpt-image-2.6-sunburst',
      quality: 'high',
      size: '768x768',
      referenceImages: [{ base64: 'cmVm', mimeType: 'image/jpeg' }],
      animation: { frameCount: 9, frameDurationMs: 200, totalMs: 190_000 },
    })
    expect(input.model).toBe(MOTION_MODEL)
    expect(animationRequestError(input.model, input.animation!, input.size)).toBeNull()
  })
})

const runValues = (over: Partial<MotionRunValues> = {}): MotionRunValues => ({
  db: {} as SupabaseClient,
  userId: 'u',
  jobId: 'j',
  section: 'k17_clip_0',
  sourceRefs: Array.from({ length: 7 }, (_, i) => ({ data: `cmVm${i}`, mediaType: 'image/jpeg' })),
  runContext: {} as never,
  runStart: Date.now(),
  budgetMs: 280_000,
  agentName: 'registration/pdp-image',
  ...over,
})
const offJob = { analysis: { enrichment: buildEnrichmentRecord(['templatelib', 'motionband']) } }
const onJob = { analysis: { enrichment: buildEnrichmentRecord(['templatelib', 'motionband', 'motioncodex']) } }

describe('motionDepsOf — 구독 시트 엔진(AX-CT-35)은 꺼진 채', () => {
  it('꺼진 잡(motioncodex 없음)은 펼칠 값이 없고, 묶음에 engine 칸이 없어 stage가 지금처럼 gif-sheet를 쓴다', () => {
    expect(motionEngineValuesOf(offJob)).toEqual({})
    expect(motionEngineValuesOf({ analysis: null })).toEqual({})
    expect(motionRefModelOf(offJob)).toBe(MOTION_MODEL)
    const deps = motionDepsOf({ ...runValues(), ...motionEngineValuesOf(offJob) })
    expect(Object.keys(deps).sort()).toEqual(['budgetMs', 'elapsedMs', 'fetchPhoto', 'generateGif', 'judgeSheet', 'upload'])
  })

  it('켜진 잡만 codex-sheet 엔진을 달고, 그 엔진은 구독 이미지(codex-image)를 시트 크기·참조 5장 안·애니메이션 없이 부른다', async () => {
    expect(motionEngineValuesOf(onJob)).toEqual({ engineId: 'codex-sheet' })
    expect(motionRefModelOf(onJob)).toBe(MOTION_SHEET_MODEL)
    const deps = motionDepsOf({ ...runValues({ tailRefs: [{ data: 'aGVybw', mediaType: 'image/png' }] }), ...motionEngineValuesOf(onJob) })
    expect(deps.engine?.id).toBe('codex-sheet')
    vi.mocked(generateImage).mockClear()
    // 가짜 응답은 PNG가 아니라 자르기에서 던진다 — 요청 꼴만 본다
    await deps.engine!.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '3:4', timeoutMs: 90_000 }).catch(() => null)
    const input = vi.mocked(generateImage).mock.calls[0][0] as GenImageInput
    expect(input).toMatchObject({ model: 'codex-image', size: '1968x2640', agentName: 'registration/pdp-image' })
    expect(input.animation).toBeUndefined()
    expect(input.quality).toBeUndefined()
    expect(input.prompt).toContain('SHEET LAYOUT')
    expect(input.referenceImages).toHaveLength(5)
    expect(input.referenceImages?.at(-1)).toEqual({ base64: 'aGVybw', mimeType: 'image/png' })
  })
})

describe('구독 시트가 실패하면 API로 잇지 않는다(AX-CT-35 규칙 7 — 검수 r1 S2)', () => {
  it('켠 잡에서 구독 이미지가 던지면 칸은 지금 실패 길(정지 컷)로 가고, 2.6 GIF(애니메이션) 호출은 0번이다', async () => {
    vi.mocked(generateImage).mockReset()
    vi.mocked(generateImage).mockRejectedValue(new Error('codex-image 로컬 백엔드가 등록돼 있지 않습니다'))
    const deps = motionDepsOf({ ...runValues(), ...motionEngineValuesOf(onJob) })
    const out = await buildMotionCell({ action: 'a', mode: 'gif', loop: 'back_and_forth', optionPhotos: [] }, 'BASE', deps)
    expect(out.cell).toBeNull()
    expect(out.reasons.join(' · ')).toContain('GIF 실패: codex-image 로컬 백엔드가 등록돼 있지 않습니다')
    const calls = vi.mocked(generateImage).mock.calls.map((c) => c[0] as GenImageInput)
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('codex-image')
    expect(calls.filter((c) => c.animation || c.model === MOTION_MODEL)).toHaveLength(0)
    vi.mocked(generateImage).mockReset()
    vi.mocked(generateImage).mockResolvedValue({ base64: 'R0lG', mimeType: 'image/gif', costUsd: 0.13 } as never)
  })
})
