'use client';

import { useRef, useState } from 'react';
import { useEditorStore, selectSelectedSectionId } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import CanvasElementComponent from './CanvasElement';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

interface CanvasSectionProps {
  section: CanvasSection;
  onElementContextMenu?: (e: React.MouseEvent, elementId: string, sectionId: string) => void;
}

export default function CanvasSectionComponent({ section, onElementContextMenu }: CanvasSectionProps) {
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const isSelected = section.id === selectedSectionId;

  const handleSectionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 마퀴 다중 선택 직후 click 이벤트에서 선택 해제 방지
    if (useCanvasStore.getState().marqueeJustEnded) {
      useCanvasStore.getState().clearMarqueeFlag();
      return;
    }
    selectSection(section.id);
    // 섹션 배경(컨테이너 자체)을 직접 클릭했을 때만 요소 선택 해제
    if (e.target === containerRef.current) {
      clearSelection();
    }
  };

  /** 섹션 배경 pointerDown — 요소가 전체를 덮더라도 갭/패딩 클릭 시 섹션 선택 */
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target === containerRef.current) {
      selectSection(section.id);
      clearSelection();
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent, direction: 'top' | 'bottom') => {
    e.stopPropagation();
    e.preventDefault();
    useCanvasStore.getState().startSectionResize(
      section.id,
      direction,
      e.clientY,
      section.canvas.height,
    );
  };

  return (
    <div
      ref={containerRef}
      data-section-id={section.id}
      data-section-type={section.sectionType}
      onClick={handleSectionClick}
      onPointerDown={handleBackgroundPointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        width: 860,
        height: section.canvas.height,
        // B-2: canvas.backgroundColor(타입상 string)는 단색 hex 외에 CSS background
        // 축약형(linear-gradient 등)도 허용 — 렌더 지원만 추가, 생성 시 기본값은 단색 유지
        ...(section.canvas.backgroundColor?.includes('gradient')
          ? { background: section.canvas.backgroundColor }
          : { backgroundColor: section.canvas.backgroundColor }),
        outline: isSelected ? '2px solid #6366f1' : 'none',
        outlineOffset: '-2px',
        cursor: 'default',
        overflow: 'visible',
        flexShrink: 0,
      }}
    >
      {/* 콘텐츠 클리핑 래퍼 — pointerEvents:none で빈 공간 클릭이 컨테이너로 전달 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {section.elements
          .filter((el) => el.isVisible)
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((element) => (
            <CanvasElementComponent
              key={element.id}
              element={element}
              sectionId={section.id}
              sectionType={section.sectionType}
              onContextMenu={onElementContextMenu}
            />
          ))}
      </div>

      {/* 상단 리사이즈 핸들 */}
      {(isHovered || isSelected) && (
        <div
          onPointerDown={(e) => handleResizePointerDown(e, 'top')}
          style={{
            position: 'absolute',
            top: -8,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 60,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'ns-resize',
            zIndex: Z_INDEX.snapGuide,
          }}
        >
          <div
            style={{
              width: 40,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#6366f1',
              opacity: 0.8,
            }}
          />
        </div>
      )}

      {/* 하단 리사이즈 핸들 */}
      {(isHovered || isSelected) && (
        <div
          onPointerDown={(e) => handleResizePointerDown(e, 'bottom')}
          style={{
            position: 'absolute',
            bottom: -8,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 60,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'ns-resize',
            zIndex: Z_INDEX.snapGuide,
          }}
        >
          <div
            style={{
              width: 40,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#6366f1',
              opacity: 0.8,
            }}
          />
        </div>
      )}
    </div>
  );
}
