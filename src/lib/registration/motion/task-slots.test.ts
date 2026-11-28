/**
 * 움직이는 칸 자리 규칙 태스크·계획(세션 B) — 대표 칸 태스크(templatelib.motion.hero 기록 잡만)·고른 칸 태스크·계획 AI 고르기(planMotion).
 * 옵션 사진 입력은 가짜다(lineInputsOf). 모델 콜은 가짜다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '../pdp-state'
import type { LineShot } from '../templatelib/shot-brief'
import type { MotionPlanRecord } from './pick'

const h = vi.hoisted(() => ({ options: [] as Array<{ label: string; image: string | null }> }))
vi.mock('../templatelib/input-values', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../templatelib/input-values')>()),
  lineInputsOf: () => ({ options: h.options }),
}))

const { heroMotionTaskOf, motionTaskOf, HERO_MOTION_ACTION } = await import('./task')
const { planMotion } = await import('../templatelib/line-plan')

const ON = ['designcut', 'templatelib', 'motionband']
const OFF = ['designcut', 'templatelib']
const record = (over: Partial<MotionPlanRecord> = {}): MotionPlanRecord => ({ engine: 'gif-sheet', hero: true, cells: [], candidates: 0, max: 2, rejected: 0, ...over })
const jobOf = (features: string[], motion?: MotionPlanRecord) =>
  ({
    id: 'J1',
    spec_sheet: { productName: '시험 상품', usageLocation: '거실' },
    analysis: { enrichment: { version: 1, features } },
    section_plan: { templatelib: motion ? { motion } : {} },
  }) as unknown as PdpJobRow
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `옵션${i}`, image: `https://example.com/o${i}.jpg` }))
const lineShot = (key: string, over: Partial<LineShot> = {}): LineShot => ({ key, section: 'how_to', purpose: 'action', composition: 'in_use', aspect: '3:4', show: '누르는 모습', ...over })

beforeEach(() => {
  h.options = []
})

describe('대표 칸 태스크', () => {
  it('motionband 잡이 계획 기록에 대표 칸을 정했을 때만 — 비율은 정지 대표 컷과 같다', () => {
    expect(heroMotionTaskOf(jobOf(ON, record()), '3:4')).toEqual({ action: HERO_MOTION_ACTION, mode: 'gif', loop: 'back_and_forth', optionPhotos: [], role: 'hero', aspect: '3:4' })
  })

  it('기록 없는 잡(옛 motionband 잡)·스위치 꺼진 잡·인쇄물(hero false)은 없다 — 태스크 바이트 그대로', () => {
    expect(heroMotionTaskOf(jobOf(ON), '3:4')).toBeUndefined()
    expect(heroMotionTaskOf(jobOf(OFF, record()), '3:4')).toBeUndefined()
    expect(heroMotionTaskOf(jobOf(ON, record({ hero: false })), '3:4')).toBeUndefined()
    expect(heroMotionTaskOf({ ...jobOf(ON), section_plan: undefined } as unknown as PdpJobRow, '3:4')).toBeUndefined()
  })
})

describe('고른 칸 태스크', () => {
  const cells = [
    { key: 'k3_a', kind: 'transform' as const, reason: '접히는 모습' },
    { key: 'k5_a', kind: 'slide' as const, reason: '색 비교' },
  ]

  it('기록에 고른 컷은 그 칸 비율의 GIF — 변형은 결과에서 머무름, 까닭을 든다', () => {
    const job = jobOf(ON, record({ cells }))
    expect(motionTaskOf(job, { section: 'how_to', show: '접는 모습', key: 'k3_a', aspect: '3:4' }, false)).toEqual({
      action: '접는 모습',
      mode: 'gif',
      loop: 'ends_in_result',
      optionPhotos: [],
      role: 'pick',
      aspect: '3:4',
      reason: '접히는 모습',
    })
  })

  it('옵션 밀기는 실물 옵션 사진 2장 이상일 때만, GIF는 인쇄물이 아닐 때만', () => {
    const job = jobOf(ON, record({ cells }))
    expect(motionTaskOf(job, { section: 'option_lineup', show: '색', key: 'k5_a', aspect: '1:1' }, false)).toBeUndefined()
    h.options = photos(2)
    expect(motionTaskOf(job, { section: 'option_lineup', show: '색', key: 'k5_a', aspect: '1:1' }, true)).toMatchObject({ mode: 'slide', role: 'pick', optionPhotos: ['https://example.com/o0.jpg', 'https://example.com/o1.jpg'] })
    expect(motionTaskOf(job, { section: 'how_to', show: '접는 모습', key: 'k3_a', aspect: '3:4' }, true)).toBeUndefined()
  })

  it('기록에 없는 컷·스위치 꺼진 잡은 undefined다', () => {
    expect(motionTaskOf(jobOf(ON, record({ cells })), { section: 'how_to', show: 'x', key: 'k9_a', aspect: '3:4' }, false)).toBeUndefined()
    expect(motionTaskOf(jobOf(OFF, record({ cells })), { section: 'how_to', show: 'x', key: 'k3_a', aspect: '3:4' }, false)).toBeUndefined()
  })
})

describe('계획 AI 고르기(planMotion)', () => {
  const shots = [lineShot('k1_a'), lineShot('k2_a', { section: 'point', purpose: 'state' }), lineShot('k3_a', { section: 'faq', purpose: 'texture', composition: 'front' })]
  const opts = { product: '시험 상품', textBearing: false, optionPhotos: 0, hasBand: false }

  it('후보 안에서만 고르고 상한(대표 포함 3)·까닭·비용을 기록한다', async () => {
    const pick = vi.fn(async () => ({
      picks: [
        { key: 'k1_a', kind: 'use', reason: '누르는 힘이 보인다' },
        { key: 'k3_a', kind: 'use', reason: '후보 밖' },
        { key: 'k2_a', kind: 'transform', reason: '바뀌는 모습' },
      ],
      costUsd: 0.01,
      error: null,
    }))
    const out = await planMotion(shots, opts, pick)
    expect(pick).toHaveBeenCalledWith({ product: '시험 상품', candidates: expect.any(Array), max: 2 })
    expect((pick.mock.calls[0] as unknown as [{ candidates: Array<{ key: string }> }])[0].candidates.map((c) => c.key)).toEqual(['k1_a', 'k2_a'])
    expect(out).toEqual({
      engine: 'gif-sheet',
      hero: true,
      cells: [
        { key: 'k1_a', kind: 'use', reason: '누르는 힘이 보인다' },
        { key: 'k2_a', kind: 'transform', reason: '바뀌는 모습' },
      ],
      candidates: 2,
      max: 2,
      rejected: 1,
      costUsd: 0.01,
    })
  })

  it('motion_band가 있으면 한 칸만 고른다. 인쇄물은 대표 칸 없이(까닭) GIF 후보도 없어 콜을 부르지 않는다', async () => {
    const pick = vi.fn(async () => ({ picks: [], costUsd: 0, error: null }))
    expect((await planMotion(shots, { ...opts, hasBand: true }, pick)).max).toBe(1)
    pick.mockClear()
    const printed = await planMotion(shots, { ...opts, textBearing: true }, pick)
    expect(printed).toMatchObject({ hero: false, heroReason: expect.stringContaining('인쇄물'), cells: [], candidates: 0, max: 3 })
    expect(pick).not.toHaveBeenCalled()
  })

  it('콜이 실패해도 대표 칸은 남고 까닭을 적는다', async () => {
    const out = await planMotion(shots, opts, async () => ({ picks: [], costUsd: 0.002, error: 'timeout' }))
    expect(out).toMatchObject({ hero: true, cells: [], error: 'timeout', costUsd: 0.002 })
  })
})
