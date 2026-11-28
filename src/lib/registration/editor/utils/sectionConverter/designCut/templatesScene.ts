/**
 * 장면형 템플릿 — 08 §3 T1·T3a·T3c·T8. 좌표는 명세 기준이고, 모바일 검사기와 2026-10-28 디자인 컷 검토에 맞춰 다음을 바꿨다.
 * - 상품 사진은 카드·그림자·받침 없이 contain으로, 사진 배경색 무대(섹션 바탕 또는 무대 띠) 위에 얹는다 — 사진이 잘리지 않고 액자처럼 뜨지 않는다.
 *   상자는 생성 비율(제품 컷 3:4)에 맞춰 여백이 생기지 않게 하고, 비율이 달라 남는 자리는 무대 색이 비친다
 * - 상품 섹션에는 플레이트를 깔지 않는다(T3c 분위기 섹션과 상품 없는 T8만 플레이트)
 * - 사진 위 글자는 스크림 안에 둔다(M2)
 * - POINT는 T3a(장 머리·제목 → 사진) 한 순서다. 예전 계획 기록의 T3b(사진 → 글 띠)는 조립이 T3a로 그린다(2026-10-30, B 배치 점검 ①)
 * - 장 머리는 압축형("POINT 01" 캡슐 한 줄 + 헤드라인) — 캡슐만 한 줄을 차지해 좁은 글자 열이 생기지 않는다(M6)
 * - 제품 사진 높이는 500 이상(M5, main_cut·point_div)
 * 글자가 길어 넘치면 자르지 않고 아래 요소를 밀고 섹션을 늘린다(통합 결정). 필수 데이터가 없으면 null(호출 측이 대체).
 * D2 장면 모드(ctx.scene — designcut2 잡 + 렌더 v2, PDP-DR-PLAN §2 C2·C4): T1·T3a·T8의 상품 장면 컷은 무대 띠·액자 없이 860 풀폭(3:4
 * cover)으로, 제목은 그 위 흰 띠(아트 디렉션 바탕 base)에 둔다. 첫 화면은 글자 자리 측정이 통과하면 사진 위 글자 자리에 얹는다(D2-3).
 * 큰 POINT의 형태 변형(zigzag·grid)은 templatesVariant가 그린다(compose VARIANT_BUILDERS).
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import type { ProductBox } from '@/lib/registration/pdp-state'
import { COPY_ZONE_MEASURE_BOTTOM } from '@/lib/registration/internalized/hero-copy-zone'
import { OVERLAY_SCRIM_MAX, SCRIM_FADE_H, SCRIM_FILM_NAME, SCRIM_NAME, overlayFilm, scrimFilmSvg, type OverlayFilm } from '@/lib/registration/templatelib/overlay'
import { uid } from '../helpers'
import type { CutSection } from './contract'
import { CutBuilder, SCENE_HOOK_STEP_SIZES, approxTextWidth, contain, fitHookToken, measureCutText, type Accent } from './build'
import { drawSceneBadge } from './inputDevices'
import { drawMessageHead } from './messageHead'
import { drawPointSteps, type PagePoint } from './pointSteps'
import {
  MARGIN,
  CONTENT_W,
  HOOK_LINE,
  SCENE_SPACE,
  TYPE,
  W,
  emphasisOn,
  fallbackGradient,
  headingOn,
  onColor,
  rgba,
  surfaceOf,
  type Colors,
  type TypeSet,
  type TypeToken,
} from './tokens'

/** 이 섹션의 글자 토큰 묶음 */
export const tk = (ctx: { type?: TypeSet }): TypeSet => ctx.type ?? TYPE

/** 첫 화면 후킹 문장(계획 T1 text.hook — mainIntro.hook). 없으면 null */
const hookOf = (s: CutSection): string | null => s.text.hook?.trim() || null

/** 렌더 v2(plan.layout 2, PDP-DR-PLAN §1) 조립 상태 — 페이지 USP 낱말(강조 구절)과 페이지 상한(체크 행 수) */
export interface V2Context {
  usp: readonly string[]
  budget: { checks: number }
  /** 페이지 POINT(chapter 순) — POINT 머리 진행 표시(R-W7, pointSteps.ts). 없으면 그리지 않는다 */
  points?: readonly PagePoint[]
}

/** D2 장면 모드(designcut2 잡의 아트 디렉션 + 렌더 v2) 조립 상태 */
export interface SceneContext {
  /** 제목 띠 색 — 아트 디렉션 바탕 체계의 base(흰 기본) */
  band: string
  /** D2-3 첫 화면 글자 자리(hero SectionImage.copyZone 측정) — 통과면 사진 위 글자 자리에 제목을 얹는다. 없으면 띠형 */
  heroZone?: { pass: boolean; ink: 'dark' | 'light' } | null
  /** 장면 사진의 실제 가로/세로(이미지 단계 기록 — 편집기 응답 image_aspects). 모르면 null(API 생성 2:3으로 본다) */
  aspectOf?: (src: string) => number | null
  /** 사이즈 단독 컷의 제품 경계 */
  productBoxOf?: (src: string) => ProductBox | null
  /** palette2 첫 화면 제목(HOOK_TYPE) — 없으면 H1 */
  hook?: TypeToken
  /** palette2 playful — 짙은 면 없음: 분위기(T3c)를 흰 스크림·진한 글자·스튜디오 바탕으로 */
  noDark?: boolean
}

export interface CutContext {
  section: CutSection
  /** 글자 토큰 묶음 — D2 장면 모드는 SCENE_TYPE(줄 간격 넓힘), 없으면 TYPE */
  type?: TypeSet
  colors: Colors
  radius: { capsule: number; card: number; bubble: number; chip: number }
  image: (key: string | null) => string | null
  /** 없으면 v1 렌더 */
  v2?: V2Context
  /** 없으면 지금 렌더(무대 띠·액자) — D2 잡에서 v2와 함께만 */
  scene?: SceneContext
  /** T5 단계마다 그 단계 사용 컷 URL(stepImagesOf) — 맞는 컷이 2장 미만이면 없음(위 사진 한 장, 지금 렌더) */
  stepImages?: (string | null)[]
}

type Surf = ReturnType<typeof surfaceOf>

/**
 * v2 제목 강조(C5) — 강조색이 있으면 그 색 글자, 밝은 색상각(강조 글자색을 못 만듦)의 밝은 바탕은 accent 형광 띠. v1이면 null.
 * 구절은 계획에 모델이 고른 값(T1-17, section.text.accent)이 있고 그릴 글에 들어 있으면 그것, 아니면 USP 낱말·수량 규칙이다
 */
export function accentFor(ctx: CutContext, surf: Surf): Accent | null {
  if (!ctx.v2) return null
  const phrase = ctx.section.text.accent
  const color = emphasisOn(surf, ctx.colors)
  if (color) return { usp: ctx.v2.usp, phrase, css: `color:${color}` }
  return !surf.dark && ctx.colors.highlight ? { usp: ctx.v2.usp, phrase, css: `background-color:${rgba(ctx.colors.accent, 0.45)}` } : null
}

/** 머리 라벨 색 — v2 캡슐 없는 라벨(C5, 32px라 짙은 바탕도 대비 4.5)은 강조색, 못 만들면 바탕 글자색 */
export const labelColorOn = (surf: Surf, c: Colors) => emphasisOn(surf, c, 4.5) ?? surf.text

export interface CutResult {
  elements: CanvasElement[]
  height: number
  background: string
  /**
   * 마운트 리플로우를 켠다 — 겹친 레이어 없이 위에서 아래로 쌓은 템플릿만. 글자 높이 추정이 실제보다 크면 상자(containerOf)와
   * 섹션이 실측에 맞게 줄어든다(T2 말풍선: 한 줄 글인데 두 줄 높이 상자가 남았다, B 배치 점검 ⑨)
   */
  reflow?: boolean
}

const h = (token: TypeToken, text: string, width = CONTENT_W) =>
  measureCutText(text, token.size, token.lineHeight, width)
const two = (n: number) => String(n).padStart(2, '0')

/** 제품 컷 생성 비율 3:4(pdp-image-prompts hero·features·usage·cta) — 상자를 같은 비율로 잡아 contain 여백이 생기지 않게 한다 */
export const productBox = (width: number) => ({ width, height: Math.round((width * 4) / 3) })

/** 가운데 캡슐 x */
const centeredCapsuleX = (label: string) => Math.round((W - (approxTextWidth(label, TYPE.LABEL.size) + 56)) / 2)

/** 플레이트(분위기 섹션 전용) — 있으면 사진, 없으면 false(호출 측이 섹션 바탕 그라데이션으로 대체 — §2.5) */
function plate(b: CutBuilder, ctx: CutContext, y: number, height: number, crop?: { y: number; height: number }) {
  const src = ctx.image(ctx.section.plateKey)
  if (!src) return false
  b.image('designcut-plate', src, 0, y, W, height, {
    frame: 'plain',
    imageType: 'designcut_plate',
    ...(crop ? { crop: { x: 0, y: crop.y, width: 100, height: crop.height } } : {}),
  })
  return true
}

/**
 * 글자가 길어 섹션이 플레이트보다 길어지면 플레이트를 섹션 끝까지 늘린다(cover로 더 잘린다) — 아래에 바탕 띠가 남지 않게.
 * 크롭 창(T3c)은 늘린 상자와 비율이 달라지므로 빼고 cover로 둔다.
 */
function fitPlate(b: CutBuilder, height: number) {
  const el = b.elements.find((e) => e.name === 'designcut-plate' && e.transform.y === 0)
  if (!el || el.transform.height >= height) return
  el.transform.height = height
  if (el.framedImageProps) delete el.framedImageProps.cropRect
}

/**
 * 상품 사진 무대 — 섹션 바탕이 사진 배경색이 아니면 그 높이만큼 사진 배경색 띠를 깔고, 그 위에 사진을 contain으로 얹는다.
 * 컷은 계획이 같은 색 배경으로 생성하므로(designcut-palette cutBackgroundOf) 사진과 무대가 이어진다.
 */
export function productStage(
  b: CutBuilder,
  ctx: CutContext,
  sectionFill: string,
  src: string,
  stage: { y: number; height: number },
  box: { x: number; y: number; width: number; height: number },
  decor = false,
  crop?: { x: number; y: number; width: number; height: number },
  stageFill: string = ctx.colors.photo
) {
  if (sectionFill.toLowerCase() !== stageFill.toLowerCase()) b.shape('designcut-stage', 'rect', 0, stage.y, W, stage.height, { fill: stageFill })
  return b.product(src, box.x, box.y, box.width, box.height, { decor, sharp: ctx.radius.card <= 8, ...(crop ? { crop } : {}) })
}

/** 장면 사진 화면 비율 범위 — 가로/세로 0.75(3:4)~1.333(4:3). 이 밖의 사진은 cover로 남는 쪽을 가운데 기준으로 자른다 */
const SCENE_ASPECT = { min: 0.75, max: 4 / 3 }
/** 비율을 모르는 사진 — API 백엔드가 3:4 힌트로 내는 1024×1536(2:3) */
const DEFAULT_SCENE_ASPECT = 2 / 3
/** 겹침 글자 위 여백·스크림 아래 여백 — 제목 2줄이 비율 미상 컷의 글자 자리(316px)에 들어가게 */
const ZONE_TOP = 40
const ZONE_BOTTOM_PAD = 12
/** 첫 화면 큰 제목 줄 간격 하한(SPACING-LAYOUT.md ①) — 겹침 글자 자리에 맞춰 줄일 때도 이 아래로 내리지 않는다 */
const FIRST_SCREEN_MIN_LH = 1.35

/**
 * 장면 사진 상자 — 높이(860 ÷ 화면 비율)와 글자 자리 높이. 글자 자리는 측정 상자 아래 끝(원본 위 30%)을 화면에 옮긴 값이다:
 * cover가 위아래를 자르면(원본이 3:4보다 길면) 잘린 위쪽만큼 줄어든다
 */
export function sceneBoxOf(aspect: number | null | undefined): { height: number; zone: number } {
  const a = aspect && aspect > 0 ? aspect : DEFAULT_SCENE_ASPECT
  const shown = Math.min(SCENE_ASPECT.max, Math.max(SCENE_ASPECT.min, a))
  const height = Math.round(W / shown)
  const sourceHeight = a < shown ? W / a : height
  const cropTop = (sourceHeight - height) / 2
  return { height, zone: Math.floor(COPY_ZONE_MEASURE_BOTTOM * sourceHeight - cropTop) }
}
/** 비율을 모르는 장면 사진의 높이(1147)·글자 자리(316) */
export const SCENE_H = sceneBoxOf(null).height
export const COPY_ZONE_H = sceneBoxOf(null).zone

/** 제목 띠 면 — 아트 디렉션 base(흰 기본). 짙은 base가 와도 글자색은 대비로 정한다 */
export function bandOf(ctx: CutContext): Surf {
  const fill = ctx.scene!.band
  const text = onColor(fill, ctx.colors.ink)
  return { fill, text, dark: text.toLowerCase() === '#ffffff' }
}

const sceneBox = (ctx: CutContext, src: string) => sceneBoxOf(ctx.scene?.aspectOf?.(src))

/**
 * 플레이트 없는 짙은 섹션 바탕 — 대체 그라데이션(deep → accent 섞음). 장면 모드에서 강조색이 밝은 색상각(노랑 — highlight)이면 잉크에
 * 노랑을 섞어 짙은 올리브가 되므로 짙은 색 단색으로 둔다(SPACING-LAYOUT.md ④)
 */
const darkFill = (ctx: CutContext) => (ctx.scene && ctx.colors.highlight ? ctx.colors.deep : fallbackGradient(true, ctx.colors))

/** D2 장면 사진 — 860 풀폭 cover, 직각. decor면 T4 장식 대상(rect 액자). 반환값은 사진 높이 */
function scenePhoto(b: CutBuilder, ctx: CutContext, src: string, y: number, decor: boolean): number {
  const { height } = sceneBox(ctx, src)
  b.image('designcut-scene', src, 0, y, W, height, {
    frame: decor ? 'decor' : 'plain',
    sharp: true,
    fit: 'cover',
    imageType: 'designcut_product',
  })
  return height
}

/**
 * D2-3 첫 화면 겹침 — 글자 자리를 통과한 히어로는 사진을 맨 위에 풀폭으로 깔고 위 글자 자리에 제목(가운데)을 얹는다.
 * 글자 밑에는 옅은 스크림(자리가 밝으면 흰 35%, 어두우면 deep 28%)을 둬 판독 규칙(M2 — 사진 위 글자는 띠·스크림 위)을 지킨다.
 * 후킹 문장은 제목을 SCENE_HOOK_STEP_SIZES 안에서 줄여 함께 들어갈 때만 제목 위에 얹고, 아니면 사진 아래 흰 띠로 내린다(R17-L 11잡은 후킹 96 + 두 줄 제목
 * 72에서 205라 글자 자리 263을 넘어 전부 띠형이었다 — 후킹 때문에 겹침을 잃거나 제목을 84 아래로 줄이지 않게). 서브도 사진 아래 흰 띠다.
 * 제목만으로도 자리보다 길면 null(띠형)
 */
function buildT1Overlay(ctx: CutContext, product: string, ink: 'dark' | 'light'): CutResult | null {
  const { section: s, colors: c } = ctx
  // 첫 화면은 분류 글자(eyebrow)를 그리지 않는다(오너 지적 10-31) — 후킹 문장이 있으면 제목 위에
  const hookText = hookOf(s)
  const hookH = hookText ? h(HOOK_LINE, hookText) + 18 : 0
  // 첫 화면 제목(palette2 HOOK_TYPE·장면 H1 1.45)이 글자 자리를 넘으면 단계별로 줄여 본다(글꼴·굵기는 그대로, 줄 간격 하한 1.35 —
  // SPACING-LAYOUT.md ①). 큰 제목·넓힌 줄 간격 때문에 겹침 배치(D2-3)를 잃지 않게. 그래도 넘치면 띠형
  const base = ctx.scene?.hook ?? tk(ctx).H1
  const zone = sceneBox(ctx, product).zone
  const large = [base, ...SCENE_HOOK_STEP_SIZES.filter((size) => size < base.size).map((size) => ({ ...base, size, lineHeight: FIRST_SCREEN_MIN_LH }))]
  const small = [
    { ...base, size: 76, lineHeight: FIRST_SCREEN_MIN_LH },
    { ...base, size: TYPE.H1.size, lineHeight: FIRST_SCREEN_MIN_LH },
  ]
  const fits = (t: TypeToken, above: number) => ZONE_TOP + above + h(t, s.text.headline!) + ZONE_BOTTOM_PAD <= zone
  const withHook = hookText ? large.find((t) => fits(t, hookH)) : undefined
  const hook = withHook ?? [...large, ...small].find((t) => fits(t, 0))
  if (!hook) return null
  const hookAbove = withHook ? hookText : null
  const hookBelow = withHook ? null : hookText
  const textH = (hookAbove ? hookH : 0) + h(hook, s.text.headline!)
  const light = ink === 'light'
  const color = light ? c.onDeep : c.heading
  const b = new CutBuilder()
  const photoH = scenePhoto(b, ctx, product, 0, false)
  // 막은 글자 뒤 같은 농도로 깔고 아래는 사진으로 녹인다 — 곧은 경계가 제품·얼굴을 자르지 않게(render-check 41401903616 P06). 글자 자리 도형은 투명한 표지다
  const scrimH = ZONE_TOP + textH + ZONE_BOTTOM_PAD
  const film = light ? { color: c.deep, alpha: 0.28 } : { color: c.base, alpha: 0.35 }
  const fade = Math.min(SCRIM_FADE_H, photoH - scrimH)
  b.svg(SCRIM_FILM_NAME, scrimFilmSvg(film, uid('fade'), scrimH, fade, 'down'), 0, 0, W, scrimH + fade)
  const scrim = b.shape('designcut-scrim', 'rect', 0, 0, W, scrimH, { fill: 'transparent' })
  const before = b.elements.length
  let y = ZONE_TOP
  if (hookAbove) y = b.text('designcut-hook', hookAbove, HOOK_LINE, MARGIN, y, CONTENT_W, color, 'center').bottom + 18
  b.text('designcut-headline', s.text.headline!, hook, MARGIN, y, CONTENT_W, color, 'center')
  contain(
    scrim,
    b.elements.slice(before).filter((e) => e.type === 'text')
  )
  const band = bandOf(ctx)
  let under = photoH + SCENE_SPACE.titleGap
  if (hookBelow) under = b.text('designcut-hook', hookBelow, HOOK_LINE, MARGIN, under, CONTENT_W, labelColorOn(band, c), 'center').bottom + 24
  if (s.text.sub) under = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, under, CONTENT_W, band.text, 'center').bottom
  else if (hookBelow) under -= 24
  const height = hookBelow || s.text.sub ? under + SCENE_SPACE.bottom : photoH
  return { elements: b.elements, height, background: ctx.scene!.band }
}

/** D2 T1 — 글자 자리 통과면 겹침(D2-3), 아니면 흰 띠 위 후킹 문장·제목·서브(가운데, v2 강조 구절) + 풀폭 장면 사진 */
function buildT1Scene(ctx: CutContext, product: string): CutResult {
  const zone = ctx.scene!.heroZone
  const overlay = zone?.pass ? buildT1Overlay(ctx, product, zone.ink) : null
  if (overlay) return overlay
  const { section: s, colors: c } = ctx
  const band = bandOf(ctx)
  const b = new CutBuilder()
  // 첫 화면 순서(오너 지적 10-31): 후킹 문장 → 제목 → 보조 효익 → 사진. 분류 글자(eyebrow)는 그리지 않는다
  let y = SCENE_SPACE.top
  const hookText = hookOf(s)
  if (hookText) y = b.text('designcut-hook', hookText, HOOK_LINE, MARGIN, y, CONTENT_W, labelColorOn(band, c), 'center').bottom + 24
  // palette2 큰 제목은 2줄에 들어가는 크기로(오너 지시 11-01), 장면 H1은 그대로
  const headlineToken = ctx.scene?.hook ? fitHookToken(ctx.scene.hook, s.text.headline!, CONTENT_W, SCENE_HOOK_STEP_SIZES) : tk(ctx).H1
  y = b.text('designcut-headline', s.text.headline!, headlineToken, MARGIN, y, CONTENT_W, headingOn(band, c), 'center', accentFor(ctx, band)).bottom
  if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y + SCENE_SPACE.titleGap, CONTENT_W, band.text, 'center').bottom
  const photoY = y + SCENE_SPACE.photoGap
  const photoH = scenePhoto(b, ctx, product, photoY, false)
  return { elements: b.elements, height: photoY + photoH, background: band.fill }
}

/**
 * T1 HERO — 사진 배경색 바탕 위 eyebrow·헤드라인·서브 + 제품 사진(3:4 contain). 후킹은 카피·이미지만(오너 지시) —
 * 예전 계획 기록에 옵션 컬러칩(M8)이 남아 있어도 그리지 않는다(옵션은 T7)
 */
export function buildT1(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const product = ctx.image(s.productImageKey)
  if (!product || !s.text.headline) return null
  if (ctx.scene) return buildT1Scene(ctx, product)
  const surf = surfaceOf(s.bg, c)
  const b = new CutBuilder()
  let y = 80
  if (ctx.v2) {
    // v2(C5): 첫 화면은 가운데 정렬 축 — 라벨(캡슐 없음)·강조 구절 제목·서브 모두 가운데
    if (s.text.eyebrow) y = b.label('designcut-eyebrow', s.text.eyebrow, MARGIN, y, CONTENT_W, labelColorOn(surf, c), 'center') + 18
    y =
      b.text('designcut-headline', s.text.headline, tk(ctx).H1, MARGIN, y, CONTENT_W, headingOn(surf, c), 'center', accentFor(ctx, surf))
        .bottom + 16
    if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y, CONTENT_W, surf.text, 'center').bottom
  } else {
    if (s.text.eyebrow) {
      b.capsule('designcut-eyebrow', s.text.eyebrow, tk(ctx).LABEL, MARGIN, y, {
        fill: c.accent,
        text: c.onAccent,
        radius: ctx.radius.capsule,
      })
      y += 64 + 26
    }
    y = b.text('designcut-headline', s.text.headline, tk(ctx).H1, MARGIN, y, CONTENT_W, surf.text).bottom + 16
    if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y, CONTENT_W, surf.text).bottom
  }
  const box = { ...productBox(660), x: 100, y: y + 48 }
  productStage(b, ctx, surf.fill, product, { y: box.y - 24, height: box.height + 48 }, box)
  return { elements: b.elements, height: box.y + box.height + 80, background: surf.fill }
}

/**
 * 압축형 장 머리 — "POINT 01" 캡슐 한 줄 + 헤드라인(+설명). 번호와 제목이 한 읽기 단위가 되고,
 * 예전 세로형(캡슐·큰 번호·밑줄 세 줄)보다 약 160px 낮다. 반환값은 머리 아래 끝
 */
export function pointHeader(b: CutBuilder, ctx: CutContext, y0: number, surf: Surf, headline: TypeToken): number {
  const { section: s, colors: c } = ctx
  const chapter = s.chapter ?? s.modules.chapter ?? null
  // 채움 메시지 머리 변형(D6 P3 — 장 번호 없는 칸, 장면 모드만). 칸이 없으면 지금 머리
  if (ctx.v2 && ctx.scene && chapter === null) {
    const accent = accentFor(ctx, surf)
    const head = { section: { headVariant: s.headVariant, chapter, text: s.text }, colors: c, headline, body: tk(ctx).BODY, accent }
    const end = drawMessageHead(b, head, y0, surf)
    if (end !== null) return end
  }
  if (ctx.v2) return pointHeaderV2(b, ctx, y0, surf, headline, chapter)
  const textColor = surf.text
  let y = y0
  if (chapter !== null) {
    b.capsule('designcut-chapter', `POINT ${two(chapter)}`, tk(ctx).LABEL, MARGIN, y, {
      fill: c.accent,
      text: c.onAccent,
      radius: ctx.radius.capsule,
    })
    y += 64 + 20
  }
  if (s.text.headline) y = b.text('designcut-headline', s.text.headline, headline, MARGIN, y, CONTENT_W, textColor).bottom
  // POINT 설명(sub) — null이면 그 줄만 생략
  if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y + 16, CONTENT_W, textColor).bottom
  return y
}

/** v2 장 번호 열 폭 — DISPLAY 96 두 자리('01' 약 131px) + 제목과의 간격 */
const CHAPTER_NUMBER_W = 160

/**
 * v2 장 머리(C5) — 캡슐 "POINT"(캡슐은 장 번호에만) → 장 번호를 DISPLAY 96으로 한 번 + 같은 줄 오른쪽에 제목(강조 구절) → 설명.
 * 번호(3자 이하 표식)와 제목(h1)은 모바일 M6 2열 판정 대상이 아니다. 캡슐 글자 옆에는 아무것도 두지 않는다(M6) —
 * 페이지 POINT 진행 표시(R-W7)는 장면 모드에서 캡슐 바로 위 줄(위 여백 안)에 둔다(pointSteps.ts)
 */
function pointHeaderV2(b: CutBuilder, ctx: CutContext, y0: number, surf: Surf, headline: TypeToken, chapter: number | null): number {
  const { section: s, colors: c } = ctx
  let y = y0
  let textX = MARGIN
  let rowBottom = y
  if (chapter !== null) {
    // 한 페이지의 POINT 단추는 같은 색이다(오너 지시 11-01) — 번호마다 다른 색을 쓰지 않고 페이지 강조색 하나로 칠한다
    // 진행 표시(R-W7) — 장면 모드만, 캡슐 바로 위 줄(위 여백 안). 캡슐 줄 오른쪽은 캡슐 글자가 M6 2열 본문이 된다
    if (ctx.scene && ctx.v2?.points) drawPointSteps(b, { points: ctx.v2.points, chapter, capsuleY: y, surf, colors: c, chipRadius: ctx.radius.chip, token: tk(ctx).LABEL })
    b.capsule('designcut-chapter', 'POINT', tk(ctx).LABEL, MARGIN, y, { fill: c.accent, text: c.onAccent, radius: ctx.radius.capsule })
    y += 64 + 16
    const numberColor = emphasisOn(surf, c) ?? surf.text
    rowBottom = b.text('designcut-chapter-number', two(chapter), tk(ctx).DISPLAY, MARGIN, y, CHAPTER_NUMBER_W - 10, numberColor).bottom
    textX = MARGIN + CHAPTER_NUMBER_W
  }
  if (s.text.headline) {
    const head = b.text('designcut-headline', s.text.headline, headline, textX, y + 10, CONTENT_W - (textX - MARGIN), headingOn(surf, c), 'left', accentFor(ctx, surf))
    rowBottom = Math.max(rowBottom, head.bottom)
  }
  y = rowBottom
  const subGap = ctx.scene ? SCENE_SPACE.titleGap : 16
  if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y + subGap, CONTENT_W, surf.text).bottom
  return y
}

/** 장 머리 띠 높이를 먼저 재고(띠 도형이 글자보다 아래 z) 띠·머리를 그린다. 반환값은 띠 아래 끝 */
function headerBand(b: CutBuilder, ctx: CutContext, surf: Surf): number {
  const headerH = pointHeader(new CutBuilder(), ctx, SCENE_SPACE.top, surf, tk(ctx).H1) + SCENE_SPACE.photoGap
  const header = b.shape('designcut-header', 'rect', 0, 0, W, headerH, { fill: surf.fill })
  const before = b.elements.length
  pointHeader(b, ctx, SCENE_SPACE.top, surf, tk(ctx).H1)
  contain(
    header,
    b.elements.slice(before).filter((e) => e.type === 'text')
  )
  return headerH
}

/** T3a POINT-PLATE — 압축 장 머리(바탕 리듬색) + 사진 배경색 무대 위 제품 사진(T4 장식 대상) */
export function buildT3a(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const product = ctx.image(s.productImageKey)
  if (!product) return null
  if (ctx.scene) {
    // D2: 흰 띠 장 머리 + 풀폭 장면 사진(T4 장식 대상 — 직각 rect 액자)
    const band = bandOf(ctx)
    const b = new CutBuilder()
    const headerH = headerBand(b, ctx, band)
    const photoH = scenePhoto(b, ctx, product, headerH, true)
    return { elements: b.elements, height: headerH + photoH, background: band.fill }
  }
  const surf = surfaceOf(s.bg, c)
  const b = new CutBuilder()
  // 헤더 높이를 먼저 잰다(헤더 바탕 도형이 글자보다 아래 z여야 한다)
  const headerH = pointHeader(new CutBuilder(), ctx, 64, surf, tk(ctx).H1) + 48
  const header = b.shape('designcut-header', 'rect', 0, 0, W, headerH, { fill: surf.fill })
  const before = b.elements.length
  pointHeader(b, ctx, 64, surf, tk(ctx).H1)
  contain(
    header,
    b.elements.slice(before).filter((e) => e.type === 'text')
  )
  const box = { ...productBox(600), x: 130, y: headerH + 40 }
  productStage(b, ctx, surf.fill, product, { y: headerH, height: box.height + 80 }, box, true)
  return { elements: b.elements, height: headerH + box.height + 80, background: surf.fill }
}

/** 사진 위 글 막 — 글 자리 아래 여백 */
const SCRIM_TEXT_PAD = 48

/**
 * 사진 위 글 막(적용 T1-30 D, 보고서 A3 #11) — K image.overlay와 같은 계산(overlayFilm: 흰·검은 사진 양쪽에서 글자 대비 4.5가 되는 가장 옅은 농도)을
 * 글 뒤(위 0 ~ solid)에만 깔고 아래 200은 사진으로 녹인다(scrimFilmSvg). 글 자리 도형은 투명한 표지다(M2·K scrimIssues가 읽는다).
 * 사진 전체에 고정 농도 0.45로 깔던 막은 완료 D 잡 팔레트 51개 모두 흰 사진에서 4.5에 못 미쳤다(필요 0.70~0.85, 11-03 계산)
 */
function photoScrim(b: CutBuilder, film: OverlayFilm, solid: number, photoH: number): CanvasElement {
  const fade = Math.max(0, Math.min(SCRIM_FADE_H, photoH - solid))
  b.svg(SCRIM_FILM_NAME, scrimFilmSvg(film, uid('fade'), solid, fade, 'down'), 0, 0, W, solid + fade)
  return b.shape(SCRIM_NAME, 'rect', 0, 0, W, solid, { fill: 'transparent' })
}
/** 막(글 자리)이 사진 높이의 K 상한(OVERLAY_SCRIM_MAX) 안에 드는 가장 낮은 사진 높이 */
const photoHeightFor = (solid: number) => Math.ceil(solid / OVERLAY_SCRIM_MAX)

/** T3c STORY — 분위기 플레이트(창 y95~1195) + 위쪽 글 자리 막(글 뒤 + 흐림) + 문구 */
export function buildT3c(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  if (!s.text.headline) return null
  const b = new CutBuilder()
  const hasPlate = plate(b, ctx, 0, 1100, { y: (95 / 1290) * 100, height: (1100 / 1290) * 100 })
  const label = s.text.eyebrow ?? 'STORY'
  // v2(C5): 본문 정렬 축은 왼쪽, 라벨은 캡슐 없이(캡슐은 POINT 장 번호에만)
  const v2 = Boolean(ctx.v2)
  const align = v2 ? 'left' : 'center'
  const sub = v2 ? { x: MARGIN, w: CONTENT_W } : { x: 80, w: 700 }
  // 글 자리는 위쪽 — 막(글 뒤)이 사진 높이의 60% 안에 들고 그 아래는 사진이 그대로 보인다. 플레이트가 없으면 위 빈 바탕을 줄인 같은 자리(M4)
  const labelY = 120
  let y = labelY
  const headY = y + (v2 ? h(tk(ctx).LABEL, label) + 18 : 64 + 36)
  y = headY + h(tk(ctx).H2, s.text.headline) + (ctx.scene ? SCENE_SPACE.titleGap : 24)
  const subY = s.text.sub ? y : null
  if (subY !== null) y += h(tk(ctx).BODY, s.text.sub!, sub.w)
  const solid = y + SCRIM_TEXT_PAD
  const bottom = hasPlate ? Math.max(1100, y + 120, photoHeightFor(solid)) : y + 120
  fitPlate(b, bottom)
  // palette2 playful(짙은 면 없음): 밝은 막 + 진한 글자, 바탕은 스튜디오 면. 그 밖은 짙은 막 + 밝은 글자 — 사진 위 글자는 막 위(M2)
  const light = Boolean(ctx.scene?.noDark)
  const film = overlayFilm(light ? 'dark' : 'light', c)
  const ink = film.text
  const scrim = hasPlate ? photoScrim(b, film, solid, bottom) : b.shape(SCRIM_NAME, 'rect', 0, 0, W, bottom, { fill: 'transparent' })
  const before = b.elements.length
  if (v2) b.label('designcut-eyebrow', label, MARGIN, labelY, CONTENT_W, ink)
  else
    b.capsule('designcut-eyebrow', label, tk(ctx).LABEL, centeredCapsuleX(label), labelY, {
      stroke: ink,
      text: ink,
      radius: ctx.radius.capsule,
    })
  b.text('designcut-headline', s.text.headline, tk(ctx).H2, MARGIN, headY, CONTENT_W, ink, align)
  if (subY !== null) b.text('designcut-sub', s.text.sub!, tk(ctx).BODY, sub.x, subY, sub.w, ink, align)
  contain(
    scrim,
    b.elements.slice(before).filter((e) => e.type === 'text')
  )
  const background = light ? c.neutral : hasPlate ? c.deep : darkFill(ctx)
  return { elements: b.elements, height: bottom, background }
}

/**
 * T8 CLOSE — 제품 사진이 있으면 바탕 리듬색 위 가운데 헤드라인·서브 + 사진 배경색 무대 위 제품 사진(플레이트 없음),
 * 없으면 플레이트 + 상단 스크림 위 가운데 헤드라인·서브
 */
export function buildT8(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  if (!s.text.headline) return null
  const product = ctx.image(s.productImageKey)
  const b = new CutBuilder()
  if (product && ctx.scene) {
    // D2: 흰 띠 위 가운데 제목·서브(강조 구절) + 풀폭 장면 사진 — 페이지 끝은 사진(아래 페이드는 다음 섹션이 없어 붙지 않는다)
    const band = bandOf(ctx)
    const head = b.text('designcut-headline', s.text.headline, tk(ctx).H1, MARGIN, SCENE_SPACE.top, CONTENT_W, headingOn(band, c), 'center', accentFor(ctx, band))
    let y = head.bottom
    if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y + SCENE_SPACE.titleGap, CONTENT_W, band.text, 'center').bottom
    const photoY = y + SCENE_SPACE.photoGap
    const photoH = scenePhoto(b, ctx, product, photoY, false)
    // 원형 배지(D6 R-D1) — 계획 칸이 있을 때만 사진 안 위 오른쪽(사진 위에 얹어 높이 그대로)
    drawSceneBadge(b, ctx, { x: 0, y: photoY, w: W })
    return { elements: b.elements, height: photoY + photoH, background: band.fill }
  }
  if (product) {
    const surf = surfaceOf(s.bg, c)
    // v2(C5): 마무리는 가운데 정렬 축 그대로, 제목 본색·강조 구절만 더한다(v1은 headingOn이 바탕 글자색, accentFor가 null)
    const head = b.text('designcut-headline', s.text.headline, tk(ctx).H1, MARGIN, 100, CONTENT_W, headingOn(surf, c), 'center', accentFor(ctx, surf))
    let y = head.bottom + 16
    if (s.text.sub) y = b.text('designcut-sub', s.text.sub, tk(ctx).BODY, MARGIN, y, CONTENT_W, surf.text, 'center').bottom
    const box = { ...productBox(480), x: 190, y: y + 64 }
    // 무대가 섹션 끝까지 — 페이지 마지막 섹션이라 무대 아래 바탕 띠가 남으면 짙은 줄로 끝난다(E1 재렌더)
    const stage = { y: box.y - 40, height: box.height + 80 }
    productStage(b, ctx, surf.fill, product, stage, box)
    return { elements: b.elements, height: stage.y + stage.height, background: surf.fill }
  }
  const hasPlate = plate(b, ctx, 0, 1290)
  let y = 100
  const headY = y
  y += h(tk(ctx).H1, s.text.headline) + 16
  const subY = s.text.sub ? y : null
  if (subY !== null) y += h(tk(ctx).BODY, s.text.sub!)
  const bottom = y + SCRIM_TEXT_PAD
  const height = hasPlate ? Math.max(1290, bottom + 120, photoHeightFor(bottom)) : bottom + 120
  fitPlate(b, height)
  // 플레이트 위 글은 T3c와 같은 막(글 뒤 + 흐림, 대비 4.5 계산). 플레이트가 없으면 짙은 바탕 위 옅은 띠 그대로
  const film = overlayFilm('light', c)
  const scrim = hasPlate ? photoScrim(b, film, bottom, height) : b.shape(SCRIM_NAME, 'rect', 0, 0, W, bottom, { fill: rgba(c.deep, 0.45) })
  const ink = hasPlate ? film.text : c.onDeep
  const t8Head = b.text('designcut-headline', s.text.headline, tk(ctx).H1, MARGIN, headY, CONTENT_W, ink, 'center')
  const t8Sub = subY !== null ? b.text('designcut-sub', s.text.sub!, tk(ctx).BODY, MARGIN, subY, CONTENT_W, ink, 'center') : null
  contain(scrim, [t8Head.el, t8Sub?.el])
  return {
    elements: b.elements,
    height,
    background: hasPlate ? c.deep : darkFill(ctx),
  }
}
