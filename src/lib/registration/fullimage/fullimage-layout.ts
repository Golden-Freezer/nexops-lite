/**
 * 통이미지 블록 → 편집기 텍스트 요소 명세 — 순수 함수. 편집기 CanvasElement를 만드는 일은 F-3(편집기 변환 모듈) 소관이고,
 * 여기서는 좌표·글꼴·크기만 정한다. 캔버스 폭 860(편집기 고정), 섹션 높이 = 860 / 실제 비율.
 * 글꼴은 화이트리스트에서 고른다(sans → Pretendard, display → GmarketSansBold, rounded → 'Cafe24 Ssurround').
 * 크기는 판독 상자 높이로 어림하고 역할 하한(제목 72·부제 45·라벨 32 — designTokens·MOBILE_LIMITS와 같은 값)까지 올린다.
 */

import type { CopyRole, FullImageBlock } from './fullimage-types'

export const FULLIMAGE_CANVAS_WIDTH = 860

export const FULLIMAGE_FONT: Record<FullImageBlock['family'], string> = {
  sans: 'Pretendard',
  display: 'GmarketSansBold',
  rounded: 'Cafe24 Ssurround',
}
/** 역할 하한(캔버스 px) — 제목 h1 72, 부제 body 45, 라벨은 장식 라벨 하한 32 */
export const FULLIMAGE_FLOOR: Record<CopyRole, number> = { headline: 72, sub: 45, support: 32 }
export const FULLIMAGE_LINE_HEIGHT: Record<CopyRole, number> = { headline: 1.25, sub: 1.45, support: 1.3 }
/** 판독 오차로 터무니없이 커지지 않게 */
const FONT_MAX = 140

export interface FullImageTextSpec {
  copyPath: string
  role: CopyRole
  content: string
  x: number
  y: number
  width: number
  height: number
  fontFamily: string
  fontSize: number
  fontWeight: FullImageBlock['weight']
  color: string
  textAlign: FullImageBlock['align']
  lineHeight: number
  /** 판독 크기가 하한보다 작아 하한까지 올렸다 */
  raised: boolean
}

/** 섹션 높이(캔버스 px) */
export function fullImageSectionHeight(aspect: number): number {
  return Math.round(FULLIMAGE_CANVAS_WIDTH / aspect)
}

/** 블록 하나 → 텍스트 요소 명세. 상자는 판독 좌표 그대로이고, 하한 때문에 글이 커지면 높이를 줄 수에 맞춰 늘린다(겹침 정리는 layoutBlocks) */
export function blockToTextSpec(block: FullImageBlock, aspect: number): FullImageTextSpec {
  const H = fullImageSectionHeight(aspect)
  const lineHeight = FULLIMAGE_LINE_HEIGHT[block.role]
  const estimated = Math.round((block.box.h * H) / block.lines / lineHeight)
  const floor = FULLIMAGE_FLOOR[block.role]
  const fontSize = Math.min(FONT_MAX, Math.max(floor, estimated))
  const height = Math.max(Math.round(block.box.h * H), Math.ceil(fontSize * lineHeight * block.lines))
  return {
    copyPath: block.copyPath,
    role: block.role,
    content: block.text,
    x: Math.round(block.box.x * FULLIMAGE_CANVAS_WIDTH),
    y: Math.round(block.box.y * H),
    width: Math.round(block.box.w * FULLIMAGE_CANVAS_WIDTH),
    height,
    fontFamily: FULLIMAGE_FONT[block.family],
    fontSize,
    fontWeight: block.family === 'display' ? 700 : block.weight,
    color: block.color,
    textAlign: block.align,
    lineHeight,
    raised: estimated < floor,
  }
}

/** 블록 전부 → 명세. 위에서부터 놓고, 키운 상자가 아래 상자와 겹치면 아래 상자를 민다(사이 12px). 섹션 높이를 넘으면 그대로 두고 넘친 수를 센다 */
export function layoutBlocks(
  blocks: FullImageBlock[],
  aspect: number
): { specs: FullImageTextSpec[]; raisedToFloor: number; overflow: number } {
  const H = fullImageSectionHeight(aspect)
  const specs = blocks.map((b) => blockToTextSpec(b, aspect)).sort((a, b) => a.y - b.y)
  for (let i = 1; i < specs.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = specs[j]
      const b = specs[i]
      const overlapX = a.x < b.x + b.width && b.x < a.x + a.width
      if (overlapX && b.y < a.y + a.height + 12) b.y = a.y + a.height + 12
    }
  }
  return {
    specs,
    raisedToFloor: specs.filter((s) => s.raised).length,
    overflow: specs.filter((s) => s.y + s.height > H).length,
  }
}
