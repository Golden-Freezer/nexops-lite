import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/clerk";
import { getBusinessId } from "@/lib/auth/business";
import {
  dedupeProductsByExposureId,
  matchCampaignProducts,
  type CampaignMatchProduct,
} from "@/lib/focus/campaign-match";
import { createAdminClient } from "@/lib/supabase/admin";

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 로컬 워커가 수확한 현재 사업장의 광고 캠페인 카탈로그를 반환한다. */
export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = await requireAuth();
    } catch (response) {
      return response as NextResponse;
    }

    const businessId = await getBusinessId();
    if (!businessId) {
      return NextResponse.json(
        { error: "사업장을 선택해 주세요." },
        { status: 400 },
      );
    }

    // 신규 테이블은 다음 DB 타입 생성 전까지 admin client의 런타임 스키마를 사용한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;
    const onlyRegisterable =
      new URL(request.url).searchParams.get("onlyRegisterable") === "1";

    let catalogQuery = supabase
      .from("focus_campaign_catalog")
      .select(
        "campaign_id,name,budget,roas_target,created_at_source,is_active,goal_type,is_auto_product_selection",
      )
      .eq("user_id", userId)
      .eq("business_id", businessId);

    if (onlyRegisterable) {
      catalogQuery = catalogQuery
        .eq("is_active", true)
        .eq("goal_type", "SALES")
        .eq("is_auto_product_selection", false);
    }

    const [catalogResult, registeredResult, productsResult] = await Promise.all(
      [
        catalogQuery.order("created_at_source", { ascending: false }),
        supabase
          .from("focus_products")
          .select("campaign_id")
          .eq("user_id", userId)
          .eq("business_id", businessId),
        supabase
          .from("products")
          .select("id,product_name,coupang_exposure_id,product_grade")
          .eq("user_id", userId)
          .eq("business_id", businessId)
          .eq("purpose", "product"),
      ],
    );

    if (catalogResult.error) {
      throw new Error(
        `캠페인 카탈로그 조회 실패: ${catalogResult.error.message}`,
      );
    }
    if (registeredResult.error) {
      throw new Error(
        `등록 캠페인 조회 실패: ${registeredResult.error.message}`,
      );
    }
    if (productsResult.error) {
      throw new Error(
        `상품 매칭 후보 조회 실패: ${productsResult.error.message}`,
      );
    }

    const registeredIds = new Set<string>(
      (registeredResult.data || []).map((row: { campaign_id: string }) =>
        String(row.campaign_id),
      ),
    );
    const campaigns = onlyRegisterable
      ? (catalogResult.data || []).filter(
          (row: { campaign_id: string }) =>
            !registeredIds.has(String(row.campaign_id)),
        )
      : catalogResult.data || [];

    const productRows = (productsResult.data || []) as CampaignMatchProduct[];
    const representativeProducts = dedupeProductsByExposureId(productRows);
    const candidates = campaigns.map(
      (campaign: {
        campaign_id: string;
        name: string | null;
        budget: unknown;
        roas_target: unknown;
        created_at_source: string | null;
      }) => ({
        campaign_id: String(campaign.campaign_id),
        name: campaign.name,
        budget: nullableNumber(campaign.budget),
        roas_target: nullableNumber(campaign.roas_target),
        created_at_source: campaign.created_at_source,
        suggestions: matchCampaignProducts(
          campaign.name,
          representativeProducts,
          3,
        ),
      }),
    );

    const products = representativeProducts
      .map((product) => ({
        coupang_exposure_id: product.coupang_exposure_id as string,
        product_name: product.product_name ?? "(상품명 없음)",
        product_grade: product.product_grade ?? null,
        product_id: product.id,
      }))
      .sort(
        (left, right) =>
          left.product_name.localeCompare(right.product_name, "ko-KR") ||
          left.coupang_exposure_id.localeCompare(right.coupang_exposure_id),
      );

    return NextResponse.json({ candidates, products });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
