import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from './pdp-state'
import { sectionImageProgress } from './pdp-progress-count'

type Job = Pick<PdpJobRow, 'design_prompts' | 'section_plan' | 'section_images'>
const img = (section: string) => ({ section, url: `https://cdn.test/${section}.png` })
const D_PROMPTS = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`s${i}`, 'prompt']))

describe('sectionImageProgress — 진행 화면 섹션 이미지 수', () => {
  it('K 라인 잡은 대표 컷 + 계획 컷이 분모이고 분자도 그 컷만 센다(운영 첫 K 잡 23 / 8장)', () => {
    const shots = Array.from({ length: 22 }, (_, i) => ({ key: `k${i + 1}_photo_0` }))
    const job = {
      design_prompts: { section_image_prompts: D_PROMPTS },
      section_plan: { templatelib: { shots } },
      section_images: [img('hero'), ...shots.map((s) => img(s.key)), img('plate:T3c'), img('k17_clip_0-gif')],
    } as unknown as Job
    expect(sectionImageProgress(job)).toEqual({ generated: 23, expected: 23 })
    const halfway = { ...job, section_images: [img('hero'), ...shots.slice(0, 9).map((s) => img(s.key))] } as unknown as Job
    expect(sectionImageProgress(halfway)).toEqual({ generated: 10, expected: 23 })
  })

  it('계획 컷 기록이 없는 잡(D·R)은 지금 그대로 — 설계 콜 프롬프트 수와 섹션 이미지 수', () => {
    const images = [img('hero'), img('features:0'), img('plate:T3c')]
    for (const section_plan of [{}, { templatelib: {} }, { templatelib: { shots: [] } }]) {
      const job = { design_prompts: { section_image_prompts: D_PROMPTS }, section_plan, section_images: images } as unknown as Job
      expect(sectionImageProgress(job), JSON.stringify(section_plan)).toEqual({ generated: 3, expected: 8 })
    }
    expect(sectionImageProgress({ design_prompts: {}, section_plan: {}, section_images: [] } as unknown as Job)).toEqual({ generated: 0, expected: 0 })
  })
})
