/**
 * GIF 칸 이미지 태스크 꼴(세션 B ③ P3, 설계 DESIGN 1·1-2절) — K 컷 중 motion_band 칸이고 motionband 스위치가 기록된 잡일 때만
 * 태스크에 motion을 단다. 꺼진 잡·다른 컷은 undefined라 태스크가 바이트 그대로다(부르는 쪽이 값이 있을 때만 펼친다).
 * 순수 함수 — 이미지 태스크 파일을 읽지 않는다(그쪽이 이 파일을 읽는다).
 */

import { hasEnrichmentFeature } from '../enrichment-switch'
import type { PdpJobRow } from '../pdp-state'
import { lineInputsOf } from '../templatelib/input-values'
import { evidenceOf } from '../templatelib/selection-facts'
import { showBeatAction, type ShowBeat } from '../templatelib/show-beat'
import { pickLoopOf, type MotionPlanRecord } from './pick'

/** GIF 칸 섹션 id(K 섹션 motion_band) */
export const MOTION_SECTION = 'motion_band'
/** 옵션 밀기에 드는 실물 옵션 사진 수 — K 근거(select-line MOTION_OPTION_PHOTOS_MIN)와 같은 값이다(시험 고정) */
export const MOTION_SLIDE_PHOTOS_MIN = 2

export interface MotionTask {
  /** 동작 한 줄(칸 카피) — GIF 지시에 싣는다 */
  action: string
  /** gif = 2.6 참조 GIF(상품 실물 사진 첨부), slide = 오너 옵션 사진 밀기($0) */
  mode: 'gif' | 'slide'
  /** 고리 꼴 — 끝 모습이 결과인 동작은 마지막 프레임 머무름, 그 밖은 오가는 동작 */
  loop: 'back_and_forth' | 'ends_in_result'
  /** 실물 옵션 사진 URL — 2장 이상일 때만 들고, GIF가 탈락하면 이것으로 내려간다 */
  optionPhotos: string[]
  /**
   * 움직이는 칸 자리 규칙(templatelib.motion 기록 잡만) — hero = 첫 화면 대표 칸(첫 프레임 = 정지 대표 컷, 포스터도 정지 대표 컷),
   * pick = 계획 AI가 고른 칸. 없으면 지금의 motion_band 칸(바이트 그대로)
   */
  role?: 'hero' | 'pick'
  /** 칸 비율 — 없으면 1:1(지금 motion_band) */
  aspect?: string
  /** 고른 까닭(pick) — 기록용 */
  reason?: string
  /** 사용 동작(use)으로 고른 칸(pick)만 true — 칸 예산이 1.5MB다(motion/stage cellMaxBytesOf, 오너 decide 35·J55). 다른 칸은 값이 없다 */
  useCell?: true
  /** 보여 줄 동작·설계(showbeat 잡, J63)를 동작 줄에 실은 칸만 true — GIF 지시가 '폰 화면에서 읽힐 만큼 크게' 한 줄을 더한다. 다른 칸은 값이 없다 */
  beatShown?: true
}

/**
 * 보여 줄 동작·설계를 움직이는 칸에 싣는다(showbeat 잡, J63) — GIF 칸(대표 칸 말고)만 동작 줄을 그 문구 + 칸 글 첫 줄로 바꾼다.
 * 고리 꼴은 칸 글로 정한 그대로다. 태스크·동작이 없거나 옵션 밀기·대표 칸이면 받은 값 그대로다(바이트 그대로)
 */
export function withShowBeat(task: MotionTask | undefined, beat: ShowBeat | null, show: string): MotionTask | undefined {
  if (!task || !beat || task.mode !== 'gif' || task.role === 'hero') return task
  return { ...task, action: showBeatAction(beat, show), beatShown: true }
}

/** 끝 모습이 결과인 동작 낱말(접힌·펼친·담긴·정리된·완성) — 그 밖은 오가는 동작으로 본다 */
const RESULT_WORDS = /(완성|정리|접힌|접어|펼친|펼쳐|채운|채워|담긴|담아|끼운|끼워|걸린|걸어|세운|세워|된 모습)/

export const motionLoopOf = (action: string): MotionTask['loop'] => (RESULT_WORDS.test(action) ? 'ends_in_result' : 'back_and_forth')

/**
 * 이 컷의 GIF 칸 태스크 — 없으면 undefined(지금처럼 정지 컷).
 * - 인쇄물(글자가 보여야 하는 상품, textBearing)은 참조 GIF가 글자를 거울처럼 뒤집을 수 있어(P03 실측) GIF를 쓰지 않고 옵션 밀기만 쓴다.
 * - 사용법 근거(사용·변형 동작)가 있으면 GIF, 없고 실물 옵션 사진이 2장 이상이면 옵션 밀기, 둘 다 없으면 GIF만(옵션 밀기 없음 — P5).
 * - 인쇄물인데 옵션 사진도 없으면 undefined다(P5부터는 근거 motion도 열리지 않아 칸이 없다 — select-line lineEvidenceOf).
 */
export function motionTaskOf(job: PdpJobRow, shot: { section: string; show: string; key?: string; aspect?: string }, textBearing: boolean): MotionTask | undefined {
  if (!hasEnrichmentFeature(job.analysis, 'motionband')) return undefined
  if (shot.section !== MOTION_SECTION) return pickedTaskOf(job, shot, textBearing)
  const optionPhotos = optionPhotosOf(job)
  const canSlide = optionPhotos.length >= MOTION_SLIDE_PHOTOS_MIN
  const usage = evidenceOf(job.spec_sheet).has('usage')
  const mode: MotionTask['mode'] | null = !textBearing && (usage || !canSlide) ? 'gif' : canSlide ? 'slide' : null
  if (!mode) return undefined
  return { action: shot.show, mode, loop: motionLoopOf(shot.show), optionPhotos: canSlide ? optionPhotos : [] }
}

const optionPhotosOf = (job: PdpJobRow) => lineInputsOf(job).options.flatMap((option) => (option.image ? [option.image] : []))

/** 계획 기록 — motionband 잡이 이 규칙 뒤에 계획을 세웠을 때만 있다(옛 잡·꺼진 잡은 undefined라 지금 그대로) */
export const motionPlanOf = (job: PdpJobRow): MotionPlanRecord | undefined =>
  hasEnrichmentFeature(job.analysis, 'motionband') ? job.section_plan?.templatelib?.motion : undefined

/** 계획 AI가 고른 컷의 움직이는 칸 — 기록에 없는 컷은 undefined. 옵션 밀기는 실물 옵션 사진 2장 이상일 때만, GIF는 인쇄물이 아닐 때만 */
function pickedTaskOf(job: PdpJobRow, shot: { show: string; key?: string; aspect?: string }, textBearing: boolean): MotionTask | undefined {
  const pick = shot.key ? motionPlanOf(job)?.cells.find((cell) => cell.key === shot.key) : undefined
  if (!pick) return undefined
  const photos = optionPhotosOf(job)
  if (pick.kind === 'slide') {
    if (photos.length < MOTION_SLIDE_PHOTOS_MIN) return undefined
    return { action: shot.show, mode: 'slide', loop: 'back_and_forth', optionPhotos: photos, role: 'pick', aspect: shot.aspect ?? '1:1', reason: pick.reason }
  }
  if (textBearing) return undefined
  return {
    action: shot.show,
    mode: 'gif',
    loop: pickLoopOf(pick.kind),
    optionPhotos: [],
    role: 'pick',
    aspect: shot.aspect ?? '1:1',
    reason: pick.reason,
    ...(pick.kind === 'use' ? { useCell: true as const } : {}),
  }
}

/** 대표 칸 동작 — 정지 대표 컷에서 시작하는 작은 움직임(상품은 같은 자리·같은 크기) */
export const HERO_MOTION_ACTION = 'a small, slow, natural motion that brings the hero image to life (a gentle turn, a light glint or the natural use motion), starting exactly from the hero image'

/**
 * 첫 화면 대표 칸(움직이는 칸 자리 규칙 ①) — 계획 기록(templatelib.motion)이 대표 칸을 정한 motionband 잡만. 비율은 정지 대표 컷과 같다.
 * 인쇄물은 기록 단계에서 hero false다(글자 반전 위험, P03). 못 만들면 정지 대표 컷이 그대로 남는다
 */
export function heroMotionTaskOf(job: PdpJobRow, aspect: string): MotionTask | undefined {
  const plan = motionPlanOf(job)
  if (!plan?.hero) return undefined
  return { action: HERO_MOTION_ACTION, mode: 'gif', loop: 'back_and_forth', optionPhotos: [], role: 'hero', aspect }
}
