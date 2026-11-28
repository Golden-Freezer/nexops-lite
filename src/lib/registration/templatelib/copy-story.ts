/**
 * K 칸 카피가 읽는 D 원문 카피(하네스 J36 → J28, 통합 11-10 decide 3 — 오너 05:2x '원문 카피는 자연스러운데 화면 칸 글이 너무 축약된 것은 아닌지').
 * J36 점검: 칸 카피 콜(line-plan planTemplateLine)이 원문 카피(copy_sections.final)를 받지 않아, 칸 글은 원문을 줄인 글이 아니라 사실에서 새로 쓴
 * 짧은 글이었다(여섯 판 모두 원문의 33~36%, 문장 줄 1/3~1/5). copystory 스위치 잡만 섹션마다 그 섹션에 맞는 원문 줄을 칸 카피 콜에 싣고,
 * 프롬프트는 '이야기·말투를 칸 상한 안에서 옮기고 새 사실은 더하지 않는다'고 적는다.
 * - 싣지 않는 것: 브랜드·상품명(brandAndName), 후기 인용(reviewHighlights), 비교 칸(compareItems·compareSummary — 다른 상품 비교 주장), 사실 근거 줄(proof —
 *   사실은 '실을 수 있는 사실' 목록에서만), 원산지를 말하는 줄(R09b — 원산지는 상품 정보 표에만).
 * - 원문 줄이 없는 섹션(입력값 섹션·표·후기 등)은 싣지 않는다. 스위치가 꺼진 잡은 이 파일을 거치지 않는다(프롬프트 바이트 그대로). 순수.
 * 재현 진입점(B J37 칸 글 3사 후보)도 copyStoryOf를 그대로 부를 수 있다
 */

import type { CopywritingResult } from '../pdp-state'
import { isOriginFact } from './origin-text'

/** 섹션마다 원문 줄 상한·한 줄 길이 상한 — 콜 입력이 크게 늘지 않게 한다 */
export const STORY_LINES_MAX = 4
export const STORY_LINE_MAX = 90

const clip = (value: unknown): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > STORY_LINE_MAX ? `${text.slice(0, STORY_LINE_MAX - 1)}…` : text
}
const joined = (...parts: unknown[]) => parts.map(clip).filter(Boolean).join(' — ')

/** 섹션 → 원문 줄. nth는 같은 섹션 id가 몇 번째로 나왔는지(point_div ↔ detailPoints[nth]) */
function linesFor(section: string, nth: number, final: CopywritingResult): unknown[] {
  const intro = final.mainIntro ?? {}
  switch (section) {
    case 'hook_3step':
      return [intro.hook, intro.benefitHeadline, intro.subBenefit]
    case 'main_cut':
      return [final.mainCutCopy?.headline, final.mainCutCopy?.subCopy, intro.benefitHeadline, intro.subBenefit]
    case 'problem_raise':
      return [final.problem?.question, final.problem?.empathy]
    case 'problem_empathy':
      return [final.problem?.question, final.problem?.empathy, ...(final.problem?.empathyLines ?? []), ...(final.problem?.empathyDeepLines ?? [])]
    case 'solution_guide':
      return [final.solution?.declaration, final.solution?.summary]
    case 'key_message':
    case 'concept_desc':
    case 'petit_div':
      return [final.summary]
    case 'point_div': {
      const point = final.detailPoints?.[nth]
      return point ? [joined(point.claim, point.benefit)] : []
    }
    case 'sub_div':
    case 'point_list_div':
      return (final.pointCards ?? []).map((card) => joined(card.title, card.description))
    case 'how_to':
      return (final.howTo ?? []).map((step) => joined(step.step, step.description))
    case 'direction_suggest':
      return final.recommendedTargets ?? []
    case 'convert_div':
    case 'cta':
      return [final.closingCta?.headline, final.closingCta?.subtext]
    default:
      return []
  }
}

/**
 * 놓인 섹션마다 원문 줄 — 키는 순서 풀이 결과의 섹션 번호(칸 카피 콜의 [index]). 원산지 줄은 뺀다(spec 원산지 값 기준).
 * 앞 섹션에 실은 줄은 뒤 섹션에 다시 싣지 않는다(첫 화면·대표 컷, 고민 꺼내기·공감이 같은 원문을 받아 글이 되풀이되지 않게). 줄이 하나도 없는 섹션은 키가 없다
 */
export function copyStoryOf(final: CopywritingResult | null | undefined, sections: ReadonlyArray<{ section: string }>, origin?: string | null): Record<number, string[]> {
  if (!final) return {}
  const seen = new Map<string, number>()
  const used = new Set<string>()
  const story: Record<number, string[]> = {}
  sections.forEach((row, index) => {
    const nth = seen.get(row.section) ?? 0
    seen.set(row.section, nth + 1)
    const lines = [...new Set(linesFor(row.section, nth, final).map(clip))]
      .filter((line) => line !== '' && !used.has(line) && !isOriginFact(line, origin))
      .slice(0, STORY_LINES_MAX)
    for (const line of lines) used.add(line)
    if (lines.length > 0) story[index] = lines
  })
  return story
}
