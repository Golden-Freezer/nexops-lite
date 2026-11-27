'use client'

/**
 * PdpForm/PdpFormPro 공용 입력 프리미티브 (프레젠테이션 전용, 상태 없음).
 * RegistrationFormFields.tsx의 TextField/NumberField 패턴을 그대로 따른다.
 */

import type { ReactNode } from 'react'

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold text-slate-600 mt-1">{children}</h4>
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
      />
    </label>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  disabled,
  suffix,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  disabled?: boolean
  suffix?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <div className="flex items-center gap-1">
        <input
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            const t = e.target.value.trim()
            if (t === '') return onChange(undefined)
            const n = Number(t)
            if (Number.isFinite(n)) onChange(n)
          }}
          disabled={disabled}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
        />
        {suffix && <span className="text-[11px] text-slate-400 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
      />
    </label>
  )
}

/** 줄바꿈/쉼표 구분 태그 입력 — 검색태그 입력(RegistrationFormFields)과 동일 파싱 관례 */
export function TagsField({
  label,
  values,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <textarea
        value={values.join('\n')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/[\n,]/)
              .map((t) => t.trim())
              .filter(Boolean)
          )
        }
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
      />
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
