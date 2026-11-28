/**
 * 디자인 컷 구매 전 확인(2026-10-30 통합 지시, #288 후속) — 디자인 컷 잡은 계획 순서로 다시 그려서, 변환기가 넣은 '구매 전 확인'
 * 표가 빠지고 스펙 표에 더한 행도 T6(치수 전용)에서 사라졌다. 다 그린 섹션의 글로 #288 판정을 다시 해(purchaseRows → missingRows)
 * 구성·사이즈·옵션 값이 빠졌으면 디자인 컷 표(buildPurchaseTable)를 첫 CTA 바로 앞(CTA가 없으면 끝)에 넣는다.
 * 계약(designcut 기록)은 바꾸지 않는다 — 예전 계획 기록에도 같은 규칙이 걸린다.
 * 끝 자리(오너 지시 2026-11-01): K 페이지는 K 표 바로 앞, 사이즈·상품 정보가 맨 끝인 계획(factsLast)은 그 두 섹션 바로 앞이다.
 */

import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ProSectionType } from '@/lib/registration/editor/types/section'
import { uid } from '../helpers'
import { PURCHASE_CHECK_TITLE, missingRows, purchaseRows, shownTextsOf, type SpecRow } from '../purchaseCheck'
import type { CutSection, DesigncutBg } from './contract'
import { buildPurchaseTable } from './templatesInfo'
import type { CutContext } from './templatesScene'
import { surfaceOf } from './tokens'

/** 표 바탕 후보 — 앞뒤 섹션과 다른 첫 바탕(같으면 separateSameBackgrounds가 선을 긋는다). v2는 흰·스튜디오 교대라 N·W만(layout2.ts) */
const BG_CANDIDATES: readonly DesigncutBg[] = ['N', 'T', 'W']
const K_TABLE_LAYOUT = 'designcut_k_spec_table.'
const BG_CANDIDATES_V2: readonly DesigncutBg[] = ['N', 'W']

export function insertPurchaseCheck(
  sections: CanvasSection[],
  specSheet: Record<string, unknown> | undefined,
  ctx: Omit<CutContext, 'section'>,
  // at = 놓을 자리. 사이즈·상품 정보가 맨 끝인 계획(factsLast)은 조립이 그 두 섹션 바로 앞을 준다. 없으면 첫 CTA 앞
  { at }: { at?: number } = {}
): { sections: CanvasSection[]; rows: SpecRow[] } {
  const rows = missingRows(purchaseRows(specSheet), shownTextsOf(sections))
  if (rows.length === 0) return { sections, rows }
  // K 페이지는 상품 정보 표가 맨 끝이다 — 구성·사이즈·옵션 표는 그 바로 앞이다(오너 지시 11-01 끝 두 자리). 그 밖의 페이지는 첫 CTA 바로 앞이다
  const kTable = sections.findIndex((s) => s.layoutId?.startsWith(K_TABLE_LAYOUT))
  const cta = sections.findIndex((s) => s.sectionType === ProSectionType.CTA)
  const pos = at ?? (kTable !== -1 ? kTable : cta === -1 ? sections.length : cta)
  const neighbors = [sections[pos - 1], sections[pos]].map((s) => s?.canvas.backgroundColor)
  const bg = (ctx.v2 ? BG_CANDIDATES_V2 : BG_CANDIDATES).find((b) => !neighbors.includes(surfaceOf(b, ctx.colors).fill)) ?? 'N'
  const section: CutSection = {
    key: 'purchase_check',
    role: 'purchase_check',
    template: 'T4',
    bg,
    chapter: null,
    plateKey: null,
    plateAspect: null,
    productImageKey: null,
    productAlpha: false,
    text: { eyebrow: null, headline: PURCHASE_CHECK_TITLE, sub: null },
    modules: {},
  }
  const result = buildPurchaseTable({ ...ctx, section }, rows)
  if (!result) return { sections, rows: [] }
  const table: CanvasSection = {
    id: uid('sec'),
    sectionType: ProSectionType.SPEC_TABLE,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_purchase',
    canvas: { width: 860, height: result.height, backgroundColor: result.background },
    elements: result.elements,
    needsInitialReflow: false,
  }
  return { sections: [...sections.slice(0, pos), table, ...sections.slice(pos)], rows }
}
