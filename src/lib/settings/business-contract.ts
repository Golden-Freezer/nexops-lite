export class BusinessValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessValidationError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FIELD_RULES = {
  businessName: { dbKey: 'business_name', label: '상호', maxLength: 100, required: true },
  businessNumber: { dbKey: 'business_number', label: '사업자등록번호', maxLength: 20 },
  representative: { dbKey: 'representative', label: '대표자명', maxLength: 50 },
  businessType: { dbKey: 'business_type', label: '업태', maxLength: 100 },
  businessCategory: { dbKey: 'business_category', label: '종목', maxLength: 100 },
  address: { dbKey: 'address', label: '사업장 소재지', maxLength: 1_000 },
} as const

type BusinessField = keyof typeof FIELD_RULES

export interface NormalizedBusinessCreate {
  fields: Record<string, string | null>
  makeDefault: boolean
}

export interface NormalizedBusinessPatch extends NormalizedBusinessCreate {
  id: string
}

function objectBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new BusinessValidationError('사업자 요청 형식이 올바르지 않습니다.')
  }
  return value as Record<string, unknown>
}

function normalizeField(
  body: Record<string, unknown>,
  field: BusinessField,
  required: boolean,
): string | null | undefined {
  if (!(field in body)) {
    if (required) throw new BusinessValidationError(`${FIELD_RULES[field].label}는 필수입니다.`)
    return undefined
  }

  const raw = body[field]
  if (raw != null && typeof raw !== 'string') {
    throw new BusinessValidationError(`${FIELD_RULES[field].label} 형식이 올바르지 않습니다.`)
  }
  const value = String(raw ?? '').trim()
  if (required && !value) {
    throw new BusinessValidationError(`${FIELD_RULES[field].label}는 필수입니다.`)
  }
  if (value.length > FIELD_RULES[field].maxLength) {
    throw new BusinessValidationError(
      `${FIELD_RULES[field].label}은(는) ${FIELD_RULES[field].maxLength}자 이하여야 합니다.`,
    )
  }
  return value || null
}

function normalizeMakeDefault(body: Record<string, unknown>): boolean {
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new BusinessValidationError('기본 사업자 설정 값이 올바르지 않습니다.')
  }
  return body.isDefault === true
}

function normalizeFields(body: Record<string, unknown>, create: boolean) {
  const fields: Record<string, string | null> = {}
  for (const field of Object.keys(FIELD_RULES) as BusinessField[]) {
    const rule = FIELD_RULES[field]
    const fieldRequired = 'required' in rule && rule.required === true
    if (!(field in body) && !create) continue
    const value = normalizeField(body, field, fieldRequired)
    if (value !== undefined) fields[rule.dbKey] = value
  }
  return fields
}

export function normalizeBusinessCreate(value: unknown): NormalizedBusinessCreate {
  const body = objectBody(value)
  return {
    fields: normalizeFields(body, true),
    makeDefault: normalizeMakeDefault(body),
  }
}

export function normalizeBusinessPatch(value: unknown): NormalizedBusinessPatch {
  const body = objectBody(value)
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!UUID_PATTERN.test(id)) throw new BusinessValidationError('사업자 id가 올바르지 않습니다.')

  const fields = normalizeFields(body, false)
  const makeDefault = normalizeMakeDefault(body)
  if (Object.keys(fields).length === 0 && !makeDefault) {
    throw new BusinessValidationError('변경할 사업자 정보가 없습니다.')
  }
  return { id, fields, makeDefault }
}

export function normalizeBusinessId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!UUID_PATTERN.test(id)) throw new BusinessValidationError('사업자 id가 올바르지 않습니다.')
  return id
}

export function isMissingBusinessMutationRpc(error: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST202'
    || /Could not find the function|schema cache/i.test(error?.message ?? '')
}
