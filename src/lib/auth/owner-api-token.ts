import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/clerk";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_PREFIX = "nxo_pat_";
const TOKEN_BYTES = 32;

/** 평문은 발급 응답에서 한 번만 노출하고, 저장·로그에는 사용하지 않는다. */
export function generateOwnerApiToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashOwnerApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hasBearerAuthorization(req: Request): boolean {
  return /^Bearer\s+/i.test(req.headers.get("authorization") ?? "");
}

function readBearerToken(req: Request): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 데스크톱 위젯의 개인 Bearer 토큰을 검증한다.
 * 유효하면 토큰 소유 Clerk user_id, 미존재·폐기·형식 오류면 null을 반환한다.
 */
export async function verifyOwnerApiToken(
  req: Request,
): Promise<string | null> {
  const token = readBearerToken(req);
  if (!token) return null;

  const tokenHash = hashOwnerApiToken(token);
  const db = createAdminClient() as any;
  const { data, error } = await db
    .from("owner_api_tokens")
    .select("id, user_id, token_hash")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw new Error(`개인 API 토큰 조회 실패: ${error.message}`);
  if (!data || !hashesMatch(tokenHash, data.token_hash)) return null;

  const { error: updateError } = await db
    .from("owner_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  // 사용시각 기록 실패가 이미 검증된 요청을 차단하지는 않는다.
  if (updateError)
    console.warn("[auth] 개인 API 토큰 last_used_at 갱신 실패:", updateError);

  return data.user_id;
}

/** Bearer가 명시되면 개인토큰만, 없으면 기존 Clerk 오너 인증을 그대로 사용한다. */
export async function requireOwnerRequest(req: NextRequest): Promise<string> {
  if (!hasBearerAuthorization(req)) return requireOwner();

  const userId = await verifyOwnerApiToken(req);
  if (!userId) {
    throw NextResponse.json(
      { error: "개인 API 토큰이 유효하지 않습니다." },
      { status: 401 },
    );
  }
  return userId;
}
