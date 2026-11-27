import type { CanvasSection } from '@/lib/registration/editor/types/canvas';

// ─── 저장본 스키마 마이그레이션 ───────────────────────────────────────────────
// 저장 페이로드는 sections 배열뿐이므로 버전은 각 섹션의 schemaVersion에 스탬프한다.
// 부재 = v1 (2026-07-07 이전 저장본).

export const EDITOR_SCHEMA_VERSION = 2;

/**
 * 저장본/신규 변환본을 현재 스키마 버전으로 끌어올린다.
 * 로드 직후(MainCanvas)와 신규 변환 직후 모두 통과시켜, document에는
 * 항상 현행 버전 섹션만 존재한다는 불변식을 유지한다.
 */
export function migrateSectionsData(sections: CanvasSection[]): CanvasSection[] {
  if (!sections.length) return sections;
  const from = sections[0]?.schemaVersion ?? 1;
  if (from >= EDITOR_SCHEMA_VERSION) return sections;

  let migrated = sections;
  if (from < 2) migrated = migrateV1toV2(migrated);

  return migrated.map((s) => ({ ...s, schemaVersion: EDITOR_SCHEMA_VERSION }));
}

/**
 * v1 → v2: 컨테이너 관계 메타(containerOf) 복원.
 * v1 저장본은 카드류 shape와 자식 텍스트의 관계 정보가 없다 —
 * converter의 id 명명 규칙(`review_card_bg_${i}` 등)으로 관계를 재구성한다.
 * 재구성 규칙은 restoreContainerRelations(트랙 3)에서 정의한다.
 */
function migrateV1toV2(sections: CanvasSection[]): CanvasSection[] {
  return sections.map((section) => ({
    ...section,
    elements: restoreContainerRelations(section.elements),
  }));
}

// ── 컨테이너 관계 복원 규칙 ──────────────────────────────────────────────────
// converter의 컨테이너 shape "name" 패턴 → 자식 name 목록 (sections.ts와 동일 규칙).
// 주의: 요소 id는 uid 난수이므로 관계는 name으로 매칭하고, 결과 containerOf에는
// 실제 요소 id를 담는다 (reflowSection이 id로 비교).
// v1 저장본에는 containerOf가 없으므로 이 명명 규칙으로 재구성한다.
const CONTAINER_RULES: { pattern: RegExp; children: (idx: string) => string[] }[] = [
  {
    pattern: /^review_card_bg_(\d+)$/,
    children: (i) => [
      `review_avatar_${i}`, `review_initial_${i}`, `review_author_${i}`,
      `review_stars_${i}`, `review_text_${i}`, `review_badge_${i}`,
    ],
  },
  { pattern: /^step_(?:bg|border)_(\d+)$/, children: (i) => [`step_num_${i}`, `step_text_${i}`] },
  { pattern: /^bubble_bg_(\d+)$/, children: (i) => [`bubble_text_${i}`] },
  { pattern: /^usp_cell_(\d+)$/, children: (i) => [`usp_icon_${i}`, `usp_label_${i}`, `usp_sub_${i}`] },
];

function restoreContainerRelations<T extends { id: string; name: string; containerOf?: string[] }>(
  elements: T[],
): T[] {
  const idByName = new Map(elements.map((e) => [e.name, e.id]));
  return elements.map((el) => {
    if (el.containerOf?.length) return el;
    for (const { pattern, children } of CONTAINER_RULES) {
      const m = el.name.match(pattern);
      if (!m) continue;
      const childIds = children(m[1])
        .map((name) => idByName.get(name))
        .filter((id): id is string => !!id);
      if (childIds.length) return { ...el, containerOf: childIds };
    }
    return el;
  });
}
