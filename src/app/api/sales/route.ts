import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { syncDailySettlements } from "@/lib/settlement/auto-sync";

const SALES_STATUSES = ["confirmed", "cancelled", "returned"] as const;
type SalesStatus = (typeof SALES_STATUSES)[number];

function isSalesStatus(value: unknown): value is SalesStatus {
  return SALES_STATUSES.some((status) => status === value);
}

/** GET /api/sales - 일일 매출 목록 (기간 필터) */
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
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const buildQuery = () => {
      let q = supabase
        .from("sales_transactions")
        .select(
          `*, products ( product_name, sku, product_grade, user_id, business_id )`,
        )
        .eq("user_id", userId);
      q = q.eq("business_id", businessId);
      if (startDate) q = q.gte("order_date", startDate);
      if (endDate) q = q.lte("order_date", endDate);
      return q
        .order("order_date", { ascending: false })
        .order("id", { ascending: false });
    };

    // PostgREST max_rows(기본 1000) 캡을 우회하여 전체 조회
    const { data, error } = await fetchAllRows(buildQuery);
    if (error) {
      return NextResponse.json(
        { error: `매출 조회 실패: ${error.message}` },
        { status: 500 },
      );
    }

    const safeRows = (data || []).map((row: Record<string, unknown>) => {
      const product = row.products as Record<string, unknown> | null;
      if (
        !product ||
        product.user_id !== userId ||
        product.business_id !== businessId
      ) {
        return { ...row, products: null };
      }
      const {
        user_id: _productUserId,
        business_id: _productBusinessId,
        ...publicProduct
      } = product;
      return { ...row, products: publicProduct };
    });

    return NextResponse.json({ data: safeRows });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "매출 조회 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

/** POST /api/sales - 매출 수동 등록 */
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
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 JSON 형식입니다." },
        { status: 400 },
      );
    }

    if (
      !body.orderDate ||
      body.sellingPrice == null ||
      body.totalAmount == null
    ) {
      return NextResponse.json(
        { error: "주문일, 판매가, 매출액은 필수입니다." },
        { status: 400 },
      );
    }

    const status = body.status ?? "confirmed";
    if (!isSalesStatus(status)) {
      return NextResponse.json(
        {
          error: "status는 confirmed, cancelled, returned 중 하나여야 합니다.",
        },
        { status: 400 },
      );
    }

    const productId =
      body.productId == null || body.productId === ""
        ? null
        : String(body.productId);
    if (productId) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .maybeSingle();
      if (productError) {
        return NextResponse.json(
          { error: `상품 검증 실패: ${productError.message}` },
          { status: 500 },
        );
      }
      if (!product) {
        return NextResponse.json(
          { error: "현재 사업장에 속한 상품이 아닙니다." },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabase
      .from("sales_transactions")
      .insert({
        user_id: userId,
        business_id: businessId,
        product_id: productId,
        option_id: body.optionId || null,
        order_number: body.orderNumber || null,
        order_date: body.orderDate,
        order_quantity: Number(body.orderQuantity) || 1,
        selling_price: Number(body.sellingPrice),
        total_amount: Number(body.totalAmount),
        unit_cost: body.unitCost != null ? Number(body.unitCost) : null,
        shipping_fee: Number(body.shippingFee || 0),
        commission_amount:
          body.commissionAmount != null ? Number(body.commissionAmount) : null,
        status,
        source: "manual",
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `매출 등록 실패: ${error.message}` },
        { status: 500 },
      );
    }

    let settlementWarning: string | null = null;
    try {
      await syncDailySettlements(supabase, {
        userId,
        businessId,
        orderDate: data.order_date,
      });
    } catch (settlementError) {
      settlementWarning =
        settlementError instanceof Error
          ? settlementError.message
          : "자동 정산 갱신에 실패했습니다.";
      console.error("[sales POST] 자동 정산 갱신 실패:", settlementError);
    }

    return NextResponse.json({
      data,
      ...(settlementWarning ? { warning: settlementWarning } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "매출 등록 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/sales - 매출 행 수정 (현재: 판매자할인쿠폰 직접 수정 + 마진 재계산)
 * body: { id, couponDiscount }
 * 마진 = 매출 - 원가×수량 - 수수료 - 수수료VAT - 입출고 - 입출고VAT - 쿠폰 - 부가세 (저장 공식과 동일)
 */
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
    let businessId: string;
    try {
      businessId = await requireOwnedBusinessId(userId);
    } catch (r) {
      return r as NextResponse;
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 JSON 형식입니다." },
        { status: 400 },
      );
    }

    const id = body.id as string;
    if (!id)
      return NextResponse.json({ error: "id는 필수입니다." }, { status: 400 });
    if (body.couponDiscount == null) {
      return NextResponse.json(
        { error: "couponDiscount는 필수입니다." },
        { status: 400 },
      );
    }
    const couponDiscount = Number(body.couponDiscount);
    if (!Number.isFinite(couponDiscount) || couponDiscount < 0) {
      return NextResponse.json(
        { error: "쿠폰 금액은 0 이상의 숫자여야 합니다." },
        { status: 400 },
      );
    }

    // 마진 재계산에 필요한 기존 값 조회 (사업장 한정)
    let sel = supabase
      .from("sales_transactions")
      .select(
        "order_date, total_amount, order_quantity, unit_cost, coupon_discount, commission_fee, commission_vat, fulfillment_fee, fulfillment_vat, vat, products ( commission_rate )",
      )
      .eq("id", id)
      .eq("user_id", userId);
    sel = sel.eq("business_id", businessId);
    const { data: cur, error: selError } = await sel.single();
    if (selError || !cur) {
      return NextResponse.json(
        { error: "해당 매출 행을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const n = (v: unknown) => Number(v) || 0;
    // 수수료·부가세 과세 기준 = 쿠폰 차감 후 최종 판매액이므로 쿠폰이 바뀌면 둘 다 재계산한다.
    // 단, 시트 확정값(장부 파일 등 요율 계산과 무관한 값)은 보존 — 기존 값이 요율/공식
    // 파생값과 일치할 때만 파생값으로 본다.
    const total = n(cur.total_amount);
    const oldCoupon = n(cur.coupon_discount);
    const oldNet = Math.max(0, total - oldCoupon);
    const newNet = Math.max(0, total - couponDiscount);
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;

    const masterRate = n((cur as { products?: { commission_rate?: unknown } }).products?.commission_rate);
    let commissionFee = n(cur.commission_fee);
    let commissionVat = n(cur.commission_vat);
    const commissionDerived =
      masterRate > 0 &&
      (near(commissionFee, Math.round(total * masterRate)) ||
        near(commissionFee, Math.round(oldNet * masterRate)));
    if (commissionDerived) {
      const vatDerived = near(commissionVat, Math.round(commissionFee * 0.1));
      commissionFee = Math.round(newNet * masterRate);
      if (vatDerived) commissionVat = Math.round(commissionFee * 0.1);
    }

    let vat = n(cur.vat);
    const salesVatDerived =
      total > 0 &&
      (near(vat, Math.floor(total / 11)) || near(vat, Math.floor(oldNet / 11)));
    if (salesVatDerived) vat = newNet > 0 ? Math.floor(newNet / 11) : 0;

    const margin =
      total -
      n(cur.unit_cost) * n(cur.order_quantity) -
      commissionFee -
      commissionVat -
      n(cur.fulfillment_fee) -
      n(cur.fulfillment_vat) -
      couponDiscount -
      vat;

    let upd = supabase
      .from("sales_transactions")
      .update({
        coupon_discount: couponDiscount,
        commission_fee: commissionFee,
        commission_vat: commissionVat,
        vat,
        margin,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);
    upd = upd.eq("business_id", businessId);
    const { data, error } = await upd.select().single();

    if (error) {
      return NextResponse.json(
        { error: `매출 수정 실패: ${error.message}` },
        { status: 500 },
      );
    }

    let settlementWarning: string | null = null;
    try {
      await syncDailySettlements(supabase, {
        userId,
        businessId,
        orderDate: cur.order_date,
      });
    } catch (settlementError) {
      settlementWarning =
        settlementError instanceof Error
          ? settlementError.message
          : "자동 정산 갱신에 실패했습니다.";
      console.error("[sales PATCH] 자동 정산 갱신 실패:", settlementError);
    }

    return NextResponse.json({
      data,
      ...(settlementWarning ? { warning: settlementWarning } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "매출 수정 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
