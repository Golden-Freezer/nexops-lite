'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth/clerk-shim';
import { useEditorStore, selectSections, selectZoom, selectSelectedElementIds, selectViewMode, selectDerivativePreview, selectShowGrid } from '@/lib/registration/editor/stores/editorStore';
import type { DerivativePreviewMode } from '@/lib/registration/editor/stores/editorStore';
import { uploadImageViaSignedUrl } from '@/lib/registration/editor/services/editorApi';
import { filterSectionsByDerivative } from '@/lib/registration/editor/utils/exportUtils';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import type { SnapGuide } from '@/lib/registration/editor/stores/canvasStore';
import type { CanvasElement, CanvasSection, ResizeHandle } from '@/lib/registration/editor/types/canvas';
import CanvasSectionComponent from './CanvasSection';
import SelectionBox from './SelectionBox';
import SnapGuides from './SnapGuides';
import MobilePreview from './MobilePreview';
import CanvasContextMenu from './CanvasContextMenu';
import type { ContextMenuState } from './CanvasContextMenu';
import { useKeyboardShortcuts } from '@/lib/registration/editor/hooks/useKeyboardShortcuts';
import { Z_INDEX, MIN_FONT_SIZES } from '@/lib/registration/editor/constants/designTokens';
import { measureTextBlock } from '@/lib/registration/editor/utils/sectionConverter/measure';

const CANVAS_WIDTH = 860;
const SNAP_THRESHOLD = 5;
const MIN_SIZE = 20;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;
const CANVAS_MARGIN_TOP = 32; // my-8 = 2rem

// ─────────────────────────────────────────────
// 렌더/히트테스트/가이드가 공유하는 "보이는 섹션" 목록
// (divider·비표시·0높이 제외 + 파생본 미리보기 필터 — 세 곳이 동일해야
//  스냅 가이드 y와 마퀴 히트 좌표가 화면과 일치한다)
// ─────────────────────────────────────────────
function getVisibleSortedSections(
  sections: CanvasSection[],
  derivativePreview: DerivativePreviewMode,
): CanvasSection[] {
  let list = [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0);
  if (derivativePreview !== 'master') {
    const filtered = filterSectionsByDerivative(
      list,
      derivativePreview as 'quick' | 'standard' | 'persuasive',
    );
    const ids = new Set(filtered.map((s) => s.id));
    list = list.filter((s) => ids.has(s.id));
  }
  return list;
}

// ─────────────────────────────────────────────
// 스냅 계산 헬퍼
// ─────────────────────────────────────────────
function computeSnap(
  elemX: number,
  elemY: number,
  elemW: number,
  elemH: number,
  sectionElements: CanvasElement[],
  dragElementId: string,
  sectionHeight: number,
): { snappedX: number; snappedY: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let snappedX = elemX;
  let snappedY = elemY;

  const myLeft = elemX;
  const myRight = elemX + elemW;
  const myCenterX = elemX + elemW / 2;
  const myTop = elemY;
  const myBottom = elemY + elemH;
  const myCenterY = elemY + elemH / 2;

  // 캔버스 중앙선 가이드 (x=430)
  const canvasCenterX = CANVAS_WIDTH / 2;
  if (Math.abs(myCenterX - canvasCenterX) < SNAP_THRESHOLD) {
    snappedX = canvasCenterX - elemW / 2;
    guides.push({ orientation: 'vertical', position: canvasCenterX, type: 'center' });
  }

  // 섹션 중앙 가로선 가이드
  if (sectionHeight > 0) {
    const sectionCenterY = sectionHeight / 2;
    if (Math.abs(myCenterY - sectionCenterY) < SNAP_THRESHOLD) {
      snappedY = sectionCenterY - elemH / 2;
      guides.push({ orientation: 'horizontal', position: sectionCenterY, type: 'center' });
    }
  }

  for (const other of sectionElements) {
    if (other.id === dragElementId || !other.isVisible) continue;
    const ox = other.transform.x;
    const oy = other.transform.y;
    const ow = other.transform.width;
    const oh = other.transform.height;
    const otherLeft = ox;
    const otherRight = ox + ow;
    const otherCenterX = ox + ow / 2;
    const otherTop = oy;
    const otherBottom = oy + oh;
    const otherCenterY = oy + oh / 2;

    // X-axis snaps
    if (Math.abs(myLeft - otherLeft) < SNAP_THRESHOLD) {
      snappedX = otherLeft;
      guides.push({ orientation: 'vertical', position: otherLeft, type: 'edge' });
    } else if (Math.abs(myRight - otherRight) < SNAP_THRESHOLD) {
      snappedX = otherRight - elemW;
      guides.push({ orientation: 'vertical', position: otherRight, type: 'edge' });
    } else if (Math.abs(myLeft - otherRight) < SNAP_THRESHOLD) {
      snappedX = otherRight;
      guides.push({ orientation: 'vertical', position: otherRight, type: 'edge' });
    } else if (Math.abs(myRight - otherLeft) < SNAP_THRESHOLD) {
      snappedX = otherLeft - elemW;
      guides.push({ orientation: 'vertical', position: otherLeft, type: 'edge' });
    } else if (Math.abs(myCenterX - otherCenterX) < SNAP_THRESHOLD) {
      snappedX = otherCenterX - elemW / 2;
      guides.push({ orientation: 'vertical', position: otherCenterX, type: 'center' });
    }

    // Y-axis snaps
    if (Math.abs(myTop - otherTop) < SNAP_THRESHOLD) {
      snappedY = otherTop;
      guides.push({ orientation: 'horizontal', position: otherTop, type: 'edge' });
    } else if (Math.abs(myBottom - otherBottom) < SNAP_THRESHOLD) {
      snappedY = otherBottom - elemH;
      guides.push({ orientation: 'horizontal', position: otherBottom, type: 'edge' });
    } else if (Math.abs(myTop - otherBottom) < SNAP_THRESHOLD) {
      snappedY = otherBottom;
      guides.push({ orientation: 'horizontal', position: otherBottom, type: 'edge' });
    } else if (Math.abs(myBottom - otherTop) < SNAP_THRESHOLD) {
      snappedY = otherTop - elemH;
      guides.push({ orientation: 'horizontal', position: otherTop, type: 'edge' });
    } else if (Math.abs(myCenterY - otherCenterY) < SNAP_THRESHOLD) {
      snappedY = otherCenterY - elemH / 2;
      guides.push({ orientation: 'horizontal', position: otherCenterY, type: 'center' });
    }
  }

  return { snappedX, snappedY, guides };
}

// ─────────────────────────────────────────────
// P1-2: 그룹 리사이즈 시작 상태
// ─────────────────────────────────────────────
interface GroupResizeStart {
  sectionId: string;
  starts: Record<string, {
    x: number; y: number; width: number; height: number;
    fontSize?: number; minFont?: number;
  }>;
}

// ─────────────────────────────────────────────
// 리사이즈 계산 헬퍼
// ─────────────────────────────────────────────
function computeResize(
  handle: ResizeHandle,
  startBounds: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY: number,
  shiftKey: boolean,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = startBounds;

  switch (handle) {
    case 'top-left':
      x = startBounds.x + deltaX;
      y = startBounds.y + deltaY;
      width = Math.max(MIN_SIZE, startBounds.width - deltaX);
      height = Math.max(MIN_SIZE, startBounds.height - deltaY);
      break;
    case 'top-center':
      y = startBounds.y + deltaY;
      height = Math.max(MIN_SIZE, startBounds.height - deltaY);
      break;
    case 'top-right':
      y = startBounds.y + deltaY;
      width = Math.max(MIN_SIZE, startBounds.width + deltaX);
      height = Math.max(MIN_SIZE, startBounds.height - deltaY);
      break;
    case 'middle-left':
      x = startBounds.x + deltaX;
      width = Math.max(MIN_SIZE, startBounds.width - deltaX);
      break;
    case 'middle-right':
      width = Math.max(MIN_SIZE, startBounds.width + deltaX);
      break;
    case 'bottom-left':
      x = startBounds.x + deltaX;
      width = Math.max(MIN_SIZE, startBounds.width - deltaX);
      height = Math.max(MIN_SIZE, startBounds.height + deltaY);
      break;
    case 'bottom-center':
      height = Math.max(MIN_SIZE, startBounds.height + deltaY);
      break;
    case 'bottom-right':
      width = Math.max(MIN_SIZE, startBounds.width + deltaX);
      height = Math.max(MIN_SIZE, startBounds.height + deltaY);
      break;
  }

  // 꼭지점 핸들 + Shift: 비율 유지
  const cornerHandles: ResizeHandle[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  if (shiftKey && cornerHandles.includes(handle)) {
    const aspect = startBounds.width / startBounds.height;
    if (Math.abs(width - startBounds.width) >= Math.abs(height - startBounds.height)) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  }

  return { x, y, width, height };
}

// ─────────────────────────────────────────────
// Canvas 컴포넌트
// ─────────────────────────────────────────────
export default function Canvas() {
  const sections = useEditorStore(selectSections);
  const zoom = useEditorStore(selectZoom);
  const viewMode = useEditorStore(selectViewMode);
  const selectedElementIds = useEditorStore(selectSelectedElementIds);
  const derivativePreview = useEditorStore(selectDerivativePreview);
  const showGrid = useEditorStore(selectShowGrid);
  const selectSection = useEditorStore((s) => s.selectSection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const updateElement = useEditorStore((s) => s.updateElement);
  const updateElementPosition = useEditorStore((s) => s.updateElementPosition);
  const updateElementSize = useEditorStore((s) => s.updateElementSize);
  const { getToken } = useAuth();

  const scrollRef = useRef<HTMLDivElement>(null);
  // 다중 선택 드래그를 위한 시작 위치 캐시
  const allStartPositionsRef = useRef<Record<string, { x: number; y: number; sectionId: string }>>({});
  const wasDraggingRef = useRef(false);
  // P1-2: 그룹(다중 선택) 리사이즈 — 제스처 시작 시점의 요소 상태 캐시
  const groupResizeStartRef = useRef<GroupResizeStart | null>(null);

  // ── RAF 최적화: pointermove 이벤트 throttle ──
  const rafRef = useRef<number | null>(null);
  const latestMoveRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null);

  // ── 컨텍스트 메뉴 상태 ───────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ── 팬 상태 ───────────────────────────────
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // ── 마퀴 선택 ──
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);

  // 컨텍스트 메뉴 이미지 교체용 hidden file input
  const contextFileInputRef = useRef<HTMLInputElement>(null);
  const contextReplaceTargetRef = useRef<{ elementId: string; sectionId: string; elementType: string } | null>(null);

  // ── 마퀴 상태 ──
  const isMarquee = useCanvasStore((s) => s.isMarquee);
  const marqueeRect = useCanvasStore((s) => s.marqueeRect);

  // 키보드 단축키 등록
  useKeyboardShortcuts();

  // ── 컨텍스트 메뉴 이미지 액션 핸들러 ──────────
  const handleContextImageReplace = useCallback(() => {
    if (!contextMenu?.elementId || !contextMenu?.sectionId || !contextMenu?.elementType) return;
    contextReplaceTargetRef.current = {
      elementId: contextMenu.elementId,
      sectionId: contextMenu.sectionId,
      elementType: contextMenu.elementType,
    };
    contextFileInputRef.current?.click();
  }, [contextMenu]);

  const handleContextFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = contextReplaceTargetRef.current;
    if (!file || !target) return;
    e.target.value = '';
    try {
      const token = await getToken();
      if (!token) return;
      const newUrl = await uploadImageViaSignedUrl(token, file);
      const doc = useEditorStore.getState().document;
      const section = doc?.sections.find((s) => s.id === target.sectionId);
      const el = section?.elements.find((e) => e.id === target.elementId);
      if (!el) return;
      if (el.type === 'image' && el.imageProps) {
        updateElement(target.sectionId, target.elementId, {
          imageProps: { ...el.imageProps, src: newUrl, isUserUploaded: true },
        });
      } else if (el.type === 'framed-image' && el.framedImageProps) {
        updateElement(target.sectionId, target.elementId, {
          framedImageProps: { ...el.framedImageProps, src: newUrl, isUserUploaded: true },
        });
      }
      const sections = useEditorStore.getState().document?.sections;
      if (sections) {
        useCanvasStore.getState().commitHistory('이미지 교체', sections);
      }
    } catch (err) {
      console.error('이미지 교체 실패:', err);
    }
  }, [getToken, updateElement]);

  const handleContextImageDownload = useCallback(async () => {
    const src = contextMenu?.imageSrc;
    if (!src) return;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${contextMenu?.imageAlt || 'image'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(src, '_blank');
    }
  }, [contextMenu]);

  // AI 재생성(이미지·카피) 모달은 Phase 4 — 백엔드 재생성 API와 함께 이식 예정

  // ── localStorage 스크롤 위치 복원 ────
  useEffect(() => {
    const savedScrollTop = Number(localStorage.getItem('nexops-editor-scrollTop')) || 0;
    const savedScrollLeft = Number(localStorage.getItem('nexops-editor-scrollLeft')) || 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = savedScrollTop;
      scrollRef.current.scrollLeft = savedScrollLeft;
    }
  }, []);

  // ── localStorage 스크롤 위치 저장 (디바운스 500ms) ────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        localStorage.setItem('nexops-editor-scrollTop', String(container.scrollTop));
        localStorage.setItem('nexops-editor-scrollLeft', String(container.scrollLeft));
      }, 500);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => { container.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);

  // ── 좌측 패널 섹션 클릭 → 캔버스 스크롤 ────
  useEffect(() => {
    const handler = (e: Event) => {
      const sectionId = (e as CustomEvent).detail;
      if (!scrollRef.current || !sectionId) return;
      const el = scrollRef.current.querySelector(`[data-section-id="${sectionId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('nexops:scroll-to-section', handler);
    return () => window.removeEventListener('nexops:scroll-to-section', handler);
  }, []);

  // ── Ctrl+휠 줌 ────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const { zoom: oldZoom } = useEditorStore.getState();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const rawZoom = oldZoom + delta;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(rawZoom * 10) / 10));
      if (newZoom === oldZoom) return;

      // 마우스 커서 위치를 기준으로 스크롤 조정 (zoom-to-cursor)
      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const canvasY = (container.scrollTop + mouseY - CANVAS_MARGIN_TOP) / oldZoom;

      useEditorStore.getState().setZoom(newZoom);

      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = Math.max(0, CANVAS_MARGIN_TOP + canvasY * newZoom - mouseY);
      });
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // c13: divider 및 height=0 섹션 제외 + 파생본 미리보기 필터 (공용 헬퍼)
  const sortedSections = getVisibleSortedSections(sections, derivativePreview);

  // 섹션 Y 오프셋 계산 (SelectionBox 오버레이 절대 위치 계산용)
  let yOffset = 0;
  const sectionOffsets: Record<string, number> = {};
  for (const section of sortedSections) {
    sectionOffsets[section.id] = yOffset;
    yOffset += section.canvas.height;
  }
  const totalCanvasHeight = yOffset;

  // 선택된 요소의 렌더 정보 수집 (선택 박스 오버레이)
  type SelectedInfo = { element: CanvasElement; section: CanvasSection; sectionOffsetY: number };
  const selectedInfos: SelectedInfo[] = [];
  if (selectedElementIds.length > 0) {
    for (const section of sortedSections) {
      const sectionOffsetY = sectionOffsets[section.id] ?? 0;
      for (const el of section.elements) {
        if (selectedElementIds.includes(el.id) && el.isVisible) {
          selectedInfos.push({ element: el, section, sectionOffsetY });
        }
      }
    }
  }

  // ── 실제 드래그/리사이즈 처리 (RAF 내부에서 호출) ───────────────
  const processPointerMove = useCallback((clientX: number, clientY: number, shiftKey: boolean) => {
    const canvasState = useCanvasStore.getState();
    const editorState = useEditorStore.getState();
    const currentZoom = editorState.zoom;

    // ── 섹션 리사이즈 ──
    if (canvasState.isSectionResizing && canvasState.sectionResizeState) {
      const { sectionId, direction, startMouseY, startHeight } = canvasState.sectionResizeState;
      const deltaY = (clientY - startMouseY) / currentZoom;
      let newHeight = direction === 'bottom' ? startHeight + deltaY : startHeight - deltaY;

      const section = editorState.document?.sections.find((s: CanvasSection) => s.id === sectionId);
      if (section) {
        let maxBottom = 0;
        for (const el of section.elements) {
          const bottom = el.transform.y + el.transform.height;
          if (bottom > maxBottom) maxBottom = bottom;
        }
        newHeight = Math.max(200, maxBottom, newHeight);

        editorState.updateSection(sectionId, {
          ...section,
          canvas: { ...section.canvas, height: Math.round(newHeight) },
          userAdjustedHeight: true,
        });
      }
      return;
    }

    // ── 마퀴 업데이트 ──
    if (canvasState.isMarquee) {
      const container = scrollRef.current;
      if (!container) return;
      const wrapperRect = container.querySelector('[data-canvas-content]')?.getBoundingClientRect();
      if (!wrapperRect) return;
      const canvasX = (clientX - wrapperRect.left) / currentZoom;
      const canvasY = (clientY - wrapperRect.top) / currentZoom;
      useCanvasStore.getState().updateMarquee(canvasX, canvasY);
      return;
    }

    // ── 드래그 ──────────────────────────────
    if (canvasState.isDragging) {
      const { dragState } = canvasState;
      if (!dragState.dragElementId || !dragState.dragSectionId) return;

      // 다중 선택 드래그 시작 시 원점 캐시
      if (!wasDraggingRef.current) {
        wasDraggingRef.current = true;
        allStartPositionsRef.current = {};
        const { selectedElementIds: selIds } = editorState;
        for (const section of editorState.document?.sections ?? []) {
          for (const el of section.elements) {
            if (selIds.includes(el.id)) {
              allStartPositionsRef.current[el.id] = {
                x: el.transform.x,
                y: el.transform.y,
                sectionId: section.id,
              };
            }
          }
        }
      }

      const rawDeltaX = (clientX - dragState.startX) / currentZoom;
      const rawDeltaY = (clientY - dragState.startY) / currentZoom;

      // Shift: 축 고정
      let deltaX = rawDeltaX;
      let deltaY = rawDeltaY;
      if (shiftKey) {
        if (Math.abs(rawDeltaX) >= Math.abs(rawDeltaY)) {
          deltaY = 0;
        } else {
          deltaX = 0;
        }
      }

      const baseX = dragState.offsetX + deltaX;
      const baseY = dragState.offsetY + deltaY;

      const sectionId = dragState.dragSectionId;
      const section = editorState.document?.sections.find((s: CanvasSection) => s.id === sectionId);
      const mainElem = section?.elements.find((el: CanvasElement) => el.id === dragState.dragElementId);
      const elemW = mainElem?.transform.width ?? 0;
      const elemH = mainElem?.transform.height ?? 0;

      const { snappedX, snappedY, guides } = computeSnap(
        baseX, baseY, elemW, elemH,
        section?.elements ?? [],
        dragState.dragElementId,
        section?.canvas.height ?? 0,
      );

      // 가로 가이드는 섹션 로컬 y → 캔버스 전역 y 변환
      // (SnapGuides 오버레이는 전체 스택 기준이므로, 첫 섹션이 아니면
      //  섹션 오프셋만큼 어긋난 위치에 그려지던 버그 수정)
      if (guides.length > 0 && editorState.document) {
        let secOffset = 0;
        for (const s of getVisibleSortedSections(editorState.document.sections, editorState.derivativePreview)) {
          if (s.id === sectionId) break;
          secOffset += s.canvas.height;
        }
        for (const g of guides) {
          if (g.orientation === 'horizontal') g.position += secOffset;
        }
      }

      const snapDeltaX = snappedX - dragState.offsetX;
      const snapDeltaY = snappedY - dragState.offsetY;

      updateElementPosition(sectionId, dragState.dragElementId, snappedX, snappedY);

      const { selectedElementIds: selIds } = editorState;
      if (selIds.length > 1) {
        for (const id of selIds) {
          if (id === dragState.dragElementId) continue;
          const startPos = allStartPositionsRef.current[id];
          if (!startPos) continue;
          updateElementPosition(startPos.sectionId, id,
            startPos.x + snapDeltaX,
            startPos.y + snapDeltaY,
          );
        }
      }

      useCanvasStore.getState().setSnapGuides(guides);
      return;
    }

    // ── 리사이즈 ────────────────────────────
    if (canvasState.isResizing) {
      const { resizeState } = canvasState;
      if (!resizeState.resizeElementId || !resizeState.resizeSectionId || !resizeState.handle) return;

      const deltaX = (clientX - resizeState.startMouseX) / currentZoom;
      const deltaY = (clientY - resizeState.startMouseY) / currentZoom;

      const { x, y, width, height } = computeResize(
        resizeState.handle,
        resizeState.startBounds,
        deltaX,
        deltaY,
        shiftKey,
      );

      // P1-2: 다중 선택(그룹 포함) 상태에서 핸들을 잡으면 선택 전체를 비례 스케일
      const selIds = editorState.selectedElementIds;
      const isGroupResize = selIds.length > 1 && selIds.includes(resizeState.resizeElementId);
      if (!isGroupResize) {
        updateElementPosition(resizeState.resizeSectionId, resizeState.resizeElementId, x, y);
        updateElementSize(resizeState.resizeSectionId, resizeState.resizeElementId, width, height);
        return;
      }

      // 첫 프레임: 앵커와 같은 섹션의 선택 요소 시작 상태 캡처.
      // 다른 섹션의 선택 요소는 좌표계(섹션 로컬 y)가 달라 스케일 대상에서 제외.
      if (!groupResizeStartRef.current) {
        const sec = editorState.document?.sections.find(
          (s: CanvasSection) => s.id === resizeState.resizeSectionId,
        );
        const starts: GroupResizeStart['starts'] = {};
        for (const el of sec?.elements ?? []) {
          if (!selIds.includes(el.id)) continue;
          const isAnchor = el.id === resizeState.resizeElementId;
          starts[el.id] = {
            // 앵커는 제스처 원본 bounds 사용 — 프레임 간 누적 오차 방지
            x: isAnchor ? resizeState.startBounds.x : el.transform.x,
            y: isAnchor ? resizeState.startBounds.y : el.transform.y,
            width: isAnchor ? resizeState.startBounds.width : el.transform.width,
            height: isAnchor ? resizeState.startBounds.height : el.transform.height,
            ...(el.textProps
              ? {
                  fontSize: el.textProps.fontSize,
                  // 하한 계약(GUARD): 위계 하한 아래로 축소 금지. 시작값이 이미 하한
                  // 미만인 요소(원형 뱃지 등 allowBelowMin)는 시작값이 바닥 — 클램프가
                  // 축소 중에 오히려 키우는 역전을 막는다.
                  minFont: Math.min(
                    el.textProps.fontSize,
                    MIN_FONT_SIZES[el.textProps.typoLevel ?? 'caption'] ?? MIN_FONT_SIZES.caption,
                  ),
                }
              : {}),
          };
        }
        groupResizeStartRef.current = { sectionId: resizeState.resizeSectionId, starts };
      }

      const b0 = resizeState.startBounds;
      const sx = width / Math.max(1, b0.width);
      const sy = height / Math.max(1, b0.height);
      const handle = resizeState.handle;
      // 제스처 고정점 = 잡은 핸들의 반대편 (top-left를 잡으면 bottom-right 고정)
      const fixedX = handle.includes('left') ? b0.x + b0.width : b0.x;
      const fixedY = handle.includes('top') ? b0.y + b0.height : b0.y;
      // 텍스트 스케일 계수: 세로 스케일 기준(글줄 높이와 비례).
      // 가로 전용 핸들(middle-left/right)은 폰트 유지 — 박스 폭만 바꿔 재줄바꿈.
      const fontScale = handle === 'middle-left' || handle === 'middle-right' ? 1 : sy;

      const { sectionId: gSecId, starts } = groupResizeStartRef.current;
      const gSection = editorState.document?.sections.find((s: CanvasSection) => s.id === gSecId);
      for (const el of gSection?.elements ?? []) {
        const s0 = starts[el.id];
        if (!s0) continue;
        const nx = fixedX + (s0.x - fixedX) * sx;
        const ny = fixedY + (s0.y - fixedY) * sy;
        updateElementPosition(gSecId, el.id, nx, ny);
        updateElementSize(
          gSecId, el.id,
          Math.max(MIN_SIZE, s0.width * sx),
          Math.max(MIN_SIZE, s0.height * sy),
        );
        if (s0.fontSize !== undefined && el.textProps && fontScale !== 1) {
          const newFont = Math.max(s0.minFont ?? 1, Math.round(s0.fontSize * fontScale));
          if (newFont !== el.textProps.fontSize) {
            updateElement(gSecId, el.id, { textProps: { ...el.textProps, fontSize: newFont } });
          }
        }
      }
    }
  }, [updateElementPosition, updateElementSize, updateElement]);

  // ── document-level pointer 이벤트 (RAF throttle) ─────────────
  const handlePointerMove = useCallback((e: PointerEvent) => {
    // 팬은 즉시 처리 (시각적 끊김 방지)
    if (isPanningRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = panStartRef.current.scrollLeft - (e.pageX - panStartRef.current.x);
      scrollRef.current.scrollTop = panStartRef.current.scrollTop - (e.pageY - panStartRef.current.y);
      return;
    }

    // 드래그/리사이즈: 최신 이벤트 값 저장 후 RAF 예약
    latestMoveRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const evt = latestMoveRef.current;
      if (evt) processPointerMove(evt.clientX, evt.clientY, evt.shiftKey);
    });
  }, [processPointerMove]);

  const handlePointerUp = useCallback(() => {
    // RAF 취소 (pointerup 시 미처리 프레임 무효화)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // ── 팬 종료 ──────────────────────────────
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      return;
    }

    // ── 섹션 리사이즈 종료 ──
    if (useCanvasStore.getState().isSectionResizing) {
      useCanvasStore.getState().endSectionResize();
      return;
    }

    // ── 마퀴 종료 ──
    if (useCanvasStore.getState().isMarquee) {
      const rect = useCanvasStore.getState().marqueeRect;
      if (rect) {
        const minX = Math.min(rect.startX, rect.endX);
        const maxX = Math.max(rect.startX, rect.endX);
        const minY = Math.min(rect.startY, rect.endY);
        const maxY = Math.max(rect.startY, rect.endY);

        // 범위 내 요소 검색
        const editorState = useEditorStore.getState();
        const doc = editorState.document;
        if (doc) {
          const hitIds: string[] = [];
          let yOff = 0;
          // 렌더와 동일한 필터(파생본 미리보기 포함) — 화면에 없는 섹션의
          // 요소가 마퀴에 잡히던 좌표 불일치 방지
          const sorted = getVisibleSortedSections(doc.sections, editorState.derivativePreview);
          for (const section of sorted) {
            for (const el of section.elements) {
              if (!el.isVisible) continue;
              const elLeft = el.transform.x;
              const elTop = yOff + el.transform.y;
              const elRight = elLeft + el.transform.width;
              const elBottom = elTop + el.transform.height;
              // intersection check
              if (elRight > minX && elLeft < maxX && elBottom > minY && elTop < maxY) {
                hitIds.push(el.id);
              }
            }
            yOff += section.canvas.height;
          }
          if (hitIds.length > 0) {
            useEditorStore.setState({
              selectedElementIds: hitIds,
              selectedElementId: hitIds[hitIds.length - 1] ?? null,
            });
          }
        }
      }
      useCanvasStore.getState().endMarquee();
      return;
    }

    const canvasState = useCanvasStore.getState();

    if (canvasState.isDragging || canvasState.isResizing) {
      const edState = useEditorStore.getState();
      const findEl = (secId: string, elId: string): CanvasElement | undefined =>
        edState.document?.sections
          .find((s: CanvasSection) => s.id === secId)
          ?.elements.find((e: CanvasElement) => e.id === elId);

      // 실제 변경 여부 판정 — 이동/크기 변화 없는 단순 클릭(pointerdown→up)이
      // '요소 이동' 스냅샷을 쌓아 Ctrl+Z가 헛도는 히스토리 오염 방지
      let mutated = false;

      if (canvasState.isResizing) {
        const { resizeState } = canvasState;
        if (resizeState.resizeElementId && resizeState.resizeSectionId) {
          const el = findEl(resizeState.resizeSectionId, resizeState.resizeElementId);
          const b = resizeState.startBounds;
          mutated = !!el && (
            el.transform.x !== b.x ||
            el.transform.y !== b.y ||
            el.transform.width !== b.width ||
            el.transform.height !== b.height
          );
          if (mutated) {
            const groupStart = groupResizeStartRef.current;
            if (groupStart) {
              // P1-2: 그룹 스케일 커밋 — 텍스트는 autoHeight를 유지하고, 새 fontSize
              // 기준 추정 높이로 measuredHeight를 동기화한다. 미동기 시 reflowSection이
              // 스케일 이전 실측(stale)으로 높이를 되돌린다.
              const gSec = edState.document?.sections.find(
                (s: CanvasSection) => s.id === groupStart.sectionId,
              );
              for (const gel of gSec?.elements ?? []) {
                if (!(gel.id in groupStart.starts)) continue;
                if (gel.type !== 'text' || gel.autoHeight === false || !gel.textProps?.content) continue;
                const est = measureTextBlock(
                  gel.textProps.content,
                  gel.textProps.fontSize,
                  gel.textProps.lineHeight,
                  gel.transform.width,
                );
                if (est > 0) {
                  edState.updateElement(groupStart.sectionId, gel.id, {
                    measuredHeight: est,
                    ...(est !== gel.transform.height
                      ? { transform: { ...gel.transform, height: est } }
                      : {}),
                  });
                }
              }
              edState.reflowSection(groupStart.sectionId);
            } else {
              // V4.5: 텍스트 요소를 수동 리사이즈하면 autoHeight 비활성화
              if (el?.type === 'text') {
                edState.updateElement(resizeState.resizeSectionId, resizeState.resizeElementId, { autoHeight: false });
              }
              // 리사이즈 완료 후 섹션 높이 자동 축소
              edState.reflowSection(resizeState.resizeSectionId);
            }
          }
        }
      }

      if (canvasState.isDragging) {
        const { dragState } = canvasState;
        if (dragState.dragElementId && dragState.dragSectionId) {
          const el = findEl(dragState.dragSectionId, dragState.dragElementId);
          mutated = !!el && (
            el.transform.x !== dragState.offsetX ||
            el.transform.y !== dragState.offsetY
          );
          // 드래그 완료 후 섹션 높이 자동 축소
          if (mutated) {
            edState.reflowSection(dragState.dragSectionId);
          }
        }
      }

      // 제스처 종료 시점의 post 스냅샷 (연속 이동은 기록하지 않음 — H3 통일 모델)
      if (mutated) {
        const sections = useEditorStore.getState().document?.sections ?? [];
        useCanvasStore.getState().commitHistory(
          canvasState.isDragging ? '요소 이동' : '요소 리사이즈',
          sections,
        );
      }

      useCanvasStore.getState().endDrag();
      useCanvasStore.getState().endResize();
      useCanvasStore.getState().clearSnapGuides();
    }

    wasDraggingRef.current = false;
    allStartPositionsRef.current = {};
    groupResizeStartRef.current = null;
  }, []);

  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // ── 팬 시작 (Space+드래그) ──────────────────
  function handleScrollPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (useEditorStore.getState().viewMode !== 'pan') return;
    e.preventDefault();
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = {
      x: e.pageX,
      y: e.pageY,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    };
  }

  // ── 커서 스타일 ─────────────────────────────
  const cursor =
    viewMode === 'pan'
      ? isPanning
        ? 'grabbing'
        : 'grab'
      : 'default';

  // ── 모바일 뷰 전환 (hooks 이후) ──────────
  if (viewMode === 'mobile') {
    return <MobilePreview />;
  }

  return (
    /* 스크롤 컨테이너 */
    <div
      ref={scrollRef}
      id="editor-canvas-scroll"
      className="flex-1 overflow-auto bg-[var(--surface-canvas)]"
      style={{
        cursor,
        ...(showGrid && {
          backgroundImage: 'radial-gradient(circle, var(--editor-canvas-dot) 0.5px, transparent 0.5px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundAttachment: 'local',
        }),
      }}
      onPointerDown={handleScrollPointerDown}
      onClick={(e) => {
        if (e.target === e.currentTarget && viewMode !== 'pan') {
          selectSection(null);
          clearSelection();
        }
      }}
    >
      {/* 캔버스 래퍼 — 860px 고정 폭 + 줌 스케일 */}
      <div
        className="mx-auto my-8 origin-top"
        style={{
          width: CANVAS_WIDTH,
          transform: `scale(${zoom})`,
          transformOrigin: 'top center',
          marginBottom: `calc(2rem - ${totalCanvasHeight * (1 - zoom)}px)`,
          position: 'relative',
        }}
        onPointerDown={(e) => {
          // Only start marquee on left-click on canvas background (not on elements)
          if (e.button !== 0 || viewMode === 'pan') return;
          const target = e.target as HTMLElement;
          if (target.closest('[data-canvas-content]') && !target.closest('[data-element-id]')) {
            const wrapperRect = (e.currentTarget as HTMLElement).querySelector('[data-canvas-content]')?.getBoundingClientRect();
            if (!wrapperRect) return;
            const canvasX = (e.clientX - wrapperRect.left) / zoom;
            const canvasY = (e.clientY - wrapperRect.top) / zoom;

            // ── text 모드: 클릭 위치에 새 텍스트 요소 추가 ──
            if (viewMode === 'text') {
              // 클릭 Y 좌표로 해당 섹션 결정
              let cumulativeY = 0;
              let targetSection: CanvasSection | null = null;
              let localY = canvasY;
              for (const sec of sortedSections) {
                if (canvasY < cumulativeY + sec.canvas.height) {
                  targetSection = sec;
                  localY = canvasY - cumulativeY;
                  break;
                }
                cumulativeY += sec.canvas.height;
              }
              if (!targetSection && sortedSections.length > 0) {
                targetSection = sortedSections[sortedSections.length - 1];
                localY = canvasY - (cumulativeY - targetSection.canvas.height);
              }
              if (targetSection) {
                const maxZ = targetSection.elements.reduce((m, el) => Math.max(m, el.zIndex), 0);
                const newTextEl: CanvasElement = {
                  id: crypto.randomUUID(),
                  type: 'text',
                  name: 'new-text',
                  transform: { x: Math.max(0, canvasX - 150), y: Math.max(0, localY), width: 300, height: 60, rotation: 0 },
                  zIndex: maxZ + 1,
                  isLocked: false,
                  isVisible: true,
                  opacity: 1,
                  textProps: {
                    content: '텍스트를 입력하세요',
                    fontFamily: 'Pretendard',
                    fontSize: 32,
                    fontWeight: 400,
                    fontStyle: 'normal',
                    textDecoration: 'none',
                    color: '#333333',
                    textAlign: 'center',
                    lineHeight: 1.5,
                    letterSpacing: -0.3,
                  },
                };
                const edState = useEditorStore.getState();
                edState.addElement(targetSection.id, newTextEl);
                edState.selectElement(newTextEl.id);
                edState.selectSection(targetSection.id);
                edState.setViewMode('select');
              }
              return;
            }

            useCanvasStore.getState().startMarquee(canvasX, canvasY);
            clearSelection();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          clearSelection();
          setContextMenu({ x: e.clientX, y: e.clientY, elementId: null, sectionId: null });
        }}
      >
        {sortedSections.length === 0 ? (
          <EmptyCanvasPlaceholder />
        ) : (
          <>
            {/* 섹션 스택 */}
            <div className="flex flex-col" data-canvas-content>
              {sortedSections.map((section) => (
                <CanvasSectionComponent
                  key={section.id}
                  section={section}
                  onElementContextMenu={(e, elementId, sectionId) => {
                    e.preventDefault();
                    const doc = useEditorStore.getState().document;
                    const sec = doc?.sections.find((s) => s.id === sectionId);
                    const el = sec?.elements.find((el) => el.id === elementId);
                    setContextMenu({
                      x: e.clientX, y: e.clientY, elementId, sectionId,
                      elementType: el?.type ?? null,
                      imageSrc: el?.imageProps?.src || el?.framedImageProps?.src || null,
                      imageAlt: el?.imageProps?.alt || el?.framedImageProps?.alt || null,
                    });
                  }}
                />
              ))}
            </div>

            {/* 스냅 가이드 오버레이 */}
            <SnapGuides canvasHeight={totalCanvasHeight} />

            {/* 선택 박스 오버레이 (overflow:hidden 영향 없이 핸들 표시) */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: CANVAS_WIDTH,
                height: totalCanvasHeight,
                pointerEvents: 'none',
                zIndex: Z_INDEX.selection,
              }}
            >
              {/* 마퀴 선택 사각형 */}
              {isMarquee && marqueeRect && (
                <div
                  style={{
                    position: 'absolute',
                    left: Math.min(marqueeRect.startX, marqueeRect.endX),
                    top: Math.min(marqueeRect.startY, marqueeRect.endY),
                    width: Math.abs(marqueeRect.endX - marqueeRect.startX),
                    height: Math.abs(marqueeRect.endY - marqueeRect.startY),
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.5)',
                    pointerEvents: 'none',
                    zIndex: Z_INDEX.marquee,
                  }}
                />
              )}
              {selectedInfos.map(({ element, section, sectionOffsetY }) => (
                <SelectionBox
                  key={element.id}
                  elementId={element.id}
                  sectionId={section.id}
                  x={element.transform.x}
                  y={sectionOffsetY + element.transform.y}
                  width={element.transform.width}
                  height={element.transform.height}
                  elementY={element.transform.y}
                  isLocked={element.isLocked}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* 컨텍스트 메뉴 이미지 교체용 hidden input */}
      <input
        ref={contextFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleContextFileChange}
        style={{ display: 'none' }}
      />

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <CanvasContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onImageReplace={handleContextImageReplace}
          onImageDownload={handleContextImageDownload}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 빈 캔버스 Placeholder
// ─────────────────────────────────────────────
function EmptyCanvasPlaceholder() {
  return (
    <div
      className="flex flex-col items-center justify-center bg-[var(--surface-base)] border-2 border-dashed border-[var(--border-default)] rounded-lg text-[var(--text-disabled)]"
      style={{ width: CANVAS_WIDTH, minHeight: 600 }}
    >
      <div className="text-5xl mb-4">🎨</div>
      <p className="text-sm font-medium text-[var(--text-secondary)]">캔버스가 비어 있습니다</p>
      <p className="text-xs mt-1 text-[var(--text-disabled)]">Pro PDP를 생성하면 섹션이 자동으로 배치됩니다.</p>
    </div>
  );
}
