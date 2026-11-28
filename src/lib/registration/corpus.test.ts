import { describe, it, expect } from 'vitest'
import {
  getCorpusSnapshot,
  getCorpusVersion,
  formatCorpusVersion,
  buildDesignGroundingBlock,
  buildCopyGroundingBlock,
  buildImageGroundingBlock,
} from './corpus'

const MAX_BLOCK_CHARS_WITH_SUFFIX = 4020 // MAX_BLOCK_CHARS(4000) + '\n(이하 생략)' 여유

describe('getCorpusSnapshot', () => {
  it('실측 스냅샷이 있는 카테고리는 데이터를 반환한다', () => {
    const snapshot = getCorpusSnapshot('fashion')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.category).toBe('fashion')
  })

  it('9종 코퍼스 어디에도 대응이 없는 카테고리(packaging)는 null — 우아한 생략', () => {
    expect(getCorpusSnapshot('packaging')).toBeNull()
  })

  it('미수집 카테고리(stationery·pet)도 null', () => {
    expect(getCorpusSnapshot('stationery')).toBeNull()
    expect(getCorpusSnapshot('pet')).toBeNull()
  })

  it('빈 값/미상 카테고리는 예외 없이 null', () => {
    expect(getCorpusSnapshot(undefined)).toBeNull()
    expect(getCorpusSnapshot(null)).toBeNull()
    expect(getCorpusSnapshot('존재하지않는카테고리')).toBeNull()
  })

  it('대소문자·공백에 관대하다', () => {
    expect(getCorpusSnapshot(' Fashion ')).not.toBeNull()
  })

  it('실 스냅샷 버전은 generatedAt과 12자리 지문 또는 legacy 형식이다', () => {
    const snapshot = getCorpusSnapshot('fashion')!
    const escapedGeneratedAt = snapshot.generatedAt.replaceAll('.', '\.')
    expect(getCorpusVersion('fashion')).toMatch(
      new RegExp('^v1:' + escapedGeneratedAt + ':(?:[0-9a-f]{12}|legacy)$')
    )
    expect(getCorpusVersion('packaging')).toBeNull()
  })

  it('contentHash 없는 픽스처는 v1:generatedAt:legacy로 조립한다', () => {
    expect(formatCorpusVersion({ generatedAt: '2026-08-20T00:00:00.000Z' })).toBe(
      'v1:2026-08-20T00:00:00.000Z:legacy'
    )
  })
})

describe('공통 모바일 규칙 블록 — 스냅샷 부재 시에도 항상 반환(H-2)', () => {
  it('스냅샷이 없는 카테고리(packaging)에서도 그라운딩 블록은 비어있지 않다', () => {
    const design = buildDesignGroundingBlock('packaging')
    const copy = buildCopyGroundingBlock('packaging')
    const image = buildImageGroundingBlock('packaging')
    for (const block of [design, copy, image]) {
      expect(block.length).toBeGreaterThan(0)
      expect(block).toContain('모바일')
    }
  })

  it('모든 블록 머리에 H-1 재사용 금지 지시가 고정 삽입된다', () => {
    const block = buildDesignGroundingBlock(undefined)
    expect(block.startsWith('아래는 시장 관행 참고 자료다')).toBe(true)
  })
})

describe('카테고리별 그라운딩 블록', () => {
  it('디자인 블록에 실측 섹션 시퀀스가 포함된다(fashion — coupang 데이터 보유)', () => {
    const block = buildDesignGroundingBlock('fashion')
    expect(block).toContain('섹션 시퀀스 실측 prior')
    expect(block).toContain('usp_feature')
  })

  it('카피 블록에 원문 없이 패턴 추상화만 포함된다(fashion)', () => {
    const block = buildCopyGroundingBlock('fashion')
    expect(block).toContain('카피 패턴 추상화')
    // 원문 발췌(따옴표로 감싼 실제 카피 문장)가 섞이지 않았는지 — H-1 소스 레벨 방어 확인
    expect(block).not.toMatch(/"[^"]{15,}"/)
  })

  it('이미지 블록에 카테고리 집계 연출 패턴(hex·px)이 포함된다(beauty)', () => {
    const block = buildImageGroundingBlock('beauty')
    expect(block).toMatch(/#[0-9A-Fa-f]{6}/)
  })

  it('coupang 데이터가 없는 카테고리(digital)는 이미지 블록에서 카테고리 절만 생략하고 공통 블록은 유지한다', () => {
    const block = buildImageGroundingBlock('digital')
    expect(block.length).toBeGreaterThan(0)
    expect(block).toContain('모바일')
  })

  it('모든 주입 블록은 단계당 상한(약 4KB) 안에 있다', () => {
    for (const key of ['fashion', 'beauty', 'food', 'digital', 'household', 'packaging']) {
      expect(buildDesignGroundingBlock(key).length).toBeLessThanOrEqual(MAX_BLOCK_CHARS_WITH_SUFFIX)
      expect(buildCopyGroundingBlock(key).length).toBeLessThanOrEqual(MAX_BLOCK_CHARS_WITH_SUFFIX)
      expect(buildImageGroundingBlock(key).length).toBeLessThanOrEqual(MAX_BLOCK_CHARS_WITH_SUFFIX)
    }
  })
})
