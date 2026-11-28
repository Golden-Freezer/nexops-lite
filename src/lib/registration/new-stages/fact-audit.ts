/**
 * 새 단계 ② 사실 감사(하네스 R10a) — 화면 글을 한 줄씩 입력과 대조해 입력에 없는 사실(수치·소재·인증·효능·후기 수·비교)을 찾는다.
 * 기록+경고만 한다(I4-4 10): 모델이 쓴 fix는 기록에만 남고 글을 고치는 함수는 없다. 자리가 둘이다 — 카피 뒤(카피 최종본,
 * copy_sections.fact_audit)·K 칸 카피 뒤(디자인 컷 칸 글, section_plan.kslot_fact_audit). 아직 어디서도 부르지 않는다.
 * 프롬프트는 C 시제품 v4(c-model-eval-new-prompts-v4.ts FACT_AUDIT_SYSTEM·buildFactAuditPrompt) 그대로다.
 */

import {
  parseStrictJsonObject,
  reqArray,
  reqBoolean,
  reqEnum,
  reqNumber,
  reqObject,
  reqString,
  runNewStageCall,
  skippedRecord,
  type NewStageCallOptions,
  type NewStageDeps,
  type NewStageRecord,
} from './common'
import { lineIdsOf, type ScreenLine } from './screen-lines'
import { promptSourcesOf, quotedIn, type PromptSources, type SourceJob } from './sources'

export const FACT_AUDIT_SYSTEM = 'You audit Korean e-commerce page copy against its source inputs. Use only the given inputs and respond only with the requested JSON.'

export interface FactAuditInput extends PromptSources {
  lines: readonly ScreenLine[]
}

export function buildFactAuditPrompt(input: FactAuditInput): string {
  return `상세페이지에 나가는 화면 글을 한 줄씩 입력과 대조해 '사실 감사'를 한다. 목적은 입력에 없는 사실(수치·소재·인증·효능·후기 수·비교)이 페이지에 나가지 않게 하는 것이다.

## 입력(근거는 이것만)
### 판매자 입력
${input.spec}

### 분석
${input.analysis}

### 리서치(후기·경쟁사 요약)
${input.research}

## 감사할 화면 글(id: 글)
${input.lines.map((l) => `- ${l.id}: ${l.text.replace(/\n/g, ' / ')}`).join('\n')}

## 규칙
- 사실 주장(숫자·단위·소재·성분·인증·수상·후기 수·순위·비교·효과·안전)이 있는 줄만 판정한다. 감성 문구·권유만 있는 줄은 빼고 적지 않는다.
- 판정: supported(입력에 같은 사실이 있다) · partial(일부만 있거나 입력보다 세다) · unsupported(입력에 없다).
- supported·partial이면 근거가 된 입력 문구를 글자 그대로 evidence에 넣는다(입력 원문의 부분 문자열).
- partial·unsupported이면 fix에 입력 안에서만 고친 글을 쓴다. 고칠 수 없으면 fix는 빈 문자열(지운다)이다.
- 질병·의학·기능성 효능, 인증·시험 사칭, 살균·무독성·100% 안전 같은 절대 표현은 입력에 있어도 regulated: true로 표시한다.

## 답
JSON 하나만 쓴다.
{"items":[{"id":"줄 id","claim":"사실 주장","verdict":"supported|partial|unsupported","evidence":"입력 원문 부분","fix":"고친 글 또는 빈 문자열","regulated":false}],"summary":{"checked":0,"unsupported":0,"regulated":0}}`
}

export const FACT_VERDICTS = ['supported', 'partial', 'unsupported'] as const
export type FactVerdict = (typeof FACT_VERDICTS)[number]

export interface FactAuditItem {
  id: string
  claim: string
  verdict: FactVerdict
  evidence: string
  /** 모델이 제안한 고친 글 — 기록만 한다(적용하지 않는다) */
  fix: string
  regulated: boolean
}

export interface FactAudit {
  items: FactAuditItem[]
  summary: { checked: number; unsupported: number; regulated: number }
}

export function parseFactAudit(text: string): FactAudit {
  const o = parseStrictJsonObject(text)
  const items = reqArray(o, 'items', '$').map((v, i) => {
    const at = `$.items[${i}]`
    const item = reqObject(v, at)
    return {
      id: reqString(item, 'id', at, { nonEmpty: true }),
      claim: reqString(item, 'claim', at),
      verdict: reqEnum(item, 'verdict', FACT_VERDICTS, at),
      evidence: reqString(item, 'evidence', at),
      fix: reqString(item, 'fix', at),
      regulated: reqBoolean(item, 'regulated', at),
    }
  })
  const summary = reqObject(o.summary, '$.summary')
  return {
    items,
    summary: {
      checked: reqNumber(summary, 'checked', '$.summary'),
      unsupported: reqNumber(summary, 'unsupported', '$.summary'),
      regulated: reqNumber(summary, 'regulated', '$.summary'),
    },
  }
}

const idList = (items: readonly FactAuditItem[]) => items.map((item) => item.id).join(', ')

/**
 * 경고 — 앞은 감사가 찾은 것(입력에 없는 주장·입력보다 센 주장·규제 표현), 뒤는 답이 규칙을 어긴 곳(보낸 적 없는 줄 id·입력에 없는 근거
 * 인용·요약 수 불일치). 글은 고치지 않는다
 */
export function checkFactAudit(audit: FactAudit, input: FactAuditInput): string[] {
  const warnings: string[] = []
  const unsupported = audit.items.filter((item) => item.verdict === 'unsupported')
  const partial = audit.items.filter((item) => item.verdict === 'partial')
  const regulated = audit.items.filter((item) => item.regulated)
  if (unsupported.length > 0) warnings.push(`사실 감사: 입력에 없는 주장 ${unsupported.length}줄(${idList(unsupported)})`)
  if (partial.length > 0) warnings.push(`사실 감사: 입력보다 세거나 일부만 맞는 주장 ${partial.length}줄(${idList(partial)})`)
  if (regulated.length > 0) warnings.push(`사실 감사: 규제 표현 ${regulated.length}줄(${idList(regulated)})`)
  const ids = lineIdsOf(input.lines)
  const strays = audit.items.filter((item) => !ids.has(item.id))
  if (strays.length > 0) warnings.push(`보낸 적 없는 줄 id ${strays.length}개(${idList(strays)})`)
  const sourceText = [input.spec, input.analysis, input.research].join('\n')
  const unquoted = audit.items.filter((item) => item.verdict !== 'unsupported' && !quotedIn(sourceText, item.evidence))
  if (unquoted.length > 0) warnings.push(`근거 인용이 입력 원문에 없음 ${unquoted.length}줄(${idList(unquoted)})`)
  if (audit.summary.unsupported !== unsupported.length || audit.summary.regulated !== regulated.length) {
    warnings.push(
      `요약 수가 항목과 다름(요약 unsupported ${audit.summary.unsupported}·regulated ${audit.summary.regulated}, 항목 ${unsupported.length}·${regulated.length})`,
    )
  }
  return warnings
}

/** 잡과 화면 글 줄에서 감사 입력 — 줄은 screen-lines(카피 최종본 또는 디자인 컷 칸 글)가 만든다 */
export function factAuditInputOf(job: SourceJob, lines: readonly ScreenLine[]): FactAuditInput {
  return { ...promptSourcesOf(job), lines }
}

/**
 * 한 콜에 싣는 화면 글 줄 수 상한(하네스 R11c) — 출력(생각 포함)은 글자 수보다 판정할 줄 수를 따른다. C 4차 Sonnet 5.5 xhigh는 줄당 124~154토큰
 * (P05 56줄 → 8,629토큰·58초, P07 52줄 → 6,465토큰)이었다. R11b의 글자 기준(1,500자)은 R11 운영 P07 잡 7d9ee39a에서 걸리지 않았는데 한 콜이
 * 카피 뒤 16,519·K 칸 19,120/20,000(상한의 96%)토큰이었다 — 짧은 글 줄이 많은 페이지다. 40줄이면 줄당 250토큰(C 4차 최고의 1.6배)까지도
 * 출력이 상한(20,000)의 절반 안이다. 골든 A-track-i 카피 화면 글도 74줄·1,417자(줄당 약 19자)라 글자 기준에 안 걸리고 이 기준으로 37줄 둘이 된다.
 * P07 잡의 줄 수는 잡 행을 읽지 못해 재지 못했다 — 재현 진입점(__e2e__/fact-audit-repro)이 묶음별 줄·글자·토큰을 남긴다.
 * R11d에서 모델이 Opus 5.5 xhigh로 바뀌었다(40줄 그대로) — 줄당 토큰은 Sonnet 실측이라 Opus 값은 P09 재현 기록으로 다시 본다
 */
export const FACT_AUDIT_LINES_PER_CALL = 40
/**
 * 한 콜에 싣는 화면 글 글자 수 상한(R11b) — 줄이 길 때의 둘째 기준이다(C 4차 P05 1,501자 → 출력 8,629토큰, 글자당 약 5.7토큰).
 * 40줄·1,500자 이하는 지금처럼 한 콜이라 프롬프트가 바이트까지 같다
 */
export const FACT_AUDIT_LINE_CHARS_PER_CALL = 1500

const charsOf = (lines: readonly ScreenLine[]) => lines.reduce((sum, line) => sum + line.text.length, 0)

/**
 * 화면 글을 순서대로 묶음으로 나눈다 — 40줄·1,500자 이하면 한 묶음. 넘으면 k = max(⌈줄 수 ÷ 40⌉, ⌈글자 수 ÷ 1,500⌉), 묶음당 목표 줄 수
 * ⌈줄 수 ÷ k⌉로 순서대로 채우고, 다음 줄을 더하면 글자 상한을 넘을 때도 끊는다(긴 줄이 몰린 곳은 묶음이 늘어난다). 묶음마다 40줄 이하이고,
 * 줄 하나가 상한보다 긴 경우 말고는 1,500자 이하다. 줄은 쪼개지 않고 빈 묶음은 없다
 */
export function factAuditChunks(lines: readonly ScreenLine[], limits = { lines: FACT_AUDIT_LINES_PER_CALL, chars: FACT_AUDIT_LINE_CHARS_PER_CALL }): ScreenLine[][] {
  const count = Math.max(1, Math.ceil(lines.length / limits.lines), Math.ceil(charsOf(lines) / limits.chars))
  if (count <= 1) return [[...lines]]
  const target = Math.ceil(lines.length / count)
  const chunks: ScreenLine[][] = []
  let current: ScreenLine[] = []
  let chars = 0
  for (const line of lines) {
    if (current.length > 0 && (current.length >= target || chars + line.text.length > limits.chars)) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(line)
    chars += line.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

type DoneAudit = Extract<NewStageRecord<FactAudit>, { status: 'done' }>

/**
 * 나눠 부른 감사 합치기 — 하나라도 실패면 실패(앞선 실패의 종류·몇째 묶음인지), 비용은 모든 콜의 합(실패·잘린 콜 포함), 시간은 가장 긴 콜
 * (동시에 부른다). 모두 끝나면 항목을 잇고 요약 수를 더한 뒤 경고는 전체 입력으로 한 번 낸다
 */
export function mergeFactAuditParts(parts: readonly NewStageRecord<FactAudit>[], input: FactAuditInput): NewStageRecord<FactAudit> {
  const called = parts.flatMap((part) => (part.status === 'skipped' ? [] : [part]))
  if (called.length === 0) return skippedRecord('factAudit', 'no_input')
  const calls = parts.length
  const costUsd = called.reduce((sum, part) => sum + part.costUsd, 0)
  const durationMs = Math.max(...called.map((part) => part.durationMs))
  const failedAt = called.findIndex((part) => part.status === 'failed')
  const failed = called[failedAt]
  if (failed?.status === 'failed') {
    const failure = { kind: failed.failure.kind, message: `나눔 ${failedAt + 1}/${calls}: ${failed.failure.message}` }
    return { version: 1, stage: 'factAudit', status: 'failed', route: failed.route, failure, costUsd, durationMs, calls }
  }
  const done = called as DoneAudit[]
  const audit: FactAudit = {
    items: done.flatMap((part) => part.result.items),
    summary: {
      checked: done.reduce((sum, part) => sum + part.result.summary.checked, 0),
      unsupported: done.reduce((sum, part) => sum + part.result.summary.unsupported, 0),
      regulated: done.reduce((sum, part) => sum + part.result.summary.regulated, 0),
    },
  }
  return { version: 1, stage: 'factAudit', status: 'done', route: done[0].route, result: audit, warnings: checkFactAudit(audit, input), costUsd, durationMs, calls }
}

/**
 * 감사할 줄이 없으면 부르지 않고 생략(no_input)으로 기록한다. 화면 글이 40줄(FACT_AUDIT_LINES_PER_CALL)이나 1,500자(FACT_AUDIT_LINE_CHARS_PER_CALL)를 넘으면 묶음마다 같은 프롬프트(줄만
 * 그 묶음)로 동시에 불러 합친다 — 콜마다 같은 route·시간 제한이라 run 시간은 가장 긴 콜 하나 몫이다(R11b)
 */
export async function runFactAudit(input: FactAuditInput, deps: NewStageDeps, options: NewStageCallOptions): Promise<NewStageRecord<FactAudit>> {
  if (input.lines.length === 0) return skippedRecord('factAudit', 'no_input')
  const call = (lines: readonly ScreenLine[], check: (audit: FactAudit) => string[]) =>
    runNewStageCall({ stage: 'factAudit', system: FACT_AUDIT_SYSTEM, content: buildFactAuditPrompt({ ...input, lines }), parse: parseFactAudit, check }, deps, options)
  const chunks = factAuditChunks(input.lines)
  if (chunks.length === 1) return call(input.lines, (audit) => checkFactAudit(audit, input))
  const parts = await Promise.all(chunks.map((lines) => call(lines, () => [])))
  return mergeFactAuditParts(parts, input)
}
