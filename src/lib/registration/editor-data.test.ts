/**
 * assembleEditorDataResponse 단위 테스트 — DB 무접근(순수 조립 로직만).
 * conversion_cta = cta 재사용(원본 C-A3)은 verifier가 적발한 실결함의 회귀 가드:
 * 누락 시 convert_div 섹션이 에디터에서만 이미지 없이 빌드된다.
 */

import { describe, it, expect } from 'vitest'
import { assembleEditorDataResponse, motionClipsOf, usesMobileFloor, type EditorDataRow } from './editor-data'
import { buildEditorDocument } from './editor/utils/buildEditorDocument'
import { makeTextEl } from './editor/utils/sectionConverter/elements'
import type { PdpJobRow, SectionMotion } from './pdp-state'

function fakeJob(overrides: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    business_id: null,
    draft_id: null,
    spec_sheet: { productName: '테스트 상품' },
    source_images: [],
    image_model: 'gpt-image-2',
    image_quality: 'high',
    mode: 'pro',
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: { activated_sections: ['main_intro'] },
    copy_sections: { final: { mainIntro: { title: 't' } } },
    section_images: [
      { section: 'hero', url: 'https://x/hero.png' },
      { section: 'cta', url: 'https://x/cta.png' },
      { section: 'features:0', url: 'https://x/f0.png' },
      { section: 'features:1', url: 'https://x/f1.png' },
    ],
    final_html: null,
    current_step: 'done',
    progress: 100,
    error: null,
    cost_usd: 0,
    created_at: '2026-08-11T00:00:00Z',
    updated_at: '2026-08-11T00:00:00Z',
    ...overrides,
  } as PdpJobRow
}

describe('assembleEditorDataResponse', () => {
  it('conversion_cta가 없으면 cta를 재사용한다 (원본 C-A3 규칙)', () => {
    const res = assembleEditorDataResponse(fakeJob(), null)
    const images = res.generated_images as Record<string, unknown>
    expect(images.conversion_cta).toBe('https://x/cta.png')
    expect(images.cta).toBe('https://x/cta.png')
  })

  it('파이프라인이 conversion_cta를 직접 저장했으면 덮어쓰지 않는다', () => {
    const job = fakeJob({
      section_images: [
        { section: 'cta', url: 'https://x/cta.png' },
        { section: 'conversion_cta', url: 'https://x/conv.png' },
      ],
    })
    const images = assembleEditorDataResponse(job, null).generated_images as Record<string, unknown>
    expect(images.conversion_cta).toBe('https://x/conv.png')
  })

  it('리스트형 키(features:i)는 배열로 접힌다', () => {
    const images = assembleEditorDataResponse(fakeJob(), null).generated_images as Record<string, unknown>
    expect(images.features).toEqual(['https://x/f0.png', 'https://x/f1.png'])
  })

  it('저장본이 없으면 is_new=true, 있으면 저장 상태를 그대로 싣는다', () => {
    expect(assembleEditorDataResponse(fakeJob(), null).is_new).toBe(true)
    const row: EditorDataRow = {
      id: 'row-1',
      user_id: 'user-1',
      pdp_job_id: 'job-1',
      sections_data: [{ id: 's1' }],
      layout_assignments: { s1: 'preset-1' },
      updated_at: '2026-08-11T00:00:00Z',
    }
    const res = assembleEditorDataResponse(fakeJob(), row)
    expect(res.is_new).toBe(false)
    expect(res.sections_data).toEqual([{ id: 's1' }])
    expect(res.layout_assignments).toEqual({ s1: 'preset-1' })
  })
})

describe('assembleEditorDataResponse — Track I 테마 매핑(편집기·final_html 일치)', () => {
  const plan = {
    activated_sections: ['main_cut', 'hidden_page', 'cta'],
    internalized_skeleton: { roles: [], excluded: [], persuasion: { grammar: 'G1' } },
  } as unknown as PdpJobRow['section_plan']
  const base = {
    generation_track: 'internalized' as const,
    section_plan: plan,
  }

  it('ENRICHMENT persuasion 잡은 정정 매핑으로 테마를 펼친다(hidden_page = how_to_guide 레시피)', () => {
    const enriched = assembleEditorDataResponse(
      fakeJob({
        ...base,
        analysis: { detected_category: 'household', enrichment: { version: 1, features: ['vocab', 'persuasion'] } },
      }),
      null
    )
    const legacy = assembleEditorDataResponse(fakeJob({ ...base, analysis: { detected_category: 'household' } }), null)
    const enrichedTheme = enriched.internalized_theme as Record<string, unknown> | null
    const legacyTheme = legacy.internalized_theme as Record<string, unknown> | null
    expect(enrichedTheme).toBeTruthy()
    expect(legacyTheme).toBeTruthy()
    // 기존 매핑에서 hidden_page는 faq 레시피, 정정 매핑에서는 how_to_guide 레시피(또는 레시피 없음)
    expect(JSON.stringify(enrichedTheme?.hidden_page ?? null)).not.toBe(
      JSON.stringify(legacyTheme?.hidden_page ?? null)
    )
  })
})

describe('모바일 하한 적용 잡(T3m) — mobile_floor', () => {
  it('Track S(standard)·mobile 기록 잡은 적용, Track I 무기록 잡(구 잡·대조군)은 미적용', () => {
    const recorded = {
      activated_sections: ['main_intro'],
      enrichment: { version: 1 as const, features: ['vocab', 'mobile'], vocabHash: null },
    }
    expect(usesMobileFloor(fakeJob())).toBe(true) // generation_track 없음 = standard
    expect(usesMobileFloor(fakeJob({ generation_track: 'standard' } as Partial<PdpJobRow>))).toBe(true)
    expect(usesMobileFloor(fakeJob({ generation_track: 'internalized' } as Partial<PdpJobRow>))).toBe(false)
    expect(
      usesMobileFloor(fakeJob({ generation_track: 'internalized', section_plan: recorded } as Partial<PdpJobRow>))
    ).toBe(true)
    expect(
      assembleEditorDataResponse(fakeJob({ generation_track: 'internalized' } as Partial<PdpJobRow>), null).mobile_floor
    ).toBe(false)
    expect(assembleEditorDataResponse(fakeJob(), null).mobile_floor).toBe(true)
  })

  it('저장된 편집본(sections_data)은 하한을 다시 적용하지 않고 그대로 불러온다', async () => {
    const small = makeTextEl('saved_small', '저장된 작은 글자', 'body', 60, 10, 740, '#bbbbbb', 'left', 3, {
      fontSize: 20,
      height: 40,
      allowBelowMin: true,
    })
    const saved = [
      {
        id: 's1',
        sectionType: 'point_div',
        groupType: 'usp',
        order: 0,
        isVisible: true,
        layoutId: 'point_div_layout_01',
        canvas: { width: 860, height: 600, backgroundColor: '#ffffff' },
        elements: [small],
      },
    ]
    const res = assembleEditorDataResponse(fakeJob(), {
      sections_data: saved,
      layout_assignments: {},
    } as unknown as EditorDataRow)
    expect(res.mobile_floor).toBe(true)
    const doc = await buildEditorDocument('job-1', res)
    const el = doc.sections[0].elements[0]
    expect(el.textProps).toMatchObject({ fontSize: 20, color: '#bbbbbb' })
    expect(doc.sections[0].canvas.height).toBe(600)
  })
})

describe('강조 장식(T4) — annotations를 이미지 URL 키로 전달', () => {
  const items = [{ kind: 'label' as const, anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'pointCards[0].title' }]

  it('장식이 기록된 컷만 URL 키로 싣는다(skipped·failed·미기록 컷은 없다)', () => {
    const job = fakeJob({
      section_images: [
        { section: 'hero', url: 'https://x/hero.png' },
        { section: 'features:0', url: 'https://x/f0.png', annotations: items, annotationStatus: 'done' },
        { section: 'features:1', url: 'https://x/f1.png', annotationStatus: 'skipped' },
        { section: 'howto:0', url: 'https://x/h0.png', annotationStatus: 'failed' },
      ],
    })
    const res = assembleEditorDataResponse(job, null)
    expect(Object.keys(res.annotations ?? {})).toEqual(['https://x/f0.png'])
    expect(res.annotations!['https://x/f0.png'].items).toEqual(items)
  })

  it('장식이 없는 잡은 annotations 키 자체가 없다(Track S·구 잡 응답 불변)', () => {
    expect('annotations' in assembleEditorDataResponse(fakeJob(), null)).toBe(false)
    expect('annotations' in assembleEditorDataResponse(fakeJob({ generation_track: 'internalized' }), null)).toBe(false)
  })

  it('카피 흐름·리듬 수(copy_sections.copy_flow·copy_rhythm, 측정용)는 편집기 응답에 나오지 않고 응답을 바꾸지 않는다(Track S 포함)', () => {
    const counts = { phrases: 2, features: 1, numbers: 1, restated: 0, closing_echo: 1, concerns: 3, unanswered: 1, mismatched: 1 }
    const copy_flow = {
      version: 1 as const,
      counts,
      before: counts,
      examples: {
        phrases: ['끈 당겨'],
        features: [],
        numbers: ['20매'],
        restated: [],
        closing_echo: [],
        unanswered: ['이름도 하나씩'],
        mismatched: ['detailPoints[4]'],
      },
    }
    const rhythmCounts = { head_fields: 12, body_fields: 14, head_long: 3, bad_breaks: 1, long_sentences: 2, crowded: 0 }
    const copy_rhythm = {
      version: 1 as const,
      counts: rhythmCounts,
      examples: { head_long: ['mainIntro.benefitHeadline'], bad_breaks: ['mainIntro.hook'], long_sentences: [], crowded: [] },
    }
    for (const track of ['standard', 'internalized'] as const) {
      const plain = fakeJob({ generation_track: track })
      const withFlow = fakeJob({ generation_track: track, copy_sections: { ...plain.copy_sections, copy_flow, copy_rhythm } })
      const response = assembleEditorDataResponse(withFlow, null)
      expect(response).toEqual(assembleEditorDataResponse(plain, null))
      expect(JSON.stringify(response)).not.toMatch(/copy_flow|copy_rhythm/)
    }
  })
})

describe('GIF 칸(세션 B ③ P4) — motion_clips를 포스터 URL 키로 전달', () => {
  const motion = (over: Partial<SectionMotion> = {}): SectionMotion => ({
    path: 'gpt26-ref',
    status: 'ok',
    webpUrl: 'https://x/motion.webp',
    width: 780,
    height: 780,
    frames: 9,
    durationMs: 3600,
    bytes: 250_000,
    quality: 80,
    loop: 'pingpong',
    ...over,
  })

  it('움직이는 WebP가 있는 칸만 싣는다(포스터로 내린 칸·실패 칸·크기 없는 칸은 뺀다)', () => {
    const job = fakeJob({
      section_images: [
        { section: 'hero', url: 'https://x/hero.png' },
        { section: 'motion:0', url: 'https://x/poster.jpg', motion: motion() },
        { section: 'motion:1', url: 'https://x/poster1.jpg', motion: motion({ status: 'poster', webpUrl: undefined, reason: '예산' }) },
        { section: 'motion:2', url: 'https://x/poster2.jpg', error: '실패', motion: motion() },
        { section: 'motion:3', url: 'https://x/poster3.jpg', motion: motion({ width: 0 }) },
      ],
    })
    expect(assembleEditorDataResponse(job, null).motion_clips).toEqual({
      'https://x/poster.jpg': { webpUrl: 'https://x/motion.webp', width: 780, height: 780, bytes: 250_000 },
    })
  })

  it('움직임 칸이 없는 잡은 motion_clips 키 자체가 없고 응답이 그대로다', () => {
    expect(motionClipsOf(fakeJob().section_images)).toBeNull()
    expect('motion_clips' in assembleEditorDataResponse(fakeJob(), null)).toBe(false)
    const posterOnly = fakeJob({
      section_images: [...fakeJob().section_images, { section: 'motion:0', url: 'https://x/p.jpg', motion: motion({ status: 'poster', webpUrl: undefined }) }],
    })
    expect('motion_clips' in assembleEditorDataResponse(posterOnly, null)).toBe(false)
  })

  it('원본 GIF 이름이 옛 .png든 새 .gif든 motion_clips는 같다 — 편집기·굽기는 webpUrl만 읽는다(세션 B ③ 확장자 바로잡기)', () => {
    const withGif = (gifUrl: string) => [{ section: 'k17_clip_0', url: 'https://x/poster.jpg', motion: motion({ gifUrl }) }]
    expect(motionClipsOf(withGif('https://x/pdp-k17_clip_0-gif-1.png'))).toEqual(motionClipsOf(withGif('https://x/pdp-k17_clip_0-gif-1.gif')))
    expect(motionClipsOf(withGif('https://x/pdp-k17_clip_0-gif-1.png'))).toEqual({ 'https://x/poster.jpg': { webpUrl: 'https://x/motion.webp', width: 780, height: 780, bytes: 250_000 } })
  })

  it('편집기 문서는 sourceData.motionClips로 받고, 없는 잡은 키가 없다', async () => {
    const job = fakeJob({ section_images: [...fakeJob().section_images, { section: 'motion:0', url: 'https://x/poster.jpg', motion: motion() }] })
    const doc = await buildEditorDocument('job-1', assembleEditorDataResponse(job, null))
    expect(doc.sourceData.motionClips).toEqual({ 'https://x/poster.jpg': { webpUrl: 'https://x/motion.webp', width: 780, height: 780, bytes: 250_000 } })
    const plain = await buildEditorDocument('job-1', assembleEditorDataResponse(fakeJob(), null))
    expect('motionClips' in plain.sourceData).toBe(false)
  })
})

describe('뺀 컷(결정 카드 c08·J44) — dropped_cuts는 쓰는 법 미달로 뺀 컷이 있을 때만', () => {
  it('droppedForUse 컷 키만 싣는다 — 상품 불일치로 뺀 컷·실패 컷은 넣지 않는다', () => {
    const job = fakeJob({
      section_images: [
        { section: 'hero', url: 'https://x/hero.png' },
        { section: 'k3_items_photo_1', url: '', error: '게이트 미달 — 페이지에서 뺌', droppedForUse: { url: 'https://x/k3.png', reason: '쓰는 법 미달: 시험' } },
        { section: 'k5_photo_0', url: '', error: '게이트 미달 — 페이지에서 뺌', droppedForProduct: { url: 'https://x/k5.png', reason: '상품 불일치: 시험' } },
        { section: 'k6_photo_0', url: '', error: '생성 실패' },
      ],
    })
    expect(assembleEditorDataResponse(job, null).dropped_cuts).toEqual(['k3_items_photo_1'])
  })

  it('뺀 컷이 없는 잡(꺼진 잡)은 dropped_cuts 키 자체가 없고 응답이 그대로다', () => {
    expect('dropped_cuts' in assembleEditorDataResponse(fakeJob(), null)).toBe(false)
  })
})
