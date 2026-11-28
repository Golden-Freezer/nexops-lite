/**
 * K 대표 컷·움직이는 칸 참조 안내(점검 고침 2) — 글과 붙는 컷. K 라인 잡의 hero·motion 태스크만, 스타일 참조가 없을 때만.
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from './pdp-state'
import { productRefRolesCut, productRefRolesText } from './pdp-image-stage'

const jobOf = (features: string[], templatelib = true) =>
  ({ analysis: { enrichment: { version: 1, features } }, section_plan: templatelib ? { templatelib: {} } : {} }) as unknown as PdpJobRow
const K = jobOf(['designcut', 'templatelib'])
const motion = { action: 'a', mode: 'gif' as const, loop: 'back_and_forth' as const, optionPhotos: [] }

describe('productRefRolesText', () => {
  it('첫 사진이 구조 정본이고 Refs 줄에 사진 수(대표 칸은 맨 끝 대표 컷)', () => {
    expect(productRefRolesText(1)).toContain('Refs: photo 1 = structure master.')
    expect(productRefRolesText(3)).toContain('Refs: photo 1 = structure master; photos 2-3 = the same product from other angles or options.')
    expect(productRefRolesText(2, true)).toMatch(/; LAST image = this page hero cut \(frame 1\)\.$/)
    expect(productRefRolesText(0)).toContain('Refs: photo 1 = structure master.')
  })
})

describe('productRefRolesCut', () => {
  it('K 라인 잡의 대표 컷·움직이는 칸만 — 스타일 참조를 붙였거나 상품 없는 컷·다른 컷·K 아닌 잡은 아니다(바이트 그대로)', () => {
    expect(productRefRolesCut(K, { section: 'hero', effectOnly: false }, false)).toBe(true)
    expect(productRefRolesCut(K, { section: 'k3_a', effectOnly: false, motion }, false)).toBe(true)
    expect(productRefRolesCut(K, { section: 'hero_motion', effectOnly: false, motion: { ...motion, role: 'hero' } }, false)).toBe(true)
    expect(productRefRolesCut(K, { section: 'k3_a', effectOnly: false }, false)).toBe(false)
    expect(productRefRolesCut(K, { section: 'hero', effectOnly: false }, true)).toBe(false)
    expect(productRefRolesCut(K, { section: 'hero', effectOnly: true }, false)).toBe(false)
    expect(productRefRolesCut(jobOf(['designcut']), { section: 'hero', effectOnly: false }, false)).toBe(false)
    expect(productRefRolesCut(jobOf(['designcut', 'templatelib'], false), { section: 'hero', effectOnly: false }, false)).toBe(false)
  })
})
