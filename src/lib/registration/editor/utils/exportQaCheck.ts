import type { ExportWarning } from '@/lib/registration/editor/types/editor';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';

/**
 * Export 전 QA 체크 — V4.3 명세서 기준
 * 검사 항목:
 *   1. 텍스트 overflow (실측 measuredHeight > 영역 height × 1.1)
 *   2. 이미지 누락 (src 없음 또는 플레이스홀더)
 *   3. CTA 섹션 마지막 위치
 */
export function runExportQaCheck(sections: CanvasSection[]): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  const visible = sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .sort((a, b) => a.order - b.order);

  const PLACEHOLDER_PATTERNS = [
    'placehold.co',
    'placeholder',
    'Generation+Failed',
    'Generation Failed',
    'Image+Generation',
  ];

  function isPlaceholder(src: string | undefined | null): boolean {
    if (!src || src.trim() === '') return true;
    return PLACEHOLDER_PATTERNS.some((p) => src.includes(p));
  }

  for (const section of visible) {
    for (const el of section.elements) {
      // 1. 텍스트 overflow
      if (el.type === 'text') {
        const measured = el.measuredHeight ?? (section.measuredHeight ?? 0);
        const allocated = el.transform.height;
        if (measured > 0 && allocated > 0 && measured > allocated * 1.1) {
          warnings.push({
            type: 'overflow',
            sectionId: section.id,
            elementId: el.id,
            message: `텍스트가 영역을 초과합니다 (실측 ${Math.round(measured)}px > 영역 ${Math.round(allocated)}px)`,
            severity: 'error',
          });
        }
      }

      // 2. 이미지 누락 / 플레이스홀더
      if (el.type === 'image' && el.imageProps) {
        const src = el.imageProps.src;
        if (!src || src.trim() === '') {
          warnings.push({
            type: 'missing_image',
            sectionId: section.id,
            elementId: el.id,
            message: '이미지 src가 없습니다',
            severity: 'error',
          });
        } else if (isPlaceholder(src)) {
          warnings.push({
            type: 'placeholder',
            sectionId: section.id,
            elementId: el.id,
            message: '플레이스홀더 이미지가 포함되어 있습니다',
            severity: 'warning',
          });
        }
      }

      if (el.type === 'framed-image' && el.framedImageProps) {
        const src = el.framedImageProps.src;
        if (!src || src.trim() === '') {
          warnings.push({
            type: 'missing_image',
            sectionId: section.id,
            elementId: el.id,
            message: '프레임 이미지 src가 없습니다',
            severity: 'error',
          });
        } else if (isPlaceholder(src)) {
          warnings.push({
            type: 'placeholder',
            sectionId: section.id,
            elementId: el.id,
            message: '프레임에 플레이스홀더 이미지가 포함되어 있습니다',
            severity: 'warning',
          });
        }
      }
    }
  }

  // 3. CTA 마지막 위치
  const lastSection = visible[visible.length - 1];
  if (lastSection && lastSection.sectionType !== 'cta') {
    warnings.push({
      type: 'missing_cta',
      message: 'CTA 섹션이 마지막에 위치하지 않습니다',
      severity: 'warning',
    });
  }

  // CTA 섹션이 아예 없는 경우
  const hasCta = visible.some((s) => s.sectionType === 'cta');
  if (!hasCta) {
    warnings.push({
      type: 'missing_cta',
      message: 'CTA 섹션이 없습니다',
      severity: 'error',
    });
  }

  return warnings;
}
