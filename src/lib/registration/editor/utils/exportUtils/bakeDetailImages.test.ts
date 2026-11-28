import { describe, expect, it } from 'vitest'
import { PAGE_MIN_HEIGHT, toExportHeight } from '@/lib/registration/templatelib/template-types'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import {
  FILE_MAX_BYTES,
  bakeableSections,
  FULL_CHUNK_MAX_PX,
  SLICE_MAX_PX,
  detailFileName,
  drawOpsFor,
  encodeFullParts,
  encodeSpans,
  encodeWithinLimit,
  extOfPart,
  planFullChunks,
  planFullParts,
  planStillCuts,
  planSectionSlices,
  safeProductName,
  splitEven,
  stackSpans,
} from './bakeDetailImages'

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)])

describe('내보내기 폭 — 860 캔버스를 780으로', () => {
  it('높이는 같은 비율로 줄고 반올림한다', () => {
    expect(toExportHeight(860)).toBe(780)
    expect(toExportHeight(2150)).toBe(1950)
    expect(toExportHeight(28718)).toBe(26047)
    expect(toExportHeight(0)).toBe(0)
  })

  it('합격점 860 값을 내보내면 780 값 25,000 이상이다(오너 합격점)', () => {
    expect(toExportHeight(PAGE_MIN_HEIGHT)).toBeGreaterThanOrEqual(25000)
  })
})

describe('splitEven', () => {
  it('상한 이하면 한 조각, 넘으면 고르게 나눈다(합·연속성 유지)', () => {
    expect(splitEven(2999, 3000)).toEqual([{ y: 0, height: 2999 }])
    expect(splitEven(3000, 3000)).toEqual([{ y: 0, height: 3000 }])
    const parts = splitEven(7001, 3000)
    expect(parts.map((p) => p.height)).toEqual([2334, 2334, 2333])
    expect(parts.map((p) => p.y)).toEqual([0, 2334, 4668])
    expect(parts.reduce((s, p) => s + p.height, 0)).toBe(7001)
  })

  it('높이 0은 조각 없음', () => {
    expect(splitEven(0, 3000)).toEqual([])
  })
})

describe('planSectionSlices — 섹션 경계마다 1장, 긴 섹션만 나눈다', () => {
  it('보통 섹션은 섹션당 1장, y는 페이지 기준 누적', () => {
    const slices = planSectionSlices([
      { id: 'a', sectionType: 'main_cut', height: 1200 },
      { id: 'b', sectionType: 'point_div', height: 900 },
    ])
    expect(slices).toEqual([
      { sectionId: 'a', y: 0, height: 1200 },
      { sectionId: 'b', y: 1200, height: 900 },
    ])
  })

  it(`${SLICE_MAX_PX}px보다 긴 섹션만 나눈다`, () => {
    const slices = planSectionSlices([
      { id: 'a', sectionType: 'main_cut', height: 500 },
      { id: 'long', sectionType: 'spec_table', height: 6500 },
    ])
    expect(slices.map((s) => s.sectionId)).toEqual(['a', 'long', 'long', 'long'])
    expect(slices.filter((s) => s.sectionId === 'long').every((s) => s.height <= SLICE_MAX_PX)).toBe(true)
    expect(slices[1].y).toBe(500)
  })

  it('구분선 같은 낮은 섹션은 앞 섹션 이미지에 붙이고(맨 앞이면 다음에) 페이지를 빠짐없이 덮는다', () => {
    const boxes = [
      { id: 'top-divider', sectionType: 'divider', height: 40 },
      { id: 'a', sectionType: 'main_cut', height: 1500 },
      { id: 'd1', sectionType: 'divider', height: 40 },
      { id: 'b', sectionType: 'point_div', height: 2990 },
      { id: 'd2', sectionType: 'divider', height: 40 },
    ]
    const slices = planSectionSlices(boxes)
    // 맨 앞 구분선 40 → a(1500)에, d1 40 → a에, d2 40 → b(2990)에 붙는다. b 묶음 3,030px는 상한을 넘어 1,515px 둘로 나뉜다
    expect(slices).toEqual([
      { sectionId: 'a', y: 0, height: 1580 },
      { sectionId: 'b', y: 1580, height: 1515 },
      { sectionId: 'b', y: 3095, height: 1515 },
    ])
    expect(slices.reduce((s, x) => s + x.height, 0)).toBe(stackSpans(boxes).reduce((s, x) => s + x.height, 0))
    expect(slices.every((s, i) => i === 0 || s.y === slices[i - 1].y + slices[i - 1].height)).toBe(true)
  })

  it('전부 낮은 섹션이면 한 장으로 묶는다', () => {
    expect(
      planSectionSlices([
        { id: 'x', sectionType: 'divider', height: 40 },
        { id: 'y', sectionType: 'divider', height: 64 },
      ])
    ).toEqual([{ sectionId: 'x', y: 0, height: 104 }])
  })
})

describe('bakeableSections — 편집기 캔버스와 같은 "보이는 섹션"', () => {
  it('비표시·구분선·0높이를 빼고 order 순으로 둔다', () => {
    const sec = (id: string, order: number, sectionType: string, height: number, isVisible = true) => ({
      id,
      order,
      sectionType: sectionType as CanvasSection['sectionType'],
      isVisible,
      canvas: { height },
    })
    const out = bakeableSections([
      sec('c', 3, 'point_div', 900),
      sec('a', 1, 'main_cut', 1200),
      sec('d', 2, 'divider', 40),
      sec('h', 4, 'sub_div', 800, false),
      sec('z', 5, 'notice', 0),
      sec('b', 0, 'hook', 5),
    ])
    expect(out.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('stackSpans — 섹션 비트맵 위치(그리기 원본)', () => {
  it('낮은 섹션도 합치지 않고 간격 없이 쌓는다', () => {
    expect(
      stackSpans([
        { id: 'a', sectionType: 'main_cut', height: 100 },
        { id: 'd', sectionType: 'divider', height: 40 },
      ])
    ).toEqual([
      { y: 0, height: 100 },
      { y: 100, height: 40 },
    ])
  })
})

describe('planFullChunks — 전체 한 장, 넘으면 이어 붙는 조각', () => {
  it(`${FULL_CHUNK_MAX_PX}px 이하면 1장`, () => {
    expect(planFullChunks(18181)).toEqual([{ y: 0, height: 18181 }])
  })

  it('넘으면 고른 조각 2개 이상(기준 잡 B Track S 28,892px → 2조각)', () => {
    const chunks = planFullChunks(28892)
    expect(chunks).toEqual([
      { y: 0, height: 14446 },
      { y: 14446, height: 14446 },
    ])
  })
})

describe('drawOpsFor — 조각에 그릴 섹션 영역', () => {
  const sources = [
    { y: 0, height: 1000 },
    { y: 1000, height: 500 },
    { y: 1500, height: 2000 },
  ]

  it('섹션 경계를 걸치는 조각은 여러 섹션에서 잘라 이어 그린다', () => {
    expect(drawOpsFor(sources, { y: 800, height: 1000 })).toEqual([
      { source: 0, sy: 800, dy: 0, height: 200 },
      { source: 1, sy: 0, dy: 200, height: 500 },
      { source: 2, sy: 0, dy: 700, height: 300 },
    ])
  })

  it('겹치지 않는 섹션은 그리지 않는다', () => {
    expect(drawOpsFor(sources, { y: 0, height: 1000 })).toEqual([{ source: 0, sy: 0, dy: 0, height: 1000 }])
  })
})

describe('품질 사다리·조각 늘리기', () => {
  it('상한 안에 드는 첫 품질을 고른다', async () => {
    const sizes: Record<number, number> = { 0.92: 6e6, 0.85: 4e6, 0.78: 3e6 }
    const result = await encodeWithinLimit(async (q) => blobOf(sizes[q]))
    expect(result?.quality).toBe(0.85)
  })

  it('끝까지 넘으면 null', async () => {
    expect(await encodeWithinLimit(async () => blobOf(FILE_MAX_BYTES + 1))).toBeNull()
  })

  it('최저 품질로도 크면 반으로 나눠 다시 굽고 순서·합을 지킨다', async () => {
    // 1px당 400바이트(품질 무관) — 20,000px 조각은 8MB라 5MB를 넘고, 10,000px 조각 둘은 4MB씩
    const encoded = await encodeSpans([{ y: 0, height: 20000 }], async (span) => blobOf(span.height * 400))
    expect(encoded.map((e) => [e.y, e.height])).toEqual([
      [0, 10000],
      [10000, 10000],
    ])
    expect(encoded.every((e) => e.blob.size <= FILE_MAX_BYTES && e.quality === 0.92)).toBe(true)
  })

  it('작은 조각인데도 넘으면 실패를 알린다', async () => {
    await expect(encodeSpans([{ y: 0, height: 500 }], async () => blobOf(FILE_MAX_BYTES * 2))).rejects.toThrow(/MB/)
  })
})

describe('다운로드 파일명 — 순번이 보이게', () => {
  it('상품명 정리(금지 문자·공백·길이)', () => {
    expect(safeProductName('테스트 상품 / 묶음: 20매?')).toBe('테스트-상품-묶음-20매')
    expect(safeProductName('  ')).toBe('product')
    expect(safeProductName(null)).toBe('product')
    expect(safeProductName('가'.repeat(60))).toHaveLength(40)
  })

  it('전체 1장·조각·미리보기·섹션', () => {
    expect(detailFileName('p', 'full', 0, 1)).toBe('p-detail-full.jpg')
    expect(detailFileName('p', 'full', 1, 2)).toBe('p-detail-full-02.jpg')
    expect(detailFileName('p', 'full-preview', 0, 1)).toBe('p-detail-full-preview.jpg')
    expect(detailFileName('p', 'section', 8, 12)).toBe('p-section-09.jpg')
  })
})

describe('planFullParts — GIF 칸(세션 B ③ P4)은 JPEG 조각 사이에 한 칸', () => {
  it('움직임 칸이 없으면 planFullChunks와 같다(조각 수·자리 그대로)', () => {
    for (const total of [0, 1, 18181, 20000, 20001, 28892, 61234]) {
      expect(planFullParts(total, [])).toEqual(planFullChunks(total))
    }
  })

  it('움직임 칸 앞뒤 정지 구간을 따로 조각내고, 칸은 번호를 단다', () => {
    expect(planFullParts(9000, [{ y: 3189, height: 780 }])).toEqual([
      { y: 0, height: 3189 },
      { y: 3189, height: 780, motion: 0 },
      { y: 3969, height: 5031 },
    ])
  })

  it('정지 구간이 상한을 넘으면 그 구간 안에서만 고르게 나눈다(합·연속성 유지)', () => {
    const parts = planFullParts(50000, [{ y: 25000, height: 780 }])
    expect(parts.map((p) => p.height)).toEqual([12500, 12500, 780, 12110, 12110])
    expect(parts.find((p) => p.motion === 0)).toEqual({ y: 25000, height: 780, motion: 0 })
    let y = 0
    for (const p of parts) {
      expect(p.y).toBe(y)
      y += p.height
    }
    expect(y).toBe(50000)
  })

  it('맨 앞·맨 끝 칸은 빈 정지 조각을 만들지 않는다', () => {
    expect(planFullParts(780, [{ y: 0, height: 780 }])).toEqual([{ y: 0, height: 780, motion: 0 }])
    expect(planFullParts(2000, [{ y: 1220, height: 780 }])).toEqual([
      { y: 0, height: 1220 },
      { y: 1220, height: 780, motion: 0 },
    ])
  })

  it('앞 칸과 겹치거나 페이지 밖인 칸은 넣지 않는다', () => {
    expect(planFullParts(3000, [{ y: 100, height: 780 }, { y: 500, height: 780 }]).filter((p) => p.motion !== undefined)).toEqual([
      { y: 100, height: 780, motion: 0 },
    ])
    expect(planFullParts(1000, [{ y: 500, height: 780 }])).toEqual(planFullChunks(1000))
  })
})

describe('전체 이미지 파일 이름 — GIF 칸만 .webp', () => {
  it('확장자를 주지 않으면 지금과 같고(.jpg), WebP 칸은 같은 번호 줄에 .webp', () => {
    expect(detailFileName('p', 'full', 0, 1)).toBe(detailFileName('p', 'full', 0, 1, 'jpg'))
    expect(detailFileName('p', 'full', 2, 4, 'webp')).toBe('p-detail-full-03.webp')
    expect(detailFileName('p', 'section', 2, 4, 'webp')).toBe('p-section-03.jpg')
    expect(extOfPart({ mime: 'image/jpeg' })).toBe('jpg')
    expect(extOfPart({ mime: 'image/webp' })).toBe('webp')
  })
})

describe('encodeFullParts — 전체 이미지 굽기 조립', () => {
  // 조각 높이에 비례한 가짜 JPEG(품질이 낮을수록 작다) — 호출 순서를 적는다
  const fakeEncoder = () => {
    const calls: string[] = []
    const encode = async (span: { y: number; height: number }, q: number) => {
      calls.push(`${span.y}:${span.height}@${q}`)
      return new Blob([new Uint8Array(Math.round(span.height * 300 * q))], { type: 'image/jpeg' })
    }
    return { calls, encode }
  }

  it('움직임 칸이 없으면 지금(encodeSpans(planFullChunks))과 조각·품질·크기·호출 순서가 같고 모두 image/jpeg다', async () => {
    for (const total of [18181, 28892, 61234]) {
      const before = fakeEncoder()
      const old = await encodeSpans(planFullChunks(total), before.encode)
      const after = fakeEncoder()
      const now = await encodeFullParts(total, [], after.encode)
      expect(after.calls).toEqual(before.calls)
      expect(now.map((p) => ({ y: p.y, height: p.height, blob: p.blob, quality: p.quality }))).toEqual(old)
      expect(now.map((p) => p.blob.size)).toEqual(old.map((p) => p.blob.size))
      expect(now.every((p) => p.mime === 'image/jpeg' && p.blob.type === 'image/jpeg')).toBe(true)
    }
  })

  it('경계를 넘기면(AX-CT-36 — 굽기가 stackSpans 경계를 넘기는 길) encodeSpan 이 경계 자리 조각을 받고, 안 넘기면 같은 높이 자리다', async () => {
    const withCuts = fakeEncoder()
    const parts = await encodeFullParts(31_588, [], withCuts.encode, undefined, [2_301, 11_934, 16_100, 24_000])
    expect(parts.map((p) => [p.y, p.height])).toEqual([
      [0, 16_100],
      [16_100, 15_488],
    ])
    expect(withCuts.calls).toEqual(['0:16100@0.92', '16100:15488@0.92'])
    const plain = fakeEncoder()
    await encodeFullParts(31_588, [], plain.encode)
    expect(plain.calls).toEqual(['0:15794@0.92', '15794:15794@0.92'])
  })

  it('움직임 칸 자리에는 받은 WebP를 그대로 넣고 그 자리는 굽지 않는다', async () => {
    const webp = new Blob([new Uint8Array(250_000)], { type: 'image/webp' })
    const { calls, encode } = fakeEncoder()
    const parts = await encodeFullParts(9000, [{ y: 3189, height: 780, blob: webp }], encode)
    expect(parts.map((p) => [p.y, p.height, p.mime])).toEqual([
      [0, 3189, 'image/jpeg'],
      [3189, 780, 'image/webp'],
      [3969, 5031, 'image/jpeg'],
    ])
    expect(parts[1].blob).toBe(webp)
    expect(parts[1].quality).toBeNull()
    expect(calls.some((c) => c.startsWith('3189:'))).toBe(false)
  })
})

describe('planStillCuts — 자르는 자리를 섹션 경계로(AX-CT-36)', () => {
  const contiguous = (spans: Array<{ y: number; height: number }>, start: number, end: number) => {
    expect(spans[0].y).toBe(start)
    for (let i = 1; i < spans.length; i++) expect(spans[i].y).toBe(spans[i - 1].y + spans[i - 1].height)
    expect(spans.at(-1)!.y + spans.at(-1)!.height).toBe(end)
  }

  it('경계를 안 주면(또는 구간 안에 없으면) splitEven 그대로 — 지금 굽기와 같은 조각', () => {
    for (const total of [0, 1, 19_999, 20_000, 20_001, 31_588, 61_234]) {
      const even = splitEven(total, 20_000)
      expect(planStillCuts(0, total, [], 20_000)).toEqual(even)
      expect(planStillCuts(0, total, [0, total, total + 50], 20_000)).toEqual(even)
    }
    expect(planFullParts(31_588, [], 20_000, [])).toEqual(planFullChunks(31_588))
  })

  it('한 조각이면 경계가 있어도 그대로 한 장', () => {
    expect(planStillCuts(0, 18_000, [5_000, 9_000], 20_000)).toEqual([{ y: 0, height: 18_000 }])
  })

  it('같은 높이 자리(15,794)에서 가장 가까운 섹션 경계에서 자른다 — 11-19 구디백 꼴(31,588px 2조각)', () => {
    const spans = planStillCuts(0, 31_588, [2_301, 11_934, 15_200, 16_100, 24_000], 20_000)
    expect(spans).toEqual([
      { y: 0, height: 16_100 },
      { y: 16_100, height: 15_488 },
    ])
    contiguous(spans, 0, 31_588)
  })

  it('조각 상한을 넘기는 경계는 고르지 않는다 — 맞는 경계가 없으면 같은 높이 자리', () => {
    // 경계 9,000 은 둘째 조각이 22,588(>20,000)이 되어 못 고름, 22,000 은 첫 조각이 22,000 이라 못 고름
    expect(planStillCuts(0, 31_588, [9_000, 22_000], 20_000)).toEqual(splitEven(31_588, 20_000))
  })

  it('세 조각 이상도 이어지고 모두 상한 안이며, 조각 수는 splitEven과 같다', () => {
    const boundaries = Array.from({ length: 40 }, (_, i) => 1_000 + i * 1_437)
    const spans = planStillCuts(0, 55_000, boundaries, 20_000)
    expect(spans).toHaveLength(splitEven(55_000, 20_000).length)
    contiguous(spans, 0, 55_000)
    for (const s of spans) expect(s.height).toBeLessThanOrEqual(20_000)
    for (const s of spans.slice(1)) expect(boundaries).toContain(s.y)
  })

  it('움직이는 칸 사이 정지 구간에도 적용되고, 움직이는 칸 자리는 그대로다(같은 높이 자리 28,020 에 더 가까운 30,000)', () => {
    const parts = planFullParts(45_000, [{ y: 10_000, height: 1_040 }], 20_000, [4_000, 25_500, 30_000])
    expect(parts[0]).toEqual({ y: 0, height: 10_000 })
    expect(parts[1]).toEqual({ y: 10_000, height: 1_040, motion: 0 })
    expect(parts.slice(2)).toEqual([
      { y: 11_040, height: 18_960 },
      { y: 30_000, height: 15_000 },
    ])
  })
})
