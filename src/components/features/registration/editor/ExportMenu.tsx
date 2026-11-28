'use client';

import { useRef, useState, useEffect } from 'react';
import {
  type LucideIcon,
  FileImage,
  Images,
  Archive,
  Code2,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode,
  PackageCheck,
  Tags,
} from 'lucide-react';
import { useEditorStore, selectSections, selectDocument, selectMeasuredHeights } from '@/lib/registration/editor/stores/editorStore';
import {
  exportFullPagePngBlob,
  exportZip,
  exportZipWithDerivatives,
  exportReviewHtml,
  exportRenderHtml,
  withClonedCapture,
  captureExportBlob,
  type ExportFormat,
} from '@/lib/registration/editor/utils/exportUtils';
import { runExportQaCheck } from '@/lib/registration/editor/utils/exportQaCheck';
import { getSectionLabel } from '@/lib/registration/editor/utils/sectionConverter';
import type { ExportWarning, DerivativeVersion } from '@/lib/registration/editor/types/editor';
import { Z_INDEX } from '@/lib/registration/editor/constants/designTokens';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import CoupangImageSave from './CoupangImageSave';
import { isOptionSpec } from '@/lib/registration/options/option-spec';
import { buildRegistrationOptionExport } from '@/lib/registration/options/registration-export';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function triggerHtmlDownload(htmlStr: string, filename: string, type = 'text/html;charset=utf-8'): void {
  const blob = new Blob([htmlStr], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────

type ExportType =
  | 'sections_png'
  | 'full_page_png'
  | 'zip'
  | 'zip_derivatives'
  | 'review_html'
  | 'render_html'
  | 'qa_check'
  | 'option_export';

interface ExportOption {
  type: ExportType;
  label: string;
  desc: string;
  Icon: LucideIcon;
  group: 'image' | 'html' | 'bundle' | 'qa';
}

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────

const RESOLUTION_PRESETS = [
  { id: 'basic', label: '기본 (1×)', scale: 1 },
  { id: 'web', label: 'Web (2×)', scale: 2 },
  { id: 'print', label: 'Print (3×)', scale: 3 },
  { id: 'hd', label: 'HD (4×)', scale: 4 },
] as const;

const EXPORT_OPTIONS: ExportOption[] = [
  // ── 이미지 ──
  {
    type: 'sections_png',
    label: '섹션별 이미지',
    desc: '섹션을 선택하여 하나의 이미지로 저장',
    Icon: Images,
    group: 'image',
  },
  {
    type: 'full_page_png',
    label: '전체 페이지 이미지',
    desc: '긴 페이지 자동 분할→결합 stitched 방식',
    Icon: FileImage,
    group: 'image',
  },
  // ── HTML ──
  {
    type: 'review_html',
    label: 'Review HTML (검수용)',
    desc: '시맨틱 · flex 레이아웃 · 브라우저 미리보기용',
    Icon: FileCode,
    group: 'html',
  },
  {
    type: 'render_html',
    label: 'Render HTML (캡처용)',
    desc: '860px 고정 · 실측 height · absolute 배치',
    Icon: Code2,
    group: 'html',
  },
  // ── 번들 ──
  {
    type: 'zip',
    label: 'ZIP (마스터)',
    desc: '섹션별 + 전체 + 검수/캡처 HTML 포함',
    Icon: Archive,
    group: 'bundle',
  },
  {
    type: 'zip_derivatives',
    label: 'ZIP + 파생본',
    desc: 'Quick(12) / Standard(18) / Persuasive(24) 동시 출력',
    Icon: PackageCheck,
    group: 'bundle',
  },
  {
    type: 'option_export',
    label: '옵션 등록용 내보내기',
    desc: '등록 옵션 축·옵션명 JSON (가격·재고 없음)',
    Icon: Tags,
    group: 'bundle',
  },
  // ── QA ──
  {
    type: 'qa_check',
    label: 'QA 검사 실행',
    desc: 'overflow · 이미지 누락 · CTA 위치 검사',
    Icon: ShieldCheck,
    group: 'qa',
  },
];

const GROUP_LABELS: Record<string, string> = {
  image: '이미지',
  html: 'HTML',
  bundle: '번들',
  qa: '검사',
};

// ─────────────────────────────────────────────
// QA 결과 패널
// ─────────────────────────────────────────────

function QaResultPanel({
  warnings,
  onClose,
}: {
  warnings: ExportWarning[];
  onClose: () => void;
}) {
  const errors = warnings.filter((w) => w.severity === 'error');
  const warns = warnings.filter((w) => w.severity === 'warning');

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text-primary)]">QA 검사 결과</span>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
        >
          닫기
        </button>
      </div>

      {warnings.length === 0 ? (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <span className="text-sm text-emerald-700 font-medium">이상 없음 — Export 준비 완료</span>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {errors.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded border border-red-200">
              <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
              <span className="text-xs text-red-700">{w.message}</span>
            </div>
          ))}
          {warns.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2 bg-amber-50 rounded border border-amber-200">
              <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="text-xs text-amber-700">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <p className="text-[10px] text-[var(--text-disabled)]">
          오류 {errors.length}개 · 경고 {warns.length}개
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// GIF 감지
// ─────────────────────────────────────────────

function hasGifInSections(ids: Set<string>, sections: CanvasSection[]): boolean {
  return sections
    .filter((s) => ids.has(s.id))
    .some((s) =>
      s.elements.some((el) => {
        const src = el.imageProps?.src ?? el.framedImageProps?.src ?? '';
        return /\.gif(\?|$)/i.test(src);
      }),
    );
}

// ─────────────────────────────────────────────
// 섹션 선택 패널
// ─────────────────────────────────────────────

interface SectionPickerPanelProps {
  visible: CanvasSection[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onExport: () => void;
  onClose: () => void;
  isExporting: boolean;
  hasGif: boolean;
}

function SectionPickerPanel({
  visible,
  selectedIds,
  onToggle,
  onToggleAll,
  onExport,
  onClose,
  isExporting,
  hasGif,
}: SectionPickerPanelProps) {
  const allSelected = visible.length > 0 && visible.every((s) => selectedIds.has(s.id));
  const someSelected = visible.some((s) => selectedIds.has(s.id));

  return (
    <div className="py-2">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">섹션 선택</span>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
        >
          닫기
        </button>
      </div>

      {/* 전체 선택 */}
      <label className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-[var(--hover-overlay)] cursor-pointer border-b border-[var(--border-subtle)]">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={onToggleAll}
          className="accent-[var(--editor-brand)]"
        />
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          전체 선택 ({selectedIds.size}/{visible.length})
        </span>
      </label>

      {/* 섹션 목록 */}
      <div className="max-h-48 overflow-y-auto">
        {visible.map((section, i) => (
          <label
            key={section.id}
            className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-[var(--hover-overlay)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(section.id)}
              onChange={() => onToggle(section.id)}
              className="accent-[var(--editor-brand)]"
            />
            <span className="text-xs text-[var(--text-primary)]">
              {String(i + 1).padStart(2, '0')}. {getSectionLabel(section.sectionType)}
            </span>
          </label>
        ))}
      </div>

      {/* GIF 경고 */}
      {hasGif && (
        <div className="mx-4 mt-2 p-2 bg-amber-50 rounded border border-amber-200 flex items-start gap-1.5">
          <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
          <span className="text-[10px] text-amber-700 leading-tight">
            GIF 요소 포함 섹션은 첫 프레임 정지 이미지로 저장됩니다
          </span>
        </div>
      )}

      {/* 다운로드 버튼 */}
      <div className="px-4 pt-3 pb-1">
        <button
          onClick={onExport}
          disabled={selectedIds.size === 0 || isExporting}
          className={[
            'w-full py-2 rounded-lg text-sm font-medium transition-colors',
            selectedIds.size === 0 || isExporting
              ? 'bg-[var(--surface-elevated)] text-[var(--text-disabled)] cursor-not-allowed'
              : 'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-dark)] active:brightness-90',
          ].join(' ')}
        >
          다운로드 ({selectedIds.size}개 섹션)
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ExportMenu
// ─────────────────────────────────────────────

interface ExportMenuProps {
  onClose: () => void;
}

export default function ExportMenu({ onClose }: ExportMenuProps) {
  const sections = useEditorStore(selectSections);
  const doc = useEditorStore(selectDocument);
  const measuredHeights = useEditorStore(selectMeasuredHeights);
  // 옵션 등록용 내보내기 — 등록 옵션 구조(variants ≥ 2)가 있는 문서만 메뉴에 보인다(05_OPTIONS.md §5, 읽기 전용)
  const rawOptionSpec = doc?.sourceData.specSheet?.optionSpec;
  const optionSpec = isOptionSpec(rawOptionSpec) && rawOptionSpec.variants.length >= 2 ? rawOptionSpec : null;

  // NexOps는 오너 전용 도구 — NEXFIT의 유료 구독 게이트를 항상 통과 상태로 둔다.
  const isPaid: boolean = true;

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeType, setActiveType] = useState<ExportType | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const [qaWarnings, setQaWarnings] = useState<ExportWarning[] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  // 기본 1× (사용자 결정: JPG 1× 유지) — 2~4×는 사용자가 명시 선택 시에만
  const [resolution, setResolution] = useState<number>(1);

  const menuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 감지
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [onClose]);

  // ── visible 섹션 (non-divider) ─────────────────────────────────────────────

  const visibleSections = [...sections]
    .filter((s) => s.isVisible && s.sectionType !== 'divider')
    .sort((a, b) => a.order - b.order);

  // ── 섹션 피커 핸들러 ──────────────────────────────────────────────────────

  function openSectionPicker() {
    setShowSectionPicker(true);
    setSelectedSectionIds(new Set(visibleSections.map((s) => s.id)));
  }

  function toggleSectionId(id: string) {
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSections() {
    const allSelected = visibleSections.every((s) => selectedSectionIds.has(s.id));
    if (allSelected) {
      setSelectedSectionIds(new Set());
    } else {
      setSelectedSectionIds(new Set(visibleSections.map((s) => s.id)));
    }
  }

  // ── 섹션별 stitch 내보내기 ────────────────────────────────────────────────

  async function handleSectionExport() {
    if (isExporting || selectedSectionIds.size === 0) return;
    if (!isPaid) return; // 미구독자 내보내기 차단(방어 — UI에서도 옵션을 숨긴다)

    setIsExporting(true);
    setActiveType('sections_png');
    setProgress(0);
    setExportError(null);

    try {
      const canvasEl = document.querySelector<HTMLElement>('[data-canvas-content]');
      if (!canvasEl) throw new Error('캔버스 요소를 찾을 수 없습니다.');

      const selectedVisible = visibleSections.filter((s) => selectedSectionIds.has(s.id));

      await withClonedCapture(canvasEl, async (clone) => {
        const ext = exportFormat === 'png' ? 'png' : 'jpg';

        // PNG blob을 JPEG blob으로 변환 (배경 흰색)
        const toJpegBlob = async (pngBlob: Blob): Promise<Blob> => {
          const bitmap = await createImageBitmap(pngBlob);
          const cvs = document.createElement('canvas');
          cvs.width = bitmap.width;
          cvs.height = bitmap.height;
          const ctx = cvs.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cvs.width, cvs.height);
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return await new Promise<Blob>((resolve, reject) => {
            cvs.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob null'))),
              'image/jpeg',
              0.92,
            );
          });
        };

        // 섹션별 blob + 글로벌 순번 수집
        type CapturedSection = { section: CanvasSection; blob: Blob; globalIdx: number };
        const captured: CapturedSection[] = [];

        for (let i = 0; i < selectedVisible.length; i++) {
          const section = selectedVisible[i];
          const el = clone.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`);
          if (!el) continue;

          // 860으로 찍어 780 × 해상도로 줄인다. 섹션에 쓰인 글꼴만 넣어 찍는다(매번 전체 웹폰트를 받지 않게)
          let blob = await captureExportBlob(el, {
            scale: resolution,
            bgcolor: el.style.backgroundColor || '#ffffff',
          });

          if (exportFormat === 'jpeg') {
            blob = await toJpegBlob(blob);
          }

          const globalIdx = visibleSections.findIndex((v) => v.id === section.id);
          captured.push({ section, blob, globalIdx });
          setProgress(Math.round(((i + 1) / selectedVisible.length) * 80));
        }

        if (captured.length === 0) {
          throw new Error('캡처된 섹션이 없습니다.');
        }

        // 단일 선택 → 이미지 한 장 직접 다운로드
        if (captured.length === 1) {
          const { section, blob } = captured[0];
          const globalIdx = visibleSections.findIndex((v) => v.id === section.id);
          const idx = String(globalIdx + 1).padStart(2, '0');
          const filename = `${idx}_${section.sectionType}.${ext}`;

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setProgress(100);
          return;
        }

        // 복수 선택 → ZIP으로 묶기
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const sectionsFolder = zip.folder('sections');
        if (!sectionsFolder) throw new Error('ZIP 폴더 생성 실패');

        for (const { section, blob, globalIdx } of captured) {
          const idx = String(globalIdx + 1).padStart(2, '0');
          sectionsFolder.file(`${idx}_${section.sectionType}.${ext}`, blob);
        }
        setProgress(90);

        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nexops_sections.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setProgress(100);
      });

      setTimeout(onClose, 500);
    } catch (err) {
      console.error('[ExportMenu] 섹션 내보내기 오류:', err);
      setExportError('내보내기에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
      setActiveType(null);
      setProgress(0);
    }
  }

  // ── 내보내기 핸들러 ────────────────────────────────────────────────────────

  async function handleExport(type: ExportType) {
    if (isExporting) return;
    // QA 검사는 결제와 무관(내보내기 아님) — 그 외 내보내기는 미구독자 차단(방어).
    if (!isPaid && type !== 'qa_check') return;

    // sections_png → 섹션 피커 열기
    if (type === 'sections_png') {
      openSectionPicker();
      return;
    }

    // 다른 옵션 클릭 시 섹션 피커 닫기
    setShowSectionPicker(false);

    // 옵션 등록용 내보내기 — 캔버스 캡처 없이 JSON만 받는다(문서·잡을 고치지 않는다)
    if (type === 'option_export') {
      if (optionSpec) {
        const json = JSON.stringify(buildRegistrationOptionExport(optionSpec), null, 2);
        triggerHtmlDownload(json, 'nexops_registration_options.json', 'application/json;charset=utf-8');
      }
      return;
    }

    // QA 검사는 별도 처리 (비동기 캡처 불필요)
    if (type === 'qa_check') {
      const warnings = runExportQaCheck(sections);
      setQaWarnings(warnings);
      return;
    }

    setIsExporting(true);
    setActiveType(type);
    setProgress(0);
    setQaWarnings(null);
    setExportError(null);

    try {
      const palette = doc?.sourceData.designPalette ?? null;
      const canvasEl = document.querySelector<HTMLElement>('[data-canvas-content]');

      if (type === 'full_page_png') {
        if (!canvasEl) throw new Error('캔버스 요소를 찾을 수 없습니다.');
        setProgress(20);
        const blob = await exportFullPagePngBlob(canvasEl, { backgroundColor: '#ffffff', scale: resolution });
        setProgress(80);
        // JPEG 변환 (필요 시)
        let finalBlob = blob;
        if (exportFormat === 'jpeg') {
          const bitmap = await createImageBitmap(blob);
          const cvs = document.createElement('canvas');
          cvs.width = bitmap.width; cvs.height = bitmap.height;
          const ctx = cvs.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cvs.width, cvs.height);
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          finalBlob = await new Promise<Blob>((resolve, reject) => {
            cvs.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob null')), 'image/jpeg', 0.92);
          });
        }
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexops_full_page.${exportFormat === 'png' ? 'png' : 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setProgress(100);

      } else if (type === 'zip') {
        if (!canvasEl) throw new Error('캔버스 요소를 찾을 수 없습니다.');
        await exportZip(canvasEl, sections, palette, (pct) => setProgress(pct), exportFormat, resolution);

      } else if (type === 'zip_derivatives') {
        if (!canvasEl) throw new Error('캔버스 요소를 찾을 수 없습니다.');
        const allVersions: DerivativeVersion[] = ['quick', 'standard', 'persuasive'];
        await exportZipWithDerivatives(canvasEl, sections, {
          derivatives: allVersions,
          format: exportFormat,
          palette,
          measuredHeights,
          scale: resolution,
          onProgress: (pct) => setProgress(pct),
        });

      } else if (type === 'review_html') {
        const htmlStr = exportReviewHtml(sections, palette);
        triggerHtmlDownload(htmlStr, 'nexops_review.html');
        setProgress(100);

      } else if (type === 'render_html') {
        const htmlStr = exportRenderHtml(sections, measuredHeights, palette);
        triggerHtmlDownload(htmlStr, 'nexops_render.html');
        setProgress(100);
      }

      setTimeout(onClose, 500);
    } catch (err) {
      console.error('[ExportMenu] 내보내기 오류:', err);
      setExportError('내보내기에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
      setActiveType(null);
      setProgress(0);
    }
  }

  // ── 그룹별 분류 ────────────────────────────────────────────────────────────

  const groups = ['image', 'html', 'bundle', 'qa'] as const;

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 w-80 bg-[var(--surface-overlay)] rounded-lg shadow-xl border border-[var(--border-default)] overflow-hidden"
      style={{ zIndex: Z_INDEX.toolbar }}
    >
      {/* 진행 상태 바 */}
      {isExporting && (
        <div className="px-4 py-2.5 bg-[var(--brand-primary-tint)] border-b border-[var(--editor-brand-tint)]">
          <div className="flex items-center gap-2 mb-1.5">
            <Loader2 size={13} className="animate-spin text-[var(--editor-brand)] shrink-0" />
            <span className="text-xs font-medium text-[var(--editor-brand)]">
              내보내는 중... {progress}%
            </span>
          </div>
          <div className="h-1.5 bg-[var(--editor-brand-tint)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--editor-brand)] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 에러 알림 */}
      {exportError && !isExporting && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-start gap-2">
          <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-red-700 font-medium">{exportError}</p>
          </div>
          <button
            onClick={() => setExportError(null)}
            className="text-xs text-red-400 hover:text-red-600 shrink-0"
          >
            닫기
          </button>
        </div>
      )}

      {/* QA 결과 패널 */}
      {qaWarnings !== null && !isExporting && (
        <div className="border-b border-[var(--border-subtle)]">
          <QaResultPanel warnings={qaWarnings} onClose={() => setQaWarnings(null)} />
        </div>
      )}

      {/* 포맷 선택 */}
      {!isExporting && isPaid && (
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--hover-overlay)]">
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">이미지 포맷</p>
          <div className="flex gap-2">
            {(['jpeg', 'png'] as const).map((fmt) => (
              <label
                key={fmt}
                className={[
                  'flex-1 flex flex-col gap-0.5 px-3 py-2 rounded-md border cursor-pointer transition-colors',
                  exportFormat === fmt
                    ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-elevated)] hover:bg-[var(--hover-overlay)]',
                ].join(' ')}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="exportFormat"
                    value={fmt}
                    checked={exportFormat === fmt}
                    onChange={() => setExportFormat(fmt)}
                    className="accent-[var(--editor-brand)]"
                  />
                  <span className={`text-xs font-semibold ${exportFormat === fmt ? 'text-[var(--editor-brand)]' : 'text-[var(--text-primary)]'}`}>
                    {fmt.toUpperCase()}
                    {fmt === 'jpeg' && (
                      <span className="ml-1 text-[10px] font-normal text-[var(--editor-brand)]">(권장)</span>
                    )}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-disabled)] pl-4">
                  {fmt === 'jpeg' ? '쿠팡 최적화 · 10MB 미만' : '무손실 · 파일 크기 주의'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 해상도 선택 */}
      {!isExporting && isPaid && (
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--hover-overlay)]">
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">이미지 해상도</p>
          <div className="flex gap-2">
            {RESOLUTION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setResolution(preset.scale)}
                className={[
                  'flex-1 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                  resolution === preset.scale
                    ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)]',
                ].join(' ')}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 섹션 선택 패널 or 옵션 목록 (유료 구독자만 — 미구독자는 위 업셀 표시) */}
      {isPaid && (showSectionPicker && !isExporting ? (
        <SectionPickerPanel
          visible={visibleSections}
          selectedIds={selectedSectionIds}
          onToggle={toggleSectionId}
          onToggleAll={toggleAllSections}
          onExport={handleSectionExport}
          onClose={() => setShowSectionPicker(false)}
          isExporting={isExporting}
          hasGif={hasGifInSections(selectedSectionIds, sections)}
        />
      ) : (
        <div className="py-1 max-h-[360px] overflow-y-auto">
          {groups.map((group) => {
            const opts = EXPORT_OPTIONS.filter((o) => o.group === group && (o.type !== 'option_export' || optionSpec));
            return (
              <div key={group}>
                <div className="px-4 py-1.5">
                  <span className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider">
                    {GROUP_LABELS[group]}
                  </span>
                </div>
                <ul>
                  {opts.map(({ type, label, desc, Icon }) => {
                    const isActive = activeType === type;
                    const isDisabled = isExporting && type !== 'qa_check';

                    return (
                      <li key={type}>
                        <button
                          onClick={() => handleExport(type)}
                          disabled={isDisabled}
                          className={[
                            'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors',
                            isDisabled
                              ? 'opacity-40 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-[var(--hover-overlay)] active:bg-[var(--pressed-overlay)]',
                            isActive ? 'bg-[var(--brand-primary-tint)]' : '',
                            type === 'qa_check' && qaWarnings !== null && !isActive
                              ? 'bg-emerald-50'
                              : '',
                          ].join(' ')}
                        >
                          <Icon
                            size={15}
                            className={[
                              'mt-0.5 shrink-0',
                              isActive ? 'text-[var(--editor-brand)]' :
                              (type === 'qa_check' && qaWarnings !== null ? 'text-emerald-500' : 'text-[var(--text-disabled)]'),
                            ].join(' ')}
                          />
                          <div>
                            <div
                              className={`text-sm font-medium ${
                                isActive ? 'text-[var(--editor-brand)]' :
                                (type === 'qa_check' && qaWarnings !== null ? 'text-emerald-700' : 'text-[var(--text-primary)]')
                              }`}
                            >
                              {label}
                            </div>
                            <div className="text-xs text-[var(--text-disabled)] mt-0.5">{desc}</div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ))}

      {/* 쿠팡 상세 이미지 굽기·저장(U1) — 기존 내보내기와 별개 */}
      {!showSectionPicker && <CoupangImageSave />}
    </div>
  );
}
