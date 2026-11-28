/**
 * Trust gate(결정 T-6) + Track I 카피 블록(§5 copywriting 행) 단위 테스트 — I-3 게이트.
 * trust-gate 3케이스(충족/미충족/카테고리 미지원)와 카피 블록의 톤 지시·패턴 전량·상한·H-1 계약을 고정한다.
 */

import { describe, it, expect } from 'vitest'
import {
  attachQualityReport,
  buildEnrichedQualityReport,
  buildQualityReport,
  buildVocabTrustStack,
  evaluateTrustStack,
  runTrustGate,
} from './trust-gate'
import { ROLE_TO_SECTIONS, ROLE_TO_SECTIONS_ENRICHED } from './role-section-map'
import { getDesignVocab, lookupVocabCell } from '../design-vocab'
import { buildSkeleton } from './pdp-internalized-skeleton'
import {
  buildInternalizedCopyBlock,
  buildPooledInternalizedCopyBlock,
  buildPooledInternalizedImageBlock,
  getCorpusSnapshotV2,
  FACTUAL_CATALOG_BANNED_EXPRESSIONS,
} from '../corpus-v2'
import type { PdpSpecSheet } from '../pdp-state'

function fullSpec(): PdpSpecSheet {
  return {
    productName: '테스트 상품',
    size: '가로 30cm x 세로 20cm',
    certificationInfo: 'KC 인증 취득',
    eventBannerInfo: '런칭 기념 10% 할인',
    colorOptions: ['블랙', '화이트', '네이비', '베이지'],
    reviewsText: '좋아요',
  }
}

describe('runTrustGate — 3케이스(충족/미충족/카테고리 미지원)', () => {
  it('케이스 1 충족: 완전 입력 잡의 골격은 생성 가능한 필수 역할을 전부 채워 pass한다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const skeleton = buildSkeleton({ snapshot, specSheet: fullSpec(), strategyContract: {} })
    const result = runTrustGate(skeleton.activatedSections.map(String), snapshot)
    expect(result.pass).toBe(true)
    // 플랫폼 영역(shipping_cs 등)은 pass 판정에서 제외되지만 누락 목록·힌트에는 남는다
    for (const missing of result.missingRequired) {
      expect(['shipping_cs', 'legal_notice']).toContain(missing)
    }
  })

  it('케이스 2 미충족: 최소 골격(main_cut·cta뿐)은 필수 역할 누락으로 fail하고 행동 힌트를 낸다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const result = runTrustGate(['main_cut', 'cta'], snapshot)
    expect(result.pass).toBe(false)
    // fashion naver 필수 스택: how_to_guide·option_catalog·product_intro·promotion_offer·shipping_cs·size_spec·usp_feature
    expect(result.missingRequired).toContain('size_spec')
    expect(result.missingRequired).toContain('option_catalog')
    expect(result.userActionHints.some((h) => h.includes('치수표'))).toBe(true)
    expect(result.userActionHints.some((h) => h.includes('옵션'))).toBe(true)
  })

  it('케이스 3 카테고리 미지원: v2 스냅샷이 없으면 게이트 자체가 실행 대상이 아니다(파이프라인 폴백 계약)', () => {
    // 미지원 카테고리는 getCorpusSnapshotV2가 null — 파이프라인은 게이트를 건너뛴다(quality_report 미기록)
    expect(getCorpusSnapshotV2('packaging')).toBeNull()
    expect(getCorpusSnapshotV2('stationery')).toBeNull()
  })

  it('플랫폼 영역 역할(shipping_cs·legal_notice)만 누락이면 pass — 생성으로 채울 수 없는 축은 차단 사유가 아니다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const skeleton = buildSkeleton({ snapshot, specSheet: fullSpec(), strategyContract: {} })
    const result = runTrustGate(skeleton.activatedSections.map(String), snapshot)
    expect(result.pass).toBe(true)
    if (result.missingRequired.includes('shipping_cs')) {
      expect(result.userActionHints.some((h) => h.includes('플랫폼 영역'))).toBe(true)
    }
  })

  it('authenticity는 certification 변형(dedupe)으로도 충족 판정된다', () => {
    const snapshot = getCorpusSnapshotV2('digital')! // digital 필수 스택에 authenticity 포함(0.929)
    const result = runTrustGate(['main_cut', 'certification', 'cta'], snapshot)
    expect(result.missingRequired).not.toContain('authenticity')
    expect(result.missingRequired).not.toContain('certification_evidence')
  })

  it('거짓 pass 회귀(verifier 적발): 인증 근거 없는 digital 잡은 골격에서 certification이 빠지고 게이트가 누락·힌트를 낸다', () => {
    const snapshot = getCorpusSnapshotV2('digital')!
    const skeleton = buildSkeleton({
      snapshot,
      specSheet: { ...fullSpec(), certificationInfo: undefined },
      strategyContract: {},
    })
    // 골격·산출 어디에도 certification이 없으므로 게이트는 이제 누락을 정직하게 보고해야 한다
    expect(skeleton.activatedSections.map(String)).not.toContain('certification')
    const result = runTrustGate(skeleton.activatedSections.map(String), snapshot)
    expect(result.pass).toBe(false)
    expect(result.missingRequired).toContain('authenticity')
    expect(result.missingRequired).toContain('certification_evidence')
    expect(result.userActionHints.some((h) => h.includes('인증'))).toBe(true)
  })
})

describe('quality_report 조립·부착(부록 F-2) — compose 후처리의 순수 함수 계약', () => {
  it('buildQualityReport는 trust gate 결과와 골격 제외 근거를 스키마대로 담는다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const report = buildQualityReport(
      {
        activated_sections: ['main_cut', 'cta'],
        internalized_skeleton: { roles: [], excluded: [{ role: 'size_spec', reason: '치수 없음' }] },
      },
      snapshot
    )
    expect(report.trust_gate.pass).toBe(false)
    expect(report.trust_gate.missing_required.length).toBeGreaterThan(0)
    expect(report.skeleton_excluded).toEqual([{ role: 'size_spec', reason: '치수 없음' }])
  })

  it('attachQualityReport는 기존 copy_sections 필드(final·stage1·stage2·similarity_warnings)를 훼손하지 않는다', () => {
    const snapshot = getCorpusSnapshotV2('fashion')!
    const report = buildQualityReport({ activated_sections: ['main_cut', 'cta'] }, snapshot)
    const existing = {
      final: { title: '완성 카피' },
      stage1: { title: '스테이지1' },
      stage2: { title: '스테이지2' },
      stage3_changed_ratio: 0.3,
      similarity_warnings: [{ section: 'main_cut', score: 0.9 }],
    }
    const attached = attachQualityReport(existing, report)
    expect(attached.final).toEqual(existing.final)
    expect(attached.stage1).toEqual(existing.stage1)
    expect(attached.stage2).toEqual(existing.stage2)
    expect(attached.stage3_changed_ratio).toBe(0.3)
    expect(attached.similarity_warnings).toEqual(existing.similarity_warnings)
    expect(attached.quality_report).toEqual(report)
  })
})

describe('buildInternalizedCopyBlock — Track I 카피 주입 계약', () => {
  it('copyTone 지시가 카테고리 파생값대로 실린다 (digital=factual_catalog → 과장 금지 목록 포함)', () => {
    const block = buildInternalizedCopyBlock('digital')!
    expect(block).toContain('사실 카탈로그형')
    for (const banned of FACTUAL_CATALOG_BANNED_EXPRESSIONS.slice(0, 3)) {
      expect(block).toContain(banned)
    }
  })

  it('spec_proof 카테고리(fashion)는 스펙 증명 지시가 실리고 과장 금지 목록은 없다', () => {
    const block = buildInternalizedCopyBlock('fashion')!
    expect(block).toContain('스펙 증명형')
    expect(block).not.toContain('과장 표현 금지')
  })

  it('패턴이 v1 상한(6개)을 넘어 전량 실린다 — 절단 폐지(결정 T-2)', () => {
    const block = buildInternalizedCopyBlock('fashion')!
    const patternLines = block.split('\n').filter((l) => /^- .+ \(100건 중 \d+건\)/.test(l))
    expect(patternLines.length).toBeGreaterThan(6)
  })

  it('H-1 계약: ANTI_COPY 프리앰블로 시작하고 원문 인용(긴 따옴표 문자열)이 없다', () => {
    const block = buildInternalizedCopyBlock('beauty')!
    expect(block.startsWith('아래는 시장 관행 참고 자료다')).toBe(true)
    expect(block).not.toMatch(/"[^"]{15,}"/)
  })

  it('모바일 규칙(H-2)이 항상 포함되고 블록은 6KB 상한 안이다', () => {
    for (const key of ['fashion', 'beauty', 'food', 'digital', 'household']) {
      const block = buildInternalizedCopyBlock(key)!
      expect(block).toContain('모바일')
      expect(block.length).toBeLessThanOrEqual(6000 + 20)
    }
  })

  it('v2 미보유 카테고리는 null — 파이프라인이 v1 블록으로 폴백한다', () => {
    expect(buildInternalizedCopyBlock('packaging')).toBeNull()
    expect(buildInternalizedCopyBlock(undefined)).toBeNull()
  })
})

describe('ENRICHMENT trust gate — pooled trustStack·정정 매핑·보고서 필드', () => {
  it('vocab 셀 출현율로 v2와 같은 임계(0.50/0.35)의 trustStack을 만든다', () => {
    const cell = { pages: 10, sectionCountMedian: 10, roles: { usp_feature: { prevalence: 0.9 }, hook: { prevalence: 0.4 }, faq: { prevalence: 0.2 } } }
    expect(buildVocabTrustStack(cell as never)).toEqual({ required: ['usp_feature'], recommended: ['hook'] })
    const pooled = lookupVocabCell('stationery', getDesignVocab())!
    const stack = buildVocabTrustStack(pooled.cell)
    expect(stack.required).toContain('usp_feature')
    expect(stack.required.every((r) => !stack.recommended.includes(r))).toBe(true)
  })

  it('정정 매핑에서 how_to_guide는 hidden_page로 충족된다(기존 매핑은 solution_guide)', () => {
    const stack = { required: ['how_to_guide' as const], recommended: [] }
    expect(evaluateTrustStack(['hidden_page'], stack, ROLE_TO_SECTIONS_ENRICHED).missingRequired).toEqual([])
    expect(evaluateTrustStack(['hidden_page'], stack, ROLE_TO_SECTIONS).missingRequired).toEqual(['how_to_guide'])
  })

  it('보고서에 기존 trust_gate 형태 + 설득 근거(미응답 고민)·근거 수준을 남긴다', () => {
    const report = buildEnrichedQualityReport({
      sectionPlan: {
        activated_sections: ['main_cut', 'point_div', 'cta'],
        internalized_skeleton: {
          roles: [],
          excluded: [{ role: 'faq', reason: 'FAQ 렌더러 없음' }],
          persuasion: {
            grammar: 'G4',
            lengthTarget: [7, 10],
            stages: [],
            objectionCoverage: [
              { objection: '실내에서 써도 될까', type: 'environment_versatility', answeredBy: 'point_list_div' },
              { objection: '환경 우려', type: 'material_eco', answeredBy: null, note: '친환경 주장 금지' },
            ],
            layouts: [],
            rules: [{ id: 'R1', pass: true }],
            priorSource: 'coupang:pooled',
            vocabHash: 'abc',
          },
        },
      },
      trustStack: { required: ['usp_feature', 'social_proof'], recommended: [] },
      evidenceLevel: { level: 'pooled', priorSource: 'coupang:pooled', note: '범용 근거' },
    })
    expect(report.trust_gate.missing_required).toEqual(['social_proof'])
    expect(report.skeleton_excluded).toEqual([{ role: 'faq', reason: 'FAQ 렌더러 없음' }])
    expect(report.persuasion).toEqual({
      grammar: 'G4',
      rules: [{ id: 'R1', pass: true }],
      unanswered: [{ objection: '환경 우려', type: 'material_eco', note: '친환경 주장 금지' }],
    })
    expect(report.evidenceLevel?.level).toBe('pooled')
  })

  it('pooled 카피·이미지 블록은 범용 근거와 공통 규칙만 담는다(v2 레시피 수치 없음)', () => {
    const copy = buildPooledInternalizedCopyBlock()
    expect(copy).toContain('범용 근거')
    expect(copy).toContain('재사용을 금지')
    const image = buildPooledInternalizedImageBlock()
    expect(image).toContain('[모바일 판독 기준]')
    expect(image).not.toContain('실측 디자인 레시피')
    expect(image).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})

describe('ENRICHMENT trust gate — 렌더러 없는 역할(faq)', () => {
  it('정정 매핑에서 faq는 생성 대상이 아니라 pass를 막지 않고 전용 힌트로 안내한다', () => {
    const stack = { required: ['faq' as const, 'usp_feature' as const], recommended: [] }
    const gate = evaluateTrustStack(['point_div'], stack, ROLE_TO_SECTIONS_ENRICHED)
    expect(gate.missingRequired).toEqual(['faq'])
    expect(gate.pass).toBe(true)
    const report = buildEnrichedQualityReport({
      sectionPlan: { activated_sections: ['point_div'] },
      trustStack: stack,
      evidenceLevel: { level: 'v2', priorSource: 'v2:digital', note: 'v2' },
    })
    expect(report.trust_gate.pass).toBe(true)
    expect(report.trust_gate.user_action_hints.some((h) => h.includes('FAQ'))).toBe(true)
  })

  it('기존 매핑에서 faq(hidden_page)는 지금처럼 누락이면 pass를 막는다', () => {
    const gate = evaluateTrustStack(['point_div'], { required: ['faq'], recommended: [] }, ROLE_TO_SECTIONS)
    expect(gate.pass).toBe(false)
  })
})
