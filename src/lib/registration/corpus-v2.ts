/**
 * PDP 실측 코퍼스 스냅샷 v2 로더 — DESIGN-INTERNALIZED-TRACK-20260811 결정 T-2·부록 B.
 * Track I(internalized) 전용. Track S가 소비하는 v1(corpus.ts)과 파일 단위로 분리한다(결정 T-7 회귀 안전).
 *
 * 원천은 `corpus/v2/*.json`(scripts/registration/build-corpus-snapshot.mjs --v2 가 생성, 수동 갱신).
 * v1과 동일하게 정적 JSON import를 쓴다 — webpack/Next가 정적으로 분석 가능한 리터럴 경로만 번들에
 * 포함하므로 동적 경로 조립은 불가(corpus.ts 헤더 주석 참조). px 환산(§E-1)·모바일 하한 클램프(§E-2)는
 * 빌드 스크립트가 이미 적용한 값이 수록돼 있어 이 모듈과 소비 코드는 환산을 모른다.
 */

import fashionV2 from './corpus/v2/fashion.json'
import beautyV2 from './corpus/v2/beauty.json'
import foodV2 from './corpus/v2/food.json'
import digitalV2 from './corpus/v2/digital.json'
import householdV2 from './corpus/v2/household.json'
import commonMobileRules from './corpus/_common-mobile-rules.json'
import { formatCorpusVersion, type NexfitCategoryKey } from './corpus'

/** SECTION_ROLE_TAXONOMY v1.1 통제 어휘 16종 — 파생 데이터·골격 결정론·trust gate가 공유하는 역할 축. */
export const ROLE16 = [
  'hook',
  'problem',
  'product_intro',
  'usp_feature',
  'option_catalog',
  'how_to_guide',
  'size_spec',
  'certification_evidence',
  'social_proof',
  'shipping_cs',
  'brand_story',
  'promotion_offer',
  'target_recommendation',
  'authenticity',
  'faq',
  'legal_notice',
] as const

export type Role16 = (typeof ROLE16)[number]

export type PositionMode = 'opening' | 'early' | 'middle' | 'late' | 'closing'

export type CopyTone =
  | 'factual_catalog'
  | 'spec_proof'
  | 'evidence_certification'
  | 'hooking_problem'
  | 'balanced'

export interface SequenceRoleStatV2 {
  role: Role16
  prevalence: number
  positionMode: PositionMode
  positionDist: Record<PositionMode, number>
}

export interface DesignRecipeV2 {
  headlinePx: number
  bodyPx: number
  lineHeightRatio: number
  paddingPx: number
  elementGapPx: number
  topHexes: string[]
  topTreatments: Array<{ value: string; share: number }>
  imagesPerSection: number
  sourcePlatform: 'naver' | 'coupang'
  clampedToMobileMin?: boolean
}

export interface GapRuleV2 {
  section: Role16
  label: string
  evidencePct: number
  activateDefault: boolean
  rationale: string
}

export interface CorpusSnapshotV2 {
  category: string
  generatedAt: string
  schemaVersion: 2
  contentHash?: string
  sourceCommitSha?: string
  derivedFingerprint?: string
  source: {
    naver: { categoryDir: string; samplePages: number } | null
    coupang: { categoryDir: string; samplePages: number; smallSample?: boolean } | null
  }
  profile: {
    sectionCountMedian: number
    patternPrevalence: Record<Role16, number>
    trustStack: { required: Role16[]; recommended: Role16[] }
    copyTone: CopyTone
    hookDefault: boolean
  }
  sequenceFull: SequenceRoleStatV2[]
  designRecipes: Record<Role16, DesignRecipeV2>
  copyPatterns: {
    prevalentPatterns: Array<{ pattern: string; intro: string; occurrencePer100: number }>
  }
  gapRules: GapRuleV2[]
}

// JSON 모듈은 리터럴 유니언(PositionMode·Role16 등)으로 좁혀지지 않으므로 unknown 경유로 캐스팅한다 —
// 어휘 보장은 빌드 스크립트(--v2)의 원천 검증·게이트가 담당하고, 테스트가 스키마 불변식을 고정한다.
const SNAPSHOTS_V2: Partial<Record<NexfitCategoryKey, CorpusSnapshotV2>> = {
  fashion: fashionV2 as unknown as CorpusSnapshotV2,
  beauty: beautyV2 as unknown as CorpusSnapshotV2,
  food: foodV2 as unknown as CorpusSnapshotV2,
  digital: digitalV2 as unknown as CorpusSnapshotV2,
  household: householdV2 as unknown as CorpusSnapshotV2,
}

/**
 * 카테고리 키(NEXFIT 8종)로 v2 스냅샷을 조회한다. 미보유 카테고리(packaging·stationery·pet)는 null —
 * 호출부(Track I 골격·테마·게이트)는 null이면 Track S와 동일한 기본 동작으로 우아하게 후퇴한다.
 */
export function getCorpusSnapshotV2(categoryKey: string | undefined | null): CorpusSnapshotV2 | null {
  if (!categoryKey) return null
  const key = categoryKey.trim().toLowerCase() as NexfitCategoryKey
  return SNAPSHOTS_V2[key] ?? null
}

/** Track I 카테고리가 소비할 v2 정적 코퍼스 버전. */
export function getCorpusVersion(categoryKey: string | undefined | null): string | null {
  const snapshot = getCorpusSnapshotV2(categoryKey)
  return snapshot ? formatCorpusVersion(snapshot) : null
}

/**
 * H-2 공통 모바일 규칙 블록 — Track I 주입 블록들의 공통 머리. 원천 JSON은 v1과 동일
 * (_common-mobile-rules.json — 결정 T-2 "변경 없음"). corpus.ts의 동명 포매터는 비공개이고
 * Track S 파일은 무변경 원칙(T-7)이라 여기서 별도 유지한다.
 */
export function buildInternalizedMobileRulesBlock(): string {
  const rules = commonMobileRules.doNotRules.map((r) => `- ${r.rule}`).join('\n')
  return [
    `[모바일 판독 기준] 뷰포트 ${commonMobileRules.viewportPx}px 기준 본문 최소 ${commonMobileRules.minBodyPx}px 이상 확보.`,
    `실측 근거: ${commonMobileRules.measuredFailingSampleShare}.`,
    '하지 말 것(실측 약점 반면교사):',
    rules,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Track I 카피 주입 블록 (결정 T-2·§5 copywriting 행 — premium/Pro Stage1만 주입, 구조 보존 원칙 유지)
// ─────────────────────────────────────────────────────────────────

/** H-1 프롬프트 레벨 방어 — v1 ANTI_COPY_PREAMBLE과 동일 문구(Track S 파일 무변경 원칙으로 별도 유지). */
const ANTI_COPY_PREAMBLE_V2 =
  '아래는 시장 관행 참고 자료다. 특정 표현·문구·고유 슬로건의 재사용을 금지하며 구조와 기법만 참조하라.'

/** Track I 카피 블록 상한 — §9 리스크 표 "카피 블록만 상한 유지(6KB로 상향, 계측 후 조정)". */
const MAX_COPY_BLOCK_CHARS_V2 = 6000

/** copyTone 5종별 카피 지시 — WORK_SPEC A-1 배정 기준의 실행 지시문 번역. */
const COPY_TONE_DIRECTIVES: Record<CopyTone, string> = {
  factual_catalog:
    '[카피 톤: 사실 카탈로그형] 이 카테고리 베스트셀러는 사실 진술형 카피가 지배적이다(정품보장·제품소개 우세 실측). 스펙·구성·정품 근거를 담백하게 진술하고 감탄·과장 수식을 배제하라.',
  spec_proof:
    '[카피 톤: 스펙 증명형] 이 카테고리 베스트셀러는 기능·수치 근거 중심 카피가 지배적이다(USP 출현율 ≥ 60% 실측). 모든 주장에 구체 수치·소재·기능 근거를 붙여라 — 근거 없는 형용사만의 문장을 만들지 마라.',
  evidence_certification:
    '[카피 톤: 인증 근거형] 이 카테고리 베스트셀러는 인증·시험 근거 카피가 지배적이다(인증 출현율 ≥ 50% 실측). 입력에 있는 인증·시험 결과를 카피의 축으로 세워라 — 입력에 없는 인증을 창작하지 마라.',
  hooking_problem:
    '[카피 톤: 문제 후킹형] 이 카테고리 베스트셀러는 문제 제기·공감 카피가 유효하다(problem 출현율 ≥ 15% 실측). 타겟의 실제 불편을 구체 장면으로 제기한 뒤 해결로 연결하라.',
  balanced: '[카피 톤: 균형형] 지배적 단일 톤이 없는 카테고리다 — 사실 진술과 감성 소구를 섹션 목적에 맞게 배분하라.',
}

/** factual_catalog 카테고리 과장 표현 금지 목록 — WORK_SPEC C-1(기존 금지어 필터에 추가) 대응. */
export const FACTUAL_CATALOG_BANNED_EXPRESSIONS = [
  '최고',
  '최강',
  '최상',
  '업계 1위',
  '유일',
  '완벽',
  '기적',
  '혁명적',
  '압도적',
  '전무후무',
] as const

/**
 * Track I 카피 주입 블록 — copyTone 지시 + 패턴 전량(v1의 6개 절단 폐지) + 모바일 규칙 +
 * ANTI_COPY 프리앰블(부록 C). 원문 카피는 어떤 경로로도 실리지 않는다(H-1·불변-2).
 * v2 스냅샷이 없는 카테고리는 null — 호출부(파이프라인)가 v1 블록으로 폴백한다.
 */
export function buildInternalizedCopyBlock(categoryKey: string | undefined | null): string | null {
  const snapshot = getCorpusSnapshotV2(categoryKey)
  if (!snapshot) return null
  const parts = [ANTI_COPY_PREAMBLE_V2, buildInternalizedMobileRulesBlock()]
  parts.push(COPY_TONE_DIRECTIVES[snapshot.profile.copyTone])
  if (snapshot.profile.copyTone === 'factual_catalog') {
    parts.push(`[과장 표현 금지] 다음 표현을 카피 어디에도 쓰지 마라: ${FACTUAL_CATALOG_BANNED_EXPRESSIONS.join(', ')}`)
  }
  // 결정 T-4: authenticity(정품 보장)는 certification 섹션 변형으로 렌더된다 — 카피는 사실 진술형 강제.
  if ((snapshot.profile.patternPrevalence.authenticity ?? 0) >= 0.35) {
    parts.push(
      '[정품 보장 카피 규칙] 인증/정품 보장 섹션에 정품·공식 판매처 내용을 쓸 때는 사실 진술형으로만 쓴다 — 입력에 명시된 정품·인증 근거만 서술하고, 근거 없는 보증 문구·과장 수식을 창작하지 마라.'
    )
  }
  const patterns = snapshot.copyPatterns.prevalentPatterns
  if (patterns.length > 0) {
    const lines = patterns.map((p) => `- ${p.pattern} (100건 중 ${p.occurrencePer100}건): ${p.intro}`).join('\n')
    parts.push(`[카피 패턴 추상화 — 구조·기법만 참조, 문구 재사용 금지]\n${lines}`)
  }
  const block = parts.filter(Boolean).join('\n\n')
  return block.length > MAX_COPY_BLOCK_CHARS_V2 ? block.slice(0, MAX_COPY_BLOCK_CHARS_V2) + '\n(이하 생략)' : block
}

/**
 * Track I 이미지 주입 블록(부록 C·§5 design ②/images 행) — v1의 상위 6역할 절단 대신 designRecipes
 * 역할 전량(환산 px·hex — 빌드 시 §E-1/E-2 적용 완료 값)을 싣는다. v2 미보유 카테고리는 null —
 * 호출부(이미지 스테이지)가 v1 블록으로 폴백한다.
 */
export function buildInternalizedImageBlock(categoryKey: string | undefined | null): string | null {
  const snapshot = getCorpusSnapshotV2(categoryKey)
  if (!snapshot) return null
  const parts = [ANTI_COPY_PREAMBLE_V2, buildInternalizedMobileRulesBlock()]
  const roleLines = ROLE16.filter((role) => snapshot.designRecipes[role])
    .map((role) => {
      const r = snapshot.designRecipes[role]
      return (
        `- ${role}: 헤드라인 ${r.headlinePx}px·본문 ${r.bodyPx}px·행간 ${r.lineHeightRatio}, ` +
        `배경 ${r.topTreatments[0]?.value ?? '단색'} ${r.topHexes.slice(0, 3).join('/')}, 컷 ${r.imagesPerSection}장`
      )
    })
    .join('\n')
  parts.push(`[실측 디자인 레시피 — 역할별 중앙값(캔버스 860px 기준), 측정 hex 외 신규 색 생성 금지]\n${roleLines}`)
  return parts.filter(Boolean).join('\n\n')
}

// ─────────────────────────────────────────────────────────────────
// v2가 없는 카테고리(stationery·packaging·pet 등)의 Track I 블록 — ENRICHMENT 잡만(설계 §4.2 v2 없는 카테고리).
// 카테고리 실측 레시피가 없으므로 범용 근거(pooled)임을 밝히고, 공통 규칙(유사도 방어·모바일 판독)만 준다.
// ─────────────────────────────────────────────────────────────────

const POOLED_EVIDENCE_NOTE =
  '[범용 근거] 이 카테고리는 카테고리별 실측 레시피가 없어 쿠팡·네이버 상세페이지 전체 실측 분포(pooled)를 구조 근거로 쓴다. ' +
  '카테고리 고유 관행을 단정하지 말고 입력 스펙에 있는 사실만 쓴다.'

/** Track I 카피 블록(pooled) — copyTone 지시·패턴 목록 없이 공통 규칙과 범용 근거 표시만. */
export function buildPooledInternalizedCopyBlock(): string {
  return [ANTI_COPY_PREAMBLE_V2, buildInternalizedMobileRulesBlock(), POOLED_EVIDENCE_NOTE].join('\n\n')
}

/** Track I 이미지 블록(pooled) — 역할별 레시피(px·hex)가 없으므로 공통 규칙만. 컷별 연출 지시는 T3(E-4)가 더한다. */
export function buildPooledInternalizedImageBlock(): string {
  return [ANTI_COPY_PREAMBLE_V2, buildInternalizedMobileRulesBlock()].join('\n\n')
}
