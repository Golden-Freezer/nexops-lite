import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

// NOTE: expenses 테이블은 마이그레이션 후 `npm run db:types`로 타입 재생성 필요

class ExpenseVendorValidationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 500,
  ) {
    super(message);
    this.name = "ExpenseVendorValidationError";
  }
}

async function validateVendor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  vendorId: unknown,
  userId: string,
  businessId: string,
): Promise<string | null> {
  if (!vendorId) return null;
  let query = supabase
    .from("expense_vendors")
    .select("id")
    .eq("id", String(vendorId))
    .eq("user_id", userId)
    .eq("is_active", true);
  query = query.eq("business_id", businessId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ExpenseVendorValidationError(
      `거래처 확인 실패: ${error.message}`,
      500,
    );
  }
  if (!data) {
    throw new ExpenseVendorValidationError(
      "선택한 거래처를 현재 사업장에서 찾을 수 없습니다.",
      400,
    );
  }
  return data.id;
}

/** GET /api/expenses - 지출 목록 */
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
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const category = searchParams.get("category");

    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    const buildQuery = () => {
      let q = supabase.from("expenses").select("*").eq("user_id", userId);
      q = q.eq("business_id", businessId);
      if (startDate) q = q.gte("expense_date", startDate);
      if (endDate) q = q.lte("expense_date", endDate);
      if (category) q = q.eq("category", category);
      return q
        .order("expense_date", { ascending: false })
        .order("id", { ascending: true });
    };

    // PostgREST max_rows(기본 1000) 캡을 우회하여 전체 조회
    const { data, error } = await fetchAllRows(buildQuery);

    if (error) {
      return NextResponse.json(
        { error: `지출 조회 실패: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "지출 조회 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

/** POST /api/expenses - 지출 등록 */
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 JSON 형식입니다." },
        { status: 400 },
      );
    }

    if (!body.expenseDate || !body.category || body.amount == null) {
      return NextResponse.json(
        { error: "지출일, 카테고리, 금액은 필수입니다." },
        { status: 400 },
      );
    }

    if (Number(body.amount) <= 0) {
      return NextResponse.json(
        { error: "금액은 0보다 커야 합니다." },
        { status: 400 },
      );
    }

    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }
    let vendorId: string | null;
    try {
      vendorId = await validateVendor(
        supabase,
        body.vendorId,
        userId,
        businessId,
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "거래처 검증 실패" },
        {
          status:
            error instanceof ExpenseVendorValidationError ? error.status : 500,
        },
      );
    }

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        user_id: userId,
        business_id: businessId,
        expense_date: body.expenseDate,
        category: body.category,
        description: body.description || null,
        amount: Number(body.amount),
        vat_amount: Number(body.vatAmount || 0),
        payment_method: body.paymentMethod || "card",
        vendor_id: vendorId,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `지출 등록 실패: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "지출 등록 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

/** PATCH /api/expenses - 지출 수정 */
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
    const id = body.id as string;
    if (!id)
      return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (body.expenseDate !== undefined) updates.expense_date = body.expenseDate;
    if (body.category !== undefined) updates.category = body.category;
    if (body.description !== undefined)
      updates.description = body.description || null;
    if (body.amount !== undefined) updates.amount = Number(body.amount);
    if (body.vatAmount !== undefined)
      updates.vat_amount = Number(body.vatAmount);
    if (body.paymentMethod !== undefined)
      updates.payment_method = body.paymentMethod;
    if (body.notes !== undefined) updates.notes = body.notes || null;

    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }
    if (body.vendorId !== undefined) {
      try {
        updates.vendor_id = await validateVendor(
          supabase,
          body.vendorId,
          userId,
          businessId,
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "거래처 검증 실패",
          },
          {
            status:
              error instanceof ExpenseVendorValidationError
                ? error.status
                : 500,
          },
        );
      }
    }

    let updateQuery = supabase
      .from("expenses")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId);
    updateQuery = updateQuery.eq("business_id", businessId);

    const { data, error } = await updateQuery.select().single();

    if (error)
      return NextResponse.json(
        { error: `지출 수정 실패: ${error.message}` },
        { status: 500 },
      );
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "지출 수정 중 오류" },
      { status: 500 },
    );
  }
}

/** DELETE /api/expenses - 회계 원장 보존을 위해 하드 삭제 금지 */
export async function DELETE(_request: NextRequest) {
  try {
    await requireAuth();

    return NextResponse.json(
      {
        error:
          "지출 내역은 회계·세무 원장이므로 삭제할 수 없습니다. 오류는 수정 내역으로 정정해 주세요.",
        code: "EXPENSE_DELETE_BLOCKED_LEDGER_SAFETY",
      },
      { status: 409 },
    );
  } catch (error) {
    if (error instanceof NextResponse) return error;
    return NextResponse.json(
      { error: "인증 확인 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
