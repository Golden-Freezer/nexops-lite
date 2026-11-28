/**
 * K 라인 계획의 실제 콜 연결 — templatelib 잡만 동적으로 읽는다. 스위치가 꺼진 잡은 이 파일과 템플릿 라이브러리를 읽지 않는다.
 */

import { composeTemplateSections, generateTemplateGuideline, selectTemplatePicks } from '@/lib/agents/registration/pdp-template-agent'
import { pickMotionCells } from '@/lib/agents/registration/pdp-motion-pick-agent'
import { pickPaletteByVision } from '@/lib/agents/registration/pdp-palette-pick-agent'
import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { fillTemplateSlots } from '@/lib/agents/registration/pdp-template-copy-agent'
import type { RunContext } from '@/lib/agents/types'
import { slotCopyGuardOf } from './kline-copy-guard'
import type { PdpJobRow } from './pdp-state'
import { planTemplateLine, type LinePlanResult } from './templatelib/line-plan'

export { lostSectionsOf } from './templatelib/line-plan'

/**
 * 계획 콜을 부른다. 도중에 던지면(카피를 못 받음, 소프트 종료) 계획이 남지 않아 다음 run이 다시 부른다 — 그때까지 끝난 콜의 비용을 saveSpent로 잡에 더하고 같은 오류를 던진다.
 * 오류를 감싸지 않는다(파이프라인이 이름으로 소프트 종료를 가른다). 콜 하나의 안에서 던지면 그 콜이 앞서 쓴 비용은 여기로 오지 않는다(고치기 콜의 소프트 종료).
 * photo(원본 사진 첫 장)가 있으면 색 조합 비전 고르기를 붙인다 — palettepick 잡만 부른다(select-line), 꺼진 잡은 콜 0이다.
 */
export async function runTemplateLinePlan(
  job: PdpJobRow,
  runContext: RunContext,
  saveSpent: (usd: number) => Promise<unknown>,
  photo?: VisionImage
): Promise<LinePlanResult> {
  let spent = 0
  const counted =
    <I, O extends { costUsd: number }>(call: (input: I, context: RunContext) => Promise<O>) =>
    async (input: I) => {
      const outcome = await call(input, runContext)
      spent += outcome.costUsd
      return outcome
    }
  // 화면 글 가드(결정 카드 c03) — 연령 제한·학부모 대리 구매·경쟁사 리뷰가 있는 잡만 칸 카피 프롬프트·검사가 달라진다. 없는 잡은 빈 객체
  const guard = slotCopyGuardOf(job)
  try {
    return await planTemplateLine(job, {
      guideline: counted(generateTemplateGuideline),
      compose: counted(composeTemplateSections),
      select: counted(selectTemplatePicks),
      fillSlots: counted((input: Parameters<typeof fillTemplateSlots>[0], context: RunContext) => fillTemplateSlots({ ...input, ...guard }, context)),
      pickMotion: counted(pickMotionCells),
      ...(photo ? { palette: counted((input: Parameters<typeof pickPaletteByVision>[1], context: RunContext) => pickPaletteByVision(photo, input, context)) } : {}),
    })
  } catch (e) {
    if (spent > 0) await saveSpent(spent)
    throw e
  }
}
