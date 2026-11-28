// 등록용 옵션 내보내기 (05_OPTIONS.md §5, T6a)
// 완료된 잡의 optionSpec → 등록 담당(사람 또는 이후 자동화)이 그대로 쓰는 옵션 JSON.
// 가격·재고·바코드는 넣지 않는다(등록 시점의 원천 값). 모든 옵션이 같은 상세페이지를 쓴다.

import type { OptionSpec } from './option-spec'

export interface RegistrationOptionExport {
  /** 쿠팡 옵션명 축(예: 수량, 디자인) */
  axes: Array<{ name: string; values: string[] }>
  items: Array<{
    /** 등록 옵션명 그대로 */
    itemName: string
    attributes: Record<string, string>
    representationImage?: string
    detailShared: true
  }>
}

export interface RegistrationOptionExportOptions {
  /** label → 대표 이미지 경로(대표이미지 잡 결과 등). 없으면 variant.sourceImage */
  representationImages?: Readonly<Record<string, string>>
}

export function buildRegistrationOptionExport(
  spec: OptionSpec,
  options: RegistrationOptionExportOptions = {},
): RegistrationOptionExport {
  const axes = spec.axes.map((axis) => ({ name: axis.name, values: [...axis.values] }))
  const items = spec.variants.map((variant) => {
    const attributes: Record<string, string> = {}
    for (const axis of spec.axes) {
      const value = variant.values[axis.kind]
      if (value !== undefined) attributes[axis.name] = value
    }
    const image = options.representationImages?.[variant.label] || variant.sourceImage
    return {
      itemName: variant.label,
      attributes,
      ...(image ? { representationImage: image } : {}),
      detailShared: true as const,
    }
  })
  return { axes, items }
}
