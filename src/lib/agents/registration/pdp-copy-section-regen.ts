/**
 * D 카피 재생성 — 걸린 섹션 1콜(결정 카드 c14 L, 하네스 J27 — regenslot 스위치 잡만, 기본 off). 카피 단계의 재생성(연령·학부모 시점·숫자·
 * 경쟁사 재현·코퍼스 유사도)이 카피 전체(Stage 1~3, 3콜)를 다시 돌지 않고, 걸린 최상위 섹션만 지시와 함께 한 번에 다시 쓴다(재생성 1회당 콜 −2).
 * 다른 섹션은 참고로만 보여 주고 답에는 걸린 섹션 키만 받는다 — 이미 통과한 섹션이 흔들리지 않는다.
 * route는 Stage 3(품질 검수 — 위반 고치기)과 같은 copy/stage3, 단계 말미 블록(stageGuardBlock — 주장 범위·후기 범위·학부모·연령)과 사실 값
 * 블록(factsBlock)을 Stage 2·3과 같은 차례로 붙인다. 받기 판정(섹션마다)은 부르는 쪽(pdp-pipeline stepCopywriting)이 한다.
 * 답에 없거나 모양이 원래 섹션과 다른 섹션(객체↔배열·문자열, 배열 개수)은 버린다(dropped).
 */

import { callLlm } from '../llm'
import { parseLlmJson } from '../json-parser'
import type { AgentOutput, RunContext } from '../types'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import type { CopywritingResult } from '@/lib/registration/pdp-state'

export interface CopySectionRegenInput {
  /** 지금 최종 카피 — 고칠 섹션의 원래 값과 참고 섹션을 여기서 읽는다 */
  final: CopywritingResult
  /** 걸린 최상위 섹션 키(검사가 준 섹션) */
  sections: readonly string[]
  /** 재작성 지시(기존 재생성과 같은 지시 블록 — buildNumberRewriteDirective 등) */
  directive: string
  stageGuardBlock?: string
  factsBlock?: string
  runContext?: RunContext
  deadlineAt?: number
}

export interface CopySectionRegenResult {
  /** 받은 섹션 값 — 고칠 섹션 키만, 원래와 같은 모양 */
  sections: Record<string, unknown>
  /** 답에 없거나 모양이 달라 버린 섹션 */
  dropped: string[]
}

const valuesOf = (final: CopywritingResult, keys: (key: string) => boolean): Record<string, unknown> =>
  Object.fromEntries(Object.entries(final as unknown as Record<string, unknown>).filter(([key]) => keys(key)))

/** 섹션 재생성 프롬프트 — 지시 → 고칠 섹션(원래 값) → 참고 섹션 → 단계 말미 블록 → 사실 값 블록 순. 순수 */
export function buildCopySectionRegenPrompt(input: Pick<CopySectionRegenInput, 'final' | 'sections' | 'directive' | 'stageGuardBlock' | 'factsBlock'>): string {
  const fix = input.sections.filter((section) => section in (input.final as object))
  return [
    '## 걸린 섹션만 다시 쓴다',
    '아래 [지시]가 짚은 위반이 있는 섹션만 다시 쓴다. [참고 섹션]은 이미 검수를 통과했다 — 흐름·말투를 맞추는 데만 보고 답에 넣지 않는다.',
    `- 답은 JSON 객체 하나다. 키는 [고칠 섹션]의 키(${fix.join(', ')})만 쓴다.`,
    '- 값은 원래와 같은 모양으로 쓴다 — 객체는 같은 칸 이름, 배열은 같은 개수. 위반이 없는 칸은 원래 글을 그대로 둔다.',
    '- 새 사실·숫자·효능을 더하지 않는다. 지시를 지키려고 칸을 비우지 않는다.',
    '',
    input.directive,
    '',
    '[고칠 섹션]',
    JSON.stringify(valuesOf(input.final, (key) => fix.includes(key)), null, 2),
    '',
    '[참고 섹션 — 바꾸지 않는다]',
    JSON.stringify(valuesOf(input.final, (key) => !fix.includes(key))),
    ...(input.stageGuardBlock ? ['', input.stageGuardBlock] : []),
    ...(input.factsBlock ? ['', input.factsBlock] : []),
  ].join('\n')
}

/** 받은 값이 원래 섹션과 같은 모양인가 — 배열은 같은 개수, 객체는 객체, 그 밖은 같은 타입 */
export function sameSectionShape(before: unknown, after: unknown): boolean {
  if (Array.isArray(before)) return Array.isArray(after) && after.length === before.length
  if (before && typeof before === 'object') return Boolean(after) && typeof after === 'object' && !Array.isArray(after)
  return typeof before === typeof after
}

function parseSections(text: string): Record<string, unknown> {
  const parsed = parseLlmJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('섹션 재생성 응답 JSON 파싱 실패')
  return parsed
}

/** 걸린 섹션 1콜 — 실패하면 콜 결과(실패)를 그대로 돌려준다. 성공하면 고칠 섹션 키만, 원래와 같은 모양의 값만 남긴다 */
export async function regenerateCopySections(input: CopySectionRegenInput): Promise<AgentOutput<CopySectionRegenResult>> {
  const result = await callLlm<Record<string, unknown>>(
    pdpRoute('copy/stage3'),
    {
      system: 'You are a Korean e-commerce detail-page copy editor. Rewrite only the requested sections and respond only with the requested JSON.',
      messages: [{ role: 'user', content: buildCopySectionRegenPrompt(input) }],
      timeoutMs: 120_000,
      agentName: 'registration/pdp-copy-section-regen',
      runContext: input.runContext,
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    },
    parseSections
  )
  if (!result.success) return result
  const before = input.final as unknown as Record<string, unknown>
  const sections: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const section of input.sections) {
    if (section in result.data && section in before && sameSectionShape(before[section], result.data[section])) sections[section] = result.data[section]
    else dropped.push(section)
  }
  return { ...result, data: { sections, dropped } }
}
