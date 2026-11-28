import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// captureToBlob(U1b) — 라이브러리 글꼴 임베드를 끄고, 쓰인 글꼴 CSS를 onclone에서 복제 루트에 <style>로 넣는지
const toBlob = vi.fn()
vi.mock('dom-to-image-more', () => ({ default: { toBlob: (...args: unknown[]) => toBlob(...args) } }))
vi.mock('@/components/features/registration/editor/ui/Toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/components/features/registration/editor/ui/ConfirmDialog', () => ({ confirmDialog: vi.fn() }))
const embeddedFontCss = vi.fn()
vi.mock('./fontEmbed', () => ({ embeddedFontCss: (...args: unknown[]) => embeddedFontCss(...args) }))

const { captureToBlob, captureExportBitmap, captureSectionsAsBlob } = await import('./capture')

type FakeNode = { tag: string; textContent: string; children: FakeNode[]; appendChild: (c: FakeNode) => void }
const fakeNode = (tag: string): FakeNode => {
  const node: FakeNode = { tag, textContent: '', children: [], appendChild: (c) => void node.children.push(c) }
  return node
}

/** 라이브러리 흉내: 받은 옵션을 기록하고 복제 루트로 onclone을 부른다 */
function runLibrary() {
  const clone = fakeNode('div')
  toBlob.mockImplementation(async (_node: unknown, options: { onclone?: (c: unknown) => unknown }) => {
    await options.onclone?.(clone)
    return new Blob(['png'])
  })
  return clone
}

describe('captureExportBitmap — 860을 찍어 780으로 줄인다', () => {
  const resize = vi.fn()
  beforeEach(() => {
    toBlob.mockReset()
    embeddedFontCss.mockReset()
    embeddedFontCss.mockResolvedValue('')
    resize.mockReset()
    resize.mockResolvedValue({ close: vi.fn() })
    vi.stubGlobal('createImageBitmap', resize)
    runLibrary()
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['기본', 1, 2, 780, 1950],
    ['2×', 2, 2, 1560, 3900],
    ['3×', 3, 3, 2340, 5850],
  ])('%s — 찍는 배율과 줄인 크기', async (_name, scale, shot, width, height) => {
    const node = { offsetHeight: 2150 } as unknown as HTMLElement
    await captureExportBitmap(node, { scale: scale as number, bgcolor: '#fff' })
    const options = toBlob.mock.calls[0][1] as { width: number; height: number; scale: number; bgcolor: string }
    expect(options).toMatchObject({ width: 860, height: 2150, scale: shot, bgcolor: '#fff' })
    expect(resize.mock.calls[0][1]).toEqual({ resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
  })
})

describe('captureSectionsAsBlob — 섹션을 하나씩 찍어 잇는다', () => {
  const canvases: Array<{ width: number; height: number }> = []
  const section = (height: number, backgroundColor = '') => ({ offsetHeight: height, style: { backgroundColor } }) as unknown as HTMLElement
  const scaleOf = (call: number) => (toBlob.mock.calls[call][1] as { scale: number }).scale
  const bgcolorOf = (call: number) => (toBlob.mock.calls[call][1] as { bgcolor?: string }).bgcolor

  beforeEach(() => {
    canvases.length = 0
    toBlob.mockReset()
    embeddedFontCss.mockReset()
    embeddedFontCss.mockResolvedValue('')
    runLibrary()
    vi.stubGlobal('createImageBitmap', vi.fn(async (_blob: Blob, options?: { resizeWidth: number; resizeHeight: number }) => ({ width: options?.resizeWidth ?? 780, height: options?.resizeHeight ?? 100, close: vi.fn() })))
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (b: Blob) => void) => done(new Blob(['png'])) }
        canvases.push(canvas)
        return canvas
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('섹션 자기 바탕을 먼저 쓴다 — 흰색으로 덮으면 짙은 섹션의 흰 글자가 사라진다', async () => {
    await captureSectionsAsBlob([section(860, 'rgb(44, 40, 37)'), section(860)], '#ffffff', 1)
    expect(bgcolorOf(0)).toBe('rgb(44, 40, 37)')
    expect(bgcolorOf(1)).toBe('#ffffff')
  })

  it('이은 한 장은 780 폭이다', async () => {
    await captureSectionsAsBlob([section(860), section(860)], '#ffffff', 1)
    expect(canvases.at(-1)?.width).toBe(780)
  })

  it('이어 붙일 높이가 캔버스 한도를 넘으면 배율을 낮추고, 1배 아래로는 내리지 않는다', async () => {
    await captureSectionsAsBlob([section(10_000)], undefined, 4)
    // 780 값 9,070 × 3 = 27,210 ≤ 32,767, × 4는 넘는다
    expect(scaleOf(0)).toBe(3)
    expect(canvases.at(-1)?.width).toBe(780 * 3)
    toBlob.mockClear()
    await captureSectionsAsBlob([section(40_000)], undefined, 2)
    expect(scaleOf(0)).toBe(2)
    expect(canvases.at(-1)?.width).toBe(780)
  })
})

describe('captureToBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: (tag: string) => fakeNode(tag) })
    toBlob.mockReset()
    embeddedFontCss.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('라이브러리 임베드를 끄고 노드에 쓰인 글꼴 CSS를 복제 루트에 넣는다', async () => {
    embeddedFontCss.mockResolvedValue('@font-face { font-family: X; }')
    const clone = runLibrary()
    const node = {} as HTMLElement
    await captureToBlob(node, { width: 860, height: 100, bgcolor: '#fff' })
    expect(embeddedFontCss).toHaveBeenCalledWith(node)
    expect(toBlob.mock.calls[0][1]).toMatchObject({ width: 860, height: 100, bgcolor: '#fff', disableEmbedFonts: true })
    expect(clone.children).toHaveLength(1)
    expect(clone.children[0]).toMatchObject({ tag: 'style', textContent: '@font-face { font-family: X; }' })
  })

  it('넘겨받은 fontCss는 다시 만들지 않는다(빈 문자열 포함) — 비어 있으면 <style>을 넣지 않는다', async () => {
    const clone = runLibrary()
    await captureToBlob({} as HTMLElement, {}, '')
    expect(embeddedFontCss).not.toHaveBeenCalled()
    expect(clone.children).toHaveLength(0)
  })

  it('호출 측 onclone도 부른다', async () => {
    const clone = runLibrary()
    const onclone = vi.fn()
    await captureToBlob({} as HTMLElement, { onclone }, 'css')
    expect(onclone).toHaveBeenCalledWith(clone)
    expect(clone.children).toHaveLength(1)
  })
})
