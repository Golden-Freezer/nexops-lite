import type { ImportType, ImportResult, ImportError, ParsedRow } from '@/types/import'
import { apiFetch } from '@/lib/api-client'

/**
 * 검증된 행들을 서버 API로 배치 전송
 */
export async function submitImportBatch(
  importType: ImportType,
  fileName: string,
  validRows: ParsedRow[],
  invalidRows: ParsedRow[],
  fileDate?: string | null
): Promise<ImportResult> {
  const response = await apiFetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      importType,
      fileName,
      rows: validRows.map((r) => r.data),
      totalRows: validRows.length + invalidRows.length,
      errorCount: invalidRows.length,
      ...(fileDate && { fileDate }),
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '임포트 실패')
  }

  const result = await response.json()

  // skipped vs error 분리
  const skippedRows = invalidRows.filter((r) => r.skipReason)
  const errorRows = invalidRows.filter((r) => !r.skipReason)
  const clientErrors: ImportError[] = errorRows.flatMap((r) => r.errors)

  // 스킵 사유별 집계
  const skippedReasons: Record<string, number> = {}
  for (const r of skippedRows) {
    const reason = r.skipReason!
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1
  }

  return {
    batchId: result.data.batchId,
    totalRows: result.data.totalRows,
    successCount: result.data.successCount,
    errorCount: errorRows.length + result.data.errorCount,
    skippedCount: skippedRows.length + (result.data.skippedCount || 0),
    errors: [...clientErrors, ...(result.data.errors || [])].slice(0, 20),
    skippedReasons: {
      ...skippedReasons,
      ...(result.data.skippedReasons || {}),
    },
    mergedCount: result.data.mergedCount || undefined,
    ...(result.data.fallbackApplied ? {
      fallbackApplied: result.data.fallbackApplied,
      unmatchedOptions: result.data.unmatchedOptions,
    } : {}),
    // product 임포트 전용: 신규/업데이트 구분 + 판매상태 경고
    ...(result.data.insertedCount != null || result.data.updatedCount != null ? {
      insertedCount: result.data.insertedCount,
      updatedCount: result.data.updatedCount,
      invalidStatusCount: result.data.invalidStatusCount,
    } : {}),
  }
}
