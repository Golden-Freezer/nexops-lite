/**
 * 내재화 테마(결정 T-5) — v2 designRecipes(역할별 실측 중앙값, §E-1 환산·§E-2 클램프 완료 값)를
 * 24 섹션 타입별 렌더 기본값으로 변환하는 순수 함수. designTokens.ts(Track S)는 수정하지 않는다 —
 * 테마는 주입 시점(compose 미리보기·에디터 문서 최초 빌드)에 오버라이드되는 얇은 레이어이고,
 * 오너가 에디터에서 덮어쓰면 그게 우선이다(오너 재량 보존).
 *
 * 1차 적용 범위(§9 리스크 대응): 타이포(헤드라인/본문 px·행간)·배경 hex·패딩만. 프레임 지오메트리
 * 불변, 에디터에서는 배경+타이포만(절대좌표 모델 — 위치 조정은 신규 변환 reflow가 흡수).
 *
 * 배경 hex 선택(§E-3): 측정값(topHexes)만 후보 — 새 색 생성 금지(palette.py 원칙 계승).
 * palette가 있으면 bgMain/bgSub와 ΔE(CIE76) 최소 후보, 없으면 후보 1위.
 */

import type { CorpusSnapshotV2, Role16 } from '../corpus-v2'
import type { DesignPalette } from '../pdp-state'
import { ROLE_TO_SECTIONS, type RoleSectionMapping } from './role-section-map'

/** 부록 C SectionThemeDefaults — 서버가 해석을 마친 뒤 소비처(compose·에디터)에 내려보내는 형태. */
export interface ResolvedSectionTheme {
  headlinePx: number
  bodyPx: number
  lineHeightRatio: number
  paddingPx: number
  gapPx: number
  backgroundHex: string
}

/** 섹션 타입(ProSectionType 문자열) → 테마. 레시피 없는 타입(cta·divider 등)은 키 자체가 없다(기본값 유지). */
export type InternalizedThemeMap = Record<string, ResolvedSectionTheme>

// ── ΔE(CIE76) — sRGB → Lab 변환 후 유클리드 거리. 배경 후보와 팔레트의 근접성 판정 전용 ──

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function srgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  // D65 백색점 기준 XYZ
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return Number.POSITIVE_INFINITY
  const [l1, a1, b1] = srgbToLab(a)
  const [l2, a2, b2] = srgbToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** §E-3 배경 hex 선택 — 후보(측정값) 중 palette.bgMain/bgSub와 ΔE 최소, palette 없으면 후보 1위. */
export function pickBackgroundHex(candidates: string[], palette: DesignPalette | null | undefined): string {
  const valid = candidates.filter((c) => hexToRgb(c) !== null)
  if (valid.length === 0) return '#FFFFFF'
  const anchors = [palette?.bgMain, palette?.bgSub].filter((h): h is string => Boolean(h && hexToRgb(h)))
  if (anchors.length === 0) return valid[0]
  let best = valid[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const candidate of valid) {
    const dist = Math.min(...anchors.map((a) => deltaE(candidate, a)))
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}

/**
 * v2 designRecipes → 섹션 타입별 해석 완료 테마. 역할→섹션 전개는 role-section-map SSOT를 따르고,
 * 두 역할이 같은 섹션 타입에 닿으면(예: certification ← certification_evidence·authenticity)
 * 먼저 온 역할이 이긴다(결정 T-4 dedupe와 동일 의미론).
 */
export function buildInternalizedTheme(
  snapshot: CorpusSnapshotV2,
  palette: DesignPalette | null | undefined,
  /** ENRICHMENT persuasion 잡은 정정 매핑(ROLE_TO_SECTIONS_ENRICHED)을 넘긴다. 기본값은 기존 매핑 */
  roleMap: Record<Role16, RoleSectionMapping> = ROLE_TO_SECTIONS
): InternalizedThemeMap {
  const theme: InternalizedThemeMap = {}
  for (const [role, mapping] of Object.entries(roleMap)) {
    const recipe = snapshot.designRecipes[role as keyof typeof snapshot.designRecipes]
    if (!recipe) continue
    for (const sectionType of mapping.sections) {
      const key = String(sectionType)
      if (theme[key]) continue
      theme[key] = {
        headlinePx: recipe.headlinePx,
        bodyPx: recipe.bodyPx,
        lineHeightRatio: recipe.lineHeightRatio,
        paddingPx: recipe.paddingPx,
        gapPx: recipe.elementGapPx,
        backgroundHex: pickBackgroundHex(recipe.topHexes, palette),
      }
    }
  }
  return theme
}
