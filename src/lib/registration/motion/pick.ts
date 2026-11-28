/**
 * 움직이는 칸 고르기(세션 B 움직이는 칸 자리 규칙 ②, 오너 2026-11-06 21:57 "그 외에 담당 ai agent가 판단해서 이미지보다 움직이는 이미지가 들어가야 하는 자리에").
 * 후보는 코드가 정하고(계획 컷 중 움직임이 정지 컷보다 나은 칸, 내보내기가 바꿔 넣을 수 있는 칸만), 계획 AI는 그 안에서만 고르며 까닭을 남긴다.
 * 상한은 대표 칸 포함 3칸 — 대표 1 + motion_band(있으면) + 고른 칸. 모르는 키·종류, 같은 섹션 둘째 칸, 상한 밖은 버린다.
 * 순수 함수(프롬프트·응답 읽기·후보) — 모델 콜은 agents/registration/pdp-motion-pick-agent.ts가 한다.
 */

import type { LineShot } from '../templatelib/shot-brief'
import type { MotionEngineId } from './engine'
import { gifFrameSizeOf } from './engine'

/** 움직임 종류 — 사용 동작·변형·조립·크기 비교·옵션 밀기 */
export const MOTION_KINDS = ['use', 'transform', 'assemble', 'scale', 'slide'] as const
export type MotionKind = (typeof MOTION_KINDS)[number]

/** 페이지 움직이는 칸 상한(대표 칸 포함) */
export const MOTION_CELLS_MAX = 3
/** 대표 칸 섹션 키(section_images) — 정지 대표 컷(hero) 다음에 만든다 */
export const HERO_MOTION_SECTION = 'hero_motion'
/** 지금의 움직이는 띠 섹션(motion/task MOTION_SECTION과 같은 값) */
const BAND_SECTION = 'motion_band'

/** 움직임이 정지 컷보다 나은 컷 — 목적(동작·상태 바뀜·크기)이나 구도(손에 든·쓰는 중) */
const MOVING_PURPOSES: readonly string[] = ['action', 'state', 'scale']
const MOVING_COMPOSITIONS: readonly string[] = ['in_hand', 'in_use']

export interface MotionCandidate {
  key: string
  section: string
  purpose: string
  composition: string
  show: string
  kinds: MotionKind[]
  /** 칸 글이 말한 보여 줄 동작·설계 이름(showbeat 잡만, J63 show-beat label). 없으면 후보 줄이 지금 그대로다 */
  beat?: string
}

export interface MotionPick {
  key: string
  kind: MotionKind
  reason: string
}

/** 계획 기록(templatelib.motion) — 이 기록이 있는 잡만 대표 칸·고른 칸을 만든다(없는 잡은 지금처럼 motion_band만) */
export interface MotionPlanRecord {
  engine: MotionEngineId
  /** 대표 칸을 만드는가 — 인쇄물(글자 반전 위험, P03)은 false */
  hero: boolean
  heroReason?: string
  /** 고른 칸(대표·motion_band 밖) */
  cells: MotionPick[]
  /** 코드가 준 후보 수와 고르기 상한 */
  candidates: number
  max: number
  /** 버린 답(모르는 키·상한 밖 등)의 수 */
  rejected: number
  error?: string
  costUsd?: number
}

/** 고른 칸 고리 꼴 — 끝 모습이 결과인 종류(변형·조립)는 머무름, 그 밖은 오가는 동작 */
export const pickLoopOf = (kind: MotionKind): 'back_and_forth' | 'ends_in_result' => (kind === 'transform' || kind === 'assemble' ? 'ends_in_result' : 'back_and_forth')

/**
 * 후보 — 계획 컷 중 내보내기가 바꿔 넣을 수 있는 칸(사진 위 글·원·아치 틀·치수 칸 아님, GIF 크기가 있는 비율)만.
 * GIF 종류는 인쇄물이 아닐 때만(글자 반전), 옵션 밀기는 실물 옵션 사진 2장 이상이고 옵션 섹션 칸일 때만
 */
export function motionCandidatesOf(shots: readonly LineShot[], opts: { textBearing: boolean; optionPhotos: number }): MotionCandidate[] {
  return shots.flatMap((shot) => {
    if (shot.section === BAND_SECTION || shot.overlayAnchor || shot.clipShape || shot.sizeCut || !gifFrameSizeOf(shot.aspect)) return []
    const moving = MOVING_PURPOSES.includes(shot.purpose) || MOVING_COMPOSITIONS.includes(shot.composition)
    const gifKinds: MotionKind[] = opts.textBearing || !moving ? [] : shot.purpose === 'scale' ? ['scale', 'use'] : shot.purpose === 'state' ? ['transform', 'assemble', 'use'] : ['use', 'transform', 'assemble']
    const kinds: MotionKind[] = [...gifKinds, ...(opts.optionPhotos >= 2 && shot.section.startsWith('option') ? (['slide'] as const) : [])]
    return kinds.length > 0 ? [{ key: shot.key, section: shot.section, purpose: shot.purpose, composition: shot.composition, show: shot.show, kinds }] : []
  })
}

/** 고를 수 있는 칸 수 — 상한 3에서 대표 칸·motion_band 칸을 뺀다 */
export const pickMaxOf = (hero: boolean, hasBand: boolean): number => Math.max(0, MOTION_CELLS_MAX - (hero ? 1 : 0) - (hasBand ? 1 : 0))

/** 모델 답 거르기 — 후보 키·그 후보가 받는 종류만, 섹션마다 한 칸, 상한까지. 까닭은 120자 */
export function clampPicks(raw: unknown, candidates: readonly MotionCandidate[], max: number): { cells: MotionPick[]; rejected: number } {
  const list = Array.isArray(raw) ? raw : []
  const byKey = new Map(candidates.map((c) => [c.key, c]))
  const cells: MotionPick[] = []
  const sections = new Set<string>()
  let rejected = 0
  for (const item of list) {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const candidate = typeof o.key === 'string' ? byKey.get(o.key) : undefined
    const kind = o.kind as MotionKind
    const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, 120) : ''
    if (!candidate || !candidate.kinds.includes(kind) || !reason || sections.has(candidate.section) || cells.length >= max || cells.some((c) => c.key === candidate.key)) {
      rejected += 1
      continue
    }
    sections.add(candidate.section)
    cells.push({ key: candidate.key, kind, reason })
  }
  return { cells, rejected }
}

export const MOTION_PICK_SYSTEM =
  '너는 쿠팡 상세페이지의 움직이는 칸을 고르는 디자이너다. 정지 사진보다 짧은 움직임(1~2초 고리)이 고객 이해를 확실히 돕는 칸만 고른다. 꾸밈용 움직임은 고르지 않는다. JSON만 답한다.'

/** 고르기 입력 — effectUse는 effectshot 잡만 true(하네스 J53). 없으면 프롬프트가 바이트 그대로다 */
export interface MotionPickInput {
  product: string
  candidates: readonly MotionCandidate[]
  max: number
  effectUse?: boolean
}

/** use 설명 — 지금 판과 effectshot 판(효과가 보이는 사용 동작) */
const USE_KIND = 'use = 사용 동작(누르기·빗질·붙이기)'
const USE_KIND_EFFECT = 'use = 사용 동작(누르기·빗질·붙이기 — 문지르면 거품이 일고 빗질하면 털이 모이는 것처럼 쓴 효과가 보이는 동작이면 더 좋다)'
/** effectshot 판의 고르기 순서 — use를 받는 칸을 조립·변형보다 먼저 */
export const USE_FIRST_LINE = '- use를 받는 후보가 있으면 assemble·transform 칸보다 그 칸을 먼저 고른다.'
/** showbeat 판의 고르기 순서(J63) — 칸 글이 말한 동작·설계를 움직임으로 보여 줄 칸을 먼저. 보여 줄 동작이 적힌 후보가 있을 때만 붙는다 */
export const BEAT_FIRST_LINE = "- '보여 줄 동작'이 적힌 후보가 있으면 그 칸을 먼저 고른다 — 카피가 말한 동작·설계를 움직임으로 직접 보여 줄 칸이다."

export function buildMotionPickPrompt(input: MotionPickInput): string {
  const rows = input.candidates.map(
    (c) => `- key "${c.key}" · 섹션 ${c.section} · 목적 ${c.purpose} · 구도 ${c.composition} · 받는 종류 ${c.kinds.join('/')} · 칸 글: ${c.show || '(없음)'}${c.beat ? ` · 보여 줄 동작: ${c.beat}` : ''}`
  )
  return [
    `상품: ${input.product}`,
    '첫 화면 대표 컷은 이미 움직이는 칸이다. 아래 후보 칸 가운데 움직임이 정지 사진보다 나은 칸을 고른다.',
    `- 최대 ${input.max}칸, 섹션마다 한 칸. 나은 칸이 없으면 빈 목록이다.`,
    `- 종류: ${input.effectUse ? USE_KIND_EFFECT : USE_KIND}, transform = 변형(접기·펴기·늘이기), assemble = 조립·끼우기, scale = 손·물건과 크기 비교, slide = 옵션 사진 밀기.`,
    ...(input.effectUse ? [USE_FIRST_LINE] : []),
    ...(input.candidates.some((c) => c.beat) ? [BEAT_FIRST_LINE] : []),
    '- 그 칸이 받는 종류만 쓴다. reason은 고객이 무엇을 더 빨리 알게 되는지 한 문장(60자 안팎)이다.',
    '',
    '후보:',
    ...rows,
    '',
    '답 꼴: {"motion":[{"key":"후보 key","kind":"종류","reason":"까닭"}]}',
  ].join('\n')
}

/** 답 읽기 — JSON 객체의 motion 배열(코드 울타리·앞뒤 글 허용). 못 읽으면 던진다(콜이 실패로 센다) */
export function parseMotionPick(text: string): unknown[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('움직이는 칸 고르기 답에 JSON이 없습니다.')
  const parsed = JSON.parse(text.slice(start, end + 1)) as { motion?: unknown }
  if (!Array.isArray(parsed.motion)) throw new Error('움직이는 칸 고르기 답에 motion 목록이 없습니다.')
  return parsed.motion
}
