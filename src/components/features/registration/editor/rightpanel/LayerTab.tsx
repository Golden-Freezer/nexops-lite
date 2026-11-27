'use client';

// editor/rightpanel/LayerTab.tsx — D4 분할: 원본 RightPanel.tsx 117~290행 순수 이동 (2026-07-04)

import { useState } from 'react';
import {
  Settings, Lock, Unlock, Eye, EyeOff,
  ImageIcon, Type as TypeIcon, Hexagon,
} from 'lucide-react';
import {
  useEditorStore,
  selectSelectedSectionId,
  selectDocument,
  selectSelectedElementId,
} from '@/lib/registration/editor/stores/editorStore';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import { EmptyState } from './primitives';

function LayerTab() {
  const doc = useEditorStore(selectDocument);
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const selectedElementId = useEditorStore(selectSelectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const reorderElements = useEditorStore((s) => s.reorderElements);

  // DnD 상태
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropAbove, setDropAbove] = useState<boolean>(true);

  const section = doc?.sections.find((s) => s.id === selectedSectionId);

  if (!selectedSectionId || !section) {
    return <EmptyState icon="📑" message="섹션을 선택하면 레이어가 표시됩니다." />;
  }

  // z-index 높은 것이 위 (목록 상단 = 가장 앞 요소)
  const sorted = [...section.elements].sort((a, b) => b.zIndex - a.zIndex);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'text': return <TypeIcon size={12} className="text-blue-500" />;
      case 'image': case 'framed-image': return <ImageIcon size={12} className="text-green-500" />;
      case 'shape': return <Hexagon size={12} className="text-purple-500" />;
      default: return <Settings size={12} className="text-[var(--text-disabled)]" />;
    }
  };

  const getDisplayName = (el: import('@/lib/registration/editor/types/canvas').CanvasElement) => {
    if (el.name) return el.name;
    if (el.type === 'text' && el.textProps?.content) {
      return el.textProps.content.replace(/<[^>]*>/g, '').slice(0, 12) + (el.textProps.content.length > 12 ? '…' : '');
    }
    return el.type;
  };

  // ── DnD 핸들러 ──
  function handleDragStart(id: string) {
    setDragId(id);
    setDragOverId(null);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOverId(targetId);
    setDropAbove(e.clientY < rect.top + rect.height / 2);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    // sorted는 z-index 내림차순 (상단=앞, 하단=뒤)
    const ids = sorted.map((el) => el.id);
    const dragIdx = ids.indexOf(dragId);
    const targetIdx = ids.indexOf(targetId);
    if (dragIdx === -1 || targetIdx === -1) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const newIds = [...ids];
    newIds.splice(dragIdx, 1);
    const adjustedTargetIdx = newIds.indexOf(targetId);
    const insertAt = dropAbove ? adjustedTargetIdx : adjustedTargetIdx + 1;
    newIds.splice(insertAt, 0, dragId);

    // 히스토리는 reorderElements 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
    // newIds는 내림차순(앞→뒤)이므로 reverse → 오름차순(뒤→앞) = orderedIds[0]=가장 뒤
    const orderedIds = [...newIds].reverse();
    if (selectedSectionId) reorderElements(selectedSectionId, orderedIds);

    setDragId(null);
    setDragOverId(null);
  }

  return (
    <div className="p-2">
      <div className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wide px-2 py-1 border-b border-[var(--border-subtle)] mb-1">
        {section.sectionType}
      </div>
      {sorted.map((el) => {
        const isActive = el.id === selectedElementId;
        const isBeingDragged = dragId === el.id;
        const isDropTarget = dragOverId === el.id && dragId !== el.id;

        return (
          <div
            key={el.id}
            className="relative"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              handleDragStart(el.id);
            }}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, el.id)}
            onDrop={(e) => handleDrop(e, el.id)}
          >
            {/* 드롭 위 구분선 */}
            {isDropTarget && dropAbove && (
              <span className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />
            )}
            <div
              onClick={() => selectElement(el.id)}
              className={[
                'flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors group',
                isActive ? 'bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]' : 'hover:bg-[var(--hover-overlay)] text-[var(--text-secondary)]',
                !el.isVisible ? 'opacity-40' : '',
              ].join(' ')}
              style={{ opacity: isBeingDragged ? 0.4 : undefined }}
            >
              {/* 드래그 핸들 */}
              <span className="text-[var(--text-disabled)] select-none cursor-grab active:cursor-grabbing shrink-0 text-[10px] leading-none">
                ⠿
              </span>
              {getTypeIcon(el.type)}
              <span className="flex-1 truncate text-[11px]">{getDisplayName(el)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); updateElement(selectedSectionId, el.id, { isVisible: !el.isVisible }); }}
                className="text-[var(--text-disabled)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={el.isVisible ? '숨기기' : '표시'}
              >
                {el.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); updateElement(selectedSectionId, el.id, { isLocked: !el.isLocked }); }}
                className="text-[var(--text-disabled)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={el.isLocked ? '잠금 해제' : '잠금'}
              >
                {el.isLocked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
            </div>
            {/* 드롭 아래 구분선 */}
            {isDropTarget && !dropAbove && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// 요소 삽입 탭
// ─────────────────────────────────────────────


export { LayerTab };
