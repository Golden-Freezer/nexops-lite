import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 금액 포맷 (한국 원화) */
export function formatKRW(amount: number): string {
  return amount.toLocaleString('ko-KR') + '원'
}

/** 퍼센트 포맷 (소수점 1자리) */
export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

/** 마진율에 따른 색상 클래스 */
export function marginColorClass(rate: number): string {
  if (rate < 0) return 'text-danger-600'
  if (rate < 0.1) return 'text-warning-600'
  return 'text-positive-600'
}
