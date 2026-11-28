/**
 * 새 단계 ③ 연출 감독(하네스 R10a) — 헌장·식별 카드 뒤 첫 생성 전에 페이지 단위로 빛 하나·세트 하나·컷 리듬(거리·사람 유무)을 정한다.
 * 기존 결정론 장치(light·scene·shotplan·shotvary)를 바꾸지 않고 컷 지시 뒤에 덧붙인다(I4-4 11) — directorLineOf가 덧붙일 한 줄이다.
 * 결과 키 design_prompts.director. 새 배치 + newstages 잡의 이미지 단계가 첫 생성 전에 한 번 부른다(pdp-image-stage.ts needsDirector →
 * pdp-new-stages-stage.ts runDirectorStage), 컷 지시 뒤 덧붙임은 pdp-new-stages-stage.ts directorLineFor가 이 파일의 directorLineOf로 한다.
 * 프롬프트는 C 시제품 v4(c-model-eval-new-prompts-v4.ts DIRECTOR_SYSTEM·buildDirectorPrompt) 그대로다.
 */

import type { DesignPrompts, PdpSpecSheet } from '../pdp-state'
import { specSheetPromptJson } from '../pdp-state'
import type { TemplateLibRecord } from '../templatelib/selection'
import {
  parseStrictJsonObject,
  reqArray,
  reqEnum,
  reqObject,
  reqString,
  reqStringArray,
  runNewStageCall,
  skippedRecord,
  type NewStageCallOptions,
  type NewStageDeps,
  type NewStageRecord,
} from './common'

export const DIRECTOR_SYSTEM = 'You are the art director of a Korean e-commerce detail page photo set. Use only the given inputs and respond only with the requested JSON.'

export interface DirectorShot {
  key: string
  section: string
  purpose: string
  composition: string
  show: string
}

export interface DirectorInput {
  spec: string
  card: string
  charter: string
  shots: readonly DirectorShot[]
}

export function buildDirectorPrompt(input: DirectorInput): string {
  return `상세페이지 한 장의 사진 연출을 '연출 감독'으로 정한다. 지금은 조명·무대·세트 문장이 컷마다 따로 붙어 충돌과 반복이 생긴다. 페이지 단위로 빛 하나·세트 하나·컷 리듬을 정해 각 컷 지시에 나눠 준다.

## 입력
### 판매자 입력
${input.spec}

### 식별 카드(상품 사진을 본 비전 모델의 설명)
${input.card.trim() || '(없음)'}

### 지금 스타일 헌장·조명 값
${input.charter}

### 컷 목록(순서대로, key: 섹션 · 목적 · 구도 · 화면 글)
${input.shots.map((s) => `- ${s.key}: ${s.section} · ${s.purpose} · ${s.composition} · ${s.show.replace(/\n/g, ' / ')}`).join('\n')}

## 규칙
- 빛은 하나: 방향·질·색온도를 한 줄로. 모든 컷이 이 빛을 따른다. 컷마다 바꾸려면 그 컷의 까닭을 쓴다(예: 야외 사용 장면).
- 세트는 하나: 바닥·벽·소품 계열을 한 줄로. 상품이 실제로 쓰이는 곳이 따로 있으면 그 컷만 실제 장소로 빼고 까닭을 쓴다.
- 리듬: 컷마다 거리(close|mid|wide)와 사람 유무(none|hand|person)를 정한다. 같은 거리·같은 사람 유무가 3컷 넘게 이어지지 않게 한다.
- 상품 생김새·색·부품은 식별 카드와 다르게 만들지 않는다. 입력에 없는 소품 브랜드·글자를 넣지 않는다.
- 목적이 problem인 컷은 이 상품을 쓰기 전의 고민 장면이다. 이 상품·그 포장·상품에 인쇄된 무늬를 소품이나 배경으로 적지 않는다(견줄 물건이 필요하면 모양·색·무늬가 다른 일반 물건).
- 컷마다 지시는 영어 1문장(이미지 모델용), 40단어 이하.

## 답
JSON 하나만 쓴다.
{"light":"영어 한 줄","set":"영어 한 줄","cuts":[{"key":"컷 key","distance":"close|mid|wide","people":"none|hand|person","direction":"영어 한 문장","exception":"빛·세트를 바꾸면 까닭, 아니면 빈 문자열"}],"conflicts_removed":["지금 지시에서 서로 부딪히던 것"]}`
}

export const DIRECTOR_DISTANCES = ['close', 'mid', 'wide'] as const
export const DIRECTOR_PEOPLE = ['none', 'hand', 'person'] as const

export interface DirectorCut {
  key: string
  distance: (typeof DIRECTOR_DISTANCES)[number]
  people: (typeof DIRECTOR_PEOPLE)[number]
  direction: string
  /** 빛·세트를 이 컷만 바꾼 까닭 — 비어 있지 않으면 페이지 빛·세트를 붙이지 않는다 */
  exception: string
}

export interface DirectorPlan {
  light: string
  set: string
  cuts: DirectorCut[]
  conflicts_removed: string[]
}

export function parseDirectorPlan(text: string): DirectorPlan {
  const o = parseStrictJsonObject(text)
  return {
    light: reqString(o, 'light', '$', { nonEmpty: true }),
    set: reqString(o, 'set', '$', { nonEmpty: true }),
    cuts: reqArray(o, 'cuts', '$').map((v, i) => {
      const at = `$.cuts[${i}]`
      const cut = reqObject(v, at)
      return {
        key: reqString(cut, 'key', at, { nonEmpty: true }),
        distance: reqEnum(cut, 'distance', DIRECTOR_DISTANCES, at),
        people: reqEnum(cut, 'people', DIRECTOR_PEOPLE, at),
        direction: reqString(cut, 'direction', at, { nonEmpty: true }),
        exception: reqString(cut, 'exception', at),
      }
    }),
    conflicts_removed: reqStringArray(o, 'conflicts_removed', '$'),
  }
}

const DIRECTION_MAX_WORDS = 40
const RHYTHM_MAX_RUN = 3

/** 가장 긴 같은 값 연속 길이 */
function longestRun(values: readonly string[]): number {
  let best = 0
  let run = 0
  values.forEach((value, i) => {
    run = i > 0 && value === values[i - 1] ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

/** 규칙에 어긋난 곳 — 보낸 적 없는 컷 키·지시가 빠진 컷·40단어 넘는 지시·같은 거리·사람 유무 4컷 이상 연속(컷 목록 순서) */
export function checkDirectorPlan(plan: DirectorPlan, shots: readonly DirectorShot[]): string[] {
  const warnings: string[] = []
  const keys = new Set(shots.map((shot) => shot.key))
  const byKey = new Map(plan.cuts.map((cut) => [cut.key, cut]))
  const strays = plan.cuts.filter((cut) => !keys.has(cut.key)).map((cut) => cut.key)
  if (strays.length > 0) warnings.push(`보낸 적 없는 컷 키 ${strays.length}개(${strays.join(', ')})`)
  const missing = shots.filter((shot) => !byKey.has(shot.key)).map((shot) => shot.key)
  if (missing.length > 0) warnings.push(`지시가 빠진 컷 ${missing.length}개(${missing.join(', ')})`)
  const long = plan.cuts.filter((cut) => cut.direction.trim().split(/\s+/).length > DIRECTION_MAX_WORDS).map((cut) => cut.key)
  if (long.length > 0) warnings.push(`${DIRECTION_MAX_WORDS}단어 넘는 지시 ${long.length}개(${long.join(', ')})`)
  const ordered = shots.map((shot) => byKey.get(shot.key)).filter((cut): cut is DirectorCut => cut !== undefined)
  const distanceRun = longestRun(ordered.map((cut) => cut.distance))
  const peopleRun = longestRun(ordered.map((cut) => cut.people))
  if (distanceRun > RHYTHM_MAX_RUN) warnings.push(`같은 거리 ${distanceRun}컷 연속(규칙 ${RHYTHM_MAX_RUN}컷까지)`)
  if (peopleRun > RHYTHM_MAX_RUN) warnings.push(`같은 사람 유무 ${peopleRun}컷 연속(규칙 ${RHYTHM_MAX_RUN}컷까지)`)
  return warnings
}

/**
 * 컷 지시 뒤에 덧붙일 한 줄 — 지시가 없는 컷은 null(덧붙이지 않는다 = 지금 지시 그대로). 예외 컷은 페이지 빛·세트를 붙이지 않는다
 * (그 컷의 지시가 바뀐 빛·장소를 말한다).
 * lightSetOnly(상품 없는 컷 — 목적 problem, J49 decide 24)면 컷별 지시 문장 없이 페이지 빛·세트만 붙인다 — 감독이 그 컷에 상품을 소품으로
 * 적어도 지시에 들어가지 않는다. 예외 컷은 빛·세트도 그 컷 지시 안에 있어 줄을 붙이지 않는다
 */
export function directorLineOf(plan: DirectorPlan, key: string, options: { lightSetOnly?: boolean } = {}): string | null {
  const cut = plan.cuts.find((row) => row.key === key)
  if (!cut) return null
  if (options.lightSetOnly) return cut.exception.trim() ? null : `Art direction: Light: ${plan.light.trim()} Set: ${plan.set.trim()}`
  const direction = cut.direction.trim()
  if (cut.exception.trim()) return `Art direction: ${direction}`
  return `Art direction: ${direction} Light: ${plan.light.trim()} Set: ${plan.set.trim()}`
}

/** K 계획 컷 목록(section_plan.templatelib.shots, 대표 컷 말고) → 감독 입력 컷 */
export function directorShotsOf(templatelib: Pick<TemplateLibRecord, 'shots'> | null | undefined): DirectorShot[] {
  return (templatelib?.shots ?? []).map((shot) => ({
    key: shot.key,
    section: shot.section,
    purpose: shot.purpose,
    composition: shot.composition,
    show: shot.show ?? '',
  }))
}

/** 잡에서 감독 입력 — 헌장·조명 값은 C 시제품과 같은 JSON({style_charter, lighting_params}) */
export function directorInputOf(
  job: { spec_sheet: PdpSpecSheet; design_prompts: DesignPrompts | null | undefined },
  shots: readonly DirectorShot[],
): DirectorInput {
  const dp = job.design_prompts ?? {}
  return {
    spec: specSheetPromptJson(job.spec_sheet),
    card: dp.identity_card ?? '',
    charter: JSON.stringify({ style_charter: dp.style_charter ?? null, lighting_params: dp.lighting_params ?? null }),
    shots,
  }
}

/** 컷이 없으면 부르지 않고 생략(no_input)으로 기록한다 */
export async function runDirector(input: DirectorInput, deps: NewStageDeps, options: NewStageCallOptions): Promise<NewStageRecord<DirectorPlan>> {
  if (input.shots.length === 0) return skippedRecord('director', 'no_input')
  return runNewStageCall(
    { stage: 'director', system: DIRECTOR_SYSTEM, content: buildDirectorPrompt(input), parse: parseDirectorPlan, check: (plan) => checkDirectorPlan(plan, input.shots) },
    deps,
    options,
  )
}
