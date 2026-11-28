// ─── 편집기 이미지 재생성 클라이언트 (묶음 5 ③) ───────────────────────────────
// 계약: src/lib/registration/pdp-image-regen.ts(#174) — 타입만 들여온다.
//   GET  /api/registration/pdp/{jobId}                               잡(section_images[].editorRegen)
//   GET  /api/registration/pdp/{jobId}/images/regenerate?section=…   사전 조회(쓰기 없음, 비용·막힌 사유)
//   POST /api/registration/pdp/{jobId}/images/regenerate              재생성 대기 등록 → 잡이 images 단계로
//   POST /api/registration/pdp/{jobId}/images/regenerate/revert       직전 컷으로 되돌리기(P1-4, 생성 없음)
//   POST /api/registration/pdp/{jobId}/run                            runner 'web'일 때 화면이 반복 호출(PdpProgress와 같다)
// 인증은 Clerk 쿠키(같은 출처) — PdpProgress의 pdpApi와 같다. 409는 code를 살려 RegenApiError로 던진다.
// getJob·runOnce는 401 뒤 다시 보낼 때 새로 받은 토큰을 Authorization 머리에 싣는다(R12a, regenDriver의 withAuthRetry).

import type { RegenPreviewResponse, RegenRequestBody, RegenResponse, RegenRevertResponse } from '@/lib/registration/pdp-image-regen';
import type { PdpJobRow } from '@/lib/registration/pdp-state';
import { bearerHeaders, type PdpRunResponse } from '@/lib/registration/pdp-run-driver';

export class RegenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RegenApiError';
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new RegenApiError(json.error || `요청 실패(${res.status})`, res.status, json.code);
  return json as T;
}

export interface RegenApi {
  getJob(jobId: string, token?: string | null): Promise<PdpJobRow>;
  preview(jobId: string, section: string): Promise<RegenPreviewResponse>;
  request(jobId: string, body: RegenRequestBody): Promise<RegenResponse>;
  revert(jobId: string, section: string): Promise<RegenRevertResponse>;
  runOnce(jobId: string, token?: string | null): Promise<PdpRunResponse>;
}

export const regenApi: RegenApi = {
  getJob: async (jobId, token = null) =>
    (await call<{ job: PdpJobRow }>(`/api/registration/pdp/${jobId}`, { headers: bearerHeaders(token) })).job,
  preview: (jobId, section) =>
    call<RegenPreviewResponse>(`/api/registration/pdp/${jobId}/images/regenerate?${new URLSearchParams({ section }).toString()}`),
  request: (jobId, body) =>
    call<RegenResponse>(`/api/registration/pdp/${jobId}/images/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  revert: (jobId, section) =>
    call<RegenRevertResponse>(`/api/registration/pdp/${jobId}/images/regenerate/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section }),
    }),
  runOnce: (jobId, token = null) =>
    call<PdpRunResponse>(`/api/registration/pdp/${jobId}/run`, { method: 'POST', headers: bearerHeaders(token) }),
};
