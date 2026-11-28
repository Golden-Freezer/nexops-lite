import { describe, expect, it } from 'vitest'
import { fitMsPrompt, msOverflowMessage, MS_SHORT_FORMS, TRUE_SCALE_CAMERA_MS } from './ms-prompt-fit'
import { withoutDuplicateHandTerms } from './ms-prompt-shorten'
import { sizeLine, TRUE_SCALE_CAMERA, trueScaleLine } from './templatelib/shot-brief'

// AX-CT-32 — MS 지시 5,000자 상한: 맞추기 단계를 모두 써도 넘던 잡 a88c80b3 다섯 컷(6~187자 넘침, 덜어 낸 블록 0개 오류)
const pad = (head: string, n: number) => `${head} ${'x'.repeat(Math.max(0, n - head.length - 1))}`
const SIZE = '가로 16.5cm × 세로 20.7cm (165 × 207mm)'

describe('size-dup — 같은 치수의 손 비유는 하나만', () => {
  it('20.7cm·207mm 처럼 같은 값은 앞의 것만 남기고 크기 원문은 바이트 그대로', () => {
    const line = sizeLine(SIZE)
    expect(line).toContain('16.5cm is')
    const next = withoutDuplicateHandTerms(['바탕', `[Shot direction]\nCamera: front\n${line}`])
    expect(next).not.toBeNull()
    const out = next![1].split('\n')[2]
    expect(out.startsWith(`Real size (reference only, never drawn as text): ${SIZE}. `)).toBe(true)
    expect(out.length).toBeLessThan(line.length)
    expect(out.match(/ is about /g)?.length).toBe(2) // 16.5cm·20.7cm 만 남음('165 ×'는 단위가 없어 치수가 아니고, 207mm 는 20.7cm 와 같은 값)
    expect(out.endsWith('Keep hands and objects in true proportion to it.')).toBe(true)
  })

  it('겹침이 없거나 크기 줄이 없으면 null, 첫 블록의 크기 줄은 건드리지 않는다', () => {
    expect(withoutDuplicateHandTerms(['바탕', `[Shot direction]\n${sizeLine('지름 5cm, 높이 12cm')}`])).toBeNull()
    expect(withoutDuplicateHandTerms(['바탕', 'PRODUCT IDENTITY: x'])).toBeNull()
    expect(withoutDuplicateHandTerms([sizeLine(SIZE), 'PRODUCT IDENTITY: x'])).toBeNull()
  })
})

describe('true-scale — 실물 크기 문장의 짧은 MS 판', () => {
  it('원문은 크기 줄의 상수이고 짧은 판이 더 짧다(키우지 않고 카메라를 가까이 — 뜻 유지)', () => {
    const row = MS_SHORT_FORMS.find(([name]) => name === 'true-scale')
    expect(row?.[1]).toBe(TRUE_SCALE_CAMERA)
    expect(trueScaleLine(SIZE)).toContain(TRUE_SCALE_CAMERA)
    expect(TRUE_SCALE_CAMERA_MS.length).toBeLessThan(TRUE_SCALE_CAMERA.length)
    expect(TRUE_SCALE_CAMERA_MS).toMatch(/move the camera closer/)
    expect(TRUE_SCALE_CAMERA_MS).toMatch(/never enlarge the product/)
  })

  it('덜지 않는 블록만 남아 몇십 자 넘던 꼴이 크기 줄 줄이기로 상한 안에 든다', () => {
    const shot = `[Shot direction]\n${pad('Camera:', 1500)}\n${trueScaleLine(SIZE)}`
    const blocks = [pad('FEATURE HIGHLIGHT IMAGE:', 1400), pad('PRODUCT IDENTITY (read from the photos):', 1500), shot]
    const prompt = blocks.join('\n\n')
    const max = prompt.length - 15 // 15자 넘침 — true-scale 짧은 판이 19자를 줄인다(잡 a88c80b3 k5_detail_0 6자·k7_big_0 8자 꼴)
    const fit = fitMsPrompt(prompt, max)
    expect(fit.fits).toBe(true)
    expect(fit.compacted).toContain('true-scale')
    expect(fit.prompt).toContain(`Real size (reference only, never drawn as text): ${SIZE}.`)
    expect(fit.prompt.startsWith(blocks[0])).toBe(true)
  })
})

describe('끝까지 넘으면 — 몰래 자르지 않고 원인이 보이는 오류 글', () => {
  it('5,000자 경계: 정확히 5,000자는 보내고 5,001자는 덜 블록이 없으면 fits false', () => {
    const at = pad('FEATURE HIGHLIGHT IMAGE:', 2500) + '\n\n' + pad('[Shot direction]', 2498)
    expect(at.length).toBe(5000)
    expect(fitMsPrompt(at).fits).toBe(true)
    const over = at + 'y'
    const fit = fitMsPrompt(over)
    expect(fit.fits).toBe(false)
    expect(fit.dropped).toEqual([])
    expect(fit.prompt.length).toBe(5001)
  })

  it('오류 글에 넘은 글자 수와 남은 블록 머리·길이(긴 차례)를 적는다', () => {
    const over = [pad('FEATURE HIGHLIGHT IMAGE:', 1000), pad('[Shot direction]', 2600), pad('Art direction: Front view', 1500)].join('\n\n')
    const fit = fitMsPrompt(over)
    expect(fit.fits).toBe(false)
    const msg = msOverflowMessage(fit)
    expect(msg).toContain(`MS 지시 ${fit.prompt.length}자`)
    expect(msg).toContain(`${fit.prompt.length - 5000}자 넘어 보내지 않는다`)
    expect(msg.indexOf('[Shot direction]')).toBeLessThan(msg.indexOf('Art direction'))
    expect(msg).toContain('(2600자)')
  })
})
