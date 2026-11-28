/**
 * 이미지 지시 규칙 충돌 정리(점검 고침 4, 오너 2026-11-07 승인 '이미지 경로 점검 고침 0~5', 잡 스위치 rulepriority — 기본 off).
 * 조립이 끝난 컷 프롬프트 한 장을 받아 서로 부딪히는 규칙을 하나로 맞춘다. 원문 상수는 고치지 않고(pdp-image-light·pdp-image-brief와 같은 원칙),
 * 꺼진 잡의 프롬프트는 바이트까지 그대로다. 근거는 K8 잡 4개 116컷의 실제 전송 지시(sentPrompt, 11-07 읽기 전용 집계):
 * ① 우선순위 — '이 블록이 위를 이긴다' 블록이 2개 이상 겹친 컷 26(컷 지시 108·HANDS ONLY 22 …). 어느 쪽이 이기는지 정해져 있지 않았다
 *    → 각 문장을 'Priority N' 꼬리표로 바꾸고 맨 끝에 순위 블록 하나를 둔다
 * ② 닫힌 상태 — 일관성 규칙 6번 '닫힌·조립 상태 유지, 열지 말 것'이 사용·상태 목적 컷 45컷에 같이 들어갔다 → 그 컷의 한 상태를 따르게 바꾼다
 * ③ 가리킬 글 없는 목적 — 'named below' 목적인데 섹션 글 줄이 없는 컷(K8 기능 컷 5/19, K7 P09 상태 컷) → 글 없이도 서는 목적 문장으로
 * ④ 조명 두 갈래 — 사진 기본 5500K·창빛·골든아워와 헌장 색온도가 함께 들어간 컷 110/116 → canonLight(헌장 한 곳)
 *    새 배치 연출 감독 줄이 있는 컷(결정 카드 c15·J25)은 canonLight가 감독 줄을 빛 정본으로 두므로 순위 블록 빛 문장도 감독 줄을 가리킨다(J10×J25)
 * ⑤ 원형·아치 틀 — '원 안에 보인다'가 흰 원 마스크로 그려졌다(K7) → 화면을 꽉 채우고 원·테두리를 그리지 말라고
 * 두 번 돌려도 같다.
 */

import { PRODUCT_CONSISTENCY_RULES } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { canonLight, DIRECTOR_LINE_HEAD } from './pdp-image-light'
import { CLIP_LINES, PURPOSE_LINES } from './templatelib/shot-brief'

/** ① 우선순위 — 위를 이긴다는 문장 → 꼬리표. [원문, 바꿀 말] */
export const PRIORITY_TAG_SWAPS: ReadonlyArray<readonly [string, string]> = [
  // 첫 화면 사진 유형(hero-kind)
  ['This block wins over any studio, isolated-product or no-hands wording above. ', 'Priority 2 — what this cut must show. '],
  // 해결 컷 얼굴 빼기(pdp-image-tasks solutionWithoutFace)
  ['HANDS AND PRODUCT ONLY (this block wins over any person, mood or expression above):', 'HANDS AND PRODUCT ONLY (Priority 2 — what this cut must show; no person line overrides it):'],
  // K 컷 지시(templatelib shot-brief) 세 판
  ['This block wins over every instruction above about framing, angle, distance, props, the people shown and how much of the frame the product fills.', 'Priority 3 — this cut\'s brief.'],
  ['This block wins over every instruction above about where things sit in the frame and how much of the frame the product fills.', 'Priority 3 — this cut\'s brief.'],
  ['This block wins over every instruction above about how much of the frame the product fills.', 'Priority 3 — this cut\'s brief.'],
  // 컷 목적(shotdiv)
  ['This block wins over the shot distance and framing above for this cut only. ', 'Priority 3 — this cut\'s brief. '],
  // 디자인 컷 장면 세트(pdp-image-scene D2_SCENE_RULE)
  [
    'This block wins over every instruction above for this cut, including the shot direction defaults, about a solid, plain, isolated, gradient or single-color background, "no props", "sole object" or "product alone", a fixed frame-fill share, or a fixed shot distance. ',
    'Priority 4 — the page set: it replaces any solid, plain, isolated, gradient or single-color background, "no props", "sole object" or "product alone", fixed frame-fill share or fixed shot distance from the page defaults. ',
  ],
]

export const PRIORITY_BLOCK = [
  'PRIORITY (when lines of this brief disagree, the lower number wins):',
  '1. Product identity — shape, color, material, the exact parts and their count, and the one state named for this cut, as in the reference photos (PRODUCT IDENTITY, consistency rules, PRODUCT PARTS).',
  '2. What this cut must show — blocks tagged Priority 2 (first-screen photo type, hands and product only).',
  '3. This cut\'s brief — blocks tagged Priority 3 (purpose, camera, person, contact, size, frame).',
  '4. The page set — the shared set and props (Priority 4).',
  '5. Page defaults — shot direction, page shot plan, presets and template wording.',
  'Light source, light direction and color temperature come only from the style charter. The no-added-text rule always applies.',
].join('\n')

/** 순위 블록의 빛 문장 — 감독 줄이 없는 컷(지금 배치·감독 줄 없는 새 배치 컷)은 헌장이 빛 정본이다 */
const PRIORITY_LIGHT_CHARTER = 'Light source, light direction and color temperature come only from the style charter.'
export const PRIORITY_LIGHT_DIRECTOR = 'Light source, light direction and color temperature come only from the Art direction line.'
/**
 * 연출 감독 줄이 있는 컷(새 배치 — 결정 카드 c15·J25)의 순위 블록. 그 컷의 빛 정본은 감독 줄이라(canonLight가 감독 줄 바로 아래에
 * DIRECTOR_LIGHT_RULE을 둔다) 빛 문장도 감독 줄을 가리킨다. 헌장 문장을 그대로 두면 '빛은 헌장만'과 '빛은 감독 줄만'이 한 지시에 함께 든다
 * (J10×J25 후속 — light·rulepriority 함께 켜기 전 필수). 빛 문장 말고는 PRIORITY_BLOCK과 글자까지 같다
 */
export const PRIORITY_BLOCK_DIRECTOR = PRIORITY_BLOCK.replace(PRIORITY_LIGHT_CHARTER, PRIORITY_LIGHT_DIRECTOR)
/** 감독 줄('Art direction: …', directorLineOf)이 있는 지시인지 — canonLight와 같은 판정(줄 머리) */
const DIRECTOR_AT = new RegExp(`^${DIRECTOR_LINE_HEAD}`, 'm')

/**
 * 새 배치 MS 2k 짧은 판(ms-prompt-fit ② 짧은 MS 문구, 결정 카드 c05·J10). 순위 블록은 MS 덜어 내기 목록에 없어 늘 남는다 — 상한을 넘는 컷에서
 * 이 블록 때문에 부품 규칙·쓰는 법·참조 역할(1순위를 지키는 블록)이 마지막 수단으로 빠지지 않게 먼저 줄인다(K8 116컷 MS 강제 측정: 짧은 판 없이
 * 부품 규칙 덜기 3 → 33컷). ② 단계에 오면 1단이 스타일 헌장을 이미 덜어 냈으므로 '빛은 헌장만' 줄은 뺀다(빛·색은 참조 역할의 스타일 참조 사진이 맡는다)
 */
export const PRIORITY_BLOCK_MS =
  "PRIORITY (when lines disagree, the lower number wins): 1 product identity — shape, color, material, the exact parts and their count and this cut's one state, " +
  'as in the reference photos; 2 blocks tagged Priority 2; 3 blocks tagged Priority 3; 4 the page set; 5 page defaults. Never add text.'

/** ② 일관성 규칙 6번의 닫힌 상태 문장 — 줄바꿈·들여쓰기는 상수 그대로 */
const CLOSED_STATE = /Moving parts \(drawers,\s+lids, hinges\) must stay in the same assembled\/closed state shown in the reference —\s+do not open, detach or explode them unless the reference shows them that way\./
export const ONE_STATE =
  'Moving parts (drawers, lids, hinges, folding parts) keep the assembled state shown in the reference. When this cut\'s purpose or use line names\n' +
  '   another state or shows the product in use, show exactly that one state with the same parts — never two states at once,\n' +
  '   never detached or exploded parts.'

/** ③ 섹션 글이 없을 때의 목적 문장 — 'named below'가 가리킬 것이 없다 */
const SECTION_TEXT_LINE = /^Text of this section \(reference only, never drawn as text\):/m
export const NAMED_FALLBACKS: Readonly<Record<'feature_proof' | 'state' | 'ingredient' | 'problem', string>> = {
  feature_proof: 'Show the product\'s main working part working or clearly visible — that part is the focus, and the meaning reads from the picture alone.',
  state: 'Show the same product in one clear state other than its main shot (empty or filled, open or closed, folded or unfolded) — only a state the reference photos show or clearly imply. The structure stays exactly as in the reference.',
  ingredient: 'Show the product on its own, with no loose pieces placed around it.',
  problem: 'Show an everyday inconvenience that this kind of product removes — without this product.',
}

/** ⑤ 원형·아치 틀 — 마스크를 그리지 않고 꽉 채운다 */
export const CLIP_FILL_LINES: Readonly<Record<keyof typeof CLIP_LINES, string>> = {
  circle: 'The page later crops this picture into a circle, so keep everything that matters in the central area. Fill the whole rectangular frame edge to edge — do not draw a circle, ring, border, mask or vignette.',
  arch: 'The page later rounds the top of this picture into an arch, so keep everything that matters below the top corners. Fill the whole rectangular frame edge to edge — do not draw an arch, border, mask or vignette.',
}

export interface RulePriorityResult {
  prompt: string
  /** 실제로 바꾼 갈래(①~⑤) — 잡 기록·측정용 */
  changed: Array<'priority' | 'state' | 'named' | 'light' | 'frame'>
}

export function applyRulePriority(prompt: string): RulePriorityResult {
  const changed: RulePriorityResult['changed'] = []
  let out = prompt
  // ④ 조명 — 헌장이 있으면 빛은 헌장만
  const light = canonLight(out)
  if (light.changed) changed.push('light')
  out = light.prompt
  // ② 닫힌 상태
  if (PRODUCT_CONSISTENCY_RULES.includes('assembled/closed state') && CLOSED_STATE.test(out)) {
    out = out.replace(CLOSED_STATE, ONE_STATE)
    changed.push('state')
  }
  // ③ 가리킬 글 없는 목적
  if (!SECTION_TEXT_LINE.test(out)) {
    for (const key of Object.keys(NAMED_FALLBACKS) as Array<keyof typeof NAMED_FALLBACKS>) {
      const line = PURPOSE_LINES[key]
      if (line && out.includes(line)) {
        out = out.split(line).join(NAMED_FALLBACKS[key])
        if (!changed.includes('named')) changed.push('named')
      }
    }
  }
  // ⑤ 원형·아치 틀
  for (const key of Object.keys(CLIP_FILL_LINES) as Array<keyof typeof CLIP_FILL_LINES>) {
    if (out.includes(CLIP_LINES[key])) {
      out = out.split(CLIP_LINES[key]).join(CLIP_FILL_LINES[key])
      if (!changed.includes('frame')) changed.push('frame')
    }
  }
  // ① 우선순위 — 꼬리표가 하나라도 생기면 순위 블록을 맨 끝에 한 번. 감독 줄이 있는 컷은 빛 문장이 감독 줄을 가리키는 판(감독 줄 없는 컷은 그대로)
  let tagged = false
  for (const [from, to] of PRIORITY_TAG_SWAPS) {
    if (out.includes(from)) {
      out = out.split(from).join(to)
      tagged = true
    }
  }
  if ((tagged || /\bPriority [2-4] — /.test(out)) && !out.includes(PRIORITY_BLOCK) && !out.includes(PRIORITY_BLOCK_DIRECTOR)) {
    out = `${out}\n\n${DIRECTOR_AT.test(out) ? PRIORITY_BLOCK_DIRECTOR : PRIORITY_BLOCK}`
    changed.push('priority')
  }
  return { prompt: out, changed }
}
