'use client'

import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X, XCircle, Info, AlertTriangle, Building2 } from 'lucide-react'
import type { ImportType } from '@/types/import'
import { useImport } from '@/hooks/useImport'
import type { FileStatus } from '@/hooks/useImport'
import { extractDateFromFilename } from '@/lib/import/parser'
import { useBusinessContext } from '@/hooks/useBusiness'

const IMPORT_LABELS: Record<ImportType, { title: string; description: string }> = {
  sales: {
    title: '판매 통계 (Statistics)',
    description: '쿠팡윙 > 판매관리 > 판매통계에서 다운로드한 xlsx 파일 (다중 선택 가능)',
  },
  inventory_health: {
    title: '재고 건강 (inventory_health_sku_info)',
    description: '쿠팡윙 > 재고관리 > SKU 재고건강에서 다운로드한 xlsx 파일',
  },
  ad_billing: {
    title: '광고 정산 (dailySettlement)',
    description: '쿠팡윙 > 광고 > 일별 정산에서 다운로드한 xlsx 파일 (다중 선택 가능)',
  },
  ledger: {
    title: '판매장부 (전체)',
    description: '그로스판매장부 xlsx 파일 (21개 시트)',
  },
  product: {
    title: '상품 마스터 (01.상품)',
    description: '그로스판매장부의 01.상품 시트 또는 상품 목록 xlsx 파일',
  },
  purchase: {
    title: '매입 내역 (DB_구매)',
    description: '그로스판매장부의 DB_구매 시트에서 매입 내역을 가져옵니다',
  },
}

interface FileImporterProps {
  importType: ImportType
  onComplete?: () => void
}

function FileStatusRow({ fs, index }: { fs: FileStatus; index: number }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="w-5 text-center text-slate-400">{index + 1}</span>
      {fs.status === 'pending' && <span className="w-4 h-4 rounded-full bg-slate-200" />}
      {fs.status === 'processing' && <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />}
      {fs.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
      {fs.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
      <span className="truncate flex-1 text-slate-700">{fs.file.name}</span>
      {fs.fileDate && <span className="text-slate-400 shrink-0">{fs.fileDate}</span>}
      {fs.status === 'done' && fs.result && (
        <span className="text-green-600 shrink-0">{fs.result.successCount}건</span>
      )}
      {fs.status === 'error' && fs.error && (
        <span className="text-red-500 shrink-0 truncate max-w-[160px]" title={fs.error}>{fs.error}</span>
      )}
    </div>
  )
}

export function FileImporter({ importType, onComplete }: FileImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const { importing, progress, result, error, fileStatuses, preview, previewProductFile, clearPreview, importFile, importFiles, abort, reset } = useImport()
  const { currentBusiness } = useBusinessContext()

  // 오임포트 신호: 기존 상품과 하나도 매칭되지 않음 → 다른 사업장에 임포트 중일 가능성
  const wrongBusinessSuspect = preview != null && preview.updatedCount === 0 && preview.insertedCount > 0

  const label = IMPORT_LABELS[importType]

  // product 단일 파일: 미리보기(dryRun) → 확인 후 임포트 2단계 플로우
  const isProductPreviewFlow = importType === 'product' && selectedFiles.length === 1

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files))
      reset()
    }
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleImport = async () => {
    if (selectedFiles.length === 0) return

    // product: 먼저 미리보기 실행 (실제 반영은 handleConfirmImport)
    if (isProductPreviewFlow && !preview) {
      await previewProductFile(selectedFiles[0])
      return
    }

    try {
      const res = selectedFiles.length === 1
        ? await importFile(selectedFiles[0], importType)
        : await importFiles(selectedFiles, importType)

      if (res && onComplete) {
        onComplete()
      }
    } catch {
      // useImport가 설정한 오류 메시지를 아래 오류 패널에서 표시한다.
    }
  }

  const handleConfirmImport = async () => {
    if (selectedFiles.length !== 1) return
    try {
      const res = await importFile(selectedFiles[0], importType)
      if (res && onComplete) {
        onComplete()
      }
    } catch {
      // useImport가 설정한 오류 메시지를 아래 오류 패널에서 표시한다.
    }
  }

  const handleReset = () => {
    setSelectedFiles([])
    reset()
    if (fileRef.current) fileRef.current.value = ''
  }

  // 날짜별 정렬된 파일 목록 (미리보기)
  const sortedPreview = [...selectedFiles].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{label.title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{label.description}</p>
      </div>

      {/* 파일 선택 */}
      <div
        onClick={() => !importing && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          importing ? 'border-slate-200 bg-slate-50 cursor-not-allowed' : 'border-slate-300 cursor-pointer hover:border-brand-400 hover:bg-brand-50/50'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        {selectedFiles.length > 0 ? (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-700">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <span>{selectedFiles.length}개 파일 선택됨</span>
            <span className="text-slate-400">
              ({(selectedFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB)
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            <Upload className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-500">xlsx 파일을 선택하세요 (Ctrl+클릭으로 다중 선택)</p>
          </div>
        )}
      </div>

      {/* 선택된 파일 미리보기 (임포트 전) */}
      {selectedFiles.length > 1 && !importing && !result && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto space-y-0.5">
          <div className="text-xs font-medium text-slate-500 mb-1">
            {selectedFiles.length}개 파일 (날짜순 처리)
          </div>
          {sortedPreview.map((file, i) => {
            const date = extractDateFromFilename(file.name)
            const originalIdx = selectedFiles.indexOf(file)
            return (
              <div key={i} className="flex items-center gap-2 text-xs py-0.5 group">
                <span className="w-5 text-center text-slate-400">{i + 1}</span>
                <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
                <span className="truncate flex-1 text-slate-600">{file.name}</span>
                {date && <span className="text-slate-400 shrink-0">{date}</span>}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(originalIdx) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200 rounded transition-opacity"
                >
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 진행 중 파일 상태 */}
      {fileStatuses.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-60 overflow-y-auto space-y-0.5">
          <div className="text-xs font-medium text-slate-500 mb-1">{progress}</div>
          {fileStatuses.map((fs, i) => (
            <FileStatusRow key={i} fs={fs} index={i} />
          ))}
        </div>
      )}

      {/* product 미리보기 패널 (dryRun 결과 — 아직 미반영) */}
      {preview && !result && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <Info className="w-4 h-4 shrink-0" /> 임포트 미리보기 — 아직 반영되지 않았습니다
            {currentBusiness && (
              <span className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-blue-200 text-xs font-semibold text-blue-800">
                <Building2 className="w-3 h-3" /> {currentBusiness.business_name}
              </span>
            )}
          </div>
          {wrongBusinessSuspect && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>업데이트 0건 — 파일의 모든 상품이 신규 등록됩니다.</b><br />
                기존 상품과 하나도 매칭되지 않았습니다. 다른 사업장의 파일을 임포트하는 것일 수 있으니,
                현재 사업장{currentBusiness ? ` (${currentBusiness.business_name})` : ''}이 맞는지 확인 후 진행하세요.
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>신규 등록 <b className="text-blue-700">{preview.insertedCount}</b>건</span>
            <span>업데이트 <b className="text-amber-600">{preview.updatedCount}</b>건</span>
            {preview.skippedCount > 0 && <span>제외(옵션 ID 없음) {preview.skippedCount}건</span>}
            {preview.errorRows > 0 && <span className="text-red-600">오류 {preview.errorRows}행</span>}
            {preview.invalidStatusCount > 0 && <span className="text-amber-600">판매상태 인식불가 {preview.invalidStatusCount}건 (해당 필드만 무시)</span>}
          </div>
          {(preview.autoCalcIgnored.length > 0 || preview.ignoredColumns.length > 0) && (
            <div className="text-[11px] text-slate-500 space-y-0.5">
              {preview.autoCalcIgnored.length > 0 && (
                <div>자동계산 항목이라 무시됨: {preview.autoCalcIgnored.join(', ')}</div>
              )}
              {preview.ignoredColumns.length > 0 && (
                <div>인식되지 않아 무시됨: {preview.ignoredColumns.join(', ')}</div>
              )}
            </div>
          )}
          {/* 상위 5행 미리보기 */}
          <div className="overflow-x-auto bg-white rounded border border-blue-100">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-slate-500">
                  <th className="px-2 py-1 text-left font-medium">구분</th>
                  <th className="px-2 py-1 text-left font-medium">옵션 ID</th>
                  <th className="px-2 py-1 text-left font-medium">상품명</th>
                  <th className="px-2 py-1 text-left font-medium">옵션명</th>
                  <th className="px-2 py-1 text-right font-medium">판매가</th>
                  <th className="px-2 py-1 text-right font-medium">원가(기본)</th>
                  <th className="px-2 py-1 text-center font-medium">판매상태</th>
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((r) => (
                  <tr key={r.rowIndex} className="border-b border-slate-50">
                    <td className="px-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.isNew ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.isNew ? '신규' : '수정'}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-slate-600">{r.optionId}</td>
                    <td className="px-2 py-1 max-w-[180px] truncate text-slate-700">{String(r.data.coupang_display_name || r.data.product_name || '-')}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate text-slate-600">{String(r.data.option_name || '-')}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.data.condition_value != null ? Number(r.data.condition_value).toLocaleString() : '-'}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.data.unit_cost_default != null ? Number(r.data.unit_cost_default).toLocaleString() : '-'}</td>
                    <td className="px-2 py-1 text-center text-slate-600">{String(r.data.sales_status_raw || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.totalRows - preview.errorRows > preview.sampleRows.length && (
              <div className="px-2 py-1 text-[10px] text-slate-400">... 외 {preview.totalRows - preview.errorRows - preview.sampleRows.length}행</div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmImport}
              disabled={importing}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? progress : `${preview.insertedCount + preview.updatedCount}건 확인 후 임포트`}
            </button>
            <button
              onClick={clearPreview}
              disabled={importing}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 임포트 / 중단 버튼 */}
      {selectedFiles.length > 0 && !result && !preview && (
        <div className="flex gap-2">
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {isProductPreviewFlow ? '미리보기' : selectedFiles.length > 1 ? `${selectedFiles.length}개 파일 임포트` : '임포트 시작'}
              </>
            )}
          </button>
          {importing && !isProductPreviewFlow && (
            <button
              onClick={abort}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
            >
              중단
            </button>
          )}
        </div>
      )}

      {/* 완료 결과 */}
      {result && (
        <div className="space-y-2">
          {/* 메인 결과: 실제 오류가 있을 때만 amber, 아니면 green */}
          <div className={`rounded-lg p-3 text-sm ${result.errorCount > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
            <div className="flex items-center gap-2">
              {result.errorCount > 0 ? (
                <AlertCircle className="w-4 h-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              )}
              <span className="font-medium">
                {result.successCount}건 성공
                {result.errorCount > 0 && ` / ${result.errorCount}건 오류`}
                {' '}(전체 {result.totalRows}건)
              </span>
            </div>
            {(result.insertedCount != null || result.updatedCount != null) && (
              <p className="mt-1 ml-6 text-xs text-slate-600">
                신규 등록 {result.insertedCount ?? 0}건 · 업데이트 {result.updatedCount ?? 0}건
                {(result.invalidStatusCount ?? 0) > 0 && ` · 판매상태 인식불가 ${result.invalidStatusCount}건 무시`}
              </p>
            )}
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {result.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>{err.row > 0 ? `행 ${err.row}: ` : ''}{err.message}</li>
                ))}
                {result.errors.length > 5 && (
                  <li className="text-slate-400">... 외 {result.errors.length - 5}건</li>
                )}
              </ul>
            )}
          </div>
          {/* 자동 제외 안내 (스킵/합산) — 회색 info 스타일 */}
          {(result.skippedCount > 0 || (result.mergedCount && result.mergedCount > 0)) && (
            <div className="rounded-lg p-3 text-sm bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500">
                <Info className="w-4 h-4 shrink-0" />
                <span className="font-medium">
                  {result.skippedCount > 0 && `${result.skippedCount}건 자동 제외`}
                  {result.skippedCount > 0 && result.mergedCount && result.mergedCount > 0 && ', '}
                  {result.mergedCount && result.mergedCount > 0 && `${result.mergedCount}건 합산 처리`}
                </span>
              </div>
              {result.skippedReasons && Object.keys(result.skippedReasons).length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-slate-400 ml-6">
                  {Object.entries(result.skippedReasons).map(([reason, count]) => (
                    <li key={reason}>{reason}: {count}건</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* Fallback 적용 현황 (판매통계 전용) */}
          {result.fallbackApplied && (
            result.fallbackApplied.unitCost > 0 ||
            result.fallbackApplied.fulfillmentFee > 0 ||
            result.fallbackApplied.fulfillmentFeeMissingDefault > 0
          ) && (
            <div className="rounded-lg p-3 text-sm bg-blue-50 border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700">
                <Info className="w-4 h-4 shrink-0" />
                <span className="font-medium">상품 마스터 기본값 적용</span>
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-blue-600 ml-6">
                {result.fallbackApplied.unitCost > 0 && (
                  <li>원가 0원 → 기본 원가 적용: {result.fallbackApplied.unitCost}건</li>
                )}
                {result.fallbackApplied.fulfillmentFee > 0 && (
                  <li>입출고비 0원 → 기본 입출고비 적용: {result.fallbackApplied.fulfillmentFee}건</li>
                )}
                {result.fallbackApplied.fulfillmentFeeMissingDefault > 0 && (
                  <li>입출고비 기본값 없음 (혜택기간 아님): {result.fallbackApplied.fulfillmentFeeMissingDefault}건</li>
                )}
              </ul>
            </div>
          )}
          {result.unmatchedOptions != null && result.unmatchedOptions > 0 && (
            <div className="rounded-lg p-3 text-xs bg-slate-50 border border-slate-200 text-slate-500">
              상품 매칭 안 됨: {result.unmatchedOptions}개 옵션 (상품 관리에서 쿠팡 옵션ID 등록 필요)
            </div>
          )}
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            다시 임포트
          </button>
        </div>
      )}

      {/* 에러 */}
      {error && !result && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  )
}
