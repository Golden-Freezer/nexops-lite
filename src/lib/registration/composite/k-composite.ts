/**
 * K 라인 합성 칸 고르기(결정 카드 c18·하네스 J29, 오너 I2-4 'K 칸에 맞춰 다시 정의') — 순수 함수.
 *
 * 합성 대상은 K 계획의 칸(section_plan.templatelib.shots) 가운데 사람·손·움직임·치수가 없는 상품 단독(목적 hero)·디테일(texture)·
 * 포장 라벨(package) 칸이다. 원본 화소라 게이트를 거치지 않고(옛 합성 규칙 그대로) 칸 비율(태스크 aspectRatio)로 만든다.
 * 합성하다 실패한 칸은 지금처럼 생성한다. composite 스위치가 꺼진 잡은 부르지 않는다(이미지 단계가 먼저 거른다).
 */

import type { PdpJobRow } from '../pdp-state'
import { HANDLED, type LineShot } from '../templatelib/shot-brief'
import type { KCompositeRole } from './composite-types'

/** K 칸 목적 → 합성 역할 */
const PURPOSE_ROLE: Readonly<Record<string, KCompositeRole>> = { hero: 'k_solo', texture: 'k_detail', package: 'k_label' }

/** 합성 여부를 보는 태스크 칸 — 이미지 태스크(ImageTask)의 일부 */
export interface KCompositeTask {
  section: string
  effectOnly?: boolean
  motion?: unknown
  measuresProduct?: boolean
}

/** K 칸 하나의 합성 역할 — 사람·손 구도, 사람이 나오는 칸, 치수 칸, 움직이는 칸, 상품 없는 칸은 null */
export function kCompositeRoleOf(
  shot: Pick<LineShot, 'purpose' | 'composition' | 'person' | 'sizeCut'>,
  task: KCompositeTask
): KCompositeRole | null {
  const role = PURPOSE_ROLE[shot.purpose]
  if (!role) return null
  if (HANDLED.has(shot.composition)) return null
  if (shot.person && shot.person.framing !== 'nobody') return null
  if (shot.sizeCut || task.measuresProduct || task.motion || task.effectOnly) return null
  return role
}

/**
 * 이 잡 태스크 가운데 K 합성 칸(태스크 순서). 역할마다 첫 칸 하나만 — 원천 사진 한 장으로 같은 모양을 여러 칸에 만들면 같은 그림이 되풀이된다
 * (옛 합성의 '세 컷이 같은 그림이 되면 안 된다'와 같은 규칙, A-track-i K 계획은 디테일 칸이 4개). 나머지 칸은 지금처럼 생성한다.
 * K 계획이 없는 잡은 빈 목록
 */
export function kCompositeTargets(
  job: Pick<PdpJobRow, 'section_plan'>,
  tasks: readonly KCompositeTask[]
): Array<{ section: string; role: KCompositeRole }> {
  const shots = job.section_plan.templatelib?.shots
  if (!shots?.length) return []
  const byKey = new Map(shots.map((shot) => [shot.key, shot]))
  const taken = new Set<KCompositeRole>()
  return tasks.flatMap((task) => {
    const shot = byKey.get(task.section)
    const role = shot ? kCompositeRoleOf(shot, task) : null
    if (!role || taken.has(role)) return []
    taken.add(role)
    return [{ section: task.section, role }]
  })
}
