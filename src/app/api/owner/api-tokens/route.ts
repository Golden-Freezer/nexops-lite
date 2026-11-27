import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/clerk";
import {
  generateOwnerApiToken,
  hashOwnerApiToken,
} from "@/lib/auth/owner-api-token";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_LABEL = "AI 장부 업데이트";
const MAX_LABEL_LENGTH = 100;
const METADATA_COLUMNS = "id, label, created_at, last_used_at, revoked_at";

function errorResponse(error: unknown, operation: string): NextResponse {
  if (error instanceof NextResponse) return error;
  const message = error instanceof Error ? error.message : "서버 오류";
  console.error(`owner api-tokens ${operation} error:`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const userId = await requireOwner();
    const db = createAdminClient() as any;
    const { data, error } = await db
      .from("owner_api_tokens")
      .select(METADATA_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ data: { tokens: data ?? [] } });
  } catch (error: unknown) {
    return errorResponse(error, "GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner();
    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const label =
      typeof body.label === "string" ? body.label.trim() : DEFAULT_LABEL;

    if (!label || label.length > MAX_LABEL_LENGTH) {
      return NextResponse.json(
        { error: `label은 1~${MAX_LABEL_LENGTH}자여야 합니다.` },
        { status: 400 },
      );
    }

    const token = generateOwnerApiToken();
    const db = createAdminClient() as any;
    const { data, error } = await db
      .from("owner_api_tokens")
      .insert({ user_id: userId, token_hash: hashOwnerApiToken(token), label })
      .select(METADATA_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(
      { data: { ...data, token } },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return errorResponse(error, "POST");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireOwner();
    const body = (await req.json().catch(() => ({}))) as { id?: unknown };
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json(
        { error: "폐기할 토큰 id가 필요합니다." },
        { status: 400 },
      );
    }

    const db = createAdminClient() as any;
    const { data, error } = await db
      .from("owner_api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select(METADATA_COLUMNS);

    if (error) throw new Error(error.message);
    if (!data?.length) {
      return NextResponse.json(
        { error: "유효한 토큰을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json({ data: data[0] });
  } catch (error: unknown) {
    return errorResponse(error, "DELETE");
  }
}
