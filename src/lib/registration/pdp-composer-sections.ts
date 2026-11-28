/**
 * PDP 합성(compose) — 섹션 데이터 조립("available" 빌더). NEXFIT
 * agents/template_composer_agent.py:_build_sections(:279-674)의 데이터 추출·필드 매핑·폴백체인 이식.
 * 공통 섹션(premium·pro 공통)과 Pro 전용 12섹션(:515-674)을 분리해 구성한다.
 *
 * NexOps CopywritingResult(pdp-state.ts)는 NEXFIT v2 필드(mainIntro.benefitHeadline/subBenefit
 * /brandAndName, detailPoints.claim/proof/benefit/imageHint, problem.empathyLines)를 그대로 보존하고
 * 구버전 별칭(title/subtitle 등)은 하위호환 폴백으로만 유지한다 — 이 파일도 그 우선순위(v2 필드 우선 →
 * 구 필드 폴백)를 그대로 따른다.
 */

import type { ComposedSection } from './pdp-composer'
import type { CopywritingResult, GeneratedImagesMap, PdpMode, PdpSpecSheet } from './pdp-state'
import { normalizeCompareItems } from './pdp-copy-labels'
import { productInfoRows } from './product-info-rows'

const SOLD_OUT_SUBTITLE_DEFAULT = '고객님의 성원에 힘입어'

type AvailableMap = Record<string, ComposedSection | ComposedSection[]>

/** 평점만큼 ★, 나머지 ☆(반올림, 0~5) — 숫자가 아니면 별 없이 */
function ratingStars(rating: string): string {
  const value = Number(rating)
  if (!Number.isFinite(value)) return ''
  const n = Math.min(5, Math.max(0, Math.round(value)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function strField(rec: Record<string, unknown>, key: string, fallback = ''): string {
  const v = rec[key]
  return typeof v === 'string' && v ? v : fallback
}

/**
 * 첫 번째로 내용이 있는 문자열 — 원본 Python `a or b or c` 폴백 체인의 번역. `??`는 빈 문자열을 그대로 통과시켜
 * LLM이 ""를 낸 필드가 다음 후보로 넘어가지 못한다(빈 헤드라인 섹션). 공백만 있는 값도 빈 값으로 본다.
 */
function firstFilled(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

function arrField(rec: Record<string, unknown>, key: string): unknown[] {
  const v = rec[key]
  return Array.isArray(v) ? v : []
}

/**
 * template_composer_agent.py:397-412 — 중복 없이 이미지 선택, 소진되면 빈 문자열. 대신 고를 때 뒤 항목(owners개 중 index 뒤)의
 * 같은 번호 컷은 건너뛴다 — 앞 번호 컷이 실패했을 때 뒤 컷이 한 칸 당겨지지 않게(그 항목은 사진 없이)
 */
function pickUniqueImage(candidates: readonly string[], index: number, used: Set<string>, owners = 0): string {
  const atIndex = candidates[index]
  if (atIndex && !used.has(atIndex)) {
    used.add(atIndex)
    return atIndex
  }
  for (const [j, url] of candidates.entries()) {
    if (j > index && j < owners) continue
    if (url && !used.has(url)) {
      used.add(url)
      return url
    }
  }
  return ''
}

function buildSoldOutBanner(available: AvailableMap, copy: CopywritingResult, images: GeneratedImagesMap, specSheet: PdpSpecSheet): void {
  if (!specSheet.soldOutCount) return
  const extra = specSheet.extra
  const extraSubtitle = extra && typeof extra.soldOutSubtitle === 'string' ? extra.soldOutSubtitle : undefined
  available.sold_out_banner = {
    type: 'sold_out_banner',
    image: images.sold_out_banner ?? '',
    headline: copy.soldOutBanner?.headline ?? '',
    sub_copy: copy.soldOutBanner?.subtitle ?? extraSubtitle ?? SOLD_OUT_SUBTITLE_DEFAULT,
    count: specSheet.soldOutCount,
  }
}

// template_composer_agent.py:326-335 — v2 필드(benefitHeadline/subBenefit/brandAndName) 우선, 구 필드(title/subtitle) 폴백
function buildMainIntro(available: AvailableMap, mainIntro: NonNullable<CopywritingResult['mainIntro']>, images: GeneratedImagesMap): void {
  available.main_intro = {
    type: 'main_intro',
    image: images.hero ?? '',
    category: mainIntro.category ?? '',
    headline: mainIntro.benefitHeadline ?? mainIntro.title ?? '',
    hook: mainIntro.hook ?? '',
    sub_copy: mainIntro.subBenefit ?? mainIntro.subtitle ?? '',
    brand_and_name: mainIntro.brandAndName ?? mainIntro.subtitle ?? '',
  }
}

/** template_composer_agent.py:338-350 — 원본은 spec_sheet.reviews(원문 리스트) 게이트, NexOps는
 * 해당 원자료를 컴포즈 단계까지 보관하지 않으므로 copy.reviewHighlights·reviewCount로 대체 게이팅한다. */
function buildReviews(available: AvailableMap, copy: CopywritingResult, specSheet: PdpSpecSheet): void {
  const highlights = copy.reviewHighlights ?? []
  if (highlights.length === 0 && !specSheet.reviewCount) return
  available.reviews = {
    type: 'reviews',
    highlights: highlights.slice(0, 3),
    reviewCount: specSheet.reviewCount ?? 0,
  }
}

function buildProblemSolution(
  available: AvailableMap,
  problem: NonNullable<CopywritingResult['problem']>,
  solution: NonNullable<CopywritingResult['solution']>,
  images: GeneratedImagesMap,
): void {
  available.problem = {
    type: 'problem',
    image: images.problem ?? '',
    headline: problem.question ?? '이런 불편함 겪고 계신가요?',
    sub_copy: problem.empathy ?? '',
    empathy_lines: problem.empathyLines ?? [],
  }
  available.solution = {
    type: 'solution',
    image: images.solution ?? '',
    headline: solution.declaration ?? '이제 걱정 없습니다',
    sub_copy: solution.summary ?? '',
  }
}

function buildPointCards(available: AvailableMap, pointCards: NonNullable<CopywritingResult['pointCards']>, images: GeneratedImagesMap): void {
  if (pointCards.length === 0) return
  const uspIcons = images.usp_icons ?? []
  const cards = pointCards.slice(0, 5).map((card, index) => ({
    title: card.title ?? '',
    description: card.description ?? '',
    icon_url: uspIcons[index] || undefined,
  }))
  available.point_cards = { type: 'point_cards', cards }
}

// template_composer_agent.py:414-430 — claim(주장)=headline, proof(증명)/benefit(효익)=sub_copy 폴백체인
function buildDetailPoints(available: AvailableMap, detailPoints: NonNullable<CopywritingResult['detailPoints']>, images: GeneratedImagesMap): void {
  const featureImages = images.features ?? []
  const used = new Set<string>()
  const points = detailPoints.slice(0, 6)
  available.detail_points = points.map((dp, index) => ({
    type: 'detail_point',
    headline: dp.claim ?? '',
    sub_copy: dp.proof ?? dp.benefit ?? '',
    benefit: dp.benefit ?? '',
    image_hint: dp.imageHint ?? '',
    image: pickUniqueImage(featureImages, index, used, points.length),
    index,
  }))
}

function buildUsageTags(available: AvailableMap, usageTags: string[]): void {
  if (usageTags.length === 0) return
  available.usage_tags = { type: 'usage_tags', tags: usageTags }
}

function buildHowTo(available: AvailableMap, howTo: NonNullable<CopywritingResult['howTo']>, images: GeneratedImagesMap): void {
  const howToImages = images.howToImages ?? []
  available.how_to = howTo.slice(0, 5).map((ht, index) => ({
    type: 'how_to',
    headline: ht.step ?? '',
    sub_copy: ht.description ?? '',
    image: howToImages[index] ?? '',
    index,
  }))
}

function buildColorOptions(available: AvailableMap, colorOptions: CopywritingResult['colorOptions']): void {
  const options = colorOptions?.options ?? []
  if (options.length === 0) return
  available.color_options = {
    type: 'color_options',
    headline: colorOptions?.title ?? '컬러 옵션',
    sub_copy: colorOptions?.description ?? '',
    options,
  }
}

function buildRecommendedTargets(available: AvailableMap, targets: string[]): void {
  if (targets.length === 0) return
  available.recommended_targets = { type: 'recommended_targets', targets: targets.slice(0, 6) }
}

function buildCta(available: AvailableMap, copy: CopywritingResult): void {
  if (!copy.closingCta?.headline) return
  available.cta = { type: 'cta', headline: copy.closingCta.headline, sub_copy: copy.closingCta.subtext ?? '' }
}

function buildSpecTable(available: AvailableMap, specSheet: PdpSpecSheet, images: GeneratedImagesMap): void {
  available.spec_table = {
    type: 'spec_table',
    spec_rows: productInfoRows(specSheet),
    size_comparison_image: images.size_comparison ?? '',
  }
}

/**
 * Pro 전용 섹션 조립(template_composer_agent.py:517-674). event_bundle은 이식하지 않는다 —
 * 대응 이미지 프롬프트(bundle_arrangement)가 PROMPT-INVENTORY §5.3에서 애초에 이식되지 않았고
 * PRO_DEFAULT_ORDER·PRODUCT_TEMPLATES 어느 flow에도 등장하지 않는 원본 자체 미사용 섹션이었다.
 */
function buildProSections(
  available: AvailableMap,
  copy: CopywritingResult,
  images: GeneratedImagesMap,
  specSheet: PdpSpecSheet,
  mainIntro: NonNullable<CopywritingResult['mainIntro']>,
  problem: NonNullable<CopywritingResult['problem']>,
  solution: NonNullable<CopywritingResult['solution']>,
  pointCards: NonNullable<CopywritingResult['pointCards']>,
  detailPoints: NonNullable<CopywritingResult['detailPoints']>,
  usageTags: string[],
): void {
  if (specSheet.certificationInfo) {
    const cert = asRecord(copy.certificationCopy)
    available.certification = {
      type: 'certification',
      image: images.certification_badge ?? '',
      // 인증 카피가 없으면 입력 인증 문구 그대로 — '{브랜드} 정품 인증'을 지어내지 않는다(P0-1b)
      headline: strField(cert, 'headline', specSheet.certificationInfo),
      sub_copy: strField(cert, 'sub_copy'),
      highlight_text: strField(cert, 'highlight_text'),
      bullet_points: arrField(cert, 'bullet_points'),
      warning_text: strField(cert, 'warning_text'),
      cert_badges_text: strField(cert, 'cert_badges_text', specSheet.certificationInfo),
      brand_name: specSheet.brandName ?? '',
      cert_type: strField(cert, 'cert_type', 'genuine'),
    }
  }

  if (specSheet.eventBannerInfo) {
    const event = asRecord(copy.eventBannerCopy)
    available.event_banner = {
      type: 'event_banner',
      image: images.event_banner ?? '',
      headline: strField(event, 'headline', specSheet.eventBannerInfo),
      sub_copy: strField(event, 'sub_copy'),
      highlight_text: strField(event, 'highlight_text'),
      cta_text: strField(event, 'cta_text'),
      urgency_text: strField(event, 'urgency_text'),
      badge_text: strField(event, 'badge_text', 'EVENT'),
    }
  }

  available.product_exposure = {
    type: 'product_exposure',
    image: images.product_exposure ?? images.hero ?? '',
    headline: copy.productExposure?.headline ?? mainIntro.benefitHeadline ?? mainIntro.title ?? '',
    sub_copy: copy.productExposure?.subCopy ?? mainIntro.hook ?? '',
  }

  available.problem_empathy = {
    type: 'problem_empathy',
    image: images.empathy_scene ?? '',
    headline: problem.question ?? '이런 불편함 겪고 계신가요?',
    sub_copy: problem.empathy ?? '',
    empathy_lines: problem.empathyLines ?? [],
  }

  available.direction_suggest = {
    type: 'direction_suggest',
    image: images.direction_hint ?? '',
    headline: copy.directionHint?.headline ?? solution.declaration ?? '',
    sub_copy: copy.directionHint?.subCopy ?? solution.summary ?? '',
  }

  const firstCard = pointCards[0]
  const firstDetail = detailPoints[0]
  available.key_message = {
    type: 'key_message',
    image: images.key_benefit_visual ?? '',
    // template_composer_agent.py:606-607 `or` 체인 — 빈 문자열도 다음 후보로 넘긴다
    headline: firstFilled(copy.keyMessageCopy?.headline, copy.keyMessageVariations?.top, firstCard?.title, firstDetail?.claim),
    sub_copy: firstFilled(copy.keyMessageCopy?.subCopy, copy.keyMessageVariations?.mid, firstCard?.description, firstDetail?.proof),
  }

  available.main_cut = {
    type: 'main_cut',
    image: images.premium_hero ?? images.hero ?? '',
    headline: copy.mainCutCopy?.headline ?? mainIntro.benefitHeadline ?? mainIntro.title ?? '',
    sub_copy: copy.mainCutCopy?.subCopy ?? mainIntro.subBenefit ?? mainIntro.subtitle ?? '',
  }

  available.concept_desc = {
    type: 'concept_desc',
    image: images.concept_mood ?? '',
    headline: copy.conceptCopy?.headline ?? solution.declaration ?? '',
    sub_copy: copy.conceptCopy?.subCopy ?? solution.summary ?? '',
  }

  available.sub2_div_page = {
    type: 'sub2_div_page',
    image: images.comparison_scene ?? '',
    headline: usageTags.join(' '),
    sub_copy: '',
  }

  // template_composer_agent.py:637-638·655-656 `or` 체인 — 빈 문자열도 다음 후보로 넘긴다
  const ctaHeadline = firstFilled(copy.convertDivCopy?.headline, copy.closingCta?.headline, copy.keyMessageVariations?.bottom)
  available.convert_div = {
    type: 'convert_div',
    // C-A3(원본 image_generation_agent.py): conversion_cta 이미지는 cta 생성물을 그대로 물려받는다.
    // NexOps는 별도 conversion_cta 프롬프트를 이식하지 않았으므로(PROMPT-INVENTORY §5.3 제외) cta로 직결.
    image: images.cta ?? '',
    headline: ctaHeadline,
    sub_copy: firstFilled(copy.convertDivCopy?.subCopy, copy.closingCta?.subtext),
  }

  // 실제 평점(spec_sheet.rating) 없이 기본값을 지어내면 허위 표시 위험(전자상거래법) — 섹션 자체를 생략.
  const rating = String(specSheet.rating ?? '').trim()
  if (rating) {
    available.perf_rating = {
      type: 'perf_rating',
      image: images.rating_bg ?? '',
      headline: rating,
      // 별은 평점만큼(4.0이면 ★★★★☆) — 다섯 개를 다 채우지 않는다
      sub_copy: `${ratingStars(rating)} ${rating} / 5.0`.trim(),
    }
  }

  available.compare_div = {
    type: 'compare_div',
    image: images.size_comparison ?? '',
    headline: '사이즈 비교',
    sub_copy: specSheet.size ?? '',
    compare_items: normalizeCompareItems(copy.compareItems),
    compare_summary: copy.compareSummary ?? '',
  }
}

export function buildAvailableSections(
  mode: PdpMode,
  copy: CopywritingResult,
  images: GeneratedImagesMap,
  specSheet: PdpSpecSheet,
): AvailableMap {
  const available: AvailableMap = {}
  const mainIntro = copy.mainIntro ?? {}
  const problem = copy.problem ?? {}
  const solution = copy.solution ?? {}
  const pointCards = copy.pointCards ?? []
  const detailPoints = copy.detailPoints ?? []
  const howTo = copy.howTo ?? []
  const colorOptions = copy.colorOptions
  const usageTags = copy.usageSceneTags ?? []
  const targets = copy.recommendedTargets ?? []

  buildSoldOutBanner(available, copy, images, specSheet)
  buildMainIntro(available, mainIntro, images)
  buildReviews(available, copy, specSheet)
  buildProblemSolution(available, problem, solution, images)
  buildPointCards(available, pointCards, images)
  buildDetailPoints(available, detailPoints, images)
  buildUsageTags(available, usageTags)
  buildHowTo(available, howTo, images)
  buildColorOptions(available, colorOptions)
  buildRecommendedTargets(available, targets)
  buildCta(available, copy)
  buildSpecTable(available, specSheet, images)

  if (mode === 'pro') {
    buildProSections(available, copy, images, specSheet, mainIntro, problem, solution, pointCards, detailPoints, usageTags)
  }

  return available
}
