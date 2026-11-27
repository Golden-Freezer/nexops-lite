import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { kstTodayStr } from "@/lib/analytics/date-buckets";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestContext {
  userId: string;
  businessId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getContext(): Promise<RequestContext | NextResponse> {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (response) {
    return response as NextResponse;
  }
  let businessId: string;
  try {
    businessId = await requireOwnedBusinessId(userId);
  } catch (response) {
    return response as NextResponse;
  }
  // 신규 테이블은 다음 DB 타입 생성 전까지 런타임 스키마를 사용한다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  return { userId, businessId, supabase };
}

async function getOwnedFocusProduct(context: RequestContext, id: string) {
  const { data, error } = await context.supabase
    .from("focus_products")
    .select("id,coupang_exposure_id")
    .eq("id", id)
    .eq("user_id", context.userId)
    .eq("business_id", context.businessId)
    .maybeSingle();
  if (error) throw new Error(`주력상품 소속 확인 실패: ${error.message}`);
  return data as { id: string; coupang_exposure_id: string } | null;
}

/** 순위 타겟과 같은 노출ID의 등록 가능한 옵션 후보를 반환한다. */
export async function GET(request: NextRequest) {
  try {
    const context = await getContext();
    if (context instanceof NextResponse) return context;
    const searchParams = new URL(request.url).searchParams;
    const focusProductId = searchParams.get("focusProductId")?.trim() || "";
    const includeInactive = searchParams.get("includeInactive") === "1";
    if (!UUID_PATTERN.test(focusProductId)) {
      return NextResponse.json(
        { error: "focusProductId가 올바르지 않습니다." },
        { status: 400 },
      );
    }
    const focusProduct = await getOwnedFocusProduct(context, focusProductId);
    if (!focusProduct) {
      return NextResponse.json(
        { error: "주력상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    let targetsQuery = context.supabase
      .from("focus_rank_targets")
      .select(
        "id,vendor_item_id,option_label,keyword,is_active,valid_from,valid_to",
      )
      .eq("user_id", context.userId)
      .eq("business_id", context.businessId)
      .eq("focus_product_id", focusProductId);
    if (!includeInactive) targetsQuery = targetsQuery.eq("is_active", true);

    const [targetsResult, productsResult] = await Promise.all([
      targetsQuery.order("created_at", { ascending: true }),
      context.supabase
        .from("products")
        .select("coupang_option_id,option_name,product_name")
        .eq("user_id", context.userId)
        .eq("business_id", context.businessId)
        .eq("coupang_exposure_id", focusProduct.coupang_exposure_id)
        .not("coupang_option_id", "is", null),
    ]);
    if (targetsResult.error) {
      throw new Error(`순위 타겟 조회 실패: ${targetsResult.error.message}`);
    }
    if (productsResult.error) {
      throw new Error(`옵션 후보 조회 실패: ${productsResult.error.message}`);
    }

    const options = [
      ...new Map<string, { vendor_item_id: string; option_label: string }>(
        (productsResult.data || []).map(
          (product: {
            coupang_option_id: string;
            option_name: string | null;
            product_name: string | null;
          }) => {
            const vendorItemId = String(product.coupang_option_id);
            return [
              vendorItemId,
              {
                vendor_item_id: vendorItemId,
                option_label:
                  product.option_name || product.product_name || vendorItemId,
              },
            ];
          },
        ),
      ).values(),
    ];

    return NextResponse.json({
      data: { targets: targetsResult.data || [], options },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** 현재 주력상품의 옵션과 키워드 조합을 순위 추적 타겟으로 등록한다. */
export async function POST(request: NextRequest) {
  try {
    const context = await getContext();
    if (context instanceof NextResponse) return context;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "올바른 JSON 본문이 필요합니다." },
        { status: 400 },
      );
    }
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "요청 본문이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const focusProductId =
      typeof body.focus_product_id === "string"
        ? body.focus_product_id.trim()
        : "";
    const vendorItemId =
      typeof body.vendor_item_id === "string" ? body.vendor_item_id.trim() : "";
    const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
    if (!UUID_PATTERN.test(focusProductId) || !vendorItemId || !keyword) {
      return NextResponse.json(
        { error: "focus_product_id, vendor_item_id, keyword가 필요합니다." },
        { status: 400 },
      );
    }
    if (keyword.length > 200 || vendorItemId.length > 100) {
      return NextResponse.json(
        { error: "옵션 ID 또는 키워드가 너무 깁니다." },
        { status: 400 },
      );
    }
    if (
      body.option_label !== undefined &&
      body.option_label !== null &&
      typeof body.option_label !== "string"
    ) {
      return NextResponse.json(
        { error: "option_label은 문자열이어야 합니다." },
        { status: 400 },
      );
    }

    const focusProduct = await getOwnedFocusProduct(context, focusProductId);
    if (!focusProduct) {
      return NextResponse.json(
        { error: "주력상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    const { data: product, error: productError } = await context.supabase
      .from("products")
      .select("coupang_option_id,option_name,product_name")
      .eq("user_id", context.userId)
      .eq("business_id", context.businessId)
      .eq("coupang_exposure_id", focusProduct.coupang_exposure_id)
      .eq("coupang_option_id", vendorItemId)
      .limit(1)
      .maybeSingle();
    if (productError)
      throw new Error(`옵션 소속 확인 실패: ${productError.message}`);
    if (!product) {
      return NextResponse.json(
        { error: "해당 주력상품 노출ID에 속한 옵션이 아닙니다." },
        { status: 400 },
      );
    }

    const requestedLabel =
      typeof body.option_label === "string"
        ? body.option_label.trim() || null
        : null;
    const optionLabel =
      requestedLabel ||
      product.option_name ||
      product.product_name ||
      vendorItemId;

    const { data: existingTarget, error: existingError } =
      await context.supabase
        .from("focus_rank_targets")
        .select("id,vendor_item_id,option_label,keyword,is_active")
        .eq("user_id", context.userId)
        .eq("business_id", context.businessId)
        .eq("focus_product_id", focusProductId)
        .eq("vendor_item_id", vendorItemId)
        .eq("keyword", keyword)
        .maybeSingle();
    if (existingError)
      throw new Error(`기존 순위 타겟 확인 실패: ${existingError.message}`);
    if (existingTarget?.is_active === false) {
      return NextResponse.json(
        {
          error:
            "종료된 동일 옵션·키워드 타겟은 기간 이력 보존을 위해 다시 활성화할 수 없습니다. 새 키워드 타겟으로 등록해 주세요.",
          code: "FOCUS_RANK_TARGET_REACTIVATION_BLOCKED_HISTORY_SAFETY",
        },
        { status: 409 },
      );
    }
    if (existingTarget) {
      return NextResponse.json({ data: existingTarget }, { status: 200 });
    }

    const { data, error } = await context.supabase
      .from("focus_rank_targets")
      .insert({
        user_id: context.userId,
        business_id: context.businessId,
        focus_product_id: focusProductId,
        vendor_item_id: vendorItemId,
        option_label: optionLabel,
        keyword,
        is_active: true,
        valid_from: kstTodayStr(),
        valid_to: null,
        updated_at: new Date().toISOString(),
      })
      .select("id,vendor_item_id,option_label,keyword")
      .single();
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "동일한 옵션·키워드 타겟이 이미 존재합니다." },
        { status: 409 },
      );
    }
    if (error) throw new Error(`순위 타겟 등록 실패: ${error.message}`);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** 순위 타겟을 비활성화하고 과거 관측 이력은 보존한다. */
export async function DELETE(request: NextRequest) {
  try {
    const context = await getContext();
    if (context instanceof NextResponse) return context;
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "id가 올바르지 않습니다." },
        { status: 400 },
      );
    }
    const endedAt = new Date();
    const { data, error } = await context.supabase
      .from("focus_rank_targets")
      .update({
        is_active: false,
        valid_to: kstTodayStr(endedAt),
        updated_at: endedAt.toISOString(),
      })
      .eq("id", id)
      .eq("user_id", context.userId)
      .eq("business_id", context.businessId)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`순위 타겟 종료 실패: ${error.message}`);
    if (!data) {
      const { data: existing, error: existingError } = await context.supabase
        .from("focus_rank_targets")
        .select("id,is_active")
        .eq("id", id)
        .eq("user_id", context.userId)
        .eq("business_id", context.businessId)
        .maybeSingle();
      if (existingError)
        throw new Error(`순위 타겟 상태 확인 실패: ${existingError.message}`);
      if (existing && existing.is_active === false) {
        return NextResponse.json({
          success: true,
          preservedHistory: true,
          alreadyInactive: true,
        });
      }
      return NextResponse.json(
        { error: "순위 타겟을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, preservedHistory: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
