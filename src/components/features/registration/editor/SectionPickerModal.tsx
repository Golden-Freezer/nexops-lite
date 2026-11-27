'use client';

import { X, Check, Plus } from 'lucide-react';
import { useEditorStore, selectDocument, selectSections } from '@/lib/registration/editor/stores/editorStore';
import { PRO_SECTION_GROUPS } from '@/lib/registration/editor/types/section';
import type { ProSectionType } from '@/lib/registration/editor/types/section';
import { createPlaceholderSection, getSectionLabel } from '@/lib/registration/editor/utils/sectionConverter';
import { SECTION_GROUP_MAP } from '@/lib/registration/editor/constants/sectionConfig';

const GROUP_COLORS: Record<string, { border: string; bg: string }> = {
  hook:    { border: 'rgba(251,146,60,0.3)',  bg: 'rgba(251,146,60,0.08)' },
  problem: { border: 'rgba(96,165,250,0.3)',  bg: 'rgba(96,165,250,0.08)' },
  usp:     { border: 'rgba(168,85,247,0.3)',  bg: 'rgba(168,85,247,0.08)' },
  modules: { border: 'rgba(52,211,153,0.3)',  bg: 'rgba(52,211,153,0.08)' },
};

const GROUP_HEADER_COLORS: Record<string, string> = {
  hook:    'rgb(251,146,60)',
  problem: 'rgb(96,165,250)',
  usp:     'rgb(168,85,247)',
  modules: 'rgb(52,211,153)',
};

interface SectionPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SectionPickerModal({ isOpen, onClose }: SectionPickerModalProps) {
  const document = useEditorStore(selectDocument);
  const sections = useEditorStore(selectSections);
  const addSection = useEditorStore((s) => s.addSection);

  if (!isOpen || !document) return null;

  const existingTypes = new Set(sections.map((s) => s.sectionType));
  const designPalette = document.sourceData.designPalette;

  function handleAdd(sectionType: ProSectionType) {
    if (existingTypes.has(sectionType)) return;

    // 해당 그룹의 마지막 섹션 뒤에 삽입
    const group = SECTION_GROUP_MAP[sectionType];
    const groupSections = [...sections]
      .filter((s) => s.groupType === group)
      .sort((a, b) => a.order - b.order);

    const insertAfterId = groupSections.length > 0
      ? groupSections[groupSections.length - 1].id
      : undefined;

    const newSection = createPlaceholderSection(
      sectionType,
      designPalette,
      sections.length,
    );

    addSection(newSection, insertAfterId);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="섹션 추가"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-[var(--surface-overlay)] rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">섹션 추가</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded hover:bg-[var(--hover-overlay)] text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* 그룹별 섹션 목록 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {PRO_SECTION_GROUPS.map((group) => (
            <div key={group.group} className="rounded-lg border p-3"
              style={{ borderColor: GROUP_COLORS[group.group].border, backgroundColor: GROUP_COLORS[group.group].bg }}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: GROUP_HEADER_COLORS[group.group] }}>
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.types.map((type) => {
                  const exists = existingTypes.has(type);
                  return (
                    <button
                      key={type}
                      disabled={exists}
                      onClick={() => handleAdd(type)}
                      className={[
                        'flex items-center w-full px-2.5 py-1.5 rounded text-xs transition-colors',
                        exists
                          ? 'text-[var(--text-disabled)] cursor-default bg-[var(--hover-overlay)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--pressed-overlay)] cursor-pointer',
                      ].join(' ')}
                    >
                      {exists ? (
                        <Check size={12} className="mr-2 text-green-500 shrink-0" />
                      ) : (
                        <Plus size={12} className="mr-2 text-[var(--text-disabled)] shrink-0" />
                      )}
                      <span className="font-medium mr-1.5">{getSectionLabel(type)}</span>
                      <span className="text-[10px] text-[var(--text-disabled)]">{type}</span>
                      {exists && (
                        <span className="ml-auto text-[10px] text-[var(--text-disabled)]">추가됨</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 하단 안내 */}
        <div className="px-4 py-2.5 border-t border-[var(--border-default)] bg-[var(--hover-overlay)] rounded-b-lg">
          <p className="text-[10px] text-[var(--text-disabled)] leading-relaxed">
            추가된 섹션은 플레이스홀더로 생성됩니다. 캔버스에서 텍스트와 이미지를 편집하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
