import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertProductCost } from "@/lib/supabase/typed-queries";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";

/** GET /api/products/[id]/costs - 원가 히스토리 조회 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    const { id } = await params;
    const supabase = createAdminClient();

    // 상품 소유권 확인
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, purpose, business_id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (productError) {
      return NextResponse.json(
        { error: `상품 검증 실패: ${productError.message}` },
        { status: 500 },
      );
    }
    if (!product) {
      return NextResponse.json(
        { error: "상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    if (product.purpose === "product") {
      let businessId: string;
      try {
        businessId = await requireOwnedBusinessId(userId);
      } catch (r) {
        return r as NextResponse;
      }
      if (product.business_id !== businessId) {
        return NextResponse.json(
          { error: "현재 사업장에 속한 상품이 아닙니다." },
          { status: 404 },
        );
      }
    }

    const { data, error } = await supabase
      .from("product_costs")
      .select(
        `
        id, unit_cost, selling_price, fulfillment_fee,
        commission_rate, margin, margin_rate, min_roas,
        return_rate, created_at,
        supplier_id,
        suppliers ( user_id, name, source_type, url, negotiated_price, shipping_fee, screenshots )
      `,
      )
      .eq("product_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `조회 실패: ${error.message}` },
        { status: 500 },
      );
    }

    // service-role 조인은 RLS를 우회하므로, 과거 오염 행이 타 사용자의 supplier_id를
    // 가리키더라도 공급처 상세가 응답에 포함되지 않게 한 번 더 정리한다.
    const safeData = (data || []).map((row) => {
      const supplier = row.suppliers as
        | ({ user_id?: string } & Record<string, unknown>)
        | null;
      if (!supplier || supplier.user_id !== userId) {
        return { ...row, supplier_id: null, suppliers: null };
      }
      const { user_id: _supplierUserId, ...publicSupplier } = supplier;
      return { ...row, suppliers: publicSupplier };
    });

    return NextResponse.json({ data: safeData });
  } catch (error) {
    return NextResponse.json(
      { error: "원가 히스토리 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

/** POST /api/products/[id]/costs - 원가 기록 저장 (같은 supplier면 UPDATE, 없으면 INSERT) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (r) {
      return r as NextResponse;
    }
    const { id } = await params;
    const supabase = createAdminClient();

    // 상품 소유권 확인
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, purpose, business_id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (productError) {
      return NextResponse.json(
        { error: `상품 검증 실패: ${productError.message}` },
        { status: 500 },
      );
    }
    if (!product) {
      return NextResponse.json(
        { error: "상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    if (product.purpose === "product") {
      let businessId: string;
      try {
        businessId = await requireOwnedBusinessId(userId);
      } catch (r) {
        return r as NextResponse;
      }
      if (product.business_id !== businessId) {
        return NextResponse.json(
          { error: "현재 사업장에 속한 상품이 아닙니다." },
          { status: 404 },
        );
      }
    }
    const body = await request.json();

    const supplierId = body.supplierId || null;
    if (supplierId) {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .select("id")
        .eq("id", supplierId)
        .eq("user_id", userId)
        .maybeSingle();
      if (supplierError) {
        return NextResponse.json(
          { error: `공급처 검증 실패: ${supplierError.message}` },
          { status: 500 },
        );
      }
      if (!supplier) {
        return NextResponse.json(
          { error: "현재 사용자에게 속한 공급처가 아닙니다." },
          { status: 400 },
        );
      }
    }
    const costData = {
      unit_cost: body.unitCost,
      selling_price: body.sellingPrice,
      fulfillment_fee: body.fulfillmentFee,
      commission_rate: body.commissionRate,
      margin: body.margin,
      margin_rate: body.marginRate,
      min_roas: body.minRoas,
      return_rate: body.returnRate || 0.08,
    };

    // 같은 product_id + supplier_id 조합의 기존 레코드 확인
    let existingQuery = supabase
      .from("product_costs")
      .select("id")
      .eq("product_id", id);

    if (supplierId) {
      existingQuery = existingQuery.eq("supplier_id", supplierId);
    } else {
      existingQuery = existingQuery.is("supplier_id", null);
    }

    const { data: existing } = await existingQuery.limit(1);

    let data, error;
    if (existing && existing.length > 0) {
      // 기존 레코드 업데이트
      const result = await supabase
        .from("product_costs")
        .update(costData)
        .eq("id", (existing[0] as Record<string, unknown>).id as string)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // 신규 레코드 삽입
      const result = await insertProductCost(supabase, {
        product_id: id,
        supplier_id: supplierId,
        ...costData,
      });
      data = result.data;
      error = result.error;
    }

    if (error) {
      return NextResponse.json(
        { error: `저장 실패: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: "원가 기록 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
