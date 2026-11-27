'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 4.0];

/**
 * 에디터 전역 키보드 단축키 (부록 A)
 *
 * 편집 모드 (단축키 활성)
 * - Escape           : 선택 해제
 * - Ctrl+Z           : Undo
 * - Ctrl+Shift+Z     : Redo
 * - Ctrl+C           : 선택 요소 복사
 * - Ctrl+V           : 붙여넣기 (+20px 오프셋)
 * - Ctrl+D           : 선택 요소 복제 (즉시 +20px)
 * - Delete/Backspace : 선택 요소 삭제 (텍스트 편집 중 무시)
 * - Ctrl+A           : 현재 섹션 전체 요소 선택
 * - [                : 레이어 뒤로 (zIndex - 1)
 * - ]                : 레이어 앞으로 (zIndex + 1)
 * - Ctrl++/-/0       : 줌 인/아웃/100%
 * - Ctrl+B/I/U       : Bold/Italic/Underline
 * - Space (hold)     : 팬 모드 토글
 */
export const SHORTCUT_MAP = [
  { keys: 'Escape', description: '선택 해제' },
  { keys: 'Delete / Backspace', description: '선택 요소 삭제' },
  { keys: 'Ctrl+Z', description: '실행 취소' },
  { keys: 'Ctrl+Shift+Z', description: '다시 실행' },
  { keys: 'Ctrl+C', description: '복사' },
  { keys: 'Ctrl+V', description: '붙여넣기' },
  { keys: 'Ctrl+D', description: '복제' },
  { keys: 'Ctrl+G', description: '그룹' },
  { keys: 'Ctrl+Shift+G', description: '그룹 해제' },
  { keys: 'Ctrl+A', description: '전체 선택' },
  { keys: '[ / ]', description: '레이어 순서 변경' },
  { keys: 'Ctrl++ / Ctrl+-', description: '줌 인/아웃 (프리셋)' },
  { keys: 'Ctrl+0', description: '줌 100%' },
  { keys: 'Ctrl+1', description: '화면에 맞춤' },
  { keys: 'Ctrl+S', description: '저장' },
  { keys: 'Ctrl+B / I / U', description: '굵게/기울임/밑줄' },
  { keys: '방향키', description: '요소 이동 (1px, Shift+10px)' },
  { keys: 'Space (hold)', description: '팬 모드' },
  { keys: 'Ctrl+\\', description: '패널 토글' },
  { keys: '?', description: '단축키 도움말' },
] as const;

export function useKeyboardShortcuts() {
  const clearSelection = useEditorStore((s) => s.clearSelection);

  useEffect(() => {
    // 방향키 연속 이동을 keyup 시점에 1회 post 스냅샷으로 기록 (H3 통일 모델:
    // 연속 제스처는 종료 지점 기록 — 기존에는 방향키 이동이 전혀 기록되지 않아
    // Ctrl+Z가 이동 이전의 더 먼 과거로 점프했다)
    let arrowMoved = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;

      // ── Escape: 선택 해제 (편집 중에도 동작) ──────────────────────
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      // ── Delete / Backspace: 요소 삭제 (텍스트 편집 중 무시) ────────
      // 히스토리는 deleteElements 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing) {
        const { selectedElementIds } = useEditorStore.getState();
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          useEditorStore.getState().deleteElements();
        }
        return;
      }

      // 이하 단축키: 텍스트 편집 중에는 무시 (Ctrl+Z/Ctrl+Shift+Z 예외)
      if (isEditing && !(ctrl && (e.key === 'z' || e.key === 'Z'))) return;

      // ── Ctrl+Z: Undo (H5: undoDocument가 isDirty까지 설정) ────────
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.getState().undoDocument();
        return;
      }

      // ── Ctrl+Shift+Z: Redo ────────────────────────────────────────
      if (ctrl && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useEditorStore.getState().redoDocument();
        return;
      }

      // ── Ctrl+C: 복사 ──────────────────────────────────────────────
      // M14: 캔버스 요소가 선택된 경우에만 가로챈다.
      // (선택 없음 → 브라우저 네이티브 복사 허용. 입력 필드 포커스는 위 isEditing 게이트에서 이미 제외)
      if (ctrl && e.key === 'c') {
        const { selectedElementIds } = useEditorStore.getState();
        if (selectedElementIds.length === 0) return;
        e.preventDefault();
        useEditorStore.getState().copyElements();
        return;
      }

      // ── Ctrl+V: 붙여넣기 (+20px 오프셋) — 히스토리는 스토어 내부 기록 ──
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        useEditorStore.getState().pasteElements();
        return;
      }

      // ── Ctrl+D: 복제 (+20px 오프셋) — 히스토리는 스토어 내부 기록 ──
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        useEditorStore.getState().duplicateElements();
        return;
      }

      // ── Ctrl+G: 그룹 / Ctrl+Shift+G: 그룹 해제 — 히스토리는 스토어 내부 기록 ──
      if (ctrl && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().ungroupElements();
        } else {
          useEditorStore.getState().groupElements();
        }
        return;
      }

      // ── Ctrl+A: 현재 섹션 전체 선택 ──────────────────────────────
      // M14: 선택된 섹션이 있을 때만 가로챈다.
      // (섹션 미선택 → 브라우저 네이티브 전체 선택 허용. 입력 필드 포커스는 위 isEditing 게이트에서 이미 제외)
      if (ctrl && e.key === 'a') {
        const { selectedSectionId } = useEditorStore.getState();
        if (!selectedSectionId) return;
        e.preventDefault();
        useEditorStore.getState().selectAllInSection(selectedSectionId);
        return;
      }

      // ── [ : 레이어 뒤로 (zIndex - 1) — 히스토리는 스토어 내부 기록 ──
      if (e.key === '[' && !ctrl) {
        e.preventDefault();
        const { selectedElementId, document: doc } = useEditorStore.getState();
        if (selectedElementId && doc) {
          for (const section of doc.sections) {
            if (section.elements.find((el) => el.id === selectedElementId)) {
              useEditorStore.getState().changeZIndex(section.id, selectedElementId, -1);
              break;
            }
          }
        }
        return;
      }

      // ── ] : 레이어 앞으로 (zIndex + 1) — 히스토리는 스토어 내부 기록 ──
      if (e.key === ']' && !ctrl) {
        e.preventDefault();
        const { selectedElementId, document: doc } = useEditorStore.getState();
        if (selectedElementId && doc) {
          for (const section of doc.sections) {
            if (section.elements.find((el) => el.id === selectedElementId)) {
              useEditorStore.getState().changeZIndex(section.id, selectedElementId, 1);
              break;
            }
          }
        }
        return;
      }

      // ── Ctrl++ / Ctrl+= : 줌 인 (프리셋 단계) ────────────────────
      if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const { zoom } = useEditorStore.getState();
        const next = ZOOM_PRESETS.find((p) => p > zoom + 0.001);
        if (next !== undefined) useEditorStore.getState().setZoom(next);
        return;
      }

      // ── Ctrl+- : 줌 아웃 (프리셋 단계) ────────────────────────────
      if (ctrl && e.key === '-') {
        e.preventDefault();
        const { zoom } = useEditorStore.getState();
        const prev = [...ZOOM_PRESETS].reverse().find((p) => p < zoom - 0.001);
        if (prev !== undefined) useEditorStore.getState().setZoom(prev);
        return;
      }

      // ── Ctrl+0 : 줌 100% 리셋 ────────────────────────────────────
      if (ctrl && e.key === '0') {
        e.preventDefault();
        useEditorStore.getState().setZoom(1.0);
        return;
      }

      // ── Ctrl+1 : 화면에 맞춤 ─────────────────────────────────────
      if (ctrl && e.key === '1') {
        e.preventDefault();
        const container = document.getElementById('editor-canvas-scroll');
        if (container) {
          const viewportWidth = container.clientWidth - 64;
          const fitZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewportWidth / 860));
          useEditorStore.getState().setZoom(Math.round(fitZoom * 100) / 100);
        }
        return;
      }

      // ── Ctrl+S: 저장 ──────────────────────────────────────────────
      if (ctrl && e.key === 's') {
        e.preventDefault();
        useEditorStore.getState().requestSave();
        return;
      }

      // ── Ctrl+B / Ctrl+I / Ctrl+U : 텍스트 서식 ───────────────────
      if (ctrl && (e.key === 'b' || e.key === 'i' || e.key === 'u')) {
        const { document: doc, selectedElementIds } = useEditorStore.getState();
        if (!doc || selectedElementIds.length === 0) return;

        // 선택된 요소 중 텍스트 요소가 하나라도 있는지 확인
        let hasTextElement = false;
        for (const elId of selectedElementIds) {
          for (const section of doc.sections) {
            const el = section.elements.find((elem) => elem.id === elId);
            if (el?.type === 'text' && el.textProps) {
              hasTextElement = true;
              break;
            }
          }
          if (hasTextElement) break;
        }
        if (!hasTextElement) return;

        e.preventDefault();

        // 다중선택 지원: updateSelectedTextProps 사용
        if (e.key === 'b') {
          // 첫 번째 텍스트 요소의 현재 값으로 토글 방향 결정
          let currentWeight = 400;
          for (const elId of selectedElementIds) {
            for (const section of doc.sections) {
              const el = section.elements.find((elem) => elem.id === elId);
              if (el?.type === 'text' && el.textProps) { currentWeight = el.textProps.fontWeight; break; }
            }
            break;
          }
          useEditorStore.getState().updateSelectedTextProps({ fontWeight: currentWeight >= 700 ? 400 : 700 });
        } else if (e.key === 'i') {
          let currentStyle = 'normal';
          for (const elId of selectedElementIds) {
            for (const section of doc.sections) {
              const el = section.elements.find((elem) => elem.id === elId);
              if (el?.type === 'text' && el.textProps) { currentStyle = el.textProps.fontStyle; break; }
            }
            break;
          }
          useEditorStore.getState().updateSelectedTextProps({ fontStyle: currentStyle === 'italic' ? 'normal' : 'italic' });
        } else if (e.key === 'u') {
          let currentDeco = 'none';
          for (const elId of selectedElementIds) {
            for (const section of doc.sections) {
              const el = section.elements.find((elem) => elem.id === elId);
              if (el?.type === 'text' && el.textProps) { currentDeco = el.textProps.textDecoration; break; }
            }
            break;
          }
          useEditorStore.getState().updateSelectedTextProps({ textDecoration: currentDeco === 'underline' ? 'none' : 'underline' });
        }
        // 변경 직후 post 스냅샷 (updateSelectedTextProps는 연속 입력원이 있어 자동 기록하지 않음)
        const afterSections = useEditorStore.getState().document?.sections;
        if (afterSections) {
          useCanvasStore.getState().commitHistory('텍스트 서식 변경', afterSections);
        }
        return;
      }

      // ── Arrow Keys: 요소 이동 (1px, Shift+10px) ────────────────────
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !isEditing) {
        const { selectedElementIds, document: doc } = useEditorStore.getState();
        if (!doc || selectedElementIds.length === 0) return;

        e.preventDefault();

        const delta = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
        const dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0;

        for (const elId of selectedElementIds) {
          for (const section of doc.sections) {
            const el = section.elements.find((elem) => elem.id === elId);
            if (el) {
              useEditorStore.getState().updateElementPosition(
                section.id, elId,
                el.transform.x + dx,
                el.transform.y + dy,
              );
              arrowMoved = true;
              break;
            }
          }
        }
        return;
      }

      // ── Ctrl+\ : 우측 패널 토글 (텍스트 편집 중 무시) ──────────────
      if (ctrl && e.key === '\\') {
        if (isEditing) return;
        e.preventDefault();
        const { railTab, setRailTab } = useEditorStore.getState();
        setRailTab(railTab ? null : 'properties');
        return;
      }

      // ── ? : 단축키 도움말 토글 (텍스트 편집 중 무시) ────────────────
      if (e.key === '?' && !ctrl && !isEditing) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('nexops:toggle-shortcut-help'));
        return;
      }

      // ── Space: 팬 모드 진입 ───────────────────────────────────────
      if (e.code === 'Space') {
        const canvasState = useCanvasStore.getState();
        if (canvasState.isDragging || canvasState.isResizing) return;
        e.preventDefault();
        const { viewMode, setViewMode } = useEditorStore.getState();
        if (viewMode === 'select') setViewMode('pan');
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

      // 방향키 이동 종료 → post 스냅샷 1회 기록
      if (arrowMoved && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        arrowMoved = false;
        const sections = useEditorStore.getState().document?.sections;
        if (sections) {
          useCanvasStore.getState().commitHistory('요소 이동 (키보드)', sections);
        }
      }

      // Space 해제: 팬 모드 종료
      if (e.code === 'Space') {
        const { viewMode, setViewMode } = useEditorStore.getState();
        if (viewMode === 'pan') setViewMode('select');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
