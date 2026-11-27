'use client';

// editor/rightpanel/PropertySections.tsx — D4 분할: 원본 RightPanel.tsx 1237~1554행 순수 이동 (2026-07-04)

import { useState } from 'react';
import ColorPicker from '../ColorPicker';
import type { CanvasElement, ShadowProps } from '@/lib/registration/editor/types/canvas';
import { SectionHeader, PropertyInput } from './primitives';

function FramedImageBorderSection({
  sectionId,
  elementId,
  framedImageProps,
  updateElement,
  hideHeader,
}: {
  sectionId: string;
  elementId: string;
  framedImageProps: NonNullable<import('@/lib/registration/editor/types/canvas').CanvasElement['framedImageProps']>;
  updateElement: (sectionId: string, elementId: string, partial: Partial<import('@/lib/registration/editor/types/canvas').CanvasElement>) => void;
  hideHeader?: boolean;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const update = (partial: Partial<typeof framedImageProps>) => {
    updateElement(sectionId, elementId, {
      framedImageProps: { ...framedImageProps, ...partial },
    });
  };

  const width = framedImageProps.borderWidth ?? 0;
  const color = framedImageProps.borderColor ?? '#000000';
  const style = framedImageProps.borderStyle ?? 'solid';

  // clipPath 기반 프레임에서는 테두리가 클립으로 잘려 적용 불가
  const usesClipPath =
    framedImageProps.frameId !== 'circle' &&
    framedImageProps.frameId !== 'roundedRect' &&
    framedImageProps.frameId !== 'rect';

  if (usesClipPath) {
    return (
      <>
        {!hideHeader && <SectionHeader title="테두리" />}
        <div className="text-[10px] text-[var(--text-disabled)] leading-snug">
          이 프레임({framedImageProps.frameId})은 clip-path를 사용하므로 테두리를 적용할 수 없습니다.
        </div>
      </>
    );
  }

  return (
    <>
      {!hideHeader && <SectionHeader title="테두리" />}

      {/* 두께 */}
      <PropertyInput
        label="두께"
        value={width}
        min={0}
        max={40}
        unit="px"
        onChange={(v) => update({ borderWidth: v })}
      />

      {/* 색상 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">색상</label>
        <button
          onClick={() => setShowColorPicker((v) => !v)}
          className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-[10px] text-[var(--text-disabled)] font-mono">{color}</span>
      </div>
      {showColorPicker && (
        <div className="relative">
          <ColorPicker
            value={color}
            onChange={(c) => update({ borderColor: c })}
            onClose={() => setShowColorPicker(false)}
            inline
          />
        </div>
      )}

      {/* 스타일 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">스타일</label>
        <select
          value={style}
          onChange={(e) => update({ borderStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}
          className="flex-1 h-7 text-xs border border-[var(--border-default)] rounded px-1.5 bg-[var(--surface-elevated)] outline-none cursor-pointer"
        >
          <option value="solid">실선</option>
          <option value="dashed">점선(dash)</option>
          <option value="dotted">점선(dot)</option>
        </select>
      </div>
    </>
  );
}

function ShapePropertiesSection({
  sectionId,
  elementId,
  shapeProps,
  updateElement,
  hideHeader,
}: {
  sectionId: string;
  elementId: string;
  shapeProps: NonNullable<import('@/lib/registration/editor/types/canvas').CanvasElement['shapeProps']>;
  updateElement: (sectionId: string, elementId: string, partial: Partial<import('@/lib/registration/editor/types/canvas').CanvasElement>) => void;
  hideHeader?: boolean;
}) {
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);

  const updateShapeProp = (partial: Partial<typeof shapeProps>) => {
    updateElement(sectionId, elementId, { shapeProps: { ...shapeProps, ...partial } });
  };

  return (
    <>
      {!hideHeader && <SectionHeader title="도형" />}

      {/* 도형 타입 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">타입</label>
        <select
          value={shapeProps.shapeType}
          onChange={(e) => updateShapeProp({ shapeType: e.target.value as typeof shapeProps.shapeType })}
          className="flex-1 h-7 text-xs border border-[var(--border-default)] rounded px-1.5 bg-[var(--surface-elevated)] outline-none cursor-pointer"
        >
          <option value="rect">사각형</option>
          <option value="roundedRect">둥근 사각형</option>
          <option value="circle">원</option>
          <option value="line">선</option>
        </select>
      </div>

      {/* 채우기 색상 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">채우기</label>
        <button
          onClick={() => setShowFillPicker((v) => !v)}
          className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
          style={{ background: shapeProps.fill || 'transparent' }}
        />
        <span className="text-[10px] text-[var(--text-disabled)] font-mono">{shapeProps.fill || 'transparent'}</span>
      </div>
      {showFillPicker && (
        <div className="relative">
          <ColorPicker
            value={shapeProps.fill || '#e5e7eb'}
            onChange={(color) => updateShapeProp({ fill: color })}
            onClose={() => setShowFillPicker(false)}
            inline
            enableGradient
          />
        </div>
      )}

      {/* 테두리 색상 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">테두리</label>
        <button
          onClick={() => setShowStrokePicker((v) => !v)}
          className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
          style={{ backgroundColor: shapeProps.stroke || 'transparent' }}
        />
        <span className="text-[10px] text-[var(--text-disabled)] font-mono">{shapeProps.stroke || 'none'}</span>
      </div>
      {showStrokePicker && (
        <div className="relative">
          <ColorPicker
            value={shapeProps.stroke || '#9ca3af'}
            onChange={(color) => updateShapeProp({ stroke: color })}
            onClose={() => setShowStrokePicker(false)}
            inline
          />
        </div>
      )}

      {/* 테두리 두께 */}
      <PropertyInput
        label="두께"
        value={shapeProps.strokeWidth ?? 1}
        min={0}
        max={20}
        unit="px"
        onChange={(v) => updateShapeProp({ strokeWidth: v })}
      />

      {/* 모서리 둥글기 (roundedRect) */}
      {(shapeProps.shapeType === 'roundedRect' || shapeProps.shapeType === 'rect') && (
        <PropertyInput
          label="둥글기"
          value={shapeProps.borderRadius ?? 0}
          min={0}
          max={200}
          unit="px"
          onChange={(v) => updateShapeProp({ borderRadius: v })}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// 그림자 섹션 (모든 요소 공통)
// ─────────────────────────────────────────────

const DEFAULT_SHADOW: ShadowProps = {
  enabled: true,
  angle: 135,
  distance: 4,
  blur: 12,
  spread: 0,
};

function ShadowSection({
  sectionId,
  elementId,
  shadow,
  updateElement,
  hideHeader,
}: {
  sectionId: string;
  elementId: string;
  shadow: ShadowProps | undefined;
  updateElement: (sectionId: string, elementId: string, partial: Partial<import('@/lib/registration/editor/types/canvas').CanvasElement>) => void;
  hideHeader?: boolean;
}) {
  const [showShadowColorPicker, setShowShadowColorPicker] = useState(false);
  const isEnabled = shadow?.enabled ?? false;

  const toggleShadow = () => {
    if (isEnabled) {
      updateElement(sectionId, elementId, { shadow: { ...(shadow ?? DEFAULT_SHADOW), enabled: false } });
    } else {
      updateElement(sectionId, elementId, { shadow: shadow ? { ...shadow, enabled: true } : { ...DEFAULT_SHADOW } });
    }
  };

  const updateShadowProp = <K extends keyof ShadowProps>(key: K, val: ShadowProps[K]) => {
    updateElement(sectionId, elementId, { shadow: { ...(shadow ?? DEFAULT_SHADOW), [key]: val } });
  };

  return (
    <>
      {!hideHeader && <SectionHeader title="그림자" />}
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">사용</label>
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={toggleShadow}
          className="accent-[var(--editor-brand)] cursor-pointer"
        />
        {isEnabled && (
          <span className="text-[10px] text-[var(--text-disabled)]">
            {shadow?.angle ?? 135}°, {shadow?.distance ?? 4}px, blur {shadow?.blur ?? 12}
          </span>
        )}
      </div>
      {isEnabled && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">색상</label>
            <button
              onClick={() => setShowShadowColorPicker((v) => !v)}
              className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
              style={{ backgroundColor: shadow?.color || 'rgba(0,0,0,0.3)' }}
              title="그림자 색상"
            />
            <span className="text-[10px] text-[var(--text-disabled)] font-mono">{shadow?.color || 'rgba(0,0,0,0.3)'}</span>
          </div>
          {showShadowColorPicker && (
            <div className="relative">
              <ColorPicker
                value={shadow?.color || 'rgba(0,0,0,0.3)'}
                onChange={(color) => updateShadowProp('color', color)}
                onClose={() => setShowShadowColorPicker(false)}
                inline
              />
            </div>
          )}
          <PropertyInput
            label="각도"
            value={shadow?.angle ?? 135}
            min={0}
            max={360}
            unit="°"
            onChange={(v) => updateShadowProp('angle', v)}
          />
          <PropertyInput
            label="거리"
            value={shadow?.distance ?? 4}
            min={0}
            max={50}
            unit="px"
            onChange={(v) => updateShadowProp('distance', v)}
          />
          <PropertyInput
            label="흐림"
            value={shadow?.blur ?? 12}
            min={0}
            max={100}
            unit="px"
            onChange={(v) => updateShadowProp('blur', v)}
          />
          <PropertyInput
            label="퍼짐"
            value={shadow?.spread ?? 0}
            min={-20}
            max={50}
            unit="px"
            onChange={(v) => updateShadowProp('spread', v)}
          />
        </>
      )}
    </>
  );
}


export { FramedImageBorderSection, ShapePropertiesSection, ShadowSection };
