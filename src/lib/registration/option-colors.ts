/**
 * 옵션 사진 색(하네스 J54, partsbands K 잡만) — 옵션 실물 사진마다 원천 사진 색 측정(measureDesigncutPhoto — sharp 64px 군집)과 같은 방법으로
 * 대표색 하나를 잰다. 옵션 색 띠(option_gallery.named-bands)가 그 옵션 이름 칸을 이 색으로 옅게 칠한다. 색은 사진 측정값이고 이름은 판매자 입력 그대로다.
 * 옵션이 둘 미만이거나 사진 없는 옵션이 있거나 하나라도 못 재면 failed — 일부 옵션만 띠를 칠하면 '색은 이것뿐'으로 읽힌다(견본 칩과 같은 규칙).
 * 모델 콜 0(유료 0) — 사진 내려받기와 로컬 측정뿐이다.
 */

import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { fetchImageAsBase64 } from '@/lib/agents/registration/thumbnail-vision-agent'
import { measureDesigncutPhoto } from './designcut-photo'
import type { DesigncutPhotoRecord, OptionColorsRecord } from './pdp-state'

/** 잴 옵션 수 상한 — 옵션 색 띠 칸 상한(4)과 같다. 넘으면 띠를 그리지 않으니 재지도 않는다 */
export const OPTION_COLORS_MAX = 4

export interface OptionColorDeps {
  fetchImage: (url: string) => Promise<VisionImage | null>
  measure: (ref: VisionImage | undefined) => Promise<DesigncutPhotoRecord>
}

const DEFAULT_DEPS: OptionColorDeps = { fetchImage: (url) => fetchImageAsBase64(url), measure: measureDesigncutPhoto }

export async function measureOptionColors(
  options: ReadonlyArray<{ label: string; image: string | null }>,
  deps: OptionColorDeps = DEFAULT_DEPS
): Promise<OptionColorsRecord> {
  if (options.length < 2) return { version: 1, failed: 'options_under_two' }
  if (options.length > OPTION_COLORS_MAX) return { version: 1, failed: 'options_over_max' }
  if (options.some((option) => !option.image)) return { version: 1, failed: 'option_photo_missing' }
  const colors: Array<{ label: string; image: string; hex: string }> = []
  for (const option of options) {
    const image = option.image as string
    const ref = await deps.fetchImage(image)
    if (!ref) return { version: 1, failed: 'fetch_failed' }
    const measured = await deps.measure(ref)
    if ('failed' in measured) return { version: 1, failed: `measure_${measured.failed}` }
    if (!measured.product) return { version: 1, failed: 'no_product_color' }
    colors.push({ label: option.label, image, hex: measured.product })
  }
  return { version: 1, colors }
}
