import type { ProductBox } from '@/lib/registration/pdp-state'
import type { MotionClip } from '@/lib/registration/editor/types/editor'

// ─── 에디터 API 클라이언트 (NexOps 이식판) ────────────────────────────────────
// NEXFIT services/editorApi.ts의 NexOps 재작성 — 계약(EditorDataResponse 등 타입)은
// 원본을 보존하고 엔드포인트만 NexOps 라우트로 배선한다.
//   GET/PUT /api/registration/pdp/{jobId}/editor  (설계문서 §3.1-b)
//   POST    /api/registration/editor/upload        (이미지 직접 업로드 — NEXFIT signed-url 흐름 대체)
//   GET     /api/registration/editor/images        (내 이미지 보관함 — 스토리지 목록, 묶음 5 ②)
// 아직 없는 원본 기능(카피 재생성·재생성 잔여·AI 레이아웃 정돈)은 따로 정한다.

// ─────────────────────────────────────────────
// 에디터 데이터
// ─────────────────────────────────────────────

export interface EditorDataResponse {
  is_new: boolean;
  sections_data?: unknown[];
  layout_assignments?: Record<string, string>;
  copywriting_result?: Record<string, unknown> | null;
  generated_images?: Record<string, unknown> | null;
  spec_sheet?: Record<string, unknown> | null;
  section_plan?: { layout_selections?: Record<string, string> } | null;
  /** Track I(내재화) 잡만 — 서버가 해석 완료한 섹션 타입별 실측 테마(결정 T-5). 최초 빌드에서만 적용 */
  internalized_theme?: Record<
    string,
    { headlinePx: number; bodyPx: number; lineHeightRatio: number; paddingPx: number; gapPx: number; backgroundHex: string }
  > | null;
  /**
   * 모바일 하한(pdp-enrichment T3m) 적용 여부 — 서버가 잡으로 판정한다: Track S(standard) 잡이거나
   * section_plan.enrichment에 mobile이 기록된 잡. Track I 무기록 잡(구 잡·대조군)은 false. 최초 빌드에서만 쓴다.
   */
  mobile_floor?: boolean;
  /**
   * 강조 장식(pdp-enrichment T4) — 이미지 URL 키. 장식이 기록된 Track I 잡만 내려온다(없으면 키 자체가 없다).
   * aspect = 원본 가로/세로(cover 크롭 투영용, 모르면 null), section = 컷 키('features:1' 등 — 같은 URL이 여러 섹션에
   * 나오면 역할 소유 섹션에 단다). 최초 빌드에서만 프리셋·테마·하한 뒤에 얹는다.
   */
  annotations?: Record<string, { aspect: number | null; section: string; items: EditorImageAnnotation[] }>;
  /**
   * D2-3 첫 화면 글자 자리(hero SectionImage.copyZone 측정) — designcut2 잡처럼 잰 기록이 있을 때만 내려온다(없으면 키가 없다).
   * 디자인 컷 D2 장면 모드의 최초 빌드가 통과면 사진 위 글자 자리에 제목을 얹고, ink는 그 글자색(짙은 글자·흰 글자)이다
   */
  hero_copy_zone?: { pass: boolean; ink: 'dark' | 'light' };
  /** D2 장면 사진의 실제 가로/세로(이미지 URL 키) — 아트 디렉션이 기록된 디자인 컷 잡만(없으면 키가 없다). 풀폭 사진 높이·글자 자리 계산용 */
  image_aspects?: Record<string, number>;
  /** 사이즈 단독 컷의 제품 경계(이미지 URL 키) */
  product_boxes?: Record<string, ProductBox>;
  /**
   * GIF 칸(움직이는 띠) — 포스터 URL 키. 움직이는 WebP가 있는 칸만 내려온다(없으면 키가 없다). 편집기는 포스터를 그리고,
   * 상세 이미지 굽기가 이 포스터 자리를 WebP로 바꿔 전체 이미지 목록에 섞는다(세션 B ③ P4)
   */
  motion_clips?: Record<string, MotionClip>;
  /**
   * 페이지에서 뺀 컷 키(section_images[].section) — usegate 잡에서 끝까지 쓰는 법 미달이라 뺀 컷(droppedForUse, 결정 카드 c08·J44)이 있을 때만
   * 내려온다(없으면 키가 없다). 디자인 컷 K 섹션 목록에서 그 컷이 든 항목을 글·이름표째 빼고 남은 수로 그린다
   */
  dropped_cuts?: string[];
}

/** 강조 장식 1개 — 서버 ImageAnnotation(pdp-state.ts)과 같은 형태. 좌표는 원본 이미지 기준 0~1 */
export interface EditorImageAnnotation {
  kind: 'label' | 'leader' | 'zoom' | 'number';
  anchor: { x: number; y: number };
  zoomRect?: { x: number; y: number; w: number; h: number };
  text?: string;
  source: string;
}

export interface EditorDataSaveResponse {
  success: boolean;
  updated_at: string;
}

// ─────────────────────────────────────────────
// 공통 fetch 헬퍼
// ─────────────────────────────────────────────

async function apiFetch<T>(url: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const { safeApiErrorWithDetail, SafeDisplayError } = await import('@/lib/registration/editor/utils/safeErrorMessage');
    let detail: unknown;
    try {
      // NexOps 라우트는 { error } 형태 (pdp-client.ts 계약) — NEXFIT { detail } 자리에 매핑
      detail = (await res.json())?.error;
    } catch {
      // 본문 없음/비JSON — status별 일반 문구로 처리
    }
    throw new SafeDisplayError(safeApiErrorWithDetail(res.status, detail));
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────
// API 함수
// ─────────────────────────────────────────────

export async function fetchEditorData(pdpId: string, token: string): Promise<EditorDataResponse> {
  return apiFetch<EditorDataResponse>(`/api/registration/pdp/${pdpId}/editor`, token);
}

export async function saveEditorData(
  pdpId: string,
  token: string,
  data: {
    sections_data: unknown[];
    layout_assignments: Record<string, string>;
  },
): Promise<EditorDataSaveResponse> {
  return apiFetch<EditorDataSaveResponse>(`/api/registration/pdp/${pdpId}/editor`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────
// 이미지 업로드
// ─────────────────────────────────────────────

/**
 * 에디터 내 사용자 이미지 업로드. NEXFIT은 signed-url 2단계였지만 NexOps는
 * 라우트가 스토리지(sourcing-product-images)에 직접 업로드하고 public URL을 반환한다.
 * 호출부(캔버스·툴바·속성탭 6곳) 시그니처 보존을 위해 libraryMeta 파라미터는
 * 받되 무시한다 — 보관함(fetchLibraryImages)은 업로드 폴더를 그대로 읽어 따로 기록할 것이 없다.
 */
export async function uploadImageViaSignedUrl(
  token: string,
  file: File,
  _libraryMeta?: { sourcePdpId?: string; sourceSection?: string },
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiFetch<{ url: string }>('/api/registration/editor/upload', token, {
    method: 'POST',
    body: formData,
  });
  return res.url;
}

// ─────────────────────────────────────────────
// 내 이미지 보관함 (묶음 5 ②)
// ─────────────────────────────────────────────

/** 서버 LibraryImage(storage.ts)와 같은 형태 */
export interface LibraryImageItem {
  name: string;
  url: string;
  createdAt: string | null;
  size: number | null;
  kind: 'upload' | 'section' | 'thumbnail' | 'other';
}

export interface LibraryImagesResponse {
  items: LibraryImageItem[];
  hasMore: boolean;
  /** 다음 쪽 offset(서버가 건너뛴 폴더·비이미지 항목 포함 위치) */
  nextOffset: number;
}

/** scope 'job' = 그 잡의 생성 컷·썸네일(서버가 잡 소유를 확인한다), 'uploads' = 편집기에서 올린 이미지 */
export async function fetchLibraryImages(
  token: string,
  query: { scope: 'uploads' | 'job'; jobId?: string; offset?: number; limit?: number },
): Promise<LibraryImagesResponse> {
  const params = new URLSearchParams({ scope: query.scope });
  if (query.jobId) params.set('jobId', query.jobId);
  if (query.offset) params.set('offset', String(query.offset));
  if (query.limit) params.set('limit', String(query.limit));
  return apiFetch<LibraryImagesResponse>(`/api/registration/editor/images?${params.toString()}`, token);
}
