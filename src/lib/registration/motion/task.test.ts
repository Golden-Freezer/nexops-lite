/**
 * GIF 칸 태스크 꼴(세션 B ③ P3) — motionband 스위치 잡의 motion_band 컷만 motion을 달고, 꺼진 잡·다른 컷은 undefined(태스크 바이트 그대로).
 * 옵션 사진 입력은 가짜다(lineInputsOf).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdpJobRow } from '../pdp-state'

const h = vi.hoisted(() => ({ options: [] as Array<{ label: string; image: string | null }> }))
vi.mock('../templatelib/input-values', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../templatelib/input-values')>()),
  lineInputsOf: () => ({ options: h.options }),
}))

const { MOTION_SECTION, MOTION_SLIDE_PHOTOS_MIN, motionLoopOf, motionTaskOf } = await import('./task')
const { MOTION_OPTION_PHOTOS_MIN } = await import('../templatelib/select-line')

const jobOf = (features: string[], spec: Record<string, unknown> = { usageLocation: '거실' }) =>
  ({ id: 'J1', spec_sheet: { productName: '시험 상품', ...spec }, analysis: { enrichment: { version: 1, features } } }) as unknown as PdpJobRow
const ON = ['designcut', 'templatelib', 'motionband']
const OFF = ['designcut', 'templatelib']
const shot = (show = '한 손으로 흔들어 섞는 모습') => ({ section: MOTION_SECTION, show })
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `옵션${i}`, image: `https://example.com/o${i}.jpg` }))

beforeEach(() => {
  h.options = []
})

describe('motionTaskOf', () => {
  it('스위치가 꺼진 잡은 motion_band 컷이어도 undefined다 — 태스크가 바이트 그대로', () => {
    h.options = photos(3)
    expect(motionTaskOf(jobOf(OFF), shot(), false)).toBeUndefined()
  })

  it('켜진 잡도 motion_band가 아닌 컷은 undefined다', () => {
    expect(motionTaskOf(jobOf(ON), { section: 'sub2_div_page', show: '쓰는 모습' }, false)).toBeUndefined()
  })

  it('사용법 근거가 있으면 2.6 참조 GIF — 옵션 사진이 2장 이상이면 내려갈 사진으로 함께 든다', () => {
    expect(motionTaskOf(jobOf(ON), shot(), false)).toEqual({ action: '한 손으로 흔들어 섞는 모습', mode: 'gif', loop: 'back_and_forth', optionPhotos: [] })
    h.options = [...photos(2), { label: '사진 없음', image: null }]
    expect(motionTaskOf(jobOf(ON), shot(), false)?.optionPhotos).toEqual(['https://example.com/o0.jpg', 'https://example.com/o1.jpg'])
  })

  it('사용법 근거가 없고 실물 옵션 사진이 2장 이상이면 옵션 밀기', () => {
    h.options = photos(MOTION_SLIDE_PHOTOS_MIN)
    expect(motionTaskOf(jobOf(ON, {}), shot('색이 바뀌는 모습'), false)?.mode).toBe('slide')
  })

  it('인쇄물(글자가 보여야 하는 상품)은 GIF를 쓰지 않는다 — 옵션 사진이 있으면 밀기, 없으면 undefined(정지 컷)', () => {
    h.options = photos(2)
    expect(motionTaskOf(jobOf(ON), shot(), true)?.mode).toBe('slide')
    h.options = photos(1)
    expect(motionTaskOf(jobOf(ON), shot(), true)).toBeUndefined()
  })

  it('옵션 밀기 사진 수 기준은 K 근거(select-line)와 같다', () => {
    expect(MOTION_SLIDE_PHOTOS_MIN).toBe(MOTION_OPTION_PHOTOS_MIN)
  })

  it('고른 칸: 사용 동작(use)만 useCell 표지(칸 예산 1.5MB, J55) — 다른 종류는 표지 없이 지금 태스크 그대로', () => {
    const planned = (kind: string) =>
      ({
        ...jobOf(ON),
        section_plan: { templatelib: { motion: { engine: 'gif-sheet', hero: true, cells: [{ key: 'k5_a', kind, reason: '까닭' }], candidates: 1, max: 1, rejected: 0 } } },
      }) as unknown as PdpJobRow
    const cut = { section: 'point_div', show: '문질러 거품 내기', key: 'k5_a', aspect: '3:4' }
    const base = { action: '문질러 거품 내기', mode: 'gif', optionPhotos: [], role: 'pick', aspect: '3:4', reason: '까닭' }
    expect(motionTaskOf(planned('use'), cut, false)).toEqual({ ...base, loop: 'back_and_forth', useCell: true })
    expect(motionTaskOf(planned('assemble'), cut, false)).toEqual({ ...base, loop: 'ends_in_result' })
    expect(motionTaskOf(planned('transform'), cut, false)).not.toHaveProperty('useCell')
    expect(motionTaskOf(planned('scale'), cut, false)).not.toHaveProperty('useCell')
  })
})

describe('motionLoopOf', () => {
  it('끝 모습이 결과인 동작은 머무름, 그 밖은 오가는 동작', () => {
    expect(motionLoopOf('반으로 접어 넣는 모습')).toBe('ends_in_result')
    expect(motionLoopOf('펼친 모습')).toBe('ends_in_result')
    expect(motionLoopOf('흔들어 섞는 모습')).toBe('back_and_forth')
    expect(motionLoopOf('머리를 빗는 모습')).toBe('back_and_forth')
  })
})
