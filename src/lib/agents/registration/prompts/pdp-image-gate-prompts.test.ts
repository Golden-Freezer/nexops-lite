import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyRegenDirective, buildRegenDirective, buildVisionGatePrompt, classifyGateFailure, gateExpectedUseOf, gateRealSizeOf } from './pdp-image-gate-prompts'

describe('buildVisionGatePrompt — K 컷 무대', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

  // 값은 이 옵션을 넣기 전에 찍었고, J53(decide 32)에서 얼룩 기준 (a)에 '깨끗한 거품·물방울은 얼룩 아님' 한 구절을 더해 다시 찍었다
  // (그 구절만 빼면 옛 값 f23f0500f2fb3fda·a99a82a0cd38083c 그대로 — effect-shot.test.ts가 구절을 본다)
  it('기본 문구는 글자까지 그대로다 — 값은 이 옵션을 넣기 전에 찍었다', () => {
    expect(sha(buildVisionGatePrompt(['solution']))).toBe('8f1e7ab7657ac7aa')
    expect(sha(buildVisionGatePrompt(['solution'], { partsCheck: true, referenceCount: 4 }))).toBe('461a0cb367a411a7')
    expect(buildVisionGatePrompt(['solution'], { stagedCut: false })).toBe(buildVisionGatePrompt(['solution']))
  })

  it('바뀌는 줄은 일관성 하나뿐이다 — 상품 일치·결함 판정은 글자까지 같다', () => {
    const before = buildVisionGatePrompt(['k3_image_0']).split('\n')
    const after = buildVisionGatePrompt(['k3_image_0'], { stagedCut: true }).split('\n')
    expect(after).toHaveLength(before.length)
    const changed = before.flatMap((line, at) => (line === after[at] ? [] : [at]))
    expect(changed).toHaveLength(1)
    expect(before[changed[0]]).toMatch(/^- consistency:/)
    expect(after[changed[0]]).toMatch(/^- consistency:/)
    // 상품 일치는 일관성 점수에도 그대로 남고, 배경 톤과 페이지 스타일만 빠진다
    expect(after[changed[0]]).toContain('product identity')
    expect(after[changed[0]]).not.toContain('background-tone')
    for (const line of [...before.filter((text) => text.startsWith('- same_product')), ...before.filter((text) => text.startsWith('- has_artifact'))]) {
      expect(after).toContain(line)
    }
  })
})

describe('buildVisionGatePrompt — 부품 수 판정(재현 비교 전용)', () => {
  it('기본은 지금 프롬프트 그대로다 — 부품 칸이 없다', () => {
    const prompt = buildVisionGatePrompt(['solution'])
    expect(prompt).not.toContain('parts_match')
    expect(prompt).toBe(buildVisionGatePrompt(['solution'], {}))
    expect(prompt).toBe(buildVisionGatePrompt(['solution'], { partsCheck: false }))
    expect(prompt.endsWith('"consistency": 0.85, "has_artifact": false, "artifact_reason": ""}]')).toBe(true)
  })

  it('원본 여러 장 — 머리말과 부품 판정 안내가 장수를 따른다, 1장이면 지금 글 그대로', () => {
    expect(buildVisionGatePrompt(['a'], { referenceCount: 1 })).toBe(buildVisionGatePrompt(['a']))
    const many = buildVisionGatePrompt(['a'], { partsCheck: true, referenceCount: 4 })
    expect(many).toContain('The FIRST 4 attached images are REFERENCE photos')
    expect(many).not.toContain('The FIRST attached image is')
    expect(many).toContain('Use all reference photos together')
    expect(buildVisionGatePrompt(['a'], { partsCheck: true })).not.toContain('Use all reference photos')
  })

  it('켜면 판정 칸과 응답 예시에 부품 칸이 들어간다', () => {
    const prompt = buildVisionGatePrompt(['solution'], { partsCheck: true })
    expect(prompt).toContain('- parts_match:')
    expect(prompt).toContain('- parts_reason:')
    expect(prompt.endsWith('"artifact_reason": "", "parts_match": true, "parts_reason": ""}]')).toBe(true)
    // 지금 판정 칸은 그대로 있다 — 나란히 재기 위해서
    expect(prompt).toContain('- same_product:')
    expect(prompt).toContain('- has_artifact:')
  })
})

describe('buildVisionGatePrompt — K 라인 배열·크기(실물 크기 11-05)', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
  const size = '지름 50mm 원형'

  it('K 라인 표지가 없으면 치수를 줘도 지금 문구 그대로다 — D 운영 게이트', () => {
    expect(sha(buildVisionGatePrompt(['solution'], { realSize: size }))).toBe('8f1e7ab7657ac7aa')
    expect(buildVisionGatePrompt(['solution'], { lineCut: false, realSize: size })).toBe(buildVisionGatePrompt(['solution']))
    expect(buildVisionGatePrompt(['solution'], { stagedCut: true, realSize: size })).toBe(buildVisionGatePrompt(['solution'], { stagedCut: true }))
  })

  it('K 라인은 상품 일치 줄 하나만 바뀌고, 구멍·통풍구·홈·빗살 배열을 묻는다', () => {
    const before = buildVisionGatePrompt(['k3_image_0']).split('\n')
    const after = buildVisionGatePrompt(['k3_image_0'], { lineCut: true }).split('\n')
    expect(after).toHaveLength(before.length)
    const changed = before.flatMap((line, at) => (line === after[at] ? [] : [at]))
    expect(changed).toHaveLength(1)
    expect(after[changed[0]]).toMatch(/^- same_product:/)
    expect(after[changed[0]]).toContain('the layout of holes, vents, slots or bristles')
    expect(after[changed[0]]).toContain('openings hidden by hands or by the crop are not different')
    expect(after[changed[0]]).toContain('If the product is not visible in the cut, use true.')
    // 치수가 없으면 크기 칸이 없다
    expect(after.join('\n')).not.toContain('size_plausible')
    expect(buildVisionGatePrompt(['k3_image_0'], { lineCut: true, realSize: '   ' })).toBe(after.join('\n'))
  })

  it('K 라인에 치수가 있으면 크기 칸 둘과 응답 예시 칸이 붙는다 — 다른 칸은 그대로다', () => {
    const base = buildVisionGatePrompt(['hero'], { lineCut: true })
    const prompt = buildVisionGatePrompt(['hero'], { lineCut: true, realSize: size })
    expect(prompt).toContain(`- size_plausible: the product's real size is "${size}".`)
    expect(prompt).toContain('false if it looks 1.5 times or more larger or smaller than its real size')
    expect(prompt).toContain('If nothing in the cut gives a size cue, or the product is not visible, use true.')
    // 안쪽 치수는 여는 곳 — 바깥은 두께만큼 크다(오너 메모 11-06 설계 S4, K 판정에만)
    expect(prompt).toContain('An inner size (내측, 안쪽, inner) is the opening only — the outside is larger by the wall')
    expect(base).not.toContain('An inner size')
    expect(prompt).toContain('- size_reason:')
    expect(prompt.endsWith('"artifact_reason": "", "size_plausible": true, "size_reason": ""}]')).toBe(true)
    for (const line of base.split('\n').slice(0, -2)) expect(prompt.split('\n'), line).toContain(line)
    // 부품 칸과 함께 켜도 둘 다 응답 예시에 있다
    expect(buildVisionGatePrompt(['hero'], { lineCut: true, realSize: size, partsCheck: true }).endsWith('"parts_match": true, "parts_reason": "", "size_plausible": true, "size_reason": ""}]')).toBe(true)
  })

  it('치수 글은 한 줄로 펴고 따옴표를 바꾸고 길이를 자른다', () => {
    expect(gateRealSizeOf(' 길이 7.3cm,\n 굵기 3.2cm ')).toBe('길이 7.3cm, 굵기 3.2cm')
    expect(gateRealSizeOf('5" x 3"')).toBe("5' x 3'")
    expect(gateRealSizeOf('x'.repeat(300))).toHaveLength(120)
    for (const empty of [undefined, null, '', '  \n ']) expect(gateRealSizeOf(empty)).toBeNull()
  })
})

describe('게이트 미달 사유 — 크기(실물 크기 11-05)', () => {
  it('크기 칸만 미달이면 scale이고 재생성 지시가 키우지 말라고 한다', () => {
    expect(classifyGateFailure({ same_product: true, artifact_reason: '', size_plausible: false })).toBe('scale')
    const directive = buildRegenDirective({ size_plausible: false })
    expect(directive).toContain('PREVIOUS ATTEMPT FAILED — the product was drawn at the wrong size')
    expect(directive).toContain('move the camera closer instead of enlarging the product')
    expect(applyRegenDirective('prompt', { size_plausible: false })).toBe(`prompt\n\n${directive}`)
  })

  it('다른 사유가 먼저다 — 글자·얼룩·브랜드·구조가 있으면 그 사유', () => {
    expect(classifyGateFailure({ artifact_reason: 'garbled text', size_plausible: false })).toBe('baked_text')
    expect(classifyGateFailure({ artifact_reason: 'brown stain', size_plausible: false })).toBe('stain')
    expect(classifyGateFailure({ artifact_reason: 'real brand logo', size_plausible: false })).toBe('brand')
    expect(classifyGateFailure({ same_product: false, size_plausible: false })).toBe('structure')
  })

  it('크기 칸이 없거나 true면 지금과 같다', () => {
    expect(classifyGateFailure({ same_product: true, artifact_reason: '' })).toBe('consistency')
    expect(classifyGateFailure({ same_product: true, artifact_reason: '', size_plausible: true })).toBe('consistency')
    expect(classifyGateFailure({ same_product: false })).toBe('structure')
    expect(classifyGateFailure(null)).toBe('consistency')
  })
})

describe('점검 고침 1·3 — K 컷 부품·사용 판정', () => {
  it('useCheck를 켜야만 사용 판정 칸이 문구·응답 꼴에 들어가고, 없으면 지금 문구 그대로다', () => {
    const base = buildVisionGatePrompt(['k1'], { lineCut: true, partsCheck: true, referenceCount: 3 })
    const withUse = buildVisionGatePrompt(['k1'], { lineCut: true, partsCheck: true, referenceCount: 3, useCheck: true })
    expect(base).not.toContain('use_correct')
    expect(withUse).toContain('- use_correct:')
    expect(withUse).toContain('worn on the right body part')
    expect(withUse).toContain('"use_correct": true, "use_reason": ""')
    expect(withUse.replace(/- use_correct:[\s\S]*?else empty string\.\n/, '').replace(', "use_correct": true, "use_reason": ""', '')).toBe(base)
  })

  it('부품 미달은 structure, 사용 미달은 use — 재생성 지시에 판정 글 한 줄을 붙이고, 칸이 없으면 지금 지시 그대로', () => {
    expect(classifyGateFailure({ same_product: true, parts_match: false })).toBe('structure')
    expect(classifyGateFailure({ same_product: true, use_correct: false })).toBe('use')
    expect(classifyGateFailure({ same_product: true, parts_match: true, use_correct: true })).toBe('consistency')
    const structure = buildRegenDirective({ same_product: true, parts_match: false, parts_reason: 'two knots\n instead of one' })
    expect(structure).toBe(`${buildRegenDirective({ same_product: false })} Specifically: two knots instead of one.`)
    const use = buildRegenDirective({ same_product: true, use_correct: false, use_reason: 'held upside down' })
    expect(use).toContain('held, used or worn the wrong way')
    expect(use.endsWith('Specifically: held upside down.')).toBe(true)
    // 칸이 없는 D·예전 판정은 글자 그대로
    expect(buildRegenDirective({ same_product: false })).not.toContain('Specifically')
    expect(applyRegenDirective('P', { same_product: true, use_correct: false })).toBe(`P\n\n${buildRegenDirective({ same_product: true, use_correct: false })}`)
  })
})

describe('기대 쓰는 법(usegate, 결정 카드 c08·J19)', () => {
  const USE = 'grip the handle; the bristles face the hair'
  const opts = { lineCut: true, partsCheck: true, referenceCount: 3, useCheck: true }

  it('useCheck와 기대 쓰는 법이 함께 있을 때만 use_correct 기준 바로 뒤에 한 줄 — 없으면 지금 문구 그대로', () => {
    const base = buildVisionGatePrompt(['k1'], opts)
    const withUse = buildVisionGatePrompt(['k1'], { ...opts, expectedUse: USE })
    const line = `- Expected use (read earlier from the reference photos): ${USE} — judge use_correct against this as well; false if the cut contradicts it.\n`
    expect(withUse.split(line)).toHaveLength(2)
    const reasonAt = withUse.indexOf('- use_reason:')
    expect(withUse.indexOf(line)).toBe(reasonAt + withUse.slice(reasonAt).indexOf('\n') + 1)
    expect(withUse.replace(line, '')).toBe(base)
    // useCheck가 없으면(사람·손 컷이 아님) 기대 쓰는 법을 받아도 싣지 않는다 · 빈 글도 그대로
    const noUse = { lineCut: true, partsCheck: true, referenceCount: 3 }
    expect(buildVisionGatePrompt(['k1'], { ...noUse, expectedUse: USE })).toBe(buildVisionGatePrompt(['k1'], noUse))
    expect(buildVisionGatePrompt(['k1'], { ...opts, expectedUse: '  ' })).toBe(base)
    expect(buildVisionGatePrompt(['k1'], { ...opts, expectedUse: null })).toBe(base)
  })

  it('판정에 싣는 글은 한 줄·따옴표 바꿈·200자 — 비면 null', () => {
    expect(gateExpectedUseOf('  hold the "grip"\n  end  ')).toBe("hold the 'grip' end")
    expect(gateExpectedUseOf('x'.repeat(260))).toHaveLength(200)
    expect(gateExpectedUseOf('')).toBeNull()
    expect(gateExpectedUseOf(undefined)).toBeNull()
  })
})
