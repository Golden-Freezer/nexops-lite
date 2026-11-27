// sectionConverter/measure.ts — D1 분할: 원본 sectionConverter.ts 2382~2431행 순수 이동 (2026-07-04)


import { CONTENT_WIDTH, estimateWrappedLines } from './helpers';


// ─────────────────────────────────────────────────────────────────────────────
// V4.3 Phase 3: 실측 기반 높이 유틸리티 (exported — exportUtils.ts에서도 사용)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 텍스트 블록의 근사 실측 높이 계산.
 * 고정 height override를 제거하고 이 함수로 대체.
 *
 * @param text        텍스트 내용
 * @param fontSize    폰트 크기(px)
 * @param lineHeight  줄간격 배수 (e.g. 1.7)
 * @param containerWidth 컨테이너 너비(px) — 기본 860px 소스 기준
 * @returns 계산된 블록 높이(px)
 */
export function measureTextBlock(
  text: string,
  fontSize: number,
  lineHeight: number,
  containerWidth: number = CONTENT_WIDTH,
): number {
  if (!text) return 0;
  // ★별점 트랙: 한글 인지 wrap 추정으로 교체
  // (기존 0.6em 근사는 한글(≈1.0em) 줄 수를 과소추정 → 오버레이/카드 이탈)
  const lineCount = estimateWrappedLines(text, fontSize, containerWidth);
  return Math.ceil(lineCount * fontSize * lineHeight) + 10;
}

/**
 * 섹션 높이 계산 — 콘텐츠(요소) 기반.
 * 기존: 고정 estimatedHeight 사용.
 * 변경: max(element 하단 y) + paddingBottom.
 *
 * 기존 고정 height override 코드는 주석 처리(fallback 용도)로 유지.
 */
export function calculateSectionHeight(section: import('@/lib/registration/editor/types/canvas').CanvasSection): number {
  const PADDING_BOTTOM = 0;

  let maxBottom = 0;
  for (const element of section.elements) {
    if (!element.isVisible) continue;
    // measuredHeight 우선, 없으면 transform.height fallback
    const elementHeight = element.measuredHeight ?? element.transform.height;
    const bottom = element.transform.y + elementHeight;
    if (bottom > maxBottom) maxBottom = bottom;
  }

  // 요소가 없으면 기존 canvas.height 그대로 반환
  return maxBottom > 0 ? maxBottom + PADDING_BOTTOM : section.canvas.height;
}

