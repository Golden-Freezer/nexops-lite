import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * API Route에서 현재 선택된 business_id를 가져온다.
 * 클라이언트에서 X-Business-Id 헤더로 전달.
 */
export async function getBusinessId(): Promise<string | null> {
  const headersList = await headers();
  return headersList.get("x-business-id") || null;
}

/**
 * business_id 필수인 API에서 사용.
 * NextResponse를 throw해 라우트의 `instanceof NextResponse` catch와 호환된다.
 */
export async function requireBusinessId(): Promise<string> {
  const businessId = await getBusinessId();
  if (!businessId) {
    throw NextResponse.json(
      { error: "사업자를 선택해주세요." },
      { status: 400 },
    );
  }
  return businessId;
}

/**
 * business_id 필수 + 소유권 검증. 헤더는 클라이언트가 임의로 보낼 수 있어
 * 쓰기 경로(캠페인 upsert 등)에서는 X-Business-Id가 실제로 이 사용자 소유인지
 * businesses 테이블로 확인 후 반환한다 — 미검증 시 헤더 위조로 타 사용자의
 * business_id를 지정해 그 사업장의 데이터를 덮어쓸 수 있다 (audit §7-1).
 */
export async function requireOwnedBusinessId(
  userId: string,
  requestedBusinessId?: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  // 라이트판: 사업장이 보통 1개라 헤더가 없으면(첫 화면이 사업장 목록보다 먼저 부를 때 등) 기본 사업장을 쓴다.
  const headerBusinessId = requestedBusinessId ?? (await getBusinessId());
  if (!headerBusinessId) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallbackError) {
      throw NextResponse.json(
        { error: `사업자 확인 실패: ${fallbackError.message}` },
        { status: 500 },
      );
    }
    if (fallback?.id) return fallback.id as string;
  }
  const businessId = headerBusinessId ?? (await requireBusinessId());
  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw NextResponse.json(
      { error: `사업자 소유권 확인 실패: ${error.message}` },
      { status: 500 },
    );
  }
  if (!data) {
    throw NextResponse.json(
      { error: "해당 사업자에 대한 접근 권한이 없습니다." },
      { status: 403 },
    );
  }
  return businessId;
}
