/**
 * PDP 실측 코퍼스 조회·주입 블록 빌더 — 설계문서 DESIGN-NEXFIT-GENERATORS-20260809 §2 결정 H·H-1·H-2.
 * 원천 스냅샷은 `corpus/*.json`(scripts/registration/build-corpus-snapshot.mjs가 생성, 수동 갱신)이다.
 *
 * 정적 JSON import(런타임 fs 없음)를 쓴다 — 결정 A "단독 완결"과 §5 "corpus/*.json은 커밋되는 정적
 * 스냅샷"을 만족하려면 카테고리 문자열로 동적 경로를 조립하는 `import(`./corpus/${key}.json`)`은 쓸 수
 * 없다(webpack/Next가 정적으로 분석 가능한 리터럴 경로만 번들에 포함한다) — 그래서 8개 카테고리를
 * 전부 리터럴로 import하고 레지스트리 객체에 담는다. tsconfig의 resolveJsonModule이 이미 켜져 있어
 * 추가 로더 설정이 필요 없다(대안이었던 명시적 런타임 레지스트리 fetch는 서버/클라이언트 양쪽에서
 * 불필요한 I/O를 만들어 기각).
 *
 * 유사도 게이트 전용 코퍼스는 비가역 음절 3-gram 해시만 저장하며 similarity-gate.ts가 리터럴 경로로
 * 정적 import한다. 원문은 어떤 런타임·빌드 산출물에도 포함하지 않는다(H-1 소스 레벨 방어).
 */

import fashionSnapshot from './corpus/fashion.json'
import beautySnapshot from './corpus/beauty.json'
import foodSnapshot from './corpus/food.json'
import digitalSnapshot from './corpus/digital.json'
import householdSnapshot from './corpus/household.json'
import commonMobileRules from './corpus/_common-mobile-rules.json'

// NEXFIT 8종 카테고리 id(pdp-strategy-contract.ts의 CATEGORY_TO_ESSENCE 키와 동일 어휘).
// packaging·stationery·pet은 코퍼스 9종 어디에도 대응 카테고리가 없어 스냅샷이 없다(빌드 스크립트
// 헤더 주석 참조) — SNAPSHOTS에서 빠지므로 getCorpusSnapshot이 자동으로 null을 반환한다.
export type NexfitCategoryKey = 'fashion' | 'beauty' | 'food' | 'digital' | 'household' | 'packaging' | 'stationery' | 'pet'

interface SectionRoleStat {
  role: string
  prevalence: number
  positionMode: string
}

interface CopyPatternStat {
  pattern: string
  intro: string
  occurrencePer100: number
}

interface ImageDirectionRole {
  role: string
  koreanLabel: string
  headlinePxMedian: number
  bodyPxMedian: number
  paddingPxMedian: number
  topHexes: string[]
  topTreatments: string[]
}

interface GapRule {
  section: string
  label: string
  evidencePct: number
  activateDefault: boolean
  rationale: string
}

export interface CorpusSnapshot {
  category: string
  generatedAt: string
  schemaVersion?: number | string
  contentHash?: string
  sourceCommitSha?: string
  derivedFingerprint?: string
  sourceCategories: { naver: string; coupang: string | null }
  sectionDesign: { source: string; sectionCountMedian: number | null; sequence: SectionRoleStat[] }
  copyPatterns: {
    dominantAxes: string
    reviewCountMedian: number | null
    sectionCountMedian: number | null
    prevalentPatterns: CopyPatternStat[]
  }
  imageDirection: { source: string; roles: ImageDirectionRole[] }
  gapRules: GapRule[]
}

const SNAPSHOTS: Partial<Record<NexfitCategoryKey, CorpusSnapshot>> = {
  fashion: fashionSnapshot as CorpusSnapshot,
  beauty: beautySnapshot as CorpusSnapshot,
  food: foodSnapshot as CorpusSnapshot,
  digital: digitalSnapshot as CorpusSnapshot,
  household: householdSnapshot as CorpusSnapshot,
}

/** 결정 H-1 프롬프트 레벨 방어 — 모든 그라운딩 블록 머리에 고정 삽입. */
const ANTI_COPY_PREAMBLE =
  '아래는 시장 관행 참고 자료다. 특정 표현·문구·고유 슬로건의 재사용을 금지하며 구조와 기법만 참조하라.'

/** 단계당 주입 블록 상한(§2 결정 H "단계당 2~4KB") — 스냅샷이 예상보다 커져도 프롬프트 폭주를 막는 방어선. */
const MAX_BLOCK_CHARS = 4000

function clampBlock(text: string): string {
  return text.length > MAX_BLOCK_CHARS ? text.slice(0, MAX_BLOCK_CHARS) + '\n(이하 생략)' : text
}

/**
 * 카테고리 키(NEXFIT 8종)로 스냅샷을 조회한다. 미수집 카테고리(packaging·stationery·pet,
 * 10_여가생활편의 등 표본 0건)는 null — 호출부는 조용히 그라운딩 없이 진행한다(결정 H "우아한 생략").
 */
export function getCorpusSnapshot(categoryKey: string | undefined | null): CorpusSnapshot | null {
  if (!categoryKey) return null
  const key = categoryKey.trim().toLowerCase() as NexfitCategoryKey
  return SNAPSHOTS[key] ?? null
}

export interface CorpusVersionFields {
  generatedAt: string
  schemaVersion?: number | string
  contentHash?: string
}

export function formatCorpusVersion(snapshot: CorpusVersionFields): string {
  const schemaVersion = snapshot.schemaVersion ?? 'v1'
  return `${schemaVersion}:${snapshot.generatedAt}:${snapshot.contentHash || 'legacy'}`
}

/** 현재 카테고리가 소비할 정적 코퍼스의 재현 가능한 버전 문자열. */
export function getCorpusVersion(categoryKey: string | undefined | null): string | null {
  const snapshot = getCorpusSnapshot(categoryKey)
  return snapshot ? formatCorpusVersion(snapshot) : null
}

/**
 * H-2 공통 모바일 규칙 — 카테고리 무관, 항상 존재. 스냅샷 부재 카테고리에서도 이 블록은 반환되어야
 * 하므로(결정 H-2 "카테고리 패턴보다 상위 우선") build*GroundingBlock들이 항상 먼저 이 텍스트를 붙인다.
 */
function formatMobileRulesBlock(): string {
  const rules = commonMobileRules.doNotRules.map((r) => `- ${r.rule}`).join('\n')
  return [
    `[모바일 판독 기준] 뷰포트 ${commonMobileRules.viewportPx}px 기준 본문 최소 ${commonMobileRules.minBodyPx}px 이상 확보.`,
    `실측 근거: ${commonMobileRules.measuredFailingSampleShare}.`,
    '하지 말 것(실측 약점 반면교사):',
    rules,
  ].join('\n')
}

function formatGapRulesBlock(rules: GapRule[]): string {
  if (rules.length === 0) return ''
  const lines = rules
    .filter((r) => r.activateDefault)
    .map((r) => `- ${r.label}(${r.section}): 카테고리 실측 ${r.evidencePct}% 출현 — spec_sheet에 근거 있으면 기본 포함, 없으면 스킵.`)
  return lines.length ? `[격차 보완 섹션 기본 규칙]\n${lines.join('\n')}` : ''
}

/** 3단계(디자인) 주입 — 결정 H 주입 지점 ①(섹션 시퀀스 prior) + ④(격차 4종). */
export function buildDesignGroundingBlock(categoryKey: string | undefined | null): string {
  const parts = [ANTI_COPY_PREAMBLE, formatMobileRulesBlock()]
  const snapshot = getCorpusSnapshot(categoryKey)
  if (snapshot) {
    const seq = snapshot.sectionDesign.sequence
      .slice(0, 10)
      .map((s) => `${s.role}(출현 ${(s.prevalence * 100).toFixed(0)}%, 주 위치 ${s.positionMode})`)
      .join(', ')
    if (seq) {
      parts.push(
        `[섹션 시퀀스 실측 prior — ${snapshot.sourceCategories.coupang ?? snapshot.sourceCategories.naver}]\n${seq}`
      )
    }
    const gapBlock = formatGapRulesBlock(snapshot.gapRules)
    if (gapBlock) parts.push(gapBlock)
  }
  return clampBlock(parts.filter(Boolean).join('\n\n'))
}

/**
 * 4단계(카피) 주입 — 결정 H 주입 지점 ②(카피 패턴 추상화, 원문 없음). 호출부 책임(§7 5단계):
 * Pro 3-Stage에서는 Stage 1(설득 골격)에만 이 블록을 append하고 Stage 2·3에는 주입하지 않는다
 * (구조 보존 원칙 — pdp-copy-prompts.ts 주석과 동일 규칙).
 */
export function buildCopyGroundingBlock(categoryKey: string | undefined | null): string {
  const parts = [ANTI_COPY_PREAMBLE, formatMobileRulesBlock()]
  const snapshot = getCorpusSnapshot(categoryKey)
  if (snapshot) {
    const { dominantAxes, prevalentPatterns } = snapshot.copyPatterns
    if (dominantAxes) parts.push(`[카테고리 지배적 설득 축] ${dominantAxes}`)
    if (prevalentPatterns.length) {
      const patternLines = prevalentPatterns
        .slice(0, 6)
        .map((p) => `- ${p.pattern} (100건 중 ${p.occurrencePer100}건): ${p.intro}`)
        .join('\n')
      parts.push(`[카피 패턴 추상화 — 구조·기법만 참조, 문구 재사용 금지]\n${patternLines}`)
    }
  }
  return clampBlock(parts.filter(Boolean).join('\n\n'))
}

/** 5단계(이미지) 주입 — 결정 H 주입 지점 ③(카테고리 집계 연출 패턴). 개별 상품 스펙 직주입 금지. */
export function buildImageGroundingBlock(categoryKey: string | undefined | null): string {
  const parts = [ANTI_COPY_PREAMBLE, formatMobileRulesBlock()]
  const snapshot = getCorpusSnapshot(categoryKey)
  if (snapshot && snapshot.imageDirection.roles.length) {
    const roleLines = snapshot.imageDirection.roles
      .map(
        (r) =>
          `- ${r.koreanLabel}(${r.role}): 헤드라인 ${r.headlinePxMedian}px·본문 ${r.bodyPxMedian}px, 배경 ${r.topTreatments[0] ?? '단색'} ${r.topHexes.slice(0, 3).join('/')}`
      )
      .join('\n')
    parts.push(`[카테고리 집계 연출 패턴 — ${snapshot.imageDirection.source}]\n${roleLines}`)
  }
  return clampBlock(parts.filter(Boolean).join('\n\n'))
}
