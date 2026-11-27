/**
 * business_id를 자동 주입하는 fetch wrapper
 * 운영 페이지(상품/매입/지출/광고/정산)에서 사용
 */

const STORAGE_KEY = 'nexops_current_business_id'

export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const businessId = typeof window !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY)
    : null

  const headers = new Headers(options?.headers)
  if (businessId) {
    headers.set('X-Business-Id', businessId)
  }

  return fetch(url, { ...options, headers })
}
