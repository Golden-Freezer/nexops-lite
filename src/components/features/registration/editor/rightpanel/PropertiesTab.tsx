'use client';

// editor/rightpanel/PropertiesTab.tsx — D4 분할: 원본 RightPanel.tsx 469~1115행 순수 이동 (2026-07-04)

import { useMemo, useState, useRef, useCallback } from 'react';
import {
  Bold, Italic, Underline,
  AlignLeft, AlignCenter, AlignRight,
  Lock, Unlock, Eye, EyeOff,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/clerk-shim';
import { uploadImageViaSignedUrl } from '@/lib/registration/editor/services/editorApi';
import {
  useEditorStore,
  selectDocument,
  selectSelectedElementId,
  selectSelectedElementIds,
  selectMeasuredHeights,
} from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import ColorPicker from '../ColorPicker';
import type { TextElementProps } from '@/lib/registration/editor/types/canvas';
import { FONT_OPTIONS, FONT_GROUPS, fontKey } from '@/lib/registration/editor/constants/fonts';
import {
  EmptyState,
  CollapsibleSection,
  PropertyInput,
  FloatPropertyInput,
  SmallToggle,
} from './primitives';
import { FramedImageBorderSection, ShapePropertiesSection, ShadowSection } from './PropertySections';

function PropertiesTab({ selectedSectionId }: { selectedSectionId: string | null }) {
  const doc                   = useEditorStore(selectDocument);
  const selectedElementId     = useEditorStore(selectSelectedElementId);
  const selectedElementIds    = useEditorStore(selectSelectedElementIds);
  const measuredHeights       = useEditorStore(selectMeasuredHeights);
  const updateElementPosition = useEditorStore((s) => s.updateElementPosition);
  const updateElementSize     = useEditorStore((s) => s.updateElementSize);
  const updateElement         = useEditorStore((s) => s.updateElement);
  const updateSelectedElements = useEditorStore((s) => s.updateSelectedElements);
  const updateSelectedTextProps = useEditorStore((s) => s.updateSelectedTextProps);
  const requestStyleRemeasure = useEditorStore((s) => s.requestStyleRemeasure);
  const setCropTarget         = useEditorStore((s) => s.setCropTarget);
  const commitHistory         = useCanvasStore((s) => s.commitHistory);
  const { getToken }          = useAuth();
  const fileInputRef          = useRef<HTMLInputElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStrokeColorPicker, setShowStrokeColorPicker] = useState(false);
  const [showTextShadowColorPicker, setShowTextShadowColorPicker] = useState(false);

  const elementData = useMemo(() => {
    if (!doc || !selectedElementId) return null;
    for (const section of doc.sections) {
      const el = section.elements.find((e) => e.id === selectedElementId);
      if (el) return { sectionId: section.id, element: el, section };
    }
    return null;
  }, [doc, selectedElementId]);

  const handleImageReplace = useCallback(async (file: File) => {
    if (!elementData) return;
    try {
      const token = await getToken();
      if (!token) return;
      const newUrl = await uploadImageViaSignedUrl(token, file);
      const { sectionId, element } = elementData;
      if (element.type === 'image' && element.imageProps) {
        updateElement(sectionId, element.id, {
          imageProps: { ...element.imageProps, src: newUrl, isUserUploaded: true },
        });
      } else if (element.type === 'framed-image' && element.framedImageProps) {
        updateElement(sectionId, element.id, {
          framedImageProps: { ...element.framedImageProps, src: newUrl, isUserUploaded: true },
        });
      }
      const sections = useEditorStore.getState().document?.sections;
      if (sections) {
        commitHistory('이미지 교체', sections);
      }
    } catch (err) {
      console.error('이미지 교체 실패:', err);
    }
  }, [elementData, getToken, updateElement, commitHistory]);

  const handleImageDownload = useCallback(async () => {
    if (!elementData) return;
    const src = elementData.element.imageProps?.src || elementData.element.framedImageProps?.src;
    if (!src) return;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${elementData.element.imageProps?.alt || elementData.element.framedImageProps?.alt || 'image'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(src, '_blank');
    }
  }, [elementData]);

  if (!selectedSectionId) {
    return <EmptyState icon="🖱️" message="섹션 또는 요소를 선택하면 속성이 표시됩니다." />;
  }

  if (!elementData) {
    return <EmptyState icon="🖱️" message="요소를 클릭하면 속성을 편집할 수 있습니다." />;
  }

  const { sectionId, element, section } = elementData;
  const { transform } = element;
  const sectionMeasuredHeight = measuredHeights[sectionId];
  const tp = element.textProps;

  const isMulti = selectedElementIds.length > 1;

  // P1-1: 변경 시 텍스트 기하(줄바꿈·높이)가 바뀌는 스타일 키
  const GEOMETRY_TEXT_KEYS = new Set<keyof TextElementProps>([
    'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  ]);

  // textProps 부분 업데이트 헬퍼 (다중선택 시 모든 선택 요소에 적용)
  const updateTextProp = <K extends keyof TextElementProps>(key: K, val: TextElementProps[K]) => {
    if (!tp) return;
    if (isMulti) {
      updateSelectedTextProps({ [key]: val });
      // 다중선택 재측정은 요청 슬롯이 단일이라 미지원 — 마지막 포커스 요소만 동기화
      if (GEOMETRY_TEXT_KEYS.has(key)) requestStyleRemeasure(sectionId, element.id);
    } else {
      updateElement(sectionId, element.id, { textProps: { ...tp, [key]: val } });
      // P1-1: 기하 영향 키는 재측정 → 박스 높이·아래 요소 리플로우 동기화
      if (GEOMETRY_TEXT_KEYS.has(key)) requestStyleRemeasure(sectionId, element.id);
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* 다중선택 표시 */}
      {isMulti && (
        <div className="text-[10px] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)] rounded px-2 py-1">
          {selectedElementIds.length}개 요소 선택됨 — 속성 변경 시 모두 적용
        </div>
      )}

      {/* ── 텍스트 속성 ── */}
      {element.type === 'text' && tp && (
        <>
          <CollapsibleSection title="텍스트" defaultOpen>

          {/* 폰트 선택 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">폰트</label>
            <select
              value={`${tp.fontFamily}__${tp.fontWeight}`}
              onChange={(e) => {
                const opt = FONT_OPTIONS.find((f) => fontKey(f) === e.target.value);
                if (opt) {
                  if (isMulti) {
                    updateSelectedTextProps({ fontFamily: opt.fontFamily, fontWeight: opt.fontWeight });
                  } else {
                    updateElement(sectionId, element.id, {
                      textProps: { ...tp, fontFamily: opt.fontFamily, fontWeight: opt.fontWeight },
                    });
                  }
                  // P1-1: 폰트 교체는 글자폭이 달라져 줄바꿈·높이가 바뀐다
                  requestStyleRemeasure(sectionId, element.id);
                }
              }}
              className="flex-1 h-7 text-xs border border-[var(--border-default)] rounded px-1.5 bg-[var(--surface-elevated)] outline-none cursor-pointer"
              style={{ fontFamily: tp.fontFamily }}
            >
              {FONT_GROUPS.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.fonts.map((f) => (
                    <option key={fontKey(f)} value={fontKey(f)} style={{ fontFamily: f.fontFamily }}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* 폰트 크기 */}
          <PropertyInput
            label="크기"
            value={tp.fontSize}
            min={6}
            max={500}
            unit="px"
            onChange={(v) => updateTextProp('fontSize', v)}
          />
          {/* 프리셋 */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">프리셋</label>
            {([['H1', 90], ['H2', 60], ['Body', 45], ['Cap', 28]] as const).map(([label, size]) => (
              <button
                key={label}
                onClick={() => updateTextProp('fontSize', size)}
                className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors cursor-pointer ${
                  tp.fontSize === size
                    ? 'bg-[var(--editor-brand-tint)] border-[var(--editor-brand)] text-[var(--editor-brand)]'
                    : 'bg-[var(--surface-elevated)] border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bold / Italic / Underline */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">스타일</label>
            <SmallToggle
              active={tp.fontWeight >= 700}
              onClick={() => updateTextProp('fontWeight', tp.fontWeight >= 700 ? 400 : 700)}
              title="굵게"
            >
              <Bold size={12} />
            </SmallToggle>
            <SmallToggle
              active={tp.fontStyle === 'italic'}
              onClick={() => updateTextProp('fontStyle', tp.fontStyle === 'italic' ? 'normal' : 'italic')}
              title="기울임"
            >
              <Italic size={12} />
            </SmallToggle>
            <SmallToggle
              active={tp.textDecoration === 'underline'}
              onClick={() => updateTextProp('textDecoration', tp.textDecoration === 'underline' ? 'none' : 'underline')}
              title="밑줄"
            >
              <Underline size={12} />
            </SmallToggle>
          </div>

          {/* 텍스트 정렬 */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">정렬</label>
            <SmallToggle active={tp.textAlign === 'left'} onClick={() => updateTextProp('textAlign', 'left')} title="왼쪽">
              <AlignLeft size={12} />
            </SmallToggle>
            <SmallToggle active={tp.textAlign === 'center'} onClick={() => updateTextProp('textAlign', 'center')} title="가운데">
              <AlignCenter size={12} />
            </SmallToggle>
            <SmallToggle active={tp.textAlign === 'right'} onClick={() => updateTextProp('textAlign', 'right')} title="오른쪽">
              <AlignRight size={12} />
            </SmallToggle>
          </div>

          {/* 텍스트 색상 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">색상</label>
            <button
              onClick={() => setShowColorPicker((v) => !v)}
              className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
              style={{ backgroundColor: tp.color }}
              title="텍스트 색상"
            />
            <span className="text-[10px] text-[var(--text-disabled)] font-mono">{tp.color}</span>
          </div>
          {showColorPicker && (
            <div className="relative">
              <ColorPicker
                value={tp.color}
                onChange={(color) => updateTextProp('color', color)}
                onClose={() => setShowColorPicker(false)}
                inline
              />
            </div>
          )}

          {/* 자간 (letterSpacing) */}
          <FloatPropertyInput
            label="자간"
            value={tp.letterSpacing}
            min={-5}
            max={20}
            step={0.1}
            unit="px"
            onChange={(v) => updateTextProp('letterSpacing', v)}
          />

          {/* 행간 (lineHeight) — 배수 단위 명시 + 프리셋 */}
          <FloatPropertyInput
            label="행간"
            value={tp.lineHeight}
            min={0.5}
            max={5.0}
            step={0.1}
            unit="×"
            onChange={(v) => updateTextProp('lineHeight', v)}
          />
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)] w-10 shrink-0" />
            {([
              { label: '좁게', value: 1.3 },
              { label: '보통', value: 1.5 },
              { label: '넓게', value: 1.8 },
            ] as const).map((preset) => (
              <button
                key={preset.value}
                onClick={() => updateTextProp('lineHeight', preset.value)}
                className={[
                  'flex-1 h-6 rounded border text-[11px] transition-colors cursor-pointer',
                  Math.abs(tp.lineHeight - preset.value) < 0.01
                    ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]',
                ].join(' ')}
              >
                {preset.label} {preset.value}
              </button>
            ))}
          </div>

          {/* 자동 높이 토글 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">자동높이</label>
            <input
              type="checkbox"
              checked={element.autoHeight !== false}
              onChange={(e) => updateElement(sectionId, element.id, { autoHeight: e.target.checked })}
              className="accent-[var(--editor-brand)] cursor-pointer"
            />
          </div>

          </CollapsibleSection>

          {/* ── 윤곽선 (Text Stroke) ── */}
          <CollapsibleSection title="윤곽선">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">색상</label>
            <button
              onClick={() => setShowStrokeColorPicker((v) => !v)}
              className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
              style={{
                backgroundColor: tp.stroke && tp.stroke !== 'transparent' ? tp.stroke : undefined,
                backgroundImage: !tp.stroke || tp.stroke === 'transparent'
                  ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                  : undefined,
                backgroundSize: !tp.stroke || tp.stroke === 'transparent' ? '6px 6px' : undefined,
                backgroundPosition: !tp.stroke || tp.stroke === 'transparent' ? '0 0, 0 3px, 3px -3px, -3px 0px' : undefined,
              }}
              title="윤곽선 색상"
            />
            <span className="text-[10px] text-[var(--text-disabled)] font-mono">{tp.stroke || 'transparent'}</span>
          </div>
          {showStrokeColorPicker && (
            <div className="relative">
              <ColorPicker
                value={tp.stroke || 'transparent'}
                onChange={(color) => updateTextProp('stroke', color)}
                onClose={() => setShowStrokeColorPicker(false)}
                inline
              />
            </div>
          )}
          <PropertyInput
            label="두께"
            value={tp.strokeWidth ?? 0}
            min={0}
            max={10}
            unit="px"
            onChange={(v) => updateTextProp('strokeWidth', v)}
          />

          </CollapsibleSection>

          {/* ── 텍스트 그림자 (Text Shadow) ── */}
          <CollapsibleSection title="텍스트 그림자">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">색상</label>
            <button
              onClick={() => setShowTextShadowColorPicker((v) => !v)}
              className="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer hover:ring-1 hover:ring-[var(--editor-brand)] shrink-0"
              style={{ backgroundColor: tp.textShadowColor || 'rgba(0,0,0,0.3)' }}
              title="그림자 색상"
            />
            <span className="text-[10px] text-[var(--text-disabled)] font-mono">{tp.textShadowColor || 'rgba(0,0,0,0.3)'}</span>
          </div>
          {showTextShadowColorPicker && (
            <div className="relative">
              <ColorPicker
                value={tp.textShadowColor || 'rgba(0,0,0,0.3)'}
                onChange={(color) => updateTextProp('textShadowColor', color)}
                onClose={() => setShowTextShadowColorPicker(false)}
                inline
              />
            </div>
          )}
          <PropertyInput
            label="각도"
            value={tp.textShadowAngle ?? 135}
            min={0}
            max={360}
            unit="°"
            onChange={(v) => updateTextProp('textShadowAngle', v)}
          />
          <PropertyInput
            label="거리"
            value={tp.textShadowDistance ?? 0}
            min={0}
            max={50}
            unit="px"
            onChange={(v) => updateTextProp('textShadowDistance', v)}
          />
          <PropertyInput
            label="흐림"
            value={tp.textShadowBlur ?? 0}
            min={0}
            max={100}
            unit="px"
            onChange={(v) => updateTextProp('textShadowBlur', v)}
          />
          </CollapsibleSection>
        </>
      )}

      {/* ── 이미지 속성 ── */}
      {(element.type === 'image' || element.type === 'framed-image') && (
        <>
          <CollapsibleSection title="이미지" defaultOpen>
          <div className="text-xs text-[var(--text-secondary)]">
            {(element.imageProps?.src || element.framedImageProps?.src) ? '이미지 로드됨' : '이미지 없음'}
          </div>
          <div className="text-xs text-[var(--text-disabled)]">
            타입: {element.imageProps?.imageType || element.framedImageProps?.imageType || '—'}
          </div>

          {/* objectFit 선택 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">맞춤</label>
            <select
              value={element.imageProps?.objectFit || element.framedImageProps?.objectFit || 'cover'}
              onChange={(e) => {
                const val = e.target.value as 'cover' | 'contain' | 'fill';
                if (element.type === 'image' && element.imageProps) {
                  updateElement(sectionId, element.id, {
                    imageProps: { ...element.imageProps, objectFit: val },
                  });
                } else if (element.type === 'framed-image' && element.framedImageProps) {
                  updateElement(sectionId, element.id, {
                    framedImageProps: { ...element.framedImageProps, objectFit: val },
                  });
                }
              }}
              className="flex-1 h-7 text-xs border border-[var(--border-default)] rounded px-1.5 bg-[var(--surface-elevated)] outline-none cursor-pointer"
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="fill">Fill</option>
            </select>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageReplace(file);
              e.target.value = '';
            }}
          />
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-2 py-1.5 text-xs bg-[var(--surface-elevated)] hover:bg-[var(--pressed-overlay)] rounded transition-colors text-[var(--text-primary)]"
            >
              교체
            </button>
            <button
              onClick={handleImageDownload}
              className="flex-1 px-2 py-1.5 text-xs bg-[var(--surface-elevated)] hover:bg-[var(--pressed-overlay)] rounded transition-colors text-[var(--text-primary)]"
            >
              다운로드
            </button>
          </div>
          {(element.type === 'image' || element.type === 'framed-image') && (
            <button
              onClick={() => setCropTarget({ elementId: element.id, sectionId })}
              className="w-full px-2 py-1.5 text-xs bg-[var(--surface-elevated)] hover:bg-[var(--pressed-overlay)] rounded transition-colors text-[var(--text-primary)] mt-1"
            >
              자르기
            </button>
          )}
          </CollapsibleSection>
        </>
      )}

      {/* ── 프레임 이미지 테두리 ── */}
      {element.type === 'framed-image' && element.framedImageProps && (
        <CollapsibleSection title="프레임 테두리" defaultOpen>
        <FramedImageBorderSection
          sectionId={sectionId}
          elementId={element.id}
          framedImageProps={element.framedImageProps}
          updateElement={updateElement}
          hideHeader
        />
        </CollapsibleSection>
      )}

      {/* ── 도형 속성 ── */}
      {element.type === 'shape' && element.shapeProps && (
        <CollapsibleSection title="도형" defaultOpen>
        <ShapePropertiesSection
          sectionId={sectionId}
          elementId={element.id}
          shapeProps={element.shapeProps}
          updateElement={updateElement}
          hideHeader
        />
        </CollapsibleSection>
      )}

      {/* ── 그림자 (텍스트 제외 — 텍스트는 text-shadow만 사용) ── */}
      {element.type !== 'text' && (
        <CollapsibleSection title="그림자">
        <ShadowSection
          sectionId={sectionId}
          elementId={element.id}
          shadow={element.shadow}
          updateElement={updateElement}
          hideHeader
        />
        </CollapsibleSection>
      )}

      {/* ── 크기 (다중선택 시 비활성) ── */}
      <CollapsibleSection title="크기">
      {isMulti ? (
        <p className="text-[10px] text-[var(--text-disabled)]">다중 선택 시 크기 변경 불가</p>
      ) : (
        <>
          <PropertyInput
            label="너비"
            value={transform.width}
            onChange={(v) => updateElementSize(sectionId, element.id, v, transform.height)}
          />
          <PropertyInput
            label="높이"
            value={transform.height}
            onChange={(v) => updateElementSize(sectionId, element.id, transform.width, v)}
          />
        </>
      )}
      </CollapsibleSection>

      {/* ── 공통 속성 ── */}
      <CollapsibleSection title="표시">

      {/* 수직 정렬 */}
      <div className="flex items-center gap-1">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">수직</label>
        <SmallToggle
          active={(element.verticalAlign ?? 'middle') === 'top'}
          onClick={() => isMulti ? updateSelectedElements({ verticalAlign: 'top' }) : updateElement(sectionId, element.id, { verticalAlign: 'top' })}
          title="위쪽 정렬"
        >
          <AlignStartVertical size={12} />
        </SmallToggle>
        <SmallToggle
          active={(element.verticalAlign ?? 'middle') === 'middle'}
          onClick={() => isMulti ? updateSelectedElements({ verticalAlign: 'middle' }) : updateElement(sectionId, element.id, { verticalAlign: 'middle' })}
          title="가운데 정렬"
        >
          <AlignCenterVertical size={12} />
        </SmallToggle>
        <SmallToggle
          active={(element.verticalAlign ?? 'middle') === 'bottom'}
          onClick={() => isMulti ? updateSelectedElements({ verticalAlign: 'bottom' }) : updateElement(sectionId, element.id, { verticalAlign: 'bottom' })}
          title="아래쪽 정렬"
        >
          <AlignEndVertical size={12} />
        </SmallToggle>
      </div>

      {/* 투명도 — 공통 PropertyInput으로 통합 (인라인 구현의 스타일/동작 불일치 해소) */}
      <PropertyInput
        label="투명도"
        value={Math.round((element.opacity ?? 1) * 100)}
        min={0}
        max={100}
        unit="%"
        onChange={(v) => {
          const op = v / 100;
          if (isMulti) updateSelectedElements({ opacity: op });
          else updateElement(sectionId, element.id, { opacity: op });
        }}
      />

      {/* 회전 — step 5°: 0~360 범위를 1° 스텝으로 돌리던 과세밀 해소 (직접 입력은 1° 가능) */}
      <PropertyInput
        label="회전"
        value={transform.rotation}
        min={0}
        max={360}
        step={5}
        unit="°"
        onChange={(v) => updateElement(sectionId, element.id, {
          transform: { ...transform, rotation: v },
        })}
      />

      {/* 잠금 / 가시성 토글 */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--text-secondary)] w-10 shrink-0">옵션</label>
        <button
          onClick={() => updateElement(sectionId, element.id, { isLocked: !element.isLocked })}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
            element.isLocked ? 'bg-amber-100 text-amber-700' : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--pressed-overlay)]'
          }`}
          title={element.isLocked ? '잠금 해제' : '잠금'}
        >
          {element.isLocked ? <Lock size={11} /> : <Unlock size={11} />}
          {element.isLocked ? '잠금' : '해제'}
        </button>
        <button
          onClick={() => updateElement(sectionId, element.id, { isVisible: !element.isVisible })}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
            !element.isVisible ? 'bg-red-100 text-red-700' : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--pressed-overlay)]'
          }`}
          title={element.isVisible ? '숨기기' : '표시'}
        >
          {element.isVisible ? <Eye size={11} /> : <EyeOff size={11} />}
          {element.isVisible ? '표시' : '숨김'}
        </button>
      </div>
      </CollapsibleSection>

      {/* V4.3: 전략 메타 정보 */}
      {(element.contentRole || section.strategyMeta) && (
        <CollapsibleSection title="전략 메타">
          {element.contentRole && (
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">요소 역할</span>
              <span className="text-[var(--editor-brand)] font-medium">{element.contentRole}</span>
            </div>
          )}
          {section.strategyMeta?.strategyTag && (
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">전략 태그</span>
              <span className="text-[var(--editor-brand)] font-medium">{section.strategyMeta.strategyTag}</span>
            </div>
          )}
          {section.strategyMeta?.purpose && (
            <div className="text-[10px] text-[var(--text-disabled)] leading-relaxed">
              {section.strategyMeta.purpose}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* V4.3: 실측 높이 */}
      {(element.measuredHeight !== undefined || sectionMeasuredHeight !== undefined) && (
        <CollapsibleSection title="실측 높이">
          {element.measuredHeight !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">요소 실측</span>
              <span className="text-emerald-600 font-medium">{Math.round(element.measuredHeight)}px</span>
            </div>
          )}
          {sectionMeasuredHeight !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">섹션 실측</span>
              <span className="text-emerald-600 font-medium">{Math.round(sectionMeasuredHeight)}px</span>
            </div>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 스타일 탭 — 선택된 섹션의 배경색/높이 편집 + 디자인 팔레트
// ─────────────────────────────────────────────


export { PropertiesTab };
