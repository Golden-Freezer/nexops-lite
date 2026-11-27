// exportUtils/derivativeFilter.ts — D2 분할: 원본 exportUtils.ts 857~894행 순수 이동 (2026-07-04) — ★순수(결정적 해시 검증 대상)

import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { DerivativeVersion } from '@/lib/registration/editor/types/editor';

// ─────────────────────────────────────────────
// T4.4: derivatives bundle (ZIP)
// ─────────────────────────────────────────────

/**
 * priority 기반 파생본 섹션 필터링
 * - quick: 우선순위 상위 12섹션 + CTA
 * - standard: 우선순위 상위 18섹션 + CTA
 * - persuasive: 전체 24섹션 + CTA (limit 없음)
 */
export function filterSectionsByDerivative(
  sections: CanvasSection[],
  version: DerivativeVersion,
): CanvasSection[] {
  const visible = sections.filter((s) => s.isVisible && s.canvas.height >= 10);

  const maxSections: Record<DerivativeVersion, number> = {
    quick: 12,
    standard: 18,
    persuasive: 24,
  };
  const limit = maxSections[version];

  // CTA 섹션 분리
  const cta = visible.find((s) => s.sectionType === 'cta');
  const others = visible.filter((s) => s.sectionType !== 'cta');

  // priority 오름차순 정렬 (낮은 숫자 = 높은 우선순위, undefined → 99)
  const sorted = [...others].sort(
    (a, b) => (a.strategyMeta?.priority ?? 99) - (b.strategyMeta?.priority ?? 99),
  );

  const selected = sorted.slice(0, cta ? limit - 1 : limit);
  if (cta) selected.push(cta);

  return selected;
}

