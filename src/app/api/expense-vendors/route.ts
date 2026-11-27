import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";

// expense_vendors는 승인된 로컬 마이그레이션 적용 후 db:types를 재생성한다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopeBusiness(query: any, businessId: string) {
  return query.eq("business_id", businessId);
}

export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true";

    let query = supabase
      .from("expense_vendors")
      .select("*")
      .eq("user_id", userId)
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });
    query = scopeBusiness(query, businessId);
    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error)
      return NextResponse.json(
        { error: `거래처 조회 실패: ${error.message}` },
        { status: 500 },
      );
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "거래처 조회 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name)
      return NextResponse.json(
        { error: "거래처명은 필수입니다." },
        { status: 400 },
      );
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    const { data, error } = await supabase
      .from("expense_vendors")
      .insert({
        user_id: userId,
        business_id: businessId,
        name,
        business_number: body.businessNumber || null,
        contact: body.contact || null,
        default_category: body.defaultCategory || null,
        default_payment_method: body.defaultPaymentMethod || null,
        notes: body.notes || null,
        is_active: body.isActive ?? true,
      })
      .select()
      .single();

    if (error)
      return NextResponse.json(
        { error: `거래처 등록 실패: ${error.message}` },
        { status: 500 },
      );
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "거래처 등록 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const body = await request.json();
    const id = String(body.id || "");
    if (!id)
      return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name)
        return NextResponse.json(
          { error: "거래처명은 비울 수 없습니다." },
          { status: 400 },
        );
      updates.name = name;
    }
    if (body.businessNumber !== undefined)
      updates.business_number = body.businessNumber || null;
    if (body.contact !== undefined) updates.contact = body.contact || null;
    if (body.defaultCategory !== undefined)
      updates.default_category = body.defaultCategory || null;
    if (body.defaultPaymentMethod !== undefined)
      updates.default_payment_method = body.defaultPaymentMethod || null;
    if (body.notes !== undefined) updates.notes = body.notes || null;
    if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);

    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }
    let query = supabase
      .from("expense_vendors")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId);
    query = scopeBusiness(query, businessId);
    const { data, error } = await query.select().single();
    if (error)
      return NextResponse.json(
        { error: `거래처 수정 실패: ${error.message}` },
        { status: 500 },
      );
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "거래처 수정 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
