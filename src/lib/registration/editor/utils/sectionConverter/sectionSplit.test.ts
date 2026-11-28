/**
 * W4-S 섹션 나누기(ENRICHMENT `split`, 통합 승인 2026-10-30) — split 기록 잡의 편집기 문서는 point_div·sub_div의 특징과
 * hidden_page의 사용 단계를 하나씩 섹션으로 펼친다(section_plan은 유형 그대로). 머리말은 첫 인스턴스만, 번호·STEP·컷 키는 전체 순번,
 * 다른 항목의 컷을 대신 쓰지 않는다(조건 b). split 기록이 없으면 지금 그대로다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import type { EditorDataResponse } from '../../services/editorApi'
import { buildEditorDocument } from '../buildEditorDocument'
import { ProSectionType } from '../../types/section'
import { splitSectionParts } from './convert'
import fixture from './__fixtures__/r1-p02-d10ea762.json'

const FEATURES = fixture.section_plan.enrichment.features as string[]
/** 사용 단계 펼침을 보려고 hidden_page를 cta 앞에 더한 계획 */
const ORDER_WITH_HOWTO = [...fixture.section_plan.section_order.slice(0, -1), 'hidden_page', 'cta']

async function render(
  features: string[],
  order: string[] = fixture.section_plan.section_order,
  opts: { images?: Record<string, unknown>; mobile?: boolean } = {}
) {
  const response = {
    is_new: true,
    sections_data: [],
    layout_assignments: {},
    copywriting_result: fixture.copy,
    generated_images: opts.images ?? fixture.images,
    spec_sheet: fixture.spec_sheet,
    section_plan: {
      ...fixture.section_plan,
      activated_sections: order,
      section_order: order,
      // 두 열(모바일 하한 없음) 경로는 기록에서도 mobile을 뺀다 — 기록에 mobile이 있으면 하한 변형이 켜진다
      enrichment: {
        ...fixture.section_plan.enrichment,
        features: opts.mobile === false ? features.filter((f) => f !== 'mobile') : features,
      },
    },
    mobile_floor: opts.mobile ?? true,
  } as unknown as EditorDataResponse
  return (await buildEditorDocument('r1-p02', response)).sections
}

const ofType = (sections: CanvasSection[], type: ProSectionType) => sections.filter((s) => s.sectionType === type)
const textsOf = (section: CanvasSection) => section.elements.map((el) => el.textProps?.content ?? '').filter(Boolean)
const photosOf = (section: CanvasSection) =>
  section.elements
    .map((el) => el.imageProps?.src ?? el.framedImageProps?.src ?? '')
    .filter((src) => src && !src.includes('icon'))

describe('splitSectionParts', () => {
  it('특징·사용 단계는 항목 하나씩(앞 3개까지), 나눌 유형이 아니면 null', () => {
    const parts = splitSectionParts(ProSectionType.POINT_DIV, { points: ['a', 'b', 'c', 'd'], sectionTitle: 't' })!
    expect(parts.map((p) => p.content.points)).toEqual([['a'], ['b'], ['c']])
    expect(parts.map((p) => p.split)).toEqual([
      { offset: 0, first: true },
      { offset: 1, first: false },
      { offset: 2, first: false },
    ])
    expect(parts[1].content.sectionTitle).toBe('t')
    expect(splitSectionParts(ProSectionType.HIDDEN_PAGE, { steps: ['s1', 's2'] })!.map((p) => p.content.steps)).toEqual(
      [['s1'], ['s2']]
    )
    expect(splitSectionParts(ProSectionType.CTA, { headline: 'x' })).toBeNull()
  })
})

describe('편집기 문서 — split 기록 잡만 펼친다', () => {
  it('split 기록이 없으면 지금 그대로(유형마다 섹션 하나)', async () => {
    const sections = await render(FEATURES, ORDER_WITH_HOWTO)
    expect(ofType(sections, ProSectionType.POINT_DIV)).toHaveLength(1)
    expect(ofType(sections, ProSectionType.HIDDEN_PAGE)).toHaveLength(1)
  })

  it('특징: point_div를 하나씩 — 머리말은 첫 섹션만, 번호는 1·2·3으로 이어진다', async () => {
    const [before, after] = await Promise.all([render(FEATURES), render([...FEATURES, 'split'])])
    const points = ofType(after, ProSectionType.POINT_DIV)
    expect(points.length).toBeGreaterThan(1)
    expect(points.length).toBeLessThanOrEqual(3)
    expect(points.map((s) => textsOf(s).includes('핵심 포인트'))).toEqual(points.map((_, k) => k === 0))
    points.forEach((s, k) => expect(textsOf(s)).toContain(String(k + 1)))
    // 펼친 만큼 섹션이 늘고, 섹션 id는 서로 다르다
    expect(after.length).toBeGreaterThan(before.length)
    expect(new Set(after.map((s) => s.id)).size).toBe(after.length)
  })

  it('추가 특징(sub_div)도 하나씩 — 머리말은 첫 섹션만', async () => {
    const subs = ofType(await render([...FEATURES, 'split']), ProSectionType.SUB_DIV)
    expect(subs.length).toBeGreaterThan(1)
    const header = textsOf(subs[0])[0]
    expect(subs.slice(1).every((s) => !textsOf(s).includes(header))).toBe(true)
  })

  it('사용 단계: hidden_page를 단계마다 — STEP 1·2·3, 단계마다 자기 컷이고 다른 단계 컷을 다시 쓰지 않는다', async () => {
    const steps = ofType(await render([...FEATURES, 'split'], ORDER_WITH_HOWTO), ProSectionType.HIDDEN_PAGE)
    expect(steps.length).toBe(Math.min(3, (fixture.copy.howTo as unknown[]).length))
    steps.forEach((s, k) => expect(textsOf(s)).toContain(`STEP ${k + 1}`))
    expect(steps.map((s) => textsOf(s).includes('사용 방법'))).toEqual(steps.map((_, k) => k === 0))
    const photos = steps.flatMap(photosOf)
    expect(new Set(photos).size).toBe(photos.length)
  })

  it('펼친 특징·단계 섹션끼리 같은 사진이 두 번 나오지 않는다(조건 b — 컷이 없으면 글 카드)', async () => {
    const sections = await render([...FEATURES, 'split'], ORDER_WITH_HOWTO)
    const split = sections.filter((s) =>
      [ProSectionType.POINT_DIV, ProSectionType.SUB_DIV, ProSectionType.HIDDEN_PAGE].includes(
        s.sectionType as ProSectionType
      )
    )
    const photos = split.flatMap(photosOf)
    expect(new Set(photos).size).toBe(photos.length)
  })

  // 사진이 모자란 경우 — 컷을 다른 항목에서 빌려 오지 않는다(조건 b)
  const SPLIT_TYPES = [ProSectionType.POINT_DIV, ProSectionType.SUB_DIV, ProSectionType.HIDDEN_PAGE]
  const splitPhotos = (sections: CanvasSection[]) =>
    sections.filter((s) => SPLIT_TYPES.includes(s.sectionType as ProSectionType)).flatMap(photosOf)

  it('단계 컷이 howto_0i 키로만 와도 단계마다 자기 컷', async () => {
    const { howToImages, ...rest } = fixture.images as Record<string, unknown>
    const [a, b, c] = howToImages as string[]
    const images = { ...rest, howto_00: a, howto_01: b, howto_02: c }
    const steps = ofType(await render([...FEATURES, 'split'], ORDER_WITH_HOWTO, { images }), ProSectionType.HIDDEN_PAGE)
    expect(steps.map(photosOf)).toEqual([[a], [b], [c]])
  })

  it.each([true, false])(
    '단계 컷이 1장뿐이면 나머지 단계는 사진 없이(모바일 하한 %s) — 1단계·대표 컷을 다시 쓰지 않는다',
    async (mobile) => {
      const images = {
        ...(fixture.images as Record<string, unknown>),
        howToImages: [(fixture.images.howToImages as string[])[0]],
      }
      const sections = await render([...FEATURES, 'split'], ORDER_WITH_HOWTO, { images, mobile })
      const photos = splitPhotos(sections)
      expect(new Set(photos).size).toBe(photos.length)
      expect(ofType(sections, ProSectionType.HIDDEN_PAGE).slice(1).flatMap(photosOf)).toEqual([])
    }
  )

  it('지그재그 sub_div도 남는 컷이 없으면 사진 없이 — point_div 피처 컷을 다시 쓰지 않는다', async () => {
    const images: Record<string, unknown> = { ...(fixture.images as Record<string, unknown>) }
    for (const key of ['key_benefit_visual', 'usage', 'concept_mood', 'direction_hint', 'howToImages'])
      delete images[key]
    images.features = (fixture.images.features as string[]).slice(0, 3)
    const photos = splitPhotos(
      await render([...FEATURES, 'split'], fixture.section_plan.section_order, { images, mobile: false })
    )
    expect(new Set(photos).size).toBe(photos.length)
  })
})
