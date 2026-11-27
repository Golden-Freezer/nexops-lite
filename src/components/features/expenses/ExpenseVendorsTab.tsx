'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Store } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  type ExpenseVendor,
  type ExpenseVendorForm,
} from '@/types/purchases'

const EMPTY_FORM: ExpenseVendorForm = {
  name: '',
  businessNumber: '',
  contact: '',
  defaultCategory: '',
  defaultPaymentMethod: '',
  notes: '',
}

export function ExpenseVendorsTab() {
  const [vendors, setVendors] = useState<ExpenseVendor[]>([])
  const [form, setForm] = useState<ExpenseVendorForm>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/expense-vendors?includeInactive=true')
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

  const saveVendor = async () => {
    if (!form.name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/expense-vendors', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setForm(EMPTY_FORM)
      setEditingId(null)
      setShowForm(false)
      await fetchVendors()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '거래처 저장 실패')
      setLoading(false)
    }
  }

  const startEdit = (vendor: ExpenseVendor) => {
    setEditingId(vendor.id)
    setForm({
      name: vendor.name,
      businessNumber: vendor.business_number || '',
      contact: vendor.contact || '',
      defaultCategory: vendor.default_category || '',
      defaultPaymentMethod: vendor.default_payment_method || '',
      notes: vendor.notes || '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const toggleActive = async (vendor: ExpenseVendor) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/expense-vendors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: vendor.id, isActive: !vendor.is_active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await fetchVendors()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '거래처 수정 실패')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">지출 거래처</h2>
          <p className="text-xs text-slate-400">반복 지출의 기본 카테고리와 결제수단을 관리합니다.</p>
        </div>
        <button
          onClick={() => showForm ? closeForm() : setShowForm(true)}
          className="flex h-8 items-center gap-1 rounded bg-brand-500 px-3 text-xs font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" /> {showForm ? '입력 닫기' : '거래처 등록'}
        </button>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="거래처명 *" className="h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            <input value={form.businessNumber || ''} onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
              placeholder="사업자번호" className="h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            <input value={form.contact || ''} onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="연락처" className="h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            <select value={form.defaultCategory || ''} onChange={(e) => setForm({ ...form, defaultCategory: e.target.value })}
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm">
              <option value="">기본 카테고리 없음</option>
              {EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
            <select value={form.defaultPaymentMethod || ''} onChange={(e) => setForm({ ...form, defaultPaymentMethod: e.target.value })}
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm">
              <option value="">기본 결제수단 없음</option>
              {EXPENSE_PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
            <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="메모" className="h-9 rounded-lg border border-slate-200 px-3 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={closeForm} className="h-8 rounded border border-slate-200 px-3 text-xs text-slate-600">취소</button>
            <button onClick={saveVendor} disabled={loading || !form.name.trim()}
              className="h-8 rounded bg-brand-500 px-4 text-xs font-medium text-white disabled:opacity-50">
              {editingId ? '수정 저장' : '저장'}
            </button>
          </div>
        </div>
      )}

      {loading && vendors.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : vendors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <Store className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-xs text-slate-400">등록된 거래처가 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">거래처</th>
                <th className="px-3 py-2 text-left">사업자번호 / 연락처</th>
                <th className="px-3 py-2 text-left">기본값</th>
                <th className="px-3 py-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className={!vendor.is_active ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 font-medium text-slate-700">{vendor.name}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {[vendor.business_number, vendor.contact].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {[vendor.default_category, vendor.default_payment_method && EXPENSE_PAYMENT_METHOD_LABELS[vendor.default_payment_method]]
                      .filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => startEdit(vendor)} disabled={loading}
                        className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600">
                        수정
                      </button>
                      <button onClick={() => toggleActive(vendor)} disabled={loading}
                        className={`rounded-full px-2 py-1 text-[10px] ${vendor.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {vendor.is_active ? '사용중' : '중지됨'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
