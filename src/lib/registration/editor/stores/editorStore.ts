import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ProEditorDocument, ExportWarning } from '@/lib/registration/editor/types/editor';
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas';
import { SPACING } from '@/lib/registration/editor/constants/designTokens';
import { useCanvasStore } from './canvasStore';

// ─────────────────────────────────────────────
// V4.3: 프론트엔드용 StrategyContract 타입
// (Python TypedDict agents/state.py와 동기화)
// ─────────────────────────────────────────────
export interface StrategyContract {
  involvement_level?: 'high' | 'low';
  persuasion_axis?: 'emotion' | 'function' | 'balanced';
  purchase_context?: 'self_use' | 'gift' | 'family' | 'urgent_problem' | 'seasonal';
  comparison_intensity?: 'low' | 'medium' | 'high';
  proof_sensitivity?: 'low' | 'medium' | 'high';
  page_goal?: 'test' | 'standard' | 'conversion_max';
  page_length_target?: 'quick' | 'standard' | 'persuasive';
  review_position_strategy?: 'front' | 'middle' | 'back' | 'dynamic';
  soldout_position_strategy?: 'front' | 'none' | 'dynamic';
  visual_style_pack?: 'clean_proof' | 'warm_story' | 'premium_editorial' | 'cute_soft';
  frame_style_pack?: 'rounded_rect' | 'editorial_mix' | 'pebble_soft' | 'circle_focus' | 'droplet_fresh';
  hook_mode?: 'shock' | 'curiosity' | 'proof' | 'empathy' | 'authority';
  objection_priority?: string[];
}

// ─────────────────────────────────────────────
// 저장 상태
// ─────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─────────────────────────────────────────────
// 레이아웃 트랙 A: 사용자 스타일 편집 추적
// 이 키들이 사용자 조작 경로(updateElement/updateSelectedTextProps)로 바뀌면
// userStyledKeys에 기록되고, 레이아웃 교체 시 프리셋 값으로 덮어쓰지 않는다.
// ─────────────────────────────────────────────
type TextProps = import('@/lib/registration/editor/types/canvas').TextElementProps;
const TRACKED_TEXT_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration',
  'color', 'textAlign', 'lineHeight', 'letterSpacing',
] as const satisfies readonly (keyof TextProps)[];

function markUserStyled(tp: TextProps, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const merged = new Set([...(tp.userStyledKeys ?? []), ...keys]);
  tp.userStyledKeys = [...merged];
}

// ─────────────────────────────────────────────
// V4.3: 파생본 미리보기 모드
// ─────────────────────────────────────────────
export type DerivativePreviewMode = 'master' | 'quick' | 'standard' | 'persuasive';

// ─────────────────────────────────────────────
// 스토어 상태 타입
// ─────────────────────────────────────────────
interface EditorStoreState {
  // 에디터 문서
  document: ProEditorDocument | null;

  // 선택 상태
  selectedSectionId: string | null;
  selectedElementId: string | null;   // 마지막 클릭 요소 (단일 선택 / 포커스)
  selectedElementIds: string[];       // 다중 선택 배열

  // 뷰 상태
  zoom: number;           // 0.1 ~ 4.0
  viewMode: 'select' | 'text' | 'pan' | 'mobile' | 'image' | 'shape';

  // 클립보드 (복사/붙여넣기)
  clipboardElements: CanvasElement[];

  // 저장 상태
  isDirty: boolean;
  saveStatus: SaveStatus;
  saveRequested: boolean;

  // ── V4.3 Phase 3 추가 ──

  /** 레이아웃 변경 여부 (프리셋 적용/섹션 순서 변경) */
  layoutDirty: boolean;

  /** export 관련 변경 여부 (텍스트 수정/이미지 교체) */
  exportDirty: boolean;

  /** 섹션별 실측 높이 캐시 — key: sectionId */
  measuredHeights: Record<string, number>;

  /** 현재 파생본 미리보기 모드 */
  derivativePreview: DerivativePreviewMode;

  /** export 경고 목록 */
  exportWarnings: ExportWarning[];

  /** 전략 계약 (에이전트에서 전달받은 값) */
  strategyContract: StrategyContract | null;

  /** 이미지 재생성 대상 (RightPanel/ContextMenu → Canvas 연동) */
  regenTarget: { elementId: string; sectionId: string } | null;

  /** 텍스트 카피 재생성 대상 */
  textRegenTarget: { elementId: string; sectionId: string } | null;

  /** 이미지 크롭 대상 */
  cropTarget: { elementId: string; sectionId: string } | null;

  /** 우측 IconRail 활성 탭 (null = 패널 접힘) */
  railTab: string | null;

  /** 캔버스 배경 점 그리드 표시 여부 */
  showGrid: boolean;

  /**
   * P1-1: 툴바 스타일 변경(fontSize·fontFamily 등 기하 영향 키) 후 재측정 요청.
   * DOM을 가진 CanvasElement가 소비해 measuredHeight/height 동기화 + reflowSection.
   * token은 같은 요소 연속 변경도 새 요청으로 인식시키기 위한 증가 카운터.
   */
  styleRemeasure: { sectionId: string; elementId: string; token: number } | null;
}

// ─────────────────────────────────────────────
// 스토어 액션 타입
// ─────────────────────────────────────────────
interface EditorStoreActions {
  // 문서 초기화
  initDocument: (doc: ProEditorDocument) => void;
  clearDocument: () => void;

  // Undo / Redo 적용 (H5: isDirty 설정 포함 — 단일 적용 지점)
  undoDocument: () => void;
  redoDocument: () => void;

  // 선택
  selectSection: (sectionId: string | null) => void;
  selectElement: (elementId: string | null) => void;
  toggleElementSelection: (elementId: string) => void;
  clearSelection: () => void;

  // 요소 업데이트
  updateElement: (sectionId: string, elementId: string, partial: Partial<CanvasElement>) => void;
  updateElementPosition: (sectionId: string, elementId: string, x: number, y: number) => void;
  updateElementSize: (sectionId: string, elementId: string, width: number, height: number) => void;

  /** V4.5 자동높이 실측 전용 — 사용자 편집이 아니므로 isDirty를 세우지 않는다(열람만으로 자동저장 방지) */
  setMeasuredHeight: (sectionId: string, elementId: string, measuredHeight: number) => void;

  // 다중선택 배치 업데이트
  updateSelectedElements: (partial: Partial<CanvasElement>) => void;
  updateSelectedTextProps: (textPartial: Partial<import('@/lib/registration/editor/types/canvas').TextElementProps>) => void;

  // 섹션 업데이트 (레이아웃 교체 등)
  updateSection: (sectionId: string, updatedSection: CanvasSection) => void;

  // 섹션 순서 변경
  reorderSections: (newOrder: string[]) => void;

  // 뷰 제어
  setZoom: (zoom: number) => void;
  setViewMode: (mode: EditorStoreState['viewMode']) => void;

  /** L16: 마운트 후 localStorage 저장값(zoom/showGrid) 반영 — hydration-safe */
  hydrateViewPrefs: () => void;

  // 요소 추가/삭제
  addElement: (sectionId: string, element: CanvasElement) => void;
  deleteElements: () => void;

  // 클립보드 (복사/붙여넣기/복제)
  copyElements: () => void;
  pasteElements: () => void;
  duplicateElements: () => void;

  // 전체 선택 / z-Index 조정
  selectAllInSection: (sectionId: string) => void;
  changeZIndex: (sectionId: string, elementId: string, delta: number) => void;

  // 저장 상태 제어
  markDirty: () => void;
  markSaved: () => void;
  setSaveStatus: (status: SaveStatus) => void;
  requestSave: () => void;
  clearSaveRequest: () => void;

  // ── V4.3 Phase 3 추가 액션 ──
  setLayoutDirty: (dirty: boolean) => void;
  setExportDirty: (dirty: boolean) => void;
  updateMeasuredHeight: (sectionId: string, height: number) => void;
  setDerivativePreview: (mode: DerivativePreviewMode) => void;
  setExportWarnings: (warnings: ExportWarning[]) => void;
  setStrategyContract: (contract: StrategyContract) => void;
  setRegenTarget: (target: { elementId: string; sectionId: string } | null) => void;
  setTextRegenTarget: (target: { elementId: string; sectionId: string } | null) => void;
  setCropTarget: (target: { elementId: string; sectionId: string } | null) => void;
  setRailTab: (tab: string | null) => void;
  setShowGrid: (show: boolean) => void;

  // ── 섹션 추가/삭제/가시성 ──
  addSection: (section: CanvasSection, insertAfterSectionId?: string) => void;
  removeSection: (sectionId: string) => void;
  toggleSectionVisibility: (sectionId: string) => void;

  /** V4.5: 텍스트 자동 높이 리플로우 — 아래 요소 y 이동 + 섹션 높이 갱신 */
  reflowSection: (sectionId: string) => void;

  /** 신규 변환 세션 정산 — 전 섹션 needsInitialReflow 해제 (저장 직전 호출) */
  settleInitialReflow: () => void;

  /** 레이어 탭 DnD: 요소 z-index 재정렬 */
  reorderElements: (sectionId: string, orderedIds: string[]) => void;

  /** V4.5: 선택된 요소들을 그룹화 */
  groupElements: () => void;

  /** V4.5: 선택된 요소들의 그룹 해제 */
  ungroupElements: () => void;

  /** P1-1: 기하 영향 스타일 변경 후 재측정 요청/해제 */
  requestStyleRemeasure: (sectionId: string, elementId: string) => void;
  clearStyleRemeasure: () => void;

  /**
   * P1-4: 시스템 자동 스타일 적용(멀티라인 행간 등) — updateElement와 달리
   * userStyledKeys에 기록하지 않는다 (사용자 편집이 아니므로 프리셋 보존 대상 아님).
   */
  applyAutoTextProps: (sectionId: string, elementId: string, partial: Partial<TextProps>) => void;
}

type EditorStore = EditorStoreState & EditorStoreActions;

// ─────────────────────────────────────────────
// 초기 상태
// ─────────────────────────────────────────────
const initialState: EditorStoreState = {
  document: null,
  selectedSectionId: null,
  selectedElementId: null,
  selectedElementIds: [],
  // L16: 모듈 로드 시 localStorage를 읽으면 SSR 마크업(1.0/true)과 클라이언트 첫 렌더가
  // 어긋나 hydration mismatch가 발생한다. 기본값으로 시작하고, 마운트 후
  // hydrateViewPrefs()에서 저장값을 반영한다.
  zoom: 1.0,
  viewMode: 'select',
  clipboardElements: [],
  isDirty: false,
  saveStatus: 'idle',
  saveRequested: false,
  // V4.3 Phase 3
  layoutDirty: false,
  exportDirty: false,
  measuredHeights: {},
  derivativePreview: 'master',
  exportWarnings: [],
  strategyContract: null,
  regenTarget: null,
  textRegenTarget: null,
  cropTarget: null,
  railTab: 'properties',
  showGrid: true, // L16: 저장값은 hydrateViewPrefs()에서 반영
  styleRemeasure: null,
};

// ─────────────────────────────────────────────
// 히스토리 통일 모델 (2026-07-07 H3~H5)
// · 문서를 변경하는 "이산(discrete)" 스토어 액션은 변경 직후(post) 스냅샷을
//   이 헬퍼 단일 지점으로 기록한다. (pre 스냅샷 금지)
// · 연속 제스처(드래그/리사이즈/슬라이더)는 스토어에서 기록하지 않고,
//   제스처 종료 지점에서 canvasStore.commitHistory를 명시 호출한다.
// ─────────────────────────────────────────────
function commitDocHistory(description: string): void {
  const doc = useEditorStore.getState().document;
  if (!doc) return;
  useCanvasStore.getState().commitHistory(description, doc.sections);
}

// ─────────────────────────────────────────────
// 스토어 생성 (Zustand + immer)
// ─────────────────────────────────────────────
export const useEditorStore = create<EditorStore>()(
  immer((set, get) => {
    /** 액션 실행 후 document가 실제로 바뀐 경우에만 post 스냅샷 기록 */
    const withHistory = (description: string, mutate: () => void): void => {
      const before = get().document;
      mutate();
      if (get().document !== before) commitDocHistory(description);
    };

    return {
    ...initialState,

    initDocument: (doc) => {
      set((state) => {
        state.document = doc;
        state.isDirty = false;
        state.saveStatus = 'idle';
        state.selectedSectionId = null;
        state.selectedElementId = null;
      });
      // H4: 문서 간 히스토리 격리 — 이전 PDP의 히스토리를 완전히 제거
      // H3: baseline 스냅샷 — 첫 편집도 undo 가능하도록 초기 상태를 history[0]에 기록
      const canvas = useCanvasStore.getState();
      canvas.clearHistory();
      canvas.commitHistory('문서 열기', doc.sections);
    },

    clearDocument: () => {
      set((state) => {
        state.document = null;
        state.selectedSectionId = null;
        state.selectedElementId = null;
        state.isDirty = false;
        state.saveStatus = 'idle';
      });
      // H4: 문서 이탈 시 히스토리 제거 (다음 문서로의 오염 방지)
      useCanvasStore.getState().clearHistory();
    },

    undoDocument: () => {
      const sections = useCanvasStore.getState().undo();
      if (!sections) return;
      set((state) => {
        if (!state.document) return;
        state.document.sections = JSON.parse(JSON.stringify(sections)) as CanvasSection[];
        state.isDirty = true; // H5: undo 결과도 자동저장 대상
      });
    },

    redoDocument: () => {
      const sections = useCanvasStore.getState().redo();
      if (!sections) return;
      set((state) => {
        if (!state.document) return;
        state.document.sections = JSON.parse(JSON.stringify(sections)) as CanvasSection[];
        state.isDirty = true; // H5: redo 결과도 자동저장 대상
      });
    },

    selectSection: (sectionId) =>
      set((state) => {
        // 같은 섹션이면 요소 선택 유지 (요소 클릭 → selectSection 순서 보호)
        if (state.selectedSectionId === sectionId) return;
        state.selectedSectionId = sectionId;
        // 섹션 변경 시 요소 선택 해제
        state.selectedElementId = null;
        state.selectedElementIds = [];
      }),

    selectElement: (elementId) =>
      set((state) => {
        state.selectedElementId = elementId;
        state.selectedElementIds = elementId ? [elementId] : [];
      }),

    toggleElementSelection: (elementId) =>
      set((state) => {
        const idx = state.selectedElementIds.indexOf(elementId);
        if (idx === -1) {
          state.selectedElementIds.push(elementId);
          state.selectedElementId = elementId;
        } else {
          state.selectedElementIds.splice(idx, 1);
          state.selectedElementId =
            state.selectedElementIds[state.selectedElementIds.length - 1] ?? null;
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedElementId = null;
        state.selectedElementIds = [];
      }),

    updateElement: (sectionId, elementId, partial) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const element = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!element) return;
        const prevText = element.textProps;
        Object.assign(element, partial);
        // 사용자 스타일 편집 추적 — 이전 값과 실제로 달라진 스타일 키만 기록
        if (partial.textProps && prevText && element.textProps) {
          const changed = TRACKED_TEXT_STYLE_KEYS.filter(
            (k) => partial.textProps![k] !== undefined && partial.textProps![k] !== prevText[k],
          );
          markUserStyled(element.textProps, changed);
        }
        state.isDirty = true;
      }),

    setMeasuredHeight: (sectionId, elementId, measuredHeight) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const element = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!element) return;
        element.measuredHeight = measuredHeight;
        // isDirty 의도적 미설정 — 열람(마운트 실측)만으로는 자동저장을 트리거하지 않는다
      }),

    updateElementPosition: (sectionId, elementId, x, y) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const element = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!element) return;
        element.transform.x = x;
        element.transform.y = y;
        state.isDirty = true;
      }),

    updateElementSize: (sectionId, elementId, width, height) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const element = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!element) return;
        element.transform.width = width;
        element.transform.height = height;
        state.isDirty = true;
      }),

    updateSelectedElements: (partial) =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        const ids = new Set(state.selectedElementIds);
        for (const sec of state.document.sections) {
          for (const el of sec.elements) {
            if (ids.has(el.id)) Object.assign(el, partial);
          }
        }
        state.isDirty = true;
      }),

    updateSelectedTextProps: (textPartial) =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        const ids = new Set(state.selectedElementIds);
        const styledKeys = TRACKED_TEXT_STYLE_KEYS.filter((k) => textPartial[k] !== undefined);
        for (const sec of state.document.sections) {
          for (const el of sec.elements) {
            if (ids.has(el.id) && el.type === 'text' && el.textProps) {
              Object.assign(el.textProps, textPartial);
              markUserStyled(el.textProps, styledKeys);
            }
          }
        }
        state.isDirty = true;
      }),

    updateSection: (sectionId, updatedSection) =>
      set((state) => {
        if (!state.document) return;
        const idx = state.document.sections.findIndex((s: CanvasSection) => s.id === sectionId);
        if (idx === -1) return;
        state.document.sections[idx] = updatedSection;
        state.isDirty = true;
      }),

    reorderSections: (newOrder) =>
      withHistory('섹션 순서 변경', () =>
      set((state) => {
        if (!state.document) return;
        // order 인덱스를 draft에 직접 반영 후 in-place sort
        // (new Map(draft) + sections 교체 패턴은 Immer draft 소유권 혼란 유발)
        const orderMap = new Map(newOrder.map((id, idx) => [id, idx]));
        for (const section of state.document.sections) {
          const idx = orderMap.get(section.id);
          if (idx !== undefined) section.order = idx;
        }
        state.document.sections.sort((a, b) => a.order - b.order);
        state.isDirty = true;
      })),

    setZoom: (zoom) =>
      set((state) => {
        state.zoom = Math.min(4.0, Math.max(0.1, zoom));
        if (typeof window !== 'undefined') {
          localStorage.setItem('nexops-editor-zoom', String(state.zoom));
        }
      }),

    setShowGrid: (show) =>
      set((state) => {
        state.showGrid = show;
        localStorage.setItem('nexops-editor-show-grid', String(show));
      }),

    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode;
      }),

    hydrateViewPrefs: () =>
      set((state) => {
        if (typeof window === 'undefined') return;
        const storedZoom = Number(localStorage.getItem('nexops-editor-zoom'));
        if (storedZoom >= 0.1 && storedZoom <= 4.0) {
          state.zoom = storedZoom;
        }
        state.showGrid = localStorage.getItem('nexops-editor-show-grid') !== 'false';
      }),

    addElement: (sectionId, element) =>
      withHistory('요소 추가', () =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        section.elements.push(element);
        state.isDirty = true;
      })),

    deleteElements: () =>
      withHistory('요소 삭제', () =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        const toDelete = new Set(state.selectedElementIds);
        for (const section of state.document.sections) {
          const before = section.elements.length;
          section.elements = section.elements.filter((el: CanvasElement) => !toDelete.has(el.id));
          // 삭제 후 섹션 높이 자동 축소
          if (section.elements.length < before && !section.userAdjustedHeight) {
            let maxBottom = 0;
            for (const el of section.elements) {
              const bottom = el.transform.y + el.transform.height;
              if (bottom > maxBottom) maxBottom = bottom;
            }
            section.canvas.height = Math.max(200, maxBottom);
          }
        }
        state.selectedElementIds = [];
        state.selectedElementId = null;
        state.isDirty = true;
      })),

    copyElements: () =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        const selectedSet = new Set(state.selectedElementIds);
        const copied: CanvasElement[] = [];
        for (const section of state.document.sections) {
          for (const el of section.elements) {
            if (selectedSet.has(el.id)) {
              copied.push(JSON.parse(JSON.stringify(el)));
            }
          }
        }
        state.clipboardElements = copied;
      }),

    pasteElements: () =>
      withHistory('붙여넣기', () =>
      set((state) => {
        if (!state.document || state.clipboardElements.length === 0) return;
        const targetSectionId = state.selectedSectionId;
        if (!targetSectionId) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === targetSectionId);
        if (!section) return;
        const newIds: string[] = [];
        const groupIdMap = new Map<string, string>();
        for (const el of state.clipboardElements) {
          const newEl: CanvasElement = {
            ...JSON.parse(JSON.stringify(el)),
            id: crypto.randomUUID(),
            transform: { ...el.transform, x: el.transform.x + 20, y: el.transform.y + 20 },
          };
          // groupId 리맵: 같은 그룹은 새 그룹으로 유지
          if (newEl.groupId) {
            if (!groupIdMap.has(newEl.groupId)) groupIdMap.set(newEl.groupId, crypto.randomUUID());
            newEl.groupId = groupIdMap.get(newEl.groupId);
          }
          section.elements.push(newEl);
          newIds.push(newEl.id);
        }
        state.selectedElementIds = newIds;
        state.selectedElementId = newIds[newIds.length - 1] ?? null;
        state.isDirty = true;
      })),

    duplicateElements: () =>
      withHistory('요소 복제', () =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        const selectedSet = new Set(state.selectedElementIds);
        const newIds: string[] = [];
        const groupIdMap = new Map<string, string>();
        for (const section of state.document.sections) {
          const toAdd: CanvasElement[] = [];
          for (const el of section.elements) {
            if (selectedSet.has(el.id)) {
              const cloned: CanvasElement = {
                ...JSON.parse(JSON.stringify(el)),
                id: crypto.randomUUID(),
                transform: { ...el.transform, x: el.transform.x + 20, y: el.transform.y + 20 },
              };
              // groupId 리맵
              if (cloned.groupId) {
                if (!groupIdMap.has(cloned.groupId)) groupIdMap.set(cloned.groupId, crypto.randomUUID());
                cloned.groupId = groupIdMap.get(cloned.groupId);
              }
              toAdd.push(cloned);
              newIds.push(cloned.id);
            }
          }
          section.elements.push(...toAdd);
        }
        if (newIds.length > 0) {
          state.selectedElementIds = newIds;
          state.selectedElementId = newIds[newIds.length - 1] ?? null;
          state.isDirty = true;
        }
      })),

    selectAllInSection: (sectionId) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const ids = section.elements.filter((el: CanvasElement) => el.isVisible).map((el: CanvasElement) => el.id);
        state.selectedElementIds = ids;
        state.selectedElementId = ids[ids.length - 1] ?? null;
      }),

    changeZIndex: (sectionId, elementId, delta) =>
      withHistory('z-index 변경', () =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const el = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!el) return;
        el.zIndex = Math.max(0, el.zIndex + delta);
        state.isDirty = true;
      })),

    markDirty: () =>
      set((state) => {
        state.isDirty = true;
      }),

    markSaved: () =>
      set((state) => {
        state.isDirty = false;
        state.saveStatus = 'saved';
      }),

    setSaveStatus: (status) =>
      set((state) => {
        state.saveStatus = status;
      }),

    requestSave: () =>
      set((state) => {
        state.saveRequested = true;
      }),

    clearSaveRequest: () =>
      set((state) => {
        state.saveRequested = false;
      }),

    // ── V4.3 Phase 3 액션 ──

    setLayoutDirty: (dirty) =>
      set((state) => {
        state.layoutDirty = dirty;
        if (dirty) state.isDirty = true;
      }),

    setExportDirty: (dirty) =>
      set((state) => {
        state.exportDirty = dirty;
        if (dirty) state.isDirty = true;
      }),

    updateMeasuredHeight: (sectionId, height) =>
      set((state) => {
        state.measuredHeights[sectionId] = height;
      }),

    setDerivativePreview: (mode) =>
      set((state) => {
        state.derivativePreview = mode;
      }),

    setExportWarnings: (warnings) =>
      set((state) => {
        state.exportWarnings = warnings;
      }),

    setStrategyContract: (contract) =>
      set((state) => {
        state.strategyContract = contract;
      }),

    setRegenTarget: (target) =>
      set((state) => {
        state.regenTarget = target;
      }),

    setTextRegenTarget: (target) =>
      set((state) => {
        state.textRegenTarget = target;
      }),

    setCropTarget: (target) =>
      set((state) => {
        state.cropTarget = target;
      }),

    setRailTab: (tab) =>
      set((state) => {
        state.railTab = tab;
      }),

    addSection: (section, insertAfterSectionId) =>
      withHistory('섹션 추가', () =>
      set((state) => {
        if (!state.document) return;
        const sections = state.document.sections;
        if (insertAfterSectionId) {
          const idx = sections.findIndex((s: CanvasSection) => s.id === insertAfterSectionId);
          if (idx !== -1) {
            sections.splice(idx + 1, 0, section);
          } else {
            sections.push(section);
          }
        } else {
          sections.push(section);
        }
        // order 재계산
        sections.forEach((s: CanvasSection, i: number) => {
          s.order = i;
        });
        state.isDirty = true;
        state.layoutDirty = true;
      })),

    removeSection: (sectionId) =>
      withHistory('섹션 삭제', () =>
      set((state) => {
        if (!state.document) return;
        state.document.sections = state.document.sections.filter(
          (s: CanvasSection) => s.id !== sectionId,
        );
        // order 재계산
        state.document.sections.forEach((s: CanvasSection, i: number) => {
          s.order = i;
        });
        // 선택 해제
        if (state.selectedSectionId === sectionId) {
          state.selectedSectionId = null;
          state.selectedElementId = null;
          state.selectedElementIds = [];
        }
        state.isDirty = true;
        state.layoutDirty = true;
      })),

    toggleSectionVisibility: (sectionId) =>
      withHistory('섹션 표시 전환', () =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        section.isVisible = !section.isVisible;
        state.isDirty = true;
      })),

    reorderElements: (sectionId, orderedIds) =>
      withHistory('레이어 순서 변경', () =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        // orderedIds: index 0 = 가장 뒤(z=0), 마지막 = 가장 앞
        const idToZ = new Map(orderedIds.map((id, idx) => [id, idx]));
        for (const el of section.elements) {
          const z = idToZ.get(el.id);
          if (z !== undefined) el.zIndex = z;
        }
        state.isDirty = true;
      })),

    groupElements: () =>
      withHistory('그룹', () =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length < 2) return;
        const selectedSet = new Set(state.selectedElementIds);
        const groupId = crypto.randomUUID();
        for (const section of state.document.sections) {
          for (const el of section.elements) {
            if (selectedSet.has(el.id)) {
              el.groupId = groupId;
            }
          }
        }
        state.isDirty = true;
      })),

    ungroupElements: () =>
      withHistory('그룹 해제', () =>
      set((state) => {
        if (!state.document || state.selectedElementIds.length === 0) return;
        // 선택된 요소의 groupId 수집
        const groupIds = new Set<string>();
        const selectedSet = new Set(state.selectedElementIds);
        for (const section of state.document.sections) {
          for (const el of section.elements) {
            if (selectedSet.has(el.id) && el.groupId) {
              groupIds.add(el.groupId);
            }
          }
        }
        if (groupIds.size === 0) return;
        // 해당 groupId를 가진 모든 요소에서 제거
        for (const section of state.document.sections) {
          for (const el of section.elements) {
            if (el.groupId && groupIds.has(el.groupId)) {
              delete el.groupId;
            }
          }
        }
        state.isDirty = true;
      })),

    requestStyleRemeasure: (sectionId, elementId) =>
      set((state) => {
        state.styleRemeasure = {
          sectionId,
          elementId,
          token: (state.styleRemeasure?.token ?? 0) + 1,
        };
      }),

    clearStyleRemeasure: () =>
      set((state) => {
        state.styleRemeasure = null;
      }),

    applyAutoTextProps: (sectionId, elementId, partial) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;
        const element = section.elements.find((e: CanvasElement) => e.id === elementId);
        if (!element?.textProps) return;
        Object.assign(element.textProps, partial);
        // userStyledKeys 미기록 — 시스템 자동 적용은 사용자 편집이 아니다
        state.isDirty = true;
      }),

    settleInitialReflow: () =>
      set((state) => {
        if (!state.document) return;
        for (const section of state.document.sections) {
          if (section.needsInitialReflow) section.needsInitialReflow = false;
        }
        // isDirty 미설정 — 정산은 저장 파이프라인 내부 단계
      }),

    reflowSection: (sectionId) =>
      set((state) => {
        if (!state.document) return;
        const section = state.document.sections.find((s: CanvasSection) => s.id === sectionId);
        if (!section) return;

        // ── 섹션 하단 패딩 보존 (컨테이너 pad와 동일한 멱등 방식) ──────────────
        // 변환(computeSectionHeight)·프리셋 적용이 부여한 하단 여백이 초기 리플로우
        // 에서 소거되지 않게, 성장 전 기하 기준 pad를 기록해 최종 높이에 되살린다.
        // 상한 = 정본 토큰: 프리셋 estimatedHeight의 큰 슬랙은 기존처럼 축소 허용.
        // 구저장본(pad 0)은 0이 보존되므로 소급 변경 없음.
        let initialMaxBottom = 0;
        for (const el of section.elements) {
          const b = el.transform.y + el.transform.height;
          if (b > initialMaxBottom) initialMaxBottom = b;
        }
        const preservedBottomPad = Math.min(
          SPACING.sectionBottomPadding,
          Math.max(0, section.canvas.height - initialMaxBottom),
        );

        // ── 컨테이너 관계 사전 산출 ─────────────────────────────────────────
        // 컨테이너의 "하단 패딩"(현재 기하 기준 bottom - 최하단 자식 bottom)을
        // 미리 기록해 두고, 텍스트 성장 후 fit 패스에서 자식+패딩으로 재계산한다.
        // (기존 += deltaH 누적 방식은 재로드마다 성장이 중복 적용될 수 있었다)
        const containers = section.elements.filter(
          (e: CanvasElement) => e.containerOf && e.containerOf.length > 0,
        );
        const elById = new Map(section.elements.map((e: CanvasElement) => [e.id, e]));
        const containerPad = new Map<string, number>();
        for (const c of containers) {
          let maxChildBottom = -Infinity;
          for (const id of c.containerOf!) {
            const child = elById.get(id);
            if (child) maxChildBottom = Math.max(maxChildBottom, child.transform.y + child.transform.height);
          }
          if (maxChildBottom > -Infinity) {
            // 음수 패딩(자식이 이미 컨테이너를 뚫은 구저장본)은 0으로 치유
            containerPad.set(c.id, Math.max(0, c.transform.y + c.transform.height - maxChildBottom));
          }
        }

        // y 기준 오름차순 정렬된 인덱스 배열
        const sorted = [...section.elements]
          .map((el, idx) => ({ el, idx }))
          .sort((a, b) => a.el.transform.y - b.el.transform.y);

        for (const { el } of sorted) {
          // autoHeight 텍스트 요소만 처리 (undefined도 true로 취급)
          if (el.type !== 'text' || el.autoHeight === false) continue;
          const measured = el.measuredHeight;
          if (!measured || measured <= 0) continue;

          const origH = el.transform.height;
          const minTextH = 20;
          const effectiveH = Math.max(measured, minTextH);
          const deltaH = effectiveH - origH;
          if (deltaH === 0) continue;

          // 표류 감시 가드 — 대형 delta는 폰트 미로딩 측정/추정기 오차 회귀 신호.
          // 레이아웃 정확성을 위해 적용은 하되 원인 추적용으로 경고를 남긴다.
          if (Math.abs(deltaH) > 120) {
            console.warn(
              `[reflowSection] 대형 높이 표류 감지: ${el.id} ${origH}→${effectiveH}px (Δ${deltaH})`,
            );
          }

          // 높이 갱신
          el.transform.height = effectiveH;

          const threshold = el.transform.y + origH;
          const myContainers = containers.filter((c: CanvasElement) => c.containerOf!.includes(el.id));

          if (myContainers.length > 0) {
            // 컨테이너 내부 텍스트: 밀어내기를 같은 컨테이너의 형제(threshold 이하)로
            // 한정한다. 컨테이너 밖 전파는 fit 패스가 bottom 변화분으로 1회 수행 —
            // 이웃 그리드 셀(USP 2×2)·같은 카드 상단(별점/이름)은 건드리지 않는다.
            const siblings = new Set<string>();
            for (const c of myContainers) {
              c.containerOf!.forEach((id: string) => siblings.add(id));
            }
            for (const other of section.elements) {
              if (other.id === el.id || !siblings.has(other.id)) continue;
              if (other.transform.y >= threshold) {
                other.transform.y += deltaH;
              }
            }
          } else {
            // 컨테이너 밖 텍스트(섹션 타이틀 등): 아래 전체를 균등 이동 —
            // 카드/셀은 통째로 함께 이동하므로 내부 정합이 유지된다
            for (const other of section.elements) {
              if (other.id === el.id) continue;
              if (other.transform.y >= threshold) {
                other.transform.y += deltaH;
              }
            }
          }
        }

        // ── 컨테이너 fit 패스 ──────────────────────────────────────────────
        // 자식 최하단 + 보존된 패딩으로 컨테이너 높이를 재계산한다 (멱등).
        // bottom 변화분은 컨테이너 아래 요소에 1회 전파 — 동일 자식 집합을
        // 공유하는 컨테이너(스텝 bg/보더)는 서명으로 중복 전파를 방지한다.
        const shiftedSignatures = new Set<string>();
        const containersByY = [...containers].sort((a, b) => a.transform.y - b.transform.y);
        for (const c of containersByY) {
          const pad = containerPad.get(c.id);
          if (pad === undefined) continue;
          let maxChildBottom = -Infinity;
          for (const id of c.containerOf!) {
            const child = elById.get(id);
            if (child) maxChildBottom = Math.max(maxChildBottom, child.transform.y + child.transform.height);
          }
          if (maxChildBottom === -Infinity) continue;

          const oldBottom = c.transform.y + c.transform.height;
          const newH = Math.max(20, maxChildBottom + pad - c.transform.y);
          const dBottom = c.transform.y + newH - oldBottom;
          c.transform.height = newH;

          if (dBottom !== 0) {
            const signature = [...c.containerOf!].sort().join(',');
            if (!shiftedSignatures.has(signature)) {
              shiftedSignatures.add(signature);
              const children = new Set(c.containerOf!);
              for (const other of section.elements) {
                if (other.id === c.id || children.has(other.id)) continue;
                if (other.transform.y >= oldBottom - 0.5) {
                  other.transform.y += dBottom;
                }
              }
            }
          }
        }

        // 섹션 높이 재계산
        let maxBottom = 0;
        for (const el of section.elements) {
          const bottom = el.transform.y + el.transform.height;
          if (bottom > maxBottom) maxBottom = bottom;
        }
        const MIN_SECTION_HEIGHT = 200;
        if (!section.userAdjustedHeight) {
          // 요소 bounds + 보존된 하단 패딩으로 확장 AND 축소
          section.canvas.height = Math.max(MIN_SECTION_HEIGHT, maxBottom + preservedBottomPad);
        } else {
          // 사용자 조정 높이 유지, 단 요소 overflow 방지
          section.canvas.height = Math.max(section.canvas.height, maxBottom);
        }
      }),
    };
  })
);

// ─────────────────────────────────────────────
// 셀렉터 (성능 최적화용 — 필요한 것만 구독)
// ─────────────────────────────────────────────
export const selectDocument = (s: EditorStore) => s.document;
const EMPTY_SECTIONS: CanvasSection[] = [];
export const selectSections = (s: EditorStore) => s.document?.sections ?? EMPTY_SECTIONS;
export const selectSelectedSectionId = (s: EditorStore) => s.selectedSectionId;
export const selectSelectedElementId = (s: EditorStore) => s.selectedElementId;
export const selectSelectedElementIds = (s: EditorStore) => s.selectedElementIds;
export const selectZoom = (s: EditorStore) => s.zoom;
export const selectViewMode = (s: EditorStore) => s.viewMode;
export const selectIsDirty = (s: EditorStore) => s.isDirty;
export const selectSaveStatus = (s: EditorStore) => s.saveStatus;
export const selectSaveRequested = (s: EditorStore) => s.saveRequested;
// V4.3 Phase 3 셀렉터
export const selectLayoutDirty = (s: EditorStore) => s.layoutDirty;
export const selectExportDirty = (s: EditorStore) => s.exportDirty;
export const selectMeasuredHeights = (s: EditorStore) => s.measuredHeights;
export const selectDerivativePreview = (s: EditorStore) => s.derivativePreview;
export const selectExportWarnings = (s: EditorStore) => s.exportWarnings;
export const selectStrategyContract = (s: EditorStore) => s.strategyContract;
export const selectRegenTarget = (s: EditorStore) => s.regenTarget;
export const selectTextRegenTarget = (s: EditorStore) => s.textRegenTarget;
export const selectCropTarget = (s: EditorStore) => s.cropTarget;
export const selectRailTab = (s: EditorStore) => s.railTab;
export const selectShowGrid = (s: EditorStore) => s.showGrid;
export const selectStyleRemeasure = (s: EditorStore) => s.styleRemeasure;
