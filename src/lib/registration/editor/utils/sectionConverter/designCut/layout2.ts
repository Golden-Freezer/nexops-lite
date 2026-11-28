/**
 * 디자인 컷 렌더 v2 바탕(C3, PDP-DR-PLAN §1·08 §4.3 개정) — 막 단위 배정과 사진 하단 페이드. 순수 함수.
 * - 막: 후킹(T1) → 공감(고민) → 해결·포인트(해결 요약·POINT·스토리) → 확인(사용법·사이즈·옵션·추천·구매 전 확인·범위 밖 kept) → 마무리(T8)
 * - 흰 바탕(W)이 기본이고, 앞 섹션 아래 끝이 흰색이면 밝은 뉴트럴 스튜디오(N)로 바꿔 같은 바탕이 이어지지 않게 한다(흰·스튜디오 교대)
 * - 짙은 면(D)은 전환점 두 곳뿐 — 공감→해결의 첫 섹션(공감 막이 있을 때)과 마무리(T8). 사진 템플릿(T1·T3c)은 P 그대로
 * - 같은 바탕 경계 구분선(v1 separateSameBackgrounds) 대신, 사진 띠로 끝나는 섹션의 아래 140px를 다음 섹션 바탕으로 녹인다.
 *   편집기 도형은 단색만 그려서(build.ts 머리말) 그라데이션은 SVG 요소로 둔다(편집기·내보내기 모두 인라인 SVG — id는 요소마다 다르게)
 * 조립(compose) 시점에 정한다 — 범위 밖(kept) 섹션의 실제 바탕을 알고, 예전 계획 기록에도 같은 규칙이 걸린다.
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { rgbToLch } from '@/lib/registration/internalized/designcut-palette'
import { uid } from '../helpers'
import { baseKeyOf, type DesigncutBg, type DesigncutTemplate } from './contract'
import { W } from './tokens'

export type Act = 'hook' | 'empathy' | 'solve' | 'confirm' | 'close'

const ROLE_ACT: Record<string, Act> = {
  hook: 'hook',
  product_intro: 'hook',
  problem: 'empathy',
  usp_feature: 'solve',
  brand_story: 'solve',
  social_proof: 'solve',
  how_to_guide: 'confirm',
  target_recommendation: 'confirm',
  size_spec: 'confirm',
  option_catalog: 'confirm',
  purchase_check: 'confirm',
  cta: 'close',
}

/** 섹션의 막 — 해결 요약(solution_guide)은 설득 플래너 역할이 problem이어도 해결 막. 역할을 모르는 kept는 확인 막 */
export function actOf(key: string, role: string | null): Act {
  if (baseKeyOf(key) === 'solution_guide') return 'solve'
  return (role ? ROLE_ACT[role] : undefined) ?? 'confirm'
}

/** 바탕 행 — template null이면 범위 밖(kept) 섹션이고 keptFill은 그 실제 바탕색 */
export interface BgRow {
  key: string
  role: string | null
  template: DesigncutTemplate | null
  keptFill?: string | null
  /** D2 장면 모드에서 흰 띠 여백으로 끝나는 큰 POINT 형태 변형(zigzag·grid — 사진이 아래 끝에 닿지 않는다) */
  bandEnd?: boolean
}

const FIXED_V2: Partial<Record<DesigncutTemplate, DesigncutBg>> = { T1: 'P', T3c: 'P', T8: 'D' }
/** D2 장면 모드가 흰 띠 + 풀폭 장면 사진으로 그리는 템플릿(큰 POINT 형태 변형 zigzag·grid는 흰 띠 여백으로 끝난다 — BgRow.bandEnd) */
const SCENE_TEMPLATES = new Set<DesigncutTemplate>(['T1', 'T3a', 'T8'])
/** 아래 끝이 사진(무대 띠·사진 바탕·플레이트)인 템플릿 */
const PHOTO_BOTTOM = new Set<DesigncutTemplate>(['T1', 'T3a', 'T3c', 'T8'])

/** 흰색으로 보는 값(채널 최소 247 이상 — #FEFEFE·#FAFAFA 같은 사진 흰 배경 포함, 스튜디오 #F4F4F4는 아님) */
export function isWhite(color: string | null | undefined): boolean {
  const rgb = parseColor(color)
  return rgb !== null && Math.min(...rgb) >= 247
}

/** 밝은 유채색 면(tint 계열 — L* 88 이상·C* 4 초과). 흰색·스튜디오(C* ≤4)·짙은 면은 아니다 */
export function isLightTint(color: string | null | undefined): boolean {
  const rgb = parseColor(color)
  if (!rgb) return false
  const { l, c } = rgbToLch(rgb)
  return l >= 88 && c > 4
}

/**
 * 막 단위 바탕(v2). kept 행은 null — 단 바탕이 밝은 유채색(tint)인 kept는 흰·스튜디오 교대 색을 돌려준다(조립이 그 섹션 바탕만 다시
 * 칠한다 — 빌더 섹션의 글은 밝은 바탕용 짙은 글이라 그대로 읽힌다). photoIsWhite: 상품 컷 배경이 흰색이면 사진으로 끝나는 섹션도 흰색으로 끝난다
 */
export function assignActBackgrounds(
  rows: readonly BgRow[],
  photoIsWhite: boolean,
  sceneMode = false,
  // palette2 playful(PALETTE2.md ③) — 짙은 전환 면(D) 자리를 옅은 스튜디오 면(N)으로
  noDark = false
): Array<DesigncutBg | null> {
  const acts = rows.map((r) => actOf(r.key, r.role))
  // D2 장면 모드: T1·T3a·T8은 흰 띠 제목 + 풀폭 장면 사진으로 끝난다(templatesScene) — 흰 띠로 두고 짙은 전환 면 후보에서 뺀다
  const scene = (t: DesigncutTemplate | null) => sceneMode && t !== null && SCENE_TEMPLATES.has(t)
  const empathyAt = acts.indexOf('empathy')
  const solveStart =
    empathyAt === -1
      ? -1
      : rows.findIndex(
          (r, i) => i > empathyAt && acts[i] === 'solve' && r.template !== null && !FIXED_V2[r.template] && !scene(r.template)
        )
  let prevWhite = false
  const bgs = rows.map((r, i): DesigncutBg | null => {
    if (r.template === null) {
      const recolor: DesigncutBg | null = isLightTint(r.keptFill) ? (prevWhite ? 'N' : 'W') : null
      prevWhite = recolor ? recolor === 'W' : isWhite(r.keptFill)
      return recolor
    }
    if (scene(r.template)) {
      // 아래 끝은 사진 — 다음 섹션은 흰색부터(페이드가 사진 아래를 그 바탕으로 녹인다). 흰 띠 여백으로 끝나는 형태 변형은 흰색 다음
      prevWhite = r.bandEnd === true
      return 'W'
    }
    const planned = FIXED_V2[r.template] ?? (i === solveStart ? 'D' : prevWhite ? 'N' : 'W')
    const bg = noDark && planned === 'D' ? (prevWhite ? 'N' : 'W') : planned
    prevWhite = PHOTO_BOTTOM.has(r.template) ? photoIsWhite && r.template !== 'T3c' : bg === 'W'
    return bg
  })
  breakSameRuns(rows, bgs, photoIsWhite, (t) => !scene(t) && !FIXED_V2[t])
  return bgs
}

/** 같은 바탕 연속 상한(적용 D3 P5 T1-21, 통합 11-03 12:40) — K 바탕 예산 W_MAX_RUN과 같은 값 */
export const SAME_BG_RUN_MAX = 4

/** 보이는 바탕 칸 — 흰 사진 바탕(P)과 흰 kept는 흰 면이다. 바탕을 모르는 kept는 제 칸(다른 섹션과 이어지지 않는다) */
function surfaceOf(bg: DesigncutBg | null, row: BgRow, photoIsWhite: boolean, i: number): string {
  if (bg === 'P') return photoIsWhite ? 'W' : 'P'
  if (bg !== null) return bg
  if (isWhite(row.keptFill)) return 'W'
  return row.keptFill ? `kept:${row.keptFill.toLowerCase()}` : `kept:${i}`
}

/**
 * 같은 바탕이 SAME_BG_RUN_MAX보다 길게 이어지면 그 구간 안에서 바꿀 수 있는 흰 섹션 하나를 밝은 스튜디오(N)로 바꾼다(제자리 변경).
 * 바꿀 수 있는 섹션: 템플릿 섹션 · 장면 템플릿·고정 바탕(P·D) 아님 · 지금 W. 장면 섹션·짙은 면·kept는 그대로다(10-31 장면 모드 체계).
 * 고르는 순서: 나눈 양쪽 길이 중 긴 쪽이 가장 짧은 것(구간 끝은 늘 가장 길어 마지막 — 끝을 바꾸면 바깥 N과 붙을 수 있다) → 앞쪽.
 * 구간 안 비장면 W 섹션은 앞이 사진 끝이라 W였고 앞뒤가 흰 면이라, N으로 바꿔도 새 같은 바탕 이웃이 생기지 않는다. 바꿀 섹션이 없으면 그대로다
 */
function breakSameRuns(
  rows: readonly BgRow[],
  bgs: Array<DesigncutBg | null>,
  photoIsWhite: boolean,
  changeable: (template: DesigncutTemplate) => boolean
): void {
  const stuck = new Set<number>()
  for (let guard = 0; guard < rows.length; guard++) {
    const surfaces = bgs.map((bg, i) => surfaceOf(bg, rows[i], photoIsWhite, i))
    let start = -1
    let end = -1
    for (let i = 1, from = 0; i <= surfaces.length; i++) {
      if (i < surfaces.length && surfaces[i] === surfaces[from]) continue
      if (i - from > SAME_BG_RUN_MAX && !stuck.has(from)) {
        start = from
        end = i - 1
        break
      }
      from = i
    }
    if (start === -1) return
    const pick = Array.from({ length: end - start + 1 }, (_, k) => start + k)
      .filter((i) => {
        const t = rows[i].template
        return t !== null && changeable(t) && bgs[i] === 'W'
      })
      .map((i) => ({ i, longer: Math.max(i - start, end - i) }))
      .sort((a, b) => a.longer - b.longer || a.i - b.i)[0]
    if (!pick) {
      stuck.add(start)
      continue
    }
    bgs[pick.i] = 'N'
  }
}

/** 사진 하단 페이드 높이(캔버스 px, 계획 120~180의 가운데) */
export const FADE_H = 140
/** D2 풀폭 장면 사진의 페이드 — 3:4 cover가 이미 위아래를 자르고 상품이 화면 아래쪽까지 차서 짧게 둔다 */
export const SCENE_FADE_H = 80
const HEX = /^#[0-9a-f]{6}$/i

const fadeSvg = (color: string, id: string, height: number) =>
  `<svg viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">` +
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
  `<stop offset="1" stop-color="${color}" stop-opacity="1"/></linearGradient></defs>` +
  `<rect width="${W}" height="${height}" fill="url(#${id})"/></svg>`

/** 섹션 아래 끝의 사진 색 — 바닥까지 닿는 무대 띠, 또는 사진 바탕(P)으로 칠한 사진 템플릿. 아니면 null(단색 끝 — 페이드 없음) */
/** D2 풀폭 장면 사진으로 끝나는 섹션의 아래 끝 표지 — 색을 모르니 다음 바탕과 늘 달라 페이드가 붙는다 */
const SCENE_BOTTOM = 'scene'

/**
 * 섹션 아래 끝이 사진이면 그 색(장면 사진은 SCENE_BOTTOM), 아니면 null. 장면 사진이 있는 섹션은 사진이 바닥에 닿을 때만 —
 * 첫 화면 겹침(D2-3)은 서브를 사진 아래 흰 띠에 두므로 아래 끝이 글자다(페이드가 서브를 덮지 않게)
 */
function photoBottomOf(sec: CanvasSection, photo: string): string | null {
  const scene = sec.elements.find((e) => e.name === 'designcut-scene')
  // 풀폭 장면 사진만 — 본문 폭 사진 타일(큰 POINT grid)이 경계 다듬기로 아래 끝에 닿아도 860 폭 페이드를 덮지 않는다
  if (scene)
    return scene.transform.width >= W - 1 && scene.transform.y + scene.transform.height >= sec.canvas.height - 1 ? SCENE_BOTTOM : null
  const stage = sec.elements.find(
    (e) => e.name === 'designcut-stage' && e.transform.y + e.transform.height >= sec.canvas.height - 1
  )
  if (stage?.shapeProps?.fill) return stage.shapeProps.fill
  const photoLayout = ['designcut_T1', 'designcut_T3a', 'designcut_T8'].includes(sec.layoutId)
  return photoLayout && sec.canvas.backgroundColor.toLowerCase() === photo.toLowerCase() ? photo : null
}

/**
 * 사진으로 끝나는 디자인 컷 섹션 아래를 다음 섹션 바탕으로 녹인다 — 아래 끝 색과 다음 바탕이 다를 때만(같거나 그라데이션이면 그대로).
 * 페이드는 그 섹션 맨 위 z(사진 위)에 두어 사진 아래 가장자리가 경계선으로 보이지 않게 한다. 높이는 늘리지 않는다
 */
export function fadePhotoBottoms(sections: CanvasSection[], photo: string): CanvasSection[] {
  return sections.map((sec, i) => {
    const next = sections[i + 1]
    if (!next || !sec.layoutId.startsWith('designcut_')) return sec
    const bottom = photoBottomOf(sec, photo)
    const to = next.canvas.backgroundColor
    if (!bottom || !HEX.test(to) || bottom.toLowerCase() === to.toLowerCase()) return sec
    const height = bottom === SCENE_BOTTOM ? SCENE_FADE_H : FADE_H
    const fade: CanvasElement = {
      id: uid('svg'),
      type: 'svg',
      name: 'designcut-fade',
      transform: { x: 0, y: sec.canvas.height - height, width: W, height, rotation: 0 },
      zIndex: Math.max(0, ...sec.elements.map((e) => e.zIndex)) + 1,
      isLocked: false,
      isVisible: true,
      opacity: 1,
      svgProps: { svgString: fadeSvg(to, uid('fade'), height) },
    }
    return { ...sec, elements: [...sec.elements, fade] }
  })
}
