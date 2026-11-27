// exportUtils/exporters.ts — D2 분할: 원본 exportUtils.ts 289~430행, 895~1100행 순수 이동 (2026-07-04) — 브라우저 의존(PNG/ZIP/파생/preload 액션)

import JSZip from 'jszip';
import { toast } from '@/components/features/registration/editor/ui/Toast';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette, DerivativeVersion } from '@/lib/registration/editor/types/editor';
import {
  CANVAS_WIDTH,
  triggerDownloadBlob,
  canvasToBlob,
  imageToBase64ViaCanvas,
  captureElementAsBlob,
  downloadBlobAsImage,
  exportFullPagePngBlob,
} from './capture';
import type { ExportFormat } from './capture';
import { exportHtml, exportReviewHtml, exportRenderHtml } from './htmlBuilders';
import { filterSectionsByDerivative } from './derivativeFilter';

// ─────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────

/**
 * 특정 섹션 DOM을 이미지로 캡처해 다운로드한다.
 * @param sectionElement - data-section-id 가 붙은 섹션 div
 * @param filename - 파일명 (예: "01_hook_3step")
 * @param format - 'jpeg' | 'png' (기본: 'jpeg')
 */
export async function exportSectionPng(
  sectionElement: HTMLElement,
  filename: string,
  format: ExportFormat = 'jpeg',
): Promise<void> {
  const blob = await captureElementAsBlob(sectionElement);
  await downloadBlobAsImage(blob, filename, format);
}

/**
 * 전체 섹션 스택을 하나의 긴 이미지로 캡처해 다운로드한다.
 * @param canvasElement - data-canvas-content 가 붙은 섹션 컨테이너 (flex-col wrapper)
 * @param format - 'jpeg' | 'png' (기본: 'jpeg')
 */
export async function exportFullPagePng(
  canvasElement: HTMLElement,
  format: ExportFormat = 'jpeg',
): Promise<void> {
  const totalHeight = canvasElement.offsetHeight;

  // 캔버스 면적 사전 검증
  const MAX_CANVAS_AREA = 268_435_456; // Chrome 한도 268MP
  const area = CANVAS_WIDTH * totalHeight;
  if (area > MAX_CANVAS_AREA) {
    console.warn(`[Export] 캔버스 면적 ${(area / 1_000_000).toFixed(1)}MP — Chrome 한도 초과`);
    toast.error('상세페이지가 너무 길어 한 장 내보내기가 불가합니다. 섹션별 내보내기를 이용해 주세요.');
    return;
  }

  const blob = await captureElementAsBlob(canvasElement, '#ffffff');
  await downloadBlobAsImage(blob, 'nexops_full_page', format);
}

/**
 * ZIP 내보내기:
 *   sections/{nn}_{sectionType}.jpg  — 섹션별 이미지
 *   full_page.jpg                    — 전체 페이지 이미지
 *   source.html                      — 정적 HTML
 *
 * @param canvasElement - data-canvas-content 가 붙은 섹션 컨테이너
 * @param sections      - CanvasSection[] (순서·sectionType 참조)
 * @param palette       - 디자인 팔레트 (HTML export용, 선택)
 * @param onProgress    - 0~100 퍼센트 콜백 (선택)
 * @param format        - 'jpeg' | 'png' (기본: 'jpeg')
 */
export async function exportZip(
  canvasElement: HTMLElement,
  sections: CanvasSection[],
  palette?: DesignPalette | null,
  onProgress?: (percent: number) => void,
  format: ExportFormat = 'jpeg',
  scale = 1,
): Promise<void> {
  const zip = new JSZip();
  const sectionsFolder = zip.folder('sections')!;
  const ext = format === 'png' ? 'png' : 'jpg';
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';

  const visible = sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .sort((a, b) => a.order - b.order);

  const total = visible.length + 2; // per-section + full_page + html
  let done = 0;

  // 1. 섹션별 이미지
  for (let i = 0; i < visible.length; i++) {
    const section = visible[i];
    const el = canvasElement.querySelector<HTMLElement>(
      `[data-section-id="${section.id}"]`,
    );
    if (!el) continue;

    const idx = String(i + 1).padStart(2, '0');
    const filename = `${idx}_${section.sectionType}.${ext}`;

    const pngBlob = await captureElementAsBlob(el, null, scale);

    let fileBlob: Blob;
    if (format === 'png') {
      fileBlob = pngBlob;
    } else {
      // PNG → JPEG 변환
      const bitmap = await createImageBitmap(pngBlob);
      const cvs = document.createElement('canvas');
      cvs.width = bitmap.width;
      cvs.height = bitmap.height;
      const ctx = cvs.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      fileBlob = await canvasToBlob(cvs, mimeType, 0.92);
    }

    sectionsFolder.file(filename, fileBlob);
    done++;
    onProgress?.(Math.round((done / total) * 100));
  }

  // 2. 전체 페이지 이미지
  const fullPngBlob = await captureElementAsBlob(canvasElement, '#ffffff', scale);
  let fullBlob: Blob;
  if (format === 'png') {
    fullBlob = fullPngBlob;
  } else {
    const bitmap = await createImageBitmap(fullPngBlob);
    const cvs = document.createElement('canvas');
    cvs.width = bitmap.width;
    cvs.height = bitmap.height;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    fullBlob = await canvasToBlob(cvs, mimeType, 0.92);
  }
  zip.file(`full_page.${ext}`, fullBlob);

  done++;
  onProgress?.(Math.round((done / total) * 100));

  // 3. source.html
  zip.file('source.html', exportHtml(sections, palette ?? null));

  done++;
  onProgress?.(100);

  // 4. ZIP 다운로드
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownloadBlob(zipBlob, 'nexops_export.zip');
}


/**
 * 섹션 배열로부터 섹션별 이미지를 ZIP 폴더에 추가하는 헬퍼
 */
async function addSectionsToZipFolder(
  folder: JSZip,
  sections: CanvasSection[],
  canvasElement: HTMLElement,
  format: ExportFormat,
  scale = 1,
): Promise<void> {
  const ext = format === 'png' ? 'png' : 'jpg';
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  for (let i = 0; i < sorted.length; i++) {
    const section = sorted[i];
    const el = canvasElement.querySelector<HTMLElement>(`[data-section-id="${section.id}"]`);
    if (!el) continue;

    const idx = String(i + 1).padStart(2, '0');
    const filename = `${idx}_${section.sectionType}.${ext}`;

    const pngBlob = await captureElementAsBlob(el, null, scale);

    let fileBlob: Blob;
    if (format === 'png') {
      fileBlob = pngBlob;
    } else {
      const bitmap = await createImageBitmap(pngBlob);
      const cvs = document.createElement('canvas');
      cvs.width = bitmap.width;
      cvs.height = bitmap.height;
      const ctx = cvs.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      fileBlob = await canvasToBlob(cvs, mimeType, 0.92);
    }

    folder.file(filename, fileBlob);
  }
}

/**
 * ZIP 내보내기 (파생본 포함)
 * - master/ : 전체 마스터 섹션
 * - quick/, standard/, persuasive/ : 파생본별 필터링
 * - 파생본 없으면 기존 exportZip과 동일 구조
 */
export async function exportZipWithDerivatives(
  canvasElement: HTMLElement,
  sections: CanvasSection[],
  options?: {
    derivatives?: DerivativeVersion[];
    format?: ExportFormat;
    palette?: DesignPalette | null;
    onProgress?: (percent: number) => void;
    measuredHeights?: Record<string, number>;
    scale?: number;
  },
): Promise<void> {
  const format = options?.format ?? 'jpeg';
  const scale = options?.scale ?? 1;
  const derivatives = options?.derivatives ?? [];
  const palette = options?.palette ?? null;
  const onProgress = options?.onProgress;
  const measuredHeights = options?.measuredHeights ?? {};

  const zip = new JSZip();

  // 전체 진행 단계 계산
  const totalSteps = 1 + derivatives.length + 2; // master + each derivative + full_page + html
  let done = 0;

  const tick = () => {
    done++;
    onProgress?.(Math.round((done / totalSteps) * 100));
  };

  // 1. master/ 폴더
  const masterFolder = zip.folder('master')!;
  await addSectionsToZipFolder(masterFolder, sections, canvasElement, format, scale);
  tick();

  // 2. 파생본 폴더
  for (const version of derivatives) {
    const filtered = filterSectionsByDerivative(sections, version);
    const folder = zip.folder(version)!;
    await addSectionsToZipFolder(folder, filtered, canvasElement, format, scale);
    tick();
  }

  // 3. full_page (stitched)
  try {
    const fullBlob = await exportFullPagePngBlob(canvasElement, { backgroundColor: '#ffffff', scale });
    const ext = format === 'png' ? 'png' : 'jpg';
    let finalBlob: Blob;
    if (format === 'jpeg') {
      const bitmap = await createImageBitmap(fullBlob);
      const cvs = document.createElement('canvas');
      cvs.width = bitmap.width; cvs.height = bitmap.height;
      const ctx = cvs.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      finalBlob = await canvasToBlob(cvs, 'image/jpeg', 0.92);
    } else {
      finalBlob = fullBlob;
    }
    zip.file(`full_page.${ext}`, finalBlob);
  } catch (err) {
    console.warn('[exportZipWithDerivatives] full_page 캡처 실패:', err);
  }
  tick();

  // 4. source HTML (Render HTML)
  zip.file('source_render.html', exportRenderHtml(sections, measuredHeights, palette));
  zip.file('source_review.html', exportReviewHtml(sections, palette));
  tick();

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownloadBlob(zipBlob, 'nexops_export_with_derivatives.zip');
}

// ─────────────────────────────────────────────
// T4.5: 이미지 preload/inline 안정화
// ─────────────────────────────────────────────

/**
 * HTML 문자열 내 img src를 fetch하여 base64로 인라인 교체.
 * - CORS 우회: fetch cors → canvas fallback
 * - 타임아웃: 기본 10초
 * - 재시도: maxRetries (기본 2회)
 * - 실패 시 placeholder 삽입 금지 — failures 배열에 URL 기록
 */
export async function preloadAndInlineImages(
  html: string,
  options?: { timeout?: number; maxRetries?: number },
): Promise<{ html: string; failures: string[] }> {
  const timeout = options?.timeout ?? 10000;
  const maxRetries = options?.maxRetries ?? 2;
  const failures: string[] = [];

  // img src 추출 (data:, blob: 제외)
  const srcRegex = /<img[^>]+src="([^"]+)"/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = srcRegex.exec(html)) !== null) {
    const src = m[1];
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      srcs.add(src);
    }
  }

  // URL → base64 변환
  const replacements = new Map<string, string>();

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          let dataUrl: string;

          try {
            const res = await fetch(src, { mode: 'cors', signal: controller.signal });
            clearTimeout(timer);
            const blob = await res.blob();
            dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch {
            clearTimeout(timer);
            // CORS fallback: Canvas API
            dataUrl = await imageToBase64ViaCanvas(src);
          }

          replacements.set(src, dataUrl);
          return; // 성공
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }

      // 모든 재시도 실패
      failures.push(src);
      console.warn(`[preloadAndInlineImages] 인라인 실패 (${maxRetries + 1}회 시도): ${src}`, lastError);
    }),
  );

  // HTML 내 src 교체 (실패한 src는 원본 유지)
  let processedHtml = html;
  for (const [src, dataUrl] of replacements) {
    processedHtml = processedHtml.replaceAll(`src="${src}"`, `src="${dataUrl}"`);
  }

  return { html: processedHtml, failures };
}
