// sectionConverter/elements.ts — D1 분할: 원본 sectionConverter.ts 220~391행 순수 이동 (2026-07-04)


import { TYPOGRAPHY, MIN_FONT_SIZES } from '@/lib/registration/editor/constants/designTokens';
import type { CanvasElement, ShadowProps } from '@/lib/registration/editor/types/canvas';
import { uid, getLetterSpacing, resolveAutoLineHeight, estimateTextHeight } from './helpers';
import type { TypoLevel } from './helpers';


// ─────────────────────────────────────────────────────────────────────────────
// Element factories (internal)
// ─────────────────────────────────────────────────────────────────────────────

// makeTextEl 스타일 오버라이드 — B-2: stroke/strokeWidth/textShadow계열/shadow 통과 추가,
// 죽은 파라미터(backgroundColor/borderRadius — 본문에서 미사용)는 제거

interface TextElOverrides {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number;
  height: number;
  /**
   * 위계별 폰트 하한(MIN_FONT_SIZES) 클램프 해제 — 고정 지오메트리에 묶인
   * 텍스트(원형 뱃지 숫자, 아바타 이니셜, 좁은 하프 컬럼 등)에만 허용한다.
   * 일반 읽기 텍스트에는 사용 금지 (모바일 가독성 기준 위반).
   */
  allowBelowMin: boolean;
  // 텍스트 외곽선 (지원만 — 기본 미적용)
  stroke: string;
  strokeWidth: number;
  // 텍스트 그림자 (오버레이 텍스트 가독성 목적)
  textShadowAngle: number;
  textShadowDistance: number;
  textShadowBlur: number;
  textShadowColor: string;
  // 요소 레벨 그림자 (텍스트 외 요소용 box-shadow)
  shadow: ShadowProps;
}

function makeTextEl(
  name: string,
  content: string,
  level: TypoLevel,
  x: number,
  y: number,
  width: number,
  color: string,
  textAlign: 'left' | 'center' | 'right' = 'center',
  zIndex = 2,
  overrides?: Partial<TextElOverrides>,
): CanvasElement {
  const t = TYPOGRAPHY[level];
  // 모바일 가독성 하한 강제 — 860px 소스 ×0.436 축소 기준.
  // 오버라이드가 하한보다 작으면 하한으로 끌어올린다 (allowBelowMin 예외).
  const minSize = MIN_FONT_SIZES[level] ?? MIN_FONT_SIZES.caption;
  const requestedSize = overrides?.fontSize ?? t.fontSize;
  const fontSize = overrides?.allowBelowMin ? requestedSize : Math.max(requestedSize, minSize);
  const letterSpacing = getLetterSpacing(level);
  // P1-4: 명시 행간이 없는 헤딩은 2줄 이상일 때 자동 완화 행간(1.4) 적용
  const lineHeight =
    overrides?.lineHeight ?? resolveAutoLineHeight(content, level, fontSize, width, letterSpacing);
  return {
    id: uid('txt'),
    type: 'text',
    name,
    transform: {
      x,
      y,
      width,
      // 높이 추정도 동일한 유효 행간으로 — 자동 행간과 기하가 어긋나지 않게
      height: overrides?.height ?? estimateTextHeight(content, level, lineHeight),
      rotation: 0,
    },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    autoHeight: true,
    ...(overrides?.shadow !== undefined ? { shadow: { ...overrides.shadow } } : {}),
    textProps: {
      content,
      typoLevel: level,
      fontFamily: overrides?.fontFamily ?? t.fontFamily,
      fontSize,
      fontWeight: overrides?.fontWeight ?? t.fontWeight,
      fontStyle: 'normal',
      textDecoration: 'none',
      color,
      textAlign,
      lineHeight,
      letterSpacing,
      ...(overrides?.stroke !== undefined ? { stroke: overrides.stroke } : {}),
      ...(overrides?.strokeWidth !== undefined ? { strokeWidth: overrides.strokeWidth } : {}),
      ...(overrides?.textShadowAngle !== undefined ? { textShadowAngle: overrides.textShadowAngle } : {}),
      ...(overrides?.textShadowDistance !== undefined ? { textShadowDistance: overrides.textShadowDistance } : {}),
      ...(overrides?.textShadowBlur !== undefined ? { textShadowBlur: overrides.textShadowBlur } : {}),
      ...(overrides?.textShadowColor !== undefined ? { textShadowColor: overrides.textShadowColor } : {}),
    },
  };
}

function makeImageEl(
  name: string,
  src: string,
  imageType: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex = 1,
  objectFit: 'cover' | 'contain' | 'fill' = 'cover',
): CanvasElement {
  return {
    id: uid('img'),
    type: 'image',
    name,
    transform: { x, y, width, height, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    imageProps: {
      src,
      alt: name,
      objectFit,
      imageType,
      isUserUploaded: false,
    },
  };
}

function makeShapeEl(
  name: string,
  shapeType: 'circle' | 'roundedRect' | 'rect' | 'line',
  x: number,
  y: number,
  width: number,
  height: number,
  props: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    borderRadius?: number;
    /** 4-corner radius [TL, TR, BR, BL] — 말풍선 꼬리 등 비대칭 모서리 처리 */
    borderRadii?: [number, number, number, number];
    border?: string;
    cx?: number;
    cy?: number;
    radius?: number;
  },
  zIndex = 1,
): CanvasElement {
  return {
    id: uid('shp'),
    type: 'shape',
    name,
    transform: { x, y, width, height, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    shapeProps: {
      shapeType,
      ...props,
    },
  };
}

function makeSvgEl(
  name: string,
  svgString: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex = 2,
): CanvasElement {
  return {
    id: uid('svg'),
    type: 'svg',
    name,
    transform: { x, y, width, height, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    svgProps: { svgString },
  };
}

function makeFramedImageEl(
  name: string,
  src: string,
  frameId: string,
  clipPath: string,
  viewBox: string,
  bgColor: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex = 1,
): CanvasElement {
  return {
    id: uid('frm'),
    type: 'framed-image',
    name,
    transform: { x, y, width, height, rotation: 0 },
    zIndex,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    framedImageProps: {
      src,
      alt: name,
      frameId,
      clipPath,
      viewBox,
      bgColor,
      objectFit: 'cover',
      imageType: 'premium_hero',
      isUserUploaded: false,
    },
  };
}


export { makeTextEl, makeImageEl, makeShapeEl, makeSvgEl, makeFramedImageEl };
