import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DragState, ResizeState, ResizeHandle, CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { HistoryEntry } from '@/lib/registration/editor/types/editor';

// ─────────────────────────────────────────────
// 스냅 가이드 라인
// ─────────────────────────────────────────────
export interface SnapGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;   // px
  type: 'center' | 'edge' | 'distance';
}

// ─────────────────────────────────────────────
// 스토어 상태 타입
// ─────────────────────────────────────────────
interface CanvasStoreState {
  // 인터랙션 상태
  isDragging: boolean;
  isResizing: boolean;
  dragState: DragState;
  resizeState: ResizeState;

  // 스냅 가이드
  snapGuides: SnapGuide[];

  // Undo / Redo 히스토리 (최대 50개)
  history: HistoryEntry[];
  historyIndex: number;  // 현재 위치 (-1 = 초기)

  // ── V4.3 Phase 3: strategyMeta 기반 ──

  /** 전략 필터 — 이 태그 외의 섹션을 흐리게 표시 (null = 필터 없음) */
  strategyFilter: string | null;

  /** 전략 태그로 하이라이트된 섹션 ID */
  highlightedSectionId: string | null;

  // ── 섹션 리사이즈 ──
  isSectionResizing: boolean;
  sectionResizeState: {
    sectionId: string;
    direction: 'top' | 'bottom';
    startMouseY: number;
    startHeight: number;
  } | null;

  // ── V4.12: 마퀴(드래그) 다중 선택 ──
  isMarquee: boolean;
  marqueeRect: { startX: number; startY: number; endX: number; endY: number } | null;
  marqueeJustEnded: boolean;
}

// ─────────────────────────────────────────────
// 스토어 액션 타입
// ─────────────────────────────────────────────
interface CanvasStoreActions {
  // 드래그 제어
  startDrag: (elementId: string, sectionId: string, startX: number, startY: number, offsetX: number, offsetY: number) => void;
  updateDrag: (currentX: number, currentY: number, snapX?: number | null, snapY?: number | null) => void;
  endDrag: () => void;

  // 리사이즈 제어
  startResize: (
    elementId: string,
    sectionId: string,
    handle: ResizeHandle,
    startBounds: ResizeState['startBounds'],
    mouseX: number,
    mouseY: number
  ) => void;
  updateResize: (mouseX: number, mouseY: number, shiftLockAspect?: boolean) => void;
  endResize: () => void;

  // 스냅 가이드
  setSnapGuides: (guides: SnapGuide[]) => void;
  clearSnapGuides: () => void;

  // 히스토리 — 통일 모델(2026-07-07 H3~H5):
  //  · 모든 스냅샷은 "액션 직후(post)" 상태를 기록한다 (pre 스냅샷 금지)
  //  · 기록은 commitHistory 단일 지점을 통해서만 수행한다
  //  · 문서 열기(initDocument) 시 clearHistory + baseline 스냅샷 1개를 push한다
  //    → history[0] = baseline, historyIndex = 현재 상태 위치
  pushHistory: (entry: HistoryEntry) => void;
  /** 현재 sections를 깊은 복사해 post-액션 스냅샷으로 기록 (단일 기록 지점) */
  commitHistory: (description: string, sections: CanvasSection[]) => void;
  undo: () => CanvasSection[] | null;
  redo: () => CanvasSection[] | null;
  clearHistory: () => void;

  // ── V4.3 Phase 3: 전략 필터 ──
  setStrategyFilter: (tag: string | null) => void;
  setHighlightedSection: (sectionId: string | null) => void;

  // 섹션 리사이즈
  startSectionResize: (sectionId: string, direction: 'top' | 'bottom', mouseY: number, currentHeight: number) => void;
  endSectionResize: () => void;

  // 마퀴 선택
  startMarquee: (startX: number, startY: number) => void;
  updateMarquee: (endX: number, endY: number) => void;
  endMarquee: () => void;
  clearMarqueeFlag: () => void;
}

type CanvasStore = CanvasStoreState & CanvasStoreActions;

// ─────────────────────────────────────────────
// 초기 상태
// ─────────────────────────────────────────────
const initialDragState: DragState = {
  isDragging: false,
  dragElementId: null,
  dragSectionId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  offsetX: 0,
  offsetY: 0,
  snapX: null,
  snapY: null,
};

const initialResizeState: ResizeState = {
  isResizing: false,
  resizeElementId: null,
  resizeSectionId: null,
  handle: null,
  startBounds: { x: 0, y: 0, width: 0, height: 0 },
  startMouseX: 0,
  startMouseY: 0,
  currentMouseX: 0,
  currentMouseY: 0,
  shiftLockAspect: false,
};

const MAX_HISTORY = 50;

// ─────────────────────────────────────────────
// 스토어 생성 (Zustand + immer)
// ─────────────────────────────────────────────
export const useCanvasStore = create<CanvasStore>()(
  immer((set, get) => ({
    isDragging: false,
    isResizing: false,
    dragState: { ...initialDragState },
    resizeState: { ...initialResizeState },
    snapGuides: [],
    history: [],
    historyIndex: -1,
    strategyFilter: null,
    highlightedSectionId: null,
    isSectionResizing: false,
    sectionResizeState: null,
    isMarquee: false,
    marqueeRect: null,
    marqueeJustEnded: false,

    startDrag: (elementId, sectionId, startX, startY, offsetX, offsetY) =>
      set((state) => {
        state.isDragging = true;
        state.dragState = {
          isDragging: true,
          dragElementId: elementId,
          dragSectionId: sectionId,
          startX,
          startY,
          currentX: startX,
          currentY: startY,
          offsetX,
          offsetY,
          snapX: null,
          snapY: null,
        };
      }),

    updateDrag: (currentX, currentY, snapX = null, snapY = null) =>
      set((state) => {
        state.dragState.currentX = currentX;
        state.dragState.currentY = currentY;
        state.dragState.snapX = snapX;
        state.dragState.snapY = snapY;
      }),

    endDrag: () =>
      set((state) => {
        state.isDragging = false;
        state.dragState = { ...initialDragState };
      }),

    startResize: (elementId, sectionId, handle, startBounds, mouseX, mouseY) =>
      set((state) => {
        state.isResizing = true;
        state.resizeState = {
          isResizing: true,
          resizeElementId: elementId,
          resizeSectionId: sectionId,
          handle,
          startBounds,
          startMouseX: mouseX,
          startMouseY: mouseY,
          currentMouseX: mouseX,
          currentMouseY: mouseY,
          shiftLockAspect: false,
        };
      }),

    updateResize: (mouseX, mouseY, shiftLockAspect = false) =>
      set((state) => {
        state.resizeState.currentMouseX = mouseX;
        state.resizeState.currentMouseY = mouseY;
        state.resizeState.shiftLockAspect = shiftLockAspect;
      }),

    endResize: () =>
      set((state) => {
        state.isResizing = false;
        state.resizeState = { ...initialResizeState };
      }),

    setSnapGuides: (guides) =>
      set((state) => {
        state.snapGuides = guides;
      }),

    clearSnapGuides: () =>
      set((state) => {
        state.snapGuides = [];
      }),

    commitHistory: (description, sections) => {
      get().pushHistory({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description,
        sections: JSON.parse(JSON.stringify(sections)) as CanvasSection[],
      });
    },

    pushHistory: (entry) =>
      set((state) => {
        // 현재 위치 이후의 히스토리 제거 (새 액션 시 redo 브랜치 삭제)
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(entry);

        // 최대 50개 유지
        if (state.history.length > MAX_HISTORY) {
          state.history.shift();
        } else {
          state.historyIndex += 1;
        }
      }),

    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return null;

      set((state) => {
        state.historyIndex -= 1;
      });

      const targetIndex = historyIndex - 1;
      return history[targetIndex]?.sections ?? null;
    },

    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return null;

      set((state) => {
        state.historyIndex += 1;
      });

      const targetIndex = historyIndex + 1;
      return history[targetIndex]?.sections ?? null;
    },

    clearHistory: () =>
      set((state) => {
        state.history = [];
        state.historyIndex = -1;
      }),

    // ── V4.3 Phase 3 ──

    setStrategyFilter: (tag) =>
      set((state) => {
        state.strategyFilter = tag;
      }),

    setHighlightedSection: (sectionId) =>
      set((state) => {
        state.highlightedSectionId = sectionId;
      }),

    // ── 섹션 리사이즈 ──
    startSectionResize: (sectionId, direction, mouseY, currentHeight) =>
      set((state) => {
        state.isSectionResizing = true;
        state.sectionResizeState = { sectionId, direction, startMouseY: mouseY, startHeight: currentHeight };
      }),

    endSectionResize: () =>
      set((state) => {
        state.isSectionResizing = false;
        state.sectionResizeState = null;
      }),

    // ── V4.12: 마퀴 선택 ──
    startMarquee: (startX, startY) =>
      set((state) => {
        state.isMarquee = true;
        state.marqueeRect = { startX, startY, endX: startX, endY: startY };
      }),

    updateMarquee: (endX, endY) =>
      set((state) => {
        if (state.marqueeRect) {
          state.marqueeRect.endX = endX;
          state.marqueeRect.endY = endY;
        }
      }),

    endMarquee: () =>
      set((state) => {
        state.isMarquee = false;
        state.marqueeRect = null;
        state.marqueeJustEnded = true;
      }),

    clearMarqueeFlag: () =>
      set((state) => {
        state.marqueeJustEnded = false;
      }),
  }))
);

// ─────────────────────────────────────────────
// 셀렉터
// ─────────────────────────────────────────────
export const selectIsDragging = (s: CanvasStore) => s.isDragging;
export const selectIsResizing = (s: CanvasStore) => s.isResizing;
export const selectDragState = (s: CanvasStore) => s.dragState;
export const selectResizeState = (s: CanvasStore) => s.resizeState;
export const selectSnapGuides = (s: CanvasStore) => s.snapGuides;
export const selectCanUndo = (s: CanvasStore) => s.historyIndex > 0;
export const selectCanRedo = (s: CanvasStore) => s.historyIndex < s.history.length - 1;
// V4.3 Phase 3
export const selectStrategyFilter = (s: CanvasStore) => s.strategyFilter;
export const selectHighlightedSectionId = (s: CanvasStore) => s.highlightedSectionId;
// 섹션 리사이즈
export const selectIsSectionResizing = (s: CanvasStore) => s.isSectionResizing;
// V4.12: 마퀴 선택
export const selectIsMarquee = (s: CanvasStore) => s.isMarquee;
export const selectMarqueeRect = (s: CanvasStore) => s.marqueeRect;
