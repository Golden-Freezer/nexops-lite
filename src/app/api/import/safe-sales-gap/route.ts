import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireUserBoundAuth } from "@/lib/auth/clerk";
import { getBusinessId } from "@/lib/auth/business";
import { createAdminClient } from "@/lib/supabase/admin";
import { assembleImportRows } from "@/lib/import/assemble";
import { parseExcelFile } from "@/lib/import/parser";
import {
  AutoImportInputError,
  assertSingleDayStatisticsFilename,
  decodeStrictBase64,
  sha256Bytes,
} from "@/lib/import/auto-idempotency";
import {
  AutoImportBodyError,
  decodeAutoImportBody,
} from "@/lib/import/auto-request-body";
import {
  assertSafeStatisticsRawRows,
  insertSafeSalesGapAtomically,
  prepareSafeSalesGapRows,
} from "@/lib/import/safe-sales-gap";
import { resolveImportConfig } from "@/lib/settings/config";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

const MAX_BASE64 = 14 * 1024 * 1024;

interface SafeSalesGapBody {
  vendorId?: string;
  kind?: string;
  date?: string;
  fileName?: string;
  fileBase64?: string;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const businessId = await getBusinessId();
    if (!businessId) return inputError("현재 사업장을 선택해주세요.", 400);
    const month =
      new URL(req.url).searchParams.get("month") ??
      new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      return inputError("month 형식은 YYYY-MM이어야 합니다.");
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;
    const buildSafeBatchQuery = () =>
      db
        .from("coupang_imports")
        .select(
          "id, status, success_count, error_count, summary, created_at, completed_at",
        )
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("import_type", "sales")
        .eq("summary->>mode", "insert_only_gap_backfill")
        .gte("summary->>importDate", `${month}-01`)
        .lte("summary->>importDate", monthEnd)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

    const { data: batches, error: batchesError } =
      await fetchAllRows(buildSafeBatchQuery);
    if (batchesError)
      return inputError(`판매 갭 배치 조회 실패: ${batchesError.message}`, 500);

    interface SafeHistoryItem {
      batchId: string;
      importDate: string;
      status: string;
      insertedCount: number;
      errorCount: number;
      mode: "insert_only_gap_backfill";
      derivedState: string;
      createdAt: unknown;
      completedAt: unknown;
    }
    const history: SafeHistoryItem[] = (batches ?? []).flatMap(
      (batch: Record<string, unknown>): SafeHistoryItem[] => {
        const summary =
          batch.summary &&
          typeof batch.summary === "object" &&
          !Array.isArray(batch.summary)
            ? (batch.summary as Record<string, unknown>)
            : {};
        if (summary.mode !== "insert_only_gap_backfill") return [];
        const importDate = String(summary.importDate ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(importDate)) return [];
        const batchId = String(batch.id);
        return [
          {
            batchId,
            importDate,
            status: String(batch.status),
            insertedCount: Number(batch.success_count) || 0,
            errorCount: Number(batch.error_count) || 0,
            mode: "insert_only_gap_backfill",
            derivedState:
              summary.derivedState === "not_applied"
                ? "not_applied"
                : String(summary.derivedState ?? ""),
            createdAt: batch.created_at,
            completedAt: batch.completed_at,
          },
        ];
      },
    );

    return NextResponse.json({ data: { history }, month });
  } catch (error) {
    if (error instanceof Response) return error;
    return inputError(
      error instanceof Error ? error.message : "판매 갭 이력 조회 실패",
      500,
    );
  }
}

function inputError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 기존 판매·재고·정산을 전혀 수정하지 않는 단일 날짜 판매 갭 전용 경로.
 * 모든 사전 작업은 조회이며, 유일한 쓰기는 append-only 보장 RPC 한 번이다.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserBoundAuth({ touchLastUsed: false });
    const body = await decodeAutoImportBody<SafeSalesGapBody>(req);
    if (!body.vendorId) return inputError("vendorId가 필요합니다.");
    if (body.kind !== "sales")
      return inputError("판매 갭 경로는 kind='sales'만 허용합니다.");
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return inputError("date는 YYYY-MM-DD 형식으로 필요합니다.");
    }
    if (!body.fileName || !body.fileBase64)
      return inputError("fileName·fileBase64가 필요합니다.");
    if (body.fileBase64.length > MAX_BASE64)
      return inputError("파일이 너무 큽니다.", 413);

    let filenameDate: string;
    let bytes: Buffer;
    try {
      filenameDate = assertSingleDayStatisticsFilename(body.fileName);
      bytes = decodeStrictBase64(body.fileBase64);
    } catch (error) {
      return inputError(
        error instanceof Error
          ? error.message
          : "판매 파일 형식이 올바르지 않습니다.",
        422,
      );
    }
    if (body.date !== filenameDate) {
      return inputError(
        "요청 날짜와 Statistics 파일명의 날짜가 일치하지 않습니다.",
        422,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;
    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, user_id, business_name")
      .eq("coupang_vendor_id", body.vendorId)
      .eq("user_id", userId)
      .maybeSingle();
    if (businessError)
      return inputError(`사업장 조회 실패: ${businessError.message}`, 500);
    if (!business || business.user_id !== userId) {
      return inputError(
        "등록되지 않았거나 접근 권한이 없는 vendor입니다.",
        403,
      );
    }

    const { data: settings, error: settingsError } = await db
      .from("business_settings")
      .select("import_column_mappings")
      .eq("business_id", business.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError)
      return inputError(`Import 설정 조회 실패: ${settingsError.message}`, 500);

    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const importConfig = resolveImportConfig(
      "sales",
      settings?.import_column_mappings ?? {},
    );
    let assembled;
    try {
      const parsed = parseExcelFile(arrayBuffer, "sales", 0);
      assertSafeStatisticsRawRows(parsed.rows, parsed.headers, importConfig);
      assembled = assembleImportRows(
        arrayBuffer,
        "sales",
        body.fileName,
        0,
        importConfig,
      );
    } catch (error) {
      return inputError(
        error instanceof Error ? error.message : "파일 파싱 실패",
        422,
      );
    }
    const invalidDetail = assembled.invalidRows.filter(
      (row) => String(row.data.option_id ?? "").trim() && row.errors.length > 0,
    );
    if (invalidDetail.length > 0) {
      const message =
        invalidDetail[0].errors[0]?.message ?? "판매 상세행 검증 실패";
      return inputError(
        `판매 파일 ${invalidDetail.length}행 검증 실패: ${message}`,
        422,
      );
    }
    if (assembled.fileDate !== filenameDate) {
      return inputError(
        "Statistics 파일명과 파싱 기준일이 일치하지 않습니다.",
        422,
      );
    }

    const sourceRows = assembled.validRows.map((row) => row.data);
    const batchId = randomUUID();
    let prepared;
    try {
      prepared = await prepareSafeSalesGapRows(db, {
        userId,
        businessId: String(business.id),
        importDate: filenameDate,
        batchId,
        rows: sourceRows,
      });
    } catch (error) {
      return inputError(
        error instanceof Error ? error.message : "판매행 준비 실패",
        422,
      );
    }

    const contentSha256 = sha256Bytes(bytes);
    let result: Record<string, unknown>;
    try {
      result = await insertSafeSalesGapAtomically(db, {
        userId,
        businessId: String(business.id),
        importDate: filenameDate,
        contentSha256,
        batchId,
        fileName: body.fileName,
        fileSize: bytes.byteLength,
        rows: prepared.rows,
      });
    } catch (error) {
      return inputError(
        `판매 갭 저장 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        409,
      );
    }

    if (
      result.batchId !== batchId ||
      result.importDate !== filenameDate ||
      result.contentSha256 !== contentSha256 ||
      result.status !== "completed" ||
      result.mode !== "insert_only_gap_backfill" ||
      result.derivedState !== "not_applied" ||
      typeof result.receiptId !== "string" ||
      !result.receiptId ||
      Number(result.insertedCount) !== prepared.rows.length
    ) {
      return inputError(
        "판매 갭 저장 결과를 확정할 수 없습니다. 같은 파일을 다시 실행하지 마세요.",
        409,
      );
    }

    return NextResponse.json({
      data: {
        ...result,
        business: business.business_name,
        vendorId: body.vendorId,
        kind: "sales",
        salesApplied: true,
        inventory: false,
        settlement: false,
        inventoryApplied: false,
        settlementApplied: false,
        derivedState: "not_applied",
        unmatchedOptions: prepared.unmatchedOptions,
        fallbackApplied: prepared.fallbackApplied,
        warnings: [
          "판매 원장만 신규 삽입되었습니다. 재고와 정산 파생 상태는 적용되지 않았습니다.",
        ],
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof AutoImportBodyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof AutoImportInputError)
      return inputError(error.message, 422);
    console.error("safe-sales-gap error:", error);
    return inputError("판매 갭 처리 중 서버 오류가 발생했습니다.", 500);
  }
}
