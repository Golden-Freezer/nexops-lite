// 상품 사실 블록·떠넘기는 문장 제거(W2b, PDP-W2W3 계약 v1 §3) — 순수 함수.
//
// - buildSpecFactsBlock: 소재·크기·무게·원산지·추가 스펙을 모든 카피 콜(Stage 1·2·3·pointCards 보충)과 편집기 재생성에 같은 블록으로
//   준다(지금은 Stage 2와 편집기 재생성에 스펙이 0이었다). 함께 R5 P07 심사 결함 두 가지를 막는 규칙을 둔다 — 정보가 없는 카드
//   ('선택 가이드'·'브랜드 정보')와 페이지에 없는 '상세 정보'로 떠넘기는 문구('소재·규격은 상세 정보 확인').
//   블록은 새 입력 필드(무게·원산지·추가 스펙)가 있는 잡과 설득 기록 잡(ENRICHMENT)에만 넣는다 — 그 밖의 잡은 프롬프트가 지금 그대로다
//   (Track S·ENRICHMENT off Track I 골든 불변).
// - stripDeflections: 같은 잡의 최종 카피에서 떠넘기는 문장만 결정적으로 뺀다(프롬프트를 어긴 경우). 리뷰 원문·옵션명·상품명은 보지 않는다.

import { withoutCommonMaterial } from './common-material'
import { claimSafeFactRows } from './eval/claim-lexicon'
import type { PdpSpecSheet } from './pdp-state'

const FACT_FIELDS = [
  ['material', '소재'],
  ['size', '크기'],
  ['weight', '무게'],
  ['origin', '원산지'],
] as const

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** 새 입력 필드(W2a — 무게·원산지·추가 스펙) 가운데 값이 있는 것이 하나라도 있나 */
export function hasNewSpecFacts(spec: PdpSpecSheet | undefined): boolean {
  if (!spec) return false
  return Boolean(
    text(spec.weight) || text(spec.origin) || (spec.extraSpecs ?? []).some((r) => text(r?.key) && text(r?.value))
  )
}

/** 사실 행 — 소재·크기·무게·원산지·추가 스펙 순, 값이 있는 것만 */
function specFactRows(spec: PdpSpecSheet): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = FACT_FIELDS.flatMap(([key, label]) =>
    text(spec[key]) ? [{ label, value: text(spec[key]) }] : []
  )
  for (const row of spec.extraSpecs ?? []) {
    if (text(row?.key) && text(row?.value)) rows.push({ label: text(row.key), value: text(row.value) })
  }
  return rows
}

/** 흔한 소재(common-material, J38)를 뺀 값이 사실 행과 달라지는가 — 규칙 줄을 그런 잡에만 넣는다 */
function hasCommonMaterialRow(spec: PdpSpecSheet): boolean {
  return specFactRows(spec).some((row) => withoutCommonMaterial(row.value) !== row.value)
}

/**
 * 사실 줄 — '- 소재: 스테인리스 304', 추가 스펙은 '- 용량: 350ml'. 규제 표현이 든 값은 넘기지 않는다
 * (이 블록은 '이 값만 쓴다'는 지시라, 넘기면 카피가 그 표현을 사실로 옮겨 쓴다).
 * ABS·PP·플라스틱 같은 흔한 소재는 장점이 아니라 그 조각을 빼고 넘긴다(남는 값이 없으면 행째) — 맨 아래 상품 정보 표에는 그대로 있다(J38 오너 11-10)
 */
export function specFactLines(spec: PdpSpecSheet | undefined): string[] {
  if (!spec) return []
  const rows = specFactRows(spec).flatMap((row) => {
    const value = withoutCommonMaterial(row.value)
    return value.trim() ? [{ label: row.label, value }] : []
  })
  return claimSafeFactRows(rows, spec.certificationInfo).map((r) => `- ${r.label}: ${r.value}`)
}

/** 흔한 소재가 있던 잡에만 붙는 규칙 줄(J38) */
export const COMMON_MATERIAL_RULE =
  "- ABS·PP·PE·플라스틱 같은 흔한 소재는 장점이 아니다 — 위 사실에서 뺐고 맨 아래 상품 정보 표에만 나온다. 제목·근거·카드·자주 묻는 질문·주의 문구 어디에도 쓰지 않는다."

/**
 * 카피 프롬프트 블록 — 새 입력 필드가 있거나 설득 기록 잡일 때만, 그 밖에는 빈 문자열(프롬프트 불변).
 * 사실이 하나도 없어도 기록 잡에는 규칙을 넣는다(R5 P07은 소재·규격이 비어 떠넘기는 문구가 나왔다)
 */
export function buildSpecFactsBlock(spec: PdpSpecSheet | undefined, opts: { recorded: boolean }): string {
  if (!opts.recorded && !hasNewSpecFacts(spec)) return ''
  const facts = specFactLines(spec)
  return [
    '## [상품 사실 — 소재·크기·무게·원산지·규격 숫자는 이 값만 쓴다]',
    ...(facts.length ? facts : ['- 등록된 소재·크기·무게·원산지 정보가 없다.']),
    '- 위에 없는 소재·크기·무게·원산지·규격은 지어내지 않고, 없다고 알리지도 않는다 — 그 내용 없이 확인된 특징으로 쓴다.',
    ...(spec && hasCommonMaterialRow(spec) ? [COMMON_MATERIAL_RULE] : []),
    "- '상세 정보에서 확인'·'상세페이지 참조'·'제품 정보를 살펴보세요'처럼 표나 다른 섹션으로 확인을 미루는 문장을 쓰지 않는다. 아래에 스펙 표가 있어도 카피에서 가리키지 않고, 쓸 내용은 그 자리에서 쓴다.",
    "- 카드·포인트 수를 채우려고 '선택 가이드'·'브랜드 정보'·'구매 전 확인'처럼 새 정보가 없는 항목을 만들지 않는다. 쓸 사실이 모자라면 확인된 특징을 사용 장면·관리·놓는 자리처럼 다른 각도에서 쓴다.",
  ].join('\n')
}

// ── 떠넘기는 문장 제거 ──

/** 확인을 미룰 곳 — 상세 정보·상세페이지·상세 이미지·하단 표·제품 정보·제품 사양·상품 상세·아래 표 */
const DEFLECT_PLACE =
  '(?:상세\\s*(?:정보|페이지|설명|스펙|사양|이미지)|하단\\s*(?:정보|표|안내|상세)|제품\\s*(?:정보|사양)|상품\\s*(?:정보|상세)|아래\\s*표)'
/** 미루는 말 — '확인된·확인되는·확인한·살펴본'(사실을 말하는 꼴)은 넘긴다 */
const DEFLECT_VERB = '(?:(?:확인|참고|참조)(?![된되한됐])|살펴(?!본))'

/** 다른 곳으로 확인을 미루는 말 — 한 문장 안에서만 본다(카드 글의 줄바꿈은 넘는다) */
export const DEFLECTION_RE = new RegExp(`${DEFLECT_PLACE}[^.!?]{0,24}?${DEFLECT_VERB}`)

/** 고치지 않는 칸 — 리뷰 원문(재작성 불가)·등록 옵션명·상품명(최상위 title) */
function skipped(key: string, path: string): boolean {
  return key === 'reviewHighlights' || key === 'options' || path === 'title'
}

/** 비우면 섹션이 사라지는 칸(마무리 CTA 머리말 등) — 통째로 걸리면 비우지 않고 남겨 기록한다 */
const KEEP_NONEMPTY = new Set(['headline', 'title', 'benefitHeadline'])

/**
 * 문장 하나에서 걸린 절(쉼표·띄어 쓴 ' · '·— 경계)만 뺀다. 붙여 쓴 가운뎃점('소재·규격')은 낱말 나열이라 경계가 아니다.
 * 절 경계를 넘어 걸리면 문장을 통째로 뺀다
 */
function dropDeflectingClauses(sentence: string): string {
  const parts = sentence.split(/(\s*,\s*|\s+·\s+|\s*—\s*)/)
  let out = ''
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i]
    if (!clause.trim() || DEFLECTION_RE.test(clause)) continue
    out += out ? `${parts[i - 1] ?? ' '}${clause}` : clause
  }
  return DEFLECTION_RE.test(out) ? '' : out
}

/**
 * 글 하나에서 떠넘기는 말을 뺀다. 한 줄 안에서 걸리면 그 절(없으면 문장)만 — 앞 절·연령 고지 같은 다른 절은 남는다.
 * 줄바꿈을 넘어 걸리면('제품 정보를\n구매 전에 살펴보세요') 그 두 줄을 뺀다. 원래 빈 줄(문단 구분)은 남긴다. 바뀌지 않으면 같은 글
 */
export function stripDeflectionText(value: string): string {
  if (!DEFLECTION_RE.test(value)) return value
  const lines = value.split('\n')
  const emptied = new Set<number>()
  lines.forEach((line, i) => {
    if (!DEFLECTION_RE.test(line)) return
    lines[i] = line
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => (DEFLECTION_RE.test(sentence) ? dropDeflectingClauses(sentence) : sentence))
      .filter((sentence) => sentence.trim().length > 0)
      .join(' ')
    if (!lines[i].trim()) emptied.add(i)
  })
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].trim() && lines[i + 1].trim() && DEFLECTION_RE.test(`${lines[i]}\n${lines[i + 1]}`)) {
      emptied.add(i)
      emptied.add(i + 1)
    }
  }
  return lines.filter((_, i) => !emptied.has(i)).join('\n')
}

export interface DeflectionRemoval {
  path: string
  before: string
  after: string
}

/** 제거로 글 칸이 빈 배열 항목인가(경쟁사 재현 가드 emptiedByStrip과 같은 기준) */
function emptiedByStrip(item: unknown, next: unknown): boolean {
  if (typeof item === 'string') return item.trim() !== '' && next === ''
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const after = next as Record<string, unknown>
  return Object.entries(item).some(([k, v]) => typeof v === 'string' && v.trim() !== '' && after[k] === '')
}

/**
 * 최종 카피(JSON)에서 떠넘기는 말을 뺀 사본. removed는 바뀐 칸, dropped는 글 칸이 비어 뺀 배열 항목(정보 없는 카드 등),
 * kept는 통째로 걸렸지만 비우면 섹션이 사라져 남긴 칸이다. 입력은 바꾸지 않는다
 */
export function stripDeflections<T>(copy: T): {
  copy: T
  removed: DeflectionRemoval[]
  dropped: string[]
  kept: string[]
} {
  const removed: DeflectionRemoval[] = []
  const dropped: string[] = []
  const kept: string[] = []
  const walk = (value: unknown, key: string, path: string): unknown => {
    if (skipped(key, path)) return value
    if (typeof value === 'string') {
      const after = stripDeflectionText(value)
      if (after === value) return value
      if (!after.trim() && KEEP_NONEMPTY.has(key)) {
        kept.push(path)
        return value
      }
      removed.push({ path, before: value, after })
      return after
    }
    if (Array.isArray(value)) {
      const out: unknown[] = []
      value.forEach((item, i) => {
        const next = walk(item, key, `${path}[${i}]`)
        if (emptiedByStrip(item, next)) dropped.push(`${path}[${i}]`)
        else out.push(next)
      })
      return out
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k, path ? `${path}.${k}` : k)])
      )
    }
    return value
  }
  return { copy: walk(copy, '', '') as T, removed, dropped, kept }
}
