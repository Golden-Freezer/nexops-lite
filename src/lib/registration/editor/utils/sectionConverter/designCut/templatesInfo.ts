/**
 * 정보형 템플릿(색면 바탕 + 코드 인포그래픽 모듈) — 08 §3 T2·T4·T5·T6·T7, §6 M1·M2a·M4·M7·M8.
 * 모바일 검사기에 맞춘 차이:
 * - 본문은 모듈 안에서도 45(BODY) — 통합 확정 1. 넘치면 줄바꿈·행 높이로 받는다
 * - 단계 커넥터는 SVG가 아니라 세로 도형(M6은 도형이 아닌 요소와 나란한 글자 열을 본다)
 * - 치수(M4)는 선과 축 캡슐(가로·높이)만 사진 위에, 값은 플레이트 아래 한 줄 글자로 — 사진 옆 좁은 값 라벨은 M6에 걸린다.
 *   계획이 입력 수치 줄(metricRows, D6 P7)을 단 장면 모드 사이즈 칸만 캡션 아래 이름·큰 숫자 좌우 줄(metricRows.ts)
 * - 옵션(M8)은 2열(열 폭 380, M6) — 명세의 4열 185는 검사기 기준에 못 미친다. 실물 사진이 있는 옵션은 사진 카드, 없는 옵션은 이름만
 * - 제품·사용 사진은 플레이트 없이 사진 배경색 무대 위 contain(장면형 템플릿과 같은 규칙)
 */

import type { DesigncutSection } from '@/lib/registration/pdp-state'
import { sanitizeImageUrl } from '../helpers'
import { SIZE_SINGLE_SECTION, sizeLine } from './sizeLines'
import type { CutChip } from './contract'
import { CutBuilder, contain, measureCutText } from './build'
import { drawPartRows, fitsPartRows } from './inputDevices'
import { drawMetricRows, fitsMetricRows } from './metricRows'
import { drawScheduleRows, fitsScheduleRows } from './scheduleRows'
import { drawSwatchDot, swatchDotsFitAll, swatchHexOf } from './swatchDots'
import { accentFor, labelColorOn, productBox, productStage, tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_SPACE, TYPE, accentTextOn, headingOn, panelOn, rgba, surfaceOf } from './tokens'

const CHECK_SVG = (color: string) =>
  `<svg viewBox="0 0 64 64" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M19 33 L28 42 L46 23" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/** 머리 → 사진 간격 — D2 장면 모드는 글→사진 88(SPACING-LAYOUT.md ①), 그 밖은 40 */
const photoGapOf = (ctx: CutContext) => (ctx.scene ? SCENE_SPACE.photoGap : 40)

/** 바탕 유형(§4.3)대로 칠한다 — 사진 바탕(P)은 사진 배경색 */
const surfOf = (ctx: CutContext) => surfaceOf(ctx.section.bg, ctx.colors)

/** 머리(캡슐 + 헤드라인 + 서브) — 반환값은 다음 y. sub가 다른 자리(T2 결론 띠)에 쓰이면 withSub=false */
export function head(
  b: CutBuilder,
  ctx: CutContext,
  label: string | null,
  labelFill: string,
  labelText: string,
  textColor: string,
  y0 = 80,
  withSub = true
): number {
  // D2 장면 모드는 섹션 위 여백을 넓힌다(SPACING-LAYOUT.md ①)
  if (ctx.v2) return headV2(b, ctx, label, ctx.scene ? Math.max(y0, SCENE_SPACE.top) : y0, withSub)
  let y = y0
  if (label) {
    b.capsule('designcut-eyebrow', label, tk(ctx).LABEL, MARGIN, y, {
      fill: labelFill,
      text: labelText,
      radius: ctx.radius.capsule,
    })
    y += 64 + 26
  }
  if (ctx.section.text.headline)
    y = b.text('designcut-headline', ctx.section.text.headline, tk(ctx).H2, MARGIN, y, CONTENT_W, textColor).bottom
  if (withSub && ctx.section.text.sub)
    y = b.text('designcut-sub', ctx.section.text.sub, tk(ctx).BODY, MARGIN, y + 16, CONTENT_W, textColor).bottom
  return y
}

/** v2 머리(C5) — 캡슐 없는 라벨(강조색)·제목 본색 + 강조 구절·서브, 모두 왼쪽 정렬 축 */
function headV2(b: CutBuilder, ctx: CutContext, label: string | null, y0: number, withSub: boolean): number {
  const surf = surfOf(ctx)
  const { headline, sub } = ctx.section.text
  let y = y0
  if (label) y = b.label('designcut-eyebrow', label, MARGIN, y, CONTENT_W, labelColorOn(surf, ctx.colors)) + 18
  if (headline)
    y = b.text('designcut-headline', headline, tk(ctx).H2, MARGIN, y, CONTENT_W, headingOn(surf, ctx.colors), 'left', accentFor(ctx, surf)).bottom
  if (withSub && sub) y = b.text('designcut-sub', sub, tk(ctx).BODY, MARGIN, y + (ctx.scene ? SCENE_SPACE.titleGap : 16), CONTENT_W, surf.text).bottom
  return y
}

/**
 * 말풍선 꼬리 쪽 모서리 반경 — K 말풍선(templatelib engine TAIL_RADIUS)이 이 값을 따른다. 고민 말풍선은 사람 말 자리라 꼬리를 단다
 * (K '꼬리는 사람 말 자리만' — 고민·후기·질문)
 */
export const BUBBLE_TAIL_RADIUS = 8

/** T2 PROBLEM — 파스텔 바탕, 고민 말풍선(M2a) 2~3개 지그재그, 결론 띠 */
export function buildT2(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  // 말풍선은 고민 재진술이지 후기 인용이 아니다 — 앞뒤 따옴표를 떼고 그린다(08 §3 T2·§8 가짜 사용자)
  const lines = (s.modules.lines ?? [])
    .map((l) =>
      l
        .trim()
        .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 3)
  if (lines.length < 2) return null
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  const [capFill, capText] = surf.dark ? [c.accent, c.onAccent] : [c.deep, c.onDeep]
  let y = head(b, ctx, s.text.eyebrow, capFill, capText, surf.text, 80, false) + 40
  // v2(C6): 상자는 한 문법 — 바탕과 대비되는 판넬 채움, 모서리는 카드 반경(꼬리 쪽만 작게), 테두리 없음
  const v2 = Boolean(ctx.v2)
  const r = v2 ? ctx.radius.card : ctx.radius.bubble
  const bubbleFill = v2 ? panelOn(surf, c) : '#FFFFFF'
  const bubbleInk = v2 && surf.dark ? c.onDeep : c.ink
  lines.forEach((line, i) => {
    const x = i % 2 === 1 ? 160 : MARGIN
    const textH = measureCutText(line, tk(ctx).BODY.size, tk(ctx).BODY.lineHeight, 560)
    const bubbleH = Math.max(140, textH + 64)
    // 꼬리 쪽 모서리만 작게(말풍선) — 1·3번은 오른쪽 아래, 2번은 왼쪽 아래. 반경이 꼬리 값 이하(각진 컨셉)면 꼬리 모서리가 오히려 둥글어져
    // 꼬리를 그리지 않는다(K 말풍선과 같은 규칙, 적용 T1-66 D)
    const radii: [number, number, number, number] | null = r > BUBBLE_TAIL_RADIUS ? (i % 2 === 1 ? [r, r, r, BUBBLE_TAIL_RADIUS] : [r, r, BUBBLE_TAIL_RADIUS, r]) : null
    const bubble = b.shape(`designcut-bubble-${i}`, 'roundedRect', x, y, 640, bubbleH, {
      fill: bubbleFill,
      ...(radii ? { borderRadii: radii } : { borderRadius: r }),
    })
    const t = b.text(
      `designcut-bubble-text-${i}`,
      line,
      tk(ctx).BODY,
      x + 40,
      y + Math.round((bubbleH - textH) / 2),
      560,
      bubbleInk
    )
    contain(bubble, [t.el])
    y += bubbleH + 40
  })
  if (s.text.sub && v2) {
    // v2(C6): 결론은 띠(상자) 없이 굵은 글 한 단락 — 상자 수를 줄이고 본문 정렬 축(왼쪽)을 지킨다
    y = b.text('designcut-conclusion-text', s.text.sub, tk(ctx).BODY_BOLD, MARGIN, y, CONTENT_W, headingOn(surf, c)).bottom
  } else if (s.text.sub) {
    const textH = measureCutText(s.text.sub, tk(ctx).BODY_BOLD.size, tk(ctx).BODY_BOLD.lineHeight, 680)
    const bandH = Math.max(96, textH + 40)
    const band = b.shape('designcut-conclusion', 'rect', MARGIN, y, CONTENT_W, bandH, { fill: c.accent })
    const t = b.text(
      'designcut-conclusion-text',
      s.text.sub,
      tk(ctx).BODY_BOLD,
      MARGIN + 30,
      y + Math.round((bandH - textH) / 2),
      680,
      c.onAccent,
      'center'
    )
    contain(band, [t.el])
    y += bandH
  }
  // 말풍선·결론 띠를 위에서 아래로만 쌓아 겹친 레이어가 없다 — 마운트 리플로우로 상자를 실측 글 높이에 맞춘다
  // problemcut — 글 뒤 고민 사진(상품 없음). 컷이 없으면(끔·실패) 지금처럼 글만
  const problemPhoto = ctx.image(s.productImageKey)
  if (problemPhoto) {
    const photoY = y + 80
    b.image('designcut-problem-photo', problemPhoto, MARGIN, photoY, CONTENT_W, CONTENT_W, { frame: 'plain', radius: ctx.radius.card, fit: 'cover', imageType: 'problem' })
    return { elements: b.elements, height: photoY + CONTENT_W + 80, background: surf.fill, reflow: true }
  }
  return { elements: b.elements, height: y + 80, background: surf.fill, reflow: true }
}

/** T4 CHECKLIST — 체크 원 + 본문 행(M1) 3~5개 */
export function buildT4(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const items = (s.modules.items ?? []).slice(0, 5)
  if (items.length < 3) return null
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  let y = head(b, ctx, s.text.eyebrow, c.accent, c.onAccent, surf.text) + 32
  // v2(C6): 페이지 체크 표시 상한 4 — 남은 몫이 3개 이상이면 그만큼 체크 행, 아니면 체크 표시 없는 글 행(구분선만)으로 4개까지
  const budget = ctx.v2?.budget
  const checked = budget ? (budget.checks >= 3 ? Math.min(4, items.length, budget.checks) : 0) : items.length
  const rows = budget ? items.slice(0, checked > 0 ? checked : 4) : items
  if (budget) budget.checks -= checked
  rows.forEach((item, i) => {
    const mark = i < checked
    const textX = mark ? 150 : MARGIN
    const textW = mark ? 650 : CONTENT_W
    const textH = measureCutText(item, tk(ctx).BODY.size, tk(ctx).BODY.lineHeight, textW)
    const rowH = Math.max(mark ? 64 : 0, textH) + 60
    const cy = y + Math.round((rowH - 64) / 2)
    // 모서리 문법(§5.2): SOFT 원, SHARP 반경 4 정사각
    if (mark) {
      b.shape(`designcut-check-${i}`, ctx.radius.chip > 100 ? 'circle' : 'roundedRect', MARGIN, cy, 64, 64, {
        fill: c.accent,
        borderRadius: 4,
      })
      b.svg(`designcut-check-icon-${i}`, CHECK_SVG(c.onAccent), MARGIN, cy, 64, 64)
    }
    b.text(`designcut-check-text-${i}`, item, tk(ctx).BODY, textX, y + Math.round((rowH - textH) / 2), textW, surf.text)
    b.shape(`designcut-check-rule-${i}`, 'rect', MARGIN, y + rowH - 2, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
    y += rowH
  })
  return { elements: b.elements, height: y + 70, background: surf.fill }
}

/** 이름 앞 표식 열 — K 'Q·A 표식 줄'(templates/faq.json faq.rule-rows)의 표식 열과 같은 폭 */
export const MARK_COLUMN_W = 88
/** 표식 캡슐 높이(CutBuilder.capsule 기본) */
const MARK_H = 64

/**
 * 구매 전 확인 표(계획 밖 — compose가 CTA 앞에 넣는다, purchaseCut.ts). 행은 이름(작은 강조 글자)과 값(본문 굵게)을
 * 위아래로 쌓고 구분선을 긋는다 — 좁은 이름 열을 값 옆에 두면 모바일 검사기(M6)에 걸린다(T6 치수 값과 같은 이유)
 * mark(구매 전 질문 표, 적용 T1-66 D)면 이름 앞에 강조색 캡슐 표식을 두고 이름은 그 옆 열이다 — 질문은 짧아(후기 질문 32자 상한·고정 질문)
 * M6 2열 기준 안이다. 값(답)은 표식 없이 전폭 그대로 — 표식 옆 좁은 열로 두면 40자 넘는 답이 M6에 걸리고 줄이 는다
 * 질문 표의 질문은 K faq.rule-rows 질문과 같은 단계(본문 굵게·본문 색), 답은 본문(보통 굵기)이다 — 먼저 훑는 질문이 답보다 작으면 위계가 거꾸로다
 */
export function buildPurchaseTable(
  ctx: CutContext,
  rows: ReadonlyArray<{ label: string; value: string }>,
  /** mark: 모든 줄 앞 표식(질문 표 Q) / rowMarks: 줄마다 표식(없으면 그 줄은 지금 모양 — 주의·보관 표의 '주의' 경고 표식, D2 ②) */
  opts: { mark?: string; rowMarks?: ReadonlyArray<string | null> } = {}
): CutResult | null {
  if (rows.length === 0) return null
  const { colors: c } = ctx
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  let y = head(b, ctx, ctx.section.text.eyebrow, c.accent, c.onAccent, surf.text) + 40
  const t = tk(ctx)
  rows.forEach((row, i) => {
    if (opts.mark) {
      // 질문 첫 줄과 캡슐을 같은 가운데 높이에 — 줄이 캡슐보다 높으면 캡슐을, 낮으면 글을 내린다. 값은 캡슐·질문 중 아래 끝 뒤에 온다
      const lineH = Math.ceil(t.BODY_BOLD.size * t.BODY_BOLD.lineHeight)
      const markY = y + Math.max(0, Math.round((lineH - MARK_H) / 2))
      b.capsule(`designcut-mark-${i}`, opts.mark, t.LABEL, MARGIN, markY, { fill: c.accent, text: c.onAccent, radius: ctx.radius.capsule, height: MARK_H })
      const textY = y + Math.max(0, Math.round((MARK_H - lineH) / 2))
      const question = b.text(`designcut-purchase-label-${i}`, row.label, t.BODY_BOLD, MARGIN + MARK_COLUMN_W, textY, CONTENT_W - MARK_COLUMN_W, surf.text)
      y = Math.max(markY + MARK_H, question.bottom) + 12
    } else if (opts.rowMarks?.[i]) {
      // 경고 표식(T2-05) — 줄 이름 앞 캡슐, 이름 첫 줄과 같은 가운데 높이. 값은 캡슐·이름 중 아래 끝 뒤에 온다
      const lineH = Math.ceil(t.LABEL.size * t.LABEL.lineHeight)
      const markY = y + Math.max(0, Math.round((lineH - MARK_H) / 2))
      b.capsule(`designcut-mark-${i}`, opts.rowMarks[i]!, t.LABEL, MARGIN, markY, { fill: c.accent, text: c.onAccent, radius: ctx.radius.capsule, height: MARK_H })
      const labelY = y + Math.max(0, Math.round((MARK_H - lineH) / 2))
      const label = b.text(`designcut-purchase-label-${i}`, row.label, t.LABEL, MARGIN + MARK_COLUMN_W, labelY, CONTENT_W - MARK_COLUMN_W, accentTextOn(surf.dark, c))
      y = Math.max(markY + MARK_H, label.bottom) + 12
    } else y = b.text(`designcut-purchase-label-${i}`, row.label, t.LABEL, MARGIN, y, CONTENT_W, accentTextOn(surf.dark, c)).bottom + 12
    // 표 값은 본문 굵기(K와 같다, 보고서 A2 #6) — 장면 모드만. 이름은 강조 글자라 값까지 굵으면 위계가 사라진다. 질문 표의 답은 늘 본문(굵은 질문 아래)
    y = b.text(`designcut-purchase-value-${i}`, row.value, ctx.scene || opts.mark ? t.BODY : t.BODY_BOLD, MARGIN, y, CONTENT_W, surf.text).bottom + 32
    b.shape(`designcut-purchase-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
    y += 34
  })
  // 질문 표는 마운트 리플로우로 질문·답을 실측 높이에 맞춘다 — 본문 굵은 질문은 추정이 한 줄 넘게 잡혀 질문과 답 사이가 빈다(P07 capture
  // 41493222582). 캡슐은 행 맨 위라 밀리지 않고, 질문 아래 요소만 함께 오르내린다
  return { elements: b.elements, height: y + 36, background: surf.fill, ...(opts.mark ? { reflow: true } : {}) }
}

/** 단계 사진 상자(글 열과 같은 x·폭, 1:1) — 세로 커넥터가 왼쪽 번호 원 열에 그대로 이어진다 */
const STEP_PHOTO = { x: 170, size: 630, gap: 24 } as const

const normStep = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

/** 제목 맨 앞 번호 접두 — 숫자 + '.' 또는 ')' + 띄어쓰기('1. '·'2) '). '1.5L'·'1회용'·'3단계'는 걸리지 않는다 */
const STEP_NUMBER_PREFIX = /^\s*\d{1,2}[.)]\s+/

/**
 * 번호 원 옆에 그릴 단계 제목(적용 D5 P1) — 카피가 단 'N. '·'N) ' 접두를 뗀다. 바로 앞 번호 원이 같은 번호를 이미 보여 줘
 * '1 · 1. 간식 고르기'처럼 되풀이됐다(R17-L P02). 떼고 나서 빈 글이면 원래 제목 그대로다
 */
export function stepTitleOf(title: string | null | undefined): string | null {
  if (!title) return null
  const rest = title.replace(STEP_NUMBER_PREFIX, '')
  return rest.trim() ? rest : title
}

/**
 * T5 단계마다 그 단계 사용 컷(D2 ①) — 사용 컷 howto:j는 카피 howTo[j]로 만들어진다(pdp-image-tasks buildHowtoTasks, 3장까지).
 * 계획 단계는 같은 howTo에서 제목 없는 단계를 거른 것이라 번호가 밀릴 수 있어, 계획 단계 제목이 카피 howTo[j].step과 같을 때만
 * 그 컷을 준다(한 컷은 한 단계에만). 맞는 컷이 2장 미만이면 null — 위 사진 한 장(지금 렌더) 그대로다
 */
export function stepImagesOf(
  steps: ReadonlyArray<{ title?: string | null }>,
  copySteps: ReadonlyArray<string | null | undefined> | null | undefined,
  image: (key: string) => string | null
): (string | null)[] | null {
  if (!copySteps || copySteps.length === 0) return null
  const used = new Set<number>()
  const photos = steps.slice(0, 4).map((step) => {
    const title = normStep(step.title)
    if (!title) return null
    const j = copySteps.findIndex((t, k) => !used.has(k) && normStep(t) === title)
    if (j < 0) return null
    const url = image(`howto:${j}`)
    if (url) used.add(j)
    return url
  })
  return photos.filter(Boolean).length >= 2 ? photos : null
}

/**
 * T5 HOWTO — 사용 컷(있으면) + 번호 원·제목·설명 단계(M7) 2~4개 + 세로 커넥터. 단계 사진(ctx.stepImages)이 있으면
 * 위 사진 한 장 대신 단계마다 그 단계 사진을 글 아래에 둔다(D2 ① — 만들어 두고 안 쓰던 howto:1·2 컷)
 */
export function buildT5(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const steps = (s.modules.steps ?? []).slice(0, 4)
  if (steps.length < 2) return null
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  const stepPhotos = ctx.stepImages ?? null
  // 사용 컷은 1:1로 생성된다(howto) — 같은 비율 상자에 contain
  const cut = stepPhotos ? null : ctx.image(s.productImageKey)
  let y = head(b, ctx, s.text.eyebrow ?? '사용 방법', c.accent, c.onAccent, surf.text, 70) + (cut ? photoGapOf(ctx) : 40)
  if (cut) {
    productStage(b, ctx, surf.fill, cut, { y, height: 760 }, { x: 70, y: y + 20, width: 720, height: 720 })
    y += 760 + 48
  }
  const circles: number[] = []
  steps.forEach((step, i) => {
    const y0 = y
    circles.push(y0)
    b.shape(`designcut-step-${i}`, ctx.radius.chip > 100 ? 'circle' : 'roundedRect', MARGIN, y0, 80, 80, {
      fill: c.accent,
      borderRadius: 4,
    })
    // 번호는 80 원 안 한 줄이라 소제목(H3)을 키워도 장면 밖 H3(48·줄 간격 1.3, 상자 72)로 둔다(K MARK_NUMBER와 같은 이유).
    // 장면 줄 간격 1.5면 상자가 82라 원(80)을 넘어 판독 규칙 M2가 바탕을 원 밖으로 읽었다(대비 1.00)
    b.text(`designcut-step-number-${i}`, String(i + 1), TYPE.H3, MARGIN, y0 + 6, 80, c.onAccent, 'center')
    let bottom = y0 + 80
    const title = stepTitleOf(step.title)
    if (title)
      bottom = Math.max(
        bottom,
        b.text(`designcut-step-title-${i}`, title, tk(ctx).BODY_BOLD, 170, y0 + 6, 630, surf.text).bottom
      )
    if (step.description) {
      const dy = title ? bottom + 8 : y0 + 6
      bottom = Math.max(
        bottom,
        b.text(`designcut-step-desc-${i}`, step.description, tk(ctx).BODY, 170, dy, 630, surf.text).bottom
      )
    }
    const photo = stepPhotos?.[i]
    if (photo) {
      const top = bottom + STEP_PHOTO.gap
      // 사진 배경색 무대 — 위 사진 한 장(productStage)과 같은 규칙이되 사진 상자만큼만 깐다(전체 폭 띠는 왼쪽 커넥터 열을 가로지른다).
      // 1:1이 아닌 컷이면 contain 빈자리가 사진 배경색으로 이어진다
      if (surf.fill.toLowerCase() !== c.photo.toLowerCase())
        b.shape('designcut-stage', 'rect', STEP_PHOTO.x, top, STEP_PHOTO.size, STEP_PHOTO.size, { fill: c.photo })
      b.product(photo, STEP_PHOTO.x, top, STEP_PHOTO.size, STEP_PHOTO.size, { decor: false, sharp: ctx.radius.card <= 8 })
      bottom = top + STEP_PHOTO.size
    }
    y = bottom + 48
  })
  // 커넥터: 번호 원 사이 세로선(도형)
  for (let i = 0; i < circles.length - 1; i++) {
    const top = circles[i] + 80 + 12
    const len = circles[i + 1] - 12 - top
    if (len > 0)
      b.shape(`designcut-step-connector-${i}`, 'rect', MARGIN + 38, top, 4, len, { fill: rgba(c.accent, 0.5) })
  }
  // 주기 줄(적용 C5 ④ R-D3) — 입력 주기가 계획에 달렸고 칸에 들 때만 단계 아래에(없으면 지금 그대로). 마지막 단계 아래 48 여백은 줄 아래로 옮긴다
  if (ctx.scene && s.scheduleRows && fitsScheduleRows(s.scheduleRows)) y = drawScheduleRows(b, ctx, surf, s.scheduleRows, y - 48) + 48
  return { elements: b.elements, height: y + 12, background: surf.fill }
}

const AXIS_LABEL = { w: '가로', h: '높이', d: '깊이' } as const
/** 축 이름 뒤 띠 높이 — 라벨 한 줄을 덮는다 */
const AXIS_BAND_H = 64

const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10))

/** T6 SPEC — 사진 배경색 무대 + 제품 사진(3:4 contain) + 치수선(M4), 값은 무대 아래 한 줄 */
export function buildT6(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const sizeSingle = s.productImageKey === SIZE_SINGLE_SECTION
  // 사이즈 단독 컷이 실패하면 대표 컷을 쓴다 — 경계를 모르니 아래에서 선 없이 글자만 남는다
  const product = ctx.image(s.productImageKey) ?? (sizeSingle ? ctx.image('hero') : null)
  const dims = s.modules.dims ?? []
  // 방향을 모르는 치수(사이즈 단독 컷)는 축을 붙이지 않고 입력 글 그대로 적고 선을 긋지 않는다
  const sizeRaw = sizeSingle ? (s.modules.sizeRaw ?? '').trim() : ''
  // 숫자를 읽은 치수가 없으면 쓰지 않는다(08 T6 — 치수 생성 금지)
  if (!product || (dims.length === 0 && !sizeRaw)) return null
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  const [capFill, capText] = surf.dark ? [c.accent, c.onAccent] : [c.ink, c.onDeep]
  const top = head(b, ctx, s.text.eyebrow ?? '사이즈', capFill, capText, surf.text, 70) + photoGapOf(ctx)
  const size = productBox(450)
  const box = { x: 160, y: top + 60, w: size.width, h: size.height }
  // 무대는 치수선(아래 가로선·오른쪽 세로선)까지 덮는다
  const stageH = 60 + box.h + 110
  // 사이즈 단독 컷은 자르지 않고 사진 전체를 넣어 제품 경계에 선을 긋고, 무대는 그 사진에서 잰 바탕색으로 칠한다. 경계를 믿지 못하거나 비율이 입력과 다르면 선 없이 글자만. 그 밖은 지금처럼 사진 틀
  const measured = sizeSingle ? (ctx.scene?.productBoxOf?.(product) ?? null) : null
  const stageFill = measured?.background ?? c.photo
  productStage(b, ctx, surf.fill, product, { y: top, height: stageH }, { x: box.x, y: box.y, width: box.w, height: box.h }, false, undefined, stageFill)
  const line = sizeSingle ? sizeLine(box, measured, dims) : box
  // 자르지 않으니 축 이름이 사진 위에 올 수 있다 — 무대색 띠를 깔아 화면에서는 이어 보이고 사진 위 글자 규칙(M2)을 지킨다
  const axisLabel = (name: string, text: string, x: number, y: number, width: number, align: 'left' | 'center') => {
    if (sizeSingle) b.shape(`${name}-band`, 'rect', x, y - 4, width, AXIS_BAND_H, { fill: stageFill })
    b.label(name, text, x, y, width, c.ink, align)
  }
  const hasW = Boolean(line) && dims.some((d) => d.axis === 'w')
  const hasH = Boolean(line) && dims.some((d) => d.axis === 'h')
  const tick = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.ink}" stroke-width="4" stroke-linecap="round"/>`
  if (hasW && line) {
    const ly = line.y + line.h + 44
    b.svg(
      'designcut-dim-w',
      `<svg viewBox="0 0 ${line.w} 40" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${tick(2, 20, line.w - 2, 20)}${tick(2, 4, 2, 36)}${tick(line.w - 2, 4, line.w - 2, 36)}</svg>`,
      line.x,
      ly - 20,
      line.w,
      40
    )
    // v2(C5): 캡슐은 POINT 장 번호에만 — 축 이름은 치수선 아래 글자(2자 표식이라 M6 열이 아니다)
    // 좁은 제품도 축 이름은 한 줄로 — 제품 폭이 좁으면 라벨 칸만 넓힌다
    const labelW = Math.max(line.w, 96)
    if (ctx.v2) axisLabel('designcut-dim-w-label', AXIS_LABEL.w, Math.round(line.x + (line.w - labelW) / 2), ly + 22, labelW, 'center')
    else
      b.capsule('designcut-dim-w-label', AXIS_LABEL.w, tk(ctx).LABEL, line.x + line.w / 2 - 64, ly - 32, {
        fill: c.ink,
        text: c.onDeep,
        radius: ctx.radius.capsule,
      })
  }
  if (hasH && line) {
    const lx = line.x + line.w + 44
    b.svg(
      'designcut-dim-h',
      `<svg viewBox="0 0 40 ${line.h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${tick(20, 2, 20, line.h - 2)}${tick(4, 2, 36, 2)}${tick(4, line.h - 2, 36, line.h - 2)}</svg>`,
      lx - 20,
      line.y,
      40,
      line.h
    )
    if (ctx.v2) axisLabel('designcut-dim-h-label', AXIS_LABEL.h, lx + 28, Math.round(line.y + line.h / 2) - 20, 96, 'left')
    else
      b.capsule('designcut-dim-h-label', AXIS_LABEL.h, tk(ctx).LABEL, lx - 64, line.y + line.h / 2 - 32, {
        fill: c.ink,
        text: c.onDeep,
        radius: ctx.radius.capsule,
      })
  }
  const caption = dims.length > 0 ? dims.map((d) => `${AXIS_LABEL[d.axis]} ${formatValue(d.value)}${d.unit}`).join(' × ') : sizeRaw
  const captionBottom = b.text(
    'designcut-dim-caption',
    caption,
    tk(ctx).BODY_BOLD,
    MARGIN,
    top + stageH + 32,
    CONTENT_W,
    surf.text,
    ctx.v2 ? 'left' : 'center'
  ).bottom
  // 입력 수치 줄(D6 P7) — 계획이 단 줄이 있고 장면 모드이고 모두 칸에 들 때만. 아니면 지금 그대로(캡션까지)
  const rows = ctx.scene && s.metricRows && fitsMetricRows(s.metricRows) ? s.metricRows : null
  const rowsBottom = rows ? drawMetricRows(b, ctx, surf, rows, captionBottom) : captionBottom
  // 구성품 펼침(D6 T1-83) — 계획이 단 이름이 있고 장면 모드이고 모두 한 줄에 들 때만 수치 줄(없으면 캡션) 아래에. 아니면 지금 그대로
  const parts = ctx.scene && s.parts && fitsPartRows(s.parts) ? s.parts : null
  const y = parts ? drawPartRows(b, ctx, surf, parts, rowsBottom) : rowsBottom
  return { elements: b.elements, height: y + 64, background: surf.fill }
}

const CELL_X = [40, 440] as const
const CELL_W = 380

/** 실물 사진 카드 2열 — 흰 카드 안 사진 contain + 아래 등록 옵션명(견본 짝이 있으면 이름 앞 입력 색 점, C5 ③). 반환값은 다음 y */
function optionPhotoCards(b: CutBuilder, ctx: CutContext, chips: Array<CutChip & { image: string }>, y0: number, textColor: string, swatches?: DesigncutSection['swatches']) {
  let y = y0
  for (let i = 0; i < chips.length; i += 2) {
    let rowBottom = y
    chips.slice(i, i + 2).forEach((chip, col) => {
      const x = CELL_X[col]
      // v2(C6): 상자 한 문법 — 판넬 채움·카드 반경·테두리 없음
      b.shape(`designcut-option-card-${i + col}`, 'roundedRect', x, y, CELL_W, CELL_W, {
        ...(ctx.v2
          ? { fill: panelOn(surfOf(ctx), ctx.colors) }
          : { fill: '#FFFFFF', stroke: rgba(ctx.colors.ink, 0.12), strokeWidth: 2 }),
        borderRadius: ctx.radius.card,
      })
      b.image(`designcut-option-photo-${i + col}`, chip.image, x + 20, y + 20, CELL_W - 40, CELL_W - 40, {
        frame: 'plain',
        fit: 'contain',
        imageType: 'designcut_option',
      })
      const label = b.text(`designcut-option-label-${i + col}`, chip.label, tk(ctx).LABEL, x, y + CELL_W + 16, CELL_W, textColor, 'center')
      const hex = swatchHexOf(swatches, chip.label)
      if (hex) drawSwatchDot(b, `designcut-option-swatch-${i + col}`, hex, chip.label, tk(ctx).LABEL, x, CELL_W, y + CELL_W + 16, textColor)
      rowBottom = Math.max(rowBottom, label.bottom)
    })
    y = rowBottom + 40
  }
  return y
}

/**
 * 사진 없는 옵션 — 이름만(외곽선 칸 2열, 글자는 열 폭 380 가운데 — 좁히면 M6 2열 본문 기준에 걸린다).
 * 번호·지어낸 색은 그리지 않는다. 색 점은 buildT7이 모든 옵션에 점이 들 때만 견본 짝을 넘기면 이름 앞에(C5 ③ — 이름 글·칸 높이는 그대로)
 */
function optionNames(b: CutBuilder, ctx: CutContext, chips: CutChip[], y0: number, textColor: string, swatches?: DesigncutSection['swatches']) {
  let y = y0
  for (let i = 0; i < chips.length; i += 2) {
    let rowBottom = y
    chips.slice(i, i + 2).forEach((chip, col) => {
      const x = CELL_X[col]
      const textH = measureCutText(chip.label, tk(ctx).LABEL.size, tk(ctx).LABEL.lineHeight, CELL_W)
      const cellH = Math.max(96, textH + 48)
      const cell = b.shape(`designcut-option-name-${i + col}`, 'roundedRect', x, y, CELL_W, cellH, {
        ...(ctx.v2
          ? { fill: panelOn(surfOf(ctx), ctx.colors), borderRadius: ctx.radius.card }
          : {
              fill: 'transparent',
              stroke: rgba(textColor, 0.35),
              strokeWidth: 2,
              borderRadius: ctx.radius.chip > 100 ? Math.round(cellH / 2) : 8,
            }),
      })
      const label = b.text(
        `designcut-option-label-name-${i + col}`,
        chip.label,
        tk(ctx).LABEL,
        x,
        y + Math.round((cellH - textH) / 2),
        CELL_W,
        textColor,
        'center'
      )
      const hex = swatchHexOf(swatches, chip.label)
      const dot = hex ? drawSwatchDot(b, `designcut-option-swatch-name-${i + col}`, hex, chip.label, tk(ctx).LABEL, x, CELL_W, y + Math.round((cellH - textH) / 2), textColor) : null
      contain(cell, [label.el, dot])
      rowBottom = Math.max(rowBottom, y + cellH)
    })
    y = rowBottom + 24
  }
  return y
}

/**
 * T7 OPTION — 대표 컷(이전 기록만 — 새 계획은 productImageKey null) + 실물 사진이 있는 옵션은 사진 카드, 없는 옵션은 이름만.
 * 사진은 등록 옵션의 실물 사진(chips[].image)만 쓴다 — 공용 대표 컷을 옵션 사진처럼 보이게 하지 않는다
 */
export function buildT7(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const chips = (s.modules.chips ?? []).slice(0, 12)
  if (chips.length < 2) return null
  const surf = surfOf(ctx)
  const b = new CutBuilder()
  const product = ctx.image(s.productImageKey)
  let y = head(b, ctx, s.text.eyebrow ?? 'OPTION', c.accent, c.onAccent, surf.text) + (product ? photoGapOf(ctx) : 40)
  if (product) {
    const box = { ...productBox(450), x: 205, y: y + 30 }
    productStage(b, ctx, surf.fill, product, { y, height: box.height + 60 }, box)
    y += box.height + 60 + 56
  }
  const resolved = chips.map((chip) => ({ ...chip, image: chip.image ? sanitizeImageUrl(chip.image) : '' }))
  // 옵션 색 점(적용 C5 ③) — 입력 견본 짝이 계획에 달렸고 장면 모드이며 모든 옵션에 점이 들 때만(통합 조건 ⓑ — 일부 옵션에만 두지 않는다, 없으면 지금 그대로)
  const swatches = ctx.scene && swatchDotsFitAll(s.swatches, chips.map((chip) => chip.label), tk(ctx).LABEL, CELL_W) ? s.swatches : undefined
  y = optionPhotoCards(
    b,
    ctx,
    resolved.filter((chip): chip is CutChip & { image: string } => Boolean(chip.image)),
    y,
    surf.text,
    swatches
  )
  y = optionNames(
    b,
    ctx,
    resolved.filter((chip) => !chip.image),
    y,
    surf.text,
    swatches
  )
  return { elements: b.elements, height: y + 40, background: surf.fill }
}
