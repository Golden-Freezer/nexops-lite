import { describe, expect, it } from 'vitest'
import { effectShotFitOf } from '../effect-shot-fit'
import { fitMsPrompt } from '../ms-prompt-fit'
import { EFFECT_SHOT_LINE } from './shot-brief'
import { showBeatFit } from './show-beat-fit'

const LINE = 'Show plainly: the hand rubbing it in small circles on the surface it works on, mid-stroke.'
const shotBlock = (beat: boolean, pad = '') =>
  ['[Shot direction]', `Purpose: Show the feature at the moment of use.${beat ? ` ${LINE}` : ''}`, `Camera: one adult hand holds it${pad}`].join('\n')

describe('보여 줄 동작 문장의 길이 가드(J63)', () => {
  it('문장이 없는 컷은 null(지시 그대로)', () => {
    const prompt = `BASE\n\n${shotBlock(false)}`
    expect(showBeatFit(prompt, undefined, true)).toBeNull()
    expect(showBeatFit(prompt, LINE, true)).toBeNull()
  })

  it('지금 배치 모델(상한 없음)과 여유가 있는 MS 컷은 문장을 그대로 싣는다', () => {
    const prompt = `BASE\n\n${shotBlock(true)}`
    expect(showBeatFit(prompt, LINE, false)).toEqual({ prompt, kind: 'shown' })
    expect(showBeatFit(prompt, LINE, true)).toEqual({ prompt, kind: 'shown' })
  })

  it('문장 때문에 5,000자를 넘으면 문장만 뺀다', () => {
    const base = 'B'.repeat(4990 - shotBlock(false).length)
    const prompt = `${base}\n\n${shotBlock(true)}`
    expect(fitMsPrompt(prompt.replace(` ${LINE}`, '')).fits).toBe(true)
    expect(fitMsPrompt(prompt).fits).toBe(false)
    expect(showBeatFit(prompt, LINE, true)).toEqual({ prompt: prompt.replace(` ${LINE}`, ''), kind: 'too-long' })
  })

  it('문장 때문에 맞추기가 블록을 하나 더 덜면 문장만 뺀다', () => {
    // 마지막 수단 블록(Correct use → PRODUCT PARTS → REFERENCE ROLES)은 넘칠 때 하나씩 덜린다
    const filler = [`Correct use: ${'hold it the right way. '.repeat(12)}`, `PRODUCT PARTS: ${'count parts exactly. '.repeat(12)}`, `REFERENCE ROLES: ${'first image is the product. '.repeat(10)}`].join('\n\n')
    let checked = 0
    for (let pad = 1500; pad < 2400; pad += 5) {
      const prompt = `BASE\n\n${filler}\n\n${shotBlock(true, ' x'.repeat(pad))}`
      const plain = fitMsPrompt(prompt.replace(` ${LINE}`, ''))
      const withBeat = fitMsPrompt(prompt)
      if (withBeat.dropped.length <= plain.dropped.length) continue
      expect(showBeatFit(prompt, LINE, true)).toEqual({ prompt: prompt.replace(` ${LINE}`, ''), kind: 'too-long' })
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('체감 결과 문장(effectshot)과 함께 넘치면 체감 문장을 먼저 뺀다 — 동작 문장 가드 → effectShotFitOf 순서', () => {
    const block = (beat: boolean, effect: boolean) =>
      ['[Shot direction]', `Purpose: Show the feature at the moment of use.${effect ? ` ${EFFECT_SHOT_LINE}` : ''}${beat ? ` ${LINE}` : ''}`, 'Camera: one adult hand holds it'].join('\n')
    // 동작 문장만이면 맞고, 두 문장이 함께면 넘친다
    const base = 'B'.repeat(4995 - block(true, false).length)
    const prompt = `${base}\n\n${block(true, true)}`
    expect(fitMsPrompt(`${base}\n\n${block(true, false)}`).fits).toBe(true)
    expect(fitMsPrompt(prompt).fits).toBe(false)
    const beat = showBeatFit(prompt, LINE, true)!
    expect(beat).toEqual({ prompt, kind: 'shown' })
    const effect = effectShotFitOf(beat.prompt)!
    expect(effect.effectShot).toBe('too-long')
    expect(effect.prompt).toBe(`${base}\n\n${block(true, false)}`)
    expect(effect.fit.fits).toBe(true)
    // 동작 문장만으로도 넘치면 동작 문장을 빼고, 체감 문장은 그 지시로 다시 고른다
    const tight = `${'B'.repeat(5003 - block(true, false).length)}\n\n${block(true, true)}`
    const beat2 = showBeatFit(tight, LINE, true)!
    expect(beat2.kind).toBe('too-long')
    expect(beat2.prompt).not.toContain(LINE)
    expect(beat2.prompt).toContain(EFFECT_SHOT_LINE)
  })
})
