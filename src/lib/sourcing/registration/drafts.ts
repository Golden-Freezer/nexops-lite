/**
 * 쿠팡 실등록 준비 임시저장 (sourcing_registration_drafts) — CRUD.
 *
 * 신규 소싱 전용 테이블. database.ts 미포함이라 untyped SupabaseClient로 접근한다(sourcing_brands 관례).
 * guard: 이 테이블은 소싱 전용이며 쿠팡·운영 테이블을 건드리지 않는다. business_id는 등록 대상 참조일
 * 뿐이고 RLS·필터는 user_id(Clerk sub)로만 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isGeneratedRegistrationImage } from './draft-source-images'
import { emptyForm, type RegistrationForm } from './form'
import {
  decideListPrice,
  isListPriceRuleOn,
  LIST_PRICE_RULE_VERSION,
  type ListPriceRule,
  type Rng,
} from './list-price'

export type RegistrationDraftStatus = 'draft' | 'ready'

export interface RegistrationDraft {
  id: string
  businessId: string | null
  keyword: string | null
  sourcingProductId: string | null
  form: RegistrationForm
  status: RegistrationDraftStatus
  createdAt: string | null
  updatedAt: string | null
}

interface DraftRow {
  id: string
  business_id: string | null
  keyword: string | null
  sourcing_product_id: string | null
  form: unknown
  status: string
  created_at: string | null
  updated_at: string | null
}

const SELECT = 'id, business_id, keyword, sourcing_product_id, form, status, created_at, updated_at'

/** form(JSONB)을 RegistrationForm으로 — 누락 필드는 빈 폼 기본값으로 메꿔 렌더 안전성 확보. */
function toForm(raw: unknown): RegistrationForm {
  if (!raw || typeof raw !== 'object') return emptyForm()
  return { ...emptyForm(), ...(raw as Partial<RegistrationForm>) }
}

function toDraft(row: DraftRow): RegistrationDraft {
  return {
    id: row.id,
    businessId: row.business_id,
    keyword: row.keyword,
    sourcingProductId: row.sourcing_product_id,
    form: toForm(row.form),
    status: row.status === 'ready' ? 'ready' : 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 소싱 product에 연결된 임시저장 1건(부분 유니크 인덱스 기준). 없으면 null. */
export async function getDraftBySourcingProduct(
  db: SupabaseClient,
  userId: string,
  sourcingProductId: string
): Promise<RegistrationDraft | null> {
  const { data, error } = await db
    .from('sourcing_registration_drafts')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('sourcing_product_id', sourcingProductId)
    .limit(1)
  if (error) throw new Error(`등록 임시저장 조회 실패: ${error.message}`)
  return data && data.length > 0 ? toDraft(data[0] as DraftRow) : null
}

/** id로 임시저장 1건 (오너 본인 행만). 없으면 null. */
export async function getDraftById(
  db: SupabaseClient,
  userId: string,
  id: string
): Promise<RegistrationDraft | null> {
  const { data, error } = await db
    .from('sourcing_registration_drafts')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('id', id)
    .limit(1)
  if (error) throw new Error(`등록 임시저장 조회 실패: ${error.message}`)
  return data && data.length > 0 ? toDraft(data[0] as DraftRow) : null
}

export interface ListDraftsOptions {
  /** 한 페이지 행 수(1~100, 기본 20) */
  limit?: number
  /** 건너뛸 행 수(0 이상) */
  offset?: number
  /** 상태 필터 — 없으면 전체 */
  status?: RegistrationDraftStatus
}

/** 오너의 등록 임시저장 목록 한 페이지 — 최근 수정순. 전체 개수(total)를 함께 돌려 서버 페이지 넘김에 쓴다. */
export async function listDrafts(
  db: SupabaseClient,
  userId: string,
  options: ListDraftsOptions = {}
): Promise<{ drafts: RegistrationDraft[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100)
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0)
  let query = db
    .from('sourcing_registration_drafts')
    .select(SELECT, { count: 'exact' })
    .eq('user_id', userId)
  if (options.status) query = query.eq('status', options.status)
  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`등록 임시저장 목록 조회 실패: ${error.message}`)
  return { drafts: (data ?? []).map((r) => toDraft(r as DraftRow)), total: count ?? 0 }
}

export interface UpsertDraftInput {
  sourcingProductId: string | null
  keyword: string | null
  businessId: string | null
  form: RegistrationForm
  status: RegistrationDraftStatus
}

export interface UpsertDraftOptions {
  /** 스위치(REGISTRATION_LIST_PRICE_RULE)를 읽는 환경 — 기본 process.env */
  env?: Record<string, string | undefined>
  /** 정가 규칙의 난수 — 기본 crypto */
  rng?: Rng
  now?: () => Date
}

/**
 * 등록 임시저장 upsert — sourcingProductId가 있으면 (user_id, sourcing_product_id)로 기존 행을 갱신,
 * 없으면 새로 만든다. sourcingProductId가 null이면 dedup 불가라 항상 새로 만든다.
 * 정가 규칙(AX-CT-15)은 여기서만 적용한다 — keepServerListPrice 참고.
 */
export async function upsertDraft(
  db: SupabaseClient,
  userId: string,
  input: UpsertDraftInput,
  options: UpsertDraftOptions = {}
): Promise<RegistrationDraft> {
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const ruleOn = isListPriceRuleOn(env)
  const buildForm = (existing: RegistrationForm | null): RegistrationForm =>
    keepServerListPrice(keepServerDetailPageImages(input.form, existing), existing, { ruleOn, rng: options.rng, now })
  const fields = {
    business_id: input.businessId,
    keyword: input.keyword,
    sourcing_product_id: input.sourcingProductId,
    status: input.status,
    updated_at: now().toISOString(),
  }

  if (input.sourcingProductId) {
    const existing = await getDraftBySourcingProduct(db, userId, input.sourcingProductId)
    if (existing) {
      const { data, error } = await db
        .from('sourcing_registration_drafts')
        .update({ ...fields, form: buildForm(existing.form) })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select(SELECT)
        .single()
      if (error || !data) throw new Error(`등록 임시저장 갱신 실패: ${error?.message ?? '알 수 없음'}`)
      return toDraft(data as DraftRow)
    }
  }

  const { data, error } = await db
    .from('sourcing_registration_drafts')
    .insert({ user_id: userId, ...fields, form: buildForm(null) })
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`등록 임시저장 생성 실패: ${error?.message ?? '알 수 없음'}`)
  return toDraft(data as DraftRow)
}

/**
 * 드래프트 대표이미지 슬롯(form.content.heroImages[0]) 반영 — 썸네일 컷 채택 시 사용.
 * 원본 대표 사진 보관(결정 카드 c01): 덮기 전 대표가 생성 그림이 아니면(원본) sourceHeroImage에 남긴다 — PDP 원천 사진 맨 앞이 된다
 * (draftSourceImageUrls). 지금 대표가 이미 채택 컷이면 앞서 남긴 원본을 그대로 둔다. 원본 없이 바로 채택한 초안은 키를 만들지 않는다.
 */
export async function setDraftHeroImage(
  db: SupabaseClient,
  userId: string,
  id: string,
  url: string
): Promise<void> {
  const draft = await getDraftById(db, userId, id)
  if (!draft) return
  const heroImages = [...draft.form.content.heroImages]
  const current = heroImages[0]
  const sourceHeroImage = current && !isGeneratedRegistrationImage(current) ? current : draft.form.content.sourceHeroImage
  heroImages[0] = url
  const form: RegistrationForm = {
    ...draft.form,
    content: { ...draft.form.content, heroImages, ...(sourceHeroImage ? { sourceHeroImage } : {}) },
  }
  const { error } = await db
    .from('sourcing_registration_drafts')
    .update({ form, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw new Error(`드래프트 대표이미지 반영 실패: ${error.message}`)
}

/**
 * PDP 6단계 파이프라인 산출 반영 — 상세 HTML + 섹션 이미지 URL을 draft.form에 넣는다(설계문서 §8, form JSONB라 DDL 없음).
 * 섹션 컷 URL은 content.generatedImages(마지막 잡의 목록으로 교체 — detailHtml과 짝)에 둔다. detailImages는 다음 생성의
 * 원본 사진 입력이라 생성 컷을 섞지 않는다(결정 카드 c01 — 전에는 detailImages에 합쳐 다음 잡 원천으로 되먹었다).
 * 소유 검증: getDraftById가 user_id로 필터하므로 타인 드래프트는 조용히 무시(update 자체가 0행).
 */
export async function appendDraftDetailAssets(
  db: SupabaseClient,
  userId: string,
  id: string,
  finalHtml: string,
  imageUrls: string[]
): Promise<void> {
  const draft = await getDraftById(db, userId, id)
  if (!draft) return
  const generatedImages = Array.from(new Set(imageUrls))
  const form: RegistrationForm = {
    ...draft.form,
    content: { ...draft.form.content, generatedImages, detailHtml: finalHtml },
  }
  const { error } = await db
    .from('sourcing_registration_drafts')
    .update({ form, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw new Error(`드래프트 상세페이지 산출 반영 실패: ${error.message}`)
}

/** 등록 임시저장 삭제 (오너 본인 행만). */
export async function deleteDraft(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db
    .from('sourcing_registration_drafts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`등록 임시저장 삭제 실패: ${error.message}`)
}

/** 서버만 쓰는 content 칸 — 구운 상세 이미지(U1 setDraftDetailPageImages)·생성 컷(appendDraftDetailAssets)·원본 대표(setDraftHeroImage) */
const SERVER_ONLY_CONTENT_KEYS = ['detailPageSections', 'detailPageFull', 'generatedImages', 'sourceHeroImage'] as const

/**
 * 서버만 쓰는 칸(구운 상세 이미지 U1, 결정 카드 c01의 생성 컷·원본 대표 사진)은 화면 저장이 바꾸지 않는다. 화면 저장은 form 전체를
 * 덮어쓰므로(registration-drafts POST → upsertDraft), 들어온 form의 그 칸은 무시하고 저장된 값을 그대로 둔다 — 드로어를 연 채
 * 다시 구우면 드로어가 들고 있던 예전 목록이 새 목록을 덮어쓰기 때문이다. 새 행(existing 없음)에는 그 칸을 넣지 않는다.
 */
export function keepServerDetailPageImages(incoming: RegistrationForm, existing: RegistrationForm | null): RegistrationForm {
  const content = { ...incoming.content }
  for (const key of SERVER_ONLY_CONTENT_KEYS) {
    delete content[key]
    const kept = existing?.content?.[key]
    if (kept !== undefined) Object.assign(content, { [key]: kept })
  }
  return { ...incoming, content }
}

/**
 * 구운 상세 이미지 반영(U1) — 두 필드를 통째로 교체한다(다시 굽기 = 목록 교체). detailImages·detailHtml·heroImages는 건드리지 않는다
 * (detailImages는 다음 생성의 원본 사진 입력 — 섞으면 입력이 오염된다). 오너 본인 행만, 없으면 false.
 */
export async function setDraftDetailPageImages(
  db: SupabaseClient,
  userId: string,
  id: string,
  images: { sections: string[]; full: string[] }
): Promise<boolean> {
  const draft = await getDraftById(db, userId, id)
  if (!draft) return false
  const form: RegistrationForm = {
    ...draft.form,
    content: { ...draft.form.content, detailPageSections: [...images.sections], detailPageFull: [...images.full] },
  }
  const { error } = await db
    .from('sourcing_registration_drafts')
    .update({ form, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw new Error(`드래프트 상세 이미지 반영 실패: ${error.message}`)
  return true
}

const isEmptyPrice = (v: number | null | undefined): boolean => typeof v !== 'number' || !Number.isFinite(v) || v <= 0

/**
 * 정가 규칙(AX-CT-15) — form.listPriceRule 은 서버만 쓴다. 화면이 보낸 rule 은 무시하고 저장된 값을 남긴다(새 행에는 넣지 않는다).
 * 저장된 rule 이 있으면: 들어온 정가가 비어 있을 때(드로어가 빈 정가로 덮어쓰는 경우) 저장된 정가를 지키고, 양수면 오너 손 입력으로 보고 그대로 쓴다.
 * 저장된 rule 이 없고 스위치가 on 이며 들어온 정가가 비어 있고 판매가가 있으면 한 번만 정하고 rule 을 기록한다. 판매가가 바뀌어도 다시 계산하지 않는다.
 */
export function keepServerListPrice(
  incoming: RegistrationForm,
  existing: RegistrationForm | null,
  ctx: { ruleOn: boolean; rng?: Rng; now?: () => Date }
): RegistrationForm {
  const { listPriceRule: _ignored, ...form } = incoming
  void _ignored
  const stored = existing?.listPriceRule
  if (stored) {
    const originalPrice = isEmptyPrice(form.originalPrice) ? (existing?.originalPrice ?? form.originalPrice) : form.originalPrice
    return { ...form, originalPrice, listPriceRule: stored }
  }
  if (!ctx.ruleOn || !isEmptyPrice(form.originalPrice) || isEmptyPrice(form.salePrice)) return form
  const decision = decideListPrice(form.salePrice, ctx.rng)
  if (!decision) return form
  const rule: ListPriceRule = {
    discountRate: decision.discountRate,
    salePriceAtDraw: form.salePrice as number,
    listPrice: decision.listPrice,
    drawnAt: (ctx.now ?? (() => new Date()))().toISOString(),
    version: LIST_PRICE_RULE_VERSION,
  }
  return { ...form, originalPrice: decision.listPrice, listPriceRule: rule }
}
