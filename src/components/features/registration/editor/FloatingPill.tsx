'use client';

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import {
  MousePointer2,
  Type,
  ImageIcon,
  Shapes,
  Undo2,
  Redo2,
  Monitor,
  Smartphone,
  Group,
  Ungroup,
  Square,
  RectangleHorizontal,
  Circle,
  Triangle,
  Star,
  Diamond,
  ArrowRight,
  MessageCircle,
  Hexagon,
  Minus,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/clerk-shim';
import { uploadImageViaSignedUrl } from '@/lib/registration/editor/services/editorApi';
import { type ElementKind } from './ElementPanel';
import {
  useEditorStore,
  selectViewMode,
  selectSelectedSectionId,
  selectSelectedElementIds,
  selectDocument,
} from '@/lib/registration/editor/stores/editorStore';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import { useCanvasStore, selectCanUndo, selectCanRedo } from '@/lib/registration/editor/stores/canvasStore';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

const VIEW_MODE_BUTTONS = [
  { mode: 'select' as const, icon: MousePointer2, label: '선택' },
  { mode: 'text'   as const, icon: Type,          label: '텍스트' },
  { mode: 'image'  as const, icon: ImageIcon,     label: '이미지' },
  { mode: 'shape'  as const, icon: Shapes,        label: '도형' },
] as const;

export default function FloatingPill() {
  const viewMode          = useEditorStore(selectViewMode);
  const setViewMode       = useEditorStore((s) => s.setViewMode);
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const addElement        = useEditorStore((s) => s.addElement);
  const selectElement     = useEditorStore((s) => s.selectElement);

  const selectedElementIds = useEditorStore(selectSelectedElementIds);
  const doc                = useEditorStore(selectDocument);
  const groupElements      = useEditorStore((s) => s.groupElements);
  const ungroupElements    = useEditorStore((s) => s.ungroupElements);

  const canUndo      = useCanvasStore(selectCanUndo);
  const canRedo      = useCanvasStore(selectCanRedo);
  const undoDocument = useEditorStore((s) => s.undoDocument);
  const redoDocument = useEditorStore((s) => s.redoDocument);
  const { getToken } = useAuth();

  const svgInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [openDropdown, setOpenDropdown] = useState<'text' | 'shape' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── 드래그 상태 ──
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = dropdownRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect?.left ?? 0,
      origY: rect?.top ?? 0,
    };
  }, []);

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // 뷰포트 클램프 — 화면 밖으로 드래그되어 툴바(undo/redo 포함)를 분실하는 것 방지
    const rect = dropdownRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 48;
    const h = rect?.height ?? 200;
    const x = Math.min(Math.max(dragRef.current.origX + dx, 0), window.innerWidth - w);
    const y = Math.min(Math.max(dragRef.current.origY + dy, 0), window.innerHeight - h);
    setPillPos({ x, y });
  }, [isDragging]);

  const handleDragPointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!openDropdown) return;
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openDropdown]);

  // 선택된 요소 중 groupId가 있는 것이 1개 이상이면 그룹해제 활성화
  const hasGroupedSelection = useMemo(() => {
    if (!doc || selectedElementIds.length === 0) return false;
    for (const section of doc.sections) {
      for (const el of section.elements) {
        if (selectedElementIds.includes(el.id) && el.groupId) return true;
      }
    }
    return false;
  }, [doc, selectedElementIds]);

  const defaultTransform = (w: number, h: number) => ({
    x: 100, y: 100, width: w, height: h, rotation: 0,
  });

  // 통합 요소 삽입 헬퍼 (TopToolbar에서 이동)
  const insertElement = (e: ElementKind) => {
    if (!selectedSectionId) return;

    if (e.kind === 'text') {
      const id = crypto.randomUUID();
      const section = doc?.sections.find((s) => s.id === selectedSectionId);
      const maxZ = section?.elements.reduce((m, el) => Math.max(m, el.zIndex), 0) ?? 0;
      const isHeading = e.preset === 'heading';
      const el: CanvasElement = {
        id, type: 'text', name: isHeading ? '제목 텍스트' : '본문 텍스트',
        transform: { x: 100, y: 100, width: isHeading ? 660 : 600, height: isHeading ? 80 : 60, rotation: 0 },
        zIndex: maxZ + 1, isLocked: false, isVisible: true, opacity: 1,
        textProps: {
          content: isHeading ? '제목을 입력하세요' : '텍스트를 입력하세요',
          fontFamily: 'Pretendard', fontSize: isHeading ? 60 : 32,
          fontWeight: isHeading ? 700 : 400, fontStyle: 'normal', textDecoration: 'none',
          color: '#333333', textAlign: 'center', lineHeight: 1.5, letterSpacing: -0.3,
        },
      };
      addElement(selectedSectionId, el);
      selectElement(id);
      setViewMode('select');
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

  const handleSvgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
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

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSectionId) return;
    e.target.value = '';
    try {
      const token = await getToken();
      if (!token) return;
      const url = await uploadImageViaSignedUrl(token, file);
      const id = crypto.randomUUID();
      const img = new window.Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxW = 600;
        if (w > maxW) { const ratio = maxW / w; w = maxW; h = Math.round(h * ratio); }
        const el: CanvasElement = {
          id, type: 'image', name: file.name,
          transform: { x: 100, y: 100, width: w, height: h, rotation: 0 },
          zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
          imageProps: { src: url, alt: file.name, objectFit: 'cover', imageType: 'user_upload', isUserUploaded: true },
        };
        // 히스토리는 addElement 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
        addElement(selectedSectionId, el);
        selectElement(id);
      };
      img.src = url;
    } catch (err) {
      console.error('이미지 업로드 실패:', err);
    }
  }, [selectedSectionId, getToken, addElement, selectElement]);

  // 이미지/도형 모드 클릭 핸들링
  const handleViewModeClick = (mode: typeof VIEW_MODE_BUTTONS[number]['mode']) => {
    if (mode === 'image') {
      setOpenDropdown(null);
      imageInputRef.current?.click();
      return;
    }
    if (mode === 'text') {
      setOpenDropdown((prev) => prev === 'text' ? null : 'text');
      return;
    }
    if (mode === 'shape') {
      setOpenDropdown((prev) => prev === 'shape' ? null : 'shape');
      return;
    }
    setOpenDropdown(null);
    setViewMode(mode);
  };

  // 드롭다운에서 요소 삽입 후 닫기
  const handleDropdownInsert = (e: ElementKind) => {
    insertElement(e);
    setOpenDropdown(null);
  };

  return (
    <div
      ref={dropdownRef}
      className={pillPos ? '' : 'absolute left-3 top-1/2 -translate-y-1/2'}
      style={{
        zIndex: Z_INDEX.toolbar,
        ...(pillPos ? { position: 'fixed' as const, left: pillPos.x, top: pillPos.y } : {}),
      }}
      role="toolbar"
      aria-label="편집 도구"
    >
      <div className="flex flex-col items-center gap-1 bg-[var(--surface-elevated)]/95 backdrop-blur-sm rounded-xl shadow-lg border border-[var(--border-default)]/60 px-1 py-2">
        {/* 드래그 핸들 */}
        <div
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          className="flex items-center justify-center w-full py-0.5 cursor-grab active:cursor-grabbing text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
          title="드래그하여 이동"
        >
          <GripVertical size={14} />
        </div>

        <PillDivider />

        {/* 뷰 모드 그룹 */}
        <div className="flex flex-col items-center gap-0.5 relative" role="group" aria-label="편집 모드">
          {VIEW_MODE_BUTTONS.map(({ mode, icon: Icon, label }) => {
            const hasDropdown = mode === 'text' || mode === 'shape';
            const isDropdownOpen = openDropdown === mode;
            return (
              <div key={mode} className="relative">
                <PillButton
                  onClick={() => handleViewModeClick(mode)}
                  active={viewMode === mode || isDropdownOpen}
                  aria-label={label}
                  disabled={mode !== 'select' && mode !== 'text' && !selectedSectionId}
                >
                  <Icon size={15} />
                  {hasDropdown && <ChevronRight size={10} className={`transition-transform ${isDropdownOpen ? 'rotate-90' : ''}`} />}
                </PillButton>

                {/* 텍스트 드롭다운 */}
                {mode === 'text' && isDropdownOpen && (
                  <TextDropdown onInsert={handleDropdownInsert} onClickMode={() => { setViewMode('text'); setOpenDropdown(null); }} />
                )}

                {/* 도형 드롭다운 */}
                {mode === 'shape' && isDropdownOpen && (
                  <ShapeDropdown onInsert={handleDropdownInsert} disabled={!selectedSectionId} />
                )}
              </div>
            );
          })}
        </div>

        <PillDivider />

        {/* Undo / Redo */}
        <div className="flex flex-col items-center gap-0.5" role="group" aria-label="히스토리">
          <PillButton
            onClick={undoDocument}
            disabled={!canUndo}
            aria-label="실행 취소"
          >
            <Undo2 size={15} />
          </PillButton>
          <PillButton
            onClick={redoDocument}
            disabled={!canRedo}
            aria-label="다시 실행"
          >
            <Redo2 size={15} />
          </PillButton>
        </div>

        <PillDivider />

        {/* 그룹 / 그룹해제 */}
        <div className="flex flex-col items-center gap-0.5" role="group" aria-label="그룹">
          {/* 히스토리는 group/ungroupElements 내부에서 post 스냅샷으로 기록 (H3 통일 모델) */}
          <PillButton
            onClick={groupElements}
            disabled={selectedElementIds.length < 2}
            aria-label="그룹 (Ctrl+G)"
          >
            <Group size={15} />
          </PillButton>
          <PillButton
            onClick={ungroupElements}
            disabled={!hasGroupedSelection}
            aria-label="그룹 해제 (Ctrl+Shift+G)"
          >
            <Ungroup size={15} />
          </PillButton>
        </div>

        <PillDivider />

        {/* 뷰포트 전환 */}
        <div className="flex flex-col items-center gap-0.5" role="group" aria-label="뷰포트">
          <PillButton
            active={viewMode !== 'mobile'}
            onClick={() => { if (viewMode === 'mobile') setViewMode('select'); }}
            aria-label="PC 뷰"
          >
            <Monitor size={15} />
          </PillButton>
          <PillButton
            active={viewMode === 'mobile'}
            onClick={() => { if (viewMode !== 'mobile') setViewMode('mobile'); }}
            aria-label="모바일 미리보기"
          >
            <Smartphone size={15} />
          </PillButton>
        </div>
      </div>

      {/* 숨김 파일 입력 */}
      <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" onChange={handleSvgUpload} className="hidden" />
      <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
    </div>
  );
}

// ── Internal ──

function PillButton({ children, onClick, disabled, active, 'aria-label': ariaLabel }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        'flex items-center justify-center gap-1 p-1.5 rounded-lg text-xs transition-colors',
        active ? 'bg-[var(--editor-brand-tint)] text-[var(--editor-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function PillDivider() {
  return <div className="h-px w-8 bg-[var(--border-default)] my-0.5" />;
}

// ── 텍스트 드롭다운 ──

function TextDropdown({ onInsert, onClickMode }: { onInsert: (e: ElementKind) => void; onClickMode: () => void }) {
  return (
    <div className="absolute left-full top-0 ml-2 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-xl py-1.5 w-44 z-50">
      <DropdownItem
        icon={<Type size={16} />}
        label="클릭하여 배치"
        desc="캔버스 클릭 위치에 추가"
        onClick={onClickMode}
      />
      <div className="h-px bg-[var(--border-subtle)] mx-2 my-1" />
      <DropdownItem
        icon={<span className="text-[15px] font-bold">H</span>}
        label="제목 텍스트"
        desc="큰 제목용 (60px)"
        onClick={() => onInsert({ kind: 'text', preset: 'heading' })}
      />
      <DropdownItem
        icon={<span className="text-[13px]">P</span>}
        label="본문 텍스트"
        desc="본문용 (32px)"
        onClick={() => onInsert({ kind: 'text', preset: 'body' })}
      />
    </div>
  );
}

// ── 도형 드롭다운 ──

const SHAPE_ITEMS: { label: string; icon: React.ReactNode; element: ElementKind }[] = [
  { label: '사각형',       icon: <Square size={16} />,              element: { kind: 'shape', shapeType: 'rect' } },
  { label: '둥근 사각형',  icon: <RectangleHorizontal size={16} />, element: { kind: 'shape', shapeType: 'roundedRect' } },
  { label: '원',           icon: <Circle size={16} />,              element: { kind: 'shape', shapeType: 'circle' } },
  { label: '삼각형',       icon: <Triangle size={16} />,            element: { kind: 'shape', shapeType: 'triangle' } },
  { label: '별',           icon: <Star size={16} />,                element: { kind: 'shape', shapeType: 'star' } },
  { label: '마름모',       icon: <Diamond size={16} />,             element: { kind: 'shape', shapeType: 'diamond' } },
  { label: '화살표',       icon: <ArrowRight size={16} />,          element: { kind: 'shape', shapeType: 'arrow' } },
  { label: '말풍선',       icon: <MessageCircle size={16} />,       element: { kind: 'shape', shapeType: 'speechBubble' } },
];

const LINE_ITEMS: { label: string; icon: React.ReactNode; element: ElementKind }[] = [
  { label: '실선',       icon: <Minus size={16} />,      element: { kind: 'line', variant: 'solid' } },
  { label: '점선',       icon: <svg width="20" height="4" viewBox="0 0 20 4"><line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" /></svg>, element: { kind: 'line', variant: 'dashed' } },
  { label: '화살표 선',  icon: <ArrowRight size={16} />, element: { kind: 'line', variant: 'arrow' } },
];

function ShapeDropdown({ onInsert, disabled }: { onInsert: (e: ElementKind) => void; disabled: boolean }) {
  if (disabled) {
    return (
      <div className="absolute left-full top-0 ml-2 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-xl py-3 px-4 w-52 z-50">
        <p className="text-xs text-[var(--text-disabled)] text-center">섹션을 먼저 선택해 주세요</p>
      </div>
    );
  }
  return (
    <div className="absolute left-full top-0 ml-2 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-xl py-1.5 w-52 z-50 max-h-[400px] overflow-y-auto">
      <DropdownGroupLabel label="도형" />
      <div className="grid grid-cols-4 gap-1 px-2 pb-1">
        {SHAPE_ITEMS.map((item) => (
          <button
            key={item.label}
            onClick={() => onInsert(item.element)}
            title={item.label}
            className="flex flex-col items-center justify-center gap-0.5 h-12 rounded-md hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {item.icon}
            <span className="text-[8px] leading-none">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="h-px bg-[var(--border-subtle)] mx-2 my-1" />
      <DropdownGroupLabel label="선" />
      <div className="grid grid-cols-3 gap-1 px-2 pb-1">
        {LINE_ITEMS.map((item) => (
          <button
            key={item.label}
            onClick={() => onInsert(item.element)}
            title={item.label}
            className="flex flex-col items-center justify-center gap-0.5 h-12 rounded-md hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {item.icon}
            <span className="text-[8px] leading-none">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="h-px bg-[var(--border-subtle)] mx-2 my-1" />
      <DropdownGroupLabel label="뱃지" />
      <div className="grid grid-cols-3 gap-1 px-2 pb-1">
        {(['NEW', 'SALE', 'HOT'] as const).map((preset) => {
          const bg = { NEW: '#2563eb', SALE: '#dc2626', HOT: '#f59e0b' }[preset];
          return (
            <button
              key={preset}
              onClick={() => onInsert({ kind: 'badge', preset })}
              title={`뱃지 ${preset}`}
              className="flex flex-col items-center justify-center gap-0.5 h-12 rounded-md hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)] transition-colors cursor-pointer"
            >
              <span className="text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: bg }}>{preset}</span>
              <span className="text-[8px] leading-none text-[var(--text-secondary)]">{preset}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DropdownItem({ icon, label, desc, onClick }: { icon: React.ReactNode; label: string; desc?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--hover-overlay)] transition-colors cursor-pointer"
    >
      <span className="flex items-center justify-center w-6 h-6 text-[var(--text-secondary)]">{icon}</span>
      <div>
        <div className="text-xs font-medium text-[var(--text-primary)]">{label}</div>
        {desc && <div className="text-[10px] text-[var(--text-disabled)]">{desc}</div>}
      </div>
    </button>
  );
}

function DropdownGroupLabel({ label }: { label: string }) {
  return <div className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wide px-3 py-1">{label}</div>;
}
