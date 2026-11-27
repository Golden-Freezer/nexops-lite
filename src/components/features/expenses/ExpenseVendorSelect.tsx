'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type ExpenseVendor,
  type ExpenseVendorForm,
} from '@/types/purchases'

interface ExpenseVendorSelectProps {
  value?: string | null
  onSelect: (vendor: ExpenseVendor | null) => void
}

const EMPTY_VENDOR: ExpenseVendorForm = {
  name: '',
  defaultCategory: '',
  defaultPaymentMethod: '',
}

export function ExpenseVendorSelect({ value, onSelect }: ExpenseVendorSelectProps) {
  const [vendors, setVendors] = useState<ExpenseVendor[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<ExpenseVendorForm>(EMPTY_VENDOR)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/expense-vendors')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setVendors(json.data || [])
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '거래처 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/expense-vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const vendor = json.data as ExpenseVendor
      setVendors((current) => [...current, vendor].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
      setForm(EMPTY_VENDOR)
      setShowCreate(false)
      onSelect(vendor)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '거래처 등록 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-600">거래처</label>
        <button
          type="button"
          onClick={() => setShowCreate((current) => !current)}
          className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
        >
          {showCreate ? '취소' : '+ 빠른 등록'}
        </button>
      </div>

      {!showCreate && (
        <select
          value={value || ''}
          disabled={loading}
          onChange={(event) => {
            const vendor = vendors.find((item) => item.id === event.target.value) || null
            onSelect(vendor)
          }}
          className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">거래처 선택 안 함</option>
          {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      )}

      {showCreate && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="거래처명 *"
            className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.defaultCategory || ''}
              onChange={(event) => setForm((current) => ({ ...current, defaultCategory: event.target.value }))}
              className="h-9 px-2 border border-slate-200 rounded-lg text-xs"
            >
              <option value="">기본 카테고리 없음</option>
              {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <select
              value={form.defaultPaymentMethod || ''}
              onChange={(event) => setForm((current) => ({ ...current, defaultPaymentMethod: event.target.value }))}
              className="h-9 px-2 border border-slate-200 rounded-lg text-xs"
            >
              <option value="">기본 결제수단 없음</option>
              {EXPENSE_PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading || !form.name.trim()}
            className="w-full h-8 rounded bg-brand-500 text-xs font-medium text-white disabled:opacity-50"
          >
            {loading ? '등록 중...' : '거래처 등록 후 선택'}
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
