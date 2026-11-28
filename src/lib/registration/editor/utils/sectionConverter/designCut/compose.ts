/**
 * 디자인 컷 조립(D2) — designcut 기록 잡의 편집기 섹션을 만든다.
 * 계약의 order(sections·kept를 섞은 페이지 순서) 순서로 템플릿과 kept(기존 빌더 섹션)를 그리고, omitted·그 밖의 섹션은 그리지 않는다.
 * order가 없는 초기 형태 기록은 section_order로 순서를 정한다.
 * 템플릿이 필수 데이터(제품 컷·문구·모듈) 부족으로 못 그리면 그 키의 기존 섹션으로 대체한다(POINT는 먼저 대표 컷 T3a로).
 * 예전 계획 기록의 T3b(사진 → 글 띠)는 T3a로 그린다 — POINT는 장 머리·제목 → 사진 한 순서(2026-10-30, B 배치 점검 ①).
 * 디자인 컷 섹션은 겹친 레이어라 마운트 reflow를 끈다(needsInitialReflow false) — 높이는 템플릿이 미리 잰다.
 * 위에서 아래로만 쌓은 템플릿(CutResult.reflow — T2 말풍선)만 켜서 상자를 실측 글 높이에 맞춘다.
 * 다 그린 뒤 구매 전 확인(purchaseCut.ts): 구성·사이즈·옵션 값이 그린 글에 없으면 첫 CTA 바로 앞에 표를 넣는다(#288 판정 재사용).
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { ProductBox } from '@/lib/registration/pdp-state'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import { sanitizeImageUrl, uid } from '../helpers'
import { isRealOptionPhoto } from '@/lib/registration/options/option-photo-guard'
import { mapBackendSectionsToProTypes } from '../convert'
import {
  baseKeyOf,
  toCutSection,
  type CutPlan,
  type DesigncutBg,
  type DesigncutSection,
  type DesigncutTemplate,
} from './contract'
import type { DesigncutLayoutVariant } from '@/lib/registration/pdp-state'
import {
  buildT1,
  buildT3a,
  buildT3c,
  buildT8,
  type CutContext,
  type CutResult,
  type SceneContext,
  type V2Context,
} from './templatesScene'
import { buildT2, buildT4, buildT5, buildT6, buildT7, stepImagesOf } from './templatesInfo'
import { withCompareRows } from './compareRows'
import { withLayerBand } from './inputDevices'
import { appendPointPhoto, buildT10, buildT11, buildT9 } from './templatesLong'
import { buildT12 } from './templatesReview'
import { buildT11Zigzag, buildT3aCards, buildT3aGrid, buildT3aHalf, buildT3aZigzag, isBandEndPoint } from './templatesVariant'
import { insertPurchaseCheck } from './purchaseCut'
import { withZoneLink } from './zoneLink'
import type { PagePoint } from './pointSteps'
import { renderTemplate } from '@/lib/registration/templatelib/engine'
import { breatheKSeams, K_SEAM_MAX, kTemplateOf } from './k-breath'
import { headingTrackingOf } from '@/lib/registration/templatelib/font-pairs'
import { templateById } from '@/lib/registration/templatelib/library'
import { SECTION_TABLE } from '@/lib/registration/templatelib/template-types'
import { uspWordsOf } from './accent'
import { assignActBackgrounds, fadePhotoBottoms, isWhite, type BgRow } from './layout2'
import {
  CONTENT_W,
  HOOK_TYPE,
  MARGIN,
  PLAYFUL_RADIUS,
  SCENE_SPACE,
  SCENE_TYPE,
  W,
  WHITE,
  colorsOf,
  isYellowHue,
  onColor,
  radiusOf,
  rgba,
  surfaceOf,
} from './tokens'

const BUILDERS: Partial<Record<DesigncutTemplate, (ctx: CutContext) => CutResult | null>> = {
  T1: buildT1,
  T2: buildT2,
  T3a: buildT3a,
  T3c: buildT3c,
  T4: buildT4,
  T5: buildT5,
  T6: buildT6,
  T7: buildT7,
  T8: buildT8,
  // 긴 페이지(designlong) — 사실 표·사용 장면
  // 상품 정보 표 아래 기존 제품과 비교 줄(C5 ②) — 계획 칸이 있을 때만, 없으면 buildT9 그대로
  T9: withCompareRows(buildT9),
  T10: buildT10,
  // D2 구조 — 자세히 보기(기본 목록, 형태 변형은 장면 템플릿이 바꾼다)·후기 카드
  // 자세히 보기 머리 아래 층 띠(D6 T1-85) — 계획 칸이 있고 장면 모드일 때만, 아니면 그리기 그대로
  T11: withLayerBand(buildT11),
  T12: buildT12,
}

/**
 * D2 형태 변형(계획 layoutVariant — internalized/designcut-structure.ts) — 장면 모드에서만 이 그리기로 바꾼다. 모르는 이름·칸 없음·
 * 장면 모드가 아님은 BUILDERS 그대로(scene·기본 목록·카드)
 */
const VARIANT_BUILDERS: Partial<
  Record<DesigncutTemplate, Partial<Record<DesigncutLayoutVariant, (ctx: CutContext) => CutResult | null>>>
> = {
  T3a: { zigzag: buildT3aZigzag, grid: buildT3aGrid, half: buildT3aHalf, cards: buildT3aCards },
  T11: { zigzag: withLayerBand(buildT11Zigzag) },
}
const builderOf = (template: DesigncutTemplate, ctx: CutContext) =>
  (ctx.scene && VARIANT_BUILDERS[template]?.[ctx.section.layoutVariant ?? 'scene']) || BUILDERS[template]

/** section_images 리스트형 키의 접두어 → generated_images 필드(pdp-image-tasks LIST_SECTION_KEYS와 같은 규약) */
const LIST_KEYS: Record<string, string> = { features: 'features', howto: 'howToImages', usp_icons: 'usp_icons' }

/** 키 → URL. 기존 빌더처럼 자리표시·생성 실패 URL은 버려(sanitizeImageUrl) 플레이트·컷 대체 규칙이 걸리게 한다. 리스트 번호는 정수만 */
export function resolveImage(images: Record<string, string | string[]>, key: string | null): string | null {
  if (!key) return null
  const direct = images[key]
  if (typeof direct === 'string') return sanitizeImageUrl(direct) || null
  const [prefix, index] = key.split(':')
  const list = images[LIST_KEYS[prefix] ?? prefix]
  if (Array.isArray(list)) return /^\d+$/.test(index ?? '') ? sanitizeImageUrl(list[Number(index)]) || null : null
  return index === undefined && typeof list === 'string' ? sanitizeImageUrl(list) || null : null
}

/**
 * K 템플릿 칸 값 → URL. 컷 칸 값은 section_images 키이고, 입력 사진 칸(option.images·option.lineup)은 값이 사진 주소 그대로다(컷을 만들지 않는다).
 * 키로 못 찾은 값만 주소로 본다. 자리표시·생성 실패 주소는 실물 판정(isRealOptionPhoto)이 걸러 사진 없이 그린다. D 라인은 키만 쓰므로 resolveImage를 그대로 쓴다
 */
export function resolveTemplateImage(images: Record<string, string | string[]>, value: string | null): string | null {
  const byKey = resolveImage(images, value)
  if (byKey) return byKey
  return value && isRealOptionPhoto(value) ? value.trim() : null
}

type Item = { kind: 'cut'; section: DesigncutSection } | { kind: 'kept'; key: string }

/** 계약의 order(페이지 순서)대로 — sections 키면 템플릿, 아니면 kept. order에 없는 섹션은 그리지 않는다 */
function itemsByOrder(plan: CutPlan): Item[] {
  const byKey = new Map(plan.sections.map((s) => [s.key, s]))
  const omitted = new Set(plan.omitted.map((o) => o.key))
  const seen = new Set<string>()
  const items: Item[] = []
  for (const key of plan.order) {
    // 중복·omitted는 건너뛰고, sections에 없는 키는 kept에 있을 때만 기존 섹션으로 그린다
    if (seen.has(key) || omitted.has(key)) continue
    seen.add(key)
    const section = byKey.get(key)
    if (section) items.push({ kind: 'cut', section })
    else if (plan.kept.includes(key)) items.push({ kind: 'kept', key })
  }
  return items
}

/** order가 없는 기록(초기 형태) — section_order에서 기본 키의 위치(없으면 맨 뒤), 같은 위치는 기록 순서 */
function itemsBySectionOrder(plan: CutPlan, sectionOrder: string[]): Item[] {
  const at = (key: string) => {
    const i = sectionOrder.indexOf(baseKeyOf(key))
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const omitted = new Set(plan.omitted.map((o) => o.key))
  const items: Item[] = [
    ...plan.sections.map((section) => ({ kind: 'cut' as const, section })),
    ...plan.kept.filter((key) => !omitted.has(key)).map((key) => ({ kind: 'kept' as const, key })),
  ]
  const keyOf = (item: Item) => (item.kind === 'cut' ? item.section.key : item.key)
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => at(keyOf(a.item)) - at(keyOf(b.item)) || a.i - b.i)
    .map((x) => x.item)
}

const proTypeOf = (key: string): ProSectionType | null => mapBackendSectionsToProTypes([baseKeyOf(key)])[0] ?? null
/** 같은 문구 비교용 — 소문자, 공백(줄바꿈 없는 공백 포함)·문장부호·기호 제거 */
const normText = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

export interface DesignCutStats {
  /** 템플릿으로 그린 섹션 수 */
  rendered: number
  /** 데이터 부족으로 기존 섹션·다른 템플릿으로 대체한 키 */
  fallbacks: Array<{ key: string; template: DesigncutTemplate; to: string }>
  /** 구매 전 확인 표에 넣은 행 이름(넣지 않았으면 없음) */
  purchaseCheck?: string[]
}

export function composeDesignCut(
  converted: CanvasSection[],
  plan: CutPlan,
  input: {
    images: Record<string, string | string[]>
    sectionOrder: string[]
    stats?: DesignCutStats
    /** 구매 전 확인 판정 입력(spec_sheet) — 없으면 표를 넣지 않는다 */
    specSheet?: Record<string, unknown>
    /** D2-3 첫 화면 글자 자리(hero 측정 — 편집기 응답 hero_copy_zone). D2 장면 모드에서만 쓴다 */
    heroCopyZone?: { pass: boolean; ink: 'dark' | 'light' } | null
    /** D2 장면 사진의 실제 가로/세로(이미지 URL 키 — 편집기 응답 image_aspects). D2 장면 모드에서만 쓴다 */
    imageAspects?: Record<string, number> | null
    /** 사이즈 단독 컷의 제품 경계(이미지 URL 키 — 편집기 응답 product_boxes). 없으면 치수선 없이 글자만 */
    productBoxes?: Record<string, ProductBox> | null
    /** 카피 howTo 단계 제목(순서 그대로) — T5 단계 사진(stepImagesOf)의 howto:j 대조용. 없으면 위 사진 한 장(지금 렌더) */
    howToSteps?: ReadonlyArray<string | null | undefined> | null
    /**
     * 페이지에서 뺀 컷 키(편집기 응답 dropped_cuts — usegate 잡의 쓰는 법 미달 컷, J44). K 섹션 목록에서 그 컷이 든 항목을 글째 빼고 남은 수로 그린다.
     * 없으면 지금 그대로
     */
    droppedCuts?: readonly string[] | null
  }
): CanvasSection[] {
  // D2 장면 모드(C1·C2·C4): designcut2 잡의 아트 디렉션이 있고 렌더 v2일 때만. 편집기 토큰은 아트 디렉션을 읽는다 — 스튜디오 면·강조색·
  // 모서리 문법. 그 밖의 잡은 지금 토큰 그대로
  const art = plan.layout === 2 ? plan.artDirection : undefined
  const planColors = colorsOf(plan)
  // palette2(PALETTE2.md): playful 잡은 밝은 고채도 팔레트 — 스튜디오·주색·강조 글자·제목·짙은 색(스크림)을 아트 디렉션 v2에서 읽고
  // 짙은 전환 면을 옅은 스튜디오 면으로, 장 번호 캡슐을 스티커 배지(주색·보조색 교대)로 그린다. 사진·컷 바탕은 그대로
  const p2 = art?.palette2
  const playful = p2?.tone === 'playful' ? (p2.colors ?? null) : null
  const accent = playful?.primary ?? art?.background.accent
  // 노란 강조색·주색(장면 모드, palette2 버터 포함) — 강조 글자·장 번호·라벨·제목은 잉크, 강조 구절은 형광 띠(highlight), 짙은 면은
  // 잉크(SPACING-LAYOUT.md ④). 잉크는 이 계획의 잉크라 예전에 기록된 버터 계획(강조 글자 #806C02)도 첫 빌드에서 고친다
  const yellow = Boolean(art) && isYellowHue(accent ?? '')
  const colors = art
    ? {
        ...planColors,
        neutral: playful?.studio ?? art.background.studio,
        accent: accent!,
        onAccent: onColor(accent!, planColors.ink),
        ...(playful
          ? { accentText: playful.accentText, heading: playful.heading, deep: playful.deep, tint: playful.studio, highlight: false }
          : {}),
        ...(yellow ? { accentText: planColors.ink, heading: planColors.ink, deep: planColors.ink, highlight: true } : {}),
      }
    : planColors
  const radius = playful ? PLAYFUL_RADIUS : radiusOf(art ? { badge: art.corners === 'sharp' ? 'SHARP' : 'SOFT' } : plan.motif)
  const image = (key: string | null) => resolveImage(input.images, key)
  const byType = new Map<string, CanvasSection>()
  for (const sec of converted) if (!byType.has(sec.sectionType)) byType.set(sec.sectionType, sec)
  const byTypeOf = (key: string) => {
    const type = proTypeOf(key)
    return type ? byType.get(type) : undefined
  }

  const sorted: Item[] = plan.order.length > 0 ? itemsByOrder(plan) : itemsBySectionOrder(plan, input.sectionOrder)

  // 페이지의 POINT 제목(정규화) — 예전 계획 기록의 해결 체크리스트 중복 정리용
  const pointHeadlines = new Set(
    plan.sections.filter((p) => p.chapter !== null && p.text.headline).map((p) => normText(p.text.headline!))
  )
  /** 해결 체크리스트가 POINT 제목과 겹쳐 3개가 안 남아 기존 해결 섹션으로 그려질 기록(아래 루프와 같은 판정) */
  const solutionFallsBack = (section: DesigncutSection) => {
    const items = toCutSection(section).modules.items
    if (baseKeyOf(section.key) !== 'solution_guide' || !items) return false
    const left = items.filter((t) => !pointHeadlines.has(normText(t)))
    return left.length < items.length && left.length < 3
  }

  // 렌더 v2(plan.layout 2): 강조 구절용 USP 낱말(POINT 제목)·페이지 체크 상한 4, 바탕은 막 단위로 다시 정한다(layout2.ts).
  // 기존 섹션으로 그려질 해결 체크리스트는 kept로 센다 — 짙은 전환 면이 그려지지 않는 섹션에 걸리지 않게(R5-D 예전 기록)
  const v2: V2Context | undefined =
    plan.layout === 2
      ? {
          usp: uspWordsOf(plan.sections.filter((p) => p.chapter !== null).map((p) => p.text.headline)),
          budget: { checks: 4 },
          points: pagePointsOf(plan.sections),
        }
      : undefined
  const v2Bgs = v2
    ? assignActBackgrounds(
        sorted.map((item): BgRow => {
          if (item.kind === 'kept' || solutionFallsBack(item.section)) {
            const key = item.kind === 'kept' ? item.key : item.section.key
            return { key, role: null, template: null, keptFill: byTypeOf(key)?.canvas.backgroundColor ?? null }
          }
          const { key, role, template } = item.section
          return { key, role, template: template === 'T3b' ? 'T3a' : template, bandEnd: isBandEndPoint(item.section) }
        }),
        isWhite(colors.photo),
        Boolean(art),
        Boolean(playful)
      )
    : null
  // T1·T3a·T8이 흰 띠 제목 + 860 풀폭 장면 사진(실제 비율 4:3~3:4), 첫 화면은 글자 자리 겹침(D2-3)
  const aspects = input.imageAspects ?? {}
  const scene: SceneContext | undefined = art
    ? {
        band: art.background.base,
        heroZone: input.heroCopyZone ?? null,
        ...(p2 ? { hook: HOOK_TYPE[p2.tone] } : {}),
        ...(playful ? { noDark: true } : {}),
        aspectOf: (src) => (typeof aspects[src] === 'number' ? aspects[src] : null),
        productBoxOf: (src) => input.productBoxes?.[src] ?? null,
      }
    : undefined
  // 장면 모드 글자 토큰(SCENE_TYPE — 줄 간격 넓힘)·여백은 디자인 컷 섹션과 구매 전 확인 표가 같이 쓴다
  const sceneCtx = scene ? { scene, type: SCENE_TYPE } : {}
  // 뺀 컷(J44) — K 섹션 목록에서 그 컷이 든 항목을 뺀다. 칸이 없는 응답(꺼진 잡·뺀 컷 없는 잡)은 지금 그대로
  const dropped = input.droppedCuts?.length ? new Set(input.droppedCuts) : undefined

  const out: CanvasSection[] = []
  /** 구역 연결 표식을 붙일 고민(T2) 섹션 id → 그 바탕 글자색(D6 P5 — 여백 맞춤 뒤에 붙인다) */
  const linkInks = new Map<string, { text: string }>()
  /** 사이즈·상품 정보가 시작하는 자리(factsLast) — 구매 전 확인 표가 끝 두 자리를 밀어내지 않게 그 앞에 놓는다(오너 지시 2026-11-01) */
  let factsAt: number | null = null
  const usedFallback = new Set<string>()
  /** 기존 빌더 섹션을 그대로 — v2가 밝은 유채색(tint) 바탕을 흰·스튜디오로 다시 칠하라고 하면(recolor) 사본의 바탕만 바꾼다 */
  const pushExisting = (key: string, recolor?: DesigncutBg | null) => {
    const existing = byTypeOf(key)
    if (!existing || usedFallback.has(existing.id)) return false
    usedFallback.add(existing.id)
    out.push(recolor ? { ...existing, canvas: { ...existing.canvas, backgroundColor: surfaceOf(recolor, colors).fill } } : existing)
    return true
  }

  for (const [index, item] of sorted.entries()) {
    const v2Bg = v2Bgs?.[index] ?? null
    if (item.kind === 'kept') {
      pushExisting(item.key, v2Bg)
      continue
    }
    let s = toCutSection(item.section)
    // 사이즈 행렬(long:matrix, D2)은 사이즈 바로 앞 — 구매 전 확인 표가 행렬과 사이즈 사이에 끼지 않게 그 앞을 묶음 시작으로 본다
    if (plan.factsLast && factsAt === null && (s.template === 'T6' || s.key === 'long:info' || s.key === 'long:matrix')) factsAt = out.length
    // K 섹션의 바탕은 순서 풀이가 템플릿이 받는 바탕 안에서 정했다 — 막 배정이 덮지 않는다
    if (v2Bg && !s.templateRef) s = { ...s, bg: v2Bg }
    const split = s.key.includes(':')
    const wasT3b = s.template === 'T3b'
    // 예전 계획 기록도 새 배치 규칙으로 그린다(2026-10-30, B 배치 점검): POINT의 T3b(사진 → 글)는 T3a(장 머리·제목 → 사진),
    // 해결 체크리스트는 POINT 제목과 같은 항목을 빼고 3개가 안 되면 기존 해결 섹션(요약 문구)으로 — 계획 단계(designcut-plan)와 같은 규칙
    if (wasT3b) s = { ...s, template: 'T3a' }
    if (baseKeyOf(s.key) === 'solution_guide' && s.modules.items) {
      const items = s.modules.items.filter((t) => !pointHeadlines.has(normText(t)))
      if (items.length < s.modules.items.length) {
        if (items.length < 3) {
          const replaced = pushExisting(s.key, v2Bg)
          input.stats?.fallbacks.push({ key: s.key, template: s.template, to: replaced ? 'existing' : 'none' })
          continue
        }
        s = { ...s, modules: { ...s.modules, items } }
      }
    }
    const stepImages = s.template === 'T5' ? stepImagesOf(s.modules.steps ?? [], input.howToSteps, image) : null
    const ctx: CutContext = { section: s, colors, radius, image, v2, ...sceneCtx, ...(stepImages ? { stepImages } : {}) }
    let template = s.template
    // 템플릿 조합 라인(15_TEMPLATE_LINE §10): 선택 기록이 있는 섹션만 엔진으로 그린다. 기록이 없는 잡은 이 분기를 지나지 않는다
    const kTemplate = s.templateRef ? templateById(s.templateRef.id) : undefined
    const kResult =
      kTemplate && s.templateRef
        ? renderTemplate(kTemplate, s.templateRef.slots, {
            colors: plan.templateColors ?? colors,
            // 컨셉 모서리(T1-28) — K 섹션만 카드·사진·캡슐을 덮는다. 칸이 없으면(옛 잡·D) 계획 모서리 그대로
            radius: plan.templateRadius ? { ...radius, ...plan.templateRadius } : radius,
            image: (value) => resolveTemplateImage(input.images, value),
            bg: s.bg,
            usp: v2?.usp,
            // 모델이 고른 강조 구절(T1-17) — 옛 잡은 칸이 없어 지금 규칙
            ...(s.templateRef.accent ? { accentPhrase: s.templateRef.accent } : {}),
            aspectOf: scene?.aspectOf,
            productBoxOf: (src) => input.productBoxes?.[src] ?? null,
            ...(dropped ? { dropped } : {}),
          })
        : null
    if (s.templateRef && !kResult) input.stats?.fallbacks.push({ key: s.key, template: s.template, to: 'template-fallback' })
    let result = kResult ?? builderOf(template, ctx)?.(ctx) ?? null
    // usp 조각(point_div:<i>)은 기존 섹션으로 대체하지 않는다 — 기존 point_div는 POINT 전체라 중복된다.
    // 제품 컷이 없으면 대표 컷(hero)으로 T3a를 그리고, 그것도 안 되면 뺀다
    if (!result && template === 'T3a' && (split || wasT3b)) {
      const heroCtx = { ...ctx, section: { ...s, productImageKey: 'hero' } }
      result = builderOf('T3a', heroCtx)?.(heroCtx) ?? null
      if (result) {
        input.stats?.fallbacks.push({ key: s.key, template: s.template, to: 'T3a' })
        template = 'T3a'
      }
    }
    if (!result) {
      const replaced = split ? false : pushExisting(s.key)
      input.stats?.fallbacks.push({ key: s.key, template: s.template, to: replaced ? 'existing' : 'none' })
      continue
    }
    // fillacts — 큰 POINT 사진 한 장 더(D2 장면 모드, K 경로 제외)
    if (scene && !kResult && template === 'T3a') result = appendPointPhoto(result, ctx)
    const type = kResult && kTemplate ? (SECTION_TABLE[kTemplate.section].proType as ProSectionType) : (proTypeOf(s.key) ?? ProSectionType.POINT_DIV)
    out.push({
      id: uid('sec'),
      sectionType: type,
      groupType: byType.get(type)?.groupType ?? 'modules',
      order: 0,
      isVisible: true,
      layoutId: kResult && kTemplate ? `${K_LAYOUT_PREFIX}${kTemplate.id}` : `designcut_${template}`,
      canvas: { width: 860, height: result.height, backgroundColor: result.background },
      elements: result.elements,
      needsInitialReflow: result.reflow === true || Boolean(kResult),
      ...(kResult ? { preserveBottomPad: true } : {}),
    })
    // 구역 연결 표식(D6 P5 R-W9·T2-13) — 계획 표지가 있는 고민 칸, D2 장면 모드만
    if (scene && !kResult && template === 'T2' && s.linkBelow) linkInks.set(out[out.length - 1].id, surfaceOf(s.bg, colors))
    if (input.stats) input.stats.rendered++
  }
  const purchase = insertPurchaseCheck(out, input.specSheet, { colors, radius, image, v2, ...sceneCtx }, plan.factsLast ? { at: factsAt ?? out.length } : {})
  if (input.stats && purchase.rows.length > 0) input.stats.purchaseCheck = purchase.rows.map((r) => r.label)
  const ordered = purchase.sections.map((sec, i) => ({ ...sec, order: i }))
  // D2 장면 모드는 섹션 아래 여백을 120 이상으로 맞추고 경계 목표를 260으로 넓힌다(SPACING-LAYOUT.md ①, 통합 결정 10-31)
  // K 섹션끼리는 여백 호흡 3단계(K9 개선 #11)로 경계를 맞추고, 그 경계는 M4 장면 모드 상한(300)까지 둔다
  const seamed = scene ? tightenSeams(breatheKSeams(ordered.map(padSceneBottom)), SCENE_SEAM_MAX, K_SEAM_MAX) : tightenSeams(ordered, SEAM_MAX)
  // 구역 연결 표식은 아래 여백이 정해진 뒤 섹션 끝에 붙인다(높이는 그대로, 여백이 모자라면 그리지 않는다)
  const linked = linkInks.size === 0 ? seamed : seamed.map((sec) => withLinkOf(sec, linkInks.get(sec.id), colors.accent))
  // 제목 자간은 K 짝(templateFontPair)에만 — D 아트 디렉션 짝은 지금 자간 그대로다
  const tracking = plan.templateFontPair ? headingTrackingOf(plan.templateFontPair) : undefined
  const sections = withFontPair(linked, plan.templateFontPair ?? art?.fontPair, tracking)
  // v2(C3): 같은 바탕 경계 구분선 대신 사진 하단 페이드 — 바탕은 흰·스튜디오 교대라 단색끼리 같은 바탕이 이어지지 않는다
  return v2 ? fadePhotoBottoms(sections, colors.photo) : separateSameBackgrounds(sections, colors.ink)
}

/** 페이지 POINT 목록(chapter 순, 같은 chapter는 처음 것) — POINT 머리 진행 표시(R-W7)의 이름·순번. 제목은 계획 글 그대로 */
function pagePointsOf(sections: readonly DesigncutSection[]): PagePoint[] {
  const seen = new Set<number>()
  return sections
    .filter((p): p is DesigncutSection & { chapter: number } => p.chapter !== null && !seen.has(p.chapter) && Boolean(seen.add(p.chapter)))
    .sort((a, b) => a.chapter - b.chapter)
    .map((p) => ({ chapter: p.chapter, headline: p.text.headline }))
}

/** 같은 바탕 연속 구분선 — 폰에서 1px(캔버스 2px), 본문 폭 */
const DIVIDER_H = 2

/**
 * 같은 단색 바탕이 이어지는 경계에 얇은 선을 긋는다(디자인 컷 섹션이 낀 경계만).
 * 계획의 짙은 바탕 상한이 강한 제약이 되면서 밝은 상품은 W→W처럼 같은 바탕이 이어질 수 있다 — 그러면 앞 섹션 끝과
 * 뒤 섹션 머리가 한 덩어리로 읽힌다. 여백 띠는 높이를 늘리고 경계 빈 바탕 상한(M4·tightenSeams)과 부딪치므로,
 * 높이를 늘리지 않는 선으로 경계만 표시한다. 선은 뒤 섹션 맨 위(뒤가 kept면 앞 섹션 맨 아래)에 둔다.
 */
function separateSameBackgrounds(sections: CanvasSection[], ink: string): CanvasSection[] {
  return sections.map((sec, i) => {
    const prev = sections[i - 1]
    const next = sections[i + 1]
    const sameAsPrev = Boolean(prev) && isDesignCut(sec) && sameFlatBackground(prev, sec)
    const sameAsNextKept = Boolean(next) && isDesignCut(sec) && !isDesignCut(next) && sameFlatBackground(sec, next)
    if (!sameAsPrev && !sameAsNextKept) return sec
    const dark = onColor(sec.canvas.backgroundColor, ink) === WHITE
    const line = (y: number): CanvasElement => ({
      id: uid('shp'),
      type: 'shape',
      name: 'designcut-divider',
      transform: { x: MARGIN, y, width: CONTENT_W, height: DIVIDER_H, rotation: 0 },
      zIndex: 0,
      isLocked: false,
      isVisible: true,
      opacity: 1,
      shapeProps: { shapeType: 'rect', fill: rgba(dark ? WHITE : ink, dark ? 0.24 : 0.14) },
    })
    return {
      ...sec,
      elements: [
        ...(sameAsPrev ? [line(0)] : []),
        ...sec.elements,
        ...(sameAsNextKept ? [line(sec.canvas.height - DIVIDER_H)] : []),
      ],
    }
  })
}

/** 둘 다 같은 단색 바탕인가(그라데이션은 섹션마다 달라 비교하지 않는다) */
function sameFlatBackground(a: CanvasSection, b: CanvasSection): boolean {
  const [x, y] = [a.canvas.backgroundColor, b.canvas.backgroundColor]
  return Boolean(x) && !x.includes('gradient') && x.toLowerCase() === y.toLowerCase()
}

/** 섹션 경계의 빈 바탕 목표(모바일 M4 상한 200보다 여유) */
const SEAM_MAX = 180
/**
 * D2 장면 모드 경계 목표 — 섹션 위 120 + 앞 섹션 아래 120~140(NEXFIT 약 280 쪽으로, 통합 결정 10-31). 판독 규칙 M4도 장면 모드
 * 디자인 컷 경계는 MOBILE_LIMITS.maxSceneSeamBlankPx(300)로 잰다
 */
const SCENE_SEAM_MAX = 260
const SEAM_MIN_PAD = 24
const isDesignCut = (s: CanvasSection) => s.layoutId.startsWith('designcut_')
/** K 템플릿으로 그린 섹션 — designcut_ 접두어라 디자인 컷 경계 규칙을 그대로 받는다 */
const K_LAYOUT_PREFIX = 'designcut_k_'

/** 내용 위·아래 끝 — M4처럼 섹션 전면 바탕 도형(80% 이상)은 내용으로 세지 않는다 */
function contentSpan(sec: CanvasSection): { top: number; bottom: number } | null {
  const content = sec.elements.filter(
    (e) =>
      e.isVisible !== false &&
      e.transform.height > 0 &&
      !(
        e.type === 'shape' &&
        e.transform.width >= sec.canvas.width * 0.8 &&
        e.transform.height >= sec.canvas.height * 0.8
      )
  )
  if (content.length === 0) return null
  return {
    top: Math.min(...content.map((e) => e.transform.y)),
    bottom: Math.max(...content.map((e) => e.transform.y + e.transform.height)),
  }
}

/** 표지된 섹션에만 구역 연결 표식 — 내용 아래 끝부터 섹션 끝 사이(zoneLink.ts) */
function withLinkOf(sec: CanvasSection, surf: { text: string } | undefined, accent: string): CanvasSection {
  const span = surf ? contentSpan(sec) : null
  return surf && span ? withZoneLink(sec, span.bottom, surf, accent) : sec
}

/**
 * 디자인 컷 섹션과 이웃한 경계의 빈 바탕을 줄인다 — kept 섹션의 위·아래 여백은 기존 빌더 몫이라 미리 알 수 없어,
 * 합이 seamMax를 넘으면 디자인 컷 쪽(앞 섹션의 아래 여백, 그다음 뒤 섹션의 위 여백)을 깎는다. kept 섹션은 건드리지 않는다.
 * K 섹션끼리의 경계는 kSeamMax까지 둔다(여백 호흡 넓음 150 + 150).
 */
function tightenSeams(sections: CanvasSection[], seamMax: number, kSeamMax = seamMax): CanvasSection[] {
  const out = sections.map((s) => ({ ...s, canvas: { ...s.canvas }, elements: [...s.elements] }))
  for (let i = 0; i + 1 < out.length; i++) {
    const [a, b] = [out[i], out[i + 1]]
    if (!isDesignCut(a) && !isDesignCut(b)) continue
    const spanA = contentSpan(a)
    const spanB = contentSpan(b)
    if (!spanA || !spanB) continue
    let tail = a.canvas.height - spanA.bottom
    const head = spanB.top
    const max = kTemplateOf(a) && kTemplateOf(b) ? Math.max(seamMax, kSeamMax) : seamMax
    if (tail + head <= max) continue
    // 이웃이 kept면 그쪽 여백이 간격 역할을 하므로 디자인 컷 쪽은 0까지 깎는다. 디자인 컷끼리는 최소 여백을 남긴다
    const minA = isDesignCut(b) ? SEAM_MIN_PAD : 0
    const minB = isDesignCut(a) ? SEAM_MIN_PAD : 0
    if (isDesignCut(a) && tail > minA) {
      const cut = Math.min(tail + head - max, tail - minA)
      a.canvas.height -= cut
      tail -= cut
    }
    if (tail + head > max && isDesignCut(b) && head > minB) {
      const shift = Math.min(tail + head - max, head - minB)
      b.elements = b.elements.map((e) => ({ ...e, transform: { ...e.transform, y: e.transform.y - shift } }))
      b.canvas.height -= shift
    }
  }
  return out
}

/**
 * D2 장면 모드 — 글로 끝나는 디자인 컷 섹션(구매 전 확인 표 포함)은 내용 아래 여백을 SCENE_SPACE.bottom(120) 이상으로 늘린다(템플릿은
 * 36~80으로 끝난다). 풀폭 사진·무드 판이 아래 끝까지 닿는 섹션은 그대로 둔다(사진 밑에 빈 띠가 생긴다)
 */
function padSceneBottom(sec: CanvasSection): CanvasSection {
  // K 템플릿은 자기 spacing으로 끝난다(풀폭 띠로 끝나면 아래 여백 0)
  if (!isDesignCut(sec) || endsWithPhoto(sec) || sec.layoutId.startsWith(K_LAYOUT_PREFIX)) return sec
  const span = contentSpan(sec)
  if (!span) return sec
  const height = Math.max(sec.canvas.height, Math.ceil(span.bottom + SCENE_SPACE.bottom))
  return height === sec.canvas.height ? sec : { ...sec, canvas: { ...sec.canvas, height } }
}
const endsWithPhoto = (sec: CanvasSection) =>
  sec.elements.some(
    (e) => e.type === 'framed-image' && e.transform.width >= W && e.transform.y + e.transform.height >= sec.canvas.height
  )

/** 글꼴 짝이 바꾸는 글자 수준 — 첫 화면·섹션·POINT 제목과 장 번호. 본문·표·캡션(body·caption)은 Pretendard 그대로 */
const PAIR_HEADING_LEVELS = new Set(['display', 'h1', 'h2'])

/**
 * fontpair(디자인 폰트 계획 ①) — 페이지 모든 섹션의 제목 수준 글자에 짝의 제목 글꼴·굵기. 그대로 두는 기존 빌더 섹션(FAQ·배송 등)도
 * 맞춰 한 페이지에 제목 글꼴이 하나다(통합 결정 10-31). 크기·줄 간격과 본문·표·캡션은 그대로.
 * tracking(K 굵은 고딕 짝, K9)이 있으면 제목 자간을 글자 크기 × tracking(px, 소수 첫째 자리)으로 둔다. 좁히기만 하므로 줄 수가 늘지 않는다
 */
function withFontPair(sections: CanvasSection[], pair: { heading: string; weight: number } | undefined, tracking?: number): CanvasSection[] {
  if (!pair) return sections
  const spacing = (fontSize: number, current: number) => (tracking === undefined ? current : Math.round(fontSize * tracking * 10) / 10)
  return sections.map((sec) => ({
    ...sec,
    elements: sec.elements.map((el) =>
      el.textProps && PAIR_HEADING_LEVELS.has(el.textProps.typoLevel ?? '')
        ? {
            ...el,
            textProps: {
              ...el.textProps,
              fontFamily: pair.heading,
              fontWeight: pair.weight,
              letterSpacing: spacing(el.textProps.fontSize, el.textProps.letterSpacing),
            },
          }
        : el
    ),
  }))
}
