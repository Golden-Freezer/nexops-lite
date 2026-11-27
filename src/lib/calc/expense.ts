/** 공급가액 기준 부가세 10%를 원 단위로 반올림한다. */
export function calculateExpenseVat(supplyAmount: number): number {
  if (!Number.isFinite(supplyAmount) || supplyAmount <= 0) return 0
  return Math.round(supplyAmount * 0.1)
}

export function calculateExpenseTotal(supplyAmount: number, vatAmount: number): number {
  return Math.max(0, supplyAmount || 0) + Math.max(0, vatAmount || 0)
}
