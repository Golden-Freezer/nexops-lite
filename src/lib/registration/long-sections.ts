/**
 * 긴 상세페이지 확장 섹션(PDP-DR-PLAN §7 ②, 오너 지시 2026-10-31) — 잡 스위치 long(기본 on, Track I, 디자인 컷 잡 제외)이 기록된
 * 잡만. 새 정보가 있을 때만 섹션을 더한다. L-1은 입력 값을 그대로 옮기는 세 가지다(새 카피·새 컷 없음):
 * - 크기·구성: 입력 사이즈·무게 + 추가 스펙(extraSpecs)의 구성·크기·무게·용량 행
 * - 관리·보관: 추가 스펙의 관리·보관·세탁·세척·손질·주의 행
 * - 구매 전 질문: 설득 기록의 고객 고민 유형에 맞는 고정 질문 + 입력 값을 그대로 옮긴 답. 답할 입력이 없는 고민은 질문도 없다
 *   (새 숫자·효과를 만들지 않는다 — P0-2 숫자·단위 대조와 같은 원칙)
 * 규제 표현(인증·인허가·의학·기능성 — 카피 검출과 같은 사전)이 든 입력 값은 싣지 않는다(인증 정보가 뒷받침하는 인증 표현만 허용).
 * 같은 값은 한 번만 — 페이지에 이미 보이는 값, 앞 표(크기·구성 → 관리·보관 → 질문 순서)와 같은 표의 앞 행에 실린 값은 뺀다.
 * 근거 판정은 설계 단계가 하고 section_plan.long에 남긴다(편집기는 분석·리서치를 받지 않는다). 편집기 변환은 같은 함수에 페이지의
 * 그려진 글을 넘겨 표를 짓는다(sectionConverter/longSections.ts). 순수·결정론.
 */

import type { ExpansionKind } from './editor/types/canvas'
import { missingRows } from './editor/utils/sectionConverter/purchaseCheck'
import { isFactClaimSafe } from './eval/claim-lexicon'
import { classifyObjection, type ObjectionType } from './internalized/objection-types'
import type { ReviewFaqItem, ReviewFaqStats } from './reviews/review-faq'

export const LONG_KINDS: readonly ExpansionKind[] = ['size', 'care', 'faq']

export const LONG_SECTION_TITLE: Record<ExpansionKind, string> = {
  size: '크기·구성',
  care: '관리·보관',
  faq: '구매 전 질문',
  scenes: '사용 장면',
}

/** 섹션을 둘 최소 행 수 — 한 줄짜리 표·질문 하나로 섹션을 만들지 않는다(관리·보관은 한 줄도 내용이 길다). 사용 장면은 컷 수 */
export const LONG_MIN_ROWS: Record<ExpansionKind, number> = { size: 2, care: 1, faq: 2, scenes: 2 }

/**
 * L-2 이미지 확장(새 컷은 잡당 5장 이내 — 통합 조건 3~5장):
 * - 디테일 근접: 골격에 sub_div가 있으면 피처 컷을 6장까지(특징 5·6번은 매크로 컷). sub_div(나누기 잡은 특징마다 섹션)가 그 특징의
 *   글을 이미 싣고 사진이 비어 있던 자리를 채운다 — 새 섹션이 아니라 같은 특징 글을 되풀이하지 않는다(중복 정리가 같은 번호 컷을 고른다)
 * - 사용 장면 모음: 카피의 사용 장면 태그 가운데 페이지에 아직 없는 것(골격에 태그 섹션 sub2_div_page가 없을 때)으로 생활 컷 2~3장 +
 *   확장 섹션 '사용 장면'
 */
export const LONG_DETAIL_FEATURE_CAP = 6
/** 매크로 컷이 시작하는 피처 번호(= 기본 피처 컷 상한 4, pdp-image-tasks FEATURE_CAP) */
export const LONG_MACRO_FROM = 4
export const LONG_SCENE_MAX = 3

/** 사용 장면 컷 키(이미지 태스크·편집기 생성 이미지 맵 — 목록 키가 아니라 칸마다 하나라 빈 칸을 당겨 붙이지 않는다) */
export const longSceneKey = (i: number) => `long_scene:${i}`

/**
 * 사용 장면 태그 — 골격에 사용 장면 태그 섹션(sub2_div_page)이 있으면 그 섹션이 이미 보이므로 없다. '#'을 뗀 낱말, 같은 것은 한 번,
 * 앞 3개. 2개 미만이면 없다(사진 한 장짜리 모음은 만들지 않는다)
 */
export function longSceneTags(usageSceneTags: unknown, sectionOrder: readonly string[]): string[] {
  if (sectionOrder.includes('sub2_div_page') || !Array.isArray(usageSceneTags)) return []
  const tags = [...new Set(usageSceneTags.map((t) => text(t).replace(/^#+/, '').trim()).filter(Boolean))]
    .filter((t) => !COPY_DEFAULT_SCENE_TAGS.has(t))
    .slice(0, LONG_SCENE_MAX)
  return tags.length >= LONG_MIN_ROWS.scenes ? tags : []
}

/**
 * 카피 기본값의 사용 장면 태그(pdp-copy-defaults getDefaultCopyData — 카피가 비우면 채우는 값). 상품 근거가 아니라 장면 컷·캡션을
 * 만들지 않는다(근거 입력이 없으면 만들지 않는다). 시험이 기본값과 같은지 묶는다
 */
export const COPY_DEFAULT_SCENE_TAGS: ReadonlySet<string> = new Set(['일상', '실용적', '필수품'])

/** 긴 상세페이지 이미지 확장(L-2)을 만드는 잡인가 — 설계 기록(section_plan.long.images) */
export const longImagesRecorded = (sectionPlan: { long?: unknown } | null | undefined) =>
  readLongRecord(sectionPlan?.long)?.images === true

export interface LongRow {
  label: string
  value: string
  /** 페이지에 이미 보이는지 낱낱으로 보는 값(질문 답은 여러 입력 값을 잇는다) */
  items?: string[]
}

/** 설계 단계 기록 — 근거가 있는 확장 섹션과 뺀 사유 */
export interface LongRecord {
  version: 1
  kinds: ExpansionKind[]
  excluded: Array<{ kind: ExpansionKind; reason: string }>
  /**
   * L-2 이미지 확장(디테일 근접·사용 장면 컷)을 만드는 잡 — L-2 뒤 설계한 잡만 참. L-1 기록만 있는 완료 잡이 새 컷 때문에 images
   * 단계로 되돌아가지 않게 한다(이미지 태스크·편집기가 이 칸을 본다)
   */
  images?: true
  /** 후기 속 실제 질문(reviewfaq 잡만, reviews/review-faq.ts) — 설계 단계 콜의 검사 통과분. 표의 앞줄이 된다 */
  reviewFaq?: ReviewFaqItem[]
  /** 그 콜의 결과 수 — 질문이 왜 없는지 회차에서 읽는다 */
  reviewFaqStats?: ReviewFaqStats
}

/** 확장 섹션 입력 — 설계 단계(PdpSpecSheet)와 편집기(Record) 모두 같은 칸을 읽는다 */
type SpecInput = Record<string, unknown> | object | undefined
type Objections = ReadonlyArray<{ objection: string; type?: string }>

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
const field = (spec: SpecInput, key: string) => text((spec as Record<string, unknown> | undefined)?.[key])

const CARE_LABEL = /관리|보관|세탁|세척|손질|주의/
const SIZE_LABEL = /구성|포함|세트|수량|입수|사이즈|크기|치수|규격|무게|중량|용량/
const COMPOSITION_LABEL = /구성|포함|세트|수량|입수|용량/

/** 규제 표현이 없거나, 인증 표현이 인증 정보로 뒷받침되는 글만 싣는다 */
export function claimSafe(value: string, spec: SpecInput): boolean {
  return isFactClaimSafe(value, field(spec, 'certificationInfo'))
}

function extraRows(spec: SpecInput, pattern: RegExp): LongRow[] {
  const rows = (spec as { extraSpecs?: unknown } | undefined)?.extraSpecs
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => ({ label: text((r as { key?: unknown })?.key), value: text((r as { value?: unknown })?.value) }))
    .filter((r) => r.label && r.value && pattern.test(r.label))
}

/** 크기·구성 후보 행 — 입력 사이즈·무게, 추가 스펙의 구성·크기 행(관리 행은 관리·보관 몫) */
export function sizeRows(spec: SpecInput): LongRow[] {
  return [
    ...(field(spec, 'size') ? [{ label: '사이즈', value: field(spec, 'size') }] : []),
    ...(field(spec, 'weight') ? [{ label: '무게', value: field(spec, 'weight') }] : []),
    ...extraRows(spec, SIZE_LABEL).filter((r) => !CARE_LABEL.test(r.label)),
  ]
}

/** 관리·보관 후보 행 — 추가 스펙의 관리·보관 행 */
export function careRows(spec: SpecInput): LongRow[] {
  return extraRows(spec, CARE_LABEL)
}

/** 고민 유형 → 고정 질문. 표에 없는 유형(내구성·가격·기타)은 입력 사실로 답할 수 없어 묻지 않는다 */
export const FAQ_QUESTION: Partial<Record<ObjectionType, string>> = {
  quantity_size: '크기와 구성은 어떻게 되나요?',
  material_eco: '소재는 무엇인가요?',
  usage_care: '관리·보관은 어떻게 하나요?',
  safety_cert: '인증 정보가 있나요?',
  environment_versatility: '어디에서 쓰기 좋나요?',
}

export const FAQ_QUESTION_PREFIX = 'Q. '
export const FAQ_ANSWER_PREFIX = 'A. '

/**
 * 접두를 뗀 질문·답 글 — 디자인 컷 질문 표(T9 long:faq)는 글 접두 대신 강조색 Q 표식을 그린다(적용 T1-66 D). 행 글에는 접두가 그대로다
 * (긴 페이지 쌓은 표가 접두로 질문·답을 가르고, 저장된 계획 행에도 붙어 있다)
 */
export const withoutFaqPrefix = (text: string, prefix: string): string => (text.startsWith(prefix) ? text.slice(prefix.length) : text)

/** 답 한 조각 — check는 이미 보이는지 보는 값(입력 값 그대로), show는 답에 쓰는 글(추가 스펙 행은 '이름: 값') */
interface AnswerPart {
  check: string
  show: string
}

const labeled = (row: LongRow): AnswerPart => ({ check: row.value, show: `${row.label}: ${row.value}` })

/** 고민 유형의 답 — 입력 값 그대로. 인증 정보는 인증 섹션처럼 '/ · ; 줄바꿈'으로 나눠 낱낱으로 본다 */
function answerParts(type: ObjectionType, spec: SpecInput): AnswerPart[] {
  const plain = (v: string): AnswerPart[] => (v ? [{ check: v, show: v }] : [])
  if (type === 'quantity_size') return [...plain(field(spec, 'size')), ...extraRows(spec, COMPOSITION_LABEL).map(labeled)]
  if (type === 'material_eco') return plain(field(spec, 'material'))
  if (type === 'usage_care') return careRows(spec).map(labeled)
  if (type === 'environment_versatility') return plain(field(spec, 'usageLocation'))
  if (type === 'safety_cert') {
    return field(spec, 'certificationInfo')
      .split(/\s*(?:[/·;]|\n)\s*/)
      .map((v) => v.trim())
      .filter(Boolean)
      .flatMap(plain)
  }
  return []
}

/** 구매 전 질문 후보 — 고민 순서대로, 같은 유형은 한 번, 답할 입력이 있는 것만(답 조각은 show로 잇고 check를 items로) */
export function faqRows(spec: SpecInput, objections: Objections): Array<LongRow & { parts: AnswerPart[] }> {
  const seen = new Set<ObjectionType>()
  const rows: Array<LongRow & { parts: AnswerPart[] }> = []
  for (const o of objections) {
    const type = (o.type as ObjectionType | undefined) ?? classifyObjection(o.objection)
    if (seen.has(type)) continue
    seen.add(type)
    const question = FAQ_QUESTION[type]
    const parts = question ? answerParts(type, spec) : []
    const unique = parts.filter((p, i) => parts.findIndex((q) => q.check === p.check) === i)
    if (unique.length > 0) rows.push(faqRow(`${FAQ_QUESTION_PREFIX}${question}`, unique))
  }
  return rows
}

const faqRow = (label: string, parts: AnswerPart[]) => ({
  label,
  value: `${FAQ_ANSWER_PREFIX}${parts.map((p) => p.show).join(' · ')}`,
  items: parts.map((p) => p.check),
  parts,
})

/** 구매 전 질문 표 행 수 상한 — 후기 질문을 앞에 두면 고정 질문이 뒤로 밀려 잘린다 */
export const FAQ_MAX_ROWS = 5
/** 후기 답 표시 — 판매자 말이 아니라 구매자 말임을 밝힌다 */
export const REVIEW_ANSWER_SOURCE = '구매 고객 후기'

const reviewFaqRow = (item: ReviewFaqItem): LongRow => ({
  label: `${FAQ_QUESTION_PREFIX}${item.question}`,
  value: `${FAQ_ANSWER_PREFIX}"${item.answer}" — ${REVIEW_ANSWER_SOURCE}`,
  items: [item.answer],
})

/**
 * 확장 섹션 표 — 크기·구성 → 관리·보관 → 질문 순서로, 규제 표현이 든 값을 빼고, 이미 보이는 값(shownTexts·앞 표·같은 표의 앞 행)을
 * 뺀다. 질문은 답 조각 단위로 뺀다. minimum이 참이면 최소 행 수에 못 미친 표는 돌려주지 않는다. 후기 질문(reviewFaq)은 질문 표의 앞줄이다
 */
export function longTables(
  kinds: readonly ExpansionKind[],
  spec: SpecInput,
  objections: Objections,
  shownTexts: readonly string[] = [],
  minimum = true,
  reviewFaq: readonly ReviewFaqItem[] = []
): Array<{ kind: ExpansionKind; rows: LongRow[] }> {
  const shown = [...shownTexts]
  const unseen = (value: string) => missingRows([{ label: '', value, items: [value] }], shown).length > 0
  const tables: Array<{ kind: ExpansionKind; rows: LongRow[] }> = []
  for (const kind of LONG_KINDS) {
    if (!kinds.includes(kind)) continue
    const rows: LongRow[] = []
    if (kind === 'faq') {
      for (const item of reviewFaq) {
        if (!claimSafe(`${item.question} ${item.answer}`, spec) || !unseen(item.answer)) continue
        rows.push(reviewFaqRow(item))
        shown.push(item.answer)
      }
      for (const row of faqRows(spec, objections)) {
        if (rows.length >= FAQ_MAX_ROWS) break
        const parts = row.parts.filter((p) => claimSafe(p.show, spec) && unseen(p.check))
        if (parts.length === 0) continue
        const { parts: _parts, ...kept } = faqRow(row.label, parts)
        rows.push(kept)
        shown.push(...parts.map((p) => p.check))
      }
    } else {
      for (const row of kind === 'size' ? sizeRows(spec) : careRows(spec)) {
        if (!claimSafe(`${row.label} ${row.value}`, spec) || !unseen(row.value)) continue
        rows.push(row)
        shown.push(row.value)
      }
    }
    if (!minimum || rows.length >= LONG_MIN_ROWS[kind]) tables.push({ kind, rows })
  }
  return tables
}

/**
 * 설계 단계 근거 판정 — 입력만으로 지은 표(겹침·규제 표현 제외)가 최소 행 수 이상인 확장 섹션만 남기고 나머지는 사유와 함께 뺀다.
 * 확장 섹션은 골격 밖이라 기존 섹션을 밀어내지 않는다(측정 R6는 그려진 확장 섹션 수만큼 상한을 넓힌다 — page-measure)
 */
export function decideLongSections(
  spec: SpecInput,
  objections: Objections,
  reviewFaq: readonly ReviewFaqItem[] = [],
  reviewFaqStats?: ReviewFaqStats
): LongRecord {
  const kinds: ExpansionKind[] = []
  const excluded: LongRecord['excluded'] = []
  for (const { kind, rows } of longTables(LONG_KINDS, spec, objections, [], false, reviewFaq)) {
    if (rows.length >= LONG_MIN_ROWS[kind]) kinds.push(kind)
    else {
      const reason = rows.length === 0 ? '입력 근거 없음' : `근거 ${rows.length}개(최소 ${LONG_MIN_ROWS[kind]}개)`
      excluded.push({ kind, reason })
    }
  }
  return {
    version: 1,
    kinds,
    excluded,
    images: true,
    ...(reviewFaq.length > 0 ? { reviewFaq: [...reviewFaq] } : {}),
    ...(reviewFaqStats ? { reviewFaqStats } : {}),
  }
}

/** 기록의 후기 질문 읽기 — 형식이 맞는 항목만 */
function readReviewFaq(raw: unknown): ReviewFaqItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((v) => {
    const question = text((v as ReviewFaqItem | null)?.question)
    const answer = text((v as ReviewFaqItem | null)?.answer)
    return question && answer ? [{ question, answer }] : []
  })
}

/** section_plan.long 읽기 — 형식이 맞지 않으면 null(확장 섹션 없음), 모르는 종류는 버린다 */
export function readLongRecord(raw: unknown): LongRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<LongRecord>
  if (r.version !== 1 || !Array.isArray(r.kinds)) return null
  const reviewFaq = readReviewFaq(r.reviewFaq)
  return {
    version: 1,
    kinds: LONG_KINDS.filter((k) => r.kinds!.includes(k)),
    excluded: Array.isArray(r.excluded) ? r.excluded : [],
    ...(r.images === true ? { images: true as const } : {}),
    ...(reviewFaq.length > 0 ? { reviewFaq } : {}),
    ...(r.reviewFaqStats ? { reviewFaqStats: r.reviewFaqStats } : {}),
  }
}
