import * as XLSX from 'xlsx'
import type { ImportType, ParsedRow, ImportConfig, ImportError } from '@/types/import'
import { IMPORT_CONFIGS } from '@/types/import'

/**
 * 클라이언트 사이드에서 Excel 파일을 파싱하여 JSON 행 배열로 변환
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function parseExcelFile(
  buffer: ArrayBuffer,
  importType: ImportType,
  sheetIndex = 0
): { rows: Record<string, unknown>[]; headers: string[]; sheetName: string } {
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다. (최대 10MB, 현재 ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`)
  }

  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  // 시트명 자동 탐색
  const sheetSearch: Record<string, string[]> = {
    product: ['01_상품', '01.상품', '상품등록'],
    sales: ['02_판매', '02.판매'],
    purchase: ['DB_구매', 'DB.구매'],
    ad_billing: ['DB_광고', 'DB.광고'],
    inventory_health: ['DB_재고', 'DB.재고'],
  }

  let sheetName: string
  const searchNames = sheetSearch[importType]
  if (searchNames) {
    const found = workbook.SheetNames.find(
      (name) => searchNames.some((s) => name === s || name.replace(/\s/g, '') === s)
    )
    sheetName = found || workbook.SheetNames[sheetIndex]
  } else {
    sheetName = workbook.SheetNames[sheetIndex]
  }

  const sheet = workbook.Sheets[sheetName]

  if (!sheet) {
    throw new Error(`시트를 찾을 수 없습니다: ${importType === 'product' ? '"01_상품" 또는 "01.상품"' : `index ${sheetIndex}`}`)
  }

  const config = IMPORT_CONFIGS[importType]
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: config.headerRow === 0 ? undefined : 1,
    defval: null,
    raw: false,
  })

  // 2행 헤더 등: skipDataRows만큼 데이터 행 건너뛰기
  const skipRows = config.skipDataRows || 0
  const rows = skipRows > 0 ? jsonData.slice(skipRows) : jsonData

  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : []

  return { rows, headers, sheetName }
}

/**
 * 파싱된 행을 ImportConfig의 컬럼 매핑에 따라 정규화
 * - 기본: 정확 매칭 → 부분 매칭 (기존 동작 유지)
 * - strictMatch 타입(product): 정확 매칭 → 공백 제거 정확 매칭. 부분 매칭 금지
 *   ('원가(이동평균)'→'원가' 같은 오매핑 방지, products-io 스킬 §3)
 */
export function mapColumns(
  rows: Record<string, unknown>[],
  config: ImportConfig
): ParsedRow[] {
  return rows.map((row, index) => {
    const mapped: Record<string, unknown> = {}
    const errors: ImportError[] = []
    const usedRowKeys = new Set<string>()

    const mappingEntries = Object.entries(config.columnMapping)

    // Pass 1: 정확 매칭
    for (const [excelCol, dbCol] of mappingEntries) {
      if (mapped[dbCol] !== undefined) continue
      if (row[excelCol] !== undefined) {
        mapped[dbCol] = row[excelCol]
        usedRowKeys.add(excelCol)
      }
    }

    if (config.strictMatch) {
      // Pass 1.5: 공백 제거 후 정확 매칭 ('옵션ID' ↔ '옵션 ID')
      const stripSpace = (s: string) => s.replace(/\s/g, '')
      for (const [excelCol, dbCol] of mappingEntries) {
        if (mapped[dbCol] !== undefined) continue
        const target = stripSpace(excelCol)
        const matchedKey = Object.keys(row).find(
          (k) => !usedRowKeys.has(k) && stripSpace(k) === target
        )
        if (matchedKey !== undefined) {
          mapped[dbCol] = row[matchedKey]
          usedRowKeys.add(matchedKey)
        }
      }
    } else {
      // Pass 2: 부분 매칭 (아직 매핑 안 된 DB 컬럼만)
      for (const [excelCol, dbCol] of mappingEntries) {
        if (mapped[dbCol] !== undefined) continue
        const matchedKey = Object.keys(row).find(
          (k) => !usedRowKeys.has(k) && (k.includes(excelCol) || excelCol.includes(k))
        )
        if (matchedKey !== undefined) {
          mapped[dbCol] = row[matchedKey]
          usedRowKeys.add(matchedKey)
        }
      }
    }

    // 필수 컬럼 체크
    for (const reqCol of config.requiredColumns) {
      const dbCol = config.columnMapping[reqCol]
      if (dbCol && (mapped[dbCol] === null || mapped[dbCol] === undefined || mapped[dbCol] === '')) {
        errors.push({
          row: index + 2, // 1-indexed + header row
          field: reqCol,
          message: `필수 컬럼 '${reqCol}' 값이 비어있습니다.`,
        })
      }
    }

    return {
      rowIndex: index + 2,
      data: mapped,
      errors,
      isValid: errors.length === 0,
    }
  })
}

/**
 * 파일 헤더 중 columnMapping에 매칭되지 않아 무시되는 컬럼 목록
 * (매칭 판정은 strictMatch 규칙과 동일: 정확 일치 + 공백 제거 정확 일치)
 */
export function getUnmappedHeaders(headers: string[], config: ImportConfig): string[] {
  const stripSpace = (s: string) => s.replace(/\s/g, '')
  const mappedKeys = new Set(Object.keys(config.columnMapping).map(stripSpace))
  return headers.filter((h) => !mappedKeys.has(stripSpace(h)))
}

/**
 * 파일명에서 날짜 추출
 * 예: "Statistics-20260415~20260415_(0) (4).xlsx" → "2026-04-15"
 * 예: "A01008637-dailySettlement-20260415-20260415.xlsx" → "2026-04-15"
 */
/**
 * Statistics 파일이 여러 날짜 취합 파일인지 검증
 * Statistics-20260620~20260620 → null (단일 날짜, 정상)
 * Statistics-20260620~20260625 → "2026-06-20 ~ 2026-06-25" (여러 날짜, 차단)
 */
export function validateStatisticsDateRange(filename: string): string | null {
  const match = filename.match(/Statistics-(\d{8})~(\d{8})/)
  if (!match) return null
  const start = match[1]
  const end = match[2]
  if (start !== end) {
    const s = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`
    const e = `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`
    return `${s} ~ ${e}`
  }
  return null
}

export function extractDateFromFilename(filename: string): string | null {
  // Statistics-YYYYMMDD~YYYYMMDD 패턴
  const statisticsMatch = filename.match(/Statistics-(\d{4})(\d{2})(\d{2})/)
  if (statisticsMatch) {
    return `${statisticsMatch[1]}-${statisticsMatch[2]}-${statisticsMatch[3]}`
  }

  // dailySettlement-YYYYMMDD-YYYYMMDD 패턴
  const settlementMatch = filename.match(/dailySettlement-(\d{4})(\d{2})(\d{2})/)
  if (settlementMatch) {
    return `${settlementMatch[1]}-${settlementMatch[2]}-${settlementMatch[3]}`
  }

  // 일반 YYYYMMDD 패턴
  const genericMatch = filename.match(/(\d{4})(\d{2})(\d{2})/)
  if (genericMatch) {
    const y = Number(genericMatch[1])
    const m = Number(genericMatch[2])
    const d = Number(genericMatch[3])
    if (y >= 2020 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${genericMatch[1]}-${genericMatch[2]}-${genericMatch[3]}`
    }
  }

  return null
}

/**
 * 날짜 문자열을 YYYY-MM-DD 형식으로 정규화
 */
export function normalizeDate(value: unknown): string | null {
  if (!value) return null

  if (value instanceof Date) {
    // xlsx cellDates는 로컬 타임존 기준 Date를 만든다 — toISOString(UTC)로 바꾸면
    // KST 환경에서 하루 밀린 날짜가 나온다. 로컬 파트로 조립한다 (audit §1-12).
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const str = String(value).trim()

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str

  // YYYY.MM.DD or YYYY/MM/DD
  const dotMatch = str.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/)
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2].padStart(2, '0')}-${dotMatch[3].padStart(2, '0')}`
  }

  // M/D/YY or MM/DD/YY (예: 5/1/26 → 2026-05-01)
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (mdyMatch) {
    const year = mdyMatch[3].length === 2 ? `20${mdyMatch[3]}` : mdyMatch[3]
    return `${year}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`
  }

  // 한국어 날짜: "2026년 04월 15일"
  const koreanMatch = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (koreanMatch) {
    return `${koreanMatch[1]}-${koreanMatch[2].padStart(2, '0')}-${koreanMatch[3].padStart(2, '0')}`
  }

  // Excel serial date number
  const num = Number(str)
  if (!isNaN(num) && num > 40000 && num < 50000) {
    const date = XLSX.SSF.parse_date_code(num)
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }

  return null
}

/**
 * 숫자 값 정규화 (콤마 제거, 빈값 0 처리)
 */
export function normalizeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined || value === '') return defaultValue
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[,\s원₩%]/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? defaultValue : num
}

/**
 * 퍼센트 문자열을 소수로 변환
 * "100.0%" → 1.0, "97.5%" → 0.975, "0.97" → 0.97, "10.8"(단위표시 없이 %값) → 0.108
 * % 기호가 없어도 1을 넘는 값은 백분율로 간주해 /100 한다(콤마 서식 문자열도 함께 정규화, audit §1-9).
 */
export function normalizePercentage(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined || value === '') return defaultValue
  const str = String(value).trim()
  if (str.includes('%')) {
    const num = Number(str.replace(/[%,\s]/g, ''))
    return isNaN(num) ? defaultValue : num / 100
  }
  const num = Number(str.replace(/[,\s]/g, ''))
  if (isNaN(num)) return defaultValue
  return num > 1 ? num / 100 : num
}
