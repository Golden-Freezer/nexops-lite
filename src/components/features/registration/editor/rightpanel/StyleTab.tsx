'use client';

// editor/rightpanel/StyleTab.tsx — D4 분할: 원본 RightPanel.tsx 1116~1236행 순수 이동 (2026-07-04)

import { useState } from 'react';
import { useEditorStore, selectDocument } from '@/lib/registration/editor/stores/editorStore';
import ColorPicker from '../ColorPicker';
import { EmptyState, SectionHeader } from './primitives';
import { ProSectionType } from '@/lib/registration/editor/types/section';
import { REVIEW_CARD_DEFAULTS } from '@/lib/registration/editor/constants/designTokens';
import { relayoutReviewCards } from '@/lib/registration/editor/utils/reviewCardLayout';
import type { ReviewCardParams } from '@/lib/registration/editor/types/canvas';

function StyleTab({ selectedSectionId }: { selectedSectionId: string | null }) {
  const doc           = useEditorStore(selectDocument);
  const updateSection = useEditorStore((s) => s.updateSection);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);

  const section = doc?.sections.find((s) => s.id === selectedSectionId);

  if (!selectedSectionId || !section) {
    return <EmptyState icon="🎨" message="섹션을 선택하면 스타일을 편집할 수 있습니다." />;
  }

  return (
    <div className="p-4 space-y-4">
      <SectionHeader title="배경" />
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-14 shrink-0">배경색</label>
        <button
          onClick={() => setShowBgColorPicker((v) => !v)}
          className="w-7 h-7 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
          style={{ background: section.canvas.backgroundColor || '#FFFFFF' }}
        />
        <span className="text-[10px] text-[var(--text-disabled)]">{section.canvas.backgroundColor}</span>
      </div>
      {showBgColorPicker && (
        <div className="relative">
          <ColorPicker
            value={section.canvas.backgroundColor || '#FFFFFF'}
            onChange={(color) => {
              updateSection(selectedSectionId, {
                ...section,
                canvas: { ...section.canvas, backgroundColor: color },
              });
            }}
            onClose={() => setShowBgColorPicker(false)}
            inline
            enableGradient
          />
        </div>
      )}

      <SectionHeader title="섹션 크기" />
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-14 shrink-0">높이</label>
        <input
          type="range"
          min={200}
          max={5000}
          step={10}
          value={section.canvas.height}
          onChange={(e) => {
            const v = Number(e.target.value);
            updateSection(selectedSectionId, {
              ...section,
              canvas: { ...section.canvas, height: v },
              userAdjustedHeight: true,
            });
          }}
          className="flex-1 h-1 accent-[var(--editor-brand)] cursor-pointer"
        />
        <input
          type="number"
          min={200}
          value={Math.round(section.canvas.height)}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v) && v >= 200) {
              updateSection(selectedSectionId, {
                ...section,
                canvas: { ...section.canvas, height: v },
                userAdjustedHeight: true,
              });
            }
          }}
          className="w-16 h-7 bg-[var(--surface-elevated)] rounded border border-[var(--border-default)] text-xs px-2 text-center outline-none focus:border-[var(--editor-brand)]"
        />
        <span className="text-[10px] text-[var(--text-disabled)]">px</span>
      </div>
      {section.canvas.height > 3000 && (
        <div className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1 mt-1">
          높이가 3000px을 초과합니다. 모바일 로딩 속도에 영향을 줄 수 있습니다.
        </div>
      )}

      {section.sectionType === ProSectionType.PERFORMANCE_REVIEWS && (() => {
        const params: ReviewCardParams = section.reviewCardParams ?? {
          gap: REVIEW_CARD_DEFAULTS.gap,
          padding: REVIEW_CARD_DEFAULTS.padding,
          bodyFontSize: REVIEW_CARD_DEFAULTS.bodyFontSize,
        };
        const apply = (next: ReviewCardParams) => {
          updateSection(selectedSectionId, relayoutReviewCards(section, next));
        };
        const rows: Array<{
          key: keyof ReviewCardParams; label: string; min: number; max: number;
        }> = [
          { key: 'gap',          label: '카드 간격', min: 0,  max: 60 },
          { key: 'padding',      label: '카드 여백', min: 8,  max: 48 },
          { key: 'bodyFontSize', label: '본문 크기', min: 20, max: 40 },
        ];
        return (
          <>
            <SectionHeader title="리뷰 카드" />
            {rows.map(({ key, label, min, max }) => (
              <div key={key} className="flex items-center gap-2">
                <label className="text-xs text-[var(--text-secondary)] w-14 shrink-0">{label}</label>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={params[key]}
                  onChange={(e) => apply({ ...params, [key]: Number(e.target.value) })}
                  className="flex-1 h-1 accent-[var(--editor-brand)] cursor-pointer"
                />
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={params[key]}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= min && v <= max) apply({ ...params, [key]: v });
                  }}
                  className="w-16 h-7 bg-[var(--surface-elevated)] rounded border border-[var(--border-default)] text-xs px-2 text-center outline-none focus:border-[var(--editor-brand)]"
                />
                <span className="text-[10px] text-[var(--text-disabled)]">px</span>
              </div>
            ))}
          </>
        );
      })()}

      {doc?.sourceData.designPalette && (
        <>
          <SectionHeader title="디자인 팔레트" />
          <div className="flex gap-2 flex-wrap">
            {Object.entries(doc.sourceData.designPalette).map(([key, color]) => (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-7 h-7 rounded-full border border-[var(--border-default)] cursor-pointer hover:scale-110 transition-transform"
                  style={{ backgroundColor: color as string }}
                  onClick={() => {
                    updateSection(selectedSectionId, {
                      ...section,
                      canvas: { ...section.canvas, backgroundColor: color as string },
                    });
                  }}
                  title={`${key}: ${color}`}
                />
                <span className="text-[9px] text-[var(--text-disabled)]">{key}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 내부 UI 컴포넌트
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 도형 속성 섹션
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 프레임 이미지 테두리 섹션
// ─────────────────────────────────────────────

export { StyleTab };
