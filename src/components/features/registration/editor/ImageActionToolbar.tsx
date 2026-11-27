'use client';

import { useState, useRef, useCallback } from 'react';

interface ImageActionToolbarProps {
  isVisible: boolean;
  imageSrc: string;
  imageAlt: string;
  onReplace: (file: File) => void;
  /** AI 재생성(Phase 4) — 배선된 경우에만 버튼 노출 */
  onRegenerate?: () => void;
  onCrop?: () => void;
}

export default function ImageActionToolbar({
  isVisible,
  imageSrc,
  imageAlt,
  onReplace,
  onRegenerate,
  onCrop,
}: ImageActionToolbarProps) {
  const [hovered, setHovered] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shouldShow = isVisible || hovered;

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setHovered(true);
  };

  const handleMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => setHovered(false), 150);
  };

  const handleReplace = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onReplace(file);
    e.target.value = '';
  }, [onReplace]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(imageSrc);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${imageAlt || 'image'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      // CORS 실패 시 새 탭으로 폴백
      window.open(imageSrc, '_blank');
    }
  }, [imageSrc, imageAlt]);

  const handleRegenerate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRegenerate?.();
  }, [onRegenerate]);

  const btnStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    borderRadius: 4,
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 8,
          padding: '2px 4px',
          opacity: shouldShow ? 1 : 0,
          transition: 'opacity 150ms ease',
          pointerEvents: shouldShow ? 'auto' : 'none',
          zIndex: 10,
        }}
      >
        <button
          onClick={handleReplace}
          title="이미지 교체"
          style={btnStyle}
        >
          <span style={{ filter: 'brightness(10)' }}>📁</span>
        </button>
        <button
          onClick={handleDownload}
          title="이미지 다운로드"
          style={btnStyle}
        >
          <span style={{ filter: 'brightness(10)' }}>⬇️</span>
        </button>
        {onRegenerate && (
          <button
            onClick={handleRegenerate}
            title="AI 재생성"
            style={btnStyle}
          >
            <span style={{ filter: 'brightness(10)' }}>🔄</span>
          </button>
        )}
        {onCrop && (
          <button
            onClick={(e) => { e.stopPropagation(); onCrop(); }}
            title="자르기"
            style={btnStyle}
          >
            <span style={{ filter: 'brightness(10)' }}>✂️</span>
          </button>
        )}
      </div>
    </>
  );
}
