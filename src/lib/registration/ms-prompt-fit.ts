/**
 * MS 2k 지시 맞추기 2단(하네스 R07b) — 새 배치 잡(힉스필드 MS Image 2k, 상한 5000자)의 컷 지시만 다룬다. 지금 배치(2.6 high 등)는 부르지 않는다.
 * R07 1차(잡 bf9f4b5b)에서 K 컷 27개 중 25개가 1단(공급자 덜어 내기 HF_PROMPT_DROP_ORDER) 뒤에도 5,355~6,778자였다 — K 컷 지시·참조 역할·
 * 부품 규칙·식별 카드·쓰는 법 블록이 남아서다. 1단이 모자랄 때만 아래 차례로 하나씩 하고 상한 안이 되면 멈춘다. 몰래 자르지 않는다:
 * 덜거나 바꾼 것은 컷 기록(promptFit.dropped·compacted)에 남고, 끝까지 넘으면 무대가 공급자에 보내지 않고 남은 블록을 적은 오류로
 * 그 컷을 멈춘다(msOverflowMessage, AX-CT-32 — 예전에는 공급자 오류 '덜어 낸 블록 0개'만 남았다).
 *   ① 덮인 블록 덜기 — 페이지 기본 촬영 지시(E-4 '[Shot direction — 역할]', 스스로 '컷 지시가 정한 것을 따른다'고 밝히고 K 컷 지시·세트 장면이
 *      덮는다)·일반 표면 비우기 규칙(바탕 템플릿 — 인쇄는 식별 카드·인쇄 규칙과 K 컷 지시 Never 줄이 정한다), 그리고 K 컷 지시에 Never 줄이
 *      있는 컷만 바탕 템플릿의 글자 금지 두 블록(한글 맥락 줄 안내·IMPORTANT 글자 금지 — K 컷 지시의 'never drawn as text'·Never 줄과 같다)
 *   ② 짧은 MS 문구 — 부품 규칙·참조 역할(기본·D2 단색·첫 장 각도·대표 컷 사람/빛·상품 제외) 고정 문구를 같은 규칙의 짧은 글로 바꾸고,
 *      쓰는 법 블록의 Use 줄이 다른 블록(식별 카드)에 그대로 있는 글이면 그 줄만 뺀다(use-dup — 재료가 식별 카드 문장일 때)
 *   ②' ③ 앞 세 단계(J46, ms-prompt-shorten) — 겹친 블록 빼기(dup) → 인쇄 보존·도안 고정 두 고정 문구를 짧은 한 블록으로(printed) →
 *      학부모 장면 짧은 판(parent). 인쇄 상품은 인쇄 보존 블록이 두 번 붙고 인쇄 규칙이 고정이라 ③까지 덜어도 넘었다(재현 0c37e634)
 *   ③ 마지막 수단 블록 덜기 — 쓰는 법(Correct use) → 부품 규칙 → 참조 역할. 식별 카드·첫 블록(바탕 장면)·K 컷 지시는 덜지 않는다
 *      (오너 블라인드 MS 갈래는 바탕 지시 + K 컷 지시만이었다 — pack 72c4dd9a39)
 * 빛 줄은 남긴다(결정 카드 c15, light 켠 잡만): 연출 감독 줄(빛 규칙 포함)은 어느 단계도 덜지 않고, 감독 줄이 없는 컷은 1단이 헌장 블록을
 * 덜게 되면 헌장 대신 빛 두 줄 블록(charterLightBlockOf — 'charter-light')을 남긴다. light가 꺼진 잡은 헌장에 빛 규칙이 없어 지금 그대로다.
 */
import { HF_PROMPT_DROP_ORDER, HF_PROMPT_MAX, planHiggsfieldPrompt } from '@/lib/agents/image/higgsfield-image'
import { PARTS_RULE_BLOCK } from './parts-rule'
import { D2_SOLID_REFERENCE_ROLES_TEXT, REFERENCE_ROLES_TEXT } from './pdp-image-scene'
import { charterLightBlockOf } from './pdp-image-light'
import { FIRST_ANGLE_TEXT, VARY_LIGHT_TEXT, VARY_PRODUCT_EXCLUDED, VARY_REFERENCE_TEXT } from './templatelib/shot-variety'
import { USE_LINE_PREFIX } from './templatelib/handling-facts'
import { K_NEVER_LINE, TRUE_SCALE_CAMERA } from './templatelib/shot-brief'
import { PRIORITY_BLOCK, PRIORITY_BLOCK_DIRECTOR, PRIORITY_BLOCK_MS } from './rule-priority'
import { withoutContainedBlocks, withoutDuplicateHandTerms, withParentPrepMs, withPrintedRuleMs } from './ms-prompt-shorten'

/** ① 덮인 블록 머리 */
export const MS_COVERED_HEADS = ['[Shot direction — ', 'Product surface must be BLANK'] as const
/** ① K 컷 지시 Never 줄(K_NEVER_LINE)이 있는 컷만 더는 글자 금지 블록 머리 */
export const MS_TEXT_GUARD_HEADS = ['NOTE ON THE CONTEXT LINE ABOVE', 'IMPORTANT: Do NOT include any text'] as const

export const PARTS_RULE_MS =
  'PRODUCT PARTS (count them exactly as in the reference photo): the same number of cords, straps, handles, lids, tiers and pockets — never a second cord, ' +
  'an extra strap or a spare part. A part a hand holds or pulls is the same part of the product, not an additional one; a part the scene moves is not also ' +
  'drawn at rest. Picture exactly one state (for example unfolded or folded, never both; no separate cover, case or second handle). Small latches, pins and ' +
  'tips stay as small and as few as in the reference photo.'
const ROLES_FIRST_MS =
  "REFERENCE ROLES: FIRST image = the user's original product photo, the single source of truth for structure (shape, tiers/parts, handles, openings, assembled state)."
export const REFERENCE_ROLES_MS =
  `${ROLES_FIRST_MS} STYLE REFERENCE: LAST image = this page's finished HERO cut — match only its lighting, background tone and color grading; never copy its ` +
  'composition, subject placement, product structure or part count.'
export const D2_SOLID_REFERENCE_ROLES_MS =
  `${ROLES_FIRST_MS} STYLE REFERENCE: LAST image = this page's finished HERO cut — match only its lighting and color grading, not its set (keep this cut's solid ` +
  'background); never copy its composition, subject placement, product structure or part count.'
export const FIRST_ANGLE_MS = 'The FIRST image fixes structure, parts and state only — not the camera angle or which side faces the camera; follow the Camera line.'
export const VARY_PRODUCT_EXCLUDED_MS =
  'Never take the product from the LAST image, even when the person wears or holds it — only from the FIRST image and the product identity description.'
export const VARY_REFERENCE_MS =
  'The LAST image fixes only the person (face, hair, clothing) and the light and color — never its pose, expression, camera angle, camera distance or ' +
  `arrangement; follow the Camera and Person lines. ${VARY_PRODUCT_EXCLUDED_MS}`
/** 크기 줄의 실물 크기 문장(K4 오너 지적) 짧은 판 — 상품을 키우지 않고 카메라를 가까이, 주변은 제 크기(AX-CT-32) */
export const TRUE_SCALE_CAMERA_MS =
  'Everything else in the frame (hands, people, surfaces, packaging, props) keeps its real size next to the product; to show it larger, move the camera closer — never enlarge the product.'
export const VARY_LIGHT_MS =
  'The LAST image sets only the light and color — do not draw its person, face, pose, camera angle or arrangement; a person appears only as the Person line ' +
  'says, and not at all without one.'

/**
 * ② 짧은 MS 문구 — [이름, 긴 원문, 짧은 글]. 긴 글을 먼저 바꾼다(VARY_REFERENCE_TEXT가 VARY_PRODUCT_EXCLUDED를 품는다).
 * 규칙 충돌 정리 순위 블록(rulepriority 잡만, 기본 off — 결정 카드 c05·J10)을 맨 먼저 줄인다 — 1순위(상품 정체성)를 지키는 블록보다 앞이다.
 * 순위 블록이 없는 컷(꺼진 잡)에는 이 줄이 아무것도 바꾸지 않는다. 감독 줄 컷의 순위 블록(빛 문장만 감독 줄, J10×J25)도 같은 짧은 판이다 —
 * 짧은 판은 빛 문장이 없고, 감독 줄 블록(감독 빛 규칙 포함)은 덜리지 않아 빛 정본이 그대로 남는다
 */
export const MS_SHORT_FORMS: readonly (readonly [string, string, string])[] = [
  ['priority', PRIORITY_BLOCK, PRIORITY_BLOCK_MS],
  ['priority-director', PRIORITY_BLOCK_DIRECTOR, PRIORITY_BLOCK_MS],
  ['parts', PARTS_RULE_BLOCK, PARTS_RULE_MS],
  ['roles', REFERENCE_ROLES_TEXT, REFERENCE_ROLES_MS],
  ['roles-d2', D2_SOLID_REFERENCE_ROLES_TEXT, D2_SOLID_REFERENCE_ROLES_MS],
  ['vary-person', VARY_REFERENCE_TEXT, VARY_REFERENCE_MS],
  ['vary-light', VARY_LIGHT_TEXT, VARY_LIGHT_MS],
  ['first-angle', FIRST_ANGLE_TEXT, FIRST_ANGLE_MS],
  ['vary-product', VARY_PRODUCT_EXCLUDED, VARY_PRODUCT_EXCLUDED_MS],
  ['true-scale', TRUE_SCALE_CAMERA, TRUE_SCALE_CAMERA_MS],
]

/** ③ 마지막 수단 블록 머리(앞에서부터) */
export const MS_LAST_RESORT_HEADS = ['Correct use:', 'PRODUCT PARTS', 'REFERENCE ROLES'] as const

export interface MsPromptFit {
  prompt: string
  originalLength: number
  /** 덜어 낸 블록 머리(1단 공급자 순서 → ① → ③) */
  dropped: string[]
  /** 짧은 MS 문구로 바꾼 것(② 이름, ③ 앞 세 단계 dup·printed·parent) */
  compacted: string[]
  fits: boolean
}

/**
 * MS 컷 지시를 상한 안으로. 1단(planHiggsfieldPrompt)으로 들어가면 그 결과 그대로(공급자가 하던 것과 같은 글). 아니면 ①→②→③을
 * 하나씩 하고 들어가면 멈춘다. 끝까지 넘으면 fits false(무대는 보내지 않고 msOverflowMessage 오류로 그 컷을 멈춘다)
 */
export function fitMsPrompt(prompt: string, max = HF_PROMPT_MAX): MsPromptFit {
  const first = planHiggsfieldPrompt(prompt, max)
  // light 켠 잡의 감독 줄 없는 컷 — 1단이 헌장 블록을 덜게 되면 헌장 대신 빛 두 줄 블록을 남기고 다시 맞춘다(결정 카드 c15, 'charter-light').
  // 감독 줄 컷은 감독 줄 블록이 빛을 지니고 덜리지 않는다. 그 밖(꺼진 잡·헌장을 덜지 않는 컷)은 지금 그대로
  const lit = first.dropped.includes(CHARTER_DROP_HEAD) ? withCharterLight(first.blocks) : null
  const plan = lit ? planHiggsfieldPrompt(lit, max) : first
  const result = (blocks: string[], dropped: string[], compacted: string[]): MsPromptFit => {
    const text = blocks.join('\n\n')
    return { prompt: text, originalLength: prompt.length, dropped, compacted, fits: text.length <= max }
  }
  const providerDropped = lit ? inDropOrder([...plan.dropped, CHARTER_DROP_HEAD]) : plan.dropped
  const lightKept = lit ? ['charter-light'] : []
  if (plan.fits) return { prompt: plan.prompt, originalLength: prompt.length, dropped: providerDropped, compacted: lightKept, fits: true }
  let blocks = plan.keptIndex.map((i) => plan.blocks[i])
  const dropped = [...providerDropped]
  const compacted: string[] = [...lightKept]
  const over = () => blocks.join('\n\n').length > max
  const dropHead = (head: string) => {
    const next = blocks.filter((b, i) => i === 0 || !b.startsWith(head))
    if (next.length < blocks.length) {
      dropped.push(head)
      blocks = next
    }
  }
  for (const head of MS_COVERED_HEADS) {
    if (!over()) return result(blocks, dropped, compacted)
    dropHead(head)
  }
  // 글자 금지는 K 컷 지시 Never 줄이 남아 있을 때만 덜어 낸다(그 줄이 없는 컷 — 대표 컷 등 — 은 글자 금지 블록이 유일한 금지다)
  if (blocks.some((b) => b.startsWith('[Shot direction]') && b.split('\n').includes(K_NEVER_LINE))) {
    for (const head of MS_TEXT_GUARD_HEADS) {
      if (!over()) return result(blocks, dropped, compacted)
      dropHead(head)
    }
  }
  for (const [name, long, short] of MS_SHORT_FORMS) {
    if (!over()) return result(blocks, dropped, compacted)
    // 첫 블록(바탕 장면)은 건드리지 않는다
    const next = blocks.map((b, i) => (i > 0 && b.includes(long) ? b.split(long).join(short) : b))
    if (next.some((b, i) => b !== blocks[i])) {
      compacted.push(name)
      blocks = next
    }
  }
  // 쓰는 법 Use 줄 겹침 — 재료(식별 카드 문장, 240자에서 '…'로 끊김)가 다른 블록에 그대로 있으면 그 줄만 뺀다
  if (over()) {
    const next = blocks.map((b, i) => (i > 0 && b.startsWith('Correct use:') ? withoutDuplicateUseLine(b, blocks.filter((_, j) => j !== i)) : b))
    if (next.some((b, i) => b !== blocks[i])) {
      compacted.push('use-dup')
      blocks = next
    }
  }
  // ③ 앞 세 단계(J46) — 겹친 블록 빼기 → 인쇄 규칙 짧은 한 블록 → 학부모 장면 짧은 판. 하나씩 하고 들어가면 멈춘다(ms-prompt-shorten)
  for (const [name, step] of MS_PRE_LAST_RESORT_STEPS) {
    if (!over()) return result(blocks, dropped, compacted)
    const next = step(blocks)
    if (next && next.join('\n\n') !== blocks.join('\n\n')) {
      compacted.push(name)
      blocks = next
    }
  }
  for (const head of MS_LAST_RESORT_HEADS) {
    if (!over()) return result(blocks, dropped, compacted)
    dropHead(head)
  }
  return result(blocks, dropped, compacted)
}

/** ③ 앞 세 단계 — [기록 이름(promptFit.compacted), 단계]. 바꿀 것이 없으면 null·같은 글 */
export const MS_PRE_LAST_RESORT_STEPS: readonly (readonly [string, (blocks: readonly string[]) => string[] | null])[] = [
  // 같은 치수(20.7cm·207mm)의 손 비유가 겹치면 하나만 — 잃는 뜻이 없어 ③ 앞 단계의 맨 앞(AX-CT-32)
  ['size-dup', withoutDuplicateHandTerms],
  ['dup', withoutContainedBlocks],
  ['printed', withPrintedRuleMs],
  ['parent', withParentPrepMs],
]

/** 1단 공급자 덜어 내기의 헌장 블록 머리(HF_PROMPT_DROP_ORDER) */
const CHARTER_DROP_HEAD = 'GLOBAL STYLE CHARTER'

/** 헌장 블록을 빛 두 줄 블록으로 바꾼 지시 — 바꿀 것이 없으면 null(charterLightBlockOf) */
function withCharterLight(blocks: readonly string[]): string | null {
  const at = blocks.findIndex((b, i) => i > 0 && b.startsWith(CHARTER_DROP_HEAD))
  const light = at > 0 ? charterLightBlockOf(blocks[at]) : null
  return light ? blocks.map((b, i) => (i === at ? light : b)).join('\n\n') : null
}

/** 공급자 덜어 내기 머리를 HF_PROMPT_DROP_ORDER 차례로 */
const inDropOrder = (heads: readonly string[]): string[] => {
  const order = HF_PROMPT_DROP_ORDER as readonly string[]
  return [...heads].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** 쓰는 법 블록에서 Use 줄의 재료가 다른 블록에 그대로 있으면 그 줄을 뺀다 — 판매자 메모 재료(다른 블록에 없음)는 남는다 */
export function withoutDuplicateUseLine(block: string, others: readonly string[]): string {
  const lines = block.split('\n')
  const kept = lines.filter((line) => {
    if (!line.startsWith(USE_LINE_PREFIX)) return true
    const core = line.slice(USE_LINE_PREFIX.length).replace(/…$/, '').trim()
    return !(core.length > 0 && others.some((o) => o.includes(core)))
  })
  return kept.length === lines.length ? block : kept.join('\n')
}

/**
 * 모든 단계 뒤에도 상한을 넘은 지시의 오류 글(AX-CT-32) — 공급자에 보내지 않고 그 컷을 멈출 때 쓴다. 공급자 덜기는 이미 덜린 글을 받아
 * '덜어 낸 블록 0개'만 남겨 원인이 보이지 않았다(잡 a88c80b3 다섯 컷). 남은 블록 머리와 길이를 긴 차례로 적는다
 */
export function msOverflowMessage(fit: MsPromptFit, max = HF_PROMPT_MAX): string {
  const blocks = fit.prompt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const heads = blocks
    .map((b) => ({ head: b.split('\n')[0].slice(0, 32).trim(), length: b.length }))
    .sort((a, b) => b.length - a.length)
    .map((b) => `${b.head}(${b.length}자)`)
  return (
    `MS 지시 ${fit.prompt.length}자 — 맞추기 단계를 모두 써도 상한 ${max}자를 ${fit.prompt.length - max}자 넘어 보내지 않는다` +
    `(처음 ${fit.originalLength}자, 덜어 낸 블록 ${fit.dropped.length}개, 바꾼 것 ${fit.compacted.length}개). 남은 블록: ${heads.join(' · ')}`
  )
}
