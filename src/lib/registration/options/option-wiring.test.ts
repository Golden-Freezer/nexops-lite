// T6b 옵션 연결(05_OPTIONS.md §6) — 플래너 골격·카피 블록·수량 묶음 컷·편집기 옵션 섹션·저장본 내보내기 입력.
// optionSpec이 없거나 ENRICHMENT options 기록이 없으면 기존 옵션 규칙 그대로임을 함께 고정한다.

import { describe, expect, it } from 'vitest'
import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import type { DesignPalette } from '@/lib/registration/editor/types/editor'
import { buildPersuasionFlowBlock } from '@/lib/agents/registration/prompts/pdp-internalized-prompts'
import { buildSpecSheetJson } from '@/lib/agents/registration/pdp-copy-defaults'
import { getCorpusSnapshotV2 } from '../corpus-v2'
import { getDesignVocab } from '../design-vocab'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { checkMobileReadability } from '../editor/utils/mobileReadability'
import { convertToCanvasSections } from '../editor/utils/sectionConverter'
import { planPersuasionSkeleton, type PersuasionInput } from '../internalized/persuasion-planner'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { buildImageTasks, needsOptionBundleCut, OPTION_BUNDLE_SECTION, toGeneratedImagesMap } from '../pdp-image-tasks'
import type { EnrichmentRecord } from '../enrichment-switch'
import type { AnalysisResult, PdpJobRow, PdpSpecSheet, SectionImage } from '../pdp-state'
import { FAIRNEX_OPTION_LABELS } from './__fixtures__/fairnex-option-labels'
import { parseOptionLabels, toColorOptions, type OptionSpec } from './option-spec'

const vocab = getDesignVocab()!
const ON: EnrichmentRecord = { version: 1, features: ['vocab', 'persuasion', 'options'] }
const OFF: EnrichmentRecord = { version: 1, features: ['vocab', 'persuasion'] }
const PALETTE: DesignPalette = {
  primary: '#1A1A2E',
  secondary: '#E94560',
  bgMain: '#FFFFFF',
  bgSub: '#F7F7F7',
  textMain: '#333333',
  textHighlight: '#1A1A2E',
}

function specOf(key: keyof typeof FAIRNEX_OPTION_LABELS, photos: Record<string, string> = {}): OptionSpec {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS[key])
  return { ...spec, variants: spec.variants.map((v) => (photos[v.label] ? { ...v, sourceImage: photos[v.label] } : v)) }
}

function input(optionSpec: OptionSpec | undefined, opts: { record?: EnrichmentRecord | null; objections?: string[]; spec?: Partial<PdpSpecSheet>; quick?: boolean } = {}): PersuasionInput {
  const analysis: AnalysisResult = {
    objection_priority: opts.objections ?? ['세척은 어떻게 하나요?'],
    pain_clusters: [{ pain: '정리가 번거로움', urgency: 'medium' }],
    benefit_clusters: [{ name: '편리함', weight: 0.5 }, { name: '디자인', weight: 0.3 }, { name: '가성비', weight: 0.2 }],
    detected_category: 'household',
    ...(opts.record === null ? {} : { enrichment: opts.record ?? ON }),
  }
  return {
    specSheet: {
      productName: '테스트 상품',
      keyFeatures: ['간편한 원터치 사용'],
      material: '플라스틱',
      ...(optionSpec ? { optionSpec, colorOptions: toColorOptions(optionSpec) } : {}),
      ...opts.spec,
    },
    analysis,
    strategyContract: opts.quick
      ? { involvement_level: 'low', page_length_target: 'quick' }
      : { involvement_level: 'low', persuasion_axis: 'function', page_length_target: 'standard' },
    category: 'household',
    snapshotV2: getCorpusSnapshotV2('household'),
    vocab,
  }
}

describe('플래너 — 등록 옵션 구조(variants ≥ 2)', () => {
  it.each(['P02', 'P01', 'P05'] as const)('%s: option_catalog를 넣고 cta 바로 앞(불안 해소 마지막)에 둔다', (key) => {
    const plan = planPersuasionSkeleton(input(specOf(key)))
    const order = plan.sectionOrder
    expect(order).toContain(S.PETIT_DIV)
    expect(order.indexOf(S.PETIT_DIV)).toBe(order.indexOf(S.CTA) - 1)
    const stage = plan.persuasion.stages.find((s) => s.section === S.PETIT_DIV)!
    expect(stage.stage).toBe('ASSURANCE')
    expect(stage.reason).toBe('variants ≥ 2(등록 옵션 구조)')
    expect(plan.persuasion.rules.find((r) => r.id === 'R3')?.pass).not.toBe(false)
  })

  it('수량·크기, 가격·단가 고민은 옵션 섹션이 답한다(치수·이벤트 근거가 없을 때) — 그래도 위치는 마지막', () => {
    const plan = planPersuasionSkeleton(input(specOf('P05'), { objections: ['수량이 충분할까요?', '가격이 비싸지 않을까요?', '세척은 어떻게 하나요?'] }))
    const by = Object.fromEntries(plan.persuasion.objectionCoverage.map((o) => [o.objection, o]))
    expect(by['수량이 충분할까요?'].answeredBy).toBe(S.PETIT_DIV)
    expect(by['가격이 비싸지 않을까요?'].answeredBy).toBe(S.PETIT_DIV)
    expect(by['가격이 비싸지 않을까요?'].note).toContain('가격')
    expect(plan.sectionOrder.indexOf(S.PETIT_DIV)).toBe(plan.sectionOrder.indexOf(S.CTA) - 1)
  })

  it('치수가 있으면 수량·크기 고민은 기존대로 스펙 표가 답한다', () => {
    const plan = planPersuasionSkeleton(input(specOf('P05'), { objections: ['크기가 맞을까요?'], spec: { size: '12×16cm' } }))
    expect(plan.persuasion.objectionCoverage[0].answeredBy).toBe(S.SPEC_TABLE)
  })

  it('짧은 페이지(G3·quick)에서도 옵션 안내는 G3 제한으로 빠지지 않는다', () => {
    const plan = planPersuasionSkeleton(input(specOf('P01'), { quick: true }))
    expect(plan.persuasion.grammar).toBe('G3')
    expect(plan.sectionOrder).toContain(S.PETIT_DIV)
  })

  it('길이 상한이 실제로 섹션을 뺄 때도 옵션 안내는 남는다', () => {
    const rich: Partial<PdpSpecSheet> = {
      reviewsText: '잘 써요', rating: 4.7, certificationInfo: 'KC 인증번호 XU100000-00000', size: '12×16cm',
      targetPersona: '30대 직장인', brandVoiceGuide: '담백하게',
    }
    const objections = ['세척은 어떻게 하나요?', '실내에서도 쓸 수 있나요?', '오래 쓸 수 있나요?']
    const plan = planPersuasionSkeleton(input(specOf('P01'), { spec: rich, objections }))
    expect(plan.excluded.some((e) => e.reason.includes('길이 상한'))).toBe(true)
    expect(plan.sectionOrder).toContain(S.PETIT_DIV)
    expect(plan.sectionOrder.length).toBeLessThanOrEqual(plan.persuasion.lengthTarget[1])
  })

  it('이벤트가 있으면 옵션 안내 → 이벤트 배너 → cta(이벤트는 cta 바로 앞, R5)', () => {
    const order = planPersuasionSkeleton(input(specOf('P02'), { spec: { eventBannerInfo: '첫 구매 쿠폰' } })).sectionOrder
    expect(order.slice(-3)).toEqual([S.PETIT_DIV, S.EVENT_BANNER, S.CTA])
  })

  it('options 기록이 없으면 optionSpec이 있어도 기존 규칙(옵션 ≥ 4) — 2개짜리는 옵션 섹션 없음', () => {
    const off = planPersuasionSkeleton(input(specOf('P02'), { record: OFF }))
    const legacy = planPersuasionSkeleton(input(undefined, { record: OFF, spec: { colorOptions: toColorOptions(specOf('P02')) } }))
    expect(off).toEqual(legacy)
    expect(off.sectionOrder).not.toContain(S.PETIT_DIV)
  })

  it('optionSpec이 없으면 options 기록이 있어도 기존 규칙 그대로(옵션 ≥ 4는 기존 위치·사유)', () => {
    const colorOptions = ['블랙', '화이트', '그레이', '네이비']
    const on = planPersuasionSkeleton(input(undefined, { spec: { colorOptions } }))
    const off = planPersuasionSkeleton(input(undefined, { record: OFF, spec: { colorOptions } }))
    expect(on).toEqual(off)
    expect(on.persuasion.stages.find((s) => s.section === S.PETIT_DIV)?.reason).toBe('옵션 ≥ 4')
  })
})

describe('프롬프트 직렬화 — optionSpec은 넣지 않는다', () => {
  it('카피 스펙 JSON은 optionSpec 없이 기존과 같다(옵션명은 colorOptions로 간다) — 대조군·Track S 프롬프트 불변', () => {
    const spec = specOf('P02')
    const base = { productName: '테스트', colorOptions: toColorOptions(spec) }
    expect(buildSpecSheetJson({ ...base, optionSpec: spec })).toBe(buildSpecSheetJson(base))
  })
})

describe('카피 블록 — 옵션 섹션 규칙', () => {
  it('등록 옵션 구조 잡만 "옵션명 그대로·가격 금지" 규칙을 붙인다', () => {
    const on = buildPersuasionFlowBlock(planPersuasionSkeleton(input(specOf('P02'))).persuasion)
    expect(on).toContain('petit_div는 등록 옵션 안내다')
    expect(on).toContain('가격·할인')
    const legacy = planPersuasionSkeleton(input(undefined, { spec: { colorOptions: ['블랙', '화이트', '그레이', '네이비'] } }))
    expect(buildPersuasionFlowBlock(legacy.persuasion)).not.toContain('petit_div는 등록 옵션 안내다')
  })
})

describe('이미지 단계 — 수량 묶음 컷', () => {
  const job = (optionSpec: OptionSpec | undefined, record: EnrichmentRecord | null = ON, planned = true): PdpJobRow => {
    const base = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    const sections = (base.section_plan.activated_sections ?? []).filter((s) => s !== 'petit_div')
    return {
      ...base,
      section_plan: { ...base.section_plan, activated_sections: planned ? [...sections, 'petit_div'] : sections },
      spec_sheet: { ...base.spec_sheet, productName: '테스트 브러쉬', ...(optionSpec ? { optionSpec } : {}) },
      analysis: { ...base.analysis, ...(record ? { enrichment: record } : { enrichment: undefined }) },
    } as PdpJobRow
  }

  it('수량 축만 있는 옵션(P05·P10)은 묶음 컷 1장을 만든다', () => {
    for (const key of ['P05', 'P10'] as const) {
      const tasks = buildImageTasks(job(specOf(key)))
      const bundle = tasks.filter((t) => t.section === OPTION_BUNDLE_SECTION)
      expect(bundle).toHaveLength(1)
      expect(bundle[0].prompt).toContain('no variations')
      // 구성 숫자는 이미지에 넣지 않는다(옵션 카드 글자가 등록 옵션값을 보여 준다)
      expect(bundle[0].prompt).not.toMatch(/\d+\s*(개|pcs|pieces)/)
    }
  })

  it('텍스트 보유 상품(스티커 등)은 묶음 컷에서도 인쇄 문구를 지우지 않고 그대로 옮기게 한다', () => {
    const base = job(specOf('P05'))
    const sticker = { ...base, spec_sheet: { ...base.spec_sheet, productName: '감사 스티커 50매' } }
    const prompt = buildImageTasks(sticker).find((t) => t.section === OPTION_BUNDLE_SECTION)!.prompt
    expect(prompt).toContain('Reproduce the artwork and lettering printed ON each unit')
    expect(prompt).not.toContain('labels, stickers')
    expect(prompt).not.toContain('The product surface and the background must be completely free of text')
    // 일반 상품은 기존 문구 그대로
    const plain = buildImageTasks(base).find((t) => t.section === OPTION_BUNDLE_SECTION)!.prompt
    expect(plain).toContain('- No packaging, price tags, labels, stickers, numbers or quantity badges')
    expect(plain).toContain('The product surface and the background must be completely free of text, letters, numbers,\n  watermarks, or brand names')
  })

  it('골격에 옵션 섹션이 없으면(플래너가 돌지 않은 잡) 묶음 컷을 만들지 않는다', () => {
    expect(needsOptionBundleCut(job(specOf('P05'), ON, false))).toBe(false)
  })

  it('디자인·색상 축(P01·P02)은 실물 사진을 쓰므로 생성하지 않는다', () => {
    expect(needsOptionBundleCut(job(specOf('P01')))).toBe(false)
    expect(needsOptionBundleCut(job(specOf('P02')))).toBe(false)
  })

  it('options 기록이 없거나 optionSpec이 없으면 태스크 목록이 기존과 같다', () => {
    const before = buildImageTasks(job(undefined)).map((t) => t.section)
    expect(buildImageTasks(job(specOf('P05'), OFF)).map((t) => t.section)).toEqual(before)
    expect(before).not.toContain(OPTION_BUNDLE_SECTION)
  })
})

describe('편집기 — 옵션 섹션(petit_div)', () => {
  // B-track-i 카피는 colorOptions.options가 1개 — 등록 옵션명 덮어쓰기가 없으면 petit_div가 켜지지 않는다
  const fixture = loadEnrichmentFixture('B-track-i')
  const copy = fixture.copy_sections.final as unknown as Parameters<typeof convertToCanvasSections>[0]
  const images = { ...toGeneratedImagesMap(fixture.section_images as unknown as SectionImage[]), [OPTION_BUNDLE_SECTION]: 'https://example.supabase.co/bundle.png' } as Record<string, string | string[]>
  const selection = (gallery: boolean) => ({
    activated_sections: [S.PETIT_DIV as string],
    section_order: [S.PETIT_DIV as string],
    layout_assignments: {},
    ...(gallery ? { option_gallery: true } : {}),
  })
  const petit = (spec: OptionSpec | undefined, gallery: boolean) => {
    const specSheet = { productName: '테스트', ...(spec ? { optionSpec: spec, colorOptions: toColorOptions(spec) } : {}) }
    return convertToCanvasSections(copy, images, PALETTE, selection(gallery), specSheet).find((s) => s.sectionType === S.PETIT_DIV)
  }
  const texts = (sec: ReturnType<typeof petit>) =>
    (sec?.elements ?? []).filter((e) => e.type === 'text').map((e) => e.textProps?.content ?? '')

  it('디자인 옵션: 실물 사진 카드 + 사진 없는 옵션은 이름 칩, 옵션명은 등록명 그대로', () => {
    const spec = specOf('P02', { '20개 데이지(S)': 'https://example.supabase.co/daisy.png' })
    const sec = petit(spec, true)!
    const names = sec.elements.map((e) => e.name ?? '')
    expect(names.some((n) => n.startsWith('option_'))).toBe(true)
    expect(names).not.toContain('petit_img')
    const imageSrcs = sec.elements.filter((e) => e.type === 'image').map((e) => e.imageProps?.src)
    expect(imageSrcs).toContain('https://example.supabase.co/daisy.png')
    expect(imageSrcs).not.toContain('https://example.supabase.co/bundle.png')
    expect(texts(sec).join(' ')).toContain('20개 체리(L)')
  })

  it('수량 옵션: 구성 카드 + 묶음 컷', () => {
    const sec = petit(specOf('P05'), true)!
    expect(texts(sec)).toEqual(expect.arrayContaining(['2개 구성', '4개 구성']))
    expect(sec.elements.some((e) => e.type === 'image' && e.imageProps?.src === 'https://example.supabase.co/bundle.png')).toBe(true)
  })

  it.each(['P01', 'P02', 'P05'] as const)('%s: 연결된 옵션 섹션은 모바일 검사기 M1~M7 위반 0', (key) => {
    const photos = Object.fromEntries(specOf(key).variants.map((v, i) => [v.label, `https://example.supabase.co/v${i}.png`]))
    const sec = petit(specOf(key, photos), true)!
    const { counts, violations } = checkMobileReadability({ sections: [sec] })
    expect(violations).toEqual([])
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })

  it('URL이 아닌 sourceImage(스토리지 경로)는 사진으로 쓰지 않고 이름 칩으로 그린다', () => {
    const sec = petit(specOf('P02', { '20개 데이지(S)': 'user/registration/uploads/daisy.png' }), true)!
    expect(sec.elements.some((e) => e.type === 'image')).toBe(false)
    expect(texts(sec).join(' ')).toContain('20개 데이지(S)')
  })

  it('옵션 갤러리 플래그가 없으면 기존 규칙 — 카피 옵션 1개면 섹션 없음, 여럿이면 pill 그리드', () => {
    const spec = specOf('P02')
    expect(petit(spec, false)).toBeUndefined()
    const a = loadEnrichmentFixture('A-track-i')
    const aCopy = a.copy_sections.final as unknown as Parameters<typeof convertToCanvasSections>[0]
    const legacy = convertToCanvasSections(aCopy, images, PALETTE, selection(false), { productName: '테스트', optionSpec: spec })
      .find((s) => s.sectionType === S.PETIT_DIV)!
    expect(legacy.elements.some((e) => (e.name ?? '').startsWith('petit_opt_txt_'))).toBe(true)
    expect(legacy.elements.some((e) => (e.name ?? '').startsWith('option_'))).toBe(false)
  })
})

describe('편집기 저장본 — 옵션 등록용 내보내기 입력', () => {
  it('저장본 문서에도 optionSpec만 싣는다(그 밖의 spec_sheet는 싣지 않는다)', async () => {
    const spec = specOf('P02')
    const doc = await buildEditorDocument('job-1', {
      is_new: false,
      sections_data: [{ id: 's1', sectionType: S.PETIT_DIV, order: 0, isVisible: true, elements: [], canvas: { height: 100 } }],
      spec_sheet: { productName: '테스트', optionSpec: spec },
    } as unknown as Parameters<typeof buildEditorDocument>[1])
    expect(doc.sourceData.specSheet).toEqual({ optionSpec: spec })
  })
})
