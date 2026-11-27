export interface SafeSalesGapHistoryItem {
  batchId: string;
  importDate: string;
  insertedCount: number;
  status: string;
  mode: string;
  derivedState: string;
  completedAt: string | null;
}

/** 판매 전용 갭 백필은 판매가 보여도 재고·정산까지 완료된 Import로 취급하지 않는다. */
export function isPartialSafeSalesGap(item: SafeSalesGapHistoryItem): boolean {
  return (
    item.mode === "insert_only_gap_backfill" &&
    item.derivedState === "not_applied"
  );
}

export function partialSafeSalesGapByDate(
  history: SafeSalesGapHistoryItem[],
): Map<string, SafeSalesGapHistoryItem> {
  const result = new Map<string, SafeSalesGapHistoryItem>();
  for (const item of history) {
    if (
      !isPartialSafeSalesGap(item) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.importDate)
    ) {
      continue;
    }
    const current = result.get(item.importDate);
    if (
      !current ||
      String(item.completedAt ?? "") > String(current.completedAt ?? "")
    ) {
      result.set(item.importDate, item);
    }
  }
  return result;
}
