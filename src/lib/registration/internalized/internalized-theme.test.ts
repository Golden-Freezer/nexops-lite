/**
 * 내재화 테마(결정 T-5) 단위 테스트 — 역할→섹션 타입 변환·클램프 값 보존·배경 hex 선택(§E-3)·
 * compose 주입(final_html 파서 검증 — I-4 게이트의 정적 부분)을 고정한다.
 */

import { describe, it, expect } from 'vitest'
import { buildInternalizedTheme, pickBackgroundHex } from './internalized-theme'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { composePdp } from '../pdp-composer'

const snapshot = getCorpusSnapshotV2('household')!

describe('buildInternalizedTheme — 역할 레시피 → 섹션 타입 기본값', () => {
  const theme = buildInternalizedTheme(snapshot, { bgMain: '#FFF8F0', bgSub: '#FFE8F0' })

  it('역할 매핑 섹션에 테마가 생기고, 매핑 없는 타입(cta·divider)은 키가 없다(기본값 유지)', () => {
    for (const type of ['hook_3step', 'main_cut', 'point_div', 'spec_table', 'solution_guide', 'concept_desc']) {
      expect(theme[type], type).toBeDefined()
    }
    expect(theme['cta']).toBeUndefined()
    expect(theme['divider']).toBeUndefined()
  })

  it('클램프 완료 값이 그대로 보존된다 — 헤드라인≥46·본문≥37(편안 기준 16px)·행간≥1.1(§E-2)', () => {
    for (const t of Object.values(theme)) {
      expect(t.headlinePx).toBeGreaterThanOrEqual(46)
      expect(t.bodyPx).toBeGreaterThanOrEqual(37)
      expect(t.lineHeightRatio).toBeGreaterThanOrEqual(1.1)
      expect(t.paddingPx).toBeGreaterThan(0)
      expect(t.backgroundHex).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('certification은 certification_evidence 레시피가 이긴다(역할 dedupe — T-4 동일 의미론)', () => {
    const cert = snapshot.designRecipes.certification_evidence
    expect(theme['certification'].headlinePx).toBe(cert.headlinePx)
    expect(theme['certification'].bodyPx).toBe(cert.bodyPx)
  })
})

describe('pickBackgroundHex — §E-3 (측정값만·palette ΔE 최소·없으면 1위)', () => {
  it('palette 밝은 배경이면 후보 중 밝은 색을 고른다', () => {
    expect(pickBackgroundHex(['#000000', '#FFFFFF'], { bgMain: '#FFF8F0' })).toBe('#FFFFFF')
  })

  it('palette 어두운 배경이면 어두운 후보를 고른다', () => {
    expect(pickBackgroundHex(['#FFFFFF', '#111111'], { bgMain: '#000000' })).toBe('#111111')
  })

  it('palette 없으면 후보 1위(실측 최다) — 새 색 생성 금지', () => {
    expect(pickBackgroundHex(['#F5F5F5', '#FFFFFF'], null)).toBe('#F5F5F5')
  })

  it('비정상 후보는 걸러지고, 후보가 전부 무효면 흰색 폴백', () => {
    expect(pickBackgroundHex(['잘못된값', '#ABCDEF'], null)).toBe('#ABCDEF')
    expect(pickBackgroundHex([], null)).toBe('#FFFFFF')
  })
})

describe('compose 테마 주입 — final_html 파서 검증(I-4 게이트 정적 부분)', () => {
  const baseInput = {
    mode: 'pro' as const,
    copy: { closingCta: { headline: '지금 준비하세요', subtext: '만 14세 이상 사용 가능 제품' } },
    images: {},
    sectionPlan: { section_order: ['cta'] },
    strategyContract: {},
    specSheet: { productName: '테스트 상품' },
  }
  const ctaTheme = {
    cta: { headlinePx: 46, bodyPx: 33, lineHeightRatio: 1.1, paddingPx: 63, gapPx: 38, backgroundHex: '#F5F5F5' },
  }

  it('테마 전달 시 섹션 인라인 스타일에 실측 px·행간·패딩·배경 hex가 그대로 박힌다', () => {
    const { finalHtml } = composePdp({ ...baseInput, themeStyles: ctaTheme })
    expect(finalHtml).toContain('font-size:46px')
    expect(finalHtml).toContain('font-size:33px')
    expect(finalHtml).toContain('line-height:1.1')
    expect(finalHtml).toContain('padding:63px 32px')
    expect(finalHtml).toContain('background:#F5F5F5')
  })

  it('테마 미전달(Track S)은 designTokens 하한(h2 60·body 45) 기반 캔버스 충실 렌더다', () => {
    const { finalHtml } = composePdp(baseInput)
    expect(finalHtml).toContain('font-size:60px')
    expect(finalHtml).toContain('font-size:45px')
    expect(finalHtml).toContain('padding:40px 32px')
    expect(finalHtml).not.toContain('background:#F5F5F5')
  })

  it('양 트랙 모두 캔버스 860 고정 + viewport meta — 스케일 충실성(모바일 배율 = 실기기와 동일)', () => {
    for (const input of [baseInput, { ...baseInput, themeStyles: ctaTheme }]) {
      const { finalHtml } = composePdp(input)
      expect(finalHtml).toContain('width:860px')
      expect(finalHtml).toContain('name="viewport" content="width=860"')
    }
  })
})
