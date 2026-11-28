/**
 * 디자인 컷 긴 페이지(designlong) — 사실 표(T9)·자세히 보기(T10) 막을 계획에 끼우고, 계약·생성 필터·조립이 그대로 받는다.
 * 원칙: 사진이 아니라 정보를 늘린다(사실이 없으면 막 없음, 추가 컷은 이미지 쪽 기록 extra_shots만). LLM·DB 없음.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { buildImageTasks } from '../pdp-image-tasks'
import type { DesigncutPlan, PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { resolveEnabledFeatures } from '../enrichment-switch'
import { decideLongSections, FAQ_ANSWER_PREFIX, FAQ_QUESTION_PREFIX, withoutFaqPrefix } from '../long-sections'
import { buildDesigncutPlan } from './designcut-plan'
import { designcutTaskFilter } from './designcut-images'
import { readExtraShots } from './designcut-long'
import { readDesignCut } from '../editor/utils/sectionConverter/designCut/contract'
import { composeDesignCut } from '../editor/utils/sectionConverter/designCut/compose'

const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut']
const FACTS = {
  material: '종이',
  origin: '중국',
  size: '길이 30cm',
  weight: '20g',
  extraSpecs: [
    { key: '구성', value: '본체 1개와 리필 캡 2개' },
    { key: '보관 방법', value: '직사광선을 피해 서늘한 곳에 보관' },
  ],
}

/** A-track-i 디자인 컷 잡 — 사실 입력·설계 기록(section_plan.long)·이미지 쪽 기록(extra_shots)을 바꿔 끼운다 */
function job(features: string[], opts: { facts?: boolean; extraShots?: unknown; size?: string } = {}): PdpJobRow {
  const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  // 고정물에는 소재 값이 있다 — '사실 없음' 경우는 소재·원산지를 지운다
  j.spec_sheet = (opts.facts ? { ...j.spec_sheet, ...FACTS } : { ...j.spec_sheet, material: undefined, origin: undefined }) as PdpJobRow['spec_sheet']
  if (opts.size) j.spec_sheet = { ...j.spec_sheet, size: opts.size }
  const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
  j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
  const objections = j.section_plan.internalized_skeleton?.persuasion?.objectionCoverage ?? []
  j.section_plan = {
    ...j.section_plan,
    long: decideLongSections(j.spec_sheet, objections),
    ...(opts.extraShots ? { extra_shots: opts.extraShots } : {}),
  } as PdpJobRow['section_plan']
  return j
}
const longKeys = (p: DesigncutPlan) => p.sections.filter((s) => s.key.startsWith('long:')).map((s) => `${s.key}:${s.template}`)
const SHOTS = {
  version: 1,
  shots: [
    { key: 'long_scene:0', purpose: 'scene', caption: '캠핑장 테이블에서' },
    { key: 'features:6', purpose: 'texture', caption: '종이 꽃가루 근접' },
    { key: 'hero', purpose: 'scene', caption: '형식 밖 키' },
    { key: 'long_scene:1', purpose: 'mood', caption: '목적 밖' },
  ],
}

describe('스위치 — designcut과 함께만 기록(기본 on, K4 운영 전환)', () => {
  it('designcut과 함께면 기록하고, designcut을 빼면 기록하지 않는다', () => {
    expect(resolveEnabledFeatures({})).toContain('designlong')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('designlong')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('designlong')
  })
})

describe('긴 막 — 사실이 있을 때만, 사진은 이미지 쪽 기록만', () => {
  it('designlong이 없으면 사실·기록이 있어도 계획이 지금 그대로다', () => {
    const off = buildDesigncutPlan(job(ON, { facts: true, extraShots: SHOTS }))!
    expect(longKeys(off)).toEqual([])
  })

  it('사실 입력이 없고 기록도 없으면 긴 막이 없다(사진으로 길이를 채우지 않는다)', () => {
    expect(longKeys(buildDesigncutPlan(job([...ON, 'designlong']))!)).toEqual([])
  })

  it('사실 표: 소재·원산지와 크기·구성은 치수(T6) 뒤, 관리·보관은 사용 단계(T5) 뒤 — 행은 입력 값 그대로', () => {
    const p = buildDesigncutPlan(job([...ON, 'designlong'], { facts: true }))!
    const order = p.sections.map((s) => s.key)
    const after = (key: string) => order[order.indexOf(key) - 1]
    const t6 = p.sections.find((s) => s.template === 'T6')!.key
    const t5 = p.sections.find((s) => s.template === 'T5')!.key
    expect(after('long:material')).toBe(t6)
    expect(after('long:size')).toBe('long:material')
    expect(after('long:care')).toBe(t5)
    const rows = (key: string) => p.sections.find((s) => s.key === key)!.modules.find((m) => m.type === 'M9')!.data
    expect(rows('long:material')).toEqual({ rows: [{ label: '소재', value: '종이' }, { label: '원산지', value: '중국' }] })
    expect(rows('long:care')).toEqual({ rows: [{ label: '보관 방법', value: '직사광선을 피해 서늘한 곳에 보관' }] })
    expect(p.order.indexOf('long:size')).toBeGreaterThan(p.order.indexOf(t6))
    // 표는 사진이 없다 — 생성 필터에 새 키가 없다
    expect(p.sections.filter((s) => s.template === 'T9').every((s) => s.productImageKey === null)).toBe(true)
  })

  it('자세히 보기: 이미지 쪽 기록의 형식 맞는 컷만 기록 순서대로, 캡션은 기록 그대로 — 생성 필터가 그 키만 통과시킨다', () => {
    expect(readExtraShots(SHOTS)).toEqual([
      { imageKey: 'long_scene:0', caption: '캠핑장 테이블에서' },
      { imageKey: 'features:6', caption: '종이 꽃가루 근접' },
    ])
    const p = buildDesigncutPlan(job([...ON, 'designlong'], { extraShots: SHOTS }))!
    // D2가 아닌 designlong 잡은 예전처럼 한 막에 쌓는다(D2는 컷 하나가 섹션 하나)
    const shots = p.sections.find((s) => s.key === 'long:shots')!
    expect(shots.template).toBe('T10')
    const filter = designcutTaskFilter(p)!
    expect(filter('long_scene:0')).toBe(true)
    expect(filter('features:6')).toBe(true)
    expect(filter('long_scene:1')).toBe(false)
    // 1장뿐이면 막이 없다
    const one = { version: 1, shots: [SHOTS.shots[0]] }
    expect(longKeys(buildDesigncutPlan(job([...ON, 'designlong'], { extraShots: one }))!)).toEqual([])
  })

  it('크기 도식(T6)이 사이즈 원문의 축을 모두 그리면, 크기 표가 같은 사이즈 행을 빼도 정보가 남는다(R10-L-P02 사이즈 결함)', () => {
    const size = '16.5cm x 20.7cm(데이지 S)'
    const p = buildDesigncutPlan(job([...ON, 'designlong'], { facts: true, size }))!
    const t6 = p.sections.find((s) => s.template === 'T6')!
    const dims = t6.modules.find((m) => m.type === 'M4')!.data
    // 예전에는 '첫 숫자+단위'로 떨어져 가로 16.5cm 한 축만 그렸고, 크기 표는 원문이 이미 보였다며 사이즈 행을 뺐다(세로 정보가 사라짐)
    expect(dims.dims.map((d) => [d.axis, d.value, d.unit])).toEqual([
      ['w', 16.5, 'cm'],
      ['h', 20.7, 'cm'],
    ])
    expect(dims.raw).toBe(size)
    const sizeRows = p.sections.find((s) => s.key === 'long:size')?.modules.find((m) => m.type === 'M9')?.data.rows ?? []
    expect(sizeRows.some((r) => r.label === '사이즈')).toBe(false)
  })

  it('후기 질문(section_plan.long.reviewFaq)은 구매 전 질문 표의 앞줄로 계획에 실리고, 조립이 위에서 아래로 그린다(사진 없음)', () => {
    const items = [
      { question: '바닥에서 밀리지 않나요?', answer: '무거워서 밀리지 않아서 편하게 써요.' },
      { question: '설거지가 번거롭지 않나요?', answer: '그릇이 분리돼서 씻기 편해요.' },
    ]
    const j = job([...ON, 'designlong'], { facts: true })
    const objections = j.section_plan.internalized_skeleton?.persuasion?.objectionCoverage ?? []
    j.section_plan = {
      ...j.section_plan,
      long: decideLongSections(j.spec_sheet, objections, items, { kept: 2, dropped: 0 }),
    } as PdpJobRow['section_plan']
    const p = buildDesigncutPlan(j)!
    const faq = p.sections.find((s) => s.key === 'long:faq')!
    expect(faq.template).toBe('T9')
    expect(faq.productImageKey).toBeNull()
    const rows = faq.modules.find((m) => m.type === 'M9')!.data.rows
    expect(rows.slice(0, 2).map((r) => r.label)).toEqual(items.map((i) => `Q. ${i.question}`))
    expect(rows[0].value).toContain(items[0].answer)
    const read = readDesignCut({ ...j.section_plan, designcut: p })!
    const out = composeDesignCut([], read, {
      images: { hero: 'https://img.test/hero.png', features: [] },
      sectionOrder: j.section_plan.section_order ?? [],
    })
    const elements = out.flatMap((s) => s.elements)
    // 그린 글은 접두를 떼고 Q 표식을 앞에 둔다(적용 T1-66 D — 표식·폭은 편집기 designCut-faq.test가 본다)
    const tops = rows.slice(0, 2).map((r) => elements.find((e) => e.textProps?.content === withoutFaqPrefix(r.label, FAQ_QUESTION_PREFIX))!)
    const answer = elements.find((e) => e.textProps?.content === withoutFaqPrefix(rows[0].value, FAQ_ANSWER_PREFIX))!
    expect(tops.every(Boolean) && Boolean(answer)).toBe(true)
    const bottom = (e: (typeof elements)[number]) => e.transform.y + e.transform.height
    expect(answer.transform.y).toBeGreaterThanOrEqual(bottom(tops[0]))
    expect(tops[1].transform.y).toBeGreaterThanOrEqual(bottom(answer))
  })

  it('계약이 T9·T10·M9·M10을 그대로 읽고, 조립이 표·컷을 그린다(컷 URL 없는 항목은 뺀다)', () => {
    const j = job([...ON, 'designlong'], { facts: true, extraShots: SHOTS })
    const p = buildDesigncutPlan(j)!
    const read = readDesignCut({ ...j.section_plan, designcut: p })!
    expect(longKeys(read)).toEqual(longKeys(p))
    const images = {
      hero: 'https://img.test/hero.png',
      'long_scene:0': 'https://img.test/scene0.png',
      features: Array.from({ length: 7 }, (_, i) => `https://img.test/f${i}.png`),
    }
    const out = composeDesignCut([], read, { images, sectionOrder: j.section_plan.section_order ?? [] })
    const texts = out.flatMap((s) => s.elements.map((e) => e.textProps?.content ?? ''))
    expect(texts).toEqual(expect.arrayContaining(['소재·원산지', '종이', '원산지', '중국', '보관 방법']))
    const srcs = out.flatMap((s) => s.elements.map((e) => e.imageProps?.src ?? e.framedImageProps?.src ?? ''))
    expect(srcs).toEqual(expect.arrayContaining(['https://img.test/scene0.png', 'https://img.test/f6.png']))
    expect(texts).toEqual(expect.arrayContaining(['캠핑장 테이블에서', '종이 꽃가루 근접']))
  })
})

describe('D2 추가 컷 — 컷 하나가 섹션 하나(오너 지시 11-01)', () => {
  const images = {
    hero: 'https://img.test/hero.png',
    'long_scene:0': 'https://img.test/scene0.png',
    features: Array.from({ length: 7 }, (_, i) => `https://img.test/f${i}.png`),
  }

  it('한 장으로 그리고 캡션을 제목으로 쓴다 — 컷이 없는 섹션은 그리지 않는다', () => {
    const j = job([...ON, 'designcut2'], { extraShots: SHOTS })
    const p = buildDesigncutPlan(j)!
    expect(p.sections.filter((s) => s.template === 'T10').map((s) => s.key)).toEqual(['long:shot:0', 'long:shot:1'])
    const read = readDesignCut({ ...j.section_plan, designcut: p })!
    const out = composeDesignCut([], read, { images, sectionOrder: j.section_plan.section_order ?? [] })
    const texts = out.flatMap((s) => s.elements.map((e) => e.textProps?.content ?? ''))
    expect(texts).toEqual(expect.arrayContaining(['캠핑장 테이블에서', '종이 꽃가루 근접']))
    const srcs = out.flatMap((s) => s.elements.map((e) => e.imageProps?.src ?? e.framedImageProps?.src ?? ''))
    expect(srcs).toEqual(expect.arrayContaining(['https://img.test/scene0.png', 'https://img.test/f6.png']))

    const noScene = composeDesignCut([], read, { images: { ...images, 'long_scene:0': undefined } as never, sectionOrder: j.section_plan.section_order ?? [] })
    const noSceneTexts = noScene.flatMap((s) => s.elements.map((e) => e.textProps?.content ?? ''))
    expect(noSceneTexts).not.toContain('캠핑장 테이블에서')
    expect(noSceneTexts).toContain('종이 꽃가루 근접')
  })

  it('예전 계획의 한 막(long:shots)은 그대로 그린다 — 저장된 잡을 다시 그려도 깨지지 않는다', () => {
    const j = job([...ON, 'designlong'], { extraShots: SHOTS })
    const read = readDesignCut({ ...j.section_plan, designcut: buildDesigncutPlan(j)! })!
    const out = composeDesignCut([], read, { images, sectionOrder: j.section_plan.section_order ?? [] })
    const srcs = out.flatMap((s) => s.elements.map((e) => e.imageProps?.src ?? e.framedImageProps?.src ?? ''))
    expect(srcs).toEqual(expect.arrayContaining(['https://img.test/scene0.png', 'https://img.test/f6.png']))
  })
})

describe('디자인 컷 잡도 피처 프롬프트를 그 특징과 맞춘다(#359 ①, 2026-10-31 통합 점검)', () => {
  it('설계 3개(10개 대용량 없음) — D2 잡의 features:2는 카피, features:3은 간편 정리 설계 프롬프트', () => {
    const j = job([...ON, 'designcut2'])
    j.design_prompts = {
      ...(j.design_prompts ?? {}),
      feature_prompts: [
        { title: '원터치로 바로 터지는 작동', positive: 'DESIGN-ONE hands pressing' },
        { title: '화려한 컬러 꽃가루가 흩날리는 장면', positive: 'DESIGN-COLOR confetti' },
        { title: '간편 정리 — 종이 꽃가루는 쓸어 담기 쉽다', positive: 'DESIGN-TIDY sweeping' },
      ],
    } as PdpJobRow['design_prompts']
    const promptOf = (key: string) => buildImageTasks(j).find((t) => t.section === key)?.prompt ?? ''
    expect(promptOf('features:2')).not.toBe('')
    expect(promptOf('features:2')).not.toMatch(/DESIGN-/)
    expect(promptOf('features:3')).toContain('DESIGN-TIDY')
  })
})
