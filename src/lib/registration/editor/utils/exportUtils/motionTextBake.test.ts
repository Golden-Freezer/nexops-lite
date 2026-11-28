import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { bytesToBase64, hiddenLayerIndices, layersMatch, paintOrderOf, readMotionBakeResponse, requestMotionBake } from './motionTextBake'

function el(id: string, zIndex: number, isVisible = true): CanvasElement {
  return {
    id,
    type: 'text',
    name: id,
    transform: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible,
    opacity: 1,
  }
}

function section(elements: CanvasElement[]): CanvasSection {
  return {
    id: 's1',
    sectionType: 'sub2_div_page' as CanvasSection['sectionType'],
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'k',
    canvas: { width: 860, height: 1130, backgroundColor: '#fff' },
    elements,
  }
}

// 기록 순서: 제목(z3) · 바탕 도형(z0) · 사진(z2) · 숨긴 글(z5) · 사진과 같은 z로 뒤에 놓인 띠(z2)
const SEC = section([el('title', 3), el('bg', 0), el('photo', 2), el('hidden', 5, false), el('band', 2)])

describe('그리기 순서·숨길 층 — CanvasSection.tsx와 같은 순서', () => {
  it('보이는 요소만 zIndex 오름차순, 같으면 원래 순서', () => {
    expect(paintOrderOf(SEC).map((e) => e.id)).toEqual(['bg', 'photo', 'band', 'title'])
  })

  it('사진과 그 밑(먼저 그려진 것)만 숨기고, 위에 얹힌 띠·제목은 글 층에 남긴다', () => {
    expect(hiddenLayerIndices(SEC, 'photo')).toEqual([0, 1])
    expect(hiddenLayerIndices(SEC, 'nope')).toBeNull()
  })

  it('복제본 층 zIndex가 하나씩 맞을 때만 찍는다 — 개수·값이 다르면 굽지 않는다', () => {
    expect(layersMatch(['0', '2', '2', '3'], SEC)).toBe(true)
    expect(layersMatch(['0', '2', '3'], SEC)).toBe(false)
    expect(layersMatch(['0', '2', '2', '9999'], SEC)).toBe(false)
  })
})

describe('보내기·응답', () => {
  it('base64는 Buffer와 같다(큰 배열도)', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })

  it('image/webp 응답은 구운 파일, 그 밖은 까닭(skip·error·HTTP)', async () => {
    const webp = await readMotionBakeResponse(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }))
    expect(webp).toBeInstanceOf(Blob)
    expect((webp as Blob).size).toBe(3)
    expect(await readMotionBakeResponse(Response.json({ skip: '예산 넘음' }))).toEqual({ skip: '예산 넘음' })
    expect(await readMotionBakeResponse(Response.json({ error: '이 잡의 움직이는 칸이 아닙니다.' }, { status: 400 }))).toEqual({ skip: '이 잡의 움직이는 칸이 아닙니다.' })
    expect(await readMotionBakeResponse(new Response('x', { status: 502 }))).toEqual({ skip: 'HTTP 502' })
  })

  it('요청은 그 잡의 motion-bake로 webpUrl·글 층·정지 칸(base64)을 보내고, 받기 실패도 던지지 않는다', async () => {
    const sent: Array<{ url: string; body: Record<string, string> }> = []
    const fake = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) })
      return Response.json({ skip: '첫 프레임이 정지 칸과 다름' })
    }) as typeof fetch
    const r = await requestMotionBake('job 1', { webpUrl: 'https://store/m.webp', overlay: new Blob([new Uint8Array([7])]), still: new Blob([new Uint8Array([8, 9])]) }, fake)
    expect(r).toEqual({ skip: '첫 프레임이 정지 칸과 다름' })
    expect(sent).toEqual([{ url: '/api/registration/pdp/job%201/motion-bake', body: { webpUrl: 'https://store/m.webp', overlay: 'Bw==', still: 'CAk=' } }])
    const broken = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    expect(await requestMotionBake('j', { webpUrl: 'u', overlay: new Blob([]), still: new Blob([]) }, broken)).toEqual({ skip: '굽기 요청 실패(network down)' })
  })
})
