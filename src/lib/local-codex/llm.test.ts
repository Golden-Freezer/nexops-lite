import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { buildCodexTextArgs, createCodexText, parseCodexTextOutput } from './llm'

describe('codexText', () => {
  it('read-only 실행 인자와 이미지 인자를 구성한다', () => {
    expect(buildCodexTextArgs({ workDir: 'C:\\tmp\\call', outPath: 'C:\\tmp\\call\\out.txt', imagePaths: ['a.png'] }))
      .toEqual([
        'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
        '--sandbox', 'read-only', '-C', 'C:\\tmp\\call', '--json', '-o', 'C:\\tmp\\call\\out.txt',
        '-i', 'a.png', '-',
      ])
  })

  it('마지막 메시지 파일을 결과로 읽고 기본 타임아웃과 비밀 제거를 적용한다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'must-not-leak')
    const run = vi.fn(async (input: { args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }) => {
      const outPath = input.args[input.args.indexOf('-o') + 1]
      await writeFile(outPath, '  응답 본문  ', 'utf8')
      expect(input.env.OPENAI_API_KEY).toBeUndefined()
      expect(input.timeoutMs).toBe(8 * 60_000)
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    const result = await createCodexText({ run })({
      system: 'JSON으로 답하세요.',
      user: '상품을 분석하세요.',
      images: [{ base64: Buffer.from('image').toString('base64'), mediaType: 'image/png' }],
    })
    expect(result).toBe('응답 본문')
    expect(run).toHaveBeenCalledOnce()
    const args = run.mock.calls[0][0].args
    expect(args.filter((arg: string) => arg === '-i')).toHaveLength(1)
    vi.unstubAllEnvs()
  })

  it('빈 마지막 메시지는 실패로 판독한다', () => {
    expect(() => parseCodexTextOutput(' \n ')).toThrow('빈 응답')
  })
})
