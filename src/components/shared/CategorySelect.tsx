'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CategoryNode } from '@/types/calc'

interface CategorySelectProps {
  onRateChange?: (rate: number) => void
  onCategoryChange?: (path: string, categories: { major: string; mid: string; sub: string }) => void
  initialCategory?: { major: string; mid: string; sub: string }
}

export function CategorySelect({ onRateChange, onCategoryChange, initialCategory }: CategorySelectProps) {
  const [tree, setTree] = useState<CategoryNode[]>([])
  const [major, setMajor] = useState(initialCategory?.major ?? '')
  const [mid, setMid] = useState(initialCategory?.mid ?? '')
  const [sub, setSub] = useState(initialCategory?.sub ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 카테고리 트리 로드
  const loadTree = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/commission', { method: 'POST' })
      .then((res) => res.json())
      .then((res) => {
        if (res.data && res.data.length > 0) {
          setTree(res.data)
        } else {
          setError('카테고리 데이터를 불러오지 못했습니다.')
        }
      })
      .catch(() => {
        setError('카테고리 로딩 중 오류가 발생했습니다.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  const majorNodes = tree
  const midNodes = major ? tree.find((n) => n.value === major)?.children ?? [] : []
  const subNodes = mid
    ? midNodes.find((n) => n.value === mid)?.children ?? []
    : []

  // 카테고리 경로 문자열 생성
  const buildPath = useCallback((majorVal: string, midVal: string, subVal: string) => {
    const parts = [majorVal, midVal, subVal].filter(Boolean)
    return parts.join(' > ')
  }, [])

  // 수수료율 자동 연동
  const applyRate = useCallback(
    (majorVal: string, midVal: string, subVal: string) => {
      let rate: number | undefined

      // 소분류 > 중분류 > 대분류 순 탐색
      if (subVal && midVal && majorVal) {
        const subNode = tree
          .find((n) => n.value === majorVal)
          ?.children?.find((n) => n.value === midVal)
          ?.children?.find((n) => n.value === subVal)
        rate = subNode?.rate
      }
      if (rate === undefined && midVal && majorVal) {
        const midNode = tree
          .find((n) => n.value === majorVal)
          ?.children?.find((n) => n.value === midVal)
        rate = midNode?.rate
      }
      if (rate === undefined && majorVal) {
        const majorNode = tree.find((n) => n.value === majorVal)
        rate = majorNode?.rate
      }

      if (rate !== undefined) {
        onRateChange?.(rate)
      }
    },
    [tree, onRateChange]
  )

  const notifyChange = useCallback(
    (majorVal: string, midVal: string, subVal: string) => {
      applyRate(majorVal, midVal, subVal)
      onCategoryChange?.(buildPath(majorVal, midVal, subVal), {
        major: majorVal,
        mid: midVal,
        sub: subVal,
      })
    },
    [applyRate, onCategoryChange, buildPath]
  )

  const handleMajor = (val: string) => {
    setMajor(val)
    setMid('')
    setSub('')
    notifyChange(val, '', '')
  }

  const handleMid = (val: string) => {
    setMid(val)
    setSub('')
    notifyChange(major, val, '')
  }

  const handleSub = (val: string) => {
    setSub(val)
    notifyChange(major, mid, val)
  }

  const selectClass =
    'w-full h-10 px-3 border border-slate-200 rounded-lg text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-colors bg-white'

  if (loading) {
    return (
      <div className="text-xs text-slate-400 py-2">카테고리 로딩 중...</div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="text-xs text-red-500">{error}</span>
        <button
          onClick={loadTree}
          className="text-xs text-brand-500 hover:text-brand-600 underline"
        >
          재시도
        </button>
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="text-xs text-slate-400">카테고리 데이터가 없습니다.</span>
        <button
          onClick={loadTree}
          className="text-xs text-brand-500 hover:text-brand-600 underline"
        >
          재시도
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-slate-700 block">
        카테고리 (수수료 자동 연동)
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* 대분류 */}
        <select value={major} onChange={(e) => handleMajor(e.target.value)} className={selectClass}>
          <option value="">대분류 선택</option>
          {majorNodes.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>

        {/* 중분류 */}
        <select
          value={mid}
          onChange={(e) => handleMid(e.target.value)}
          className={selectClass}
          disabled={midNodes.length === 0}
        >
          <option value="">중분류 선택</option>
          {midNodes.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>

        {/* 소분류 */}
        <select
          value={sub}
          onChange={(e) => handleSub(e.target.value)}
          className={selectClass}
          disabled={subNodes.length === 0}
        >
          <option value="">소분류 선택</option>
          {subNodes.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
