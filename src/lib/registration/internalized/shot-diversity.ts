/**
 * 컷 목적 다양화(shotdiv, 오너 지시 2026-10-31 — R9 심사 '손으로 든 같은 봉투 사진이 8장 넘게 되풀이', '입체 바닥인데 바닥 모양이 안
 * 보임', '캡션은 브러쉬를 말하는데 사진에는 손만') — 디자인 컷 잡의 컷마다 '새로 보여 줄 것' 하나를 정한다. 순수·결정론이고, images 단계
 * 첫 run이 디자인 컷 계획 직전에 section_plan.extra_shots로 기록한다(pdp-image-stage).
 * ① POINT 특징 컷(features:i, POINT가 쓰는 장 수): 주제(render-aware featureSubjects)가 구조·소재·크기를 말하면 그것을 보여 주는 증명
 *    목적(밑면·안쪽 / 근접 질감 / 크기 비교), 손으로 하는 동작을 말하면 손 동작. 같은 목적은 페이지에 한 번이다 — 제목 낱말이 먼저,
 *    설명 낱말이 다음. 맞는 목적이 없거나 이미 쓴 목적이면 서로 다른 앵글 하나씩(angle)
 * ② 추가 컷(shots — C 디자인 컷 계획이 T10 '구석구석 보면' 막으로 싣는다, 2장 이상이면): 실사용 → 디테일 → 남은 증명 순으로 늘 2장
 *    이상(오너 지시 10-31 '실사용컷이나 디테일컷 등을 활용', POINT 최대 3 구조).
 *    - 실사용(long_scene:0): 사용 장면 태그 첫째(태그가 하나뿐이어도), 태그가 없으면 일상 사용 장면
 *    - 디테일: 근접 질감, POINT가 질감을 썼으면 밑면(구조 근거가 있을 때), 둘 다 못 쓰면 질감을 한 번 더(같은 목적 한 번의 유일한 예외 —
 *      구도 중복 판정은 그대로). 질감은 근거가 없어도 상품 표면 근접으로 만든다
 *    - 남은 증명: POINT·디테일이 쓰지 않은 밑면·크기 비교·질감 가운데 근거가 있는 것(근거 없는 밑면은 만들지 않는다)
 *    키는 features:N(POINT·자세히 보기 컷 다음 번호, 4 이상 — d2FeatureCutsOf)·long_scene:0
 * ④ 캡션 검사(기록만): 띄어쓰기 없이 7음절 넘게 붙은 한글 덩어리(붙어쓰기 의심), 캡션과 그 컷 목적 낱말이 하나도 맞지 않는 짝
 * 컷 프롬프트 블록(applyShotPurpose)과 구도 중복 재생성 지시(withAngleRetry)도 여기 둔다 — 디자인 컷 장면 블록 뒤에 붙는다
 */

import type { CopywritingResult } from '../editor/types/editor'
import { isFactClaimSafe } from '../eval/claim-lexicon'
import { COPY_DEFAULT_SCENE_TAGS, longSceneKey, longSceneTags } from '../long-sections'
import type { DesigncutPlan, ExtraShotPlan, ExtraShotPurpose, PdpJobRow, PointShotPurpose } from '../pdp-state'
import { hasEnrichmentFeature } from '../enrichment-switch'
import { buildDesigncutPlan, d2FeatureCutsOf, designcut2Enabled, designcutEnabled } from './designcut-plan'
import { D2_SECTION_TARGET, FILL_MESSAGE_ROLE } from './designcut-fill'
import { D2_BIG_POINTS } from './designcut-structure'
import { featureSubjects } from './render-aware-cuts'
import { ACTION_RE, MATERIAL_RE, PLACE_RE, SIZE_RE, STRUCTURE_RE, materialWords, purposesIn, type ProofPurpose } from './shot-words'
import { namedIngredientsOf } from '../templatelib/input-values'
import { judgeProductFamily } from '../templatelib/product-family'
import { CONTACT_LINE, familyShotLine, sizeLine, SIZE_PURPOSES } from '../templatelib/shot-brief'

/** designcut과 shotdiv가 함께 기록된 잡(switch가 designcut 없는 shotdiv를 기록하지 않는다) */
export function shotdivEnabled(job: PdpJobRow): boolean {
  return designcutEnabled(job) && (job.section_plan?.enrichment?.features ?? []).includes('shotdiv')
}

/** 디자인 컷 비교군(D1)의 피처 컷 수(pdp-image-tasks FEATURE_CAP) — D2는 계획 POINT가 쓰는 만큼 */
const D1_FEATURE_CUTS = 4
/** 추가 컷 features:N의 첫 번호 하한 — C 계획의 읽기가 N ≥ 4만 받는다(L-2 매크로 자리와 같은 출발) */
const EXTRA_FEATURE_FROM = 4

/**
 * POINT가 쓰는 피처 컷 수 — extra_shots 기록 전 계획으로 잰다(T10 막은 productImageKey가 아니라 d2FeatureCutsOf와 무관하다). 순수
 */
export function pointCutsOf(job: PdpJobRow): number {
  return designcut2Enabled(job) ? d2FeatureCutsOf(buildDesigncutPlan(job)) : D1_FEATURE_CUTS
}

const textOf = (v: unknown) => (typeof v === 'string' ? v : '')

/** 앵글(맞는 목적이 없는 POINT 컷) — 첫 화면(눈높이 3/4 중간 거리)과 겹치지 않는 넷, 앞부터 하나씩 */
export const SHOT_ANGLES = [
  'a straight side profile at table height',
  'a top-down view looking straight down at the product',
  'a high three-quarter view, closer than the first-screen cut',
  'a low angle from the front edge of the surface',
] as const

/**
 * 길이 채움 컷의 앵글(D2, 오너 지시 2026-11-01) — POINT 앵글 번호 뒤에 이어 붙는다. 캡션은 번호 순서대로 사진을 있는 그대로 말하는 고정 글이다
 * (사실 입력이 필요 없고 카피를 새로 쓰지 않는다)
 */
export const FILL_ANGLES = [
  'from behind — the side the first-screen cut does not show, the whole product still in frame',
  'a tight crop of one working part or edge of the product, the rest falling out of frame',
  'a wider view — the whole product smaller in the frame, with more of the surrounding set visible',
  'the product resting as it would sit between uses, seen from a natural standing height',
] as const
const ALL_ANGLES: readonly string[] = [...SHOT_ANGLES, ...FILL_ANGLES]
const ANGLE_CAPTIONS = ['옆에서 본 모습', '위에서 본 모습', '비스듬히 본 모습', '낮은 곳에서 본 모습', '뒤에서 본 모습', '가까이 본 부분', '넓게 본 모습', '놓아 둔 모습']
/** 채움 앵글을 쓰는 순서 — 새 앵글 먼저, 그다음 POINT가 쓰지 않은 앵글 */
const FILL_ANGLE_ORDER = [4, 5, 6, 7, 0, 1, 2, 3]

/** 컷이 꼭 보여 줄 주장 글 상한(목적 블록의 show 줄) */
const SHOW_MAX = 80
/** 주장 글(제목 — 설명) — 목적이 주장 대상을 지우지 않게 목적 블록에 다시 적는다(R10-L-P02 POINT 06 '커피와 간식'에 커피가 없었다) */
const showOf = (title: string, description = ''): string => {
  const text = [title.trim(), description.trim()].filter(Boolean).join(' — ')
  return text.length > SHOW_MAX ? `${text.slice(0, SHOW_MAX)}…` : text
}

/**
 * POINT 특징 컷 목적 — 제목이 장소·상황을 말하면 먼저 장면 컷(장소가 달라 여러 번도 된다), 그다음 제목 낱말로 한 바퀴, 설명 낱말로 한 바퀴
 * (같은 목적은 한 번), 남으면 앵글. show = 그 컷 주제 글
 */
function planPoints(
  subjects: ReadonlyArray<{ title: string; description: string }>,
  hasSize: boolean,
  materials: readonly string[]
): ExtraShotPlan['points'] {
  const used = new Set<string>()
  const picks: Array<PointShotPurpose | null> = subjects.map((s) => (PLACE_RE.test(s.title) ? 'scene' : null))
  for (const field of ['title', 'description'] as const) {
    subjects.forEach((s, i) => {
      if (picks[i]) return
      const hit = purposesIn(s[field], hasSize, materials).find((p) => !used.has(p))
      if (hit) {
        picks[i] = hit
        used.add(hit)
      }
    })
  }
  let angle = 0
  return subjects.map((s, i) => {
    const purpose = picks[i]
    const show = showOf(s.title, s.description)
    return {
      key: `features:${i}`,
      ...(purpose ? { purpose } : { purpose: 'angle' as const, angle: angle++ % SHOT_ANGLES.length }),
      ...(show ? { show } : {}),
    }
  })
}

/** 카피·사양에서 목적의 근거 위치 — POINT 주제(앞 pointCount개)는 그 컷이 이미 보여 주므로 뺀다 */
function proofOf(copy: CopywritingResult, job: PdpJobRow, purpose: ProofPurpose, pointCount: number): string | null {
  const spec = job.spec_sheet
  if (purpose === 'scale') return textOf(spec.size).trim() ? 'spec.size' : null
  const materials = materialWords(textOf(spec.material))
  if (purpose === 'texture' && materials.length > 0) return 'spec.material'
  const re = purpose === 'underside' ? STRUCTURE_RE : MATERIAL_RE
  const points = (copy.detailPoints ?? []) as Array<Record<string, unknown>>
  for (let j = pointCount; j < points.length; j++) {
    if (re.test([points[j]?.claim, points[j]?.benefit, points[j]?.proof].map(textOf).join(' '))) return `detailPoints[${j}]`
  }
  const extra = (spec.extraSpecs ?? []).findIndex((e) => re.test(`${textOf(e?.key)} ${textOf(e?.value)}`))
  return extra >= 0 ? `spec.extraSpecs[${extra}]` : null
}

/** 추가 컷 캡션 — 목적 낱말을 담은 짧은 글(사양 값은 짧을 때만 붙인다). 사용 장면은 태그 그대로 */
function captionOf(purpose: ProofPurpose, job: PdpJobRow): string {
  const plain = (v: unknown) => textOf(v).replace(/\([^)]*\)/g, '').trim()
  const size = plain(job.spec_sheet.size)
  const material = plain(job.spec_sheet.material)
  if (purpose === 'scale') return size && size.length <= 16 ? `실제 크기 ${size}` : '실제 크기 비교'
  if (purpose === 'texture') {
    const safe = material && material.length <= 8 && isFactClaimSafe(material, job.spec_sheet.certificationInfo)
    return safe ? `가까이 본 ${material} 소재` : '가까이 본 소재'
  }
  return '밑면과 안쪽까지'
}

/** 붙어쓰기 의심 — 띄어쓰기 없이 이어진 한글 7음절 이상('사워중두피마사지') */
const UNSPACED_RE = /[가-힣]{7,}/g
/** 막 제목은 큰 글자라 다섯 음절만 붙어도 읽기 어렵다(R17 '거실밥자리'·'퇴근후샤워'). 태그는 해시태그 값이라 붙어 올 수 있다 */
const UNSPACED_TITLE_RE = /[가-힣]{5,}/
const PURPOSE_CAPTION_RE: Record<Exclude<PointShotPurpose, 'angle'>, RegExp> = {
  underside: STRUCTURE_RE,
  texture: MATERIAL_RE,
  scale: SIZE_RE,
  action: ACTION_RE,
  scene: PLACE_RE,
}
const EXAMPLE_MAX = 5

/** ④ 캡션 검사 — 추가 컷 캡션·POINT 제목(그 컷의 캡션)·사용 장면 태그. 사용 장면 짝은 태그 그대로라 맞춤에서 뺀다 */
function checkCaptions(
  shots: ExtraShotPlan['shots'],
  points: ExtraShotPlan['points'],
  subjects: ReadonlyArray<{ title: string }>,
  tags: readonly unknown[],
  materials: readonly string[]
): ExtraShotPlan['captions'] {
  const items: Array<{ where: string; text: string; purpose?: Exclude<PointShotPurpose, 'angle'> }> = [
    ...shots.map((s) => ({
      where: s.key,
      text: s.caption ?? '',
      ...(s.purpose !== 'scene' && s.purpose !== 'angle' ? { purpose: s.purpose } : {}),
    })),
    ...points.map((p, i) => ({
      where: p.key,
      text: subjects[i]?.title ?? '',
      ...(p.purpose !== 'angle' ? { purpose: p.purpose } : {}),
    })),
    ...tags.map((t, i) => ({ where: `usageSceneTags[${i}]`, text: textOf(t) })),
  ].filter((x) => x.text.trim())
  const unspaced = items.flatMap((x) => (x.text.match(UNSPACED_RE) ?? []).map((run) => `${x.where}:${run}`))
  const mismatched = items
    .filter((x) => x.purpose)
    .filter((x) => {
      const re = PURPOSE_CAPTION_RE[x.purpose!]
      return !re.test(x.text) && !(x.purpose === 'texture' && materials.some((w) => x.text.includes(w)))
    })
    .map((x) => x.where)
  return { checked: items.length, unspaced: unspaced.slice(0, EXAMPLE_MAX), mismatched: mismatched.slice(0, EXAMPLE_MAX) }
}

/** 사용 장면 태그가 없을 때의 실사용 컷 장면·캡션 */
const EVERYDAY_SCENE = '일상 속 사용 모습'

/**
 * 실사용 컷 장면 — 긴 페이지 사용 장면 태그 첫째, 없으면(태그 하나뿐·태그 섹션이 있는 골격) 카피 태그 첫째. 카피 기본값 태그('일상' 등)는
 * 상품 근거가 아니라 쓰지 않는다. 없으면 null
 */
function sceneTagOf(usageSceneTags: unknown, sectionOrder: readonly string[]): string | null {
  const first = longSceneTags(usageSceneTags, sectionOrder)[0]
  if (first) return first
  const raw = Array.isArray(usageSceneTags) ? usageSceneTags : []
  return raw.map((t) => textOf(t).replace(/^#+/, '').trim()).find((t) => t && !COPY_DEFAULT_SCENE_TAGS.has(t)) ?? null
}

/** 태그 전부(기본값 제외, 중복 제거) — 길이 채움 사용 장면 */
function allSceneTags(usageSceneTags: unknown): string[] {
  const raw = Array.isArray(usageSceneTags) ? usageSceneTags : []
  return [...new Set(raw.map((t) => textOf(t).replace(/^#+/, '').trim()).filter((t) => t && !COPY_DEFAULT_SCENE_TAGS.has(t)))]
}

/**
 * 컷 목적 계획 — pointCount = POINT가 쓰는 피처 컷 수(pointCutsOf). 최종 카피가 없으면 null(기록하지 않는다).
 * fill = 길이 채움 컷 수(D2) — 남은 사용 장면 태그와 앵글을 번갈아 더한다. 같은 말을 늘리지 않고 사실도 요구하지 않는다
 */
export function planExtraShots(job: PdpJobRow, pointCount: number, { fill = 0 }: { fill?: number } = {}): ExtraShotPlan | null {
  const copy = job.copy_sections?.final as unknown as CopywritingResult | undefined
  if (!copy) return null
  const spec = job.spec_sheet
  const hasSize = Boolean(textOf(spec.size).trim())
  const materials = materialWords(textOf(spec.material))
  const subjects = featureSubjects(copy, pointCount)
  const points = planPoints(subjects, hasSize, materials)
  const used = new Set<string>(points.map((p) => p.purpose))

  const shots: ExtraShotPlan['shots'] = []
  let next = Math.max(EXTRA_FEATURE_FROM, pointCount)
  const pushProof = (purpose: ProofPurpose, proves: string) => {
    // 카피 주장이 근거면 그 주장 글도 — 사양 값·근거 없는 디테일이면 목적 줄만으로 충분하다
    const claim = /^detailPoints\[(\d+)\]$/.exec(proves)
    const point = claim ? ((copy.detailPoints ?? [])[Number(claim[1])] as Record<string, unknown> | undefined) : undefined
    const show = point ? showOf(textOf(point.claim), textOf(point.benefit)) : ''
    shots.push({ key: `features:${next++}`, purpose, proves, caption: captionOf(purpose, job), ...(show ? { show } : {}) })
  }
  const proof = (purpose: ProofPurpose) => proofOf(copy, job, purpose, subjects.length)

  // ① 실사용 — 늘 첫 장(태그가 하나뿐이어도, 없으면 일상 사용 장면)
  const tag = sceneTagOf(copy.usageSceneTags, job.section_plan?.section_order ?? [])
  shots.push({ key: longSceneKey(0), purpose: 'scene', proves: tag ? 'usageSceneTags' : 'everyday', caption: tag ?? EVERYDAY_SCENE })
  // ② 디테일 — 질감 → 밑면(근거 있을 때) → 질감 한 번 더. 질감은 근거가 없어도 상품 표면 근접(proves 'detail')
  const underside = used.has('underside') ? null : proof('underside')
  const detail: ProofPurpose = !used.has('texture') || !underside ? 'texture' : 'underside'
  pushProof(detail, detail === 'underside' ? underside! : (proof('texture') ?? 'detail'))
  // ③ 남은 증명 — POINT·디테일이 쓰지 않은 목적 가운데 근거가 있는 것(같은 목적 한 번)
  for (const purpose of ['underside', 'scale', 'texture'] as const) {
    if (used.has(purpose) || purpose === detail) continue
    const proves = proof(purpose)
    if (proves) pushProof(purpose, proves)
  }
  // ④ 길이 채움 — 사용 장면 태그와 앵글을 번갈아, 한쪽이 떨어지면 다른 쪽으로
  const tags = allSceneTags(copy.usageSceneTags).filter((t) => t !== tag)
  const pointAngles = new Set(points.flatMap((p) => (p.purpose === 'angle' ? [p.angle] : [])))
  const angles = FILL_ANGLE_ORDER.filter((a) => !pointAngles.has(a))
  let scene = 0
  let angle = 0
  for (let i = 0; i < fill; i++) {
    const useScene = scene < tags.length && (i % 2 === 0 || angle >= angles.length)
    if (useScene) {
      shots.push({ key: longSceneKey(scene + 1), purpose: 'scene', proves: 'usageSceneTags', caption: tags[scene] })
      scene++
    } else if (angle < angles.length) {
      const a = angles[angle++]
      shots.push({ key: `features:${next++}`, purpose: 'angle', proves: 'fill', caption: ANGLE_CAPTIONS[a], angle: a })
    }
  }

  return {
    version: 1,
    shots,
    points,
    captions: checkCaptions(shots, points, subjects, Array.isArray(copy.usageSceneTags) ? copy.usageSceneTags : [], materials),
  }
}

export { D2_SECTION_TARGET }

/**
 * D2 잡의 컷 목적 계획 — 기본 계획을 얹은 디자인 컷 계획의 섹션 수를 세어 목표까지 채움 컷을 더한다(컷 하나가 섹션 하나). D2가 아니면 기본 계획 그대로.
 * 태그·앵글이 모자라면 그만큼 덜 채운다 — 같은 컷을 되풀이하지 않는다.
 * 근거 없는 역할이 빠져 짧아진 상품일수록 많이 채운다
 */
export function planExtraShotsForLength(job: PdpJobRow, pointCount: number): ExtraShotPlan | null {
  const base = planExtraShots(job, pointCount)
  if (!base || !designcut2Enabled(job)) return base
  if (fillactsEnabled(job)) return planFillActs(job, pointCount, base)
  const plan = buildDesigncutPlan({ ...job, section_plan: { ...job.section_plan, extra_shots: base } })
  const need = plan ? D2_SECTION_TARGET - (plan.sections.length + plan.kept.length) : 0
  return need > 0 ? planExtraShots(job, pointCount, { fill: need }) : base
}

/** 채움 재설계 스위치 — D2 잡만 */
export function fillactsEnabled(job: PdpJobRow): boolean {
  return designcut2Enabled(job) && hasEnrichmentFeature(job.analysis, 'fillacts')
}

/** 막 제목 — 장면 태그가 없거나 붙어 쓴 태그일 때. 사실을 말하지 않는다 */
export const FILL_ACT_TITLES = ['구석구석 보면', '한 번 더 보면'] as const
/** 막의 앵글 컷(ALL_ANGLES 번호) — 태그·증명이 모자랄 때만. 뒤에서 본 컷(4)은 쓰지 않는다: 뒷면을 보여 준 컷이 없었다(R14 3상품) */
const ACT_WIDE_ANGLE = 6
const ACT_CLOSE_ANGLE = 5

/**
 * 채움 재설계(fillacts, 통합 결정 2026-11-01 — R14 사진 막 7~8개가 r4를 떨어뜨렸다, 재분석 3절) — 막 2개(각 실사용 1·디테일 1)와 큰 POINT마다 사진 한 장.
 * 막에 고정 캡션을 달지 않는다. 카피는 새로 쓰지 않는다. 같은 컷을 되풀이하지 않고 태그·증명이 모자라면 앵글 컷으로 채운다
 */
function planFillActs(job: PdpJobRow, pointCount: number, base: ExtraShotPlan): ExtraShotPlan {
  const copy = job.copy_sections.final as unknown as CopywritingResult
  const subjects = featureSubjects(copy, pointCount)
  const scene = base.shots.find((s) => s.purpose === 'scene')!
  const details = base.shots.filter((s) => s.purpose !== 'scene')
  const used = details.map((s) => Number(s.key.split(':')[1]))
  let next = Math.max(EXTRA_FEATURE_FROM, pointCount, ...used.map((n) => n + 1))
  const angleShot = (angle: number): ExtraShotPlan['shots'][number] => ({
    key: `features:${next++}`,
    purpose: 'angle',
    proves: 'fill',
    caption: ANGLE_CAPTIONS[angle],
    angle,
  })
  const firstTag = scene.proves === 'usageSceneTags' ? (scene.caption ?? null) : null
  const secondTag = allSceneTags(copy.usageSceneTags).find((t) => t !== firstTag) ?? null
  const secondScene: ExtraShotPlan['shots'][number] = secondTag
    ? { key: longSceneKey(1), purpose: 'scene', proves: 'usageSceneTags', caption: secondTag }
    : angleShot(ACT_WIDE_ANGLE)
  const secondDetail = details[1] ?? angleShot(ACT_CLOSE_ANGLE)
  const titleOf = (tag: string | null, i: number) => (tag && !UNSPACED_TITLE_RE.test(tag) ? tag : FILL_ACT_TITLES[i])

  const pointAngles = new Set(base.points.flatMap((p) => (p.purpose === 'angle' ? [p.angle] : [])))
  const freeAngle = SHOT_ANGLES.findIndex((_, a) => !pointAngles.has(a))
  const pointShots = base.points.slice(0, D2_BIG_POINTS).map((p, i): ExtraShotPlan['shots'][number] => {
    const subject = subjects[i]
    const text = `${subject?.title ?? ''} ${subject?.description ?? ''}`
    const purpose = p.purpose !== 'action' && ACTION_RE.test(text) ? 'action' : p.purpose !== 'texture' ? 'texture' : 'angle'
    return {
      key: `features:${next++}`,
      purpose,
      proves: `detailPoints[${i}]`,
      caption: subject?.title ?? '',
      ...(p.show ? { show: p.show } : {}),
      ...(purpose === 'angle' ? { angle: Math.max(0, freeAngle) } : {}),
      point: i,
    }
  })
  const shots = [scene, details[0], secondScene, secondDetail, ...pointShots]
  const acts = [
    { title: titleOf(firstTag, 0), keys: [scene.key, details[0].key] },
    { title: titleOf(secondTag, 1), keys: [secondScene.key, secondDetail.key] },
  ]
  // 메시지 섹션(designcut-fill) 컷 — 계획이 고른 메시지 글을 주제로 만든다. 움직임을 말하면 손이 쓰는 순간, 아니면 페이지에 없는 각도(뒤에서 본 컷 제외)
  const draft = buildDesigncutPlan({ ...job, section_plan: { ...job.section_plan, extra_shots: { ...base, shots, acts } } })
  const messageAngles = [ACT_WIDE_ANGLE, ...SHOT_ANGLES.map((_, a) => a).filter((a) => !pointAngles.has(a))]
  ;(draft?.sections ?? [])
    .filter((s) => s.role === FILL_MESSAGE_ROLE)
    .forEach((s, i) => {
      const text = `${s.text.headline ?? ''} ${s.text.sub ?? ''}`.replace(/\s*\n\s*/g, ' ')
      const action = ACTION_RE.test(text)
      shots.push({
        key: `features:${next++}`,
        purpose: action ? 'action' : 'angle',
        proves: 'message',
        caption: (s.text.headline ?? '').replace(/\s*\n\s*/g, ' '),
        show: showOf(s.text.headline ?? '', s.text.sub ?? ''),
        ...(action ? {} : { angle: messageAngles[i % messageAngles.length] }),
        message: s.key,
      })
    })
  return {
    ...base,
    shots,
    acts,
    captions: checkCaptions(shots, base.points, subjects, Array.isArray(copy.usageSceneTags) ? copy.usageSceneTags : [], materialWords(textOf(job.spec_sheet.material))),
  }
}

/**
 * 디자인 컷 계획이 실제로 그리는 이미지 키 — 섹션 상품 컷과 모듈 데이터의 imageKey(사진 칸·T10 막 컷 scenes[].imageKey). 모듈 모양은
 * C 계획 소관이라 이름이 imageKey인 칸만 너그럽게 읽는다. 계획이 없으면 빈 모음
 */
export function designcutDrawnKeys(plan: DesigncutPlan | null | undefined): Set<string> {
  const keys = new Set<string>()
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit)
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (k === 'imageKey' && typeof x === 'string') keys.add(x)
      else if (typeof x === 'object') visit(x)
    }
  }
  for (const s of plan?.sections ?? []) {
    if (s.productImageKey) keys.add(s.productImageKey)
    visit(s.modules.map((m) => m.data))
  }
  return keys
}

/** 기록된 계획 읽기 — 모양이 틀리면 null(구 잡·손상 기록) */
export function readExtraShots(raw: unknown): ExtraShotPlan | null {
  const r = raw as Partial<ExtraShotPlan> | null | undefined
  if (!r || r.version !== 1 || !Array.isArray(r.shots) || !Array.isArray(r.points)) return null
  return r as ExtraShotPlan
}

// ─── 컷 프롬프트 — 디자인 컷 장면 블록(applyD2SceneCut) 뒤에 붙어 거리 지시를 이긴다 ───

const PURPOSE_HEADER = '[Shot purpose]'
const purposeRule = (keep: string) =>
  `This block wins over the shot distance and framing above for this cut only. Keep the ${keep}. Show only product structure ` +
  'the original photo shows or clearly implies — never invent hidden parts, colors, patterns or printed text.'
const PURPOSE_RULE = purposeRule('shared set, light and the exact product identity')
/** 장면 컷은 세트를 떠나므로 세트를 지키라고 하지 않는다 */
const SCENE_RULE = purposeRule('light and the exact product identity')
/** 앵글 컷도 그 항목의 뜻을 그린다 — 각도만 바꾼 정물은 글과 따로 논다(자세히 보기 28항목 중 21개) */
const MEANING_LINE =
  'Make the meaning of this feature readable from the picture alone: show the situation, object or effect it describes, not ' +
  'just another view of the product. An adult hand may appear if it helps (no face).'
/** 주장 글 줄 — 목적은 카메라 각도·거리만 바꾸고, 주장이 말하는 물건·음식·장면은 화면에 남긴다(그리지 않는 참고 글) */
const showLine = (show: string) =>
  `Feature this cut must show (reference only, never drawn as text): ${show}. The purpose above changes only the camera ` +
  'angle and distance — every object, food or scene this feature names stays clearly in the frame next to the product.'
const NO_HAND = 'The product rests in the set — no hand holds it.'
const PURPOSE_LINES: Record<ExtraShotPurpose | 'action', string> = {
  underside:
    'Show what the other cuts of this page hide — the bottom, the inside or the opening — turned toward the camera so it ' +
    `fills most of the frame. ${NO_HAND}`,
  texture: `Macro close-up of the material and surface finish under soft raking light; the texture fills the frame. ${NO_HAND}`,
  scale:
    'Show the true size: the product beside an adult hand or a plain everyday object of known size (a mug, a pen), in the ' +
    'real proportions of the size below. No rulers, arrows or numbers drawn in the image.',
  action: 'Show the feature at the moment of use — one adult hand operating it (no face), the working part clearly visible.',
  scene: 'Show the product in use in this different place or situation — not the set of the other cuts and not a held-up product shot.',
  angle: '',
}

/** 컷의 목적(기록에 없으면 null) — 추가 컷은 shots, POINT 컷은 points */
export function shotPurposeOf(plan: ExtraShotPlan | null, section: string) {
  if (!plan) return null
  return plan.shots.find((s) => s.key === section) ?? plan.points.find((p) => p.key === section) ?? null
}

/** 목적 블록이 읽는 상품 값(적용 D4 ⓑ) — 제품군(K 선택과 같은 판정)과 입력에 이름이 적힌 재료(규제 표현 거름). 제품군 문장만 읽는다 */
export interface ShotPurposeContext {
  family?: string | null
  ingredients?: readonly string[]
}

/** 잡의 목적 블록 값 — 카테고리는 K 선택(select-line)과 같은 순서(감지 → 사양 카테고리), 재료 이름 거르기는 K 컷 태스크와 같다 */
export function shotPurposeContextOf(job: PdpJobRow): ShotPurposeContext {
  const spec = job.spec_sheet
  const categoryKey = job.analysis.detected_category?.trim() || spec.category?.trim() || ''
  return {
    family: judgeProductFamily(categoryKey, spec) ?? null,
    ingredients: namedIngredientsOf(spec).filter((name) => isFactClaimSafe(name, spec.certificationInfo)),
  }
}

/** 손이 나오는 목적 — 접촉 줄을 받는다(K 손·몸 구도와 같은 문장) */
const HAND_PURPOSES: ReadonlySet<string> = new Set(['action', 'scale'])

/**
 * 목적 블록을 붙인 프롬프트 — 목적이 없는 컷은 그대로. size = 사양 크기(그리지 않는 참고값).
 * 기록에 주장 글(show)이 있으면 목적이 그 대상을 지우지 않게 맨 끝에 다시 적는다(show가 없는 예전 기록은 예전 블록 그대로).
 * K 컷 지시와 같은 문장을 받는다(적용 D4 ⓑ): 손이 나오는 목적(action·scale)은 접촉 줄, 크기 목적(scale·action·scene)은 손에 빗댄 크기 줄,
 * 근거 있는 제품군은 맞는 목적 줄 끝에 제품군 문장(familyShotLine — context가 없으면 붙지 않는다)
 */
export function applyShotPurpose(prompt: string, section: string, plan: ExtraShotPlan | null, size?: string, context: ShotPurposeContext = {}): string {
  const shot = shotPurposeOf(plan, section)
  if (!shot) return prompt
  const show = shot.show?.trim()
  const framing = `Framing: ${ALL_ANGLES[shot.angle ?? 0] ?? SHOT_ANGLES[0]} — a view the other cuts of this page do not use.`
  const family = familyShotLine(context.family, shot.purpose, context.ingredients)
  const lines =
    shot.purpose === 'angle'
      ? // 주제 글이 있는 앵글은 그 뜻을 그린다. 주제가 없는 채움 컷은 정물 그대로
        show ? [framing, MEANING_LINE] : [`${framing} ${NO_HAND}`]
      : [`${PURPOSE_LINES[shot.purpose]}${family ? ` ${family}` : ''}`]
  if (HAND_PURPOSES.has(shot.purpose)) lines.push(CONTACT_LINE)
  const real = size?.trim()
  if (real && SIZE_PURPOSES.has(shot.purpose)) lines.push(sizeLine(real))
  if (show) lines.push(showLine(show))
  return `${prompt}\n\n${[PURPOSE_HEADER, shot.purpose === 'scene' ? SCENE_RULE : PURPOSE_RULE, ...lines].join('\n')}`
}

/** ③ 구도 중복 재생성 지시 — 같은 페이지의 다른 컷(twin)과 거의 같은 구도라 다시 만든다(1회) */
export function withAngleRetry(prompt: string, twin: string): string {
  return (
    `${prompt}\n\n[Different angle]\nThe previous attempt of this cut came out with almost the same composition as the ${twin} cut ` +
    'of this page. Use a clearly different camera angle, distance and product placement from that cut; keep the product ' +
    'identity, set and light the same.'
  )
}
