import { describe, expect, it } from 'vitest'
import { planHiggsfieldPrompt } from '@/lib/agents/image/higgsfield-image'
import { buildStyleCharter } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { fitMsPrompt } from './ms-prompt-fit'
import { tidyImageBrief } from './pdp-image-brief'
import {
  canonLight,
  CHARTER_LIGHT_HEAD,
  CHARTER_LIGHT_RULE_MS,
  charterLightBlockOf,
  DIRECTOR_LIGHT_RULE,
  DIRECTOR_LINE_HEAD,
  LIGHT_RULE,
} from './pdp-image-light'
import { directorLineFor } from './pdp-new-stages-stage'

// 결정 카드 c15(J25) — light 켠 잡: 새 배치 연출 감독 줄이 그 컷의 빛 정본이고, MS 2k 덜어 내기에서도 빛 줄이 남는다.
// light가 꺼진 잡은 canonLight를 부르지 않아(pdp-image-stage) 헌장에 빛 규칙이 없고, 감독 줄 없는 컷은 지금 그대로다

const CHARTER = buildStyleCharter({
  bgHex: '#fff7f0',
  colorTemp: 'Warm-neutral 5000K',
  direction: 'top-left',
  shadowAngle: 45,
  propColors: '#c2410c, #f4b8a0',
  mood: 'cozy · warm',
  setDesc: 'one continuous studio set shared by every cut of this page',
})
const BASE = [
  'Professional e-commerce product photography',
  '- Lighting: large softbox at 45-degree angle (key), white reflector fill, strip/rim light for edge separation',
  '- Color temperature: 5500K daylight balanced, no color cast',
].join('\n')
const PLAN = {
  light: 'warm window light from the left, 4500K, golden hour glow',
  set: 'oak vanity by a window',
  cuts: [
    { key: 'k5_a', direction: 'close-up of the hand drawing the brush through the hair', exception: '', distance: 'close', people: 'hand' },
    { key: 'k6_a', direction: 'night scene under a desk lamp, 3200K', exception: 'night cut', distance: 'mid', people: 'none' },
  ],
}
const DESIGN_PROMPTS = { director: { status: 'done', result: PLAN } } as never
const lineOf = (key: string) => directorLineFor(DESIGN_PROMPTS, key)!
const IDENTITY = 'PRODUCT IDENTITY (read from the photos): rounded handle with 1 heart-shaped cutout, central folding hinge.'
const BRIEF = ['[Shot direction]', 'This block wins.', `Camera: ${'x'.repeat(1400)}`].join('\n')
const join = (...blocks: string[]) => blocks.join('\n\n')
const pad = (head: string, n: number) => `${head} ${'x'.repeat(Math.max(0, n - head.length - 1))}`
/** 조립 순서(pdp-image-stage cutPromptOf)와 같은 차례 — 바탕·기본 촬영·헌장·K 컷 지시·감독 줄 */
const cut = (key: string | null, scene = 'SCENE: brush on the vanity') => join(scene, BASE, CHARTER, IDENTITY, BRIEF, ...(key ? [lineOf(key)] : []))

describe('canonLight — 연출 감독 줄이 있는 컷은 감독 줄이 빛 정본', () => {
  it('감독 줄은 그대로(감독 색온도·빛 문구 포함), 바로 아래에 감독 빛 규칙 — 헌장 끝 규칙은 붙이지 않는다', () => {
    const line = lineOf('k5_a')
    expect(line.startsWith(DIRECTOR_LINE_HEAD)).toBe(true)
    expect(line).toContain('Light: warm window light from the left, 4500K, golden hour glow')
    const out = canonLight(cut('k5_a')).prompt
    expect(out).toContain(`${line}\n${DIRECTOR_LIGHT_RULE}`)
    expect(out).not.toContain(LIGHT_RULE)
    // 감독 줄 밖의 사진 기본 조명·색온도는 지금처럼 정리한다
    expect(out).not.toContain('5500K')
    expect(out).not.toContain('softbox')
    // 두 번 돌려도 같다
    expect(canonLight(out).prompt).toBe(out)
  })

  it('예외 컷(바뀐 빛을 지시가 말함)도 감독 줄을 그대로 두고 규칙을 붙인다', () => {
    const line = lineOf('k6_a')
    expect(line).toBe('Art direction: night scene under a desk lamp, 3200K')
    const out = canonLight(cut('k6_a')).prompt
    expect(out).toContain(`${line}\n${DIRECTOR_LIGHT_RULE}`)
    expect(out).not.toContain(LIGHT_RULE)
  })

  it('감독 줄이 없는 컷(대표 컷·감독 없는 잡)은 지금처럼 헌장 끝에 헌장 규칙', () => {
    expect(directorLineFor(DESIGN_PROMPTS, 'hero')).toBeNull()
    const out = canonLight(cut(null)).prompt
    expect(out).toContain(LIGHT_RULE)
    expect(out).not.toContain(DIRECTOR_LIGHT_RULE)
    expect(out).not.toContain('5500K')
  })
})

describe('charterLightBlockOf — MS가 헌장을 뺄 때 남길 빛 두 줄', () => {
  it('헌장 끝에 빛 규칙이 있는 헌장(light 켠 잡, 감독 줄 없는 컷)만 빛 두 줄 블록을 만든다', () => {
    const lit = canonLight(join('SCENE', CHARTER)).prompt.split('\n\n')[1]
    expect(charterLightBlockOf(lit)).toBe(
      [
        CHARTER_LIGHT_HEAD,
        '- Single color temperature for every cut: Warm-neutral 5000K',
        '- Single key light direction: top-left (shadow angle ~45 degrees)',
        CHARTER_LIGHT_RULE_MS,
      ].join('\n'),
    )
    expect(charterLightBlockOf(CHARTER)).toBeNull()
    expect(charterLightBlockOf(`SCENE\n${LIGHT_RULE}`)).toBeNull()
  })
})

describe('fitMsPrompt — MS 덜어 내기에서 빛 줄은 남는다', () => {
  /** 헌장을 덜어야만 상한(5000자)에 드는 길이로 바탕 장면을 늘린다 */
  const sceneFor = (rest: string) => pad('SCENE', 5300 - rest.length)

  it('light 켠 잡·감독 줄 없는 컷: 헌장 대신 헌장 빛 두 줄 블록을 남긴다(charter-light)', () => {
    const rest = canonLight(join('', BASE, CHARTER, IDENTITY, BRIEF)).prompt
    const p = canonLight(cut(null, sceneFor(rest))).prompt
    expect(planHiggsfieldPrompt(p).dropped).toContain('GLOBAL STYLE CHARTER')
    const fit = fitMsPrompt(p)
    expect(fit.fits).toBe(true)
    expect(fit.prompt).not.toContain('GLOBAL STYLE CHARTER')
    expect(fit.prompt).toContain(`${CHARTER_LIGHT_HEAD}\n- Single color temperature for every cut: Warm-neutral 5000K`)
    expect(fit.prompt).toContain(CHARTER_LIGHT_RULE_MS)
    expect(fit.dropped).toContain('GLOBAL STYLE CHARTER')
    expect(fit.compacted).toEqual(['charter-light'])
  })

  it('light가 꺼진 잡(헌장에 빛 규칙 없음)은 지금 그대로 — 헌장 블록째 빠지고 빛 블록이 없다', () => {
    const p = cut(null, sceneFor(join('', BASE, CHARTER, IDENTITY, BRIEF)))
    const fit = fitMsPrompt(p)
    expect(fit.prompt).toBe(planHiggsfieldPrompt(p).prompt)
    expect(fit.prompt).not.toContain(CHARTER_LIGHT_HEAD)
    expect(fit.compacted).toEqual([])
  })

  it('감독 줄 컷: 헌장이 빠져도 감독 줄과 감독 빛 규칙은 남고 헌장 빛 블록은 더하지 않는다', () => {
    const line = lineOf('k5_a')
    const rest = canonLight(join('', BASE, CHARTER, IDENTITY, BRIEF, line)).prompt
    const p = canonLight(cut('k5_a', sceneFor(rest))).prompt
    const fit = fitMsPrompt(p)
    expect(fit.dropped).toContain('GLOBAL STYLE CHARTER')
    expect(fit.prompt).toContain(`${line}\n${DIRECTOR_LIGHT_RULE}`)
    expect(fit.prompt).not.toContain(CHARTER_LIGHT_HEAD)
    expect(fit.compacted).not.toContain('charter-light')
  })
})

describe('브리프 정리(brief)와 함께 켠 잡', () => {
  it('감독 빛 규칙이 있는 컷에는 "헌장을 따르라"를 더하지 않는다 — 감독 줄 없는 컷은 지금처럼 더한다', () => {
    const director = tidyImageBrief(canonLight(cut('k5_a')).prompt, { sizeHonored: false }).prompt
    expect(director).toContain(DIRECTOR_LIGHT_RULE)
    expect(director).not.toContain('follow this charter.')
    const plain = tidyImageBrief(canonLight(cut(null)).prompt, { sizeHonored: false }).prompt
    expect(plain).toContain('follow this charter.')
  })
})
