/**
 * 채움 메시지 머리 변형(적용 D6 P3, 통합 11-03 20:3x) — 장 번호 없는 T3a(계획 headVariant)만 머리를 바꾼다. 큰 POINT 머리는 그대로다
 * (오너 11-01 'POINT 1·2·3 카피 자리 같음'). 글은 계획 그대로이고 그 줄이 없으면 그리지 않는다.
 * - band(T2-40): 섹션 폭 강조색 띠 안에 제목만(띠 글자색 onAccent — 흰 글자 대비 4.5 미만이면 잉크), 설명은 띠 아래 바탕에
 * - rule(T2-53): 가운데 짧은 강조색 선 → 가운데 제목 → 가운데 설명
 */

import type { CanvasElement } from '@/lib/registration/editor/types/canvas'
import { CutBuilder, contain, type Accent } from './build'
import type { CutSection } from './contract'
import { CONTENT_W, MARGIN, SCENE_SPACE, W, headingOn, type Colors, type TypeToken } from './tokens'

type Surf = { fill: string; text: string; dark: boolean }

/** 띠 안 위·아래 여백 */
const BAND_PAD = 48
/** 짧은 선 폭·두께, 선 → 제목 간격 */
const RULE = { width: 80, height: 6, gap: 32 }

export interface MessageHeadInput {
  section: Pick<CutSection, 'headVariant' | 'chapter' | 'text'>
  colors: Colors
  headline: TypeToken
  body: TypeToken
  /** 밝은 바탕 제목 강조 구절(v2 — 띠 안 제목에는 쓰지 않는다: 강조색 띠 위 강조색 글자가 사라진다) */
  accent: Accent | null
}

/**
 * 머리 변형을 그리고 머리 아래 끝을 돌려준다. 변형 칸이 없거나 장 번호가 있거나 제목이 없으면 null(호출 측이 지금 머리를 그린다).
 * y0는 지금 머리와 같은 첫 글 위치다
 */
export function drawMessageHead(b: CutBuilder, input: MessageHeadInput, y0: number, surf: Surf): number | null {
  const { section: s, colors: c } = input
  const headline = s.text.headline
  if (!s.headVariant || s.chapter != null || !headline) return null
  if (s.headVariant === 'band') {
    const top = y0 - BAND_PAD
    const band = b.shape('designcut-head-band', 'rect', 0, top, W, 0, { fill: c.accent })
    const title = b.text('designcut-headline', headline, input.headline, MARGIN, y0, CONTENT_W, c.onAccent)
    band.transform.height = title.bottom + BAND_PAD - top
    contain(band, [title.el])
    const y = top + band.transform.height
    return s.text.sub ? b.text('designcut-sub', s.text.sub, input.body, MARGIN, y + SCENE_SPACE.titleGap, CONTENT_W, surf.text).bottom : y
  }
  b.shape('designcut-head-rule', 'rect', Math.round((W - RULE.width) / 2), y0, RULE.width, RULE.height, { fill: c.accent })
  let y = b.text('designcut-headline', headline, input.headline, MARGIN, y0 + RULE.height + RULE.gap, CONTENT_W, headingOn(surf, c), 'center', input.accent).bottom
  if (s.text.sub) y = b.text('designcut-sub', s.text.sub, input.body, MARGIN, y + SCENE_SPACE.titleGap, CONTENT_W, surf.text, 'center').bottom
  return y
}

/** 그린 머리 변형 이름(측정·시험용) — 띠·선 요소로 읽는다 */
export const headVariantDrawn = (elements: readonly Pick<CanvasElement, 'name'>[]): 'band' | 'rule' | null =>
  elements.some((e) => e.name === 'designcut-head-band') ? 'band' : elements.some((e) => e.name === 'designcut-head-rule') ? 'rule' : null
