/**
 * 긴 상세페이지 확장 섹션 L-1(PDP-DR-PLAN §7 ②) — 입력 값만 옮기는 크기·구성·관리·보관·구매 전 질문의 행과 설계 단계 근거 판정.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildNumberSources, findUnsupportedNumbers } from './copy-numbers'
import type { CopywritingResult, PdpJobRow, PdpSpecSheet } from './pdp-state'
import { applyDesignSkeleton, resolveDesignSkeleton } from './pdp-enrichment-stage'
import { mergeManualStrategy } from './pdp-strategy-contract'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { getDefaultCopyData } from '@/lib/agents/registration/pdp-copy-defaults'
import { selectAnnotationTargets } from './pdp-annotation-stage'
import {
  careRows,
  COPY_DEFAULT_SCENE_TAGS,
  decideLongSections,
  FAQ_QUESTION,
  faqRows,
  longSceneTags,
  longTables,
  readLongRecord,
  sizeRows,
} from './long-sections'
import { buildImageTasks } from './pdp-image-tasks'

const SPEC = {
  productName: '접이식 실리콘 수납함',
  size: '가로 30cm × 세로 20cm × 높이 12cm',
  weight: '420g',
  material: '식품용 실리콘, PP',
  usageLocation: '주방 싱크대 하부장',
  certificationInfo: 'KC 생활용품 안전확인 신고',
  extraSpecs: [
    { key: '구성품', value: '수납함 2개, 칸막이 4개' },
    { key: '세척 방법', value: '미지근한 물에 중성세제로 닦아 주세요' },
    { key: '보관 주의', value: '직사광선을 피해 보관하세요' },
    { key: '원산지', value: '중국' },
  ],
} as unknown as PdpSpecSheet

const OBJECTIONS = [
  { objection: '사이즈가 하부장에 맞을까', type: 'quantity_size' },
  { objection: '소재가 안전한지', type: 'safety_cert' },
  { objection: '세척이 번거로울까', type: 'usage_care' },
  { objection: '가격이 비싸지 않을까', type: 'price_value' },
  { objection: '어디에 두고 쓰나', type: 'environment_versatility' },
  { objection: '크기가 충분할까', type: 'quantity_size' },
]

const plain = (rows: Array<{ label: string; value: string }>) => rows.map(({ label, value }) => ({ label, value }))

describe('후보 행 — 입력 값 그대로', () => {
  it('크기·구성: 사이즈·무게 + 추가 스펙의 구성 행(관리 행·그 밖의 행은 빼고)', () => {
    expect(sizeRows(SPEC)).toEqual([
      { label: '사이즈', value: '가로 30cm × 세로 20cm × 높이 12cm' },
      { label: '무게', value: '420g' },
      { label: '구성품', value: '수납함 2개, 칸막이 4개' },
    ])
  })

  it('관리·보관: 추가 스펙의 세척·보관·주의 행만', () => {
    expect(careRows(SPEC).map((r) => r.label)).toEqual(['세척 방법', '보관 주의'])
    expect(careRows({})).toEqual([])
  })

  it('구매 전 질문: 고민 순서대로 유형마다 한 번, 고정 질문 + 입력 값 답(추가 스펙 행은 이름을 붙인다), 답할 입력이 없는 고민은 묻지 않는다', () => {
    const rows = faqRows(SPEC, OBJECTIONS)
    expect(rows.map((r) => r.label)).toEqual([
      `Q. ${FAQ_QUESTION.quantity_size}`,
      `Q. ${FAQ_QUESTION.safety_cert}`,
      `Q. ${FAQ_QUESTION.usage_care}`,
      `Q. ${FAQ_QUESTION.environment_versatility}`,
    ])
    expect(rows[0].value).toBe('A. 가로 30cm × 세로 20cm × 높이 12cm · 구성품: 수납함 2개, 칸막이 4개')
    expect(rows[0].items).toEqual(['가로 30cm × 세로 20cm × 높이 12cm', '수납함 2개, 칸막이 4개'])
    expect(rows[1].value).toBe('A. KC 생활용품 안전확인 신고')
    expect(rows[2].value).toBe('A. 세척 방법: 미지근한 물에 중성세제로 닦아 주세요 · 보관 주의: 직사광선을 피해 보관하세요')
    // 유형을 기록하지 않은 고민은 분류기로 읽는다
    expect(faqRows(SPEC, [{ objection: '어디서 쓰기 좋을지' }]).map((r) => r.value)).toEqual(['A. 주방 싱크대 하부장'])
  })

  it('답에 새 숫자·단위가 없다 — P0-2 숫자·단위 대조(입력에 없는 숫자+단위)가 걸리지 않는다', () => {
    const tables = longTables(['size', 'care', 'faq'], SPEC, OBJECTIONS, [], false)
    const asCopy = { longSections: tables.flatMap((t) => t.rows.map((r) => ({ q: r.label, a: r.value }))) }
    expect(findUnsupportedNumbers(asCopy as unknown as CopywritingResult, buildNumberSources(SPEC))).toEqual([])
  })
})

describe('표 — 같은 값 한 번, 규제 표현 제외', () => {
  it('크기·구성 → 관리·보관 → 질문 순서로 앞 표에 실린 값은 뒤 표(질문 답)에서 빠진다', () => {
    const tables = longTables(['size', 'care', 'faq'], SPEC, OBJECTIONS)
    expect(tables.map((t) => t.kind)).toEqual(['size', 'care', 'faq'])
    const faq = tables.find((t) => t.kind === 'faq')!
    expect(plain(faq.rows)).toEqual([
      { label: `Q. ${FAQ_QUESTION.safety_cert}`, value: 'A. KC 생활용품 안전확인 신고' },
      { label: `Q. ${FAQ_QUESTION.environment_versatility}`, value: 'A. 주방 싱크대 하부장' },
    ])
  })

  it('같은 표 안에서도 한 번 — 무게 칸과 추가 스펙 무게 행이 같으면 하나만', () => {
    const spec = { ...SPEC, extraSpecs: [...(SPEC.extraSpecs ?? []), { key: '무게', value: '420g' }] }
    const [size] = longTables(['size'], spec, [])
    expect(size.rows.filter((r) => r.value === '420g')).toHaveLength(1)
  })

  it('규제 표현(항균·친환경·생분해 등)이 든 입력 값은 싣지 않는다 — 인증 정보가 뒷받침하는 인증 표현은 싣는다', () => {
    const spec = {
      ...SPEC,
      material: '친환경 생분해 PLA',
      certificationInfo: 'KC 인증/식약처 신고',
      extraSpecs: [
        { key: '세척 방법', value: '항균 코팅이라 물로 헹구면 됩니다' },
        { key: '보관', value: '서늘한 곳에 보관하세요' },
      ],
    }
    const objections = [
      { objection: '소재가 뭔지', type: 'material_eco' },
      { objection: '인증이 있는지', type: 'safety_cert' },
      { objection: '어디서 쓰나', type: 'environment_versatility' },
    ]
    const tables = longTables(['care', 'faq'], spec, objections)
    expect(tables.find((t) => t.kind === 'care')!.rows.map((r) => r.label)).toEqual(['보관'])
    const faq = tables.find((t) => t.kind === 'faq')!
    expect(faq.rows.map((r) => r.label)).toEqual([`Q. ${FAQ_QUESTION.safety_cert}`, `Q. ${FAQ_QUESTION.environment_versatility}`])
    expect(faq.rows[0].value).toBe('A. KC 인증 · 식약처 신고')
  })

  it('인증 정보는 낱낱으로 본다 — 페이지에 이미 보인 인증(KC 인증)은 빼고 남은 것만 답한다', () => {
    const spec = { ...SPEC, certificationInfo: 'KC 인증/식약처 신고' }
    const [faq] = longTables(['faq'], spec, [{ objection: '인증', type: 'safety_cert' }, { objection: '어디서', type: 'environment_versatility' }], [
      'KC 인증',
    ])
    expect(faq.rows[0].value).toBe('A. 식약처 신고')
  })
})

describe('설계 단계 근거 판정', () => {
  it('겹침·규제 표현을 뺀 표가 최소 행 수 이상인 것만 남기고, 뺀 것은 사유와 함께', () => {
    const record = decideLongSections(SPEC, OBJECTIONS)
    expect(record).toEqual({ version: 1, kinds: ['size', 'care', 'faq'], excluded: [], images: true })
    const thin = decideLongSections({ size: '30cm' }, [{ objection: '가격', type: 'price_value' }])
    expect(thin.kinds).toEqual([])
    expect(thin.excluded).toEqual([
      { kind: 'size', reason: '근거 1개(최소 2개)' },
      { kind: 'care', reason: '입력 근거 없음' },
      { kind: 'faq', reason: '입력 근거 없음' },
    ])
  })

  it('기록 읽기 — 형식이 틀리면 null, 모르는 종류는 버린다', () => {
    expect(readLongRecord(decideLongSections(SPEC, OBJECTIONS))?.kinds).toEqual(['size', 'care', 'faq'])
    expect(readLongRecord({ version: 1, kinds: ['faq', 'idea'] })?.kinds).toEqual(['faq'])
    expect(readLongRecord({ version: 2, kinds: [] })).toBeNull()
    expect(readLongRecord({ version: 1 })).toBeNull()
    expect(readLongRecord(undefined)).toBeNull()
  })
})

describe('설계 단계 기록 — section_plan.long', () => {
  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'split', 'lean', 'audience']
  const designed = (features: string[]) => {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    job.spec_sheet = { ...job.spec_sheet, ...SPEC, productName: job.spec_sheet.productName }
    job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
    return applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  }

  it('long 기록 잡은 설득 기록의 고민으로 근거를 판정해 남기고, 골격(섹션 순서)은 long이 없는 잡과 같다', () => {
    const on = designed([...ON, 'long'])
    const off = designed(ON)
    // 판정이 읽는 칸(사이즈·무게·소재·사용 장소·인증·추가 스펙)은 모두 SPEC 값이다
    expect(on.long).toEqual(decideLongSections(SPEC, on.internalized_skeleton!.persuasion!.objectionCoverage))
    expect(on.long!.kinds).toContain('size')
    expect(off.long).toBeUndefined()
    expect(on.section_order).toEqual(off.section_order)
  })
})

describe('L-2 이미지 확장 — 디테일 근접·사용 장면 컷', () => {
  // 컷 배정 시험이라 길이 채움을 끈다 — 채움 섹션(point_list_div)이 피처 컷 자리를 하나 쓴다
  beforeEach(() => vi.stubEnv('NEXOPS_PDP_SECTION_TARGET', '1,18'))
  afterEach(() => vi.unstubAllEnvs())

  const ON = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'split', 'lean', 'audience']
  const TAGS = ['#캠핑', '#차박', '#피크닉', '#집들이']
  const job = (features: string[]) => {
    const j = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    j.analysis = { ...j.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
    const strategy = mergeManualStrategy(j.analysis.recommended_strategy_contract ?? {}, j.spec_sheet, [])
    j.section_plan = applyDesignSkeleton(j.section_plan, resolveDesignSkeleton(j, strategy))
    j.copy_sections = { ...j.copy_sections, final: { ...j.copy_sections.final!, usageSceneTags: TAGS } }
    return j
  }
  const sections = (j: PdpJobRow) => buildImageTasks(j).map((t) => t.section)

  it('사용 장면 태그 — # 뗀 낱말 앞 3개, 같은 것은 한 번, 2개 미만이거나 골격에 태그 섹션이 있으면 없다', () => {
    expect(longSceneTags(['#캠핑', '캠핑', '#차박', '#피크닉', '#집들이'], ['sub_div'])).toEqual(['캠핑', '차박', '피크닉'])
    expect(longSceneTags(['#캠핑'], [])).toEqual([])
    expect(longSceneTags(TAGS, ['sub2_div_page'])).toEqual([])
    expect(longSceneTags(undefined, [])).toEqual([])
    // 카피 기본값(카피가 비우면 채우는 태그)은 근거가 아니다 — 장면 컷·캡션을 만들지 않는다
    const defaults = (getDefaultCopyData({} as PdpSpecSheet).usageSceneTags ?? []).map((t) => t.replace(/^#+/, ''))
    expect(new Set(defaults)).toEqual(COPY_DEFAULT_SCENE_TAGS)
    expect(longSceneTags(['#일상', '#실용적', '#필수품'], [])).toEqual([])
    expect(longSceneTags(['#일상', '#캠핑', '#차박'], [])).toEqual(['캠핑', '차박'])
  })

  it('long 잡(골격에 sub_div): 특징 5·6번 매크로 컷 + 사용 장면 컷 3장 — 새 컷 5장 이내, lean이 남긴다. 1~4번 피처 컷은 예전 그대로', () => {
    const on = job([...ON, 'long'])
    const off = job(ON)
    expect(on.section_plan.section_order).toContain('sub_div')
    const onTasks = buildImageTasks(on)
    const offTasks = buildImageTasks(off)
    const added = sections(on).filter((s) => !sections(off).includes(s))
    expect(added).toEqual(['features:4', 'features:5', 'long_scene:0', 'long_scene:1', 'long_scene:2'])
    expect(added.length).toBeLessThanOrEqual(5)
    for (const key of ['features:4', 'features:5']) {
      expect(onTasks.find((t) => t.section === key)!.prompt, key).toContain('SHOT (detail close-up): macro view')
    }
    for (const key of ['features:0', 'features:3', 'usage']) {
      expect(onTasks.find((t) => t.section === key)?.prompt, key).toBe(offTasks.find((t) => t.section === key)?.prompt)
    }
    const scene = onTasks.find((t) => t.section === 'long_scene:1')!
    expect(scene.prompt).toContain('SCENE FOCUS: 차박')
    expect(scene.prompt).toContain('- Scene: 차박')
    expect(scene.prompt).toContain('Scene 2 of 3')
    expect(scene.prompt).not.toContain('Aspect Ratio: 3:4')
    expect(scene.aspectRatio).toBe('1:1')
  })

  it('L-1 기록만 있는 잡(설계 기록에 images 칸 없음)은 새 컷이 없다 — 완료 잡이 images 단계로 돌아가지 않는다', () => {
    const on = job([...ON, 'long'])
    const { images: _images, ...l1Only } = on.section_plan.long!
    const before = { ...on, section_plan: { ...on.section_plan, long: l1Only } }
    expect(sections(before)).toEqual(sections(job(ON)))
  })

  it('디테일 근접 매크로 컷(특징 5·6번)은 장식하지 않고 상한에도 세지 않는다 — 1~4번 장식은 매크로가 없을 때와 같다', () => {
    const on = job([...ON, 'long'])
    const others = on.section_images.filter((e) => !e.section.startsWith('features:'))
    const cuts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ section: `features:${i}`, url: `https://cdn.test/f${i}.png` })) as PdpJobRow['section_images']
    const four = selectAnnotationTargets({ ...on, section_images: [...others, ...cuts(4)] })
    const six = selectAnnotationTargets({ ...on, section_images: [...others, ...cuts(6)] })
    expect(six).toEqual(four)
    expect(six.some((t) => t.section === 'features:4' || t.section === 'features:5')).toBe(false)
  })
})
