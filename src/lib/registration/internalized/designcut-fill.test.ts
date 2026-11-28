/**
 * fillacts 페이지 재구성 — 끝 두 자리는 사이즈 → 상품 정보(오너 지시 11-01), 빈 섹션은 본문 섹션으로. 끄면 지금 계획 그대로인지도 본다.
 * 실제 컷·높이는 재지 않는다(R16).
 */

import { describe, expect, it } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { buildImageTasks } from '../pdp-image-tasks'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { D2_SECTION_TARGET, FILL_MESSAGE_ROLE, arrangeFillPage, factsTailOf, messagePieces, readMessageCuts, withInfoSections } from './designcut-fill'
import { buildDesigncutPlan } from './designcut-plan'
import { planExtraShotsForLength, pointCutsOf } from './shot-diversity'

const BASE = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'shotdiv']
const FILL = [...BASE, 'fillacts']
const TAGS = ['#아침 출근길', '#주말 나들이']

function jobOf(features: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  job.spec_sheet = { ...job.spec_sheet, material: 'PE' }
  job.copy_sections = { ...job.copy_sections, final: { ...job.copy_sections.final!, usageSceneTags: TAGS } as never }
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}
const withShots = (job: PdpJobRow): PdpJobRow => ({
  ...job,
  section_plan: { ...job.section_plan, extra_shots: planExtraShotsForLength(job, pointCutsOf(job))! },
})
const planOf = (job: PdpJobRow): DesigncutPlan => buildDesigncutPlan(withShots(job))!
const countOf = (plan: DesigncutPlan) => plan.sections.length + plan.kept.length
const templateOf = (plan: DesigncutPlan, key: string) => plan.sections.find((s) => s.key === key)?.template
/** 플래너가 뺀 역할을 흉내 낸다 — 골격 기록에서 그 섹션을 지운다 */
const withoutSections = (job: PdpJobRow, gone: readonly string[]): PdpJobRow => {
  const persuasion = job.section_plan.internalized_skeleton!.persuasion!
  return {
    ...job,
    section_plan: {
      ...job.section_plan,
      section_order: (job.section_plan.section_order ?? []).filter((k) => !gone.includes(k)),
      internalized_skeleton: {
        ...job.section_plan.internalized_skeleton!,
        persuasion: { ...persuasion, stages: persuasion.stages.filter((s) => !gone.includes(s.section)) },
      },
    },
  }
}

describe('자리', () => {
  it('페이지 끝 두 자리는 사이즈 → 상품 정보다 — 막·질문·마무리·kept는 모두 그 앞이고 기록·판정이 맞다', () => {
    const plan = planOf(jobOf(FILL))
    expect(plan.factsLast).toBe(true)
    expect(templateOf(plan, plan.order.at(-2)!)).toBe('T6')
    expect(plan.order.at(-1)).toBe('long:info')
    const sizeAt = plan.order.length - 2
    const before = (key: string) => expect(plan.order.indexOf(key), key).toBeLessThan(sizeAt)
    for (const act of plan.order.filter((k) => templateOf(plan, k) === 'T10')) before(act)
    before(plan.order.find((k) => templateOf(plan, k) === 'T8')!)
    for (const kept of plan.kept) before(kept)
    expect(factsTailOf(plan)).toEqual({ ok: true, last: plan.order.slice(-2) })
  })

  it('사이즈가 없으면 상품 정보가 맨 끝, 상품 정보가 없으면 사이즈가 맨 끝이다', () => {
    const noSize = planOf({ ...jobOf(FILL), spec_sheet: { ...jobOf(FILL).spec_sheet, size: '' } })
    expect(noSize.sections.some((s) => s.template === 'T6')).toBe(false)
    expect(noSize.order.at(-1)).toBe('long:info')
    expect(factsTailOf(noSize).ok).toBe(true)
    const p = (key: string, template: string) => ({ key, template }) as never
    expect(factsTailOf({ sections: [p('a', 'T8'), p('s', 'T6')], order: ['a', 's'] }).ok).toBe(true)
  })

  it('판정은 어긋남을 잡는다 — 표 뒤에 다른 섹션, 순서 뒤바뀜', () => {
    const p = (key: string, template: string) => ({ key, template }) as never
    const sections = [p('s', 'T6'), p('long:info', 'T9'), p('cta', 'T8')]
    expect(factsTailOf({ sections, order: ['s', 'long:info', 'cta'] })).toEqual({ ok: false, last: ['long:info', 'cta'] })
    expect(factsTailOf({ sections, order: ['cta', 'long:info', 's'] }).ok).toBe(false)
    expect(factsTailOf({ sections, order: ['cta', 's', 'long:info'] }).ok).toBe(true)
  })

  it('같은 템플릿·형태가 3번 이어지지 않는다', () => {
    for (const gone of [[], ['hidden_page', 'point_list_div', 'petit_div', 'perf_reviews']]) {
      const plan = planOf(withoutSections(jobOf(FILL), gone))
      const sig = (k: string) => {
        const s = plan.sections.find((x) => x.key === k)
        return s ? `${s.template}:${s.layoutVariant ?? 'scene'}` : `kept:${k}`
      }
      plan.order.forEach((k, i) => {
        if (i >= 2) expect(sig(k) === sig(plan.order[i - 1]) && sig(k) === sig(plan.order[i - 2]), k).toBe(false)
      })
    }
  })

  it('막과 메시지는 POINT 사이에 끼지 않고, 두 막은 붙지 않는다', () => {
    const plan = planOf(jobOf(FILL))
    const lastPoint = plan.order.reduce((n, k, i) => (plan.sections.find((s) => s.key === k)?.chapter ? i : n), -1)
    const fills = plan.sections.filter((s) => s.template === 'T10' || s.role === FILL_MESSAGE_ROLE)
    for (const s of fills) expect(plan.order.indexOf(s.key)).toBeGreaterThan(lastPoint)
    expect(plan.order.indexOf('long:shot:1') - plan.order.indexOf('long:shot:0')).toBeGreaterThan(1)
  })

  it('순서 짜기 — 막1 → 본문 첫째 → 막2 → 나머지, 메시지는 사이에, 옵션 → 질문 → 마무리 → kept → 사이즈 → 상품 정보', () => {
    const p = (key: string, template: string, role = 'x', chapter: number | null = null) =>
      ({ key, template, role, chapter, text: {}, modules: [] }) as never
    const pieces = [
      p('hook', 'T1'),
      p('point:0', 'T3a', 'usp_feature', 1),
      p('detail', 'T11'),
      p('long:shot:0', 'T10'),
      p('review', 'T12'),
      p('size', 'T6'),
      p('long:info', 'T9'),
      p('long:shot:1', 'T10'),
      p('howto', 'T5'),
      p('option', 'T7'),
      p('long:faq', 'T9'),
      p('cta', 'T8'),
      p('m:0', 'T3a', FILL_MESSAGE_ROLE),
      p('m:1', 'T3a', FILL_MESSAGE_ROLE),
    ]
    const order = (pieces as Array<{ key: string }>).map((x) => x.key)
    order.splice(order.indexOf('m:0'), 0, 'shipping_kept')
    arrangeFillPage(pieces, order)
    expect(order).toEqual([
      'hook',
      'point:0',
      'detail',
      'long:shot:0',
      'm:0',
      'review',
      'm:1',
      'long:shot:1',
      'howto',
      'option',
      'long:faq',
      'cta',
      'shipping_kept',
      'size',
      'long:info',
    ])
  })
})

describe('빈 섹션', () => {
  it('켜면 섹션이 목표 안에서 늘고 한 컷을 두 섹션이 쓰지 않는다', () => {
    const plan = planOf(jobOf(FILL))
    expect(countOf(plan)).toBeGreaterThanOrEqual(18)
    expect(countOf(plan)).toBeLessThanOrEqual(D2_SECTION_TARGET)
    const keys = plan.sections.flatMap((s) => (s.productImageKey ? [s.productImageKey] : []))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('플래너가 뺀 사용 방법·추천 대상을 근거가 있을 때만 되살린다', () => {
    const job = withoutSections(jobOf(FILL), ['hidden_page', 'point_list_div'])
    const plan = planOf(job)
    expect(templateOf(plan, 'hidden_page')).toBe('T5')
    expect(templateOf(plan, 'point_list_div')).toBe('T4')
    const noBasis: PdpJobRow = { ...job, spec_sheet: { ...job.spec_sheet, material: '', keyFeatures: [] } }
    expect(templateOf(planOf(noBasis), 'hidden_page')).toBeUndefined()
  })

  it('옵션 근거가 없으면 옵션 섹션을 더하지 않는다', () => {
    const job = withoutSections(jobOf(FILL), ['petit_div'])
    const none: PdpJobRow = { ...job, spec_sheet: { ...job.spec_sheet, colorOptions: [] }, analysis: { ...job.analysis, option_spec: undefined } as never }
    expect(withInfoSections(none, ['cta'], new Map())).not.toContain('petit_div')
    const two: PdpJobRow = { ...none, spec_sheet: { ...none.spec_sheet, colorOptions: ['빨강', '파랑'] as never } }
    const roles = new Map<string, string>()
    expect(withInfoSections(two, ['cta'], roles)).toEqual(expect.arrayContaining(['petit_div', 'cta']))
    expect(roles.get('petit_div')).toBe('option_catalog')
  })

  it('메시지 — 목표까지만, 페이지 제목과 겹치거나 규제 표현이 든 글은 싣지 않고 컷 기록의 키를 쓴다', () => {
    const job = jobOf(FILL)
    const final = {
      ...job.copy_sections.final!,
      keyMessageCopy: { headline: '손목 착용', subCopy: '겹치는 글' },
      mainCutCopy: { headline: '폰 쓸 때 손목 착용', subCopy: '담는 글' },
      conceptCopy: { headline: '항균 인증 완료', subCopy: '규제 글' },
      productExposure: { headline: '블랙 스트랩이 두 개', subCopy: '함께 든 태그' },
      directionHint: { headline: '설치부터 시작해요', subCopy: '' },
    }
    const next = { ...job, copy_sections: { ...job.copy_sections, final } } as PdpJobRow
    const head = [{ key: 'p', role: 'x', template: 'T3a', text: { headline: '손목 착용' }, modules: [] }] as never
    const cuts = new Map([['product_exposure:body', 'features:11']])
    const out = messagePieces(next, head, 2, cuts)
    expect(out.map((m) => m.key)).toEqual(['product_exposure:body', 'direction_suggest:body'])
    expect(out[0].productImageKey).toBe('features:11')
    expect(out[1].productImageKey).toBe('hero')
    expect(out.every((m) => m.chapter === null && m.template === 'T3a')).toBe(true)
    expect(messagePieces(next, head, 1, cuts)).toHaveLength(1)
    expect(messagePieces(next, head, 0, cuts)).toEqual([])
  })

  it('메시지 형태는 큰 POINT 뒤 순번으로 순환을 잇는다 — 큰 POINT 셋 다음은 half부터, cards는 설명 2~4문장일 때만(적용 D6 P2)', () => {
    const job = jobOf(FILL)
    const final = {
      ...job.copy_sections.final!,
      keyMessageCopy: { headline: '가벼운 무게', subCopy: '한 문장' },
      mainCutCopy: { headline: '넉넉한 수납', subCopy: '첫 문장이에요. 둘째 문장이에요.' },
      conceptCopy: { headline: '매일 드는 가방', subCopy: '한 문장' },
      productExposure: { headline: '부드러운 끈', subCopy: '한 문장' },
      directionHint: { headline: '비 오는 날에도', subCopy: '한 문장' },
    }
    const next = { ...job, copy_sections: { ...job.copy_sections, final } } as PdpJobRow
    const head = [1, 2, 3].map((chapter) => ({ key: `point_div:${chapter - 1}`, role: 'usp_feature', template: 'T3a', chapter, text: { headline: `특징 ${chapter}` }, modules: [] })) as never
    const variants = (j: PdpJobRow, pieces: never, count: number) => messagePieces(j, pieces, count, new Map()).map((m) => m.layoutVariant)
    expect(variants(next, head, 5)).toEqual(['half', 'cards', 'scene', 'zigzag', 'grid'])
    // 머리 변형(D6 P3 T2-40·T2-53) — 메시지 순번대로 지금 머리 → band → rule, 큰 POINT 수와 상관없다
    expect(messagePieces(next, head, 5, new Map()).map((m) => m.headVariant ?? null)).toEqual([null, 'band', 'rule', null, 'band'])
    expect(messagePieces(next, [] as never, 2, new Map()).map((m) => m.headVariant ?? null)).toEqual([null, 'band'])
    // 큰 POINT가 없으면 1번부터
    expect(variants(next, [] as never, 2)).toEqual(['scene', 'zigzag'])
    // cards 차례 설명이 한 문장이면 grid
    const oneLine = { ...next, copy_sections: { ...next.copy_sections, final: { ...final, mainCutCopy: { headline: '넉넉한 수납', subCopy: '한 문장' } } } } as PdpJobRow
    expect(variants(oneLine, head, 2)).toEqual(['half', 'grid'])
  })

  it('메시지 컷은 그 글을 주제로 만든다 — 태스크가 생기고, 뒤에서 본 컷이 아니며, 기록과 계획이 같은 키다', () => {
    const job = withShots(withoutSections(jobOf(FILL), ['hidden_page', 'point_list_div', 'petit_div']))
    const shots = job.section_plan.extra_shots!.shots.filter((s) => s.message)
    expect(shots.length).toBeGreaterThan(0)
    const plan = buildDesigncutPlan(job)!
    const tasks = buildImageTasks(job).map((t) => t.section)
    for (const shot of shots) {
      const section = plan.sections.find((s) => s.key === shot.message)!
      expect(section.productImageKey).toBe(shot.key)
      expect(shot.show).toContain((section.text.headline ?? '').split('\n')[0])
      expect(tasks).toContain(shot.key)
      expect(shot.angle).not.toBe(4)
    }
    expect(readMessageCuts(job.section_plan.extra_shots).size).toBe(shots.length)
  })
})

describe('스위치', () => {
  it('끄면 메시지·추가 정보 섹션이 없고 막 기록도 없다', () => {
    const job = withoutSections(jobOf(BASE), ['hidden_page', 'point_list_div'])
    const plan = planOf(job)
    expect(plan.sections.some((s) => s.role === FILL_MESSAGE_ROLE)).toBe(false)
    expect(templateOf(plan, 'hidden_page')).toBeUndefined()
    expect(templateOf(plan, 'point_list_div')).toBeUndefined()
    expect(withShots(job).section_plan.extra_shots!.acts).toBeUndefined()
    expect(plan.factsLast).toBeUndefined()
  })

  it('K(템플릿 라인) 잡은 재구성을 지나지 않는다', () => {
    const job = withoutSections(jobOf([...FILL, 'templatelib']), ['point_list_div'])
    const plan = planOf(job)
    expect(plan.sections.some((s) => s.role === FILL_MESSAGE_ROLE)).toBe(false)
    expect(templateOf(plan, 'point_list_div')).toBeUndefined()
  })
})
