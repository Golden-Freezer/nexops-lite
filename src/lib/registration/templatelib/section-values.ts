/**
 * K 라인 섹션 값 합치기(M5, 15_TEMPLATE_LINE §10) — 순서 풀이 결과에서 카피 콜 입력을 만들고, 모델이 쓴 글·코드가 채운 입력값·컷 키를 renderTemplate에 넘길 값 하나로 합친다. 순수.
 * 컷이 없어도 다른 사진으로 대체하지 않는다. 필수 사진이 비면 엔진이 그 템플릿을 그리지 않는다(compare.tile-duel의 '기존 제품' 칸에 우리 상품 사진이 들어가면 틀린 비교가 된다).
 */

import type { SlotCopySection } from '@/lib/agents/registration/prompts/pdp-template-copy-prompts'
import { demoCopyNote } from './demo-shot'
import { hookBeatsCopyNote } from './hook-beats'
import { infoCellCopyNote } from './info-cells'
import { fillInputSlots, type LineInputs } from './input-values'
import { templateById } from './library'
import { POINT_SECTION, type OrderedSection, type ShotPlan } from './selection-order'
import { copySlotsOf, HOOK_SECTION, requiredCopyFilled, type CopyValues } from './slot-copy'
import type { SlotItem, SlotValues, TemplateRef } from './template-types'

export interface KeyedShot extends ShotPlan {
  /** 같은 칸의 몇 번째 컷인가 — 목록 칸의 항목 번호다 */
  item: number
  /** section_images의 직접 키 — resolveImage가 목록 접두어로 읽지 않게 콜론을 쓰지 않는다 */
  key: string
}

export const shotKey = (sectionIndex: number, slot: string, item: number) => `k${sectionIndex}_${slot.replace('.', '_')}_${item}`

/** 첫 화면 첫 컷의 키 — 대표 컷을 쓴다. 다른 컷의 스타일 참조와 첫 화면 실패 처리가 이 키에 걸려 있다 */
export const HERO_SHOT_KEY = 'hero'

/** 섹션의 컷 목록에 키를 붙인다 — 생성 단계와 값 합치기가 같은 키를 쓴다 */
export function keyedShots(sectionIndex: number, section: Pick<OrderedSection, 'shots'> & Partial<Pick<OrderedSection, 'section'>>): KeyedShot[] {
  const seen = new Map<string, number>()
  return section.shots.map((shot, at) => {
    const item = seen.get(shot.slot) ?? 0
    seen.set(shot.slot, item + 1)
    return { ...shot, item, key: section.section === HOOK_SECTION && at === 0 ? HERO_SHOT_KEY : shotKey(sectionIndex, shot.slot, item) }
  })
}

/**
 * 페이지에 남는 POINT인가 — 라이브러리에 있고 글 칸이 찼다. 글을 지워 필수 칸이 빈 POINT는 안 그려지므로 번호·진행 표시에서 뺀다(01 다음 03이 되지 않게, K14).
 * 이 섹션 글을 모르면(pageCopy에 없음) 남는다고 본다. 컷 실패로 빠지는 섹션은 계획 뒤 일이라 여기서 모른다
 */
function isDrawnPoint(row: Pick<OrderedSection, 'section' | 'templateId'>, values: CopyValues | undefined): boolean {
  if (row.section !== POINT_SECTION) return false
  const template = templateById(row.templateId)
  if (!template) return false
  return values === undefined || requiredCopyFilled(copySlotsOf(template), values)
}

/** 큰 POINT 순번 — 페이지에 남는 첫 POINT가 1이고, POINT가 아니거나 안 그려지는 섹션은 번호가 없다 */
export function pointChapterOf(sections: ReadonlyArray<Pick<OrderedSection, 'section' | 'templateId'>>, index: number, pageCopy?: ReadonlyMap<number, CopyValues>): number | undefined {
  if (!isDrawnPoint(sections[index], pageCopy?.get(index))) return undefined
  return sections.slice(0, index + 1).filter((row, at) => isDrawnPoint(row, pageCopy?.get(at))).length
}

/** 템플릿의 소구 이름 칸 — POINT 캡슐 줄 진행 표시(R-W7)가 적은 칸이다 */
const stepNameOf = (templateId: string): string | null => {
  const head = templateById(templateId)?.flow[0]
  return head?.kind === 'capsule' && head.steps ? head.steps.name : null
}

/**
 * 페이지 POINT마다 소구 이름(R-W7 탭 이름) — 그 POINT의 모델 글이고, 글이 없으면 null이다(지어내지 않는다. 엔진이 점 줄로 그린다).
 * POINT가 아닌 섹션은 빈 목록. 이 섹션 글은 copy, 다른 POINT 글은 pageCopy에서 읽는다
 */
function pointStepsOf(sections: readonly OrderedSection[], index: number, copy: CopyValues, pageCopy?: ReadonlyMap<number, CopyValues>): Array<string | null> {
  if (sections[index].section !== POINT_SECTION) return []
  return sections.flatMap((row, at) => {
    if (!isDrawnPoint(row, pageCopy?.get(at))) return []
    const slot = stepNameOf(row.templateId)
    const value = slot ? (at === index ? copy : pageCopy?.get(at))?.[slot] : null
    return [typeof value === 'string' && value.trim() ? value.trim() : null]
  })
}

/**
 * 카피 콜 입력 — 카피 칸이 없는 섹션(사진만·입력값만)은 넘기지 않는다. 라이브러리에 없는 템플릿도 쓸 칸이 없어 뺀다.
 * 정보 칸 템플릿(infocells 잡만 고른다)과 첫 화면 안 B 템플릿(hookbeats 잡만 고른다, J24), 시연 칸(demoshot 잡만 고른다, J57)은 칸 안내 한 줄을 붙인다 — 다른 섹션은 note가 없어 지금 그대로다
 */
export function slotCopySections(sections: readonly OrderedSection[]): SlotCopySection[] {
  return sections.flatMap((row, index) => {
    const template = templateById(row.templateId)
    const slots = template ? copySlotsOf(template) : []
    const note = template ? (infoCellCopyNote(template.id) ?? hookBeatsCopyNote(template) ?? demoCopyNote(template)) : null
    return slots.length > 0 ? [{ index, section: row.section, factSlots: row.factSlots ?? 0, slots, ...(note ? { note } : {}) }] : []
  })
}

/**
 * 한 섹션의 값 — 글·입력값 위에 컷 키를 얹는다. 목록 칸은 항목 번호로 맞춘다(필수 칸이 빠진 항목은 엔진이 그리지 않는다).
 * pageCopy는 페이지 전체 글이다 — POINT 진행 표시가 다른 POINT의 소구 이름을 읽는다. 없으면 이 섹션 이름만 안다(점 줄)
 */
export function sectionSlotValues(sections: readonly OrderedSection[], index: number, copy: CopyValues, inputs: LineInputs, pageCopy?: ReadonlyMap<number, CopyValues>): SlotValues {
  const row = sections[index]
  const template = templateById(row.templateId)
  if (!template) return {}
  const values: SlotValues = { ...copy, ...fillInputSlots(template, inputs, pointChapterOf(sections, index, pageCopy), pointStepsOf(sections, index, copy, pageCopy)) }
  for (const shot of keyedShots(index, row)) {
    const [name, field] = shot.slot.split('.')
    if (!field) {
      values[name] = shot.key
      continue
    }
    const current = values[name]
    const rows = (Array.isArray(current) ? [...current] : []) as SlotItem[]
    rows[shot.item] = { ...rows[shot.item], [field]: shot.key }
    values[name] = rows
  }
  return values
}

/** 섹션별 선택 기록 — 라이브러리에 없는 템플릿은 null이고, 호출자가 그 섹션을 기록하지 않는다. 강조 구절(T1-17)은 에이전트가 검사한 값이 있는 섹션만 싣는다 */
export function templateRefsOf(
  sections: readonly OrderedSection[],
  copy: ReadonlyMap<number, CopyValues>,
  inputs: LineInputs,
  accents: ReadonlyMap<number, string> = new Map()
): Array<TemplateRef | null> {
  return sections.map((row, index) => {
    const template = templateById(row.templateId)
    if (!template) return null
    const accent = accents.get(index)
    return { id: template.id, version: template.version, slots: sectionSlotValues(sections, index, copy.get(index) ?? {}, inputs, copy), ...(accent ? { accent } : {}) }
  })
}
