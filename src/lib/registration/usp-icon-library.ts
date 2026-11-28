/**
 * USP 아이콘 라이브러리 (개정 5 — 오너 검수 피드백 2026-08-11).
 * 저가 모델(gemini-3.1-flash-image)로 사전 대량 생성해 둔 아이콘을 상세페이지 생성 시
 * 키워드 매칭으로 골라 쓴다 — 잡당 아이콘 4장 생성 비용을 0으로 절감.
 *
 * 카탈로그 SSOT = usp-icon-catalog.json (slug·title·keywords·생성 subject —
 * scripts/registration/generate-usp-icon-library.mjs 와 공유). 아이콘 본체는 스토리지
 * {userId}/registration/icon-library-v2/{slug}.png(투명 변환본) — 버킷이 이미지 MIME만 허용해
 * 매니페스트를 스토리지에 두지 못하므로(415 실측) URL은 런타임에 env+userId로 조립한다.
 *
 * v2(2026-10-28): 생성 원본은 흰 배경 불투명 PNG라 카드 위에 흰 사각형이 보였다. 원본은
 * icon-library/에 보관하고, scripts/registration/convert-usp-icon-library.ts가 usp-icon-alpha로
 * 투명화한 변환본을 icon-library-v2/에 올린다. 런타임은 v2만 읽는다(기존 잡의 v1 URL은 그대로 유지).
 */

import catalog from './usp-icon-catalog.json'

const BUCKET = 'sourcing-product-images'

/** 생성 원본(불투명, 보관용) — generate-usp-icon-library.mjs가 올린다 */
export const ICON_LIBRARY_SOURCE_DIR = 'icon-library'
/** 투명 변환본 — convert-usp-icon-library.ts가 올리고(--upload·--verify) 런타임은 여기만 읽는다 */
export const ICON_LIBRARY_DIR = 'icon-library-v2'

export interface UspIconAsset {
  slug: string
  title: string
  keywords: string[]
  url: string
}

export interface UspIconManifest {
  model: string
  icons: UspIconAsset[]
}

export function iconLibraryPrefix(userId: string, dir: string = ICON_LIBRARY_DIR): string {
  return `${userId}/registration/${dir}`
}

/**
 * 카탈로그 → 실사용 라이브러리. 스토리지 업로드는 변환 스크립트가 보장(--verify로 카탈로그와 1:1 확인) —
 * 개별 존재 확인 왕복은 하지 않는다. env 미설정(테스트 등)이면 null(우아한 생략 → 폴백 생성).
 */
export function getUspIconLibrary(userId: string): UspIconManifest | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base || !userId) return null
  const prefix = `${base}/storage/v1/object/public/${BUCKET}/${iconLibraryPrefix(userId)}`
  return {
    model: 'gemini-3.1-flash-image',
    icons: (catalog as Array<{ slug: string; title: string; keywords: string[] }>).map((c) => ({
      slug: c.slug,
      title: c.title,
      keywords: c.keywords,
      url: `${prefix}/${c.slug}.png`,
    })),
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s·,.\-_/()]+/g, '')
}

/**
 * 포인트카드 제목 → 라이브러리 아이콘 매칭 (순수 함수, LLM 아님).
 * 점수 = 제목에 포함된 키워드들의 길이 합(긴 키워드 적중일수록 확신) — 0점이면 미적중(null).
 */
export function selectUspIcon(cardTitle: string, manifest: UspIconManifest): UspIconAsset | null {
  const title = normalize(cardTitle)
  if (!title) return null
  let best: UspIconAsset | null = null
  let bestScore = 0
  for (const icon of manifest.icons) {
    let score = 0
    for (const kw of icon.keywords) {
      const k = normalize(kw)
      if (k.length >= 2 && title.includes(k)) score += k.length
    }
    if (score > bestScore) {
      bestScore = score
      best = icon
    }
  }
  return best
}
