'use client';

import { Eye, EyeOff, Layers, FileText, ChevronDown, ChevronUp, ChevronsLeft, Plus, Trash2, Sparkles, MessageCircle, Star, Puzzle, ImagePlus } from 'lucide-react';
import { useState } from 'react';
import {
  useEditorStore,
  selectSections,
  selectSelectedSectionId,
  selectStrategyContract,
  selectDerivativePreview,
  selectRegenAddable,
} from '@/lib/registration/editor/stores/editorStore';
import { SECTION_GROUP_MAP } from '@/lib/registration/editor/constants/sectionConfig';
import { filterSectionsByDerivative } from '@/lib/registration/editor/utils/exportUtils';
import { getSectionLabel } from '@/lib/registration/editor/utils/sectionConverter';
import { LONG_SECTION_TITLE } from '@/lib/registration/long-sections';
import { expansionState } from '@/lib/registration/editor/utils/keepCore';
import type { ProSectionType } from '@/lib/registration/editor/types/section';
import SectionPickerModal from './SectionPickerModal';

const GROUP_LABELS: Record<string, string> = {
  hook:    '초반 구성',
  problem: '본문 시작',
  usp:     '핵심 USP',
  modules: '파트 옵션',
};

const GROUP_COLORS: Record<string, string> = {
  hook:    'bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  problem: 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  usp:     'bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  modules: 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
};

const GROUP_ICONS: Record<string, React.ElementType> = {
  hook:    Sparkles,
  problem: MessageCircle,
  usp:     Star,
  modules: Puzzle,
};

export default function LeftPanel() {
  const sections           = useEditorStore(selectSections);
  const selectedSectionId  = useEditorStore(selectSelectedSectionId);
  const selectSection      = useEditorStore((s) => s.selectSection);
  const strategyContract   = useEditorStore(selectStrategyContract);
  const derivativePreview  = useEditorStore(selectDerivativePreview);
  const setExpansionsVisible = useEditorStore((s) => s.setExpansionsVisible);
  const removeExpansions   = useEditorStore((s) => s.removeExpansions);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 확장 섹션 지우기는 두 번 눌러 확인한다(브라우저 확인 창 없이) — 다시 열면 되돌릴 수 없다
  const [confirmRemove, setConfirmRemove] = useState(false);
  const expansions = expansionState(sections);
  // 좌측 패널 접기 — 240px 고정으로 닫을 수 없어 좁은 화면에서 캔버스가 압박되던 문제
  const [collapsed, setCollapsed] = useState(false);

  // 파생본 모드일 때 필터링된 섹션 목록
  const displaySections = derivativePreview && derivativePreview !== 'master'
    ? filterSectionsByDerivative(sections, derivativePreview as 'quick' | 'standard' | 'persuasive')
    : sections;

  const visibleCount = displaySections.filter((s) => s.sectionType !== 'divider').length;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center w-9 py-2 bg-[var(--surface-base)] border-r border-[var(--border-default)] shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded hover:bg-[var(--hover-overlay)] text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
          title="섹션 패널 펼치기"
          aria-label="섹션 패널 펼치기"
        >
          <Layers size={16} />
        </button>
        <span className="mt-1 text-[10px] text-[var(--text-disabled)]">{visibleCount}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-60 bg-[var(--surface-base)] border-r border-[var(--border-default)] shrink-0 overflow-hidden shadow-[-2px_0_8px_rgba(0,0,0,0.04)]">
      {/* 전략 계약 요약 패널 */}
      {strategyContract && <StrategyPanel contract={strategyContract} />}

      {/* 섹션 헤더 */}
      <div className="flex items-center h-10 px-3 border-b border-[var(--border-default)] shrink-0">
        <Layers size={14} className="text-[var(--text-disabled)] mr-1.5" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">섹션</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-disabled)]">{visibleCount}개</span>
          <button
            onClick={() => setPickerOpen(true)}
            className="p-0.5 rounded hover:bg-[var(--editor-brand-tint)] text-[var(--text-disabled)] hover:text-[var(--editor-brand)] transition-colors"
            title="섹션 추가"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="p-0.5 rounded hover:bg-[var(--hover-overlay)] text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            title="섹션 패널 접기"
            aria-label="섹션 패널 접기"
          >
            <ChevronsLeft size={14} />
          </button>
        </span>
      </div>

      {/* 긴 상세페이지 '핵심만 남기기' — 확장 섹션을 한꺼번에 숨기거나 다시 보이고(되돌리기 한 번), 두 번 눌러 지운다 */}
      {expansions.count > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-default)] shrink-0">
          <span className="text-[10px] text-[var(--text-disabled)] whitespace-nowrap">
            확장 {expansions.count}개{expansions.visible === 0 ? ' · 숨김' : ''}
          </span>
          <button
            onClick={() => setExpansionsVisible(expansions.visible === 0)}
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors whitespace-nowrap"
            title={
              expansions.visible > 0
                ? '확장 섹션을 모두 숨긴다(Ctrl+Z로 되돌리기)'
                : '숨긴 확장 섹션을 모두 다시 보인다'
            }
          >
            {expansions.visible > 0 ? '핵심만 남기기' : '확장 다시 보이기'}
          </button>
          <button
            onClick={() => {
              if (!confirmRemove) return setConfirmRemove(true);
              removeExpansions();
              setConfirmRemove(false);
            }}
            onMouseLeave={() => setConfirmRemove(false)}
            onBlur={() => setConfirmRemove(false)}
            className={`text-[10px] px-1 py-0.5 rounded transition-colors whitespace-nowrap ${
              confirmRemove ? 'bg-red-50 text-red-600' : 'text-[var(--text-disabled)] hover:text-red-500'
            }`}
            title="확장 섹션을 모두 지운다 — Ctrl+Z 되돌리기는 이 편집 중(최근 50단계)에만, 다시 열면 되돌릴 수 없다"
            aria-label={confirmRemove ? '한 번 더 누르면 확장 섹션을 지운다' : '확장 섹션 지우기'}
          >
            {confirmRemove ? '다시 눌러 지우기' : <Trash2 size={12} />}
          </button>
        </div>
      )}

      {/* 섹션 추가 모달 */}
      <SectionPickerModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} />

      {/* 섹션 목록 */}
      <div className="flex-1 overflow-y-auto">
        <SectionList
          sections={displaySections}
          selectedId={selectedSectionId}
          onSelect={selectSection}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// V4.3: 전략 계약 요약 패널
// ─────────────────────────────────────────────
import type { StrategyContract } from '@/lib/registration/editor/stores/editorStore';

const INVOLVEMENT_LABEL: Record<string, string> = { high: '고관여', low: '저관여' };
const AXIS_LABEL: Record<string, string>        = { emotion: '감성형', function: '기능형', balanced: '균형형' };
const HOOK_LABEL: Record<string, string>        = { shock: '충격형', curiosity: '호기심', proof: '증거형', empathy: '공감형', authority: '권위형' };
const REVIEW_LABEL: Record<string, string>      = { front: '앞배치', middle: '중간', back: '뒤배치', dynamic: '동적' };
const SOLDOUT_LABEL: Record<string, string>     = { front: '앞배치', none: '없음', dynamic: '동적' };
const PAGE_LABEL: Record<string, string>        = { test: '테스트', standard: '표준', conversion_max: '전환 극대화' };

function StrategyPanel({ contract }: { contract: StrategyContract }) {
  const [collapsed, setCollapsed] = useState(false);

  const rows: [string, string | undefined][] = [
    ['관여도', contract.involvement_level ? INVOLVEMENT_LABEL[contract.involvement_level] : undefined],
    ['설득축', contract.persuasion_axis ? AXIS_LABEL[contract.persuasion_axis] : undefined],
    ['후킹', contract.hook_mode ? HOOK_LABEL[contract.hook_mode] : undefined],
    ['리뷰위치', contract.review_position_strategy ? REVIEW_LABEL[contract.review_position_strategy] : undefined],
    ['완판위치', contract.soldout_position_strategy ? SOLDOUT_LABEL[contract.soldout_position_strategy] : undefined],
    ['페이지목적', contract.page_goal ? PAGE_LABEL[contract.page_goal] : undefined],
  ].filter(([, v]) => v !== undefined) as [string, string][];

  if (rows.length === 0) return null;

  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--brand-primary-tint)]">
      <button
        className="flex items-center w-full px-3 py-2 gap-1.5 text-[11px] font-medium text-[var(--editor-brand)] hover:bg-[var(--editor-brand-tint)] transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <FileText size={12} />
        <span>전략 계약 요약</span>
        <span className="ml-auto">{collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 space-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between text-[10px]">
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="text-[var(--editor-brand)] font-medium">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 섹션 목록 (DnD + 가시성 토글 포함)
// ─────────────────────────────────────────────

interface SectionListProps {
  sections: ReturnType<typeof selectSections>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function SectionList({ sections, selectedId, onSelect }: SectionListProps) {
  const reorderSections = useEditorStore((s) => s.reorderSections);
  const toggleSectionVisibility = useEditorStore((s) => s.toggleSectionVisibility);
  const removeSection   = useEditorStore((s) => s.removeSection);
  // 사진 없는 섹션(수동 추가)에 AI 새 컷 만들기 — 가능한 섹션은 Canvas 재생성 훅이 잡 기록으로 계산해 둔다(W5b)
  const regenAddable    = useEditorStore(selectRegenAddable);
  const setRegenTarget  = useEditorStore((s) => s.setRegenTarget);

  // DnD 상태
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropAbove, setDropAbove] = useState<boolean>(true);

  if (sections.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-disabled)] text-center leading-relaxed">
        섹션이 없습니다.<br />PDP를 불러오면<br />섹션이 표시됩니다.
      </div>
    );
  }

  // AI가 결정한 섹션 순서(section.order) 그대로 정렬 — 그룹별 고정 순서 대신 실제 페이지 순서 반영
  const sorted = [...sections]
    .filter((s) => s.sectionType !== 'divider')
    .sort((a, b) => a.order - b.order);

  // ── DnD 핸들러 ──────────────────────────────

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

    const allSorted = [...sections].sort((a, b) => a.order - b.order);
    const ids = allSorted.map((s) => s.id);

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

    // 히스토리는 reorderSections 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
    reorderSections(newIds);

    setDragId(null);
    setDragOverId(null);
  }

  function handleContainerDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverId(null);
    }
  }

  return (
    <div className="py-2" onDragLeave={handleContainerDragLeave}>
      {/* AI가 결정한 순서대로 섹션 표시 (그룹 헤더 없이 순서 그대로) */}
      {sorted.map((section) => {
        const group = SECTION_GROUP_MAP[section.sectionType as ProSectionType] ?? 'modules';
        const isBeingDragged = dragId === section.id;
        const isDropTarget   = dragOverId === section.id && dragId !== section.id;
        const isSelected     = section.id === selectedId;

        return (
          <div
            key={section.id}
            className="relative group/item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              handleDragStart(section.id);
            }}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, section.id)}
            onDrop={(e) => handleDrop(e, section.id)}
          >
            {/* 드롭 위 구분선 */}
            {isDropTarget && dropAbove && (
              <span className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--editor-brand)] z-10 pointer-events-none" />
            )}

            <div
              className={[
                'flex items-center px-3 py-2 gap-2 text-xs transition-colors',
                isSelected ? 'bg-[var(--brand-primary-tint)]' : 'hover:bg-[var(--hover-overlay)]',
                section.isPlaceholder ? 'border-l-2 border-dashed border-amber-400' : '',
              ].join(' ')}
              style={{
                opacity: isBeingDragged ? 0.5 : !section.isVisible ? 0.4 : undefined,
              }}
            >
              {/* 드래그 핸들 */}
              <span className="text-[var(--text-disabled)] select-none cursor-grab active:cursor-grabbing shrink-0 text-[10px] leading-none">
                ⠿
              </span>

              {/* 섹션 선택 영역 */}
              <button
                onClick={() => {
                  const newId = section.id === selectedId ? null : section.id;
                  onSelect(newId);
                  if (newId) {
                    window.dispatchEvent(new CustomEvent('nexops:scroll-to-section', { detail: newId }));
                  }
                }}
                className={[
                  'flex items-center gap-1.5 flex-1 min-w-0 text-left',
                  isSelected ? 'text-[var(--editor-brand)] font-medium' : 'text-[var(--text-secondary)]',
                ].join(' ')}
              >
                {/* 그룹 뱃지 (작게) */}
                {(() => {
                  const Icon = GROUP_ICONS[group];
                  return (
                    <span className={`inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded shrink-0 ${GROUP_COLORS[group]}`}>
                      {Icon && <Icon size={9} className="text-[var(--brand-primary)]" />}
                      {GROUP_LABELS[group]}
                    </span>
                  );
                })()}
                {/* 긴 상세페이지 확장 섹션은 스펙 표 빌더로 지어 유형 이름 대신 제목(크기·구성 등)과 '확장' 뱃지를 보인다 */}
                <span className="truncate">
                  {section.expansion ? LONG_SECTION_TITLE[section.expansion] : getSectionLabel(section.sectionType)}
                </span>
                {section.expansion && (
                  <span className="text-[8px] px-1 py-px rounded bg-sky-100 text-sky-700 shrink-0" title="긴 상세페이지 확장 섹션">
                    확장
                  </span>
                )}
                {section.isPlaceholder && (
                  <span className="text-[8px] px-1 py-px rounded bg-amber-100 text-amber-600 shrink-0">
                    플레이스홀더
                  </span>
                )}
              </button>

              {/* AI 새 컷 만들기 (사진 없는 섹션 — 그 섹션 키의 컷이 아직 없을 때만) */}
              {regenAddable[section.id] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRegenTarget({ sectionId: section.id });
                  }}
                  className="text-[var(--editor-brand)] hover:opacity-80 shrink-0"
                  title="AI로 이 섹션 사진 만들기"
                  aria-label="AI로 이 섹션 사진 만들기"
                >
                  <ImagePlus size={12} />
                </button>
              )}

              {/* 삭제 버튼 (플레이스홀더 섹션 또는 호버 시) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeSection(section.id);
                }}
                className="text-[var(--text-disabled)] hover:text-red-500 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
                title="섹션 삭제"
              >
                <Trash2 size={12} />
              </button>

              {/* 가시성 토글 — 되돌리기 기록을 남긴다(일괄 '핵심만 남기기'와 섞여도 Ctrl+Z가 한 단계씩 되돌린다) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSectionVisibility(section.id);
                }}
                className="text-[var(--text-disabled)] hover:text-[var(--text-secondary)] shrink-0"
                title={section.isVisible ? '숨기기' : '표시'}
              >
                {section.isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>

            {/* 드롭 아래 구분선 */}
            {isDropTarget && !dropAbove && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--editor-brand)] z-10 pointer-events-none" />
            )}
          </div>
        );
      })}
    </div>
  );
}
