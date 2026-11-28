/**
 * POINT 진행 표시(적용 D1 R-W7 구역 진행 표시, 오너 답 '넣는다') — D2 장면 모드 POINT 머리의 위 여백 안, 'POINT' 캡슐 바로 위 줄에
 * 이 POINT가 페이지 POINT 가운데 몇 번째인지 보인다(통합 11-03 (가)). K 진행 표시(templatelib/steps.ts drawSteps·stepsLook)를 그대로 쓴다.
 * 캡슐 줄 오른쪽에 두면 캡슐 글자가 판독 규칙 M6 2열 본문이 되고(D 캡슐은 K 구조 캡슐 판정 밖), 아래에 새 줄을 두면 머리가 길어진다 —
 * 장면 모드 위 여백(120) 안 줄(섹션 위 32 + 높이 64 + 캡슐까지 24)이라 섹션 높이·다른 요소 자리가 그대로다. 위 여백이 그보다 좁은 비장면 v2는 그리지 않는다.
 * 캡슐과 간격 24 — 16이면 탭 지금 칸의 강조색 면이 같은 색 POINT 캡슐 바로 위에 쌓여 두 알약이 겹쳐 보였다(통합 11-03 #630 눈 확인).
 * 이름은 페이지 POINT 제목 그대로다(짓지 않는다). 제목이 모두 탭 칸에 들어갈 때만 탭 띠(본문 폭 전체), 아니면 오른쪽 끝 점 줄만 — K의
 * '지금 이름 + 점'은 바로 아래 큰 제목과 같은 글을 되풀이해서 쓰지 않는다. POINT가 둘보다 적으면 그리지 않는다(K STEPS_MIN). 순수·결정론(묶음 id 말고).
 */

import { mutedOn } from '@/lib/registration/templatelib/engine'
import { STEPS, drawSteps, stepsLook, type StepsInk, type StepsLine } from '@/lib/registration/templatelib/steps'
import { uid } from '../helpers'
import type { CutBuilder } from './build'
import { CONTENT_W, MARGIN, emphasisOn, headingOn, mix, type Colors, type TypeToken, type surfaceOf } from './tokens'

type Surf = ReturnType<typeof surfaceOf>

/** 페이지 POINT 한 칸 — 계획의 chapter와 제목 */
export interface PagePoint {
  chapter: number
  headline: string | null
}

/**
 * 진행 표시 색 — K engine stepsInk와 같은 규칙(시험이 K 결과와 같음을 고정한다). 띠는 바탕에 글자색 7%, 지금 탭 칸은 강조색 면과 그 위 글자,
 * 나머지 탭은 띠 위 대비 4.5 옅은 글자, 점은 띠 위 대비 3 강조색(없으면 띠 글자색)
 */
export function pointStepsInk(surf: Surf, c: Colors, chipRadius: number): StepsInk {
  const band: Surf = { ...surf, fill: mix(surf.fill, surf.text, 0.07) }
  return {
    text: surf.text,
    band: band.fill,
    fill: c.accent,
    onFill: c.onAccent,
    muted: mutedOn(surf.text, band.fill),
    accent: emphasisOn(band, c, 4.5) ?? headingOn(band, c),
    dot: emphasisOn(band, c, 3) ?? band.text,
    radius: chipRadius,
  }
}

/** 이 chapter의 진행 줄 — 탭에 다 들어가면 제목 이름, 아니면 이름 없는 점 줄. 그릴 수 없으면 null */
export function pointStepsLine(points: readonly PagePoint[], chapter: number, w: number, token: TypeToken): StepsLine | null {
  const current = points.findIndex((p) => p.chapter === chapter)
  if (current < 0) return null
  const named: StepsLine = { names: points.map((p) => p.headline), current }
  if (stepsLook(named, w, token) === 'tabs') return named
  const dots: StepsLine = { names: points.map(() => null), current }
  return stepsLook(dots, w, token) ? dots : null
}

/** 진행 줄과 캡슐 사이 간격 */
export const POINT_STEPS_GAP = 24
/** 캡슐 위에 진행 줄을 둘 때 캡슐 위 끝이 이만큼은 내려와 있어야 한다(진행 줄 높이 + 간격 + 섹션 맨 위 여백 32) */
export const POINT_STEPS_MIN_TOP = STEPS.h + POINT_STEPS_GAP + 32

/** 캡슐(위 끝 capsuleY) 바로 위 줄, 본문 폭 전체에 진행 표시를 그린다. 자리가 없거나 그릴 수 없으면 아무것도 넣지 않고 false */
export function drawPointSteps(
  b: CutBuilder,
  args: { points: readonly PagePoint[]; chapter: number; capsuleY: number; surf: Surf; colors: Colors; chipRadius: number; token: TypeToken }
): boolean {
  if (args.capsuleY < POINT_STEPS_MIN_TOP) return false
  const line = pointStepsLine(args.points, args.chapter, CONTENT_W, args.token)
  if (!line) return false
  const box = { x: MARGIN, y: args.capsuleY - POINT_STEPS_GAP - STEPS.h, w: CONTENT_W, band: false, group: uid('grp') }
  return drawSteps(b, line, box, pointStepsInk(args.surf, args.colors, args.chipRadius), args.token) !== null
}
