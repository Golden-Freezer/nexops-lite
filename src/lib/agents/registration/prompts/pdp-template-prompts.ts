/**
 * K 라인 선택 AI 단계 프롬프트(M5, PDP-KLINE-PLAN §5) — 가이드라인·섹션 구성·템플릿 선택. 모델은 레이아웃을 새로 그리지 않고 목록 안에서 고르기만 한다.
 * 목록 밖 값은 파서가 버린다. 프롬프트 지시만 믿지 않는다.
 */

import type { Concept } from '@/lib/registration/templatelib/concepts'
import type { TemplateMeta } from '@/lib/registration/templatelib/template-meta'
import { parseRegistrationJson } from '../llm-json'
import { composePlanBlock } from './pdp-template-copy-story'

export const GUIDELINE_SYSTEM =
  'You choose a visual concept for a Korean e-commerce detail page. Choose only from the listed concept ids. Respond only with the requested JSON.'
export const COMPOSE_SYSTEM =
  'You choose which sections a Korean e-commerce detail page should have. Choose only from the listed section ids. Respond only with the requested JSON.'
export const SELECT_SYSTEM =
  'You choose one layout template per section of a Korean e-commerce detail page. Choose only from the listed template ids of that slot. Respond only with the requested JSON.'

/** 모델이 판단할 상품 정보 — 리뷰 원문은 넣지 않는다 */
export interface TemplateProductBrief {
  category: string
  persona: string | null
  summary: string
  keywords: string[]
  usps: string[]
  pains: string[]
}

export interface Guideline {
  persona: string
  tone: string
  concept: { id: string; reason: string }
  alternatives: string[]
}

const FIELD_MAX = 200
const text = (value: unknown, max = FIELD_MAX) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const list = (values: readonly string[]) => (values.length > 0 ? values.join(', ') : '(없음)')

function brief(product: TemplateProductBrief): string {
  return [
    `- 카테고리: ${product.category}`,
    `- 고객: ${product.persona ?? '(입력 없음 — 상품에서 추론)'}`,
    `- 요약: ${product.summary || '(없음)'}`,
    `- 낱말: ${list(product.keywords)}`,
    `- 장점 후보: ${list(product.usps)}`,
    `- 고민: ${list(product.pains)}`,
  ].join('\n')
}

function parseObject(raw: string, stage: string): Record<string, unknown> {
  if (!raw.trim()) throw new Error(`${stage} 응답이 비어 있습니다`)
  const parsed = parseRegistrationJson(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error(`${stage} 응답 JSON 파싱 실패 (len=${raw.length}, head=${raw.slice(0, 80)}, tail=${raw.slice(-80)})`)
  return parsed as Record<string, unknown>
}

// ─── H2 가이드라인 ───

export function buildGuidelinePrompt(product: TemplateProductBrief, concepts: readonly Concept[]): string {
  const rows = concepts.map((c) => `- ${c.id} | ${c.name} | 분위기 ${c.mood.join('·')} | 밀도 ${c.density} | 가격대 ${c.price} | 신뢰 ${c.trust} | 짙은 면 ${c.rhythm}`)
  return `상품에 맞는 페이지 컨셉을 고른다. 이 상품을 살 사람이 "나를 위한 물건"으로 느낄 분위기를 고르고, 목록 앞쪽이라는 이유로 고르지 않는다.

## 상품
${brief(product)}

## 컨셉 목록(이 id만 쓴다)
${rows.join('\n')}

## 답
JSON 하나만 쓴다. concept.id와 alternatives는 위 목록의 id이고, alternatives는 concept와 다른 2개다. persona는 이 페이지가 말을 거는 고객 한 줄, tone은 글의 말투 한 줄이다. tone은 제목 말투와 본문 말투를 나눠 적는다(예: 제목은 짧은 명사구로 담백하게, 본문은 차분한 존댓말로 / 제목은 쓰는 장면을 그리는 구로, 본문은 다정한 존댓말로 / 제목은 수치를 앞세운 구로, 본문은 근거를 짧게 말하는 존댓말로).
{"persona":"…","tone":"…","concept":{"id":"…","reason":"…"},"alternatives":["…","…"]}`
}

export function parseGuideline(raw: string, allowed: ReadonlySet<string>): Guideline {
  const parsed = parseObject(raw, '가이드라인')
  const concept = (parsed.concept ?? {}) as Record<string, unknown>
  const id = text(concept.id)
  if (!allowed.has(id)) throw new Error(`가이드라인 컨셉 id가 목록에 없습니다: ${id || '(비어 있음)'}`)
  const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.map((a) => text(a)) : []
  return {
    persona: text(parsed.persona),
    tone: text(parsed.tone),
    concept: { id, reason: text(concept.reason) },
    alternatives: [...new Set(alternatives.filter((a) => a !== id && allowed.has(a)))].slice(0, 2),
  }
}

// ─── H3 섹션 구성 ───

/** 섹션이 하는 일 — 구성 모델에 보여 준다 */
export const SECTION_PURPOSES: Readonly<Record<string, string>> = {
  hook_3step: '첫 화면. 쓰는 장면·약속·수치로 여는 큰 제목과 상품',
  main_cut: '상품을 처음 소개하는 대표 컷',
  problem_raise: '고객이 겪는 문제를 꺼내기',
  problem_empathy: '고민에 공감하기',
  solution_guide: '해결 방향을 요약하기',
  key_message: '핵심 메시지 한 문장',
  point_div: '큰 장점 하나를 크게(최대 3번)',
  sub_div: '작은 장점·세부 설명',
  point_list_div: '장점을 목록으로 모아 보기',
  compare: '쓰기 전과 쓴 뒤의 달라진 점',
  concept_desc: '상품의 생각·컨셉 설명',
  direction_suggest: '이런 분께·이럴 때 제안',
  sub2_div_page: '사용 장면을 사진으로 보여 주기',
  hidden_page: '놓치기 쉬운 세부 보여 주기',
  option_gallery: '옵션·색상 모아 보기',
  petit_div: '짧은 전환 문구·디테일 컷',
  product_exposure: '구도가 다른 상품 컷',
  review: '실제 후기',
  perf_metric: '평점 등 실제 수치',
  certification: '실제 인증',
  event_offer: '실제 혜택',
  faq: '구매 전 질문과 답',
  spec_table: '상품 정보 표',
  convert_div: '구매 망설임을 넘기는 한 번의 권유',
  how_to: '쓰는 모습을 사진과 짧은 글로 보여 주기. 입력에 없는 순서·수치는 쓰지 않는다',
  ingredients: '입력에 적힌 재료·성분 이름을 모아 보기. 이름은 코드가 넣고 효능·함량은 쓰지 않는다',
  motion_band:
    '움직이는 띠 하나 — 상품 사실·사용 장면에서 실제로 쓰는 동작·바뀌는 모습 한 가지를 짧은 한 줄로 이름 붙인다. 이 줄이 움직임 지시가 된다. 입력에 없는 동작·결과, 실물을 쓰는 방식과 다른 동작(반대로 쥐기 등)은 쓰지 않는다',
  notice: '입력에 적힌 주의·보관·관리 줄을 모아 보기. 줄은 코드가 입력 그대로 넣고, 제목만 쓴다(입력에 없는 안내 문구를 짓지 않는다)',
  cta: '마무리 구매 유도',
}

export interface ComposeInput {
  product: TemplateProductBrief
  guideline: Pick<Guideline, 'persona' | 'tone'>
  /** 고를 수 있는 섹션 */
  open: readonly string[]
  /** 상품 사실 수와 이야기 칸 — 사실이 적으면 사실을 많이 요구하는 섹션을 줄인다 */
  facts: { count: number; places: number }
  range: { min: number; max: number }
  /** 기획 1장 설득 순서(pageplan 잡만, 결정 카드 c10·J28 — 기본 off) — 고를 수 있는 섹션의 단계만. 없으면 프롬프트가 이 칸 전과 글자까지 같다 */
  plan?: ReadonlyArray<{ section: string; say: string }>
}

export function buildComposePrompt(input: ComposeInput): string {
  const rows = input.open.map((section) => `- ${section}: ${SECTION_PURPOSES[section] ?? section}`)
  return `상세페이지에 넣을 섹션을 고른다. 섹션 하나가 한 화면 묶음이다. 페이지 흐름은 코드가 맞추므로 순서는 신경 쓰지 않아도 된다.

## 상품
${brief(input.product)}
- 고객 한 줄: ${input.guideline.persona || '(없음)'}
- 상품 사실 ${input.facts.count}개, 사실을 실을 자리 ${input.facts.places}곳${composePlanBlock(input.plan)}

## 규칙
- ${input.range.min}~${input.range.max}개를 고른다. 같은 섹션을 여러 번 고를 수 있지만 point_div는 3번까지다.
- problem_raise·problem_empathy는 합쳐 한 번만 고른다. event_offer도 한 번만 고른다.
- 위 사실 수로 채울 수 없는 만큼 사실을 요구하는 섹션을 고르지 않는다. 같은 말을 되풀이하게 되기 때문이다. 대신 사진으로 보여 주는 sub2_div_page·product_exposure·petit_div를 고른다.
- 이 상품에 할 말이 없는 섹션은 고르지 않는다.

## 섹션 목록(이 id만 쓴다)
${rows.join('\n')}

## 답
JSON 하나만 쓴다.
{"sections":["hook_3step","…"]}`
}

/** 목록 밖 id는 버린다. 쓸 만한 값이 하나도 없으면 실패다 */
export function parseComposition(raw: string, allowed: ReadonlySet<string>): string[] {
  const parsed = parseObject(raw, '섹션 구성')
  const sections = Array.isArray(parsed.sections) ? parsed.sections.map((s) => text(s)).filter((s) => allowed.has(s)) : []
  if (sections.length === 0) throw new Error('섹션 구성에 쓸 수 있는 id가 없습니다')
  return sections
}

// ─── H4 템플릿 선택 ───

export interface SelectSlot {
  index: number
  section: string
  candidates: readonly TemplateMeta[]
}

export interface TemplatePick {
  index: number
  templateId: string
  reason: string
}

const describeTemplate = (t: TemplateMeta) =>
  `  - ${t.id} | ${t.name} | ${t.signature.columns}열 · 사진 ${t.signature.photo} · ${t.signature.align} · 용기 ${t.signature.container} | 밀도 ${t.fit.density}`

export function buildSelectPrompt(input: { product: TemplateProductBrief; guideline: Guideline; conceptName: string; slots: readonly SelectSlot[] }): string {
  const rows = input.slots.map((slot) => [`자리 ${slot.index} (${slot.section})`, ...slot.candidates.map(describeTemplate)].join('\n'))
  return `자리마다 템플릿을 하나 고른다. 이 고객과 컨셉에 맞고, 같은 모양이 이어지지 않아 페이지가 단조롭지 않게 고른다.

## 상품
${brief(input.product)}
- 고객 한 줄: ${input.guideline.persona || '(없음)'}
- 말투: ${input.guideline.tone || '(없음)'}
- 컨셉: ${input.conceptName}

## 자리와 후보(그 자리의 id만 쓴다)
${rows.join('\n')}

## 답
JSON 하나만 쓴다. 자리마다 한 줄이고 reason은 왜 이 모양인지 한 문장이다.
{"picks":[{"index":0,"templateId":"…","reason":"…"}]}`
}

/** 그 자리 후보가 아닌 값은 버린다(코드가 정한 첫 후보를 쓴다). 쓸 만한 값이 하나도 없으면 실패다 */
export function parseSelection(raw: string, slots: readonly SelectSlot[]): TemplatePick[] {
  const parsed = parseObject(raw, '템플릿 선택')
  const rows = Array.isArray(parsed.picks) ? (parsed.picks as Array<Record<string, unknown>>) : []
  const picks = new Map<number, TemplatePick>()
  for (const row of rows) {
    const slot = slots.find((s) => s.index === row?.index)
    const templateId = text(row?.templateId)
    if (slot && !picks.has(slot.index) && slot.candidates.some((t) => t.id === templateId)) {
      picks.set(slot.index, { index: slot.index, templateId, reason: text(row.reason) })
    }
  }
  if (picks.size === 0) throw new Error('템플릿 선택에 쓸 수 있는 값이 없습니다')
  return [...picks.values()]
}
