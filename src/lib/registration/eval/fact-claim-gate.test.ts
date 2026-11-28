/**
 * 사실 값 규제 관문(2026-11-01 통합 결정, R12 P07 '급체방지용') — 입력·OpenAPI 속성 값이어도 페이지 표·캡션·카피 입력에 옮기면 우리 주장이다.
 * 사실이 페이지로 나가는 경로를 하나씩 고정한다. 규제 표현이 없는 값은 그대로 지나간다. LLM·DB 없음.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { legacySpecRows } from '../editor/utils/sectionConverter/convert'
import { specRowsFromInput } from '../editor/utils/sectionConverter/dedupe'
import { purchaseRows } from '../editor/utils/sectionConverter/purchaseCheck'
import { infoRows, insertLongPieces } from '../internalized/designcut-long'
import { planExtraShots } from '../internalized/shot-diversity'
import { buildAvailableSections } from '../pdp-composer-sections'
import type { PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { isQuoteSafe } from '../review-scrubber'
import { specFactLines } from '../spec-facts'
import { claimSafeFactRows, isDiseaseNameTerm, isFactClaimSafe, regulatedClaimTermsIn } from './claim-lexicon'

const terms = (text: string) => regulatedClaimTermsIn(text, { negation: true }).map((t) => t.term)

describe('사전 — 급체', () => {
  it.each(['급체 방지', '급체방지용', '급체 예방에 좋아요', '급체를 막아 줘요'])('센다: %s', (text) => {
    expect(terms(text)).toEqual(['급체'])
    expect(isQuoteSafe(text)).toBe(false)
  })

  it('이름 하나로 판정한다(자동 작성의 고민 서술 예외와 같은 묶음)', () => {
    expect(isDiseaseNameTerm('급체')).toBe(true)
  })

  it.each(['긴급체포', '응급체계', '천천히 먹게 도와요', '급하게 먹지 않게 도와요', '높이를 조절해 편하게 먹어요'])('세지 않는다: %s', (text) => {
    expect(terms(text)).toEqual([])
  })
})

describe('사실 값 판정', () => {
  it('규제 표현이 없으면 통과, 있으면 실패, 인증은 인증 정보가 뒷받침할 때만 통과', () => {
    expect(isFactClaimSafe('용량 820ml', '')).toBe(true)
    expect(isFactClaimSafe('급체 방지 급체방지용', '')).toBe(false)
    expect(isFactClaimSafe('KC 인증', '')).toBe(false)
    expect(isFactClaimSafe('KC 인증', 'KC 안전확인 신고')).toBe(true)
    // 질병 표현은 인증 정보에 같은 말이 있어도 통과하지 않는다
    expect(isFactClaimSafe('급체 방지', '급체 방지')).toBe(false)
  })

  it('이름에만 든 표현도 행째 뺀다, 나머지 행은 순서 그대로', () => {
    const rows = [
      { label: '용량', value: '820ml' },
      { label: '급체 방지', value: '있음' },
      { label: '소재', value: '도자기' },
    ]
    expect(claimSafeFactRows(rows, undefined)).toEqual([rows[0], rows[2]])
  })
})

describe('사실이 페이지로 나가는 경로', () => {
  const RISKY = { label: '급체 방지', value: '급체방지용' }

  it('R12 P07 실제 입력: 상품 정보 표에서 그 행만 빠지고 다른 행은 남는다', () => {
    const path = join(process.cwd(), 'src/lib/registration/__fixtures__/pdp-products/P07.json')
    const spec = JSON.parse(readFileSync(path, 'utf8')).specSheet as PdpSpecSheet
    const rows = infoRows(spec)
    expect(rows.map((r) => r.label)).not.toContain(RISKY.label)
    expect(rows.map((r) => r.value).join(' ')).not.toContain('급체')
    // 허용 목록(구성·용량)만 남는다. 높이 조절 같은 속성은 자동으로 싣지 않는다(오너 지시 11-01), 반려동물이라 사용연령도 없다
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(['구성', '용량']))
    expect(rows.map((r) => r.label)).not.toContain('높이 조절')
    expect(rows.map((r) => r.label)).not.toContain('사용연령')
  })

  it('구매 전 확인 표: 규제 표현이 든 옵션 행만 뺀다', () => {
    expect(purchaseRows({ colorOptions: ['급체방지형', '일반형'], size: '10cm' }).map((r) => r.label)).toEqual(['사이즈'])
    expect(purchaseRows({ colorOptions: ['데이지', '체리'], size: '10cm' }).map((r) => r.label)).toEqual(['옵션', '사이즈'])
  })

  it('스펙 표 두 경로: 중복 정리 잡(specRowsFromInput)과 기존 잡(legacySpecRows)', () => {
    const input = { material: '도자기', size: '10cm', extra: { [RISKY.label]: RISKY.value, 용량: '820ml' } }
    for (const rows of [specRowsFromInput(input), legacySpecRows(input)]) {
      expect(rows.map((r) => r.label)).not.toContain(RISKY.label)
      expect(rows.map((r) => r.label)).toContain('용량')
    }
  })

  it('컴포저 스펙 표', () => {
    const available = buildAvailableSections(
      'pro',
      {},
      {},
      { productName: '시험 그릇', material: '도자기', extra: { [RISKY.label]: RISKY.value } } as unknown as PdpSpecSheet
    )
    const rows = (available.spec_table as unknown as { spec_rows: Array<{ label: string }> }).spec_rows
    expect(rows.map((r) => r.label)).toEqual(['상품명', '소재', '사용연령'])
  })

  it('디자인 컷 소재·원산지 표(D2 아닌 잡)', () => {
    const job = (material: string) =>
      ({ analysis: {}, spec_sheet: { material, origin: '중국' }, section_plan: {} }) as unknown as PdpJobRow
    const table = (material: string) => {
      const pieces: Parameters<typeof insertLongPieces>[1] = []
      insertLongPieces(job(material), pieces, [])
      return pieces.find((p) => p.key === 'long:material')?.modules[0].data as { rows: Array<{ label: string }> } | undefined
    }
    expect(table('도자기')?.rows.map((r) => r.label)).toEqual(['소재', '원산지'])
    expect(table('항균 도자기')?.rows.map((r) => r.label)).toEqual(['원산지'])
  })

  it('카피에 넘기는 사실 줄: 규제 표현이 든 값은 넘기지 않는다(넘기면 사실로 옮겨 쓴다)', () => {
    const spec = {
      material: '항균 도자기',
      size: '10cm',
      extraSpecs: [
        { key: RISKY.label, value: RISKY.value },
        { key: '용량', value: '820ml' },
      ],
    } as unknown as PdpSpecSheet
    expect(specFactLines(spec)).toEqual(['- 크기: 10cm', '- 용량: 820ml'])
  })

  it('추가 컷 캡션: 규제 표현이 든 소재는 캡션에 붙이지 않는다', () => {
    const jobWith = (material: string) =>
      ({
        analysis: { enrichment: { version: 1, features: ['designcut', 'designcut2', 'shotdiv'] } },
        copy_sections: {
          final: {
            pointCards: ['선물', '디자인', '색감', '포장'].map((title) => ({ title, description: '' })),
            detailPoints: [],
            usageSceneTags: ['여행 가방 정리', '욕실 소품 보관'],
          },
        },
        spec_sheet: { material },
        section_plan: {},
      }) as unknown as PdpJobRow
    const caption = (material: string) => planExtraShots(jobWith(material), 4)?.shots.find((s) => s.purpose === 'texture')?.caption
    expect(caption('도자기')).toBe('가까이 본 도자기 소재')
    expect(caption('항균 도자기')).toBe('가까이 본 소재')
  })
})
