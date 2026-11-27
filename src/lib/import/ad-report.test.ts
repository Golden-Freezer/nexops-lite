import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  AdReportParseError,
  normalizeIntegerId,
  parseAdReportFile,
  runAdReportImport,
} from "./ad-report";

type DbRow = Record<string, unknown>;
type DbResult = { data: unknown; error: { message: string } | null };

function workbookBuffer(headers: string[], rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

class FakeQuery implements PromiseLike<DbResult> {
  private operation: "select" | "insert" | "update" = "select";
  private payload: DbRow | DbRow[] | null = null;
  private filters: Array<(row: DbRow) => boolean> = [];

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns = "*") {
    this.operation = "select";
    return this;
  }

  insert(payload: DbRow | DbRow[]) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: DbRow) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  limit(_count: number) {
    return this;
  }

  async maybeSingle(): Promise<DbResult> {
    const result = this.execute();
    const rows = result.data as DbRow[];
    return { data: rows[0] ?? null, error: result.error };
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): DbResult {
    const tableRows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    if (this.operation === "select") {
      return { data: tableRows.filter((row) => this.filters.every((filter) => filter(row))), error: null };
    }
    if (this.operation === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(
        (row): row is DbRow => Boolean(row),
      );
      const inserted = rows.map((row) => ({ id: row.id ?? `fake-${++this.db.sequence}`, ...row }));
      tableRows.push(...inserted);
      return { data: inserted, error: null };
    }
    const matched = tableRows.filter((row) => this.filters.every((filter) => filter(row)));
    for (const row of matched) Object.assign(row, this.payload);
    return { data: matched, error: null };
  }
}

class FakeSupabase {
  sequence = 0;

  constructor(public readonly tables: Record<string, DbRow[]>) {}

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const totalHeaders = [
  "광고집행 옵션ID",
  "광고비",
  "캠페인명",
  "광고집행 상품명",
  "캠페인 ID",
  "노출수",
  "클릭수",
  "총 주문수(1일)",
  "총 판매수량(1일)",
  "총 전환매출액(1일)",
  "캠페인 시작일",
];

const dailyHeaders = ["날짜", ...totalHeaders];

describe("normalizeIntegerId", () => {
  it("숫자와 과학 표기 ID를 정수 문자열로 보존한다", () => {
    expect(normalizeIntegerId(1.2345e10)).toBe("12345000000");
    expect(normalizeIntegerId("1.2345e10")).toBe("12345000000");
    expect(normalizeIntegerId("0012345000000.0")).toBe("12345000000");
    const unsafe = 12_345_678_901_234_568;
    expect(normalizeIntegerId(unsafe)).toBe(BigInt(unsafe).toString());
    expect(normalizeIntegerId("12.3")).toBeNull();
  });
});

describe("parseAdReportFile", () => {
  it("열 순서가 달라도 이름으로 합계 보고서를 파싱한다", () => {
    const buffer = workbookBuffer(totalHeaders, [
      ["1.2345e10", "1,250", "도마 캠페인", "원목도마", "9.876e6", 100, 4, 2, 3, 42000, "2026.10.01"],
    ]);

    const result = parseAdReportFile(
      buffer,
      "A01000000_pa_total_campaign_20261116_20261122.xlsx",
    );

    expect(result.fileDate).toBe("2026-11-16");
    expect(result.periodEnd).toBe("2026-11-22");
    expect(result.isDaily).toBe(false);
    expect(result.rows[0]).toMatchObject({
      campaignId: "9876000",
      optionId: "12345000000",
      productName: "원목도마",
      adCost: 1250,
      campaignStartDate: "2026-10-01",
    });
  });

  it("데이터 행이 없으면 사람이 읽을 수 있는 파싱 오류를 낸다", () => {
    const buffer = workbookBuffer(totalHeaders, []);
    expect(() =>
      parseAdReportFile(buffer, "A01000000_pa_total_campaign_20261116_20261122.xlsx"),
    ).toThrowError(AdReportParseError);
    expect(() =>
      parseAdReportFile(buffer, "A01000000_pa_total_campaign_20261116_20261122.xlsx"),
    ).toThrow("처리할 데이터 행이 없습니다");
  });
});

describe("runAdReportImport", () => {
  it("옵션을 노출ID에 연결하고 캠페인·주력상품·일별 합계를 insert/update한다", async () => {
    const buffer = workbookBuffer(dailyHeaders, [
      ["2026-11-16", "1.2345e10", 1000, "도마 캠페인", "원목도마 A", 7001, 10, 1, 1, 1, 12000, "2026-10-01"],
      ["2026-11-16", 9002, 2000, "도마 캠페인", "원목도마 B", 7001, 20, 2, 2, 3, 33000, "2026-10-01"],
    ]);
    const supabase = new FakeSupabase({
      products: [
        { id: "product-a", user_id: "owner", business_id: "biz", purpose: "product", coupang_option_id: "12345000000", coupang_exposure_id: "exposure-1" },
        { id: "product-b", user_id: "owner", business_id: "biz", purpose: "product", coupang_option_id: "9002", coupang_exposure_id: "exposure-1" },
      ],
    });
    const params = {
      userId: "owner",
      businessId: "biz",
      fileName: "A01000000_pa_total_campaign_20261116_20261116.xlsx",
      buffer,
    };

    const first = await runAdReportImport(supabase, params);

    expect(first).toMatchObject({
      fileDate: "2026-11-16",
      insertedCount: 3,
      updatedCount: 0,
      skippedCount: 0,
      focusProductCount: 1,
      campaignCount: 1,
      warnings: [],
    });
    expect(supabase.tables.focus_campaign_catalog[0]).toMatchObject({
      campaign_id: "7001",
      name: "도마 캠페인",
      created_at_source: "2026-10-01T00:00:00+09:00",
    });
    expect(supabase.tables.focus_products).toHaveLength(1);
    expect(supabase.tables.focus_products[0]).toMatchObject({
      product_id: "product-a",
      coupang_exposure_id: "exposure-1",
      campaign_id: "7001",
      valid_from: "2026-11-16",
      valid_to: null,
      is_active: true,
    });
    expect(supabase.tables.focus_ad_daily[0]).toMatchObject({
      campaign_id: "7001",
      metric_date: "2026-11-16",
      delivered_ad_cost: 3000,
      impressions: 30,
      clicks: 3,
      ad_attributed_orders: 3,
      ad_attributed_units: 4,
      ad_attributed_sales: 45000,
      source: "ad_report_excel",
      extractor_version: "v1",
    });

    const second = await runAdReportImport(supabase, params);
    expect(second).toMatchObject({
      insertedCount: 0,
      updatedCount: 2,
      skippedCount: 1,
      focusProductCount: 0,
      campaignCount: 1,
    });
    expect(supabase.tables.focus_products).toHaveLength(1);
    expect(supabase.tables.focus_ad_daily).toHaveLength(1);
  });

  it("합계 보고서는 일별 저장을 생략하고 경고를 반환한다", async () => {
    const buffer = workbookBuffer(totalHeaders, [
      [123, 1000, "도마 캠페인", "원목도마", 7001, 10, 1, 1, 1, 12000, "2026-10-01"],
    ]);
    const supabase = new FakeSupabase({
      products: [
        { id: "product-a", user_id: "owner", business_id: "biz", purpose: "product", coupang_option_id: "123", coupang_exposure_id: "exposure-1" },
      ],
    });

    const result = await runAdReportImport(supabase, {
      userId: "owner",
      businessId: "biz",
      fileName: "A01000000_pa_total_campaign_20261116_20261122.xlsx",
      buffer,
    });

    expect(result.warnings).toContain("합계 보고서라 일별 광고 성과는 건너뜀");
    expect(supabase.tables.focus_ad_daily ?? []).toHaveLength(0);
  });

  it("상품의 노출ID를 찾지 못하면 옵션ID를 노출ID로 대신 쓰지 않는다", async () => {
    const buffer = workbookBuffer(totalHeaders, [
      [123, 1000, "도마 캠페인", "원목도마", 7001, 10, 1, 1, 1, 12000, "2026-10-01"],
    ]);
    const supabase = new FakeSupabase({
      products: [
        { id: "product-a", user_id: "owner", business_id: "biz", purpose: "product", coupang_option_id: "123", coupang_exposure_id: null },
      ],
    });

    const result = await runAdReportImport(supabase, {
      userId: "owner",
      businessId: "biz",
      fileName: "A01000000_pa_total_campaign_20261116_20261122.xlsx",
      buffer,
    });

    expect(result.skippedCount).toBe(1);
    expect(result.errors[0].message).toContain("상품 또는 쿠팡 노출ID");
    expect(supabase.tables.focus_products ?? []).toHaveLength(0);
  });
});
