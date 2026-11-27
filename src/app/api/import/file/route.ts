import { NextRequest, NextResponse } from 'next/server'
import { requireAuthOrApiKey } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdReportParseError, runAdReportImport } from '@/lib/import/ad-report'
import { assembleImportRows } from '@/lib/import/assemble'
import { detectImportType } from '@/lib/import/detect-type'
import { validateStatisticsDateRange } from '@/lib/import/parser'
import { runImport } from '@/lib/import/process'
import { businessSettingsFromRow, resolveImportConfig } from '@/lib/settings/config'
import type { ImportError, ImportType, ParsedRow } from '@/types/import'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const SUPPORTED_IMPORT_TYPES = new Set<ImportType>([
  'sales',
  'inventory_health',
  'ad_billing',
  'ad_report',
])

type AdminClient = ReturnType<typeof createAdminClient>

function errorResponse(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function thrownResponse(error: unknown): Response | null {
  return error instanceof Response ? error : null
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function rowErrors(rows: ParsedRow[]): string[] {
  return rows.flatMap((row) =>
    row.errors.map((error) => `${error.row || row.rowIndex}행: ${error.message}`)
  )
}

function importErrors(errors: ImportError[]): string[] {
  return errors.map((error) =>
    error.row > 0 ? `${error.row}행: ${error.message}` : `처리 오류: ${error.message}`
  )
}

function adReportErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return []
  return errors.map((error) => {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const value = error as { row?: unknown; message?: unknown }
      const message = String(value.message ?? '알 수 없는 오류')
      const row = Number(value.row)
      return Number.isFinite(row) && row > 0 ? `${row}행: ${message}` : `처리 오류: ${message}`
    }
    return `처리 오류: ${String(error)}`
  })
}

async function resolveBusinessId(
  supabase: AdminClient,
  userId: string,
): Promise<string> {
  const { data: existing, error: findError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (findError) {
    throw new Error(`사업장 조회에 실패했습니다: ${findError.message}`)
  }
  if (existing?.id) return String(existing.id)

  const { data: created, error: createError } = await supabase.rpc(
    'create_owned_business_atomic',
    {
      p_actor_user_id: userId,
      p_fields: { business_name: '내 사업장' },
      p_make_default: true,
    },
  )
  if (createError) {
    throw new Error(`기본 사업장 생성에 실패했습니다: ${createError.message}`)
  }

  const createdId = created && typeof created === 'object' && 'id' in created
    ? created.id
    : null
  if (!createdId) throw new Error('기본 사업장을 만들었지만 식별자를 확인하지 못했습니다.')
  return String(createdId)
}

async function readFile(request: NextRequest): Promise<File | NextResponse> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('multipart/form-data 형식으로 파일을 보내주세요.', 400)
  }

  const files = formData.getAll('file')
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return errorResponse('file 항목에 파일 하나만 첨부해주세요.', 400)
  }
  return files[0]
}

/** AI와 웹 화면이 쿠팡 Wing 원본 파일을 그대로 보내는 서버 임포트 주소. */
export async function POST(request: NextRequest) {
  let userId: string
  try {
    userId = await requireAuthOrApiKey()
  } catch (error) {
    return thrownResponse(error) ?? errorResponse('인증을 확인하지 못했습니다.', 500)
  }

  const file = await readFile(request)
  if (file instanceof NextResponse) return file
  if (!file.name.trim()) return errorResponse('파일 이름이 비어 있습니다.', 400)
  if (file.size === 0) return errorResponse('빈 파일은 임포트할 수 없습니다.', 400)
  if (file.size > MAX_FILE_SIZE) {
    return errorResponse('파일 크기는 최대 10MB까지 허용됩니다.', 413)
  }

  const importType = detectImportType(file.name)
  if (!importType || !SUPPORTED_IMPORT_TYPES.has(importType)) {
    return errorResponse('지원하지 않는 파일 이름입니다. 쿠팡 Wing 원본 파일인지 확인해주세요.', 400)
  }

  if (importType === 'sales') {
    const dateRange = validateStatisticsDateRange(file.name)
    if (dateRange) {
      return errorResponse(
        `Statistics 판매 통계는 하루치 파일만 올릴 수 있습니다. (${dateRange}) Wing에서 날짜를 하루로 선택해 다시 내려받아주세요.`,
        400,
      )
    }
  }

  let businessId: string | null = null
  const requestedBusinessId = request.headers.get('x-business-id')
  if (requestedBusinessId) {
    try {
      businessId = await requireOwnedBusinessId(userId, requestedBusinessId)
    } catch (error) {
      return thrownResponse(error) ?? errorResponse('사업장 소유권을 확인하지 못했습니다.', 500)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any
  try {
    supabase = createAdminClient()
    if (!requestedBusinessId) businessId = await resolveBusinessId(supabase, userId)
  } catch (error) {
    return thrownResponse(error) ?? errorResponse(errorMessage(error, '사업장을 준비하지 못했습니다.'), 500)
  }
  if (!businessId) return errorResponse('사용할 사업장을 확인하지 못했습니다.', 500)

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    return errorResponse('첨부 파일을 읽지 못했습니다.', 400)
  }

  if (importType === 'ad_report') {
    try {
      const result = await runAdReportImport(supabase, {
        userId,
        businessId,
        fileName: file.name,
        buffer,
      })
      const errors = adReportErrors(result.errors).slice(0, 20)
      return NextResponse.json({
        ok: errors.length === 0,
        importType,
        fileName: file.name,
        fileDate: result.fileDate,
        inserted: result.insertedCount,
        updated: result.updatedCount,
        skipped: result.skippedCount,
        errors,
        focusProducts: result.focusProductCount,
        campaigns: result.campaignCount,
        warnings: result.warnings,
      })
    } catch (error) {
      const status = error instanceof AdReportParseError ? 400 : 500
      return errorResponse(
        `광고 보고서 임포트에 실패했습니다: ${errorMessage(error, '알 수 없는 오류')}`,
        status,
      )
    }
  }

  let settingsRow: Record<string, unknown> | null
  let settingsError: { message: string } | null
  try {
    const settingsResult = await supabase
      .from('business_settings')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle()
    settingsRow = settingsResult.data
    settingsError = settingsResult.error
  } catch (error) {
    return errorResponse(
      `Import 설정 조회에 실패했습니다: ${errorMessage(error, '알 수 없는 오류')}`,
      500,
    )
  }
  if (settingsError) {
    return errorResponse(`Import 설정 조회에 실패했습니다: ${settingsError.message}`, 500)
  }

  let assembled
  try {
    const settings = businessSettingsFromRow(businessId, settingsRow)
    const config = resolveImportConfig(importType, settings.importColumnMappings)
    assembled = assembleImportRows(buffer, importType, file.name, 0, config)
  } catch (error) {
    return errorResponse(`파일을 해석하지 못했습니다: ${errorMessage(error, '파일 형식 오류')}`, 400)
  }

  try {
    const result = await runImport(supabase, {
      userId,
      businessId,
      importType,
      fileName: file.name,
      rows: assembled.validRows.map((row) => row.data),
      totalRows: assembled.validRows.length + assembled.invalidRows.length,
      fileDate: assembled.fileDate,
    })
    const errors = [
      ...rowErrors(assembled.invalidRows),
      ...importErrors(result.errors),
    ].slice(0, 20)

    return NextResponse.json({
      ok: errors.length === 0 && result.errorCount === 0,
      importType,
      fileName: file.name,
      fileDate: assembled.fileDate,
      inserted: result.successCount,
      updated: 0,
      skipped: assembled.invalidRows.length + result.skippedCount,
      errors,
    })
  } catch (error) {
    return errorResponse(
      `파일 저장에 실패했습니다: ${errorMessage(error, '알 수 없는 오류')}`,
      500,
    )
  }
}
