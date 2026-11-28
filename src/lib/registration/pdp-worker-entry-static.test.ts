/** 라이트에는 원격 구독 작업자 진입점이 없고, 텍스트 실행은 로컬 Codex 한 경로다. 실행 없이 정적 경계만 확인한다. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('라이트 상세페이지 실행 진입점', () => {
  it('원격 구독 작업자 스크립트가 없고 callLlm은 callAgent 한 경로만 쓴다', () => {
    expect(existsSync(join(process.cwd(), 'scripts/pdp-worker/worker.mts'))).toBe(false)

    const llm = readFileSync(join(process.cwd(), 'src/lib/agents/llm/index.ts'), 'utf8')
    expect(llm).toMatch(/return callAgent\(/)
    expect(llm).not.toMatch(/callGemini|callOpenAiChat|local-llm-backend/)
  })

  it('callAgent가 로컬 codexText를 사용하고 API 공급자 모듈을 가져오지 않는다', () => {
    const base = readFileSync(join(process.cwd(), 'src/lib/agents/_base.ts'), 'utf8')
    expect(base).toMatch(/import \{ codexText,[^}]+\} from '@\/lib\/local-codex\/llm'/)
    expect(base).toMatch(/await codexText\(/)
    expect(base).not.toMatch(/providers\/(?:anthropic|gemini|openai)|callOpenAiChat/)
  })
})
