// ─── 편집기 카피 재생성 클라이언트 (묶음 5 카피, pdp-editor-copy-regen-ui) ─────────────────────
// 계약: src/lib/registration/pdp-copy-regen.ts(#204) — 타입만 들여온다.
//   GET  /api/registration/pdp/{jobId}/copy/regenerate?sectionType=…   사전 조회(쓰기 없음, 비용 상한·막힌 사유)
//   POST /api/registration/pdp/{jobId}/copy/regenerate                  즉시 처리 — LLM 1콜 뒤 가드를 통과한 후보(0~3개)를 바로 준다
// 서버는 카피 원본·편집기 저장본을 고치지 않는다. 고른 후보는 편집기가 요소에 넣고 기존 PUT editor로 저장한다.
// 409(CopyRegenConflictBody)는 code와 busyKind를 살려 CopyRegenApiError로 던진다 — 이미지 생성 중(busyKind 'images')을 따로 알린다.

import type {
  CopyRegenBlock,
  CopyRegenConflictBody,
  CopyRegenPreviewResponse,
  CopyRegenRequestBody,
  CopyRegenResponse,
} from '@/lib/registration/pdp-copy-regen';
import type { ProSectionType } from '@/lib/registration/editor/types/section';
import { RegenApiError } from './regenApi';

export class CopyRegenApiError extends RegenApiError {
  constructor(
    message: string,
    status: number,
    code?: string,
    readonly busyKind?: CopyRegenBlock['busyKind'],
  ) {
    super(message, status, code);
    this.name = 'CopyRegenApiError';
  }
}

// regenApi와 같은 규칙: 같은 출처 Clerk 쿠키, 실패는 서버 error 문구와 code를 살려 던진다
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const json = (await res.json().catch(() => ({}))) as Partial<CopyRegenConflictBody>;
  if (!res.ok) throw new CopyRegenApiError(json.error || `요청 실패(${res.status})`, res.status, json.code, json.busyKind);
  return json as T;
}

export interface CopyRegenApi {
  preview(jobId: string, sectionType: ProSectionType): Promise<CopyRegenPreviewResponse>;
  request(jobId: string, body: CopyRegenRequestBody): Promise<CopyRegenResponse>;
}

export const copyRegenApi: CopyRegenApi = {
  preview: (jobId, sectionType) =>
    call<CopyRegenPreviewResponse>(`/api/registration/pdp/${jobId}/copy/regenerate?${new URLSearchParams({ sectionType }).toString()}`),
  request: (jobId, body) =>
    call<CopyRegenResponse>(`/api/registration/pdp/${jobId}/copy/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
