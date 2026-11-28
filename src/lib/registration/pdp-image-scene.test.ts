import { describe, expect, it } from 'vitest'
import { buildFeaturePrompt, buildStyleCharter } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  applyD2SceneCut,
  applySceneCut,
  designcutStageOf,
  D2_PRODUCT_SCENE_LINE,
  D2_SCENE_HEADER,
  D2_SHOT_DISTANCE,
  d2PointChapterOf,
  d2ShotDistanceOf,
  isSceneCut,
  SCENE_BACKGROUND_LINE,
} from './pdp-image-scene'
import { EFFECT_ONLY_SECTIONS, GATE_SKIP_SECTIONS } from './pdp-image-tasks'
import { canonLight } from './pdp-image-light'
import { tidyImageBrief } from './pdp-image-brief'
import type { DesigncutPlan } from './pdp-state'

const CHARTER = buildStyleCharter({
  bgHex: '#fff7f0',
  colorTemp: 'Warm-neutral 5000K',
  direction: 'top-left',
  shadowAngle: 45,
  propColors: '#c2410c',
  mood: 'cozy',
  setDesc: 'one continuous set',
})

describe('applySceneCut — 장면 컷은 세트 안, 바탕은 헌장 한 곳', () => {
  it('장면 컷은 헌장의 단색 바탕 줄을 세트 안내로 바꾸고, 상품 컷은 그대로', () => {
    expect(CHARTER).toContain('- Background: solid #fff7f0')
    for (const section of ['problem', 'solution', 'usage', 'howto:0', 'empathy_scene', 'concept_mood', 'comparison_scene']) {
      const out = applySceneCut(CHARTER, section)
      expect(out, section).toContain(SCENE_BACKGROUND_LINE)
      expect(out, section).not.toContain('- Background: solid')
    }
    for (const section of ['hero', 'features:0', 'cta', 'size_comparison', 'detail', 'option_bundle']) {
      expect(applySceneCut(CHARTER, section), section).toBe(CHARTER)
    }
  })

  it('피처 컷의 bgSub 바탕 줄은 빼고 헌장 바탕(bgMain)만 남긴다', () => {
    const feature = buildFeaturePrompt({ featureTitle: '미끄럼 방지', featureDescription: '미끄럼 방지 받침', bgSub: '#f4ece4' }).prompt
    expect(feature).toContain('- Background: Match design palette #f4ece4')
    const out = applySceneCut([feature, CHARTER].join('\n\n'), 'features:0')
    expect(out).not.toContain('Match design palette')
    expect(out).toContain('- Background: solid #fff7f0')
    // 나머지 줄은 그대로(바탕 줄 한 줄만 빠진다)
    expect(out.split('\n').length).toBe([feature, CHARTER].join('\n\n').split('\n').length - 1)
  })

  it('장면 컷 판정 — 상품 없는 효과 전용 컷 가운데 그래픽(배지·배너·평점 바탕)·아이콘은 장면이 아니다', () => {
    for (const section of GATE_SKIP_SECTIONS) expect(isSceneCut(section), section).toBe(false)
    expect(isSceneCut('usp_icons:0')).toBe(false)
    const photoScenes = [...EFFECT_ONLY_SECTIONS].filter((s) => !GATE_SKIP_SECTIONS.has(s))
    expect(photoScenes.length).toBeGreaterThan(0)
    for (const section of photoScenes) expect(isSceneCut(section), section).toBe(true)
  })
})

describe('applyD2SceneCut — D2 상품 컷도 세트 안 장면 + 역할별 거리(C2)', () => {
  it('첫 화면·POINT·마무리는 헌장 단색 바탕을 세트로 바꾸고 덮어쓰기 블록·거리를 붙인다', () => {
    for (const section of ['hero', 'features:0', 'features:5', 'cta']) {
      const out = applyD2SceneCut(CHARTER, section)
      expect(out, section).toContain(D2_PRODUCT_SCENE_LINE)
      expect(out, section).not.toContain('- Background: solid')
      expect(out, section).toContain(D2_SCENE_HEADER)
      expect(out, section).toContain(`Shot distance: ${d2ShotDistanceOf(section)}.`)
    }
  })

  it('거리 — 첫 화면 중간, POINT 근접·매크로 교대(피처 번호 = D2 POINT 순서), 마무리 중간~넓게', () => {
    expect(d2ShotDistanceOf('hero')).toBe(D2_SHOT_DISTANCE.hero)
    expect([0, 1, 2, 3, 4, 5].map((i) => d2ShotDistanceOf(`features:${i}`))).toEqual([
      D2_SHOT_DISTANCE.close,
      D2_SHOT_DISTANCE.macro,
      D2_SHOT_DISTANCE.close,
      D2_SHOT_DISTANCE.macro,
      D2_SHOT_DISTANCE.close,
      D2_SHOT_DISTANCE.macro,
    ])
    expect(d2ShotDistanceOf('cta')).toBe(D2_SHOT_DISTANCE.cta)
    for (const section of ['problem', 'detail', 'size_comparison', 'howto:0', 'usp_icons:0', 'plate:T3c']) {
      expect(d2ShotDistanceOf(section), section).toBeNull()
    }
  })

  it('계획의 장 번호가 있으면 장 순서로 번갈아 준다 — sub_div가 앞이고 새 특징이 홀수 개면 피처 번호로는 같은 거리가 붙는다', () => {
    // sub_div:4가 POINT 01, point_div:0~3이 02~05인 계획
    const order = [4, 0, 1, 2, 3]
    const plan = {
      sections: order.map((i, n) => ({ role: 'usp_feature', productImageKey: `features:${i}`, chapter: n + 1 })),
    } as unknown as DesigncutPlan
    const chapters = order.map((i) => d2PointChapterOf(plan, `features:${i}`))
    expect(chapters).toEqual([1, 2, 3, 4, 5])
    const { close, macro } = D2_SHOT_DISTANCE
    expect(order.map((i, n) => d2ShotDistanceOf(`features:${i}`, chapters[n]))).toEqual([close, macro, close, macro, close])
    // 피처 번호만 보면 features:4 → features:0이 둘 다 근접이다
    expect(order.map((i) => d2ShotDistanceOf(`features:${i}`))).toEqual([close, close, macro, close, macro])
    expect(d2PointChapterOf(plan, 'hero')).toBeNull()
    expect(d2PointChapterOf(null, 'features:0')).toBeNull()
  })

  it('덮어쓰기 블록은 소품 금지·단독 피사체·채움 비율·거리 기본값까지 덮는다고 적는다', () => {
    const out = applyD2SceneCut(CHARTER, 'hero')
    for (const phrase of ['"no props"', '"sole object"', '"product alone"', 'frame-fill share', 'shot distance', 'gradient']) {
      expect(out, phrase).toContain(phrase)
    }
  })

  it('장면 컷은 R2와 같고, 그 밖의 상품 컷(디테일·크기·옵션)은 단색 바탕 그대로', () => {
    for (const section of ['problem', 'solution', 'usage', 'howto:0']) {
      expect(applyD2SceneCut(CHARTER, section), section).toBe(applySceneCut(CHARTER, section))
    }
    for (const section of ['detail', 'size_comparison', 'option_bundle']) {
      expect(applyD2SceneCut(CHARTER, section), section).toBe(CHARTER)
    }
  })

  it('피처 컷의 bgSub 바탕 줄도 빠지고, 빛 정본(R1)·브리프 정리를 거쳐도 세트 줄·블록·거리가 남는다', () => {
    const feature = buildFeaturePrompt({ featureTitle: '미끄럼 방지', featureDescription: '미끄럼 방지 받침', bgSub: '#f4ece4' }).prompt
    const out = applyD2SceneCut([feature, CHARTER].join('\n\n'), 'features:1')
    expect(out).not.toContain('Match design palette')
    const tidied = tidyImageBrief(canonLight(out).prompt, { sizeHonored: true }).prompt
    expect(tidied).toContain(D2_PRODUCT_SCENE_LINE)
    expect(tidied).toContain(D2_SCENE_HEADER)
    expect(tidied).toContain(`Shot distance: ${D2_SHOT_DISTANCE.macro}.`)
  })
})

describe('designcutStageOf — 디자인 컷 컷의 무대 이름(적용 D4 ⓐ, 기록만)', () => {
  const d2 = { d2: true, scene: false }
  it('D2: 첫 화면·마무리·근접 POINT는 세트 안(life), 매크로 POINT는 macro, 장면 컷은 세트 안, 그 밖 상품 컷은 단색(solid)', () => {
    expect(designcutStageOf('hero', d2)).toBe('life')
    expect(designcutStageOf('cta', d2)).toBe('life')
    expect(designcutStageOf('features:0', d2)).toBe('life')
    expect(designcutStageOf('features:1', d2)).toBe('macro')
    // 장 번호가 있으면 장 순서로 — 거리 함수와 같은 값
    expect(designcutStageOf('features:1', { ...d2, chapter: 1 })).toBe('life')
    expect(designcutStageOf('features:0', { ...d2, chapter: 2 })).toBe('macro')
    for (const section of ['problem', 'usage', 'long_scene:0', 'howto:1']) expect(designcutStageOf(section, d2), section).toBe('life')
    for (const section of ['detail', 'size_single', 'option_bundle', 'product_exposure']) expect(designcutStageOf(section, d2), section).toBe('solid')
  })

  it('D2가 아니면 scene 스위치 잡의 장면 컷만 세트(life)이고, 상품 컷과 스위치 없는 잡은 헌장 단색(solid)이다', () => {
    for (const section of ['hero', 'features:1', 'cta', 'detail']) {
      expect(designcutStageOf(section, { d2: false, scene: true }), section).toBe('solid')
      expect(designcutStageOf(section, { d2: false, scene: false }), section).toBe('solid')
    }
    expect(designcutStageOf('usage', { d2: false, scene: true })).toBe('life')
    expect(designcutStageOf('usage', { d2: false, scene: false })).toBe('solid')
  })

  it('컷 목적 블록이 먼저다 — 다른 장소 장면 컷은 place, 질감 컷은 macro, 그 밖 목적은 바탕 갈래 그대로', () => {
    for (const options of [d2, { d2: false, scene: true }, { d2: false, scene: false }]) {
      expect(designcutStageOf('long_scene:0', { ...options, purpose: 'scene' })).toBe('place')
      expect(designcutStageOf('features:4', { ...options, purpose: 'texture' })).toBe('macro')
      for (const purpose of ['underside', 'scale', 'action', 'angle', null]) {
        expect(designcutStageOf('features:0', { ...options, purpose }), String(purpose)).toBe(designcutStageOf('features:0', options))
      }
    }
  })
})
