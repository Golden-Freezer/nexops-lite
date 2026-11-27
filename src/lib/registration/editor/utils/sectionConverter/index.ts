/**
 * sectionConverter.ts
 *
 * Standard 13섹션 CopywritingResult → Pro 24섹션 CanvasSection[] 변환 유틸리티.
 * 명세서 §2.2.3, §2.4, §3.3, §3.4 기반.
 * C-2 Batch3: 인증+아이콘USP+Hero프레임+이미지후킹+평점AI배경+SVG별점+리뷰카드+구분선+배경교차
 */


// D1 분할 (2026-07-04): 원본 단일 파일을 도메인 모듈로 분할, 공개 표면은 아래 재수출로 불변.
// 소비처의 '@/lib/registration/editor/utils/sectionConverter' import 경로는 이 index가 그대로 받는다.

export type { LayoutSelection } from './convert';
export {
  mapStandardToProSections,
  resolveSectionOrder,
  assignImagesToSections,
  convertToCanvasSections,
  mapBackendSectionsToProTypes,
} from './convert';
export { createSectionElements } from './sections';
export {
  isSectionValid,
  filterValidSections,
  insertWhiteDividers,
  applySafetyGuards,
} from './guards';
export { measureTextBlock, calculateSectionHeight } from './measure';
export { estimateWrappedLines, isFullBleedClosure, splitGraphemes, graphemeWidthPx } from './helpers';
export { getSectionLabel, createPlaceholderSection } from './labels';
