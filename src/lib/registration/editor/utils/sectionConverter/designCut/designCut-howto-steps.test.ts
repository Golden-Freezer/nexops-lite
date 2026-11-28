/**
 * D2 ① T5 단계 사진 — 만들어 두고 위 사진 한 장만 쓰던 사용 컷(howto:0~2)을 단계마다 그 단계 글 아래에 둔다.
 * 사용 컷 howto:j는 카피 howTo[j]로 만들어지므로 계획 단계 제목이 카피 단계 제목과 같을 때만 잇는다. 맞는 컷이 2장 미만이면 지금 렌더.
 */
import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { designCutJobB } from './designCut.fixture'
import { stepImagesOf } from './templatesInfo'

const urls: Record<string, string> = { 'howto:0': 'h0.png', 'howto:1': 'h1.png', 'howto:2': 'h2.png' }
const image = (key: string) => urls[key] ?? null
const steps = (...titles: string[]) => titles.map((title) => ({ title }))

describe('stepImagesOf — 계획 단계 ↔ 사용 컷 howto:j', () => {
  it('제목이 같은 카피 단계의 컷을 준다 — 4단계·컷 3장이면 4번째는 글만', () => {
    expect(stepImagesOf(steps('가', '나', '다', '라'), ['가', '나', '다', '라'], image)).toEqual(['h0.png', 'h1.png', 'h2.png', null])
  })

  it('계획이 제목 없는 카피 단계를 걸러 번호가 밀려도 제목으로 맞춘다(공백·대소문자 무시)', () => {
    expect(stepImagesOf(steps('나 단계', 'Da'), [null, '나단계', 'da'], image)).toEqual(['h1.png', 'h2.png'])
  })

  it('같은 제목이 둘이면 컷은 한 단계에만 준다', () => {
    expect(stepImagesOf(steps('가', '가', '나'), ['가', '가', '나'], image)).toEqual(['h0.png', 'h1.png', 'h2.png'])
    expect(stepImagesOf(steps('가', '가'), ['가', '나'], image)).toBeNull()
  })

  it('맞는 컷이 2장 미만이거나 카피 단계가 없으면 null(위 사진 한 장, 지금 렌더)', () => {
    expect(stepImagesOf(steps('가', '나'), ['가', '다'], image)).toBeNull()
    expect(stepImagesOf(steps('가', '나'), null, image)).toBeNull()
    expect(stepImagesOf(steps('가', '나'), [], image)).toBeNull()
    expect(stepImagesOf(steps('가', '나'), ['가', '나'], (k) => (k === 'howto:0' ? 'h0.png' : null))).toBeNull()
  })
})

async function t5Of(job: PdpJobRow): Promise<{ t5: CanvasSection | undefined; sections: CanvasSection[] }> {
  const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
  return { t5: doc.sections.find((s) => s.layoutId === 'designcut_T5'), sections: doc.sections }
}
const photosOf = (s: CanvasSection) => s.elements.filter((e) => e.name === 'designcut-product')
const named = (s: CanvasSection, prefix: string) => s.elements.filter((e) => e.name.startsWith(prefix))

/** B 잡에서 사용 컷을 n장만 남긴다(howto:n 이상 지움) */
function withHowtoCuts(n: number): PdpJobRow {
  const job = designCutJobB()
  return { ...job, section_images: job.section_images.filter((e) => !/^howto:\d+$/.test(e.section) || Number(e.section.split(':')[1]) < n) }
}

describe('T5 단계 사진 — 편집기 문서', () => {
  it('사용 컷 3장·카피 3단계면 단계마다 그 단계 글 아래 사진, 위 사진은 없다', async () => {
    const { t5 } = await t5Of(withHowtoCuts(3))
    expect(t5).toBeDefined()
    const photos = photosOf(t5!)
    expect(photos).toHaveLength(3)
    expect(photos.map((p) => p.imageProps?.src ?? p.framedImageProps?.src)).toEqual(
      ['howto:0', 'howto:1', 'howto:2'].map((k) => designCutJobB().section_images.find((e) => e.section === k)!.url)
    )
    // 사진 i는 단계 i 글 아래·단계 i+1 번호 원 위, 글 열(x 170·폭 630)에 둔다
    for (let i = 0; i < 3; i++) {
      const text = [...named(t5!, `designcut-step-title-${i}`), ...named(t5!, `designcut-step-desc-${i}`)]
      const textBottom = Math.max(...text.map((e) => e.transform.y + e.transform.height))
      expect(photos[i].transform.y).toBeGreaterThanOrEqual(textBottom)
      expect(photos[i].transform.x).toBe(170)
      expect(photos[i].transform.width).toBe(630)
      const next = named(t5!, `designcut-step-${i + 1}`)[0]
      if (next) expect(next.transform.y).toBeGreaterThanOrEqual(photos[i].transform.y + photos[i].transform.height)
    }
    // 세로 커넥터는 번호 원 열(사진 왼쪽)에서 이어진다
    const connectors = named(t5!, 'designcut-step-connector-')
    expect(connectors).toHaveLength(2)
    for (const c of connectors) expect(c.transform.x + c.transform.width).toBeLessThan(170)
  })

  it('사용 컷이 1장이면 지금 렌더 그대로(위 사진 한 장) — 단계 사진은 2장부터', async () => {
    const { t5 } = await t5Of(withHowtoCuts(1))
    const photos = photosOf(t5!)
    expect(photos).toHaveLength(1)
    const firstCircle = named(t5!, 'designcut-step-0')[0]
    expect(photos[0].transform.y + photos[0].transform.height).toBeLessThanOrEqual(firstCircle.transform.y)
  })

  it('단계 사진은 T5만 바꾼다 — 다른 섹션 순서·높이와 끝 자리는 그대로', async () => {
    const one = await t5Of(withHowtoCuts(1))
    const three = await t5Of(withHowtoCuts(3))
    const shape = (ss: CanvasSection[]) => ss.filter((s) => s.layoutId !== 'designcut_T5').map((s) => `${s.layoutId || s.sectionType}:${s.canvas.height}`)
    expect(shape(three.sections)).toEqual(shape(one.sections))
    expect(three.sections.map((s) => s.layoutId || s.sectionType)).toEqual(one.sections.map((s) => s.layoutId || s.sectionType))
    expect(three.t5!.canvas.height).toBeGreaterThan(one.t5!.canvas.height)
  })
})
