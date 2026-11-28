/**
 * 디자인 컷 원천 사진 색 측정(서버) — images 단계 첫 run이 계획보다 먼저 한 번 재서 section_plan.designcut_photo에 기록한다.
 * 계획(buildDesigncutPlan)은 순수 함수로 이 기록만 읽어, 기록 뒤의 재계산(pdp-image-tasks 폴백)과 결과가 같다.
 * sharp는 네이티브 바이너리라 함수 안에서 불러온다 — 로드·디코딩 실패는 사유만 기록하고 계획은 카피 팔레트로 폴백한다.
 * D2-3 첫 화면 생성 컷의 글자 자리도 여기서 잰다(measureHeroCopyZone — 계산은 internalized/hero-copy-zone).
 */

import type sharpModule from 'sharp'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { measurePhotoColors } from './internalized/photo-palette'
import {
  COPY_ZONE_SAMPLE_PX,
  HERO_COPY_ZONE,
  measureCopyZone,
  type HeroCopyZoneRecord,
} from './internalized/hero-copy-zone'
import type { DesigncutPhotoRecord } from './pdp-state'

/** 측정 크기(긴 변) — 군집 결과가 48~96px에서 같은 색상 계열로 나온다(R1 P02·P03·P07 실측) */
export const PHOTO_SAMPLE_PX = 64

export async function measureDesigncutPhoto(ref: VisionImage | undefined): Promise<DesigncutPhotoRecord> {
  if (!ref) return { version: 1, failed: 'no_source_photo' }
  let sharp: typeof sharpModule
  try {
    const mod = await import('sharp')
    sharp = (mod.default ?? mod) as typeof sharpModule
  } catch {
    return { version: 1, failed: 'sharp_unavailable' }
  }
  try {
    const { data, info } = await sharp(Buffer.from(ref.data, 'base64'))
      .rotate()
      .resize({ width: PHOTO_SAMPLE_PX, height: PHOTO_SAMPLE_PX, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return (
      measurePhotoColors(new Uint8Array(data), info.width, info.height) ?? { version: 1, failed: 'background_only' }
    )
  } catch {
    return { version: 1, failed: 'decode_failed' }
  }
}

/**
 * D2-3 첫 화면 글자 자리 측정 — 생성 컷을 64px 폭 회색조로 줄여 위쪽 띠를 잰다(생성 콜 0건). 투명 화소는 흰 바탕으로 본다.
 * 로드·디코딩 실패는 사유만 기록한다(재지 못한 컷은 재생성하지 않고, 편집기는 지금 T1을 쓴다)
 */
export async function measureHeroCopyZone(base64: string, attempt: 1 | 2): Promise<HeroCopyZoneRecord> {
  const base = { version: 1 as const, zone: { from: HERO_COPY_ZONE.from, to: HERO_COPY_ZONE.to }, attempt }
  let sharp: typeof sharpModule
  try {
    const mod = await import('sharp')
    sharp = (mod.default ?? mod) as typeof sharpModule
  } catch {
    return { ...base, failed: 'sharp_unavailable' }
  }
  try {
    const { data, info } = await sharp(Buffer.from(base64, 'base64'))
      .flatten({ background: '#ffffff' })
      .resize({ width: COPY_ZONE_SAMPLE_PX })
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true })
    const gray =
      info.channels === 1
        ? new Uint8Array(data)
        : Uint8Array.from({ length: info.width * info.height }, (_, i) => data[i * info.channels])
    const measure = measureCopyZone(gray, info.width, info.height)
    return measure ? { ...base, measure } : { ...base, failed: 'decode_failed' }
  } catch {
    return { ...base, failed: 'decode_failed' }
  }
}
