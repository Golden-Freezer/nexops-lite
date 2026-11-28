/**
 * 원본 합성 하위 단계(묶음 4) — 판정 순서(백엔드 → 사진 → 해상도 → 자격 판정 → 누끼·고르기 → 알파 게이트)와 사유별 넘김,
 * 합성 컷 만들기·다시 읽기. 누끼 백엔드·자격 판정·업로드는 모의 함수, 원천 사진은 sharp로 만든 PNG다(유료 0·DB 0).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import {
  composeCompositeCuts,
  compositeEnabled,
  loadCompositeImage,
  prepareCompositeSource,
  type PrepareDeps,
} from './composite-source'
import type { CompositeEligibility, CompositeSourceRecord } from './composite-types'
import type { LocalCutoutBackend } from './cutout-backend'

const NOW = '2026-10-29T12:00:00.000Z'
let photo900: VisionImage
let photo500: VisionImage

/** 흰 바탕 가운데 빨간 사각(한 변의 40%) PNG */
async function productPng(size: number): Promise<VisionImage> {
  const side = Math.round(size * 0.4)
  const red = await sharp({ create: { width: side, height: side, channels: 3, background: { r: 210, g: 30, b: 30 } } })
    .png()
    .toBuffer()
  const png = await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: red, left: Math.round((size - side) / 2), top: Math.round((size - side) / 2) }])
    .png()
    .toBuffer()
  return { data: png.toString('base64'), mediaType: 'image/png' }
}

/** 가운데 40% 사각만 불투명인 isnet 마스크 — 실제 모델 대신 */
const squareMaskBackend: LocalCutoutBackend = async ({ width, height }) => {
  const alpha = new Uint8Array(width * height)
  const x0 = Math.round(width * 0.3)
  const y0 = Math.round(height * 0.3)
  for (let y = y0; y < y0 + Math.round(height * 0.4); y++) {
    for (let x = x0; x < x0 + Math.round(width * 0.4); x++) alpha[y * width + x] = 255
  }
  return alpha
}

function deps(over: Partial<PrepareDeps> & { eligibility?: CompositeEligibility } = {}) {
  const judge = vi.fn(async () => ({
    eligibility: over.eligibility ?? { has_person: false, flat_print: false, reason: 'object' },
    costUsd: 0.001,
  }))
  const upload = vi.fn(async (section: string) => `https://cdn.test/job/${section}.png`)
  return { backend: squareMaskBackend, judge, upload, now: () => NOW, ...over } as PrepareDeps & {
    judge: typeof judge
    upload: typeof upload
  }
}

beforeAll(async () => {
  photo900 = await productPng(900)
  photo500 = await productPng(500)
})

describe('합성 스위치', () => {
  it("section_plan.enrichment에 'composite'가 있을 때만 켜진다", () => {
    expect(
      compositeEnabled({
        section_plan: { enrichment: { version: 1, features: ['vocab', 'composite'], vocabHash: null } },
      } as never)
    ).toBe(true)
    expect(
      compositeEnabled({ section_plan: { enrichment: { version: 1, features: ['vocab'], vocabHash: null } } } as never)
    ).toBe(false)
    expect(compositeEnabled({ section_plan: {} } as never)).toBe(false)
  })
})

describe('판정(prepareCompositeSource)', () => {
  it('누끼 백엔드가 없으면(웹) no_backend — 판정 콜도 하지 않는다', async () => {
    const d = deps({ backend: null })
    const r = await prepareCompositeSource(photo900, 'https://src/0.jpg', d)
    expect(r.record).toMatchObject({
      mode: 'skip',
      reason: 'no_backend',
      photoUrl: 'https://src/0.jpg',
      decidedAt: NOW,
    })
    expect(r.image).toBeNull()
    expect(d.judge).not.toHaveBeenCalled()
  })

  it('참조가 없으면 no_photo, 긴 변 800 미만이면 low_res — 판정 콜 없음', async () => {
    const d = deps()
    expect((await prepareCompositeSource(undefined, undefined, d)).record).toMatchObject({
      mode: 'skip',
      reason: 'no_photo',
    })
    const low = await prepareCompositeSource(photo500, undefined, d)
    expect(low.record).toMatchObject({ mode: 'skip', reason: 'low_res', metrics: { longSide: 500 } })
    expect(d.judge).not.toHaveBeenCalled()
  })

  it('공급처 표기·콜라주면 합성하지 않는다(판정 비용은 남는다)', async () => {
    const marks = await prepareCompositeSource(
      photo900,
      undefined,
      deps({ eligibility: { supplier_marks: true, reason: 'price tag' } })
    )
    expect(marks).toMatchObject({ record: { mode: 'skip', reason: 'marks' }, costUsd: 0.001, image: null })
    const collage = await prepareCompositeSource(photo900, undefined, deps({ eligibility: { collage: true } }))
    expect(collage.record).toMatchObject({ mode: 'skip', reason: 'collage' })
  })

  it('사람·평면 인쇄물이면 누끼 없이 원본 직접 배치(direct) — 누끼를 부르지 않는다', async () => {
    const backend = vi.fn(squareMaskBackend)
    const r = await prepareCompositeSource(photo900, undefined, deps({ backend, eligibility: { has_person: true } }))
    expect(r.record).toMatchObject({ mode: 'direct', reason: 'has_person' })
    expect(r.image?.mode).toBe('direct')
    expect(backend).not.toHaveBeenCalled()
    const flat = await prepareCompositeSource(photo900, undefined, deps({ eligibility: { flat_print: true } }))
    expect(flat.record).toMatchObject({ mode: 'direct', reason: 'flat_print' })
  })

  it('판정 콜이 실패해도 낙관하지 않고 알파 게이트에 맡긴다(NEXFIT)', async () => {
    const r = await prepareCompositeSource(photo900, undefined, deps({ eligibility: { error: 'timeout' } }))
    expect(r.record).toMatchObject({ mode: 'cutout', eligibility: { error: 'timeout' } })
  })

  it('isnet이 깔끔하면 cutout — 알파 PNG를 올리고 경계 상자·지표·규칙 버전을 기록한다', async () => {
    const d = deps()
    const r = await prepareCompositeSource(photo900, 'https://src/0.jpg', d)
    expect(r.record).toMatchObject({
      mode: 'cutout',
      method: 'isnet',
      cutoutUrl: 'https://cdn.test/job/composite-cutout.png',
      rule: { version: 1, isnetSoftMax: 0.15, keyOpaqueRatioMin: 2 },
      metrics: { longSide: 900 },
    })
    expect(r.record.metrics?.coverage).toBeCloseTo(0.16, 2)
    expect(r.record.bbox?.x).toBeCloseTo(0.3, 2)
    expect(r.image?.mode).toBe('cutout')
    expect(d.upload).toHaveBeenCalledWith('composite-cutout', expect.any(String), 'image/png')
    expect(r.costUsd).toBe(0.001)
  })

  it('회색조 사진도 RGB 3채널로 읽어 판정까지 간다(no_photo로 잘못 빠지지 않는다)', async () => {
    const gray = await sharp(Buffer.from(photo900.data, 'base64')).removeAlpha().toColourspace('b-w').png().toBuffer()
    expect((await sharp(gray).metadata()).channels).toBe(1)
    const r = await prepareCompositeSource({ data: gray.toString('base64'), mediaType: 'image/png' }, undefined, deps())
    expect(r.record.mode).toBe('cutout')
  })

  it('누끼가 던지거나 마스크 길이가 다르면 cutout_error', async () => {
    const throws = await prepareCompositeSource(
      photo900,
      undefined,
      deps({
        backend: async () => {
          throw new Error('ort')
        },
      })
    )
    expect(throws.record).toMatchObject({ mode: 'skip', reason: 'cutout_error' })
    const short = await prepareCompositeSource(photo900, undefined, deps({ backend: async () => new Uint8Array(10) }))
    expect(short.record).toMatchObject({ mode: 'skip', reason: 'cutout_error' })
  })

  it('고르기·알파 게이트를 못 넘으면 alpha_gate(지표는 남긴다)', async () => {
    const full = await prepareCompositeSource(
      photo900,
      undefined,
      deps({ backend: async ({ width, height }) => new Uint8Array(width * height).fill(255) })
    )
    expect(full.record).toMatchObject({ mode: 'skip', reason: 'alpha_gate', metrics: { coverage: 1 } })
  })

  it('알파 PNG 업로드가 실패해도 이번 run의 합성 원본은 남는다(cutoutUrl만 없다)', async () => {
    const upload = vi.fn(async () => {
      throw new Error('storage down')
    })
    const r = await prepareCompositeSource(photo900, undefined, deps({ upload }))
    expect(r.record.mode).toBe('cutout')
    expect(r.record.cutoutUrl).toBeUndefined()
    expect(r.image?.mode).toBe('cutout')
  })
})

describe('합성 컷(composeCompositeCuts)·다시 읽기(loadCompositeImage)', () => {
  it('받은 대상 컷만 만들고 composite 표지를 단다(K 칸은 역할도) — 실패한 컷은 빼고 계속한다', async () => {
    const prepared = await prepareCompositeSource(photo900, 'https://src/0.jpg', deps())
    const upload = vi.fn<(section: string, base64: string, mimeType: string) => Promise<string>>(async (section) => {
      if (section === 'product_exposure') throw new Error('upload')
      return `https://cdn.test/job/${section}.png`
    })
    const { entries, failed } = await composeCompositeCuts({
      record: prepared.record,
      image: prepared.image!,
      targets: [
        { section: 'hero', style: 'hero' },
        { section: 'premium_hero', style: 'premium_hero' },
        { section: 'product_exposure', style: 'product_exposure' },
        { section: 'k3_photo_0', style: 'k_label', kRole: 'k_label' },
      ],
      sizeOf: () => '200x300',
      palette: { bgMain: '#ffffff' },
      upload,
    })
    expect(failed).toEqual(['product_exposure'])
    expect(entries).toStrictEqual([
      {
        section: 'hero',
        url: 'https://cdn.test/job/hero.png',
        prompt: 'composite:cutout',
        composite: { mode: 'cutout', sourceUrl: 'https://cdn.test/job/composite-cutout.png' },
      },
      {
        section: 'premium_hero',
        url: 'https://cdn.test/job/premium_hero.png',
        prompt: 'composite:cutout',
        composite: { mode: 'cutout', sourceUrl: 'https://cdn.test/job/composite-cutout.png' },
      },
      {
        section: 'k3_photo_0',
        url: 'https://cdn.test/job/k3_photo_0.png',
        prompt: 'composite:cutout',
        composite: { mode: 'cutout', sourceUrl: 'https://cdn.test/job/composite-cutout.png', kRole: 'k_label' },
      },
    ])
    const sizes = await Promise.all(
      upload.mock.calls.slice(0, 1).map(async ([, b64]) => (await sharp(Buffer.from(b64, 'base64')).metadata()).height)
    )
    expect(sizes).toEqual([300])
  })

  it('앞 run의 기록으로 다시 읽는다 — cutout은 알파 PNG, direct는 원천 사진, 못 읽으면 null', async () => {
    const prepared = await prepareCompositeSource(photo900, undefined, deps())
    const cutoutPng = await sharp(Buffer.from((prepared.image as { rgba: { data: Uint8Array } }).rgba.data), {
      raw: { width: 900, height: 900, channels: 4 },
    })
      .png()
      .toBuffer()
    const fetchImage = vi.fn(async () => ({ data: cutoutPng.toString('base64'), mediaType: 'image/png' as const }))
    const again = await loadCompositeImage(prepared.record, photo900, fetchImage)
    expect(again?.mode).toBe('cutout')
    expect(fetchImage).toHaveBeenCalledWith('https://cdn.test/job/composite-cutout.png')

    const direct: CompositeSourceRecord = { ...prepared.record, mode: 'direct', cutoutUrl: undefined }
    expect((await loadCompositeImage(direct, photo900, fetchImage))?.mode).toBe('direct')
    expect(await loadCompositeImage(direct, undefined, fetchImage)).toBeNull()
    expect(await loadCompositeImage({ ...prepared.record, cutoutUrl: undefined }, photo900, fetchImage)).toBeNull()
    expect(await loadCompositeImage(prepared.record, photo900, async () => null)).toBeNull()
  })
})
