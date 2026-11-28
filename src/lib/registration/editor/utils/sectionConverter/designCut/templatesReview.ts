/**
 * D2 후기 템플릿(T12 — internalized/designcut-structure.ts가 계획한 막). 계획이 카피 reviewHighlights(#330 규칙: 가린 작성자·요약
 * 본문·원문 대조)를 최대 5장 옮겨 왔고, 이 템플릿은 받은 것을 그리기만 한다 — 글을 고치거나 별·작성자를 지어내지 않는다.
 * - 입력 평점이 있으면 머리 아래 큰 평점 숫자 + 별(SVG, 범용 앰버) + 리뷰 수(있을 때만)
 * - 계획에 별점 분포(rating_counts 원본, 합계 5건 이상)가 있으면 그 아래 5점→1점 막대 다섯 줄(적용 D6 P1). 옛 계획은 칸이 없어 그대로
 * - 카드: 판넬 상자 안에 별(그 카드의 원본 평점이 있을 때만) → 따옴표 본문 → 작성자 줄(가린 작성자 · 작성 월 · '후기 요약')
 * 위에서 아래로만 쌓아 겹친 레이어가 없다 — 마운트 리플로우로 상자를 실측 글 높이에 맞춘다
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { buildStarsSvg } from '../svg'
import { CutBuilder, contain } from './build'
import { head } from './templatesInfo'
import { tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, accentTextOn, panelOn, rgba, surfaceOf } from './tokens'

/** 별 색 — 기존 후기 섹션과 같은 범용 앰버(팔레트와 무관하게 '별점'으로 읽힘) */
const STAR_COLOR = '#FBBF24'
const CARD_PAD = 40
const CARD_GAP = 32
const SUMMARY_TAG = '후기 요약'

const starRow = (b: CutBuilder, name: string, rating: number, x: number, y: number, size: number) => {
  const width = size * 5 + 8 * 4
  return b.svg(name, buildStarsSvg(Math.round(rating), { size, color: STAR_COLOR, gap: 8 }), x, y, width, size)
}

/** 별점 분포 묶음 폭·칸(적용 D6 P1) — 왼쪽 'N점'·오른쪽 개수, 가운데 막대. 줄 사이 12 */
const BARS_W = 640
const BAR_LABEL_W = 72
const BAR_COUNT_W = 104
const BAR_H = 14
const BAR_GAP = 12

type Bars = NonNullable<NonNullable<CutContext['section']['modules']['reviews']>['bars']>

/**
 * 별점 분포 막대(적용 D6 P1 T1-69·T2-19) — 계획이 기록한 rating_counts 원본 개수만 그린다(몫은 개수/합계, 짓지 않음).
 * 막대는 강조색(그래픽 3:1), 바탕 길은 글자색 12%. 반환값은 아래 끝
 */
function drawBars(b: CutBuilder, ctx: CutContext, bars: Bars, top: number, text: string, fill: string): number {
  const type = tk(ctx)
  const total = bars.reduce((sum, bar) => sum + bar.count, 0)
  const x = MARGIN + (CONTENT_W - BARS_W) / 2
  const trackX = x + BAR_LABEL_W
  const trackW = BARS_W - BAR_LABEL_W - BAR_COUNT_W
  let y = top
  bars.forEach((bar, i) => {
    if (i > 0) y += BAR_GAP
    const label = b.text(`designcut-review-bar-label-${bar.star}`, `${bar.star}점`, type.LABEL, x, y, BAR_LABEL_W, text)
    const trackY = y + Math.round((label.bottom - y - BAR_H) / 2)
    b.shape(`designcut-review-bar-track-${bar.star}`, 'roundedRect', trackX, trackY, trackW, BAR_H, { fill: rgba(text, 0.12), borderRadius: BAR_H / 2 })
    const width = Math.round((trackW * bar.count) / total)
    if (width > 0)
      b.shape(`designcut-review-bar-fill-${bar.star}`, 'roundedRect', trackX, trackY, Math.max(width, BAR_H), BAR_H, { fill, borderRadius: BAR_H / 2 })
    b.text(`designcut-review-bar-count-${bar.star}`, bar.count.toLocaleString('ko-KR'), type.LABEL, trackX + trackW, y, BAR_COUNT_W, text, 'right')
    y = label.bottom
  })
  return y
}

/** T12 후기 — 카드가 없으면 null */
export function buildT12(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const reviews = s.modules.reviews
  const cards = (reviews?.cards ?? []).slice(0, 5)
  if (cards.length === 0) return null
  const surf = surfaceOf(s.bg, c)
  const panel = panelOn(surf, c)
  const ink = surf.dark ? c.onDeep : c.ink
  const type = tk(ctx)
  const b = new CutBuilder()
  let y = head(b, ctx, s.text.eyebrow, c.accent, c.onAccent, surf.text) + 40
  if (reviews?.rating) {
    const score = reviews.rating.toFixed(1)
    y = b.text('designcut-review-score', score, type.DISPLAY, MARGIN, y, CONTENT_W, accentTextOn(surf.dark, c), 'center').bottom + 8
    starRow(b, 'designcut-review-score-stars', reviews.rating, MARGIN + (CONTENT_W - (48 * 5 + 32)) / 2, y, 48)
    y += 48 + 16
    if (reviews.count)
      y = b.text('designcut-review-count', `리뷰 ${reviews.count.toLocaleString('ko-KR')}개`, type.LABEL, MARGIN, y, CONTENT_W, rgba(surf.text, 0.7), 'center').bottom
    y += 40
  }
  if (reviews?.bars) y = drawBars(b, ctx, reviews.bars, y, surf.text, surf.dark ? c.onDeep : c.accent) + 48
  cards.forEach((card, i) => {
    if (i > 0) y += CARD_GAP
    const top = y
    const box = b.shape(`designcut-review-card-${i}`, 'roundedRect', MARGIN, top, CONTENT_W, 200, { fill: panel, borderRadius: ctx.radius.card })
    const inner = CONTENT_W - CARD_PAD * 2
    let cy = top + CARD_PAD
    const children: CanvasElement[] = []
    if (card.rating) {
      children.push(starRow(b, `designcut-review-stars-${i}`, card.rating, MARGIN + CARD_PAD, cy, 32))
      cy += 32 + 20
    }
    const body = b.text(`designcut-review-text-${i}`, `"${card.text}"`, type.BODY, MARGIN + CARD_PAD, cy, inner, ink)
    children.push(body.el)
    cy = body.bottom + 20
    const meta = [card.author, card.month, card.summary ? SUMMARY_TAG : null].filter(Boolean).join(' · ')
    const metaText = b.text(`designcut-review-meta-${i}`, meta, type.LABEL, MARGIN + CARD_PAD, cy, inner, rgba(ink, 0.65))
    children.push(metaText.el)
    cy = metaText.bottom + CARD_PAD
    box.transform.height = cy - top
    contain(box, children)
    y = cy
  })
  return { elements: b.elements, height: y + 80, background: surf.fill, reflow: true }
}
