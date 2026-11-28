/**
 * 디자인 컷 2단계 편집기 배치(2026-10-28 3자 검토) — 사진 측정 필드 읽기, 상품 사진 무대(카드·그림자·받침 없음, contain 3:4),
 * T3b 글자 띠, 압축 장 머리, 옵션 실물 사진 카드.
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { flattenModules, readDesignCut } from './contract'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'

const PINK = '#F7CECF'

async function docFor(plan = designCutPlanForB()) {
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}

function photoPlan() {
  const plan = designCutPlanForB()
  Object.assign(plan.palette, { photoBackground: PINK, highKey: true, source: 'photo' })
  return plan
}

const section = (doc: { sections: CanvasSection[] }, layout: string) => doc.sections.find((s) => s.layoutId === layout)!
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const cutSections = (doc: { sections: CanvasSection[] }) => doc.sections.filter((s) => s.layoutId.startsWith('designcut_'))
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height

describe('계약 읽기 — 사진 측정 필드(A와 합의한 규칙)', () => {
  it('photoBackground(#RRGGBB)·highKey(boolean)·source(photo)와 옵션 실물 사진(http(s))을 읽는다', () => {
    const raw = photoPlan()
    raw.sections[9].modules = [
      {
        type: 'M8',
        data: {
          chips: [
            { label: '데이지(S)', color: null, image: 'https://cdn.test/daisy.jpg' },
            { label: '체리(L)', color: null, image: null },
            { label: '나쁜 주소', color: null, image: 'javascript:alert(1)' },
          ],
        },
      },
    ] as never
    const plan = readDesignCut({ designcut: raw })!
    expect(plan.palette).toMatchObject({ photoBackground: PINK, highKey: true, source: 'photo' })
    expect(flattenModules(plan.sections[9].modules).chips!.map((c) => c.image)).toEqual([
      'https://cdn.test/daisy.jpg',
      null,
      null,
    ])
  })

  it('형식이 틀린 사진 필드는 버린다(필드 없음 — 예전 기록과 같은 모양)', () => {
    const raw = designCutPlanForB()
    Object.assign(raw.palette, { photoBackground: 'pink', highKey: 'yes', source: 'copy' })
    const plan = readDesignCut({ designcut: raw })!
    expect(plan.palette).not.toHaveProperty('photoBackground')
    expect(plan.palette).not.toHaveProperty('highKey')
    expect(plan.palette).not.toHaveProperty('source')
  })
})

describe('상품 사진 무대 — 사진 배경색으로 이어 칠하고 카드·그림자·받침 없이 contain', () => {
  it('P 바탕은 짙은 면이 아니라 사진 배경색이고 그 위 글자는 대비가 맞는 색이다(위반 0)', async () => {
    const doc = await docFor(photoPlan())
    expect(section(doc, 'designcut_T1').canvas.backgroundColor).toBe(PINK)
    // 기록의 T3b(P)는 T3a로 그리고 바탕은 그대로 사진 배경색(장 머리도 사진 배경색 위)
    expect(cutSections(doc).filter((s) => s.layoutId === 'designcut_T3a').map((s) => s.canvas.backgroundColor)).toContain(PINK)
    expect(named(section(doc, 'designcut_T1'), 'designcut-headline')[0].textProps!.color).toBe('#1A1A1A')
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('짙은 바탕 섹션은 D 바탕과 플레이트 분위기 섹션뿐이다(P 상품 섹션은 더는 짙은 면이 아니다)', async () => {
    const doc = await docFor(photoPlan())
    const deep = cutSections(doc).filter((s) => s.canvas.backgroundColor === '#4A2414').map((s) => s.layoutId)
    // 픽스처 D 바탕은 T3a(POINT 02)·T8, T3c는 플레이트 위 전면 스크림 분위기 섹션 — P인 T1·POINT 03(기록 T3b → T3a)은 사진 배경색
    expect(deep).toEqual(['designcut_T3a', 'designcut_T3c', 'designcut_T8'])
  })

  it('바탕이 사진 배경색이 아닌 섹션(W·D·N·T)은 사진 높이만큼 사진 배경색 무대 띠를 깐다', async () => {
    const doc = await docFor(photoPlan())
    for (const sec of cutSections(doc).filter((s) => s.canvas.backgroundColor !== PINK)) {
      const products = named(sec, 'designcut-product')
      if (products.length === 0) continue
      const stages = named(sec, 'designcut-stage')
      expect(stages.length).toBeGreaterThan(0)
      for (const stage of stages) expect(stage.shapeProps?.fill).toBe(PINK)
      // 사진마다 그 사진을 덮는 무대가 있다(T5 단계 사진은 사진마다 무대 하나 — D2 ①)
      for (const p of products)
        expect(
          stages.some(
            (stage) =>
              stage.transform.y <= p.transform.y &&
              bottomOf(stage) >= bottomOf(p) &&
              stage.transform.x <= p.transform.x &&
              stage.transform.x + stage.transform.width >= p.transform.x + p.transform.width
          )
        ).toBe(true)
    }
    // 섹션 바탕이 이미 사진 배경색이면 띠를 따로 깔지 않는다
    expect(named(section(doc, 'designcut_T1'), 'designcut-stage')).toEqual([])
    // T3a·T8은 무대가 섹션 끝까지 — 무대 아래 바탕 띠가 남지 않는다
    for (const layout of ['designcut_T3a', 'designcut_T8']) {
      const sec = doc.sections.filter((s) => s.layoutId === layout && named(s, 'designcut-stage').length > 0).slice(-1)[0]!
      expect(bottomOf(named(sec, 'designcut-stage')[0])).toBe(sec.canvas.height)
    }
  })

  it('흰 카드·그림자·흰 테두리·접지 그림자·받침 타원·큰 번호·밑줄을 그리지 않는다', async () => {
    const doc = await docFor(photoPlan())
    const all = cutSections(doc).flatMap((s) => s.elements)
    expect(all.filter((e) => e.shadow)).toEqual([])
    for (const gone of [
      'designcut-product-card',
      'designcut-ground-shadow',
      'designcut-podium',
      'designcut-chapter-number',
      'designcut-chapter-underline',
    ])
      expect(all.filter((e) => e.name === gone)).toEqual([])
    const products = all.filter((e) => e.name === 'designcut-product')
    expect(products.length).toBeGreaterThanOrEqual(6)
    for (const p of products) {
      expect(p.framedImageProps).toMatchObject({ objectFit: 'contain', bgColor: 'transparent' })
      expect(p.framedImageProps!.borderWidth).toBeUndefined()
    }
  })

  it('제품 컷 상자는 생성 비율 3:4(사용 컷 1:1)라 contain이어도 잘림·빈 여백이 없고, 높이는 500 이상(M5)', async () => {
    const doc = await docFor(photoPlan())
    for (const layout of ['designcut_T1', 'designcut_T3a', 'designcut_T6', 'designcut_T8']) {
      for (const p of named(section(doc, layout), 'designcut-product')) {
        expect(p.transform.height / p.transform.width).toBeCloseTo(4 / 3, 2)
        expect(p.transform.height).toBeGreaterThanOrEqual(500)
      }
    }
    const howto = named(section(doc, 'designcut_T5'), 'designcut-product')[0]
    expect(howto.transform.width).toBe(howto.transform.height)
  })

  it('기록의 T3b POINT도 장 머리·제목 → 사진(T3a) 순서로 그린다 — 글이 사진 위, 사진 위에 겹친 글자·스크림 없음(B 배치 점검 ①)', async () => {
    const doc = await docFor(photoPlan())
    const sec = cutSections(doc).find((s) =>
      named(s, 'designcut-chapter-text').some((e) => e.textProps!.content === 'POINT 03')
    )!
    expect(sec.layoutId).toBe('designcut_T3a')
    const photo = named(sec, 'designcut-product')[0]
    expect(named(sec, 'designcut-scrim')).toEqual([])
    expect(named(sec, 'designcut-band')).toEqual([])
    for (const t of sec.elements.filter((e) => e.type === 'text')) expect(bottomOf(t)).toBeLessThanOrEqual(photo.transform.y)
  })

  it('압축 장 머리 — 캡슐 한 줄 바로 아래 헤드라인(세로형보다 낮다)', async () => {
    const sec = section(await docFor(photoPlan()), 'designcut_T3a')
    const capsule = named(sec, 'designcut-chapter-bg')[0]
    const headline = named(sec, 'designcut-headline')[0]
    expect(headline.transform.y - bottomOf(capsule)).toBeLessThanOrEqual(24)
    // 예전 세로형: 캡슐 64 + 8 + 큰 번호(96×1.15) + 28 ≈ 210 — 압축형은 캡슐 64 + 20
    expect(headline.transform.y - capsule.transform.y).toBeLessThanOrEqual(90)
  })
})

describe('같은 바탕 연속 구분선(짙은 바탕 상한으로 W→W 이웃이 생길 때)', () => {
  it('같은 단색 바탕이 이어지면 뒤 섹션 맨 위에 본문 폭 2px 선 — 높이는 그대로, 바탕이 다르면 선이 없다', async () => {
    const base = await docFor()
    const plan = designCutPlanForB()
    plan.sections.find((s) => s.key === 'solution_guide')!.bg = 'W' // T4(W) → T5(W)
    const doc = await docFor(plan)
    const t5 = section(doc, 'designcut_T5')
    const divider = named(t5, 'designcut-divider')
    expect(divider).toHaveLength(1)
    expect(divider[0].transform).toMatchObject({ x: 60, y: 0, width: 740, height: 2 })
    expect(divider[0].shapeProps!.fill).toBe('rgba(26, 26, 26, 0.14)')
    expect(t5.canvas.height).toBe(section(base, 'designcut_T5').canvas.height)
    // 기본 픽스처(T4 T → T5 W)에는 선이 없다
    expect(named(section(base, 'designcut_T5'), 'designcut-divider')).toEqual([])
    expect(checkMobileReadability(doc).violations).toEqual([])
  })

  it('짙은 바탕이 이어지면 흰 반투명 선이다', async () => {
    const plan = designCutPlanForB()
    plan.sections.find((s) => s.key === 'point_div:2')!.bg = 'D' // POINT 02 T3a(D) → POINT 03 T3a(D, 기록은 T3b)
    const doc = await docFor(plan)
    const third = cutSections(doc).find((s) =>
      named(s, 'designcut-chapter-text').some((e) => e.textProps!.content === 'POINT 03')
    )!
    const divider = named(third, 'designcut-divider')
    expect(divider.map((e) => e.shapeProps!.fill)).toEqual(['rgba(255, 255, 255, 0.24)'])
    expect(checkMobileReadability(doc).violations).toEqual([])
  })
})

describe('T7 옵션 — 실물 사진 카드, 사진 없는 옵션은 이름만', () => {
  function optionPlan() {
    const plan = photoPlan()
    const t7 = plan.sections.find((s) => s.template === 'T7')!
    t7.productImageKey = null as never
    t7.modules = [
      {
        type: 'M8',
        data: {
          chips: [
            { label: '데이지(S)', color: null, image: 'https://cdn.test/daisy.jpg' },
            { label: '체리(L)', color: null, image: null },
            { label: '크라프트', color: '#C8A27A', image: null },
          ],
        },
      },
    ] as never
    return plan
  }

  it('사진이 있는 옵션은 그 사진(contain)과 등록 옵션명, 없는 옵션은 이름 칸만 — 대표 컷·번호 원은 그리지 않는다', async () => {
    const doc = await docFor(optionPlan())
    const sec = section(doc, 'designcut_T7')
    const photos = sec.elements.filter((e) => e.name.startsWith('designcut-option-photo-'))
    expect(photos.map((e) => e.framedImageProps!.src)).toEqual(['https://cdn.test/daisy.jpg'])
    expect(photos[0].framedImageProps!.objectFit).toBe('contain')
    expect(named(sec, 'designcut-option-label-0')[0].textProps!.content).toBe('데이지(S)')
    const names = sec.elements.filter((e) => e.name.startsWith('designcut-option-label-name-')).map((e) => e.textProps!.content)
    expect(names).toEqual(['체리(L)', '크라프트'])
    // 이름만 — 색 점·번호 원·대표 컷 없음, 이름 글자는 열 폭 380(M6)
    expect(sec.elements.filter((e) => /designcut-option-color|designcut-chip-number|designcut-product$/.test(e.name))).toEqual([])
    for (const e of sec.elements.filter((x) => x.name.startsWith('designcut-option-label'))) expect(e.transform.width).toBe(380)
    expect(checkMobileReadability(doc).violations).toEqual([])
  })
})
