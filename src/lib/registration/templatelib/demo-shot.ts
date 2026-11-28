/**
 * 직접 해 보는 시연 칸(demoshot 스위치 잡만, 하네스 J57·통합 decide 35·37 — 오너 11-11 00:5x '실제 시험 사진 칸',
 * 원문 "AI로 그려도 된다. 오히려 AI를 더 잘 활용해야 한다"). 켠 잡은 근거 DEMO_EVIDENCE를 세워 비교 섹션을 구성에 넣고, 그 섹션 후보를 시연 칸 하나로 둔다.
 * - 판매자 시험 사진(원천 사진 역할 demo)이 있으면 그 사진 주소 그대로인 칸(compare.demo-photo, 컷 0)
 * - 없으면 상품 사실로 그린 AI 시연 컷 칸(compare.demo-try, 컷 목적 demo — shot-brief PURPOSE_LINES.demo)
 * 꺼진 잡은 근거가 서지 않아 두 템플릿이 근거 잠금으로 후보에 없고 구성·후보가 바이트까지 같다. 순수.
 */

import type { TemplateMeta } from './template-meta'
import { DEMO_PHOTOS_INPUT } from './template-types'

/** 시연 칸 근거 — demoshot 잡에만 선다(select-line) */
export const DEMO_EVIDENCE = 'demo'
/** 시연 칸이 놓이는 섹션 */
export const DEMO_SECTION = 'compare'

/** 시연 칸 템플릿인가 — 근거 demo로 잠긴 템플릿 */
export const isDemoTemplate = (t: Pick<TemplateMeta, 'needs'>): boolean => t.needs.evidence.includes(DEMO_EVIDENCE)

/** 판매자 시험 사진 칸인가 — 사진 목록 입력이 demo.photos */
export const isDemoPhotoTemplate = (t: Pick<TemplateMeta, 'slots'>): boolean =>
  Object.values(t.slots).some((slot) => slot.type === 'list' && slot.input === DEMO_PHOTOS_INPUT)

/** 이 잡의 시연 칸 후보 — 시험 사진이 있으면 사진 칸만, 없으면 AI 시연 컷 칸만 */
export function demoPool<T extends Pick<TemplateMeta, 'needs' | 'slots'>>(templates: readonly T[], hasPhoto: boolean): T[] {
  return templates.filter((t) => isDemoTemplate(t) && isDemoPhotoTemplate(t) === hasPhoto)
}

/** 구성 고치기가 필수처럼 더할 섹션 — 켠 잡은 비교 섹션을 더한다. 꺼진 잡은 받은 목록 그대로다 */
export function withDemoSection(add: readonly string[], on: boolean): readonly string[] {
  return on && !add.includes(DEMO_SECTION) ? [...add, DEMO_SECTION] : add
}

/**
 * 시연 칸의 칸 카피 안내 줄(section-values slotCopySections) — 비교 섹션이지만 다른 상품과 견주는 칸이 아니라 직접 해 본 칸이라는 것을 알린다.
 * 체감 결과는 쓰되(J50 사전 검사 그대로) 시험·인증 사칭과 시험 결과 수치는 쓰지 않게 한다. 시연 칸이 아니면 null(카피 프롬프트가 지금 그대로다)
 */
export const DEMO_COPY_NOTE =
  '  칸 안내: 이 섹션은 직접 해 보는 시연 칸이다 — 사진은 상품을 위 사실의 쓰는 법대로 직접 써 보는 순간이다. headline은 해 본 동작을 말하는 짧은 말로, sub는 그때 보이는 결과를 체감 말로 쓴다. 시험·실험·테스트 완료·인증 같은 말과 횟수·무게·퍼센트 같은 시험 결과 수치는 쓰지 않고, 다른 상품과 견주지 않는다.'

export const demoCopyNote = (t: Pick<TemplateMeta, 'needs'>): string | null => (isDemoTemplate(t) ? DEMO_COPY_NOTE : null)
