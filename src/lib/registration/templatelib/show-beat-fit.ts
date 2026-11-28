/**
 * 보여 줄 동작·설계 문장의 길이 가드(showbeat 잡, 하네스 J63) — MS 2k(상한 5,000자)는 맞추기(ms-prompt-fit)가 블록을 덜어 낸다.
 * 문장 하나 때문에 블록을 더 덜거나 넘치면 문장만 빼고 보낸다(J59 켬 k3: 4,971 → 5,054자, k1: 참조 역할 블록 하나 더 덜림 — 측정 j63-measure).
 * 컷 지시 Person 단계('쓰는 중')는 길이를 늘리지 않아 그대로 둔다. 순수 함수.
 *
 * 체감 결과 문장(effectshot, J65 effectShotFitOf)과 함께 붙은 컷 — 이 가드가 먼저 돌고, 동작 문장은 체감 문장을 뺀 지시로 잰다.
 * 그래서 둘이 함께 넘치면 체감 문장을 먼저 뺀다(뒤의 effectShotFitOf가 동작 문장이 실린 지시로 체감 문장을 고른다).
 * 까닭: 동작 문장은 섹션 하나의 카피 동작(오너 J59 메모가 짚은 몫)이고, 체감 문장은 기능·사용 컷 모두에 붙는 공통 문장이다.
 */

import { fitMsPrompt } from '../ms-prompt-fit'
import { EFFECT_SHOT_LINE } from './shot-brief'

export interface ShowBeatFit {
  prompt: string
  kind: 'shown' | 'too-long'
}

const EFFECT_MARK = ` ${EFFECT_SHOT_LINE}`

/** 문장이 실린 컷만 값이 있다(없으면 null — 지시 그대로). 지금 배치 모델(상한 없음)은 맞추기 없이 shown */
export function showBeatFit(prompt: string, line: string | undefined, msLimited: boolean): ShowBeatFit | null {
  const marked = line ? ` ${line}` : ''
  if (!marked || !prompt.includes(marked)) return null
  if (!msLimited) return { prompt, kind: 'shown' }
  // 체감 문장 없이 잰다 — 함께 넘치면 체감 문장이 먼저 빠진다
  const measured = prompt.split(EFFECT_MARK).join('')
  const withBeat = fitMsPrompt(measured)
  const plain = fitMsPrompt(measured.replace(marked, ''))
  const moreDropped = withBeat.dropped.some((head) => !plain.dropped.includes(head)) || withBeat.compacted.some((head) => !plain.compacted.includes(head))
  return withBeat.fits && !moreDropped ? { prompt, kind: 'shown' } : { prompt: prompt.replace(marked, ''), kind: 'too-long' }
}
