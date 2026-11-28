'use client'

/**
 * 쿠팡 카테고리 메타 패널 (WS-C, 읽기 전용) — 확정된 displayCategoryCode의 고시정보 항목·필수 옵션·
 * 인증·필수 서류를 쿠팡에서 불러와, 오너가 고시정보 유형을 고르면 그 항목들을 등록 폼의 고시정보에
 * 채운다. 쿠팡 쓰기 없음. 사업장 크레덴셜이 필요하므로 businessId가 있어야 호출한다.
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

interface NoticeGroup {
  name: string
  details: { name: string; required: boolean }[]
}
interface Meta {
  isAllowSingleItem: boolean | null
  allowedOfferConditions: string[]
  noticeCategories: NoticeGroup[]
  attributes: { name: string; dataType: string | null; required: boolean; exposed: boolean; units: string[] }[]
  requiredDocuments: { name: string; required: string }[]
  certifications: { name: string; required: string }[]
}

export function RegistrationCategoryMeta({
  businessId,
  displayCategoryCode,
  onApplyNotice,
}: {
  businessId: string | null
  displayCategoryCode: number | null
  /** 선택한 고시정보 유형의 항목명들을 등록 폼 고시정보 키로 채운다. */
  onApplyNotice: (itemNames: string[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [noticeIdx, setNoticeIdx] = useState(0)

  async function loadMeta() {
    if (!displayCategoryCode) {
      setError('먼저 등록 카테고리(leaf 코드)를 정하세요.')
      return
    }
    if (!businessId) {
      setError('사업장을 먼저 선택하세요.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/sourcing/category-meta?displayCategoryCode=${displayCategoryCode}&businessId=${encodeURIComponent(businessId)}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '메타 조회 실패')
      setMeta(json.data as Meta)
      setNoticeIdx(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '메타 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  const group = meta?.noticeCategories[noticeIdx] ?? null
  const requiredAttrs = (meta?.attributes ?? []).filter((a) => a.required)

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">쿠팡 카테고리 메타 (고시정보·옵션)</span>
        <button
          onClick={loadMeta}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-brand-200 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          불러오기
        </button>
      </div>

      {error && <div className="text-[11px] text-danger-600">{error}</div>}
      {!meta && !error && (
        <div className="text-[11px] text-slate-400">카테고리 코드를 정한 뒤 불러오면 고시정보 항목·필수 옵션이 표시됩니다.</div>
      )}

      {meta && (
        <div className="space-y-3">
          {/* 고시정보 유형 선택 → 폼에 채우기 */}
          {meta.noticeCategories.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500">상품정보제공고시 유형</label>
              <div className="flex items-center gap-2">
                <select
                  value={noticeIdx}
                  onChange={(e) => setNoticeIdx(Number(e.target.value))}
                  className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400 bg-white"
                >
                  {meta.noticeCategories.map((g, i) => (
                    <option key={i} value={i}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => group && onApplyNotice(group.details.map((d) => d.name))}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-brand-500 text-white hover:bg-brand-600 whitespace-nowrap"
                >
                  폼에 채우기
                </button>
              </div>
              {group && (
                <div className="text-[10px] text-slate-400">
                  항목 {group.details.length}개 · 필수 {group.details.filter((d) => d.required).length}개
                </div>
              )}
            </div>
          )}

          {/* 읽기 전용 요약 */}
          <div className="grid grid-cols-1 gap-1.5 text-[11px] text-slate-500">
            {requiredAttrs.length > 0 && (
              <div>
                <span className="text-slate-400">필수 옵션:</span> {requiredAttrs.map((a) => a.name).join(', ')}
              </div>
            )}
            {meta.certifications.length > 0 && (
              <div>
                <span className="text-slate-400">인증:</span> {meta.certifications.map((c) => c.name).join(', ')}
              </div>
            )}
            {meta.requiredDocuments.length > 0 && (
              <div>
                <span className="text-slate-400">필수 서류(조건부):</span> {meta.requiredDocuments.map((d) => d.name).join(', ')}
              </div>
            )}
            <div>
              <span className="text-slate-400">판매조건:</span> {meta.allowedOfferConditions.join(', ') || '-'}
              {meta.isAllowSingleItem != null && <span className="ml-2">단일상품 {meta.isAllowSingleItem ? '허용' : '불가'}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
