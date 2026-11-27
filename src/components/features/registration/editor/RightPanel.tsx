'use client';

// RightPanel.tsx — D4 분할(2026-07-04): 탭/서브섹션/프리미티브는 ./rightpanel/ 로 이동, 이 파일은 레일 셸 + default export 유지(소비처 ProEditorPage.tsx:8 상대경로 불변)

import { useEffect } from 'react';
import { Settings, LayoutGrid, Palette, Layers, Keyboard, Plus } from 'lucide-react';
import {
  useEditorStore,
  selectSelectedSectionId,
  selectSelectedElementId,
  selectRailTab,
} from '@/lib/registration/editor/stores/editorStore';
import LayoutLibrary from './LayoutLibrary';
import { LayerTab } from './rightpanel/LayerTab';
import { ElementsTab } from './rightpanel/ElementsTab';
import { PropertiesTab } from './rightpanel/PropertiesTab';
import { StyleTab } from './rightpanel/StyleTab';

type RightTab = 'properties' | 'layers' | 'elements' | 'layout' | 'style' | 'shortcuts';

const RAIL_TABS: { id: RightTab; icon: React.ElementType; label: string }[] = [
  { id: 'properties', icon: Settings,    label: '속성' },
  { id: 'layers',     icon: Layers,      label: '레이어' },
  { id: 'elements',   icon: Plus,        label: '요소' },
  { id: 'layout',     icon: LayoutGrid,  label: '레이아웃' },
  { id: 'style',      icon: Palette,     label: '스타일' },
];

export default function RightPanel() {
  const railTab = useEditorStore(selectRailTab);
  const setRailTab = useEditorStore((s) => s.setRailTab);
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const selectedElementId = useEditorStore(selectSelectedElementId);

  // 요소 선택 시 자동으로 속성 탭 열기 — 단, 사용자가 레이아웃/스타일 탭에서
  // 작업 중일 때는 유지 (요소 클릭마다 탭이 튕기는 동선 마찰 방지)
  useEffect(() => {
    if (!selectedElementId) return;
    const current = useEditorStore.getState().railTab;
    if (current === 'layout' || current === 'style') return;
    setRailTab('properties');
  }, [selectedElementId, setRailTab]);

  const handleRailClick = (tab: RightTab) => {
    if (tab === 'shortcuts') {
      window.dispatchEvent(new CustomEvent('nexops:toggle-shortcut-help'));
      return;
    }
    setRailTab(railTab === tab ? null : tab);
  };

  return (
    <div className="flex shrink-0">
      {/* 펼침 패널 (왼쪽, 조건부) */}
      {railTab && railTab !== 'shortcuts' && (
        <div className="w-[320px] bg-[var(--surface-base)] border-l border-[var(--border-default)] overflow-y-auto overflow-x-hidden shadow-[inset_2px_0_8px_rgba(0,0,0,0.04)]">
          {railTab === 'properties' && <PropertiesTab selectedSectionId={selectedSectionId} />}
          {railTab === 'layers' && <LayerTab />}
          {railTab === 'elements' && <ElementsTab />}
          {railTab === 'layout' && <LayoutLibrary />}
          {railTab === 'style' && <StyleTab selectedSectionId={selectedSectionId} />}
        </div>
      )}

      {/* 아이콘 레일 (오른쪽, 항상 표시) */}
      <div
        className="w-14 bg-[var(--surface-base)] border-l border-[var(--border-default)] flex flex-col items-center py-2 gap-1 shrink-0"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="패널 탭"
      >
        {RAIL_TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => handleRailClick(id)}
            aria-label={label}
            aria-selected={railTab === id}
            className={[
              'flex flex-col items-center gap-0.5 w-12 py-2 rounded-lg text-[10px] transition-colors cursor-pointer',
              railTab === id
                ? 'bg-[var(--editor-brand-tint)] text-[var(--editor-brand)] font-medium border-l-2 border-[var(--editor-brand)]'
                : 'text-[var(--text-disabled)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] border-l-2 border-transparent',
            ].join(' ')}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => handleRailClick('shortcuts')}
          aria-label="단축키"
          className="flex flex-col items-center gap-0.5 w-12 py-2 rounded-lg text-[10px] text-[var(--text-disabled)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] transition-colors cursor-pointer"
        >
          <Keyboard size={16} />
          단축키
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 레이어 탭 — 현재 섹션의 요소 목록
// ─────────────────────────────────────────────

