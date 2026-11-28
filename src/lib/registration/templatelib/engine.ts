/**
 * K 라인 템플릿 엔진 — JSON 템플릿 + 슬롯 값 → 편집기 요소(15_TEMPLATE_LINE §3). 좌표를 고정하지 않고 위에서 아래로 쌓아, 글이 길면
 * 아래 요소를 민다(D 라인 CutBuilder·장면 모드 글자 토큰). 빈 선택 슬롯은 요소도 간격도 남기지 않고, 필수가 비면 null이다(호출 측이
 * 다음 후보로). 색은 고른 색 조합(ColorSet.colors = D 라인 Colors)과 현재 바탕에서만 나온다.
 * 글자 높이는 추정이라 실제 글꼴과 다르다 — 조립(compose)이 마운트 리플로우를 켜 실측으로 맞추고, 아래 여백은 preserveBottomPad로 지킨다.
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { TABLE_NAME_ELEMENT, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { sizeLine } from '@/lib/registration/editor/utils/sectionConverter/designCut/sizeLines'
import type { ProductBox } from '@/lib/registration/pdp-state'
import { uid } from '@/lib/registration/editor/utils/sectionConverter/helpers'
import {
  CutBuilder,
  DECOR_RADIUS,
  HOOK_STEP_SIZES,
  approxTextWidth,
  contain,
  fitHookToken,
  type Accent,
} from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import type { CutResult } from '@/lib/registration/editor/utils/sectionConverter/designCut/templatesScene'
import { HALF_PLANE_NAME, HALF_TOP, halfPlaneOf } from '@/lib/registration/editor/utils/sectionConverter/designCut/halfPlane'
import {
  CONTENT_W,
  HOOK_TYPE,
  MARGIN,
  SCENE_TYPE,
  W,
  WHITE,
  emphasisOn,
  headingOn,
  mix,
  rgba,
  surfaceOf,
  type Colors,
  type TypeToken,
} from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { iconFragment } from './icons'
import { layerInks } from './layer-band'
import { BADGE, badgeLayout, drawBadge, isBadgeInput, type BadgeLayout, type BadgeType } from './medal'
import { SCRIM_FADE_H, SCRIM_FILM_NAME, SCRIM_NAME, overlayFilm, scrimFilmSvg } from './overlay'
import { PANEL_EDGE_NAME, panelEdgeBox, panelEdgeSvg } from './panel-edge'
import { scaleLayout, shownMm } from './scale-set'
import { listItems, missingSlots, stringList, textOf } from './slots'
import { capsuleStepsLine, drawSteps, itemStepsLine, type StepsInk } from './steps'
import { drawLink, linkInk } from './zone-link'
import type {
  ColorRole,
  DimensionNode,
  FillName,
  FlowNode,
  GapName,
  ImageNode,
  ImageOverlay,
  ImageSlot,
  ListSlot,
  PanelNode,
  RepeatNode,
  RowNode,
  ScaleSetNode,
  SlotDef,
  SlotItem,
  SlotValue,
  SlotValues,
  SurfaceName,
  TailCorner,
  Template,
  TokenName,
} from './template-types'
import { SIZE_SCALE_HEIGHT_INPUT, SIZE_SCALE_LABEL_INPUT, SIZE_SCALE_WIDTH_INPUT } from './template-types'

/**
 * K 글자 크기 — 오너 지시(11-01)로 D 라인보다 크다(폰 390에서 본문 약 24px). D 라인 표 SCENE_TYPE은 건드리지 않아 스위치를 끈 잡은 그대로다.
 * 줄 간격은 규격 그대로 장면 토큰을 따른다. 본문 크기는 두고 제목을 올려 단계 비율을 벌린다(H1÷본문 1.77, 판매 페이지 1.72~2.40). 본문 굵기 400으로 제목과 가른다.
 * CAPTION은 사진 설명·각주·후기 작성자용이다(LABEL은 한 줄 굵은 글이라 이 자리를 못 맡는다).
 * CAPTION의 수준은 caption이다 — 본문 수준이면 빌더가 판독 하한(본문 45)으로 올려 36이 45가 되고, 45에서 줄 간격 1.5가 본문 규칙 1.7에 걸린다(적용 K4 T1-09).
 * caption 하한은 28이라 36 그대로 그려진다(폰 390에서 약 16.3px, 연구 A2 1-3).
 */
export const K_TYPE: Record<TokenName, TypeToken> = {
  DISPLAY: SCENE_TYPE.DISPLAY,
  H1: { ...SCENE_TYPE.H1, size: 92 },
  H2: { ...SCENE_TYPE.H2, size: 74 },
  H3: { ...SCENE_TYPE.H3, size: 62 },
  BODY: { ...SCENE_TYPE.BODY, size: 52, weight: 400 },
  BODY_BOLD: { ...SCENE_TYPE.BODY_BOLD, size: 52 },
  // 표 값(K10) — 본문 단계(줄 간격 1.7)를 두고 크기만 폰 판독 하한(M1 본문 45)으로 줄여 한 줄에 더 들어가게 한다
  TABLE: { ...SCENE_TYPE.BODY, size: 45, weight: 400 },
  LABEL: { ...SCENE_TYPE.LABEL, size: 36 },
  CAPTION: { ...SCENE_TYPE.BODY, size: 36, weight: 500, lineHeight: 1.5, level: 'caption' },
  HOOK: { ...HOOK_TYPE.calm, size: 112 },
}
/**
 * 표 이름 내림 — 가로 칸 가운데 맞춤은 리플로가 어긋나 금지라(린트 space) 위 맞춤에서 값(TABLE) 첫 줄과 이름 줄 높이 차의 절반만큼 내린다.
 * 행 높이 맞춤(even) 표는 칸마다 행 가운데에 두므로 내리지 않는다(K10)
 */
const NAME_DROP = Math.round((K_TYPE.TABLE.size * K_TYPE.TABLE.lineHeight - K_TYPE.LABEL.size * K_TYPE.LABEL.lineHeight) / 2)
/** K 첫 화면 큰 제목 줄임 단계 — D의 단계는 100부터라 112 다음이 100이 된다. 104에 들어가던 제목이 작아지지 않게 108·104를 더한다 */
export const K_HOOK_STEP_SIZES = [108, 104, ...HOOK_STEP_SIZES]
/** 번호 원 안 글자 — 글자 상자(48 × 1.5 + 10)가 원에 들어가는 크기라 소제목과 함께 키우지 않는다 */
const MARK_NUMBER: TypeToken = { ...K_TYPE.H3, size: 48 }
/** 코드 토큰 간격 — titleGap·photoGap은 template.spacing */
export const K_SPACE = { blockGap: 64, itemGap: 48, rowGap: 32, tightGap: 16, cardPad: 40, columnGap: 24, tableGap: 20, tableTight: 8 }
/** 번호·체크 원 — 번호 글자 상자(48/1.5 + 10)가 원 안에 들어가는 크기(M2가 글자 뒤 도형을 상자 포함으로 판정) */
const MARK_SIZE = 88
/** 원 바탕 아이콘의 안쪽 여백 비율 */
const ICON_DISC_PAD = 0.22
const CAPSULE_H = 64
const ARROW = { w: 72, h: 56 }
/** 이름표 — 글자 상자(LABEL 36 × 1.2 + 10 = 53)가 칩 안에 들어가는 높이 */
export const TAG = { h: 72, gap: 16, pad: 28, textTop: 10 }
const LEADER = { stroke: 4 }
const RULE_H = 2
const ASPECTS: Record<ImageSlot['aspect'][number], number> = { '3:4': 3 / 4, '4:3': 4 / 3, '1:1': 1, '2:3': 2 / 3 }

export interface TemplateContext {
  colors: Colors
  /** photo — 둥근(decor) 사진 틀·사진 판 반경(컨셉 모서리 T1-28). 없으면 빌더 DECOR_RADIUS 16. 카드 8 이하(isSharp)면 사진은 직각이다 */
  radius: { capsule: number; card: number; bubble: number; chip: number; photo?: number }
  /** 이미지 키 → URL. 값이 없으면 사진이 빠진 것으로 본다 */
  image: (key: string | null) => string | null
  /** 순서 풀이가 고른 바탕. 템플릿이 허용하지 않으면 허용 목록의 첫째 */
  bg?: SurfaceName
  /** 페이지 USP 낱말 — 제목 강조 구절 */
  usp?: readonly string[]
  /** 모델이 고른 이 섹션의 강조 구절(적용 T1-17, TemplateRef.accent) — 그릴 글에 없으면 USP 규칙으로 돌아간다 */
  accentPhrase?: string
  aspectOf?: (src: string) => number | null
  /** 사진 URL → 사이즈 단독 컷에서 잰 제품 경계(적용 K14). 없거나 못 쟀으면 치수선을 긋지 않는다 */
  productBoxOf?: (src: string) => ProductBox | null
  /**
   * 페이지에서 뺀 컷 키(usegate 잡의 쓰는 법 미달 컷, 결정 카드 c08·J44) — 사진 칸 값이 이 안에 든 목록 항목은 글·이름표까지 통째로 빼고 남은 수로
   * 그린다. 덜어진 목록의 최소는 한 장 낮춘다(droppedListMin, 하한 2 — J48, 칸 수가 뜻인 템플릿은 그대로). 그보다 적으면 빈 목록이다(필수 목록이면 섹션째 빠진다). 덜 찬 마지막 줄은 가운데로 모은다.
   * 없으면 지금 그대로 — 사진 틀만 빠지고 칸·글이 남는다(꺼진 잡·API 실패 컷)
   */
  dropped?: ReadonlySet<string>
}

export interface Surf {
  fill: string
  text: string
  dark: boolean
}
interface Scope {
  values: Record<string, SlotValue>
  defs: Record<string, SlotDef>
  index: number
  surf: Surf
  /** 이 흐름이 쌓이는 칸 */
  x: number
  w: number
  /** 상자·줄 상자 안 — 안쪽 가로 칸을 또 묶지 않는다(겹쳐 묶으면 아래 요소를 두 번 민다) */
  boxed?: boolean
  /** 반복 칸 안 이름표의 묶음 — 항목마다 따로 세면 폰 한 화면 장식 수(M7)를 넘긴다 */
  tagGroup?: string
  /** 표 행 높이 맞춤 — 이 가로 칸을 이 높이까지 세우고 칸마다 세로 가운데에 둔다(K10) */
  rowMin?: number
  /** 표 행 묶음 id — 행 상자에 달아 리플로가 실측으로 행 높이·가운데를 다시 맞추게 한다(K10) */
  rowGroup?: string
  /** 행 높이 맞춤 행의 칸 안 — 표 이름을 값 첫 줄에 맞춰 내리지 않는다(행 가운데라서) */
  centered?: boolean
  /** 반복 칸의 항목 목록 — 진행 표시(steps)가 이름과 지금 항목을 읽는다 */
  items?: readonly SlotItem[]
}
interface Run {
  t: Template
  ctx: TemplateContext
  b: CutBuilder
  /** 이름표·치수선 묶음 번호 — 한 묶음이 장식 하나다(M7) */
  group: () => string
  /** 표 이름 묶음 — 한 표의 이름이 장식 하나다(M7) */
  nameGroup?: string
  /** 표 행 높이 맞춤 — 반복 칸마다 맞춘 행 높이(같은 표의 rows·special은 같은 값) */
  evenHeights?: Map<RepeatNode, EvenRows>
  /** 실제로 그려질 맨 위 단계 첫·끝 노드 — 곡선 경계가 섹션 끝(이웃 섹션과 맞닿음)인지 가른다. 미리 재기에는 없다(덮개는 높이를 안 바꾼다) */
  ends?: { first?: FlowNode; last?: FlowNode }
  /** 반 띠 면(적용 K7-c 4a) — 흐름보다 먼저 만들어 맨 아래 z에 두고, 반 띠 사진을 그릴 때 높이를 정한다 */
  halfFace?: CanvasElement
  /** 반 띠 면 바탕 — 흐름 맨 위 단계에서 반 띠 사진 앞 노드는 면 위에 놓이므로 글자색·강조색을 이 바탕으로 정한다(D pointHeader와 같음) */
  halfSurf?: Surf
  /** 뺀 컷 항목을 덜어 낸 목록(J44) — 덜 찬 마지막 줄을 가운데로 모은다. 없으면 지금 배치 그대로 */
  compacted?: ReadonlySet<ListSlot>
}

const surfaceOfFill = (fill: FillName, c: Colors, parent: Surf): Surf => {
  if (fill === 'A') return { fill: c.accent, text: c.onAccent, dark: c.onAccent.toUpperCase() === WHITE }
  // 카드 색 — 바탕과 같은 색이 되지 않게 바탕에 따라 푼다
  if (fill === 'C') return surfaceOf(parent.fill === c.base ? 'T' : 'W', c)
  return surfaceOf(fill, c)
}

const pickBg = (t: Template, bg: SurfaceName | undefined) => (bg && t.surfaces.includes(bg) ? bg : t.surfaces[0])

const gapOf = (t: Template, name: GapName | undefined) => {
  if (!name) return 0
  return name === 'titleGap' || name === 'photoGap' ? t.spacing[name] : K_SPACE[name]
}

function colorOf(role: ColorRole | undefined, token: TokenName, surf: Surf, c: Colors): string {
  const resolved = role ?? (['HOOK', 'H1', 'H2', 'H3'].includes(token) ? 'heading' : 'text')
  if (resolved === 'heading') return headingOn(surf, c)
  if (resolved === 'accent') return emphasisOn(surf, c, 4.5) ?? surf.text
  // text·onFill — onFill은 강조색 상자 위 제목·글이 제목 색 규칙 없이 그 면의 글자색을 쓴다(규격 3절)
  return surf.text
}

/** 형광 띠 투명도 — 띠 위 제목 대비는 concepts.test가 색 조합 전부에서 잰다(M2) */
export const BAND_ALPHA = 0.45

/**
 * 제목 강조 — 밝은 면은 컨셉 강조 방식(T1-18)이 band이거나 강조 글자색을 못 만드는 색(highlight)이면 형광 띠, 아니면 강조색 글자.
 * 짙은 면은 늘 색 글자다(연구 A2 6-3). 어두운 노랑 글자를 만들지 않는다. 칸이 없는 색(옛 계획·D)은 지금 규칙 그대로다
 */
function accentOf(ctx: TemplateContext, surf: Surf): Accent | null {
  // K 계획은 섹션 제목 칸이 비어 usp가 빈 목록이다(USP 규칙이 돌지 않음). 모델이 고른 구절(T1-17)이 있으면 그것만으로 칠한다. 둘 다 없으면 지금처럼 null
  if (!ctx.usp?.length && !ctx.accentPhrase) return null
  const base = { usp: ctx.usp ?? [], phrase: ctx.accentPhrase }
  if (!surf.dark && (ctx.colors.highlight || ctx.colors.emphasisStyle === 'band')) return { ...base, css: `background-color:${rgba(ctx.colors.accent, BAND_ALPHA)}` }
  const color = emphasisOn(surf, ctx.colors)
  return color ? { ...base, css: `color:${color}` } : null
}

const isSharp = (ctx: TemplateContext) => ctx.radius.card <= 8
/** 둥근 사진 틀(decor)에만 컨셉 사진 반경을 넘긴다 — 값이 없으면 칸을 두지 않아 빌더 기본 16 그대로(D와 옛 K 잡) */
const decorRadius = (frame: string, ctx: TemplateContext) => (frame === 'decor' && ctx.radius.photo !== undefined ? { radius: ctx.radius.photo } : {})
const radiusOfName = (name: PanelNode['radius'], ctx: TemplateContext) => {
  if (name === 'none') return 0
  return name === 'bubble' ? ctx.radius.bubble : ctx.radius.card
}

/** 사진 높이 — 실제 비율을 슬롯이 받는 비율 범위로 묶어 이 폭에 맞춘다(넘치는 쪽은 cover로 잘린다). 슬롯 최소 높이 이상 */
function photoHeight(def: ImageSlot, src: string, width: number, ctx: TemplateContext): number {
  const allowed = def.aspect.map((a) => ASPECTS[a])
  const actual = ctx.aspectOf?.(src) ?? allowed[0]
  const ratio = Math.min(Math.max(...allowed), Math.max(Math.min(...allowed), actual))
  return Math.max(Math.round(width / ratio), def.minHeight)
}

/**
 * 사진 위 글 — 막(SVG)과 글자 자리 도형을 글보다 먼저 넣고(순서가 곧 위아래) 글을 얹는다. 도형은 투명하고 글이 얹히는 자리를 표시한다(M2·전수 검사가 읽는다).
 * 도형을 글의 상자로 묶지 않는다: 묶으면 리플로우가 도형을 글에 맞춰 줄여 아래 자리에서 사진 끝과 떨어진다. 글이 줄면 막 안 여백만 늘어난다. 글이 모두 비면 막도 뺀다.
 * 막은 최악 사진 기준이라 글자색은 강조 없이 막의 글자색만 쓴다(전수 검사 overlay).
 */
function drawOverlay(run: Run, overlay: ImageOverlay, scope: Scope, photo: { y: number; h: number }) {
  const { b, t, ctx } = run
  const film = overlayFilm(overlay.ink, ctx.colors)
  const start = b.elements.length
  const layer = b.svg(SCRIM_FILM_NAME, '', 0, photo.y, W, 0)
  const scrim = b.shape(SCRIM_NAME, 'rect', 0, photo.y, W, 0, { fill: 'transparent' })
  const top = overlay.anchor === 'top'
  const textTop = photo.y + (top ? t.spacing.top : K_SPACE.blockGap)
  const inner: Scope = { ...scope, surf: { fill: film.worst, text: film.text, dark: film.dark }, x: MARGIN, w: CONTENT_W, boxed: true }
  const bottom = drawNodes(run, overlay.nodes, inner, textTop)
  if (bottom === null) {
    b.elements.length = start
    return
  }
  const height = bottom - photo.y + (top ? K_SPACE.blockGap : t.spacing.bottom)
  scrim.transform.height = height
  if (!top) for (const el of b.elements.slice(start)) el.transform.y += photo.h - height
  const fade = Math.max(0, Math.min(SCRIM_FADE_H, photo.h - height))
  layer.svgProps = { svgString: scrimFilmSvg(film, uid('fade'), height, fade, top ? 'down' : 'up') }
  layer.transform.y = top ? photo.y : photo.y + photo.h - height - fade
  layer.transform.height = height + fade
}

/** 배지 글자 — 이름표는 판독 하한 45(표 글 줄 간격 1.7, 굵게), 값은 장식 라벨 글꼴(한 줄·굵게) */
export const BADGE_TYPE: BadgeType = { label: { ...K_TYPE.TABLE, weight: 700 }, value: K_TYPE.LABEL }

/** 그릴 배지 글 배치 — 칸이 배지 입력이고 글이 원 안에 들어갈 때만. 아니면 null(사진 그대로) */
function badgeOf(node: ImageNode, scope: Scope): BadgeLayout | null {
  if (!node.badge) return null
  const def = scope.defs[node.badge.slot]
  const value = textOf(scope.values[node.badge.slot])
  if (def?.type !== 'text' || !isBadgeInput(def.input) || !value) return null
  return badgeLayout(def.input, value, BADGE_TYPE)
}

function drawImage(run: Run, node: ImageNode, scope: Scope, y: number): number | null {
  const def = scope.defs[node.slot]
  const src = run.ctx.image(textOf(scope.values[node.slot]))
  if (!src || def?.type !== 'image') return null
  const x = node.bleed ? 0 : (node.x ?? scope.x)
  const w = node.bleed ? W : (node.w ?? scope.w)
  // 원은 언제나 정원이다 — 실제 컷 비율이나 최소 높이로 타원이 되지 않는다
  const h = node.frame === 'circle' ? w : photoHeight(def, src, w, run.ctx)
  const sharp = isSharp(run.ctx)
  // 사진 위 글·배지 — 보이지 않는 상자로 묶는다. 리플로우가 글 줄어든 만큼 아래를 올리는데, 줄 높이는 사진이 정하므로 전할 변화가 없다(drawRow와 같은 이유)
  const overlay = node.overlay && node.bleed ? node.overlay : null
  const badge = badgeOf(node, scope)
  const box = (overlay || badge) && !scope.boxed ? run.b.shape('designcut-row', 'rect', x, y, w, h, { fill: 'transparent' }) : null
  const start = run.b.elements.length
  if (node.plate) {
    run.b.shape('designcut-plate', 'roundedRect', x + node.plate.dx, y + node.plate.dy, w, h, {
      fill: rgba(run.ctx.colors.accent, 0.16),
      borderRadius: sharp ? 0 : (run.ctx.radius.photo ?? DECOR_RADIUS),
    })
  }
  const frame = node.frame ?? (node.bleed ? 'plain' : 'decor')
  run.b.image('designcut-scene', src, x, y, w, h, { frame, sharp, ...decorRadius(frame, run.ctx), fit: node.fit ?? 'cover', imageType: 'designcut_product' })
  if (overlay) drawOverlay(run, overlay, scope, { y, h })
  if (badge && node.badge) {
    const inset = node.bleed ? MARGIN : BADGE.inset
    drawBadge(run.b, { layout: badge, corner: node.badge.corner, photo: { x, y, w }, inset, colors: run.ctx.colors, group: run.group() })
  }
  if (box) contain(box, run.b.elements.slice(start))
  // 반 띠 — 면이 사진 위 끝에서 사진 높이 절반까지 내려온다(D buildT3aHalf와 같은 식)
  if (node.half && run.halfFace) run.halfFace.transform.height = y + Math.round(h / 2) - HALF_TOP
  return y + h + (node.plate ? Math.max(0, node.plate.dy) : 0)
}

function drawCapsule(run: Run, node: Extract<FlowNode, { kind: 'capsule' }>, scope: Scope, y: number): number | null {
  const label = node.label ?? (node.slot ? textOf(scope.values[node.slot]) : null)
  if (!label) return null
  const { colors: c, radius } = run.ctx
  const fillSurf = node.outline ? scope.surf : surfaceOfFill(node.fill ?? 'A', c, scope.surf)
  const width = approxTextWidth(label, K_TYPE.LABEL.size) + 56
  const x = node.align === 'center' ? scope.x + Math.round((scope.w - width) / 2) : scope.x
  run.b.capsule('designcut-capsule', label, K_TYPE.LABEL, x, y, {
    ...(node.outline ? { stroke: fillSurf.text } : { fill: fillSurf.fill }),
    text: fillSurf.text,
    radius: radius.capsule,
  })
  // 진행 표시(R-W7) — 캡슐 줄 오른쪽 끝, 같은 높이라 아래를 밀지 않는다
  const line = node.steps ? capsuleStepsLine(node.steps, scope.values, scope.defs) : null
  const from = x + width + K_SPACE.columnGap
  if (line) drawSteps(run.b, line, { x: from, y, w: scope.x + scope.w - from, band: false, group: run.group() }, stepsInk(run, scope), K_TYPE.LABEL)
  return y + CAPSULE_H
}

/** 항목 색 띠를 바탕 쪽으로 섞는 비율 — 앞에서부터 바탕 글자색 대비 4.5를 지키는 첫 값을 쓴다(J54) */
export const ITEM_BAND_TINTS = [0.55, 0.7, 0.85] as const
/**
 * 띠가 바탕과 구분되는 최소 대비 — 흰 옵션 사진이 흰 바탕에서 띠가 사라져 이름만 떠 보였다(render-check 42848359713 PB-bands-4).
 * 이보다 낮으면 바탕에 글자색을 ITEM_BAND_EDGE_MIX만큼 섞은 옅은 띠로 바꾼다(진행 표시 띠와 같은 방식)
 */
export const ITEM_BAND_SEPARATION_MIN = 1.1
export const ITEM_BAND_EDGE_MIX = 0.07

/**
 * 항목 색 띠 면(J54 named-bands) — 옵션 사진 색(hex)을 바탕 쪽으로 섞어 옅은 띠를 만든다. 글자는 바탕 글자색 그대로라 페이지 글색이 흔들리지 않는다.
 * 대비 4.5를 지키는 섞음이 없거나 색이 아니면 null(부르는 쪽이 fill 토큰 면을 쓴다)
 */
export function itemBandSurface(hex: unknown, parent: Surf): Surf | null {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex.trim())) return null
  const ink = parseColor(parent.text)
  if (!ink) return null
  const tinted = ITEM_BAND_TINTS.map((t) => mix(hex.trim(), parent.fill, t)).find((color) => contrastRatio(ink, parseColor(color)!) >= 4.5)
  if (!tinted) return null
  const base = parseColor(parent.fill)
  const fill = base && contrastRatio(parseColor(tinted)!, base) < ITEM_BAND_SEPARATION_MIN ? mix(parent.fill, parent.text, ITEM_BAND_EDGE_MIX) : tinted
  return { fill, text: parent.text, dark: parent.dark }
}

/** 띠 위 옅은 글자 — 글자색을 띠 쪽으로 가장 많이 섞되 대비 4.5는 지킨다. 못 지키면 글자색 그대로 */
export const mutedOn = (text: string, band: string) =>
  [0.45, 0.35, 0.25, 0.15].map((t) => mix(text, band, t)).find((color) => contrastRatio(parseColor(color)!, parseColor(band)!) >= 4.5) ?? text

/**
 * 진행 표시 색 — 띠는 바탕에 글자색 7%를 섞은 색이다. 지금 탭 칸은 강조색 면(캡슐과 같은 A 면)과 그 위 글자, 나머지 탭은 띠 위 옅은 글자,
 * 지금 이름 글자는 띠 위 대비 4.5, 점은 3을 넘는 강조색(없으면 제목·글자색)이다
 */
export function stepsInk(run: Run, scope: Scope): StepsInk {
  const band: Surf = { ...scope.surf, fill: mix(scope.surf.fill, scope.surf.text, 0.07) }
  const c = run.ctx.colors
  const current = surfaceOfFill('A', c, scope.surf)
  return {
    text: scope.surf.text,
    band: band.fill,
    fill: current.fill,
    onFill: current.text,
    muted: mutedOn(scope.surf.text, band.fill),
    accent: emphasisOn(band, c, 4.5) ?? headingOn(band, c),
    dot: emphasisOn(band, c, 3) ?? band.text,
    radius: run.ctx.radius.chip,
  }
}

/** 견본 색 값 — 입력 #RRGGBB만(지어낸 색·이름 색은 받지 않는다) */
const SWATCH_HEX = /^#[0-9A-Fa-f]{6}$/

function drawMark(run: Run, node: Extract<FlowNode, { kind: 'mark' }>, scope: Scope, y: number): number | null {
  const { colors: c, radius } = run.ctx
  const x = node.align === 'center' ? scope.x + Math.round((scope.w - MARK_SIZE) / 2) : scope.x
  const shape = radius.chip > 100 ? 'circle' : 'roundedRect'
  if (node.color) {
    // 견본 색 칩(적용 C5 ③ T1-99) — 입력 색으로 칠한 도형만. 옅은 테두리는 흰·베이지 견본이 같은 밝기 바탕에 묻히지 않게
    const hex = textOf(scope.values[node.color])
    if (!hex || !SWATCH_HEX.test(hex)) return null
    run.b.shape('designcut-swatch', shape, x, y, MARK_SIZE, MARK_SIZE, { fill: hex, stroke: rgba(scope.surf.text, 0.2), strokeWidth: 2, borderRadius: 4 })
    return y + MARK_SIZE
  }
  const value = node.slot ? textOf(scope.values[node.slot]) : node.value
  if (!value) return null
  if (value === 'index') {
    const surf = surfaceOfFill('A', c, scope.surf)
    // 글자를 상자 식구로 묶지 않는다 — 마운트 리플로우가 상자 높이를 글자에 맞춰 줄여 원이 납작해진다(render-check 41272804976)
    run.b.shape('designcut-mark', shape, x, y, MARK_SIZE, MARK_SIZE, { fill: surf.fill, borderRadius: 4 })
    run.b.text('designcut-mark-number', String(scope.index + 1), MARK_NUMBER, x, y + 3, MARK_SIZE, surf.text, 'center')
    return y + MARK_SIZE
  }
  if (value === 'dash') {
    // 중립 표식 — 원·테두리 없이 회색 줄표만 그린다. 없다·나쁘다로 읽히지 않게 엑스 자리를 비운다
    const dash = rgba(scope.surf.text, 0.55)
    run.b.svg(
      'designcut-mark-dash',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><path d="M26 44h36" fill="none" stroke="${dash}" stroke-width="7" stroke-linecap="round"/></svg>`,
      x,
      y,
      MARK_SIZE,
      MARK_SIZE
    )
    return y + MARK_SIZE
  }
  if (value === 'warn') {
    // 경고 느낌표(K4 T1-67) — 채우지 않은 원·모서리 상자에 강조색 테두리와 느낌표. 그림이라 바탕 대비 3 이상, 못 만들면 바탕 글자색이다
    const ink = emphasisOn(scope.surf, c, 3) ?? scope.surf.text
    run.b.shape('designcut-mark', shape, x, y, MARK_SIZE, MARK_SIZE, { fill: 'transparent', stroke: ink, strokeWidth: 3, borderRadius: 4 })
    run.b.svg(
      'designcut-mark-warn',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><path d="M44 24v28" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"/><circle cx="44" cy="64" r="5" fill="${ink}"/></svg>`,
      x,
      y,
      MARK_SIZE,
      MARK_SIZE
    )
    return y + MARK_SIZE
  }
  const positive = value === 'check'
  const surf = positive ? surfaceOfFill('A', c, scope.surf) : scope.surf
  run.b.shape('designcut-mark', shape, x, y, MARK_SIZE, MARK_SIZE, {
    ...(positive ? { fill: surf.fill } : { fill: 'transparent', stroke: rgba(scope.surf.text, 0.35), strokeWidth: 2 }),
    borderRadius: 4,
  })
  const ink = positive ? surf.text : rgba(scope.surf.text, 0.55)
  const path = positive ? 'M24 46l14 14 26-30' : 'M28 28l32 32M60 28L28 60'
  run.b.svg(
    `designcut-mark-${positive ? 'check' : 'cross'}`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><path d="${path}" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    x,
    y,
    MARK_SIZE,
    MARK_SIZE
  )
  return y + MARK_SIZE
}

/** 아이콘 — 사전에 있는 이름만 그린다. 빈 값·모르는 이름은 요소 없음. 원 바탕은 체크 표식과 같은 강조색, 없으면 바탕 위 강조색(대비 3 이상) */
function drawIcon(run: Run, node: Extract<FlowNode, { kind: 'icon' }>, scope: Scope, y: number): number | null {
  const inner = iconFragment(textOf(scope.values[node.slot]) ?? '')
  if (!inner) return null
  const { colors: c, radius } = run.ctx
  const { size } = node
  const x = node.align === 'center' ? scope.x + Math.round((scope.w - size) / 2) : scope.x
  const disc = node.disc ? surfaceOfFill('A', c, scope.surf) : null
  if (disc) run.b.shape('designcut-icon-disc', radius.chip > 100 ? 'circle' : 'roundedRect', x, y, size, size, { fill: disc.fill, borderRadius: 4 })
  const ink = disc ? disc.text : (emphasisOn(scope.surf, c, 3) ?? scope.surf.text)
  const pad = disc ? Math.round(size * ICON_DISC_PAD) : 0
  run.b.svg(
    'designcut-icon',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
    x + pad,
    y + pad,
    size - pad * 2,
    size - pad * 2
  )
  return y + size
}

/** 짧은 이름표 묶음 — 장식 라벨 규칙(한 줄·12자 이하·32px)을 따르고, 한 묶음이 장식 하나다. 폭을 넘으면 다음 줄 */
const tagWidths = (tags: readonly string[]) => tags.map((tag) => approxTextWidth(tag, K_TYPE.LABEL.size) + TAG.pad * 2)

/** 이름표 줄 나누기 — 줄마다 든 이름표 번호 */
function tagLines(widths: readonly number[], maxW: number): number[][] {
  const lines: number[][] = [[]]
  let used = 0
  widths.forEach((width, i) => {
    const line = lines[lines.length - 1]
    if (line.length > 0 && used + TAG.gap + width > maxW) {
      lines.push([i])
      used = width
      return
    }
    used += (line.length > 0 ? TAG.gap : 0) + width
    line.push(i)
  })
  return lines
}

function drawTags(run: Run, node: Extract<FlowNode, { kind: 'tags' }>, scope: Scope, y: number, groupId?: string): number | null {
  // 반복 칸 안에서는 항목마다 이름 하나(문자열)다
  const value = scope.values[node.slot]
  const tags = typeof value === 'string' ? (value.trim() ? [value] : []) : stringList(value)
  if (tags.length === 0) return null
  const group = groupId ?? scope.tagGroup ?? run.group()
  const widths = tagWidths(tags)
  const lines = tagLines(widths, scope.w)
  const marked = (el: CanvasElement) => {
    el.groupId = group
    return el
  }
  lines.forEach((line, row) => {
    const lineW = line.reduce((sum, i) => sum + widths[i], 0) + TAG.gap * (line.length - 1)
    let x = node.align === 'center' ? scope.x + Math.round((scope.w - lineW) / 2) : scope.x
    const lineY = y + row * (TAG.h + TAG.gap)
    for (const i of line) {
      const bg = marked(
        run.b.shape(`annotation-chip-${i}`, 'roundedRect', x, lineY, widths[i], TAG.h, {
          fill: rgba(scope.surf.text, 0.08),
          borderRadius: node.pill || run.ctx.radius.chip > 100 ? TAG.h / 2 : run.ctx.radius.chip,
        })
      )
      const text = run.b.text(`annotation-label-${i}`, tags[i], K_TYPE.LABEL, x, lineY + TAG.textTop, widths[i], scope.surf.text, 'center')
      marked(text.el)
      contain(bg, [text.el])
      x += widths[i] + TAG.gap
    }
  })
  return y + lines.length * TAG.h + (lines.length - 1) * TAG.gap
}

/** 별점 기호 — 입력값으로만 그린다. 숫자가 아니면 그리지 않는다(근거 없는 별 5개 금지) */
function drawRating(run: Run, node: Extract<FlowNode, { kind: 'rating' }>, scope: Scope, y: number): number | null {
  const value = Number(textOf(scope.values[node.slot]))
  if (!Number.isFinite(value) || value <= 0 || value > 5) return null
  const filled = Math.round(value)
  const stars = '★'.repeat(filled) + '☆'.repeat(5 - filled) + (node.value ? ` ${textOf(scope.values[node.slot])}` : '')
  // 별만이면 기호 대비(3), 숫자가 함께면 글자 대비(4.5)
  const color = emphasisOn(scope.surf, run.ctx.colors, node.value ? 4.5 : 3) ?? scope.surf.text
  return run.b.text('designcut-rating', stars, K_TYPE.H3, scope.x, y, scope.w, color, node.align ?? 'left').bottom
}

/** 별점 분포 글(CAPTION) 한 줄 높이 — 막대를 이 줄 가운데에 둔다 */
const BARS_LINE_H = Math.round(K_TYPE.CAPTION.size * K_TYPE.CAPTION.lineHeight)
/**
 * 별점 분포 막대 한 줄의 치수 — 줄 높이가 고정이라 높이 추정이 결정론이다(BARS_H). rowH는 CAPTION 한 줄 글 상자 추정 높이(measureCutText, 한 줄 + 10)와
 * 같아 글 상자가 줄 밖으로 나가지 않는다
 */
export const BARS = { rowH: BARS_LINE_H + 10, gap: 18, labelW: 96, pctW: 104, trackH: 20, radius: 10 } as const
export const BARS_H = (rows: number) => (rows > 0 ? rows * BARS.rowH + (rows - 1) * BARS.gap : 0)

/**
 * 별점 분포 막대(적용 K7-b) — 입력 목록(RATING_BARS_INPUT)으로만 그린다. 비었으면 그리지 않는다(근거 없는 기본값 금지, #289).
 * 줄마다 'N점' 라벨 + 트랙(옅은 글자색) + share 비율 채움(강조색) + 퍼센트 글. 0%면 채움이 없다.
 * 줄마다 투명 행 상자(designcut-row)로 묶는다 — 마운트 리플로우가 글 높이를 실측으로 줄이거나 늘릴 때 같은 줄 막대는 그대로 두고
 * 아래 줄을 상자 맞춤으로 한 번만 옮긴다. 묶지 않으면 라벨·퍼센트 두 글이 따로 아래를 밀어 줄마다 글과 막대가 어긋난다(render 41596478661)
 */
function drawBars(run: Run, node: Extract<FlowNode, { kind: 'bars' }>, scope: Scope, y: number): number | null {
  const rows = (Array.isArray(scope.values[node.slot]) ? (scope.values[node.slot] as unknown[]) : []).filter(
    (row): row is Record<string, string> => !!row && typeof row === 'object'
  )
  if (rows.length === 0) return null
  const ink = emphasisOn(scope.surf, run.ctx.colors, 3) ?? scope.surf.text
  const trackX = scope.x + BARS.labelW
  const trackW = Math.max(0, scope.w - BARS.labelW - BARS.pctW)
  rows.forEach((row, i) => {
    const top = y + i * (BARS.rowH + BARS.gap)
    const share = Math.min(1, Math.max(0, Number(row.share) || 0))
    const trackY = top + Math.round((BARS_LINE_H - BARS.trackH) / 2)
    const start = run.b.elements.length
    const box = run.b.shape('designcut-row', 'rect', scope.x, top, scope.w, BARS.rowH, { fill: 'transparent' })
    run.b.text('designcut-bars-label', `${row.star}점`, K_TYPE.CAPTION, scope.x, top, BARS.labelW, scope.surf.text, 'left')
    run.b.shape('designcut-bars-track', 'roundedRect', trackX, trackY, trackW, BARS.trackH, { fill: rgba(scope.surf.text, 0.12), borderRadius: BARS.radius })
    const fillW = Math.round(trackW * share)
    if (fillW > 0) run.b.shape('designcut-bars-fill', 'roundedRect', trackX, trackY, fillW, BARS.trackH, { fill: ink, borderRadius: BARS.radius })
    run.b.text('designcut-bars-pct', `${Math.round(share * 100)}%`, K_TYPE.CAPTION, trackX + trackW, top, BARS.pctW, scope.surf.text, 'right')
    contain(box, run.b.elements.slice(start + 1))
  })
  return y + BARS_H(rows.length)
}

/** 치수 글자의 첫 숫자와 단위 — 없으면 null */
function sizeIn(text: string | null): { value: number; unit: string | null } | null {
  const match = text?.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?(?![a-z])/i)
  const value = Number(match?.[1])
  return Number.isFinite(value) && value > 0 ? { value, unit: match?.[2]?.toLowerCase() ?? null } : null
}

/** 입력 치수 글 → 치수선 판정 값(sizeLine) — 숫자를 못 읽은 축은 뺀다. 단위가 없으면 빈 글이라 두 축이 있어도 비율을 믿지 않아 선을 긋지 않는다 */
function lineDimsOf(width: string | null, height: string | null) {
  return ([['w', width], ['h', height]] as const).flatMap(([axis, value]) => {
    const size = sizeIn(value)
    return size ? [{ axis, value: size.value, unit: size.unit ?? '' }] : []
  })
}

/** 치수선이 제품에서 떨어지는 거리와 양 끝 눈금 반 길이 */
const LINE = { gap: 28, cap: 12 }

/** 사진 바탕과 대비가 더 큰 글자색 — 짙은 바탕 사진이면 흰색. 바탕을 못 쟀으면 본문 색 */
function lineInkOn(background: string | undefined, ink: string): string {
  const bg = background ? parseColor(background) : null
  const [dark, light] = [parseColor(ink), parseColor('#FFFFFF')]
  if (!bg || !dark || !light) return ink
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? ink : '#FFFFFF'
}

/**
 * 치수 도면(적용 K14, 오너 11-04 13:4x '제품으로 가로 세로 길이를 보여줘야 하는데 사각형으로 보여주니까 직관적이지 않다') — 사이즈 단독 컷을 놓고 재 둔 제품 경계에 가로·세로 선을 긋는다.
 * 사진 틀이 아니라 제품 경계라 입력 치수와 맞는다(sizeLines.ts). 경계를 못 쟀거나 믿기 어렵거나 비율이 입력과 다르면(옛 잡 포함) 선 없이 사진과 치수 글만 둔다 — 틀린 선보다 낫다.
 * 깊이는 선을 긋지 않고 글로만 적는다. 나란히(side)는 사진 옆에, 그 밖은 사진 아래에 치수 글을 둔다. 치수가 하나도 없으면 그리지 않는다(지어내지 않는다)
 */
function drawDimension(run: Run, node: DimensionNode, scope: Scope, y: number): number | null {
  const def = scope.defs[node.slot]
  const src = run.ctx.image(textOf(scope.values[node.slot]))
  const width = textOf(scope.values[node.widthSlot])
  const height = textOf(scope.values[node.heightSlot])
  const depth = node.depthSlot ? textOf(scope.values[node.depthSlot]) : null
  if (!src || def?.type !== 'image' || (!width && !height && !depth)) return null
  const side = node.side === true
  const w = side ? Math.floor((scope.w - K_SPACE.columnGap) / 2) : (node.w ?? scope.w)
  const h = photoHeight(def, src, w, run.ctx)
  run.b.image('designcut-scene', src, scope.x, y, w, h, { frame: 'decor', sharp: isSharp(run.ctx), ...decorRadius('decor', run.ctx), fit: 'contain', imageType: 'designcut_product' })

  const group = run.group()
  const box = run.ctx.productBoxOf?.(src) ?? null
  const line = sizeLine({ x: scope.x, y, w, h }, box, lineDimsOf(width, height))
  if (line) {
    const { gap, cap } = LINE
    // 사진 틀 안 좌표 — 제품이 틀에 가까우면 선을 틀 안으로 당긴다
    const [left, top, right, bottom] = [line.x - scope.x, line.y - y, line.x - scope.x + line.w, line.y - y + line.h]
    const belowY = Math.min(bottom + gap, h - cap - LEADER.stroke)
    const besideX = Math.min(right + gap, w - cap - LEADER.stroke)
    const paths = [
      ...(width ? [`M${left} ${belowY}H${right}M${left} ${belowY - cap}V${belowY + cap}M${right} ${belowY - cap}V${belowY + cap}`] : []),
      ...(height ? [`M${besideX} ${top}V${bottom}M${besideX - cap} ${top}H${besideX + cap}M${besideX - cap} ${bottom}H${besideX + cap}`] : []),
    ]
    const el = run.b.svg(
      'annotation-leader-box',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path d="${paths.join('')}" fill="none" stroke="${lineInkOn(box?.background, run.ctx.colors.ink)}" stroke-width="${LEADER.stroke}" stroke-linecap="round"/></svg>`,
      scope.x,
      y,
      w,
      h
    )
    el.groupId = group
  }
  const labels = [width, height, depth].filter((v): v is string => Boolean(v))
  const tags = (x: number, tagW: number, tagY: number) => drawTags(run, { kind: 'tags', slot: '__dim', align: 'center' }, { ...scope, x, w: tagW, values: { __dim: labels } }, tagY, group)
  const sideW = scope.w - w - K_SPACE.columnGap
  if (side && tagLines(tagWidths(labels), sideW).every((row) => row.length > 0) && Math.max(...tagWidths(labels)) <= sideW) {
    const rows = tagLines(tagWidths(labels), sideW).length
    const tagsH = rows * TAG.h + (rows - 1) * TAG.gap
    tags(scope.x + w + K_SPACE.columnGap, sideW, y + Math.max(0, Math.round((h - tagsH) / 2)))
    return y + h
  }
  const labelY = y + h + K_SPACE.tightGap
  return tags(scope.x, scope.w, labelY) ?? labelY
}

/**
 * 같은 축척 윤곽(적용 K7 4d T1-84·T2-32) — 입력 목록(SIZE_SCALE_INPUT, scaleRows가 고른 가로·세로)으로만 그린다. 같은 폭 열마다 한 축척으로 줄인 사각형을
 * 바닥 맞춤으로 세우고(밑줄 하나, 지시선 굵기), 열 아래 이름표(3자 이하 — 표식이라 본문 열이 아니다), 그 아래 전체 폭에 행마다 치수 줄(입력 글 그대로)을 둔다.
 * 사각형은 제품 모양이 아니라 입력 숫자의 윤곽이다. 숫자를 못 읽는 항목이 하나라도 있으면 그리지 않는다(지어내지 않는다)
 */
function drawScaleSet(run: Run, node: ScaleSetNode, scope: Scope, y: number): number | null {
  const def = scope.defs[node.slot]
  if (def?.type !== 'list') return null
  const field = (input: string) => Object.entries(def.fields).find(([, f]) => f.type === 'text' && f.input === input)?.[0]
  const [labelKey, widthKey, heightKey] = [field(SIZE_SCALE_LABEL_INPUT), field(SIZE_SCALE_WIDTH_INPUT), field(SIZE_SCALE_HEIGHT_INPUT)]
  const items = listItems(def, scope.values[node.slot])
  if (!labelKey || !widthKey || !heightKey || items.length < 2) return null
  const rows = items.map((item) => ({ label: textOf(item[labelKey]) ?? '', width: textOf(item[widthKey]) ?? '', height: textOf(item[heightKey]) ?? '' }))
  const sizes = rows.map((row) => ({ w: shownMm(row.width), h: shownMm(row.height) }))
  if (sizes.some((s) => s.w === null || s.h === null)) return null
  const gap = K_SPACE.columnGap
  const layout = scaleLayout(sizes as Array<{ w: number; h: number }>, scope.w, gap)
  const ink = scope.surf.text
  const half = LEADER.stroke / 2
  const svgH = layout.height + LEADER.stroke
  const base = svgH - half
  const paths = layout.boxes.map((box, i) => {
    const x0 = Math.max(half, i * (layout.colW + gap) + box.x)
    const x1 = Math.min(scope.w - half, x0 + box.w)
    return `M${x0} ${base - box.h}H${x1}V${base}H${x0}Z`
  })
  paths.push(`M${half} ${base}H${scope.w - half}`)
  const group = run.group()
  const el = run.b.svg(
    'annotation-leader-scale',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scope.w} ${svgH}"><path d="${paths.join('')}" fill="none" stroke="${ink}" stroke-width="${LEADER.stroke}" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
    scope.x,
    y,
    scope.w,
    svgH
  )
  el.groupId = group
  // 열 이름표 — 한 줄을 투명 행 상자로 묶어 리플로우가 이름표마다 따로 아래를 밀지 않게 한다(별점 분포 줄과 같은 까닭). 표 행(designcut-row)과 이름을 갈라 표 행 높이 맞춤에 섞이지 않는다
  const labelTop = y + svgH + K_SPACE.tightGap
  const start = run.b.elements.length
  const box = run.b.shape('designcut-scale-row', 'rect', scope.x, labelTop, scope.w, 0, { fill: 'transparent' })
  let labelBottom = labelTop
  rows.forEach((row, i) => {
    const { bottom } = run.b.text('designcut-scale-label', row.label, K_TYPE.LABEL, scope.x + i * (layout.colW + gap), labelTop, layout.colW, ink, 'center')
    labelBottom = Math.max(labelBottom, bottom)
  })
  box.transform.height = labelBottom - labelTop
  contain(box, run.b.elements.slice(start + 1))
  // 치수 줄 — 전체 폭, 행마다 하나(입력 글 그대로)
  let lineTop = labelBottom + K_SPACE.rowGap
  rows.forEach((row, i) => {
    if (i > 0) lineTop += K_SPACE.tableTight
    lineTop = run.b.text('designcut-scale-dims', `${row.label}  ${row.width} · ${row.height}`, K_TYPE.TABLE, scope.x, lineTop, scope.w, ink, 'left').bottom
  })
  return lineTop
}

/** 말풍선 꼬리 쪽 모서리 반경 — D 말풍선(templatesInfo)과 같은 값 */
const TAIL_RADIUS = 8
const TAIL_INDEX: Readonly<Record<TailCorner, number>> = { tl: 0, tr: 1, br: 2, bl: 3 }
/** 네 모서리 반경 [왼위, 오위, 오아래, 왼아래] — 꼬리 모서리만 작게 */
const tailRadii = (radius: number, tail: TailCorner): [number, number, number, number] => {
  const radii: [number, number, number, number] = [radius, radius, radius, radius]
  radii[TAIL_INDEX[tail]] = TAIL_RADIUS
  return radii
}

/** 윤곽선 카드의 선 굵기 — D 카드 테두리·캡슐 윤곽선과 같은 값 */
const OUTLINE_W = 2

/** 곡선 경계 쪽이 같은 섹션 안 간격인가 — 섹션 끝이면 맞닿는 이웃 섹션 바탕을 몰라 덮개를 칠하지 않는다(곧은 가장자리) */
const edgeOpen = (run: Run, node: PanelNode, side: 'top' | 'bottom') =>
  run.ends !== undefined && (side === 'top' ? run.ends.first !== node : run.ends.last !== node)

function drawPanel(run: Run, node: PanelNode, scope: Scope, y: number): number | null {
  const { ctx, t, b } = run
  // 윤곽선 카드는 채움이 없어 글이 바깥 바탕 위에 선다. 선 색은 화살표와 같은 장식 선 규칙(대비 3)
  const outline = node.outline === true && !node.bleed
  const itemBand = !outline && node.fillFrom ? itemBandSurface(scope.values[node.fillFrom], scope.surf) : null
  const surf = outline ? scope.surf : (itemBand ?? surfaceOfFill(node.fill, ctx.colors, scope.surf))
  const x = node.bleed ? 0 : (node.x ?? scope.x)
  const w = node.bleed ? W : (node.w ?? scope.w)
  const padX = node.bleed ? MARGIN : K_SPACE.cardPad
  const bandPad = node.bleed && node.pad ? K_SPACE[node.pad] : null
  const padTop = bandPad ?? (node.bleed ? t.spacing.top : K_SPACE.cardPad)
  const padBottom = bandPad ?? (node.bleed ? t.spacing.bottom : K_SPACE.cardPad)
  const radius = node.bleed ? 0 : radiusOfName(node.radius, ctx)
  // 도형을 먼저(아래 z). 안쪽이 모두 비면 도형도 뺀다
  const start = b.elements.length
  const corners = radius > TAIL_RADIUS && node.tail ? tailRadii(radius, node.tail) : null
  // 채움 없는 둥근 상자는 내보내기가 흰색으로 칠하므로 투명을 밝힌다
  const paint = outline
    ? { fill: 'transparent', stroke: emphasisOn(scope.surf, ctx.colors, 3) ?? scope.surf.text, strokeWidth: OUTLINE_W }
    : { fill: surf.fill }
  const panel = b.shape('designcut-panel', radius > 0 ? 'roundedRect' : 'rect', x, y, w, 0, {
    ...paint,
    ...(corners ? { borderRadii: corners } : radius > 0 ? { borderRadius: radius } : {}),
  })
  const innerY = y + padTop
  const inner: Scope = { ...scope, surf, x: x + padX, w: w - padX * 2, boxed: true }
  const bottom = drawNodes(run, node.nodes, inner, innerY)
  if (bottom === null) {
    b.elements.length = start
    return null
  }
  panel.transform.height = bottom + padBottom - y
  // 곡선 경계 — 안쪽 여백 안에 바깥 바탕색 덮개를 얹고 띠 밖 간격 쪽으로 조금 내민다(경계 실선 방지). 띠 상자 식구라 글이 늘면 아래 덮개도
  // 함께 내려가고, 내민 식구(overhang)라 리플로가 띠 높이를 맞출 때는 뺀다
  const edge = node.bleed && node.edge && edgeOpen(run, node, node.edge.side) ? node.edge : null
  if (edge) {
    const box = panelEdgeBox(edge.side, { y, h: panel.transform.height })
    b.svg(PANEL_EDGE_NAME, panelEdgeSvg(edge, scope.surf.fill, W), 0, box.y, W, box.h).overhang = true
  }
  // 편집 뒤 글이 늘면 안쪽 요소끼리 밀고 상자도 늘어난다 — 사진·표시도 같은 상자 식구다
  contain(panel, b.elements.slice(start + 1))
  return y + panel.transform.height
}

const hasKind = (nodes: readonly FlowNode[], kind: FlowNode['kind']): boolean =>
  nodes.some((n) => {
    if (n.kind === kind) return true
    if (n.kind === 'panel' || n.kind === 'repeat') return hasKind(n.nodes, kind)
    return n.kind === 'row' && n.columns.some((c) => hasKind(c.nodes, kind))
  })

function drawRow(run: Run, node: RowNode, scope: Scope, y: number): number | null {
  const gap = node.gap ?? K_SPACE.columnGap
  let x = scope.x
  let bottom: number | null = null
  const spans: Array<{ from: number; to: number; end: number | null }> = []
  // 사진 옆 글 — 줄 높이는 사진이 정할 수 있는데, 리플로우는 글이 줄어든 만큼 아래를 올려 구분선·다음 줄이 사진을 덮는다(render-check 41285031668).
  // 보이지 않는 상자로 묶으면 안쪽 글만 서로 밀고, 아래로는 줄 전체의 높이 변화만 전한다.
  // 칸 안에 상자가 있으면 묶지 않는다 — 그 상자가 이미 높이 변화를 전해서, 겹쳐 묶으면 사진·아래 글을 또 민다(compare.tile-duel)
  // 표 행(box)은 띠·카드 상자 안에서도 묶는다 — 리플로가 가장 안쪽 상자 안에서만 밀고 안쪽 상자부터 맞춘다(K8). 사진 줄은 상자 밖에서만 묶는다(전과 같음)
  const start = run.b.elements.length
  const even = scope.rowMin !== undefined
  const box =
    (node.box === true || even || (!scope.boxed && node.columns.some((c) => hasKind(c.nodes, 'image')))) &&
    node.columns.some((c) => hasKind(c.nodes, 'text')) &&
    !node.columns.some((c) => hasKind(c.nodes, 'panel'))
      ? run.b.shape('designcut-row', 'rect', scope.x, y, scope.w, 0, { fill: 'transparent' })
      : null
  for (const column of node.columns) {
    const from = run.b.elements.length
    const end = drawNodes(run, column.nodes, { ...scope, x, w: column.w, boxed: scope.boxed || box !== null, rowMin: undefined, rowGroup: undefined, centered: even }, y)
    spans.push({ from, to: run.b.elements.length, end })
    if (end !== null) bottom = Math.max(bottom ?? y, end)
    x += column.w + gap
  }
  if (bottom === null) {
    run.b.elements.length = start
    return null
  }
  // 표 행 높이 맞춤(K10) — 맞춘 높이까지 세우고 칸마다 세로 가운데에 둔다. 행 묶음이라 리플로가 실측으로 다시 맞춘다
  if (even) bottom = Math.max(bottom, y + scope.rowMin!)
  if (box) {
    box.transform.height = bottom - y
    if (scope.rowGroup) box.rowGroup = scope.rowGroup
    contain(box, run.b.elements.slice(start + 1))
  }
  if (node.valign === 'center' || even) {
    for (const span of spans) {
      if (span.end === null) continue
      const shift = Math.round((bottom - span.end) / 2)
      for (const el of run.b.elements.slice(span.from, span.to)) el.transform.y += shift
    }
  }
  if (node.valign === 'stretch') {
    // 타일 — 칸의 첫 요소가 상자면 가장 긴 칸 높이까지 늘리고, 안쪽을 세로 가운데로 옮긴다
    for (const span of spans) {
      const first = run.b.elements[span.from]
      if (span.end === null || first?.name !== 'designcut-panel') continue
      const grow = bottom - span.end
      first.transform.height += grow
      const shift = Math.round(grow / 2)
      for (const el of run.b.elements.slice(span.from + 1, span.to)) el.transform.y += shift
    }
  }
  return bottom
}

function drawDivider(run: Run, node: Extract<FlowNode, { kind: 'divider' }>, scope: Scope, y: number): number {
  const fill = rgba(scope.surf.text, 0.25)
  run.b.shape('designcut-rule', 'rect', node.x ?? scope.x, y, node.w ?? scope.w, RULE_H, { fill })
  return y + RULE_H
}

function drawArrow(run: Run, scope: Scope, y: number): number {
  const stroke = emphasisOn(scope.surf, run.ctx.colors, 3) ?? scope.surf.text
  run.b.svg(
    'designcut-arrow',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARROW.w} ${ARROW.h}"><path d="M8 10l28 34 28-34" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    scope.x + Math.round((scope.w - ARROW.w) / 2),
    y,
    ARROW.w,
    ARROW.h
  )
  return y + ARROW.h
}

function drawRepeat(run: Run, node: RepeatNode, scope: Scope, y: number): number | null {
  const def = scope.defs[node.slot]
  if (def?.type !== 'list') return null
  const items = listItems(def, scope.values[node.slot])
  if (items.length === 0 || items.length < def.min) return null
  if (node.layer) return drawLayers(run, node, def, items, scope, y)
  const columns = node.columns ?? 1
  const gap = gapOf(run.t, node.gap ?? 'itemGap')
  const colW = Math.floor((scope.w - K_SPACE.columnGap * (columns - 1)) / columns)
  const tagGroup = node.nodes.some((child) => child.kind === 'tags' || child.kind === 'steps') ? run.group() : scope.tagGroup
  const even = node.even ? run.evenHeights?.get(node) : undefined
  // 좌우 번갈아 — 둘째·넷째 항목은 가로 칸 순서를 뒤집는다. 칸 폭이 칸과 함께 옮겨 글 폭·높이는 그대로다
  const flipped = node.alternate && isRowItem(node.nodes) ? [flipRow(node.nodes[0] as RowNode)] : null
  const compacted = run.compacted?.has(def) === true
  let top = y
  let bottom = y
  for (let row = 0; row * columns < items.length; row++) {
    if (row > 0) {
      top = bottom + gap
      if (node.rule) top = drawDivider(run, { kind: 'divider' }, scope, bottom + gap) + gap
      if (node.connector) top = drawArrow(run, scope, bottom + K_SPACE.tightGap) + K_SPACE.tightGap
    }
    let rowBottom = top
    const rowItems = items.slice(row * columns, (row + 1) * columns)
    // 뺀 컷으로 줄어든 목록(J44) — 덜 찬 마지막 줄은 칸 크기 그대로 가운데로 모아 빈 칸이 한쪽에 남지 않게 한다(4 → 3은 위 2·아래 1)
    const shift = compacted ? Math.round(((columns - rowItems.length) * (colW + K_SPACE.columnGap)) / 2) : 0
    rowItems.forEach((item, i) => {
      const inner: Scope = {
        ...scope,
        values: item,
        defs: def.fields,
        index: row * columns + i,
        x: scope.x + shift + i * (colW + K_SPACE.columnGap),
        w: colW,
        tagGroup,
        items,
      }
      const nodes = flipped && inner.index % 2 === 1 ? flipped : node.nodes
      const end = even === undefined ? drawNodes(run, nodes, inner, top) : drawEvenItem(run, nodes, inner, top, even)
      if (end !== null) rowBottom = Math.max(rowBottom, end)
    })
    bottom = rowBottom
  }
  return bottom
}

export const LAYER_BAND_NAME = 'designcut-layer'
/**
 * 층 띠(T1-85) — 항목마다 칸 폭 띠를 맞닿게 쌓는다. 위가 옅고 아래가 짙은 같은 강조색 단계, 글자색은 띠마다 대비 4.5(layer-band.ts).
 * 띠는 직각이다(층 단면). 띠마다 안쪽 글을 상자 식구로 묶어 글이 늘면 그 띠가 늘고 아래 띠를 민다. 색을 못 맞추면 목록을 그리지 않는다
 */
function drawLayers(run: Run, node: RepeatNode, def: ListSlot, items: readonly SlotItem[], scope: Scope, y: number): number | null {
  const inks = layerInks(scope.surf, run.ctx.colors, items.length)
  if (!inks) return null
  const start = run.b.elements.length
  const pad = K_SPACE.cardPad
  let top = y
  items.forEach((item, index) => {
    const ink = inks[index]
    const from = run.b.elements.length
    const band = run.b.shape(LAYER_BAND_NAME, 'rect', scope.x, top, scope.w, 0, { fill: ink.fill })
    const inner: Scope = { ...scope, values: item, defs: def.fields, index, surf: ink, x: scope.x + pad, w: scope.w - pad * 2, boxed: true, items }
    const end = drawNodes(run, node.nodes, inner, top + pad)
    if (end === null) {
      run.b.elements.length = from
      return
    }
    band.transform.height = end + pad - top
    contain(band, run.b.elements.slice(from + 1))
    top += band.transform.height
  })
  if (top === y) {
    run.b.elements.length = start
    return null
  }
  return top
}

const isRowItem = (nodes: readonly FlowNode[]) => nodes.length === 1 && nodes[0].kind === 'row'
const flipRow = (row: RowNode): RowNode => ({ ...row, columns: [...row.columns].reverse() })

/** 같은 표의 행 높이(엔진 추정)와 행 묶음 id */
interface EvenRows {
  h: number
  id: string
}

/**
 * 항목 하나(K10) — 좌우 표 칸(가로 칸 하나)은 행 높이까지 세워 칸마다 가운데, 쌓기 항목은 보이지 않는 상자로 묶어 덩어리를 가운데에 둔다.
 * 어느 쪽이든 행 상자에 행 묶음 id를 달아, 리플로가 실측 글 높이로 행 높이·가운데를 다시 맞춘다(추정이 한 줄 많아도 어긋나지 않는다)
 */
function drawEvenItem(run: Run, nodes: FlowNode[], scope: Scope, top: number, even: EvenRows): number | null {
  const rowH = even.h
  if (isRowItem(nodes)) return drawNodes(run, nodes, { ...scope, rowMin: rowH, rowGroup: even.id }, top)
  const h = probeHeight(run, nodes, { ...scope, boxed: true })
  if (h === null) return null
  const start = run.b.elements.length
  const box = run.b.shape('designcut-row', 'rect', scope.x, top, scope.w, 0, { fill: 'transparent' })
  const end = drawNodes(run, nodes, { ...scope, boxed: true }, top + Math.max(0, Math.round((rowH - h) / 2)))
  if (end === null) {
    run.b.elements.length = start
    return null
  }
  const bottom = Math.max(end, top + rowH)
  box.transform.height = bottom - top
  box.rowGroup = even.id
  contain(box, run.b.elements.slice(start + 1))
  return bottom
}

/** 미리 재기 — 버리는 빌더에 그려 높이만 본다(edgeBleeds와 같다) */
function probeHeight(run: Run, nodes: FlowNode[], scope: Scope): number | null {
  const probe: Run = { t: run.t, ctx: run.ctx, b: new CutBuilder(), group: () => '' }
  return drawNodes(probe, nodes, scope, 0)
}

/** 항목 글의 가장 큰 한 줄 높이 */
const lineOfNodes = (nodes: readonly FlowNode[]): number =>
  Math.max(
    0,
    ...nodes.map((n) => {
      if (n.kind === 'text') return K_TYPE[n.token].size * K_TYPE[n.token].lineHeight
      if (n.kind === 'row') return Math.max(0, ...n.columns.map((c) => lineOfNodes(c.nodes)))
      return 0
    })
  )

/**
 * 같은 표의 행 높이 — 이 반복과 바로 뒤 joinRule 반복(rows·special)의 항목을 모두 재서, 가장 낮은 행보다 한 줄 높은 행까지를 같은 높이로 맞춘다.
 * 그보다 긴 행(3줄 이상 값)은 제 높이다
 */
function measureEvenRows(run: Run, nodes: readonly FlowNode[], scope: Scope) {
  nodes.forEach((node, i) => {
    if (node.kind !== 'repeat' || !node.even || run.evenHeights?.has(node)) return
    const group: RepeatNode[] = [node]
    for (const next of nodes.slice(i + 1)) {
      if (next.kind !== 'repeat' || !next.even || !next.joinRule) break
      group.push(next)
    }
    const heights: number[] = []
    for (const repeat of group) {
      const def = scope.defs[repeat.slot]
      if (def?.type !== 'list') continue
      listItems(def, scope.values[repeat.slot]).forEach((item, index) => {
        // 좌우 표 칸은 맞춤 없이(최소 높이 0) 재야 이름 내림 없이 칸 높이가 나온다
        const inner: Scope = { ...scope, values: item, defs: def.fields, index, ...(isRowItem(repeat.nodes) ? { rowMin: 0 } : { boxed: true }) }
        const h = probeHeight(run, repeat.nodes, inner)
        if (h !== null) heights.push(h)
      })
    }
    const low = Math.min(...heights)
    const span = Math.max(...group.map((r) => lineOfNodes(r.nodes)))
    const rowH = heights.length ? Math.max(...heights.filter((h) => h <= low + span + 1)) : 0
    const id = uid('rows')
    for (const repeat of group) (run.evenHeights ??= new Map()).set(repeat, { h: rowH, id })
  })
}

function drawNode(run: Run, node: FlowNode, scope: Scope, y: number): number | null {
  switch (node.kind) {
    case 'text': {
      const raw = textOf(scope.values[node.slot])
      if (!raw) return null
      const content = node.format === 'two' ? raw.padStart(2, '0') : raw
      const color = colorOf(node.color, node.token, scope.surf, run.ctx.colors)
      const accent = node.emphasis ? accentOf(run.ctx, scope.surf) : null
      const x = node.x ?? scope.x
      const w = node.w ?? scope.w
      // 큰 제목은 2줄에 들어가는 크기로(D 라인 첫 화면과 같다)
      const token = node.token === 'HOOK' ? fitHookToken(K_TYPE.HOOK, content, w, K_HOOK_STEP_SIZES) : K_TYPE[node.token]
      const drop = node.nameTag && !scope.centered ? NAME_DROP : 0
      const drawn = run.b.text(node.nameTag ? TABLE_NAME_ELEMENT : `designcut-${node.slot}`, content, token, x, y + drop, w, color, node.align ?? 'left', accent)
      if (node.nameTag) drawn.el.groupId = run.nameGroup ??= run.group()
      return drawn.bottom
    }
    case 'label': {
      const token = node.token ?? 'LABEL'
      const color = colorOf(node.color, token, scope.surf, run.ctx.colors)
      const drawn = run.b.text('annotation-label-compare', node.label, K_TYPE[token], scope.x, y, scope.w, color, node.align ?? 'left')
      drawn.el.groupId = run.group()
      return drawn.bottom
    }
    case 'capsule':
      return drawCapsule(run, node, scope, y)
    case 'image':
      return drawImage(run, node, scope, y)
    case 'row':
      return drawRow(run, node, scope, y)
    case 'panel':
      return drawPanel(run, node, scope, y)
    case 'repeat':
      return drawRepeat(run, node, scope, y)
    case 'divider':
      return drawDivider(run, node, scope, y)
    case 'mark':
      return drawMark(run, node, scope, y)
    case 'icon':
      return drawIcon(run, node, scope, y)
    case 'tags':
      return drawTags(run, node, scope, y)
    case 'rating':
      return drawRating(run, node, scope, y)
    case 'bars':
      return drawBars(run, node, scope, y)
    case 'scaleSet':
      return drawScaleSet(run, node, scope, y)
    case 'dimension':
      return drawDimension(run, node, scope, y)
    case 'steps':
      // 옵션 전환 띠(T2-52) — 반복 칸 밖이면 목록이 없어 그리지 않는다
      return drawSteps(run.b, itemStepsLine(scope.items ?? [], node.field, scope.index), { x: scope.x, y, w: scope.w, band: true, group: scope.tagGroup ?? run.group() }, stepsInk(run, scope), K_TYPE.LABEL)
    case 'link':
      // 구역 연결 표식(R-W9) — 흐름 안에서는 높이·간격 0. renderTemplate이 아래 여백 안에 그린다
      return null
  }
}

/**
 * 노드 목록을 쌓는다 — 아무것도 그리지 않았으면 null. 간격은 다음에 그릴 노드가 있을 때만 더해 끝에 남지 않는다. 건너뛴 노드의
 * gapAfter는 더 크면 이어받는다(설명이 빠져도 제목 → 사진 간격은 글→사진 값)
 */
function drawNodes(run: Run, nodes: FlowNode[], scope: Scope, startY: number): number | null {
  let y = startY
  let pending = 0
  let drew = false
  measureEvenRows(run, nodes, scope)
  // 반 띠 — 맨 위 단계에서 반 띠 사진까지는 면 위라 면 바탕으로 그린다(사진 뒤는 섹션 바탕)
  let onFace = run.halfSurf !== undefined && nodes === run.t.flow
  for (const node of nodes) {
    const here = onFace && run.halfSurf ? { ...scope, surf: run.halfSurf } : scope
    if (onFace && node.kind === 'image' && node.half) onFace = false
    // 앞 목록과 잇는 표(joinRule): 앞 목록 끝과 이 목록 첫 줄 사이에도 행 사이와 같은 선·간격을 둔다. 이 목록이 비면 그은 선을 걷는다(K8)
    if (drew && node.kind === 'repeat' && node.joinRule === true) {
      const start = run.b.elements.length
      const gap = gapOf(run.t, node.gap ?? 'itemGap')
      const joined = drawNode(run, node, here, drawDivider(run, { kind: 'divider' }, here, y + gap) + gap)
      if (joined === null) {
        run.b.elements.length = start
        pending = Math.max(pending, gapOf(run.t, node.gapAfter))
        continue
      }
      y = joined
      pending = gapOf(run.t, node.gapAfter)
      continue
    }
    const bottom = drawNode(run, node, here, drew ? y + pending : y)
    if (bottom === null) {
      pending = Math.max(pending, gapOf(run.t, node.gapAfter))
      continue
    }
    y = bottom
    pending = gapOf(run.t, node.gapAfter)
    drew = true
  }
  return drew ? y : null
}

const isBleed = (node: FlowNode) => (node.kind === 'image' || node.kind === 'panel') && node.bleed === true

/** 슬롯이 채워져 실제로 그려질 첫·끝 노드와 그것이 풀폭인지 — 풀폭이면 첫·끝 여백을 0으로 한다 */
function edgeBleeds(t: Template, slots: SlotValues, ctx: TemplateContext): { top: boolean; bottom: boolean; first?: FlowNode; last?: FlowNode } {
  const probe = (node: FlowNode) => {
    const run: Run = { t, ctx, b: new CutBuilder(), group: () => '' }
    const scope: Scope = { values: slots, defs: t.slots, index: 0, surf: surfaceOf(pickBg(t, ctx.bg), ctx.colors), x: MARGIN, w: CONTENT_W }
    return drawNode(run, node, scope, 0) !== null
  }
  const drawn = t.flow.filter(probe)
  const [first, last] = [drawn[0], drawn.at(-1)]
  return { top: Boolean(first && isBleed(first)), bottom: Boolean(last && isBleed(last)), first, last }
}

/**
 * 뺀 컷으로 덜어진 목록의 최소 수(J48, decide 19) — 한 장 낮추되 2 아래로는 내리지 않고, 원래 최소보다 올리지도 않는다(4 → 3, 3 → 2, 2·1은 그대로).
 * 최소 4장 격자에서 한 장을 빼도 남은 3장을 같은 템플릿으로 그린다(위 2·아래 1 가운데). 더 줄면 섹션째 빠진다
 */
export const droppedListMin = (min: number): number => Math.min(min, Math.max(2, min - 1))

/**
 * 칸 수가 뜻인 템플릿(decide 20) — '네 방향'·'정면·옆·위'처럼 장수가 곧 내용이라 덜어진 목록도 최소를 낮추지 않는다(최소 아래면 지금처럼 섹션째 빠진다).
 * 이름의 '3열'·'2×2'처럼 배치만 말하는 템플릿은 넣지 않는다
 */
export const COUNT_FIXED_TEMPLATES: ReadonlySet<string> = new Set(['product_exposure.four-sides', 'product_exposure.three-views'])

/**
 * 뺀 컷 항목 덜기(J44) — 사진 칸 값이 뺀 컷인 목록 항목을 글·이름표째 뺀 슬롯 값과, 항목이 빠진 목록. 뺀 컷이 없거나 걸린 항목이 없으면 받은 값·템플릿 그대로다.
 * 덜어진 목록은 최소 수를 droppedListMin으로 낮춘 칸 정의로 바꾼 템플릿 사본을 돌려준다(J48, 칸 수가 뜻인 템플릿은 낮추지 않음). 덜어 낸 값으로 필수 칸·최소 수를 다시 보므로
 * 낮춘 최소보다도 적어진 필수 목록은 섹션째 빠진다(사진 하나짜리 섹션이 빠지는 지금 규칙과 같다)
 */
function withoutDropped(
  t: Template,
  slots: SlotValues,
  dropped: ReadonlySet<string> | undefined
): { template: Template; values: SlotValues; compacted?: Set<ListSlot> } {
  if (!dropped?.size) return { template: t, values: slots }
  const values: SlotValues = { ...slots }
  const defs: Template['slots'] = { ...t.slots }
  const compacted = new Set<ListSlot>()
  for (const [name, def] of Object.entries(t.slots)) {
    const list = slots[name]
    if (def.type !== 'list' || !Array.isArray(list)) continue
    const photoFields = Object.entries(def.fields).flatMap(([field, f]) => (f.type === 'image' ? [field] : []))
    const kept = (list as Array<string | SlotItem>).filter(
      (item) => typeof item !== 'object' || item === null || !photoFields.some((field) => dropped.has(textOf(item[field]) ?? ''))
    )
    if (kept.length === list.length) continue
    values[name] = kept as SlotValue
    const relaxed: ListSlot = COUNT_FIXED_TEMPLATES.has(t.id) ? def : { ...def, min: droppedListMin(def.min) }
    defs[name] = relaxed
    compacted.add(relaxed)
  }
  return compacted.size > 0 ? { template: { ...t, slots: defs }, values, compacted } : { template: t, values: slots }
}

/** 템플릿 + 슬롯 → 편집기 요소·높이·바탕. 필수 슬롯이 비었거나 사진 URL이 없으면 null */
export function renderTemplate(given: Template, givenSlots: SlotValues, ctx: TemplateContext): CutResult | null {
  const { template: t, values: slots, compacted } = withoutDropped(given, givenSlots, ctx.dropped)
  if (missingSlots(t, slots).length > 0) return null
  const requiredPhotoMissing = Object.entries(t.slots).some(
    ([name, def]) => def.type === 'image' && def.required && !ctx.image(textOf(slots[name]))
  )
  if (requiredPhotoMissing) return null
  const surf = surfaceOf(pickBg(t, ctx.bg), ctx.colors)
  const b = new CutBuilder()
  let groups = 0
  const group = uid('grp')
  const edges = edgeBleeds(t, slots, ctx)
  const run: Run = { t, ctx, b, group: () => `${group}-${groups++}`, ends: { first: edges.first, last: edges.last }, ...(compacted ? { compacted } : {}) }
  // 반 띠(적용 K7-c 4a) — 흐름 맨 위 단계에 반 띠 사진이 있으면 면을 맨 먼저 만들어 맨 아래 z에 둔다. 높이는 사진을 그릴 때 정한다
  if (t.flow.some((n) => n.kind === 'image' && n.half)) {
    run.halfSurf = halfPlaneOf(surf, ctx.colors)
    run.halfFace = b.shape(HALF_PLANE_NAME, 'rect', 0, HALF_TOP, W, 0, { fill: run.halfSurf.fill })
  }
  const scope: Scope = { values: slots, defs: t.slots, index: 0, surf, x: MARGIN, w: CONTENT_W }
  const bottom = drawNodes(run, t.flow, scope, edges.top ? 0 : t.spacing.top)
  if (bottom === null) return null
  const height = bottom + (edges.bottom ? 0 : t.spacing.bottom)
  // 구역 연결 표식(R-W9) — 흐름 맨 끝 link는 내용 뒤 아래 여백 안에 그린다. 풀폭으로 끝나 아래 여백이 없으면 그리지 않는다
  if (t.flow.at(-1)?.kind === 'link' && !edges.bottom) drawLink(b, bottom, height, linkInk(surf, ctx.colors.accent), surf.fill, run.group())
  return { elements: b.elements, height, background: surf.fill }
}
