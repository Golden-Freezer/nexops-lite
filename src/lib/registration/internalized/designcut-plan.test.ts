/**
 * 디자인 컷 비교군 계획(D1) — 08_DESIGN_CUTS.md §3·§4.3·§5·§6·§7 규칙과 02 D1 절 데이터 계약.
 * 픽스처 A·B·C(Track I)를 designcut 기록 잡으로 설계 단계를 다시 돌려 계획·플레이트 태스크를 만든다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { selectAnnotationTargets } from '../pdp-annotation-stage'
import { buildImageTasks } from '../pdp-image-tasks'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture, type FixtureKey } from '../__golden__/golden-harness'
import {
  buildDesigncutPlan,
  d2FeatureCutsOf,
  designcut2Enabled,
  designcutArtDirectionOf,
  designcutEnabled,
  MAX_POINTS_D2,
  parseAxisDims,
  parseSizeDims,
  rhythmViolations,
} from './designcut-plan'
import { cutBackgroundOf } from './designcut-palette'
import { buildD2SceneSet, isLightNeutral, sceneSetInputOf } from '../scene-set'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { designcutTaskFilter } from './designcut-images'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options']
const KEYS: FixtureKey[] = ['A-track-i', 'B-track-i', 'C-track-i']

function designedJob(key: FixtureKey, features: string[] = [...ON, 'designcut']): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}

const plan = (key: FixtureKey) => buildDesigncutPlan(designedJob(key))!
const byKey = (p: DesigncutPlan, key: string) => p.sections.find((s) => s.key === key)!

describe('적용 조건 — designcut 기록 잡만', () => {
  it('기록이 없거나 Track S면 null(운영 기본 경로 무변경)', () => {
    expect(buildDesigncutPlan(designedJob('A-track-i', ON))).toBeNull()
    expect(designcutEnabled({ ...designedJob('A-track-i'), generation_track: 'standard' })).toBe(false)
    expect(buildDesigncutPlan(fixtureToJob(loadEnrichmentFixture('A-track-s')))).toBeNull()
  })
})

describe('템플릿 배정(08 §7.1)·usp 분할·장 번호(§5.1)', () => {
  it('A: 역할 순서대로 T1 → T2 → POINT 01~04 → T5 → T4 → T6 → T8(해결 체크리스트는 POINT 제목과 같아 기존 섹션)', () => {
    const p = plan('A-track-i')
    expect(p.sections.map((s) => `${s.key}:${s.template}`)).toEqual([
      'main_cut:T1',
      'problem_raise:T2',
      'point_div:0:T3a',
      'point_div:1:T3a',
      'point_div:2:T3a',
      'point_div:3:T3a',
      'hidden_page:T5',
      'point_list_div:T4',
      'spec_table:T6',
      'cta:T8',
    ])
    expect(p.kept).toContain('solution_guide')
  })

  it('POINT는 usp 출현 순서대로 01부터 연속(상한 4) — 모두 장 머리·제목 → 사진(T3a) 한 순서(B 배치 점검 ①)', () => {
    for (const key of KEYS) {
      const points = plan(key).sections.filter((s) => s.role === 'usp_feature')
      expect(points.map((s) => s.chapter)).toEqual([1, 2, 3, 4])
      expect(points.map((s) => s.template)).toEqual(['T3a', 'T3a', 'T3a', 'T3a'])
      expect(points.map((s) => s.pointIndex)).toEqual([0, 1, 2, 3])
      expect(points.map((s) => s.productImageKey)).toEqual(['features:0', 'features:1', 'features:2', 'features:3'])
      expect(points.every((s) => s.modules[0].type === 'M6')).toBe(true)
    }
    const omitted = plan('A-track-i').omitted.map((o) => o.key)
    expect(omitted).toEqual(expect.arrayContaining(['sub_div:0', 'sub_div:5', 'perf_reviews']))
  })

  it('B·C: 첫 hook이 T1, 뒤의 main_cut·product_exposure는 T1 하나로 합친다', () => {
    for (const key of ['B-track-i', 'C-track-i'] as FixtureKey[]) {
      const p = plan(key)
      expect(p.sections[0]).toMatchObject({ key: 'hook_3step', template: 'T1', productImageKey: 'hero' })
      expect(p.omitted.filter((o) => o.reason.includes('히어로'))).toEqual([
        { key: 'main_cut', reason: '히어로(T1) 하나로 합침' },
        { key: 'product_exposure', reason: '히어로(T1) 하나로 합침' },
      ])
    }
  })

  it('order는 sections·kept 키를 페이지 순서로 섞은 것, omitted는 그리지 않는다', () => {
    for (const key of KEYS) {
      const p = plan(key)
      expect(p.order.filter((k) => !p.kept.includes(k))).toEqual(p.sections.map((s) => s.key))
      expect(p.order.some((k) => p.omitted.some((o) => o.key === k))).toBe(false)
    }
  })
})

describe('바탕 유형 교차(08 §4.3)', () => {
  it('A·B·C: 첫 P·끝 D, 같은 유형 연속·밝음 연속 3·강함 연속 3 없음, D 2~3개', () => {
    for (const key of KEYS) {
      const bgs = plan(key).sections.map((s) => s.bg)
      expect(bgs[0], key).toBe('P')
      expect(bgs.at(-1), key).toBe('D')
      expect(rhythmViolations(bgs), `${key} ${bgs.join('')}`).toBe(0)
      const d = bgs.filter((b) => b === 'D').length
      expect(d, key).toBeGreaterThanOrEqual(2)
      expect(d, key).toBeLessThanOrEqual(3)
    }
  })

  it('규칙 검사기 — 같은 유형 연속·밝음 3연속을 센다', () => {
    expect(rhythmViolations(['P', 'W', 'T', 'N'])).toBe(1)
    expect(rhythmViolations(['P', 'W', 'W'])).toBe(1)
    expect(rhythmViolations(['P', 'D', 'P'])).toBe(1)
    expect(rhythmViolations(['P', 'T', 'W', 'D', 'T', 'P', 'D'])).toBe(0)
  })
})

describe('플레이트(08 §2.1·§9.1, 2026-10-28 개정) — 상품 컷 없는 분위기 섹션(T3c)만, 키 plate:<섹션키>', () => {
  it('A: 상품 컷이 있는 T1·T3a·T6·T8은 플레이트 없음(편집기가 컷 바탕색으로 이어 칠한다)', () => {
    const p = buildDesigncutPlan(designedJob('A-track-i'))!
    expect(p.sections.filter((s) => s.plateKey)).toEqual([])
    expect(p.sections.every((s) => s.plateAspect === null)).toBe(true)
    expect(buildImageTasks(designedJob('A-track-i')).some((t) => t.section.startsWith('plate:'))).toBe(false)
  })

  it('브랜드 스토리(T3c)는 2:3 플레이트 — 생성 태스크는 effectOnly·skipGate', () => {
    const job = withSection(designedJob('A-track-i'), 'concept_desc', 'brand_story', 'point_div')
    const p = buildDesigncutPlan(job)!
    expect(p.sections.filter((s) => s.plateKey).map((s) => [s.plateKey, s.plateAspect])).toEqual([
      ['plate:concept_desc', '2:3'],
    ])
    const plates = buildImageTasks(job).filter((t) => t.section.startsWith('plate:'))
    expect(plates.map((t) => [t.section, t.aspectRatio, t.effectOnly, t.skipGate])).toEqual([
      ['plate:concept_desc', '3:4', true, true],
    ])
    expect(plates.every((t) => t.prompt.includes('NO TEXT'))).toBe(true)
  })

  it('기록 없는 잡의 태스크 목록은 그대로이고, 기록 잡은 계획이 쓰는 키만 + 플레이트(장식 대상 아님, 2026-10-28 같은 컷 한 번)', () => {
    const off = buildImageTasks(designedJob('A-track-i', ON)).map((t) => t.section)
    const on = buildImageTasks(designedJob('A-track-i')).map((t) => t.section)
    expect(off.some((s) => s.startsWith('plate:'))).toBe(false)
    const needed = designcutTaskFilter(buildDesigncutPlan(designedJob('A-track-i'))!)!
    expect(on.filter((s) => !s.startsWith('plate:'))).toEqual(off.filter(needed))
    expect(on.filter((s) => !s.startsWith('plate:')).length).toBeLessThan(off.length)
    const job = designedJob('A-track-i')
    job.section_images = [
      ...job.section_images,
      ...on
        .filter((s) => s.startsWith('plate:'))
        .map((section) => ({ section, url: `https://cdn.test/${section}.png` })),
    ]
    expect(selectAnnotationTargets(job).some((t) => t.section.startsWith('plate:'))).toBe(false)
  })

  it('계획은 이미지 생성 진행과 무관하다(재개·태스크 목록 일치) — 기록된 계획을 우선한다', () => {
    const job = withSection(designedJob('A-track-i'), 'concept_desc', 'brand_story', 'point_div')
    const full = buildDesigncutPlan(job)
    expect(buildDesigncutPlan({ ...job, section_images: [] })).toEqual(full)
    const story = full!.sections.find((s) => s.key === 'concept_desc')!
    const recorded = {
      ...job,
      section_plan: { ...job.section_plan, designcut: { ...full!, sections: [full!.sections[0], story] } },
    }
    expect(
      buildImageTasks(recorded)
        .filter((t) => t.section.startsWith('plate:'))
        .map((t) => t.section)
    ).toEqual(['plate:concept_desc'])
  })
})

describe('해결 체크리스트 — POINT 제목과 같은 항목 정리(B 배치 점검 ⑧)', () => {
  it('POINT가 같은 제목을 보이면 체크리스트 대신 기존 해결 섹션(요약 문구)을 같은 자리에 그린다', () => {
    const p = plan('A-track-i')
    expect(p.sections.some((s) => s.key === 'solution_guide')).toBe(false)
    expect(p.kept).toContain('solution_guide')
    expect(p.order.indexOf('solution_guide')).toBeLessThan(p.order.indexOf('point_div:0'))
  })

  it('POINT가 그 제목을 보이지 않으면 체크리스트(T4)는 그대로', () => {
    const job = designedJob('A-track-i')
    job.section_plan = {
      ...job.section_plan,
      section_order: job.section_plan.section_order!.filter((k) => k !== 'point_div'),
    }
    const p = buildDesigncutPlan(job)!
    const [m1] = byKey(p, 'solution_guide').modules
    expect(m1.type).toBe('M1')
    const titles = job.copy_sections.final!.pointCards!.map((c) => c.title!.trim())
    expect((m1.data as { items: string[] }).items).toEqual(titles.filter((t) => [...t].length <= 32).slice(0, 5))
  })
})

describe('템플릿 글자·모듈 — 카피·스펙 값 그대로(새 문구 없음)', () => {
  it('A: T1·POINT·T2·T4·T5·T6·T8 글자와 모듈 데이터', () => {
    const job = designedJob('A-track-i')
    const copy = job.copy_sections.final!
    const p = buildDesigncutPlan(job)!
    expect(byKey(p, 'main_cut').text).toEqual({
      eyebrow: copy.mainIntro?.category?.trim() || null,
      headline: (copy.mainIntro?.benefitHeadline || copy.mainIntro?.title)?.trim(),
      sub: (copy.mainIntro?.subBenefit || copy.mainIntro?.subtitle)?.trim() || null,
    })
    // 후킹은 카피·이미지만(오너 지시) — 카피에 옵션이 2개 이상이어도 컬러칩 띠(M8)를 붙이지 않는다
    expect(copy.colorOptions!.options!.length).toBeGreaterThanOrEqual(2)
    expect(byKey(p, 'main_cut').modules).toEqual([])
    expect(byKey(p, 'point_div:1').text).toEqual({
      eyebrow: null,
      headline: copy.pointCards![1].title,
      sub: copy.pointCards![1].description,
    })
    // '이런 고민' 라벨 삭제(오너 지시 11-01)
    expect(byKey(p, 'problem_raise').text.eyebrow).toBeNull()
    const bubbles = byKey(p, 'problem_raise').modules[0]
    expect(bubbles.type).toBe('M2a')
    const lines = (bubbles.data as { lines: string[] }).lines
    expect(lines.length).toBeGreaterThanOrEqual(2)
    // 카피 문장 그대로(앞뒤 따옴표만 걷음), 28자 이하
    const source = copy.problem!.empathyLines!.map((l) => l.replace(/^['"“‘]+|['"”’]+$/g, '').trim())
    expect(lines.every((l) => source.includes(l) && [...l].length <= 28)).toBe(true)
    expect(lines.some((l) => /^['"]|['"]$/.test(l))).toBe(false)
    expect(byKey(p, 'hidden_page')).toMatchObject({
      productImageKey: 'howto:0',
      text: { headline: '사용 방법' },
      modules: [
        { type: 'M7', data: { steps: copy.howTo!.map((s) => ({ title: s.step, description: s.description })) } },
      ],
    })
    expect(byKey(p, 'spec_table').modules).toEqual([
      { type: 'M4', data: { dims: [{ axis: 'w', value: 30, unit: 'cm' }], raw: job.spec_sheet.size } },
    ])
    expect(byKey(p, 'cta').text).toEqual({
      eyebrow: null,
      headline: copy.closingCta?.headline,
      sub: copy.closingCta?.subtext ?? null,
    })
    expect(p.sections.every((s) => s.productAlpha === false)).toBe(true)
    // 장식 기록 잡의 T3a에는 장식 참조(편집기가 annotations에서 읽음)
    expect(byKey(p, 'point_div:0').modules).toEqual([
      { type: 'M6', data: { chapter: 1 } },
      { type: 'M2b', data: { imageKey: 'features:0' } },
    ])
  })

  it('데이터가 모자라면 섹션을 빼고 사유를 남긴다', () => {
    const job = designedJob('A-track-i')
    const copy = job.copy_sections.final!
    job.copy_sections = {
      ...job.copy_sections,
      final: {
        ...copy,
        problem: { ...copy.problem, empathyLines: ['한 줄뿐'] },
        howTo: [{ step: '하나' }],
        recommendedTargets: ['a', 'b'],
      },
    }
    job.spec_sheet = { ...job.spec_sheet, size: '대용량 10개입' }
    const p = buildDesigncutPlan(job)!
    const reasons = Object.fromEntries(p.omitted.map((o) => [o.key, o.reason]))
    expect(reasons).toMatchObject({
      problem_raise: '고객 고민 문장 2개 미만(28자 이하)',
      hidden_page: '사용 단계 2개 미만',
      point_list_div: '추천 대상 3개 미만',
      spec_table: 'spec.size에서 치수(숫자+단위)를 읽지 못함',
    })
  })
})

describe('치수 파싱(M4) — 숫자+단위가 없으면 만들지 않는다', () => {
  it.each([
    [
      '30x20x10cm',
      [
        ['w', 30],
        ['h', 20],
        ['d', 10],
      ],
    ],
    [
      '가로 20cm 세로 15.5cm',
      [
        ['w', 20],
        ['h', 15.5],
      ],
    ],
    ['지름 8 mm', [['w', 8]]],
    ['약 12cm', [['w', 12]]],
    ['대용량 10개입', []],
    // 값마다 단위(R10-L-P02 — 예전에는 첫 값만 읽어 가로 한 축)
    [
      '16.5cm x 20.7cm(데이지 S)',
      [
        ['w', 16.5],
        ['h', 20.7],
      ],
    ],
    [
      '34cm x 19.5cm x 12.5cm',
      [
        ['w', 34],
        ['h', 19.5],
        ['d', 12.5],
      ],
    ],
    // 단위가 없는 곱셈 표기는 치수가 아니다(수량 등)
    ['2 x 10 세트', []],
  ])('%s', (raw, expected) => {
    expect(parseSizeDims(raw).map((d) => [d.axis, d.value])).toEqual(expected)
  })
})

describe('parseAxisDims — 방향이 확실한 치수만(sizecut)', () => {
  it.each([
    ['16.5cm x 20.7cm(데이지 S)', [['w', 16.5], ['h', 20.7]]],
    ['34cm x 19.5cm x 12.5cm', [['w', 34], ['h', 19.5], ['d', 12.5]]],
    ['190mm x 60mm(프리사이즈)', [['w', 190], ['h', 60]]],
    ['가로 20cm 세로 15.5cm', [['w', 20], ['h', 15.5]]],
    ['폭 30cm', [['w', 30]]],
    // 방향을 모른다 — 호출자가 입력 글 그대로 적는다
    ['고리 21.4cm, 펼침 37.3cm', []],
    ['길이 7.3cm, 굵기 3.2cm', []],
    ['지름 50mm 원형', []],
    ['5cm 원형', []],
    // 방향 있는 값과 모르는 값이 섞이면 일부만 적지 않는다
    ['길이 30cm, 폭 5cm', []],
    ['소 10cm x 20cm, 대 30cm x 40cm', []],
    ['대용량 10개입', []],
  ])('%s', (raw, expected) => {
    expect(parseAxisDims(raw).map((d) => [d.axis, d.value])).toEqual(expected)
  })
})

/** 설계 골격에 역할 섹션을 끼워 넣는다(플래너 변형 재현) — section_order·stages를 함께 바꾼다 */
function withSection(job: PdpJobRow, key: string, role: string, after: string): PdpJobRow {
  const order = [...job.section_plan.section_order!]
  order.splice(order.indexOf(after) + 1, 0, key)
  const skeleton = job.section_plan.internalized_skeleton!
  const stages = [...skeleton.persuasion!.stages, { section: key, role, stage: 'VALUE' as const, reason: 'test' }]
  return {
    ...job,
    section_plan: {
      ...job.section_plan,
      section_order: order,
      internalized_skeleton: { ...skeleton, persuasion: { ...skeleton.persuasion!, stages } },
    },
  }
}

/** 고정 사진 바탕끼리 붙은 쌍 — 바탕을 바꿀 수 없어 피할 수 없는 위반 */
const fixedPhotoPairs = (p: DesigncutPlan) =>
  p.sections.filter(
    (s, i) => i > 0 && ['T1', 'T3c'].includes(s.template) && ['T1', 'T3c'].includes(p.sections[i - 1].template)
  ).length

describe('바탕 교차 — 플래너 변형(verifier 재현 사례)', () => {
  it('POINT 바로 뒤에 브랜드 스토리(T3c)가 와도 POINT는 T3a — 사진 바탕 연속 없음', () => {
    for (const key of KEYS) {
      const p = buildDesigncutPlan(withSection(designedJob(key), 'concept_desc', 'brand_story', 'point_div'))!
      const story = p.sections.findIndex((s) => s.key === 'concept_desc')
      expect(p.sections[story].template).toBe('T3c')
      expect(p.sections[story - 1]).toMatchObject({ key: 'point_div:3', template: 'T3a' })
      expect(p.sections[story - 1].modules).toEqual([
        { type: 'M6', data: { chapter: 4 } },
        { type: 'M2b', data: { imageKey: 'features:3' } },
      ])
      expect(p.sections[story - 1].plateKey).toBeNull()
      expect(p.sections[story].plateKey).toBe('plate:concept_desc')
      expect(rhythmViolations(p.sections.map((s) => s.bg)), key).toBe(0)
    }
  })

  it('무작위 섹션 순서 300개 — 피할 수 없는 고정 사진 쌍 외 위반 0, 섹션 ≥ 9면 D 2~3', () => {
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const base = withSection(designedJob('A-track-i'), 'concept_desc', 'brand_story', 'point_div')
    const middle = base.section_plan.section_order!.slice(1, -1)
    for (let n = 0; n < 300; n++) {
      const shuffled = [...middle].sort(() => rand() - 0.5)
      const order = [base.section_plan.section_order![0], ...shuffled, base.section_plan.section_order!.at(-1)!]
      const p = buildDesigncutPlan({ ...base, section_plan: { ...base.section_plan, section_order: order } })!
      const bgs = p.sections.map((s) => s.bg)
      expect(rhythmViolations(bgs), `${order.join(',')} → ${bgs.join('')}`).toBe(fixedPhotoPairs(p))
      if (p.sections.length >= 9) {
        const d = bgs.filter((b) => b === 'D').length
        expect(d, bgs.join('')).toBeGreaterThanOrEqual(2)
        expect(d, bgs.join('')).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('verifier 비차단 반영', () => {
  it('두 번째 고민 섹션은 T2 하나로 합친다(같은 질문·말풍선 반복 없음)', () => {
    const p = buildDesigncutPlan(withSection(designedJob('A-track-i'), 'problem_empathy', 'problem', 'problem_raise'))!
    expect(p.sections.filter((s) => s.template === 'T2')).toHaveLength(1)
    expect(p.omitted).toContainEqual({ key: 'problem_empathy', reason: '고민(T2) 하나로 합침' })
  })

  it('말풍선은 앞뒤 따옴표를 걷는다(후기처럼 보이는 따옴표 금지)', () => {
    const job = designedJob('A-track-i')
    const copy = job.copy_sections.final!
    job.copy_sections = {
      ...job.copy_sections,
      final: {
        ...copy,
        problem: { ...copy.problem, empathyLines: ["'준비할 게 너무 많아요'", '“치우기 번거로워요”', '그냥 문장'] },
      },
    }
    const m = buildDesigncutPlan(job)!.sections.find((s) => s.template === 'T2')!.modules[0]
    expect(m).toEqual({ type: 'M2a', data: { lines: ['준비할 게 너무 많아요', '치우기 번거로워요', '그냥 문장'] } })
  })

  it('sub_div 조각은 그 카피와 같은 인덱스의 피처 컷을 쓴다(pointCards가 적을 때)', () => {
    const job = designedJob('A-track-i')
    const copy = job.copy_sections.final!
    job.copy_sections = { ...job.copy_sections, final: { ...copy, pointCards: copy.pointCards!.slice(0, 2) } }
    const points = buildDesigncutPlan(job)!.sections.filter((s) => s.role === 'usp_feature')
    expect(points.map((s) => [s.key, s.chapter, s.productImageKey])).toEqual([
      ['point_div:0', 1, 'features:0'],
      ['point_div:1', 2, 'features:1'],
      ['sub_div:0', 3, 'features:0'],
      ['sub_div:1', 4, 'features:1'],
    ])
  })

  it('사용 단계 설명이 없으면 null(빈 문자열 아님)', () => {
    const job = designedJob('A-track-i')
    const copy = job.copy_sections.final!
    job.copy_sections = {
      ...job.copy_sections,
      final: { ...copy, howTo: [{ step: '꺼내기' }, { step: '붙이기', description: '벽에 붙인다' }] },
    }
    const steps = buildDesigncutPlan(job)!.sections.find((s) => s.template === 'T5')!.modules[0]
    expect(steps).toEqual({
      type: 'M7',
      data: {
        steps: [
          { title: '꺼내기', description: null },
          { title: '붙이기', description: '벽에 붙인다' },
        ],
      },
    })
  })
})

describe('D2(designcut2) — 큰 POINT 3개 + 자세히 보기·빈 분위기 컷 빼기·아트 디렉션(PDP-DR-PLAN §2·§7, pdp-design-structure)', () => {
  const D2 = [...ON, 'designcut', 'designcut2']
  const d2Job = (key: FixtureKey) => designedJob(key, D2)

  it('designcut2는 디자인 컷 잡에서만 — 꺼진 잡(D)은 계획이 예전 그대로(아트 디렉션 없음, POINT 4)', () => {
    expect(designcut2Enabled(d2Job('A-track-i'))).toBe(true)
    expect(designcut2Enabled(designedJob('A-track-i'))).toBe(false)
    const d = plan('A-track-i')
    expect(d.artDirection).toBeUndefined()
    expect(d.sections.filter((s) => s.role === 'usp_feature')).toHaveLength(4)
  })

  it('A: 큰 POINT는 point_div 1~3(features:0~2, 형태 scene·zigzag·grid), point_div 4번과 sub_div 새 특징(5·6번)은 자세히 보기 한 섹션', () => {
    const job = d2Job('A-track-i')
    const p = buildDesigncutPlan(job)!
    const points = p.sections.filter((s) => s.template === 'T3a')
    expect(points.map((s) => s.key)).toEqual(['point_div:0', 'point_div:1', 'point_div:2'])
    expect(points.map((s) => s.chapter)).toEqual([1, 2, 3])
    expect(points.map((s) => s.layoutVariant)).toEqual(['scene', 'zigzag', 'grid'])
    for (const s of points) expect(s.productImageKey).toBe(`features:${s.pointIndex}`)
    // 남은 특징 셋은 자세히 보기(T11) 하나 — 항목마다 자기 피처 컷, 카피 제목·설명 그대로(같은 사진을 되풀이하지 않는다)
    const copy = job.copy_sections.final!
    const detail = p.sections.filter((s) => s.template === 'T11')
    expect(detail).toHaveLength(1)
    expect(detail[0].key).toBe('detail:more')
    expect(p.order.indexOf('detail:more')).toBe(p.order.indexOf('point_div:2') + 1)
    expect(detail[0].layoutVariant).toBe('zigzag')
    expect(detail[0].modules).toEqual([
      {
        type: 'M11',
        data: {
          items: [
            { title: copy.pointCards![3].title, description: copy.pointCards![3].description, imageKey: 'features:3' },
            { title: copy.detailPoints![4].claim, description: copy.detailPoints![4].benefit ?? copy.detailPoints![4].proof, imageKey: 'features:4' },
            { title: copy.detailPoints![5].claim, description: copy.detailPoints![5].benefit ?? copy.detailPoints![5].proof, imageKey: 'features:5' },
          ],
        },
      },
    ])
    expect(points.length + 3).toBeLessThanOrEqual(MAX_POINTS_D2)
    const reasons = new Map(p.omitted.map((o) => [o.key, o.reason]))
    for (const i of [0, 1, 2, 3]) expect(reasons.get(`sub_div:${i}`)).toBe(`D2 — POINT ${i + 1}과 같은 특징(point_div)`)
    for (const key of ['point_div:3', 'sub_div:4', 'sub_div:5']) expect(reasons.get(key)).toBe('D2 — 자세히 보기(T11)에 묶음')
    // 피처 컷도 6장까지 만든다(꺼진 잡은 4장)
    const featureTasks = (j: PdpJobRow) => buildImageTasks(j).filter((t) => t.section.startsWith('features:')).map((t) => t.section)
    expect(featureTasks(job)).toEqual(expect.arrayContaining(['features:4', 'features:5']))
    expect(featureTasks(designedJob('A-track-i'))).not.toContain('features:4')
  })

  it('빈 분위기 컷(T3c)은 기본에서 뺀다 — 플레이트도 만들지 않는다', () => {
    const job = withSection(d2Job('A-track-i'), 'concept_desc', 'brand_story', 'point_div')
    const p = buildDesigncutPlan(job)!
    expect(p.sections.some((s) => s.template === 'T3c')).toBe(false)
    expect(p.sections.filter((s) => s.plateKey)).toEqual([])
    expect(p.omitted.find((o) => o.key === 'concept_desc')?.reason).toBe('D2 — 빈 분위기 컷(T3c)은 기본에서 뺀다')
    expect(buildImageTasks(job).some((t) => t.section.startsWith('plate:'))).toBe(false)
  })

  it('아트 디렉션 — 세트는 R2와 같은 생성기에 K 어휘 표(벽 톤 입력은 컷 바탕색, 적용 D4 ⓒ), 흰·밝은 뉴트럴 스튜디오·강조, 정렬 축 2개, 모서리 = motif', () => {
    for (const key of KEYS) {
      const job = d2Job(key)
      const p = buildDesigncutPlan(job)!
      const art = p.artDirection!
      const input = sceneSetInputOf(job)
      expect(art.set).toEqual(buildD2SceneSet({ ...input, palette: { ...input.palette, bgMain: cutBackgroundOf(p.palette) } }))
      expect(art.set.floor, key).not.toMatch(/oak/i)
      expect(art.set.props.join(' '), key).not.toMatch(/plant|succulent|herb|eucalyptus|flower/i)
      expect(art.set.props, key).toHaveLength(2)
      expect(art.background.base).toBe('#FFFFFF')
      expect(art.background.accent).toBe(p.palette.accent)
      expect(isLightNeutral(art.background.studio)).toBe(true)
      expect(art.alignment).toEqual({ hero: 'center', closing: 'center', body: 'left' })
      expect(art.corners).toBe(p.motif.badge === 'SHARP' ? 'sharp' : 'soft')
      // 결정론 — 다시 계산해도 같다(재개·태스크 목록 일치)
      expect(buildDesigncutPlan(job)).toEqual(p)
    }
  })

  it('스튜디오 색 — 흰 배경 촬영(컷 바탕 흰색)이면 흰 기본과 구분되는 상수 뉴트럴, 밝은 뉴트럴 촬영 배경은 그 색', () => {
    const withPhoto = (job: PdpJobRow, background: string): PdpJobRow => ({
      ...job,
      section_plan: {
        ...job.section_plan,
        designcut_photo: {
          version: 1,
          background,
          backgroundTransparent: false,
          product: '#3A6EA5',
          productShare: 0.4,
          productLightness: 50,
          productChroma: 40,
          clusters: [],
        },
      },
    })
    const white = buildDesigncutPlan(withPhoto(d2Job('A-track-i'), '#FFFFFF'))!.artDirection!
    expect(white.background.studio).not.toBe(white.background.base)
    expect(white.background.studio).toBe('#F4F3F0')
    expect(buildDesigncutPlan(withPhoto(d2Job('A-track-i'), '#F2F1ED'))!.artDirection!.background.studio).toBe('#F2F1ED')
  })

  it('자세히 보기 항목 아이콘(적용 T1-60 D) — 카피 detailPoints에 K 사전 이름이 있을 때만 옮기고, 사전 밖·없음은 칸을 두지 않는다', () => {
    const job = structuredClone(d2Job('A-track-i'))
    const points = job.copy_sections.final!.detailPoints!
    points[4] = { ...points[4], icon: 'water' }
    points[5] = { ...points[5], icon: 'shield' }
    const items = (buildDesigncutPlan(job)!.sections.find((s) => s.template === 'T11')!.modules[0] as { data: { items: Array<{ icon?: string }> } }).data.items
    expect(items.map((i) => i.icon)).toEqual([undefined, 'water', undefined])
    expect(items.map((i) => 'icon' in i)).toEqual([false, true, false])
    // 지금 카피(아이콘 없음)는 예전 계획 그대로 — 칸이 생기지 않는다
    const plain = (buildDesigncutPlan(d2Job('A-track-i'))!.sections.find((s) => s.template === 'T11')!.modules[0] as { data: { items: object[] } }).data.items
    expect(plain.some((i) => 'icon' in i)).toBe(false)
  })

  it('sub_div가 빠진 D2 잡 — 큰 POINT 3장 + 자세히 보기 1항목, 피처 컷도 4장(안 쓰는 5·6번 컷을 만들지 않는다)', () => {
    const full = d2Job('A-track-i')
    const drop = (list?: string[]) => list?.filter((k) => k !== 'sub_div')
    const job: PdpJobRow = {
      ...full,
      section_plan: {
        ...full.section_plan,
        section_order: drop(full.section_plan.section_order),
        activated_sections: drop(full.section_plan.activated_sections),
      },
    }
    const p = buildDesigncutPlan(job)!
    expect(p.sections.filter((s) => s.template === 'T3a')).toHaveLength(3)
    const detail = p.sections.find((s) => s.template === 'T11')!
    expect(detail.modules[0]).toMatchObject({ type: 'M11', data: { items: [{ imageKey: 'features:3' }] } })
    expect(d2FeatureCutsOf(p)).toBe(4)
    // 큰 POINT는 features:0~2 — 6은 자세히 보기 항목(features:3~5)까지 센 값
    expect(d2FeatureCutsOf(buildDesigncutPlan(full))).toBe(6)
    const features = buildImageTasks(job).filter((t) => t.section.startsWith('features:')).map((t) => t.section)
    expect(features).not.toContain('features:4')
    expect(features).not.toContain('features:5')
  })

  // 2026-10-31 통합 점검: 1~4번도 번호로 고르지 않는다 — 디자인 컷 POINT도 features:i를 쓰므로 render-aware-cuts ①(그 특징과
  // 제목 낱말이 맞는 설계 항목, 없으면 카피)을 같이 쓴다. 예전에는 '다른 제목 0'인 설계 항목도 0번 컷에 붙었다
  it('피처 컷(D2 포함) — 설계 프롬프트는 그 특징과 제목 낱말이 맞을 때만, 아니면 카피 폴백(번호로 고르지 않는다)', () => {
    const base = d2Job('A-track-i')
    const points = base.copy_sections.final!.detailPoints!
    const entries = (titleOf: (i: number) => string) =>
      Array.from({ length: 6 }, (_, i) => ({ title: titleOf(i), positive: `DESIGN_MARK_${i} studio product shot` }))
    const withPrompts = (feature_prompts: unknown[]): PdpJobRow => ({
      ...base,
      design_prompts: { ...base.design_prompts, feature_prompts } as PdpJobRow['design_prompts'],
    })
    const promptOf = (job: PdpJobRow, key: string) => buildImageTasks(job).find((t) => t.section === key)?.prompt ?? ''
    const unmatched = withPrompts(entries((i) => `다른 제목 ${i}`))
    expect(promptOf(unmatched, 'features:0')).not.toBe('')
    expect(promptOf(unmatched, 'features:0')).not.toMatch(/DESIGN_MARK_/)
    expect(promptOf(unmatched, 'features:4')).not.toBe('')
    expect(promptOf(unmatched, 'features:4')).not.toContain('DESIGN_MARK_4')
    const matched = withPrompts(entries((i) => points[i]?.claim ?? ''))
    expect(promptOf(matched, 'features:4')).toContain('DESIGN_MARK_4')
  })

  it('D2 바탕 교차 — A·B·C: 첫 P·끝 D, 교차 규칙 위반 없음', () => {
    for (const key of KEYS) {
      const bgs = buildDesigncutPlan(d2Job(key))!.sections.map((s) => s.bg)
      expect(bgs[0], key).toBe('P')
      expect(bgs.at(-1), key).toBe('D')
      expect(rhythmViolations(bgs), `${key} ${bgs.join('')}`).toBe(0)
    }
  })

  it('designcutArtDirectionOf — D2 잡은 기록된 계획의 아트 디렉션(없으면 다시 계산), 꺼진 잡은 null', () => {
    const job = d2Job('A-track-i')
    const p = buildDesigncutPlan(job)!
    expect(designcutArtDirectionOf(job)).toEqual(p.artDirection)
    const recorded: PdpJobRow = { ...job, section_plan: { ...job.section_plan, designcut: p } }
    expect(designcutArtDirectionOf(recorded)).toBe(p.artDirection)
    expect(designcutArtDirectionOf(designedJob('A-track-i'))).toBeNull()
  })

  it('편집기 계약이 아트 디렉션을 통과시킨다 — 형태가 틀리면 그 필드만 빼고 계획은 읽는다', () => {
    const p = buildDesigncutPlan(d2Job('A-track-i'))!
    expect(readDesignCut({ designcut: p })?.artDirection).toEqual(p.artDirection)
    const broken = { ...p, artDirection: { ...p.artDirection!, background: { ...p.artDirection!.background, studio: 'white' } } }
    const read = readDesignCut({ designcut: broken })
    expect(read).not.toBeNull()
    expect(read).not.toHaveProperty('artDirection')
    expect(readDesignCut({ designcut: plan('A-track-i') })).not.toHaveProperty('artDirection')
  })
})
