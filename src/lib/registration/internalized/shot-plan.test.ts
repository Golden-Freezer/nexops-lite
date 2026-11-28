/**
 * R3 촬영 계획(PDP-DR-PLAN §3) — 역할 의도·금지, 페이지 거리·앵글 계획, 잡 단위 출연. 순수 함수만(LLM·DB 없음).
 */

import { describe, expect, it } from 'vitest'
import { buildStyleCharter } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  ANGLE_PHRASE,
  buildShotCast,
  buildShotPlanBlock,
  describeShotCast,
  DISTANCE_PHRASE,
  orderByPage,
  planPageShots,
  ROLE_AVOID,
  ROLE_INTENT,
  SHOT_PLAN_BLOCK_MAX_CHARS,
  SHOT_PLAN_PRIORITY,
  type CastInput,
  type PlannedShot,
} from './shot-plan'

describe('역할 의도·금지 한 줄', () => {
  it('같은 역할에 둘 다 있고 각 120자 이하', () => {
    expect(Object.keys(ROLE_INTENT).sort()).toEqual(Object.keys(ROLE_AVOID).sort())
    for (const line of [...Object.values(ROLE_INTENT), ...Object.values(ROLE_AVOID)]) {
      expect(line!.length, line).toBeLessThanOrEqual(120)
    }
  })

  it('크기 컷은 손·비교 소품 없이(개정 5) — 손·물건 옆에 두라거나 숫자를 막지 않는다', () => {
    expect(ROLE_INTENT.size_spec).not.toMatch(/hand|familiar object/i)
    expect(ROLE_AVOID.size_spec).not.toMatch(/number|ruler/i)
  })
})

describe('페이지 거리·앵글 계획', () => {
  const ORDER = ['hook_3step', 'problem_raise', 'point_div', 'sub2_div_page', 'hidden_page', 'compare_div', 'cta']
  const SECTIONS = ['hero', 'problem', 'solution', 'usage', 'cta', 'features:1', 'features:0', 'howto:1', 'howto:0', 'size_comparison', 'usp_icons:0', 'plate:T3c']

  it('컷을 섹션 순서로 — 같은 섹션의 컷은 번호 순, 페이지에 자리가 없는 컷은 맨 뒤 원래 순서', () => {
    expect(orderByPage(SECTIONS, ORDER)).toEqual([
      'hero',
      'problem',
      'features:0',
      'features:1',
      'usage',
      'howto:0',
      'howto:1',
      'size_comparison',
      'cta',
      'solution',
      'usp_icons:0',
      'plate:T3c',
    ])
  })

  it('첫 화면 중간 → 문제 넓게 → 피처 근접·매크로 교대 → 사용 넓게 → 마무리 중간', () => {
    const plan = planPageShots(['hero', 'problem', 'features:0', 'features:1', 'usage', 'cta'])
    expect(['hero', 'problem', 'features:0', 'features:1', 'usage', 'cta'].map((s) => plan.get(s)?.distance)).toEqual([
      'medium',
      'wide',
      'close',
      'macro',
      'wide',
      'medium',
    ])
  })

  it('같은 거리·앵글이 이어지지 않는다 — 사용법(중간) 바로 다음 마무리는 중간-넓게, 축을 못 박는 컷·그래픽은 계획 밖', () => {
    const pair = planPageShots(['howto:0', 'cta'])
    expect([pair.get('howto:0')?.distance, pair.get('cta')?.distance]).toEqual(['medium', 'medium_wide'])
    const ordered = orderByPage(SECTIONS, ORDER)
    const plan = planPageShots(ordered)
    // 사용법 0(중간) → 1(근접) → 크기(계획 밖) → 마무리(중간)
    expect(['howto:0', 'howto:1', 'cta'].map((s) => plan.get(s)?.distance)).toEqual(['medium', 'close', 'medium'])
    for (const section of ['size_comparison', 'usp_icons:0', 'plate:T3c']) expect(plan.has(section), section).toBe(false)
    const outside = planPageShots(['premium_hero', 'product_exposure', 'direction_hint', 'concept_mood'])
    expect(outside.size).toBe(0)
    const shots = ordered.map((s) => plan.get(s)).filter((s): s is PlannedShot => Boolean(s))
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].distance, `${i}`).not.toBe(shots[i - 1].distance)
      expect(shots[i].angle, `${i}`).not.toBe(shots[i - 1].angle)
    }
  })

  it('계획 블록 — 우선순위 한 줄·역할 의도·금지·거리·앵글, D2 상품 컷은 거리를 뺀다, 모든 조합이 600자 이하', () => {
    const shot: PlannedShot = { distance: 'close', angle: 'top_down' }
    const block = buildShotPlanBlock('usp_feature', shot)!
    expect(block.split('\n').slice(0, 2)).toEqual(['[Page shot plan]', SHOT_PLAN_PRIORITY])
    expect(block).toContain(`Intent: ${ROLE_INTENT.usp_feature}`)
    expect(block).toContain(`Avoid: ${ROLE_AVOID.usp_feature}`)
    expect(block).toContain(`Distance: ${DISTANCE_PHRASE.close}.`)
    expect(block).toContain(`Angle: ${ANGLE_PHRASE.top_down}.`)
    const d2 = buildShotPlanBlock('usp_feature', shot, { omitDistance: true })!
    expect(d2).not.toContain('Distance:')
    expect(d2).toContain('Angle:')
    expect(buildShotPlanBlock(null, undefined)).toBeNull()
    for (const role of Object.keys(ROLE_INTENT) as Array<keyof typeof ROLE_INTENT>) {
      for (const distance of Object.keys(DISTANCE_PHRASE) as PlannedShot['distance'][]) {
        for (const angle of Object.keys(ANGLE_PHRASE) as PlannedShot['angle'][]) {
          expect(buildShotPlanBlock(role, { distance, angle })!.length).toBeLessThanOrEqual(SHOT_PLAN_BLOCK_MAX_CHARS)
        }
      }
    }
  })

  it('상품 없는 장면 컷(비교 장면)은 상품 역할의 의도·금지를 받지 않는다 — 문제 장면은 받는다', () => {
    const shot: PlannedShot = { distance: 'medium', angle: 'eye_level' }
    const comparison = buildShotPlanBlock('usp_feature', shot, { effectOnly: true })!
    expect(comparison).not.toContain('Intent:')
    expect(comparison).toContain('Angle:')
    expect(buildShotPlanBlock('problem', shot, { effectOnly: true })).toContain(`Intent: ${ROLE_INTENT.problem}`)
  })
})

describe('잡 단위 출연(인물·옷 톤·반려동물·소품)', () => {
  const base: CastInput = { category: 'household', productText: '접이식 수납 정리함', targetText: '', parentProxy: false, seed: 'job-1' }
  const person = (who: string, pronoun: string, decade: number) =>
    `one adult ${who} in ${pronoun} ${decade}0s — the same person in every cut that shows a person (hands-only cuts show ${pronoun} hands)`

  it('한 사람으로 고정 — 타깃 서술의 성별·나이대, 모르면 30대 여성, 학부모 대리 구매형은 어른 손만·아이 없음', () => {
    expect(buildShotCast({ ...base, targetText: '30대 여성 직장인' }).people).toBe(person('woman', 'her', 3))
    expect(buildShotCast({ ...base, targetText: '40대 남성 캠퍼' }).people).toBe(person('man', 'his', 4))
    expect(buildShotCast(base).people).toBe(person('woman', 'her', 3))
    expect(buildShotCast({ ...base, targetText: '30대 여성', parentProxy: true }).people).toBe(
      'adult hands only — no faces, and no children anywhere'
    )
  })

  it('성별 — 상품명(남성용·여성용)이 타깃 서술보다 앞서고, 여자친구·남자친구는 성별로 읽지 않는다', () => {
    expect(buildShotCast({ ...base, category: 'fashion', productText: '남성용 경량 패딩', targetText: '20대 여성' }).people).toBe(
      person('man', 'his', 2)
    )
    expect(buildShotCast({ ...base, targetText: '여자친구 선물을 고르는 20대 남성' }).people).toBe(person('man', 'his', 2))
    expect(buildShotCast({ ...base, targetText: '남성·여성 모두' }).people).toBe(person('woman', 'her', 3))
  })

  it('반려동물은 pet 카테고리에서만 — 상품 대상과 같은 종 하나(색은 잡마다 고정), 대형견용은 큰 개', () => {
    const pet = { ...base, category: 'pet' }
    const dog = buildShotCast({ ...pet, productText: '강아지 산책 하네스' }).pets
    expect(dog).toMatch(/^one (cream-colored|light brown|white) small dog — the same animal in every cut; no other animals$/)
    expect(buildShotCast({ ...pet, productText: '강아지 산책 하네스' }).pets).toBe(dog)
    expect(buildShotCast({ ...pet, productText: '대형견용 하네스' }).pets).toMatch(/ large dog — /)
    expect(buildShotCast({ ...pet, productText: '고양이 스크래쳐' }).pets).toMatch(/ cat — /)
    expect(buildShotCast({ ...pet, productText: '햄스터 집' }).pets).toMatch(/^only the kind of animal this product is for/)
    // pet 밖 카테고리는 동물 없음 — 강아지 인형·핫도그·캣아이 선글라스에 동물을 부르지 않는다
    for (const productText of ['강아지 인형', '핫도그 메이커', '캣아이 선글라스']) {
      expect(buildShotCast({ ...base, productText }).pets, productText).toBe('no pets or animals')
    }
  })

  it('옷은 상품이 아닌 옷만 밝은 뉴트럴 하나(잡마다 고정), 소품은 세트 기술 + 컷 지시가 부르는 것만 — 결정론', () => {
    const cast = buildShotCast(base)
    expect(cast.clothing).toMatch(/^clothing other than the product in plain solid (off-white|oatmeal beige|light grey|soft taupe)/)
    expect(cast.props).toContain('the props named in "Set description" plus only what a cut\'s instructions name')
    expect(cast.props).toContain('unless they are the product itself')
    expect(buildShotCast(base)).toEqual(cast)
    const line = describeShotCast(cast)
    for (const part of ['people: ', 'clothing: ', 'pets: ', 'props: ']) expect(line).toContain(part)
  })

  it('헌장 출연 줄은 castDesc가 있을 때만 — 없으면 헌장이 예전과 한 글자도 같다', () => {
    const args = {
      bgHex: '#ffffff',
      colorTemp: 'Neutral 5000K',
      direction: 'top-left',
      shadowAngle: 45,
      propColors: '#c2410c',
      mood: 'clean',
      setDesc: 'one continuous set',
    }
    const before = buildStyleCharter(args)
    expect(before).not.toContain('- Cast (')
    const cast = describeShotCast(buildShotCast(base))
    const line = `- Cast (identical in every cut that shows people, hands or animals): ${cast}\n`
    const after = buildStyleCharter({ ...args, castDesc: cast })
    expect(after).toContain(line)
    expect(after.replace(line, '')).toBe(before)
  })
})
