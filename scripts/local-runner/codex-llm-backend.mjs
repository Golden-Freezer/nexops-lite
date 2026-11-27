/**
 * 코덱스 구독 LLM 백엔드(pdp-llm-subscription-backend) — 텍스트·비전 1콜을 `codex exec`로 돌린다(ChatGPT 로그인, API 과금 없음).
 *
 * 로컬 실행기(실 테스트 하네스)가 `registerLocalLlmBackend('codex-cli', createCodexLlmBackendFromEnv().backend)`로 등록해 쓴다.
 * child_process는 이 파일(scripts/)에만 있고 Next 번들에는 들어가지 않는다. 실행 함수는 이미지 백엔드와 같은 것을 쓴다.
 *
 * 1콜 = `codex exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only -C <빈 임시 폴더>
 *        -m <모델> [-c model_reasoning_effort="<effort>"] --json -o <임시 폴더>/last-message.txt [-i <이미지>…] -`
 * - 전용 CODEX_HOME(NEXOPS_CODEX_HOME)으로 돈다 — 전역 ~/.codex/AGENTS.md(개발 지침)·config.toml(기본 모델·추론 수준)이
 *   상세페이지 프롬프트에 섞이지 않게. --ignore-user-config는 config.toml만 건너뛰고 AGENTS.md는 읽기 때문이다. 폴더가 없거나
 *   AGENTS.md·AGENTS.override.md가 있거나 ChatGPT 로그인이 아니면(API 키 로그인 포함) 만들지 않고 사유를 돌려준다. 로그인은 오너 몫(`CODEX_HOME=<폴더> codex login`).
 * - 자식 환경에서 API 키와 그 밖의 비밀값(이름에 KEY·SECRET·TOKEN 등) env를 뺀다(구독 로그인만, 비밀값이 모델 문맥에 들어가지 않게).
 * - 프롬프트: 시스템·사용자 메시지를 표지가 있는 한 덩어리로 파일 → stdin. 코덱스는 자체 에이전트 하네스 위에서 이 글을 받으므로,
 *   명령·파일 없이 요청한 형식의 답만 마지막 메시지로 내라는 머리말을 붙인다.
 * - 답: -o 파일(마지막 메시지). 토큰: --json 이벤트 중 usage가 든 마지막 이벤트(형태는 첫 smoke에서 실측해 고정한다 — 못 읽으면 null).
 * - 한도 소진·시간 초과·로그인 만료·구독에서 못 쓰는 모델은 재시도하지 않고 소프트 종료 오류(softStop 표지)를 던진다. 빈 답·비정상 종료는 1회 다시 시도한다.
 * - run 기한(request.deadlineAt, R11e): 있으면 실행마다 시간 제한을 남은 시간 안으로 줄이고, 15초 미만이면 부르지 않고 기한 오류
 *   (LLM_DEADLINE_EXHAUSTED_CODE, 소프트 종료 아님)를 던진다. 없으면 지금 그대로다.
 */

import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertAllowedArgs,
  createLimiter,
  isQuotaFailure,
  runCodexOnce,
  sanitizeCodexEnv,
} from './codex-image-backend.mjs'

/** src/lib/agents/llm/local-llm-backend.ts와 같은 값(시험이 대조) */
export const LOCAL_LLM_SOFT_STOP_MARKER = '[local-llm:soft-stop]'
/** codex model_reasoning_effort가 받는 값 — max는 없다 */
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const OUTPUT_FILE = 'last-message.txt'
const PROMPT_FILE = 'PROMPT.md'

const PREAMBLE =
  '이 작업은 글로만 답한다. 명령을 실행하거나 파일을 만들거나 고치지 말고, 아래 [지시]를 따르며 [요청]에 대한 답만 ' +
  '마지막 메시지로 낸다. [요청]이 JSON을 요구하면 JSON만 낸다(설명·코드 블록 없이).'

const SOFT_STOP = {
  quota: { label: '구독 한도 소진', code: 'CODEX_QUOTA_EXHAUSTED' },
  timeout: { label: '시간 초과(timeout)', code: 'CODEX_TIMEOUT' },
  unavailable: { label: '로그인 만료·구독에서 쓸 수 없는 모델', code: 'CODEX_UNAVAILABLE' },
}

function softStopError(reason, detail) {
  const { label, code } = SOFT_STOP[reason]
  const error = new Error(`${LOCAL_LLM_SOFT_STOP_MARKER} ${reason}: codex-cli ${label} — ${detail}`)
  error.code = code
  error.softStop = true
  error.softStopReason = reason
  return error
}

// 로그인 만료·API 키 로그인 거부·구독에서 못 쓰는 모델 — 일반 실패로 두면 2회 시도 뒤 호출부가 이전 단계 결과로 넘어간다(검수 지적).
// 401은 상태 표기 꼴로만 본다(답 글 속 숫자 오탐 방지). 일시적 과부하('not available')는 넣지 않는다 — 다시 시도하면 되는 실패다
const UNAVAILABLE_PATTERN =
  /(status|http|code)[: ]*401|401 unauthori[sz]ed|unauthori[sz]ed:|not logged in|codex login|log ?in (again|required)|(access|refresh) token[^\n]*(expired|invalid|revoked|could not be refreshed)|model_not_found|model[^\n]*(does not exist|is not supported|isn't supported)|unsupported model/i
const TAIL_LINES = 6
/** --json 이벤트 중 실패를 알리는 것만 본다 — 답(agent_message) 글은 모델이 쓴 문장이라 오탐이 난다(검수 지적) */
const FAILURE_EVENT_TYPES = new Set(['error', 'turn.failed'])

function failureText(line) {
  if (!line.startsWith('{')) return line
  try {
    const event = JSON.parse(line)
    return FAILURE_EVENT_TYPES.has(event?.type) ? JSON.stringify(event) : ''
  } catch {
    return line
  }
}

/** 실패한 실행의 stdout·stderr 마지막 몇 줄에만 패턴을 댄다(앞쪽은 프롬프트 반향이 섞인다) */
export function isUnavailableFailure({ stdout = '', stderr = '' }) {
  const tail = (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^tokens used/i.test(line))
      .slice(-TAIL_LINES)
      .map(failureText)
  return [...tail(stderr), ...tail(stdout)].some((line) => line && UNAVAILABLE_PATTERN.test(line))
}

// 코덱스 프로세스에 넘기지 않을 비밀값 env — API 키 3종(이미지 백엔드 목록) 밖의 .env.local 값(서비스 키·토큰 등)도 뺀다(검수 지적).
// 프롬프트에 섞인 상품·리뷰 글이 명령 실행을 유도해도 비밀값이 모델 문맥에 들어가지 않게
const SECRET_ENV_PATTERN =
  /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|DATABASE_URL|_DSN$|^PG|_AK$|LICENSE/i

export function sanitizeLlmEnv(env) {
  return Object.fromEntries(Object.entries(sanitizeCodexEnv(env)).filter(([key]) => !SECRET_ENV_PATTERN.test(key)))
}

/** src/lib/agents/deadline.ts DEADLINE_MIN_ATTEMPT_MS와 같은 값 — 이보다 적게 남으면 부르지 않는다(R11e) */
export const LLM_DEADLINE_MIN_ATTEMPT_MS = 15_000
/** run 기한으로 부르지 않았다 — src/lib/agents/llm/providers/codex-cli.ts가 이 코드로 기한 소진 실패(stage timeout)로 바꾼다 */
export const LLM_DEADLINE_EXHAUSTED_CODE = 'LLM_DEADLINE_EXHAUSTED'

/**
 * 이번 CLI 실행의 시간 제한(R11e) — 요청에 run 기한(deadlineAt, epoch ms — 구독 작업자의 단계 기한)이 있으면 min(지정값, 남은 시간),
 * 남은 시간이 최소보다 적으면 null(부르지 않음). 기한이 없으면 지정값 그대로(하네스 동작 불변). 동시 실행 대기 뒤·시도마다 잰다 —
 * 빈 답·비정상 종료의 두 번째 실행도 기한을 넘기지 않게
 */
export function llmAttemptTimeoutMs(request, timeoutMs, now = Date.now()) {
  const base = request.timeoutMs ?? timeoutMs
  if (typeof request.deadlineAt !== 'number') return base
  const left = request.deadlineAt - now
  return left < LLM_DEADLINE_MIN_ATTEMPT_MS ? null : Math.min(base, left)
}

/** 기한으로 부르지 않았을 때의 오류 — 소프트 종료가 아니다(구독 문제가 아니고, API로 이어도 남은 시간이 없다) */
export function llmDeadlineError(backend, lastReason) {
  const error = new Error(
    `${backend}: run 기한까지 ${LLM_DEADLINE_MIN_ATTEMPT_MS / 1000}초가 남지 않아 부르지 않았습니다${lastReason ? `(직전 시도: ${lastReason})` : ''}`
  )
  error.code = LLM_DEADLINE_EXHAUSTED_CODE
  return error
}

function imageExtension(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

/** Anthropic 형식 메시지 → 프롬프트 글 + 첨부 이미지(base64). 이미지는 순서대로 번호를 단다 */
export function buildLlmPrompt({ system, messages }) {
  const images = []
  const parts = []
  for (const message of messages ?? []) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
    const texts = []
    for (const block of blocks) {
      if (block.type === 'text') texts.push(block.text)
      else if (block.type === 'image' && block.source?.type === 'base64') {
        images.push({ data: block.source.data, mediaType: block.source.media_type })
        texts.push(`(첨부 이미지 ${images.length})`)
      } else {
        throw new Error(`codex-cli: 보낼 수 없는 메시지 블록 — ${block.type}`)
      }
    }
    parts.push(message.role === 'assistant' ? `[이전 답]\n${texts.join('\n')}` : texts.join('\n'))
  }
  const text = [PREAMBLE, '', '[지시]', system ?? '', '', '[요청]', parts.join('\n\n')].join('\n')
  return { text, images }
}

export function buildCodexLlmArgs({ workDir, outPath, imagePaths = [], model, effort }) {
  if (!model) throw new Error('codex-cli: 모델이 필요합니다.')
  if (effort && !CODEX_EFFORTS.includes(effort))
    throw new Error(`codex-cli: effort ${effort}는 쓸 수 없습니다(${CODEX_EFFORTS.join('|')})`)
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-C',
    workDir,
    '-m',
    model,
  ]
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
  args.push('--json', '-o', outPath)
  for (const image of imagePaths) args.push('-i', image)
  args.push('-')
  return assertAllowedArgs(args)
}

function usageOf(value) {
  if (!value || typeof value !== 'object') return null
  const input = value.input_tokens
  const output = value.output_tokens
  if (typeof input !== 'number' || typeof output !== 'number') return null
  return {
    inputTokens: input,
    outputTokens: output,
    ...(typeof value.cached_input_tokens === 'number' ? { cachedInputTokens: value.cached_input_tokens } : {}),
  }
}

/** --json 이벤트(JSONL, 출력 꼬리)에서 usage가 든 마지막 이벤트의 토큰. 잘린 첫 줄·다른 출력은 건너뛴다. 없으면 null */
export function parseCodexUsage(stdout) {
  let found = null
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    found = usageOf(event?.usage) ?? usageOf(event?.payload?.usage) ?? usageOf(event?.info?.total_token_usage) ?? found
  }
  return found
}

/** 전용 CODEX_HOME 점검 — 쓸 수 있으면 null, 아니면 사유 */
export async function checkCodexHome(dir) {
  if (!dir) return { reason: 'no_home', detail: 'NEXOPS_CODEX_HOME이 없습니다' }
  try {
    if (!(await stat(dir)).isDirectory()) return { reason: 'no_home', detail: `폴더가 아닙니다: ${dir}` }
  } catch {
    return { reason: 'no_home', detail: `폴더가 없습니다: ${dir}` }
  }
  const exists = (name) =>
    access(path.join(dir, name)).then(
      () => true,
      () => false
    )
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
    if (await exists(name)) {
      return { reason: 'agents_md', detail: `전용 CODEX_HOME에 ${name}가 있습니다(지침이 프롬프트에 섞임): ${dir}` }
    }
  }
  const notLoggedIn = { reason: 'not_logged_in', detail: `ChatGPT 로그인이 없습니다 — CODEX_HOME=${dir} codex login` }
  let auth
  try {
    auth = JSON.parse(await readFile(path.join(dir, 'auth.json'), 'utf8'))
  } catch {
    return notLoggedIn
  }
  // API 키 로그인이면 codex exec가 API로 과금된다(구독 0원 기록과 어긋남, 검수 지적) — 값은 출력하지 않는다
  if (auth?.OPENAI_API_KEY) {
    return {
      reason: 'api_key_login',
      detail: `전용 CODEX_HOME이 API 키 로그인입니다 — ChatGPT 로그인으로 바꾸세요: ${dir}`,
    }
  }
  if (auth?.auth_mode !== 'chatgpt' || !auth?.tokens || typeof auth.tokens !== 'object') return notLoggedIn
  return null
}

export function createCodexLlmBackend(options = {}) {
  const {
    command = process.env.NEXOPS_CODEX_BIN || 'codex',
    commandPrefixArgs = [],
    codexHome,
    timeoutMs = 5 * 60_000,
    maxConcurrent = 1,
    workRoot = path.join(os.tmpdir(), 'nexops-codex-llm'),
    env = process.env,
    keepWorkDir = false,
    onEvent = () => {},
    // run 기한을 재는 시계 — 시험이 바꾼다(R11e)
    now = Date.now,
  } = options
  if (!codexHome) throw new Error('codex-cli: 전용 CODEX_HOME이 필요합니다(전역 AGENTS.md가 섞이지 않게).')
  assertAllowedArgs([command, ...commandPrefixArgs])
  const childEnv = { ...sanitizeLlmEnv(env), CODEX_HOME: codexHome }
  const limit = createLimiter(maxConcurrent)

  return (request) =>
    limit(async () => {
      const { text, images } = buildLlmPrompt(request)
      await mkdir(workRoot, { recursive: true })
      const workDir = await mkdtemp(path.join(workRoot, 'call-'))
      try {
        const imagePaths = []
        for (const [i, image] of images.entries()) {
          const imagePath = path.join(workDir, `image-${i + 1}.${imageExtension(image.mediaType)}`)
          await writeFile(imagePath, Buffer.from(image.data, 'base64'))
          imagePaths.push(imagePath)
        }
        const promptPath = path.join(workDir, PROMPT_FILE)
        await writeFile(promptPath, text, 'utf8')
        const outPath = path.join(workDir, OUTPUT_FILE)
        const args = assertAllowedArgs([
          ...commandPrefixArgs,
          ...buildCodexLlmArgs({ workDir, outPath, imagePaths, model: request.model, effort: request.effort }),
        ])
        let lastReason = ''
        for (let attempt = 1; attempt <= 2; attempt++) {
          const timeout = llmAttemptTimeoutMs(request, timeoutMs, now())
          if (timeout === null) throw llmDeadlineError('codex-cli', lastReason)
          await rm(outPath, { force: true })
          const run = await runCodexOnce({ command, args, cwd: workDir, env: childEnv, promptPath, timeoutMs: timeout })
          if (run.timedOut) {
            onEvent({ type: 'soft-stop', reason: 'timeout', attempt, durationMs: run.durationMs })
            throw softStopError(
              'timeout',
              `${Math.round(timeout / 1000)}초 안에 끝나지 않았습니다${run.killUnconfirmed ? ' · 프로세스 종료 미확인' : ''}`
            )
          }
          const answer = await readFile(outPath, 'utf8').catch(() => '')
          if (run.exitCode === 0 && answer.trim()) {
            const usage = parseCodexUsage(run.stdout)
            onEvent({ type: 'success', attempt, durationMs: run.durationMs, usage })
            return { text: answer, usage }
          }
          if (isQuotaFailure(run)) {
            onEvent({ type: 'soft-stop', reason: 'quota', attempt, durationMs: run.durationMs })
            const lastLine = (run.stderr.trim() || run.stdout.trim()).split(/\r?\n/).at(-1) ?? ''
            throw softStopError('quota', lastLine)
          }
          if (run.exitCode !== 0 && isUnavailableFailure(run)) {
            onEvent({ type: 'soft-stop', reason: 'unavailable', attempt, durationMs: run.durationMs })
            const lastLine = (run.stderr.trim() || run.stdout.trim()).split(/\r?\n/).at(-1) ?? ''
            throw softStopError('unavailable', lastLine)
          }
          lastReason = run.spawnError
            ? `실행 실패: ${run.spawnError}`
            : `종료코드 ${run.exitCode} · ${answer.trim() ? '답 있음' : '빈 답'}`
          onEvent({ type: 'attempt-failed', attempt, durationMs: run.durationMs, reason: lastReason })
        }
        const error = new Error(`codex-cli 호출 실패(2회 시도): ${lastReason}`)
        error.code = 'CODEX_LLM_FAILED'
        throw error
      } finally {
        if (!keepWorkDir) {
          await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) =>
            onEvent({ type: 'cleanup-failed', workDir, reason: error.message })
          )
        }
      }
    })
}

/** env(NEXOPS_CODEX_HOME)로 만든다 — 못 만들면 사유를 돌려준다(하네스가 잡을 만들기 전에 멈춘다) */
export async function createCodexLlmBackendFromEnv(env = process.env, options = {}) {
  const codexHome = env.NEXOPS_CODEX_HOME?.trim()
  const problem = await checkCodexHome(codexHome)
  if (problem) return { ok: false, ...problem }
  return { ok: true, backend: createCodexLlmBackend({ ...options, codexHome, env }) }
}
