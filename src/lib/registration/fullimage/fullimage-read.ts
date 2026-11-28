/**
 * 통이미지 판독 응답 검증·승인 카피 대조·블록 매칭 — 순수 함수(비전 호출은 F-2 소관).
 * 판독은 보이는 글을 그대로 읽게 한다(기대 문구를 베끼지 않게). 대조는 공백·문장부호를 뗀 키로 하고, 한 줄이 여러 블록으로
 * 나뉘어 읽혀도 같은 줄로 묶는다. 편집기에 들어가는 글은 승인 카피 원문이다(판독 글이 아님).
 */

import type { ApprovedLine, FullImageBlock, TextBox } from './fullimage-types'

export interface ReadBlock {
  text: string
  box: TextBox
  lines: number
  color: string
  weight: FullImageBlock['weight']
  family: FullImageBlock['family']
  align: FullImageBlock['align']
}

export interface FullImageRead {
  blocks: ReadBlock[]
  productMatches: boolean
  issues: string[]
}

const WEIGHTS = [400, 500, 600, 700, 800, 900] as const
const FAMILIES = new Set(['sans', 'display', 'rounded'])
const ALIGNS = new Set(['left', 'center', 'right'])
const HEX = /^#[0-9a-fA-F]{6}$/

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseBox(raw: unknown): TextBox | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const [x, y, w, h] = [num(b.x), num(b.y), num(b.w), num(b.h)]
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
  const cx = clamp01(x)
  const cy = clamp01(y)
  return { x: cx, y: cy, w: Math.min(w, 1 - cx), h: Math.min(h, 1 - cy) }
}

/** 판독 응답(JSON) 검증 — 형식이 틀린 블록은 버리고, 응답 자체가 틀리면 null(판독 실패 → G) */
export function parseFullImageRead(raw: unknown): FullImageRead | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.blocks) || typeof r.productMatches !== 'boolean') return null
  const blocks: ReadBlock[] = []
  for (const item of r.blocks) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    const text = typeof b.text === 'string' ? b.text.trim() : ''
    const box = parseBox(b.box)
    if (!text || !box) continue
    const weightRaw = num(b.weight) ?? 400
    const weight = WEIGHTS.reduce((best, w) => (Math.abs(w - weightRaw) < Math.abs(best - weightRaw) ? w : best), 400 as ReadBlock['weight'])
    blocks.push({
      text,
      box,
      lines: Math.max(1, Math.round(num(b.lines) ?? 1)),
      color: typeof b.color === 'string' && HEX.test(b.color) ? b.color.toUpperCase() : '#111111',
      weight,
      family: typeof b.family === 'string' && FAMILIES.has(b.family) ? (b.family as ReadBlock['family']) : 'sans',
      align: typeof b.align === 'string' && ALIGNS.has(b.align) ? (b.align as ReadBlock['align']) : 'center',
    })
  }
  const issues = Array.isArray(r.issues) ? r.issues.filter((i): i is string => typeof i === 'string' && i.trim() !== '') : []
  return { blocks, productMatches: r.productMatches, issues }
}

/** 대조 키 — 공백·줄바꿈·문장부호를 뗀다 */
export function copyKey(text: string): string {
  return text.replace(/[\s.,!?~…'"‘’“”·・:;()[\]{}<>«»\-–—_/\\|*#]+/g, '')
}

/**
 * 판독 블록이 속하는 승인 줄 — 블록 키가 그 줄 키 안에 들어 있으면(줄이 여러 블록으로 나뉘어 읽힌 경우 포함).
 * 여러 줄에 들어 있으면 길이가 가장 가까운 줄(짧은 조각이 긴 줄에 잘못 붙지 않게)
 */
function ownerLine(block: ReadBlock, lines: ApprovedLine[]): ApprovedLine | null {
  const key = copyKey(block.text)
  if (!key) return null
  const candidates = lines.filter((l) => copyKey(l.text).includes(key))
  if (candidates.length === 0) return null
  return candidates.reduce((best, l) =>
    Math.abs(copyKey(l.text).length - key.length) < Math.abs(copyKey(best.text).length - key.length) ? l : best
  )
}

/**
 * 승인 카피 대조 — missing: 읽힌 블록을 줄별로 이어 붙여도 원문 키가 안 되는 줄, extra: 어느 승인 줄에도 속하지 않는 블록 글.
 * 제품 인쇄 글자는 판독 지시에서 빼게 하므로 여기서는 따로 거르지 않는다(productText로 넘기면 extra에서 뺀다)
 */
export function compareApprovedCopy(
  lines: ApprovedLine[],
  blocks: ReadBlock[],
  productText: string[] = []
): { missing: string[]; extra: string[] } {
  const productKeys = productText.map(copyKey).filter(Boolean)
  const byLine = new Map<string, ReadBlock[]>()
  const extra: string[] = []
  for (const block of blocks) {
    const owner = ownerLine(block, lines)
    if (owner) byLine.set(owner.copyPath, [...(byLine.get(owner.copyPath) ?? []), block])
    else if (!productKeys.some((k) => k.includes(copyKey(block.text)))) extra.push(block.text)
  }
  const missing = lines
    .filter((l) => {
      const parts = (byLine.get(l.copyPath) ?? []).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
      return parts.map((p) => copyKey(p.text)).join('') !== copyKey(l.text)
    })
    .map((l) => l.text)
  return { missing, extra }
}

const unionBox = (boxes: TextBox[]): TextBox => {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * 블록 매칭 — 승인 줄마다 그 줄에 속한 판독 블록을 묶어 상자·줄 수·모양을 정한다. 한 줄이라도 블록이 없으면 null(판독 실패 → G).
 * 모양(색·굵기·계열·정렬)은 가장 큰 블록을 따른다. 판독 블록이 원문 줄바꿈과 같은 자리에서 나뉘었으면 원문 \n을 그대로 둔다
 */
export function matchBlocks(lines: ApprovedLine[], blocks: ReadBlock[]): FullImageBlock[] | null {
  const out: FullImageBlock[] = []
  for (const line of lines) {
    const parts = blocks.filter((b) => ownerLine(b, lines) === line).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
    if (parts.length === 0) return null
    const lead = parts.reduce((big, p) => (p.box.w * p.box.h > big.box.w * big.box.h ? p : big))
    out.push({
      copyPath: line.copyPath,
      text: line.text,
      role: line.role,
      box: unionBox(parts.map((p) => p.box)),
      lines: parts.reduce((n, p) => n + p.lines, 0),
      color: lead.color,
      weight: lead.weight,
      family: lead.family,
      align: lead.align,
    })
  }
  return out
}
