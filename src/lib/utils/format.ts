/** 통화 포맷: ₩2.1M, ₩345K, ₩1,234 */
export function formatCurrency(n: number): string {
  if (n === 0) return '₩0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''

  if (abs >= 1_000_000) {
    const val = abs / 1_000_000
    return `${sign}₩${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M`
  }
  if (abs >= 1_000) {
    const val = abs / 1_000
    return `${sign}₩${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}K`
  }
  return `${sign}₩${abs.toLocaleString('ko-KR')}`
}

/** 퍼센트 포맷: 23.5% */
export function formatPercent(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}%`
}

// ── 화면 원화 금액 표기 — 2026-10-30 오너 지시 "금액 표기는 소수점 이하 올림" ──
// 표기만 다룬다. 저장값·계산(마진·수수료·입출고비·VAT·원가)은 원값을 그대로 쓰고, 합계는 원값을 다 더한 뒤 한 번만 올린다.
// 규칙: 정수 원, 소수점이 있으면 0에서 먼 쪽으로 올림(엑셀 ROUNDUP — −579,673.4 → −579,674).
// 부동소수 잔차(7.000000000000001 류)는 1e-6 안이면 가까운 정수로 먼저 정리한다(8이 되지 않게). −0은 0.
// 외화(CNY·USD)·비율(%·ROAS)·수량은 대상이 아니다.

const WON_RESIDUAL = 1e-6

function roundUpAway(v: number): number {
  const near = Math.round(v)
  const out = Math.abs(v - near) < WON_RESIDUAL ? near : v > 0 ? Math.ceil(v) : -Math.ceil(-v)
  return out === 0 ? 0 : out
}

/** 화면에 찍을 정수 원 — 0에서 먼 쪽 올림(잔차 정리 뒤) */
export function ceilWon(v: number): number {
  return roundUpAway(v)
}

/** 금액 숫자만('1,235') — 값이 없거나 숫자가 아니면 empty(화면마다 '-'·'—') */
export function formatWonNumber(v: number | null | undefined, empty = '-'): string {
  return v == null || !Number.isFinite(v) ? empty : ceilWon(v).toLocaleString('ko-KR')
}

/** 금액 + 원('1,235원') */
export function formatWon(v: number | null | undefined, empty = '-'): string {
  return v == null || !Number.isFinite(v) ? empty : `${formatWonNumber(v)}원`
}

export interface WonShortOptions {
  /** 1억 이상을 억으로(기본 true). false면 만으로만 */
  eok?: boolean
  /** 만·억의 소수 자릿수(기본 1) */
  digits?: number
  /** 만 단위만 다른 자릿수(기본 digits) — 랭킹 표처럼 '1,235만원'·'1.3억원'을 쓰는 화면은 0 */
  manDigits?: number
  /** 천 단위 쉼표(기본 false — 기존 '12345.7만' 모양) */
  grouping?: boolean
}

/** 원 단위로 올린 값을 unit(1e4 만·1e8 억·1e3 천)으로 나눠 소수 digits 자리에서 다시 0에서 먼 쪽 올림 */
function inUnit(won: number, unit: number, digits: number): number {
  const scale = 10 ** digits
  return roundUpAway((won / unit) * scale) / scale
}

/**
 * 만·억 축약('123.5만', '1.3억') — 원 단위로 먼저 올린 뒤 단위를 고르고(9,999.4 → 10,000 → '1.0만'),
 * 보이는 자리에서 다시 0에서 먼 쪽으로 올린다(1,234,100 → '123.5만'). 올림이 단위를 넘기면 위 단위로(99,999,001 → '1.0억').
 * 1만 미만은 정수 원.
 */
export function formatWonShort(
  v: number,
  { eok = true, digits = 1, manDigits = digits, grouping = false }: WonShortOptions = {},
): string {
  const won = ceilWon(v)
  const show = (n: number, d: number) =>
    grouping ? n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : n.toFixed(d)
  if (eok && (Math.abs(won) >= 1e8 || Math.abs(inUnit(won, 1e4, manDigits)) >= 1e4)) return `${show(inUnit(won, 1e8, digits), digits)}억`
  if (Math.abs(won) >= 1e4) return `${show(inUnit(won, 1e4, manDigits), manDigits)}만`
  return won.toLocaleString('ko-KR')
}

/**
 * 단위를 고정한 금액 숫자(단위 글자는 붙이지 않음) — '만'으로만 쓰는 표('1,235만')·축 눈금('13천').
 * 원 단위로 먼저 올린 뒤 unit으로 나눠 소수 digits 자리에서 0에서 먼 쪽 올림, 끝자리 0은 지운다(12.5만은 그대로).
 */
export function formatWonInUnit(v: number, unit: number, digits = 0): string {
  return inUnit(ceilWon(v), unit, digits).toLocaleString('ko-KR', { maximumFractionDigits: digits })
}
