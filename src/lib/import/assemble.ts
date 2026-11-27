import { IMPORT_CONFIGS } from '@/types/import'
import type { ImportConfig, ImportType, ParsedRow } from '@/types/import'
import { parseExcelFile, mapColumns, extractDateFromFilename } from './parser'
import {
  validateSalesRow,
  validateInventoryHealthRow,
  validateAdBillingRow,
  validateProductRow,
  validatePurchaseRow,
} from './validators'

/**
 * 엑셀 buffer → 검증된 임포트 행 조립 (순수 함수, DOM 비의존 = 클라이언트·서버 공용).
 * useImport.processOneFile(클라이언트 수동 업로드)와 /api/import/auto(확장 자동 수확)가
 * 동일한 파싱·매핑·검증·날짜 상속 규칙을 타도록 이 한 곳에 모은다.
 */

const VALIDATORS: Record<string, (row: ParsedRow) => ParsedRow> = {
  sales: validateSalesRow,
  inventory_health: validateInventoryHealthRow,
  ad_billing: validateAdBillingRow,
  product: validateProductRow,
  purchase: validatePurchaseRow,
}

export interface AssembledImport {
  validRows: ParsedRow[]
  invalidRows: ParsedRow[]
  fileDate: string | null
}

/**
 * @param sheetIndex 시트 자동 탐색 실패 시 폴백 인덱스 (기본 0)
 */
export function assembleImportRows(
  buffer: ArrayBuffer,
  importType: ImportType,
  fileName: string,
  sheetIndex = 0,
  configOverride?: ImportConfig
): AssembledImport {
  const config = configOverride ?? IMPORT_CONFIGS[importType]
  const { rows } = parseExcelFile(buffer, importType, sheetIndex)
  if (rows.length === 0) {
    throw new Error('파싱된 데이터가 없습니다. 파일 형식을 확인해주세요.')
  }

  const mapped = mapColumns(rows, config)

  const fileDate = extractDateFromFilename(fileName)
  if (fileDate && importType === 'sales') {
    for (const row of mapped) {
      if (!row.data.order_date) {
        row.data.order_date = fileDate
      }
    }
  }

  // dailySettlement: 계층 구조 → 캠페인 상세행에 부모 날짜 상속
  if (importType === 'ad_billing') {
    let lastDate: string | null = null
    for (const row of mapped) {
      const rawDate = String(row.data.ad_date || '').trim()
      if (rawDate && rawDate !== '전체') {
        lastDate = rawDate // 일별 소계행에서 날짜 기억
      } else if (!rawDate && lastDate && row.data.campaign_id) {
        // 날짜 null + 캠페인ID 있음 = 상세행 → 부모 날짜 상속
        row.data.ad_date = lastDate
        // 날짜 상속 성공 → mapColumns의 필수컬럼 에러 제거
        row.errors = row.errors.filter((e) => e.field !== '날짜')
        row.isValid = row.errors.length === 0
      }
    }
  }

  const validator = VALIDATORS[importType]
  const validated = validator ? mapped.map(validator) : mapped
  const validRows = validated.filter((r) => r.isValid)
  const invalidRows = validated.filter((r) => !r.isValid)

  // 광고 Import는 입력 날짜 전체를 DELETE+재삽입하므로, 진짜 합계/소계/전부 0원 행 외의
  // 오류 행을 빼고 전송하면 기존 원장을 부분 데이터로 교체하게 된다.
  if (importType === 'ad_billing') {
    const errorRows = invalidRows.filter(r => r.errors.length > 0 || !r.skipReason)
    if (errorRows.length > 0) {
      const first = errorRows[0].errors[0]?.message || '유효하지 않은 광고 행'
      throw new Error(`광고 파일 ${errorRows.length}행 검증 실패: ${first} 기존 날짜 원장은 유지됩니다.`)
    }
  }

  // 매입 Import는 구매·재고·이동평균을 파일 단위 한 트랜잭션으로 저장한다.
  // 잘못된 행을 제외한 부분 Import는 원본 장부와 DB 건수를 다르게 만드므로 전체를 차단한다.
  if (importType === 'purchase' && invalidRows.length > 0) {
    const first = invalidRows[0].errors[0]?.message || '유효하지 않은 행'
    throw new Error(`매입 파일 ${invalidRows.length}행 검증 실패: ${first} 전체 파일은 반영되지 않았습니다.`)
  }

  if (validRows.length === 0) {
    throw new Error(`유효한 데이터가 없습니다. 전체 ${validated.length}행 중 ${invalidRows.length}행 오류.`)
  }

  return { validRows, invalidRows, fileDate }
}
