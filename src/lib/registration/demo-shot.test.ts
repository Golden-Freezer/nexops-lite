/**
 * 직접 해 보는 시연 칸(하네스 J57, 통합 decide 35·37 — 오너 11-11 00:5x '실제 시험 사진 칸' + 원문 "AI로 그려도 된다. 오히려 AI를 더 잘 활용해야 한다").
 * - 스위치 demoshot(기본 off, K 잡만): 꺼진 잡은 원천·입력·선택·컷 지시가 바이트까지 같다
 * - 원천 사진 역할 demo(폼 '시험 사진'): 켠 잡의 시연 칸 입력, 생성 원천에서는 뺀다
 * - 켠 잡: 시험 사진이 있으면 compare.demo-photo(사진 주소 그대로, 컷 0), 없으면 compare.demo-try(AI 시연 컷 목적 demo)
 * 순수 함수·태스크 짜기·가짜 AI 단계만 본다(이미지·LLM·DB 콜 0).
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from './__fixtures__/pdp-products'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures, type EnrichmentFeature } from './enrichment-switch'
import { buildImageTasks } from './pdp-image-tasks'
import { generationSourceOf } from './pdp-image-stage'
import type { PdpJobRow } from './pdp-state'
import {
  cleanSourcePhotoRoles,
  demoPhotoUrls,
  generationExcludedRolesOf,
  generationSourceUrls,
  PHOTO_ROLE_LABEL,
  PHOTO_ROLES,
  type SourcePhotoRole,
} from './source-photo-roles'
import { DEMO_COPY_NOTE, DEMO_EVIDENCE, DEMO_SECTION, demoPool, isDemoPhotoTemplate, isDemoTemplate, withDemoSection } from './templatelib/demo-shot'
import { slotCopySections } from './templatelib/section-values'
import { fillInputSlots, lineInputsOf } from './templatelib/input-values'
import { TEMPLATES, templateById } from './templatelib/library'
import { selectLineInputOf, selectTemplateLine, type TemplateAgents } from './templatelib/select-line'
import { imageSlots } from './templatelib/selection-order'
import { buildShotBrief, PURPOSE_LINES, shotRouteOf, type LineShot } from './templatelib/shot-brief'
import type { TemplateMeta } from './templatelib/template-meta'
import { SHOT_PURPOSES } from './templatelib/template-types'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

const LIBRARY = TEMPLATES as unknown as TemplateMeta[]
const A = 'https://img.test/a.jpg'
const B = 'https://img.test/b-demo.jpg'
const C = 'https://img.test/c.jpg'
const DEMO_ROLES: SourcePhotoRole[] = [{ url: B, role: 'demo' }]

describe('원천 사진 역할 demo(시험 사진)', () => {
  it('역할 목록·라벨에 있고 서버 정리가 남긴다', () => {
    expect(PHOTO_ROLES).toContain('demo')
    expect(PHOTO_ROLE_LABEL.demo).toBe('시험 사진')
    expect(cleanSourcePhotoRoles([{ url: B, role: 'demo' }, { url: 'https://img.test/x.jpg', role: 'demo' }], [A, B])).toEqual(DEMO_ROLES)
  })

  it('생성 원천에서 기본으로 빠지고(설명 그림과 같이), 시험 사진 주소는 원천 순서다', () => {
    expect(generationSourceUrls([A, B, C], DEMO_ROLES)).toEqual({ urls: [A, C], excluded: [B], fallback: false })
    expect(generationSourceUrls([A, B, C], [{ url: C, role: 'demo' }, { url: A, role: 'demo' }])).toMatchObject({ urls: [B] })
    expect(demoPhotoUrls([A, B, C], [{ url: C, role: 'demo' }, { url: A, role: 'demo' }])).toEqual([A, C])
    expect(demoPhotoUrls([A, C], undefined)).toEqual([])
  })

  it('잡이 빼는 역할 — photoroles는 설명 그림·시험 사진, demoshot만은 시험 사진, 둘 다 꺼짐은 없음', () => {
    expect(generationExcludedRolesOf({ photoRoles: true, demoShot: false })).toEqual(['explain', 'demo'])
    expect(generationExcludedRolesOf({ photoRoles: true, demoShot: true })).toEqual(['explain', 'demo'])
    expect(generationExcludedRolesOf({ photoRoles: false, demoShot: true })).toEqual(['demo'])
    expect(generationExcludedRolesOf({ photoRoles: false, demoShot: false })).toEqual([])
  })

  it('이미지 단계 원천(generationSourceOf) — 꺼진 잡은 역할이 있어도 그대로, demoshot 잡은 시험 사진만, photoroles 잡은 설명 그림까지 뺀다', () => {
    const roles: SourcePhotoRole[] = [...DEMO_ROLES, { url: C, role: 'explain' }]
    const job = (features: EnrichmentFeature[]) =>
      ({ source_images: [A, B, C], spec_sheet: { sourcePhotoRoles: roles }, analysis: { enrichment: { version: 1, features } } }) as unknown as PdpJobRow
    expect(generationSourceOf(job(['templatelib']))).toEqual({ urls: [A, B, C], excluded: [], fallback: false })
    expect(generationSourceOf(job(['templatelib', 'demoshot']))).toEqual({ urls: [A, C], excluded: [B], fallback: false })
    expect(generationSourceOf(job(['photoroles']))).toEqual({ urls: [A], excluded: [B, C], fallback: false })
  })
})

describe('demoshot 스위치', () => {
  it('기본 off·K4 밖, 운영(Vercel·작업자)은 EXTRA로도 켜지지 않고 로컬 EXTRA로 K 잡에서만 기록한다', () => {
    expect(ENRICHMENT_DEFAULTS.demoshot).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('demoshot')
    expect(resolveEnabledFeatures({})).not.toContain('demoshot')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'demoshot' })).not.toContain('demoshot')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'demoshot' })).not.toContain('demoshot')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'demoshot' })
    expect(on).toContain('demoshot')
    expect(on.filter((f) => f !== 'demoshot')).toEqual(resolveEnabledFeatures({}))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'demoshot', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('demoshot')
  })
})

describe('시연 칸 템플릿 두 개', () => {
  const ai = templateById('compare.demo-try')!
  const photo = templateById('compare.demo-photo')!

  it('둘 다 비교 섹션·근거 demo 잠금이고, AI 칸은 컷 목적 demo 한 장, 사진 칸은 입력 사진이라 컷이 없다', () => {
    for (const t of [ai, photo]) {
      expect(t.section).toBe(DEMO_SECTION)
      expect(t.needs.evidence).toEqual([DEMO_EVIDENCE])
      expect(isDemoTemplate(t as unknown as TemplateMeta)).toBe(true)
    }
    expect(isDemoPhotoTemplate(photo as unknown as TemplateMeta)).toBe(true)
    expect(isDemoPhotoTemplate(ai as unknown as TemplateMeta)).toBe(false)
    expect(imageSlots(ai as unknown as TemplateMeta).map(({ def }) => def.purpose)).toEqual([['demo']])
    // 손만 컷 길(사용 컷 action과 같은 보호 줄) — MS 2k 실측(P02 462d097d)에서 in_use 컷은 옵션 디자인 줄이 덜리는 블록에 붙어 빠졌다
    expect(imageSlots(ai as unknown as TemplateMeta).map(({ def }) => def.composition)).toEqual([['in_hand']])
    expect(imageSlots(photo as unknown as TemplateMeta)).toEqual([])
    expect(LIBRARY.filter(isDemoTemplate).map((t) => t.id).sort()).toEqual(['compare.demo-photo', 'compare.demo-try'])
  })

  it('칸 글은 효능 사전 칸(claimRisk effect)이다 — J50 사전 검사를 그대로 받는다. 제목은 사실을 쓰지 않아 사실이 적은 상품에서도 놓인다', () => {
    for (const t of [ai, photo]) {
      for (const name of ['headline', 'sub']) expect(t.slots[name]).toMatchObject({ type: 'text', source: 'copy', claimRisk: 'effect' })
      expect(t.slots.headline).toMatchObject({ facts: 0, required: true })
      expect(t.needs.facts).toEqual({ min: 0, max: 1 })
    }
  })

  it('칸 카피 안내 — 시연 칸에만 한 줄(시험·인증·시험 결과 수치·비교 금지), 다른 비교 템플릿은 안내가 없다', () => {
    const rows = [ai.id, photo.id, 'compare.dark-band'].map((templateId) => ({ section: 'compare', templateId }))
    const notes = slotCopySections(rows as never).map((s) => s.note ?? null)
    expect(notes).toEqual([DEMO_COPY_NOTE, DEMO_COPY_NOTE, null])
    for (const word of ['시험·실험·테스트 완료·인증', '시험 결과 수치', '다른 상품과 견주지 않는다']) expect(DEMO_COPY_NOTE).toContain(word)
  })

  it('사진 칸은 시험 사진 주소를 그대로 받고, 없으면 비어 그 템플릿을 고르지 않는다', () => {
    const base = { spec: {} as never, cards: [], options: [] }
    expect(fillInputSlots(photo, { ...base, demoPhotos: [B, C] }).photos).toEqual([{ photo: B }])
    expect(fillInputSlots(photo, base).photos).toBeUndefined()
  })

  it('시연 칸 후보 — 사진이 있으면 사진 칸만, 없으면 AI 칸만. 구성에는 비교 섹션을 켠 잡만 더한다', () => {
    expect(demoPool(LIBRARY, true).map((t) => t.id)).toEqual(['compare.demo-photo'])
    expect(demoPool(LIBRARY, false).map((t) => t.id)).toEqual(['compare.demo-try'])
    const add = ['how_to']
    expect(withDemoSection(add, false)).toBe(add)
    expect(withDemoSection(add, true)).toEqual(['how_to', 'compare'])
    expect(withDemoSection(['compare'], true)).toEqual(['compare'])
  })
})

describe('컷 목적 demo', () => {
  const demoShot: LineShot = { key: 'k9_photo_0', section: 'compare', purpose: 'demo', composition: 'in_hand', aspect: '3:4', show: '골프티를 직접 내려쳐 봤어요' }
  const purposeOf = (brief: string) => brief.split('\n').find((line) => line.startsWith('Purpose: '))!

  it('등록된 목적이고 사용 컷 길(사람·세트)이다 — 사용 판정·Use 줄을 받는다', () => {
    expect(SHOT_PURPOSES).toContain('demo')
    expect(shotRouteOf('demo')).toEqual(shotRouteOf('action'))
    expect(shotRouteOf('demo').effectOnly).toBe(false)
  })

  it('Purpose 줄은 상품 사실대로 직접 해 보는 순간이고, 사진 속 숫자·퍼센트·그래프·인증·테스트 완료 글을 막는다', () => {
    const line = purposeOf(buildShotBrief(demoShot))
    expect(line).toBe(`Purpose: ${PURPOSE_LINES.demo}`)
    expect(PURPOSE_LINES.demo).toContain('the way its facts below say it is used')
    expect(PURPOSE_LINES.demo).toContain("No numbers, percentages, graphs, certification marks or 'test complete' text.")
    // K 컷 지시는 MS 맞추기가 덜지 않는다 — 기존 사용 컷(action)보다 길어지는 몫이 짧다(MS 2k 실측은 PR 본문)
    expect(PURPOSE_LINES.demo.length - PURPOSE_LINES.action.length).toBeLessThanOrEqual(200)
  })

  it('켠 잡 태스크 — 시연 컷은 사용 컷처럼 사용 판정·Use 줄 표지를 받고, 상품 없는 컷이 아니다', () => {
    const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
    const withShots = {
      ...job,
      analysis: { ...job.analysis, enrichment: { version: 1, features: ['templatelib', 'demoshot'] } } as PdpJobRow['analysis'],
      section_plan: { ...job.section_plan, templatelib: { shots: [demoShot] } } as PdpJobRow['section_plan'],
    }
    const task = buildImageTasks(withShots).find((t) => t.section === demoShot.key)!
    expect(task.shotBrief).toContain(PURPOSE_LINES.demo)
    expect(task).toMatchObject({ useGate: true, useCut: true, effectOnly: false })
    expect(task).not.toHaveProperty('noProductCut')
  })
})

describe('K 선택 — 꺼진 잡 바이트 같음, 켠 잡 시연 칸', () => {
  const item = getPdpTestProduct('P08')
  const free = <T,>(value: T) => ({ value, usedFallback: false, error: null, costUsd: 0 })
  const jobOf = (features: EnrichmentFeature[], roles?: SourcePhotoRole[]) =>
    ({
      id: 'job-demo',
      cost_pool: 'test',
      source_images: [A, B, C],
      spec_sheet: { ...item.specSheet, ...(roles ? { sourcePhotoRoles: roles } : {}) },
      analysis: { detected_category: item.categoryKey, enrichment: { version: 1, features } },
      copy_sections: { final: { options: item.specSheet.colorOptions ?? [] } },
      section_plan: {},
    }) as unknown as PdpJobRow

  /** 모델은 늘 첫 후보를 고르고 구성 콜은 비어 기본 구성을 쓴다 — 받은 섹션 후보를 남긴다 */
  async function run(job: PdpJobRow) {
    const seen = { slots: [] as Array<{ section: string; ids: string[] }> }
    const agents: TemplateAgents = {
      guideline: async ({ concepts }) => free({ persona: '', tone: '', concept: { id: concepts[0].id, reason: '' }, alternatives: [] }),
      compose: async () => free([]),
      select: async ({ slots }) => {
        seen.slots = slots.map((slot) => ({ section: slot.section, ids: slot.candidates.map((c) => c.id) }))
        return free(slots.map((slot) => ({ index: slot.index, templateId: slot.candidates[0].id, reason: '' })))
      },
    }
    const input = selectLineInputOf(job, LIBRARY)
    const out = await selectTemplateLine(input, agents)
    return { input, seen, out }
  }

  it('꺼진 잡 — 시험 사진 역할이 있어도 입력·후보·선택·기록이 역할 없는 잡과 같다', async () => {
    const plain = await run(jobOf(['designcut', 'templatelib']))
    const marked = await run(jobOf(['designcut', 'templatelib'], DEMO_ROLES))
    // spec은 잡 입력 그대로라 역할 칸이 보인다 — 그 밖의 입력(옵션·후기·시험 사진)은 같다
    expect({ ...marked.input.inputs, spec: null }).toEqual({ ...plain.input.inputs, spec: null })
    expect(marked.input).not.toHaveProperty('demoShot')
    expect(marked.input.inputs).not.toHaveProperty('demoPhotos')
    expect(marked.seen).toEqual(plain.seen)
    expect(marked.out.record).toEqual(plain.out.record)
    expect(marked.out.order.sections).toEqual(plain.out.order.sections)
    expect(plain.seen.slots.flatMap((slot) => slot.ids).some((id) => id.startsWith('compare.demo-'))).toBe(false)
  })

  it('켠 잡·시험 사진 없음 — 비교 섹션이 구성에 들고 후보는 AI 시연 칸 하나다', async () => {
    const { input, seen, out } = await run(jobOf(['designcut', 'templatelib', 'demoshot']))
    expect(input.demoShot).toBe(true)
    expect(input.inputs).not.toHaveProperty('demoPhotos')
    expect(seen.slots.filter((slot) => slot.section === DEMO_SECTION)).toEqual([{ section: DEMO_SECTION, ids: ['compare.demo-try'] }])
    expect(out.order.sections.filter((s) => s.section === DEMO_SECTION).map((s) => s.templateId)).toEqual(['compare.demo-try'])
  })

  it('켠 잡·시험 사진 있음 — 후보는 시험 사진 칸 하나이고 입력은 그 주소다', async () => {
    const { input, seen, out } = await run(jobOf(['designcut', 'templatelib', 'demoshot'], DEMO_ROLES))
    expect(input.inputs?.demoPhotos).toEqual([B])
    expect(lineInputsOf(jobOf(['designcut', 'templatelib', 'demoshot'], DEMO_ROLES)).demoPhotos).toEqual([B])
    expect(seen.slots.filter((slot) => slot.section === DEMO_SECTION)).toEqual([{ section: DEMO_SECTION, ids: ['compare.demo-photo'] }])
    expect(out.order.sections.filter((s) => s.section === DEMO_SECTION).map((s) => s.templateId)).toEqual(['compare.demo-photo'])
  })
})
