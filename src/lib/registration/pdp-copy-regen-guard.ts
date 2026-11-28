/**
 * 편집기 카피 재생성 가드(pdp-copy-regen-api) — 후보마다 결정론적으로 검사한다. 기존 카피 가드를 한 칸짜리 카피로 감싸 그대로 쓴다.
 * 순서: 정리·빈 값 → 금지 표현(NEXFIT _sanitize_text처럼 치환하고, 치환 뒤에도 남으면 탈락) → 옵션 개수 정정(등록 옵션 구조가 있는
 * 잡만, 카피 단계와 같은 규칙 — 숫자만 바꾼다) → 길이 → 중복 → 코퍼스 유사도 → 연령(제한 상품만) → 경쟁사 리뷰 재현(경쟁사 리뷰가 있는 잡만).
 * 판정하지 못하면(코퍼스를 읽지 못함·검사 예외) 그 후보는 탈락(unjudged) — 통과로 보지 않는다(통합 요구: 판정 불가면 이전 카피 유지).
 * 주장 범위(효능·브랜드·가격)는 결정론적 검사기가 없어 프롬프트 블록으로만 막는다(카피 단계와 같다).
 */

import { checkAgeCompliance } from './compliance-gate'
import { correctCopyFacts, type CopyFacts } from './copy-facts'
import { checkBannedExpressions, sanitizeCopyData } from './pdp-copy-sanitize'
import { normalizeCopyText, stripCopyDelimiters, type CopyRegenRejection } from './pdp-copy-regen'
import type { CopywritingResult } from './pdp-state'
import { findCopyEchoes, type EchoGuard } from './reviews/competitor-echo'
import { checkCopySimilarity, type CorpusCheck } from './similarity-gate'

/** NEXFIT 규칙 "한 줄에 15~22자" — 현재 카피 줄이 더 길면 그 길이까지 허용한다(본문 칸) */
export const COPY_REGEN_LINE_CHARS = 22
const MIN_TOTAL_CHARS = 40
const TOTAL_GROWTH = 1.6

export interface CopyGuardContext {
  currentText: string
  /** null = 이 카테고리는 검사 대상 아님(loadCorpusCheck 의미 그대로), { error } = 코퍼스를 읽지 못함(판정 불가) */
  corpus: CorpusCheck | null | { error: string }
  echoGuard: EchoGuard | null
  /** 연령 제한 상품만 — 만 N세 */
  minAge: number | null
  /** 사실 값(pdp-copy-facts-r4) — 등록 옵션 구조가 있는 잡만. 축 개수 오기는 탈락이 아니라 숫자를 고친다 */
  facts?: CopyFacts
}

export interface CopyGuardResult {
  passed: string[]
  rejected: CopyRegenRejection[]
}

const GUARD_KEY = 'editorCopyRegen'

/** 옵션 개수 오기를 고친 글 — 카피 단계 가드(correctCopyFacts)를 한 칸에 그대로 쓴다 */
function correctedText(text: string, facts: CopyFacts): string {
  const fixed = correctCopyFacts(asCopy(text), facts).copy as unknown as Record<string, string>
  return fixed[GUARD_KEY]
}

/** 한 칸을 카피 한 키로 감싼다 — 기존 가드는 최상위 키를 섹션 이름으로 보고 안쪽 문자열을 모두 검사한다 */
function asCopy(value: string | string[]): CopywritingResult {
  return { [GUARD_KEY]: value } as unknown as CopywritingResult
}

/**
 * 유사도 검사 입력 — 줄 그대로와 줄을 이어 붙인 글을 함께 넣는다. 유사도 게이트는 줄마다 나누고 10자 미만 조각을 버려서,
 * 한 문장을 짧은 두 줄로 쪼개면 그대로 비켜 간다(검수 지적)
 */
function similarityInput(text: string): string[] {
  const joined = text.replace(/\n+/g, ' ')
  return joined === text ? [text] : [text, joined]
}

function chars(s: string): number {
  return [...s].length
}

/** 슬롯 넘침 방지 상한 — 줄당 글자 수·줄 수·전체 글자 수(현재 카피 기준) */
export function copyRegenLengthLimits(currentText: string): { lineChars: number; lines: number; total: number } {
  const lines = currentText.split('\n')
  return {
    lineChars: Math.max(COPY_REGEN_LINE_CHARS, ...lines.map(chars)),
    lines: lines.length + 1,
    total: Math.max(MIN_TOTAL_CHARS, Math.ceil(chars(currentText) * TOTAL_GROWTH)),
  }
}

function lengthViolation(text: string, currentText: string): string | null {
  const limits = copyRegenLengthLimits(currentText)
  const lines = text.split('\n')
  if (lines.length > limits.lines) return `줄 수 ${lines.length} > ${limits.lines}`
  const longest = Math.max(...lines.map(chars))
  if (longest > limits.lineChars) return `한 줄 ${longest}자 > ${limits.lineChars}자`
  if (chars(text) > limits.total) return `전체 ${chars(text)}자 > ${limits.total}자`
  return null
}

/** 중복 비교 키 — 공백과 구분자 글자를 뺀다(현재 카피는 구분자 글자를 지운 값, 후보는 그대로 둔 값이라 — 검수 지적) */
const squash = (s: string) => stripCopyDelimiters(s).replace(/\s+/g, '')

/** 금지 표현은 치환한다 — 치환 뒤에도 남으면 null */
function replaceBanned(text: string): string | null {
  const [cleaned] = sanitizeCopyData(text)
  const out = normalizeCopyText(String(cleaned))
  return checkBannedExpressions(out).length > 0 ? null : out
}

/** 내용 가드(유사도·연령·재현) — 걸린 사유 또는 null. 예외는 호출부가 unjudged로 바꾼다 */
function contentViolation(text: string, ctx: CopyGuardContext): CopyRegenRejection | null {
  const copy = asCopy(text)
  if (ctx.corpus && 'error' in ctx.corpus)
    return { reason: 'unjudged', detail: `코퍼스 유사도 판정 불가: ${ctx.corpus.error}` }
  if (ctx.corpus && checkCopySimilarity(asCopy(similarityInput(text)), ctx.corpus).length > 0) {
    return { reason: 'similarity', detail: '기존 상세페이지 문장과 너무 비슷합니다.' }
  }
  if (ctx.minAge && checkAgeCompliance(copy, ctx.minAge).violations.length > 0) {
    return { reason: 'age', detail: `만 ${ctx.minAge}세 미만 사용을 암시하는 표현이 있습니다.` }
  }
  if (ctx.echoGuard && findCopyEchoes(copy, ctx.echoGuard).length > 0) {
    return { reason: 'competitor_echo', detail: '분석용 경쟁 상품 리뷰 문장과 길게 겹칩니다.' }
  }
  return null
}

export function guardCopyCandidates(raw: readonly string[], ctx: CopyGuardContext): CopyGuardResult {
  const passed: string[] = []
  const rejected: CopyRegenRejection[] = []
  const seen = new Set([squash(ctx.currentText)])
  for (const candidate of raw) {
    const text = normalizeCopyText(candidate)
    if (!text) {
      rejected.push({ reason: 'empty', detail: '빈 후보입니다.' })
      continue
    }
    const sanitized = replaceBanned(text)
    if (sanitized === null) {
      rejected.push({ reason: 'banned', detail: '금지 표현이 치환 뒤에도 남았습니다.' })
      continue
    }
    const replaced = ctx.facts ? correctedText(sanitized, ctx.facts) : sanitized
    const tooLong = lengthViolation(replaced, ctx.currentText)
    if (tooLong) {
      rejected.push({ reason: 'length', detail: tooLong })
      continue
    }
    if (seen.has(squash(replaced))) {
      rejected.push({ reason: 'duplicate', detail: '현재 카피 또는 앞 후보와 같습니다.' })
      continue
    }
    let violation: CopyRegenRejection | null
    try {
      violation = contentViolation(replaced, ctx)
    } catch (error) {
      violation = {
        reason: 'unjudged',
        detail: `가드 판정 실패: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (violation) {
      rejected.push(violation)
      continue
    }
    seen.add(squash(replaced))
    passed.push(replaced)
  }
  return { passed, rejected }
}
