/**
 * 컷 실패 판정 — 사진이 없는 컷. 잡이 done이어도 컷이 빠졌을 수 있다(R13 P01: 12컷 중 4컷, 운영 API: 안전 거부·시간 초과).
 * 첫 화면(hero)이 끝내 없으면 이미지 단계가 잡을 failed로 끝내고, 그 밖의 컷은 done을 유지하되 기록하고 화면에 알린다(pdp-image-stage·PdpPreview).
 */

import { JOB_CAP_ERROR_PREFIX } from './job-cost-cap'
import type { SectionImage } from './pdp-state'

export interface CutFailureSummary {
  cutsFailed: number
  cutsFailedSections: string[]
  heroFailed: boolean
}

/** 사진이 없는 컷 — 재생성에 실패해도 앞 컷이 남아 있으면(url 있음) 실패가 아니다 */
export function cutFailureSummary(images: readonly Pick<SectionImage, 'section' | 'url'>[]): CutFailureSummary {
  const cutsFailedSections = images.filter((e) => !e.url).map((e) => e.section)
  return { cutsFailed: cutsFailedSections.length, cutsFailedSections, heroFailed: cutsFailedSections.includes('hero') }
}

const CUT_LABELS: Readonly<Record<string, string>> = {
  hero: '첫 화면',
  problem: '고민 장면',
  solution: '해결 장면',
  usage: '사용 장면',
  cta: '마무리',
  product_exposure: '제품 노출',
  premium_hero: '프리미엄 컷',
  key_benefit_visual: '핵심 메시지',
  direction_hint: '방향 제시',
  concept_mood: '컨셉',
  size_comparison: '크기 비교',
  size_single: '크기 컷',
  comparison_scene: '비교 장면',
  empathy_scene: '공감 장면',
  rating_bg: '평점 배경',
  option_bundle: '옵션 구성',
  certification_badge: '인증 배지',
  event_banner: '이벤트 배너',
  sold_out_banner: '품절 배너',
}
const NUMBERED_LABELS: Readonly<Record<string, string>> = {
  features: '특징',
  howto: '사용법',
  long_scene: '사용 장면',
  usp_icons: '아이콘',
}

const PLATE_PREFIX = 'plate:'
const LONG_SHOT_PREFIX = 'long:shot:'

/** 사람이 읽는 컷 이름 — 플레이트는 그 섹션 이름에 '배경'을 붙인다. 모르는 키는 키 그대로(플레이트는 키를 보이지 않고 '배경') */
export function cutLabel(section: string): string {
  if (section.startsWith(PLATE_PREFIX)) {
    const owner = section.slice(PLATE_PREFIX.length)
    const label = cutLabel(owner)
    return label === owner ? '배경' : `${label} 배경`
  }
  if (section.startsWith(LONG_SHOT_PREFIX)) return `추가 컷 ${Number(section.slice(LONG_SHOT_PREFIX.length)) + 1}`
  const [name, index] = section.split(':')
  if (index !== undefined && NUMBERED_LABELS[name]) return `${NUMBERED_LABELS[name]} ${Number(index) + 1}`
  return CUT_LABELS[section] ?? section
}

/** 실패 사유를 짧게 — 오너가 다음 행동을 고를 수 있는 만큼만(안전 거부는 프롬프트 문제, 시간 초과는 다시 만들면 될 수 있다) */
export function cutFailureReason(error: string | undefined): string {
  const text = error ?? ''
  // 점검 고침 1 — 재생성 뒤에도 원본과 다른 상품이라 뺀 컷(pdp-image-stage settleLineFailure)
  if (text.includes('페이지에서 뺌(상품 불일치')) return '원본과 다른 상품이라 뺌'
  // 결정 카드 c08·J19 — usegate 잡의 사용 판정 컷이 재판정 뒤에도 쓰는 법이 틀려 뺀 컷(settleLineFailure). 꺼진 잡은 이 글이 생기지 않는다
  if (text.includes('페이지에서 뺌(쓰는 법 미달')) return '쓰는 법이 원본과 달라 뺌'
  // 점검 고침 5 — 첫 생성 잡이 잡당 비용 상한에 닿아 만들지 않은 컷(pdp-image-stage, job-cost-cap)
  if (text.startsWith(JOB_CAP_ERROR_PREFIX)) return '잡 비용 상한으로 만들지 않음'
  if (/safety system|moderation|안전 시스템/i.test(text)) return '안전 심사 거부'
  if (/시간 초과|timeout/i.test(text)) return '시간 초과'
  return '생성 실패'
}

/**
 * 화면에 알릴 실패 컷 — 이름과 사유. 잡 기록(cuts_failed)이 있으면 그 컷만 본다: section_images에는 지금 계획에 없는 옛 항목이 남을 수 있다.
 * 기록 뒤 다시 만들어 사진이 생긴 컷은 뺀다. 기록이 없는 예전 잡(이 칸 전)은 전체를 본다.
 */
export function cutFailureNotes(
  images: readonly Pick<SectionImage, 'section' | 'url' | 'error'>[],
  recorded?: { sections: readonly string[] } | null
): Array<{ section: string; label: string; reason: string }> {
  const wanted = recorded ? new Set(recorded.sections) : null
  return images
    .filter((e) => !e.url && (!wanted || wanted.has(e.section)))
    .map((e) => ({ section: e.section, label: cutLabel(e.section), reason: cutFailureReason(e.error) }))
}

/**
 * 사진은 있지만 확인이 필요한 컷(점검 고침 1, 통합 Q1) — 첫 화면 대표 컷이 재생성 뒤에도 원본과 달라 보여 나은 쪽을 쓴 경우.
 * 조용히 넘어가지 않게 잡 결과 화면이 경고로 보인다
 */
export function gateWarningNotes(images: readonly Pick<SectionImage, 'section' | 'url' | 'gateWarning'>[]): Array<{ section: string; label: string; warning: string }> {
  return images.filter((e) => e.url && e.gateWarning).map((e) => ({ section: e.section, label: cutLabel(e.section), warning: e.gateWarning! }))
}
