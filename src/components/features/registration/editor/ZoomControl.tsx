'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Minus, Plus, Maximize2, Check } from 'lucide-react';
import { useEditorStore, selectZoom } from '@/lib/registration/editor/stores/editorStore';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 4.0];
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const CANVAS_WIDTH = 860;

// ─────────────────────────────────────────────
// 프리셋 단계 이동 헬퍼
// ─────────────────────────────────────────────
function stepZoom(currentZoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = ZOOM_PRESETS.find((p) => p > currentZoom + 0.001);
    return next ?? currentZoom;
  }
  const prev = [...ZOOM_PRESETS].reverse().find((p) => p < currentZoom - 0.001);
  return prev ?? currentZoom;
}

// ─────────────────────────────────────────────
// ZoomControl — 플로팅 Pill 컴포넌트
// ─────────────────────────────────────────────
export default function ZoomControl() {
  const zoom = useEditorStore(selectZoom);
  const setZoom = useEditorStore((s) => s.setZoom);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuItemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const zoomPercent = Math.round(zoom * 100);

  // ── 길게 누름 연속 줌 ──
  const startHold = useCallback((direction: 1 | -1) => {
    clearHold();
    holdDelayRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => {
        const current = useEditorStore.getState().zoom;
        const next = stepZoom(current, direction);
        if (next !== current) setZoom(next);
      }, 100);
    }, 200);
  }, [setZoom]);

  const clearHold = useCallback(() => {
    if (holdDelayRef.current) { clearTimeout(holdDelayRef.current); holdDelayRef.current = null; }
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
  }, []);

  // ── 바깥 클릭 / Escape 닫기 ──
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); return; }
      // 방향키 탐색
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          return next >= menuItemsRef.current.length ? 0 : next;
        });
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? menuItemsRef.current.length - 1 : next;
        });
      }
      if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault();
        menuItemsRef.current[focusedIndex]?.click();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen, focusedIndex]);

  // 포커스 이동
  useEffect(() => {
    if (focusedIndex >= 0 && menuItemsRef.current[focusedIndex]) {
      menuItemsRef.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  // 인라인 입력 활성 시 포커스
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // ── 배율 표시 클릭/더블클릭 구분 ──
  const handleLabelClick = () => {
    if (isEditing) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setMenuOpen((prev) => !prev);
      setFocusedIndex(-1);
    }, 250);
  };

  const handleLabelDoubleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setMenuOpen(false);
    setInputValue(String(zoomPercent));
    setIsEditing(true);
  };

  // ── 인라인 입력 확정 ──
  const commitInput = () => {
    const num = parseInt(inputValue, 10);
    if (!isNaN(num)) {
      const clamped = Math.min(400, Math.max(10, num));
      setZoom(clamped / 100);
    }
    setIsEditing(false);
  };

  // ── 화면 맞춤 ──
  const fitToScreen = () => {
    const container = document.getElementById('editor-canvas-scroll');
    if (container) {
      const viewportWidth = container.clientWidth - 64;
      const fitZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewportWidth / CANVAS_WIDTH));
      setZoom(Math.round(fitZoom * 100) / 100);
    }
    setMenuOpen(false);
  };

  // ── 선택 영역에 맞춤 (현재 선택 요소 바운딩 박스 기준) ──
  const fitToSelection = () => {
    const container = document.getElementById('editor-canvas-scroll');
    const editorState = useEditorStore.getState();
    if (!container || !editorState.document || editorState.selectedElementIds.length === 0) {
      fitToScreen();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const section of editorState.document.sections) {
      for (const el of section.elements) {
        if (editorState.selectedElementIds.includes(el.id)) {
          minX = Math.min(minX, el.transform.x);
          minY = Math.min(minY, el.transform.y);
          maxX = Math.max(maxX, el.transform.x + el.transform.width);
          maxY = Math.max(maxY, el.transform.y + el.transform.height);
        }
      }
    }

    if (minX === Infinity) { fitToScreen(); return; }

    const selW = maxX - minX;
    const selH = maxY - minY;
    const viewW = container.clientWidth - 64;
    const viewH = container.clientHeight - 64;
    const fitZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(viewW / selW, viewH / selH) * 0.9));
    setZoom(Math.round(fitZoom * 100) / 100);
    setMenuOpen(false);
  };

  // ── 드롭다운 메뉴 항목 ──
  const presetItems = ZOOM_PRESETS.map((p) => ({
    label: `${Math.round(p * 100)}%`,
    value: p,
    isActive: Math.abs(zoom - p) < 0.001,
  }));

  let menuItemIndex = 0;

  return (
    <div
      className="absolute right-4 bottom-4"
      style={{ zIndex: Z_INDEX.zoomControl }}
    >
      {/* ── Pill 컨테이너 ── */}
      <div
        ref={pillRef}
        className="flex items-center h-[32px] px-1 gap-0.5 rounded-full bg-[var(--surface-elevated)] border border-[var(--border-default)] shadow-[0_4px_12px_rgba(0,0,0,0.08)] select-none"
      >
        {/* − 버튼 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--editor-brand)] focus-visible:outline-offset-1 transition-colors"
          aria-label="축소"
          onClick={() => {
            const next = stepZoom(zoom, -1);
            if (next !== zoom) setZoom(next);
          }}
          onPointerDown={() => startHold(-1)}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
        >
          <Minus size={14} />
        </button>

        {/* 배율 표시 / 드롭다운 트리거 / 인라인 입력 */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="w-12 h-6 text-center text-[13px] font-medium tabular-nums bg-[var(--surface-elevated)] border border-[var(--editor-brand)] rounded outline-none text-[var(--text-primary)]"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitInput();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onBlur={commitInput}
          />
        ) : (
          <button
            className="min-w-[48px] h-7 px-1.5 flex items-center justify-center rounded-full hover:bg-[var(--hover-overlay)] text-[13px] font-medium tabular-nums text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--editor-brand)] focus-visible:outline-offset-1 transition-colors"
            aria-label="배율 선택"
            onClick={handleLabelClick}
            onDoubleClick={handleLabelDoubleClick}
          >
            {zoomPercent}%
          </button>
        )}

        {/* + 버튼 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--editor-brand)] focus-visible:outline-offset-1 transition-colors"
          aria-label="확대"
          onClick={() => {
            const next = stepZoom(zoom, 1);
            if (next !== zoom) setZoom(next);
          }}
          onPointerDown={() => startHold(1)}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
        >
          <Plus size={14} />
        </button>

        {/* 수직 구분선 */}
        <div className="w-px h-4 bg-[var(--border-default)]" />

        {/* 화면 맞춤 버튼 */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--editor-brand)] focus-visible:outline-offset-1 transition-colors"
          aria-label="화면에 맞춤"
          onClick={fitToScreen}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* ── 드롭다운 메뉴 (위쪽 팝업) ── */}
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 bottom-[calc(100%+6px)] w-[160px] bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1"
        >
          {presetItems.map((item) => {
            const idx = menuItemIndex++;
            return (
              <button
                key={item.value}
                ref={(el) => { menuItemsRef.current[idx] = el; }}
                role="menuitem"
                className="w-full h-8 px-3 flex items-center gap-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] transition-colors"
                onClick={() => {
                  setZoom(item.value);
                  setMenuOpen(false);
                }}
              >
                <span className="w-4 flex-shrink-0">
                  {item.isActive && <Check size={14} className="text-[var(--editor-brand)]" />}
                </span>
                {item.label}
              </button>
            );
          })}

          {/* 구분선 */}
          <div className="h-px bg-[var(--border-default)] my-1" />

          {/* 화면에 맞춤 */}
          <button
            ref={(el) => { menuItemsRef.current[menuItemIndex++] = el; }}
            role="menuitem"
            className="w-full h-8 px-3 flex items-center gap-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] transition-colors"
            onClick={fitToScreen}
          >
            <span className="w-4 flex-shrink-0" />
            화면에 맞춤
          </button>

          {/* 선택 영역에 맞춤 */}
          <button
            ref={(el) => { menuItemsRef.current[menuItemIndex++] = el; }}
            role="menuitem"
            className="w-full h-8 px-3 flex items-center gap-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] transition-colors"
            onClick={fitToSelection}
          >
            <span className="w-4 flex-shrink-0" />
            선택 영역에 맞춤
          </button>
        </div>
      )}
    </div>
  );
}
