/**
 * 원본 합성 하위 단계(묶음 4, 12_ORIGINAL_COMPOSITE.md §1) — images 단계 첫 run의 맨 앞에서 잡당 한 번 판정하고, 합성 대상 컷을 만든다.
 * 순서: 백엔드 등록 → 사진(생성 참조 첫 장) → 긴 변 800 → 자격 판정 1콜 → isnet+키잉 고르기 → 알파 게이트 → sharp 합성.
 * 어느 단계에서 넘어가든 그 컷은 지금 생성 경로로 간다(사유는 기록에만). 생성·DB·스토리지는 deps로 받는다(시험에서 모의).
 */

import type sharpModule from 'sharp'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import type { PdpJobRow, SectionImage } from '../pdp-state'
import {
  COMPOSITE_MIN_LONG_SIDE,
  CUTOUT_MAX_SIDE,
  CUTOUT_SELECT_RULE,
  type CompositeEligibility,
  type CompositeStyleKey,
  type KCompositeRole,
  type CompositeSkipReason,
  type CompositeSourceRecord,
} from './composite-types'
import type { LocalCutoutBackend } from './cutout-backend'
import { keyWhiteBackground } from './key-white'
import { alphaBBox, selectCutout } from './cutout-select'
import { parseFrameSize, renderCutoutCut, renderDirectCut, type RgbaImage, type RgbImage } from './composite-render'

type Sharp = typeof sharpModule

async function loadSharp(): Promise<Sharp> {
  const mod = await import('sharp')
  return (mod.default ?? mod) as Sharp
}

/**
 * 합성 스위치 — 잡 기록 section_plan.enrichment에 'composite'가 있을 때만(디자인 컷 'designcut'과 같은 방식). 로컬 실행의
 * NEXOPS_PDP_ENRICHMENT_EXTRA로만 켜진다(Vercel은 무시) — 기본 웹 경로와 골든은 이 하위 단계를 돌지 않는다.
 */
export function compositeEnabled(job: Pick<PdpJobRow, 'section_plan'>): boolean {
  return (job.section_plan?.enrichment?.features ?? []).includes('composite')
}

/** 합성 원본 — 누끼(RGBA) 또는 원본 직접 배치(RGB). 둘 다 처리 크기(긴 변 CUTOUT_MAX_SIDE 이하) */
export type CompositeImage = { mode: 'cutout'; rgba: RgbaImage } | { mode: 'direct'; rgb: RgbImage }

export interface PrepareDeps {
  backend: LocalCutoutBackend | null
  judge: (image: VisionImage) => Promise<{ eligibility: CompositeEligibility; costUsd: number }>
  /** 잡 폴더에 올리고 공개 URL을 돌려준다(uploadPdpImage) */
  upload: (section: string, base64: string, mimeType: string) => Promise<string>
  now: () => string
}

/** 원천 사진 → 처리 크기 RGB(확대 없음, 투명은 흰색 위에) + 원본 긴 변 — B 실험 readRgb와 같은 전처리 */
export async function readSourceRgb(sharp: Sharp, ref: VisionImage): Promise<{ rgb: RgbImage; longSide: number }> {
  const input = Buffer.from(ref.data, 'base64')
  // 회전 전 크기라도 긴 변은 같다
  const meta = await sharp(input).metadata()
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0)
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: CUTOUT_MAX_SIDE, height: CUTOUT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    // 회색조 사진도 RGB 3채널로(1채널이면 판정 전에 no_photo로 잘못 빠진다)
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error(`원천 사진이 RGB 3채널이 아닙니다(${info.channels})`)
  return { rgb: { data: new Uint8Array(data), width: info.width, height: info.height }, longSide }
}

function toRgba(rgb: Uint8Array, alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(alpha.length * 4)
  for (let p = 0; p < alpha.length; p++) {
    out[p * 4] = rgb[p * 3]
    out[p * 4 + 1] = rgb[p * 3 + 1]
    out[p * 4 + 2] = rgb[p * 3 + 2]
    out[p * 4 + 3] = alpha[p]
  }
  return out
}

/**
 * 잡당 한 번 판정한다. image는 이 run에서 바로 합성할 원본(skip이면 없음). 비용은 자격 판정 콜만이다(누끼는 로컬 CPU).
 */
export async function prepareCompositeSource(
  ref: VisionImage | undefined,
  photoUrl: string | undefined,
  deps: PrepareDeps
): Promise<{ record: CompositeSourceRecord; image: CompositeImage | null; costUsd: number }> {
  const base = {
    version: 1 as const,
    decidedAt: deps.now(),
    rule: CUTOUT_SELECT_RULE,
    ...(photoUrl ? { photoUrl } : {}),
  }
  const skip = (reason: CompositeSkipReason, extra: Partial<CompositeSourceRecord> = {}, costUsd = 0) => ({
    record: { ...base, mode: 'skip' as const, reason, ...extra },
    image: null,
    costUsd,
  })
  if (!deps.backend) return skip('no_backend')
  if (!ref) return skip('no_photo')

  const sharp = await loadSharp()
  let source: { rgb: RgbImage; longSide: number }
  try {
    source = await readSourceRgb(sharp, ref)
  } catch {
    return skip('no_photo')
  }
  const metrics = { longSide: source.longSide }
  if (source.longSide < COMPOSITE_MIN_LONG_SIDE) return skip('low_res', { metrics })

  const { eligibility, costUsd } = await deps.judge(ref)
  if (eligibility.supplier_marks) return skip('marks', { eligibility, metrics }, costUsd)
  if (eligibility.collage) return skip('collage', { eligibility, metrics }, costUsd)
  // 사람이 나오면 누끼를 뜰 때 소매에서 잘린 손이 뜬다 — 원본을 그대로 두면 제품 화소가 100% 보존된다(NEXFIT)
  if (eligibility.has_person || eligibility.flat_print) {
    return {
      record: {
        ...base,
        mode: 'direct',
        reason: eligibility.has_person ? 'has_person' : 'flat_print',
        eligibility,
        metrics,
      },
      image: { mode: 'direct', rgb: source.rgb },
      costUsd,
    }
  }

  const { data: rgb, width, height } = source.rgb
  let isnetAlpha: Uint8Array
  try {
    isnetAlpha = await deps.backend({ rgb, width, height })
    if (isnetAlpha.length !== width * height) throw new Error(`마스크 길이 ${isnetAlpha.length} ≠ ${width}x${height}`)
  } catch (e) {
    console.warn('[registration/pdp-composite] 누끼 실패 — 생성 경로로', e instanceof Error ? e.message : e)
    return skip('cutout_error', { eligibility, metrics }, costUsd)
  }
  const choice = selectCutout({ rgb, isnetAlpha, key: keyWhiteBackground(rgb, width, height) })
  const allMetrics = { ...metrics, ...choice.metrics }
  if (!choice.ok) return skip('alpha_gate', { eligibility, metrics: allMetrics }, costUsd)

  const rgba = { data: toRgba(choice.rgb, choice.alpha), width, height }
  let cutoutUrl: string | undefined
  try {
    const png = await sharp(Buffer.from(rgba.data), { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
    cutoutUrl = await deps.upload('composite-cutout', png.toString('base64'), 'image/png')
  } catch (e) {
    // 알파 PNG가 없어도 이번 run의 합성 컷은 만들 수 있다 — 디자인 컷 레이어(productAlpha)만 쓰지 못한다
    console.warn('[registration/pdp-composite] 누끼 PNG 업로드 실패', e instanceof Error ? e.message : e)
  }
  const bbox = alphaBBox(choice.alpha, width, height)
  return {
    record: {
      ...base,
      mode: 'cutout',
      eligibility,
      method: choice.method,
      metrics: allMetrics,
      ...(cutoutUrl ? { cutoutUrl } : {}),
      ...(bbox ? { bbox } : {}),
    },
    image: { mode: 'cutout', rgba },
    costUsd,
  }
}

/** 기록만 있고 이번 run에 원본이 없을 때(앞 run에서 판정) — 누끼 PNG 또는 원천 사진을 다시 읽는다. 못 읽으면 null(생성 경로) */
export async function loadCompositeImage(
  record: CompositeSourceRecord,
  ref: VisionImage | undefined,
  fetchImage: (url: string) => Promise<VisionImage | null>
): Promise<CompositeImage | null> {
  const sharp = await loadSharp()
  try {
    if (record.mode === 'direct') return ref ? { mode: 'direct', rgb: (await readSourceRgb(sharp, ref)).rgb } : null
    if (record.mode !== 'cutout' || !record.cutoutUrl) return null
    const png = await fetchImage(record.cutoutUrl)
    if (!png) return null
    const { data, info } = await sharp(Buffer.from(png.data, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { mode: 'cutout', rgba: { data: new Uint8Array(data), width: info.width, height: info.height } }
  } catch {
    return null
  }
}

/** 합성할 컷 하나 — 섹션(K 칸 키 포함)과 합성 모양. K 칸은 역할을 컷 기록에 남긴다(J29) */
export interface CompositeTarget {
  section: string
  style: CompositeStyleKey
  kRole?: KCompositeRole
}

/**
 * 합성 대상 컷(옛 섹션 hero·premium_hero·product_exposure, K 칸 상품 단독·디테일·포장 라벨 — 태스크에 있고 아직 끝나지 않은 것)을 만든다.
 * 컷마다 실패하면 그 컷은 빼고 계속한다(생성 경로, failed에 남긴다). 게이트는 거치지 않는다(원본 화소, NEXFIT B-5).
 */
export async function composeCompositeCuts(input: {
  record: CompositeSourceRecord
  image: CompositeImage
  targets: readonly CompositeTarget[]
  sizeOf: (section: string) => string
  palette: { bgMain?: string; bgSub?: string }
  /** 디자인 컷 잡 — 컷 바탕 단색 */
  solid?: boolean
  upload: PrepareDeps['upload']
}): Promise<{ entries: SectionImage[]; failed: string[] }> {
  const entries: SectionImage[] = []
  const failed: string[] = []
  for (const { section, style, kRole } of input.targets) {
    try {
      const frame = parseFrameSize(input.sizeOf(section))
      const png =
        input.image.mode === 'cutout'
          ? await renderCutoutCut({
              cutout: input.image.rgba,
              section: style,
              frame,
              palette: input.palette,
              solid: input.solid,
            })
          : await renderDirectCut({
              photo: input.image.rgb,
              section: style,
              frame,
              palette: input.palette,
              solid: input.solid,
            })
      const url = await input.upload(section, png.toString('base64'), 'image/png')
      const sourceUrl = input.record.cutoutUrl ?? input.record.photoUrl
      entries.push({
        section,
        url,
        prompt: `composite:${input.image.mode}`,
        composite: { mode: input.image.mode, ...(sourceUrl ? { sourceUrl } : {}), ...(kRole ? { kRole } : {}) },
      })
    } catch (e) {
      failed.push(section)
      console.warn(
        `[registration/pdp-composite] '${section}' 합성 실패 — 생성 경로로`,
        e instanceof Error ? e.message : e
      )
    }
  }
  return { entries, failed }
}
