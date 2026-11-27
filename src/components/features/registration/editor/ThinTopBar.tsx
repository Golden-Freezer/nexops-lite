'use client';

import { useRouter } from 'next/navigation';
import {
  Save,
  Download,
  Loader2,
  Check,
  AlertTriangle,
  Plus,
  LayoutDashboard,
  ImageIcon,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import {
  useEditorStore,
  selectIsDirty,
  selectSaveStatus,
  selectDocument,
  selectDerivativePreview,
  selectSections,
} from '@/lib/registration/editor/stores/editorStore';
import type { DerivativePreviewMode } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore, selectCanUndo, selectCanRedo } from '@/lib/registration/editor/stores/canvasStore';
import { filterSectionsByDerivative } from '@/lib/registration/editor/utils/exportUtils';
import ExportMenu from './ExportMenu';

interface ThinTopBarProps {
  pdpId: string;
  onExportAllImages: () => void;
  imageExporting: boolean;
}

export default function ThinTopBar({ pdpId, onExportAllImages, imageExporting }: ThinTopBarProps) {
  const router = useRouter();
  const isDirty = useEditorStore(selectIsDirty);
  const saveStatus = useEditorStore(selectSaveStatus);
  const requestSave = useEditorStore((s) => s.requestSave);
  const editorDoc = useEditorStore(selectDocument);
  const derivativePreview = useEditorStore(selectDerivativePreview);
  const setDerivativePreview = useEditorStore((s) => s.setDerivativePreview);
  const sections = useEditorStore(selectSections);
  // undo/redo — FloatingPill(드래그 이동 가능)에만 있으면 발견성이 낮아 상단바에도 상시 노출
  const canUndo = useCanvasStore(selectCanUndo);
  const canRedo = useCanvasStore(selectCanRedo);
  const undoDocument = useEditorStore((s) => s.undoDocument);
  const redoDocument = useEditorStore((s) => s.redoDocument);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportAreaRef = useRef<HTMLDivElement>(null);

  // 다크 토글은 제거 — editor-theme.css에 다크 변형이 없고(Phase 4), html.dark 토글이
  // 에디터 이탈 후 대시보드 전역을 다크로 오염시키는 부작용이 있었다(verifier 적발).

  const filteredCount = derivativePreview && derivativePreview !== 'master'
    ? filterSectionsByDerivative(sections, derivativePreview as 'quick' | 'standard' | 'persuasive')
        .filter((s) => s.sectionType !== 'divider').length
    : null;

  // 내보내기 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!exportMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (exportAreaRef.current && !exportAreaRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [exportMenuOpen]);

  const saveButtonDisabled = saveStatus === 'saving';

  return (
    <div className="flex items-center h-12 px-5 bg-[var(--surface-base)] border-b border-[var(--border-default)] gap-2 select-none shrink-0">
      {/* 좌: NexOps 워드마크 + 잡 결과/새 생성 이동 (NEXFIT 로고·/dashboard·/generate 라우트는 NexOps에 없음) */}
      <span className="text-sm font-bold text-[var(--editor-brand)] select-none">NexOps</span>
      <ThinButton onClick={() => router.push(`/registration/detail-page?jobId=${pdpId}`)} aria-label="생성 결과로">
        <LayoutDashboard size={16} />
        <span className="text-xs">생성 결과</span>
      </ThinButton>
      <ThinButton onClick={() => router.push('/registration/detail-page')} aria-label="새로 만들기">
        <Plus size={16} />
        <span className="text-xs">새로 만들기</span>
      </ThinButton>

      {/* 중앙: 상품명 */}
      <div className="flex-1 flex justify-center min-w-0">
        {editorDoc?.meta.productName && (
          <span className="text-xs text-[var(--text-disabled)] truncate max-w-[240px]" title={editorDoc.meta.productName}>
            {editorDoc.meta.productName}
          </span>
        )}
      </div>

      {/* 우: 실행취소/다시실행 + 저장 + 파생본 + 내보내기 */}
      <div className="flex items-center gap-1.5">

        <ThinButton onClick={undoDocument} disabled={!canUndo} aria-label="실행 취소 (Ctrl+Z)" title="실행 취소 (Ctrl+Z)">
          <Undo2 size={16} />
        </ThinButton>
        <ThinButton onClick={redoDocument} disabled={!canRedo} aria-label="다시 실행 (Ctrl+Shift+Z)" title="다시 실행 (Ctrl+Shift+Z)">
          <Redo2 size={16} />
        </ThinButton>

        <ThinDivider />

        <SaveStatusBadge saveStatus={saveStatus} isDirty={isDirty} />

        <ThinButton onClick={() => requestSave()} disabled={saveButtonDisabled} aria-label="저장">
          {saveStatus === 'saving' ? <Loader2 size={16} className="animate-spin" /> :
           saveStatus === 'saved' && !isDirty ? <Check size={16} className="text-green-500" /> :
           saveStatus === 'error' ? <AlertTriangle size={16} className="text-red-500" /> :
           <Save size={16} />}
          <span className="text-xs">
            {saveStatus === 'saving' ? '저장 중...' :
             saveStatus === 'saved' && !isDirty ? '저장됨' :
             saveStatus === 'error' ? '실패' : '저장'}
          </span>
        </ThinButton>

        <ThinDivider />

        <DerivativeToggle current={derivativePreview} onChange={setDerivativePreview} />
        {filteredCount !== null && (
          <span className="text-[11px] text-[var(--brand-primary-dark)] font-medium bg-[var(--editor-brand-tint)] px-1 py-0.5 rounded-full">
            {filteredCount}개
          </span>
        )}

        <ThinDivider />

        <ThinButton onClick={onExportAllImages} disabled={imageExporting} aria-label="이미지 내보내기">
          {imageExporting ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
          <span className="text-xs">이미지</span>
        </ThinButton>


        <div ref={exportAreaRef} className="relative">
          <button
            onClick={() => setExportMenuOpen((v) => !v)}
            aria-label="내보내기"
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] active:brightness-90 transition-colors cursor-pointer"
          >
            <Download size={16} />
            <span className="text-xs">내보내기</span>
          </button>
          {exportMenuOpen && <ExportMenu onClose={() => setExportMenuOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

// ── Internal ──


function ThinButton({ children, onClick, disabled, 'aria-label': ariaLabel, title }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={[
        'flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ThinDivider() {
  return <div className="w-px h-5 bg-[var(--border-default)]" />;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SaveStatusBadge({ saveStatus, isDirty }: { saveStatus: SaveStatus; isDirty: boolean }) {
  if (saveStatus === 'saving' || saveStatus === 'error') return null;
  if (isDirty) return <span className="text-[11px] text-amber-500">● 미저장</span>;
  return null;
}

const DERIVATIVE_MODES: { mode: DerivativePreviewMode; label: string; title: string }[] = [
  { mode: 'master', label: 'M', title: '전체 섹션 (마스터본)' },
  { mode: 'quick', label: 'Q', title: '핵심 섹션만 (priority 1~3)' },
  { mode: 'standard', label: 'S', title: '표준 섹션 (priority 1~6)' },
  { mode: 'persuasive', label: 'P', title: '설득 강화 전체 섹션' },
];

function DerivativeToggle({ current, onChange }: { current: DerivativePreviewMode; onChange: (m: DerivativePreviewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-[var(--surface-elevated)] rounded p-0.5">
      {DERIVATIVE_MODES.map(({ mode, label, title }) => (
        <button
          key={mode}
          title={title}
          aria-label={title}
          onClick={() => onChange(mode)}
          className={[
            'px-2 py-1 rounded text-[11px] font-medium transition-colors',
            current === mode ? 'bg-[var(--surface-base)] text-[var(--brand-primary-dark)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
