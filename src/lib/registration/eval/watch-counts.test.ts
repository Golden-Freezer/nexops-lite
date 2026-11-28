/**
 * 잡 감시 셈(결정 카드 c33) — 컷 기록의 사용 판정 미달·쓰는 법 재료 없음·원본 GIF 올리기 실패·포스터 칸·첫 칸 움직임과 경고 한 줄.
 * 기록 모양은 지난 K8 시험 잡 T01 그대로(hero_motion·K 컷 motion 칸, 원본 GIF 버킷 거절 까닭).
 */

import { describe, expect, it } from 'vitest'
import type { SectionImage, SectionMotion } from '../pdp-state'
import { GIF_UPLOAD_FAILED_MARK, watchCountsOf, watchWarningOf } from './watch-counts'

const motion = (status: SectionMotion['status'], reason?: string): SectionMotion => ({
  path: 'gpt26-ref',
  status,
  width: 780,
  height: 780,
  frames: 12,
  durationMs: 1800,
  bytes: 900000,
  quality: 70,
  loop: 'pingpong',
  ...(reason ? { reason } : {}),
})
const gifFail = `${GIF_UPLOAD_FAILED_MARK}(움직이는 WebP는 그대로): PDP 이미지 업로드 실패(hero_motion-gif): mime type image/gif is not supported`
const gate = (use_correct?: boolean): SectionImage['gate'] => ({
  verdict: 'pass',
  consistency: 9,
  same_product: true,
  has_artifact: false,
  ...(use_correct === undefined ? {} : { use_correct }),
})

describe('watchCountsOf', () => {
  it('T01 모양 — 첫 칸·K 컷 움직이는 칸 셋 모두 원본 GIF 올리기 실패, 첫 칸 움직임은 ok', () => {
    const images: SectionImage[] = [
      { section: 'hero', url: 'h.png', gate: gate() },
      { section: 'hero_motion', url: 'hm.jpg', motion: motion('ok', gifFail) },
      { section: 'k4_photo_0', url: 'k4.jpg', motion: motion('ok', gifFail.replace('hero_motion', 'k4_photo_0')) },
      { section: 'k14_clip_0', url: 'k14.jpg', motion: motion('ok', gifFail.replace('hero_motion', 'k14_clip_0')) },
      { section: 'k2_photo_0', url: 'k2.png', gate: gate(true) },
    ]
    const counts = watchCountsOf(images)
    expect(counts).toEqual({
      useCorrectFalse: 0,
      useFactsNone: 0,
      gifUploadFailed: 3,
      motionPoster: 0,
      heroMotion: 'ok',
      sections: { useCorrectFalse: [], useFactsNone: [], gifUploadFailed: ['hero_motion', 'k4_photo_0', 'k14_clip_0'] },
    })
    expect(watchWarningOf(counts)).toBe('감시 경고: 원본 GIF 올리기 실패 3(hero_motion·k4_photo_0·k14_clip_0)')
  })

  it('사용 판정 미달·쓰는 법 재료 없음·포스터 칸·첫 칸 포스터를 센다 — 묻지 않은 판정(칸 없음)은 미달이 아니다', () => {
    const images: SectionImage[] = [
      { section: 'hero', url: 'h.png', motion: motion('poster', '검사 탈락: 글자 반전') },
      { section: 'k3_hand_0', url: 'a.png', gate: gate(false), useFacts: 'none' },
      { section: 'k5_hand_0', url: 'b.png', gate: gate(false) },
      { section: 'k6_worn_0', url: 'c.png', gate: gate(), useFacts: 'none' },
      { section: 'motion:2', url: 'm.jpg', motion: motion('poster', 'GIF 칸 예산 초과') },
    ]
    const counts = watchCountsOf(images)
    expect(counts.useCorrectFalse).toBe(2)
    expect(counts.useFactsNone).toBe(2)
    expect(counts.gifUploadFailed).toBe(0)
    expect(counts.motionPoster).toBe(2)
    expect(counts.heroMotion).toBe('poster')
    expect(watchWarningOf(counts)).toBe('감시 경고: 사용 판정 미달 2(k3_hand_0·k5_hand_0) / 쓰는 법 재료 없음 2(k3_hand_0·k6_worn_0) / 첫 칸 움직임이 포스터로 내려감')
  })

  it('컷 이름은 칸마다 앞 5개 — 넘으면 경고 줄 끝에 …', () => {
    const images: SectionImage[] = Array.from({ length: 7 }, (_, i) => ({ section: `k${i}_hand_0`, url: `${i}.png`, useFacts: 'none' as const }))
    const counts = watchCountsOf(images)
    expect(counts.useFactsNone).toBe(7)
    expect(counts.sections.useFactsNone).toHaveLength(5)
    expect(watchWarningOf(counts)).toBe('감시 경고: 쓰는 법 재료 없음 7(k0_hand_0·k1_hand_0·k2_hand_0·k3_hand_0·k4_hand_0…)')
  })

  it('기록이 없거나 모두 0이면 경고 없음, 움직이는 칸이 없으면 heroMotion null', () => {
    const empty = watchCountsOf(null)
    expect(empty).toMatchObject({ useCorrectFalse: 0, useFactsNone: 0, gifUploadFailed: 0, motionPoster: 0, heroMotion: null })
    expect(watchWarningOf(empty)).toBeNull()
    const passed: SectionImage[] = [{ section: 'hero', url: 'h.png', gate: gate(true) }]
    expect(watchWarningOf(watchCountsOf(passed))).toBeNull()
  })
})
