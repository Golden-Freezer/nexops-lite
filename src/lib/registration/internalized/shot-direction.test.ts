import { describe, expect, it } from 'vitest'
import { getDesignVocab, type DesignVocabSnapshot, type RoleVocab, type VocabShare } from '../design-vocab'
import { EFFECT_ONLY_SECTIONS } from '../pdp-image-tasks'
import {
  buildRoleShotBlock,
  MOBILE_FRAMING_PHRASE,
  SHOT_BLOCK_MAX_CHARS,
  SHOT_PRIORITY_NOTE,
  shotRoleForTask,
  type ShotContext,
} from './shot-direction'

const share = (keys: string[]): VocabShare[] => keys.map((key, i) => ({ key, share: 0.6 - i * 0.1 }))
function role(shot: Partial<Record<keyof RoleVocab['shot'], string[]>>, background: string[] = ['solid']): RoleVocab {
  return {
    sections: 100,
    prevalence: 0.5,
    positionDist: { opening: 0.2, early: 0.2, middle: 0.2, late: 0.2, closing: 0.2 },
    layout: [],
    background: share(background),
    elements: [],
    copyDevices: [],
    overlay: { imageShare: 0.5, devices: [] },
    shot: {
      angle: share(shot.angle ?? []),
      composition: share(shot.composition ?? []),
      lighting: share(shot.lighting ?? []),
      staging: share(shot.staging ?? []),
      backdrop: share(shot.backdrop ?? []),
    },
  }
}
function vocab(levers: Array<{ key: string; pro: number; template: number }> = []): DesignVocabSnapshot {
  const roles = {
    product_intro: role(
      {
        angle: ['mixed', 'angle45'],
        composition: ['center'],
        lighting: ['soft_even'],
        staging: ['props'],
        backdrop: ['light_studio'],
      },
      ['solid', 'gradient']
    ),
    usp_feature: role({
      angle: ['closeup'],
      composition: ['fill_frame'],
      lighting: ['directional'],
      staging: ['graphic_marks', 'hand_model'],
      backdrop: ['white_cutout'],
    }),
    problem: role({
      angle: ['front'],
      composition: ['thirds'],
      lighting: ['soft_even'],
      staging: ['model_wearing'],
      backdrop: ['real_space'],
    }),
    how_to_guide: role({ angle: ['top_down'], staging: ['hand_model'] }),
    target_recommendation: role({ staging: ['in_use_scene'] }),
    brand_story: role({
      angle: ['front'],
      composition: ['center'],
      lighting: ['soft_even'],
      staging: ['props'],
      backdrop: ['light_studio'],
    }),
  }
  const platform = {
    pages: 10,
    pooled: { pages: 10, sectionCountMedian: 12, roles },
    byCategory: {},
    tierLevers: levers,
  }
  return { platforms: { coupang: platform, naver: { ...platform, tierLevers: [] } } } as unknown as DesignVocabSnapshot
}
const ctx = (over: Partial<ShotContext> = {}): ShotContext => ({ category: 'household', vocab: vocab(), ...over })

describe('shotRoleForTask — 부록 D', () => {
  it('제품 컷·pro 컷은 역할로, 그래픽 컷과 표 밖 태스크는 null', () => {
    const expected: Record<string, string | null> = {
      hero: 'product_intro',
      premium_hero: 'product_intro',
      product_exposure: 'product_intro',
      direction_hint: 'product_intro',
      solution: 'product_intro',
      cta: 'product_intro',
      problem: 'problem',
      empathy_scene: 'problem',
      'features:2': 'usp_feature',
      key_benefit_visual: 'usp_feature',
      comparison_scene: 'usp_feature',
      concept_mood: 'brand_story',
      'howto:1': 'how_to_guide',
      size_comparison: 'size_spec',
      rating_bg: null,
      certification_badge: null,
      event_banner: null,
      sold_out_banner: null,
      'usp_icons:0': null,
      unknown_task: null,
    }
    for (const [task, r] of Object.entries(expected)) expect(shotRoleForTask(task), task).toBe(r)
  })

  it('usage는 G4면 target_recommendation, 그 밖은 how_to_guide', () => {
    expect(shotRoleForTask('usage', 'G4')).toBe('target_recommendation')
    expect(shotRoleForTask('usage', 'G1')).toBe('how_to_guide')
    expect(shotRoleForTask('usage')).toBe('how_to_guide')
  })
})

describe('buildRoleShotBlock', () => {
  it('역할 실측 상위 키를 고정 구절로(옮기지 않는 키는 다음 순위), 모바일 구도 구절을 항상 넣는다', () => {
    const block = buildRoleShotBlock('hero', ctx())!
    expect(block.split('\n').slice(0, 2)).toEqual(['[Shot direction — product_intro]', SHOT_PRIORITY_NOTE])
    expect(block).toContain(
      '45-degree three-quarter view, centered subject, soft even studio light, a few relevant props, light seamless studio background.'
    )
    expect(block).toContain(MOBILE_FRAMING_PHRASE)
  })

  it('문제 장면은 제품 없는 장면 연출만 — 장면형 배경 외 축(인물 중심 구도·조명은 컷 지시 소관)은 뺀다', () => {
    const block = buildRoleShotBlock('empathy_scene', ctx(), { effectOnly: true })!
    expect(block).toContain('[Shot direction — problem scene]')
    expect(block).toContain('the product does not appear')
    expect(block).toContain('real-life space background.')
    expect(block).not.toMatch(/model|front view|thirds|studio/)
  })

  it('제품이 나오지 않는 컷(effectOnly — comparison_scene)은 장면 경로: 제품 축·증거·레버 없음', () => {
    const levers = [{ key: 'framing:full_bleed', pro: 0.62, template: 0.29 }]
    const block = buildRoleShotBlock('comparison_scene', ctx({ vocab: vocab(levers), proofTypes: ['구조컷'] }), {
      effectOnly: true,
    })!
    expect(block).toContain('[Shot direction — usp_feature scene]')
    expect(block).toContain('the product does not appear')
    expect(block).not.toMatch(/Proof|Premium cue|hand|close-up|white background/)
  })

  it('차별 지시가 있는 pro 컷은 그 축을 빼고(hero 정면·중앙 반복 금지), 같은 축 레버도 붙이지 않는다', () => {
    const levers = [
      { key: 'framing:full_bleed', pro: 0.62, template: 0.29 },
      { key: 'photoType:staged', pro: 0.99, template: 0.81 },
    ]
    const c = ctx({ vocab: vocab(levers) })
    expect(buildRoleShotBlock('hero', c)).toContain('45-degree three-quarter view, centered subject')
    for (const task of ['product_exposure', 'direction_hint', 'premium_hero', 'concept_mood']) {
      const block = buildRoleShotBlock(task, c)!
      expect(block, task).toContain(SHOT_PRIORITY_NOTE)
      expect(block, task).not.toMatch(/three-quarter|centered subject|studio background|full-bleed/)
    }
    expect(buildRoleShotBlock('product_exposure', c)).toContain('soft even studio light, a few relevant props.')
    expect(buildRoleShotBlock('premium_hero', c)).not.toContain('soft even studio light') // 극적 조명은 컷 지시
  })

  it('usp 컷은 proof_plan 증거 유형을 클로즈업 지시로, 다른 역할에는 붙이지 않는다', () => {
    const proofTypes = ['구조컷', '클로즈업 접착컷', '사용컷']
    const usp = buildRoleShotBlock('features:0', ctx({ proofTypes }))!
    expect(usp).toContain('Proof: macro close-up that makes the key claim visible.')
    expect(usp).toContain('Proof: clear view of the structure.')
    expect(usp).toContain('held by an adult hand') // graphic_marks는 건너뛴다
    expect(buildRoleShotBlock('hero', ctx({ proofTypes }))).not.toContain('Proof:')
  })

  it('등급 레버는 전문 > 템플릿만, 역할 한정·style pack 가중으로 2개까지 — 그라데이션은 배경 대안으로', () => {
    const levers = [
      { key: 'framing:full_bleed', pro: 0.62, template: 0.29 },
      { key: 'photoType:staged', pro: 0.99, template: 0.81 },
      { key: 'angle:macro', pro: 0.56, template: 0.27 },
      { key: 'background:gradient', pro: 0.42, template: 0.18 },
      { key: 'staging:texture_swatch', pro: 0.3, template: 0.4 },
    ]
    const hero = buildRoleShotBlock('hero', ctx({ vocab: vocab(levers), stylePack: 'warm_story' }))!
    expect(hero).toContain('light seamless studio background or a soft gradient backdrop.')
    expect(hero.match(/Premium cue/g)).toHaveLength(2)
    expect(hero).toContain('Premium cue: edge-to-edge full-bleed framing.')
    expect(hero).toContain('Premium cue: styled, art-directed look.')
    expect(hero).not.toContain('macro') // angle:macro는 usp 컷 전용

    const usp = buildRoleShotBlock('features:0', ctx({ vocab: vocab(levers), stylePack: 'clean_proof' }))!
    expect(usp).toContain('Premium cue: add one macro detail of the key feature.')
    expect(usp).not.toContain('texture') // 템플릿이 더 많이 쓰는 레버는 쓰지 않는다
    expect(usp).not.toContain('gradient') // usp 역할 배경 분포에 그라데이션 없음
  })

  it('앵글·구도는 역할 대표 컷만 — 같은 역할의 다른 컷은 조명·연출·배경만(같은 사진 반복 방지)', () => {
    const c = ctx({ vocab: vocab([{ key: 'framing:full_bleed', pro: 0.62, template: 0.29 }]) })
    expect(buildRoleShotBlock('hero', c)).toContain('45-degree three-quarter view, centered subject')
    expect(buildRoleShotBlock('features:0', c)).toContain('close-up framing, subject filling the frame')
    for (const task of ['solution', 'cta', 'features:1', 'features:3', 'key_benefit_visual']) {
      const block = buildRoleShotBlock(task, c)!
      expect(block, task).not.toMatch(/three-quarter|centered subject|close-up framing|filling the frame|full-bleed/)
    }
    expect(buildRoleShotBlock('solution', c)).toContain(
      'soft even studio light, a few relevant props, light seamless studio background.'
    )
  })

  it('vocab에 역할 분포가 없으면 null', () => {
    expect(buildRoleShotBlock('size_comparison', ctx())).toBeNull()
    expect(buildRoleShotBlock('rating_bg', ctx())).toBeNull()
  })

  it('실제 스냅샷: 모든 태스크·카테고리에서 600자 이하, px·hex 없음, 모바일 구도 구절 포함', () => {
    const real = getDesignVocab()!
    const tasks = [
      'hero',
      'premium_hero',
      'product_exposure',
      'direction_hint',
      'solution',
      'cta',
      'problem',
      'empathy_scene',
      'usage',
      'features:0',
      'key_benefit_visual',
      'comparison_scene',
      'concept_mood',
      'howto:0',
      'size_comparison',
    ]
    let built = 0
    for (const category of ['household', 'beauty', 'fashion', 'stationery', 'food', null]) {
      for (const grammar of ['G1', 'G4'] as const) {
        for (const task of tasks) {
          const block = buildRoleShotBlock(
            task,
            {
              category,
              vocab: real,
              grammar,
              stylePack: 'premium_editorial',
              proofTypes: ['클로즈업 접착컷', '소재컷', '구조컷'],
            },
            { effectOnly: EFFECT_ONLY_SECTIONS.has(task) }
          )
          if (!block) continue
          built++
          expect(block.length, `${category}/${task}`).toBeLessThanOrEqual(SHOT_BLOCK_MAX_CHARS)
          expect(block).not.toMatch(/\d+\s*px|#[0-9a-f]{3,8}\b/i)
          expect(block).toContain(MOBILE_FRAMING_PHRASE)
        }
      }
    }
    expect(built).toBeGreaterThan(100)
  })
})

describe('R3 촬영 계획과 함께 — planAngle', () => {
  it('계획이 앵글을 정하면 역할 실측 앵글을 빼고 나머지 축은 그대로', () => {
    const plain = buildRoleShotBlock('hero', ctx())!
    expect(plain).toContain('45-degree three-quarter view')
    const planned = buildRoleShotBlock('hero', ctx(), { planAngle: true })!
    expect(planned).not.toContain('45-degree three-quarter view')
    expect(planned).toContain('centered subject')
    expect(planned).toContain(MOBILE_FRAMING_PHRASE)
  })
})
