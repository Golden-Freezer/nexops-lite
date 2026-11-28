/**
 * 진행 표시(적용 K1 R-W7 구역 진행 표시, T2-52 옵션 전환 띠, 연구 L9 N2·A5 6.14) — 페이지 안 POINT나 옵션 가운데 지금 칸이 몇 번째인지 한 줄로 보인다.
 * 이름이 모두 있고 칸에 들어가면 탭 띠, 아니면 지금 이름 + 점 줄, 지금 이름도 없으면 점 줄만이다. 항목이 둘보다 적으면 그리지 않는다.
 * 이름은 입력·모델 글 그대로이고 짓지 않는다(오너 11-02 '값이 있을 때만'). 한 묶음이 장식 하나다(M7). 순수·결정론.
 */

import { approxTextWidth, contain, measureCutText, type CutBuilder } from '@/lib/registration/editor/utils/sectionConverter/designCut/build'
import { rgba, type TypeToken } from '@/lib/registration/editor/utils/sectionConverter/designCut/tokens'
import { listItems } from './slots'
import { POINT_STEPS_NAME, type CapsuleSteps, type SlotDef, type SlotItem, type SlotValues } from './template-types'

/** 줄 높이는 POINT 캡슐(64)과 같다 — 캡슐 줄 오른쪽에 두어도 머리 높이가 늘지 않는다 */
export const STEPS = { h: 64, inset: 4, tabPad: 16, dot: 16, current: 36, dotGap: 12, nameGap: 20, bandPad: 24 }
export const STEPS_MIN = 2
/** 지금이 아닌 탭 글자 굵기 — 보통 굵기라 지금 칸(토큰 굵기)과 갈린다 */
export const STEPS_REST_WEIGHT = 400

export type StepsLook = 'tabs' | 'named' | 'dots'

export interface StepsLine {
  names: ReadonlyArray<string | null>
  /** 지금 칸(0부터) */
  current: number
}

export interface StepsInk {
  /** 섹션·상자 글자색 */
  text: string
  /** 띠 색 — 바탕에 글자색을 조금 섞은 불투명 색이라 글자 대비를 띠 위에서 그대로 잰다 */
  band: string
  /** 지금 탭 칸 채움 — 강조색(캡슐과 같은 면)이라 지금 칸이 가장 강하다(통합 11-02 위계 보완) */
  fill: string
  /** 지금 탭 칸 글자 — 강조색 면 위 글자(onAccent), 굵게 */
  onFill: string
  /** 나머지 탭 글자 — 띠 위 대비 4.5를 지키는 옅은 글자, 보통 굵기 */
  muted: string
  /** 지금 이름(점 줄 옆) 글자 — 띠 위 대비 4.5 강조색 */
  accent: string
  /** 지금 점 — 띠 위 대비 3 */
  dot: string
  /** 칩 모서리(컨셉) */
  radius: number
}

export interface StepsBox {
  x: number
  y: number
  w: number
  /**
   * true면 늘 옅은 띠를 깔고 이름은 왼쪽·점은 오른쪽 끝이다(옵션 전환 띠).
   * false면 탭일 때만 띠이고, 아니면 이름·점을 오른쪽 끝에 모은다(POINT 캡슐 줄 오른쪽)
   */
  band: boolean
  group: string
}

/** POINT 진행 목록의 항목 칸 이름 */
export const STEPS_NAME_FIELD = POINT_STEPS_NAME

const clean = (name: unknown) => (typeof name === 'string' && name.trim() ? name.trim() : null)

/** POINT 캡슐 줄의 진행 — 목록 항목마다 이름, 지금 순번은 1부터인 글. 이 섹션 이름 칸 글이 지금 칸 이름보다 먼저다 */
export function capsuleStepsLine(steps: CapsuleSteps, values: SlotValues, defs: Record<string, SlotDef>): StepsLine | null {
  const def = defs[steps.slot]
  const current = Number(values[steps.current]) - 1
  if (def?.type !== 'list' || !Number.isInteger(current)) return null
  const names = listItems(def, values[steps.slot]).map((item) => clean(item[STEPS_NAME_FIELD]))
  const own = clean(values[steps.name])
  if (own && current >= 0 && current < names.length) names[current] = own
  return { names, current }
}

/** 반복 칸 안의 진행 — 그 목록 항목의 이름 칸, 지금 항목 번호(0부터) */
export const itemStepsLine = (items: readonly SlotItem[], field: string, index: number): StepsLine => ({ names: items.map((item) => clean(item[field])), current: index })
const dotsWidth = (count: number) => STEPS.current + (count - 1) * (STEPS.dot + STEPS.dotGap)

/** 어느 모양으로 그릴지 — 폭은 띠 바깥 폭이다 */
export function stepsLook(line: StepsLine, w: number, token: TypeToken): StepsLook | null {
  const count = line.names.length
  if (count < STEPS_MIN || line.current < 0 || line.current >= count) return null
  const names = line.names.map(clean)
  const cell = (w - STEPS.inset * 2) / count
  if (names.every((name) => name !== null && approxTextWidth(name, token.size) + STEPS.tabPad * 2 <= cell)) return 'tabs'
  const own = names[line.current]
  if (own && approxTextWidth(own, token.size) + STEPS.nameGap + dotsWidth(count) + STEPS.bandPad * 2 <= w) return 'named'
  return dotsWidth(count) <= w ? 'dots' : null
}

/** 점 줄 — 원 하나의 SVG라 글자 겹침 검사에 걸리지 않는다. 지금 칸은 긴 알약이다 */
function dotsSvg(count: number, current: number, ink: StepsInk): string {
  const h = STEPS.dot
  let x = 0
  const marks = Array.from({ length: count }, (_, i) => {
    const w = i === current ? STEPS.current : STEPS.dot
    const mark = `<rect x="${x}" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="${i === current ? ink.dot : rgba(ink.text, 0.25)}"/>`
    x += w + STEPS.dotGap
    return mark
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dotsWidth(count)} ${h}">${marks.join('')}</svg>`
}

/** 진행 표시를 그리고 아래 끝을 낸다. 그릴 수 없으면 아무것도 넣지 않고 null */
export function drawSteps(b: CutBuilder, line: StepsLine, box: StepsBox, ink: StepsInk, token: TypeToken): number | null {
  const look = stepsLook(line, box.w, token)
  if (!look) return null
  const count = line.names.length
  const names = line.names.map(clean)
  const { x, y, w, group } = box
  // 한 줄 글 상자 높이(그릴 때와 같은 추정) — 띠·지금 칸 카드 안 가운데에 둔다
  const textY = y + Math.floor((STEPS.h - measureCutText('가', token.size, token.lineHeight, w)) / 2)
  const start = b.elements.length
  const radius = Math.min(ink.radius, STEPS.h / 2)
  const strip = look === 'tabs' || box.band ? b.shape('designcut-steps-band', radius > 0 ? 'roundedRect' : 'rect', x, y, w, STEPS.h, { fill: ink.band, borderRadius: radius }) : null

  if (look === 'tabs') {
    // 위계 — 지금 칸은 강조색 채움 + 굵은 onAccent 글자, 나머지는 옅은 글자·보통 굵기(통합 11-02: 흰 카드 지금 칸이 굵은 검정 나머지보다 약해 보였다)
    const cell = (w - STEPS.inset * 2) / count
    const rest: TypeToken = { ...token, weight: STEPS_REST_WEIGHT }
    names.forEach((name, i) => {
      const cx = Math.round(x + STEPS.inset + i * cell)
      const cw = Math.round(cell)
      const on = i === line.current
      const card = on
        ? b.shape('designcut-steps-current', radius > STEPS.inset ? 'roundedRect' : 'rect', cx, y + STEPS.inset, cw, STEPS.h - STEPS.inset * 2, { fill: ink.fill, borderRadius: Math.max(0, radius - STEPS.inset) })
        : null
      const text = b.text(`annotation-label-step-${i}`, name!, on ? token : rest, cx, textY, cw, on ? ink.onFill : ink.muted, 'center')
      if (card) contain(card, [text.el])
    })
  } else {
    // 점은 늘 오른쪽 끝이다. 이름은 띠면 왼쪽 끝, 띠가 없으면 점 바로 왼쪽(오른쪽 맞춤 글 상자라 실제 글꼴이 넓어도 줄이 갈리지 않는다)
    const pad = box.band ? STEPS.bandPad : 0
    const dotsW = dotsWidth(count)
    const dotsX = x + w - pad - dotsW
    const own = look === 'named' ? names[line.current] : null
    if (own) b.text('annotation-label-step', own, token, x + pad, textY, dotsX - STEPS.nameGap - x - pad, ink.accent, box.band ? 'left' : 'right')
    b.svg('designcut-steps-dots', dotsSvg(count, line.current, ink), dotsX, y + Math.round((STEPS.h - STEPS.dot) / 2), dotsW, STEPS.dot)
  }

  const drawn = b.elements.slice(start)
  for (const el of drawn) el.groupId = group
  if (strip) contain(strip, drawn.slice(1))
  return y + STEPS.h
}
