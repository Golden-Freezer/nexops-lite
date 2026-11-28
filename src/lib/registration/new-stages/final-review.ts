/**
 * 새 단계 ⑤ 최종 검수(하네스 R10a) — compose 뒤 done 전, 나가기 직전 화면 글 전부에서 규제 표현·입력에 없는 숫자·연령 어긋남·사진이
 * 보여 줄 수 없는 약속을 찾는다. 기록+경고만 한다(I4-4 10): 모델이 쓴 fix는 기록에만 남고 글을 고치는 함수는 없다.
 * 결과 키 section_plan.final_review. 아직 어디서도 부르지 않는다.
 * 프롬프트는 C 시제품 v4(c-model-eval-new-prompts-v4.ts FINAL_REVIEW_SYSTEM·buildFinalReviewPrompt) 그대로다.
 */

import { specSheetPromptJson, type PdpSpecSheet } from '../pdp-state'
import {
  parseStrictJsonObject,
  reqArray,
  reqBoolean,
  reqEnum,
  reqObject,
  reqString,
  runNewStageCall,
  skippedRecord,
  type NewStageCallOptions,
  type NewStageDeps,
  type NewStageRecord,
} from './common'
import type { ScreenLine } from './screen-lines'
import { quotedIn } from './sources'

export const FINAL_REVIEW_SYSTEM = 'You are the final compliance reviewer of Korean e-commerce page text before it goes live. Respond only with the requested JSON.'

export interface FinalReviewInput {
  spec: string
  lines: readonly ScreenLine[]
}

export function buildFinalReviewPrompt(input: FinalReviewInput): string {
  return `나가기 직전의 상세페이지 화면 글 전부를 마지막으로 검수한다. 렌더된 화면 글만 보고, 걸리는 글을 찾아 고친다.

## 판매자 입력(사실 근거)
${input.spec}

## 화면 글 전부(id: 글)
${input.lines.map((l) => `- ${l.id}: ${l.text.replace(/\n/g, ' / ')}`).join('\n')}

## 걸리는 것(이것만 본다)
- regulated: 질병·의학·기능성 효능, 인증·시험 사칭, 살균·무독성·100% 안전 같은 절대 표현(건강식품·화장품·식품은 특히).
- number: 판매자 입력에 없는 숫자·단위·후기 수·순위.
- age: 연령·대상을 입력과 다르게 좁히거나 넓힌 글(예: 아이·학부모 대상이 아닌데 그렇게 씀).
- reproduce: 사진·화면이 실제로 보여 줄 수 없는 약속(예: 맛·향·촉감을 본 것처럼 단정).
- 걸리지 않는 글은 적지 않는다.

## 답
JSON 하나만 쓴다. fix는 판매자 입력 안에서만 고친 글이고, 고칠 수 없으면 빈 문자열(지운다)이다.
{"flags":[{"id":"줄 id","kind":"regulated|number|age|reproduce","text":"걸린 부분","why":"한 줄","fix":"고친 글"}],"pass":true}`
}

export const FINAL_REVIEW_KINDS = ['regulated', 'number', 'age', 'reproduce'] as const
export type FinalReviewKind = (typeof FINAL_REVIEW_KINDS)[number]

export interface FinalReviewFlag {
  id: string
  kind: FinalReviewKind
  text: string
  why: string
  /** 모델이 제안한 고친 글 — 기록만 한다(적용하지 않는다) */
  fix: string
}

export interface FinalReview {
  flags: FinalReviewFlag[]
  pass: boolean
}

export function parseFinalReview(text: string): FinalReview {
  const o = parseStrictJsonObject(text)
  return {
    flags: reqArray(o, 'flags', '$').map((v, i) => {
      const at = `$.flags[${i}]`
      const flag = reqObject(v, at)
      return {
        id: reqString(flag, 'id', at, { nonEmpty: true }),
        kind: reqEnum(flag, 'kind', FINAL_REVIEW_KINDS, at),
        text: reqString(flag, 'text', at),
        why: reqString(flag, 'why', at),
        fix: reqString(flag, 'fix', at),
      }
    }),
    pass: reqBoolean(o, 'pass', '$'),
  }
}

/** 경고 — 앞은 걸린 글(종류별 수·줄 id), 뒤는 답이 규칙을 어긴 곳(보낸 적 없는 줄 id·그 줄에 없는 걸린 부분·pass와 걸린 글의 모순) */
export function checkFinalReview(review: FinalReview, lines: readonly ScreenLine[]): string[] {
  const warnings: string[] = []
  if (review.flags.length > 0) {
    const counts = FINAL_REVIEW_KINDS.map((kind) => [kind, review.flags.filter((flag) => flag.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${kind} ${n}`)
      .join('·')
    warnings.push(`최종 검수: 걸린 글 ${review.flags.length}건(${counts} — ${review.flags.map((flag) => flag.id).join(', ')})`)
  }
  const byId = new Map(lines.map((line) => [line.id, line.text]))
  const strays = review.flags.filter((flag) => !byId.has(flag.id)).map((flag) => flag.id)
  if (strays.length > 0) warnings.push(`보낸 적 없는 줄 id ${strays.length}개(${strays.join(', ')})`)
  const unquoted = review.flags
    .filter((flag) => byId.has(flag.id))
    .filter((flag) => {
      const line = byId.get(flag.id) ?? ''
      return !quotedIn(line, flag.text) && !quotedIn(line.replace(/\n/g, ' / '), flag.text)
    })
    .map((flag) => flag.id)
  if (unquoted.length > 0) warnings.push(`걸린 부분이 그 줄 글에 없음 ${unquoted.length}건(${unquoted.join(', ')})`)
  if (review.pass && review.flags.length > 0) warnings.push('pass true인데 걸린 글이 있음')
  if (!review.pass && review.flags.length === 0) warnings.push('pass false인데 걸린 글이 없음')
  return warnings
}

/** 잡과 화면 글 줄에서 검수 입력 — 줄은 screen-lines(나가는 화면 글)가 만든다 */
export function finalReviewInputOf(job: { spec_sheet: PdpSpecSheet }, lines: readonly ScreenLine[]): FinalReviewInput {
  return { spec: specSheetPromptJson(job.spec_sheet), lines }
}

/** 검수할 줄이 없으면 부르지 않고 생략(no_input)으로 기록한다 */
export async function runFinalReview(input: FinalReviewInput, deps: NewStageDeps, options: NewStageCallOptions): Promise<NewStageRecord<FinalReview>> {
  if (input.lines.length === 0) return skippedRecord('finalReview', 'no_input')
  return runNewStageCall(
    { stage: 'finalReview', system: FINAL_REVIEW_SYSTEM, content: buildFinalReviewPrompt(input), parse: parseFinalReview, check: (review) => checkFinalReview(review, input.lines) },
    deps,
    options,
  )
}
