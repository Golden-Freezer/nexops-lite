// sectionConverter/guards.ts — D1 분할: 원본 sectionConverter.ts 1944~2042행 순수 이동 (2026-07-04)


import { ProSectionType } from '@/lib/registration/editor/types/section';
import { SECTION_GROUP_MAP } from '@/lib/registration/editor/constants/sectionConfig';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { uid } from './helpers';


// ─────────────────────────────────────────────────────────────────────────────
// 섹션 유효성 검사: 실제 콘텐츠가 있는 섹션만 필터링
// ─────────────────────────────────────────────────────────────────────────────
export function isSectionValid(section: CanvasSection): boolean {
  if (section.sectionType === ProSectionType.DIVIDER) return true;

  const textEls = section.elements.filter((el) => el.type === 'text');
  const hasText = textEls.some((el) => {
    const content = el.textProps?.content?.trim() ?? '';
    return (
      content.length > 0 &&
      content !== '[object Object]' &&
      content !== 'N차 완판' &&
      content !== 'N차 완판 기록'
    );
  });

  const imageEls = section.elements.filter((el) => el.type === 'image' || el.type === 'framed-image');
  const hasImage = imageEls.some((el) => {
    const src = el.imageProps?.src ?? el.framedImageProps?.src ?? '';
    return (
      src.length > 0 &&
      !src.includes('placehold') &&
      !src.includes('Generation+Failed') &&
      !src.includes('Generation Failed')
    );
  });

  return hasText || hasImage;
}

// 빈 섹션 필터에서 제거하면 안 되는 필수 섹션
const REQUIRED_SECTIONS = new Set<ProSectionType>([
  ProSectionType.MAIN_CUT,
  ProSectionType.POINT_DIV,
  ProSectionType.HIDDEN_PAGE,
  ProSectionType.CTA,
]);

export function filterValidSections(sections: CanvasSection[]): CanvasSection[] {
  return sections.filter((s) => {
    // perf_review는 perf_reviews에 통합됨 → 항상 제거
    if (s.sectionType === ProSectionType.PERFORMANCE_REVIEW) return false;
    if (REQUIRED_SECTIONS.has(s.sectionType)) return true;
    return isSectionValid(s);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 섹션 간 거터(divider) 삽입 — 팔레트 연동 여백 (2026-07-08 연결부 개선)
//
// 기존 6px 흰색 고정은 (a) 흰 섹션끼리 경계가 안 보여 뭉개지고, (b) full-bleed
// 이미지끼리·컬러 전환부에선 얇은 실선만 두고 붙어 어색했다. 이를 페이지
// 베이스(bgMain) 색의 넉넉한 거터로 바꿔 "섹션이 배경 위에 떠 있는" 구분감과
// 숨 쉴 공간을 만든다. 다크↔라이트 전환부는 거터를 조금 더 키운다.
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 섹션 간 거터 높이(px) — 모바일 ×0.436 ≈ 17px */
const SECTION_GUTTER = 40;
/** 다크↔라이트 전환부 거터(px) — 급전환 완충 */
const CONTRAST_GUTTER = 64;

function isDarkBg(color: string | undefined): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c.includes('gradient')) return false;
  const h = c.replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return r * 0.299 + g * 0.587 + b * 0.114 < 110;
}

export function insertWhiteDividers(
  sections: CanvasSection[],
  bgMain = '#FFFFFF',
): CanvasSection[] {
  const result: CanvasSection[] = [];
  sections.forEach((s, i) => {
    // order = 배열 인덱스 불변식 유지 (editorStore의 삽입/삭제 재계산과 동일 규칙).
    // divider까지 포함해 다시 번호를 매기지 않으면 order 정렬 시 거터가 한곳에 뭉친다.
    result.push({ ...s, order: result.length });
    const next = sections[i + 1];
    if (next) {
      // 양쪽 섹션 모두 visible일 때만 거터, 아니면 0px (export 필터에서 제거됨)
      const bothVisible = s.isVisible !== false && next.isVisible !== false;
      // 다크↔라이트 전환부는 더 넉넉하게 (검정 섹션 급전환 완충)
      const contrast = isDarkBg(s.canvas.backgroundColor) !== isDarkBg(next.canvas.backgroundColor);
      const gutter = contrast ? CONTRAST_GUTTER : SECTION_GUTTER;
      result.push({
        id: uid('div'),
        sectionType: ProSectionType.DIVIDER,
        groupType: SECTION_GROUP_MAP[ProSectionType.DIVIDER],
        order: result.length,
        isVisible: true,
        layoutId: 'divider',
        // 페이지 베이스 색 거터 — 섹션이 배경 위에 떠 있는 구분감
        canvas: { width: 860, height: bothVisible ? gutter : 0, backgroundColor: bgMain },
        elements: [],
      });
    }
  });
  return result;
}

/** 안전장치: CTA 마지막 보장 + perf_review 완전 제거 */
export function applySafetyGuards(sections: CanvasSection[]): CanvasSection[] {
  // perf_review 명시적 제거 (filterValidSections에서도 처리되지만 이중 보장)
  let result = sections.filter(
    (s) => s.sectionType !== ProSectionType.PERFORMANCE_REVIEW,
  );

  // CTA가 마지막이 아니면 마지막으로 이동
  const ctaIdx = result.findLastIndex((s) => s.sectionType === ProSectionType.CTA);
  if (ctaIdx >= 0 && ctaIdx !== result.length - 1) {
    const cta = result[ctaIdx];
    result = [...result.filter((_, i) => i !== ctaIdx), cta];
  }

  // 최소 섹션 수 검증 로그 (divider 제외한 실제 콘텐츠 섹션)
  const activeSections = result.filter((s) => s.sectionType !== 'divider');
  if (activeSections.length < 18) {
    console.warn(
      `[SafetyGuards] 섹션 수 ${activeSections.length}개 — 18개 미만. 백엔드 section_plan 확인 필요.`,
    );
  }

  return result;
}

