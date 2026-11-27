import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertLocalCodex, LOCAL_CODEX_ONLY_MESSAGE } from './guard'

afterEach(() => vi.unstubAllEnvs())

describe('assertLocalCodex', () => {
  it('VERCEL 환경에서는 사람이 읽을 수 있는 안내로 차단한다', () => {
    vi.stubEnv('VERCEL', '1')
    expect(() => assertLocalCodex()).toThrow(LOCAL_CODEX_ONLY_MESSAGE)
  })

  it('로컬 환경에서는 통과한다', () => {
    vi.stubEnv('VERCEL', '')
    expect(() => assertLocalCodex()).not.toThrow()
  })
})
