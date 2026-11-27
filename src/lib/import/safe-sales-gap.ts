import { resolveFulfillmentFallback } from "./fulfillment-fallback";
import type { ImportConfig } from "@/types/import";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

const SAFE_STATISTICS_CORE_FIELDS = [
  "option_id",
  "total_amount",
  "order_quantity",
  "gross_amount",
  "gross_quantity",
  "cancel_amount",
  "cancel_quantity",
] as const;

function normalizedHeader(value: string): string {
  return value.replace(/\s/g, "");
}

function isFiniteRawNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // 후속 normalizeNumber와 같은 문법만 허용한다. 괄호 음수는 여기서 통과시킨 뒤
  // 0으로 바뀌는 불일치가 생기므로 명시적인 선행 '-' 표기만 받는다.
  const parsed = Number(trimmed.replace(/[,\s원₩]/g, ""));
  return Number.isFinite(parsed);
}

/**
 * 안전 백필에서는 일반 Import의 빈값 기본치(수량 1, 금액 0)를 허용하지 않는다.
 * Wing Statistics의 핵심 원본 열과 각 상세행의 실제 숫자 셀을 정규화 전에 확인한다.
 */
export function assertSafeStatisticsRawRows(
  rows: Record<string, unknown>[],
  headers: string[],
  config: ImportConfig,
): void {
  const headerByField = new Map<string, string>();
  const usedHeaders = new Set<string>();

  for (const field of SAFE_STATISTICS_CORE_FIELDS) {
    const aliases = Object.entries(config.columnMapping)
      .filter(([, target]) => target === field)
      .map(([header]) => normalizedHeader(header));
    const actualHeader = headers.find((header) =>
      aliases.includes(normalizedHeader(header)),
    );
    if (!actualHeader) {
      throw new Error(`Wing Statistics 필수 원본 열이 없습니다: ${field}`);
    }
    const normalizedActual = normalizedHeader(actualHeader);
    if (usedHeaders.has(normalizedActual)) {
      throw new Error(
        `Wing Statistics 핵심 원본 열 매핑이 충돌합니다: ${field}`,
      );
    }
    usedHeaders.add(normalizedActual);
    headerByField.set(field, actualHeader);
  }

  let detailCount = 0;
  rows.forEach((row, index) => {
    const optionHeader = headerByField.get("option_id")!;
    const optionId = String(row[optionHeader] ?? "").trim();
    if (!optionId) return;
    detailCount += 1;

    for (const field of SAFE_STATISTICS_CORE_FIELDS.slice(1)) {
      const header = headerByField.get(field)!;
      if (!isFiniteRawNumber(row[header])) {
        throw new Error(
          `Wing Statistics ${index + 2}행의 ${field} 원본 숫자 값이 올바르지 않습니다.`,
        );
      }
    }
  });

  if (detailCount === 0) {
    throw new Error("Wing Statistics에 옵션 ID가 있는 판매 상세행이 없습니다.");
  }
}

export interface SafeSalesGapRow {
  user_id: string;
  business_id: string;
  product_id: string | null;
  order_date: string;
  option_id: string;
  option_name: string | null;
  product_type: string | null;
  category: string | null;
  order_quantity: number;
  selling_price: number;
  total_amount: number;
  gross_amount: number;
  gross_quantity: number;
  cancel_amount: number;
  cancel_quantity: number;
  coupon_discount: number;
  commission_rate: number;
  commission_fee: number;
  commission_vat: number;
  settlement_amount: number;
  fulfillment_fee: number;
  fulfillment_vat: number;
  payout_amount: number;
  unit_cost: number;
  vat: number;
  margin: number;
  item_winner_rate: number;
  status: "cancelled" | "confirmed";
  source: "coupang_import";
  import_batch_id: string;
}

interface ReadClient {
  // Supabase의 fluent query 타입 전체를 재노출하지 않고 read-only 표면만 받는다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

interface RpcClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

interface ProductRow {
  id: string;
  coupang_option_id: string | null;
  unit_cost_default: number | null;
  fulfillment_fee_default: number | null;
  fulfillment_fee_benefit_until: string | null;
  commission_rate: number | null;
  seller_discount_coupon: number | null;
}

export interface SafeSalesPreparationResult {
  rows: SafeSalesGapRow[];
  unmatchedOptions: number;
  fallbackApplied: {
    unitCost: number;
    fulfillmentFee: number;
    fulfillmentFeeMissingDefault: number;
  };
}

function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

/** 판매 상세행을 기존 데이터 변경 없이 조회 정보만으로 RPC 입력 형태로 조립한다. */
export async function prepareSafeSalesGapRows(
  db: ReadClient,
  input: {
    userId: string;
    businessId: string;
    importDate: string;
    batchId: string;
    rows: Record<string, unknown>[];
  },
): Promise<SafeSalesPreparationResult> {
  const detailRows = input.rows.filter((row) =>
    String(row.option_id ?? "").trim(),
  );
  if (detailRows.length === 0) {
    throw new Error(
      "등록할 판매 상세행이 없습니다. 기존 데이터는 변경되지 않았습니다.",
    );
  }
  const dates = new Set(
    detailRows.map((row) => String(row.order_date ?? "").trim()),
  );
  if (dates.size !== 1 || !dates.has(input.importDate)) {
    throw new Error(
      "판매 파일의 상세행 날짜가 요청 기준일과 일치하지 않습니다. 기존 데이터는 변경되지 않았습니다.",
    );
  }

  const optionIds = [
    ...new Set(detailRows.map((row) => String(row.option_id).trim())),
  ];
  const { data: products, error: productsError } = await fetchAllRows(() =>
    db
      .from("products")
      .select(
        "id, coupang_option_id, unit_cost_default, fulfillment_fee_default, fulfillment_fee_benefit_until, commission_rate, seller_discount_coupon",
      )
      .eq("user_id", input.userId)
      .eq("business_id", input.businessId)
      .in("coupang_option_id", optionIds)
      .order("id", { ascending: true }),
  );
  if (productsError)
    throw new Error(`상품 연결 조회 실패: ${productsError.message}`);

  const productMap = new Map<string, ProductRow>();
  for (const product of (products ?? []) as ProductRow[]) {
    const optionId = String(product.coupang_option_id ?? "").trim();
    if (!optionId) continue;
    if (productMap.has(optionId)) {
      throw new Error(
        `현재 사업장에서 옵션 ID ${optionId}의 상품 연결이 중복됩니다. 기존 데이터는 변경되지 않았습니다.`,
      );
    }
    productMap.set(optionId, product);
  }

  const productIds = [
    ...new Set([...productMap.values()].map((row) => row.id)),
  ];
  const avgCostMap = new Map<string, number>();
  const couponMap = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: states, error: statesError } = await fetchAllRows(() =>
      db
        .from("inventory_state")
        .select("product_id, avg_cost_krw")
        .in("product_id", productIds)
        .order("product_id", { ascending: true }),
    );
    if (statesError)
      throw new Error(`이동평균 원가 조회 실패: ${statesError.message}`);
    for (const state of states ?? []) {
      const cost = numeric(state.avg_cost_krw);
      if (cost > 0) avgCostMap.set(String(state.product_id), cost);
    }

    const { data: coupons, error: couponsError } = await fetchAllRows(() =>
      db
        .from("product_price_history")
        .select("id, product_id, value, effective_date")
        .in("product_id", productIds)
        .eq("field_name", "seller_discount_coupon")
        .lte("effective_date", input.importDate)
        .order("effective_date", { ascending: false })
        .order("id", { ascending: false }),
    );
    if (couponsError)
      throw new Error(`쿠폰 이력 조회 실패: ${couponsError.message}`);
    for (const coupon of coupons ?? []) {
      const productId = String(coupon.product_id);
      if (!couponMap.has(productId))
        couponMap.set(productId, numeric(coupon.value));
    }
  }

  const fallbackApplied = {
    unitCost: 0,
    fulfillmentFee: 0,
    fulfillmentFeeMissingDefault: 0,
  };
  let unmatchedOptions = 0;
  const rows = detailRows.map((row): SafeSalesGapRow => {
    const optionId = String(row.option_id).trim();
    const product = productMap.get(optionId) ?? null;
    if (!product) unmatchedOptions += 1;
    const orderQuantity = numeric(row.order_quantity);
    const totalAmount = numeric(row.total_amount);
    const rawUnitCost = numeric(row.unit_cost);
    const unitCost =
      rawUnitCost ||
      (product
        ? (avgCostMap.get(product.id) ?? numeric(product.unit_cost_default))
        : 0);
    const fulfillment = resolveFulfillmentFallback({
      sheetFee: row.fulfillment_fee,
      sheetVat: row.fulfillment_vat,
      defaultPerUnit: product?.fulfillment_fee_default,
      quantity: orderQuantity,
      orderDate: input.importDate,
      benefitUntil: product?.fulfillment_fee_benefit_until,
    });
    if (rawUnitCost === 0 && unitCost > 0) fallbackApplied.unitCost += 1;
    if (fulfillment.usedFallback) fallbackApplied.fulfillmentFee += 1;
    if (fulfillment.missingDefault)
      fallbackApplied.fulfillmentFeeMissingDefault += 1;

    const rawCoupon = numeric(row.coupon_discount);
    const perUnitCoupon =
      rawCoupon > 0
        ? 0
        : product
          ? (couponMap.get(product.id) ??
            numeric(product.seller_discount_coupon))
          : 0;
    const couponDiscount =
      rawCoupon ||
      (perUnitCoupon > 0 ? perUnitCoupon * Math.abs(orderQuantity) : 0);
    // 수수료·부가세 과세 기준 = 쿠폰 차감 후 최종 판매액 (process.ts 폴백과 동일 규칙)
    const netAmount = Math.max(0, totalAmount - couponDiscount);
    const commissionRate =
      numeric(row.commission_rate) || numeric(product?.commission_rate);
    const commissionFee =
      numeric(row.commission_fee) ||
      (commissionRate > 0 ? Math.round(netAmount * commissionRate) : 0);
    const commissionVat =
      numeric(row.commission_vat) || Math.round(commissionFee * 0.1);
    const vat =
      numeric(row.vat) || (netAmount > 0 ? Math.floor(netAmount / 11) : 0);
    const margin =
      totalAmount -
      unitCost * orderQuantity -
      commissionFee -
      commissionVat -
      fulfillment.fee -
      fulfillment.vat -
      couponDiscount -
      vat;

    return {
      user_id: input.userId,
      business_id: input.businessId,
      product_id: product?.id ?? null,
      order_date: input.importDate,
      option_id: optionId,
      option_name: optionalText(row.option_name),
      product_type: optionalText(row.product_type),
      category: optionalText(row.category),
      order_quantity: orderQuantity,
      selling_price:
        numeric(row.selling_price) ||
        (orderQuantity > 0 ? Math.round(totalAmount / orderQuantity) : 0),
      total_amount: totalAmount,
      gross_amount: numeric(row.gross_amount),
      gross_quantity: numeric(row.gross_quantity),
      cancel_amount: numeric(row.cancel_amount),
      cancel_quantity: numeric(row.cancel_quantity),
      coupon_discount: couponDiscount,
      commission_rate: numeric(row.commission_rate),
      commission_fee: commissionFee,
      commission_vat: commissionVat,
      settlement_amount: numeric(row.settlement_amount),
      fulfillment_fee: fulfillment.fee,
      fulfillment_vat: fulfillment.vat,
      payout_amount: numeric(row.payout_amount),
      unit_cost: unitCost,
      vat,
      margin,
      item_winner_rate: numeric(row.item_winner_rate),
      status:
        numeric(row.cancel_amount) > 0 &&
        (orderQuantity <= 0 || totalAmount <= 0)
          ? "cancelled"
          : "confirmed",
      source: "coupang_import",
      import_batch_id: input.batchId,
    };
  });

  return { rows, unmatchedOptions, fallbackApplied };
}

export async function insertSafeSalesGapAtomically(
  db: RpcClient,
  input: {
    userId: string;
    businessId: string;
    importDate: string;
    contentSha256: string;
    batchId: string;
    fileName: string;
    fileSize: number;
    rows: SafeSalesGapRow[];
  },
): Promise<Record<string, unknown>> {
  if (input.rows.length === 0)
    throw new Error("등록할 판매 상세행이 없습니다.");
  const { data, error } = await db.rpc("insert_sales_gap_backfill_tx", {
    p_user_id: input.userId,
    p_business_id: input.businessId,
    p_import_date: input.importDate,
    p_content_sha256: input.contentSha256,
    p_import_batch_id: input.batchId,
    p_file_name: input.fileName,
    p_file_size: input.fileSize,
    p_rows: input.rows,
  });
  if (error) throw new Error(error.message || "판매 갭 원자 저장 실패");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("판매 갭 저장 결과 형식이 올바르지 않습니다.");
  }
  return data as Record<string, unknown>;
}
