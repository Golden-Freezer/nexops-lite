import { describe, expect, it } from 'vitest'
import { fitHiggsfieldPrompt, planHiggsfieldPrompt } from '@/lib/agents/image/higgsfield-image'
import {
  D2_SOLID_REFERENCE_ROLES_MS,
  fitMsPrompt,
  MS_SHORT_FORMS,
  PARTS_RULE_MS,
  REFERENCE_ROLES_MS,
  VARY_REFERENCE_MS,
  withoutDuplicateUseLine,
} from './ms-prompt-fit'
import { PARTS_RULE_BLOCK } from './parts-rule'
import { D2_SOLID_REFERENCE_ROLES_TEXT, REFERENCE_ROLES_TEXT } from './pdp-image-scene'
import { FIRST_ANGLE_TEXT, VARY_REFERENCE_TEXT, varyReferenceText } from './templatelib/shot-variety'
import { K_NEVER_LINE } from './templatelib/shot-brief'
import { USE_LINE_PREFIX } from './templatelib/handling-facts'
import { PRIORITY_BLOCK, PRIORITY_BLOCK_DIRECTOR, PRIORITY_BLOCK_MS } from './rule-priority'

const pad = (head: string, n: number) => `${head} ${'x'.repeat(Math.max(0, n - head.length - 1))}`
const IDENTITY = 'PRODUCT IDENTITY (read from the photos): rounded handle with 1 heart-shaped cutout, central folding hinge.'
const brief = (extra = 0, never = true) => ['[Shot direction]', 'This block wins.', pad('Camera:', 300 + extra), ...(never ? [K_NEVER_LINE] : [])].join('\n')
const join = (...blocks: string[]) => blocks.join('\n\n')

describe('fitMsPrompt — 1단으로 들어가면 공급자와 같은 글', () => {
  it('상한 안이면 원문 그대로(바꾼 것 없음)', () => {
    const p = join('SCENE', IDENTITY)
    expect(fitMsPrompt(p)).toEqual({ prompt: p, originalLength: p.length, dropped: [], compacted: [], fits: true })
  })

  it('1단 덜어 내기로 들어가면 planHiggsfieldPrompt 결과와 같고 2단은 하지 않는다', () => {
    const p = join(pad('SCENE', 1000), pad('GLOBAL STYLE CHARTER', 2500), IDENTITY, pad('[Shot direction — product_intro]', 500), brief(2000))
    const fit = fitMsPrompt(p)
    expect(fit.prompt).toBe(planHiggsfieldPrompt(p).prompt)
    expect(fit.prompt).toBe(fitHiggsfieldPrompt(p).prompt)
    expect(fit.dropped).toEqual(['GLOBAL STYLE CHARTER'])
    expect(fit.compacted).toEqual([])
  })
})

describe('fitMsPrompt — 2단 차례(① 덮인 블록 → ② 짧은 MS 문구 → ③ 마지막 수단)', () => {
  it('① 페이지 기본 촬영 지시·표면 비우기를 덜고 들어가면 멈춘다', () => {
    const p = join(pad('SCENE', 1500), IDENTITY, pad('[Shot direction — product_intro]', 600), pad('Product surface must be BLANK', 400), brief(2400))
    const fit = fitMsPrompt(p)
    expect(fit.fits).toBe(true)
    expect(fit.dropped).toEqual(['[Shot direction — '])
    expect(fit.prompt).toContain('Product surface must be BLANK')
  })

  it('① 글자 금지 두 블록은 K 컷 지시에 Never 줄이 있을 때만 덜어 낸다', () => {
    const blocks = (never: boolean) =>
      join(pad('SCENE', 1500), pad('NOTE ON THE CONTEXT LINE ABOVE', 300), pad('IMPORTANT: Do NOT include any text', 300), IDENTITY, brief(2700, never))
    const withNever = fitMsPrompt(blocks(true))
    expect(withNever.dropped).toContain('NOTE ON THE CONTEXT LINE ABOVE')
    expect(withNever.fits).toBe(true)
    const without = fitMsPrompt(blocks(false))
    expect(without.dropped).not.toContain('NOTE ON THE CONTEXT LINE ABOVE')
    expect(without.dropped).not.toContain('IMPORTANT: Do NOT include any text')
    expect(without.prompt).toContain('IMPORTANT: Do NOT include any text')
  })

  it('② 부품 규칙·참조 역할 고정 문구를 짧은 MS 문구로 바꾼다(바꾼 이름을 남긴다)', () => {
    const roles = `${REFERENCE_ROLES_TEXT} ${varyReferenceText('person')}`
    const p = join(pad('SCENE', 1600), IDENTITY, roles, brief(1000), PARTS_RULE_BLOCK)
    const fit = fitMsPrompt(p)
    expect(fit.fits).toBe(true)
    expect(fit.compacted[0]).toBe('parts')
    expect(fit.prompt).toContain(PARTS_RULE_MS)
    expect(fit.prompt).not.toContain(PARTS_RULE_BLOCK)
    if (fit.compacted.includes('roles')) expect(fit.prompt).toContain(REFERENCE_ROLES_MS)
  })

  it('② 짧은 MS 문구는 원문보다 짧고, 사람 참조 문구는 상품 제외 문장을 품는다', () => {
    for (const [name, long, short] of MS_SHORT_FORMS) expect(short.length, name).toBeLessThan(long.length)
    expect(VARY_REFERENCE_MS).toContain('Never take the product from the LAST image')
    const d2 = join(pad('SCENE', 1700), IDENTITY, `${D2_SOLID_REFERENCE_ROLES_TEXT} ${FIRST_ANGLE_TEXT}`, brief(2100))
    const fit = fitMsPrompt(d2)
    expect(fit.prompt).toContain(D2_SOLID_REFERENCE_ROLES_MS)
    expect(fit.compacted).toContain('roles-d2')
  })

  it('② Use 줄 재료가 식별 카드에 그대로 있으면 그 줄만 뺀다(판매자 메모 재료는 남는다)', () => {
    const dup = ['Correct use: Use it right.', `${USE_LINE_PREFIX}rounded handle with 1 heart-shaped cutout, central folding hinge…`].join('\n')
    expect(withoutDuplicateUseLine(dup, [IDENTITY])).toBe('Correct use: Use it right.')
    const own = ['Correct use: Use it right.', `${USE_LINE_PREFIX}hold the grip, bristles face the scalp.`].join('\n')
    expect(withoutDuplicateUseLine(own, [IDENTITY])).toBe(own)
  })

  it('③ 마지막 수단은 쓰는 법 → 부품 → 참조 역할 순서이고, 첫 블록·식별 카드·K 컷 지시는 덜지 않는다', () => {
    const p = join(pad('SCENE', 1800), IDENTITY, pad('Correct use:', 400), PARTS_RULE_BLOCK, pad('REFERENCE ROLES: custom', 600), brief(1900))
    const fit = fitMsPrompt(p)
    expect(fit.fits).toBe(true)
    expect(fit.dropped).toContain('Correct use:')
    expect(fit.prompt.startsWith('SCENE')).toBe(true)
    expect(fit.prompt).toContain(IDENTITY)
    expect(fit.prompt).toContain('[Shot direction]')
  })

  it('끝까지 넘으면 fits false — 몰래 자르지 않는다(공급자가 오류를 낸다)', () => {
    const p = join(pad('SCENE', 3000), IDENTITY, brief(2500))
    const fit = fitMsPrompt(p)
    expect(fit.fits).toBe(false)
    expect(fit.prompt.length).toBeGreaterThan(5000)
    expect(() => fitHiggsfieldPrompt(fit.prompt)).toThrow(/힉스필드 상한 5000자/)
  })

  it('② 규칙 충돌 정리 순위 블록(rulepriority 잡, J10)은 짧은 MS 판으로 맨 먼저 바꾼다 — 부품 규칙은 그대로 남고, 순위 블록이 없는 지시는 이 줄이 바꾸지 않는다', () => {
    const rest = join(IDENTITY, PARTS_RULE_BLOCK, brief(), PRIORITY_BLOCK)
    const on = join(pad('SCENE', 5200 - rest.length - 2), rest)
    expect(on.length).toBe(5200)
    const fit = fitMsPrompt(on)
    expect(fit.fits).toBe(true)
    expect(fit.compacted).toEqual(['priority'])
    expect(fit.dropped).toEqual([])
    expect(fit.prompt).toContain(PRIORITY_BLOCK_MS)
    expect(fit.prompt).not.toContain(PRIORITY_BLOCK)
    expect(fit.prompt).toContain(PARTS_RULE_BLOCK)
    // ② 단계에서는 헌장이 이미 빠졌으므로 짧은 판은 헌장을 가리키지 않는다
    expect(PRIORITY_BLOCK_MS).not.toMatch(/charter/i)
    const offRest = join(IDENTITY, PARTS_RULE_BLOCK, brief())
    const off = fitMsPrompt(join(pad('SCENE', 5200 - offRest.length - 2), offRest))
    expect(off.compacted).not.toContain('priority')
    expect(off.compacted[0]).toBe('parts')
  })

  it('② 감독 줄 컷의 순위 블록(빛 문장만 감독 줄, J10×J25)도 같은 짧은 판으로 맨 먼저 바꾼다 — 부품 규칙은 그대로', () => {
    const rest = join(IDENTITY, PARTS_RULE_BLOCK, brief(), PRIORITY_BLOCK_DIRECTOR)
    const on = join(pad('SCENE', 5200 - rest.length - 2), rest)
    expect(on.length).toBe(5200)
    const fit = fitMsPrompt(on)
    expect(fit.fits).toBe(true)
    expect(fit.compacted).toEqual(['priority-director'])
    expect(fit.dropped).toEqual([])
    expect(fit.prompt).toContain(PRIORITY_BLOCK_MS)
    expect(fit.prompt).not.toContain(PRIORITY_BLOCK_DIRECTOR)
    expect(fit.prompt).toContain(PARTS_RULE_BLOCK)
  })

  it('짧은 MS 문구 표의 원문은 지금 조립 경로의 상수다(원문이 바뀌면 이 시험이 알린다)', () => {
    const names = Object.fromEntries(MS_SHORT_FORMS.map(([n, long]) => [n, long]))
    expect(names.priority).toBe(PRIORITY_BLOCK)
    expect(names['priority-director']).toBe(PRIORITY_BLOCK_DIRECTOR)
    expect(names.parts).toBe(PARTS_RULE_BLOCK)
    expect(names.roles).toBe(REFERENCE_ROLES_TEXT)
    expect(names['vary-person']).toBe(VARY_REFERENCE_TEXT)
  })
})
