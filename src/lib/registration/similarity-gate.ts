/**
 * PDP 카피 유사도 게이트 — 설계문서 DESIGN-NEXFIT-GENERATORS-20260809 §2 결정 H-1 산출 레벨 방어(3번째 겹).
 * 순수 함수(LLM 아님). compose 단계 직전에 생성 카피를 비가역 해시 코퍼스(유사도 검사 전용,
 * 프롬프트 미주입)와 n-gram 비교해 임계 초과 문장을 찾는다. 재생성·경고 플래그 소비는 파이프라인
 * 소관 — 여기는 검사만.
 *
 * n-gram 선택: **음절(문자) 3-gram + Jaccard 유사도**를 쓴다(어절 2-gram 대신).
 * 한국어는 조사·어미가 붙어 공백 기준 어절 분리가 형태소 경계와 다르므로("정품보장을"과 "정품보장은"이
 * 다른 어절 토큰이 되어 실제로는 유사한 문장이 과소 탐지된다), 형태소 분석기 없이도 안정적인 방법은
 * 음절 단위 n-gram이다. 각 한글 음절은 그 자체로 완결된 글자이므로(영문 알파벳 1글자와 달리) 3-gram이면
 * 이미 조사 변화에 강건한 부분 문자열 단위가 된다 — 별도 형태소 분석 의존성(dependency minimalism) 없이
 * "표현 재사용" 탐지에 실용적으로 충분하다는 것이 한국어 표절/유사도 탐지에서 흔히 쓰는 근거다.
 */

import { createHash } from 'node:crypto'
import type { CopywritingResult } from './pdp-state'
import fashionCorpusCheck from './corpus-check/fashion.json'
import beautyCorpusCheck from './corpus-check/beauty.json'
import foodCorpusCheck from './corpus-check/food.json'
import digitalCorpusCheck from './corpus-check/digital.json'
import householdCorpusCheck from './corpus-check/household.json'

/** 10자 미만 문장은 비교하지 않는다 — 짧은 문구(예: "네", "좋아요")는 우연 일치가 흔해 오탐이 크다. */
const MIN_SENTENCE_LENGTH = 10
const CORPUS_ALGO = 'char3gram-sha256-12'
const HASH_PATTERN = /^[0-9a-f]{12}$/

export interface CorpusCheckSentence {
  len: number
  grams: string[]
}

export interface CorpusCheck {
  schemaVersion: 1
  algo: typeof CORPUS_ALGO
  generatedAt: string
  sentenceCount: number
  sentences: CorpusCheckSentence[]
}

type CorpusCategoryKey = 'fashion' | 'beauty' | 'food' | 'digital' | 'household'

// webpack/Next가 모든 산출물을 빌드 시점에 포함하도록 리터럴 정적 import만 사용한다.
const CORPUS_CHECKS: Record<CorpusCategoryKey, unknown> = {
  fashion: fashionCorpusCheck,
  beauty: beautyCorpusCheck,
  food: foodCorpusCheck,
  digital: digitalCorpusCheck,
  household: householdCorpusCheck,
}

/** Jaccard 임계값(튜닝 가능) — 3-gram 집합이 이 비율 이상 겹치면 "표현 재사용"으로 간주한다. */
export const SIMILARITY_THRESHOLD = 0.5

export interface SimilarityFinding {
  section: string
  sentence: string
  score: number
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n]+|(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH)
}

function hashGram(gram: string): string {
  return createHash('sha256').update(gram, 'utf8').digest('hex').slice(0, 12)
}

function hashedCharNgrams(text: string, n = 3): Set<string> {
  const grams = new Set<string>()
  const clean = text.replace(/\s+/gu, '')
  if (clean.length < n) {
    grams.add(hashGram(clean))
    return grams
  }
  for (let i = 0; i <= clean.length - n; i++) grams.add(hashGram(clean.slice(i, i + n)))
  return grams
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const g of a) if (b.has(g)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * CopywritingResult(및 임의 중첩 객체/배열)를 재귀 순회해 문자열 리프를 전부 모은다 — 필드를
 * 하드코딩 나열하지 않는 이유는 CopywritingResult가 `[key: string]: unknown` 확장 스키마라
 * 필드 추가마다 이 파일을 갱신해야 하는 결합을 피하기 위함. 최상위 키를 section 라벨로 쓴다.
 */
function collectCandidateSentences(value: unknown, section: string, out: Array<{ section: string; sentence: string }>): void {
  if (typeof value === 'string') {
    for (const sentence of splitSentences(value)) out.push({ section, sentence })
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCandidateSentences(item, section, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // 후기 카드의 original(P1-6 후기 요약의 원문 — 대조용)은 화면에 그리지 않는다. 결정론 발췌라 재생성으로 고칠 수도 없다
      if (key === 'original') continue
      // section 라벨은 최상위 키로 고정 — 내부 키는 문장 위치 구분에 쓰지 않는다(호출부가 section만 소비)
      collectCandidateSentences(v, section, out)
    }
  }
}

function assertCorpusCheck(value: unknown, categoryKey: string): CorpusCheck {
  if (!value || typeof value !== 'object') {
    throw new Error(`유사도 해시 코퍼스가 올바른 객체가 아닙니다: ${categoryKey}`)
  }
  const corpus = value as Partial<CorpusCheck>
  if (
    corpus.schemaVersion !== 1 ||
    corpus.algo !== CORPUS_ALGO ||
    typeof corpus.generatedAt !== 'string' ||
    typeof corpus.sentenceCount !== 'number' ||
    !Array.isArray(corpus.sentences)
  ) {
    throw new Error(`유사도 해시 코퍼스 스키마가 올바르지 않습니다: ${categoryKey}`)
  }
  if (corpus.sentences.length === 0) {
    throw new Error(`유사도 해시 코퍼스 sentences가 비어 있습니다: ${categoryKey}`)
  }
  for (const sentence of corpus.sentences) {
    if (
      !sentence ||
      typeof sentence.len !== 'number' ||
      !Array.isArray(sentence.grams) ||
      sentence.grams.length === 0 ||
      sentence.grams.some((gram) => typeof gram !== 'string' || !HASH_PATTERN.test(gram))
    ) {
      throw new Error(`유사도 해시 코퍼스 문장 데이터가 올바르지 않습니다: ${categoryKey}`)
    }
  }
  return corpus as CorpusCheck
}

/**
 * 잡 단위 임시 코퍼스 — 글 목록을 정적 코퍼스와 같은 방식(10자 이상 문장 → 음절 3-gram 해시)으로 바꾼다. 레퍼런스 원문처럼
 * 잡마다 다른 비교 대상을 더할 때 쓴다(원문은 해시로만 남고 프롬프트에 들어가지 않는다). 문장이 없으면 null
 */
export function buildTextCorpusCheck(texts: readonly string[]): CorpusCheck | null {
  const sentences = texts.flatMap(splitSentences).map((s) => ({ len: s.length, grams: [...hashedCharNgrams(s)] }))
  if (sentences.length === 0) return null
  return { schemaVersion: 1, algo: CORPUS_ALGO, generatedAt: 'job', sentenceCount: sentences.length, sentences }
}

/** 두 코퍼스를 합친다 — 한쪽이 없으면 다른 쪽 그대로(둘 다 없으면 null, 기존 의미론) */
export function mergeCorpusChecks(a: CorpusCheck | null, b: CorpusCheck | null): CorpusCheck | null {
  if (!a) return b
  if (!b) return a
  return { ...a, sentenceCount: a.sentenceCount + b.sentenceCount, sentences: [...a.sentences, ...b.sentences] }
}

/**
 * 정적 해시 코퍼스 로더. 화이트리스트 밖 카테고리는 검사 대상이 없다는 기존 의미론에 따라 null이다.
 * 화이트리스트 데이터가 비거나 깨지면 빌드 산출물 오류이므로 예외를 던져 fail-closed한다.
 */
export function loadCorpusCheck(categoryKey: string): CorpusCheck | null {
  const key = categoryKey?.trim().toLowerCase()
  if (!key || !Object.prototype.hasOwnProperty.call(CORPUS_CHECKS, key)) return null
  return assertCorpusCheck(CORPUS_CHECKS[key as CorpusCategoryKey], key)
}

/** 생성된 카피 산출물을 비가역 해시 코퍼스와 비교해 임계 초과 문장을 찾는다. */
export function checkCopySimilarity(
  copySections: CopywritingResult,
  corpusCheck: CorpusCheck | null,
): SimilarityFinding[] {
  if (corpusCheck === null) return []
  const corpus = assertCorpusCheck(corpusCheck, '전달된 코퍼스')
  const corpusGrams = corpus.sentences.map((sentence) => new Set(sentence.grams))

  const candidates: Array<{ section: string; sentence: string }> = []
  for (const [section, value] of Object.entries(copySections)) {
    collectCandidateSentences(value, section, candidates)
  }

  const findings: SimilarityFinding[] = []
  for (const { section, sentence } of candidates) {
    const grams = hashedCharNgrams(sentence)
    let maxScore = 0
    for (const storedGrams of corpusGrams) {
      const score = jaccard(grams, storedGrams)
      if (score > maxScore) maxScore = score
    }
    if (maxScore >= SIMILARITY_THRESHOLD) findings.push({ section, sentence, score: maxScore })
  }
  return findings
}
