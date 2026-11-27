import { NextResponse } from "next/server";
import { hasBearerAuthorization } from "@/lib/auth/owner-api-token";

const BEARER_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** Tauri 개인토큰 호출에만 CORS를 붙인다. 쿠키 credential 허용 헤더는 의도적으로 없다. */
export function withBearerCors(
  req: Request,
  response: NextResponse,
): NextResponse {
  if (!hasBearerAuthorization(req)) return response;
  for (const [name, value] of Object.entries(BEARER_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function bearerCorsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: BEARER_CORS_HEADERS });
}
