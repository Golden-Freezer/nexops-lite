'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import {
  exportData,
  type ExportColumn,
  type ExportFormat,
} from '@/lib/export/excel'

interface ExportButtonProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]
  columns: ExportColumn[]
  filename: string
  sheetName: string
  disabled?: boolean
  title?: string
  className?: string
}

/** CSV/XLSX 형식을 명시적으로 선택하는 공용 다운로드 액션. */
export function ExportButton({
  data,
  columns,
  filename,
  sheetName,
  disabled,
  title,
  className = '',
}: ExportButtonProps) {
  const [format, setFormat] = useState<ExportFormat>('xlsx')

  return (
    <div className={`flex items-center ${className}`} title={title}>
      <select
        value={format}
        onChange={(event) => setFormat(event.target.value as ExportFormat)}
        disabled={disabled}
        aria-label="다운로드 형식"
        className="h-8 rounded-l border border-r-0 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500 disabled:opacity-40"
      >
        <option value="xlsx">XLSX</option>
        <option value="csv">CSV</option>
      </select>
      <button
        type="button"
        onClick={() => exportData(data, columns, filename, sheetName, format)}
        disabled={disabled}
        className="flex h-8 items-center gap-1 rounded-r border border-slate-200 px-2.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" /> 다운로드
      </button>
    </div>
  )
}
