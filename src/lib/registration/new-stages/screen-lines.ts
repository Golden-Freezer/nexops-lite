/**
 * 화면 글 줄 뽑기(하네스 R10a) — 사실 감사·최종 검수가 받는 {id, text} 줄. 읽기만 하고 고치지 않는다.
 * - 카피 최종본(copy_sections.final): 화면에 그리는 칸만 허용 목록으로 읽는다. 팔레트·SEO 낱말·상품 종류 낱말(productType)·강조 구절·
 *   후기 원문(original, 대조용)·이미지 힌트·아이콘 이름은 화면 글이 아니라 뺀다.
 * - 디자인 컷 계획(section_plan.designcut, K 라인 칸 글): 섹션마다 templateRef.slots의 글. id는 C 시제품 screenLines와 같은
 *   `<섹션 번호>.<섹션 키>.<칸>`이고 목록 칸은 `[항목]`·`[항목].<필드>`를 붙인다. 칸에 얹힌 컷 키(hero·k<번호>_<칸>_<항목>)는 글이 아니라 뺀다.
 */

import type { CopywritingResult } from '../pdp-state'
import { templateById } from '../templatelib/library'
import { isInputValue } from '../templatelib/slots'
import type { SlotValues } from '../templatelib/template-types'

export interface ScreenLine {
  id: string
  text: string
}

/** 카피 최종본에서 화면에 그리는 칸 — null은 글(또는 글 목록) 그 자체, 배열은 객체(또는 객체 목록)의 글 필드 */
const COPY_SCREEN_FIELDS: ReadonlyArray<readonly [string, readonly string[] | null]> = [
  ['mainIntro', ['hook', 'benefitHeadline', 'subBenefit', 'title', 'subtitle', 'brandAndName']],
  ['problem', ['question', 'empathy', 'empathyLines', 'empathyDeepLines']],
  ['solution', ['declaration', 'summary']],
  ['pointCards', ['title', 'description']],
  ['summary', null],
  ['detailPoints', ['claim', 'proof', 'benefit']],
  ['howTo', ['step', 'description']],
  ['recommendedTargets', null],
  ['reviewHighlights', ['text']],
  ['compareItems', ['name', 'pros', 'cons']],
  ['compareSummary', null],
  ['objection_handlers', ['objection', 'answer']],
  ['closingCta', ['headline', 'subtext']],
]

/** 칸에 얹힌 컷 키 — section-values shotKey(`k${섹션}_${칸}_${항목}`)·HERO_SHOT_KEY('hero') 꼴 */
const SHOT_KEY_VALUE = /^(?:hero|k\d+_[A-Za-z0-9_]+_\d+)$/

function pushText(rows: ScreenLine[], id: string, value: unknown): void {
  if (typeof value === 'string') {
    if (value.trim() && !SHOT_KEY_VALUE.test(value.trim())) rows.push({ id, text: value })
    return
  }
  if (Array.isArray(value)) value.forEach((item, i) => typeof item === 'string' && pushText(rows, `${id}[${i}]`, item))
}

function pushFields(rows: ScreenLine[], id: string, value: unknown, fields: readonly string[] | null): void {
  if (fields === null || typeof value !== 'object' || value === null || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  for (const field of fields) pushText(rows, `${id}.${field}`, record[field])
}

/** 카피 최종본의 화면 글 — 칸 순서는 위 목록 순서(페이지 순서와 대체로 같다) */
export function copyScreenLines(final: CopywritingResult | null | undefined): ScreenLine[] {
  const rows: ScreenLine[] = []
  if (!final) return rows
  for (const [key, fields] of COPY_SCREEN_FIELDS) {
    const value = final[key]
    if (fields === null) pushText(rows, key, value)
    else if (Array.isArray(value)) value.forEach((item, i) => pushFields(rows, `${key}[${i}]`, item, fields))
    else pushFields(rows, key, value, fields)
  }
  return rows
}

/** designcutScreenLines가 읽는 칸만 — section_plan.designcut(DesigncutPlan)이 이 꼴이다 */
export interface DesigncutLike {
  sections?: ReadonlyArray<{ key: string; templateRef?: { id?: string; slots: SlotValues } }>
}

/** 칸을 줄에서 뺄지 — 템플릿 id·칸 이름(목록 항목이면 필드 이름도). 남는 줄의 id·순서는 빼지 않을 때와 같다 */
type SkipSlot = (templateId: string, slot: string, field?: string) => boolean

/** 디자인 컷 계획(K 라인)의 칸 글 — templateRef가 없는 섹션(옛 디자인 컷 템플릿)은 읽지 않는다. skip이 없으면 칸 글 전부(최종 검수) */
export function designcutScreenLines(plan: DesigncutLike | null | undefined, skip?: SkipSlot): ScreenLine[] {
  const rows: ScreenLine[] = []
  for (const [index, section] of (plan?.sections ?? []).entries()) {
    const slots = section.templateRef?.slots
    if (!slots) continue
    const templateId = section.templateRef?.id
    const skipped = (slot: string, field?: string) => Boolean(skip && templateId && skip(templateId, slot, field))
    for (const [slot, value] of Object.entries(slots)) {
      if (skipped(slot)) continue
      const id = `${index}.${section.key}.${slot}`
      if (!Array.isArray(value)) {
        pushText(rows, id, value)
        continue
      }
      value.forEach((item, i) => {
        if (typeof item === 'string') pushText(rows, `${id}[${i}]`, item)
        else if (item && typeof item === 'object') {
          for (const [field, text] of Object.entries(item)) if (!skipped(slot, field)) pushText(rows, `${id}[${i}].${field}`, text)
        }
      })
    }
  }
  return rows
}

/**
 * K 칸 사실 감사 줄(J47, decide 16) — 칸 글에서 입력 칸(source 'input' — 코드가 판매자 입력을 그대로 옮긴 값: 리뷰 별점 막대·후기 인용·스펙 표 등)을
 * 뺀다. 감사 입력(스펙 JSON)에는 리뷰 파일·후기 원문이 없어 이 칸이 '입력에 없음'으로 걸렸다(거짓 경고). 모델이 쓴 칸은 그대로 감사한다.
 * 입력 칸이 없는 계획은 designcutScreenLines와 같다(감사 프롬프트 바이트 그대로). 최종 검수 줄은 designcutScreenLines 그대로다
 */
export function slotFactAuditLines(plan: DesigncutLike | null | undefined): ScreenLine[] {
  return designcutScreenLines(plan, (templateId, slot, field) => {
    const template = templateById(templateId)
    return template ? isInputValue(template, slot, field) : false
  })
}

/** 줄 id 집합 — 모델이 돌려준 id가 보낸 줄에 있는지 검사할 때 쓴다 */
export function lineIdsOf(lines: readonly ScreenLine[]): Set<string> {
  return new Set(lines.map((line) => line.id))
}
