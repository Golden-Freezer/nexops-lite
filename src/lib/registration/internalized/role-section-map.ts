/**
 * 역할 16종(SECTION_ROLE_TAXONOMY v1.1) ↔ NEXFIT 24 섹션 타입 매핑 — 단일 진실 소스.
 * DESIGN-INTERNALIZED-TRACK-20260811 결정 T-4의 표를 코드로 옮긴 것이며, 매핑 변경은 이 파일에서만 한다.
 *
 * 원칙:
 * - 신규 역할 3종(option_catalog·size_spec·authenticity)은 1차에는 기존 섹션 타입의 변형으로 구현한다
 *   (에디터 ProSectionType 유니언·sectionConverter·레이아웃 프리셋 무접촉). 전용 타입 신설은 I-5 판정 후.
 * - 미스매치 역할은 생성 제외가 기본(억지 매핑 금지 — §9 리스크 표).
 * - comparison·wearing_shots는 taxonomy가 "섹션 역할이 아니라 섹션 내부 장치"로 정의해 역할 축에
 *   존재하지 않는다 — 매핑 대상 아님.
 */

import { ProSectionType } from '@/lib/registration/editor/types/section'
import type { Role16 } from '../corpus-v2'

/** 골격 포함 조건 — spec_sheet 근거 없이 생성하면 환각(치수·인증·이벤트)이 되는 역할의 게이트. */
export type SkeletonCondition =
  | 'has_dimensions'
  | 'has_certification'
  | 'has_event'
  | 'has_options'
  | 'hook_gate'
  | 'never'

export interface RoleSectionMapping {
  sections: ProSectionType[]
  condition?: SkeletonCondition
}

export const ROLE_TO_SECTIONS: Record<Role16, RoleSectionMapping> = {
  hook: { sections: [ProSectionType.HOOK_3STEP], condition: 'hook_gate' },
  problem: { sections: [ProSectionType.PROBLEM_RAISE, ProSectionType.PROBLEM_EMPATHY], condition: 'hook_gate' },
  product_intro: { sections: [ProSectionType.MAIN_CUT, ProSectionType.PRODUCT_EXPOSURE] },
  // usp_feature는 출현율 ≥ 0.6이면 point_div+sub_div 2개, 미만이면 point_div 1개 —
  // 개수 규칙은 buildSkeleton이 적용한다(결정 T-4 "출현율 따라 1~2개").
  usp_feature: { sections: [ProSectionType.POINT_DIV, ProSectionType.SUB_DIV] },
  brand_story: { sections: [ProSectionType.CONCEPT_DESC] },
  social_proof: { sections: [ProSectionType.PERFORMANCE_REVIEWS, ProSectionType.PERFORMANCE_RATING] },
  certification_evidence: { sections: [ProSectionType.CERTIFICATION], condition: 'has_certification' },
  promotion_offer: { sections: [ProSectionType.EVENT_BANNER], condition: 'has_event' },
  how_to_guide: { sections: [ProSectionType.SOLUTION_GUIDE] },
  size_spec: { sections: [ProSectionType.SPEC_TABLE], condition: 'has_dimensions' },
  option_catalog: { sections: [ProSectionType.POINT_LIST_DIV], condition: 'has_options' },
  // authenticity는 certification 변형(정품 보장 — 사실 진술형 카피는 카피 블록 규칙이 강제)으로 재사용한다.
  // certification_evidence와 동시 활성 시 전개 단계 dedupe가 첫 항목만 남긴다.
  // 조건 has_certification: 컴포저가 certification 섹션을 specSheet.certificationInfo 있을 때만 렌더하므로
  // (pdp-composer-sections.ts), 근거 없이 계획에 넣으면 "계획됐지만 렌더 안 되는" 유령 섹션이 되고
  // trust gate가 거짓 pass를 낸다 — 렌더 근거 게이트와 골격 게이트를 반드시 일치시킨다(2026-08-11 verifier 적발).
  authenticity: { sections: [ProSectionType.CERTIFICATION], condition: 'has_certification' },
  shipping_cs: { sections: [], condition: 'never' }, // 플랫폼 영역 — trust gate 진단에서만 체크
  legal_notice: { sections: [], condition: 'never' }, // 동상
  target_recommendation: { sections: [ProSectionType.PETIT_DIV] },
  faq: { sections: [ProSectionType.HIDDEN_PAGE] },
}

/** usp_feature 2개 전개(point_div+sub_div)의 출현율 임계 — 결정 T-4 비고. */
export const USP_SECONDARY_PREVALENCE_THRESHOLD = 0.6
