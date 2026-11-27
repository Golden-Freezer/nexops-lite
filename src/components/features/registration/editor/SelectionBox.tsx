'use client';

import type { CSSProperties } from 'react';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import type { ResizeHandle } from '@/lib/registration/editor/types/canvas';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

interface SelectionBoxProps {
  elementId: string;
  sectionId: string;
  x: number;
  y: number;       // sectionOffset 포함 (시각 위치용)
  width: number;
  height: number;
  elementY: number; // 순수 element.transform.y (리사이즈 계산용)
  /** 잠금 요소: 리사이즈 핸들 숨김 (드래그와 동일하게 편집 차단) */
  isLocked?: boolean;
}

// 핸들 8개 정의 — position은 상대 위치 (%)
const HANDLES: Array<{ id: ResizeHandle; cursor: string; style: CSSProperties }> = [
  { id: 'top-left',      cursor: 'nw-resize', style: { top: -4,          left: -4 } },
  { id: 'top-center',    cursor: 'n-resize',  style: { top: -4,          left: '50%', transform: 'translateX(-50%)' } },
  { id: 'top-right',     cursor: 'ne-resize', style: { top: -4,          right: -4 } },
  { id: 'middle-left',   cursor: 'w-resize',  style: { top: '50%',       left: -4, transform: 'translateY(-50%)' } },
  { id: 'middle-right',  cursor: 'e-resize',  style: { top: '50%',       right: -4, transform: 'translateY(-50%)' } },
  { id: 'bottom-left',   cursor: 'sw-resize', style: { bottom: -4,       left: -4 } },
  { id: 'bottom-center', cursor: 's-resize',  style: { bottom: -4,       left: '50%', transform: 'translateX(-50%)' } },
  { id: 'bottom-right',  cursor: 'se-resize', style: { bottom: -4,       right: -4 } },
];

/** 핸들 시각적 크기 vs 히트 영역 크기 */
const HANDLE_SIZE = 8;
const HIT_SIZE = 24;
const HIT_OFFSET = (HIT_SIZE - HANDLE_SIZE) / 2; // 8

/** 원래 핸들 위치에서 히트 영역 확장을 위한 위치 계산 */
function expandedPosition(original: CSSProperties): CSSProperties {
  const result: CSSProperties = {};

  if (typeof original.top === 'number') {
    result.top = original.top - HIT_OFFSET;
  } else if (typeof original.top === 'string') {
    result.top = `calc(${original.top} - ${HIT_OFFSET}px)`;
  }

  if (typeof original.bottom === 'number') {
    result.bottom = original.bottom - HIT_OFFSET;
  } else if (typeof original.bottom === 'string') {
    result.bottom = `calc(${original.bottom} - ${HIT_OFFSET}px)`;
  }

  if (typeof original.left === 'number') {
    result.left = original.left - HIT_OFFSET;
  } else if (typeof original.left === 'string') {
    result.left = `calc(${original.left} - ${HIT_OFFSET}px)`;
  }

  if (typeof original.right === 'number') {
    result.right = original.right - HIT_OFFSET;
  } else if (typeof original.right === 'string') {
    result.right = `calc(${original.right} - ${HIT_OFFSET}px)`;
  }

  // transform은 그대로 유지 (translateX/Y 등)
  if (original.transform) {
    result.transform = original.transform;
  }

  return result;
}

export default function SelectionBox({
  elementId,
  sectionId,
  x,
  y,
  width,
  height,
  elementY,
  isLocked = false,
}: SelectionBoxProps) {
  const startResize = useCanvasStore((s) => s.startResize);

  const handlePointerDown = (e: React.PointerEvent, handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startResize(
      elementId,
      sectionId,
      handle,
      { x, y: elementY, width, height },
      e.clientX,
      e.clientY,
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        outline: isLocked ? '1.5px dashed #d97706' : '1.5px solid #3b82f6',
        pointerEvents: 'none',
        zIndex: Z_INDEX.marquee,
        boxSizing: 'border-box',
      }}
    >
      {!isLocked && HANDLES.map((h) => (
        <div
          key={h.id}
          onPointerDown={(e) => handlePointerDown(e, h.id)}
          style={{
            position: 'absolute',
            width: HIT_SIZE,
            height: HIT_SIZE,
            cursor: h.cursor,
            pointerEvents: 'auto',
            ...expandedPosition(h.style),
          }}
        >
          {/* 시각적 핸들 (8x8) */}
          <div
            style={{
              position: 'absolute',
              top: HIT_OFFSET,
              left: HIT_OFFSET,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              backgroundColor: '#ffffff',
              border: '1.5px solid #3b82f6',
              borderRadius: 1,
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      ))}
    </div>
  );
}
