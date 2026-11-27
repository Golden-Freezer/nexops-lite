import { createHash } from 'node:crypto'
import type { ImportType } from '@/types/import'

export type AutoImportKind = Extract<
  ImportType,
  'inventory_health' | 'sales' | 'ad_billing'
>

export const AUTO_IMPORT_HASH_BASIS = {
  xlsx: 'xlsx_raw_bytes_v1',
  adBilling: 'ad_rows_canonical_json_v1',
} as const

export type AutoImportHashBasis =
  (typeof AUTO_IMPORT_HASH_BASIS)[keyof typeof AUTO_IMPORT_HASH_BASIS]

export type AutoImportReceiptStatus =
  | 'processing'
  | 'completed'
  | 'indeterminate'

export interface AutoImportReceiptScope {
  userId: string
  businessId: string
  importKind: AutoImportKind
  importDate: string
  hashBasis: AutoImportHashBasis
  contentSha256: string
}

export interface ClaimAutoImportReceiptInput extends AutoImportReceiptScope {
  batchId: string
  fileName: string
  rowCount: number
}

export interface AutoImportReceiptState {
  receiptId: string
  status: AutoImportReceiptStatus
  batchId: string
  response: Record<string, unknown> | null
}

export interface AutoImportReceiptClaim extends AutoImportReceiptState {
  claimed: boolean
}

export class AutoImportInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutoImportInputError'
  }
}

export class AutoImportReceiptRpcError extends Error {
  readonly operation: 'claim' | 'complete' | 'indeterminate'
  readonly rpcCode: string | null

  constructor(
    operation: 'claim' | 'complete' | 'indeterminate',
    message: string,
    rpcCode: string | null = null
  ) {
    super(message)
    this.name = 'AutoImportReceiptRpcError'
    this.operation = operation
    this.rpcCode = rpcCode
  }
}

/**
 * Buffer.from(..., 'base64')는 잘못된 문자와 패딩도 관대하게 무시한다. 자동 Import의
 * 내용 해시는 실제 전송 파일을 정확히 식별해야 하므로 표준·정규 base64만 허용한다.
 */
export function decodeStrictBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new AutoImportInputError('fileBase64 형식이 올바르지 않습니다.')
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new AutoImportInputError('fileBase64 형식이 올바르지 않습니다.')
  }
  return decoded
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableJson(value: unknown, inArray = false): string | undefined {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null'
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item, true) ?? 'null').join(',')}]`
      }
      const record = value as Record<string, unknown>
      const entries = Object.keys(record)
        .sort()
        .flatMap((key) => {
          const encoded = stableJson(record[key])
          return encoded === undefined
            ? []
            : [`${JSON.stringify(key)}:${encoded}`]
        })
      return `{${entries.join(',')}}`
    }
    default:
      return inArray ? 'null' : undefined
  }
}

/**
 * 광고 GraphQL 응답은 행/프로퍼티 순서가 달라질 수 있다. 행을 안정 JSON으로 바꾼 뒤
 * 정렬하되 중복 항목은 제거하지 않아 동일한 멀티셋만 같은 해시가 되도록 한다.
 */
export function canonicalizeAdaptedAdRows(
  rows: Record<string, unknown>[]
): string {
  const canonicalRows = rows.map((row) => stableJson(row) ?? '{}').sort()
  return `[${canonicalRows.join(',')}]`
}

export function sha256CanonicalAdRows(
  rows: Record<string, unknown>[]
): string {
  return createHash('sha256')
    .update(canonicalizeAdaptedAdRows(rows), 'utf8')
    .digest('hex')
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function compactDateToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

/** Statistics 자동 수확 계약의 단일 일자 파일명만 허용한다. */
export function assertSingleDayStatisticsFilename(fileName: string): string {
  const match =
    /^Statistics-(\d{8})~(\d{8})(?:_\(\d+\))?(?: \(\d+\))*\.[xX][lL][sS][xX]$/.exec(
      fileName
    )
  const compactDates = fileName.match(/\d{8}/g) ?? []
  if (!match || compactDates.length !== 2) {
    throw new AutoImportInputError(
      'Statistics 일별 파일명을 확인할 수 없습니다.'
    )
  }

  const startDate = compactDateToIso(match[1])
  const endDate = compactDateToIso(match[2])
  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate)) {
    throw new AutoImportInputError(
      'Statistics 파일의 기준일 형식이 올바르지 않습니다.'
    )
  }
  if (startDate !== endDate) {
    throw new AutoImportInputError(
      `여러 날짜 취합 파일 (${startDate} ~ ${endDate}). 일별 파일만 자동 Import 가능합니다.`
    )
  }
  return startDate
}

/** parsed/adapted fileDate를 SSOT로 삼고, 행 날짜가 있는 종류는 혼합 여부도 확인한다. */
export function resolveAutoImportDate(
  importKind: AutoImportKind,
  fileDate: string | null | undefined,
  rows: Record<string, unknown>[]
): string {
  if (!fileDate || !isIsoCalendarDate(fileDate)) {
    throw new AutoImportInputError(
      '파일의 Import 기준일을 확인할 수 없습니다.'
    )
  }

  const rowDateField =
    importKind === 'ad_billing'
      ? 'ad_date'
      : importKind === 'sales'
        ? 'order_date'
        : null
  if (!rowDateField) return fileDate

  const rowDates = new Set<string>()
  for (const row of rows) {
    const value = row[rowDateField]
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new AutoImportInputError(
        '일부 행의 Import 기준일을 확인할 수 없습니다.'
      )
    }

    const rowDate = String(value).trim()
    if (!isIsoCalendarDate(rowDate)) {
      throw new AutoImportInputError(
        '일부 행의 Import 기준일 형식이 올바르지 않습니다.'
      )
    }
    rowDates.add(rowDate)
  }

  if (rowDates.size !== 1 || !rowDates.has(fileDate)) {
    throw new AutoImportInputError(
      '여러 날짜가 섞인 파일은 자동 Import할 수 없습니다.'
    )
  }
  return fileDate
}

interface RpcErrorLike {
  message?: string
  code?: string
}

interface RpcResult {
  data: unknown
  error: RpcErrorLike | null
}

interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<RpcResult>
}

function parseReceiptState(
  operation: 'claim' | 'complete' | 'indeterminate',
  data: unknown
): AutoImportReceiptState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AutoImportReceiptRpcError(
      operation,
      `자동 Import 영수증 ${operation} 응답이 올바르지 않습니다.`
    )
  }

  const record = data as Record<string, unknown>
  const status = record.status
  const response = record.response
  if (
    typeof record.receiptId !== 'string' ||
    typeof record.batchId !== 'string' ||
    (status !== 'processing' &&
      status !== 'completed' &&
      status !== 'indeterminate') ||
    (response !== null &&
      (typeof response !== 'object' || Array.isArray(response))) ||
    (status === 'completed' && response === null) ||
    (status !== 'completed' && response !== null)
  ) {
    throw new AutoImportReceiptRpcError(
      operation,
      `자동 Import 영수증 ${operation} 응답 필드가 올바르지 않습니다.`
    )
  }

  return {
    receiptId: record.receiptId,
    status,
    batchId: record.batchId,
    response: response as Record<string, unknown> | null,
  }
}

async function callReceiptRpc(
  supabase: RpcClient,
  operation: 'claim' | 'complete' | 'indeterminate',
  name: string,
  params: Record<string, unknown>
): Promise<AutoImportReceiptState> {
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    throw new AutoImportReceiptRpcError(
      operation,
      `자동 Import 영수증 ${operation} 실패: ${error.message ?? '알 수 없는 오류'}`,
      error.code ?? null
    )
  }
  return parseReceiptState(operation, data)
}

export async function claimAutoImportReceipt(
  supabase: RpcClient,
  input: ClaimAutoImportReceiptInput
): Promise<AutoImportReceiptClaim> {
  const { data, error } = await supabase.rpc('claim_auto_import_receipt', {
    p_user_id: input.userId,
    p_business_id: input.businessId,
    p_import_kind: input.importKind,
    p_import_date: input.importDate,
    p_hash_basis: input.hashBasis,
    p_content_sha256: input.contentSha256,
    p_batch_id: input.batchId,
    p_file_name: input.fileName,
    p_row_count: input.rowCount,
  })
  if (error) {
    throw new AutoImportReceiptRpcError(
      'claim',
      `자동 Import 영수증 claim 실패: ${error.message ?? '알 수 없는 오류'}`,
      error.code ?? null
    )
  }

  const state = parseReceiptState('claim', data)
  const claimed = (data as Record<string, unknown>).claimed
  if (typeof claimed !== 'boolean') {
    throw new AutoImportReceiptRpcError(
      'claim',
      '자동 Import 영수증 claim 응답 필드가 올바르지 않습니다.'
    )
  }
  return { ...state, claimed }
}

export async function completeAutoImportReceipt(
  supabase: RpcClient,
  input: Pick<AutoImportReceiptScope, 'userId' | 'businessId'> & {
    receiptId: string
    batchId: string
    response: Record<string, unknown>
  }
): Promise<AutoImportReceiptState> {
  return callReceiptRpc(
    supabase,
    'complete',
    'complete_auto_import_receipt',
    {
      p_receipt_id: input.receiptId,
      p_user_id: input.userId,
      p_business_id: input.businessId,
      p_batch_id: input.batchId,
      p_response: input.response,
    }
  )
}

export async function markAutoImportReceiptIndeterminate(
  supabase: RpcClient,
  input: Pick<AutoImportReceiptScope, 'userId' | 'businessId'> & {
    receiptId: string
    batchId: string
    stage: 'run_import' | 'complete_receipt'
  }
): Promise<AutoImportReceiptState> {
  return callReceiptRpc(
    supabase,
    'indeterminate',
    'mark_auto_import_receipt_indeterminate',
    {
      p_receipt_id: input.receiptId,
      p_user_id: input.userId,
      p_business_id: input.businessId,
      p_batch_id: input.batchId,
      p_stage: input.stage,
    }
  )
}
