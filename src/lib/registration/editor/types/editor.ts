import type { CanvasSection } from './canvas';

// ─────────────────────────────────────────────
// 소스 데이터 참조 타입 (명세서 8.1)
// ─────────────────────────────────────────────
export interface DesignPalette {
  primary: string;
  secondary: string;
  bgMain: string;
  bgSub: string;
  textMain: string;
  textHighlight: string;
}

export interface CopywritingResult {
  mainIntro: {
    category: string;
    subtitle: string;
    title: string;
    hook: string;
    benefitHeadline?: string;
    subBenefit?: string;
    brandAndName?: string;
  };
  designPalette: DesignPalette;
  problem: { question: string; empathy: string; empathyLines?: string[]; empathyDeepLines?: string[] };
  solution: { declaration: string; summary: string };
  pointCards: Array<{ title: string; description: string }>;
  summary: string;
  /** key_message 섹션용 위계별 변형 (top/mid/bottom) — hero 헤드라인 중복 회피 */
  keyMessageVariations?: { top?: string; mid?: string; bottom?: string };
  productExposure?: { headline?: string; subCopy?: string };
  keyMessageCopy?: { headline?: string; subCopy?: string };
  /** 비교 섹션용 — 경쟁 대안 대비 3-way 비교 (마지막 항목 = 본 상품) */
  compareItems?: Array<{ name: string; pros: string; cons: string }>;
  compareSummary?: string;
  colorOptions: { title: string; options: string[]; description: string };
  usageSceneTags: string[];
  detailPoints: Array<{
    title?: string;
    description?: string;
    claim?: string;
    proof?: string;
    benefit?: string;
    imageHint?: string;
  }>;
  howTo: Array<{ step: string; description: string }>;
  recommendedTargets: string[];
  closingCta: { headline: string; subtext: string } | string;
  title: string;
  seo_keywords: string[];
  sizeComparisonObject?: string;
  reviewHighlights?: Array<{ text: string; author: string }>;
  certificationCopy?: {
    headline: string;
    sub_copy: string;
    highlight_text?: string;
    bullet_points?: string[];
    warning_text: string;
    cert_badges_text: string;
  };
}

export interface InitialBaseline {
  schemaVersion: number;
  capturedAt: string;
  sections: CanvasSection[];
}

// ─────────────────────────────────────────────
// Pro 에디터 문서 (캔버스 전체 상태, 명세서 8.1)
// ─────────────────────────────────────────────
export interface ProEditorDocument {
  id: string;
  pdpId: string;
  version: number;
  createdAt: string;
  updatedAt: string;

  meta: {
    productName: string;
    brandName: string;
    category: string;
    essenceType: 'sensory' | 'result' | 'convenience' | 'emotional';
    planTier: 'pro';
  };

  sourceData: {
    copywritingResult: CopywritingResult;
    generatedImages: Record<string, string | string[]>;  // imageType → URL(s)
    designPalette: DesignPalette;
    specSheet: Record<string, unknown>;
  };

  sections: CanvasSection[];
  initialBaseline?: InitialBaseline;

  settings: {
    canvasWidth: 860;
    defaultFont: 'Pretendard';
  };
}

// ─────────────────────────────────────────────
// 에디터 전체 UI 상태
// ─────────────────────────────────────────────
export interface EditorState {
  document: ProEditorDocument | null;
  activeSectionId: string | null;
  selectedElementIds: string[];
  editMode: 'select' | 'text' | 'pan';
  zoom: number;                           // 0.25 ~ 3.0
  isDirty: boolean;                       // 미저장 변경 여부
  isSaving: boolean;
}

// ─────────────────────────────────────────────
// Undo / Redo 히스토리 엔트리
// ─────────────────────────────────────────────
export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;                    // e.g., '텍스트 수정', '요소 이동'
  sections: CanvasSection[];              // 해당 시점의 섹션 스냅샷
}

// ─────────────────────────────────────────────
// V4.3: 파생본 버전
// ─────────────────────────────────────────────
export type DerivativeVersion = "quick" | "standard" | "persuasive";

// ─────────────────────────────────────────────
// V4.3: Export 경고 타입
// ─────────────────────────────────────────────
export interface ExportWarning {
  /** 경고 유형 */
  type: "overflow" | "placeholder" | "missing_image" | "missing_cta" | "low_contrast" | "excessive_reviews";
  /** 관련 섹션 ID */
  sectionId?: string;
  /** 관련 요소 ID */
  elementId?: string;
  /** 경고 메시지 */
  message: string;
  /** 심각도 */
  severity: "error" | "warning" | "info";
}

// ─────────────────────────────────────────────
// 내보내기 옵션 (명세서 8.2)
// ─────────────────────────────────────────────
export interface ExportOptions {
  type: 'per_section_png' | 'full_page_png' | 'zip' | 'html';

  perSectionPng?: {
    format: 'png';
    width: 860;
    quality: number;                      // 0.0 ~ 1.0 (권장: 0.95)
    sectionIds?: string[];                // 미지정 시 전체 섹션
  };

  fullPagePng?: {
    format: 'png';
    width: 860;
  };

  zipDownload?: {
    includePerSection: boolean;
    includeFullPage: boolean;
    includeHtml: boolean;
  };

  htmlExport?: {
    inlineStyles: boolean;
    responsive: false;                    // PNG 렌더링용 — 반응형 비활성
  };

  /** V4.3: 검수용 HTML (semantic, flex/grid, auto height) */
  review_html?: boolean;

  /** V4.3: 캡처용 HTML (860 고정, 실측 height, 이미지 인라인) */
  render_html?: boolean;

  /** V4.3: 긴 상세페이지 대응 — 분할 후 결합 */
  stitched_full_page?: boolean;

  /** V4.3: Quick/Standard/Persuasive 동시 출력 */
  derivatives?: DerivativeVersion[];
}
