/**
 * 후킹·히어로 개편(적용 K13, 오너 11-04 18:11 권장안 ①~④) — 첫 화면은 제목 + 풀폭 사진 한 장, 가장 큰 사진 0.55 이상, 후킹·히어로는 다른 컷, 카테고리 칸은 같은 이름에 모양만 교체. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { HOOK_BEATS_PHOTO_SHARE_MIN, isHookBeats } from './hook-beats'
import { TEMPLATE_ALIASES, TEMPLATES, templateById } from './library'
import { firstScreenPhotoShare, HOOK_PHOTO_SHARE_MIN } from './lint'
import { screenKey, skeletonKey } from './lint-category'
import { sampleContext, sampleSlots } from './sample'
import { HERO_LARGE_BRIEF } from './shot-brief'
import type { FlowNode, Template } from './template-types'

/**
 * 안 B 표지 템플릿(hookbeats 스위치 잡만, J24)은 첫 화면 기본형의 예외다 — 오너 11-07 승인 카드 원문(1:1 대표·보조 둘·여백 80/40)을 확인 판(J32)에서
 * 그대로 재려고 lint 예외 3건을 그 표지에만 둔다(통합 11-10). 사진 하한은 아래 ②의 0.45 줄과 hook-beats.test가 본다
 */
const beatsHooks = TEMPLATES.filter((t) => t.section === 'hook_3step' && isHookBeats(t))
const hooks = TEMPLATES.filter((t) => t.section === 'hook_3step' && !isHookBeats(t))
const heroes = TEMPLATES.filter((t) => t.section === 'main_cut')

const imagesIn = (nodes: readonly FlowNode[]): Array<Extract<FlowNode, { kind: 'image' }>> =>
  nodes.flatMap((node) => {
    if (node.kind === 'image') return [node]
    if (node.kind === 'row') return node.columns.flatMap((column) => imagesIn(column.nodes))
    if (node.kind === 'repeat' || node.kind === 'panel') return imagesIn(node.nodes)
    return []
  })
const shareOf = (t: Template, aspectOf?: () => number) => {
  const out = renderTemplate(t, sampleSlots(t, { mode: 'full' }), sampleContext(aspectOf ? { aspectOf } : {}))
  expect(out, t.id).not.toBeNull()
  return firstScreenPhotoShare(out!.elements)
}

describe('① 첫 화면 기본형 — 제목 1~2줄 + 풀폭 사진 한 장', () => {
  it('후킹 칸은 사진 칸 하나이고 풀폭이다 — 나란히 두는 꼴이 없다', () => {
    expect(hooks.length).toBeGreaterThan(0)
    for (const t of hooks) {
      const images = imagesIn(t.flow)
      expect(images, t.id).toHaveLength(1)
      expect(images[0].bleed, t.id).toBe(true)
      expect(t.flow.some((node) => node.kind === 'row' || node.kind === 'repeat'), t.id).toBe(false)
    }
  })

  it('후킹 사진 칸은 세로 비율만 받는다 — 가로 사진이면 0.55를 못 넘는다', () => {
    for (const t of hooks) {
      const def = t.slots[imagesIn(t.flow)[0].slot]
      expect(def.type, t.id).toBe('image')
      if (def.type === 'image') expect(def.aspect.every((aspect) => aspect === '3:4' || aspect === '2:3'), `${t.id} ${def.aspect.join()}`).toBe(true)
    }
  })
})

describe('② 기준값 — 첫 화면 가장 큰 사진 넓이 0.55 이상', () => {
  it('전 후킹 칸이 표본 글과 가장 넓은 사진 비율에서 넘는다', () => {
    for (const t of hooks) {
      expect(shareOf(t), t.id).toBeGreaterThanOrEqual(HOOK_PHOTO_SHARE_MIN)
      expect(shareOf(t, () => 100), t.id).toBeGreaterThanOrEqual(HOOK_PHOTO_SHARE_MIN)
    }
  })

  it('안 B 표지 칸만 하한 0.45 — 풀폭 1:1 대표(0.462)라 0.55에는 못 미친다(오너 11-04 0.55의 예외, 표지 템플릿만)', () => {
    expect(beatsHooks.map((t) => t.id)).toEqual(['hook_3step.garden-beats'])
    for (const t of beatsHooks) {
      expect(shareOf(t), t.id).toBeGreaterThanOrEqual(HOOK_BEATS_PHOTO_SHARE_MIN)
      expect(shareOf(t), t.id).toBeLessThan(HOOK_PHOTO_SHARE_MIN)
    }
  })

  it('계산 — 화면 밖은 빼고 가장 큰 한 장만 잰다. 풀폭 3:4는 넘고 여백 둔 사진은 안 넘는다', () => {
    const photo = (x: number, y: number, width: number, height: number) => ({ type: 'framed-image', transform: { x, y, width, height } })
    expect(firstScreenPhotoShare([photo(0, 478, 860, 1147)])).toBeCloseTo(1147 / 1860, 3)
    expect(firstScreenPhotoShare([photo(60, 478, 740, 987)])).toBeLessThan(HOOK_PHOTO_SHARE_MIN)
    expect(firstScreenPhotoShare([photo(0, 1860, 860, 1147)])).toBe(0)
    expect(firstScreenPhotoShare([photo(0, 1000, 860, 1147), { type: 'text', transform: { x: 0, y: 0, width: 860, height: 1860 } }])).toBeCloseTo(860 / 1860, 3)
    expect(firstScreenPhotoShare([])).toBe(0)
  })
})

describe('③ 후킹·히어로 두 칸, 다른 컷', () => {
  const firstImage = (t: Template) => imagesIn(t.flow)[0]

  it('히어로 칸은 사진을 앞세운다 — 풀폭 사진이나 판 위 큰 사진이 있고 첫 화면에 크게 든다', () => {
    for (const t of heroes) {
      const big = imagesIn(t.flow).some((image) => image.bleed || (image.plate && (image.w ?? 0) >= 680))
      expect(big, t.id).toBe(true)
      expect(shareOf(t), t.id).toBeGreaterThan(0.3)
    }
  })

  it('히어로 첫 사진은 대표 컷을 먼저 받지 않는다 — 대표 컷은 후킹 몫이고 히어로는 쓰는 장면·구성이다', () => {
    for (const t of heroes) {
      const def = t.slots[firstImage(t).slot]
      if (def.type === 'image') expect(def.purpose[0], t.id).not.toBe('hero')
    }
  })

  it('사진 위 글 없는 대표 컷 지시는 제품을 가장 크게 둔다', () => {
    expect(HERO_LARGE_BRIEF).toContain('largest subject')
    expect(HERO_LARGE_BRIEF).toContain('at least half of the frame')
  })
})

describe('④ 카테고리 칸 — 같은 이름에 모양만 교체, 후킹만 복제 검사 예외', () => {
  it('카테고리 후킹 칸이 그대로 있고 풀폭 사진 꼴이다 — 공용과 같은 뼈대여도 통과한다', () => {
    const category = hooks.filter((t) => (t.fit.categories?.length ?? 0) > 0)
    // 16 = K13의 15 + 정원 전용 둘째 첫 화면(하네스 R12b, hook_3step.garden-hand-first-center-sub)
    expect(category).toHaveLength(16)
    const common = hooks.filter((t) => !t.fit.categories?.length)
    const skeletons = new Set(common.map((t) => skeletonKey(t.flow)))
    expect(category.some((t) => skeletons.has(skeletonKey(t.flow)))).toBe(true)
    const screens = new Set(common.map((t) => screenKey(t.flow, t.slots)))
    expect(category.some((t) => screens.has(screenKey(t.flow, t.slots)))).toBe(true)
  })

  it('뺀 칸의 옛 id는 옛 계획이 그대로 쓰도록 같은 섹션 칸으로 풀린다', () => {
    for (const id of ['hook_3step.two-photos', 'hook_3step.pair-center', 'hook_3step.three-colors', 'hook_3step.plate-center', 'main_cut.band-side', 'main_cut.side-note', 'main_cut.parts-grid']) {
      expect(TEMPLATE_ALIASES.has(id), id).toBe(true)
      expect(TEMPLATES.some((t) => t.id === id), id).toBe(false)
      expect(templateById(id)?.section, id).toBe(id.split('.')[0])
    }
  })
})
