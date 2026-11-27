/**
 * 코덱스 구독 이미지 백엔드 (C1 — 설계 00_DESIGN.md §4.9, 콘텐츠팀 계획 §4.1).
 *
 * 로컬 프로세스(실 테스트 하네스·콘텐츠 실행기)가 `registerLocalImageBackend('codex-image', createCodexImageBackend())`로
 * 등록해 쓴다. child_process는 이 파일(scripts/)에만 있고 Next 번들에는 들어가지 않는다.
 *
 * 컷 1장 = `codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write -C <임시폴더> -i <참조>… -`
 * - 프롬프트는 파일 → stdin(`-`). 셸 인자·`$(cat)` 전달은 조용한 실패가 재현돼 쓰지 않는다.
 * - 자식 환경에서 API 키 변수를 빼서 구독 로그인 인증만 쓰게 한다(API 과금 방지).
 * - 산출 검증: out/image.png 존재 · PNG 시그니처 · 최소 해상도 · 목표 화면비 ±3%. "종료코드 0인데 산출물 없음"은 실패.
 * - 재시도는 컷당 1회(maxAttempts 기본 2 — 비교 하네스는 1로 다시 부르지 않는다). 한도 소진·시간 초과는 재시도하지 않고 소프트 종료 오류를 던진다(잡 재개 가능).
 * - 임시 폴더는 끝나면 지운다. `~/.codex/generated_images/`는 다른 프로젝트와 공용이라 건드리지 않는다.
 * - `--dangerously-bypass-approvals-and-sandbox`·`danger-full-access`는 최종 argv 전체(접두 인자 포함)에서 거부한다.
 * - 실행 파일은 `codex`(PATH의 .exe). npm `.cmd` 셈만 있는 PC(예: 미니PC)는 NEXOPS_CODEX_BIN에 codex.exe 경로를 준다.
 * - 전용 홈(E2, 코덱스 내부 보고서 2026-10-30): codexHome을 주면 CODEX_HOME으로 돌리고 --ignore-user-config·--ignore-rules를 붙인다 —
 *   전역 ~/.codex의 AGENTS.md(개발 지침)·config.toml(기본 모델·추론 수준)이 컷마다 섞이지 않게(LLM 백엔드와 같은 방식).
 *   createCodexImageBackendFromEnv는 NEXOPS_CODEX_HOME을 점검하고(폴더·AGENTS.md 없음·ChatGPT 로그인·imagegen 스킬) 모델·추론 수준을
 *   명시한다(기본 gpt-6-astra·xhigh = 지금까지 전역 설정과 같은 값, NEXOPS_CODEX_IMAGE_MODEL·NEXOPS_CODEX_IMAGE_EFFORT로 바꾼다).
 *   codexHome 없이 만들면 예전처럼 전역 설정으로 돈다(실험 스크립트 호환).
 * - 산출 회수(전용 홈 1컷 확인 2026-10-30): 에이전트가 out/image.png 복사를 빠뜨려도 생성은 $CODEX_HOME/generated_images/<thread>/에
 *   된다. out/image.png가 없으면 이번 실행 시작 뒤 생긴 PNG 중 가장 최근 것을 산출로 받는다 — 출력의 session id로 thread 폴더를
 *   고르고, 못 찾으면 시작 뒤 새 thread 폴더가 하나일 때만(동시 실행과 섞이지 않게). generated_images는 지우지 않는다.
 * - 재작성 기록(E1, 기본 off): trace를 켜면(NEXOPS_CODEX_IMAGE_TRACE=1, 전용 홈만) --ephemeral을 빼고 실행마다 이번 thread의 기록에서
 *   최종 프롬프트(revisedPrompt)·턴 시간을 뽑아 결과의 trace로 돌려준다(codex-rollout.mjs — 0.160은 thread_history sqlite, 예전 jsonl도 읽음).
 *   기본 off인 이유: ephemeral을 빼면 컷마다 base64 결과(약 2MB)가 전용 홈 sqlite에 쌓인다(코덱스 내부 상태라 지우지 않는다) —
 *   기록이 필요한 측정 회차에서만 켠다(통합 결정 2026-10-30).
 * - 병렬 모드(K 라인 M2, 기본 off — NEXOPS_CODEX_PARALLEL=1, 전용 홈만): 여러 프로세스가 같은 전용 홈을 쓸 때 다른 잡의 사진을 받지 않게 한다.
 *   최근 잡은 컷 전부가 산출 회수 경로로 온다(원장 19잡 406컷 2026-11-01). 0.160은 머리말에 session id가 없을 때가 있어 지금 방식은 동시에
 *   돌면 '새 폴더 둘 이상 → 포기'가 잦고, 더 나쁘게는 자기 컷이 실패했을 때 다른 잡의 폴더 하나를 자기 것으로 받을 수 있다. 그래서 --json을 켜
 *   thread.started 이벤트의 thread_id와 이름이 정확히 같은 폴더의 사진만 받는다(앞 8자 비교 금지 — thread id는 UUIDv7이라 앞 8자가 약 65초 동안
 *   같다). out/image.png는 보지 않는다 — imagegen 스킬이 '$CODEX_HOME에서 골라 복사'를 시켜 에이전트가 같은 홈의 다른 thread 사진을 복사할 수 있다.
 *   thread_id를 못 읽으면 받지 않는다(그 시도 실패 → 1회 재시도). 머리말 session id 폴백도 쓰지 않는다(JSON 답 글 속 글자를 잘못 읽는다).
 *   --json 출력의 답·명령 글이 한도 오탐을 내지 않게 한도 판별도 실패 이벤트만 본다.
 *   NEXOPS_CODEX_WORK_ROOT는 잡마다 임시 폴더 뿌리를 나눈다(실행기가 '이 잡의 코덱스가 남았나'를 다른 잡과 섞지 않고 센다).
 */

import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectCodexTrace, threadIdOf } from './codex-rollout.mjs'

/** src/lib/agents/image/local-backend.ts와 같은 값(테스트가 대조) */
export const LOCAL_BACKEND_SOFT_STOP_MARKER = '[local-backend:soft-stop]'
export const STRIPPED_ENV_KEYS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY']
const FORBIDDEN_ARG_PATTERN = /dangerously-bypass-approvals-and-sandbox|danger-full-access/i
// 한도 판별은 산출 검증이 실패했을 때 stdout·stderr 각각의 마지막 몇 줄만 본다(종료코드 무관) —
// 앞쪽에는 프롬프트 반향·tokens used 같은 숫자가 섞인다
const QUOTA_PATTERN = /usage limit|rate[- ]?limit(s|ed)?\b|exceeded (your )?(current )?quota|quota exceeded|too many requests|status( code)?:? ?429|429 too many/i
const QUOTA_TAIL_LINES = 6
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const OUTPUT_TAIL_BYTES = 16 * 1024
/** 출력 앞부분(세션 머리말의 session id용) */
const OUTPUT_HEAD_BYTES = 4 * 1024
/** 파일 시각 오차 여유 */
const MTIME_SLACK_MS = 1000
const KILL_GRACE_MS = 10_000
const OUTPUT_DIR = 'out'
const OUTPUT_FILE = 'image.png'
/** 전용 홈 기본 모델·추론 수준 — 지금까지 전역 config.toml로 돌던 값과 같게 둔다(효과 비교는 E7에서 따로) */
export const DEFAULT_IMAGE_MODEL = 'gpt-6-astra'
export const DEFAULT_IMAGE_EFFORT = 'xhigh'
/** codex model_reasoning_effort가 받는 값(codex-llm-backend CODEX_EFFORTS와 같다) */
export const IMAGE_EFFORTS = ['low', 'medium', 'high', 'xhigh']
/**
 * 이미지 도구 참조 상한 — 실측(R13 P01 hero 재현 6/6: '`referenced_image_paths` must contain at most 5 paths'). 넘기면 모델이 알아서 줄이기도 하고
 * 컷을 포기하기도 한다(P01은 같은 6장으로 8컷 성공·4컷 실패). 시작 전에 막아 구독 시도를 쓰지 않는다. types.ts IMAGE_MAX_REFERENCES와 같은 값(시험으로 고정)
 */
export const CODEX_MAX_REFERENCES = 5
/** 전용 홈에서 이미지 도구 지침을 읽는 시스템 스킬 */
const IMAGEGEN_SKILL = path.join('skills', '.system', 'imagegen', 'SKILL.md')

/** API 키 변수를 뺀 자식 환경. Windows 환경변수는 대소문자를 가리지 않으므로 대문자로 비교한다. */
export function sanitizeCodexEnv(env) {
  const stripped = new Set(STRIPPED_ENV_KEYS)
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => value !== undefined && !stripped.has(key.toUpperCase())),
  )
}

export function parseSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size ?? '').trim())
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new Error(`codex-image: 크기 형식이 'WxH'가 아닙니다: ${size}`)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** PNG 시그니처와 IHDR에서 가로·세로를 읽는다. PNG가 아니면 null. */
export function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** 실제 화면비가 목표에서 벗어난 비율(0.03 = 3%) */
export function aspectError(actual, target) {
  return Math.abs(actual.width / actual.height / (target.width / target.height) - 1)
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b)
}

export function describeAspect({ width, height }) {
  const d = gcd(width, height)
  const ratio = `${width / d}:${height / d}`
  const shape = width === height ? 'square' : width > height ? 'landscape' : 'portrait'
  return `${shape} ${ratio} aspect ratio (target about ${width}x${height} px)`
}

export function buildCodexPrompt({ prompt, size, referenceCount }) {
  const target = parseSize(size)
  // 참조마다 역할(상품 실물·스타일 참조 등)은 브리프가 정한다 — 래퍼가 역할을 덮어쓰지 않는다
  const refLine =
    referenceCount > 0
      ? `${referenceCount} reference image(s) are attached. Use each one in the role the brief gives it; if the brief does not say, treat it as a photo of the real product and keep the product faithful to it.`
      : 'No reference image is attached.'
  return [
    'Use your built-in image generation tool (not code, not SVG, not PIL drawing) to create exactly ONE image.',
    refLine,
    `Output: ${describeAspect(target)}. Follow the text rules in the brief exactly and do not add watermarks.`,
    '',
    '=== IMAGE BRIEF ===',
    prompt,
    '=== END BRIEF ===',
    '',
    'After generating, copy the generated PNG file into the current working directory as:',
    `  ${OUTPUT_DIR}/${OUTPUT_FILE}`,
    'Then print one line: the final path and the pixel size (width x height). If a step fails, say exactly which step failed.',
    'Do not modify anything outside the current working directory.',
  ].join('\n')
}

export function buildCodexArgs({ workDir, refPaths, model, reasoningEffort, isolated = false, keepRollout = false, json = false }) {
  // 재작성 기록을 켠 전용 홈 실행만 기록을 남긴다(E1). 그 밖은 지금처럼 ephemeral
  const args = isolated && keepRollout ? ['exec', '--skip-git-repo-check'] : ['exec', '--ephemeral', '--skip-git-repo-check']
  // 전용 홈이면 사용자 설정·규칙 파일을 읽지 않는다(LLM 백엔드와 같은 플래그)
  if (isolated) args.push('--ignore-user-config', '--ignore-rules')
  args.push('--sandbox', 'workspace-write', '-C', workDir)
  if (model) args.push('-m', model)
  if (reasoningEffort) args.push('-c', `model_reasoning_effort="${reasoningEffort}"`)
  // 병렬 모드만 — 첫 이벤트 thread.started의 thread_id로 이번 실행의 산출 폴더를 정확히 고른다
  if (json) args.push('--json')
  for (const ref of refPaths) args.push('-i', ref)
  args.push('-')
  return assertAllowedArgs(args)
}

export function assertAllowedArgs(args) {
  const forbidden = args.find((arg) => FORBIDDEN_ARG_PATTERN.test(String(arg)))
  if (forbidden) throw new Error(`codex-image: 금지된 인자 ${forbidden}`)
  return args
}

/** --json 이벤트 중 실패를 알리는 것 — 답·명령 출력(item.*)은 모델·도구가 쓴 글이라 한도 오탐이 난다 */
const FAILURE_EVENT_TYPES = new Set(['error', 'turn.failed'])

function failureEventText(line) {
  if (!line.startsWith('{')) return line
  try {
    return FAILURE_EVENT_TYPES.has(JSON.parse(line)?.type) ? line : ''
  } catch {
    return line
  }
}

/**
 * --json 이벤트 요약 — 모델이 무엇을 했는지(끝난 항목 종류별 수·실행한 명령·마지막 말). JSON이 아닌 줄은 건너뛴다.
 * 실패 사유와 재현 기록이 쓴다(R13 P01: '종료코드 0 · 산출 파일 없음'만으로는 합성·거부를 가를 수 없었다)
 */
export function summarizeCodexEvents(text) {
  const items = {}
  const commands = []
  let lastMessage = ''
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const item = event?.item
    if (event?.type !== 'item.completed' || typeof item?.type !== 'string') continue
    items[item.type] = (items[item.type] ?? 0) + 1
    if (item.type === 'agent_message' && typeof item.text === 'string') lastMessage = item.text
    if (item.type === 'command_execution' && typeof item.command === 'string') commands.push(item.command)
  }
  return { items, commands, lastMessage }
}

/**
 * 실행 출력의 안전 거부 — 요청 ID로 센다(같은 거부가 stderr·이벤트에 되풀이된다). 모델이 실행 안에서 다시 시도해 사진이 나와도 거부는 남는다.
 * 잡 기록에는 사진 없이 끝난 컷만 남으므로 빈도는 여기서만 잴 수 있다
 */
export function safetyRejectionsOf(text) {
  const ids = new Set()
  const categories = new Set()
  for (const match of String(text ?? '').matchAll(/request ID ([0-9a-f-]{36})\.?\s*safety_violations=\[([^\]]*)\]/gi)) {
    ids.add(match[1])
    for (const category of match[2].split(',')) if (category.trim()) categories.add(category.trim())
  }
  return { rejected: ids.size, categories: [...categories].sort() }
}

/** 이벤트에 실을 칸 — 거부가 없으면 칸 없음 */
const safetyFields = (output) => {
  const { rejected, categories } = safetyRejectionsOf(output)
  return rejected > 0 ? { safetyRejected: rejected, safetyCategories: categories } : {}
}

const DETAIL_MESSAGE_MAX = 160

/** 병렬 모드 '산출 파일 없음'의 근거 — thread 폴더·out/image.png·모델이 한 일·마지막 말. 잡 기록(section_images[].error)에 남는다 */
export function missingCutDetail({ threadId, outImageBytes, summary }) {
  const tools = Object.entries(summary.items)
    .filter(([type]) => type !== 'agent_message')
    .map(([type, count]) => `${type} ${count}`)
    .join(', ')
  const message = summary.lastMessage.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MESSAGE_MAX)
  return [
    threadId ? `thread ${threadId.slice(0, 8)} 폴더에 사진 없음` : 'thread id 못 읽음',
    outImageBytes > 0 ? `out/image.png ${outImageBytes}B 있음(받지 않음)` : 'out/image.png 없음',
    tools ? `항목 ${tools}` : '항목 없음',
    ...(message ? [`마지막 말: ${message}`] : []),
  ].join(' · ')
}

/** 재현 기록(runLogDir) 한 건 — run-N.json, out/image.png·thread 사진 복사본. 이벤트 전체는 run-N.jsonl(runCodexOnce teePath) */
async function saveRunRecord(dir, seq, { run, output, outFile, threadImage, reason }) {
  const outCopy = path.join(dir, `run-${seq}-out.png`)
  const outImageBytes = await copyFile(outFile, outCopy).then(() => stat(outCopy).then((info) => info.size)).catch(() => 0)
  const threadCopied = threadImage ? await copyFile(threadImage, path.join(dir, `run-${seq}-thread.png`)).then(() => true).catch(() => false) : false
  await writeFile(
    path.join(dir, `run-${seq}.json`),
    JSON.stringify(
      {
        seq,
        exitCode: run.exitCode,
        timedOut: Boolean(run.timedOut),
        durationMs: run.durationMs,
        threadId: threadIdOf(output, { eventOnly: true }) ?? null,
        threadImage: threadCopied,
        outImageBytes,
        ...summarizeCodexEvents(output),
        reason: reason ?? null,
        stderrTail: run.stderr.slice(-2000),
      },
      null,
      2,
    ),
    'utf8',
  )
}

/** 한도 소진 판별 — stdout·stderr 각각의 마지막 몇 줄만 본다(tokens used 줄 제외). jsonEvents(병렬 모드 --json 출력)면 JSON 줄은 실패 이벤트만 */
export function isQuotaFailure({ stdout = '', stderr = '' }, { jsonEvents = false } = {}) {
  const tailLines = (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^tokens used/i.test(line))
      .slice(-QUOTA_TAIL_LINES)
      .map((line) => (jsonEvents ? failureEventText(line) : line))
  return [...tailLines(stderr), ...tailLines(stdout)].some((line) => line && QUOTA_PATTERN.test(line))
}

/** 동시 실행 상한(기본 2) — 같은 구독 한도를 쓰는 다른 작업과 나눠 쓰기 위해서다 */
export function createLimiter(max) {
  let active = 0
  const waiting = []
  return async (task) => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

function softStopError(reason, detail) {
  const label = reason === 'quota' ? '구독 한도 소진' : '시간 초과(timeout)'
  const error = new Error(`${LOCAL_BACKEND_SOFT_STOP_MARKER} ${reason}: codex-image ${label} — ${detail}`)
  error.code = reason === 'quota' ? 'CODEX_QUOTA_EXHAUSTED' : 'CODEX_TIMEOUT'
  error.softStop = true
  error.softStopReason = reason
  return error
}

const IS_WINDOWS = process.platform === 'win32'

// 코덱스는 샌드박스 자식 프로세스를 띄우므로 트리째 끝낸다(POSIX는 detached로 만든 프로세스 그룹째)
export function killTree(child) {
  if (!child.pid) return
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export function runCodexOnce({ command, args, cwd, env, promptPath, timeoutMs, teePath }) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tails = { stdout: '', stderr: '' }
    // 재현 기록만 — stdout 전체를 파일로(tails는 끝부분뿐이다)
    const tee = teePath ? createWriteStream(teePath) : null
    let head = ''
    let timedOut = false
    let settled = false
    let graceTimer
    const append = (stream) => (chunk) => {
      const text = chunk.toString('utf8')
      tails[stream] = (tails[stream] + text).slice(-OUTPUT_TAIL_BYTES)
      if (head.length < OUTPUT_HEAD_BYTES) head = (head + text).slice(0, OUTPUT_HEAD_BYTES)
    }
    const finish = (result) => {
      if (settled) return
      settled = true
      tee?.end()
      clearTimeout(timer)
      clearTimeout(graceTimer)
      resolve({ ...result, timedOut, ...tails, head, durationMs: Date.now() - started })
    }
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WINDOWS })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // 종료 뒤 close가 오지 않아도 영원히 기다리지 않는다
      graceTimer = setTimeout(() => finish({ exitCode: null, killUnconfirmed: true }), KILL_GRACE_MS)
    }, timeoutMs)
    const onStdout = append('stdout')
    child.stdout.on('data', (chunk) => {
      tee?.write(chunk)
      onStdout(chunk)
    })
    child.stderr.on('data', append('stderr'))
    child.stdin.on('error', () => {}) // 자식이 먼저 끝나면 EPIPE — 결과는 close에서 판정
    createReadStream(promptPath).pipe(child.stdin)
    child.on('error', (error) => finish({ exitCode: null, spawnError: error.message }))
    child.on('close', (code) => finish({ exitCode: code }))
  })
}

/**
 * 전용 홈 산출 회수 — 이번 실행 시작 뒤 생긴 generated_images PNG 중 가장 최근 것(없으면 null). session id가 출력에 있으면 그
 * thread 폴더만, 없으면 새 thread 폴더가 하나일 때만 고른다. 읽기만 한다(지우지 않는다).
 * exactThread(병렬 모드): 출력의 thread id와 이름이 정확히 같은 폴더만 — id를 못 읽으면 고르지 않는다(폴더가 하나여도 다른 잡 것일 수 있다)
 */
export async function findGeneratedImage(codexHome, startedAtMs, outputText = '', { exactThread = false } = {}) {
  const root = path.join(codexHome, 'generated_images')
  let threads
  try {
    threads = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory())
  } catch {
    return null
  }
  const sessionId = threadIdOf(outputText, { eventOnly: exactThread })?.toLowerCase()
  if (exactThread && !sessionId) return null
  const fresh = []
  for (const thread of threads) {
    if (exactThread ? thread.name.toLowerCase() !== sessionId : sessionId && !thread.name.toLowerCase().startsWith(sessionId.slice(0, 8))) continue
    const dir = path.join(root, thread.name)
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.toLowerCase().endsWith('.png')) continue
      const info = await stat(path.join(dir, name)).catch(() => null)
      if (info && info.mtimeMs >= startedAtMs - MTIME_SLACK_MS) fresh.push({ thread: thread.name, file: path.join(dir, name), mtimeMs: info.mtimeMs })
    }
  }
  if (fresh.length === 0 || (!sessionId && new Set(fresh.map((f) => f.thread)).size !== 1)) return null
  return fresh.sort((a, b) => b.mtimeMs - a.mtimeMs)[0].file
}

async function validateOutput(outPath, target, { aspectTolerance, minShortSide }) {
  let buffer
  try {
    buffer = await readFile(outPath)
  } catch {
    return { ok: false, reason: '산출 파일 없음' }
  }
  const size = readPngSize(buffer)
  if (!size) return { ok: false, reason: 'PNG 형식 아님' }
  if (Math.min(size.width, size.height) < minShortSide) {
    return { ok: false, reason: `해상도 부족 ${size.width}x${size.height}`, size }
  }
  const error = aspectError(size, target)
  if (error > aspectTolerance) {
    return { ok: false, reason: `화면비 오차 ${(error * 100).toFixed(1)}% (${size.width}x${size.height}, 목표 ${target.width}x${target.height})`, size }
  }
  return { ok: true, buffer, size }
}

function refExtension(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

/**
 * generateImage가 부르는 LocalImageBackend를 만든다.
 * request: { prompt, size: 'WxH', referenceImages: [{ base64, mimeType }], agentName, runContext }
 */
export function createCodexImageBackend(options = {}) {
  const {
    command = process.env.NEXOPS_CODEX_BIN || 'codex',
    commandPrefixArgs = [],
    timeoutMs = 7 * 60_000,
    aspectTolerance = 0.03,
    minShortSide = 512,
    maxConcurrent = 2,
    workRoot = path.join(os.tmpdir(), 'nexops-codex-image'),
    model,
    reasoningEffort,
    codexHome,
    trace: traceEnabled = false,
    parallel = false,
    env = process.env,
    keepWorkDir = false,
    onEvent = () => {},
    /** 재현 도구만 — 실행마다 이벤트 전체·판정 근거·산출 복사본을 이 폴더에 남긴다(기본 없음) */
    runLogDir,
    /** 컷당 시도 수(기본 2 = 재시도 1회). 비교 하네스처럼 '실패해도 다시 부르지 않음'이 조건이면 1 */
    maxAttempts = 2,
  } = options
  assertAllowedArgs([command, ...commandPrefixArgs])
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) throw new Error(`codex-image: maxAttempts는 1 또는 2입니다(${maxAttempts})`)
  if (reasoningEffort && !IMAGE_EFFORTS.includes(reasoningEffort))
    throw new Error(`codex-image: effort ${reasoningEffort}는 쓸 수 없습니다(${IMAGE_EFFORTS.join('|')})`)
  const isolated = Boolean(codexHome)
  const keepRollout = isolated && traceEnabled
  // 병렬 모드는 전용 홈에서만 뜻이 있다(회수는 전용 홈 경로)
  const exactThread = isolated && parallel
  const childEnv = isolated ? { ...sanitizeCodexEnv(env), CODEX_HOME: codexHome } : sanitizeCodexEnv(env)
  const limit = createLimiter(maxConcurrent)
  let runSeq = 0

  return (request) =>
    limit(async () => {
      if (!request?.prompt?.trim()) throw new Error('codex-image: 프롬프트가 필요합니다.')
      const refCount = request.referenceImages?.length ?? 0
      if (refCount > CODEX_MAX_REFERENCES) {
        const error = new Error(`codex-image: 참조 ${refCount}장 — 이미지 도구 상한 ${CODEX_MAX_REFERENCES}장을 넘어 시작하지 않습니다`)
        error.code = 'CODEX_TOO_MANY_REFERENCES'
        throw error
      }
      const target = parseSize(request.size ?? '1024x1024')
      await mkdir(workRoot, { recursive: true })
      const workDir = await mkdtemp(path.join(workRoot, 'cut-'))
      try {
        const refs = request.referenceImages ?? []
        await mkdir(path.join(workDir, 'in'), { recursive: true })
        const refPaths = []
        for (const [i, ref] of refs.entries()) {
          const refPath = path.join(workDir, 'in', `ref-${i}.${refExtension(ref.mimeType)}`)
          await writeFile(refPath, Buffer.from(ref.base64, 'base64'))
          refPaths.push(refPath)
        }
        const promptPath = path.join(workDir, 'PROMPT.md')
        await writeFile(promptPath, buildCodexPrompt({ prompt: request.prompt, size: request.size ?? '1024x1024', referenceCount: refPaths.length }), 'utf8')
        const args = assertAllowedArgs([...commandPrefixArgs, ...buildCodexArgs({ workDir, refPaths, model, reasoningEffort, isolated, keepRollout, json: exactThread })])
        const outDir = path.join(workDir, OUTPUT_DIR)

        let lastReason = ''
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await rm(outDir, { recursive: true, force: true })
          await mkdir(outDir, { recursive: true })
          const runStartedAt = Date.now()
          const seq = ++runSeq
          if (runLogDir) await mkdir(runLogDir, { recursive: true })
          const teePath = runLogDir ? path.join(runLogDir, `run-${seq}.jsonl`) : undefined
          const run = await runCodexOnce({ command, args, cwd: workDir, env: childEnv, promptPath, timeoutMs, teePath })
          const output = `${run.head ?? ''}\n${run.stdout}\n${run.stderr}`
          // 재작성 기록 — 이번 실행의 rollout을 읽고 지운다(시간 초과·실패여도 지워 쌓이지 않게). 못 읽어도 생성에는 영향 없음
          // 병렬 모드에서 thread id를 못 읽으면 다른 잡 기록을 읽을 수 있어 기록을 남기지 않는다
          const trace = keepRollout && (!exactThread || threadIdOf(output, { eventOnly: true })) ? await collectCodexTrace(codexHome, runStartedAt, output).catch(() => null) : null
          const outFile = path.join(outDir, OUTPUT_FILE)
          if (run.timedOut) {
            if (runLogDir) await saveRunRecord(runLogDir, seq, { run, output, outFile, threadImage: null, reason: 'timeout' })
            // killUnconfirmed: 유예 시간 안에 프로세스 종료를 확인하지 못함 — 코덱스가 살아남아 한도를 쓸 수 있다
            const killUnconfirmed = Boolean(run.killUnconfirmed)
            onEvent({ type: 'soft-stop', reason: 'timeout', attempt, durationMs: run.durationMs, killUnconfirmed })
            throw softStopError(
              'timeout',
              `${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다${killUnconfirmed ? ' · 프로세스 종료 미확인' : ''}`,
            )
          }
          let checked
          let recovered = false
          let threadImage = null
          if (exactThread) {
            // 병렬 모드: 자기 thread 폴더 사진만 받는다(파일 머리말) — out/image.png는 보지 않는다
            threadImage = await findGeneratedImage(codexHome, runStartedAt, output, { exactThread })
            if (threadImage) checked = await validateOutput(threadImage, target, { aspectTolerance, minShortSide })
            else {
              const outImageBytes = await stat(outFile).then((info) => info.size).catch(() => 0)
              const detail = missingCutDetail({ threadId: threadIdOf(output, { eventOnly: true }), outImageBytes, summary: summarizeCodexEvents(output) })
              checked = { ok: false, reason: `산출 파일 없음 — ${detail}` }
            }
            recovered = checked.ok
          } else {
            checked = await validateOutput(outFile, target, { aspectTolerance, minShortSide })
          }
          // 전용 홈: 복사를 빠뜨린 실행은 이번에 생긴 generated_images PNG를 받는다(같은 검증을 거친다)
          if (!exactThread && !checked.ok && isolated && checked.reason === '산출 파일 없음') {
            const found = await findGeneratedImage(codexHome, runStartedAt, output)
            if (found) {
              checked = await validateOutput(found, target, { aspectTolerance, minShortSide })
              recovered = checked.ok
            }
          }
          if (runLogDir) await saveRunRecord(runLogDir, seq, { run, output, outFile, threadImage, reason: checked.ok ? null : checked.reason })
          if (checked.ok) {
            onEvent({ type: 'success', ...safetyFields(output), attempt, durationMs: run.durationMs, width: checked.size.width, height: checked.size.height, bytes: checked.buffer.length, ...(recovered ? { recovered: true, ...(exactThread ? { recoveredExact: true } : {}) } : {}), ...(trace ? { traced: true } : {}) })
            return { base64: checked.buffer.toString('base64'), mimeType: 'image/png', ...(trace ? { trace } : {}) }
          }
          if (isQuotaFailure(run, { jsonEvents: exactThread })) {
            onEvent({ type: 'soft-stop', reason: 'quota', attempt, durationMs: run.durationMs })
            const lastLine = (run.stderr.trim() || run.stdout.trim()).split(/\r?\n/).at(-1) ?? ''
            throw softStopError('quota', lastLine)
          }
          lastReason = run.spawnError
            ? `실행 실패: ${run.spawnError}`
            : `종료코드 ${run.exitCode} · ${checked.reason}`
          onEvent({ type: 'attempt-failed', ...safetyFields(output), attempt, durationMs: run.durationMs, reason: lastReason })
        }
        const error = new Error(`codex-image 생성 실패(2회 시도): ${lastReason}`)
        error.code = 'CODEX_IMAGE_FAILED'
        throw error
      } finally {
        // 시간 초과 직후에는 Windows가 파일 핸들을 잠깐 잡고 있다 — 정리 실패가 본래 오류를 가리지 않게 삼킨다
        if (!keepWorkDir) {
          await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) =>
            onEvent({ type: 'cleanup-failed', workDir, reason: error.message }),
          )
        }
      }
    })
}

/**
 * 전용 CODEX_HOME 점검(E2) — 쓸 수 있으면 null, 아니면 사유. LLM 백엔드 점검(폴더·AGENTS.md 없음·ChatGPT 로그인, API 키 로그인 거부)에
 * imagegen 시스템 스킬이 보이는지를 더한다. 인증 값은 읽기만 하고 출력하지 않는다
 */
export async function checkCodexImageHome(dir) {
  // LLM 백엔드가 이 파일을 정적으로 불러오므로(인자 검사 공유) 순환을 피해 점검 함수는 호출 때 불러온다
  const { checkCodexHome } = await import('./codex-llm-backend.mjs')
  const problem = await checkCodexHome(dir)
  if (problem) return problem
  const skill = path.join(dir, IMAGEGEN_SKILL)
  const hasSkill = await access(skill).then(
    () => true,
    () => false
  )
  if (!hasSkill) return { reason: 'no_imagegen_skill', detail: `전용 CODEX_HOME에 imagegen 스킬이 없습니다(코덱스를 한 번 실행하면 생깁니다): ${skill}` }
  return null
}

/**
 * 환경에서 전용 홈 백엔드를 만든다 — NEXOPS_CODEX_HOME을 점검하고 모델·추론 수준을 명시한다. 점검에 걸리면 만들지 않고 사유를 돌려준다
 * (하네스가 잡을 만들기 전에 멈춘다 — 전역 설정으로 넘어가지 않는다)
 */
export async function createCodexImageBackendFromEnv(env = process.env, options = {}) {
  const codexHome = env.NEXOPS_CODEX_HOME?.trim()
  const problem = await checkCodexImageHome(codexHome ?? '')
  if (problem) return { ok: false, ...problem }
  const model = env.NEXOPS_CODEX_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL
  const effort = env.NEXOPS_CODEX_IMAGE_EFFORT?.trim() || DEFAULT_IMAGE_EFFORT
  if (!IMAGE_EFFORTS.includes(effort)) return { ok: false, reason: 'bad_effort', detail: `NEXOPS_CODEX_IMAGE_EFFORT=${effort}(${IMAGE_EFFORTS.join('|')}만)` }
  // 재작성 기록은 측정 회차에서만(기본 off — 켜면 컷마다 base64 결과가 전용 홈 sqlite에 쌓인다)
  const trace = env.NEXOPS_CODEX_IMAGE_TRACE?.trim() === '1'
  // 병렬 모드(기본 off) — 실행기가 여러 프로세스를 함께 돌릴 때만 켠다(파일 머리말)
  const parallel = env.NEXOPS_CODEX_PARALLEL?.trim() === '1'
  const workRoot = env.NEXOPS_CODEX_WORK_ROOT?.trim()
  return {
    ok: true,
    model,
    effort,
    trace,
    parallel,
    backend: createCodexImageBackend({ ...options, ...(workRoot ? { workRoot } : {}), codexHome, model, reasoningEffort: effort, trace, parallel, env }),
  }
}
