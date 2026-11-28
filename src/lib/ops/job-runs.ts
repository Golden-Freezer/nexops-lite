// NEXOPS 라이트에는 운영 관제 테이블과 알림 런타임이 없다.
// 호출부 계약만 유지하고 기록은 성공한 no-op으로 처리한다.

export const OPS_JOB_KEYS = {
  pdpSubscriptionHalt: 'pdp-subscription-halt',
} as const

export type OpsJobStatus = 'ok' | 'skipped' | 'failed'

export interface JobRunInput {
  jobKey: string
  status: OpsJobStatus
  userId?: string | null
  startedAt?: Date | string | null
  finishedAt?: Date
  kstDate?: string
  detail?: Record<string, unknown>
}

export interface JobRunRecordResult {
  recorded: boolean
  error?: string
}

export function kstDateOf(at: Date): string {
  return new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export function isManualRun(detail: unknown): boolean {
  return Boolean(detail && typeof detail === 'object' && typeof (detail as { manual?: unknown }).manual === 'string')
}

export function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export async function recordJobRun(_db: unknown, _input: JobRunInput): Promise<JobRunRecordResult> {
  return { recorded: true }
}
