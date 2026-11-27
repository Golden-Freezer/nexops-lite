import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOCUS_PRODUCT_STATUSES = [
  "active",
  "paused_seasonal",
  "discontinued",
] as const;
type FocusProductStatus = (typeof FOCUS_PRODUCT_STATUSES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFocusProductStatus(value: unknown): value is FocusProductStatus {
  return FOCUS_PRODUCT_STATUSES.some((status) => status === value);
}

function getKstDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addProductNames(
  supabase: any,
  userId: string,
  businessId: string,
  rows: any[],
) {
  const productIds = [
    ...new Set(
      rows
        .map((row) => row.product_id)
        .filter(
          (productId): productId is string => typeof productId === "string",
        ),
    ),
  ];

  if (productIds.length === 0) {
    return rows.map((row) => ({ ...row, product_name: row.label ?? null }));
  }

  const { data: products, error } = await supabase
    .from("products")
    .select("id, product_name")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .in("id", productIds);

  if (error) throw new Error(`연결 상품 조회 실패: ${error.message}`);

  const names = new Map<string, string | null>(
    (products || []).map(
      (product: { id: string; product_name: string | null }) => [
        product.id,
        product.product_name,
      ],
    ),
  );

  return rows.map((row) => ({
    ...row,
    product_name: row.product_id
      ? (names.get(row.product_id) ?? row.label ?? null)
      : (row.label ?? null),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addProductStatuses(
  supabase: any,
  userId: string,
  businessId: string,
  rows: any[],
) {
  const focusProductIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");

  if (focusProductIds.length === 0) return rows;

  const { data: events, error } = await supabase
    .from("focus_product_status_events")
    .select("id, focus_product_id, status, effective_at, created_at")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .in("focus_product_id", focusProductIds)
    .order("effective_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(`주력상품 상태 조회 실패: ${error.message}`);

  const latestStatuses = new Map<string, FocusProductStatus>();
  for (const event of events || []) {
    if (
      typeof event.focus_product_id === "string" &&
      isFocusProductStatus(event.status) &&
      !latestStatuses.has(event.focus_product_id)
    ) {
      latestStatuses.set(event.focus_product_id, event.status);
    }
  }

  return rows.map((row) => ({
    ...row,
    status:
      latestStatuses.get(row.id) ?? (row.is_active ? "active" : "discontinued"),
  }));
}

/** 현재 사업장의 주력상품 목록을 반환한다. */
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
    } catch (response) {
      return response as NextResponse;
    }

    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "1";
    let query = supabase
      .from("focus_products")
      .select("*")
      .eq("user_id", userId)
      .eq("business_id", businessId);

    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) throw new Error(`주력상품 조회 실패: ${error.message}`);

    const namedRows = await addProductNames(
      supabase,
      userId,
      businessId,
      data || [],
    );
    const rows = await addProductStatuses(
      supabase,
      userId,
      businessId,
      namedRows,
    );
    return NextResponse.json({ data: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 주력상품과 광고 캠페인의 연결을 등록한다. */
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
    } catch (response) {
      return response as NextResponse;
    }

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
        { error: "올바른 요청 본문이 필요합니다." },
        { status: 400 },
      );
    }

    const exposureId =
      typeof body.coupang_exposure_id === "string"
        ? body.coupang_exposure_id.trim()
        : "";
    const campaignId =
      typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
    if (!exposureId || !campaignId) {
      return NextResponse.json(
        {
          error:
            "coupang_exposure_id와 campaign_id는 비어 있지 않은 문자열이어야 합니다.",
        },
        { status: 400 },
      );
    }

    const productId = body.product_id == null ? null : body.product_id;
    if (
      productId !== null &&
      (typeof productId !== "string" || !UUID_PATTERN.test(productId))
    ) {
      return NextResponse.json(
        { error: "product_id는 올바른 UUID여야 합니다." },
        { status: 400 },
      );
    }
    if (
      body.label !== undefined &&
      body.label !== null &&
      typeof body.label !== "string"
    ) {
      return NextResponse.json(
        { error: "label은 문자열이어야 합니다." },
        { status: 400 },
      );
    }

    if (productId) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (productError)
        throw new Error(`상품 검증 실패: ${productError.message}`);
      if (!product) {
        return NextResponse.json(
          { error: "현재 사업장에 속한 product_id가 아닙니다." },
          { status: 400 },
        );
      }
    }

    // 캠페인 ID도 클라이언트 입력이므로 현재 사업장의 수확 카탈로그에 실제로
    // 존재하는지 확인한다. service-role upsert 전에 확인하지 않으면 타 사업장의
    // campaign_id를 현재 사업장 주력상품에 연결할 수 있다.
    const { data: campaign, error: campaignError } = await supabase
      .from("focus_campaign_catalog")
      .select("campaign_id")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (campaignError)
      throw new Error(`캠페인 소속 확인 실패: ${campaignError.message}`);
    if (!campaign) {
      return NextResponse.json(
        { error: "현재 사업장에 속한 campaign_id가 아닙니다." },
        { status: 400 },
      );
    }

    const validFrom = getKstDate();
    const label =
      typeof body.label === "string" ? body.label.trim() || null : null;
    const { data: inserted, error: insertError } = await supabase
      .from("focus_products")
      .upsert(
        {
          user_id: userId,
          business_id: businessId,
          product_id: productId,
          coupang_exposure_id: exposureId,
          campaign_id: campaignId,
          label,
          valid_from: validFrom,
          is_active: true,
        },
        {
          onConflict: "business_id,coupang_exposure_id,campaign_id,valid_from",
          ignoreDuplicates: true,
        },
      )
      .select("*")
      .maybeSingle();

    if (insertError)
      throw new Error(`주력상품 등록 실패: ${insertError.message}`);

    let row = inserted;
    let status = 201;
    if (!row) {
      const { data: existing, error: existingError } = await supabase
        .from("focus_products")
        .select("*")
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("coupang_exposure_id", exposureId)
        .eq("campaign_id", campaignId)
        .eq("valid_from", validFrom)
        .maybeSingle();

      if (existingError)
        throw new Error(`기존 주력상품 조회 실패: ${existingError.message}`);
      if (!existing) throw new Error("등록 결과를 확인할 수 없습니다.");
      row = existing;
      status = 200;
    }

    const namedRows = await addProductNames(supabase, userId, businessId, [
      row,
    ]);
    const [result] = await addProductStatuses(
      supabase,
      userId,
      businessId,
      namedRows,
    );
    return NextResponse.json({ data: result }, { status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 주력상품의 운영 상태나 표시 이름을 수정한다. */
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
    } catch (response) {
      return response as NextResponse;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "올바른 JSON 본문이 필요합니다." },
        { status: 400 },
      );
    }
    if (
      !isRecord(body) ||
      typeof body.id !== "string" ||
      !UUID_PATTERN.test(body.id)
    ) {
      return NextResponse.json(
        { error: "id는 올바른 UUID여야 합니다." },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json(
          { error: "is_active는 boolean이어야 합니다." },
          { status: 400 },
        );
      }
      updates.is_active = body.is_active;
    }
    if (body.label !== undefined) {
      if (body.label !== null && typeof body.label !== "string") {
        return NextResponse.json(
          { error: "label은 문자열이어야 합니다." },
          { status: 400 },
        );
      }
      updates.label =
        typeof body.label === "string" ? body.label.trim() || null : null;
    }
    let requestedStatus: FocusProductStatus | undefined;
    if (body.status !== undefined) {
      if (!isFocusProductStatus(body.status)) {
        return NextResponse.json(
          {
            error:
              "status는 active, paused_seasonal, discontinued 중 하나여야 합니다.",
          },
          { status: 400 },
        );
      }
      requestedStatus = body.status;
    }
    if (
      body.note !== undefined &&
      body.note !== null &&
      typeof body.note !== "string"
    ) {
      return NextResponse.json(
        { error: "note는 문자열이어야 합니다." },
        { status: 400 },
      );
    }
    if (
      updates.is_active === undefined &&
      updates.label === undefined &&
      requestedStatus === undefined
    ) {
      return NextResponse.json(
        { error: "수정할 is_active, label 또는 status가 필요합니다." },
        { status: 400 },
      );
    }

    const { data: ownedProduct, error: ownershipError } = await supabase
      .from("focus_products")
      .select("id")
      .eq("id", body.id)
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (ownershipError)
      throw new Error(`주력상품 소속 확인 실패: ${ownershipError.message}`);
    if (!ownedProduct) {
      return NextResponse.json(
        { error: "주력상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    let insertedEventId: string | null = null;
    if (requestedStatus) {
      const effectiveAtDate = new Date();
      effectiveAtDate.setMilliseconds(0);
      const effectiveAt = effectiveAtDate.toISOString();
      const idempotencyKey = `status:${body.id}:${requestedStatus}:${effectiveAt}`;
      const note =
        typeof body.note === "string" ? body.note.trim() || null : null;

      const { data: event, error: eventError } = await supabase
        .from("focus_product_status_events")
        .upsert(
          {
            user_id: userId,
            business_id: businessId,
            focus_product_id: body.id,
            status: requestedStatus,
            effective_at: effectiveAt,
            note,
            idempotency_key: idempotencyKey,
          },
          {
            onConflict: "business_id,focus_product_id,idempotency_key",
            ignoreDuplicates: true,
          },
        )
        .select("id")
        .maybeSingle();

      if (eventError)
        throw new Error(
          `주력상품 상태 이벤트 기록 실패: ${eventError.message}`,
        );
      insertedEventId = event?.id ?? null;

      updates.is_active = requestedStatus === "active";
      if (requestedStatus === "active") updates.valid_to = null;
      if (requestedStatus === "discontinued") updates.valid_to = getKstDate();
    }

    const { data, error } = await supabase
      .from("focus_products")
      .update(updates)
      .eq("id", body.id)
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .select("*")
      .maybeSingle();

    if (error) {
      if (insertedEventId) {
        const { error: rollbackError } = await supabase
          .from("focus_product_status_events")
          .delete()
          .eq("id", insertedEventId)
          .eq("user_id", userId)
          .eq("business_id", businessId);
        if (rollbackError) {
          throw new Error(
            `주력상품 수정 실패: ${error.message}; 상태 이벤트 롤백 실패: ${rollbackError.message}`,
          );
        }
      }
      throw new Error(`주력상품 수정 실패: ${error.message}`);
    }
    if (!data)
      return NextResponse.json(
        { error: "주력상품을 찾을 수 없습니다." },
        { status: 404 },
      );

    const namedRows = await addProductNames(supabase, userId, businessId, [
      data,
    ]);
    const [result] = await addProductStatuses(
      supabase,
      userId,
      businessId,
      namedRows,
    );
    return NextResponse.json({ data: result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 주력상품·상태·순위 이력 보존을 위해 하드 삭제를 금지한다. */
export async function DELETE(_request: NextRequest) {
  try {
    await requireAuth();

    return NextResponse.json(
      {
        error:
          "주력상품은 운영·순위 이력 보존을 위해 삭제할 수 없습니다. 운영 상태를 '판매 종료'로 변경해 주세요.",
        code: "FOCUS_PRODUCT_DELETE_BLOCKED_HISTORY_SAFETY",
      },
      { status: 409 },
    );
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
