/**
 * 체감 결과 문장 길이 가드(하네스 J65) — MS 2k 컷 지시에서 체감 문장 때문에 부품·참조 역할 블록이 더 덜리거나 상한을 넘으면 문장만 뺀다.
 * 순수 함수만 본다(이미지·LLM·DB 콜 0). 단계 배선(기록 effectShot)은 k-line-run.test.ts가 본다
 */

import { describe, expect, it } from 'vitest'
import { effectShotFitOf } from './effect-shot-fit'
import { HF_PROMPT_MAX } from '@/lib/agents/image/higgsfield-image'
import { fitMsPrompt } from './ms-prompt-fit'
import { EFFECT_SHOT_LINE } from './templatelib/shot-brief'

const MARK = ` ${EFFECT_SHOT_LINE}`
const SHOT = `[Shot direction]\nPurpose: Show the product doing its job.${MARK}\nCamera: front, eye level.`
const PARTS = 'PRODUCT PARTS (count them exactly as in the reference photo): one cord, one lid, two handles.'
const ROLES = "REFERENCE ROLES: FIRST image = the user's original product photo, the single source of truth for structure."
/** 바탕 장면 길이 n — 첫 블록은 맞추기가 덜지 않으니 길이로 상한 가까이를 만든다 */
const promptOf = (n: number, shot = SHOT) => [`Base scene: ${'x'.repeat(n)}`, shot, PARTS, ROLES].join('\n\n')

describe('effectShotFitOf — 체감 문장 길이 가드', () => {
  it('문장은 90자 안이고 숫자·분할 전후 금지를 지닌다', () => {
    expect(EFFECT_SHOT_LINE.length).toBeLessThanOrEqual(90)
    expect(EFFECT_SHOT_LINE).toContain('no numbers or split before/after')
  })

  it('문장이 없는 지시(꺼진 잡·기능·사용 밖 컷)는 null — 호출자가 지금처럼 맞춘다', () => {
    expect(effectShotFitOf(promptOf(100, SHOT.replace(MARK, '')))).toBeNull()
    expect(effectShotFitOf('')).toBeNull()
  })

  it('여유가 있으면 문장을 싣고(shown) 맞추기 결과는 fitMsPrompt 그대로다', () => {
    const prompt = promptOf(1000)
    const out = effectShotFitOf(prompt)!
    expect(out.effectShot).toBe('shown')
    expect(out.prompt).toBe(prompt)
    expect(out.fit).toEqual(fitMsPrompt(prompt))
    expect(out.fit.prompt).toContain(EFFECT_SHOT_LINE)
  })

  it('문장 때문에 블록이 하나 더 덜리면 문장만 뺀다(too-long) — 부품·참조 역할 블록이 남는다', () => {
    // 문장 없이 딱 상한인 길이 — 문장을 붙이면 넘어 부품 블록을 덜게 된다
    const bare = promptOf(100, SHOT.replace(MARK, ''))
    const n = 100 + HF_PROMPT_MAX - bare.length
    const prompt = promptOf(n)
    expect(fitMsPrompt(prompt).dropped.length).toBeGreaterThan(fitMsPrompt(prompt.replace(MARK, '')).dropped.length)
    const out = effectShotFitOf(prompt)!
    expect(out.effectShot).toBe('too-long')
    expect(out.prompt).toBe(prompt.replace(MARK, ''))
    expect(out.fit.fits).toBe(true)
    expect(out.fit.dropped).toEqual([])
    expect(out.fit.prompt).toContain('PRODUCT PARTS')
    expect(out.fit.prompt).toContain('REFERENCE ROLES')
    expect(out.fit.prompt).not.toContain(EFFECT_SHOT_LINE)
  })

  it('어느 길이에서도 가드 결과는 문장 없는 지시보다 더 덜지 않고, 문장 없는 지시가 들어가면 들어간다', () => {
    const seen = new Set<string>()
    for (let n = HF_PROMPT_MAX - 600; n <= HF_PROMPT_MAX + 200; n += 7) {
      const prompt = promptOf(n)
      const out = effectShotFitOf(prompt)!
      const without = fitMsPrompt(prompt.replace(MARK, ''))
      seen.add(out.effectShot)
      expect(out.fit.dropped.length, String(n)).toBeLessThanOrEqual(without.dropped.length)
      if (without.fits) expect(out.fit.fits, String(n)).toBe(true)
      expect(out.fit.prompt.includes(EFFECT_SHOT_LINE), String(n)).toBe(out.effectShot === 'shown')
    }
    expect([...seen].sort()).toEqual(['shown', 'too-long'])
  })
})
