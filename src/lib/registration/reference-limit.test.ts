import { describe, expect, it } from 'vitest'
import { fitSourceRefs } from './reference-limit'

const photos = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('fitSourceRefs', () => {
  it('상한 안이면 그대로다', () => {
    expect(fitSourceRefs(photos(4), 1, 5)).toEqual({ kept: [0, 1, 2, 3], dropped: 0 })
    expect(fitSourceRefs(photos(5), 0, 5)).toEqual({ kept: [0, 1, 2, 3, 4], dropped: 0 })
  })

  it('넘으면 앞을 남기고 뒤를 뺀다 — 뒤에 붙는 참조 몫을 비운다', () => {
    expect(fitSourceRefs(photos(6), 0, 5)).toEqual({ kept: [0, 1, 2, 3, 4], dropped: 1 })
    expect(fitSourceRefs(photos(6), 1, 5)).toEqual({ kept: [0, 1, 2, 3], dropped: 2 })
    expect(fitSourceRefs(photos(5), 1, 5)).toEqual({ kept: [0, 1, 2, 3], dropped: 1 })
  })

  it('상한이 없으면(무한) 그대로다', () => {
    expect(fitSourceRefs(photos(6), 1, Number.POSITIVE_INFINITY)).toEqual({ kept: photos(6), dropped: 0 })
  })

  it('원본을 바꾸지 않는다', () => {
    const input = photos(6)
    fitSourceRefs(input, 1, 5)
    expect(input).toEqual(photos(6))
  })
})
