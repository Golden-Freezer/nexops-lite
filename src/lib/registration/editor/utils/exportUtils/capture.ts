// exportUtils/capture.ts — D2 분할: 원본 exportUtils.ts 6~288행, 751~856행 순수 이동 (2026-07-04) — 브라우저 의존(캡처/스티치/다운로드 트리거)

import domtoimage from 'dom-to-image-more';
import { toast } from '@/components/features/registration/editor/ui/Toast';
import { confirmDialog } from '@/components/features/registration/editor/ui/ConfirmDialog';

const CANVAS_WIDTH = 860;
const COUPANG_MAX_SIZE = 10 * 1024 * 1024; // 10MB

export type ExportFormat = 'jpeg' | 'png';

// ─────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────

/** Blob → 다운로드 트리거 */
function triggerDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** URL 문자열 → 다운로드 트리거 */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** canvas.toBlob() → Promise (null 체크 포함) */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error(`toBlob returned null (type: ${type})`));
      },
      type,
      quality,
    );
  });
}

/**
 * Canvas API로 이미지를 base64 data URL로 변환한다.
 * fetch CORS 실패 시 fallback으로 사용된다.
 */
async function imageToBase64ViaCanvas(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    // cache bust로 CORS preflight 재시도
    img.src = src + (src.includes('?') ? '&' : '?') + '_cb=' + Date.now();
  });
}

/**
 * DOM 요소 내 모든 외부 이미지를 base64 data URL로 인라인 변환한다.
 * dom-to-image-more 캡처 전에 호출해야 SVG foreignObject 안에서 이미지가 렌더링된다.
 * @returns 원본 src를 복원하는 함수
 */
export async function inlineExternalImages(element: HTMLElement): Promise<() => void> {
  const images = element.querySelectorAll<HTMLImageElement>('img');
  const originals: Array<{ img: HTMLImageElement; src: string }> = [];

  const promises = Array.from(images).map(async (img) => {
    const src = img.src;
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

    try {
      let dataUrl: string;
      try {
        // 1차: fetch로 변환 시도
        const res = await fetch(src, { mode: 'cors' });
        const blob = await res.blob();
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        // 2차: Canvas API fallback
        dataUrl = await imageToBase64ViaCanvas(src);
      }

      originals.push({ img, src });
      img.src = dataUrl;
    } catch (err) {
      console.warn(`[exportUtils] 이미지 인라인 변환 실패 (${src}):`, err);
    }
  });

  await Promise.all(promises);

  return () => {
    for (const { img, src } of originals) {
      img.src = src;
    }
  };
}

/**
 * 원본 DOM을 건드리지 않고, 깨끗한 오프스크린 컨테이너에 복제본을 배치하여 캡처한다.
 * - 이미지를 data URL로 인라인 → 깊은 복제 → 오프스크린 컨테이너 배치
 * - Tailwind 조상 없음 → computed style 깨끗
 * - CSS injection을 #nexops-export-clone에 스코핑 → 테두리 완전 제거
 * - requestAnimationFrame 대기 → 스타일 계산 보장
 */
export async function withClonedCapture<T>(
  el: HTMLElement,
  fn: (clone: HTMLElement) => Promise<T>,
): Promise<T> {
  // 0. 폰트 준비 대기 — 미로딩 상태 캡처 시 wrap이 달라져 텍스트가 카드/섹션
  //    경계(overflow:hidden)를 벗어나 잘리는 원인이 된다
  try {
    await document.fonts?.ready;
  } catch {
    // 폰트 API 실패는 캡처를 막지 않는다 (폴백 렌더 허용)
  }

  // 1. 이미지 로드 대기 + data URL 인라인 (원본에)
  const imgs = el.querySelectorAll<HTMLImageElement>('img');
  await Promise.all(
    Array.from(imgs)
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => new Promise<void>((r) => {
        img.onload = () => r();
        img.onerror = () => r();
        setTimeout(r, 5000);
      })),
  );
  const restoreImages = await inlineExternalImages(el);

  try {
    // 2. 깊은 복제 (data URL 이미지 포함)
    const clone = el.cloneNode(true) as HTMLElement;

    // 3. 깨끗한 오프스크린 컨테이너
    const container = document.createElement('div');
    container.id = 'nexops-export-clone';
    container.style.cssText =
      `position:fixed;left:-9999px;top:0;width:${CANVAS_WIDTH}px;` +
      'margin:0;padding:0;transform:none;overflow:visible;background:transparent;';

    // 4. UI용 border/outline/box-shadow 제거 — 단, "콘텐츠" 스타일은 보존
    //    dom-to-image-more가 내부에서 재복제하므로 CSS 주입이 무효 → 인라인 수정 필수.
    //    도형 stroke·프레임 이미지 테두리·리뷰카드 box-shadow는 React style prop
    //    (=인라인)으로 지정되므로, 인라인으로 이미 선언된 border/box-shadow는
    //    남기고 CSS 상속분(테일윈드/전역 리셋)만 무력화한다.
    //    (기존 전량 제거는 리뷰카드 테두리·그림자·프레임 테두리까지 PNG에서 지웠다)
    const stripUiChrome = (child: HTMLElement) => {
      const st = child.style;
      const hasInlineBorder = !!(st.borderStyle || st.borderWidth || st.border);
      if (!hasInlineBorder) {
        st.borderColor = 'transparent';
        st.borderStyle = 'none';
      }
      if (!st.boxShadow) {
        st.boxShadow = 'none';
      }
      st.outline = 'none';
    };
    // 4-0. UI chrome 명시 제외 — 선택 박스/스냅 가이드 등 [data-export-exclude]
    //      노드는 스타일 휴리스틱과 무관하게 통째로 제거 (chrome이 인라인 스타일로
    //      바뀌어도 내보내기에 새어들지 않도록 하는 구조적 방어)
    clone.querySelectorAll<HTMLElement>('[data-export-exclude]').forEach((n) => n.remove());

    clone.querySelectorAll<HTMLElement>('*').forEach(stripUiChrome);
    stripUiChrome(clone);

    // 4-1. section overflow 클리핑
    clone.querySelectorAll<HTMLElement>('[data-section-id]').forEach((sec) => {
      sec.style.overflow = 'hidden';
    });

    // 4-2. 빈 이미지 플레이스홀더 숨김
    clone.querySelectorAll<HTMLElement>('[data-img-placeholder]').forEach((ph) => {
      ph.style.backgroundColor = 'transparent';
      ph.style.color = 'transparent';
    });

    container.appendChild(clone);
    document.body.appendChild(container);

    // 5. 스타일 계산 보장
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    try {
      return await fn(clone);
    } finally {
      document.body.removeChild(container);
    }
  } finally {
    restoreImages();
  }
}

/** @deprecated Use withClonedCapture instead */
export const withIsolatedElement = withClonedCapture;
/** @deprecated Use withClonedCapture instead */
export const withNeutralizedAncestors = withClonedCapture;

/**
 * dom-to-image로 DOM 요소를 캡처한다.
 * withClonedCapture로 깨끗한 오프스크린 복제본에서 캡처 → 여백/테두리 제거.
 * scale 기본 1 → 860px (devicePixelRatio 무시). 해상도 셀렉터 선택 시 2~4×.
 */
async function captureElementAsBlob(
  el: HTMLElement,
  backgroundColor: string | null = null,
  scale = 1,
): Promise<Blob> {
  return await withClonedCapture(el, async (clone) =>
    domtoimage.toBlob(clone, {
      width: CANVAS_WIDTH,
      height: clone.offsetHeight,
      scale,
      bgcolor: backgroundColor ?? undefined,
      cacheBust: false, // 이미지는 withClonedCapture 내부에서 인라인 완료
    }),
  );
}

/**
 * Blob(PNG)을 format에 따라 다운로드한다.
 * - JPEG: quality 자동 조절로 10MB 미만 보장
 * - PNG: 10MB 초과 시 사용자에게 경고
 */
async function downloadBlobAsImage(
  blob: Blob,
  filename: string,
  format: ExportFormat = 'jpeg',
): Promise<void> {
  const baseName = filename.replace(/\.(png|jpg|jpeg)$/i, '');
  const ext = format === 'png' ? '.png' : '.jpg';
  const outputFilename = baseName + ext;

  if (format === 'png') {
    // ── PNG: 원본 화질, 크기 경고만 ──
    if (blob.size >= COUPANG_MAX_SIZE) {
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
      const proceed = await confirmDialog({
        title: '쿠팡 업로드 제한 초과',
        message:
          `PNG 파일 크기가 ${sizeMB}MB입니다.\n` +
          `쿠팡 업로드 제한(10MB)을 초과합니다.\n\n` +
          `그래도 다운로드하시겠습니까?\n` +
          `(JPEG로 전환하면 10MB 미만으로 줄어듭니다)`,
        confirmLabel: '다운로드',
      });
      if (!proceed) return;
    }
    triggerDownloadBlob(blob, outputFilename);
    return;
  }

  // ── JPEG: PNG blob → canvas → JPEG 변환 + quality 자동 조절 ──
  const bitmap = await createImageBitmap(blob);
  const cvs = document.createElement('canvas');
  cvs.width = bitmap.width;
  cvs.height = bitmap.height;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const QUALITY_STEPS = [0.92, 0.85, 0.75, 0.6];
  for (const quality of QUALITY_STEPS) {
    try {
      const jpegBlob = await canvasToBlob(cvs, 'image/jpeg', quality);
      if (jpegBlob.size < COUPANG_MAX_SIZE) {
        triggerDownloadBlob(jpegBlob, outputFilename);
        return;
      }
      console.warn(`[Export] quality ${quality} → ${(jpegBlob.size / 1024 / 1024).toFixed(1)}MB — 10MB 초과`);
    } catch (e) {
      console.warn(`[Export] toBlob 실패 (quality: ${quality}):`, e);
    }
  }

  // 모든 quality 실패 → toDataURL fallback
  try {
    const dataUrl = cvs.toDataURL('image/jpeg', 0.6);
    triggerDownload(dataUrl, outputFilename);
  } catch (e2) {
    console.error('[Export] 이미지 내보내기 완전 실패:', e2);
    toast.error('이미지 내보내기에 실패했습니다. 섹션별 내보내기를 이용해 주세요.');
  }
}


// ─────────────────────────────────────────────
// T4.2: slice/chunk 캡처
// ─────────────────────────────────────────────

/**
 * DOM 요소를 세로로 분할 캡처한다.
 * totalHeight > sliceHeight 인 경우 여러 Blob으로 분리 반환.
 * 각 sliceHeight마다 clipRect를 이동하여 dom-to-image 면적 한계를 회피한다.
 */
export async function captureSliced(
  element: HTMLElement,
  options?: { sliceHeight?: number; backgroundColor?: string; scale?: number },
): Promise<Blob[]> {
  const totalHeight = element.offsetHeight;
  const sliceH = options?.sliceHeight ?? 4000;
  const bg = options?.backgroundColor ?? null;
  const scale = options?.scale ?? 1;

  if (totalHeight <= sliceH) {
    const blob = await captureElementAsBlob(element, bg, scale);
    return [blob];
  }

  return await withClonedCapture(element, async (clone) => {
    const blobs: Blob[] = [];
    const cloneHeight = clone.offsetHeight;

    for (let y = 0; y < cloneHeight; y += sliceH) {
      const height = Math.min(sliceH, cloneHeight - y);

      const blob = await domtoimage.toBlob(clone, {
        width: CANVAS_WIDTH,
        height: cloneHeight,
        scale,
        bgcolor: bg ?? undefined,
        cacheBust: false,
        style: {
          marginTop: `-${y}px`,
        },
        filter: () => true,
      }).then(async (fullBlob: Blob) => {
        const bitmap = await createImageBitmap(fullBlob);
        const cvs = document.createElement('canvas');
        cvs.width = CANVAS_WIDTH * scale;
        cvs.height = height * scale;
        const ctx = cvs.getContext('2d')!;
        ctx.drawImage(
          bitmap,
          0, y * scale, CANVAS_WIDTH * scale, height * scale,
          0, 0, CANVAS_WIDTH * scale, height * scale,
        );
        bitmap.close();
        return canvasToBlob(cvs, 'image/png');
      });

      blobs.push(blob);
    }

    return blobs;
  });
}

// ─────────────────────────────────────────────
// T4.3: stitched full-page export
// ─────────────────────────────────────────────

/**
 * 여러 Blob(PNG)을 세로로 결합하여 하나의 PNG Blob 생성
 */
export async function stitchBlobs(blobs: Blob[], width: number): Promise<Blob> {
  const images = await Promise.all(blobs.map((b) => createImageBitmap(b)));
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d')!;

  let y = 0;
  for (const img of images) {
    ctx.drawImage(img, 0, y);
    y += img.height;
    img.close();
  }

  return canvasToBlob(canvas, 'image/png');
}

/**
 * 전체 페이지를 단일 PNG Blob으로 반환한다.
 * 면적 한계 초과 시 slice → stitch fallback으로 자동 전환.
 * (기존 exportFullPagePng는 다운로드 래퍼로 유지)
 */
export async function exportFullPagePngBlob(
  canvasElement: HTMLElement,
  options?: { stitched?: boolean; backgroundColor?: string; scale?: number },
): Promise<Blob> {
  const bg = options?.backgroundColor ?? '#ffffff';
  const scale = options?.scale ?? 1;

  try {
    // 1차: 단일 캡처 시도
    return await captureElementAsBlob(canvasElement, bg, scale);
  } catch (error) {
    if (options?.stitched === false) throw error;
    // 2차: stitched fallback
    console.warn('[exportFullPagePngBlob] 단일 캡처 실패, stitched export로 전환', error);
    const slices = await captureSliced(canvasElement, { sliceHeight: 4000, backgroundColor: bg, scale });
    return stitchBlobs(slices, CANVAS_WIDTH * scale);
  }
}


export {
  CANVAS_WIDTH,
  triggerDownloadBlob,
  triggerDownload,
  canvasToBlob,
  imageToBase64ViaCanvas,
  captureElementAsBlob,
  downloadBlobAsImage,
};
