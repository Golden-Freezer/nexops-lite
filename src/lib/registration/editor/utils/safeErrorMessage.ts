const SAFE_MESSAGES: Record<number, string> = {
  400: '요청이 올바르지 않습니다.',
  401: '로그인이 필요합니다.',
  403: '접근 권한이 없습니다.',
  404: '요청한 항목을 찾을 수 없습니다.',
  409: '이미 처리 중인 요청이 있습니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  500: '서버에 일시적인 문제가 발생했습니다.',
  502: '서버에 연결할 수 없습니다.',
  503: '서비스 점검 중입니다.',
};

// 403/429의 detail은 서버가 통제하는 사용자 안내문(플랜·한도 게이트)이라
// 그대로 표시해도 에러 상세 은닉 취지와 충돌하지 않는다. 그 외 status는 은닉 유지.
const DETAIL_PASSTHROUGH_STATUSES = new Set([403, 429]);

export function safeApiError(status: number): string {
  return SAFE_MESSAGES[status] ?? '오류가 발생했습니다. 다시 시도해주세요.';
}

/** 403/429이고 서버 detail이 문자열이면 통과, 그 외에는 status별 일반 문구. */
export function safeApiErrorWithDetail(status: number, detail?: unknown): string {
  if (
    DETAIL_PASSTHROUGH_STATUSES.has(status) &&
    typeof detail === 'string' &&
    detail.trim().length > 0
  ) {
    return detail.trim();
  }
  return safeApiError(status);
}

/** 표시해도 안전한 메시지임이 보장된 에러 — safeErrorMessage가 유일하게 통과시킨다. */
export class SafeDisplayError extends Error {}

export function safeErrorMessage(
  error: unknown,
  fallback = '오류가 발생했습니다. 다시 시도해주세요.',
): string {
  if (error instanceof SafeDisplayError && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
