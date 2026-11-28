import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  checkCopySimilarity,
  loadCorpusCheck,
  SIMILARITY_THRESHOLD,
  type CorpusCheck,
} from './similarity-gate'
import type { CopywritingResult } from './pdp-state'

function plainCharNgrams(text: string, n = 3): Set<string> {
  const grams = new Set<string>()
  const clean = text.replace(/\s+/gu, '')
  if (clean.length < n) {
    grams.add(clean)
    return grams
  }
  for (let i = 0; i <= clean.length - n; i++) grams.add(clean.slice(i, i + n))
  return grams
}

function hashGram(gram: string): string {
  return createHash('sha256').update(gram, 'utf8').digest('hex').slice(0, 12)
}

function makeCorpus(rawSentences: string[]): CorpusCheck {
  return {
    schemaVersion: 1,
    algo: 'char3gram-sha256-12',
    generatedAt: '2026-08-19T00:00:00.000Z',
    sentenceCount: rawSentences.length,
    sentences: rawSentences
      .filter((sentence) => sentence.length >= 10)
      .map((sentence) => ({
        len: sentence.length,
        grams: [...plainCharNgrams(sentence)].map(hashGram),
      })),
  }
}

function plainJaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection++
  return intersection / (a.size + b.size - intersection)
}

describe('checkCopySimilarity', () => {
  it('평문 3-gram과 해시 3-gram이 같은 Jaccard 판정을 낸다', () => {
    const rawSentences = [
      '100% 미국 현지 정품 보장을 약속드립니다 저희는 정직합니다',
      '기다림 없는 국내 바로 배송으로 빠르게 만나보세요',
    ]
    const candidate = '100% 미국 현지 정품 보장을 약속드립니다 저희는 정직해요'
    const candidateGrams = plainCharNgrams(candidate)
    const plainScore = Math.max(
      ...rawSentences.map((sentence) => plainJaccard(candidateGrams, plainCharNgrams(sentence))),
    )
    const copySections: CopywritingResult = { problem: { question: candidate } }

    const findings = checkCopySimilarity(copySections, makeCorpus(rawSentences))

    expect(findings.length > 0).toBe(plainScore >= SIMILARITY_THRESHOLD)
    expect(findings[0].score).toBeCloseTo(plainScore, 12)
    expect(findings[0].sentence).toBe(candidate)
  })

  it('임계값 0.5 경계는 적발하고 바로 아래는 통과시킨다', () => {
    const copySections: CopywritingResult = { headline: 'ABCDEFGHIJKL' }

    const atBoundary = checkCopySimilarity(copySections, makeCorpus(['ABCDEFGHXY']))
    const belowBoundary = checkCopySimilarity(copySections, makeCorpus(['ABCDEFGWXY']))

    expect(atBoundary).toHaveLength(1)
    expect(atBoundary[0].score).toBe(SIMILARITY_THRESHOLD)
    expect(belowBoundary).toHaveLength(0)
  })

  it('화이트리스트 밖 카테고리는 검사 대상 없음으로 빈 결과를 반환한다', () => {
    const copySections: CopywritingResult = {
      closingCta: { headline: '지금 바로 구매하고 특별한 혜택을 받아보세요' },
    }

    expect(loadCorpusCheck('packaging')).toBeNull()
    expect(loadCorpusCheck('../fashion')).toBeNull()
    expect(checkCopySimilarity(copySections, loadCorpusCheck('packaging'))).toEqual([])
  })

  it('화이트리스트 코퍼스의 sentences가 비면 fail-closed로 예외를 던진다', () => {
    const emptyCorpus: CorpusCheck = {
      schemaVersion: 1,
      algo: 'char3gram-sha256-12',
      generatedAt: '2026-08-19T00:00:00.000Z',
      sentenceCount: 0,
      sentences: [],
    }

    expect(() => checkCopySimilarity({ headline: '충분히 긴 생성 카피 문장입니다' }, emptyCorpus)).toThrow(
      'sentences가 비어 있습니다',
    )
  })

  it('정적 import된 실제 카테고리 코퍼스는 해시 문장을 제공한다', () => {
    const corpus = loadCorpusCheck('fashion')

    expect(corpus?.sentences.length).toBeGreaterThan(0)
    expect(corpus?.sentences[0].grams[0]).toMatch(/^[0-9a-f]{12}$/)
  })
})
