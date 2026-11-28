/**
 * K0 저장 재료 재조립 — 호출 없이 저장 잡만으로 계획이 서는지, 칸 검사에 걸린 글을 자르지 않고 지우는지, 빌린 컷 수가 맞는지 본다.
 * 저장 잡은 리포 픽스처(R1 세 잡)이고 값은 픽스처에서 읽어 비교한다.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from '../pdp-state'
import { templateById } from '../templatelib/library'
import { keyedShots } from '../templatelib/section-values'
import type { OrderedSection } from '../templatelib/selection-order'
import { copySlotsOf } from '../templatelib/slot-copy'
import p02 from '../internalized/__fixtures__/designcut-v2/r1-p02-d10ea762.json'
import p03 from '../internalized/__fixtures__/designcut-v2/r1-p03-f2d72bd0.json'
import p07 from '../internalized/__fixtures__/designcut-v2/r1-p07-8e7006a3.json'
import { lendCuts, reassembleK0 } from './k0-reassemble'
import { renderJobHtml } from './render-capture'

/** R1 저장 잡은 디자인 컷 전이라 스위치를 켜서 기준 계획을 세운다 */
const withDesigncut = (fixture: unknown): PdpJobRow => {
  const job = fixture as PdpJobRow
  const enrichment = job.section_plan.enrichment!
  return { ...job, section_plan: { ...job.section_plan, enrichment: { ...enrichment, features: [...enrichment.features, 'designcut'] } } }
}
const JOBS: Array<[string, PdpJobRow]> = [
  ['P02', withDesigncut(p02)],
  ['P03', withDesigncut(p03)],
  ['P07', withDesigncut(p07)],
]

describe('reassembleK0', () => {
  it.each(JOBS)('%s: 저장 잡을 바꾸지 않고 K 계획을 세운다', async (_, job) => {
    const before = JSON.stringify(job)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { job: built, stats, sections } = await reassembleK0(job)
    expect(sections).toHaveLength(stats.planned)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    expect(JSON.stringify(job)).toBe(before)

    const plan = built.section_plan.designcut!
    expect(plan.layout).toBe(2)
    expect(plan.sections.length).toBeGreaterThan(0)
    expect(plan.sections.every((section) => section.templateRef)).toBe(true)
    expect(plan.templateColors).toBeTruthy()
    // 컨셉 모서리(T1-28) — 실제 K 계획과 같이 고른 컨셉의 모서리가 실린다
    expect(plan.templateRadius?.card).toBeGreaterThan(0)
    expect(stats.planned).toBeGreaterThanOrEqual(stats.drawn)
    expect(stats.drawn + stats.undrawn.length).toBe(stats.planned)
    expect(stats.cuts.lent).toBe(stats.cuts.needed)
  })

  it.each(JOBS)('%s: 칸에 넣은 글은 저장 카피에 있는 글 그대로다(자르거나 새로 쓰지 않는다)', async (_, job) => {
    const { job: built } = await reassembleK0(job)
    const saved = JSON.stringify(job.copy_sections.final ?? {})
    const FIXED = new Set(['이런 분께 추천드려요'])
    for (const section of built.section_plan.designcut!.sections) {
      const template = templateById(section.templateRef!.id)!
      for (const slot of copySlotsOf(template as never)) {
        const value = section.templateRef!.slots[slot.name]
        if (typeof value === 'string' && !FIXED.has(value)) expect(saved, `${template.id}.${slot.name}`).toContain(JSON.stringify(value).slice(1, -1))
      }
    }
  })

  it.each(JOBS)('%s: 조립한 계획을 그릴 수 있고, 그려진 K 섹션 수는 stats와 같다', async (_, job) => {
    const { job: built, stats } = await reassembleK0(job)
    const rendered = await renderJobHtml(built, null)
    expect(rendered.html.length).toBeGreaterThan(0)
    const kSections = rendered.doc.sections.filter((section) => section.layoutId?.startsWith('designcut_k_'))
    expect(kSections.length).toBe(stats.drawn)
  })

  it('디자인 컷이 아닌 잡은 조립하지 않는다', async () => {
    await expect(reassembleK0(p02 as unknown as PdpJobRow)).rejects.toThrow('디자인 컷')
  })
})

describe('lendCuts', () => {
  const section = (slots: Array<[string, string]>): OrderedSection =>
    ({ section: 'point_div', templateId: 'x', bg: 'W', shots: slots.map(([slot, purpose]) => ({ slot, purpose, composition: 'center' })) }) as unknown as OrderedSection
  const cut = (name: string): SectionImage => ({ section: name, url: `https://x/${name}.jpg`, prompt: '' })

  it('컷 목적에 맞는 저장 컷을 먼저 빌리고 키는 컷 키를 쓴다', () => {
    const sections = [section([['photo', 'hero']]), section([['photo', 'problem']]), section([['photo', 'feature_proof']])]
    const { images, needed, reused } = lendCuts(sections, [cut('features:0'), cut('problem'), cut('hero')])
    expect(needed).toBe(3)
    expect(reused).toBe(0)
    expect(images.map((image) => image.section)).toEqual(sections.flatMap((row, i) => keyedShots(i, row).map((shot) => shot.key)))
    expect(images.map((image) => image.url)).toEqual(['https://x/hero.jpg', 'https://x/problem.jpg', 'https://x/features:0.jpg'])
  })

  it('안 쓴 컷을 먼저 쓰고, 모자라면 다시 쓴 수를 센다', () => {
    const sections = [section([['photo', 'hero']]), section([['photo', 'hero']]), section([['photo', 'hero']])]
    const { images, reused } = lendCuts(sections, [cut('hero'), cut('usage')])
    expect(images.map((image) => image.url)).toEqual(['https://x/hero.jpg', 'https://x/usage.jpg', 'https://x/hero.jpg'])
    expect(reused).toBe(1)
  })

  it('바탕·아이콘 재료와 URL 없는 항목은 빌리지 않는다', () => {
    const { images, needed } = lendCuts([section([['photo', 'scene']])], [cut('plate:a'), cut('usp_icons:0'), cut('rating_bg'), { section: 'usage', url: '', prompt: '' }])
    expect(needed).toBe(1)
    expect(images).toEqual([])
  })
})
