/**
 * 강조 장식(E-3, T4) 순수 로직 — 허용 라벨·발동 조건·Vision 응답 검증·밀도 상한·상태기계(resolveStepToRun)·편집기 전달.
 * docs/plans/pdp-enrichment/01_TEST_PLAN.md L1 T4 행. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { lookupRoleVocab } from './design-vocab'
import {
  ANNOTATION_LIMITS,
  annotationProgress,
  buildAllowedLabels,
  buildNumberAnnotations,
  editorAnnotationsOf,
  featureCutLabels,
  imageAspectFromBase64,
  pageImageCap,
  pendingAnnotationTargets,
  selectAnnotationTargets,
  validateAnnotations,
  withAnnotationResult,
  type AnnotationTarget,
} from './pdp-annotation-stage'
import { resolveStepToRun } from './pdp-pipeline'
import { designcutEnabled } from './internalized/designcut-plan'
import type { PdpJobRow } from './pdp-state'
import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'

const ALL = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile']

function trackIJob(features: string[] | null = ALL): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  // 사용법(hidden_page)·크기 비교(compare_div) 컷이 화면에 나오는 계획
  const shown = [...(job.section_plan.activated_sections ?? []), 'hidden_page', 'compare_div']
  if (features)
    job.section_plan = {
      ...job.section_plan,
      activated_sections: shown,
      enrichment: { version: 1, features, vocabHash: null },
    }
  return job
}

const target = (overrides: Partial<AnnotationTarget> = {}): AnnotationTarget => ({
  section: 'features:0',
  url: 'https://cdn.test/f0.png',
  mode: 'vision',
  kinds: ['label', 'leader', 'zoom'],
  labels: [
    { text: '원터치 작동', source: 'pointCards[0].title' },
    { text: '10미터', source: 'spec.size' },
  ],
  ...overrides,
})

describe('허용 라벨 목록 — 카피·스펙에서 결정론 추출', () => {
  it('12자 이하만 넣고, 넘는 문구는 자르지 않고 뺀다', () => {
    const job = trackIJob()
    job.copy_sections = {
      ...job.copy_sections,
      final: {
        ...job.copy_sections.final,
        pointCards: [
          { title: '원터치 작동' },
          { title: '열세 글자를 넘는 아주 긴 제목입니다' },
          { title: '원터치 작동' },
        ],
        detailPoints: [{ claim: '두 줄\n문구' }, { claim: '짧은 주장' }],
      },
    }
    job.spec_sheet = { ...job.spec_sheet, material: '실리콘', size: '가로 30cm 세로 10미터 대용량 롤' }
    expect(buildAllowedLabels(job)).toEqual([
      { text: '원터치 작동', source: 'pointCards[0].title' },
      { text: '짧은 주장', source: 'detailPoints[1].claim' },
      { text: '실리콘', source: 'spec.material' },
    ])
  })
})

describe('selectAnnotationTargets — 발동 조건', () => {
  it('Track S 잡·기록 없는 구 Track I 잡·annotations 없는 기록 잡은 대상 0', () => {
    expect(selectAnnotationTargets({ ...trackIJob(), generation_track: 'standard' })).toEqual([])
    expect(selectAnnotationTargets(trackIJob(null))).toEqual([])
    expect(selectAnnotationTargets(trackIJob(['vocab', 'persuasion', 'layouts', 'shots', 'mobile']))).toEqual([])
  })

  it('features는 페이지 상한 안 앞 순서, howto는 번호, url 없는 컷·재생성 대기 컷은 뺀다', () => {
    const job = trackIJob()
    const cap = pageImageCap(job.analysis.detected_category, 4)
    const targets = selectAnnotationTargets(job)
    expect(targets.filter((t) => t.mode === 'vision').map((t) => t.section)).toEqual(
      ['features:0', 'features:1', 'features:2', 'features:3'].slice(0, cap)
    )
    expect(targets.filter((t) => t.mode === 'number').map((t) => t.section)).toEqual(['howto:0', 'howto:1', 'howto:2'])

    job.section_images = job.section_images.map((e) =>
      e.section === 'features:0'
        ? { ...e, url: '', error: 'x' }
        : e.section === 'howto:1'
          ? { ...e, pendingRegen: true }
          : e
    )
    const after = selectAnnotationTargets(job).map((t) => t.section)
    expect(after).not.toContain('features:0')
    expect(after).not.toContain('howto:1')
  })

  it('컷을 보여 주는 섹션이 설계 계획에 없으면 그 컷은 대상이 아니다', () => {
    const job = trackIJob()
    job.spec_sheet = { ...job.spec_sheet, size: '30x10cm' }
    const without = (drop: string[]) => ({
      ...job,
      section_plan: {
        ...job.section_plan,
        activated_sections: job.section_plan.activated_sections!.filter((s) => !drop.includes(s)),
      },
    })
    const sections = (j: PdpJobRow) => selectAnnotationTargets(j).map((t) => t.section.split(':')[0])
    expect(sections(without(['hidden_page']))).not.toContain('howto')
    expect(sections(without(['compare_div']))).not.toContain('size_comparison')
    expect(sections(without(['point_div', 'sub_div']))).not.toContain('features')
    expect(new Set(sections(job))).toEqual(new Set(['features', 'size_comparison', 'howto']))
  })

  it('size_comparison은 spec.size 라벨만, 그 문구가 없으면 대상이 아니다', () => {
    const job = trackIJob()
    job.spec_sheet = { ...job.spec_sheet, size: '30x10cm' }
    const size = selectAnnotationTargets(job).find((t) => t.section === 'size_comparison')!
    expect(size.kinds).toEqual(['label'])
    expect(size.labels).toEqual([{ text: '30x10cm', source: 'spec.size' }])
    job.spec_sheet = { ...job.spec_sheet, size: '가로 30cm 세로 10미터 대용량 롤' }
    expect(selectAnnotationTargets(job).some((t) => t.section === 'size_comparison')).toBe(false)
  })

  it('페이지 상한 = USP 컷 수 × 실측 오버레이 비율(반올림), 1~4', () => {
    const share = lookupRoleVocab('household', 'usp_feature')!.role.overlay.imageShare
    expect(pageImageCap('household', 4)).toBe(Math.max(1, Math.min(4, Math.round(4 * share))))
    expect(pageImageCap('household', 0)).toBe(0)
    expect(pageImageCap('household', 1)).toBe(1)
    expect(pageImageCap('household', 12)).toBe(ANNOTATION_LIMITS.maxPageImages)
  })
})

describe('USP 컷 라벨 — 컷마다 자기 라벨 1개, 페이지에서 한 번만(R2-2)', () => {
  function withCopy(pointCards: Array<{ title: string }>, detailPoints: Array<{ claim: string }>): PdpJobRow {
    const job = trackIJob()
    job.copy_sections = { ...job.copy_sections, final: { ...job.copy_sections.final, pointCards, detailPoints } }
    return job
  }

  it('features:i는 POINT 카드 i 제목, 못 쓰면(12자 초과) 그 컷의 detailPoints[i] claim, 이미 쓴 문구는 건너뛴다', () => {
    const job = withCopy(
      [{ title: '은은한 반투명' }, { title: '열세 글자를 넘는 아주 긴 제목입니다' }, { title: '은은한 반투명' }],
      [{ claim: '비칠 듯 신비로움' }, { claim: '두 가지 컬러' }, { claim: '두 사이즈' }]
    )
    expect(featureCutLabels(job, 0, new Set())).toEqual([{ text: '은은한 반투명', source: 'pointCards[0].title' }])
    expect(featureCutLabels(job, 1, new Set())).toEqual([{ text: '두 가지 컬러', source: 'detailPoints[1].claim' }])
    expect(featureCutLabels(job, 2, new Set(['은은한 반투명']))).toEqual([
      { text: '두 사이즈', source: 'detailPoints[2].claim' },
    ])
    expect(featureCutLabels(job, 3, new Set())).toEqual([])
  })

  /** 디자인 컷 잡 — Track I + designcut 기록 + 설득 플래너 골격(designcutEnabled 조건) */
  function asDesigncut(job: PdpJobRow): PdpJobRow {
    const skeleton = job.section_plan.internalized_skeleton ?? { roles: [], excluded: [] }
    const persuasion = skeleton.persuasion ?? ({} as NonNullable<typeof skeleton.persuasion>)
    job.section_plan = {
      ...job.section_plan,
      enrichment: { version: 1, features: [...ALL, 'designcut'], vocabHash: null },
      internalized_skeleton: { ...skeleton, persuasion },
    }
    return job
  }

  it('디자인 컷 잡은 claim 먼저 — 쓸 수 없거나(12자 초과·여러 줄) 이미 쓴 claim이면 POINT 제목으로 돌아간다(D1 T2-45)', () => {
    const titles = [{ title: '끈으로 닫는 포장' }, { title: '탄성모 터치' }, { title: '거품 샴푸' }, { title: '한 손에 쏙' }]
    const claims = [
      { claim: '조임끈으로 마무리해요' },
      { claim: '열세 글자를 넘는 아주 긴 주장이에요' },
      { claim: '두 줄\n주장' },
      { claim: '한 손으로 쥐는 크기' },
    ]
    const job = asDesigncut(withCopy(titles, claims))
    expect(designcutEnabled(job)).toBe(true)
    expect(featureCutLabels(job, 0, new Set())).toEqual([{ text: '조임끈으로 마무리해요', source: 'detailPoints[0].claim' }])
    expect(featureCutLabels(job, 1, new Set())).toEqual([{ text: '탄성모 터치', source: 'pointCards[1].title' }])
    expect(featureCutLabels(job, 2, new Set())).toEqual([{ text: '거품 샴푸', source: 'pointCards[2].title' }])
    expect(featureCutLabels(job, 3, new Set(['한 손으로 쥐는 크기']))).toEqual([
      { text: '한 손에 쏙', source: 'pointCards[3].title' },
    ])
    expect(featureCutLabels(job, 4, new Set())).toEqual([])
    // 디자인 컷이 아닌 같은 카피 잡은 이전 순서(제목 먼저) 그대로
    const plain = withCopy(titles, claims)
    expect(designcutEnabled(plain)).toBe(false)
    expect(featureCutLabels(plain, 0, new Set())).toEqual([{ text: '끈으로 닫는 포장', source: 'pointCards[0].title' }])
  })

  it('디자인 컷 잡의 claim 먼저는 라벨 글만 바꾼다 — 대상 컷(=Vision 콜)은 디자인 컷이 아닌 잡과 같다', () => {
    const titles = [{ title: '끈 없는 원터치' }, { title: '300개 구성' }, { title: '투명한 외관' }, { title: '유연한 집게' }]
    const claims = [{ claim: '함께 끼우는 원터치' }, { claim: '열세 글자를 넘는 아주 긴 주장이에요' }, { claim: '줄기 곁에 맑은 색상' }]
    const plainTargets = selectAnnotationTargets(withCopy(titles, claims))
    const dTargets = selectAnnotationTargets(asDesigncut(withCopy(titles, claims)))
    const cuts = (ts: AnnotationTarget[]) => ts.map((t) => `${t.section}:${t.mode}:${t.labels.length}`)
    expect(cuts(dTargets)).toEqual(cuts(plainTargets))
    const features = dTargets.filter((t) => t.section.startsWith('features:'))
    expect(features.length).toBeGreaterThan(0)
    expect(features[0].labels).toEqual([{ text: '함께 끼우는 원터치', source: 'detailPoints[0].claim' }])
    expect(features.find((t) => t.section === 'features:1')?.labels).toEqual([
      { text: '300개 구성', source: 'pointCards[1].title' },
    ])
  })

  it('대상 컷마다 라벨이 하나이고 서로 다르다 — 크기 컷 문구는 USP 컷에 주지 않는다', () => {
    const job = withCopy(
      [{ title: '30x10cm' }, { title: '컬러 2종' }, { title: 'S/L 두 사이즈' }, { title: '20개 구성' }],
      [{ claim: '비칠 듯 신비로움' }]
    )
    job.spec_sheet = { ...job.spec_sheet, size: '30x10cm' }
    const targets = selectAnnotationTargets(job)
    const vision = targets.filter((t) => t.mode === 'vision' && t.section.startsWith('features:'))
    expect(vision.length).toBeGreaterThan(0)
    for (const t of vision) expect(t.labels).toHaveLength(1)
    const texts = vision.map((t) => t.labels[0].text)
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts).not.toContain('30x10cm')
    expect(vision[0]).toMatchObject({
      section: 'features:0',
      labels: [{ text: '비칠 듯 신비로움', source: 'detailPoints[0].claim' }],
    })
    expect(targets.find((t) => t.section === 'size_comparison')?.labels).toEqual([
      { text: '30x10cm', source: 'spec.size' },
    ])
  })

  it('라벨을 줄 수 없는 컷은 건너뛰고 다음 컷으로 페이지 상한을 채운다', () => {
    const job = withCopy(
      [
        { title: '열세 글자를 넘는 아주 긴 제목입니다' },
        { title: '컬러 2종' },
        { title: '두 사이즈' },
        { title: '20개 구성' },
      ],
      []
    )
    const cap = pageImageCap(
      job.analysis.detected_category,
      job.section_images.filter((e) => /^features:\d+$/.test(e.section)).length
    )
    const sections = selectAnnotationTargets(job)
      .filter((t) => t.section.startsWith('features:'))
      .map((t) => t.section)
    expect(sections).not.toContain('features:0')
    expect(sections).toEqual(['features:1', 'features:2', 'features:3'].slice(0, cap))
  })
})

describe('validateAnnotations — Vision 응답 검증', () => {
  it('목록 밖 문자열·범위 밖 좌표·근접 앵커·작은 확대 영역·허용 밖 종류를 거부한다', () => {
    const rows = [
      { kind: 'label', text: '새로 만든 문구', x: 0.5, y: 0.5 },
      { kind: 'label', text: '원터치 작동', x: 0.97, y: 0.5 },
      { kind: 'leader', text: ' 원터치 작동 ', x: 0.4, y: 0.5 },
      { kind: 'label', text: '10미터', x: 0.45, y: 0.55 },
      { kind: 'zoom', zoomRect: { x: 0.6, y: 0.6, w: 0.1, h: 0.3 } },
      { kind: 'number', text: '1', x: 0.2, y: 0.2 },
      { kind: 'zoom', zoomRect: { x: 0.6, y: 0.2, w: 0.2, h: 0.2 }, text: '없는 문구' },
    ]
    expect(validateAnnotations(rows, target())).toEqual([
      { kind: 'leader', anchor: { x: 0.4, y: 0.5 }, text: '원터치 작동', source: 'pointCards[0].title' },
      {
        kind: 'zoom',
        anchor: { x: 0.7, y: 0.30000000000000004 },
        zoomRect: { x: 0.6, y: 0.2, w: 0.2, h: 0.2 },
        source: 'image',
      },
    ])
  })

  it('이미지당 3개, 같은 문구 반복 없음, size 컷은 라벨만', () => {
    const rows = [0.2, 0.4, 0.6, 0.8].map((x, i) => ({
      kind: 'label',
      text: i % 2 ? '10미터' : '원터치 작동',
      x,
      y: 0.5,
    }))
    expect(validateAnnotations(rows, target()).map((a) => a.text)).toEqual(['원터치 작동', '10미터'])
    const many = Array.from({ length: 5 }, (_, i) => ({
      kind: 'zoom',
      zoomRect: { x: i * 0.16, y: 0.1, w: 0.15, h: 0.15 },
    }))
    expect(validateAnnotations(many, target())).toHaveLength(ANNOTATION_LIMITS.perImage)
    const size = target({ kinds: ['label'], labels: [{ text: '10미터', source: 'spec.size' }] })
    expect(validateAnnotations([{ kind: 'leader', text: '10미터', x: 0.5, y: 0.5 }], size)).toEqual([])
  })

  it('빈 응답·배열 아님 → 장식 0 → skipped, 호출 실패 → failed', () => {
    expect(validateAnnotations([], target())).toEqual([])
    expect(validateAnnotations({ kind: 'label' }, target())).toEqual([])
    const entry = { section: 'features:0', url: 'https://cdn.test/f0.png' }
    expect(withAnnotationResult(entry, { annotations: [] })).toEqual({ ...entry, annotationStatus: 'skipped' })
    expect(withAnnotationResult(entry, 'failed')).toEqual({ ...entry, annotationStatus: 'failed' })
  })

  it('번호 배지는 결정론 — 단계 번호 1개', () => {
    expect(
      buildNumberAnnotations(target({ section: 'howto:2', mode: 'number', kinds: ['number'], labels: [] }))
    ).toEqual([{ kind: 'number', anchor: { x: 0.1, y: 0.1 }, text: '3', source: 'howto[2]' }])
  })
})

describe('상태기계 — 장식 대상이 남으면 images, 전부 기록되면 compose', () => {
  it('대상 컷 annotationStatus 미기록 → images, 전부 기록 → compose/done(Track S·구 잡 판정 불변)', () => {
    const job = { ...trackIJob(), final_html: null }
    expect(resolveStepToRun(job)).toBe('images')
    const recorded = {
      ...job,
      section_images: job.section_images.map((e) =>
        selectAnnotationTargets(job).some((t) => t.section === e.section)
          ? { ...e, annotationStatus: 'skipped' as const }
          : e
      ),
    }
    expect(pendingAnnotationTargets(recorded)).toEqual([])
    expect(resolveStepToRun(recorded)).toBe('compose')
    expect(resolveStepToRun(trackIJob(null))).toBe('done')
    expect(resolveStepToRun({ ...trackIJob(), generation_track: 'standard' })).toBe('done')
  })

  it('재생성으로 url이 바뀐 컷은 다시 대상이 된다', () => {
    const job = trackIJob()
    const recorded = job.section_images.map((e) => ({ ...e, annotationStatus: 'done' as const }))
    const regenerated = recorded.map((e) =>
      e.section === 'features:0' ? { section: e.section, url: 'https://cdn.test/new.png' } : e
    )
    expect(pendingAnnotationTargets({ ...job, section_images: regenerated }).map((t) => t.section)).toEqual([
      'features:0',
    ])
  })

  it('장식 진행률은 남은 대상이 줄 때마다 오르고 compose(95) 아래에 머문다', () => {
    const values = [9, 7, 5, 3, 1].map(annotationProgress)
    expect(new Set(values).size).toBe(values.length)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(Math.max(...values)).toBeLessThan(95)
  })
})

describe('editorAnnotationsOf — 편집기 전달', () => {
  it('장식이 기록된 컷만 이미지 URL 키로, 원본 비율은 생성 태스크 비율 힌트', () => {
    const job = trackIJob()
    const f0 = job.section_images.find((e) => e.section === 'features:0')!
    const items = [
      { kind: 'label' as const, anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'pointCards[0].title' },
    ]
    job.section_images = job.section_images.map((e) =>
      e === f0
        ? { ...e, annotations: items, annotationStatus: 'done' as const }
        : e.section === 'howto:0'
          ? { ...e, annotationStatus: 'skipped' as const }
          : e
    )
    const out = editorAnnotationsOf(job)!
    expect(Object.keys(out)).toEqual([f0.url])
    expect(out[f0.url].items).toEqual(items)
    expect(out[f0.url].aspect).toBeGreaterThan(0)
    expect(editorAnnotationsOf(trackIJob())).toBeNull()
  })
})

describe('imageAspectFromBase64 — 투영용 실제 비율(헤더)', () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')
  const u32be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
  const u16be = (v: number) => [(v >> 8) & 255, v & 255]
  const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0))

  it('PNG IHDR — gpt-image-2 3:4 요청의 실제 1024×1536', () => {
    const png = [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...u32be(13),
      ...ascii('IHDR'),
      ...u32be(1024),
      ...u32be(1536),
    ]
    expect(imageAspectFromBase64(b64(png))).toBeCloseTo(1024 / 1536, 6)
  })

  it('JPEG SOF0(앞 APP0 세그먼트 건너뜀)', () => {
    const app0 = [0xff, 0xe0, ...u16be(16), ...new Array(14).fill(0)]
    const sof0 = [0xff, 0xc0, ...u16be(17), 8, ...u16be(1200), ...u16be(900), 3, ...new Array(9).fill(0)]
    expect(imageAspectFromBase64(b64([0xff, 0xd8, ...app0, ...sof0]))).toBeCloseTo(900 / 1200, 6)
  })

  it('WebP VP8X·VP8 — 캔버스 크기', () => {
    const riff = (chunk: string, body: number[]) => [
      ...ascii('RIFF'),
      0,
      0,
      0,
      0,
      ...ascii('WEBP'),
      ...ascii(chunk),
      0,
      0,
      0,
      0,
      ...body,
    ]
    const vp8x = riff('VP8X', [0, 0, 0, 0, 799 & 255, 799 >> 8, 0, 599 & 255, 599 >> 8, 0])
    expect(imageAspectFromBase64(b64(vp8x))).toBeCloseTo(800 / 600, 6)
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 640 & 255, 640 >> 8, 480 & 255, 480 >> 8])
    expect(imageAspectFromBase64(b64(vp8))).toBeCloseTo(640 / 480, 6)
  })

  it('알 수 없는 바이트는 null — 편집기는 비율 힌트로 대신 투영', () => {
    expect(imageAspectFromBase64(b64(ascii('not an image at all')))).toBeNull()
    expect(imageAspectFromBase64('')).toBeNull()
  })

  it('장식 결과에 실제 비율을 남기고, 편집기 전달은 실제 비율·컷 키를 쓴다', () => {
    const job = trackIJob()
    const f0 = job.section_images.find((e) => e.section === 'features:0')!
    const items = [
      { kind: 'label' as const, anchor: { x: 0.5, y: 0.5 }, text: '원터치 작동', source: 'pointCards[0].title' },
    ]
    const recorded = withAnnotationResult(f0, { annotations: items, aspect: 2 / 3 })
    expect(recorded.imageAspect).toBeCloseTo(2 / 3, 6)
    job.section_images = job.section_images.map((e) => (e === f0 ? recorded : e))
    expect(editorAnnotationsOf(job)![f0.url]).toMatchObject({ aspect: 2 / 3, section: 'features:0' })
  })
})
