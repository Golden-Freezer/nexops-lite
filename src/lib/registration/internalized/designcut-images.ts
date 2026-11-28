/**
 * 디자인 컷 이미지 키(2026-10-28 개정) — 같은 컷은 한 섹션만 쓴다. 이전 계획은 대표 컷(hero)을 히어로·크기·옵션·마무리에
 * 네 번 다시 써서 같은 사진이 액자처럼 되풀이됐다(D P02, 3자 검토 공통).
 * ① 계획: 자기 컷(히어로 hero·POINT features:i·사용법 howto:0)이 먼저 자리를 잡고, 나머지 템플릿은 후보 순서에서 아직 쓰지 않은
 *    제품 등장 컷을 고른다. 후보가 다 쓰였으면 후보와 hero 가운데 페이지에서 덜 쓴 컷을 다시 쓰고, 바로 앞·뒤 섹션과 같은 컷은 피한다(적용 D3 P1 R-P1 —
 *    hero만 되풀이하던 자리, 새 컷 없음). T7은 옵션 실물 사진(칩)이라 컷이 없다.
 * ② 생성: 디자인 컷이 그리는 키 + 템플릿이 못 그릴 때 대체되는 기존 섹션(compose pushExisting)과 kept 섹션이 쓰는 키만 만든다.
 *    기존 섹션의 키를 모르는 섹션이 하나라도 있으면 거르지 않는다(전부 생성 — 기존 동작).
 */

import { SECTION_IMAGE_MAPPING } from '../editor/constants/sectionConfig'
import type { DesigncutPlan, DesigncutSection } from '../pdp-state'

/** 제품이 나오는 컷 후보(효과 전용 컷 problem·empathy_scene 등은 제품 자리에 못 쓴다). 앞이 선호 */
const POOL: Partial<Record<DesigncutSection['template'], string[]>> = {
  // POINT 중 자기 피처 컷이 없는 장 — 다른 각도의 제품 단독 컷이 먼저
  T3a: ['product_exposure', 'solution', 'usage', 'premium_hero'],
  // 치수 도식은 제품 단독 컷 위에 그린다(size_comparison은 AI가 그린 화살표가 있어 도식과 겹친다)
  T6: ['product_exposure', 'premium_hero'],
  // 마무리는 구매 장면 컷(cta) → 사용 장면
  T8: ['cta', 'usage', 'solution'],
}
/** Pro 모드에서만 생성하는 컷(pdp-image-tasks buildProTasks) */
const PRO_ONLY = new Set(['product_exposure', 'premium_hero'])
const OWN_KEY = /^(hero|features:\d+|howto:\d+)$/
const HERO_KEY = 'hero'

/**
 * 템플릿별 제품 컷 키 배정 — 자기 컷은 그대로, 대표 컷을 빌려 쓰던 자리(T3a 컷 없는 장·T6·T8)는 후보에서 고르고 T7은 비운다.
 * 후보를 다 쓴 자리는 후보·hero 중 쓰임 수가 가장 적은 컷이다(같으면 후보 순서, hero는 맨 뒤). 바로 앞 섹션이 받은 컷과 바로 뒤 섹션의 자기 컷은 고르지 않는다.
 * pieces는 페이지 순서다. 같은 입력이면 같은 결과(결정론).
 */
export function assignImageKeys<T extends Pick<DesigncutSection, 'template' | 'productImageKey'>>(
  pieces: T[],
  pro: boolean
): T[] {
  const used = new Set(
    pieces.map((p) => p.productImageKey).filter((k): k is string => !!k && k !== 'hero' && OWN_KEY.test(k))
  )
  if (pieces.some((p) => p.template === 'T1')) used.add('hero')
  const borrows = (p: T) => p.template !== 'T7' && POOL[p.template] !== undefined && p.productImageKey === HERO_KEY && p.template !== 'T1'
  // 쓰임 수 — 빌리지 않는 섹션의 컷을 먼저 세고, 배정하면서 더한다
  const uses = new Map<string, number>()
  const addUse = (key: string | null) => key && uses.set(key, (uses.get(key) ?? 0) + 1)
  for (const p of pieces) if (p.template !== 'T7' && !borrows(p)) addUse(p.productImageKey)
  const out: T[] = []
  pieces.forEach((p, i) => {
    if (p.template === 'T7') return void out.push({ ...p, productImageKey: null })
    if (!borrows(p)) return void out.push(p)
    const allowed = POOL[p.template]!.filter((k) => pro || !PRO_ONLY.has(k))
    const fresh = allowed.find((k) => !used.has(k))
    const next = pieces[i + 1]
    const near = new Set([out[i - 1]?.productImageKey, next && !borrows(next) ? next.productImageKey : null])
    const reuse = [...allowed, HERO_KEY].filter((k) => !near.has(k))
    const key = fresh ?? reuse.reduce<string>((best, k) => ((uses.get(k) ?? 0) < (uses.get(best) ?? 0) ? k : best), reuse[0] ?? HERO_KEY)
    used.add(key)
    addUse(key)
    out.push({ ...p, productImageKey: key })
  })
  return out
}

/**
 * 기존 빌더 섹션이 쓰는 이미지 태스크 — sectionConfig SECTION_IMAGE_MAPPING + 빌더의 allImages 읽기(sections.ts:
 * main_cut usp_icons·대표 컷 대체, POINT 계열 피처 슬롯, 사용법 단계별 컷, 옵션 갤러리 묶음·대표 컷, 인증 배지·평점 바탕).
 * 'x:*'는 그 접두어의 모든 키. 알 수 없는 섹션 키는 null.
 */
export function legacyImageTasks(key: string): string[] | null {
  const mapping = SECTION_IMAGE_MAPPING[key]
  if (!mapping) return null
  const image = mapping.imageKey
  // conversion_cta는 생성 키가 아니라 cta의 별칭이다(editor-data — Pro 전환 컷은 cta를 다시 쓴다)
  const alias: Record<string, string> = { conversion_cta: 'cta' }
  const base =
    image === ''
      ? []
      : /^feature_\d+$/.test(image)
        ? ['features:*']
        : /^howto_\d+$/.test(image)
          ? ['howto:*']
          : [alias[image] ?? image]
  const extra: Record<string, string[]> = {
    main_cut: ['hero', 'usp_icons:*'],
    petit_div: ['option_bundle', 'hero'],
    certification: ['certification_badge'],
    perf_rating: ['rating_bg'],
  }
  return [...base.filter((k) => k !== 'options'), ...(extra[key] ?? [])]
}

/**
 * 사진 없는 글 템플릿 — 계획 단계가 그릴 내용(고민 문장 2개 이상·체크 항목 3개 이상·후기 카드 1장 이상)을 이미 확인해 조립에서 기존 섹션으로 대체되지
 * 않는다. 그래서 대체용 기존 섹션 컷(problem·solution 등)을 미리 만들지 않는다(2026-10-31 통합 점검 — R5-D 구디백 c7afd0b3은 만든 컷
 * 8장 중 problem·solution 2장을 어느 템플릿도 쓰지 않았다)
 */
const TEXT_ONLY_TEMPLATES = new Set(['T2', 'T4', 'T12'])

/**
 * 디자인 컷 잡이 생성할 이미지 태스크 판정 — 계획이 그리는 키(제품 컷·플레이트·장식 대상) + 대체·kept 기존 섹션의 키 + hero(다른 컷의
 * 스타일 참조). 사진 없는 글 템플릿은 대체 키를 더하지 않는다. 기존 섹션 키를 모르는 섹션이 있으면 null(거르지 않는다).
 */
export function designcutTaskFilter(plan: DesigncutPlan): ((section: string) => boolean) | null {
  const exact = new Set<string>(['hero'])
  const prefixes = new Set<string>()
  const add = (key: string) => (key.endsWith(':*') ? prefixes.add(key.slice(0, -2)) : exact.add(key))
  for (const s of plan.sections) {
    if (s.productImageKey) add(s.productImageKey)
    if (s.plateKey) add(s.plateKey)
    for (const m of s.modules) {
      if (m.type === 'M2b') add(m.data.imageKey)
      // 긴 페이지 자세히 보기(T10) — 이미지 쪽 기록(extra_shots)에서 계획이 실은 컷만(계획 ∩ 이미지 쪽 기록)
      if (m.type === 'M10') m.data.scenes.forEach((scene) => add(scene.imageKey))
      // D2 자세히 보기(T11) — 항목마다 자기 피처 컷
      if (m.type === 'M11') m.data.items.forEach((item) => item.imageKey && add(item.imageKey))
    }
    // usp 조각(point_div:<i>)과 긴 막(long:<종류>)은 기존 섹션으로 대체하지 않는다(compose — POINT 전체라 중복, 긴 막은 기존 섹션 없음)
    if (s.key.includes(':') || TEXT_ONLY_TEMPLATES.has(s.template)) continue
    const legacy = legacyImageTasks(s.key)
    if (!legacy) return null
    legacy.forEach(add)
  }
  for (const key of plan.kept) {
    const legacy = legacyImageTasks(key)
    if (!legacy) return null
    legacy.forEach(add)
  }
  return (section) => exact.has(section) || prefixes.has(section.split(':')[0])
}
