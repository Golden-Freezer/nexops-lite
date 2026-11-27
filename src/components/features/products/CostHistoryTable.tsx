'use client'

import { formatKRW, formatPercent, marginColorClass } from '@/lib/utils'
import type { CostHistoryItem } from '@/types/product'

interface CostHistoryTableProps {
  items: CostHistoryItem[]
}

export function CostHistoryTable({ items }: CostHistoryTableProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
        <p className="text-sm text-slate-400">원가 기록이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">원가 히스토리</h3>
        <p className="text-xs text-slate-400">최신 순 정렬 (immutable history)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">날짜</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">원가</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">판매가</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">마진</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">마진율</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">ROAS</th>
              <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">공급처</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={item.id}
                className={`border-b border-slate-100 ${i === 0 ? 'bg-brand-50/30' : ''}`}
              >
                <td className="px-4 py-2 text-xs text-slate-500">
                  {new Date(item.createdAt).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">
                  {formatKRW(item.unitCost)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">
                  {formatKRW(item.sellingPrice)}
                </td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${marginColorClass(item.marginRate)}`}>
                  {formatKRW(item.margin)}
                </td>
                <td className={`px-4 py-2 text-right font-mono ${marginColorClass(item.marginRate)}`}>
                  {formatPercent(item.marginRate)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-600">
                  {item.minRoas === Infinity ? '∞' : item.minRoas.toFixed(1)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {item.supplierName || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
