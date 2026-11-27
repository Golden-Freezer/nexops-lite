import type { ProSectionType } from './section';

// ─────────────────────────────────────────────
// V4.3: 프레임 시스템 정의
// ─────────────────────────────────────────────
export interface FrameSystem {
  /** 주요 프레임 스타일 */
  primary: "rounded_rect" | "editorial_mix" | "pebble_soft" | "circle_focus" | "droplet_fresh" | "square_clean" | "petal_soft" | "notch_split";
  /** 보조 프레임 스타일 (선택) */
  secondary?: string;
}

// ─────────────────────────────────────────────
// V4.3: 콘텐츠 밀도 (파생본 대응)
// ─────────────────────────────────────────────
export type ContentDensity = "quick" | "standard" | "persuasive";

// ─────────────────────────────────────────────
// 레이아웃 카테고리
// ─────────────────────────────────────────────
export type LayoutCategory =
  | 'minimal'
  | 'bold'
  | 'image_first'
  | 'split'
  | 'overlay'
  | 'gradient'
  | 'card'
  | 'full_bleed'
  | 'stacked'
  | 'dynamic';

export type LayoutOnlySupport = 'safe' | 'preview-required' | 'unsupported';

// ─────────────────────────────────────────────
// 레이아웃 요소 슬롯 (프리셋이 정의하는 요소 위치/크기)
// ─────────────────────────────────────────────
export interface LayoutElementSlot {
  slotId: string;                         // e.g., 'headline', 'hero_image'
  elementType: 'text' | 'image' | 'card_group' | 'badge' | 'table';
  position: {
    x: number;
    y: number;
    width: number;
    height: number | 'auto';
  };
  isDraggable: boolean;
  isResizable: boolean;

  /** 슬롯별 텍스트 스타일 힌트 — 레이아웃 전환 시 적용 (content는 보존) */
  textStyle?: {
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    lineHeight?: number;
    letterSpacing?: number;
    /**
     * 타이포 위계 — 지정 시 그룹 폰트 스킴(heading/body)과 자동 정합.
     * fontFamily를 직접 지정하는 것보다 이 방식을 권장한다.
     */
    typoLevel?: 'display' | 'h1' | 'h2' | 'body' | 'caption';
    /** 직접 폰트 지정 — 에디터 로드 가능 폰트 화이트리스트를 통과해야만 적용된다 */
    fontFamily?: string;
  };

  /** 슬롯별 이미지 스타일 힌트 */
  imageStyle?: {
    objectFit?: 'cover' | 'contain' | 'fill';
  };
}

// ─────────────────────────────────────────────
// 레이아웃 프리셋 (240개 = 24섹션 × 10개)
// ─────────────────────────────────────────────
export interface LayoutPreset {
  id: string;                             // e.g., 'main_intro_layout_01'
  sectionType: ProSectionType;
  name: string;                           // 표시명 (e.g., '센터 임팩트')
  thumbnail: string;                      // 미리보기 이미지 URL or 경로
  category: LayoutCategory;
  tags: string[];

  structure: {
    background: {
      type: 'solid' | 'gradient' | 'image';
      value: string;                      // hex, css gradient, 또는 이미지 URL
    };
    elements: LayoutElementSlot[];
    estimatedHeight: number;              // 기본 섹션 높이 (px)
  };

  /** V4.3: 전략 태그 — 기능형/감성형/증거형 프리셋 구분 */
  strategyTag?: "function" | "emotion" | "proof" | "balanced" | "review_forward" | "compare_heavy";

  /** 배치만 적용 호환성 — 부재 시 카테고리 기본값으로 유도(presetCompatibility.ts) */
  layoutOnlySupport?: LayoutOnlySupport;

  /** V4.3: 프레임 시스템 연결 */
  frameSystem?: FrameSystem;

  /** V4.3: 콘텐츠 밀도 대응 */
  contentDensity?: ContentDensity;

  /** V4.3: slot 우선순위 정의 — 필수 요소 누락 방지 */
  requiredSlots?: string[];

  /** 트랙 4 D-3: 리뷰 카드 밀도 파라미터 (perf_reviews 전용, 부분 오버라이드) */
  cardParams?: { gap?: number; padding?: number; bodyFontSize?: number };
}
