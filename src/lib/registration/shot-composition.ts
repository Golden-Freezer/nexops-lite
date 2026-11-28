/**
 * 구도 중복 판정(shotdiv ③) — 생성 컷마다 작은 구도 지문(dHash: 9×8 회색조 가로 밝기 차 64비트)을 남기고, 같은 페이지의 다른 상품 컷과
 * 거의 같은 구도면 다른 각도로 한 번 다시 만든다(pdp-image-stage). Vision 콜 없이 결정론($0)이다. D2-3 글자 자리 측정처럼 sharp는
 * 함수 안에서 불러오고, 재지 못하면 지문 없이 지나간다(판정하지 않는다).
 * 한계: 밝기 배치를 보므로 바탕만 다르고 손에 든 같은 구도(R9 '손으로 든 같은 봉투')는 거리가 커져 놓칠 수 있고, 바탕이 같고 상품 자세만
 * 다른 컷은 가깝게 나올 수 있다.
 * 문턱 실측(R10-L·R12-L 4잡 189쌍, 2026-11-01): 가장 가까운 쌍이 18이라 문턱 10은 한 번도 걸리지 않았다. R12-L 168쌍을 눈으로 가른 같은 구도 21쌍(B 1인 판정·축소본)
 * 기준 문턱 18은 걸림 3·맞음 2, 20은 8·4, 22는 16·5, 24는 26·9다. 같은 구도 거리가 18~32라 다른 구도와 겹친다 — 이 지문은 거의 똑같은 쌍만 잡는다.
 * 페이지 전체의 구도 반복은 이 값으로 풀리지 않는다(재현율 18에서 0.10). 잘못 걸려도 다른 각도 컷을 한 장 더 만들 뿐이라(구독, 약 110초) 18로 둔다.
 */

import type sharpModule from 'sharp'
import type { SectionImage } from './pdp-state'

/** 거의 같은 구도로 보는 지문 거리 상한(64비트 중 다른 비트 수) */
export const DHASH_TWIN_MAX = 18

/** 지문을 남기는 상품 컷 — 첫 화면·특징·사용법·사용 장면(효과 컷·플레이트·아이콘은 뺀다) */
export function isCompositionCut(section: string): boolean {
  return /^(hero|features:\d+|howto:\d+|long_scene:\d+)$/.test(section)
}

/** 다시 만들 수 있는 컷 — 첫 화면은 기준이라 다시 만들지 않는다(글자 자리·스타일 참조가 첫 화면에 묶여 있다) */
export function isCompositionTarget(section: string): boolean {
  return isCompositionCut(section) && section !== 'hero'
}

/** 9×8 회색조 → 행마다 왼쪽이 오른쪽보다 밝으면 1. 재지 못하면 null */
export async function dHashOf(base64: string): Promise<string | null> {
  let sharp: typeof sharpModule
  try {
    const mod = await import('sharp')
    sharp = (mod.default ?? mod) as typeof sharpModule
  } catch {
    return null
  }
  try {
    const { data, info } = await sharp(Buffer.from(base64, 'base64'))
      .flatten({ background: '#ffffff' })
      .resize(9, 8, { fit: 'fill' })
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.width !== 9 || info.height !== 8) return null
    return dHashFromGray(Uint8Array.from({ length: 72 }, (_, i) => data[i * info.channels]))
  } catch {
    return null
  }
}

/** 9×8 회색조 화소(행 우선) → 16진 16자리 */
export function dHashFromGray(gray: Uint8Array): string {
  let hex = ''
  for (let row = 0; row < 8; row++) {
    let byte = 0
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1 : 0)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** 두 지문의 다른 비트 수 — 모양이 틀리면 64 */
export function dHashDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64
  let d = 0
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** 이월 표지 — 시간·지출 예약이 모자라 다음 run이 다시 만드는 구도 중복 컷(pendingRegen과 함께 남는 error 글) */
const ANGLE_PENDING = '구도 중복 — 다른 각도 재생성 대기: '
export const anglePendingError = (twin: string) => `${ANGLE_PENDING}${twin}`
/** 이월된 구도 중복 재생성이면 거의 같은 구도였던 컷 이름, 아니면 null */
export function anglePendingOf(entry: Pick<SectionImage, 'pendingRegen' | 'error'>): string | null {
  return entry.pendingRegen && entry.error?.startsWith(ANGLE_PENDING) ? entry.error.slice(ANGLE_PENDING.length) || null : null
}

/**
 * 이 컷과 거의 같은 구도인 다른 컷(가장 가까운 것) — 지문이 있는 상품 컷끼리만 본다. 없으면 null
 */
export function findCompositionTwin(
  entry: Pick<SectionImage, 'section' | 'dhash'>,
  images: readonly SectionImage[]
): { of: string; distance: number } | null {
  if (!entry.dhash || !isCompositionTarget(entry.section)) return null
  let best: { of: string; distance: number } | null = null
  for (const other of images) {
    if (other.section === entry.section || !other.url || !other.dhash || !isCompositionCut(other.section)) continue
    const distance = dHashDistance(entry.dhash, other.dhash)
    if (distance <= DHASH_TWIN_MAX && (!best || distance < best.distance)) best = { of: other.section, distance }
  }
  return best
}

/**
 * K 라인 컷(키 k<섹션>_<칸>_<번호>, templatelib/section-values shotKey) — shotdiv 정규식(isCompositionCut)이 받지 않아 K5까지 지문이 없었다.
 * shotvary 잡만 지문을 남기고 거의 같은 구도 짝을 기록한다(세션 B variety F5 — 기록만, 다른 각도 재생성은 하지 않는다)
 */
export function isLineCompositionCut(section: string): boolean {
  return /^k\d+_/.test(section)
}

/** K 컷과 거의 같은 구도인 다른 컷 — 대표 컷과 다른 K 컷을 본다. 기록용(재생성 없음). 없으면 null */
export function findLineCompositionTwin(
  entry: Pick<SectionImage, 'section' | 'dhash'>,
  images: readonly SectionImage[]
): { of: string; distance: number } | null {
  if (!entry.dhash || !isLineCompositionCut(entry.section)) return null
  let best: { of: string; distance: number } | null = null
  for (const other of images) {
    if (other.section === entry.section || !other.url || !other.dhash || !(other.section === 'hero' || isLineCompositionCut(other.section))) continue
    const distance = dHashDistance(entry.dhash, other.dhash)
    if (distance <= DHASH_TWIN_MAX && (!best || distance < best.distance)) best = { of: other.section, distance }
  }
  return best
}
