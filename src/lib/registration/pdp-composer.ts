/**
 * PDP 6단계 합성(compose) 순수 함수 — NEXFIT agents/template_composer_agent.py(977줄) 재작성.
 * 전량 통독 결과 LLM 프롬프트 0건(PROMPT-INVENTORY §6) — 번역이 아니라 순수 조립 로직 재작성 대상.
 *
 * 배치 순서: section_plan.section_order 우선 → select_template(전략 계약 기반 4종, pro 전용)
 * → PRO_DEFAULT_ORDER 폴백(:238-277, :905-921). FLOW_ALIAS로 섹션 키 이명을 정규화한다.
 *
 * HTML 렌더 축약(§6 결정 G): NexOps는 구조화된 `sections`(JSONB)가 Phase 3 에디터가 소비하는 1급
 * 산출이고 final_html은 미리보기 보조일 뿐이므로, 원본 CSS 977줄(templates/page_renderer.py)을
 * 통째 이식하지 않고 모바일 780px 세로 스택 미리보기 수준으로 축약한다.
 *
 * essence_type은 이 파일에서 사용하지 않는다 — 원본을 읽어보면 _build_sections의 problem 섹션
 * if/else 분기(:352-369)와 _get_section_order의 hook 분기(:258-269)가 essence_type 값과 무관하게
 * 바이트 동일한 결과를 내는 죽은 조건문으로 확인되어(v2 리팩터 잔재), 포팅 시 재현할 실제 동작이 없다.
 */

import type {
  CopywritingResult,
  GeneratedImagesMap,
  PdpMode,
  PdpSpecSheet,
  SectionPlan,
  StrategyContract,
} from './pdp-state'
import type { InternalizedThemeMap, ResolvedSectionTheme } from './internalized/internalized-theme'
import { MIN_FONT_SIZES } from './editor/constants/designTokens'
import { FLOW_ALIAS, PRO_DEFAULT_ORDER, ensureCtaLast, ensureSoldoutIfNeeded, selectTemplate } from './pdp-composer-data'
import { buildAvailableSections } from './pdp-composer-sections'

/** 에디터(Phase 3)가 소비하는 1급 구조화 산출 — headline/sub_copy/image로 정규화 + 섹션 타입별 확장 필드 */
export interface ComposedSection {
  type: string
  image?: string
  headline?: string
  sub_copy?: string
  [extra: string]: unknown
}

export interface ComposePdpInput {
  mode: PdpMode
  copy: CopywritingResult
  images: GeneratedImagesMap
  sectionPlan: SectionPlan
  strategyContract: StrategyContract
  specSheet: PdpSpecSheet
  /** Track I 내재화 테마(결정 T-5) — 섹션 타입별 실측 타이포·배경·패딩. 미전달(Track S) 시 기존 렌더와 동일 */
  themeStyles?: InternalizedThemeMap
}

export interface ComposePdpOutput {
  sections: ComposedSection[]
  finalHtml: string
}

/** template_composer_agent.py:238-277 fallback 중 plan_tier != "pro" 분기 — pro는 PRO_DEFAULT_ORDER 그대로 */
function fallbackSectionOrder(specSheet: PdpSpecSheet, mode: PdpMode): string[] {
  if (mode === 'pro') return [...PRO_DEFAULT_ORDER]

  const soldOut = specSheet.soldOutCount ?? 0
  const hasReviews = (specSheet.reviewCount ?? 0) > 0

  const hook = soldOut > 0 ? ['sold_out_banner', 'main_intro'] : ['main_intro']
  if (hasReviews) hook.push('reviews')

  const body = ['problem', 'solution', 'point_cards', 'detail_points']
  const modules = ['usage_tags', 'how_to', 'recommended_targets']
  if (specSheet.colorOptions?.length) modules.push('color_options')
  const closing = ['spec_table', 'cta']

  return [...hook, ...body, ...modules, ...closing]
}

/** run() 섹션 순서 결정 로직 이식(template_composer_agent.py:905-921) */
function resolveSectionOrder(input: ComposePdpInput): string[] {
  const planned = input.sectionPlan.section_order
  let order = planned && planned.length > 0 ? [...planned] : undefined

  if (!order && input.mode === 'pro' && Object.keys(input.strategyContract).length > 0) {
    order = ensureCtaLast(selectTemplate(input.strategyContract).flow)
  }

  if (order && input.specSheet.soldOutCount) {
    order = ensureSoldoutIfNeeded(order, input.specSheet.soldOutCount)
  }

  return order ?? fallbackSectionOrder(input.specSheet, input.mode)
}

/** _build_sections 조립 루프 이식(template_composer_agent.py:701-716) — 이명 정규화 + 리스트형 섹션 펼침 */
function assembleSections(order: string[], available: Record<string, ComposedSection | ComposedSection[]>): ComposedSection[] {
  const sections: ComposedSection[] = []
  for (const raw of order) {
    const secType = FLOW_ALIAS[raw] ?? raw
    const entry = available[secType]
    if (Array.isArray(entry)) sections.push(...entry)
    else if (entry) sections.push(entry)
  }
  return sections
}

const LIST_FIELDS = ['cards', 'tags', 'targets', 'options', 'spec_rows', 'compare_items', 'highlights', 'bullet_points', 'empathy_lines']

/** 이미지도 카피도 없는 섹션은 제외 — 리스트형 데이터 섹션(포인트카드·스펙표 등)은 비어있지 않으면 유지 */
function hasContent(section: ComposedSection): boolean {
  if (section.image || section.headline || section.sub_copy) return true
  return LIST_FIELDS.some((field) => Array.isArray(section[field]) && (section[field] as unknown[]).length > 0)
}

/**
 * 테마 키(ProSectionType)를 컴포저 어휘로 확장 — assembleSections가 FLOW_ALIAS로 섹션 키를 바꾸므로
 * (point_div→point_cards 등) 별칭 키에도 같은 테마를 건다. sub_div→detail_points는 리스트형 펼침이라
 * 개별 항목 타입(detail_point 단수)도 함께 등록한다(pdp-composer-sections의 펼침 관례).
 */
function expandThemeAliases(themeStyles: InternalizedThemeMap): InternalizedThemeMap {
  const expanded: InternalizedThemeMap = { ...themeStyles }
  for (const [proType, theme] of Object.entries(themeStyles)) {
    const alias = FLOW_ALIAS[proType]
    if (alias && !expanded[alias]) expanded[alias] = theme
    if (alias === 'detail_points' && !expanded['detail_point']) expanded['detail_point'] = theme
  }
  return expanded
}

export function composePdp(input: ComposePdpInput): ComposePdpOutput {
  const available = buildAvailableSections(input.mode, input.copy, input.images, input.specSheet)
  const order = resolveSectionOrder(input)
  const sections = assembleSections(order, available).filter(hasContent)
  const themeStyles = input.themeStyles ? expandThemeAliases(input.themeStyles) : undefined
  const finalHtml = renderFinalHtml(sections, input.specSheet, themeStyles)
  return { sections, finalHtml }
}

// ── HTML 미리보기 렌더 (page_renderer.py 977줄 CSS 전량 이식 대신 세로 스택으로 축약, 상단 §6 결정 참조) ──

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

function renderListBlock(label: string, items: string[]): string {
  if (items.length === 0) return ''
  const lis = items.map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`).join('')
  return `<div style="margin-top:12px;"><strong>${label}</strong><ul style="margin:6px 0 0;padding-left:20px;">${lis}</ul></div>`
}

function renderSectionExtras(section: ComposedSection): string {
  const parts: string[] = []
  if (Array.isArray(section.cards)) {
    const cards = section.cards as Array<{ title?: string; description?: string }>
    parts.push(renderListBlock('포인트', cards.map((c) => `${c.title ?? ''} — ${c.description ?? ''}`)))
  }
  if (Array.isArray(section.tags)) parts.push(renderListBlock('태그', section.tags as string[]))
  if (Array.isArray(section.targets)) parts.push(renderListBlock('추천 대상', section.targets as string[]))
  if (Array.isArray(section.options)) parts.push(renderListBlock('옵션', section.options as string[]))
  if (Array.isArray(section.spec_rows)) {
    const rows = section.spec_rows as Array<{ label: string; value: string }>
    parts.push(renderListBlock('스펙', rows.map((r) => `${r.label}: ${r.value}`)))
  }
  if (Array.isArray(section.compare_items)) {
    const items = section.compare_items as Array<{ name?: string; pros?: string }>
    parts.push(renderListBlock('비교', items.map((r) => `${r.name ?? ''} — ${r.pros ?? ''}`)))
  }
  if (Array.isArray(section.highlights)) {
    // 인용 카드(평점이 있는 카드, R6)는 작성자를 붙이지 않는다 — 편집기 카드도 작성자 줄 없이 별점·옵션만
    const highlights = section.highlights as Array<{ text?: string; author?: string; rating?: number }>
    const line = (h: (typeof highlights)[number]) =>
      h.author && typeof h.rating !== 'number' ? `${h.text ?? ''} — ${h.author}` : h.text ?? ''
    parts.push(renderListBlock('리뷰', highlights.map(line)))
  }
  if (Array.isArray(section.empathy_lines)) parts.push(renderListBlock('공감 포인트', section.empathy_lines as string[]))
  // bullet_points는 인증 섹션만 가진다 — 입력 인증 항목의 둘째부터(첫 항목은 제목)
  if (Array.isArray(section.bullet_points)) parts.push(renderListBlock('인증', section.bullet_points as string[]))
  return parts.join('')
}

/**
 * 미리보기 스케일 충실성(오너 적발 2026-08-12): 모든 px는 캔버스 860px 기준 값 그대로 인라인한다 —
 * 축소는 소비측 소관(실기기=viewport meta width=860가 화면 폭 맞춤, 앱 프리뷰=PdpPreview transform).
 * Track I는 실측 테마 값, Track S는 designTokens 모바일 하한(h2 60·body 45 — 실물 에디터 기본과 동일
 * 어휘)을 쓴다 — 이전의 축약 스타일(20/14px, 가변 폭)은 실물과 배율이 달라 모바일 판정을 오도했다.
 * I-4 게이트가 final_html에서 테마 값들을 파서로 대조한다.
 */
function renderSection(section: ComposedSection, theme?: ResolvedSectionTheme): string {
  const img = typeof section.image === 'string' && section.image
    ? `<img src="${escapeHtml(section.image)}" alt="" style="width:100%;display:block;border-radius:8px;" />`
    : ''
  const headlinePx = theme?.headlinePx ?? MIN_FONT_SIZES.h2
  const bodyPx = theme?.bodyPx ?? MIN_FONT_SIZES.body
  const lineHeight = theme?.lineHeightRatio ?? 1.4
  const headline = section.headline
    ? `<h2 style="font-size:${headlinePx}px;line-height:${lineHeight};font-weight:700;margin:12px 0 4px;">${escapeHtml(section.headline)}</h2>`
    : ''
  const subCopy = section.sub_copy
    ? `<p style="font-size:${bodyPx}px;line-height:${lineHeight};color:#475569;margin:0 0 8px;white-space:pre-wrap;">${escapeHtml(section.sub_copy)}</p>`
    : ''
  const sectionStyle = theme
    ? `padding:${theme.paddingPx}px 32px;background:${theme.backgroundHex};border-bottom:1px solid #e2e8f0;`
    : 'padding:40px 32px;border-bottom:1px solid #e2e8f0;'
  return `<section data-section-type="${section.type}" style="${sectionStyle}">${img}${headline}${subCopy}${renderSectionExtras(section)}</section>`
}

function renderFinalHtml(sections: ComposedSection[], specSheet: PdpSpecSheet, themeStyles?: InternalizedThemeMap): string {
  const body = sections.map((section) => renderSection(section, themeStyles?.[section.type])).join('')
  const title = escapeHtml(specSheet.productName ?? '')
  // viewport width=860: 실기기 브라우저가 캔버스 폭을 화면 폭에 맞춰 축소 — 390px 폰에서 body 45px ≈ 20px,
  // 테마 본문 33px ≈ 15px(§E-2 하한과 정합). 앱 내 iframe은 PdpPreview가 transform으로 동일 배율을 만든다.
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=860" /><title>${title}</title></head>` +
    `<body style="margin:0;background:#f1f5f9;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">` +
    `<div style="width:860px;margin:0 auto;background:#ffffff;">${body}</div></body></html>`
  )
}
