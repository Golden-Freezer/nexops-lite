import * as XLSX from "xlsx";

export interface AdReportError {
  row: number;
  message: string;
}

export interface AdReportRow {
  rowNumber: number;
  campaignId: string | null;
  campaignName: string | null;
  productName: string | null;
  optionId: string | null;
  metricDate: string | null;
  impressions: number;
  clicks: number;
  adCost: number;
  orders: number;
  units: number;
  attributedSales: number;
  campaignStartDate: string | null;
  campaignEndDate: string | null;
}

export interface ParsedAdReportFile {
  rows: AdReportRow[];
  headers: string[];
  fileDate: string | null;
  periodEnd: string | null;
  hasDateColumn: boolean;
  isDaily: boolean;
  errors: AdReportError[];
}

export interface AdReportImportResult {
  fileDate: string | null;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: AdReportError[];
  focusProductCount: number;
  campaignCount: number;
  warnings: string[];
}

export class AdReportParseError extends Error {
  readonly code = "AD_REPORT_PARSE_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AdReportParseError";
  }
}

const MAX_ERRORS = 50;
const HEADER_ALIASES = {
  campaignId: ["캠페인 ID", "캠페인ID"],
  campaignName: ["캠페인명", "캠페인 명"],
  productName: ["광고집행 상품명", "광고 집행 상품명", "광고 상품명"],
  optionId: ["광고집행 옵션ID", "광고집행 옵션 ID", "광고 옵션ID"],
  metricDate: ["날짜", "일자", "광고집행일", "광고 집행일", "광고일자", "보고일자", "기준일"],
  impressions: ["노출수"],
  clicks: ["클릭수"],
  adCost: ["광고비"],
  orders: ["총 주문수(1일)", "총주문수(1일)"],
  units: ["총 판매수량(1일)", "총판매수량(1일)"],
  attributedSales: ["총 전환매출액(1일)", "총전환매출액(1일)"],
  campaignStartDate: ["캠페인 시작일", "캠페인시작일"],
  campaignEndDate: ["캠페인 종료일", "캠페인종료일"],
} as const;

type HeaderKey = keyof typeof HEADER_ALIASES;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "")
    .trim();
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[,\s원%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerMetric(value: unknown): number {
  return Math.trunc(numberValue(value));
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    if (!validDate(year, month, day)) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 20_000 && value < 100_000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && validDate(parsed.y, parsed.m, parsed.d)) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = textValue(value);
  if (!text) return null;
  const compact = yyyymmdd(text);
  if (compact) return compact;
  const match = text.match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:\s*일)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validDate(year, month, day)) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function yyyymmdd(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** ID 값을 지수 표기나 소수점이 없는 정수 문자열로 정규화한다. */
export function normalizeIntegerId(value: unknown): string | null {
  if (typeof value === "bigint") return value < BigInt(0) ? null : value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return BigInt(value).toString();
  }
  if (value === null || value === undefined) return null;
  const source = String(value).trim().replace(/,/g, "");
  if (!source || source.startsWith("-")) return null;
  const match = source.match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  const integerPart = match[1] || "0";
  const fractionPart = match[2] || "";
  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const digits = integerPart + fractionPart;
  const decimalIndex = integerPart.length + exponent;
  let integerDigits: string;
  if (decimalIndex <= 0) {
    if (!/^0*$/.test(digits)) return null;
    integerDigits = "0";
  } else if (decimalIndex < digits.length) {
    if (!/^0*$/.test(digits.slice(decimalIndex))) return null;
    integerDigits = digits.slice(0, decimalIndex);
  } else {
    integerDigits = digits + "0".repeat(decimalIndex - digits.length);
  }
  return integerDigits.replace(/^0+(?=\d)/, "");
}

function headerIndexes(headers: unknown[]): Map<HeaderKey, number> {
  const normalized = headers.map(normalizeHeader);
  const indexes = new Map<HeaderKey, number>();
  for (const key of Object.keys(HEADER_ALIASES) as HeaderKey[]) {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) indexes.set(key, index);
  }
  return indexes;
}

export function parseAdReportFile(buffer: ArrayBuffer, fileName: string): ParsedAdReportFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new AdReportParseError("광고 보고서 엑셀 파일을 읽지 못했습니다.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new AdReportParseError("광고 보고서에서 읽을 시트를 찾지 못했습니다.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerRowIndex = matrix.slice(0, 20).findIndex((row) => {
    const indexes = headerIndexes(row);
    return indexes.has("campaignId") && indexes.has("optionId");
  });
  if (headerRowIndex < 0) {
    throw new AdReportParseError("광고 보고서의 '캠페인 ID'와 '광고집행 옵션ID' 열을 찾지 못했습니다.");
  }
  const headers = matrix[headerRowIndex].map((value) => String(value ?? "").trim());
  const indexes = headerIndexes(headers);
  const required: HeaderKey[] = [
    "campaignId",
    "campaignName",
    "productName",
    "optionId",
    "impressions",
    "clicks",
    "adCost",
    "orders",
    "units",
    "attributedSales",
  ];
  const missing = required.filter((key) => !indexes.has(key));
  if (missing.length > 0) {
    const labels = missing.map((key) => HEADER_ALIASES[key][0]).join(", ");
    throw new AdReportParseError(`광고 보고서 필수 열을 찾지 못했습니다: ${labels}`);
  }

  const period = fileName.match(/_pa_total_campaign_(\d{8})_(\d{8})(?:[^\d]|$)/i);
  const fileDate = period ? yyyymmdd(period[1]) : null;
  const periodEnd = period ? yyyymmdd(period[2]) : null;
  const errors: AdReportError[] = [];
  const hasDateColumn = indexes.has("metricDate");
  const cell = (row: unknown[], key: HeaderKey) => {
    const index = indexes.get(key);
    return index === undefined ? null : row[index];
  };
  const rows = matrix.slice(headerRowIndex + 1).flatMap((sourceRow, offset) => {
    if (sourceRow.every((value) => value === null || value === undefined || value === "")) return [];
    const rowNumber = headerRowIndex + offset + 2;
    const campaignId = normalizeIntegerId(cell(sourceRow, "campaignId"));
    const optionId = normalizeIntegerId(cell(sourceRow, "optionId"));
    const metricDate = hasDateColumn ? dateValue(cell(sourceRow, "metricDate")) : null;
    if (!campaignId && errors.length < MAX_ERRORS) errors.push({ row: rowNumber, message: "캠페인 ID가 비어 있거나 올바른 정수 ID가 아닙니다." });
    if (!optionId && errors.length < MAX_ERRORS) errors.push({ row: rowNumber, message: "광고집행 옵션ID가 비어 있거나 올바른 정수 ID가 아닙니다." });
    if (hasDateColumn && !metricDate && errors.length < MAX_ERRORS) errors.push({ row: rowNumber, message: "광고집행 날짜가 비어 있거나 올바른 날짜가 아닙니다." });
    return [{
      rowNumber,
      campaignId,
      campaignName: textValue(cell(sourceRow, "campaignName")),
      productName: textValue(cell(sourceRow, "productName")),
      optionId,
      metricDate,
      impressions: integerMetric(cell(sourceRow, "impressions")),
      clicks: integerMetric(cell(sourceRow, "clicks")),
      adCost: numberValue(cell(sourceRow, "adCost")),
      orders: integerMetric(cell(sourceRow, "orders")),
      units: integerMetric(cell(sourceRow, "units")),
      attributedSales: numberValue(cell(sourceRow, "attributedSales")),
      campaignStartDate: dateValue(cell(sourceRow, "campaignStartDate")),
      campaignEndDate: dateValue(cell(sourceRow, "campaignEndDate")),
    }];
  });
  if (rows.length === 0) {
    throw new AdReportParseError("광고 보고서에 처리할 데이터 행이 없습니다.");
  }

  return {
    rows,
    headers,
    fileDate,
    periodEnd,
    hasDateColumn,
    isDaily: hasDateColumn && rows.some((row) => Boolean(row.metricDate)),
    errors,
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

function sourceTimestamp(date: string): string {
  return `${date}T00:00:00+09:00`;
}

/** 파싱된 광고 보고서를 캠페인, 주력상품, 일별 광고 성과에 순서대로 반영한다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAdReportImport(
  supabase: any,
  params: { userId: string; businessId: string; fileName: string; buffer: ArrayBuffer },
): Promise<AdReportImportResult> {
  const parsed = parseAdReportFile(params.buffer, params.fileName);
  const now = new Date().toISOString();
  const errors = [...parsed.errors];
  const pushError = (row: number, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ row, message });
  };
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = new Set(parsed.errors.map((error) => error.row)).size;
  let focusProductCount = 0;
  let campaignCount = 0;

  const validCampaignRows = parsed.rows.filter((row) => row.campaignId);
  const campaigns = new Map<string, AdReportRow[]>();
  for (const row of validCampaignRows) {
    const rows = campaigns.get(row.campaignId!) ?? [];
    rows.push(row);
    campaigns.set(row.campaignId!, rows);
  }
  const successfulCampaigns = new Set<string>();
  for (const [campaignId, rows] of campaigns) {
    const name = rows.find((row) => row.campaignName)?.campaignName ?? null;
    const startDate = rows.map((row) => row.campaignStartDate).filter(Boolean).sort()[0] ?? null;
    const base = { name, harvested_at: now, updated_at: now };
    try {
      const { data: existing, error: selectError } = await supabase
        .from("focus_campaign_catalog")
        .select("id")
        .eq("user_id", params.userId)
        .eq("business_id", params.businessId)
        .eq("campaign_id", campaignId)
        .limit(1)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) {
        const update = startDate ? { ...base, created_at_source: sourceTimestamp(startDate) } : base;
        const { error } = await supabase.from("focus_campaign_catalog").update(update).eq("id", existing.id);
        if (error) throw error;
        updatedCount++;
      } else {
        const { error } = await supabase.from("focus_campaign_catalog").insert({
          user_id: params.userId,
          business_id: params.businessId,
          campaign_id: campaignId,
          ...base,
          created_at_source: startDate ? sourceTimestamp(startDate) : null,
        });
        if (error) throw error;
        insertedCount++;
      }
      campaignCount++;
      successfulCampaigns.add(campaignId);
    } catch (error) {
      skippedCount++;
      pushError(rows[0].rowNumber, `캠페인 ${campaignId} 저장 실패: ${errorMessage(error)}`);
    }
  }

  const optionIds = [...new Set(parsed.rows.map((row) => row.optionId).filter((id): id is string => Boolean(id)))];
  const productMap = new Map<string, { id: string; coupang_exposure_id: string | null }>();
  if (optionIds.length > 0) {
    const { data, error } = await supabase
      .from("products")
      .select("id,coupang_option_id,coupang_exposure_id")
      .eq("user_id", params.userId)
      .eq("business_id", params.businessId)
      .eq("purpose", "product")
      .in("coupang_option_id", optionIds);
    if (error) throw new Error(`광고 옵션에 연결된 상품 조회 실패: ${errorMessage(error)}`);
    for (const product of data ?? []) {
      const optionId = normalizeIntegerId(product.coupang_option_id);
      if (optionId) productMap.set(optionId, product);
    }
  }

  const focusCandidates = new Map<string, { row: AdReportRow; product: { id: string; coupang_exposure_id: string } }>();
  const seenMissingOptions = new Set<string>();
  for (const row of parsed.rows) {
    if (!row.campaignId || !row.optionId || !successfulCampaigns.has(row.campaignId)) continue;
    const product = productMap.get(row.optionId);
    if (!product?.coupang_exposure_id) {
      if (!seenMissingOptions.has(row.optionId)) {
        seenMissingOptions.add(row.optionId);
        skippedCount++;
        pushError(row.rowNumber, `옵션ID ${row.optionId}에 연결된 상품 또는 쿠팡 노출ID를 찾지 못해 주력상품 등록을 건너뜁니다.`);
      }
      continue;
    }
    const key = `${row.campaignId}\u0000${product.coupang_exposure_id}`;
    if (!focusCandidates.has(key)) {
      focusCandidates.set(key, { row, product: { id: product.id, coupang_exposure_id: product.coupang_exposure_id } });
    }
  }

  for (const { row, product } of focusCandidates.values()) {
    if (!parsed.fileDate) {
      skippedCount++;
      pushError(row.rowNumber, "파일명에서 보고서 시작일을 찾지 못해 주력상품 등록을 건너뜁니다.");
      continue;
    }
    try {
      const { data: existing, error: selectError } = await supabase
        .from("focus_products")
        .select("id")
        .eq("user_id", params.userId)
        .eq("business_id", params.businessId)
        .eq("coupang_exposure_id", product.coupang_exposure_id)
        .eq("campaign_id", row.campaignId)
        .limit(1)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) {
        skippedCount++;
        continue;
      }
      const { error } = await supabase.from("focus_products").insert({
        user_id: params.userId,
        business_id: params.businessId,
        product_id: product.id,
        coupang_exposure_id: product.coupang_exposure_id,
        campaign_id: row.campaignId,
        label: row.productName,
        valid_from: parsed.fileDate,
        valid_to: null,
        is_active: true,
      });
      if (error) throw error;
      insertedCount++;
      focusProductCount++;
    } catch (error) {
      skippedCount++;
      pushError(row.rowNumber, `주력상품 저장 실패: ${errorMessage(error)}`);
    }
  }

  const warnings: string[] = [];
  if (!parsed.hasDateColumn) warnings.push("합계 보고서라 일별 광고 성과는 건너뜀");
  else if (!parsed.isDaily) warnings.push("날짜 열에 유효한 일자가 없어 일별 광고 성과는 건너뜀");

  if (parsed.isDaily) {
    const daily = new Map<string, AdReportRow & { firstRow: number }>();
    for (const row of parsed.rows) {
      if (!row.campaignId || !row.metricDate || !successfulCampaigns.has(row.campaignId)) continue;
      const key = `${row.campaignId}\u0000${row.metricDate}`;
      const aggregate = daily.get(key);
      if (!aggregate) daily.set(key, { ...row, firstRow: row.rowNumber });
      else {
        aggregate.impressions += row.impressions;
        aggregate.clicks += row.clicks;
        aggregate.adCost += row.adCost;
        aggregate.orders += row.orders;
        aggregate.units += row.units;
        aggregate.attributedSales += row.attributedSales;
      }
    }
    for (const aggregate of daily.values()) {
      try {
        const { data: existing, error: selectError } = await supabase
          .from("focus_ad_daily")
          .select("id")
          .eq("user_id", params.userId)
          .eq("business_id", params.businessId)
          .eq("campaign_id", aggregate.campaignId)
          .eq("metric_date", aggregate.metricDate)
          .limit(1)
          .maybeSingle();
        if (selectError) throw selectError;
        const metrics = {
          ad_attributed_units: aggregate.units,
          ad_attributed_sales: aggregate.attributedSales,
          ad_attributed_orders: aggregate.orders,
          delivered_ad_cost: aggregate.adCost,
          impressions: aggregate.impressions,
          clicks: aggregate.clicks,
          last_observed_at: now,
          extractor_version: "v1",
          source: "ad_report_excel",
          updated_at: now,
        };
        if (existing) {
          const { error } = await supabase.from("focus_ad_daily").update(metrics).eq("id", existing.id);
          if (error) throw error;
          updatedCount++;
        } else {
          const { error } = await supabase.from("focus_ad_daily").insert({
            user_id: params.userId,
            business_id: params.businessId,
            campaign_id: aggregate.campaignId,
            metric_date: aggregate.metricDate,
            ...metrics,
            first_observed_at: now,
          });
          if (error) throw error;
          insertedCount++;
        }
      } catch (error) {
        skippedCount++;
        pushError(aggregate.firstRow, `일별 광고 성과 저장 실패: ${errorMessage(error)}`);
      }
    }
  }

  return { fileDate: parsed.fileDate, insertedCount, updatedCount, skippedCount, errors, focusProductCount, campaignCount, warnings };
}
