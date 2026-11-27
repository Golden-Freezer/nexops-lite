'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/clerk-shim';
import { useEditorStore, selectSelectedSectionId, selectSections } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { useLayoutStore, selectActiveCategory } from '@/lib/registration/editor/stores/layoutStore';
import { loadLayoutPresets } from '@/lib/registration/editor/data/layouts';
import { applyLayoutPreset, type PresetApplyMode } from '@/lib/registration/editor/utils/applyLayoutPreset';
import { getLayoutOnlySupport } from '@/lib/registration/editor/utils/presetCompatibility';
import { restoreInitialSection } from '@/lib/registration/editor/utils/restoreInitialSection';
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument';
import { fetchEditorData } from '@/lib/registration/editor/services/editorApi';
import { toast } from '@/components/features/registration/editor/ui/Toast';
import { confirmDialog } from '@/components/features/registration/editor/ui/ConfirmDialog';
import PresetPreviewPopover from './PresetPreviewPopover';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { LayoutCategory, LayoutPreset, LayoutElementSlot } from '@/lib/registration/editor/types/layout';
import type { ProSectionType } from '@/lib/registration/editor/types/section';

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────

// 패널 280px / p-3(12px) 양쪽 = 256px / 2열 + gap-2(8px) → 열 1개 = 124px
const CANVAS_SOURCE_WIDTH = 860;
const EMPTY_PRESETS: LayoutPreset[] = [];
const CARD_PREVIEW_WIDTH = 124;
const SCALE = CARD_PREVIEW_WIDTH / CANVAS_SOURCE_WIDTH; // ≈ 0.1442
const PREVIEW_HEIGHT = 90; // 고정 미리보기 높이 (px)
const PRESET_APPLY_MODE_STORAGE_KEY = 'nexops-editor-preset-apply-mode';

const CATEGORIES: { id: LayoutCategory | null; label: string }[] = [
  { id: null,           label: '전체' },
  { id: 'minimal',      label: 'minimal' },
  { id: 'bold',         label: 'bold' },
  { id: 'image_first',  label: 'image_first' },
  { id: 'split',        label: 'split' },
  { id: 'overlay',      label: 'overlay' },
  { id: 'gradient',     label: 'gradient' },
  { id: 'card',         label: 'card' },
  { id: 'full_bleed',   label: 'full_bleed' },
  { id: 'stacked',      label: 'stacked' },
  { id: 'dynamic',      label: 'dynamic' },
];

// ─────────────────────────────────────────────
// LayoutLibrary
// ─────────────────────────────────────────────

export default function LayoutLibrary() {
  const { getToken } = useAuth();
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [isRestoringAll, setIsRestoringAll] = useState<boolean>(false);
  const [presetApplyMode, setPresetApplyMode] = useState<PresetApplyMode>(() => {
    if (typeof window === 'undefined') return 'full';
    const stored = window.localStorage.getItem(PRESET_APPLY_MODE_STORAGE_KEY);
    return stored === 'placement-only' || stored === 'full' ? stored : 'full';
  });
  const [previewState, setPreviewState] = useState<{
    presetId: string;
    section: CanvasSection;
    anchorRect: { top: number; left: number };
    presetName: string;
  } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doc               = useEditorStore((s) => s.document);
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const sections         = useEditorStore(selectSections);
  const updateSection    = useEditorStore((s) => s.updateSection);
  const commitHistory    = useCanvasStore((s) => s.commitHistory);

  const loadPresetsAction    = useLayoutStore((s) => s.loadPresets);
  const filterByCategoryFn   = useLayoutStore((s) => s.filterByCategory);
  const selectPresetAction   = useLayoutStore((s) => s.selectPreset);
  const activeCategory       = useLayoutStore(selectActiveCategory);
  const isLoading            = useLayoutStore((s) => s.isLoading);

  const selectedSection  = sections.find((s) => s.id === selectedSectionId) ?? null;
  const sectionType      = selectedSection?.sectionType as ProSectionType | undefined;
  const baselineSection  = selectedSection
    ? doc?.initialBaseline?.sections.find((section) => section.id === selectedSection.id) ??
      doc?.initialBaseline?.sections.find(
        (section) => section.sectionType === selectedSection.sectionType,
      )
    : undefined;

  // 로드 중인 sectionType 추적 — store 업데이트 실패 시 무한 재시도 방지
  const pendingLoadRef = useRef<Set<string>>(new Set());

  // sectionType에 대한 안정적인 셀렉터
  const isLoaded = useLayoutStore(
    useCallback((s) => !!s.loadedSections[sectionType ?? ''], [sectionType]),
  );
  const allPresets = useLayoutStore(
    useCallback((s) => s.presets[sectionType ?? ''] ?? EMPTY_PRESETS, [sectionType]),
  );
  // filteredPresets: useMemo로 안정적인 참조 유지 (Zustand 셀렉터에서 .filter()를 호출하면
  // 매 store 업데이트마다 새 배열 참조를 반환해 React #185 무한 루프 발생)
  const filteredPresets = useMemo(
    () => (!activeCategory ? allPresets : allPresets.filter((p) => p.category === activeCategory)),
    [allPresets, activeCategory],
  );
  const currentPresetId = useLayoutStore(
    useCallback(
      (s) =>
        s.selectedPresetId[selectedSectionId ?? ''] ??
        (selectedSection?.layoutId ?? null),
      [selectedSectionId, selectedSection?.layoutId],
    ),
  );

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current === null) return;
    clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    clearPreviewTimer();
    setPreviewState(null);
  }, [clearPreviewTimer]);

  const schedulePresetPreview = useCallback(
    (preset: LayoutPreset, anchorRect: { top: number; left: number }) => {
      clearPreview();
      if (!selectedSection) return;

      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        const cloned = JSON.parse(JSON.stringify(selectedSection)) as CanvasSection;
        cloned.id = 'preview-' + selectedSection.id;
        const palette = useEditorStore.getState().document?.sourceData?.designPalette ?? null;
        const section = applyLayoutPreset(cloned, preset, palette, { mode: presetApplyMode });
        setPreviewState({
          presetId: preset.id,
          section,
          anchorRect,
          presetName: preset.name,
        });
      }, 250);
    },
    [clearPreview, presetApplyMode, selectedSection],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PRESET_APPLY_MODE_STORAGE_KEY, presetApplyMode);
  }, [presetApplyMode]);

  useEffect(() => {
    clearPreview();
  }, [selectedSectionId, presetApplyMode, clearPreview]);

  useEffect(
    () => () => {
      clearPreviewTimer();
    },
    [clearPreviewTimer],
  );

  // 섹션 타입이 변경되면 프리셋 로드
  useEffect(() => {
    if (!sectionType || isLoaded) return;
    // store 업데이트 실패로 isLoaded가 false인 채 남아 있는 경우 무한 재시도 방지
    if (pendingLoadRef.current.has(sectionType)) return;
    pendingLoadRef.current.add(sectionType);

    loadLayoutPresets(sectionType)
      .then((presets) => {
        try {
          loadPresetsAction(sectionType, presets);
        } catch (storeErr) {
          console.warn(`[LayoutLibrary] layoutStore.loadPresets 실패 (${sectionType}):`, storeErr);
        }
      })
      .catch((err) => {
        console.warn(`[LayoutLibrary] 프리셋 로드 실패 (${sectionType}):`, err);
        // 에러 시에도 로드 완료 처리 → 무한 로딩 방지
        try {
          loadPresetsAction(sectionType, []);
        } catch (storeErr) {
          console.warn(`[LayoutLibrary] layoutStore fallback 실패 (${sectionType}):`, storeErr);
        }
      })
      .finally(() => {
        pendingLoadRef.current.delete(sectionType);
      });
  }, [sectionType, isLoaded, loadPresetsAction]);

  // 문서 전체 작업 블록 — early return(미선택 등)과 메인 패널 양쪽에서 재사용해
  // 섹션 선택 여부와 무관하게 항상 노출한다. (핸들러는 함수 선언 → 호이스팅되어 참조 안전)
  const docWideActions = (
    <div className="px-2.5 pt-2.5 pb-2.5 shrink-0 border-b border-[var(--border-subtle)]">
      <span className="text-[10px] font-medium text-[var(--text-secondary)]">문서 전체</span>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <button
          onClick={handleWhitenAllBackgrounds}
          className="py-1.5 rounded-md text-[11px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--editor-brand)] hover:text-[var(--editor-brand)] transition-colors"
          title="모든 섹션 배경을 흰색으로 바꿉니다 (Ctrl+Z로 되돌리기)"
        >
          배경 모두 흰색
        </button>
        <button
          onClick={handleRestoreAllToInitial}
          disabled={!doc?.initialBaseline || isRestoringAll}
          className="py-1.5 rounded-md text-[11px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] enabled:hover:border-[var(--editor-brand)] enabled:hover:text-[var(--editor-brand)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={doc?.initialBaseline ? '모든 섹션을 처음 생성된 디자인으로 되돌립니다 (콘텐츠 유지)' : '초기 스냅샷이 없는 문서입니다'}
        >
          {isRestoringAll ? '복원 중…' : '전체 초기 복원'}
        </button>
      </div>
    </div>
  );

  // ── 빈 상태: 섹션 미선택 ──
  if (!selectedSectionId || !selectedSection) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {docWideActions}
        <EmptyState
          icon="🗂️"
          message="섹션을 선택하면 레이아웃을 변경할 수 있습니다."
        />
      </div>
    );
  }

  // ── sectionType 없음: 로딩 아닌 준비 중 상태 ──
  if (!sectionType) {
    return (
      <EmptyState
        icon="🛠️"
        message="이 섹션의 레이아웃 프리셋은 준비 중입니다."
      />
    );
  }

  // ── 로딩 중 (sectionType이 있을 때만 스피너 표시) ──
  if (!isLoaded || isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-5 h-5 rounded-full border-2 border-[var(--editor-brand-tint)] border-t-[var(--editor-brand)] animate-spin" />
      </div>
    );
  }

  // ── 프리셋 없음 ──
  if (allPresets.length === 0) {
    return (
      <EmptyState
        icon="🛠️"
        message="이 섹션의 레이아웃 프리셋은 준비 중입니다."
      />
    );
  }

  // AI 정돈(레이아웃 미세조정 LLM 콜)은 재생성 백엔드와 함께 Phase 4

  async function handleRestore() {
    if (!selectedSection || !selectedSectionId || !doc || isRestoring) return;

    if (baselineSection) {
      const restored = restoreInitialSection(selectedSection, baselineSection);
      updateSection(selectedSectionId, restored);
      const afterSections = useEditorStore.getState().document?.sections;
      if (afterSections) commitHistory('초기 디자인 복원', afterSections);
      toast.success('초기 디자인을 복원했습니다 — Ctrl+Z로 되돌릴 수 있습니다');
      return;
    }

    setIsRestoring(true);
    try {
      const confirmed = await confirmDialog({
        title: '이 섹션을 다시 생성할까요?',
        message:
          '초기 스냅샷이 없는 문서입니다. 현재 생성 규칙으로 섹션을 다시 만들며,\n' +
          '이 섹션의 텍스트·이미지 편집 내용이 원본으로 되돌아갑니다.',
        confirmLabel: '재구성',
        danger: true,
      });
      if (!confirmed) return;

      const token = (await getToken()) ?? '';
      const result = await fetchEditorData(doc.pdpId, token);
      const rebuilt = await buildEditorDocument(doc.pdpId, {
        ...result,
        is_new: true,
        sections_data: [],
      });
      const rebuiltSection = rebuilt.sections.find(
        (section) => section.sectionType === selectedSection.sectionType,
      );
      if (!rebuiltSection) {
        toast.error('이 섹션은 재구성할 수 없습니다');
        return;
      }

      updateSection(selectedSectionId, { ...rebuiltSection, id: selectedSection.id });
      const afterSections = useEditorStore.getState().document?.sections;
      if (afterSections) commitHistory('생성 규칙으로 재구성', afterSections);
      toast.success('현재 생성 규칙으로 섹션을 재구성했습니다');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '섹션 재구성에 실패했습니다.');
    } finally {
      setIsRestoring(false);
    }
  }

  // 문서 전체: 모든 섹션 배경을 흰색으로 — Ctrl+Z 또는 '전체 초기 복원'으로 되돌리기 가능
  function handleWhitenAllBackgrounds() {
    const document = useEditorStore.getState().document;
    if (!document || document.sections.length === 0) return;
    for (const s of document.sections) {
      updateSection(s.id, { ...s, canvas: { ...s.canvas, backgroundColor: '#FFFFFF' } });
    }
    const after = useEditorStore.getState().document?.sections;
    if (after) commitHistory('섹션 배경 모두 흰색', after);
    toast.success('모든 섹션 배경을 흰색으로 변경했습니다 — Ctrl+Z로 되돌릴 수 있습니다');
  }

  // 문서 전체: 모든 섹션을 초기 생성 디자인으로 복원 (콘텐츠 유지). baseline id로만 매칭 —
  // 캡처 id는 안정적이므로 sectionType 폴백의 중복 충돌을 피한다.
  async function handleRestoreAllToInitial() {
    const document = useEditorStore.getState().document;
    const baseline = document?.initialBaseline;
    if (!document || !baseline || isRestoringAll) return;
    const confirmed = await confirmDialog({
      title: '전체를 초기 디자인으로 되돌릴까요?',
      message:
        '모든 섹션의 배치·색·배경을 처음 생성된 상태로 되돌립니다.\n' +
        '현재 텍스트·이미지 편집 내용은 유지됩니다.',
      confirmLabel: '되돌리기',
    });
    if (!confirmed) return;
    setIsRestoringAll(true);
    try {
      const baseById = new Map(baseline.sections.map((b) => [b.id, b]));
      for (const s of document.sections) {
        const base = baseById.get(s.id);
        if (base) updateSection(s.id, restoreInitialSection(s, base));
      }
      const after = useEditorStore.getState().document?.sections;
      if (after) commitHistory('전체 초기 디자인 복원', after);
      toast.success('전체를 초기 디자인으로 복원했습니다 — Ctrl+Z로 되돌릴 수 있습니다');
    } finally {
      setIsRestoringAll(false);
    }
  }

  async function handlePresetClick(preset: LayoutPreset) {
    clearPreview();
    if (!selectedSection || !selectedSectionId) return;

    if (presetApplyMode === 'placement-only') {
      const layoutOnlySupport = getLayoutOnlySupport(preset);
      if (layoutOnlySupport === 'unsupported') {
        toast.error('이 레이아웃은 배치만 적용을 지원하지 않습니다');
        return;
      }
      if (layoutOnlySupport === 'preview-required') {
        // 다음 작업의 미리보기 기능 도입 전까지 대비 위험을 확인창으로 안내한다.
        const confirmed = await confirmDialog({
          title: '배치만 적용이 불안정할 수 있습니다',
          message: '이 레이아웃은 이미지 위에 텍스트를 얹는 구성이라\n기존 글자 색을 유지하면 읽기 어려울 수 있습니다. 적용할까요?',
          confirmLabel: '적용',
        });
        if (!confirmed) return;
      }
    }

    // 트랙 C-3: 프리셋 배경 {{palette.*}} 토큰을 브랜드 팔레트로 해석
    const palette = useEditorStore.getState().document?.sourceData?.designPalette ?? null;
    const updated = applyLayoutPreset(selectedSection, preset, palette, { mode: presetApplyMode });
    updateSection(selectedSectionId, updated);
    selectPresetAction(selectedSectionId, preset.id);

    // 교체 직후 post 스냅샷 (updateSection은 연속 입력원이 있어 자동 기록하지 않음 — H3 통일 모델)
    const afterSections = useEditorStore.getState().document?.sections;
    if (afterSections) {
      const historyLabel =
        presetApplyMode === 'placement-only'
          ? `레이아웃 교체(배치만): ${preset.name}`
          : `레이아웃 교체: ${preset.name}`;
      commitHistory(historyLabel, afterSections);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {docWideActions}
      {/* 프리셋 적용 범위 */}
      <div className="px-2.5 pt-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">적용 범위</span>
          <div className="flex p-0.5 rounded-md border border-[var(--border-default)] bg-[var(--editor-canvas-bg)]">
            {([
              ['placement-only', '배치만'],
              ['full', '배치+스타일'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setPresetApplyMode(mode)}
                className={[
                  'px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap',
                  presetApplyMode === mode
                    ? 'bg-[var(--surface-base)] text-[var(--editor-brand)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {presetApplyMode === 'placement-only' && (
          <p className="mt-1 text-[10px] text-[var(--text-disabled)]">
            글자 색·크기 등 스타일은 유지됩니다.
          </p>
        )}
      </div>


      {/* 카테고리 필터 칩 */}
      <div className="p-2.5 border-b border-[var(--border-subtle)] overflow-x-auto shrink-0">
        <div className="flex gap-1.5 min-w-max">
          {CATEGORIES.map(({ id, label }) => (
            <button
              key={label}
              onClick={() => filterByCategoryFn(id)}
              className={[
                'px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap',
                activeCategory === id
                  ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 프리셋 그리드 */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredPresets.length === 0 ? (
          <p className="text-[11px] text-[var(--text-disabled)] text-center pt-6">
            해당 카테고리의 프리셋이 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredPresets.map((preset) => {
              const layoutOnlySupport =
                presetApplyMode === 'placement-only'
                  ? getLayoutOnlySupport(preset)
                  : 'safe';
              return (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  isActive={currentPresetId === preset.id}
                  isDisabled={layoutOnlySupport === 'unsupported'}
                  showWarning={layoutOnlySupport === 'preview-required'}
                  onClick={() => {
                    void handlePresetClick(preset);
                  }}
                  onPreviewStart={(anchorRect) => {
                    schedulePresetPreview(preset, anchorRect);
                  }}
                  onPreviewEnd={clearPreview}
                />
              );
            })}
          </div>
        )}
      </div>
      {/* 초기 디자인 복원 / 구문서 재구성 */}
      {selectedSection && (
        <div className="px-2.5 pb-2.5 shrink-0">
          <button
            onClick={handleRestore}
            disabled={isRestoring}
            className={[
              'w-full py-1.5 rounded-md text-[11px] font-semibold border transition-colors',
              isRestoring
                ? 'border-[var(--border-default)] text-[var(--text-disabled)] cursor-wait'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--editor-brand)] hover:text-[var(--editor-brand)] hover:bg-[var(--brand-primary-tint)]',
            ].join(' ')}
            title={
              baselineSection
                ? '현재 콘텐츠를 유지하고 최초 디자인으로 복원합니다'
                : '파이프라인 원본에서 현재 생성 규칙으로 섹션을 다시 만듭니다'
            }
          >
            {isRestoring
              ? '재구성 중…'
              : baselineSection
                ? '초기 디자인 복원'
                : '생성 규칙으로 재구성'}
          </button>
        </div>
      )}
      {previewState && (
        <PresetPreviewPopover
          key={previewState.presetId}
          previewSection={previewState.section}
          presetName={previewState.presetName}
          mode={presetApplyMode}
          anchorRect={previewState.anchorRect}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PresetCard — 미니어처 미리보기 카드
// ─────────────────────────────────────────────

interface PresetCardProps {
  preset: LayoutPreset;
  isActive: boolean;
  isDisabled: boolean;
  showWarning: boolean;
  onClick: () => void;
  onPreviewStart: (anchorRect: { top: number; left: number }) => void;
  onPreviewEnd: () => void;
}

function PresetCard({
  preset,
  isActive,
  isDisabled,
  showWarning,
  onClick,
  onPreviewStart,
  onPreviewEnd,
}: PresetCardProps) {
  const bgStyle = getBackgroundStyle(preset);

  return (
    <button
      onClick={onClick}
      onMouseEnter={(event) => {
        if (isDisabled) return;
        const { top, left } = event.currentTarget.getBoundingClientRect();
        onPreviewStart({ top, left });
      }}
      onMouseLeave={onPreviewEnd}
      onFocus={(event) => {
        if (isDisabled) return;
        const { top, left } = event.currentTarget.getBoundingClientRect();
        onPreviewStart({ top, left });
      }}
      onBlur={onPreviewEnd}
      disabled={isDisabled}
      title={`${preset.name} (${preset.category})`}
      className={[
        'rounded-lg border-2 overflow-hidden transition-all text-left w-full',
        isActive
          ? 'border-[var(--editor-brand)] ring-1 ring-[var(--editor-brand)]'
          : isDisabled
            ? 'border-[var(--border-default)]'
            : 'border-[var(--border-default)] hover:border-[var(--editor-brand)]',
        isDisabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {/* 미니어처 미리보기 */}
      <div
        className="relative overflow-hidden"
        style={{ height: PREVIEW_HEIGHT, ...bgStyle }}
      >
        {showWarning && (
          <span className="absolute right-1 top-1 z-10 rounded border border-amber-200 bg-amber-100 px-1 py-0.5 text-[9px] font-semibold leading-none text-amber-700">
            주의
          </span>
        )}
        {/* 860px 원본 → scale 축소 렌더링 */}
        <div
          className="absolute top-0 left-0"
          style={{
            width: CANVAS_SOURCE_WIDTH,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
          }}
        >
          {preset.structure.elements.map((slot) => (
            <SlotMiniature key={slot.slotId} slot={slot} />
          ))}
        </div>
      </div>

      {/* 레이블 */}
      <div className="px-1.5 py-1 bg-[var(--surface-base)]">
        <p className="text-[10px] font-medium text-[var(--text-primary)] truncate leading-tight">
          {preset.name}
        </p>
        <span className="text-[9px] text-[var(--text-disabled)] leading-none">{preset.category}</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────
// SlotMiniature — 단일 슬롯 미니어처 사각형
// ─────────────────────────────────────────────

function SlotMiniature({ slot }: { slot: LayoutElementSlot }) {
  const h = typeof slot.position.height === 'number' ? slot.position.height : 60;

  const colorClass =
    slot.elementType === 'image'
      ? 'bg-blue-100 border border-blue-200'
      : slot.elementType === 'badge'
        ? 'bg-purple-100 border border-purple-200'
        : slot.elementType === 'card_group'
          ? 'bg-green-50 border border-green-200'
          : 'bg-gray-200'; // text / table / etc.

  return (
    <div
      className={`absolute rounded-sm ${colorClass}`}
      style={{
        left: slot.position.x,
        top: slot.position.y,
        width: slot.position.width,
        height: h,
      }}
    />
  );
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function getBackgroundStyle(preset: LayoutPreset): React.CSSProperties {
  const { type, value } = preset.structure.background;
  if (type === 'solid') return { backgroundColor: value };
  if (type === 'gradient') return { background: value };
  return { backgroundColor: '#f3f4f6' };
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--text-disabled)]">
      <span className="text-3xl">{icon}</span>
      <p className="text-xs leading-relaxed">{message}</p>
    </div>
  );
}
