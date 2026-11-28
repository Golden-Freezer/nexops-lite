/**
 * K 라인 계획 기록(M5, 15_TEMPLATE_LINE §10) — 순서 풀이 결과와 카피를 디자인 컷 계획으로 옮긴다. 편집기 조립은 templateRef가 있는 섹션을 엔진으로 그린다.
 * 팔레트·모티프 같은 잡 값은 기준 계획(buildDesigncutPlan)에서 받고, 페이지 구성은 모두 K 값으로 바꾼다. 순수·결정론이고 line-plan.ts가 부른다.
 */

import type { DesigncutPlan, DesigncutSection } from '../pdp-state'
import type { ColorSet } from './color-sets'
import { shapeRadius } from './concept-radius'
import type { Concept } from './concepts'
import { FONT_PAIR_TABLE, type FontPairId } from './font-pairs'
import type { LineInputs } from './input-values'
import { pointChapterOf, templateRefsOf } from './section-values'
import type { OrderedSection } from './selection-order'
import type { CopyValues } from './slot-copy'

/**
 * 엔진이 못 그린 섹션의 칸 — 글·사진·모듈을 비워 두어 이 템플릿이 대신 그릴 것이 없다. 그 섹션은 빠지고 stats.fallbacks에 남는다(지어내지 않는다). 시험이 고정한다
 */
const NO_FALLBACK_TEMPLATE: DesigncutSection['template'] = 'T4'

export const templatelibSectionKey = (index: number, section: string) => `k${index}_${section}`

export interface TemplatelibPlanInput {
  sections: readonly OrderedSection[]
  palette: Pick<ColorSet, 'colors'>
  fontPair: FontPairId
  /** 섹션 번호 → 모델이 쓴 카피. 없는 섹션은 입력값·컷 키만 들어간다 */
  copy: ReadonlyMap<number, CopyValues>
  inputs: LineInputs
  /** 섹션 번호 → 모델이 고른 강조 구절(슬롯 카피 에이전트가 검사함). 없으면 지금 규칙 */
  accents?: ReadonlyMap<number, string>
  /** 컨셉 모서리(T1-28) — 있으면 templateRadius로 기록한다. 없으면 칸을 두지 않는다(계획 모서리 그대로) */
  shape?: Concept['shape']
}

/** 기준 계획 + 선택 결과 → K 계획. 라이브러리에 없는 템플릿 섹션은 기록하지 않고 번호는 그대로 둔다(컷 키가 섹션 번호를 쓴다) */
export function buildTemplatelibPlan(base: DesigncutPlan, input: TemplatelibPlanInput): DesigncutPlan {
  const refs = templateRefsOf(input.sections, input.copy, input.inputs, input.accents)
  const { heading, weight } = FONT_PAIR_TABLE[input.fontPair]
  const sections = input.sections.flatMap((row, index): DesigncutSection[] => {
    const templateRef = refs[index]
    if (!templateRef) return []
    return [
      {
        key: templatelibSectionKey(index, row.section),
        role: row.section,
        template: NO_FALLBACK_TEMPLATE,
        bg: row.bg,
        chapter: pointChapterOf(input.sections, index, input.copy) ?? null,
        plateKey: null,
        plateAspect: null,
        productImageKey: null,
        productAlpha: false,
        text: { eyebrow: null, headline: null, sub: null },
        modules: [],
        templateRef,
      },
    ]
  })
  return {
    ...base,
    sections,
    kept: [],
    omitted: [],
    order: sections.map((section) => section.key),
    layout: 2,
    templateColors: input.palette.colors,
    ...(input.shape ? { templateRadius: shapeRadius(input.shape) } : {}),
    templateFontPair: { heading, weight },
  }
}
