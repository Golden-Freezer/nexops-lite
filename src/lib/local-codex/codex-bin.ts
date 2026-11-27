import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'

const OUTPUT_TAIL_BYTES = 16 * 1024
const KILL_GRACE_MS = 10_000

const SECRET_ENV_PATTERN =
  /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|DATABASE_URL|_DSN$|^PG|_AK$|LICENSE/i

export interface CodexChildProcess {
  pid?: number
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: (code: number | null) => void): this
}

export type SpawnCodex = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: boolean
    detached: boolean
    shell: false
  },
) => CodexChildProcess

export interface CodexRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  killUnconfirmed?: boolean
  spawnError?: string
}

interface RunDependencies {
  spawnImpl?: SpawnCodex
  spawnSyncImpl?: typeof spawnSync
  platform?: NodeJS.Platform
}

export function codexCommandCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const configured = env.NEXOPS_CODEX_BIN?.trim()
  if (configured) return [configured]
  if (platform !== 'win32') return ['codex']
  // npm install -g @openai/codex 는 codex.cmd만 만든다. Node는 shell 없이 .cmd를 실행하지 못하므로
  // 같은 패키지의 bin/codex.js를 node로 직접 실행한다(.js 후보는 runCodexProcess가 node로 돌린다).
  const candidates = ['codex']
  const npmRoots = [env.APPDATA ? path.win32.join(env.APPDATA, 'npm', 'node_modules') : '', env.NEXOPS_NPM_ROOT ?? ''].filter(Boolean)
  for (const root of npmRoots) candidates.push(path.win32.join(root, '@openai', 'codex', 'bin', 'codex.js'))
  return candidates
}

/** Codex에는 ChatGPT 로그인만 전달하고 API 키·서비스 비밀값은 전달하지 않는다. */
export function sanitizeCodexEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => value !== undefined && !SECRET_ENV_PATTERN.test(key)),
  ) as NodeJS.ProcessEnv
}

function defaultSpawn(command: string, args: string[], options: Parameters<SpawnCodex>[2]): CodexChildProcess {
  return spawn(command, args, options) as CodexChildProcess
}

function killTree(
  child: CodexChildProcess,
  platform: NodeJS.Platform,
  spawnSyncImpl: typeof spawnSync,
): void {
  if (!child.pid) return
  if (platform === 'win32') {
    spawnSyncImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function runOnce(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; timeoutMs: number },
  dependencies: RunDependencies,
): Promise<CodexRunResult> {
  const spawnImpl = dependencies.spawnImpl ?? defaultSpawn
  const spawnSyncImpl = dependencies.spawnSyncImpl ?? spawnSync
  const platform = dependencies.platform ?? process.platform

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: Pick<CodexRunResult, 'exitCode' | 'spawnError' | 'killUnconfirmed'>) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      resolve({ ...result, stdout, stderr, timedOut })
    }

    let child: CodexChildProcess
    try {
      child = spawnImpl(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: platform !== 'win32',
        shell: false,
      })
    } catch (error) {
      finish({ exitCode: null, spawnError: error instanceof Error ? error.message : String(error) })
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree(child, platform, spawnSyncImpl)
      graceTimer = setTimeout(
        () => finish({ exitCode: null, killUnconfirmed: true }),
        KILL_GRACE_MS,
      )
    }, options.timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES)
    })
    child.stdin.on('error', () => {})
    child.on('error', (error) => finish({ exitCode: null, spawnError: error.message }))
    child.on('close', (code) => finish({ exitCode: code }))
    child.stdin.end(options.stdin)
  })
}

/** 실행 파일 탐색 실패 시 Windows에서 npm 전역 설치본(bin/codex.js)까지 시도한다. */
export async function runCodexProcess(
  input: {
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    stdin: string
    timeoutMs: number
    commands?: string[]
  },
  dependencies: RunDependencies = {},
): Promise<CodexRunResult> {
  const commands = input.commands ?? codexCommandCandidates(process.env, dependencies.platform)
  let last: CodexRunResult | null = null
  for (const command of commands) {
    const viaNode = command.toLowerCase().endsWith('.js')
    const result = viaNode
      ? await runOnce(process.execPath, [command, ...input.args], input, dependencies)
      : await runOnce(command, input.args, input, dependencies)
    last = result
    if (!result.spawnError) return result
  }
  return last ?? {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    spawnError: 'Codex CLI 실행 파일을 찾을 수 없습니다.',
  }
}
