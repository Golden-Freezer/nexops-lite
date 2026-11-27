/**
 * PDP 카피라이팅 순수 후처리 규칙(pointCards 판정·Stage 3 무결성·V4.3 파생 필드) — NEXFIT
 * agents/copywriting_agent.py run()(:1213-1699)의 LLM 호출 없는 부분 이식. SSOT: PROMPT-INVENTORY.md §4.3.
 * 금지 표현 정화·empathyLines 검증은 pdp-copy-sanitize.ts로 분리(500줄 초과 방지).
 * AI 호출(pdp-copy-agent.ts)이 이 파일의 함수들을 순서대로 적용한다 — 이 파일 자체는 어떤 모델도
 * 호출하지 않는다(CLAUDE.md "AI 호출 로직과 순수 비즈니스 로직 분리" 원칙).
 */

import type { CopywritingResult, DetailSection, StrategyContract } from './pdp-state'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// pointCards 검증·폴백 — copywriting_agent.py:807-846, 1359-1402
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const POINTCARD_PLACEHOLDER_RE = /^(포인트|Point)\s*\d+$/i
const POINTCARD_KNOWN_DEFAULT_DESCS = new Set([
  '주요 특징을 확인하세요', '놀라운 기능을 경험하세요', '최고의 선택이 될 거예요', '더 편리한 일상을 만나보세요',
])

export interface PointCard {
  title: string
  description: string
}

function isPlaceholderPointCard(title: string, description: string): boolean {
  return POINTCARD_PLACEHOLDER_RE.test(title.trim()) || POINTCARD_KNOWN_DEFAULT_DESCS.has(description.trim())
}

/**
 * pointCards 원소에서 플레이스홀더·기존 제목 중복을 걸러낸다. 초회 검증과 LLM 재생성 응답
 * 검증(excludeTitles로 기존 카드 제목 전달) 양쪽에 재사용된다 — copywriting_agent.py:882-898.
 */
export function filterValidPointCards(cards: unknown, excludeTitles: string[] = []): PointCard[] {
  if (!Array.isArray(cards)) return []
  const out: PointCard[] = []
  for (const c of cards) {
    if (!isPlainObject(c)) continue
    const title = String(c.title ?? '')
    const description = String(c.description ?? '')
    if (isPlaceholderPointCard(title, description)) continue
    if (excludeTitles.includes(title.trim())) continue
    out.push({ title, description })
  }
  return out
}

export interface PointCardValidation {
  cards: PointCard[]
  /** 4개 미달분 — 0이면 LLM 재생성·로컬 폴백 불필요 */
  deficit: number
}

/** pointCards 판정만 수행(로컬 필터) — LLM 재생성 콜은 에이전트(pdp-copy-agent.ts) 소관 */
export function validatePointCards(cards: unknown, targetCount = 4): PointCardValidation {
  const valid = filterValidPointCards(cards)
  return { cards: valid, deficit: Math.max(0, targetCount - valid.length) }
}

/** 제품 데이터 기반 동적 pointCard 로컬 폴백 — copywriting_agent.py:807-846 1:1 */
export function generateFallbackPointcards(
  productName: string,
  features: unknown[],
  category: string,
  count: number,
): PointCard[] {
  const keywords: string[] = []
  for (const f of features) {
    if (typeof f === 'string' && f.length > 0) keywords.push(f.slice(0, 10))
  }
  if (category) keywords.push(category.slice(0, 10))

  const patterns: PointCard[] = [
    { title: `${productName.slice(0, 7)} 핵심 효과`, description: `${productName}만의 특별한 차이를 경험하세요` },
    { title: '간편한 사용법', description: '누구나 쉽게 사용할 수 있는\n직관적인 디자인' },
    { title: '검증된 품질', description: '까다로운 테스트를 통과한\n믿을 수 있는 품질' },
    { title: '높은 만족도', description: '사용자 10명 중 9명이\n재구매를 선택합니다' },
    { title: '프리미엄 소재', description: '엄선된 원재료로 만든\n차원이 다른 완성도' },
    { title: '빠른 체감 효과', description: '사용 직후부터 느껴지는\n확실한 변화' },
  ]

  const result: PointCard[] = keywords.slice(0, count).map((kw) => ({ title: kw, description: `${kw}의 효과를 직접 확인하세요` }))
  for (const p of patterns) {
    if (result.length >= count) break
    if (!result.some((r) => r.title === p.title)) result.push(p)
  }
  return result.slice(0, count)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stage 3 필드 무결성 강제 — copywriting_agent.py:1154-1189 1:1
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Stage3IntegrityResult {
  result: CopywritingResult
  driftRestoredFields: string[]
  /** changedTop.size / totalFields — CopySectionsPayload.stage3_changed_ratio 그대로 저장.
   *  > 0.6이면 전면 재작성 의심(원본은 로그만 남김, 이식판은 호출부가 warnings로 표면화) */
  changedRatio: number
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Stage 3의 `_changed_fields` 신고를 이용한 전면 재출력 드리프트 감지·복원.
 * 신고되지 않은 최상위 필드가 Stage 2(enhanced)와 다르면 드리프트로 판단해 Stage 2 값을 복원한다.
 * `_changed_fields`는 반환 전 제거한다.
 */
export function enforceStage3FieldIntegrity(enhanced: CopywritingResult, final: unknown): Stage3IntegrityResult {
  if (!isPlainObject(final)) {
    return { result: enhanced, driftRestoredFields: [], changedRatio: 0 }
  }
  const finalObj: Record<string, unknown> = { ...final }
  const changedFieldsRaw = finalObj._changed_fields
  delete finalObj._changed_fields

  const enhancedRecord = enhanced as unknown as Record<string, unknown>
  if (!isPlainObject(enhanced)) {
    return { result: finalObj as CopywritingResult, driftRestoredFields: [], changedRatio: 0 }
  }
  if (!Array.isArray(changedFieldsRaw)) {
    // 미신고 — 드리프트 감지 불가, 결과 그대로 사용(원본 :1168 경고 로그와 동일 취급)
    return { result: finalObj as CopywritingResult, driftRestoredFields: [], changedRatio: 0 }
  }

  const changedTop = new Set(changedFieldsRaw.map((p) => String(p).split('.')[0].split('[')[0]))
  const driftRestored: string[] = []
  for (const key of Object.keys(enhancedRecord)) {
    if (changedTop.has(key) || !(key in finalObj)) continue
    if (!jsonEqual(finalObj[key], enhancedRecord[key])) {
      finalObj[key] = enhancedRecord[key]
      driftRestored.push(key)
    }
  }
  const totalFields = Object.keys(enhancedRecord).length || 1
  const changedRatio = changedTop.size / totalFields

  return { result: finalObj as CopywritingResult, driftRestoredFields: driftRestored, changedRatio }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 하위호환 섹션 + V4.3 파생 필드 — copywriting_agent.py:608-689, 1576-1675
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 신규 구조 → 기존 7-섹션 구조 변환(하위호환) — copywriting_agent.py:608-689 1:1 */
export function buildLegacySections(copy: CopywritingResult): DetailSection[] {
  const mainIntro = copy.mainIntro ?? {}
  const problem = copy.problem ?? {}
  const solution = copy.solution ?? {}
  const pointCards = copy.pointCards ?? []
  const howTo = copy.howTo ?? []
  const closingCta = copy.closingCta ?? {}
  const targets = copy.recommendedTargets ?? []

  const icons = ['✦', '◆', '●']
  const detailItems = pointCards
    .slice(0, 3)
    .map((pc, i) => ({ icon: icons[i % 3], text: `${pc.title ?? ''}: ${pc.description ?? ''}` }))

  const usageDesc = howTo.length > 0 ? `${howTo[0].step ?? ''}: ${howTo[0].description ?? ''}` : ''
  const trustSub = targets.length > 0 ? targets.slice(0, 3).join(', ') : '모든 분께 추천드립니다'
  const ctaHeadline = closingCta.headline ?? '지금 구매하기'

  return [
    {
      section_type: 'hook',
      headline: mainIntro.benefitHeadline || mainIntro.hook || '',
      sub_copy: mainIntro.brandAndName || mainIntro.title || '',
      image_direction: '제품 중심의 프리미엄 스튜디오 촬영, 따뜻한 조명',
    },
    {
      section_type: 'problem',
      headline: problem.question || '이런 불편함 겪고 계신가요?',
      sub_copy: problem.empathy || '',
      image_direction: '문제 상황을 보여주는 공감 가는 이미지, 밝은 톤 유지',
    },
    {
      section_type: 'benefit',
      headline: solution.declaration || '이제 걱정 없습니다',
      sub_copy: solution.summary || '',
      image_direction: '제품 사용 중인 밝고 긍정적인 라이프스타일 이미지',
    },
    {
      section_type: 'detail_points',
      headline: '이런 점이 다릅니다',
      sub_copy: '',
      image_direction: '제품 디테일 클로즈업 샷',
      detail_items: detailItems,
    },
    {
      section_type: 'usage',
      headline: '이렇게 사용하세요',
      sub_copy: usageDesc,
      image_direction: '자연스러운 사용 장면, 한국인 모델',
    },
    {
      section_type: 'trust',
      headline: '이런 분께 추천합니다',
      sub_copy: trustSub,
      image_direction: '신뢰감을 주는 깔끔한 제품 이미지',
    },
    {
      section_type: 'cta',
      headline: ctaHeadline.length <= 30 ? ctaHeadline : ctaHeadline.slice(0, 30),
      sub_copy: '한정 수량 / 빠른 배송',
      image_direction: '',
    },
  ]
}

export interface V43DerivedFields {
  hero_copy: NonNullable<CopywritingResult['hero_copy']>
  review_strategy: NonNullable<CopywritingResult['review_strategy']>
  section_copy_blocks: NonNullable<CopywritingResult['section_copy_blocks']>
  objection_handlers: NonNullable<CopywritingResult['objection_handlers']>
  cta_variants: NonNullable<CopywritingResult['cta_variants']>
  sections: DetailSection[]
}

const REVIEW_POSITION_MAP: Record<string, string> = { front: 'front', middle: 'middle', back: 'back', dynamic: 'dynamic' }

const DEFAULT_OBJECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['가격이 비싸지 않나요?', '합리적인 가격에 최고의 품질을 제공합니다.'],
  ['품질이 좋은가요?', '수많은 검증된 후기와 품질로 신뢰할 수 있습니다.'],
  ['배송은 빠른가요?', '빠른 배송 및 30일 무료 반품을 보장합니다.'],
]

/** LLM 재호출 없이 기존 copy에서 V4.3 파생 필드를 규칙 기반으로 도출 — copywriting_agent.py:1576-1675 1:1 */
export function deriveV43Fields(
  copy: CopywritingResult,
  strategyContract: StrategyContract,
  objectionPriority: string[],
): V43DerivedFields {
  const sections = buildLegacySections(copy)
  const hookCopy = sections.find((s) => s.section_type === 'hook')?.headline ?? ''
  const mainIntro = copy.mainIntro ?? {}
  const solution = copy.solution ?? {}
  const detailPoints = copy.detailPoints ?? []
  const closingCta = copy.closingCta ?? {}

  const hero_copy = {
    benefit_headline: mainIntro.benefitHeadline || mainIntro.title || '',
    hook: hookCopy,
    subline: mainIntro.subBenefit || mainIntro.subtitle || '',
  }

  const reviewPositionRaw = strategyContract.review_position_strategy ?? 'dynamic'
  const review_strategy = {
    position: REVIEW_POSITION_MAP[reviewPositionRaw] ?? 'middle',
    why_here: `strategy_contract.review_position_strategy=${reviewPositionRaw} 기반 배치`,
  }

  const section_copy_blocks = sections.slice(0, 12).map((sec) => ({
    section: sec.section_type ?? '',
    role: 'proof',
    headline: sec.headline ?? '',
    body: sec.sub_copy ?? '',
  }))

  const answerPool: string[] = []
  for (const dp of detailPoints) {
    const proof = (dp.proof ?? '').trim()
    const benefit = (dp.benefit ?? '').trim()
    if (proof && benefit) answerPool.push(`${proof} — ${benefit}`)
    else if (proof || benefit) answerPool.push(proof || benefit)
  }
  const compareSummary = (copy.compareSummary ?? '').trim()
  if (compareSummary) answerPool.push(compareSummary)
  const solutionSummary = (solution.summary ?? '').trim()
  if (solutionSummary) answerPool.push(solutionSummary)
  const baseAnswer = copy.summary || '우리 제품이 최적의 해결책입니다.'

  const objection_handlers: Array<{ objection: string; answer: string }> = []
  objectionPriority.slice(0, 5).forEach((objText, i) => {
    let answer = answerPool.length > 0 ? answerPool[i % answerPool.length] : baseAnswer
    if (/가격|비싸|비용/.test(objText)) answer = compareSummary || '합리적인 가격에 검증된 품질을 제공합니다.'
    else if (/배송|언제 와|도착/.test(objText)) answer = '빠른 배송 및 30일 무료 반품을 보장합니다.'
    objection_handlers.push({ objection: objText, answer })
  })
  for (const [objText, ansText] of DEFAULT_OBJECTIONS) {
    if (objection_handlers.length >= 3) break
    if (!objection_handlers.some((h) => h.objection === objText)) objection_handlers.push({ objection: objText, answer: ansText })
  }

  const ctaMain = closingCta.headline || '지금 바로 경험해보세요'
  const ctaSub = closingCta.subtext || '빠른 배송 · 30일 무료 반품'
  const cta_variants = [
    { type: 'emotion', copy: ctaMain },
    { type: 'rational', copy: ctaSub || '지금 구매하고 무료 반품 혜택받기' },
  ]

  return { hero_copy, review_strategy, section_copy_blocks, objection_handlers, cta_variants, sections }
}
