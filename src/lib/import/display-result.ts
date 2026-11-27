import type { ImportResult } from '@/types/import'

export interface ImportDisplayResult {
  file: string
  type: string
  success: number
  error: number
  errors: string[]
  warnings: string[]
}

function getFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Import 실패'
}

/** 단일 파일 처리 결과를 UI 표시 형식으로 변환한다. 실패는 반드시 오류 1건 이상으로 표현한다. */
export function toImportDisplayResult(
  file: string,
  type: string,
  result: ImportResult | null,
  failure?: unknown
): ImportDisplayResult {
  if (!result) {
    return {
      file,
      type,
      success: 0,
      error: 1,
      errors: [getFailureMessage(failure)],
      warnings: [],
    }
  }

  return {
    file,
    type,
    success: result.successCount,
    error: result.errorCount,
    errors: result.errors.map((error) => error.message).slice(0, 3),
    warnings: result.warnings?.slice(0, 3) ?? [],
  }
}

/** 단일 파일 임포트 Promise의 성공/실패를 항상 표시 가능한 결과로 정규화한다. */
export async function runImportForDisplay(
  file: string,
  type: string,
  importFile: () => Promise<ImportResult | null>
): Promise<ImportDisplayResult> {
  try {
    return toImportDisplayResult(file, type, await importFile())
  } catch (error) {
    return toImportDisplayResult(file, type, null, error)
  }
}
