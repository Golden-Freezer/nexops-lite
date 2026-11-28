/**
 * 글자 수 상한 자르기 — 상한은 UTF-16 단위 그대로, 서로게이트 쌍(이모지) 가운데에서는 끊지 않는다.
 */

import { describe, expect, it } from 'vitest'
import { clipUtf16, dropLoneSurrogates } from './text-clip'

describe('clipUtf16', () => {
  it('상한 이하는 그대로, 넘으면 상한에서', () => {
    expect(clipUtf16('가나다', 3)).toBe('가나다')
    expect(clipUtf16('가나다라', 3)).toBe('가나다')
    expect(clipUtf16('가나다', 0)).toBe('')
  })

  it('상한이 이모지 가운데면 그 이모지를 통째로 뺀다(한 단위 앞), 다 들어가면 남긴다', () => {
    expect(clipUtf16('가나😀라', 3)).toBe('가나')
    expect(clipUtf16('가나😀라', 4)).toBe('가나😀')
    expect(clipUtf16('😀😀', 3)).toBe('😀')
  })

  it('이미 깨진 입력의 짝 없는 서로게이트는 지운다(정상 이모지는 그대로)', () => {
    expect(clipUtf16('\uDE00abc', 10)).toBe('abc')
    expect(clipUtf16('ab\uD83D', 10)).toBe('ab')
    expect(dropLoneSurrogates('가😀\uD83D나\uDE00')).toBe('가😀나')
  })
})
