import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCodexProcess, sanitizeCodexEnv, type CodexRunResult } from './codex-bin'
import { assertLocalCodex } from './guard'

export const DEFAULT_CODEX_TIMEOUT_MS = 8 * 60_000

export interface CodexTextImage {
  base64: string
  mediaType: string
}

export interface CodexTextInput {
  system: string
  user: string
  images?: CodexTextImage[]
  timeoutMs?: number
}

type RunCodex = (input: {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: string
  timeoutMs: number
}) => Promise<CodexRunResult>

function imageExtension(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

export function buildCodexTextPrompt(input: Pick<CodexTextInput, 'system' | 'user'>): string {
  return [
    '이 작업은 텍스트 응답만 필요합니다. 명령을 실행하거나 파일을 만들거나 수정하지 마세요.',
    '아래 지시와 요청을 따르고, 요청한 형식의 답만 마지막 메시지로 반환하세요.',
    '',
    '[지시]',
    input.system,
    '',
    '[요청]',
    input.user,
  ].join('\n')
}

export function buildCodexTextArgs(input: {
  workDir: string
  outPath: string
  imagePaths?: string[]
}): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-C',
    input.workDir,
    '--json',
    '-o',
    input.outPath,
  ]
  for (const imagePath of input.imagePaths ?? []) args.push('-i', imagePath)
  args.push('-')
  return args
}

export function parseCodexTextOutput(value: string): string {
  const text = value.trim()
  if (!text) throw new Error('Codex CLI가 빈 응답을 반환했습니다.')
  return text
}

function runFailure(result: CodexRunResult): Error {
  if (result.timedOut) {
    return new Error(
      `Codex CLI가 제한 시간 안에 끝나지 않았습니다.${result.killUnconfirmed ? ' 프로세스 종료도 확인하지 못했습니다.' : ''}`,
    )
  }
  const detail = result.spawnError ?? result.stderr.trim().split(/\r?\n/).at(-1) ?? ''
  return new Error(`Codex CLI 텍스트 호출 실패(종료 코드 ${result.exitCode ?? '없음'}): ${detail}`)
}

export function createCodexText(dependencies: { run?: RunCodex } = {}) {
  const run = dependencies.run ?? runCodexProcess
  return async function codexTextWithDependencies(input: CodexTextInput): Promise<string> {
    assertLocalCodex()
    const root = path.join(os.tmpdir(), 'nexops-codex-llm')
    await mkdir(root, { recursive: true })
    const workDir = await mkdtemp(path.join(root, 'call-'))
    try {
      const imagePaths: string[] = []
      for (const [index, image] of (input.images ?? []).entries()) {
        const imagePath = path.join(workDir, `image-${index + 1}.${imageExtension(image.mediaType)}`)
        await writeFile(imagePath, Buffer.from(image.base64, 'base64'))
        imagePaths.push(imagePath)
      }

      const outPath = path.join(workDir, 'last-message.txt')
      const result = await run({
        args: buildCodexTextArgs({ workDir, outPath, imagePaths }),
        cwd: workDir,
        env: sanitizeCodexEnv(),
        stdin: buildCodexTextPrompt(input),
        timeoutMs: input.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
      })
      if (result.exitCode !== 0) throw runFailure(result)
      const output = await readFile(outPath, 'utf8').catch(() => '')
      return parseCodexTextOutput(output)
    } finally {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    }
  }
}

export const codexText = createCodexText()
