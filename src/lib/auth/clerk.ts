import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyOwnerApiToken } from "@/lib/auth/owner-api-token";

/**
 * NEXOPS 라이트 인증 (Supabase Auth, 대표님 1명).
 * 파일 이름은 NEXOPS와 import 경로를 맞추려고 그대로 두었다. Clerk는 쓰지 않는다.
 */
async function sessionUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** 로그인한 대표님의 user id를 반환한다. 없으면 401 응답을 throw한다. */
export async function requireAuth(): Promise<string> {
  const userId = await sessionUserId();
  if (!userId) {
    throw NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  return userId;
}

/** 라이트판은 사용자가 대표님 1명뿐이라 오너 검사와 로그인 검사가 같다. */
export async function requireOwner(): Promise<string> {
  return requireAuth();
}

export interface AuthOrApiKeyOptions {
  touchLastUsed?: boolean;
}

/**
 * 로그인 세션 또는 업로드 키(설정 ▶ 업로드 키, Bearer nxo_pat_…)를 허용한다.
 * 업로드 키는 대표님 PC의 AI(Codex/Claude)가 장부 파일을 올릴 때 쓴다.
 */
export async function requireAuthOrApiKey(
  _options: AuthOrApiKeyOptions = {},
): Promise<string> {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const req = new Request("http://local", { headers: { authorization: authHeader } });
    const tokenUser = await verifyOwnerApiToken(req);
    if (tokenUser) return tokenUser;
    throw NextResponse.json(
      { error: "업로드 키가 맞지 않습니다. 설정 ▶ 업로드 키에서 새로 만드세요." },
      { status: 401 },
    );
  }
  return requireAuth();
}

export async function requireUserBoundAuth(
  options: AuthOrApiKeyOptions = {},
): Promise<string> {
  return requireAuthOrApiKey(options);
}

/** NEXOPS 호환용. 라이트판은 별도 JWT 템플릿이 없다. */
export async function requireAuthWithToken(): Promise<{
  userId: string;
  token: string | null;
}> {
  const userId = await requireAuth();
  return { userId, token: null };
}
