/**
 * K 컷 배정(분석 2차 A4 #1·#5) — 슬롯이 받는 목적·구도 안에서 한 쌍씩 고른다. 예전에는 목적과 구도를 따로 돌려 같은 짝이 다시 나오고,
 * 착용 상품이 아닌데 착용 구도가 나오고(13컷 중 11컷), 구성이 하나인데 여러 개 구도가 나오고, 크기 입력이 있어도 크기 컷이 없는 상품이 있었다.
 * 조합 키는 지금 목적·구도 두 축이다. 무대·거리·사람·상태는 컷 계획에 칸이 없어 K 연결(A4 #6·#7) 때 더한다. 순수·결정론.
 */

import type { HeroKind } from '../pdp-state'
import type { MetaImageSlot } from './template-meta'
import { INPUT_NAMED_PURPOSES } from './template-types'

/** 사진 슬롯 하나의 배정 — 컷 계획이 이 목적·구도로 사진을 만든다. 목록 슬롯은 'shots.photo'처럼 적고 항목마다 한 줄이다 */
export interface ShotPlan {
  slot: string
  purpose: string
  composition: string
}

export interface ShotContext {
  /** 첫 컷 유형(heroKindOf) — 착용 구도도 이 값이 worn일 때만 연다 */
  heroKind: HeroKind
  /** 여러 개를 함께 보여 줄 수 있는가 — 구성이 둘 이상이거나 옵션이 둘 이상이다 */
  multiple: boolean
  /** 크기 입력이 있는가 — 있으면 크기 컷을 한 장 이상 둔다. 없으면 지어내지 않는다 */
  hasSize: boolean
  /** 입력에 재료 이름이 있는가(namedIngredientsOf) — 있을 때만 재료 목적을 고른다(오너 11-01 22:52) */
  namedIngredient?: boolean
  /** 원천 사진에 포장 역할 사진이 있는가(photoroles 켠 잡만, J58) — 있으면 포장 컷 한 장을 보장한다(forcePackage). 없으면 지금 그대로다 */
  packagePhoto?: boolean
}

export type ShotSlot = { slot: string; def: MetaImageSlot }

/**
 * 첫 컷 구도 — 첫 화면 유형이 정한다. 슬롯이 받는 값 가운데 앞에 있는 것을 쓰고, 슬롯이 하나도 받지 않아도 맨 앞 값을 쓴다(오너 지적: 상품에 맞는 히어로 유형).
 * 사진 칸 모양은 구도와 상관없이 같아 엔진에 문제가 없다. 다른 컷은 슬롯 값을 넘지 않는다.
 */
const FIRST_COMPOSITION: Readonly<Record<HeroKind, readonly string[]>> = {
  worn: ['worn'],
  in_use: ['in_use', 'in_hand'],
  studio: ['front', 'angle45', 'side', 'top', 'flatlay', 'closeup'],
}
/** 첫 컷 목적 — 슬롯이 받는 값 가운데 앞에 있는 것을 쓴다 */
const FIRST_PURPOSE: Readonly<Record<HeroKind, readonly string[]>> = {
  worn: ['scene', 'action', 'hero'],
  in_use: ['scene', 'action', 'hero'],
  studio: ['hero', 'color', 'group'],
}
/** 페이지 최소 장 수(A4 3절, 뺄 수 없는 것) — 슬롯이 받지 않으면 못 채운다 */
export const SHOT_MINIMUM = { handOrWorn: 2, closeup: 3, group: 1, scale: 1 }
export const HAND_OR_WORN: ReadonlySet<string> = new Set(['in_hand', 'worn'])
/** 같은 목적이 이어져도 되는 수 */
export const SAME_PURPOSE_MAX_RUN = 2
/**
 * 크기 감을 주는 구도(오너 승인 11-01) — 손이나 몸에 닿아야 한다. 치수 섹션 사진은 치수 컷이라 크기 감 컷으로 세지 않는다.
 * 크기 목적만 받는 슬롯(spec_table.dimension)은 그대로 치수 컷으로 쓰고, 다른 슬롯은 이 구도일 때만 크기 목적을 받는다
 */
export const TOUCH_COMPOSITIONS: readonly string[] = ['in_hand', 'in_use', 'worn']
export const isTouchScale = (shot: Pick<ShotPlan, 'purpose' | 'composition'>) => shot.purpose === 'scale' && TOUCH_COMPOSITIONS.includes(shot.composition)
/** 크기 컷으로 바꾸지 않는 목적 — 고민 장면에는 상품이 없고, 비교 칸은 상대 물건이다 */
const NOT_SCALE: ReadonlySet<string> = new Set(['problem', 'compare'])

export const shotKeyOf = (shot: Pick<ShotPlan, 'purpose' | 'composition'>) => `${shot.purpose}|${shot.composition}`

export function allowedCompositions(def: MetaImageSlot, context: ShotContext | undefined): string[] {
  if (!context) return def.composition
  const open = def.composition.filter((c) => (c !== 'worn' || context.heroKind === 'worn') && (c !== 'group' || context.multiple))
  if (open.length > 0) return open
  // 슬롯이 막힌 구도만 받으면 가까운 구도로 내린다
  return def.composition.includes('worn') ? ['in_use'] : ['front']
}

export function allowedPurposes(def: MetaImageSlot, context: ShotContext | undefined): string[] {
  const named = context?.namedIngredient ? def.purpose : def.purpose.filter((p) => !INPUT_NAMED_PURPOSES.includes(p))
  const open = !context || context.multiple ? named : named.filter((p) => p !== 'group' && p !== 'quantity')
  return open.length > 0 ? open : ['hero']
}

const firstOf = (preferred: readonly string[], allowed: readonly string[]) => preferred.find((value) => allowed.includes(value)) ?? allowed[0]

/**
 * 첫 사진 칸이 첫 화면 유형과 맞는가(적용 K6 R-K15, 통합 11-03 12:55 (나)) — 칸 맨 앞 값이 붙인·담은 상태(목적 state)나 입은 모습(구도 worn)인 '붙인 컷' 칸은
 * 첫 화면 유형의 첫 구도(FIRST_COMPOSITION)에 그 칸이 받는 닿는 구도(TOUCH_COMPOSITIONS)가 있을 때만 맞다. 없으면 칸은 붙인 컷인데 놓인 컷이 나온다(K1 ④ P11 스티커 hero|front).
 * 붙인 컷 칸이 아니거나 사진 칸이 없으면 맞다
 */
export function firstSlotFits(def: MetaImageSlot | undefined, context: Pick<ShotContext, 'heroKind'>): boolean {
  if (!def || (def.purpose[0] !== 'state' && def.composition[0] !== 'worn')) return true
  return FIRST_COMPOSITION[context.heroKind].some((composition) => TOUCH_COMPOSITIONS.includes(composition) && def.composition.includes(composition))
}

/** 페이지 컷 배정 — rows는 섹션별 사진 슬롯이다(sections는 같은 순서의 섹션 id, 포장 컷 자리 고르기에만 쓴다). 첫 섹션 첫 슬롯은 첫 컷 유형을 따른다 */
export function assignShotRows(rows: ReadonlyArray<readonly ShotSlot[]>, context?: ShotContext, sections: readonly string[] = []): ShotPlan[][] {
  const placed: ShotPlan[] = []
  const countOf = (test: (shot: ShotPlan) => boolean) => placed.filter(test).length
  /** 아직 못 채운 최소 장 수에 드는 쌍인가 — 바로 앞과 구도가 같으면 뒤로 미룬다 */
  const fillsMinimum = (purpose: string, composition: string) => {
    if (!context) return 0
    const prev = placed.at(-1)
    const fresh = prev?.composition !== composition
    const hand = fresh && HAND_OR_WORN.has(composition) && countOf((s) => HAND_OR_WORN.has(s.composition)) < SHOT_MINIMUM.handOrWorn
    const close = fresh && composition === 'closeup' && countOf((s) => s.composition === 'closeup') < SHOT_MINIMUM.closeup
    const group = fresh && composition === 'group' && context.multiple && countOf((s) => s.composition === 'group') < SHOT_MINIMUM.group
    const scale = isTouchScale({ purpose, composition }) && context.hasSize && countOf(isTouchScale) < SHOT_MINIMUM.scale
    return (hand || close || group ? 1 : 0) + (scale ? 1 : 0)
  }
  const pick = (slot: string, def: MetaImageSlot, isFirst: boolean): ShotPlan => {
    const purposes = allowedPurposes(def, context)
    const compositions = allowedCompositions(def, context)
    if (isFirst && context) return { slot, purpose: firstOf(FIRST_PURPOSE[context.heroKind], purposes), composition: FIRST_COMPOSITION[context.heroKind].find((value) => def.composition.includes(value)) ?? FIRST_COMPOSITION[context.heroKind][0] }
    const tail = placed.slice(-SAME_PURPOSE_MAX_RUN)
    const prev = placed.at(-1)
    const rank = (purpose: string, composition: string) => [
      tail.length === SAME_PURPOSE_MAX_RUN && tail.every((s) => s.purpose === purpose) ? 1 : 0,
      -fillsMinimum(purpose, composition),
      countOf((s) => s.purpose === purpose && s.composition === composition),
      prev?.purpose === purpose && prev.composition === composition ? 1 : 0,
      prev?.composition === composition ? 1 : 0,
      countOf((s) => s.purpose === purpose) + countOf((s) => s.composition === composition),
    ]
    let best: { purpose: string; composition: string; rank: number[] } | null = null
    for (const purpose of purposes) {
      for (const composition of compositions) {
        if (context && purpose === 'scale' && purposes.length > 1 && !TOUCH_COMPOSITIONS.includes(composition)) continue
        const score = rank(purpose, composition)
        const diff = best ? score.findIndex((value, i) => value !== best!.rank[i]) : -1
        if (!best || (diff >= 0 && score[diff] < best.rank[diff])) best = { purpose, composition, rank: score }
      }
    }
    return { slot, purpose: best!.purpose, composition: best!.composition }
  }

  const out = rows.map((row, r) =>
    row.map(({ slot, def }, s) => {
      const shot = pick(slot, def, r === 0 && s === 0)
      placed.push(shot)
      return shot
    })
  )
  if (context?.hasSize && !placed.some(isTouchScale)) forceScale(rows, out, context)
  if (context) breakPurposeRuns(rows, out, context)
  if (context?.packagePhoto && !out.some((row) => row.some((shot) => shot.purpose === PACKAGE))) forcePackage(rows, out, sections)
  return out
}

const PACKAGE = 'package'
/** 포장 컷으로 바꿔도 되는 섹션(J58 (나)) — 구성·정보·마무리 자리라 포장을 보여 줘도 흐름이 맞다 */
const PACKAGE_SECTIONS: ReadonlySet<string> = new Set(['main_cut', 'spec_table', 'cta', 'convert_div'])
/** (나)에서 포장으로 바꿀 수 있는 목적 — 상품을 그대로 보여 주는 칸 */
const PACKAGE_STAND_IN: ReadonlySet<string> = new Set(['group', 'hero', 'feature_proof'])

/**
 * 포장 컷 한 장 보장(J58, 통합 decide 35·38) — photoroles 잡에서 포장 역할 사진이 있는데 배정에 포장 목적이 없으면 한 장을 포장으로 바꾼다.
 * (가) 포장 목적을 받는 칸이 먼저, (나) 없으면 구성·정보·마무리 섹션(PACKAGE_SECTIONS)에서 상품을 그대로 보여 주는 목적(PACKAGE_STAND_IN)을 받는 칸.
 * 둘 다 뒤쪽 칸부터 고른다. 첫 컷·크기 목적 칸(손·몸 크기 컷·치수 컷)·고민·비교 칸은 바꾸지 않고, (나)는 착용 구도 칸도 쓰지 않는다.
 * 목적만 바꾸고 구도는 그대로라 칸 모양·최소 장 수가 그대로다. 바꿀 칸이 없으면 그대로 둔다(지어내지 않는다 — 포장 컷 브리프는 참조 그대로다)
 */
function forcePackage(rows: ReadonlyArray<readonly ShotSlot[]>, out: ShotPlan[][], sections: readonly string[]): void {
  const cells = rows.flatMap((row, r) => row.map(({ def }, s) => ({ r, s, def })))
  const free = cells.filter(({ r, s }) => !(r === 0 && s === 0) && out[r][s].purpose !== 'scale' && !NOT_SCALE.has(out[r][s].purpose))
  const accepts = free.filter(({ def }) => def.purpose.includes(PACKAGE))
  const standIn = free.filter(
    ({ r, s, def }) => PACKAGE_SECTIONS.has(sections[r] ?? '') && out[r][s].composition !== 'worn' && def.purpose.some((p) => PACKAGE_STAND_IN.has(p))
  )
  const spot = accepts.at(-1) ?? standIn.at(-1)
  if (spot) out[spot.r][spot.s] = { ...out[spot.r][spot.s], purpose: PACKAGE }
}

/**
 * 같은 목적 3연속 끊기(적용 K6 ④ T1-51, 통합 11-03 14:2x) — 앞에서부터 고르면 뒤 칸이 한 목적만 받을 때 앞 칸이 이미 같은 목적을 써서 3연속이 남는다.
 * 3연속의 셋째 칸이 그 목적뿐이면 같은 섹션의 앞 이웃 칸(첫 컷·크기 컷 제외) 하나를 그 칸이 받는 다른 목적으로 바꾼다 — 페이지에 덜 쓴 목적 먼저.
 * 구도는 그대로라 구도로 세는 최소 장 수(손·몸·근접·여러 개)와 컷 수가 그대로다. 새 3연속이 생기면 바꾸지 않는다.
 * 세 칸 모두 한 목적인 연속(고민 칸이 이어지는 섹션 순서)과 다른 섹션에만 대안이 있는 연속은 그대로다
 */
function breakPurposeRuns(rows: ReadonlyArray<readonly ShotSlot[]>, out: ShotPlan[][], context: ShotContext): void {
  const cells = rows.flatMap((row, r) => row.map(({ def }, s) => ({ r, s, def })))
  const purposeAt = (i: number) => out[cells[i].r][cells[i].s].purpose
  const runAround = (i: number) =>
    [i - 2, i - 1, i].some((start) => start >= 0 && start + 2 < cells.length && purposeAt(start) === purposeAt(start + 1) && purposeAt(start + 1) === purposeAt(start + 2))
  for (let i = 2; i < cells.length; i++) {
    const purpose = purposeAt(i)
    if (purpose === 'scale' || purposeAt(i - 1) !== purpose || purposeAt(i - 2) !== purpose) continue
    // 크기 목적은 대안으로 세지 않는다 — 손·몸 구도가 없는 칸은 pick이 크기를 못 고르고, 이 함수도 크기로 바꾸지 않는다
    if (allowedPurposes(cells[i].def, context).some((value) => value !== purpose && value !== 'scale')) continue
    const used = (value: string) => cells.filter((_, at) => purposeAt(at) === value).length
    for (const at of [i - 1, i - 2]) {
      const { r, s, def } = cells[at]
      if (r !== cells[i].r || (r === 0 && s === 0)) continue
      const others = allowedPurposes(def, context).filter((value) => value !== purpose && value !== 'scale')
      const before = out[r][s]
      const swap = [...others]
        .sort((a, b) => used(a) - used(b))
        .find((value) => {
          out[r][s] = { ...before, purpose: value }
          const fine = !runAround(at)
          out[r][s] = before
          return fine
        })
      if (swap) {
        out[r][s] = { ...before, purpose: swap }
        break
      }
    }
  }
}

/**
 * 슬롯이 크기 목적을 받지 않아도 크기 입력이 있으면 한 장을 크기 컷으로 쓴다 — 지금 구도가 이미 손·몸에 닿는 슬롯을 먼저 고른다(근접·여러 개 최소 장 수를 깎지 않는다). 손에 들거나 쓰는 구도를 받는 슬롯이고, 앞 절반을 먼저 본다(A4 4절, 앞쪽 크기 감).
 * 첫 컷은 건드리지 않는다. 그런 슬롯이 없으면 못 만든 대로 둔다.
 */
function forceScale(rows: ReadonlyArray<readonly ShotSlot[]>, out: ShotPlan[][], context: ShotContext): void {
  const spots = rows.flatMap((row, r) =>
    row.flatMap(({ def }, s) => {
      const compositions = allowedCompositions(def, context)
      const touch = TOUCH_COMPOSITIONS.find((composition) => compositions.includes(composition))
      if (!touch || (r === 0 && s === 0) || NOT_SCALE.has(out[r][s].purpose)) return []
      const kept = TOUCH_COMPOSITIONS.includes(out[r][s].composition)
      return [{ r, s, kept, composition: kept ? out[r][s].composition : touch }]
    })
  )
  const front = ({ r }: { r: number }) => r < rows.length / 2
  const spot = spots.find((one) => one.kept && front(one)) ?? spots.find((one) => one.kept) ?? spots.find(front) ?? spots[0]
  if (spot) out[spot.r][spot.s] = { ...out[spot.r][spot.s], purpose: 'scale', composition: spot.composition }
}
