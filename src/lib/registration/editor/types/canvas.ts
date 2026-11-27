import type { ProSectionType } from './section';

// ─────────────────────────────────────────────
// V4.3: 요소의 설득 역할
// ─────────────────────────────────────────────
export type ContentRole = "hero" | "proof" | "review" | "cta" | "empathy" | "spec" | "compare" | "general";

// ─────────────────────────────────────────────
// V4.3: 섹션에 부착되는 전략 메타데이터
// ─────────────────────────────────────────────
export interface SectionStrategyMeta {
  /** 이 섹션의 설득 목적 (예: "사회적 검증", "핵심 효익 지배") */
  purpose?: string;

  /** 전략 태그 (예: "기능형", "감성형", "증거형") */
  strategyTag?: string;

  /** 이 섹션이 속한 구간 */
  sectionGroup?: "hook" | "problem" | "usp" | "module";

  /** 파생본 우선순위 (높을수록 Quick에도 포함) */
  priority?: number;
}

// ─────────────────────────────────────────────
// 텍스트 요소 속성
// ─────────────────────────────────────────────
export interface TextElementProps {
  content: string;
  richContent?: string;  // 인라인 <span style="font-size:...;color:..."> 포함 HTML (선택적)
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  color: string;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  letterSpacing: number;
  /** 생성 시 타이포 위계 레벨 — 섹션 폰트 스킴(트랙 5) 적용 대상 판별용 */
  typoLevel?: 'display' | 'h1' | 'h2' | 'body' | 'caption';
  /**
   * 레이아웃 트랙 A: 사용자가 직접 편집한 스타일 키 목록.
   * 레이아웃 교체 시 이 키들은 프리셋/카테고리 기본값으로 덮어쓰지 않고 보존한다.
   */
  userStyledKeys?: string[];
  // 텍스트 외곽선 (Stroke)
  stroke?: string;           // 색상 (기본: 'transparent')
  strokeWidth?: number;      // 두께 px (기본: 0)
  // 텍스트 그림자
  textShadowAngle?: number;     // 각도 deg (기본: 135, 우하단)
  textShadowDistance?: number;   // 거리 px (기본: 0)
  textShadowBlur?: number;      // 블러 반경 px (기본: 0)
  textShadowColor?: string;     // 그림자 색상 (기본: 'rgba(0,0,0,0.3)')
}

// ─────────────────────────────────────────────
// 이미지 요소 속성
// ─────────────────────────────────────────────
export interface ImageElementProps {
  src: string;
  alt: string;
  objectFit: 'cover' | 'contain' | 'fill';
  imageType: string;          // 명세서 2.4 ImageType 참조
  originalPrompt?: string;    // 재생성용 원본 프롬프트
  isUserUploaded: boolean;
  cropRect?: { x: number; y: number; width: number; height: number }; // percentage 0-100
}

// ─────────────────────────────────────────────
// 카드 그룹 요소 속성 (perf_review, point_cards 등)
// ─────────────────────────────────────────────
export interface CardGroupProps {
  cards: Array<{
    id: string;
    imageUrl?: string;
    title?: string;
    description?: string;
    badgeText?: string;
  }>;
  layout: 'horizontal' | 'vertical' | 'grid';
  columns?: number;
}

// ─────────────────────────────────────────────
// 도형 요소 속성 (circle, roundedRect 등)
// ─────────────────────────────────────────────
export type ShapeType =
  | 'rect'
  | 'roundedRect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'triangle'
  | 'star'
  | 'diamond'
  | 'arrow'
  | 'speechBubble';

export interface ShapeElementProps {
  shapeType: ShapeType;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  /** 4-corner radius [TL, TR, BR, BL] — 말풍선 꼬리 등 비대칭 모서리 처리 */
  borderRadii?: [number, number, number, number];
  border?: string;
  // 원형 전용
  cx?: number;
  cy?: number;
  radius?: number;
}

// ─────────────────────────────────────────────
// 인라인 SVG 요소 속성
// ─────────────────────────────────────────────
export interface SvgElementProps {
  svgString: string;
}

// ─────────────────────────────────────────────
// 프레임 적용 이미지 요소 속성 (Hero 프레임 clipPath)
// ─────────────────────────────────────────────
export interface FramedImageElementProps {
  src: string;
  alt: string;
  frameId: string;
  clipPath: string;
  viewBox: string;
  bgColor: string;
  objectFit: 'cover' | 'contain' | 'fill';
  imageType: string;
  originalPrompt?: string;    // 재생성용 원본 프롬프트
  isUserUploaded: boolean;
  cropRect?: { x: number; y: number; width: number; height: number }; // percentage 0-100
  // 테두리 (frameId=rect/roundedRect/circle 에서만 유효; clipPath 경로는 clip으로 잘려서 미적용)
  borderWidth?: number;       // px (기본 0)
  borderColor?: string;       // 색상 (기본 '#000000')
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}

// ─────────────────────────────────────────────
// 그림자 속성 (텍스트, 도형, 이미지 공통)
// ─────────────────────────────────────────────
export interface ShadowProps {
  enabled: boolean;
  angle: number;      // 각도 deg (기본: 135)
  distance: number;   // 거리 px (기본: 4)
  blur: number;
  spread: number;
  color?: string;     // 그림자 색상 (기본: 'rgba(0,0,0,0.3)')
}

// ─────────────────────────────────────────────
// 캔버스 요소 (드래그/리사이즈 가능한 개별 요소)
// ─────────────────────────────────────────────
export interface CanvasElement {
  id: string;
  type: 'text' | 'image' | 'shape' | 'badge' | 'card_group' | 'svg' | 'framed-image';
  name: string;

  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };

  zIndex: number;
  isLocked: boolean;
  isVisible: boolean;
  opacity: number;

  /** 요소 내 콘텐츠 수직 정렬 (기본: 'middle') */
  verticalAlign?: 'top' | 'middle' | 'bottom';

  /** 그룹 ID — 동일 groupId 요소는 함께 선택/이동 */
  groupId?: string;

  textProps?: TextElementProps;
  imageProps?: ImageElementProps;
  cardGroupProps?: CardGroupProps;
  shapeProps?: ShapeElementProps;
  svgProps?: SvgElementProps;
  framedImageProps?: FramedImageElementProps;

  /** 그림자 효과 */
  shadow?: ShadowProps;

  /** V4.3: 실측 기반 높이 (measureTextBlock 등으로 계산) */
  measuredHeight?: number;

  /** V4.5: 텍스트 자동 높이 — undefined/true=자동, false=수동 리사이즈 고정 */
  autoHeight?: boolean;

  /** V4.3: 요소의 설득 역할 — hero/proof/review/cta 등 */
  contentRole?: ContentRole;

  /**
   * 컨테이너 관계 — 이 shape가 감싸는 자식 요소 id 목록.
   * reflowSection이 자식 텍스트의 실측 성장분만큼 컨테이너 높이를 연동 확장한다
   * (리뷰 카드 배경 등 "고정 shape가 텍스트에 뚫리는" 겹침의 구조적 방지).
   */
  containerOf?: string[];
}

// ─────────────────────────────────────────────
// 리뷰 카드 사용자 조절 파라미터 (트랙 4 D-2)
// ─────────────────────────────────────────────
export interface ReviewCardParams {
  /** 카드 간 세로 간격 px */
  gap: number;
  /** 카드 내부 패딩 px */
  padding: number;
  /** 본문 폰트 크기 px */
  bodyFontSize: number;
}

// ─────────────────────────────────────────────
// 캔버스 섹션 (Pro 24개 섹션 중 하나)
// ─────────────────────────────────────────────
export interface CanvasSection {
  id: string;
  sectionType: ProSectionType;
  groupType: 'hook' | 'problem' | 'usp' | 'modules';
  order: number;
  isVisible: boolean;
  layoutId: string;

  /** 프리셋 적용 시 매칭 기록 — 동일 프리셋 재적용의 매칭 흔들림 방지(applyLayoutPreset). 저장본에 함께 영속된다 */
  slotAssignments?: Record<string, string>;

  canvas: {
    width: 860;
    height: number;
    backgroundColor: string;
  };

  elements: CanvasElement[];

  /** V4.3: 전략 메타데이터 */
  strategyMeta?: SectionStrategyMeta;

  /** 사용자가 RightPanel에서 높이를 수동 변경했는지 여부 */
  userAdjustedHeight?: boolean;

  /** 데이터 없이 빈 상태로 추가된 섹션 */
  isPlaceholder?: boolean;

  /** V4.3: export 안전 여부 (placeholder/overflow 검사용) */
  exportSafe?: boolean;

  /** V4.3: 실측 기반 섹션 높이 */
  measuredHeight?: number;

  /**
   * 저장 스키마 버전 — 좌표/관계 규칙 변경 시 구저장본 마이그레이션 판단 기준.
   * 저장 페이로드가 sections 배열뿐이라 섹션에 스탬프한다 (부재 = v1).
   */
  schemaVersion?: number;

  /** 리뷰 섹션 카드 파라미터 (perf_reviews 전용, 부재 시 REVIEW_CARD_DEFAULTS) */
  reviewCardParams?: ReviewCardParams;

  /**
   * 신규 변환 세션에서만 true — 마운트 자동 reflow(추정↔실측 정합) 허용 플래그.
   * 저장 시 해제된다: 저장본/프리셋 적용 기하는 사용자가 승인한 진실이므로
   * 재로드 마운트에서 자동 reflow가 배치를 재구성하면 안 된다
   * (Ctrl+Z 기준선만 정상으로 보이던 재접속 배치 붕괴의 원인).
   */
  needsInitialReflow?: boolean;
}

// ─────────────────────────────────────────────
// 선택 상태
// ─────────────────────────────────────────────
export interface SelectionState {
  selectedIds: string[];
  activeSectionId: string | null;
  isMultiSelect: boolean;
}

// ─────────────────────────────────────────────
// 드래그 상태
// ─────────────────────────────────────────────
export interface DragState {
  isDragging: boolean;
  dragElementId: string | null;
  dragSectionId: string | null;
  startX: number;      // 드래그 시작 시 마우스 pageX
  startY: number;      // 드래그 시작 시 마우스 pageY
  currentX: number;
  currentY: number;
  offsetX: number;     // 드래그 시작 시 요소의 transform.x (canvas coords)
  offsetY: number;     // 드래그 시작 시 요소의 transform.y (canvas coords)
  snapX: number | null;
  snapY: number | null;
}

// ─────────────────────────────────────────────
// 리사이즈 핸들 타입
// ─────────────────────────────────────────────
export type ResizeHandle =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

// ─────────────────────────────────────────────
// 리사이즈 상태
// ─────────────────────────────────────────────
export interface ResizeState {
  isResizing: boolean;
  resizeElementId: string | null;
  resizeSectionId: string | null;
  handle: ResizeHandle | null;
  startBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  startMouseX: number;
  startMouseY: number;
  currentMouseX: number;
  currentMouseY: number;
  shiftLockAspect: boolean;
}
