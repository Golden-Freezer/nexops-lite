/**
 * 동시 풀(runWithConcurrency) — 오류 때 진행 중인 일을 끝까지 기다리는지, 선행 대기 일이 교착 없이 남는지(순수, 외부 호출 0).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ budget: vi.fn() }))
vi.mock('@/lib/agents/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/budget')>()),
  checkMonthlyBudget: (...args: unknown[]) => h.budget(...args),
}))

import { estimateImageCostUsd } from '@/lib/agents/image/types'
import { GATE_RESERVE_USD } from './job-cost-cap'
import { createSpendGate, runWithConcurrency } from './pdp-image-pool'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('runWithConcurrency', () => {
  it('일 하나가 던지면 새 일을 시작하지 않고, 진행 중인 일이 끝난 뒤에 첫 오류를 던진다', async () => {
    const log: string[] = []
    const run = runWithConcurrency(['a', 'b', 'c', 'd'], 2, {
      ready: () => true,
      canStart: () => true,
      run: async (item) => {
        log.push(`start:${item}`)
        if (item === 'a') {
          await sleep(5)
          throw new Error('a 실패')
        }
        await sleep(40)
        log.push(`end:${item}`)
      },
    })
    await expect(run.catch((e: Error) => (log.push('rejected'), Promise.reject(e)))).rejects.toThrow('a 실패')
    expect(log).toEqual(['start:a', 'start:b', 'end:b', 'rejected'])
  })

  it('선행을 기다리는 일은 진행 중인 일이 없으면 시작하지 않고 남긴다(교착 없음) — 시간·지출이 막히면 거기서 멈춘다', async () => {
    const started: string[] = []
    const out = await runWithConcurrency(['hero', 'x', 'y'], 4, {
      ready: (item) => item === 'hero',
      canStart: () => true,
      run: async (item) => {
        started.push(item)
      },
    })
    expect(out).toEqual({ started: ['hero'], skipped: ['x', 'y'] })

    const blocked = await runWithConcurrency(['p', 'q', 'r'], 4, {
      ready: () => true,
      canStart: (item) => item === 'p',
      run: async () => {},
    })
    expect(blocked).toEqual({ started: ['p'], skipped: ['q', 'r'] })
  })
})

describe('createSpendGate — 조회 실패면 닫힘·잡 비용 상한 몫(점검 고침 5)', () => {
  const MODEL = 'gpt-image-2'
  const unit = estimateImageCostUsd(MODEL, 'medium')
  beforeEach(() => h.budget.mockReset().mockResolvedValue({ allowed: true, spentUsd: 0, budgetUsd: 1000 }))

  it('월 예산을 읽지 못하면(degraded) 제공자 이미지를 막고 그 까닭을 남긴다 — 로컬 백엔드는 예약하지 않아 그대로다', async () => {
    h.budget.mockResolvedValue({ allowed: false, spentUsd: 0, budgetUsd: 50, degraded: true, degradedReason: 'db' })
    const gate = await createSpendGate('registration/pdp-image')
    expect(gate.degraded).toBe(true)
    expect(gate.tryReserve(MODEL, 'medium')).toBe(false)
    expect(gate.lastBlock).toBe('month')
    expect(gate.tryReserve('codex-image', 'medium')).toBe(true)
  })

  it('잡 몫을 주면 컷마다 단가 + 게이트 몫을 빼고, 모자라면 job으로 막는다 — 월 한도는 그대로 남는다', async () => {
    const gate = await createSpendGate('registration/pdp-image', undefined, (unit + GATE_RESERVE_USD) * 2 + 0.0001)
    expect(gate.degraded).toBe(false)
    expect(gate.lastBlock).toBeNull()
    expect(gate.tryReserve(MODEL, 'medium')).toBe(true)
    expect(gate.tryReserve(MODEL, 'medium')).toBe(true)
    expect(gate.tryReserve(MODEL, 'medium')).toBe(false)
    expect(gate.lastBlock).toBe('job')
  })

  it('잡 몫이 없으면(편집기 재생성) 월 한도만 본다 — 월 한도가 먼저 바닥나면 month', async () => {
    h.budget.mockResolvedValue({ allowed: true, spentUsd: 1000 - unit * 1.5, budgetUsd: 1000 })
    const gate = await createSpendGate('registration/pdp-image')
    expect(gate.tryReserve(MODEL, 'medium')).toBe(true)
    expect(gate.tryReserve(MODEL, 'medium')).toBe(false)
    expect(gate.lastBlock).toBe('month')
  })
})
