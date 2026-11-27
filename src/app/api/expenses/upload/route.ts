import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/clerk";
import { requireOwnedBusinessId } from "@/lib/auth/business";
import { createLogger } from "@/lib/monitoring/logger";
import { EXPENSE_BUCKET, removeExpenseReceipt } from "@/lib/supabase/storage";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
];
const logger = createLogger("expense-receipt");

/** POST /api/expenses/upload — 지출 증빙 파일 업로드 */
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const expenseId = formData.get("expenseId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 필요합니다." },
        { status: 400 },
      );
    }

    if (!expenseId) {
      return NextResponse.json(
        { error: "expenseId는 필수입니다." },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `허용되지 않는 파일 형식입니다. (이미지, PDF, 엑셀, 워드, CSV 가능)`,
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "파일 크기는 10MB 이하만 가능합니다." },
        { status: 400 },
      );
    }

    // 소유권 검증
    const ownerQuery = supabase
      .from("expenses")
      .select("id,receipt_path")
      .eq("id", expenseId)
      .eq("user_id", userId)
      .eq("business_id", businessId);

    const { data: ownerCheck, error: ownerError } =
      await ownerQuery.maybeSingle();
    if (ownerError) {
      return NextResponse.json(
        { error: `지출 소유권 확인 실패: ${ownerError.message}` },
        { status: 500 },
      );
    }
    if (!ownerCheck) {
      return NextResponse.json(
        { error: "해당 지출 내역을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    // 파일 업로드
    const ext = file.name.split(".").pop() || "bin";
    const safeName = file.name.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
    const filePath = `expenses/${userId}/${expenseId}/${Date.now()}_${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(EXPENSE_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `업로드 실패: ${uploadError.message}` },
        { status: 500 },
      );
    }

    // expenses.receipt_path 업데이트 — signed URL은 조회 시점(GET /api/expenses/[id]/receipt)마다 새로 발급한다
    let updateQuery = supabase
      .from("expenses")
      .update({ receipt_path: filePath, updated_at: new Date().toISOString() })
      .eq("id", expenseId)
      .eq("user_id", userId)
      .eq("business_id", businessId);
    updateQuery = ownerCheck.receipt_path
      ? updateQuery.eq("receipt_path", ownerCheck.receipt_path)
      : updateQuery.is("receipt_path", null);

    const { data: updated, error: updateError } = await updateQuery
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      // DB가 새 경로를 참조하지 못했으므로 방금 업로드한 파일을 즉시 정리한다.
      try {
        await removeExpenseReceipt(supabase, filePath);
      } catch (cleanupError) {
        logger.error("증빙 업로드 롤백 파일 정리가 필요합니다.", {
          expenseId,
          userId,
          businessId,
          cleanupPath: filePath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
      return NextResponse.json(
        {
          error: `증빙 경로 저장 실패: ${updateError?.message || "지출 내역이 변경되었습니다."}`,
        },
        { status: updateError ? 500 : 409 },
      );
    }

    let warning: string | undefined;
    if (ownerCheck.receipt_path && ownerCheck.receipt_path !== filePath) {
      try {
        // DB가 이미 새 파일을 참조한 뒤에 기존 파일을 정리해 끈어진 참조를 만들지 않는다.
        await removeExpenseReceipt(supabase, ownerCheck.receipt_path);
      } catch (cleanupError) {
        logger.warn("교체된 기존 증빙 파일 정리가 필요합니다.", {
          expenseId,
          userId,
          businessId,
          cleanupPath: ownerCheck.receipt_path,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
        warning =
          "새 증빙은 저장되었지만 기존 파일 정리는 재시도가 필요합니다.";
      }
    }

    return NextResponse.json({
      data: { receiptPath: filePath },
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "증빙 업로드 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

/** DELETE /api/expenses/upload — 증빙 파일 삭제 */
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const expenseId = searchParams.get("expenseId");
    if (!expenseId)
      return NextResponse.json(
        { error: "expenseId는 필수입니다." },
        { status: 400 },
      );

    // 소유권 검증 + 현재 경로 조회
    const ownerQuery = supabase
      .from("expenses")
      .select("receipt_path")
      .eq("id", expenseId)
      .eq("user_id", userId)
      .eq("business_id", businessId);

    const { data: existing, error: ownerError } =
      await ownerQuery.maybeSingle();
    if (ownerError) {
      return NextResponse.json(
        { error: `지출 소유권 확인 실패: ${ownerError.message}` },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: "해당 지출 내역을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (!existing.receipt_path) {
      return NextResponse.json({ success: true });
    }

    // DB 참조를 먼저 해제한 후 Storage를 정리해 끊어진 파일 참조를 만들지 않는다.
    const updateQuery = supabase
      .from("expenses")
      .update({ receipt_path: null, updated_at: new Date().toISOString() })
      .eq("id", expenseId)
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("receipt_path", existing.receipt_path);

    const { data: updated, error } = await updateQuery
      .select("id")
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: `증빙 참조 해제 실패: ${error.message}` },
        { status: 500 },
      );
    if (!updated) {
      return NextResponse.json(
        {
          error:
            "증빙이 다른 요청에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        },
        { status: 409 },
      );
    }

    try {
      await removeExpenseReceipt(supabase, existing.receipt_path);
    } catch (storageError) {
      logger.warn("참조 해제된 증빙 파일 정리가 필요합니다.", {
        expenseId,
        userId,
        businessId,
        cleanupPath: existing.receipt_path,
        error:
          storageError instanceof Error
            ? storageError.message
            : String(storageError),
      });
      return NextResponse.json({
        success: true,
        warning:
          "증빙 참조는 안전하게 해제했지만 파일 정리는 재시도가 필요합니다.",
        code: "EXPENSE_RECEIPT_STORAGE_CLEANUP_PENDING",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "증빙 삭제 중 오류" },
      { status: 500 },
    );
  }
}
