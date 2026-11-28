/**
 * R1 빛·색온도 정본(PDP-DR-PLAN §3) — 조립이 끝난 컷 프롬프트에서 광원·빛 방향·색온도는 스타일 헌장 한 곳만 정하게 한다.
 * 잡 스위치 light(기본 off, Track I)가 켜진 잡만 쓴다(pdp-image-stage generateSection, 플레이트 제외). 헌장이 없는 프롬프트는 그대로다.
 *
 * 원문 상수는 고치지 않는다(pdp-image-brief와 같은 원칙). 헌장 밖의 줄에서
 * - 사진 기본 지시의 조명·색온도 줄은 뺀다
 * - 연출 프리셋·컷 템플릿의 빛 문구는 대비·밝기만 남긴 문구로 바꾼다(소프트박스·창가·골든아워·측광 같은 광원·방향을 지운다)
 * - 카테고리 조명 줄(Category lighting, 색온도 K 값 포함)은 뺀다
 * - 설계 LLM이 예시에서 옮겨 쓴 빛 문구도 같은 표로 바꾸고, 남은 색온도 K 값·골든아워 표현을 지운다
 * 그리고 헌장 끝에 '빛은 헌장만 정한다' 한 줄을 더한다. 두 번 돌려도 같다.
 *
 * 새 배치 연출 감독 줄(결정 카드 c15 — 'Art direction: 지시 Light: 빛 Set: 세트', 예외 컷은 지시만)이 있는 컷은 그 줄이 빛 정본이다.
 * 감독 줄은 바꾸지 않고(색온도·빛 문구 그대로), 헌장 끝 규칙 대신 감독 줄 바로 아래에 '빛은 감독 줄만 정한다' 한 줄을 둔다 —
 * 같은 블록이라 MS 2k 덜어 내기(헌장 블록을 먼저 뺀다)에서도 함께 남는다. 감독 줄이 없는 컷·지금 배치는 위 그대로다.
 * 감독 줄이 없는 컷의 헌장 빛 두 줄은 MS 덜어 내기가 헌장을 뺄 때 charterLightBlockOf로 남긴다(ms-prompt-fit).
 */

import { CHARTER_LIGHT_EXAMPLE_SWAPS } from '@/lib/agents/registration/prompts/pdp-design-prompts'

const CHARTER_HEAD = 'GLOBAL STYLE CHARTER'
const CHARTER_LAST = 'This image is one of many images on a single product page sharing this exact charter.'
export const LIGHT_RULE =
  'Light source, light direction and color temperature for every cut come only from this charter; other lines of this brief may set only contrast and brightness.'

/** 연출 감독 줄 머리(director.ts directorLineOf가 만든다) — 이 줄 하나가 그 컷의 빛 정본이다 */
export const DIRECTOR_LINE_HEAD = 'Art direction:'
const DIRECTOR_LINE = /^Art direction:[^\n]*$/m
const DIRECTOR_LINES = /^Art direction:[^\n]*$/gm
/** 감독 줄이 있는 컷의 빛 규칙 — 감독 줄 바로 아래에 둔다 */
export const DIRECTOR_LIGHT_RULE =
  'Light source, light direction and color temperature for this cut come only from the Art direction line above; every other line of this brief, ' +
  'including the style charter, may set only contrast and brightness.'

/** MS 덜어 내기가 헌장 블록을 뺄 때 남기는 빛 블록 머리·규칙(감독 줄 없는 컷) */
export const CHARTER_LIGHT_HEAD = 'LIGHT (from the page style charter):'
export const CHARTER_LIGHT_RULE_MS =
  'Light source, light direction and color temperature for every cut come only from these lines; other lines of this brief may set only contrast and brightness.'
/** 헌장(buildStyleCharter)의 빛 두 줄 머리 */
const CHARTER_LIGHT_LINES = ['- Single color temperature for every cut:', '- Single key light direction:'] as const

/** 사진 기본 지시(PHOTOGRAPHY_BASE_COMMON)의 광원·색온도 줄 — 헌장과 부딪힌다 */
const BASE_LIGHT_LINES = [
  '- Lighting: large softbox at 45-degree angle (key), white reflector fill, strip/rim light for edge separation',
  '- Color temperature: 5500K daylight balanced, no color cast',
]

/**
 * 연출 프리셋(PHOTOGRAPHY_PRESETS.lighting)·컷 템플릿(build*Prompt)의 빛 문구 → 대비·밝기만 남긴 문구.
 * 긴 문구부터 바꾼다(프리셋 문구가 템플릿 줄 안에도 들어 있다)
 */
export const LIGHT_PHRASE_SWAPS: ReadonlyArray<readonly [string, string]> = [
  ['- Lighting: Dramatic key light from side/below with strong rim light, studio editorial', '- Lighting: high contrast with a strong edge highlight, studio editorial'],
  ['- Mood: Warm, soft natural lighting — golden hour or warm indoor light', '- Mood: soft, inviting light'],
  ['- Tone: Warm color temperature (avoid cool blues/grays), natural saturated colors', '- Tone: natural saturated colors (no gloomy gray desaturation)'],
  ['- Lighting: Soft diffused light from top-left (no harsh shadows)', '- Lighting: soft and diffused (no harsh shadows)'],
  ['- 35mm f/1.4 wide angle, natural light (window light or golden hour)', '- 35mm f/1.4 wide angle, soft natural-feeling light'],
  ['- Strong highlight/shadow contrast, cinematic lighting', '- Strong highlight/shadow contrast'],
  ['- Mood: Bright, warm tones, high saturation', '- Mood: bright, high saturation'],
  ['natural window light or outdoor golden hour, soft and warm', 'soft natural-feeling light'],
  ['large softbox key light, white bounce fill, subtle rim light', 'soft contrast with subtle edge separation'],
  ['even dual softbox setup, minimal shadows, true color rendering', 'even low-contrast light, minimal shadows, true color rendering'],
  ['ring light or small softbox very close, highlight material texture', 'close soft light that brings out material texture'],
  ['bright, high-key setup, minimal shadows', 'bright high-key exposure, minimal shadows'],
]

const CATEGORY_LIGHT_LINE = /^[ \t]*- Category lighting:[^\n]*(?:\n|$)/gm
/** 남은 색온도 값(5500K·3200-4000K) — 앞의 쉼표·공백과 함께 지운다 */
const KELVIN = /,?[ \t]*\b\d{4}(?:[ \t]*[-–~][ \t]*\d{4})?[ \t]?K\b/g
const GOLDEN_HOUR = /\bgolden[- ]hour\b/gi

export interface LightCanonResult {
  prompt: string
  /** 실제로 바꾼 것이 있는지 */
  changed: boolean
}

/** 헌장 블록(머리 줄 ~ 마지막 문장)을 떼어 둔다 — 헌장 안의 색온도·방향은 정본이라 건드리지 않는다 */
function splitCharter(text: string): { before: string; charter: string; after: string } | null {
  const start = text.indexOf(CHARTER_HEAD)
  if (start < 0) return null
  const lastAt = text.indexOf(CHARTER_LAST, start)
  const end = lastAt < 0 ? text.indexOf('\n\n', start) : lastAt + CHARTER_LAST.length
  const stop = end < 0 ? text.length : end
  return { before: text.slice(0, start), charter: text.slice(start, stop), after: text.slice(stop) }
}

function canonOutside(text: string): string {
  // 연출 감독 줄은 그 컷의 빛 정본이라 바꾸지 않는다 — 자리표로 떼어 두고 정리 뒤 되돌린다(감독 줄이 없으면 지금과 같은 글)
  const kept: string[] = []
  let out = text.replace(DIRECTOR_LINES, (line) => `\u0000${kept.push(line) - 1}\u0000`)
  for (const line of BASE_LIGHT_LINES) out = out.split(`${line}\n`).join('').split(line).join('')
  for (const [from, to] of [...LIGHT_PHRASE_SWAPS, ...CHARTER_LIGHT_EXAMPLE_SWAPS]) out = out.split(from).join(to)
  out = out.replace(CATEGORY_LIGHT_LINE, '').replace(KELVIN, '').replace(GOLDEN_HOUR, 'soft natural')
  return kept.length > 0 ? out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]) : out
}

/** 컷 프롬프트 하나의 빛 지시를 헌장 한 곳(감독 줄이 있으면 감독 줄)으로 모은다(헌장이 없으면 그대로) */
export function canonLight(prompt: string): LightCanonResult {
  const parts = splitCharter(prompt)
  if (!parts) return { prompt, changed: false }
  const director = DIRECTOR_LINE.test(prompt)
  // 브리프 정리(헌장 우선 한 줄)가 먼저 돌았어도 한 번만 더한다. 감독 줄이 있는 컷은 헌장 끝이 아니라 감독 줄 아래에 둔다
  const charter =
    !director && parts.charter.endsWith(CHARTER_LAST) && !prompt.includes(LIGHT_RULE) ? `${parts.charter}\n${LIGHT_RULE}` : parts.charter
  const joined = `${canonOutside(parts.before)}${charter}${canonOutside(parts.after)}`
  const next =
    director && !joined.includes(DIRECTOR_LIGHT_RULE) ? joined.replace(DIRECTOR_LINE, (line) => `${line}\n${DIRECTOR_LIGHT_RULE}`) : joined
  return { prompt: next, changed: next !== prompt }
}

/**
 * MS 덜어 내기가 뺄 헌장 블록 → 남길 빛 블록(헌장 빛 두 줄 + 규칙). light 켠 잡의 감독 줄 없는 컷(헌장 끝에 LIGHT_RULE)만이고,
 * 그 밖(꺼진 잡·감독 줄 컷·빛 줄 없는 헌장)은 null — 지금처럼 헌장 블록째 빠진다
 */
export function charterLightBlockOf(charterBlock: string): string | null {
  if (!charterBlock.startsWith(CHARTER_HEAD) || !charterBlock.includes(LIGHT_RULE)) return null
  const lines = charterBlock.split('\n').filter((line) => CHARTER_LIGHT_LINES.some((head) => line.startsWith(head)))
  return lines.length > 0 ? [CHARTER_LIGHT_HEAD, ...lines, CHARTER_LIGHT_RULE_MS].join('\n') : null
}
