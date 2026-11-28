/**
 * 정적 시험(AX-PL-17 ②′b) — 상세페이지 구독 작업자 진입점(scripts/pdp-worker/worker.mts) 글만 읽어 '오너 id 없음' 시작 경고 자리를 고정한다.
 * worker.mts 는 실행하지 않는다(tsx·DB·LLM 0). 경고가 시작을 막는 문제(problems)나 점검 끝 코드에 섞이지 않고, 두 갈래(--selfcheck·상주)에서 한 번씩 적히는지 본다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'scripts/pdp-worker/worker.mts'), 'utf8').replace(/\r\n/g, '\n')
const CALL = 'worker.workerEnvWarnings(process.env)'
const positions = (needle: string): number[] => {
  const found: number[] = []
  for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) found.push(at)
  return found
}

describe('worker.mts 시작 경고(오너 id 없음) 자리', () => {
  it('① workerEnvWarnings(process.env) 가 두 번 — selfcheck 갈래와 상주 갈래', () => {
    expect(positions(CALL)).toHaveLength(2)
    const selfcheckStart = source.indexOf('if (flags.selfcheck) {')
    const pingLine = source.indexOf('if (flags.ping)')
    const [first] = positions(CALL)
    expect(selfcheckStart).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(selfcheckStart)
    expect(first).toBeLessThan(pingLine)
  })

  it("② 상주 갈래 것은 'if (stopping) return 0' 뒤, 'if (problems.length > 0)' 앞", () => {
    const stopping = source.indexOf('if (stopping) return 0')
    const problemsGate = source.indexOf('if (problems.length > 0) {')
    const [, second] = positions(CALL)
    expect(stopping).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(stopping)
    expect(second).toBeLessThan(problemsGate)
  })

  it('③ selfcheck 끝 코드 줄은 그대로 — 경고는 끝 코드에 들지 않는다', () => {
    const lines = source.split('\n').filter((line) => line.includes('problems.length === 0 ? 0 : 1'))
    expect(lines.map((line) => line.trim())).toContain('return problems.length === 0 ? 0 : 1')
    const [first] = positions(CALL)
    const endCode = source.indexOf('return problems.length === 0 ? 0 : 1')
    expect(endCode).toBeGreaterThan(first)
    // 경고는 problems 에 섞이지 않는다 — 경고를 problems 로 밀어 넣는 줄이 없다
    expect(source).not.toMatch(/problems\.push\([^)]*[Ww]arning/)
  })
})
