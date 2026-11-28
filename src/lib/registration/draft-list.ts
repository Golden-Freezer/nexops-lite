/**
 * 등록 대기 목록(상품등록 첫 화면) — 등록 임시저장(sourcing_registration_drafts)을 목록 한 줄로 줄인다.
 *
 * form(JSONB)에는 상세 HTML처럼 큰 값이 들어 있어 목록 응답에는 화면이 쓰는 값만 담는다. 사업장 이름은
 * 오너 본인 사업장 목록(listOwnedBusinesses)으로 붙이고, 목록에 없는 id는 이름 없이 둔다(격리 — 남의 사업장 이름을 찾지 않음).
 */

import type { RegistrationDraft, RegistrationDraftStatus } from '@/lib/sourcing/registration/drafts'

export interface DraftListItem {
  id: string
  sourcingProductId: string | null
  keyword: string | null
  productName: string
  businessId: string | null
  businessName: string | null
  status: RegistrationDraftStatus
  salePrice: number | null
  categoryPath: string | null
  heroImage: string | null
  /** 상세페이지 산출(HTML 또는 구운 이미지)이 있는지 */
  hasDetailPage: boolean
  updatedAt: string | null
}

export interface DraftListPage {
  items: DraftListItem[]
  total: number
  page: number
  pageSize: number
}

export const DRAFT_PAGE_SIZE = 20

/** 쿼리 문자열 → 1 이상 정수 페이지(기본 1) */
export function parseDraftPage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** 쿼리 문자열 → 상태 필터. draft·ready 외 값은 전체(undefined) */
export function parseDraftStatus(raw: string | null | undefined): RegistrationDraftStatus | undefined {
  return raw === 'draft' || raw === 'ready' ? raw : undefined
}

export function toDraftListItem(draft: RegistrationDraft, businessNames: Map<string, string>): DraftListItem {
  const content = draft.form.content ?? { heroImages: [], detailImages: [], detailHtml: null }
  const hero = (content.heroImages ?? []).find(Boolean) ?? null
  const hasDetailPage =
    Boolean(content.detailHtml && content.detailHtml.trim()) ||
    (content.detailPageSections?.length ?? 0) > 0 ||
    (content.detailPageFull?.length ?? 0) > 0
  return {
    id: draft.id,
    sourcingProductId: draft.sourcingProductId,
    keyword: draft.keyword,
    productName: draft.form.productName?.trim() || draft.keyword || '',
    businessId: draft.businessId,
    businessName: draft.businessId ? businessNames.get(draft.businessId) ?? null : null,
    status: draft.status,
    salePrice: draft.form.salePrice ?? null,
    categoryPath: draft.form.categoryPath ?? null,
    heroImage: hero,
    hasDetailPage,
    updatedAt: draft.updatedAt,
  }
}
