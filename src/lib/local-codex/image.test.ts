import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_IMAGE_RATE_LIMIT_MESSAGE,
  RateLimitedError,
  buildCodexImageArgs,
  createCodexImage,
  isRateLimitOutput,
  parsePngDimensions,
} from './image'

function fakePng(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('codexImage', () => {
  it('workspace-write 실행 인자를 구성한다', () => {
    expect(buildCodexImageArgs('C:\\tmp\\cut', ['ref.png'])).toEqual([
      'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write',
      '-C', 'C:\\tmp\\cut', '-i', 'ref.png', '-',
    ])
  })

  it('임시 폴더의 out/image.png를 검증해 반환한다', async () => {
    const png = fakePng(1024, 1024)
    const run = vi.fn(async (input: { cwd: string; args: string[]; timeoutMs: number }) => {
      await writeFile(path.join(input.cwd, 'out', 'image.png'), png)
      expect(input.args).toContain('workspace-write')
      expect(input.timeoutMs).toBe(8 * 60_000)
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    const result = await createCodexImage({ run })({
      prompt: '흰 배경 상품 사진',
      referenceImages: [{ base64: Buffer.from('reference').toString('base64'), mimeType: 'image/png' }],
    })
    expect(result).toEqual({ base64: png.toString('base64'), mimeType: 'image/png' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('PNG 헤더에서 크기를 판독한다', () => {
    expect(parsePngDimensions(fakePng(1200, 800))).toEqual({ width: 1200, height: 800 })
    expect(parsePngDimensions(Buffer.from('not-png'))).toBeNull()
  })

  it.each([
    '429 Too Many Requests',
    'rate limit exceeded',
    'usage_limit_reached',
  ])('Codex 출력의 이미지 한도 오류를 판별한다: %s', (output) => {
    expect(isRateLimitOutput(output)).toBe(true)
  })

  it('한도 오류는 재시도하지 않고 RateLimitedError로 던진다', async () => {
    const run = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'ERROR: exceeded retry limit, last status: 429 Too Many Requests',
      timedOut: false,
    }))

    const promise = createCodexImage({ run })({ prompt: '상품 이미지' })
    await expect(promise).rejects.toEqual(expect.any(RateLimitedError))
    await expect(promise).rejects.toThrow(CODEX_IMAGE_RATE_LIMIT_MESSAGE)
    expect(run).toHaveBeenCalledOnce()
  })

  it('정상 이미지가 나오면 로그에 429 글자가 있어도 성공으로 본다', async () => {
    const png = fakePng(1024, 1024)
    const run = vi.fn(async (input: { cwd: string }) => {
      await writeFile(path.join(input.cwd, 'out', 'image.png'), png)
      return { exitCode: 0, stdout: 'user: 리뷰 429개 텀블러', stderr: '', timedOut: false }
    })
    const result = await createCodexImage({ run })({ prompt: '리뷰 429개 텀블러' })
    expect(result.base64).toBe(png.toString('base64'))
  })
})
