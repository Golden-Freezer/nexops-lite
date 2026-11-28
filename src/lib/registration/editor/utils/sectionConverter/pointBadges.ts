// sectionConverter/pointBadges.ts — 핵심 포인트 번호 원을 제목 첫 줄에 붙인다 (2026-10-30 오너 지시)
//
// 번호 원(64)을 제목 상자 위쪽에 맞추면, h2 행간 1.8(줄 상자 108)에서 원이 글자보다 약 26px 떠 번호와 제목이 따로 보였다.
// 체크 목록(point_list_div)처럼 원의 중심을 제목 '첫 줄' 중심에 맞춘다. 숫자 글자는 원과 같이 움직인다.

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ProSectionType } from '@/lib/registration/editor/types/section'

/** 제목 첫 줄 중심에 원의 중심이 오는 원의 y — 줄 상자 = 글자 크기 × 행간 */
export function pointBadgeY(title: CanvasElement, badgeSize: number): number {
  const props = title.textProps
  if (!props) return title.transform.y
  const lineBox = props.fontSize * (props.lineHeight || 1.5)
  return Math.round(title.transform.y + (lineBox - badgeSize) / 2)
}

/**
 * 테마·모바일 하한이 제목 크기·행간을 바꾼 뒤 번호 원(point_badge_i)과 숫자(point_num_i)를 제목(point_i_title) 첫 줄에 다시 맞춘다.
 * 이미 맞으면 섹션을 그대로 돌려준다.
 */
export function alignPointBadges(sections: CanvasSection[]): CanvasSection[] {
  return sections.map((section) => {
    if (section.sectionType !== ProSectionType.POINT_DIV) return section
    const byName = new Map(section.elements.map((el) => [el.name, el]))
    let changed = false
    const elements = section.elements.map((el) => {
      const index = /^point_(?:badge|num)_(\d+)$/.exec(el.name)?.[1]
      const badge = index === undefined ? undefined : byName.get(`point_badge_${index}`)
      const title = index === undefined ? undefined : byName.get(`point_${index}_title`)
      if (!badge || !title) return el
      const delta = pointBadgeY(title, badge.transform.height) - badge.transform.y
      if (delta === 0) return el
      changed = true
      const y = el.transform.y + delta
      // 원 중심(cy)은 새 위치에서 다시 잰다 — 모바일 하한 여백 줄이기처럼 cy를 고치지 않고 옮긴 경우가 있다
      return {
        ...el,
        transform: { ...el.transform, y },
        ...(el.shapeProps?.cy !== undefined
          ? { shapeProps: { ...el.shapeProps, cy: y + el.transform.height / 2 } }
          : {}),
      }
    })
    return changed ? { ...section, elements } : section
  })
}
