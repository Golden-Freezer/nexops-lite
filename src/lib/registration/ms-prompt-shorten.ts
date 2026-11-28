/**
 * MS 2k 지시 맞추기의 ③ 앞 세 단계(J46, decide 13) — ② 짧은 MS 문구 뒤에도 상한(5000자)을 넘는 컷만 ms-prompt-fit이 차례로 부른다.
 * 인쇄 상품(P02 구디백·P01 스티커)은 인쇄 보존 블록이 한 지시에 두 번 붙고 인쇄 규칙 두 블록이 고정이라, ③ 마지막 수단까지 덜어도
 * 덜지 않는 블록(바탕 장면·식별 카드·K 컷 지시·감독 줄)만으로 넘었다(재현 0c37e634 MS 32컷 중 31컷). 순수 함수만 둔다.
 *   A dup     — 첫 블록이 아닌 블록의 글이 다른 블록 안에 통째로 있으면 그 블록을 뺀다(긴 쪽·앞쪽을 남긴다). 같은 글이라 잃는 뜻이 없다.
 *   B printed — 인쇄 보존(PRINTED_DESIGN_PRESERVE_INSTRUCTION)과 도안 고정(buildPrintedDesignsRule) 두 고정 문구가 둘 다 있을 때만
 *               같은 뜻의 짧은 한 블록으로 바꾼다. 같은 블록의 다른 줄(옵션 디자인 줄 등 상품별 글)은 바이트 그대로다.
 *   C parent  — 학부모 장면 블록(PARENT_PREP_IMAGE_BLOCK)을 같은 뜻('아이를 어디에도 그리지 않음')의 짧은 판으로 바꾼다.
 * 식별 카드·PRINTED MARKS·첫 블록·K 컷 지시·감독 줄(c15)·순위 블록(c05)은 건드리지 않는다.
 */
import { buildPrintedDesignsRule, PRINTED_DESIGN_PRESERVE_INSTRUCTION } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { PARENT_PREP_IMAGE_BLOCK } from './parent-proxy-copy'

/** 도안 고정 문구를 찾을 원천 사진 수 범위(buildPrintedDesignsRule photoCount) */
const MAX_PRINTED_PHOTOS = 20

/** A — 다른 블록 안에 통째로 들어 있는 블록을 뺀다. 첫 블록은 빼지 않고, 같은 글이 둘이면 앞의 것을 남긴다 */
export function withoutContainedBlocks(blocks: readonly string[]): string[] {
  return blocks.filter(
    (block, i) =>
      i === 0 ||
      !blocks.some((other, j) => j !== i && other.includes(block) && (other.length > block.length || j < i))
  )
}

/** B 짧은 판 — 두 고정 문구(인쇄 보존 + 도안 고정)의 뜻을 한 블록에 */
export function printedRuleMs(photoCount: number): string {
  const many = photoCount > 1
  const photos = many ? `the first ${photoCount} attached images` : 'the first attached image'
  return (
    `PRINTED DESIGNS (the printed content IS the product): reproduce the artwork, lettering and logos printed on the product exactly as in the product reference photo${many ? 's' : ''} (${photos}) — ` +
    'Korean stays Korean, same layout and colors. Never erase, translate, re-letter, invent or blend designs; with several items, repeat only those designs. ' +
    'A style reference attached after them is not a source of designs. Add no text anywhere else. ' +
    'Keep it FLAT printed material — never a plate, mug, box or other 3D object.'
  )
}

/** 지시 속 도안 고정 문구 — [블록 번호, 원천 사진 수, 글]. 없으면 null(사진 수가 큰 글부터 찾는다) */
function findPrintedDesignsRule(blocks: readonly string[]): { at: number; photoCount: number; text: string } | null {
  for (let n = MAX_PRINTED_PHOTOS; n >= 1; n--) {
    const text = buildPrintedDesignsRule(n)
    const at = blocks.findIndex((b, i) => i > 0 && b.includes(text))
    if (at > 0) return { at, photoCount: n, text }
  }
  return null
}

/** 블록에서 글 하나를 뺀다 — 앞뒤 줄바꿈 하나도 함께. 남는 글이 없으면 null */
function removeText(block: string, text: string): string | null {
  const next = block.includes(`\n${text}`)
    ? block.split(`\n${text}`).join('')
    : block.includes(`${text}\n`)
      ? block.split(`${text}\n`).join('')
      : block.split(text).join('')
  return next.trim() ? next : null
}

/** B — 두 고정 문구가 둘 다 있을 때만 짧은 한 블록으로. 하나만 있거나 첫 블록에만 있으면 null(그대로) */
export function withPrintedRuleMs(blocks: readonly string[]): string[] | null {
  const preserveAt = blocks.findIndex((b, i) => i > 0 && b.includes(PRINTED_DESIGN_PRESERVE_INSTRUCTION))
  const designs = findPrintedDesignsRule(blocks)
  if (preserveAt <= 0 || !designs) return null
  const short = printedRuleMs(designs.photoCount)
  const out: (string | null)[] = blocks.map((b, i) => (i === preserveAt ? b.split(PRINTED_DESIGN_PRESERVE_INSTRUCTION).join(short) : b))
  const withDesigns = out[designs.at]!
  out[designs.at] = removeText(withDesigns, designs.text)
  return out.filter((b): b is string => b !== null)
}

/** C 짧은 판 — 학부모 장면(아이를 어디에도 그리지 않음) */
export const PARENT_PREP_MS =
  "[PARENT-PREP SCENE - MANDATORY] Adults prepare this product as party favors: show only adults' hands and the prepared result. " +
  'Never depict children, kids, babies or minors anywhere in the image (background, wall photos, reflections).'

/** C — 학부모 장면 블록을 짧은 판으로. 없으면 null(첫 블록은 건드리지 않는다) */
export function withParentPrepMs(blocks: readonly string[]): string[] | null {
  if (!blocks.some((b, i) => i > 0 && b.includes(PARENT_PREP_IMAGE_BLOCK))) return null
  return blocks.map((b, i) => (i > 0 ? b.split(PARENT_PREP_IMAGE_BLOCK).join(PARENT_PREP_MS) : b))
}

/** 크기 줄 머리·손 비유 머리(templatelib/shot-brief sizeLine) */
const SIZE_LINE_HEAD = 'Real size (reference only, never drawn as text): '
const HAND_TERMS_PART = /In hand terms, (.+?)\. (?=Keep hands)/
const UNIT_CM: Readonly<Record<string, number>> = { mm: 0.1, cm: 1, m: 100 }

/**
 * D size-dup(AX-CT-32) — 크기 줄의 손 비유에서 같은 치수를 두 번 옮긴 것(세로 20.7cm·207mm)을 하나만 남긴다. 치수 글(크기 원문)은 바이트 그대로,
 * 손 비유만 줄인다. 첫 블록은 건드리지 않는다. 바꿀 것이 없으면 null
 */
export function withoutDuplicateHandTerms(blocks: readonly string[]): string[] | null {
  let changed = false
  const next = blocks.map((block, i) => {
    if (i === 0 || !block.includes(SIZE_LINE_HEAD)) return block
    return block
      .split('\n')
      .map((line) => {
        if (!line.startsWith(SIZE_LINE_HEAD)) return line
        const m = HAND_TERMS_PART.exec(line)
        if (!m) return line
        const seen = new Set<number>()
        const terms = m[1].split('; ').filter((term) => {
          const unit = /^(\d+(?:\.\d+)?)(mm|cm|m) is /i.exec(term)
          if (!unit) return true
          const cm = Math.round(Number(unit[1]) * UNIT_CM[unit[2].toLowerCase()] * 100) / 100
          if (seen.has(cm)) return false
          seen.add(cm)
          return true
        })
        if (terms.length === m[1].split('; ').length) return line
        changed = true
        return line.replace(m[0], `In hand terms, ${terms.join('; ')}. `)
      })
      .join('\n')
  })
  return changed ? next : null
}
