import { NextRequest, NextResponse } from 'next/server'
import { bearerCorsPreflight, withBearerCors } from '@/lib/auth/bearer-cors'
import { hasBearerAuthorization, requireOwnerRequest } from '@/lib/auth/owner-api-token'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/auth/clerk'
import {
  BusinessValidationError,
  isMissingBusinessMutationRpc,
  normalizeBusinessCreate,
  normalizeBusinessId,
  normalizeBusinessPatch,
} from '@/lib/settings/business-contract'

type RpcError = { code?: string; message?: string }

function rpcErrorResponse(error: RpcError, action: string) {
  if (isMissingBusinessMutationRpc(error)) {
    return NextResponse.json(
      {
        error: `안전한 사업자 ${action} 함수가 아직 적용되지 않았습니다. 관리자에게 마이그레이션 적용을 요청하세요.`,
        code: 'BUSINESS_ATOMIC_MIGRATION_REQUIRED',
      },
      { status: 503 },
    )
  }

  const message = error.message ?? `사업자 ${action} 실패`
  if (message.includes('NXBUS_SCOPE_MISMATCH')) {
    return NextResponse.json({ error: '해당 사업자에 대한 접근 권한이 없습니다.' }, { status: 403 })
  }
  if (message.includes('NXBUS_NOT_FOUND')) {
    return NextResponse.json({ error: '사업자를 찾을 수 없습니다.' }, { status: 404 })
  }
  if (message.includes('NXBUS_INVALID_REQUEST')) {
    return NextResponse.json({ error: '사업자 요청 값이 올바르지 않습니다.' }, { status: 400 })
  }
  return NextResponse.json({ error: `사업자 ${action} 실패: ${message}` }, { status: 500 })
}

function requestErrorResponse(error: unknown, fallback: string) {
  if (error instanceof NextResponse) return error
  if (error instanceof BusinessValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'JSON 요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  )
}

export function OPTIONS() {
  return bearerCorsPreflight()
}

/** GET /api/businesses - 로그인 사용자가 소유한 사업자 목록 */
export async function GET(req: NextRequest) {
  try {
    // 목록은 로그인 사용자 전원에게 허용한다 — 데이터는 아래 user_id 필터로 격리된다.
    // Bearer(위젯 개인토큰) 경로만 requireOwnerRequest가 토큰을 검증한다.
    const userId = hasBearerAuthorization(req)
      ? await requireOwnerRequest(req)
      : await requireAuth()
    // service role을 쓰므로 user_id 필터를 생략하지 않는다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      return withBearerCors(
        req,
        NextResponse.json({ error: `사업자 목록 조회 실패: ${error.message}` }, { status: 500 }),
      )
    }
    return withBearerCors(
      req,
      NextResponse.json(
        { data: data ?? [] },
        { headers: { 'Cache-Control': 'private, no-store' } },
      ),
    )
  } catch (error) {
    return withBearerCors(req, requestErrorResponse(error, '사업자 목록 조회 오류'))
  }
}

/** POST /api/businesses - 기본값 경합까지 단일 DB 트랜잭션으로 등록 */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuth()
    const input = normalizeBusinessCreate(await request.json())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase.rpc('create_owned_business_atomic', {
      p_actor_user_id: userId,
      p_fields: input.fields,
      p_make_default: input.makeDefault,
    })

    if (error) return rpcErrorResponse(error, '등록')
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return requestErrorResponse(error, '사업자 등록 오류')
  }
}

/** PATCH /api/businesses - 정보 수정과 기본 사업자 전환을 원자 처리 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireAuth()
    const input = normalizeBusinessPatch(await request.json())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase.rpc('patch_owned_business_atomic', {
      p_actor_user_id: userId,
      p_business_id: input.id,
      p_fields: input.fields,
      p_make_default: input.makeDefault,
    })

    if (error) return rpcErrorResponse(error, '수정')
    return NextResponse.json({ data })
  } catch (error) {
    return requestErrorResponse(error, '사업자 수정 오류')
  }
}

/** DELETE /api/businesses - 모든 business_id 의존성을 잠금 안에서 검사한 뒤 빈 사업자만 삭제 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireAuth()
    const id = normalizeBusinessId(new URL(request.url).searchParams.get('id'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase.rpc('delete_owned_empty_business_atomic', {
      p_actor_user_id: userId,
      p_business_id: id,
    })

    if (error) return rpcErrorResponse(error, '삭제')
    if (!data?.deleted) {
      return NextResponse.json(
        {
          error: '이 사업장에 연결된 운영 또는 감사 데이터가 있어 삭제할 수 없습니다.',
          code: 'BUSINESS_HAS_DEPENDENCIES',
          dependencies: Array.isArray(data?.dependencies) ? data.dependencies : [],
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return requestErrorResponse(error, '사업자 삭제 오류')
  }
}
