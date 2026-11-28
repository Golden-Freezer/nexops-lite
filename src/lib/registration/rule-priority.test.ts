import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildStyleCharter, PRODUCT_CONSISTENCY_RULES } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { heroKindBlock } from './hero-kind'
import { applyD2SceneCut } from './pdp-image-scene'
import { canonLight, DIRECTOR_LIGHT_RULE, LIGHT_RULE } from './pdp-image-light'
import { solutionWithoutFace } from './pdp-image-tasks'
import { directorLineFor } from './pdp-new-stages-stage'
import {
  applyRulePriority,
  CLIP_FILL_LINES,
  NAMED_FALLBACKS,
  ONE_STATE,
  PRIORITY_BLOCK,
  PRIORITY_BLOCK_DIRECTOR,
  PRIORITY_LIGHT_DIRECTOR,
  PRIORITY_TAG_SWAPS,
} from './rule-priority'
import { buildFrameBrief, buildShotBrief, CLIP_LINES, heroLargeBrief, PURPOSE_LINES, type LineShot } from './templatelib/shot-brief'

const shot = (over: Partial<LineShot> = {}): LineShot => ({ key: 'k', section: 'sub_div', purpose: 'scene', composition: 'in_use', aspect: '1:1', show: '', ...over })
const CHARTER = [
  'GLOBAL STYLE CHARTER (identical across ALL images of this product page — deviation from this charter is a failure):',
  '- Single color temperature for every cut: Warm tungsten 3200-4000K side lighting',
  'This image is one of many images on a single product page sharing this exact charter.',
].join('\n')
const BASE = ['Premium ecommerce photo', PRODUCT_CONSISTENCY_RULES, '- Color temperature: 5500K daylight balanced, no color cast', '- Lighting: natural window light or outdoor golden hour, soft and warm', CHARTER].join('\n\n')

describe('규칙 충돌 정리(rulepriority)', () => {
  it('① 위를 이긴다 문장이 모두 꼬리표가 되고 순위 블록이 맨 끝에 한 번 붙는다 — 실제 블록 빌더 출력 기준', () => {
    const prompt = [
      BASE,
      buildShotBrief(shot({ purpose: 'action', show: '손잡이를 돌려 연다' })),
      buildFrameBrief('top'),
      heroLargeBrief(),
      heroKindBlock('in_use', 0),
    ].join('\n\n')
    const withHands = solutionWithoutFace(applyD2SceneCut(prompt, 'hero'))
    expect(withHands).toMatch(/wins over/)
    // 앞의 모든 원문(디자인 컷 장면 세트 포함)이 실제로 들어 있어야 대조가 뜻이 있다
    for (const [from] of PRIORITY_TAG_SWAPS.filter(([f]) => !f.startsWith('This block wins over the shot distance'))) expect(withHands, from.slice(0, 40)).toContain(from)
    const out = applyRulePriority(withHands)
    expect(out.prompt).not.toMatch(/wins over/)
    expect(out.prompt.endsWith(PRIORITY_BLOCK)).toBe(true)
    expect(out.prompt.split(PRIORITY_BLOCK)).toHaveLength(2)
    expect(out.prompt).toContain('Priority 2 — what this cut must show')
    expect(out.prompt).toContain("Priority 3 — this cut's brief.")
    expect(out.changed).toContain('priority')
  })

  it('① 컷 목적(shotdiv) 문장도 원문 그대로 바꿀 수 있다 — 원문 파일과 대조', () => {
    const src = readFileSync(join(__dirname, 'internalized/shot-diversity.ts'), 'utf8')
    const from = PRIORITY_TAG_SWAPS.find(([f]) => f.startsWith('This block wins over the shot distance'))![0]
    expect(src).toContain(from)
  })

  it('② 일관성 6번 닫힌 상태 문장 → 이 컷의 한 상태', () => {
    const out = applyRulePriority(BASE)
    expect(out.prompt).not.toContain('assembled/closed state')
    expect(out.prompt).toContain(ONE_STATE)
    expect(out.changed).toContain('state')
  })

  it('③ named below 목적인데 섹션 글이 없으면 글 없이 서는 문장으로, 글이 있으면 그대로', () => {
    const empty = buildShotBrief(shot({ purpose: 'feature_proof', composition: 'front', show: '' }))
    expect(empty).toContain(PURPOSE_LINES.feature_proof)
    const out = applyRulePriority(empty)
    expect(out.prompt).not.toContain(PURPOSE_LINES.feature_proof)
    expect(out.prompt).toContain(NAMED_FALLBACKS.feature_proof)
    const withText = buildShotBrief(shot({ purpose: 'state', composition: 'front', show: '접은 모습' }))
    expect(applyRulePriority(withText).prompt).toContain(PURPOSE_LINES.state)
  })

  it('④ 조명은 헌장 한 곳만 — 5500K·창빛·골든아워 줄이 빠진다', () => {
    const out = applyRulePriority(BASE)
    expect(out.prompt).not.toContain('5500K')
    expect(out.prompt).not.toMatch(/golden hour/i)
    expect(out.prompt).toContain('Warm tungsten 3200-4000K')
    expect(out.prompt).toContain(LIGHT_RULE)
    expect(out.changed).toContain('light')
  })

  it('⑤ 원형 틀 문구 → 꽉 채우고 원을 그리지 않는다', () => {
    const brief = buildShotBrief(shot({ clipShape: 'circle' }))
    expect(brief).toContain(CLIP_LINES.circle)
    const out = applyRulePriority(brief)
    expect(out.prompt).toContain(CLIP_FILL_LINES.circle)
    expect(out.prompt).not.toContain(CLIP_LINES.circle)
  })

  it('두 번 돌려도 같고, 바꿀 것이 없는 지시는 그대로다', () => {
    const once = applyRulePriority(solutionWithoutFace(BASE)).prompt
    expect(applyRulePriority(once).prompt).toBe(once)
    const plain = 'Premium ecommerce photo of the product on a table.'
    expect(applyRulePriority(plain)).toEqual({ prompt: plain, changed: [] })
  })
})

// J10×J25 후속 — 새 배치 연출 감독 줄이 있는 컷은 canonLight가 감독 줄을 빛 정본으로 두므로(c15) 순위 블록 빛 문장도 감독 줄을 가리킨다.
// 감독 줄이 없는 컷(지금 배치 — J10 K8 측정 대상)은 순위 블록이 바이트까지 그대로다
describe('규칙 충돌 정리 × 연출 감독 줄(rulepriority × light, J10×J25)', () => {
  const NEW_CHARTER = buildStyleCharter({
    bgHex: '#fff7f0',
    colorTemp: 'Warm-neutral 5000K',
    direction: 'top-left',
    shadowAngle: 45,
    propColors: '#c2410c, #f4b8a0',
    mood: 'cozy · warm',
    setDesc: 'one continuous studio set shared by every cut of this page',
  })
  const PLAN = {
    light: 'warm window light from the left, 4500K, golden hour glow',
    set: 'oak vanity by a window',
    cuts: [{ key: 'k5_a', direction: 'close-up of the hand drawing the brush through the hair', exception: '', distance: 'close', people: 'hand' }],
  }
  const directorLine = directorLineFor({ director: { status: 'done', result: PLAN } } as never, 'k5_a')!
  /** 조립 순서(pdp-image-stage cutPromptOf) — 바탕·기본 촬영·헌장·일관성·K 컷 지시·감독 줄 */
  const cutOf = (director: boolean) =>
    [
      'Premium ecommerce photo',
      '- Color temperature: 5500K daylight balanced, no color cast',
      NEW_CHARTER,
      PRODUCT_CONSISTENCY_RULES,
      buildShotBrief(shot({ purpose: 'action', show: '빗을 쥐고 빗는다' })),
      ...(director ? [directorLine] : []),
    ].join('\n\n')

  it('감독 줄 컷: 순위 블록 빛 문장이 감독 줄을 가리키고, 헌장만 문장·헌장 끝 규칙은 없다 — 감독 빛 규칙은 감독 줄 아래 한 번', () => {
    const out = applyRulePriority(cutOf(true))
    expect(out.prompt.endsWith(PRIORITY_BLOCK_DIRECTOR)).toBe(true)
    expect(out.prompt.split(PRIORITY_BLOCK_DIRECTOR)).toHaveLength(2)
    expect(out.prompt).not.toContain(PRIORITY_BLOCK)
    expect(out.prompt).not.toContain('come only from the style charter')
    expect(out.prompt).not.toContain(LIGHT_RULE)
    expect(out.prompt).toContain(`${directorLine}\n${DIRECTOR_LIGHT_RULE}`)
    expect(out.prompt.split(DIRECTOR_LIGHT_RULE)).toHaveLength(2)
    // 감독 줄의 빛 문구는 그대로다(정본)
    expect(out.prompt).toContain('Light: warm window light from the left, 4500K, golden hour glow')
    expect(out.changed).toEqual(expect.arrayContaining(['light', 'priority']))
  })

  it('light와 함께 켠 잡(stage가 canonLight를 먼저 돌림)도 같은 글이고, 두 번 돌려도 같다', () => {
    const once = applyRulePriority(cutOf(true)).prompt
    expect(applyRulePriority(canonLight(cutOf(true)).prompt).prompt).toBe(once)
    expect(applyRulePriority(once).prompt).toBe(once)
  })

  it('감독 줄 없는 컷은 지금 순위 블록 그대로(헌장이 빛 정본), 감독 판은 빛 문장 한 줄만 다르다', () => {
    const out = applyRulePriority(cutOf(false))
    expect(out.prompt.endsWith(PRIORITY_BLOCK)).toBe(true)
    expect(out.prompt).not.toContain(PRIORITY_BLOCK_DIRECTOR)
    expect(out.prompt).toContain(LIGHT_RULE)
    const [plain, director] = [PRIORITY_BLOCK.split('\n'), PRIORITY_BLOCK_DIRECTOR.split('\n')]
    expect(director).toHaveLength(plain.length)
    expect(director.slice(0, -1)).toEqual(plain.slice(0, -1))
    expect(director.at(-1)).toBe(`${PRIORITY_LIGHT_DIRECTOR} The no-added-text rule always applies.`)
    expect(plain.at(-1)).toContain('come only from the style charter')
  })
})
