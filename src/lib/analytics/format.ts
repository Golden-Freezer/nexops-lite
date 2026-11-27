/**
 * 숫자 포맷 유틸 — 전 차트/섹션 공용 (순수 함수)
 * 규약: nexops-chart-system §5
 */

/** 1234567 → '1,234,567' (ko-KR) */
export function fmtNum(v: number): string {
  return v.toLocaleString('ko-KR')
}

/** |v|>=1억 → '1.2억' / |v|>=1만 → '123.5만' / 그 외 fmtNum (기존 대시보드 fmtShort와 동일 로직) */
export function fmtShort(v: number): string {
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}만`
  return fmtNum(v)
}

/** fmtNum + '원' */
export function fmtWon(v: number): string {
  return `${fmtNum(v)}원`
}

/** 12.345 → '12.3%' */
export function fmtPct(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`
}

/** 양수에 '+' 접두 (델타 표기용) */
export function fmtSign(v: number): string {
  return `${v > 0 ? '+' : ''}${fmtNum(v)}`
}

/** '2026-06' → '6월' (현재 연도와 다르면 '26.6월' 형태) */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const currentYear = Number(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4))
  if (y !== currentYear) return `${String(y).slice(2)}.${m}월`
  return `${m}월`
}
