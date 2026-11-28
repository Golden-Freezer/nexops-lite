/**
 * 칸마다 그리는 글자 토큰과 폭, 끝 줄 판정(A2 #8·#9) — 템플릿 흐름에서 읽는다. 폭 계산은 engine.ts가 칸을 그릴 때와 같다(slot-lines.test가 실제 렌더 폭과 대조한다).
 * 같은 칸을 여러 노드가 쓰면 좁은 쪽이다. 줄 수와 끝 줄은 글자 폭 추정값이라 브라우저 실측과 다를 수 있다. 순수·결정론.
 */

import { keepFactUnits } from '../editor/utils/sectionConverter/designCut/build'
import { CONTENT_W, type TypeToken } from '../editor/utils/sectionConverter/designCut/tokens'
import { estimateWrappedLines } from '../editor/utils/sectionConverter/helpers'
import { K_SPACE } from './engine'
import type { FlowNode, TokenName } from './template-types'

export interface SlotLine {
  token: TokenName
  width: number
  /** 엔진이 제목 강조 구절을 칠하는 칸(흐름 노드 emphasis) — 강조 구절 지정(T1-17)이 이 칸 글에서 고른다 */
  emphasis?: boolean
}

/** 끝 줄이 이 글자 수 이하면 외톨이다(공백 제외) — 조사나 서술어 한 어절만 남은 줄 */
export const ORPHAN_MAX_CHARS = 3

function visit(nodes: readonly FlowNode[], width: number, prefix: string, out: Map<string, SlotLine>) {
  for (const node of nodes) {
    if (node.kind === 'text') {
      const key = `${prefix}${node.slot}`
      const known = out.get(key)
      const emphasis = node.emphasis === true || known?.emphasis === true
      const line = { token: node.token, width: node.w ?? width, ...(emphasis ? { emphasis } : {}) }
      if (!known || line.width < known.width) out.set(key, line)
      else if (emphasis && !known.emphasis) out.set(key, { ...known, emphasis })
    } else if (node.kind === 'row') {
      for (const column of node.columns) visit(column.nodes, column.w, prefix, out)
    } else if (node.kind === 'panel') {
      visit(node.nodes, node.bleed ? CONTENT_W : (node.w ?? width) - K_SPACE.cardPad * 2, prefix, out)
    } else if (node.kind === 'repeat') {
      const columns = node.columns ?? 1
      // 층 띠는 띠 안쪽 여백(cardPad)만큼 좁다
      const pad = node.layer ? K_SPACE.cardPad * 2 : 0
      visit(node.nodes, Math.floor((width - K_SPACE.columnGap * (columns - 1)) / columns) - pad, `${node.slot}.`, out)
    } else if (node.kind === 'image' && node.overlay) {
      visit(node.overlay.nodes, CONTENT_W, prefix, out)
    }
  }
}

/** 글 칸 → 토큰·폭. 키는 칸 이름이고 목록 안 칸은 '목록.칸'이다 */
export function slotLinesOf(flow: readonly FlowNode[]): Map<string, SlotLine> {
  const out = new Map<string, SlotLine>()
  visit(flow, CONTENT_W, '', out)
  return out
}

/** 한 줄에 드는 글자 수 어림(한글 기준) */
export const lineCharsOf = (token: Pick<TypeToken, 'size'>, width: number) => Math.floor(width / token.size)

/** 마지막 문단이 두 줄 이상일 때 그 끝 줄 글 — 낱말을 뒤에서 빼며 줄 수가 줄어드는 자리를 찾는다. 한 줄이거나 낱말 하나가 폭보다 길면 null이다 */
export function lastLineOf(text: string, token: Pick<TypeToken, 'size'>, width: number): string | null {
  const paragraph = keepFactUnits(text.split('\n').at(-1)?.trim() ?? '')
  const total = estimateWrappedLines(paragraph, token.size, width)
  if (total < 2) return null
  const words = paragraph.split(' ')
  for (let kept = words.length - 1; kept >= 1; kept--) {
    if (estimateWrappedLines(words.slice(0, kept).join(' '), token.size, width) < total) return words.slice(kept).join(' ')
  }
  return null
}

export function isOrphanLine(text: string, token: Pick<TypeToken, 'size'>, width: number): boolean {
  const last = lastLineOf(text, token, width)
  return last !== null && last.replace(/[\s ]+/g, '').length <= ORPHAN_MAX_CHARS
}
