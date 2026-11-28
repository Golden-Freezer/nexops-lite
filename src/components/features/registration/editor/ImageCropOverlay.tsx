'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';

interface CropRect {
  x: number; y: number; width: number; height: number; // percentage 0-100
}

interface ImageCropOverlayProps {
  elementId: string;
  sectionId: string;
  imageSrc: string;
  initialCrop?: CropRect;
  containerWidth: number;
  containerHeight: number;
  zoom?: number;
  objectFit?: 'cover' | 'contain' | 'fill';
}

type HandlePos = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

export default function ImageCropOverlay({
  elementId,
  sectionId,
  imageSrc,
  initialCrop,
  containerWidth,
  containerHeight,
  zoom = 1,
  objectFit = 'cover',
}: ImageCropOverlayProps) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const setCropTarget = useEditorStore((s) => s.setCropTarget);

  const [crop, setCrop] = useState<CropRect>(
    initialCrop ?? { x: 10, y: 10, width: 80, height: 80 }
  );
  const dragRef = useRef<{
    type: 'move' | HandlePos;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  const pxToPercent = useCallback((px: number, total: number) => (px / total) * 100, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, type: 'move' | HandlePos) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    };
  }, [crop]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { type, startX, startY, startCrop } = dragRef.current;
      const dx = pxToPercent((e.clientX - startX) / zoom, containerWidth);
      const dy = pxToPercent((e.clientY - startY) / zoom, containerHeight);

      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

      if (type === 'move') {
        setCrop({
          ...startCrop,
          x: clamp(startCrop.x + dx, 0, 100 - startCrop.width),
          y: clamp(startCrop.y + dy, 0, 100 - startCrop.height),
        });
      } else {
        let { x, y, width, height } = startCrop;
        // Horizontal handles
        if (type === 'tl' || type === 'ml' || type === 'bl') {
          const newX = clamp(x + dx, 0, x + width - 5);
          width = width - (newX - x);
          x = newX;
        }
        if (type === 'tr' || type === 'mr' || type === 'br') {
          width = clamp(width + dx, 5, 100 - x);
        }
        // Vertical handles
        if (type === 'tl' || type === 'tc' || type === 'tr') {
          const newY = clamp(y + dy, 0, y + height - 5);
          height = height - (newY - y);
          y = newY;
        }
        if (type === 'bl' || type === 'bc' || type === 'br') {
          height = clamp(height + dy, 5, 100 - y);
        }
        setCrop({ x, y, width, height });
      }
    };

    const handlePointerUp = () => { dragRef.current = null; };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [containerWidth, containerHeight, zoom, pxToPercent]);

  // ESC 키로 취소
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCropTarget(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setCropTarget]);

  const handleConfirm = () => {
    // 요소를 찾아서 imageProps 또는 framedImageProps에 cropRect 저장
    const doc = useEditorStore.getState().document;
    if (!doc) return;
    const section = doc.sections.find((s) => s.id === sectionId);
    const element = section?.elements.find((el) => el.id === elementId);
    if (!element) return;

    const roundedCrop = {
      x: Math.round(crop.x * 10) / 10,
      y: Math.round(crop.y * 10) / 10,
      width: Math.round(crop.width * 10) / 10,
      height: Math.round(crop.height * 10) / 10,
    };

    // 크롭 영역에 맞게 transform 크기 축소
    const newWidth = Math.round(element.transform.width * (roundedCrop.width / 100));
    const newHeight = Math.round(element.transform.height * (roundedCrop.height / 100));

    const newTransform = {
      ...element.transform,
      width: newWidth,
      height: newHeight,
    };

    if (element.type === 'image' && element.imageProps) {
      updateElement(sectionId, elementId, {
        imageProps: { ...element.imageProps, cropRect: roundedCrop },
        transform: newTransform,
      });
    } else if (element.type === 'framed-image' && element.framedImageProps) {
      updateElement(sectionId, elementId, {
        framedImageProps: { ...element.framedImageProps, cropRect: roundedCrop },
        transform: newTransform,
      });
    }
    setCropTarget(null);
  };

  const handleCancel = () => setCropTarget(null);

  // 히트영역 20×20, 시각 핸들은 코너=10×10 / 엣지=20×4 or 4×20
  const handles: {
    pos: HandlePos;
    hitStyle: React.CSSProperties;
    visualStyle: React.CSSProperties;
    cursor: string;
  }[] = [
    { pos: 'tl', cursor: 'nw-resize',
      hitStyle:    { top: -10, left: -10 },
      visualStyle: { width: 10, height: 10, borderRadius: 1 } },
    { pos: 'tc', cursor: 'n-resize',
      hitStyle:    { top: -10, left: '50%', transform: 'translateX(-50%)' },
      visualStyle: { width: 20, height: 4,  borderRadius: 2 } },
    { pos: 'tr', cursor: 'ne-resize',
      hitStyle:    { top: -10, right: -10 },
      visualStyle: { width: 10, height: 10, borderRadius: 1 } },
    { pos: 'ml', cursor: 'w-resize',
      hitStyle:    { top: '50%', left: -10, transform: 'translateY(-50%)' },
      visualStyle: { width: 4,  height: 20, borderRadius: 2 } },
    { pos: 'mr', cursor: 'e-resize',
      hitStyle:    { top: '50%', right: -10, transform: 'translateY(-50%)' },
      visualStyle: { width: 4,  height: 20, borderRadius: 2 } },
    { pos: 'bl', cursor: 'sw-resize',
      hitStyle:    { bottom: -10, left: -10 },
      visualStyle: { width: 10, height: 10, borderRadius: 1 } },
    { pos: 'bc', cursor: 's-resize',
      hitStyle:    { bottom: -10, left: '50%', transform: 'translateX(-50%)' },
      visualStyle: { width: 20, height: 4,  borderRadius: 2 } },
    { pos: 'br', cursor: 'se-resize',
      hitStyle:    { bottom: -10, right: -10 },
      visualStyle: { width: 10, height: 10, borderRadius: 1 } },
  ];

  return (
    <div
      className="absolute inset-0 z-50"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 1. 어두운 원본 이미지 — 고정, 절대 움직이지 않음 */}
      {/* 크롭은 원본 비율 그대로 겹쳐 그려야 해 next/image 최적화를 쓰지 않는다 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt="crop base"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ objectFit, filter: 'brightness(0.35)' }}
        draggable={false}
      />

      {/* 2. 밝은 이미지 — clipPath로 crop 영역만 노출, 고정 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt="crop bright"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          objectFit,
          clipPath: `inset(${crop.y}% ${100 - crop.x - crop.width}% ${100 - crop.y - crop.height}% ${crop.x}%)`,
        }}
        draggable={false}
      />

      {/* 3. crop 영역 테두리 + 핸들 (이미지 없음, 테두리만) */}
      <div
        className="absolute"
        style={{
          left: `${crop.x}%`,
          top: `${crop.y}%`,
          width: `${crop.width}%`,
          height: `${crop.height}%`,
          border: '2px solid rgba(255,255,255,0.9)',
          cursor: 'move',
        }}
        onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e, 'move'); }}
      >
        {/* 룰 오브 서즈 그리드 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.3)' }} />
        </div>

        {/* 8개 드래그 핸들 */}
        {handles.map(({ pos, hitStyle, visualStyle, cursor }) => (
          <div
            key={pos}
            style={{
              position: 'absolute',
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor,
              ...hitStyle,
            }}
            onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e, pos); }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
                pointerEvents: 'none',
                ...visualStyle,
              }}
            />
          </div>
        ))}
      </div>

      {/* 확인/취소/초기화 버튼 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2 z-10" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={handleConfirm}
          className="px-3 py-1.5 bg-[var(--brand-primary)] text-white text-xs rounded hover:bg-[var(--brand-primary-dark)] transition-colors"
        >
          확인
        </button>
        <button
          onClick={() => setCrop({ x: 0, y: 0, width: 100, height: 100 })}
          className="px-3 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-primary)] text-xs rounded border border-[var(--border-default)] hover:bg-[var(--hover-overlay)] transition-colors"
        >
          초기화
        </button>
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-primary)] text-xs rounded border border-[var(--border-default)] hover:bg-[var(--hover-overlay)] transition-colors"
        >
          취소
        </button>
      </div>
    </div>
  );
}
