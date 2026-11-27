import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  codexCommandCandidates,
  runCodexProcess,
  sanitizeCodexEnv,
  type CodexChildProcess,
  type SpawnCodex,
} from './codex-bin'

class FakeChild extends EventEmitter implements CodexChildProcess {
  pid = 1234
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

describe('codex-bin', () => {
  it('환경 변수 실행 파일을 우선하고 Windows에서는 npm 전역 codex.js도 후보로 둔다', () => {
    expect(codexCommandCandidates({ NODE_ENV: 'test', NEXOPS_CODEX_BIN: 'C:\\tools\\codex.exe' }, 'win32'))
      .toEqual(['C:\\tools\\codex.exe'])
    expect(codexCommandCandidates({ NODE_ENV: 'test', APPDATA: String.raw`C:\Users\a\AppData\Roaming` }, 'win32'))
      .toEqual(['codex', String.raw`C:\Users\a\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js`])
    expect(codexCommandCandidates({} as NodeJS.ProcessEnv, 'linux')).toEqual(['codex'])
  })

  it('API 키와 비밀 환경 변수를 자식 환경에서 제거한다', () => {
    const result = sanitizeCodexEnv({
      NODE_ENV: 'test',
      PATH: 'bin',
      OPENAI_API_KEY: 'openai-secret',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      GEMINI_API_KEY: 'gemini-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    })
    expect(result).toEqual({ NODE_ENV: 'test', PATH: 'bin' })
  })

  it('shell 없이 인자 배열로 실행하고 .js 후보는 node로 실행한다', async () => {
    const calls: Array<{ command: string; args: string[]; options: Parameters<SpawnCodex>[2] }> = []
    const spawnImpl: SpawnCodex = (command, args, options) => {
      calls.push({ command, args, options })
      const child = new FakeChild()
      queueMicrotask(() => {
        if (command === 'codex') child.emit('error', new Error('ENOENT'))
        else {
          child.stdout.write('ok')
          child.emit('close', 0)
        }
      })
      return child
    }

    const result = await runCodexProcess(
      {
        args: ['exec', '--sandbox', 'read-only', '-'],
        cwd: 'C:\\tmp\\job',
        env: { NODE_ENV: 'test', PATH: 'bin' },
        stdin: 'prompt',
        timeoutMs: 1000,
        commands: ['codex', String.raw`C:\npm\codex.js`],
      },
      { spawnImpl, platform: 'win32' },
    )

    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok', timedOut: false })
    expect(calls.map((call) => call.command)).toEqual(['codex', process.execPath])
    expect(calls[1].args).toEqual([String.raw`C:\npm\codex.js`, 'exec', '--sandbox', 'read-only', '-'])
    expect(calls[1].options).toMatchObject({ shell: false, windowsHide: true, detached: false })
  })
})
