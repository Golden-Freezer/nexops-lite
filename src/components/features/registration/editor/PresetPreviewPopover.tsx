'use client';

import CanvasSectionComponent from './CanvasSection';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { PresetApplyMode } from '@/lib/registration/editor/utils/applyLayoutPreset';

interface PresetPreviewPopoverProps {
  previewSection: CanvasSection;
  presetName: string;
  mode: PresetApplyMode;
  anchorRect: { top: number; left: number };
}

const SOURCE_WIDTH = 860;
const POPOVER_WIDTH = 320;
const SCALE = POPOVER_WIDTH / SOURCE_WIDTH;
const MAX_PREVIEW_HEIGHT = 420;
const HEADER_HEIGHT = 32;
const VIEWPORT_MARGIN = 8;

export default function PresetPreviewPopover({
  previewSection,
  presetName,
  mode,
  anchorRect,
}: PresetPreviewPopoverProps) {
  const previewHeight = Math.min(previewSection.canvas.height * SCALE, MAX_PREVIEW_HEIGHT);
  const popoverHeight = HEADER_HEIGHT + previewHeight + 2;
  const viewportHeight = typeof window === 'undefined' ? popoverHeight : window.innerHeight;
  const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - popoverHeight - VIEWPORT_MARGIN);
  const top = Math.min(Math.max(anchorRect.top, VIEWPORT_MARGIN), maxTop);
  const right =
    typeof window === 'undefined'
      ? VIEWPORT_MARGIN
      : window.innerWidth - anchorRect.left + VIEWPORT_MARGIN;

  return (
    <div
      className="fixed z-50 pointer-events-none overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] shadow-xl"
      style={{ width: POPOVER_WIDTH, right, top }}
      aria-hidden="true"
    >
      <div className="flex h-8 items-center border-b border-[var(--border-subtle)] px-3">
        <p className="truncate text-[10px] font-medium text-[var(--text-secondary)]">
          {presetName} — {mode === 'placement-only' ? '배치만' : '배치+스타일'} 미리보기
        </p>
      </div>
      <div
        className="overflow-hidden"
        style={{
          width: POPOVER_WIDTH,
          height: previewHeight,
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: SOURCE_WIDTH,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
          }}
        >
          <CanvasSectionComponent section={previewSection} />
        </div>
      </div>
    </div>
  );
}
