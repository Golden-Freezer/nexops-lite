import { TrendingUp, TrendingDown } from 'lucide-react'

interface DeltaBadgeProps {
  value: number // % 값 (예: 12.3 → '+12.3%')
  invert?: boolean // 지출계열(증가=나쁨) 색 반전
}

/** 전기 대비 변화 뱃지 — 색상 단독 의미 전달 금지 규칙에 따라 부호/화살표 병행 */
export function DeltaBadge({ value, invert = false }: DeltaBadgeProps) {
  if (value === 0 || !Number.isFinite(value)) {
    return (
      <span className="flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
        —
      </span>
    )
  }

  const up = value > 0
  const good = invert ? !up : up
  const toneClass = good ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'

  return (
    <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${toneClass}`}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {up ? '+' : '-'}{Math.abs(value).toFixed(1)}%
    </span>
  )
}
