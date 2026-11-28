/**
 * D2 테스트·렌더 확인용 designcut 기록 — B Track I 픽스처 잡에 D1 계약 형태(02 D1 + 통합 세부 1~4, key 분할·text)로 손으로 넣는다.
 * 문구는 픽스처 copy_sections.final에서 그대로 옮겼다(D1이 할 일과 같다). 플레이트는 픽스처의 기존 컷 URL로 대신한다(실제 플레이트 아님).
 */

import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import type { PdpJobRow } from '@/lib/registration/pdp-state'
import { applyDesignSkeleton, resolveDesignSkeleton } from '@/lib/registration/pdp-enrichment-stage'
import { mergeManualStrategy } from '@/lib/registration/pdp-strategy-contract'
import { buildDesigncutPlan } from '@/lib/registration/internalized/designcut-plan'

const PLATE_KEYS = ['main_cut', 'point_div:0', 'point_div:1', 'concept_desc', 'spec_table', 'cta']

export const DESIGN_CUT_ORDER = [
  'main_cut',
  'product_exposure',
  'problem_raise',
  'point_div',
  'solution_guide',
  'hidden_page',
  'concept_desc',
  'spec_table',
  'petit_div',
  'problem_empathy',
  'perf_rating',
  'cta',
]

const text = (headline: string | null, sub: string | null = null, eyebrow: string | null = null) => ({
  eyebrow,
  headline,
  sub,
})

export function designCutPlanForB(withPlates = true) {
  const sec = (key: string, role: string, template: string, bg: string, extra: Record<string, unknown> = {}) => ({
    key,
    role,
    template,
    bg,
    chapter: null,
    plateKey: withPlates && PLATE_KEYS.includes(key) ? `plate:${key}` : null,
    plateAspect: null,
    productImageKey: null,
    pointIndex: null,
    text: text(null),
    modules: [],
    ...extra,
  })
  return {
    version: 1,
    palette: {
      accent: '#D9622B',
      accentText: '#A8441A',
      deep: '#4A2414',
      tint: '#FBF0E8',
      ink: '#1A1A1A',
      mode: 'color',
    },
    motif: { badge: 'SOFT' },
    sections: [
      sec('main_cut', 'main_cut', 'T1', 'P', {
        productImageKey: 'hero',
        text: text(
          '마음을 붙이면\n선물이 됩니다',
          '카네이션과 감사 문구를 담은 핸드메이드 스티커, 붙이면 완성',
          '선물포장 스티커'
        ),
        modules: [
          {
            type: 'M8',
            data: {
              chips: [
                { label: '카네이션', color: '#E8A0A8' },
                { label: '크라프트', color: '#C8A27A' },
              ],
            },
          },
        ],
      }),
      sec('problem_raise', 'problem', 'T2', 'T', {
        text: text(
          '고맙다는 마음, 어떻게 전하고 있나요?',
          '선물은 준비했는데 마음을 어떻게 담을지, 포장 앞에서 자꾸 망설여져요.'
        ),
        modules: [
          {
            type: 'M2a',
            data: { lines: ['포장이 늘 평범해 보여요', '문구 뭐라고 쓸지 막막해요', '감사 인사가 늘 어려워요'] },
          },
        ],
      }),
      sec('point_div:0', 'usp_feature', 'T3a', 'W', {
        chapter: 1,
        pointIndex: 0,
        productImageKey: 'features:0',
        text: text('감사 인사 완성', '문구 고민 없이 붙이기만\n하면 감사 인사 끝'),
        modules: [
          { type: 'M6', data: { chapter: 1 } },
          { type: 'M2b', data: { imageKey: 'features:0' } },
        ],
      }),
      sec('point_div:1', 'usp_feature', 'T3a', 'D', {
        chapter: 2,
        pointIndex: 1,
        productImageKey: 'features:1',
        text: text('50매 대용량', '답례품, 수제 선물까지\n한 번에 다 포장'),
      }),
      sec('point_div:2', 'usp_feature', 'T3b', 'P', {
        chapter: 3,
        pointIndex: 2,
        productImageKey: 'features:3',
        text: text('다양한 활용', '답례품·수제 선물 포장 어디에나'),
      }),
      sec('solution_guide', 'target_recommendation', 'T4', 'T', {
        text: text('이런 분께 추천해요', '감사 문구와 일러스트가 함께 있어 붙이면 감사 인사가 완성돼요', '추천 대상'),
        modules: [
          {
            type: 'M1',
            data: {
              items: [
                '감사 인사 준비하는 분',
                '답례품 다량 포장하는 분',
                '수제 선물 만드는 분',
                '포장 정성 더하고 싶은 분',
              ],
            },
          },
        ],
      }),
      sec('hidden_page', 'how_to_guide', 'T5', 'W', {
        productImageKey: 'howto:0',
        text: text('이렇게 붙여 보세요'),
        modules: [
          {
            type: 'M7',
            data: {
              steps: [
                { title: '선물 상자 리본 위에 부착', description: '리본 매듭 가운데에 붙이면 포인트가 돼요' },
                { title: '답례품 봉투 앞면에 부착', description: '봉투 입구를 한 번에 봉할 수 있어요' },
                { title: '수제 선물 포장지 위에 부착', description: '포장지 가운데에 붙여 마무리해요' },
              ],
            },
          },
        ],
      }),
      sec('concept_desc', 'brand_story', 'T3c', 'P', {
        text: text('말 대신 스티커 한 장', '고맙다는 마음, 이렇게 전해져요'),
      }),
      sec('spec_table', 'size_spec', 'T6', 'N', {
        productImageKey: 'hero',
        text: text('한 장 크기'),
        modules: [
          {
            type: 'M4',
            data: {
              dims: [
                { axis: 'w', value: 5, unit: 'cm' },
                { axis: 'h', value: 5, unit: 'cm' },
              ],
              raw: '5×5cm',
            },
          },
        ],
      }),
      sec('petit_div', 'option_catalog', 'T7', 'T', {
        productImageKey: 'hero',
        text: text('디자인 구성', '카네이션 일러스트와 감사 문구가 담긴 단일 디자인 50매'),
        modules: [
          {
            type: 'M8',
            data: {
              chips: [
                { label: '카네이션', color: '#E8A0A8' },
                { label: '크라프트', color: '#C8A27A' },
                { label: '감사 문구', color: null },
                { label: '하트', color: null },
              ],
            },
          },
        ],
      }),
      sec('cta', 'cta', 'T8', 'D', {
        productImageKey: 'hero',
        text: text('지금 포장에 마음을 더해보세요', '50매 구성 · 답례품과 수제 선물 포장에 바로 활용'),
      }),
    ],
    kept: ['product_exposure', 'problem_empathy'],
    order: [
      'main_cut',
      'product_exposure',
      'problem_raise',
      'problem_empathy',
      'point_div:0',
      'point_div:1',
      'point_div:2',
      'solution_guide',
      'hidden_page',
      'concept_desc',
      'spec_table',
      'petit_div',
      'cta',
    ],
    omitted: [{ key: 'perf_rating', reason: '자사 평점 근거 없음' }],
  }
}

/** B Track I 픽스처 잡 + designcut 기록 + 플레이트 컷(기존 컷 URL로 대신) + mobile 기록(D1 잡은 ENRICHMENT 전부 on) */
export function designCutJobB(options: { withPlates?: boolean; plan?: unknown } = {}): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('B-track-i')) as PdpJobRow & { section_plan: Record<string, unknown> }
  const hero = job.section_images.find((s) => s.section === 'hero')!
  const plates = (options.withPlates ?? true) ? PLATE_KEYS.map((k) => ({ ...hero, section: `plate:${k}` })) : []
  return {
    ...job,
    section_images: [...job.section_images, ...plates],
    section_plan: {
      ...job.section_plan,
      section_order: DESIGN_CUT_ORDER,
      enrichment: { version: 1, features: ['mobile'], vocabHash: null },
      designcut: options.plan ?? designCutPlanForB(options.withPlates ?? true),
    },
  } as unknown as PdpJobRow
}

type FixtureCopy = {
  mainIntro?: { category?: string; title?: string; benefitHeadline?: string; subBenefit?: string; subtitle?: string }
  problem?: { question?: string; empathy?: string; empathyLines?: string[] }
  pointCards?: Array<{ title?: string; description?: string }>
  recommendedTargets?: string[]
  howTo?: Array<{ step?: string; description?: string }>
  keyMessageCopy?: { headline?: string; subCopy?: string }
  colorOptions?: { title?: string; options?: string[]; description?: string }
  solution?: { summary?: string }
  closingCta?: { headline?: string; subtext?: string } | string
}

/**
 * 아무 픽스처 잡에서 계약 형태의 기록을 만든다(시험용 — D1의 역할 배정을 흉내 낸다). 문구는 그 잡의 copy_sections.final 그대로,
 * 모듈 데이터 규칙(M2a 2~3·M1 3~5·M7 2~4·M8 ≥2)은 계약 세부 2를 따른다. 플레이트는 기존 컷 URL로 대신한다.
 */
export function designCutJobFromFixture(key: 'A-track-i' | 'B-track-i' | 'C-track-i', withPlates = true): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key)) as PdpJobRow & { section_plan: Record<string, unknown> }
  const copy = (job.copy_sections as { final: FixtureCopy }).final
  const hero = job.section_images.find((s) => s.section === 'hero')!
  const sections: Array<Record<string, unknown>> = []
  const order: string[] = []
  const plateKeys: string[] = []
  const add = (key: string, template: string, bg: string, extra: Record<string, unknown>) => {
    const plate = withPlates && ['T1', 'T3a', 'T3c', 'T6', 'T8'].includes(template) ? `plate:${key}` : null
    if (plate) plateKeys.push(key)
    sections.push({
      key,
      role: '',
      template,
      bg,
      chapter: null,
      plateKey: plate,
      plateAspect: null,
      productImageKey: null,
      pointIndex: null,
      modules: [],
      ...extra,
    })
    order.push(key)
  }
  const mi = copy.mainIntro ?? {}
  add('main_cut', 'T1', 'P', {
    productImageKey: 'hero',
    text: text(mi.benefitHeadline ?? mi.title ?? null, mi.subBenefit ?? mi.subtitle ?? null, mi.category ?? null),
  })
  order.push('product_exposure')
  const lines = (copy.problem?.empathyLines ?? []).slice(0, 3)
  if (lines.length >= 2)
    add('problem_raise', 'T2', 'T', {
      text: text(copy.problem?.question ?? null, copy.problem?.empathy ?? null),
      modules: [{ type: 'M2a', data: { lines } }],
    })
  const points = (copy.pointCards ?? []).slice(0, 3)
  const bgs = ['W', 'D', 'P']
  points.forEach((p, i) =>
    add(`point_div:${i}`, i === 2 ? 'T3b' : 'T3a', bgs[i], {
      chapter: i + 1,
      pointIndex: i,
      productImageKey: i === 2 ? 'features:3' : `features:${i}`,
      text: text(p.title ?? null, p.description ?? null),
      modules: [{ type: 'M6', data: { chapter: i + 1 } }],
    })
  )
  const items = (copy.recommendedTargets ?? []).slice(0, 5)
  if (items.length >= 3)
    add('solution_guide', 'T4', 'W', {
      text: text('이런 분께 추천해요', copy.solution?.summary ?? null),
      modules: [{ type: 'M1', data: { items } }],
    })
  const steps = (copy.howTo ?? []).slice(0, 4).map((h) => ({ title: h.step ?? '', description: h.description ?? '' }))
  if (steps.length >= 2)
    add('hidden_page', 'T5', 'W', {
      productImageKey: 'howto:0',
      text: text(null),
      modules: [{ type: 'M7', data: { steps } }],
    })
  if (copy.keyMessageCopy?.headline)
    add('concept_desc', 'T3c', 'P', { text: text(copy.keyMessageCopy.headline, copy.keyMessageCopy.subCopy ?? null) })
  const options = copy.colorOptions?.options ?? []
  if (options.length >= 2)
    add('petit_div', 'T7', 'T', {
      productImageKey: 'hero',
      text: text(copy.colorOptions?.title ?? null, copy.colorOptions?.description ?? null),
      modules: [{ type: 'M8', data: { chips: options.map((label) => ({ label, color: null })) } }],
    })
  const cta = typeof copy.closingCta === 'string' ? { headline: copy.closingCta } : (copy.closingCta ?? {})
  add('cta', 'T8', 'D', { productImageKey: 'hero', text: text(cta.headline ?? null, cta.subtext ?? null) })
  return {
    ...job,
    section_images: [...job.section_images, ...plateKeys.map((k) => ({ ...hero, section: `plate:${k}` }))],
    section_plan: {
      ...job.section_plan,
      enrichment: { version: 1, features: ['mobile'], vocabHash: null },
      designcut: {
        version: 1,
        palette: designCutPlanForB().palette,
        motif: { badge: 'SOFT' },
        sections,
        kept: ['product_exposure'],
        omitted: [],
        order,
      },
    },
  } as unknown as PdpJobRow
}

/**
 * D1 실제 계획 — D1 테스트(designcut-plan.test.ts)와 같이 설계 단계를 designcut 기록으로 다시 돌린 뒤
 * buildDesigncutPlan이 만든 기록을 그대로 싣는다. 플레이트는 D1이 정한 plate:<key>에 대표 컷 URL을 대신 넣는다.
 */
export function designcutJobFromD1(key: 'A-track-i' | 'B-track-i' | 'C-track-i', withPlates = true): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture(key))
  const features = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  const plan = buildDesigncutPlan(job)!
  const hero = job.section_images.find((s) => s.section === 'hero')!
  const plates = withPlates
    ? plan.sections.filter((s) => s.plateKey).map((s) => ({ ...hero, section: s.plateKey! }))
    : []
  return {
    ...job,
    section_images: [...job.section_images, ...plates],
    section_plan: { ...job.section_plan, designcut: plan },
  }
}
