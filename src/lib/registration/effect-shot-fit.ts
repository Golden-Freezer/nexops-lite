/**
 * 체감 결과 문장 길이 가드(하네스 J65, 통합 판단 11-11 08:4x) — 새 배치(힉스필드 MS 2k) 컷 지시만 다룬다. 지금 배치 지시는 바이트 그대로다.
 * 근거: effectshot 기본 켬 재현(808be0b1·462d097d)에서 기능·사용 컷 13개 중 4개가 체감 문장(EFFECT_SHOT_LINE) 때문에 MS 5,000자 맞추기의
 * 마지막 수단 덜기가 하나 늘어 부품(PRODUCT PARTS)·참조 역할(REFERENCE ROLES) 블록이 빠졌다. 두 블록은 상품 구조를 지키는 블록이라
 * 체감 문장 하나 때문에 빠지면 안 된다(K7 P09 끈 빠짐 같은 사고).
 * 그래서 문장을 붙인 지시와 뺀 지시를 각각 fitMsPrompt로 재고, 붙인 쪽이 블록을 더 덜거나 상한을 넘으면 그 컷은 문장만 뺀다.
 * 맞추기는 앞에서부터 같은 차례로 더니 덜기 수가 같으면 덜어 낸 블록도 같다.
 */

import { fitMsPrompt, type MsPromptFit } from './ms-prompt-fit'
import { EFFECT_SHOT_LINE } from './templatelib/shot-brief'

/** 컷 기록 — shown: 문장을 실어 보냄, too-long: 문장 때문에 블록이 더 덜리거나 상한을 넘어 문장만 뺌 */
export type EffectShotFit = 'shown' | 'too-long'

/** 컷 지시 Purpose 줄 끝에 붙는 모양(buildShotBrief) */
const EFFECT_MARK = ` ${EFFECT_SHOT_LINE}`

/**
 * MS 2k 컷 지시의 체감 문장 가드 — 문장이 없는 지시(꺼진 잡·기능·사용 밖 컷)는 null(호출자가 지금처럼 fitMsPrompt를 부른다).
 * 고른 지시와 그 지시의 맞추기 결과를 함께 돌려 호출자가 다시 재지 않게 한다
 */
export function effectShotFitOf(prompt: string): { prompt: string; fit: MsPromptFit; effectShot: EffectShotFit } | null {
  if (!prompt.includes(EFFECT_MARK)) return null
  const shown = fitMsPrompt(prompt)
  const bare = prompt.split(EFFECT_MARK).join('')
  const without = fitMsPrompt(bare)
  if (shown.fits && shown.dropped.length <= without.dropped.length) return { prompt, fit: shown, effectShot: 'shown' }
  return { prompt: bare, fit: without, effectShot: 'too-long' }
}
