/**
 * K 여백 호흡 3단계(K9 개선 #11, 연구 A3 #15) — K 템플릿 섹션끼리 맞닿은 경계에서 앞 섹션 아래·뒤 섹션 위 빈 여백을 좁음 88·보통 120·넓음 150으로 맞춘다.
 * 지금 K 템플릿은 311개 모두 위·아래 120이라 경계가 늘 240이다. 판매 페이지는 섹션 안쪽 여백이 사분위폭÷중앙값 40%로 달라지고, 묶음 안은 좁게·묶음 사이는
 * 넓게 하는 2단 호흡이 많다. 그래서 표·목록 뒤와 POINT 연속은 좁게, 구역이 바뀌는 곳(장 시작)과 풀폭 사진 뒤는 넓게 둔다(값은 설계 판단).
 * 띠·사진이 섹션 끝에 닿은 쪽(빈 여백이 없는 쪽)은 그대로 둔다 — 늘리면 띠 밖에 빈 줄이 생긴다. 장면 모드에서만 쓴다(M4 경계 합 300·한쪽 200 안). 순수.
 */

import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { templateById } from '@/lib/registration/templatelib/library'
import { POINT_SECTION } from '@/lib/registration/templatelib/template-meta'
import type { Template } from '@/lib/registration/templatelib/template-types'
import { isLinkElement, relayoutLink } from '@/lib/registration/templatelib/zone-link'

export const K_BREATH = { narrow: 88, normal: 120, wide: 150 } as const
export type BreathLevel = keyof typeof K_BREATH
/** K–K 경계 빈 여백 합 상한 — M4 장면 모드 경계(maxSceneSeamBlankPx 300)와 같다 */
export const K_SEAM_MAX = K_BREATH.wide * 2
/** 표·목록 섹션 — 뒤 경계를 좁게 둔다 */
const LIST_SECTIONS: ReadonlySet<string> = new Set(['spec_table', 'point_list_div', 'compare', 'faq'])
/** 섹션 끝에서 이만큼 안까지 닿은 요소가 있으면 그쪽은 빈 여백이 아니다(띠·풀폭 사진) */
const FLUSH_PX = 2
const K_PREFIX = 'designcut_k_'

type BreathTemplate = Pick<Template, 'section' | 'order'>

/** 경계 단계 — 장 시작·사진 뒤가 표·목록 뒤보다 먼저다 */
export function breathLevel(prev: BreathTemplate, next: BreathTemplate, prevEndsWithPhoto: boolean): BreathLevel {
  if (prev.order.zone !== next.order.zone || prevEndsWithPhoto) return 'wide'
  if (LIST_SECTIONS.has(prev.section) || (prev.section === POINT_SECTION && next.section === POINT_SECTION)) return 'narrow'
  return 'normal'
}

export const kTemplateOf = (sec: CanvasSection): Template | undefined =>
  sec.layoutId.startsWith(K_PREFIX) ? templateById(sec.layoutId.slice(K_PREFIX.length)) : undefined

/** 구역 연결 표식(R-W9)은 아래 여백 안에 그리는 장식이라 빈 여백·끝 닿음 판정에서 뺀다 — 높이가 바뀌면 relayoutLink가 다시 붙인다 */
const visible = (sec: CanvasSection) => sec.elements.filter((e) => e.isVisible !== false && e.transform.height > 0 && !isLinkElement(e))
const topFlush = (sec: CanvasSection) => visible(sec).some((e) => e.transform.y <= FLUSH_PX)
const bottomFlush = (sec: CanvasSection) => visible(sec).some((e) => e.transform.y + e.transform.height >= sec.canvas.height - FLUSH_PX)
const endsWithPhoto = (sec: CanvasSection) =>
  visible(sec).some((e) => e.type === 'framed-image' && e.transform.width >= sec.canvas.width && e.transform.y + e.transform.height >= sec.canvas.height - FLUSH_PX)
/** 위·아래 빈 여백 — 섹션 전면 바탕 도형(80% 이상)은 내용으로 세지 않는다(compose contentSpan과 같은 자) */
function blankOf(sec: CanvasSection): { head: number; tail: number } | null {
  const content = visible(sec).filter(
    (e) => !(e.type === 'shape' && e.transform.width >= sec.canvas.width * 0.8 && e.transform.height >= sec.canvas.height * 0.8)
  )
  if (content.length === 0) return null
  return {
    head: Math.min(...content.map((e) => e.transform.y)),
    tail: sec.canvas.height - Math.max(...content.map((e) => e.transform.y + e.transform.height)),
  }
}

/** 섹션 아래 빈 여백을 to로 — 캔버스 높이만 바꾼다(바탕은 캔버스 색이 채운다) */
function setTail(sec: CanvasSection, to: number): CanvasSection {
  const blank = blankOf(sec)
  if (!blank || bottomFlush(sec)) return sec
  return relayoutLink({ ...sec, canvas: { ...sec.canvas, height: sec.canvas.height + to - blank.tail } })
}

/** 섹션 위 빈 여백을 to로 — 요소를 함께 옮기고 캔버스 높이를 맞춘다 */
function setHead(sec: CanvasSection, to: number): CanvasSection {
  const blank = blankOf(sec)
  if (!blank || topFlush(sec)) return sec
  const shift = to - blank.head
  return {
    ...sec,
    canvas: { ...sec.canvas, height: sec.canvas.height + shift },
    elements: sec.elements.map((e) => ({ ...e, transform: { ...e.transform, y: e.transform.y + shift } })),
  }
}

/** K–K 경계마다 단계를 정해 앞 섹션 아래·뒤 섹션 위 빈 여백을 맞춘다. K가 아닌 섹션과의 경계는 그대로다 */
export function breatheKSeams(sections: readonly CanvasSection[]): CanvasSection[] {
  const out = [...sections]
  for (let i = 0; i + 1 < out.length; i++) {
    const [prev, next] = [kTemplateOf(out[i]), kTemplateOf(out[i + 1])]
    if (!prev || !next) continue
    const px = K_BREATH[breathLevel(prev, next, endsWithPhoto(out[i]))]
    out[i] = setTail(out[i], px)
    out[i + 1] = setHead(out[i + 1], px)
  }
  return out
}
