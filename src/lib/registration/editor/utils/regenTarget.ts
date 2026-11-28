/**
 * 편집기 이미지 재생성 UI(묶음 5 ③) 계산 — 순수 함수. 서버 계약은 pdp-image-regen.ts(#174)이고 여기서는 타입만 쓴다
 * (값 상수를 들여오면 서버 모듈이 브라우저 번들에 딸려 온다 — 라벨·상한은 여기 두고 시험이 서버 값과 같은지 고정한다).
 * - 캔버스 이미지 → 섹션 키: section_images[].url과 src가 같은 문자열인 항목(toGeneratedImagesMap이 url을 바꾸지 않는다).
 *   못 찾으면 재생성 대상이 아니다(사용자 업로드·보관함 재사용·옵션 실물 사진).
 * - 결과 반영: done 기록의 previousUrl이 아직 문서에 있으면 그 자리를 모두 새 url로 바꾼다(편집기를 닫았다 연 경우 포함).
 * - 사후 재생성(W5b): 사진 없는 섹션(수동 추가 — 생성이 만들지 않은 키)에 그 섹션 키의 새 컷을 만들어 섹션 끝에 넣는다.
 */

import type { CanvasSection } from '../types/canvas'
import type { RegenEstimate, RegenStyle } from '@/lib/registration/pdp-image-regen'
import type { SectionImage } from '@/lib/registration/pdp-state'
import { SECTION_IMAGE_MAPPING } from '../constants/sectionConfig'
import { elementsWithSrc, imageSrcOf } from './imageSwap'

/** 서버 REGEN_STYLES와 같은 키(시험 고정) — 화면 순서도 이 순서 */
export const REGEN_STYLE_LABELS = {
  premium_studio: '프리미엄 스튜디오',
  lifestyle: '생활 장면',
  macro: '근접 디테일',
  empathy: '공감 장면',
  product_photo: '제품 사진',
  infographic: '정보 정리형',
} satisfies Record<RegenStyle, string>

export const REGEN_STYLE_ORDER = Object.keys(REGEN_STYLE_LABELS) as RegenStyle[]

/** 서버 REGEN_NOTE_MAX_CHARS와 같다(시험 고정) */
export const REGEN_NOTE_LIMIT = 200

/** 캔버스 이미지 src → 재생성할 섹션 키. 생성 실패 표지가 있는 항목은 대상이 아니다 */
export function regenSectionForSrc(sectionImages: readonly SectionImage[], src: string | null | undefined): string | null {
  if (!src) return null
  return sectionImages.find((e) => e.url === src && !e.error)?.section ?? null
}

export type RegenState =
  | { state: 'pending' }
  | { state: 'done'; url: string; previousUrl: string | null }
  | { state: 'rejected' | 'failed'; message: string }

/** 그 섹션의 재생성 기록. requestedAt을 주면 그 요청의 기록일 때만 결과로 본다(아니면 아직 대기) */
export function regenStateOf(sectionImages: readonly SectionImage[], section: string, requestedAt?: string): RegenState | null {
  const entry = sectionImages.find((e) => e.section === section)
  const record = entry?.editorRegen
  if (!entry || !record) return null
  if (requestedAt && record.requestedAt !== requestedAt) return { state: 'pending' }
  if (record.status === 'pending') return { state: 'pending' }
  if (record.status === 'done') return { state: 'done', url: entry.url, previousUrl: record.previousUrl ?? null }
  return { state: record.status, message: record.message ?? (record.status === 'rejected' ? '새 이미지가 정체성 확인을 통과하지 못했습니다.' : '이미지를 만들지 못했습니다.') }
}

export interface RegenApply {
  section: string
  from: string
  to: string
  targets: Array<{ sectionId: string; elementId: string }>
}

/** 아직 캔버스에 반영되지 않은 재생성 결과 — done이고 이전 이미지가 문서에 남아 있는 것 */
export function pendingApplies(sectionImages: readonly SectionImage[], sections: readonly CanvasSection[]): RegenApply[] {
  const out: RegenApply[] = []
  for (const entry of sectionImages) {
    const record = entry.editorRegen
    if (record?.status !== 'done' || !record.previousUrl || !entry.url || record.previousUrl === entry.url) continue
    const targets = elementsWithSrc(sections, record.previousUrl)
    if (targets.length > 0) out.push({ section: entry.section, from: record.previousUrl, to: entry.url, targets })
  }
  return out
}

/**
 * 섹션 유형 → 그 섹션이 쓰는 생성 컷 키(서버 이미지 태스크 키). SECTION_IMAGE_MAPPING의 imageKey를 태스크 키로 바꾼다
 * (feature_0N→features:N, howto_0N→howto:N, conversion_cta→cta). 이미지가 없는 섹션('')과 옵션 갤러리('options' — 실물
 * 옵션 사진)는 null
 */
export function sectionImageKeyOf(sectionType: string): string | null {
  const image = SECTION_IMAGE_MAPPING[sectionType]?.imageKey
  if (!image || image === 'options') return null
  const feature = /^feature_(\d+)$/.exec(image)
  if (feature) return `features:${Number(feature[1])}`
  const howto = /^howto_(\d+)$/.exec(image)
  if (howto) return `howto:${Number(howto[1])}`
  return image === 'conversion_cta' ? 'cta' : image
}

const hasImage = (section: CanvasSection) => section.elements.some((el) => imageSrcOf(el) !== null)

/**
 * 사진 없는 섹션에 새 컷을 만들 키 — 섹션에 사진 요소가 없고 그 키의 컷이 아직 없을 때(항목 없음·생성 실패·대기 중)만.
 * 이미 만든 컷이 있는 키는 재생성이 다른 자리의 같은 컷까지 바꾸므로 여기서 고르지 않는다
 */
export function addableImageKey(sectionImages: readonly SectionImage[], section: CanvasSection): string | null {
  // 긴 상세페이지 확장 섹션은 유형(sub2_div_page·spec_table)의 대표 키가 다른 자리 컷이라 새 컷을 만들지 않는다
  if (section.expansion || hasImage(section)) return null
  const key = sectionImageKeyOf(section.sectionType)
  if (!key) return null
  return sectionImages.find((e) => e.section === key)?.url ? null : key
}

export interface RegenAdd {
  section: string
  url: string
  sectionId: string
}

/**
 * 아직 캔버스에 넣지 않은 새 컷 — 이전 이미지 없이 만든 done 기록(덧붙인 항목 added, 또는 생성이 실패했던 항목)의 url이 문서에
 * 없으면 그 키를 쓰는 사진 없는 섹션(첫 번째)에 넣는다(창을 닫았다 다시 연 경우). 바꾼 컷(previousUrl 있음)은 pendingApplies가 자리를 바꾼다
 */
export function pendingAdds(sectionImages: readonly SectionImage[], sections: readonly CanvasSection[]): RegenAdd[] {
  const out: RegenAdd[] = []
  for (const entry of sectionImages) {
    const record = entry.editorRegen
    if (record?.status !== 'done' || record.previousUrl || !entry.url) continue
    if (elementsWithSrc(sections, entry.url).length > 0) continue
    const target = sections.find((s) => !hasImage(s) && sectionImageKeyOf(s.sectionType) === entry.section)
    if (target) out.push({ section: entry.section, url: entry.url, sectionId: target.id })
  }
  return out
}

const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`

/** 확인 전 비용 안내 문구(줄 단위) */
export function regenCostLines(estimate: RegenEstimate): string[] {
  const head = `모델 ${estimate.model} · 품질 ${estimate.quality}`
  if (!estimate.billed) {
    return [head, '코덱스 구독 경로라 이미지 API 과금이 없습니다. 로컬 실행기가 처리합니다.', '정체성 확인(비전) 판정에는 따로 소액이 듭니다.']
  }
  return [
    head,
    `이미지 1장 약 ${usd(estimate.imageUsd)}, 정체성 확인에 걸려 한 번 더 만들면 최대 ${usd(estimate.maxImageUsd)}`,
    '정체성 확인·강조 장식(비전) 판정에는 따로 소액이 듭니다. 월 예산 안에서만 실행됩니다.',
  ]
}
