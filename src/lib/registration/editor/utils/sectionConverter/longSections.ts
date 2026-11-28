// sectionConverter/longSections.ts — 긴 상세페이지 확장 섹션 배치(PDP-DR-PLAN §7 ②, L-1)
//
// 설계 단계가 근거를 판정한 확장 섹션(section_plan.long.kinds — long-sections.ts)을 스펙 표 빌더로 지어 넣는다. 표는 설계 판정과 같은
// 함수(longTables)에 페이지의 그려진 글을 넘겨 짓는다 — 이미 보이는 값은 빼고 남은 행이 최소 수 이상일 때만 둔다(같은 정보 되풀이 없음,
// r4). 구매 전 확인(purchaseCheck.ts)은 이 표까지 보고 빠진 행만 싣는다(겹치면 한쪽만).
// 자리: 크기·구성은 스펙 표 바로 뒤(없으면 CTA 앞), 관리·보관은 사용 방법 뒤(없으면 CTA 앞), 구매 전 질문은 CTA 앞.
// L-2 사용 장면(사진): 제목 + 장면마다 생성 컷(정사각) → 태그 캡션. 자리는 사용 방법 뒤 → 없으면 마지막 추가 특징 뒤 → CTA 앞.

import type { CanvasElement, CanvasSection, ExpansionKind } from '@/lib/registration/editor/types/canvas'
import type { DesignPalette } from '@/lib/registration/editor/types/editor'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import { SECTION_GROUP_MAP } from '@/lib/registration/editor/constants/sectionConfig'
import {
  LONG_MIN_ROWS,
  LONG_SECTION_TITLE,
  longSceneKey,
  longSceneTags,
  longTables,
  type LongRow,
} from '@/lib/registration/long-sections'
import { makeImageEl, makeTextEl } from './elements'
import { missingRows } from './purchaseCheck'
import { computeSectionHeight, CONTENT_WIDTH, sanitizeImageUrl, SIDE_PADDING, str, uid } from './helpers'

export interface LongSectionsInput {
  kinds: ExpansionKind[]
  objections: Array<{ objection: string; type?: string }>
}

/** 확장 섹션 표 — 이미 보이는 값을 뺀 행(질문은 답 조각 단위), 최소 행 수 이상만 */
export function expansionTables(
  input: LongSectionsInput,
  specSheet: Record<string, unknown> | undefined,
  shownTexts: readonly string[]
): Array<{ kind: ExpansionKind; rows: LongRow[] }> {
  return longTables(input.kinds, specSheet, input.objections, shownTexts)
}

export const expansionTitle = (kind: ExpansionKind) => LONG_SECTION_TITLE[kind]

/**
 * 사용 장면 확장 섹션(L-2) — 페이지에 없는 사용 장면 태그(long-sections longSceneTags)와 그 생성 컷(long_scene:i)이 2쌍 이상일 때만.
 * 문구는 카피 태그 그대로(새 문구 없음). 컷이 빠진 태그와 다른 섹션 글에 이미 보이는 태그(추천 대상 등)는 뺀다
 */
export function buildSceneSection(
  usageSceneTags: unknown,
  images: Record<string, string | string[]>,
  sectionOrder: readonly string[],
  palette: DesignPalette,
  shownTexts: readonly string[] = []
): CanvasSection | null {
  const unseen = (tag: string) => missingRows([{ label: '', value: tag, items: [tag] }], shownTexts).length > 0
  const scenes = longSceneTags(usageSceneTags, sectionOrder)
    .map((tag, i) => ({ tag, url: sanitizeImageUrl(str(images[longSceneKey(i)])), key: longSceneKey(i) }))
    .filter((s) => s.url && unseen(s.tag))
  if (scenes.length < LONG_MIN_ROWS.scenes) return null
  const ink = palette.textMain || '#1a1a1a'
  const elements: CanvasElement[] = []
  let y = 80
  const title = makeTextEl('scenes_title', LONG_SECTION_TITLE.scenes, 'h2', SIDE_PADDING, y, CONTENT_WIDTH, ink, 'center', 3)
  elements.push(title)
  y += title.transform.height + 60
  scenes.forEach((s, i) => {
    if (i > 0) y += 60
    elements.push(makeImageEl(`scene_${i}_img`, s.url, s.key, SIDE_PADDING, y, CONTENT_WIDTH, CONTENT_WIDTH, 1, 'cover'))
    y += CONTENT_WIDTH + 24
    const caption = makeTextEl(`scene_${i}_caption`, s.tag, 'body', SIDE_PADDING, y, CONTENT_WIDTH, ink, 'center', 3)
    elements.push(caption)
    y += caption.transform.height
  })
  const type = ProSectionType.SUB2_DIV_PAGE
  return {
    id: uid('sec'),
    sectionType: type,
    groupType: SECTION_GROUP_MAP[type],
    order: 0,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height: computeSectionHeight(elements), backgroundColor: palette.bgMain || '#FFFFFF' },
    elements,
    needsInitialReflow: true,
    expansion: 'scenes',
  }
}

/** 확장 섹션 자리 — 앞의 유형부터 찾아 그 마지막 골격 섹션 바로 뒤, 없으면 첫 CTA 앞 */
const ANCHORS: Record<ExpansionKind, ProSectionType[]> = {
  size: [ProSectionType.SPEC_TABLE],
  care: [ProSectionType.HIDDEN_PAGE],
  faq: [],
  scenes: [ProSectionType.HIDDEN_PAGE, ProSectionType.SUB_DIV],
}

/**
 * 확장 섹션을 제자리에 — 크기·구성은 스펙 표 뒤, 관리·보관은 사용 방법 뒤, 사용 장면은 사용 방법(없으면 추가 특징) 뒤, 없으면(그리고
 * 구매 전 질문은) 첫 CTA 앞, CTA가 없으면 끝
 */
export function placeExpansions(
  sections: CanvasSection[],
  expansions: ReadonlyArray<{ kind: ExpansionKind; section: CanvasSection }>
): CanvasSection[] {
  let out = [...sections]
  const insertAt = (pos: number, section: CanvasSection) => {
    out = [...out.slice(0, pos), section, ...out.slice(pos)]
  }
  const beforeCta = () => {
    const cta = out.findIndex((s) => s.sectionType === ProSectionType.CTA)
    return cta === -1 ? out.length : cta
  }
  for (const { kind, section } of expansions) {
    const anchor = ANCHORS[kind]
      .map((type) => out.findLastIndex((s) => s.sectionType === type && !s.expansion))
      .find((at) => at >= 0)
    insertAt(anchor !== undefined ? anchor + 1 : beforeCta(), section)
  }
  return out
}
