/**
 * 원천 사진 순서·역할(결정 카드 c12·하네스 J20, 가정 A4) — 화면(PdpForm)과 서버(잡 생성 라우트·이미지 단계)가 함께 쓰는 순수 함수.
 *
 * - 순서: sourceImages 순서가 계약이다(첫 장 = 구조 정본·식별 카드·게이트 기준). 폼의 순서 바꾸기·대표 지정·빼기는 이 순서만 바꾼다.
 * - 역할: 원본·옵션·설명 그림. spec_sheet.sourcePhotoRoles(DDL 없음)에 원본이 아닌 사진만 {url, role}로 남기고, 프롬프트 스펙 JSON에는
 *   넣지 않는다(SPEC_PROMPT_EXCLUDED_KEYS). photoroles 스위치가 기록된 잡만 읽는다 — 설명 그림(글·도식 패널, 하네스 TEXT_PANEL과 같은 뜻)은
 *   생성 원천에서 빼 기록만 하고, 옵션 사진은 식별 카드 콜에 역할 한 줄을 붙인다. 스위치가 꺼진 잡은 역할이 있어도 지금과 같다.
 * - 시험 사진(demo, 하네스 J57·통합 decide 37)은 판매자가 상품을 직접 시험한 사진이다. demoshot 잡의 시연 칸(compare.demo-photo)이 주소 그대로
 *   쓰고, 생성 원천(식별 카드·컷 참조)에서는 설명 그림처럼 뺀다 — 시험 장면이 상품 정체를 흐리지 않게. photoroles·demoshot이 둘 다 꺼진 잡은 그대로다.
 * - 포장 사진(package, 하네스 J58·통합 decide 35·38)은 생성 원천에 남는다(빼는 역할 GENERATION_EXCLUDED_ROLES 밖). photoroles 잡에 있으면 K 컷 배정이
 *   포장 컷 한 장을 보장한다(shot-assign forcePackage) — 참조 그대로 그리는 포장 컷의 근거다.
 */

import { isGeneratedRegistrationImage } from '@/lib/sourcing/registration/draft-source-images'
import { isLowResolutionImage, type ImageDimensions } from './reference-image-quality'

export const PHOTO_ROLES = ['original', 'option', 'explain', 'demo', 'package'] as const
export type PhotoRole = (typeof PHOTO_ROLES)[number]

/** spec_sheet에 남기는 한 줄 — 원본이 아닌 사진만 */
export interface SourcePhotoRole {
  url: string
  role: Exclude<PhotoRole, 'original'>
}

export const PHOTO_ROLE_LABEL: Readonly<Record<PhotoRole, string>> = { original: '원본', option: '옵션', explain: '설명 그림', demo: '시험 사진', package: '포장' }

const isMarkedRole = (role: unknown): role is SourcePhotoRole['role'] => role === 'option' || role === 'explain' || role === 'demo' || role === 'package'

/** 들어온 역할 정리 — sourceImages에 있는 주소·알려진 역할만, 같은 주소는 처음 한 번. 원본은 남기지 않는다 */
export function cleanSourcePhotoRoles(value: unknown, sourceImages: readonly string[]): SourcePhotoRole[] {
  if (!Array.isArray(value)) return []
  const out: SourcePhotoRole[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const { url: rawUrl, role } = row as { url?: unknown; role?: unknown }
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!url || !sourceImages.includes(url) || !isMarkedRole(role) || out.some((r) => r.url === url)) continue
    out.push({ url, role })
  }
  return out
}

/**
 * 포장 역할 사진이 원천에 있는가(J58, 통합 decide 35·38) — 포장 사진은 설명 그림과 달리 생성 원천에 남는다(참조 그대로 그리는 포장 컷의 근거).
 * 읽는 쪽(select-line)이 photoroles 기록 잡에서만 부른다
 */
export function hasPackagePhoto(sourceImages: readonly string[], roles: readonly SourcePhotoRole[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r.role === 'package' && sourceImages.includes(r.url))
}

/** 사진 하나의 역할 — 기록이 없으면 원본 */
export function photoRoleOf(roles: readonly SourcePhotoRole[] | null | undefined, url: string): PhotoRole {
  return roles?.find((r) => r.url === url)?.role ?? 'original'
}

/** 역할 바꾸기(화면) — 원본으로 돌리면 줄을 지운다 */
export function withPhotoRole(roles: readonly SourcePhotoRole[], url: string, role: PhotoRole): SourcePhotoRole[] {
  const rest = roles.filter((r) => r.url !== url)
  return role === 'original' ? rest : [...rest, { url, role }]
}

/** 남은 사진만의 역할(빼기 뒤) — 화면이 지운 사진의 역할 줄을 남기지 않는다 */
export function rolesForUrls(roles: readonly SourcePhotoRole[], urls: readonly string[]): SourcePhotoRole[] {
  return roles.filter((r) => urls.includes(r.url))
}

/** 생성 원천에서 빼는 역할 — 설명 그림과 시험 사진(J57) */
export const GENERATION_EXCLUDED_ROLES: readonly PhotoRole[] = ['explain', 'demo']

/**
 * 생성 원천 — 빼는 역할(기본 설명 그림·시험 사진)을 뺀 나머지(순서 그대로). 다 빠지면 원래 목록을 쓴다(원천 없이 만들지 않는다 — fallback 표시).
 * excluded는 뺀 사진(기록용)
 */
export function generationSourceUrls(
  sourceImages: readonly string[],
  roles: readonly SourcePhotoRole[] | null | undefined,
  excludedRoles: readonly PhotoRole[] = GENERATION_EXCLUDED_ROLES
): { urls: string[]; excluded: string[]; fallback: boolean } {
  const excluded = sourceImages.filter((url) => excludedRoles.includes(photoRoleOf(roles, url)))
  if (excluded.length === 0) return { urls: [...sourceImages], excluded: [], fallback: false }
  const urls = sourceImages.filter((url) => !excluded.includes(url))
  return urls.length > 0 ? { urls, excluded, fallback: false } : { urls: [...sourceImages], excluded: [], fallback: true }
}

/**
 * 잡이 생성 원천에서 빼는 역할(이미지 단계 generationSourceOf·K 계획 shotvary가 같이 쓴다) — photoroles 잡은 설명 그림·시험 사진,
 * demoshot만 켠 잡은 시험 사진만(J57). 둘 다 꺼진 잡은 빈 목록이라 원천이 source_images 그대로다
 */
export function generationExcludedRolesOf(switches: { photoRoles: boolean; demoShot: boolean }): readonly PhotoRole[] {
  if (switches.photoRoles) return GENERATION_EXCLUDED_ROLES
  return switches.demoShot ? ['demo'] : []
}

/** 시험 사진 주소(순서 그대로, J57) — sourceImages에 있고 역할이 demo인 사진만. demoshot 잡의 시연 칸 입력이다 */
export function demoPhotoUrls(sourceImages: readonly string[], roles: readonly SourcePhotoRole[] | null | undefined): string[] {
  return sourceImages.filter((url) => photoRoleOf(roles, url) === 'demo')
}

/**
 * 식별 카드 역할 한 줄 — 보내는 사진 순서(1부터)의 역할. 옵션 사진이 없으면 null(지금 지시 그대로).
 * 옵션 사진은 같은 상품의 다른 색·구성이라 그 색·구성을 상품 자체 특징으로 적지 않게 한다
 */
export function identityRoleLine(sentRoles: readonly PhotoRole[]): string | null {
  const options = sentRoles.flatMap((role, i) => (role === 'option' ? [`photo ${i + 1}`] : []))
  if (options.length === 0) return null
  const which = options.length === 1 ? `${options[0]} shows` : `${options.join(', ')} show`
  return (
    `Photo roles: ${which} the same product in another purchase option (a different color, pattern or set). ` +
    "Describe the product's shared form once and do not state an option photo's color, pattern or set as the product's own."
  )
}

/** 목록 안 옮기기(화면) — 범위 밖이면 그대로 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 대표 지정 = 맨 앞으로 */
export function moveToFront<T>(list: readonly T[], index: number): T[] {
  return moveItem(list, index, 0)
}

export const FIRST_PHOTO_GENERATED_MESSAGE =
  '대표(첫 장)가 AI가 만든 그림입니다. 첫 장은 상품 구조·식별 카드·검수의 기준이 됩니다 — 원본 사진을 맨 앞으로 옮기세요.'
export const FIRST_PHOTO_LOW_RES_MESSAGE =
  '대표(첫 장)가 저해상도입니다. 첫 장은 상품 구조·식별 카드·검수의 기준이 됩니다 — 큰 원본 사진을 맨 앞으로 옮기세요.'

/** 첫 장 경고 — 생성 경로가 먼저, 다음 저해상도. 문제가 없거나 사진이 없으면 null */
export function firstPhotoWarning(urls: readonly string[], dims: Readonly<Record<string, ImageDimensions>>): string | null {
  const first = urls[0]
  if (!first) return null
  if (isGeneratedRegistrationImage(first)) return FIRST_PHOTO_GENERATED_MESSAGE
  return isLowResolutionImage(dims[first]) ? FIRST_PHOTO_LOW_RES_MESSAGE : null
}
