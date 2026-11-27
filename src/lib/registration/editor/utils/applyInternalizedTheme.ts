// ─── 내재화 테마 적용 (Track I, 결정 T-5) ─────────────────────────────────────
// 서버가 해석해 내려준 섹션 타입별 실측 테마(EditorDataResponse.internalized_theme)를
// 신규 변환 문서에만 적용한다 — 저장본 재로드에는 적용하지 않는다(오너 편집이 우선).
// 1차 적용 범위는 배경 hex + 타이포(px·행간)뿐이다: 절대좌표 지오메트리는 불변이고,
// 폰트 크기 변화에 따른 높이 정합은 신규 변환 섹션의 마운트 reflow(needsInitialReflow)가 흡수한다.
// 사용자가 직접 만진 스타일 키(userStyledKeys)는 덮어쓰지 않는다 — 신규 변환 직후라 보통 비어있다.

import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { EditorDataResponse } from '@/lib/registration/editor/services/editorApi';

type ThemeMap = NonNullable<EditorDataResponse['internalized_theme']>;

/** typoLevel 미기록 요소의 폴백 분류 경계 — designTokens h2(60px)와 body(45px) 사이. */
const HEADLINE_FONT_SIZE_FALLBACK_MIN = 50;
/** 이 크기 미만은 캡션·라벨·법정표시 계열 — 1차 적용 범위 밖(실측 하한 33px보다 작아 확대 부작용 방지). */
const BODY_FONT_SIZE_FALLBACK_MIN = 30;

function themedFontSize(
  typoLevel: string | undefined,
  fontSize: number,
  theme: ThemeMap[string]
): number | null {
  if (typoLevel === 'display' || typoLevel === 'h1' || typoLevel === 'h2') return theme.headlinePx;
  if (typoLevel === 'body') return theme.bodyPx;
  if (typoLevel === 'caption') return null;
  // typoLevel 미기록(구 변환분·프리셋 산출) — 크기 기반 폴백
  if (fontSize >= HEADLINE_FONT_SIZE_FALLBACK_MIN) return theme.headlinePx;
  if (fontSize >= BODY_FONT_SIZE_FALLBACK_MIN) return theme.bodyPx;
  return null;
}

export function applyInternalizedTheme(sections: CanvasSection[], theme: ThemeMap): CanvasSection[] {
  return sections.map((section) => {
    const sectionTheme = theme[String(section.sectionType)];
    if (!sectionTheme) return section;

    const elements = section.elements.map((el) => {
      if (el.type !== 'text' || !el.textProps) return el;
      const styled = new Set(el.textProps.userStyledKeys ?? []);
      const nextSize = styled.has('fontSize')
        ? null
        : themedFontSize(el.textProps.typoLevel, el.textProps.fontSize, sectionTheme);
      if (nextSize === null) return el;
      return {
        ...el,
        textProps: {
          ...el.textProps,
          fontSize: nextSize,
          ...(styled.has('lineHeight') ? {} : { lineHeight: sectionTheme.lineHeightRatio }),
        },
      };
    });

    return {
      ...section,
      canvas: { ...section.canvas, backgroundColor: sectionTheme.backgroundHex },
      elements,
    };
  });
}
