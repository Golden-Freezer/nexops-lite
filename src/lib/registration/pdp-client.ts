/**
 * 상세페이지(PDP) 잡 API 클라이언트 — 고정 계약(POST /api/registration/pdp 등, Phase 2 API 태스크가
 * 그대로 구현)에 맞춘 fetch 래퍼 + UI 공용 상수. Phase 1 ThumbnailStudio의 api<T>()는 { data: T } 언랩
 * 관례지만, PDP 계약은 언랩 없이 { jobId }/{ jobs }/{ job }/{ ok } 형태를 그대로 반환하므로 별도로 둔다.
 */

import type { PdpStep } from './pdp-state'

export async function pdpApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `요청 실패(${res.status})`)
  return json as T
}

/** 6단계 파이프라인 UI 순서 — pending/done/failed는 터미널·대기 상태라 스텝퍼에 그리지 않는다 */
export const PDP_UI_STEPS = ['analysis', 'research', 'design', 'copywriting', 'images', 'compose'] as const

export const PDP_STEP_LABELS: Record<(typeof PDP_UI_STEPS)[number], string> = {
  analysis: '데이터 분석',
  research: '리서치 플래닝',
  design: '섹션 디자인',
  copywriting: '카피라이팅',
  images: '이미지 생성',
  compose: '합성',
}

export const PDP_STATUS_LABELS: Record<PdpStep, string> = {
  pending: '대기',
  analysis: '데이터 분석 중',
  research: '리서치 플래닝 중',
  design: '섹션 디자인 중',
  copywriting: '카피라이팅 중',
  images: '이미지 생성 중',
  compose: '합성 중',
  done: '완료',
  failed: '실패',
}
