import type { ImportType } from '@/types/import'

/** 표준 코드와 한글 파일명을 모두 지원하는 Import 유형 감지. */
export function detectImportType(filename: string): ImportType | null {
  const lower = filename.toLowerCase().replace(/\s+/g, '')
  if (lower.startsWith('statistics-') || lower.includes('statistics')) return 'sales'
  if (lower.startsWith('inventory_health') || lower.includes('inventory_health')) return 'inventory_health'
  if (lower.includes('pa_total_campaign')) return 'ad_report'
  if (lower.includes('dailysettlement') || lower.includes('daily_settlement')) return 'ad_billing'
  if (lower.includes('그로스판매장부') || lower.includes('판매장부')) return 'ledger'
  if (/(^|[._-])01[._-]?상품/.test(lower) || lower.includes('상품등록')) return 'product'
  if (/db[._-]?구매/.test(lower)) return 'purchase'
  return null
}
