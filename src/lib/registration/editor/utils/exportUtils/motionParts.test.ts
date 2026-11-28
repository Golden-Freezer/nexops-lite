import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { MOTION_ENCODE } from '@/lib/registration/motion/encode'
import { FILE_MAX_BYTES, MOTION_PAGE_MAX_BYTES } from './detailImageLimits'
import { collectMotionParts, COVERED_REASON, isWebpHeader, motionSlotOf, overMotionBudget, previewMotionSrcs, type MotionClips } from './motionParts'

const POSTER = 'https://store/poster.jpg'
const WEBP = 'https://store/motion.webp'
const CLIPS: MotionClips = { [POSTER]: { webpUrl: WEBP, width: 780, height: 780, bytes: 250_000 } }

function photo(over: Partial<CanvasElement['transform']> = {}, props: Record<string, unknown> = {}, el: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: `p-${Math.random()}`,
    type: 'framed-image',
    name: 'designcut-scene',
    transform: { x: 0, y: 200, width: 860, height: 860, rotation: 0, ...over },
    zIndex: 2,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    framedImageProps: {
      src: POSTER,
      alt: 'designcut-scene',
      frameId: 'designcut',
      clipPath: 'none',
      viewBox: '0 0 100 100',
      bgColor: '#FFFFFF',
      objectFit: 'cover',
      imageType: 'designcut_product',
      isUserUploaded: false,
      ...props,
    } as CanvasElement['framedImageProps'],
    ...el,
  }
}

function text(y: number, zIndex = 1): CanvasElement {
  return {
    id: `t-${y}`,
    type: 'text',
    name: 'motion',
    transform: { x: 80, y, width: 700, height: 40, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
  }
}

function section(elements: CanvasElement[], height = 1130, id = 's1'): CanvasSection {
  return {
    id,
    sectionType: 'sub2_div_page' as CanvasSection['sectionType'],
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'k',
    canvas: { width: 860, height, backgroundColor: '#fff' },
    elements,
  }
}

const webpBlob = (size = 1000) => {
  const bytes = new Uint8Array(size)
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  return new Blob([bytes], { type: 'application/octet-stream' })
}

describe('motionSlotOf — 포스터 자리를 WebP로 바꿔 넣어도 같은지', () => {
  it('motion_band(동작 한 줄 + 풀폭 1:1 띠)는 780 폭 비트맵 안 자리를 돌려준다', () => {
    // caption-top: 위 120 + 글 40 + 간격 48 → 사진 y 208, 860×860
    const r = motionSlotOf(section([text(120), photo({ y: 208 })]), CLIPS, 1025)
    expect(r).toEqual({ slot: { top: 189, height: 780, clip: CLIPS[POSTER] } })
  })

  it('포스터가 motion_clips에 없는 섹션은 null(지금 그대로)', () => {
    expect(motionSlotOf(section([photo({}, { src: 'https://store/other.jpg' })]), CLIPS, 1025)).toBeNull()
    expect(motionSlotOf(section([text(120)]), CLIPS, 1025)).toBeNull()
    expect(motionSlotOf(section([photo()]), {}, 1025)).toBeNull()
    // 프로토타입 키는 칸으로 보지 않는다
    expect(motionSlotOf(section([photo({}, { src: 'constructor' })]), CLIPS, 1025)).toBeNull()
  })

  it('숨긴 사진은 보지 않는다', () => {
    expect(motionSlotOf(section([photo({}, {}, { isVisible: false })]), CLIPS, 1025)).toBeNull()
  })

  it.each([
    ['풀폭이 아닌 사진', photo({ x: 80, width: 700, height: 700 })],
    ['사진 비율이 움직이는 칸과 다름', photo({ height: 600 })],
    ['돌린 사진', photo({ rotation: 3 })],
    ['투명도를 바꾼 사진', photo({}, {}, { opacity: 0.8 })],
    ['잘라 낸 사진', photo({}, { cropRect: { x: 0, y: 0, width: 80, height: 80 } })],
    ['모서리·테두리가 있는 사진', photo({}, { clipPath: 'inset(0 round 24px)' })],
    ['모서리·테두리가 있는 사진', photo({}, { frameId: 'circle' })],
    ['모서리·테두리가 있는 사진', photo({}, { borderWidth: 2 })],
    ['섹션 밖으로 나간 사진', photo({ y: 400 })],
  ])('%s는 넣지 않고 이유를 남긴다', (reason, el) => {
    expect(motionSlotOf(section([el]), CLIPS, 1025)).toEqual({ skip: reason })
  })

  it('사진 위에 얹은 요소가 있으면 넣지 않는다(밑에 깔린 요소는 괜찮다)', () => {
    expect(motionSlotOf(section([photo(), text(500, 3)]), CLIPS, 1025)).toEqual({ skip: '사진 위에 얹은 요소가 있음' })
    expect(motionSlotOf(section([photo(), text(500, 1)]), CLIPS, 1025)).toMatchObject({ slot: { height: 780 } })
  })

  it('사진 요소(type image)도 같은 규칙 — 모서리가 있으면 뺀다', () => {
    const img: CanvasElement = {
      ...photo(),
      type: 'image',
      framedImageProps: undefined,
      imageProps: { src: POSTER, alt: '', objectFit: 'cover', imageType: 'x', isUserUploaded: false },
    }
    expect(motionSlotOf(section([img]), CLIPS, 1025)).toMatchObject({ slot: { top: 181, height: 780 } })
    const rounded = { ...img, imageProps: { ...img.imageProps!, borderRadii: [8, 8, 0, 0] as [number, number, number, number] } }
    expect(motionSlotOf(section([rounded]), CLIPS, 1025)).toEqual({ skip: '모서리가 있는 사진' })
  })

  it('비트맵 높이를 넘는 자리는 넣지 않는다', () => {
    expect(motionSlotOf(section([photo({ y: 208 })]), CLIPS, 900)).toEqual({ skip: '섹션 밖으로 나간 사진' })
  })
})

describe('previewMotionSrcs — 편집기 미리보기 재생 칸(결정 카드 c30)', () => {
  it('내보내기가 WebP로 바꿔 넣는 칸만 사진 요소 id → WebP 주소로 돌려준다', () => {
    const ok = photo({ y: 208 }, {}, { id: 'ok' })
    expect(previewMotionSrcs([section([text(120), ok])], CLIPS)).toEqual({ ok: WEBP })
  })

  it('사진 위 글로 막힌 칸(첫 칸 글 굽기 후보)도 넣는다 — 글 요소는 미리보기에서 사진 위에 그대로 얹힌다', () => {
    const covered = photo({ y: 0 }, {}, { id: 'hero' })
    const s = section([covered, text(80, 5)], 860)
    expect(motionSlotOf(s, CLIPS, 780)).toEqual({ skip: COVERED_REASON })
    expect(previewMotionSrcs([s], CLIPS)).toEqual({ hero: WEBP })
  })

  it('바꿔 넣지 못하는 칸(잘림·풀폭 아님·비율 다름)·숨긴 섹션·구분선·클립 없음은 포스터 그대로라 넣지 않는다', () => {
    const cropped = section([photo({ y: 0 }, { cropRect: { x: 0, y: 0, width: 50, height: 50 } }, { id: 'c' })], 860, 'a')
    const narrow = section([photo({ x: 60, width: 740, height: 740 }, {}, { id: 'n' })], 1130, 'b')
    const tall = section([photo({ y: 0, height: 1000 }, {}, { id: 't' })], 1130, 'c')
    const hidden = { ...section([photo({ y: 0 }, {}, { id: 'h' })], 860, 'd'), isVisible: false }
    const divider = { ...section([photo({ y: 0 }, {}, { id: 'v' })], 860, 'e'), sectionType: 'divider' as CanvasSection['sectionType'] }
    expect(previewMotionSrcs([cropped, narrow, tall, hidden, divider], CLIPS)).toEqual({})
    expect(previewMotionSrcs([section([photo({ y: 0 }, {}, { id: 'x' })], 860)], {})).toEqual({})
  })
})

describe('overMotionBudget · isWebpHeader', () => {
  it('페이지 합 예산은 motion/encode.ts와 같은 값이고, 넘으면 뒤 칸부터 뺀다', () => {
    expect(MOTION_PAGE_MAX_BYTES).toBe(MOTION_ENCODE.pageMaxBytes)
    expect(overMotionBudget([700 * 1024, 700 * 1024])).toEqual([])
    expect(overMotionBudget([700 * 1024, 700 * 1024, 10])).toEqual([])
    // 페이지 3MB(J55) — 0.9MB 대표 칸 + 고른 칸 둘(2.3MB)은 남고, 3MB를 넘으면 맨 뒤부터, 맨 위 대표 칸은 남는다
    expect(overMotionBudget([900 * 1024, 700 * 1024, 700 * 1024])).toEqual([])
    expect(overMotionBudget([900 * 1024, 1500 * 1024, 700 * 1024])).toEqual([2])
    expect(overMotionBudget([1600 * 1024, 1600 * 1024])).toEqual([1])
    expect(overMotionBudget([])).toEqual([])
  })

  it('RIFF····WEBP 머리만 WebP로 본다', async () => {
    expect(isWebpHeader(new Uint8Array(await webpBlob(20).slice(0, 12).arrayBuffer()))).toBe(true)
    expect(isWebpHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false)
    expect(isWebpHeader(new Uint8Array(4))).toBe(false)
  })
})

describe('collectMotionParts — 받기·검사·예산', () => {
  const pages = [section([text(120), photo({ y: 208 })], 1130, 'm'), section([text(100)], 600, 'n')]
  const sources = [
    { y: 3000, height: 1025 },
    { y: 4025, height: 544 },
  ]

  it('움직임 칸은 페이지 기준 자리와 image/webp 파일로 돌려준다', async () => {
    const asked: string[] = []
    const r = await collectMotionParts(pages, sources, CLIPS, async (url) => (asked.push(url), webpBlob()))
    expect(asked).toEqual([WEBP])
    expect(r.notes).toEqual([])
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0]).toMatchObject({ y: 3189, height: 780 })
    expect(r.parts[0].blob.type).toBe('image/webp')
    expect(r.parts[0].blob.size).toBe(1000)
  })

  it('motion_clips가 비면 아무것도 받지 않는다', async () => {
    const r = await collectMotionParts(pages, sources, {}, async () => {
      throw new Error('받으면 안 됨')
    })
    expect(r).toEqual({ parts: [], notes: [] })
  })

  it.each([
    ['받기 실패', async () => Promise.reject(new Error('HTTP 404')), 'HTTP 404'],
    ['WebP가 아닌 파일', async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])]), 'WebP가 아님'],
    ['파일 상한 초과', async () => webpBlob(FILE_MAX_BYTES + 1), 'MB를 넘음'],
  ])('%s면 그 칸은 포스터 JPEG로 두고 이유를 남긴다', async (_label, fetchBlob, reason) => {
    const r = await collectMotionParts(pages, sources, CLIPS, fetchBlob)
    expect(r.parts).toEqual([])
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toContain('1번째 섹션')
    expect(r.notes[0]).toContain(reason)
  })

  it('자리를 못 맞춘 칸은 받지 않고 이유를 남긴다', async () => {
    const r = await collectMotionParts([section([photo({ height: 600 })])], [{ y: 0, height: 1025 }], CLIPS, async () => {
      throw new Error('받으면 안 됨')
    })
    expect(r).toEqual({ parts: [], notes: ['1번째 섹션: 사진 비율이 움직이는 칸과 다름'] })
  })

  it('motion_clips에 있는데 보이는 사진 어디에도 그 포스터가 없으면 받지 않고 이유를 남긴다 — 다른 사진·숨긴 사진·구운 자리 없는 섹션', async () => {
    const never = async (): Promise<Blob> => {
      throw new Error('받으면 안 됨')
    }
    const NOTE = '움직이는 칸 1개: 포스터와 같은 사진이 페이지에 없음(poster.jpg)'
    const other = await collectMotionParts([section([text(120), photo({ y: 208 }, { src: 'https://store/still.jpg' })])], [{ y: 0, height: 1025 }], CLIPS, never)
    expect(other).toEqual({ parts: [], notes: [NOTE] })
    const hidden = await collectMotionParts([section([photo({}, {}, { isVisible: false })])], [{ y: 0, height: 1025 }], CLIPS, never)
    expect(hidden).toEqual({ parts: [], notes: [NOTE] })
    const uncaptured = await collectMotionParts([section([text(100)]), section([photo()])], [{ y: 0, height: 544 }], CLIPS, never)
    expect(uncaptured).toEqual({ parts: [], notes: [NOTE] })
    const query = await collectMotionParts([section([text(100)])], [{ y: 0, height: 544 }], { 'https://store/a/k17_clip_0-poster.jpg?v=1': CLIPS[POSTER] }, never)
    expect(query.notes).toEqual(['움직이는 칸 1개: 포스터와 같은 사진이 페이지에 없음(k17_clip_0-poster.jpg)'])
  })

  it('찾지 못한 칸의 이유 줄은 기록만 더한다 — 찾은 칸의 자리·받은 WebP 바이트는 그대로(굽기 결과 같음)', async () => {
    const fetchBlob = async () => webpBlob(1234)
    const before = await collectMotionParts(pages, sources, CLIPS, fetchBlob)
    const withMissing = await collectMotionParts(pages, sources, { ...CLIPS, 'https://store/gone.jpg': CLIPS[POSTER] }, fetchBlob)
    const bytesOf = async (r: typeof before) =>
      Promise.all(r.parts.map(async (p) => ({ y: p.y, height: p.height, type: p.blob.type, bytes: Array.from(new Uint8Array(await p.blob.arrayBuffer())) })))
    expect(await bytesOf(withMissing)).toEqual(await bytesOf(before))
    expect(before.notes).toEqual([])
    expect(withMissing.notes).toEqual(['움직이는 칸 1개: 포스터와 같은 사진이 페이지에 없음(gone.jpg)'])
  })

  it('페이지 합 예산을 넘으면 뒤 칸을 뺀다', async () => {
    const two = [section([photo()], 1130, 'a'), section([photo()], 1130, 'b')]
    const r = await collectMotionParts(two, [{ y: 0, height: 1025 }, { y: 1025, height: 1025 }], CLIPS, async () => webpBlob(1600 * 1024))
    expect(r.parts.map((p) => p.y)).toEqual([181])
    expect(r.notes).toEqual(['2번째 섹션: 페이지 움직임 합 3000KB를 넘음'])
  })
})

describe('첫 칸 글 굽기 — 사진 위 글로만 막힌 칸', () => {
  const covered = () => {
    const p = photo({ y: 208 })
    return { p, sec: section([text(120), p, text(500, 3)]) }
  }

  it('allowCovered면 그 칸을 cover(사진 요소 id)와 함께 돌려주고, 아니면 지금처럼 건너뛴다', () => {
    const { p, sec } = covered()
    expect(motionSlotOf(sec, CLIPS, 1025)).toEqual({ skip: COVERED_REASON })
    expect(motionSlotOf(sec, CLIPS, 1025, { allowCovered: true })).toEqual({ slot: { top: 189, height: 780, clip: CLIPS[POSTER] }, cover: { photoId: p.id } })
  })

  it('다른 까닭은 allowCovered여도 지금처럼 건너뛰고, 안 막힌 칸에는 cover가 없다', () => {
    expect(motionSlotOf(section([photo({ rotation: 3 }), text(500, 3)]), CLIPS, 1025, { allowCovered: true })).toEqual({ skip: '돌린 사진' })
    expect(motionSlotOf(section([photo({ y: 208 }), text(500, 3)]), CLIPS, 900, { allowCovered: true })).toEqual({ skip: '섹션 밖으로 나간 사진' })
    expect(motionSlotOf(section([text(120), photo({ y: 208 })]), CLIPS, 1025, { allowCovered: true })).toEqual({ slot: { top: 189, height: 780, clip: CLIPS[POSTER] } })
  })

  it('bakeText가 구운 WebP를 돌려주면 그 칸은 받지 않고 구운 파일을 쓴다(자리·검사 그대로)', async () => {
    const { p, sec } = covered()
    const asked: string[] = []
    const calls: Array<{ index: number; photoId: string; top: number }> = []
    const r = await collectMotionParts([section([text(100)], 600, 'n'), sec], [{ y: 0, height: 544 }, { y: 544, height: 1025 }], CLIPS, async (url) => (asked.push(url), webpBlob()), {
      bakeText: async ({ index, slot, photoId }) => (calls.push({ index, photoId, top: slot.top }), webpBlob(4321)),
    })
    expect(asked).toEqual([])
    expect(calls).toEqual([{ index: 1, photoId: p.id, top: 189 }])
    expect(r.notes).toEqual([])
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0]).toMatchObject({ y: 733, height: 780 })
    expect(r.parts[0].blob.size).toBe(4321)
    expect(r.parts[0].blob.type).toBe('image/webp')
  })

  it('못 구우면 그 칸은 포스터 JPEG로 두고 까닭을 남긴다 — 구운 파일도 WebP 머리 검사를 받는다', async () => {
    const { sec } = covered()
    const never = async (): Promise<Blob> => {
      throw new Error('받으면 안 됨')
    }
    const skipped = await collectMotionParts([sec], [{ y: 0, height: 1025 }], CLIPS, never, { bakeText: async () => ({ skip: '첫 프레임이 정지 칸과 다름' }) })
    expect(skipped).toEqual({ parts: [], notes: ['1번째 섹션: 움직이는 WebP를 쓰지 못함(사진 위 글을 굽지 못함: 첫 프레임이 정지 칸과 다름)'] })
    const notWebp = await collectMotionParts([sec], [{ y: 0, height: 1025 }], CLIPS, never, { bakeText: async () => new Blob([new Uint8Array(16)]) })
    expect(notWebp.notes).toEqual(['1번째 섹션: 움직이는 WebP를 쓰지 못함(WebP가 아님)'])
  })

  it('bakeText가 없으면 막힌 칸은 지금과 같은 이유 줄이고, 안 막힌 칸은 지금처럼 받는다', async () => {
    const { sec } = covered()
    const r = await collectMotionParts([sec], [{ y: 0, height: 1025 }], CLIPS, async () => webpBlob())
    expect(r).toEqual({ parts: [], notes: ['1번째 섹션: 사진 위에 얹은 요소가 있음'] })
    const plain = await collectMotionParts([section([text(120), photo({ y: 208 })])], [{ y: 0, height: 1025 }], CLIPS, async () => webpBlob(), {
      bakeText: async () => {
        throw new Error('부르면 안 됨')
      },
    })
    expect(plain.notes).toEqual([])
    expect(plain.parts).toHaveLength(1)
  })
})
