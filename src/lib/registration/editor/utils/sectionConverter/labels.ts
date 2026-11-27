// sectionConverter/labels.ts — D1 분할: 원본 sectionConverter.ts 2432~2526행 순수 이동 (2026-07-04)


import { ProSectionType } from '@/lib/registration/editor/types/section';
import { SECTION_GROUP_MAP } from '@/lib/registration/editor/constants/sectionConfig';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import { SIDE_PADDING, CONTENT_WIDTH, computeSectionHeight } from './helpers';
import { createSectionElements } from './sections';


// ─────────────────────────────────────────────────────────────────────────────
// 플레이스홀더 섹션 팩토리 — 에디터에서 미생성 섹션을 수동 추가할 때 사용
// ─────────────────────────────────────────────────────────────────────────────

/** 섹션 타입별 한국어 레이블 */
const SECTION_TYPE_LABELS: Record<string, string> = {
  hook_3step: '후킹 3 STEP',
  certification: '인증',
  event_banner: '이벤트 배너',
  perf_sales: '판매량 성과',
  perf_rating: '평점 성과',
  perf_reviews: '리뷰수 성과',
  product_exposure: '제품 노출',
  perf_review: '리뷰 성과',
  event_bundle: '묶음 이벤트',
  event_discount: '할인 이벤트',
  event_option: '옵션 이벤트',
  problem_raise: '문제 제기',
  problem_empathy: '문제 공감',
  direction_suggest: '방향 제시',
  solution_guide: '해결 유도',
  key_message: '키 메시지',
  main_cut: '메인컷',
  concept_desc: '컨셉 설명',
  point_div: '포인트',
  sub_div: '서브',
  sub2_div_page: '서브 2',
  hidden_page: '히든 페이지',
  compare_div: '비교',
  compare2_div: '비교 2',
  point_list_div: '포인트 나열',
  petit_div: '뽀띠',
  convert_div: '전환 포인트',
  spec_table: '제원',
  cta: 'CTA',
};

export function getSectionLabel(sectionType: string): string {
  return SECTION_TYPE_LABELS[sectionType] ?? sectionType;
}

export function createPlaceholderSection(
  sectionType: ProSectionType,
  designPalette: DesignPalette,
  order: number,
): CanvasSection {
  const label = getSectionLabel(sectionType);

  // 빈 content로 기본 요소 생성 시도
  const elements = createSectionElements(sectionType, {}, null, designPalette);

  // 요소가 없으면 플레이스홀더 텍스트 요소 추가
  if (elements.length === 0) {
    elements.push({
      id: `ph_${sectionType}_${Date.now()}`,
      name: 'placeholder-text',
      type: 'text',
      transform: { x: SIDE_PADDING, y: 80, width: CONTENT_WIDTH, height: 60, rotation: 0 },
      zIndex: 1,
      isVisible: true,
      isLocked: false,
      opacity: 0.5,
      textProps: {
        content: `[${label}] 콘텐츠를 편집하세요`,
        fontFamily: 'Pretendard',
        fontSize: 32,
        fontWeight: 400,
        fontStyle: 'normal',
        textDecoration: 'none',
        lineHeight: 1.5,
        letterSpacing: -0.3,
        textAlign: 'center',
        color: designPalette.textMain,
      },
    });
  }

  const sectionHeight = computeSectionHeight(elements);

  return {
    id: `sec_ph_${sectionType}_${Date.now()}`,
    sectionType,
    groupType: SECTION_GROUP_MAP[sectionType],
    order,
    isVisible: true,
    layoutId: 'placeholder',
    isPlaceholder: true,
    canvas: {
      width: 860,
      height: sectionHeight,
      backgroundColor: designPalette.bgMain,
    },
    elements,
  };
}
