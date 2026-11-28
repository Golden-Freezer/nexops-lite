/**
 * 표본 값 render(render-check args.sampleInputs, 통합 11-03 23:42) — 저장된 잡 spec에 입력 칸 표본(withSampleInputSlots)을 메모리에서만 얹는다.
 * 저장 잡은 입력 칸이 비어 있어(R17-L 0/11) 입력이 있을 때만 그리는 부품이 화면에 안 나온다. 오너 답 '화면 확인은 표본 값'(INPUT-SLOTS.md)을
 * 저장 컷 render로 보는 길이다. 다시 세우기(--replan)나 K 재조립(--k0)과 함께만 뜻이 있다 — 저장된 계획은 표본을 읽지 않는다.
 * 기본 꺼짐, LLM·이미지 호출 없음, DB에 쓰지 않는다. 표본 글은 '표본…'으로 시작해 실제 상품 값과 섞여 보이지 않는다
 */

import { INPUT_SLOT_SAMPLE, withSampleInputSlots } from '../__fixtures__/input-slots.sample'
import { optionChips } from '../internalized/designcut-inputs'
import type { PdpJobRow } from '../pdp-state'

/**
 * 원본 잡은 그대로 두고 spec만 표본을 얹은 새 잡.
 * 견본 색(적용 C5 ③, 통합 03:23 (가)) — 표본 견본 이름('표본 초록'·'표본 베이지')은 실제 옵션 이름과 짝이 안 맞아 색 점·칩이 안 나온다.
 * 잡에 옵션이 둘 이상이면 표본 견본 둘의 이름만 앞 두 옵션 이름으로 바꿔 얹는다(색은 표본 그대로, 메모리에서만 — 저장 0). 픽스처는 그대로다
 */
export function withSampleInputJob(job: PdpJobRow): PdpJobRow {
  const spec = withSampleInputSlots(job.spec_sheet)
  const labels = optionChips(job, job.copy_sections?.final?.colorOptions?.options, true).map((chip) => chip.label)
  const swatches = labels.length >= 2 ? INPUT_SLOT_SAMPLE.swatches.slice(0, 2).map((swatch, i) => ({ ...swatch, name: labels[i] })) : spec.swatches
  return { ...job, spec_sheet: { ...spec, swatches } }
}
