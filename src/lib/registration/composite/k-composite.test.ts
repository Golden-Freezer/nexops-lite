/**
 * K 라인 합성 칸 고르기(결정 카드 c18·하네스 J29) — 순수 함수. 목적별 역할, 사람·손·움직임·치수·상품 없는 칸 제외, 태스크 순서.
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from '../pdp-state'
import type { LineShot } from '../templatelib/shot-brief'
import { kCompositeRoleOf, kCompositeTargets, type KCompositeTask } from './k-composite'

type Shot = Pick<LineShot, 'purpose' | 'composition' | 'person' | 'sizeCut'>
const shot = (purpose: string, extra: Partial<Shot> = {}): Shot => ({ purpose, composition: 'front', ...extra })
const task = (section: string, extra: Partial<KCompositeTask> = {}): KCompositeTask => ({ section, effectOnly: false, ...extra })

function jobWith(shots: Array<Partial<LineShot> & Pick<LineShot, 'key' | 'purpose'>> | undefined): Pick<PdpJobRow, 'section_plan'> {
  const lineShots = shots?.map((s) => ({ section: 's', composition: 'front', aspect: '1:1', show: '', ...s }))
  return { section_plan: { ...(lineShots ? { templatelib: { shots: lineShots } } : {}) } } as unknown as Pick<PdpJobRow, 'section_plan'>
}

describe('kCompositeRoleOf — K 칸 목적별 합성 역할', () => {
  it('상품 단독(hero)·디테일(texture)·포장 라벨(package)만 역할이 있다', () => {
    expect(kCompositeRoleOf(shot('hero'), task('k1'))).toBe('k_solo')
    expect(kCompositeRoleOf(shot('texture', { composition: 'closeup' }), task('k1'))).toBe('k_detail')
    expect(kCompositeRoleOf(shot('package', { composition: 'angle45' }), task('k1'))).toBe('k_label')
    for (const purpose of ['scene', 'action', 'state', 'scale', 'feature_proof', 'quantity', 'color', 'group', 'underside', 'ingredient', 'problem']) {
      expect(kCompositeRoleOf(shot(purpose), task('k1'))).toBeNull()
    }
  })

  it('손·사용·착용 구도는 목적이 맞아도 뺀다', () => {
    for (const composition of ['in_hand', 'in_use', 'worn']) {
      expect(kCompositeRoleOf(shot('hero', { composition }), task('k1'))).toBeNull()
    }
  })

  it('사람이 나오는 칸은 빼고, 사람 없음(nobody)으로 정한 칸은 남긴다', () => {
    const person = (framing: NonNullable<LineShot['person']>['framing']) => ({ framing, beat: 'during' as const, face: 'none' as const })
    expect(kCompositeRoleOf(shot('hero', { person: person('hands') }), task('k1'))).toBeNull()
    expect(kCompositeRoleOf(shot('package', { person: person('waist_up') }), task('k1'))).toBeNull()
    expect(kCompositeRoleOf(shot('hero', { person: person('nobody') }), task('k1'))).toBe('k_solo')
  })

  it('치수 칸·제품 경계를 재는 태스크·움직이는 칸·상품 없는 칸은 뺀다', () => {
    expect(kCompositeRoleOf(shot('hero', { sizeCut: true }), task('k1'))).toBeNull()
    expect(kCompositeRoleOf(shot('hero'), task('k1', { measuresProduct: true }))).toBeNull()
    expect(kCompositeRoleOf(shot('hero'), task('k1', { motion: { kind: 'turn' } }))).toBeNull()
    expect(kCompositeRoleOf(shot('texture'), task('k1', { effectOnly: true }))).toBeNull()
  })
})

describe('kCompositeTargets — 잡의 K 합성 칸', () => {
  it('태스크 순서로 K 계획의 합성 칸만 돌려준다 — 계획에 없는 태스크(대표 컷 hero)는 빠진다', () => {
    const job = jobWith([
      { key: 'k2_photo_a', purpose: 'package' },
      { key: 'k1_photo_a', purpose: 'hero' },
      { key: 'k3_photo_a', purpose: 'scene' },
      { key: 'k4_photo_a', purpose: 'texture', composition: 'closeup' },
      { key: 'k5_photo_a', purpose: 'hero', composition: 'in_hand' },
    ])
    const tasks = ['hero', 'k1_photo_a', 'k2_photo_a', 'k3_photo_a', 'k4_photo_a', 'k5_photo_a'].map((section) => task(section))
    expect(kCompositeTargets(job, tasks)).toEqual([
      { section: 'k1_photo_a', role: 'k_solo' },
      { section: 'k2_photo_a', role: 'k_label' },
      { section: 'k4_photo_a', role: 'k_detail' },
    ])
  })

  it('역할마다 첫 칸 하나만 합성한다 — 같은 역할의 뒤 칸은 생성(같은 그림 되풀이 막기)', () => {
    const job = jobWith([
      { key: 'k5_photo_0', purpose: 'texture', composition: 'closeup' },
      { key: 'k7_left_0', purpose: 'texture', composition: 'closeup' },
      { key: 'k8_photo_0', purpose: 'texture', composition: 'top' },
      { key: 'k16_photo_0', purpose: 'hero' },
      { key: 'k17_photo_0', purpose: 'hero', composition: 'angle45' },
    ])
    const tasks = ['k5_photo_0', 'k7_left_0', 'k8_photo_0', 'k16_photo_0', 'k17_photo_0'].map((section) => task(section))
    expect(kCompositeTargets(job, tasks)).toEqual([
      { section: 'k5_photo_0', role: 'k_detail' },
      { section: 'k16_photo_0', role: 'k_solo' },
    ])
    // 앞 칸이 움직이는 칸이라 빠지면 같은 역할의 다음 칸이 받는다
    const moved = [task('k5_photo_0', { motion: { kind: 'turn' } }), ...tasks.slice(1)]
    expect(kCompositeTargets(job, moved)[0]).toEqual({ section: 'k7_left_0', role: 'k_detail' })
  })

  it('태스크 쪽 표지(움직임·치수)도 본다 — 같은 칸이라도 움직이는 칸이면 빠진다', () => {
    const job = jobWith([{ key: 'k1_photo_a', purpose: 'hero' }])
    expect(kCompositeTargets(job, [task('k1_photo_a', { motion: { kind: 'turn' } })])).toEqual([])
  })

  it('K 계획이 없거나 칸이 비면(D·R 잡) 빈 목록이다', () => {
    const tasks = [task('hero'), task('premium_hero'), task('product_exposure')]
    expect(kCompositeTargets(jobWith(undefined), tasks)).toEqual([])
    expect(kCompositeTargets(jobWith([]), tasks)).toEqual([])
  })
})
