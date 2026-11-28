/**
 * 긴 페이지 템플릿(designlong — internalized/designcut-long.ts가 계획에 끼운 막).
 * - T9 사실 표(크기·구성 / 관리·보관 / 구매 전 질문): 구매 전 확인 표와 같은 그리기(buildPurchaseTable — 이름 위·값 아래로 쌓고
 *   구분선, 좁은 이름 열을 값 옆에 두지 않는다 — 모바일 검사기 M6). 계획이 좌우 줄을 단 상품 정보 표만 이름·값 좌우 줄(infoRows.ts)
 * - T10 구석구석 보면: 머리 아래 정사각 컷과 캡션(이미지 쪽 기록 extra_shots의 caption — 없으면 사진만)을 차례로 쌓는다. 컷이 2장
 *   미만이면 그리지 않는다. 컷을 고르는 일은 이미지 쪽 몫이고 이 템플릿은 받은 것을 그리기만 한다
 * - T11 자세히 보기(D2 — 큰 POINT 밖 특징 묶음): 기본 목록 그리기 — 항목마다 자기 피처 컷(있을 때, 4:3)·번호·제목·설명을 위에서
 *   아래로 쌓는다. 형태 변형 zigzag는 templatesVariant가 그린다(compose VARIANT_BUILDERS — 장면 모드만). 정보가 빠지지 않게 하는 바닥 그리기다
 * 바탕·강조색은 compose가 넘기는 토큰만 쓴다(팔레트 규칙은 아트 디렉션 쪽 몫)
 */

import { LONG_FAQ_KEY, LONG_INGREDIENTS_KEY, LONG_MATRIX_KEY, LONG_NOTICE_KEY, NOTICE_ROW_LABEL } from '@/lib/registration/internalized/designcut-long'
import { FAQ_ANSWER_PREFIX, FAQ_QUESTION_PREFIX, withoutFaqPrefix } from '@/lib/registration/long-sections'
import { MOBILE_LIMITS, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability'
import { iconFragment } from '@/lib/registration/templatelib/icons'
import { uid } from '../helpers'
import { CutBuilder, approxTextWidth, measureCutText } from './build'
import { INFO_TABLE_KEY, buildInfoRows } from './infoRows'
import { buildPurchaseTable, head } from './templatesInfo'
import { tk, type CutContext, type CutResult } from './templatesScene'
import { CONTENT_W, MARGIN, SCENE_SPACE, TYPE, accentTextOn, rgba, surfaceOf } from './tokens'

/** 질문 표식 글 — K 구조 라벨 'Q'(STRUCTURE_LABELS)와 같다 */
export const FAQ_MARK = 'Q'
/** 주의·보관 표 '주의' 줄 경고 표식(T2-05) — 글자 한 개라 표식(M6 열 아님)이다 */
export const NOTICE_MARK = '!'
const SCENE_MIN = 2
const SCENE_GAP = 56
const DETAIL_GAP = 72
const DETAIL_PHOTO_H = Math.round((CONTENT_W * 3) / 4)
/** 머리 → 사진 간격 — D2 장면 모드는 글→사진 88(SPACING-LAYOUT.md ①), 그 밖은 48 */
const photoGapOf = (ctx: CutContext) => (ctx.scene ? SCENE_SPACE.photoGap : 48)

/**
 * T9 사실 표 — 행이 없으면 null. 구매 전 질문 표(long:faq, 후기 질문 줄 포함)는 'Q. '·'A. ' 글 접두를 떼고 질문 앞에 강조색 Q 표식을
 * 둔다(적용 T1-66 D — 보고서 개선 #8, K 'Q·A 표식 줄'). 저장된 계획 행은 접두가 붙어 있어 그리는 쪽에서 뗀다
 */
export function buildT9(ctx: CutContext): CutResult | null {
  const rows = ctx.section.modules.rows ?? []
  if (rows.length === 0) return null
  // 성분·원재료 표(D2 ③)는 재료 이름만 줄마다 — 행 이름은 모두 표 제목 낱말이라 되풀이하지 않는다. 다른 표는 지금 그대로
  if (ctx.section.key === LONG_INGREDIENTS_KEY) return buildNameList(ctx, rows.map((r) => r.value))
  // 사이즈 행렬 표(D2)는 값이 모두 짧고 칸에 들면 격자, 아니면 사이즈마다 행 블록(아래 사실 표 그리기 — 행 '치수 값 · …'). 다른 표는 지금 그대로
  if (ctx.section.key === LONG_MATRIX_KEY && ctx.section.modules.matrix) {
    const grid = buildMatrixGrid(ctx, ctx.section.modules.matrix)
    if (grid) return grid
  }
  // 주의·보관 표(D2 ②)는 '주의' 줄에만 경고 표식(T2-05) — 다른 표는 지금 그대로
  if (ctx.section.key === LONG_NOTICE_KEY)
    return buildPurchaseTable(ctx, rows, { rowMarks: rows.map((r) => (r.label === NOTICE_ROW_LABEL.caution ? NOTICE_MARK : null)) })
  // 상품 정보 표(D6 P6)는 계획이 좌우 줄을 단 장면 모드 표만 이름·값 좌우 줄(행이 칸에 안 들면 null — 지금 쌓기). 다른 표는 지금 그대로
  if (ctx.section.key !== LONG_FAQ_KEY)
    return (ctx.scene && ctx.section.key === INFO_TABLE_KEY && ctx.section.tableShape === 'rows' ? buildInfoRows(ctx, rows) : null) ?? buildPurchaseTable(ctx, rows)
  const faq = rows.map((r) => ({ label: withoutFaqPrefix(r.label, FAQ_QUESTION_PREFIX), value: withoutFaqPrefix(r.value, FAQ_ANSWER_PREFIX) }))
  return buildPurchaseTable(ctx, faq, { mark: FAQ_MARK })
}

/**
 * 이름 목록(성분·원재료 표, D2 ③) — 머리 아래 이름(본문 굵게·본문 색)을 줄마다 쌓고 구분선을 긋는다. 간격·선은 사실 표(buildPurchaseTable)
 * 값 줄과 같다. 이름은 20자 이하 입력 그대로라 한 줄 전폭이다(좁은 열 없음 — M6)
 */
function buildNameList(ctx: CutContext, names: readonly string[]): CutResult {
  const { colors: c } = ctx
  const surf = surfaceOf(ctx.section.bg, c)
  const b = new CutBuilder()
  const t = tk(ctx)
  let y = head(b, ctx, ctx.section.text.eyebrow, c.accent, c.onAccent, surf.text) + 40
  names.forEach((name, i) => {
    y = b.text(`designcut-ingredient-${i}`, name, t.BODY_BOLD, MARGIN, y, CONTENT_W, surf.text).bottom + 32
    b.shape(`designcut-ingredient-rule-${i}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
    y += 34
  })
  return { elements: b.elements, height: y + 36, background: surf.fill }
}

/** 사이즈 행렬 격자 — 이름 열 하나 + 값 열 4개씩(열이 많으면 4개씩 나눈 덩어리를 아래로 쌓는다). 값은 3자 이하(M6 표식 기준) */
const MATRIX_COLS = 4
const MATRIX_VALUE_MAX = 3
const MATRIX_COL_W = Math.floor(CONTENT_W / (MATRIX_COLS + 1))
const MATRIX_BLOCK_GAP = 56

/**
 * 사이즈 행렬 격자(D2 — 통합 승인 (가)) — 값이 모두 3자 이하이고, 머리(치수 이름)·사이즈 이름이 표 이름 규칙(한 줄·12자 이하)으로 칸 폭 안에
 * 들 때만. 머리·사이즈 이름은 표 이름(TABLE_NAME_ELEMENT — 값 옆에 놓아도 본문 2열이 아님, 한 표가 한 묶음 M7), 값은 3자 이하 표식이라
 * 열이 아니다(M6). 못 들면 null — 사실 표 행 블록((나))으로 그린다
 */
function buildMatrixGrid(ctx: CutContext, m: { columns: string[]; rows: Array<{ label: string; values: string[] }> }): CutResult | null {
  const t = tk(ctx)
  const nameFits = (s: string) =>
    !s.includes('\n') && [...s].length <= MOBILE_LIMITS.annotationLabelMaxChars && approxTextWidth(s, TYPE.LABEL.size) <= MATRIX_COL_W
  const valueFits = (s: string) => [...s].length <= MATRIX_VALUE_MAX && approxTextWidth(s, t.BODY_BOLD.size) <= MATRIX_COL_W
  if (!m.columns.every(nameFits) || !m.rows.every((row) => nameFits(row.label) && row.values.every(valueFits))) return null
  const { colors: c } = ctx
  const surf = surfaceOf(ctx.section.bg, c)
  const b = new CutBuilder()
  const group = uid('matrix-names')
  const nameColor = accentTextOn(surf.dark, c)
  const name = (text: string, x: number, y: number, align: 'left' | 'center') => {
    const placed = b.text(TABLE_NAME_ELEMENT, text, TYPE.LABEL, x, y, MATRIX_COL_W, nameColor, align)
    placed.el.groupId = group
    return placed
  }
  const valueH = measureCutText('가', t.BODY_BOLD.size, t.BODY_BOLD.lineHeight, MATRIX_COL_W)
  const nameH = measureCutText('가', TYPE.LABEL.size, TYPE.LABEL.lineHeight, MATRIX_COL_W)
  let y = head(b, ctx, ctx.section.text.eyebrow, c.accent, c.onAccent, surf.text) + 40
  for (let start = 0; start < m.columns.length; start += MATRIX_COLS) {
    if (start > 0) y += MATRIX_BLOCK_GAP
    const cols = m.columns.slice(start, start + MATRIX_COLS)
    cols.forEach((col, j) => name(col, MARGIN + MATRIX_COL_W * (j + 1), y, 'center'))
    y += nameH + 20
    b.shape(`designcut-matrix-head-rule-${start}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.5) })
    y += 22
    m.rows.forEach((row, r) => {
      name(row.label, MARGIN, y + Math.max(0, Math.round((valueH - nameH) / 2)), 'left')
      cols.forEach((_, j) =>
        b.text(`designcut-matrix-value-${r}-${start + j}`, row.values[start + j], t.BODY_BOLD, MARGIN + MATRIX_COL_W * (j + 1), y, MATRIX_COL_W, surf.text, 'center')
      )
      y += Math.max(valueH, nameH) + 20
      b.shape(`designcut-matrix-rule-${r}-${start}`, 'rect', MARGIN, y, CONTENT_W, 2, { fill: rgba(surf.text, 0.25) })
      y += 22
    })
  }
  return { elements: b.elements, height: y + 36, background: surf.fill }
}

/** T10 구석구석 보면 — 컷(1:1, 카드 반경)마다 아래에 캡션 한 줄(있을 때만). 컷 URL이 없는 항목은 뺀다 */
export function buildT10(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const scenes = (s.modules.scenes ?? [])
    .map((scene) => ({ ...scene, src: ctx.image(scene.imageKey) }))
    .filter((scene): scene is typeof scene & { src: string } => Boolean(scene.src))
  // D2 추가 컷 섹션(long:shot:i)은 한 장으로 그린다
  if (scenes.length < (s.key.startsWith('long:shot:') ? 1 : SCENE_MIN)) return null
  const surf = surfaceOf(s.bg, c)
  const b = new CutBuilder()
  let y = head(b, ctx, s.text.eyebrow, c.accent, c.onAccent, surf.text) + photoGapOf(ctx)
  scenes.forEach((scene, i) => {
    if (i > 0) y += SCENE_GAP
    b.image(`designcut-scene-${i}`, scene.src, MARGIN, y, CONTENT_W, CONTENT_W, {
      frame: 'plain',
      radius: ctx.radius.card,
      fit: 'cover',
      imageType: scene.imageKey,
    })
    y += CONTENT_W
    if (scene.caption)
      y = b.text(`designcut-scene-caption-${i}`, scene.caption, tk(ctx).BODY_BOLD, MARGIN, y + 24, CONTENT_W, surf.text, 'center').bottom
  })
  return { elements: b.elements, height: y + 80, background: surf.fill }
}

/** 큰 POINT와 붙는 사진 사이 — 변형과 무관하게 섹션 끝에 놓는다 */
const POINT_PHOTO_GAP = 80

/** 큰 POINT 사진 한 장 더(fillacts) — T10과 같은 칸. 컷이 없으면 그대로 */
export function appendPointPhoto(result: CutResult, ctx: CutContext): CutResult {
  const key = ctx.section.modules.scenes?.[0]?.imageKey ?? null
  const src = ctx.image(key)
  if (!src) return result
  const y = result.height + POINT_PHOTO_GAP
  const b = new CutBuilder()
  const photo = b.image('designcut-point-photo', src, MARGIN, y, CONTENT_W, CONTENT_W, {
    frame: 'plain',
    radius: ctx.radius.card,
    fit: 'cover',
    imageType: key!,
  })
  photo.zIndex = Math.max(0, ...result.elements.map((e) => e.zIndex)) + 1
  return { ...result, elements: [...result.elements, photo], height: y + CONTENT_W }
}

/** 원 3칸(적용 T2-51 D) — 지름은 K point_list_div.circle-trio와 같은 216, 원 아래 이름 칸은 3칸이 본문 폭(740)을 나눈 236 */
const CIRCLE_D = 216
const CIRCLE_COL_GAP = 16
const CIRCLE_COL_W = Math.floor((CONTENT_W - 2 * CIRCLE_COL_GAP) / 3)
const CIRCLE_NAME_GAP = 24

type DetailItem = NonNullable<CutContext['section']['modules']['details']>[number]

/**
 * 원 3칸을 고르는 조건 — K circle-trio(원 사진 + 이름)와 같은 값일 때만: 항목 3개·모두 사진, 제목이 이름 한 줄(12자 이하·원 아래 칸 236 안),
 * 설명은 없다. 236 칸 셋에 본문을 나란히 두면 모바일 검사 M6(2열 본문 폭 380 이상)에 걸려 설명은 원 칸에 못 넣는다.
 * 그 밖은 지금 세로 쌓기다(통합 11-03 안 B, 오너 11-02 '입력이 없는 장치는 값이 있을 때만 나온다'). R17-L 저장 11잡은 설명이 있어 해당 0이다
 */
export function circleTrioFits(ctx: CutContext, items: readonly DetailItem[]): boolean {
  if (items.length !== 3) return false
  return items.every((item) => Boolean(ctx.image(item.imageKey)) && nameOnly(item))
}

/** 원·아이콘 칸 아래 이름 — 설명 없이 제목만, 한 줄·12자 이하(장식 라벨 규칙)·칸 236 안 */
function nameOnly(item: DetailItem): boolean {
  return (
    !item.description &&
    Boolean(item.title) &&
    !item.title.includes('\n') &&
    [...item.title.trim()].length <= MOBILE_LIMITS.annotationLabelMaxChars &&
    approxTextWidth(item.title, TYPE.LABEL.size) <= CIRCLE_COL_W
  )
}

/** 아이콘 칸(적용 T1-60·T2-11·T2-56·A6-D2·T2-54 D) — 원판 지름(K ICON_SIZES 가장 큰 값)·그림 여백(K 원판 여백 0.22)·줄 사이 */
const ICON_DISC = 160
const ICON_PAD = Math.round(ICON_DISC * 0.22)
const ICON_ROW_GAP = 56
const ICON_COLS = 3
const ICON_MIN = 3
const ICON_MAX = 6

/**
 * 아이콘 칸을 고르는 조건 — 항목 3~6개가 모두 K 아이콘 사전 이름(icon)을 갖고, 이름 한 줄·설명 없음(원 3칸과 같은 까닭, M6).
 * 아이콘 이름은 카피가 줄 때만 있다(지금 카피 프롬프트는 고르지 않아 저장 문서는 해당 0 — V2 과제). 글에서 낱말로 아이콘을 짓지 않는다
 */
export function iconGridFits(items: readonly DetailItem[]): boolean {
  if (items.length < ICON_MIN || items.length > ICON_MAX) return false
  return items.every((item) => Boolean(item.icon && iconFragment(item.icon)) && nameOnly(item))
}

/**
 * 아이콘 칸 — 3열 격자(3개 1줄, 4~6개 2줄, 덜 찬 줄은 가운데). 강조색 원판 위에 K 사전 그림(원판 글자색 선), 아래 가운데에 이름 한 줄.
 * 짙은 바탕(D)이면 짙은 면 기능 목록(T2-54)이 된다 — 이름은 바탕 글자색, 그림은 원판 위라 바탕과 무관하게 같은 대비다.
 * 그림 요소 이름은 usp_icon_<i>(측정 plan-metrics가 아이콘으로 센다), 이름은 내용 라벨 한 묶음(M7)
 */
function drawIconGrid(b: CutBuilder, ctx: CutContext, items: readonly DetailItem[], top: number): CutResult {
  const { section: s, colors: c } = ctx
  const surf = surfaceOf(s.bg, c)
  const group = uid('icon-names')
  // 이름은 모두 한 줄이라 줄 높이가 같다 — 줄 사이를 한 값으로 둔다
  const rowH = ICON_DISC + CIRCLE_NAME_GAP + measureCutText('가', TYPE.LABEL.size, TYPE.LABEL.lineHeight, CIRCLE_COL_W)
  let bottom = top
  items.forEach((item, i) => {
    const row = Math.floor(i / ICON_COLS)
    const inRow = Math.min(ICON_COLS, items.length - row * ICON_COLS)
    const offset = ((ICON_COLS - inRow) * (CIRCLE_COL_W + CIRCLE_COL_GAP)) / 2
    const x = MARGIN + offset + (i % ICON_COLS) * (CIRCLE_COL_W + CIRCLE_COL_GAP)
    const y = top + row * (rowH + ICON_ROW_GAP)
    const discX = x + (CIRCLE_COL_W - ICON_DISC) / 2
    b.shape(`designcut-icon-disc-${i}`, 'circle', discX, y, ICON_DISC, ICON_DISC, { fill: c.accent })
    const inner = iconFragment(item.icon!)!
    b.svg(
      `usp_icon_${i}`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${c.onAccent}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
      discX + ICON_PAD,
      y + ICON_PAD,
      ICON_DISC - ICON_PAD * 2,
      ICON_DISC - ICON_PAD * 2
    )
    const name = b.text(TABLE_NAME_ELEMENT, item.title.trim(), TYPE.LABEL, x, y + ICON_DISC + CIRCLE_NAME_GAP, CIRCLE_COL_W, surf.text, 'center')
    name.el.groupId = group
    bottom = Math.max(bottom, name.bottom)
  })
  return { elements: b.elements, height: bottom + 80, background: surf.fill }
}

/**
 * 원 3칸 — 정원 사진(cover) 3개를 한 줄에 두고 원 아래 가운데에 이름 한 줄. 이름은 표 이름과 같은 내용 라벨(TABLE_NAME_ELEMENT — 장식 라벨 규칙을
 * 따르고 프리셋 적용 때 걷어내지 않는다)이고 세 이름이 한 묶음이다(M7)
 */
function drawCircleTrio(b: CutBuilder, ctx: CutContext, items: readonly DetailItem[], top: number): CutResult {
  const { section: s, colors: c } = ctx
  const surf = surfaceOf(s.bg, c)
  const group = uid('circle-names')
  let bottom = top + CIRCLE_D
  items.forEach((item, i) => {
    const x = MARGIN + i * (CIRCLE_COL_W + CIRCLE_COL_GAP)
    b.image(`designcut-detail-photo-${i}`, ctx.image(item.imageKey)!, x + (CIRCLE_COL_W - CIRCLE_D) / 2, top, CIRCLE_D, CIRCLE_D, {
      frame: 'circle',
      fit: 'cover',
      imageType: item.imageKey ?? 'designcut',
    })
    const name = b.text(TABLE_NAME_ELEMENT, item.title.trim(), TYPE.LABEL, x, top + CIRCLE_D + CIRCLE_NAME_GAP, CIRCLE_COL_W, surf.text, 'center')
    name.el.groupId = group
    bottom = Math.max(bottom, name.bottom)
  })
  return { elements: b.elements, height: bottom + 80, background: surf.fill }
}

/**
 * T11 자세히 보기(기본 목록) — 항목이 없으면 null. 컷 URL이 없는 항목은 글만 그린다(특징을 빼지 않는다).
 * 사진 + 이름 3항목은 원 3칸, 그다음 아이콘 + 이름 3~6항목은 아이콘 칸(사진이 근거라 둘 다 맞으면 원 3칸)
 */
export function buildT11(ctx: CutContext): CutResult | null {
  const { section: s, colors: c } = ctx
  const items = s.modules.details ?? []
  if (items.length === 0) return null
  const surf = surfaceOf(s.bg, c)
  const b = new CutBuilder()
  const headBottom = head(b, ctx, s.text.eyebrow, c.accent, c.onAccent, surf.text)
  let y = headBottom + (ctx.image(items[0].imageKey) ? photoGapOf(ctx) : 48)
  if (circleTrioFits(ctx, items)) return drawCircleTrio(b, ctx, items, y)
  if (iconGridFits(items)) return drawIconGrid(b, ctx, items, headBottom + photoGapOf(ctx))
  items.forEach((item, i) => {
    if (i > 0) y += DETAIL_GAP
    const src = ctx.image(item.imageKey)
    if (src) {
      b.image(`designcut-detail-photo-${i}`, src, MARGIN, y, CONTENT_W, DETAIL_PHOTO_H, {
        frame: 'plain',
        radius: ctx.radius.card,
        fit: 'cover',
        imageType: item.imageKey ?? 'designcut',
      })
      y += DETAIL_PHOTO_H + 32
    }
    const no = String(i + 1).padStart(2, '0')
    y = b.text(`designcut-detail-no-${i}`, no, tk(ctx).LABEL, MARGIN, y, CONTENT_W, accentTextOn(surf.dark, c)).bottom + 12
    y = b.text(`designcut-detail-title-${i}`, item.title, tk(ctx).H3, MARGIN, y, CONTENT_W, surf.text).bottom
    if (item.description)
      y = b.text(`designcut-detail-desc-${i}`, item.description, tk(ctx).BODY, MARGIN, y + 16, CONTENT_W, surf.text).bottom
  })
  return { elements: b.elements, height: y + 80, background: surf.fill }
}
