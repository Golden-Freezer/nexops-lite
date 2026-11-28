/**
 * 잡 감시 셈(결정 카드 c33, 가정 A7) — 컷 기록(section_images)에 이미 있는 값을 잡 한 줄로 센다. 라운드 감시가 조용한 실패를 바로 알리게,
 * 0이 아니면 경고 한 줄을 낸다(기록만 — 운영 동작 0). 시험 원장(pdp-program 하네스)이 이 함수를 쓰고, 통합 운영 잡 기록(INTEG r12-record.mjs)은
 * 같은 셈을 그 파일 안에 옮겨 쓴다(리포 밖 도구라 import하지 않는다 — 셈을 바꾸면 그쪽도 함께 바꾼다).
 * - useCorrectFalse: 게이트 사용 판정 미달(gate.use_correct === false) 컷 수 — 손·몸 컷을 반대로 쥐는 등
 * - useFactsNone: 손·착용·사용 컷인데 쓰는 법 재료가 없어 Use 줄 없이 만든 컷 수(useFacts 'none')
 * - gifUploadFailed: 원본 GIF 올리기 실패(움직이는 WebP는 그대로) 칸 수 — motion.reason에 남는다(motion/stage.ts)
 * - motionPoster: 움직이는 칸이 포스터 한 장으로 내려간 칸 수(motion.status 'poster')
 * - heroMotion: 첫 칸(대표 컷) 움직임 — ok(움직이는 WebP)·poster(포스터로 내려감)·null(움직이는 칸 아님)
 * 첫 화면 넓이·제목·움직임 시작 위치는 캡처로 잰다(scripts/pdp-eval/design-diagnostics.mjs).
 */

import type { SectionImage } from '../pdp-state'

/** motion/stage.ts가 남기는 원본 GIF 올리기 실패 까닭의 머리 */
export const GIF_UPLOAD_FAILED_MARK = '원본 GIF 올리기 실패'

export interface WatchCounts {
  useCorrectFalse: number
  useFactsNone: number
  gifUploadFailed: number
  motionPoster: number
  heroMotion: 'ok' | 'poster' | null
  /** 0이 아닌 칸의 컷 이름(경고 줄용) — 칸마다 앞 5개 */
  sections: { useCorrectFalse: string[]; useFactsNone: string[]; gifUploadFailed: string[] }
}

type WatchImage = Pick<SectionImage, 'section' | 'gate' | 'useFacts' | 'motion'>

const isHeroSection = (section: string) => section === 'hero' || section === 'hero_motion'

/** 컷 기록 → 감시 셈. 기록이 없으면 모두 0·null */
export function watchCountsOf(images: readonly WatchImage[] | null | undefined): WatchCounts {
  const list = images ?? []
  const pick = (test: (image: WatchImage) => boolean) => list.filter(test).map((image) => image.section)
  const useCorrectFalse = pick((image) => image.gate?.use_correct === false)
  const useFactsNone = pick((image) => image.useFacts === 'none')
  const gifUploadFailed = pick((image) => Boolean(image.motion?.reason?.includes(GIF_UPLOAD_FAILED_MARK)))
  const hero = list.find((image) => isHeroSection(image.section) && image.motion)
  return {
    useCorrectFalse: useCorrectFalse.length,
    useFactsNone: useFactsNone.length,
    gifUploadFailed: gifUploadFailed.length,
    motionPoster: list.filter((image) => image.motion?.status === 'poster').length,
    heroMotion: hero?.motion?.status ?? null,
    sections: { useCorrectFalse: useCorrectFalse.slice(0, 5), useFactsNone: useFactsNone.slice(0, 5), gifUploadFailed: gifUploadFailed.slice(0, 5) },
  }
}

/** 0이 아닌 칸만 경고 한 줄로 — 모두 0이면 null. 첫 칸 움직임이 포스터로 내려갔으면 함께 알린다 */
export function watchWarningOf(counts: WatchCounts): string | null {
  const parts: string[] = []
  const named = (label: string, n: number, sections: string[]) => parts.push(`${label} ${n}(${sections.join('·')}${n > sections.length ? '…' : ''})`)
  if (counts.useCorrectFalse > 0) named('사용 판정 미달', counts.useCorrectFalse, counts.sections.useCorrectFalse)
  if (counts.useFactsNone > 0) named('쓰는 법 재료 없음', counts.useFactsNone, counts.sections.useFactsNone)
  if (counts.gifUploadFailed > 0) named('원본 GIF 올리기 실패', counts.gifUploadFailed, counts.sections.gifUploadFailed)
  if (counts.heroMotion === 'poster') parts.push('첫 칸 움직임이 포스터로 내려감')
  return parts.length > 0 ? `감시 경고: ${parts.join(' / ')}` : null
}
