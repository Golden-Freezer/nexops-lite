'use client';

// editor/rightpanel/ElementsTab.tsx — D4 분할: 원본 RightPanel.tsx 291~468행 순수 이동 (2026-07-04)

import { useRef, useCallback, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth/clerk-shim';
import { uploadImageViaSignedUrl } from '@/lib/registration/editor/services/editorApi';
import { useEditorStore, selectSelectedSectionId } from '@/lib/registration/editor/stores/editorStore';
import ElementPanel, { type ElementKind } from '../ElementPanel';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import { EmptyState } from './primitives';
import { MyImagesTab } from './MyImagesTab';

// '내 이미지' 보관함 서브탭(MyImagesTab) — 스토리지 목록(묶음 5 ②)

type ElementsPane = 'elements' | 'my-images';
const PANES: { id: ElementsPane; label: string }[] = [
  { id: 'elements', label: '요소' },
  { id: 'my-images', label: '내 이미지' },
];

function ElementsTab() {
  const [pane, setPane] = useState<ElementsPane>('elements');
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const addElement        = useEditorStore((s) => s.addElement);
  const selectElement     = useEditorStore((s) => s.selectElement);
  const setViewMode       = useEditorStore((s) => s.setViewMode);
  const pdpId             = useEditorStore((s) => s.document?.pdpId ?? '');
  const sectionType       = useEditorStore((s) => s.document?.sections.find((sec) => sec.id === selectedSectionId)?.sectionType);
  const { getToken }      = useAuth();
  const svgInputRef       = useRef<HTMLInputElement>(null);
  const imageInputRef     = useRef<HTMLInputElement>(null);

  const defaultTransform = (w: number, h: number) => ({
    x: 100, y: 100, width: w, height: h, rotation: 0,
  });

  const insertElement = (e: ElementKind) => {
    if (!selectedSectionId) return;

    if (e.kind === 'text') {
      setViewMode('text');
      return;
    }

    if (e.kind === 'svg') {
      svgInputRef.current?.click();
      return;
    }

    const id = crypto.randomUUID();
    let el: CanvasElement | null = null;

    if (e.kind === 'shape') {
      const st = e.shapeType;
      const names: Record<string, string> = {
        rect: '사각형', roundedRect: '둥근 사각형', circle: '원', ellipse: '타원',
        line: '선', triangle: '삼각형', star: '별', diamond: '마름모',
        arrow: '화살표', speechBubble: '말풍선',
      };
      const isLine = st === 'line';
      const isEllipse = st === 'ellipse';
      el = {
        id, type: 'shape', name: names[st] ?? '도형',
        transform: defaultTransform(isLine ? 300 : isEllipse ? 260 : 200, isLine ? 4 : isEllipse ? 160 : 200),
        zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
        shapeProps: {
          shapeType: st,
          fill: isLine ? '#374151' : '#e5e7eb',
          stroke: isLine ? undefined : '#9ca3af',
          strokeWidth: isLine ? 0 : 2,
          borderRadius: st === 'roundedRect' ? 16 : 0,
        },
      };
    } else if (e.kind === 'line') {
      el = {
        id, type: 'shape',
        name: e.variant === 'dashed' ? '점선' : e.variant === 'arrow' ? '화살표 선' : '선',
        transform: defaultTransform(300, 4),
        zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
        shapeProps: {
          shapeType: e.variant === 'arrow' ? 'arrow' : 'line',
          fill: '#374151',
          stroke: e.variant === 'dashed' ? '#374151' : undefined,
          strokeWidth: e.variant === 'dashed' ? 3 : 0,
        },
      };
    } else if (e.kind === 'badge') {
      const colorMap = { NEW: '#2563eb', SALE: '#dc2626', HOT: '#f59e0b' };
      el = {
        id, type: 'badge', name: `뱃지 ${e.preset}`,
        transform: defaultTransform(140, 52),
        zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
        textProps: {
          content: e.preset, fontFamily: 'Pretendard', fontSize: 28, fontWeight: 800,
          fontStyle: 'normal', textDecoration: 'none', color: '#ffffff', textAlign: 'center',
          lineHeight: 1, letterSpacing: 0.5,
        },
        shapeProps: { shapeType: 'roundedRect', fill: colorMap[e.preset] },
      };
    } else if (e.kind === 'framed-image') {
      const clip = e.frameShape === 'circle' ? 'circle(50% at 50% 50%)' :
                   e.frameShape === 'roundedRect' ? 'inset(0 round 16px)' : 'none';
      el = {
        id, type: 'framed-image', name: '프레임 이미지',
        transform: defaultTransform(260, 260),
        zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
        framedImageProps: {
          src: '', alt: 'framed image', frameId: e.frameShape,
          clipPath: clip, viewBox: '0 0 100 100', bgColor: '#f3f4f6',
          objectFit: 'cover', imageType: 'placeholder', isUserUploaded: false,
        },
      };
    }

    if (el) {
      addElement(selectedSectionId, el);
      selectElement(id);
    }
  };

  const handleSvgUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !selectedSectionId) return;
    const svgString = await file.text();
    const id = crypto.randomUUID();
    const el: CanvasElement = {
      id, type: 'svg', name: file.name.replace(/\.svg$/i, '') || 'SVG',
      transform: defaultTransform(200, 200),
      zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
      svgProps: { svgString },
    };
    addElement(selectedSectionId, el);
    selectElement(id);
  };

  const handleImageUpload = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file || !selectedSectionId) return;
    ev.target.value = '';
    try {
      const token = await getToken();
      if (!token) return;
      const url = await uploadImageViaSignedUrl(token, file, { sourcePdpId: pdpId, sourceSection: sectionType });
      const id = crypto.randomUUID();
      const img = new window.Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = 600;
        if (w > maxW) { const ratio = maxW / w; w = maxW; h = Math.round(h * ratio); }
        const newEl: CanvasElement = {
          id, type: 'image', name: file.name,
          transform: { x: 100, y: 100, width: w, height: h, rotation: 0 },
          zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
          imageProps: { src: url, alt: file.name, objectFit: 'cover', imageType: 'user_upload', isUserUploaded: true },
        };
        // 히스토리는 addElement 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
        addElement(selectedSectionId, newEl);
        selectElement(id);
      };
      img.src = url;
    } catch (err) {
      console.error('이미지 업로드 실패:', err);
    }
  }, [selectedSectionId, getToken, addElement, selectElement, pdpId, sectionType]);

  if (!selectedSectionId) {
    return <EmptyState icon="🧩" message="섹션을 선택하면 요소를 추가할 수 있습니다." />;
  }

  return (
    <div className="p-2">
      {/* 요소 / 내 이미지 */}
      <div className="flex gap-1 mb-2 p-0.5 rounded-lg bg-[var(--surface-canvas)]" role="tablist" aria-label="요소 탭">
        {PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pane === p.id}
            onClick={() => setPane(p.id)}
            className={`flex-1 py-1 rounded-md text-xs transition-colors cursor-pointer ${
              pane === p.id
                ? 'bg-[var(--surface-base)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--editor-brand)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pane === 'my-images' && <MyImagesTab />}

      {pane === 'elements' && (
        <>
          {/* 이미지 업로드 버튼 */}
          <button
            onClick={() => imageInputRef.current?.click()}
            className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-dashed border-[var(--border-default)] hover:border-[var(--editor-brand)] hover:bg-[var(--brand-primary-tint)] text-xs text-[var(--text-secondary)] hover:text-[var(--editor-brand)] transition-colors cursor-pointer"
          >
            <ImageIcon size={14} />
            이미지 업로드
          </button>

          {/* ElementPanel을 인라인으로 렌더링 (popover 스타일 제거) */}
          <div className="[&>div]:static [&>div]:shadow-none [&>div]:border-0 [&>div]:p-0 [&>div]:w-full [&>div]:max-h-none">
            <ElementPanel onInsert={insertElement} />
          </div>
        </>
      )}

      <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" onChange={handleSvgUpload} className="hidden" />
      <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
    </div>
  );
}

// ─────────────────────────────────────────────
// 속성 탭 — 선택된 요소의 실제 값 표시/편집
// ─────────────────────────────────────────────


export { ElementsTab };
