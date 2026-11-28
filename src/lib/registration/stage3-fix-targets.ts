/**
 * Stage 3 '고칠 곳'이 가리키는 최상위 칸(pdp-stage3-fix-effective) — flow·rhythm 잡의 무결성 검사(enforceStage3FieldIntegrity keep)는
 * 이 칸이 신고 없이 바뀌어도 되돌리지 않는다. R10-L-P02 등 비율 0 잡은 핵심 12칸이 Stage 2와 같았다 — 고친 것을 신고하지 않으면
 * 되돌려지고 아무것도 남지 않는다. 결정론 검사 결과(흐름·리듬·카피 규칙·섹션 반복)의 위치를 최상위 칸 이름으로 바꾼다. 순수
 */

import type { CopyFlowFindings } from './copy-flow-check'
import type { RepeatFinding } from './copy-repeats'
import type { CopyRhythmFindings } from './copy-rhythm-check'
import type { CopyRuleFindings } from './copy-rule-check'

/** 반복 검사의 섹션 이름 → 최상위 칸 — 특징 묶음은 두 칸, 흐름 검사는 마지막 띠(closingCta)를 첫 화면에 합쳐 센다 */
const SECTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  features: ['pointCards', 'detailPoints'],
  mainIntro: ['mainIntro', 'closingCta'],
}
/** 답 없는 고민은 뒤 섹션(solution·특징·사용법)에서 답하라고 하므로 그 칸도 */
const ANSWER_FIELDS = ['solution', 'pointCards', 'detailPoints', 'howTo']

const topOf = (path: string) => path.split('.')[0].split('[')[0]
const fieldsOf = (section: string) => SECTION_FIELDS[section] ?? [section]

export interface Stage3FixFindings {
  flow?: CopyFlowFindings | null
  rhythm?: CopyRhythmFindings | null
  rules?: CopyRuleFindings | null
  repeats?: readonly RepeatFinding[] | null
}

/** '고칠 곳' 블록이 고치라고 할 수 있는 최상위 칸 — 블록 상한으로 잘린 항목도 넣는다(더 넓게 남긴다) */
export function stage3FixTargets(f: Stage3FixFindings): Set<string> {
  const out = new Set<string>()
  const addSections = (sections: readonly string[]) => sections.flatMap(fieldsOf).forEach((k) => out.add(k))
  const addPath = (path: string) => out.add(topOf(path))
  for (const r of f.repeats ?? []) addSections(r.sections)
  if (f.flow) {
    for (const p of f.flow.phrases) addSections(p.sections)
    for (const e of f.flow.features) addSections(e.sections)
    for (const n of f.flow.numbers) addSections(n.sections)
    for (const r of f.flow.restated) addPath(r.path)
    for (const e of f.flow.closingEcho) addPath(e.path)
    for (const c of f.flow.concerns.filter((x) => !x.answered)) {
      addPath(c.path)
      ANSWER_FIELDS.forEach((k) => out.add(k))
    }
  }
  if (f.rhythm) {
    for (const x of [...f.rhythm.headLong, ...f.rhythm.badBreaks, ...f.rhythm.longSentences, ...f.rhythm.crowded]) addPath(x.path)
  }
  if (f.rules) {
    for (const g of f.rules.guideEndings) addPath(g.path)
    if (f.rules.hookType?.present === false) out.add('mainIntro')
  }
  out.delete('')
  return out
}
