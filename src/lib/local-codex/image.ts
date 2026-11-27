import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCodexProcess, sanitizeCodexEnv, type CodexRunResult } from './codex-bin'
import { assertLocalCodex } from './guard'
import { DEFAULT_CODEX_TIMEOUT_MS } from './llm'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_REFERENCES = 5

export type CodexImageReference =
  | string
  | { url: string }
  | { base64: string; mimeType?: string; mediaType?: string }

export interface CodexImageInput {
  prompt: string
  referenceImages?: CodexImageReference[]
  size?: string
  timeoutMs?: number
}

export interface CodexImageResult {
  base64: string
  mimeType: string
}

type RunCodex = (input: {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: string
  timeoutMs: number
}) => Promise<CodexRunResult>

interface ResolvedReference {
  bytes: Buffer
  mimeType: string
}

function parseSize(size: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(size.trim())
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new Error(`Codex 이미지 크기는 WxH 형식이어야 합니다: ${size}`)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

export function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export function buildCodexImageArgs(workDir: string, referencePaths: string[] = []): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '-C',
    workDir,
  ]
  for (const referencePath of referencePaths) args.push('-i', referencePath)
  args.push('-')
  return args
}

export function buildCodexImagePrompt(prompt: string, size = '1024x1024', referenceCount = 0): string {
  const target = parseSize(size)
  const ratio = target.width === target.height
    ? 'square 1:1'
    : `${target.width > target.height ? 'landscape' : 'portrait'} ${target.width}:${target.height}`
  return [
    'Use your built-in image generation tool (not code, SVG, or programmatic drawing) to create exactly ONE image.',
    referenceCount > 0
      ? `${referenceCount} reference image(s) are attached. Keep the real product faithful to them.`
      : 'No reference image is attached.',
    `Output: ${ratio} aspect ratio (target about ${target.width}x${target.height} px). Do not add watermarks.`,
    '',
    '=== IMAGE BRIEF ===',
    prompt,
    '=== END BRIEF ===',
    '',
    'After generating, copy the generated PNG into the current working directory as out/image.png.',
    'Then print one line with the final path and pixel size. Do not modify anything outside the current working directory.',
  ].join('\n')
}

function dataUrlReference(value: string): ResolvedReference | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value)
  return match ? { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') } : null
}

async function resolveReference(reference: CodexImageReference): Promise<ResolvedReference> {
  const url = typeof reference === 'string' && /^https?:\/\//i.test(reference)
    ? reference
    : typeof reference === 'object' && 'url' in reference
      ? reference.url
      : null
  if (url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'NEXOPS-Local-Codex/1.0' } })
    if (!response.ok) throw new Error(`참조 이미지 다운로드 실패(${response.status}): ${url}`)
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png',
    }
  }

  if (typeof reference === 'string') {
    return dataUrlReference(reference) ?? { bytes: Buffer.from(reference, 'base64'), mimeType: 'image/png' }
  }
  if ('base64' in reference) {
    return {
      bytes: Buffer.from(reference.base64, 'base64'),
      mimeType: reference.mimeType ?? reference.mediaType ?? 'image/png',
    }
  }
  throw new Error('참조 이미지 형식을 확인할 수 없습니다.')
}

function validateOutput(buffer: Buffer, target: { width: number; height: number }): string | null {
  const actual = parsePngDimensions(buffer)
  if (!actual) return 'PNG 형식이 아닙니다.'
  if (Math.min(actual.width, actual.height) < 512) return `해상도가 부족합니다: ${actual.width}x${actual.height}`
  const aspectError = Math.abs(actual.width / actual.height / (target.width / target.height) - 1)
  return aspectError > 0.03
    ? `화면비 오차가 큽니다: ${actual.width}x${actual.height} (목표 ${target.width}x${target.height})`
    : null
}

function failureReason(result: CodexRunResult, outputReason: string): string {
  if (result.timedOut) {
    return `Codex CLI가 제한 시간 안에 끝나지 않았습니다.${result.killUnconfirmed ? ' 프로세스 종료도 확인하지 못했습니다.' : ''}`
  }
  const detail = result.spawnError ?? result.stderr.trim().split(/\r?\n/).at(-1)
  return `${outputReason}${detail ? ` · ${detail}` : ''}`
}

export function createCodexImage(dependencies: { run?: RunCodex } = {}) {
  const run = dependencies.run ?? runCodexProcess
  return async function codexImageWithDependencies(input: CodexImageInput): Promise<CodexImageResult> {
    assertLocalCodex()
    if (!input.prompt.trim()) throw new Error('이미지 프롬프트가 필요합니다.')
    const references = input.referenceImages ?? []
    if (references.length > MAX_REFERENCES) {
      throw new Error(`Codex 이미지 생성은 참조 이미지를 최대 ${MAX_REFERENCES}장까지 지원합니다.`)
    }

    const size = input.size ?? '1024x1024'
    const target = parseSize(size)
    const root = path.join(os.tmpdir(), 'nexops-codex-image')
    await mkdir(root, { recursive: true })
    const workDir = await mkdtemp(path.join(root, 'cut-'))
    try {
      const referencePaths: string[] = []
      for (const [index, reference] of references.entries()) {
        const resolved = await resolveReference(reference)
        const referencePath = path.join(workDir, `reference-${index + 1}.${extensionFor(resolved.mimeType)}`)
        await writeFile(referencePath, resolved.bytes)
        referencePaths.push(referencePath)
      }

      const outDir = path.join(workDir, 'out')
      const outPath = path.join(outDir, 'image.png')
      const args = buildCodexImageArgs(workDir, referencePaths)
      const prompt = buildCodexImagePrompt(input.prompt, size, referencePaths.length)
      let lastReason = '산출 파일이 없습니다.'

      for (let attempt = 1; attempt <= 2; attempt++) {
        await rm(outDir, { recursive: true, force: true })
        await mkdir(outDir, { recursive: true })
        const result = await run({
          args,
          cwd: workDir,
          env: sanitizeCodexEnv(),
          stdin: prompt,
          timeoutMs: input.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS,
        })
        if (result.timedOut) throw new Error(failureReason(result, lastReason))
        const buffer = await readFile(outPath).catch(() => null)
        const outputReason = buffer ? validateOutput(buffer, target) : '산출 파일이 없습니다.'
        if (buffer && !outputReason) return { base64: buffer.toString('base64'), mimeType: 'image/png' }
        lastReason = failureReason(result, outputReason ?? '산출 검증 실패')
      }
      throw new Error(`Codex 이미지 생성 실패(2회 시도): ${lastReason}`)
    } finally {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    }
  }
}

export const codexImage = createCodexImage()
