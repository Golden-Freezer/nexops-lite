// editor/utils/keepCore.ts — 긴 상세페이지 '핵심만 남기기'(PDP-DR-PLAN §7 ③, L-3)
//
// 변환기가 더한 확장 섹션(CanvasSection.expansion — 크기·구성·관리·보관·구매 전 질문·사용 장면)을 한꺼번에 숨기거나 다시 보이거나
// 지운다. 섹션 사이 거터(divider)는 앞 섹션 뒤에 붙고 그 색·높이도 앞 섹션을 따른다(insertWhiteDividers·applyToneRhythm). 그래서 확장
// 섹션 이웃 거터 가운데, 바뀐 뒤 보이는 순서에서 겹치거나(바로 앞도 보이는 거터) 섹션 사이가 아닌(맨 앞·맨 뒤) 것만 함께 숨기거나
// 지운다 — 남는 거터는 앞 섹션의 것이다. 섹션별 삭제·숨김(LeftPanel)은 그대로다. 순수 함수 — 스토어가 기록(되돌리기)과 함께 부른다.

import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { ProSectionType } from '@/lib/registration/editor/types/section';

const isDivider = (s: CanvasSection) => s.sectionType === ProSectionType.DIVIDER;

/** 확장 섹션 바로 앞·뒤의 거터 id(확장 섹션이 바뀔 때 함께 살필 거터) */
function neighborDividers(sections: readonly CanvasSection[]): Set<string> {
  const ids = new Set<string>();
  sections.forEach((s, i) => {
    if (!s.expansion) return;
    for (const near of [sections[i - 1], sections[i + 1]]) if (near && isDivider(near)) ids.add(near.id);
  });
  return ids;
}

/** 보이는 순서에서 군더더기 거터 — 앞에 보이는 섹션이 없거나, 바로 앞이 보이는 거터이거나, 뒤에 보이는 섹션이 없는 거터 */
function redundantDividers(sections: readonly CanvasSection[]): Set<string> {
  const visible = sections.filter((s) => s.isVisible !== false);
  const redundant = new Set<string>();
  let seenContent = false;
  let lastDivider: string | null = null;
  for (const s of visible) {
    if (!isDivider(s)) {
      seenContent = true;
      lastDivider = null;
      continue;
    }
    if (!seenContent || lastDivider) redundant.add(s.id);
    else lastDivider = s.id;
  }
  if (lastDivider) redundant.add(lastDivider);
  return redundant;
}

/** 확장 섹션 수와 그중 보이는 수 — 없으면 둘 다 0(버튼을 숨긴다) */
export function expansionState(sections: readonly CanvasSection[]): { count: number; visible: number } {
  const expansions = sections.filter((s) => s.expansion);
  return { count: expansions.length, visible: expansions.filter((s) => s.isVisible !== false).length };
}

/**
 * 확장 섹션을 모두 보이거나 숨기고, 이웃 거터는 바뀐 뒤 보이는 순서에서 군더더기가 아닐 때만 보인다. 바뀌는 섹션이 없으면 같은 배열
 */
export function withExpansionsVisible(sections: CanvasSection[], visible: boolean): CanvasSection[] {
  const near = neighborDividers(sections);
  const toggled = sections.map((s) => (s.expansion ? { ...s, isVisible: visible } : s));
  const redundant = redundantDividers(toggled.map((s) => (near.has(s.id) ? { ...s, isVisible: true } : s)));
  const next = toggled.map((s) => (near.has(s.id) ? { ...s, isVisible: !redundant.has(s.id) } : s));
  if (next.every((s, i) => s.isVisible === sections[i].isVisible)) return sections;
  return next.map((s, i) => (s.isVisible === sections[i].isVisible ? sections[i] : s));
}

/** 확장 섹션과, 그 뒤 군더더기가 되는 이웃 거터를 지운다 — order는 배열 순서로 다시 매긴다(editorStore removeSection과 같은 규칙) */
export function withoutExpansions(sections: CanvasSection[]): CanvasSection[] {
  if (!sections.some((s) => s.expansion)) return sections;
  const near = neighborDividers(sections);
  const rest = sections.filter((s) => !s.expansion);
  // 앞서 숨겨 둔 이웃 거터도 보이는 것으로 놓고 판정한다(숨김 → 지우기 순서여도 군더더기 거터가 문서에 남지 않게)
  const redundant = redundantDividers(rest.map((s) => (near.has(s.id) ? { ...s, isVisible: true } : s)));
  return rest
    .filter((s) => !(near.has(s.id) && redundant.has(s.id)))
    .map((s, i) => (s.order === i ? s : { ...s, order: i }));
}
