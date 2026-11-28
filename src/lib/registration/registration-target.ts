/**
 * 등록 대상 사업장·Wing 계정 대조 가드(AX-CT-18) — 순수 함수만 둔다.
 * 초안에 저장된 사업장이 곧 등록 대상이다. 기본 사업장으로 떨어지지 않고, 확장은 지금 로그인된 Wing 계정이
 * 그 사업장의 판매자 계정과 같을 때만 입력한다. 스위치 REGISTRATION_ACCOUNT_GUARD 가 on 일 때만 쓴다.
 */

import type { RegistrationForm } from '@/lib/sourcing/registration/form'

export const ACCOUNT_GUARD_ENV = 'REGISTRATION_ACCOUNT_GUARD'
/** 확장이 `{ ok: true, guard: 1 }` 로 답하는 가드 버전 — 올리면 옛 확장은 멈춘다 */
export const GUARD_VERSION = 1
/** 가드가 켜졌을 때만 쓰는 확장 메시지 이름 — 옛 확장은 이 이름을 몰라 응답이 없다(조용히 가드가 빠지지 않는다) */
export const GUARDED_MESSAGE_TYPE = 'NEXOPS_REG_OPEN_SPLIT_GUARDED'
export const LEGACY_MESSAGE_TYPE = 'NEXOPS_REG_OPEN_SPLIT'

export const isAccountGuardOn = (env: Record<string, string | undefined>): boolean =>
  env[ACCOUNT_GUARD_ENV]?.trim().toLowerCase() === 'on'

/** 판매자 계정 ID 정규화 — 문자열·숫자면 공백 떼고 대문자, 빈 값·그 밖의 형은 null */
export function normalizeVendorId(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim().toUpperCase()
  return s ? s : null
}

export interface OwnedBusinessLike {
  id: string
  name: string
  coupangVendorId: string | null
}

export type TargetFailureReason = 'no-business' | 'not-owned' | 'no-vendor'

export type RegistrationTarget =
  | { ok: true; businessId: string; businessName: string; vendorId: string }
  | { ok: false; reason: TargetFailureReason }

/** 초안에 저장된 사업장만 본다 — 비어 있으면 기본 사업장으로 채우지 않고 no-business */
export function resolveRegistrationTarget(input: {
  draftBusinessId: string | null | undefined
  owned: ReadonlyArray<OwnedBusinessLike>
}): RegistrationTarget {
  if (!input.draftBusinessId) return { ok: false, reason: 'no-business' }
  const biz = input.owned.find((b) => b.id === input.draftBusinessId)
  if (!biz) return { ok: false, reason: 'not-owned' }
  const vendorId = normalizeVendorId(biz.coupangVendorId)
  if (!vendorId) return { ok: false, reason: 'no-vendor' }
  return { ok: true, businessId: biz.id, businessName: biz.name, vendorId }
}

export type WingAccountCheck = 'ok' | 'mismatch' | 'unknown'

/** 기대 계정(사업장)과 지금 Wing 로그인 계정 비교 — 어느 쪽이든 못 읽으면 unknown(= 멈춤) */
export function compareWingAccount(expected: unknown, wing: unknown): WingAccountCheck {
  const a = normalizeVendorId(expected)
  const b = normalizeVendorId(wing)
  if (!a || !b) return 'unknown'
  return a === b ? 'ok' : 'mismatch'
}

export const TARGET_FAILURE_MESSAGE: Record<TargetFailureReason, string> = {
  'no-business': '등록 대상 사업장이 저장되지 않았습니다. 사업장을 고르고 저장하세요.',
  'not-owned': '저장된 사업장이 내 사업장 목록에 없습니다. 사업장을 다시 고르고 저장하세요.',
  'no-vendor': '저장된 사업장에 쿠팡 판매자 계정 ID(벤더코드)가 없어 계정 대조를 할 수 없습니다.',
}

export type HandoffStart =
  | { ok: true; target: Extract<RegistrationTarget, { ok: true }> }
  | { ok: false; message: string }

/** 'Wing 등록 시작' 전 확인 — 저장된 초안이 있고, 화면 사업장이 저장된 값과 같고, 대상이 정상이어야 한다 */
export function evaluateHandoffStart(input: {
  draftId: string | null
  savedBusinessId: string | null
  currentBusinessId: string | null
  owned: ReadonlyArray<OwnedBusinessLike>
}): HandoffStart {
  if (!input.draftId) return { ok: false, message: '먼저 임시저장하세요 — 저장된 초안의 사업장으로만 등록을 시작합니다.' }
  if ((input.currentBusinessId ?? null) !== (input.savedBusinessId ?? null)) {
    return { ok: false, message: '사업장을 바꾼 뒤 저장하지 않았습니다. 먼저 저장하세요.' }
  }
  const target = resolveRegistrationTarget({ draftBusinessId: input.savedBusinessId, owned: input.owned })
  if (!target.ok) return { ok: false, message: TARGET_FAILURE_MESSAGE[target.reason] }
  return { ok: true, target }
}

/** 확장에 넘기는 draft — 지금 드로어가 보내던 꼴에 target(사업장·기대 판매자 계정)을 더한다 */
export function buildWingHandoff(form: RegistrationForm, target: Extract<RegistrationTarget, { ok: true }>) {
  const categoryName = form.categoryPath ? (form.categoryPath.split('>').pop()?.trim() ?? null) : null
  return {
    categoryName,
    displayCategoryCode: form.displayCategoryCode,
    product: {
      productName: form.productName,
      brand: form.brand,
      salePrice: form.salePrice,
      originalPrice: form.originalPrice,
      categoryPath: form.categoryPath,
      displayCategoryCode: form.displayCategoryCode,
      searchTags: form.searchTags,
      barcode: form.barcode,
      heroImageUrl: form.content.heroImages[0] ?? null,
      detailHtml: form.content.detailHtml,
      notice: form.notice,
      options: form.options,
      memo: form.memo,
    },
    target: {
      businessId: target.businessId,
      businessName: target.businessName,
      expectedVendorId: target.vendorId,
      guardVersion: GUARD_VERSION,
    },
  }
}

export type GuardedHandoffResult = { ok: true } | { ok: false; message: string }

/** 가드된 넘김에 대한 확장 응답 판정 — 응답 없음·guard 표식 없음(옛 확장)은 멈춘다 */
export function interpretGuardedHandoffResponse(res: unknown): GuardedHandoffResult {
  const r = res && typeof res === 'object' ? (res as { ok?: unknown; guard?: unknown; reason?: unknown }) : null
  if (!r) return { ok: false, message: '확장을 업데이트(새로고침)하세요 — 계정 대조를 지원하지 않는 확장입니다.' }
  if (r.ok === true && r.guard === GUARD_VERSION) return { ok: true }
  if (r.ok === true) return { ok: false, message: '확장을 업데이트(새로고침)하세요 — 계정 대조를 지원하지 않는 확장입니다.' }
  if (r.reason === 'no-target') return { ok: false, message: '확장이 사업장 정보 없는 초안을 거절했습니다. 저장 후 다시 시도하세요.' }
  return { ok: false, message: '확장에 전달하지 못했습니다. 확장을 리로드한 뒤 다시 시도하세요.' }
}
