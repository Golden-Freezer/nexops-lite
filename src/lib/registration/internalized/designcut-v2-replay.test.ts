/**
 * 디자인 컷 계획 v2(2026-10-28) — R1 P02·P03·P07 저장 잡에 designcut을 켜고 원천 사진(64px 축소본)으로 다시 계획한다.
 * 사진 팔레트·같은 컷 한 번·짙은 바탕 상한·생성 태스크·조립 뒤 짙은 바탕 비중을 고정한다(네트워크·DB·유료 0).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '../editor-data'
import { buildEditorDocument } from '../editor/utils/buildEditorDocument'
import { measureDesigncutPhoto } from '../designcut-photo'
import { buildImageTasks } from '../pdp-image-tasks'
import { resolveStepToRun } from '../pdp-pipeline'
import type { DesigncutPhoto, DesigncutPhotoRecord, PdpJobRow } from '../pdp-state'
import { buildDesigncutPlan } from './designcut-plan'
import { cutBackgroundOf, rgbToLch } from './designcut-palette'

const DIR = join(__dirname, '__fixtures__/designcut-v2')
const JOBS = { p02: 'r1-p02-d10ea762', p03: 'r1-p03-f2d72bd0', p07: 'r1-p07-8e7006a3' } as const
type Name = keyof typeof JOBS

function r1Job(name: Name, designcut = true): PdpJobRow {
  const row = JSON.parse(readFileSync(join(DIR, `${JOBS[name]}.json`), 'utf8')) as PdpJobRow
  const features = row.section_plan.enrichment!.features.filter((f) => f !== 'designcut')
  return {
    ...row,
    section_plan: {
      ...row.section_plan,
      enrichment: { ...row.section_plan.enrichment!, features: designcut ? [...features, 'designcut'] : features },
    },
  }
}
async function measured(name: Name): Promise<DesigncutPhotoRecord> {
  const data = readFileSync(join(DIR, `${name}-source-64.png`)).toString('base64')
  return measureDesigncutPhoto({ data, mediaType: 'image/png' })
}
/** images 단계 첫 run과 같은 순서 — 측정 기록 → 계획 기록. edit로 피처 컷 수·측정값을 바꾼 변형(verifier 재현 사례)을 만든다 */
async function planned(
  name: Name,
  photo = true,
  edit: { detailPoints?: number; pointCards?: number; photo?: Partial<DesigncutPhoto> } = {}
): Promise<PdpJobRow> {
  let job = r1Job(name)
  const final = job.copy_sections.final!
  job = {
    ...job,
    copy_sections: {
      ...job.copy_sections,
      final: {
        ...final,
        detailPoints: (final.detailPoints ?? []).slice(0, edit.detailPoints ?? undefined),
        pointCards: (final.pointCards ?? []).slice(0, edit.pointCards ?? undefined),
      },
    },
  }
  const measuredRecord = photo ? await measured(name) : ({ version: 1, failed: 'decode_failed' } as const)
  const designcut_photo = edit.photo ? ({ ...measuredRecord, ...edit.photo } as DesigncutPhoto) : measuredRecord
  const withPhoto = { ...job, section_plan: { ...job.section_plan, designcut_photo } }
  return { ...withPhoto, section_plan: { ...withPhoto.section_plan, designcut: buildDesigncutPlan(withPhoto)! } }
}
/** 플레이트까지 생성된 잡(계획이 플레이트를 배정한 섹션만 — 2026-10-28부터 T3c) */
function withPlates(job: PdpJobRow): PdpJobRow {
  const plates = job.section_plan
    .designcut!.sections.filter((s) => s.plateKey)
    .map((s) => ({ section: s.plateKey!, url: `https://img.test/${s.plateKey!.replace(/:/g, '-')}.png` }))
  return { ...job, section_images: [...job.section_images, ...plates] }
}
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return rgbToLch([(n >> 16) & 255, (n >> 8) & 255, n & 255]).h
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
const PHOTO_TEMPLATES = new Set(['T1', 'T3b', 'T3c'])
/** 사진 바탕(P)을 쓸 수 있는 템플릿 — 고정 사진 바탕 + 늘 제품 사진이 있는 POINT(T3a, 밝은 면 연속을 끊을 때만 — B 배치 점검 ①) */
const P_TEMPLATES = new Set([...PHOTO_TEMPLATES, 'T3a'])

describe('디자인 컷 계획 v2 — R1 P02·P03·P07 재생', () => {
  it('팔레트가 상품마다 자기 사진에서 나온다 — P02 금색 강조·분홍 면(카피 #c2410c 아님), P03·P07 녹색 계열', async () => {
    const [p02, p03, p07] = await Promise.all((['p02', 'p03', 'p07'] as const).map((n) => planned(n)))
    const pal = (j: PdpJobRow) => j.section_plan.designcut!.palette
    expect(pal(p02)).toMatchObject({ source: 'photo', highKey: true })
    expect(hueGap(hue(pal(p02).accent), 79)).toBeLessThan(15)
    expect(hueGap(hue(pal(p02).tint), hue(pal(p02).photoBackground!))).toBeLessThan(12)
    expect(hueGap(hue(pal(p02).accent), hue('#c2410c'))).toBeGreaterThan(25)
    for (const j of [p03, p07]) {
      expect(pal(j).source).toBe('photo')
      expect(hue(pal(j).accent)).toBeGreaterThan(110)
      expect(hue(pal(j).accent)).toBeLessThan(180)
    }
  })

  it('측정 실패 기록이면 카피 primary 파생 그대로(폴백) — source 없음', async () => {
    const job = await planned('p02', false)
    const pal = job.section_plan.designcut!.palette
    expect(pal.source).toBeUndefined()
    expect(pal.accent).toBe('#EF6731')
  })

  it.each(['p02', 'p03', 'p07'] as const)(
    '%s: 같은 컷은 한 섹션만, 마무리(T8)는 cta 컷, 옵션(T7)은 대표 컷 없이 실물 사진 칩',
    async (name) => {
      const plan = (await planned(name)).section_plan.designcut!
      const keys = plan.sections.map((s) => s.productImageKey).filter((k): k is string => k !== null)
      expect(new Set(keys).size).toBe(keys.length)
      expect(plan.sections.find((s) => s.template === 'T8')?.productImageKey).toBe('cta')
      const t7 = plan.sections.find((s) => s.template === 'T7')
      if (t7) {
        expect(t7.productImageKey).toBeNull()
        const chips = t7.modules.find((m) => m.type === 'M8')!.data.chips as Array<{
          label: string
          image?: string | null
        }>
        expect(chips.some((c) => c.image?.startsWith('https://img.test/'))).toBe(true)
      }
    }
  )

  /** 조립 뒤 D 섹션 높이 비중 — 사진 템플릿이 아닌 디자인 컷 섹션 중 바탕이 deep(단색, 또는 플레이트 없을 때 deep으로 시작하는 그라디언트) */
  async function darkShare(job: PdpJobRow) {
    const plan = job.section_plan.designcut!
    const doc = await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
    const total = doc.sections.reduce((s, x) => s + x.canvas.height, 0)
    const dark = doc.sections
      .filter((s) => s.layoutId.startsWith('designcut_') && !PHOTO_TEMPLATES.has(s.layoutId.slice(10)))
      .filter((s) => s.canvas.backgroundColor.includes(plan.palette.deep))
    // 잰 것이 계획의 D 섹션 전부인지(판정이 바탕 표기를 놓치면 0으로 잰다)
    expect(dark.length).toBe(plan.sections.filter((s) => s.bg === 'D').length)
    return dark.reduce((s, x) => s + x.canvas.height, 0) / total
  }

  it.each([
    ['p02', {}, 0.2],
    ['p03', {}, 0.2],
    ['p07', {}, 0.2],
    // verifier 재현 사례 — 피처 컷이 적으면 T3b(P)가 밝은 면 연속을 끊지 못해 예전 비용(상한 800)에서 27~37%
    ['p02', { detailPoints: 2 }, 0.2],
    ['p02', { detailPoints: 0 }, 0.2],
    // 짧은 페이지(POINT 없음) — 마무리 T8 하나만으로 목표(0.18)를 넘으면 짙은 면을 더 넣지 않는다(verifier 2차 38.6%)
    ['p02', { detailPoints: 0, pointCards: 0 }, 0.25],
    ['p03', { detailPoints: 0 }, 0.2],
    // 하이키 아님(짙고 선명한 상품) — 30%
    ['p02', { detailPoints: 0, photo: { productLightness: 40, productChroma: 70, product: '#1D4ED8' } }, 0.3],
  ] as const)('%s %o: 사진 바탕(P)은 사진 템플릿·POINT(T3a)만, 조립 뒤 짙은 바탕(D) 높이 ≤ 상한 %s', async (name, edit, cap) => {
    const job = withPlates(await planned(name, true, edit))
    const plan = job.section_plan.designcut!
    expect(plan.sections.filter((s) => s.bg === 'P').every((s) => P_TEMPLATES.has(s.template))).toBe(true)
    expect(await darkShare(job)).toBeLessThanOrEqual(cap)
    // 하이키는 짙은 면이 마무리(T8) 하나뿐이다
    if (plan.palette.highKey) expect(plan.sections.filter((s) => s.bg === 'D').map((s) => s.template)).toEqual(['T8'])
  })

  it.each(['p02', 'p03', 'p07'] as const)(
    '%s: 상품 컷이 있는 섹션에는 플레이트가 없고, 제품 컷 생성 배경·스타일 헌장 배경은 컷 바탕(사진 촬영 배경)',
    async (name) => {
      const job = await planned(name)
      const plan = job.section_plan.designcut!
      expect(plan.sections.filter((s) => s.plateKey).every((s) => s.template === 'T3c' || !s.productImageKey)).toBe(
        true
      )
      const bg = cutBackgroundOf(plan.palette)
      const copyBg = job.copy_sections.final!.designPalette!.bgMain!
      expect(bg.toLowerCase()).not.toBe(copyBg.toLowerCase())
      const tasks = buildImageTasks(job)
      const hero = tasks.find((t) => t.section === 'hero')!.prompt
      expect(hero).toContain(bg)
      expect(hero).not.toContain(copyBg)
      // 디자인 컷이 아닌 잡은 카피 배경 그대로
      expect(buildImageTasks(r1Job(name, false)).find((t) => t.section === 'hero')!.prompt).toContain(copyBg)
    }
  )

  it.each(['p02', 'p03', 'p07'] as const)(
    '%s: 생성 태스크는 계획이 쓰는 키 + 대체 기존 섹션 키뿐(절반 이하), 쓰는 키는 모두 생성',
    async (name) => {
      const job = await planned(name)
      const plan = job.section_plan.designcut!
      const tasks = buildImageTasks(job).map((t) => t.section)
      const before = buildImageTasks(r1Job(name, false)).map((t) => t.section)
      expect(tasks.length).toBeLessThanOrEqual(before.length / 2 + plan.sections.filter((s) => s.plateKey).length)
      for (const s of plan.sections) {
        if (s.productImageKey) expect(tasks).toContain(s.productImageKey)
        if (s.plateKey) expect(tasks).toContain(s.plateKey)
      }
      expect(tasks).toContain('hero')
      expect(tasks).not.toContain('usp_icons:0')
    }
  )

  it('계획은 기록된 측정만 읽는다 — 기록 뒤 재계산(태스크 폴백)과 같고, 이미지 진행과 무관', async () => {
    const job = await planned('p02')
    const again = buildDesigncutPlan({
      ...job,
      section_plan: { ...job.section_plan, designcut: undefined },
      section_images: [],
    })
    expect(again).toEqual(job.section_plan.designcut)
    const withoutRecord = buildImageTasks({ ...job, section_plan: { ...job.section_plan, designcut: undefined } })
    expect(withoutRecord.map((t) => [t.section, t.prompt])).toEqual(
      buildImageTasks(job).map((t) => [t.section, t.prompt])
    )
  })

  it('생성 범위 밖이 된 섹션의 예전 재생성 대기는 images 단계를 다시 부르지 않는다(배포 전환기 — 무한 반복 방지)', async () => {
    const planned02 = await planned('p02')
    const features = planned02.section_plan.enrichment!.features.filter((f) => f !== 'annotations')
    const job: PdpJobRow = {
      ...planned02,
      research_result: { pain_points: [] } as unknown as PdpJobRow['research_result'],
      section_plan: { ...planned02.section_plan, enrichment: { ...planned02.section_plan.enrichment!, features } },
    }
    const done = buildImageTasks(job).map((t) => ({ section: t.section, url: `https://img.test/${t.section}.png` }))
    const stale = { section: 'usage', url: 'https://img.test/usage.png', pendingRegen: true }
    expect(buildImageTasks(job).some((t) => t.section === 'usage')).toBe(false)
    expect(resolveStepToRun({ ...job, section_images: [...done, stale] })).toBe('compose')
    // 지금 태스크에 있는 섹션의 대기는 그대로 images
    expect(resolveStepToRun({ ...job, section_images: [...done, { ...done[0], pendingRegen: true }] })).toBe('images')
  })
})
