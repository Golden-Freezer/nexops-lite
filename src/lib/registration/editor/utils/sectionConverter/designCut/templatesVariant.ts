/**
 * D2 형태 변형(layoutVariant — internalized/designcut-structure.ts가 계획에 기록, 장면 모드에서만) — 큰 POINT(T3a)·자세히 보기(T11)가
 * 이어져도 모양이 달라 보이게 다른 배치로 그린다(오너 지시 10-31 '레이아웃 다양화', SPACING-LAYOUT.md ②). 모바일 판독 규칙을 지키려
 * 모두 한 열로 쌓는다 — 긴 본문 옆에 사진·글을 나란히 두지 않는다(M6). 여백은 장면 모드 값(SCENE_SPACE)을 쓴다.
 * - T3a zigzag: 흰 띠 장 머리 아래, 사진 카드(680)를 오른쪽으로 비켜 놓고 그 뒤에 왼쪽 아래로 어긋난 옅은 강조색 판
 * - T3a grid: 흰 띠 장 머리 아래 본문 폭 사진 타일. 큰 POINT 셋은 머리(캡슐·번호·제목·설명 자리)가 같고 사진 배치만 다르다
 * - T3a half(적용 D6 P2 T2-42): 섹션 위쪽에 옅은 강조 면을 깔고 그 위에 같은 머리, 본문 폭 사진 타일이 면 아래 경계에 반쯤 걸친다
 * - T3a cards(적용 D6 P2 T2-16·T2-20): 머리에서 설명을 빼고 설명 문장마다 카드 한 장(문장 경계만 나눔 — pointCards) → 본문 폭 사진.
 *   짙은 띠면 흰 카드, 밝은 띠면 패널 카드(panelOn)
 * - T11 zigzag(모든 항목에 컷): 항목마다 정사각 사진(600)을 왼쪽·오른쪽으로 번갈아 비켜 놓고 그 아래 같은 축에 번호·제목·설명
 * T3a 사진은 장식(T4) 대상 액자(rect·roundedRect)다. 모르는 변형·칸 없음은 compose가 지금 그리기(scene·기본 목록)로 둔다
 */

import { CutBuilder, DECOR_RADIUS, contain } from './build'
import { HALF_PLANE_NAME, HALF_TOP, halfPlaneOf } from './halfPlane'
import { cardSentences, fitsCards } from './pointCards'
import { head } from './templatesInfo'
import { buildT11 } from './templatesLong'
import { bandOf, pointHeader, sceneBoxOf, tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_SPACE, W, WHITE, accentTextOn, panelOn, rgba, surfaceOf } from './tokens'

/** zigzag 사진 카드 폭 — 4:3 사진도 높이 510(M5 상품 컷 500 이상) */
const ZIG_W = 680
/** zigzag 판이 사진에서 어긋나는 거리 */
const ZIG_SHIFT = 48
/** 자세히 보기 zigzag 사진 — 정사각 600(M5 500 이상), 왼쪽 60·오른쪽 200으로 번갈아 */
const DETAIL_W = 600
const DETAIL_GAP = 96
/** 문장 카드 안 여백·카드 사이 */
const CARD_PAD_X = 40
const CARD_PAD_Y = 32
const CARD_GAP = 16

const two = (n: number) => String(n).padStart(2, '0')
/** SHARP 모서리 문법이면 직각 액자(상품 무대 productStage와 같은 기준). 판 모서리도 액자와 같다(SOFT 16) */
const isSharp = (ctx: CutContext) => ctx.radius.card <= 8
/** 위에 그린 것이 없으면(장 머리·제목·설명 모두 없음) 사진을 섹션 위 여백 자리에 — 섹션 안 빈 칸이 200을 넘지 않게(M4) */
const photoTop = (y: number) => (y > SCENE_SPACE.top ? y + SCENE_SPACE.photoGap : SCENE_SPACE.top)

/** 흰 띠 여백(사진 양옆)으로 끝나는 큰 POINT 형태 변형 — 본문 폭·비켜 놓은 사진이라 풀폭 사진으로 끝나지 않는다 */
const BAND_END_VARIANTS = new Set(['zigzag', 'grid', 'half', 'cards'])
/** 흰 띠 여백으로 끝나는 큰 POINT 형태 변형(사진이 아래 끝에 닿지 않는다) — 다음 섹션 바탕 교대가 흰색 다음으로 본다(layout2) */
export const isBandEndPoint = (s: { template: string; layoutVariant?: string }) =>
  (s.template === 'T3a' || s.template === 'T3b') && BAND_END_VARIANTS.has(s.layoutVariant ?? '')
/** 사진 상자 높이 — 장면 사진과 같은 실제 비율(4:3~3:4로 묶음, 모르면 3:4)을 이 폭에 맞춘다 */
const photoHeight = (ctx: CutContext, src: string, width: number) =>
  Math.round((sceneBoxOf(ctx.scene?.aspectOf?.(src)).height * width) / W)

/** 큰 POINT zigzag — 흰 띠 장 머리 → 오른쪽으로 비켜 놓은 사진 카드 + 왼쪽 아래로 어긋난 옅은 강조색 판 */
export function buildT3aZigzag(ctx: CutContext): CutResult | null {
  const product = ctx.image(ctx.section.productImageKey)
  if (!product) return null
  const band = bandOf(ctx)
  const b = new CutBuilder()
  const photoY = photoTop(pointHeader(b, ctx, SCENE_SPACE.top, band, tk(ctx).H1))
  const height = photoHeight(ctx, product, ZIG_W)
  const x = W - MARGIN - ZIG_W
  const sharp = isSharp(ctx)
  // 판을 먼저(아래 z) — 사진 왼쪽·아래 가장자리로만 비친다
  b.shape('designcut-zigzag-plate', 'roundedRect', x - ZIG_SHIFT, photoY + ZIG_SHIFT, ZIG_W, height, {
    fill: rgba(ctx.colors.accent, 0.16),
    borderRadius: sharp ? 0 : DECOR_RADIUS,
  })
  b.image('designcut-scene', product, x, photoY, ZIG_W, height, { frame: 'decor', sharp, fit: 'cover', imageType: 'designcut_product' })
  return { elements: b.elements, height: photoY + height + ZIG_SHIFT, background: band.fill }
}

/**
 * 큰 POINT grid — 머리는 scene·zigzag와 같고(오너 지시 11-01 'POINT 1·2·3은 카피가 나오는 자리가 같아야'), 사진만 본문 폭 타일이다.
 * 예전에는 번호 타일 + 옆 제목이라 3장만 글자 자리가 달라 보였다
 */
export function buildT3aGrid(ctx: CutContext): CutResult | null {
  const product = ctx.image(ctx.section.productImageKey)
  if (!product) return null
  const band = bandOf(ctx)
  const b = new CutBuilder()
  const photoY = photoTop(pointHeader(b, ctx, SCENE_SPACE.top, band, tk(ctx).H1))
  const height = photoHeight(ctx, product, CONTENT_W)
  b.image('designcut-scene', product, MARGIN, photoY, CONTENT_W, height, { frame: 'decor', sharp: isSharp(ctx), fit: 'cover', imageType: 'designcut_product' })
  return { elements: b.elements, height: photoY + height, background: band.fill }
}

/**
 * 큰 POINT half(T2-42) — 섹션 위쪽 옅은 강조 면(밝은 띠는 tint 바탕 T, 짙은 띠는 흰색 10%·띠가 tint면 강조색 12%를 섞은 색) 위에 같은 머리를 두고, 본문 폭 사진 타일의
 * 위 절반까지 면을 내린다(사진이 면 아래 경계에 걸친다). 면은 맨 아래 z이고 섹션 위 HALF_TOP 아래에서 시작하며, 높이는 머리·사진을 잰 뒤 정한다
 */
export function buildT3aHalf(ctx: CutContext): CutResult | null {
  const product = ctx.image(ctx.section.productImageKey)
  if (!product) return null
  const band = bandOf(ctx)
  const plane = halfPlaneOf(band, ctx.colors)
  const b = new CutBuilder()
  const face = b.shape(HALF_PLANE_NAME, 'rect', 0, HALF_TOP, W, 0, { fill: plane.fill })
  const photoY = photoTop(pointHeader(b, ctx, SCENE_SPACE.top, plane, tk(ctx).H1))
  const height = photoHeight(ctx, product, CONTENT_W)
  face.transform.height = photoY + Math.round(height / 2) - HALF_TOP
  b.image('designcut-scene', product, MARGIN, photoY, CONTENT_W, height, { frame: 'decor', sharp: isSharp(ctx), fit: 'cover', imageType: 'designcut_product' })
  return { elements: b.elements, height: photoY + height, background: band.fill }
}

/**
 * 큰 POINT cards(T2-16·T2-20) — 같은 머리에서 설명(sub)만 빼고, 설명 문장마다 카드 한 장(글자 그대로)을 쌓은 뒤 본문 폭 사진 타일.
 * 짙은 띠는 흰 카드·짙은 글(T2-20), 밝은 띠는 패널 카드(T2-16). 저장된 설명이 2~4문장이 아니면(편집 등) grid로 그린다
 */
export function buildT3aCards(ctx: CutContext): CutResult | null {
  const sub = ctx.section.text.sub
  if (!fitsCards(sub)) return buildT3aGrid(ctx)
  const product = ctx.image(ctx.section.productImageKey)
  if (!product) return null
  const band = bandOf(ctx)
  const card = band.dark ? { fill: WHITE, text: ctx.colors.ink } : { fill: panelOn(band, ctx.colors), text: band.text }
  const b = new CutBuilder()
  const headCtx: CutContext = { ...ctx, section: { ...ctx.section, text: { ...ctx.section.text, sub: null } } }
  let y = pointHeader(b, headCtx, SCENE_SPACE.top, band, tk(ctx).H1) + SCENE_SPACE.titleGap
  cardSentences(sub).forEach((sentence, i) => {
    if (i > 0) y += CARD_GAP
    const box = b.shape(`designcut-point-card-${i}`, 'roundedRect', MARGIN, y, CONTENT_W, 0, { fill: card.fill, borderRadius: ctx.radius.card })
    const text = b.text(`designcut-point-card-text-${i}`, sentence, tk(ctx).BODY, MARGIN + CARD_PAD_X, y + CARD_PAD_Y, CONTENT_W - CARD_PAD_X * 2, card.text)
    box.transform.height = text.bottom + CARD_PAD_Y - y
    contain(box, [text.el])
    y += box.transform.height
  })
  const photoY = y + SCENE_SPACE.photoGap
  const height = photoHeight(ctx, product, CONTENT_W)
  b.image('designcut-scene', product, MARGIN, photoY, CONTENT_W, height, { frame: 'decor', sharp: isSharp(ctx), fit: 'cover', imageType: 'designcut_product' })
  return { elements: b.elements, height: photoY + height, background: band.fill }
}

/**
 * 자세히 보기 zigzag — 항목마다 정사각 사진을 왼쪽·오른쪽으로 번갈아 비켜 놓고, 그 아래 같은 축(폭 600)에 번호·제목·설명. 컷 URL이
 * 빠진 항목이 있으면 기본 목록(templatesLong buildT11)으로 그린다(계획은 그때 list를 고르지만 URL이 빠질 수 있다)
 */
export function buildT11Zigzag(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const items = (s.modules.details ?? []).map((item) => ({ ...item, src: ctx.image(item.imageKey) }))
  if (items.length === 0) return null
  if (items.some((item) => !item.src)) return buildT11(ctx)
  const surf = surfaceOf(s.bg, c)
  const b = new CutBuilder()
  let y = head(b, ctx, s.text.eyebrow, c.accent, c.onAccent, surf.text) + SCENE_SPACE.photoGap
  items.forEach((item, i) => {
    if (i > 0) y += DETAIL_GAP
    const x = i % 2 === 0 ? MARGIN : W - MARGIN - DETAIL_W
    b.image(`designcut-detail-photo-${i}`, item.src!, x, y, DETAIL_W, DETAIL_W, {
      frame: 'plain',
      radius: ctx.radius.card,
      fit: 'cover',
      imageType: item.imageKey ?? 'designcut',
    })
    y += DETAIL_W + 32
    y = b.text(`designcut-detail-no-${i}`, two(i + 1), tk(ctx).LABEL, x, y, DETAIL_W, accentTextOn(surf.dark, c)).bottom + 12
    y = b.text(`designcut-detail-title-${i}`, item.title, tk(ctx).H3, x, y, DETAIL_W, surf.text).bottom
    if (item.description)
      y = b.text(`designcut-detail-desc-${i}`, item.description, tk(ctx).BODY, x, y + 16, DETAIL_W, surf.text).bottom
  })
  return { elements: b.elements, height: y + 80, background: surf.fill }
}
