/** 판매 전용 안전 갭 배치를 다른 Import 소비자가 완전 성공으로 오인하지 않게 한다. */
export function safeSalesGapImportDate(summary: unknown): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }
  const metadata = summary as Record<string, unknown>;
  return metadata.mode === "insert_only_gap_backfill" &&
    metadata.derivedState === "not_applied" &&
    typeof metadata.importDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(metadata.importDate)
    ? metadata.importDate
    : null;
}

/** Dashboard의 기존 일반 Import shape는 보존하고 안전 갭만 부분 반영 범위를 노출한다. */
export function exposeDashboardImportState(row: Record<string, unknown>) {
  const { summary, ...existingShape } = row;
  const importDate = safeSalesGapImportDate(summary);
  if (!importDate) return existingShape;
  return {
    ...existingShape,
    status: "partial",
    import_scope: "sales_only",
    sales_applied: true,
    inventory_applied: false,
    settlement_applied: false,
    import_date: importDate,
  };
}
