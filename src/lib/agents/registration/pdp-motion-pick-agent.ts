/**
 * 움직이는 칸 고르기 콜(세션 B 움직이는 칸 자리 규칙 ②) — motionband 잡의 K 계획(line-plan planMotion)만 부른다. 후보·상한·거르기는 motion/pick.ts가 정한다.
 * 실패는 던지지 않고 빈 목록과 까닭을 돌려준다(계획을 막지 않는다 — 대표 칸은 그대로 만든다).
 */

import { billedCostOf } from '../billed-usage'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { buildMotionPickPrompt, MOTION_PICK_SYSTEM, parseMotionPick, type MotionPickInput } from '@/lib/registration/motion/pick'
import { callLlm } from '../llm'
import type { RunContext } from '../types'

const TIMEOUT_MS = 45_000

export async function pickMotionCells(
  input: MotionPickInput,
  runContext?: RunContext,
): Promise<{ picks: unknown[]; costUsd: number; error: string | null }> {
  const result = await callLlm(
    pdpRoute('design/motion-pick'),
    {
      system: MOTION_PICK_SYSTEM,
      messages: [{ role: 'user', content: buildMotionPickPrompt(input) }],
      timeoutMs: TIMEOUT_MS,
      agentName: 'registration/pdp-motion-pick',
      runContext,
    },
    (text) => parseMotionPick(text),
  )
  if (!result.success) {
    console.warn('[registration/pdp-motion-pick] 움직이는 칸 고르기 실패:', result.error.message)
    return { picks: [], costUsd: billedCostOf(result), error: result.error.message }
  }
  return { picks: result.data, costUsd: billedCostOf(result), error: null }
}
