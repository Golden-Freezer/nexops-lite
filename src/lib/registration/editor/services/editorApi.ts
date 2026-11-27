// ─── 에디터 API 클라이언트 (NexOps 이식판) ────────────────────────────────────
// NEXFIT services/editorApi.ts의 NexOps 재작성 — 계약(EditorDataResponse 등 타입)은
// 원본을 보존하고 엔드포인트만 NexOps 라우트로 배선한다.
//   GET/PUT /api/registration/pdp/{jobId}/editor  (설계문서 §3.1-b)
//   POST    /api/registration/editor/upload        (이미지 직접 업로드 — NEXFIT signed-url 흐름 대체)
// 제거된 원본 기능(이미지 재생성·카피 재생성·이미지 보관함·재생성 잔여·AI 레이아웃 정돈)은
// 재생성 백엔드와 함께 Phase 4에서 이식한다.

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
 * 받되 무시한다(이미지 보관함은 Phase 4).
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
