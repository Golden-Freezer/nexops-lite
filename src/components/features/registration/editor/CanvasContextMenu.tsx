'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';

export interface ContextMenuState {
  x: number;
  y: number;
  elementId: string | null;
  sectionId: string | null;
  elementType?: string | null;
  imageSrc?: string | null;
  imageAlt?: string | null;
}

interface CanvasContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onImageReplace?: () => void;
  onImageDownload?: () => void;
  onImageRegenerate?: () => void;
  onTextRegenerate?: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
}

interface MenuDivider {
  type: 'divider';
}

type MenuEntry = MenuItem | MenuDivider;

function isDivider(entry: MenuEntry): entry is MenuDivider {
  return 'type' in entry && entry.type === 'divider';
}

export default function CanvasContextMenu({ menu, onClose, onImageReplace, onImageDownload, onImageRegenerate, onTextRegenerate }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clipboardElements = useEditorStore((s) => s.clipboardElements);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

  const copyElements = useEditorStore((s) => s.copyElements);
  const pasteElements = useEditorStore((s) => s.pasteElements);
  const duplicateElements = useEditorStore((s) => s.duplicateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const changeZIndex = useEditorStore((s) => s.changeZIndex);
  const selectAllInSection = useEditorStore((s) => s.selectAllInSection);
  const groupElements = useEditorStore((s) => s.groupElements);
  const ungroupElements = useEditorStore((s) => s.ungroupElements);

  const hasSelection = selectedElementIds.length > 0;
  const hasClipboard = clipboardElements.length > 0;
  const hasSingleSelection = selectedElementIds.length === 1;
  const hasMultiSelection = selectedElementIds.length >= 2;

  // 선택된 요소 중 groupId가 있는지 검사
  const hasGrouped = useMemo(() => {
    const doc = useEditorStore.getState().document;
    if (!doc) return false;
    const selectedSet = new Set(selectedElementIds);
    for (const section of doc.sections) {
      for (const el of section.elements) {
        if (selectedSet.has(el.id) && el.groupId) return true;
      }
    }
    return false;
  }, [selectedElementIds]);

  // 액션 실행 후 메뉴 닫기 헬퍼
  // (히스토리는 각 editorStore 액션 내부에서 post 스냅샷으로 기록 — H3 통일 모델)
  const withClose = (action: () => void) => {
    return () => {
      action();
      onClose();
    };
  };

  const isImageElement = menu.elementType === 'image' || menu.elementType === 'framed-image';
  const isTextElement = menu.elementType === 'text';

  const imageEntries: MenuEntry[] = isImageElement
    ? [
        { label: '이미지 교체', action: () => { onImageReplace?.(); onClose(); } },
        { label: '이미지 다운로드', action: () => { onImageDownload?.(); onClose(); } },
        // AI 재생성 항목은 핸들러가 배선된 경우에만 노출 (재생성 백엔드는 Phase 4)
        ...(onImageRegenerate ? [{ label: 'AI 재생성', action: () => { onImageRegenerate(); onClose(); } } as MenuEntry] : []),
        { type: 'divider' },
      ]
    : [];

  const textEntries: MenuEntry[] = isTextElement && onTextRegenerate
    ? [
        { label: '카피 재생성', action: () => { onTextRegenerate(); onClose(); } },
        { type: 'divider' },
      ]
    : [];

  const entries: MenuEntry[] = [
    ...imageEntries,
    ...textEntries,
    {
      label: '복사',
      shortcut: 'Ctrl+C',
      disabled: !hasSelection,
      action: () => { copyElements(); onClose(); },
    },
    {
      label: '붙여넣기',
      shortcut: 'Ctrl+V',
      disabled: !hasClipboard,
      action: withClose(pasteElements),
    },
    {
      label: '복제',
      shortcut: 'Ctrl+D',
      disabled: !hasSelection,
      action: withClose(duplicateElements),
    },
    {
      label: '삭제',
      shortcut: 'Delete',
      disabled: !hasSelection,
      action: withClose(deleteElements),
    },
    { type: 'divider' },
    {
      label: '앞으로',
      shortcut: ']',
      disabled: !hasSingleSelection,
      action: () => {
        if (!hasSingleSelection) return;
        const doc = useEditorStore.getState().document;
        if (!doc) return;
        for (const section of doc.sections) {
          if (section.elements.find((el) => el.id === selectedElementIds[0])) {
            changeZIndex(section.id, selectedElementIds[0], 1);
            break;
          }
        }
        onClose();
      },
    },
    {
      label: '뒤로',
      shortcut: '[',
      disabled: !hasSingleSelection,
      action: () => {
        if (!hasSingleSelection) return;
        const doc = useEditorStore.getState().document;
        if (!doc) return;
        for (const section of doc.sections) {
          if (section.elements.find((el) => el.id === selectedElementIds[0])) {
            changeZIndex(section.id, selectedElementIds[0], -1);
            break;
          }
        }
        onClose();
      },
    },
    { type: 'divider' },
    {
      label: '전체 선택',
      shortcut: 'Ctrl+A',
      disabled: !selectedSectionId,
      action: () => {
        if (selectedSectionId) selectAllInSection(selectedSectionId);
        onClose();
      },
    },
    { type: 'divider' },
    {
      label: '그룹',
      shortcut: 'Ctrl+G',
      disabled: !hasMultiSelection,
      action: withClose(groupElements),
    },
    {
      label: '그룹 해제',
      shortcut: 'Ctrl+Shift+G',
      disabled: !hasGrouped,
      action: withClose(ungroupElements),
    },
  ];

  // 클릭/Escape/스크롤 시 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // 화면 밖 overflow 방지
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${menu.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${menu.y - rect.height}px`;
    }
  }, [menu.x, menu.y]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
        zIndex: Z_INDEX.contextMenu,
        minWidth: 180,
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '4px 0',
        userSelect: 'none',
      }}
    >
      {entries.map((entry, i) => {
        if (isDivider(entry)) {
          return (
            <div
              key={`div-${i}`}
              style={{
                height: 1,
                backgroundColor: '#e5e7eb',
                margin: '4px 0',
              }}
            />
          );
        }
        return (
          <button
            key={entry.label}
            disabled={entry.disabled}
            onClick={entry.action}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'none',
              cursor: entry.disabled ? 'default' : 'pointer',
              color: entry.disabled ? '#9ca3af' : '#1f2937',
              fontSize: 13,
              textAlign: 'left',
              lineHeight: '20px',
            }}
            onMouseEnter={(e) => {
              if (!entry.disabled) {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            <span>{entry.label}</span>
            {entry.shortcut && (
              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 24 }}>
                {entry.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
