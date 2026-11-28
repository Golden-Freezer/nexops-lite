/**
 * 리뷰 엑셀 파서 — NEXFIT agents/review_excel_parser.py 이식(쿠팡 리뷰 다운로드 11열 형식:
 * 작성일·리뷰어번호·이름·판매자·상품옵션명·평점·리뷰제목·리뷰내용·사진수·도움·도움된인원수).
 * - 활성 시트가 '옵션판매비율'일 수 있어 시트도 헤더로 찾는다. 열은 위치가 아니라 이름으로 매핑한다.
 * - 헤더를 못 찾으면 첫 시트에서 평균 텍스트가 가장 긴 열을 본문으로 본다(원본 폴백 그대로).
 * - 리뷰어번호 열은 읽지 않는다(개인정보). 이름 열은 읽는 즉시 앞 한 글자만 남기고 가린다(maskAuthor — 원래 이름은 담지 않는다,
 *   P1-6). 작성일 열은 작성 월('YYYY.MM')로만 담는다. 판매자 열과 상품옵션명의 상품명(첫 쉼표 앞)은 경쟁사 파일의 타사명 제거에만 쓴다.
 * LLM·DB와 무관한 순수 파싱 계층이다.
 */

import * as XLSX from 'xlsx'
import { maskAuthor } from '../review-scrubber'
import type { ParsedReview, ReviewStats } from './review-types'

type ColumnKey = 'body' | 'rating' | 'title' | 'option' | 'helped' | 'seller' | 'date' | 'author'

const HEADER_TO_KEY: Record<string, ColumnKey> = {
  리뷰내용: 'body',
  평점: 'rating',
  리뷰제목: 'title',
  상품옵션명: 'option',
  도움된인원수: 'helped',
  판매자: 'seller',
  작성일: 'date',
  이름: 'author',
}

/** 구조화 본문 상한(원본 _BODY_TRIM_STRUCTURED) — 표집·직렬화는 더 짧게 자른다 */
const BODY_TRIM_STRUCTURED = 1_000
const FALLBACK_PROBE_ROWS = 50
const FALLBACK_MIN_AVG_LEN = 30

export interface ParsedReviewFile {
  reviews: ParsedReview[]
  stats: ReviewStats
  /** 판매자 열의 서로 다른 값 — 경쟁사 파일의 타사명 제거용 */
  sellers: string[]
  /** 상품옵션명 첫 쉼표 앞(쿠팡 형식 "상품명, 옵션…", 쉼표 있는 값만)의 서로 다른 값 — 경쟁사 파일의 상품명·브랜드 제거용 */
  productTitles: string[]
}

type Row = unknown[]

function clean(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/\u00a0/g, ' ')
    .trim()
}

function toInt(value: unknown): number | null {
  const text = clean(value)
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** 작성일 → 'YYYY.MM' — 엑셀 날짜 일련번호·Date·'2026-10-15'·'2026.10.15 13:20'·'2026년 10월' 꼴. 알아볼 수 없으면 undefined */
export function monthOf(value: unknown): string | undefined {
  let year: number | undefined
  let month: number | undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    const code = XLSX.SSF.parse_date_code(value) as { y?: number; m?: number } | null
    year = code?.y
    month = code?.m
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getFullYear()
    month = value.getMonth() + 1
  } else {
    const hit = /(\d{4})\s*[.\-/년]\s*(\d{1,2})/.exec(clean(value))
    if (hit) {
      year = Number(hit[1])
      month = Number(hit[2])
    }
  }
  if (!year || !month || year < 2000 || year > 2100 || month < 1 || month > 12) return undefined
  return `${year}.${String(month).padStart(2, '0')}`
}

function cell(row: Row, idx: number | undefined): unknown {
  return idx === undefined || idx >= row.length ? null : row[idx]
}

function sheetRows(sheet: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, defval: null, blankrows: false })
}

function findReviewSheet(workbook: XLSX.WorkBook): { rows: Row[]; columns: Partial<Record<ColumnKey, number>> } | null {
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[name])
    const header = rows[0] ?? []
    const columns: Partial<Record<ColumnKey, number>> = {}
    header.forEach((value, idx) => {
      const key = HEADER_TO_KEY[clean(value)]
      if (key && columns[key] === undefined) columns[key] = idx
    })
    if (columns.body !== undefined) return { rows, columns }
  }
  return null
}

/** 헤더를 못 찾은 형식용 — 앞 50행에서 평균 텍스트 길이가 가장 긴 열(평균 30자 이상)을 본문으로 본다 */
function fallbackBodyColumn(rows: Row[]): number | null {
  const sums = new Map<number, { total: number; count: number }>()
  for (const row of rows.slice(1, 1 + FALLBACK_PROBE_ROWS)) {
    row.forEach((value, idx) => {
      const text = clean(value)
      if (!text) return
      const s = sums.get(idx) ?? { total: 0, count: 0 }
      sums.set(idx, { total: s.total + text.length, count: s.count + 1 })
    })
  }
  let best: number | null = null
  let bestAvg = 0
  for (const [idx, s] of sums) {
    const avg = s.total / s.count
    if (avg > bestAvg) {
      best = idx
      bestAvg = avg
    }
  }
  return bestAvg >= FALLBACK_MIN_AVG_LEN ? best : null
}

/**
 * 리뷰 엑셀(바이트) → 본문 있는 리뷰 목록과 통계. 본문이 빈 행(별점만)은 목록에서 빼되 평점 분포에는 센다.
 * 형식을 알아보지 못하면 Error를 던진다(라우트가 400으로 바꾼다).
 */
export function parseReviewWorkbook(bytes: Uint8Array): ParsedReviewFile {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array' })
  } catch {
    throw new Error('엑셀 파일을 읽지 못했습니다.')
  }
  let found = findReviewSheet(workbook)
  if (!found) {
    const first = workbook.SheetNames[0]
    const rows = first ? sheetRows(workbook.Sheets[first]) : []
    const bodyIdx = fallbackBodyColumn(rows)
    if (bodyIdx === null)
      throw new Error("리뷰 엑셀 형식을 알아보지 못했습니다: '리뷰내용' 열도 본문 후보 열도 없습니다.")
    found = { rows, columns: { body: bodyIdx } }
  }

  const { rows, columns } = found
  const reviews: ParsedReview[] = []
  const ratingCounts: Record<string, number> = {}
  const sellers = new Set<string>()
  const productTitles = new Set<string>()
  let totalRows = 0
  for (const row of rows.slice(1)) {
    if (!row.some((value) => clean(value))) continue
    totalRows += 1
    const rawRating = toInt(cell(row, columns.rating))
    const rating = rawRating !== null && rawRating >= 1 && rawRating <= 5 ? rawRating : null
    if (rating !== null) ratingCounts[String(rating)] = (ratingCounts[String(rating)] ?? 0) + 1
    const seller = clean(cell(row, columns.seller))
    if (seller) sellers.add(seller)
    // 쉼표가 없는 옵션("블랙")은 옵션값뿐이라 상품명으로 보지 않는다
    const option = clean(cell(row, columns.option))
    if (option.includes(',')) productTitles.add(option.split(',')[0].trim())
    const body = clean(cell(row, columns.body))
    if (!body) continue
    const month = monthOf(cell(row, columns.date))
    const name = clean(cell(row, columns.author))
    reviews.push({
      rating,
      title: clean(cell(row, columns.title)),
      body: body.slice(0, BODY_TRIM_STRUCTURED),
      option: clean(cell(row, columns.option)),
      helped: Math.max(0, toInt(cell(row, columns.helped)) ?? 0),
      ...(month ? { month } : {}),
      ...(name ? { author: maskAuthor(name) } : {}),
    })
  }
  return {
    reviews,
    stats: { total_rows: totalRows, text_review_count: reviews.length, rating_counts: ratingCounts },
    sellers: [...sellers],
    productTitles: [...productTitles],
  }
}
