/**
 * K 컷 목적을 글에 맞춘다(분석 2차 A4 #10) — assignShots는 글이 나오기 전에 '가장 덜 쓴 값'으로 나눠 준 초안이다. 슬롯 카피 뒤에
 * 그 칸의 글이 구조·소재·크기·동작·장소를 말하면 컷 목적을 그 말로 바꾼다. 슬롯이 그 목적을 받지 않으면 구도만 옮기고 내용은 글 줄(Show)이 전한다.
 * 낱말이 없는 글은 그대로 둔다 — feature_proof 줄이 이미 '뜻이 그림에 보이게' 지시한다. 추가 콜 없음. 순수·결정론.
 */

import { PLACE_RE, purposesIn } from '../internalized/shot-words'
import { templateById } from './library'
import { imageSlots, type OrderedSection } from './selection-order'
import { HERO_SHOT_KEY, keyedShots, type KeyedShot } from './section-values'
import {
  allowedCompositions,
  allowedPurposes,
  HAND_OR_WORN,
  isTouchScale,
  SAME_PURPOSE_MAX_RUN,
  SHOT_MINIMUM,
  shotKeyOf,
  TOUCH_COMPOSITIONS,
  type ShotContext,
  type ShotPlan,
} from './shot-assign'
import type { CopyValues } from './slot-copy'
import type { MetaImageSlot, TemplateMeta } from './template-meta'

export interface RefineContext extends ShotContext {
  /** 사양 소재 낱말(materialWords) — 카피가 소재를 그대로 말하면 질감 목적이다 */
  materials: readonly string[]
}

/** 글이 바꾼 결과(숫자만, 글은 남기지 않는다) — worded는 목적 낱말이 있는 컷, matched는 그 가운데 목적이 낱말과 맞는 컷이다. 대표 컷은 세지 않는다 */
export interface ShotRefineRecord {
  total: number
  worded: number
  matchedBefore: number
  matchedAfter: number
  purposeChanged: number
  compositionOnly: number
  /**
   * 못 맞춘 까닭 — fixed 글이 정하지 않는 컷(고민·입력값), said 섹션 글을 같이 쓰는 다른 컷이 그 말을 이미 그림(칸마다 한 말),
   * composition 슬롯이 그 목적을 받지 않지만 지금 구도가 이미 그 말의 구도임(손에 든 컷과 크기 말 등), slot 슬롯이 받지 않고 구도도 못 옮김,
   * rule 페이지 규칙(연속·반복·최소 장 수)이나 구도가 막음. worded = matchedAfter + compositionOnly + 까닭 다섯의 합이다(적용 K6 ⑤ R-K12)
   */
  blocked: { fixed: number; said: number; composition: number; slot: number; rule: number }
}

export interface ShotRefineResult {
  sections: OrderedSection[]
  record: ShotRefineRecord
}

/** 글이 바꿀 수 있는 목적 — 고민 컷과 입력값이 정하는 컷(색·구성·수량·포장·재료·상태)은 글이 정하지 않는다 */
const OPEN_PURPOSES: ReadonlySet<string> = new Set(['hero', 'feature_proof', 'scene', 'action', 'underside', 'texture', 'scale'])

/** 목적에 어울리는 구도 — 앞에서부터 슬롯이 받는 값을 쓴다 */
const PURPOSE_COMPOSITIONS: Readonly<Record<string, readonly string[]>> = {
  scene: ['in_use', 'worn'],
  action: ['in_hand', 'in_use'],
  scale: TOUCH_COMPOSITIONS,
  texture: ['closeup'],
  underside: ['closeup', 'top', 'angle45', 'side'],
}
/**
 * 쓰임 증거(feature_proof) 칸이 글을 따라 받는 증거 갈래(적용 K6 ⑤ R-K12, 통합 11-03 14:5x) — 구조·소재를 말하는 글이면 밑면·질감 컷도 '뜻이 그림에 보이게'와 같은 일이다.
 * 글 맞춤 안에서만 연다(초안 배정·계획은 그대로). 크기는 열지 않는다 — 크기 컷은 페이지 최소 장 수 규칙이 따로 정하고 컷 지시 Size 줄이 있다
 */
const PROOF_KINDS: readonly string[] = ['underside', 'texture']
const acceptedByCopy = (purposes: readonly string[]): readonly string[] =>
  purposes.includes('feature_proof') ? [...purposes, ...PROOF_KINDS.filter((kind) => !purposes.includes(kind))] : purposes
const HANDS_ON: ReadonlySet<string> = new Set(TOUCH_COMPOSITIONS)
/** 구도만 옮길 때 쓰지 않는 값 — 각도만 바뀌어서는 글이 말하는 곳이 보이지 않는다 */
const ANGLE_ONLY: ReadonlySet<string> = new Set(['angle45', 'side'])
/** 지금 목적과 부딪치는 구도 — 목적 줄과 Camera 줄이 서로 다른 말을 하게 된다(전체를 보여라 + 근접, 들어 보이지 마라 + 손, 손 없이 + 손) */
const CLASHES: Readonly<Record<string, readonly string[]>> = { hero: ['closeup'], scene: ['in_hand'], underside: TOUCH_COMPOSITIONS }

/** 컷이 놓이는 칸의 글 — 목록 칸은 그 항목의 글(own), 없으면 섹션의 글 */
export function shotTextOf(copy: CopyValues | undefined, shot: Pick<KeyedShot, 'slot' | 'item'>): { text: string; own: boolean } {
  const strings = (values: object) => Object.values(values).filter((value): value is string => typeof value === 'string')
  const [name, field] = shot.slot.split('.')
  const rows = field ? copy?.[name] : undefined
  const row = Array.isArray(rows) ? rows[shot.item] : undefined
  const own = row && typeof row === 'object' ? strings(row) : []
  return { text: (own.length > 0 ? own : strings(copy ?? {})).join(' — ').trim(), own: own.length > 0 }
}

/** 글이 말하는 목적 — 장소가 먼저다(글이 장소를 말하면 그 장면을 그려야 한다, shot-diversity와 같은 순서) */
export function wordPurposesOf(text: string, context: Pick<RefineContext, 'hasSize' | 'materials'>): string[] {
  return [...(PLACE_RE.test(text) ? ['scene'] : []), ...purposesIn(text, context.hasSize, context.materials)]
}

interface Entry {
  row: number
  at: number
  key: string
  plan: ShotPlan
  def: MetaImageSlot | undefined
  text: string
  own: boolean
}

export function refineShotsByCopy(
  sections: readonly OrderedSection[],
  copy: ReadonlyMap<number, CopyValues>,
  undrawn: readonly string[],
  context: RefineContext
): ShotRefineResult {
  const entries: Entry[] = sections.flatMap((row, index) => {
    if (undrawn.some((entry) => entry.startsWith(`${index}:`))) return []
    const template = templateById(row.templateId) as unknown as TemplateMeta | undefined
    const slots = template ? imageSlots(template) : []
    return keyedShots(index, row).map((shot, at) => ({
      row: index,
      at,
      key: shot.key,
      plan: row.shots[at],
      def: slots.length === row.shots.length ? slots[at].def : undefined,
      ...shotTextOf(copy.get(index), shot),
    }))
  })
  const pairCount = (key: string) => entries.filter((entry) => shotKeyOf(entry.plan) === key).length
  // 글이 같은 짝을 더 되풀이하게 만들지 않는다 — 초안의 최다 반복을 넘지 않는다
  const pairLimit = Math.max(0, ...entries.map((entry) => pairCount(shotKeyOf(entry.plan))))

  const minimums: ReadonlyArray<{ wanted: number; test: (plan: ShotPlan) => boolean }> = [
    { wanted: SHOT_MINIMUM.handOrWorn, test: (plan) => HAND_OR_WORN.has(plan.composition) },
    { wanted: SHOT_MINIMUM.closeup, test: (plan) => plan.composition === 'closeup' },
    { wanted: context.multiple ? SHOT_MINIMUM.group : 0, test: (plan) => plan.composition === 'group' },
    { wanted: context.hasSize ? SHOT_MINIMUM.scale : 0, test: isTouchScale },
  ]
  /** 바꿔도 페이지 규칙이 그대로인가 — 같은 목적 연속, 같은 짝 반복, 최소 장 수 */
  const fits = (index: number, next: ShotPlan): boolean => {
    const entry = entries[index]
    if (shotKeyOf(next) !== shotKeyOf(entry.plan) && pairCount(shotKeyOf(next)) + 1 > pairLimit) return false
    const purposeAt = (i: number) => (i === index ? next.purpose : entries[i]?.plan.purpose)
    let from = index
    while (purposeAt(from - 1) === next.purpose) from--
    let to = index
    while (purposeAt(to + 1) === next.purpose) to++
    if (to - from + 1 > SAME_PURPOSE_MAX_RUN) return false
    return minimums.every(({ wanted, test }) => {
      const now = entries.filter((one) => test(one.plan)).length
      const after = now - (test(entry.plan) ? 1 : 0) + (test(next) ? 1 : 0)
      return after >= Math.min(now, wanted)
    })
  }
  /** 목적을 받을 구도 — 지금 구도가 어울리면 그대로. 크기는 손·몸에 닿아야 하고(오너 승인 11-01) 밑면 컷은 손이 나오지 않아 맞는 구도가 없으면 null */
  const compositionFor = (word: string, plan: ShotPlan, def: MetaImageSlot): string | null => {
    const fitting = PURPOSE_COMPOSITIONS[word] ?? []
    if (fitting.includes(plan.composition)) return plan.composition
    const found = fitting.find((value) => allowedCompositions(def, context).includes(value))
    if (found) return found
    if (word === 'scale') return null
    return word === 'underside' && HANDS_ON.has(plan.composition) ? null : plan.composition
  }

  /** 목적을 두고 구도만 옮길 값 — 이미 어울리면 옮기지 않는다 */
  const movedComposition = (word: string, plan: ShotPlan, def: MetaImageSlot): string | null => {
    const fitting = PURPOSE_COMPOSITIONS[word] ?? []
    if (fitting.includes(plan.composition)) return null
    const open = allowedCompositions(def, context)
    return fitting.find((value) => open.includes(value) && !ANGLE_ONLY.has(value) && !CLASHES[plan.purpose]?.includes(value)) ?? null
  }

  const record: ShotRefineRecord = { total: 0, worded: 0, matchedBefore: 0, matchedAfter: 0, purposeChanged: 0, compositionOnly: 0, blocked: { fixed: 0, said: 0, composition: 0, slot: 0, rule: 0 } }
  /** 섹션 글을 같이 쓰는 컷은 같은 말을 한 번만 그린다(칸마다 사진 한 장 한 말) */
  const spoken = new Map<number, Set<string>>()
  entries.forEach((entry, index) => {
    if (entry.key === HERO_SHOT_KEY) return
    record.total += 1
    const words = wordPurposesOf(entry.text, context)
    if (words.length === 0) return
    record.worded += 1
    const said = spoken.get(entry.row) ?? new Set<string>()
    spoken.set(entry.row, said)
    if (words.includes(entry.plan.purpose)) {
      record.matchedBefore += 1
      record.matchedAfter += 1
      if (!entry.own) said.add(entry.plan.purpose)
      return
    }
    if (!entry.def || !OPEN_PURPOSES.has(entry.plan.purpose)) {
      record.blocked.fixed += 1
      return
    }
    const open = entry.own ? words : words.filter((word) => !said.has(word))
    if (open.length === 0) {
      record.blocked.said += 1
      return
    }
    const purposes = acceptedByCopy(allowedPurposes(entry.def, context))
    const accepted = open.filter((value) => purposes.includes(value))
    for (const word of accepted) {
      const composition = compositionFor(word, entry.plan, entry.def)
      const next = composition ? { ...entry.plan, purpose: word, composition } : null
      if (next && fits(index, next)) {
        entry.plan = next
        record.purposeChanged += 1
        record.matchedAfter += 1
        if (!entry.own) said.add(word)
        return
      }
    }
    // 슬롯이 받는 목적 밖이면 구도만 옮긴다 — 내용은 글 줄이 전한다
    for (const word of open) {
      const composition = movedComposition(word, entry.plan, entry.def)
      if (!composition) continue
      const next = { ...entry.plan, composition }
      if (fits(index, next)) {
        entry.plan = next
        record.compositionOnly += 1
        return
      }
    }
    if (accepted.length > 0) record.blocked.rule += 1
    else if (open.some((word) => PURPOSE_COMPOSITIONS[word]?.includes(entry.plan.composition))) record.blocked.composition += 1
    else record.blocked.slot += 1
  })

  const changed = new Map(entries.map((entry) => [`${entry.row}:${entry.at}`, entry.plan]))
  return {
    sections: sections.map((row, index) => ({
      ...row,
      shots: row.shots.map((shot, at) => changed.get(`${index}:${at}`) ?? shot),
    })),
    record,
  }
}
