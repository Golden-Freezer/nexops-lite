import { describe, expect, it } from 'vitest'
import { checkFirstScreen, firstScreenSkippedForWeb, FS_PROMPT, parseFirstScreen, runFirstScreen, type FirstScreenVerdict } from './first-screen'
import { fakeDeps, TEST_OPTIONS } from './new-stages.fixture'

const PASS: FirstScreenVerdict = { what_clear: true, what: '두피 빗', why_clear: true, why: '아침 엉킴', pass: true, fix: '' }
const CAPTURE = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' }

describe('parseFirstScreen', () => {
  it('맞는 답을 그대로 읽는다', () => {
    expect(parseFirstScreen(JSON.stringify(PASS))).toEqual(PASS)
  })

  it.each([
    [{ ...PASS, pass: 'yes' }, 'pass'],
    [{ ...PASS, what_clear: 1 }, 'what_clear'],
    [{ what_clear: true, what: 'x', why_clear: true, why: 'y', pass: true }, 'fix'],
  ])('형식 오류 %#', (value, path) => {
    expect(() => parseFirstScreen(JSON.stringify(value))).toThrow(path)
  })
})

describe('checkFirstScreen — 기록+경고', () => {
  it('합격은 경고 0', () => {
    expect(checkFirstScreen(PASS)).toEqual([])
  })

  it('불합격은 안 보인 쪽과 고칠 곳을 경고로 적는다', () => {
    expect(checkFirstScreen({ ...PASS, why_clear: false, pass: false, fix: '제목에 아침 엉킴을 넣는다' })).toEqual([
      '첫 화면 심사 불합격(왜 갖고 싶은지 안 보임) — 제목에 아침 엉킴을 넣는다',
    ])
  })

  it('pass와 두 판정의 모순·고칠 곳 없는 불합격을 경고한다', () => {
    expect(checkFirstScreen({ ...PASS, what_clear: false, pass: true })).toEqual(['pass가 what_clear·why_clear 판정과 다름'])
    expect(checkFirstScreen({ ...PASS, pass: false })).toEqual([
      '첫 화면 심사 불합격',
      'pass가 what_clear·why_clear 판정과 다름',
      '불합격인데 고칠 곳(fix)이 비어 있음',
    ])
  })
})

describe('runFirstScreen', () => {
  it('웹 잡(캡처 없음)은 부르지 않고 web_no_renderer 생략으로 기록한다', async () => {
    const { deps, calls } = fakeDeps({ text: JSON.stringify(PASS) })
    const record = await runFirstScreen(null, deps, TEST_OPTIONS)
    expect(record).toEqual({ version: 1, stage: 'firstScreen', status: 'skipped', reason: 'web_no_renderer' })
    expect(record).toEqual(firstScreenSkippedForWeb())
    expect(calls).toHaveLength(0)
  })

  it('캡처가 있으면 route 이름 compose/first-screen으로 이미지와 시제품 프롬프트를 보낸다', async () => {
    const { deps, calls, routeNames } = fakeDeps({ text: JSON.stringify(PASS) })
    const record = await runFirstScreen(CAPTURE, deps, TEST_OPTIONS)
    expect(routeNames).toEqual(['compose/first-screen'])
    expect(calls[0].request.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: FS_PROMPT },
    ])
    expect(FS_PROMPT).toContain('the top 1860px of an 860px-wide page')
    expect(record).toMatchObject({ stage: 'firstScreen', status: 'done', result: PASS, warnings: [] })
  })

  it('잘린 답은 failed(truncated)', async () => {
    const { deps } = fakeDeps({ text: '{"what_clear": true, "what": "두', stopReason: 'max_tokens' })
    expect(await runFirstScreen(CAPTURE, deps, TEST_OPTIONS)).toMatchObject({ status: 'failed', failure: { kind: 'truncated' } })
  })
})
