// 안 쓰는 컷 생성 전 빼기(W5, ENRICHMENT `lean`, 통합 승인 2026-10-30) — 섹션 골격(section_plan.section_order)이 쓸 이미지 키만 만든다.
//
// 골격은 design 단계에서 images 단계보다 먼저 정해진다. 디자인 컷 잡의 designcutTaskFilter와 같은 매핑(legacyImageTasks —
// SECTION_IMAGE_MAPPING + 빌더가 읽는 키)을 일반 기록 잡에 쓴다. 다음은 늘 남긴다:
// - hero: 다른 컷의 스타일 참조
// - dedupe 여분 풀: sub_div·point_list_div가 있으면 그 섹션이 남는 컷에서 고르는 키 전체(dedupe.ts SUB_PREFS·LIST_PREFS)
// - 특징·사용 단계 컷(features:*·howto:*): point_div·sub_div·hidden_page가 있으면 매핑으로 남는다(W4-S 펼침도 같은 키)
// 모르는 섹션 키가 하나라도 있으면 null — 거르지 않는다(designcut과 같은 안전장치).

import { ProSectionType as S } from '../editor/types/section'
import { SPARE_IMAGE_PREFS } from '../editor/utils/sectionConverter/dedupe'
import { legacyImageTasks } from './designcut-images'

/** 편집기 생성 이미지 맵 키 → 이미지 태스크 키(목록 키는 접두어 전체) */
const MAP_KEY_TO_TASK: Record<string, string> = { features: 'features:*', howToImages: 'howto:*' }
/** 남는 컷에서 사진을 고르는 섹션(dedupe planImages) */
const SPARE_CONSUMERS = new Set<string>([S.SUB_DIV, S.POINT_LIST_DIV])

/** 골격 → 만들 태스크 판정. 모르는 섹션 키가 있으면 null(거르지 않는다) */
export function sectionTaskFilter(order: readonly string[]): ((section: string) => boolean) | null {
  if (order.length === 0) return null
  const exact = new Set<string>(['hero'])
  const prefixes = new Set<string>()
  const add = (key: string) => (key.endsWith(':*') ? prefixes.add(key.slice(0, -2)) : exact.add(key))
  for (const key of order) {
    const legacy = legacyImageTasks(key)
    if (!legacy) return null
    legacy.forEach(add)
  }
  if (order.some((key) => SPARE_CONSUMERS.has(key))) {
    for (const key of SPARE_IMAGE_PREFS) add(MAP_KEY_TO_TASK[key] ?? key)
  }
  return (section) => exact.has(section) || prefixes.has(section.split(':')[0])
}
