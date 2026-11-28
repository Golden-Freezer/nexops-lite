/**
 * 등록 준비 드로어의 등록 대상 사업장 기본값.
 * 순서: 초안에 저장된 사업장 → 화면에서 선택 중인 사업장(오너 소유 목록에 있을 때만) → 기본 사업장 → 첫 사업장.
 */
export function pickRegistrationBusinessId(
  draftBusinessId: string | null | undefined,
  selectedBusinessId: string | null | undefined,
  owned: ReadonlyArray<{ id: string; isDefault: boolean }>
): string | null {
  if (draftBusinessId) return draftBusinessId
  if (selectedBusinessId && owned.some((b) => b.id === selectedBusinessId)) return selectedBusinessId
  return owned.find((b) => b.isDefault)?.id ?? owned[0]?.id ?? null
}
