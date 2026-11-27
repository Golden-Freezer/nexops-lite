'use client'

import { useState, useCallback, useRef } from 'react'
import type { ImportType, ImportResult } from '@/types/import'
import { PRODUCT_AUTO_CALC_COLUMNS } from '@/types/import'
import { parseExcelFile, mapColumns, extractDateFromFilename, getUnmappedHeaders } from '@/lib/import/parser'
import { validateProductRow } from '@/lib/import/validators'
import { assembleImportRows } from '@/lib/import/assemble'
import { submitImportBatch } from '@/lib/import/batch'
import { apiFetch } from '@/lib/api-client'
import { resolveImportConfig } from '@/lib/settings/config'
import { useBusinessSettings } from '@/hooks/useBusinessSettings'

export interface FileStatus {
  file: File
  fileDate: string | null
  status: 'pending' | 'processing' | 'done' | 'error'
  result?: ImportResult
  error?: string
}

// product 임포트 미리보기 (dryRun) 결과
export interface ProductPreview {
  fileName: string
  totalRows: number
  errorRows: number
  insertedCount: number
  updatedCount: number
  skippedCount: number
  invalidStatusCount: number
  autoCalcIgnored: string[] // 자동계산 항목이라 무시된 컬럼
  ignoredColumns: string[] // 인식되지 않아 무시된 컬럼
  sampleRows: { rowIndex: number; optionId: string; isNew: boolean; data: Record<string, unknown> }[]
}

interface FileImportResponse {
  ok: boolean
  inserted: number
  updated: number
  skipped: number
  errors: string[]
  focusProducts?: number
  campaigns?: number
  warnings?: string[]
  error?: string
}

async function submitRawFile(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiFetch('/api/import/file', {
    method: 'POST',
    body: formData,
  })
  const body = await response.json().catch(() => ({})) as Partial<FileImportResponse>
  if (!response.ok) throw new Error(body.error || '파일 임포트 실패')

  const inserted = body.inserted ?? 0
  const updated = body.updated ?? 0
  const skipped = body.skipped ?? 0
  const errors = Array.isArray(body.errors) ? body.errors : []
  return {
    batchId: `file:${file.name}`,
    totalRows: inserted + updated + skipped,
    successCount: inserted + updated,
    errorCount: errors.length,
    skippedCount: skipped,
    errors: errors.map((message) => ({ row: 0, message })),
    insertedCount: inserted,
    updatedCount: updated,
    focusProductCount: body.focusProducts,
    campaignCount: body.campaigns,
    warnings: body.warnings,
  }
}

export function useImport() {
  const { settings } = useBusinessSettings()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([])
  const [preview, setPreview] = useState<ProductPreview | null>(null)
  const abortRef = useRef(false)

  const processOneFile = useCallback(async (
    file: File,
    importType: ImportType
  ): Promise<ImportResult> => {
    if (importType === 'ad_report') return submitRawFile(file)

    const buffer = await file.arrayBuffer()
    // 파싱·매핑·검증·날짜 상속은 서버 자동 임포트(/api/import/auto)와 공용 (assemble.ts)
    const config = resolveImportConfig(importType, settings?.importColumnMappings)
    const { validRows, invalidRows, fileDate } = assembleImportRows(
      buffer,
      importType,
      file.name,
      0,
      config
    )
    return submitImportBatch(importType, file.name, validRows, invalidRows, fileDate)
  }, [settings?.importColumnMappings])

  /** product 임포트 미리보기 — dryRun API로 신규/업데이트 판정만 (DB 쓰기 없음) */
  const previewProductFile = useCallback(async (file: File): Promise<ProductPreview | null> => {
    setImporting(true)
    setProgress('미리보기 분석 중...')
    setError(null)
    setResult(null)
    setPreview(null)

    try {
      const buffer = await file.arrayBuffer()
      const config = resolveImportConfig('product', settings?.importColumnMappings)
      const { rows, headers } = parseExcelFile(buffer, 'product')
      if (rows.length === 0) {
        throw new Error('파싱된 데이터가 없습니다. 파일 형식을 확인해주세요.')
      }

      const mapped = mapColumns(rows, config)
      const validated = mapped.map(validateProductRow)
      const validRows = validated.filter((r) => r.isValid)
      const invalidRows = validated.filter((r) => !r.isValid)
      if (validRows.length === 0) {
        throw new Error(`유효한 데이터가 없습니다. 전체 ${validated.length}행 중 ${invalidRows.length}행 오류.`)
      }

      // 무시 컬럼: 자동계산 항목 vs 미인식 컬럼 분리 안내
      const unmapped = getUnmappedHeaders(headers, config)
      const autoCalcIgnored = unmapped.filter((h) => PRODUCT_AUTO_CALC_COLUMNS.includes(h))
      const ignoredColumns = unmapped.filter((h) => !PRODUCT_AUTO_CALC_COLUMNS.includes(h))

      const res = await apiFetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importType: 'product',
          fileName: file.name,
          dryRun: true,
          rows: validRows.map((r) => r.data),
          totalRows: validated.length,
          errorCount: invalidRows.length,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || '미리보기 분석 실패')
      }
      const json = await res.json()
      const existingSet = new Set<string>(json.data.existingOptionIds || [])

      const sampleRows = validRows.slice(0, 5).map((r) => {
        const optionId = String(r.data.coupang_option_id || '')
        return { rowIndex: r.rowIndex, optionId, isNew: !existingSet.has(optionId), data: r.data }
      })

      const p: ProductPreview = {
        fileName: file.name,
        totalRows: validated.length,
        errorRows: invalidRows.length,
        insertedCount: json.data.insertedCount || 0,
        updatedCount: json.data.updatedCount || 0,
        skippedCount: json.data.skippedCount || 0,
        invalidStatusCount: json.data.invalidStatusCount || 0,
        autoCalcIgnored,
        ignoredColumns,
        sampleRows,
      }
      setPreview(p)
      setProgress('')
      return p
    } catch (err) {
      setError(err instanceof Error ? err.message : '미리보기 실패')
      return null
    } finally {
      setImporting(false)
    }
  }, [settings?.importColumnMappings])

  const clearPreview = useCallback(() => setPreview(null), [])

  /** 단일 파일 임포트 (기존 호환) */
  const importFile = useCallback(async (file: File, importType: ImportType) => {
    setImporting(true)
    setProgress('파일 읽는 중...')
    setError(null)
    setResult(null)
    setFileStatuses([])
    setPreview(null)

    try {
      const importResult = await processOneFile(file, importType)
      setResult(importResult)
      setProgress('완료')
      return importResult
    } catch (err) {
      const msg = err instanceof Error ? err.message : '임포트 실패'
      setError(msg)
      // 호출자가 실패를 성공 결과(null → 0건)로 오인하지 않도록 원래 오류를 전파한다.
      throw err instanceof Error ? err : new Error(msg)
    } finally {
      setImporting(false)
    }
  }, [processOneFile])

  /** 다중 파일 순차 임포트 */
  const importFiles = useCallback(async (files: File[], importType: ImportType) => {
    if (files.length === 0) return null

    // 단일 파일이면 기존 로직
    if (files.length === 1) {
      return importFile(files[0], importType)
    }

    abortRef.current = false
    setImporting(true)
    setError(null)
    setResult(null)

    // 파일명 날짜순 정렬
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))

    const initial: FileStatus[] = sorted.map((file) => ({
      file,
      fileDate: extractDateFromFilename(file.name),
      status: 'pending' as const,
    }))
    setFileStatuses(initial)

    let totalSuccess = 0
    let totalError = 0
    let totalSkipped = 0
    let totalRows = 0
    const allErrors: ImportResult['errors'] = []
    const allWarnings: string[] = []
    const allSkippedReasons: Record<string, number> = {}
    let totalMerged = 0
    let fallbackAgg: ImportResult['fallbackApplied'] | undefined
    let unmatchedAgg = 0

    for (let i = 0; i < sorted.length; i++) {
      if (abortRef.current) break

      const file = sorted[i]
      setProgress(`(${i + 1}/${sorted.length}) ${file.name}`)

      // 현재 파일 processing
      setFileStatuses((prev) =>
        prev.map((fs, idx) => idx === i ? { ...fs, status: 'processing' } : fs)
      )

      try {
        const res = await processOneFile(file, importType)
        totalSuccess += res.successCount
        totalError += res.errorCount
        totalSkipped += res.skippedCount
        totalRows += res.totalRows
        allErrors.push(...res.errors)
        if (res.warnings) allWarnings.push(...res.warnings)
        if (res.skippedReasons) {
          for (const [reason, count] of Object.entries(res.skippedReasons)) {
            allSkippedReasons[reason] = (allSkippedReasons[reason] || 0) + count
          }
        }
        if (res.mergedCount) totalMerged += res.mergedCount

        // Fallback 통계 집계
        if (res.fallbackApplied) {
          if (!fallbackAgg) fallbackAgg = { unitCost: 0, fulfillmentFee: 0, fulfillmentFeeMissingDefault: 0 }
          fallbackAgg.unitCost += res.fallbackApplied.unitCost
          fallbackAgg.fulfillmentFee += res.fallbackApplied.fulfillmentFee
          fallbackAgg.fulfillmentFeeMissingDefault += res.fallbackApplied.fulfillmentFeeMissingDefault || 0
        }
        if (res.unmatchedOptions) unmatchedAgg += res.unmatchedOptions

        setFileStatuses((prev) =>
          prev.map((fs, idx) => idx === i ? { ...fs, status: 'done', result: res } : fs)
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : '임포트 실패'
        totalError++
        allErrors.push({ row: 0, message: `[${file.name}] ${msg}` })

        setFileStatuses((prev) =>
          prev.map((fs, idx) => idx === i ? { ...fs, status: 'error', error: msg } : fs)
        )
      }
    }

    const combined: ImportResult = {
      batchId: 'multi',
      totalRows,
      successCount: totalSuccess,
      errorCount: totalError,
      skippedCount: totalSkipped,
      errors: allErrors.slice(0, 20),
      warnings: allWarnings.slice(0, 20),
      skippedReasons: Object.keys(allSkippedReasons).length > 0 ? allSkippedReasons : undefined,
      mergedCount: totalMerged || undefined,
      ...(fallbackAgg ? { fallbackApplied: fallbackAgg, unmatchedOptions: unmatchedAgg } : {}),
    }

    setResult(combined)
    setProgress(`완료 (${sorted.length}개 파일)`)
    setImporting(false)
    return combined
  }, [importFile, processOneFile])

  const abort = useCallback(() => {
    abortRef.current = true
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    setProgress('')
    setFileStatuses([])
    setPreview(null)
    abortRef.current = false
  }, [])

  return { importing, progress, result, error, setError, fileStatuses, preview, previewProductFile, clearPreview, importFile, importFiles, abort, reset }
}
