'use client';

import { useCanvasStore, selectSnapGuides } from '@/lib/registration/editor/stores/canvasStore';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

/**
 * 드래그/리사이즈 중 표시되는 스냅 가이드라인.
 * Canvas 내부의 절대 위치 오버레이로 렌더링된다.
 */
export default function SnapGuides({ canvasHeight }: { canvasHeight: number }) {
  const guides = useCanvasStore(selectSnapGuides);

  if (guides.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: Z_INDEX.contextMenu,
        overflow: 'hidden',
      }}
    >
      {guides.map((guide, idx) => {
        if (guide.orientation === 'vertical') {
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: guide.position,
                top: 0,
                width: 1,
                height: canvasHeight,
                borderLeft: '1px dashed #ef4444',
              }}
            />
          );
        }
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: guide.position,
              left: 0,
              right: 0,
              height: 1,
              borderTop: '1px dashed #ef4444',
            }}
          />
        );
      })}
    </div>
  );
}
