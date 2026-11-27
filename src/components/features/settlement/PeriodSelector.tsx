'use client'

import { Calendar } from 'lucide-react'
import type { PeriodFilter } from '@/types/settlement'
import { getPresetDates } from '@/hooks/useReport'

interface PeriodSelectorProps {
  value: PeriodFilter
  onChange: (filter: PeriodFilter) => void
}

type PresetType = 'week' | 'last7' | 'last30' | 'month' | 'last-month'

const PRESETS: { type: PresetType; label: string }[] = [
  { type: 'week', label: '이번 주' },
  { type: 'last7', label: '최근 7일' },
  { type: 'month', label: '이번 달' },
  { type: 'last30', label: '최근 30일' },
  { type: 'last-month', label: '지난 달' },
]

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const handlePreset = (type: PresetType) => {
    const dates = getPresetDates(type)
    onChange({ type, ...dates })
  }

  const handleCustomDate = (field: 'periodStart' | 'periodEnd', dateStr: string) => {
    onChange({
      ...value,
      type: 'custom',
      [field]: dateStr,
    })
  }

  const inputClass =
    'w-full h-10 px-3 border border-slate-200 rounded-lg text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors'

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* 프리셋 버튼 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
          {PRESETS.map((preset) => (
            <button
              key={preset.type}
              onClick={() => handlePreset(preset.type)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                value.type === preset.type
                  ? 'bg-brand-50 text-brand-600 border border-brand-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* 구분선 */}
        <div className="hidden sm:block w-px h-6 bg-slate-200" />

        {/* 커스텀 날짜 입력 */}
        <div className="flex items-center gap-2 flex-1">
          <input
            type="date"
            value={value.periodStart}
            onChange={(e) => handleCustomDate('periodStart', e.target.value)}
            className={`${inputClass} max-w-[160px]`}
          />
          <span className="text-sm text-slate-400 shrink-0">~</span>
          <input
            type="date"
            value={value.periodEnd}
            onChange={(e) => handleCustomDate('periodEnd', e.target.value)}
            className={`${inputClass} max-w-[160px]`}
          />
        </div>
      </div>
    </div>
  )
}
