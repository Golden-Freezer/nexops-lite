import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface RequestContext {
  userId: string;
  businessId: string;
  // 신규 테이블은 다음 DB 타입 생성 전까지 런타임 스키마를 사용한다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseMonth(
  value: string | null,
  min: number,
  max: number,
): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function monthRange(year: number, month: number) {
  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(next.getTime() - 86_400_000);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

function nullablePositiveInteger(
  value: unknown,
  field: string,
): { value: number | null; error?: string } {
  if (value === undefined || value === null || value === "")
    return { value: null };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { value: null, error: `${field}는 1 이상의 정수여야 합니다.` };
  }
  return { value: parsed };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  return { userId, businessId, supabase };
}

async function verifyFocusProduct(context: RequestContext, id: string) {
  const { data, error } = await context.supabase
    .from("focus_products")
    .select("id")
    .eq("id", id)
    .eq("user_id", context.userId)
    .eq("business_id", context.businessId)
    .maybeSingle();
  if (error) throw new Error(`주력상품 소속 확인 실패: ${error.message}`);
  return Boolean(data);
}

async function findOwnedActiveTarget(context: RequestContext, id: string) {
  const { data, error } = await context.supabase
    .from("focus_rank_targets")
    .select("id")
    .eq("id", id)
    .eq("user_id", context.userId)
    .eq("business_id", context.businessId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`순위 타겟 소속 확인 실패: ${error.message}`);
  return data as { id: string } | null;
}

/** 주력상품의 옵션별 월간 순위를 반환하며, 같은 날짜에는 수동값을 우선한다. */
export async function GET(request: NextRequest) {
  try {
    const context = await getContext();
    if (context instanceof NextResponse) return context;

    const { searchParams } = new URL(request.url);
    const focusProductId = searchParams.get("focusProductId")?.trim() || "";
    const includeInactive = searchParams.get("includeInactive") === "1";
    const year = parseMonth(searchParams.get("year"), 1, 9999);
    const month = parseMonth(searchParams.get("month"), 1, 12);
    if (!UUID_PATTERN.test(focusProductId) || year === null || month === null) {
      return NextResponse.json(
        { error: "focusProductId, year, month를 올바르게 입력해 주세요." },
        { status: 400 },
      );
    }
    if (!(await verifyFocusProduct(context, focusProductId))) {
      return NextResponse.json(
        { error: "주력상품을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const range = monthRange(year, month);
    let targetsQuery = context.supabase
      .from("focus_rank_targets")
      .select(
        "id,vendor_item_id,option_label,keyword,is_active,valid_from,valid_to",
      )
      .eq("user_id", context.userId)
      .eq("business_id", context.businessId)
      .eq("focus_product_id", focusProductId);
    if (includeInactive) {
      targetsQuery = targetsQuery
        .lte("valid_from", range.end)
        .or(`valid_to.is.null,valid_to.gte.${range.start}`);
    } else {
      targetsQuery = targetsQuery.eq("is_active", true);
    }
    const { data: targets, error: targetsError } = await targetsQuery.order(
      "created_at",
      { ascending: true },
    );
    if (targetsError)
      throw new Error(`순위 타겟 조회 실패: ${targetsError.message}`);

    const targetIds = (targets || []).map(
      (target: { id: string }) => target.id,
    );
    if (targetIds.length === 0) {
      return NextResponse.json({ data: { targets: [], daily: [] } });
    }

    const { data: observations, error: dailyError } = await context.supabase
      .from("focus_rank_daily")
      .select("target_id,metric_date,rank,page,position_in_page,found,source")
      .eq("user_id", context.userId)
      .eq("business_id", context.businessId)
      .in("target_id", targetIds)
      .gte("metric_date", range.start)
      .lte("metric_date", range.end)
      .order("metric_date", { ascending: true });
    if (dailyError)
      throw new Error(`일별 순위 조회 실패: ${dailyError.message}`);

    const preferred = new Map<string, (typeof observations)[number]>();
    for (const row of observations || []) {
      const key = `${row.target_id}:${row.metric_date}`;
      const current = preferred.get(key);
      if (!current || row.source === "manual") preferred.set(key, row);
    }

    return NextResponse.json({
      data: { targets: targets || [], daily: [...preferred.values()] },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function upsertManual(request: NextRequest) {
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

    const targetId =
      typeof body.target_id === "string" ? body.target_id.trim() : "";
    const metricDate =
      typeof body.metric_date === "string" ? body.metric_date.trim() : "";
    if (!UUID_PATTERN.test(targetId) || !isValidDate(metricDate)) {
      return NextResponse.json(
        { error: "target_id와 metric_date를 올바르게 입력해 주세요." },
        { status: 400 },
      );
    }
    const target = await findOwnedActiveTarget(context, targetId);
    if (!target) {
      return NextResponse.json(
        { error: "순위 타겟을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const rank = nullablePositiveInteger(body.rank, "rank");
    const page = nullablePositiveInteger(body.page, "page");
    const position = nullablePositiveInteger(
      body.position_in_page,
      "position_in_page",
    );
    for (const result of [rank, page, position]) {
      if (result.error)
        return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (
      body.found !== undefined &&
      body.found !== null &&
      typeof body.found !== "boolean"
    ) {
      return NextResponse.json(
        { error: "found는 boolean 또는 null이어야 합니다." },
        { status: 400 },
      );
    }
    if (body.found === false && rank.value !== null) {
      return NextResponse.json(
        { error: "found=false인 관측에는 rank를 함께 저장할 수 없습니다." },
        { status: 400 },
      );
    }
    const found =
      rank.value !== null
        ? true
        : body.found === null || typeof body.found === "boolean"
          ? body.found
          : null;

    const now = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("focus_rank_daily")
      .upsert(
        {
          user_id: context.userId,
          business_id: context.businessId,
          target_id: targetId,
          metric_date: metricDate,
          rank: rank.value,
          page: page.value,
          position_in_page: position.value,
          found,
          page_size: null,
          scan_depth: null,
          source: "manual",
          source_ranking_item_id: null,
          observed_at: now,
          updated_at: now,
        },
        { onConflict: "business_id,target_id,metric_date,source" },
      )
      .select("target_id,metric_date,rank,page,position_in_page,found,source")
      .single();
    if (error) throw new Error(`수동 순위 저장 실패: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** 수동 순위를 입력하거나 같은 날짜의 수동값을 보정한다. */
export async function POST(request: NextRequest) {
  return upsertManual(request);
}

/** POST와 같은 자연키로 기존 수동값을 수정한다. */
export async function PATCH(request: NextRequest) {
  return upsertManual(request);
}

/** 수동 순위도 관측 이력이므로 하드 삭제를 금지한다. */
export async function DELETE(_request: NextRequest) {
  try {
    await requireAuth();

    return NextResponse.json(
      {
        error:
          "수동 순위는 관측 이력이므로 삭제할 수 없습니다. 오류는 올바른 순위로 다시 저장해 정정해 주세요.",
        code: "FOCUS_RANK_DELETE_BLOCKED_HISTORY_SAFETY",
      },
      { status: 409 },
    );
  } catch (error) {
    if (error instanceof NextResponse) return error;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
