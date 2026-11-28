import { describe, expect, it } from 'vitest'
import { REGEN_NOTE_MAX_CHARS, REGEN_STYLES, type RegenEstimate } from '@/lib/registration/pdp-image-regen'
import type { PdpJobRow, SectionImage } from '@/lib/registration/pdp-state'
import { buildImageTasks, buildKnownImageTasks } from '@/lib/registration/pdp-image-tasks'
import { legacyImageTasks } from '@/lib/registration/internalized/designcut-images'
import { fixtureToJob, loadEnrichmentFixture } from '@/lib/registration/__golden__/golden-harness'
import { SECTION_IMAGE_MAPPING } from '../constants/sectionConfig'
import { ProSectionType } from '../types/section'
import type { DesignPalette } from '../types/editor'
import { appendedImage, elementsWithSrc, imageSrcPatch } from './imageSwap'
import {
  REGEN_NOTE_LIMIT,
  REGEN_STYLE_ORDER,
  addableImageKey,
  pendingAdds,
  pendingApplies,
  regenCostLines,
  regenSectionForSrc,
  regenStateOf,
  sectionImageKeyOf,
} from './regenTarget'
import { R1_JOBS, renderR1 } from './sectionConverter/__fixtures__/r1Render'
import { createPlaceholderSection } from './sectionConverter/labels'

const T0 = '2026-10-29T01:00:00.000Z'

describe('서버 계약과 같은 값', () => {
  it('스타일 키·순서와 요청 문구 상한이 pdp-image-regen.ts와 같다(UI는 값을 들여오지 않는다)', () => {
    expect(REGEN_STYLE_ORDER).toEqual(REGEN_STYLES)
    expect(REGEN_NOTE_LIMIT).toBe(REGEN_NOTE_MAX_CHARS)
  })
})

describe('regenSectionForSrc', () => {
  const images: SectionImage[] = [
    { section: 'hero', url: 'https://img.test/hero.png' },
    { section: 'features:0', url: 'https://img.test/f0.png', error: '생성 실패' },
  ]
  it('src와 같은 url의 섹션 키를 찾고, 생성 실패 항목·없는 src·빈 src는 대상이 아니다', () => {
    expect(regenSectionForSrc(images, 'https://img.test/hero.png')).toBe('hero')
    expect(regenSectionForSrc(images, 'https://img.test/f0.png')).toBeNull()
    expect(regenSectionForSrc(images, 'https://cdn.test/user-upload.png')).toBeNull()
    expect(regenSectionForSrc(images, null)).toBeNull()
  })
})

describe('regenStateOf', () => {
  const entry = (editorRegen?: SectionImage['editorRegen']): SectionImage[] => [{ section: 'hero', url: 'https://img.test/new.png', editorRegen }]
  it('기록이 없으면 null, 다른 요청의 기록이면 아직 대기, 상태별로 결과를 돌려준다', () => {
    expect(regenStateOf(entry(), 'hero')).toBeNull()
    expect(regenStateOf(entry({ requestedAt: 'old', status: 'done', previousUrl: 'p' }), 'hero', T0)).toEqual({ state: 'pending' })
    expect(regenStateOf(entry({ requestedAt: T0, status: 'pending' }), 'hero', T0)).toEqual({ state: 'pending' })
    expect(regenStateOf(entry({ requestedAt: T0, status: 'done', previousUrl: 'https://img.test/old.png' }), 'hero', T0)).toEqual({
      state: 'done',
      url: 'https://img.test/new.png',
      previousUrl: 'https://img.test/old.png',
    })
    expect(regenStateOf(entry({ requestedAt: T0, status: 'rejected', message: '다른 상품' }), 'hero', T0)).toEqual({ state: 'rejected', message: '다른 상품' })
    expect(regenStateOf(entry({ requestedAt: T0, status: 'failed' }), 'hero', T0)).toMatchObject({ state: 'failed' })
  })
})

describe('pendingApplies — R1 저장 잡', () => {
  for (const [key, f] of R1_JOBS) {
    it(`${key}: done 기록의 이전 이미지가 든 자리를 모두 찾고, 바꾼 뒤에는 남지 않으며, 프리셋 가드 탈락은 0`, async () => {
      const { doc, stats } = await renderR1(f)
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)
      const [section, from] = Object.entries(f.images as Record<string, unknown>).find(
        ([, u]) => typeof u === 'string' && elementsWithSrc(doc.sections, u).length > 0
      ) as [string, string]
      const to = 'https://img.test/regen-new.png'
      const images: SectionImage[] = [
        { section, url: to, editorRegen: { requestedAt: T0, status: 'done', previousUrl: from } },
        { section: 'other', url: 'https://img.test/other.png', editorRegen: { requestedAt: T0, status: 'rejected', message: 'x' } },
      ]
      const [apply, ...rest] = pendingApplies(images, doc.sections)
      expect(rest).toEqual([])
      expect(apply).toEqual({ section, from, to, targets: elementsWithSrc(doc.sections, from) })

      const targets = new Set(apply.targets.map((t) => t.elementId))
      const swapped = doc.sections.map((s) => ({
        ...s,
        elements: s.elements.map((el) => (targets.has(el.id) ? { ...el, ...imageSrcPatch(el, to, false) } : el)),
      }))
      expect(pendingApplies(images, swapped)).toEqual([])
      expect(swapped.map((s) => s.elements.length)).toEqual(doc.sections.map((s) => s.elements.length))
    })
  }
})

describe('사후 재생성(W5b) — 사진 없는 섹션의 새 컷', () => {
  const PALETTE = {
    primary: '#3366CC',
    secondary: '#88AADD',
    accent: '#FFAA00',
    bgMain: '#FFFFFF',
    bgSub: '#F5F5F5',
    textMain: '#1A1A1A',
    textSub: '#666666',
    textHighlight: '#3366CC',
  } as unknown as DesignPalette
  // 편집기 '섹션 추가'와 같은 섹션(카피·컷 없음)
  const placeholder = (type: ProSectionType) => createPlaceholderSection(type, PALETTE, 0)
  const NEW_URL = 'https://img.test/size-new.png'

  it('섹션 유형 → 서버 태스크 키 — 빌더 매핑(legacyImageTasks) 안의 키, 사진 없는 섹션·옵션 갤러리·모르는 유형은 null', () => {
    expect(sectionImageKeyOf('point_div')).toBe('features:0')
    expect(sectionImageKeyOf('sub_div')).toBe('features:3')
    expect(sectionImageKeyOf('point_list_div')).toBe('features:2')
    expect(sectionImageKeyOf('hidden_page')).toBe('howto:0')
    expect(sectionImageKeyOf('convert_div')).toBe('cta')
    expect(sectionImageKeyOf('main_cut')).toBe('premium_hero')
    expect(sectionImageKeyOf('compare_div')).toBe('size_comparison')
    expect(sectionImageKeyOf('spec_table')).toBeNull()
    expect(sectionImageKeyOf('petit_div')).toBeNull()
    expect(sectionImageKeyOf('nope')).toBeNull()
    for (const type of Object.keys(SECTION_IMAGE_MAPPING)) {
      const key = sectionImageKeyOf(type)
      if (!key) continue
      const legacy = legacyImageTasks(type) ?? []
      expect(legacy.some((l) => l === key || (l.endsWith(':*') && key.startsWith(l.slice(0, -1)))), type).toBe(true)
    }
  })

  it('lean 잡이 만들지 않은 골격 밖 섹션(비교)의 키는 서버가 아는 키다 — 요청이 400이 아니다', () => {
    const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    const lean = {
      ...job,
      analysis: { ...job.analysis, enrichment: { version: 1, features: ['vocab', 'persuasion', 'lean'] } },
    } as PdpJobRow
    const key = sectionImageKeyOf(ProSectionType.COMPARE_DIV)!
    expect(buildImageTasks(lean).some((t) => t.section === key)).toBe(false)
    expect(buildKnownImageTasks(lean).some((t) => t.section === key)).toBe(true)
  })

  it('addableImageKey — 사진 없는 섹션이고 그 키의 컷이 없을 때만(항목 없음·생성 실패·대기), 컷이 있거나 섹션에 사진이 있으면 null', () => {
    const compare = placeholder(ProSectionType.COMPARE_DIV)
    expect(addableImageKey([], compare)).toBe('size_comparison')
    expect(addableImageKey([{ section: 'size_comparison', url: '', error: '생성 실패' }], compare)).toBe('size_comparison')
    const pending: SectionImage = {
      section: 'size_comparison',
      url: '',
      pendingRegen: true,
      editorRegen: { requestedAt: T0, status: 'pending', added: true },
    }
    expect(addableImageKey([pending], compare)).toBe('size_comparison')
    expect(addableImageKey([{ section: 'size_comparison', url: NEW_URL }], compare)).toBeNull()
    expect(addableImageKey([], placeholder(ProSectionType.SPEC_TABLE))).toBeNull()
    const { element } = appendedImage(compare, NEW_URL, { width: 1024, height: 768 }, 'new', 'size_comparison')
    expect(addableImageKey([], { ...compare, elements: [...compare.elements, element] })).toBeNull()
  })

  it('appendedImage — 가장 아래 요소 밑에 내용 폭·사진 비율로 놓고 섹션 높이를 늘린다(줄이지 않는다)', () => {
    const compare = placeholder(ProSectionType.COMPARE_DIV)
    const bottom = Math.max(...compare.elements.map((el) => el.transform.y + el.transform.height))
    const { element, height } = appendedImage(compare, NEW_URL, { width: 1024, height: 768 }, 'new-1', 'size_comparison')
    expect(element).toMatchObject({
      id: 'new-1',
      type: 'image',
      transform: { x: 60, width: 740, height: 555 },
      imageProps: { src: NEW_URL, imageType: 'size_comparison', isUserUploaded: false },
    })
    expect(element.transform.y).toBeGreaterThan(bottom)
    expect(element.zIndex).toBeGreaterThan(Math.max(...compare.elements.map((el) => el.zIndex)))
    expect(height).toBe(element.transform.y + 555 + 140)
    expect(height).toBeGreaterThan(compare.canvas.height)
    const tall = { ...compare, canvas: { ...compare.canvas, height: 99999 } }
    expect(appendedImage(tall, NEW_URL, { width: 1, height: 1 }, 'x', 'size_comparison').height).toBe(99999)
  })

  it('pendingAdds — 이전 이미지 없이 만든 done 컷이 문서에 없으면 그 키의 사진 없는 섹션에 넣을 일, 넣은 뒤·바꾼 컷·실패는 아니다', () => {
    const compare = placeholder(ProSectionType.COMPARE_DIV)
    const done: SectionImage = { section: 'size_comparison', url: NEW_URL, editorRegen: { requestedAt: T0, status: 'done', added: true } }
    const want = [{ section: 'size_comparison', url: NEW_URL, sectionId: compare.id }]
    expect(pendingAdds([done], [compare])).toEqual(want)
    // 생성이 실패했던 항목(덧붙임 아님)을 다시 만든 컷도 같다
    expect(pendingAdds([{ ...done, editorRegen: { requestedAt: T0, status: 'done' } }], [compare])).toEqual(want)
    const { element } = appendedImage(compare, NEW_URL, { width: 1, height: 1 }, 'n', 'size_comparison')
    expect(pendingAdds([done], [{ ...compare, elements: [...compare.elements, element] }])).toEqual([])
    // 오너가 그 컷을 다른 섹션으로 옮겼으면 이미 넣은 것이다 — 같은 유형의 빈 섹션이 있어도 다시 넣지 않는다
    const moved = { ...placeholder(ProSectionType.SPEC_TABLE), elements: [element] }
    expect(pendingAdds([done], [compare, moved])).toEqual([])
    expect(pendingAdds([{ ...done, editorRegen: { ...done.editorRegen!, previousUrl: 'https://img.test/p.png' } }], [compare])).toEqual([])
    expect(pendingAdds([{ ...done, url: '', editorRegen: { ...done.editorRegen!, status: 'failed' } }], [compare])).toEqual([])
    expect(pendingAdds([{ section: 'size_comparison', url: NEW_URL }], [compare])).toEqual([])
    expect(pendingAdds([done], [placeholder(ProSectionType.SPEC_TABLE)])).toEqual([])
  })
})

describe('regenCostLines', () => {
  const base: RegenEstimate = { model: 'gpt-image-2', quality: 'medium', billed: true, imageUsd: 0.053, maxImageUsd: 0.106 }
  it('과금 모델은 1장 값과 게이트 재생성 포함 최대값을, 구독 모델은 과금 없음을 알린다', () => {
    const billed = regenCostLines(base).join('\n')
    expect(billed).toContain('$0.053')
    expect(billed).toContain('$0.106')
    const local = regenCostLines({ ...base, model: 'codex-image', billed: false, imageUsd: 0, maxImageUsd: 0 }).join('\n')
    expect(local).toContain('과금이 없습니다')
    expect(local).not.toContain('$')
  })
})
