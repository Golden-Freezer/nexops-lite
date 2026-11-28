import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '../../types/canvas'
import { checkMobileReadability, contrastRatio, parseColor } from '../mobileReadability'
import { MIN_TONE_DISTANCE, deepTone, toneDistance } from '../applyToneRhythm'
import { R1_JOBS as JOBS, renderR1 as render } from './__fixtures__/r1Render'
import p02 from './__fixtures__/r1-p02-d10ea762.json'
import p03 from './__fixtures__/r1-p03-f2d72bd0.json'

// R1 저장 잡(P02 포장 파우치·P03 두피 브러시·P07 반려동물 식기) 재렌더 — __fixtures__/r1Render.ts(테마·프리셋 포함, persuasion 기록 잡)

const body = (sections: CanvasSection[]) => sections.filter((s) => s.sectionType !== 'divider')
const hookOf = (sections: CanvasSection[]) => sections.find((s) => s.sectionType === 'hook_3step')!
const squash = (text: string) => text.replace(/\s+/g, '')

/** 핵심 포인트 (원, 숫자, 제목) 묶음 — 원의 중심이 제목 첫 줄(글자 크기 × 행간) 중심에 있고 숫자가 원 안에 있는지 함께 본다 */
function pointRows(sections: CanvasSection[]) {
  return sections
    .filter((s) => s.sectionType === 'point_div')
    .flatMap((section) =>
      section.elements
        .filter((e) => e.name.startsWith('point_badge_'))
        .map((badge) => {
          const i = badge.name.slice('point_badge_'.length)
          const title = section.elements.find((e) => e.name === `point_${i}_title`)!
          const num = section.elements.find((e) => e.name === `point_num_${i}`)!
          const center = badge.transform.y + badge.transform.height / 2
          const firstLine = title.textProps!.fontSize * title.textProps!.lineHeight!
          expect(Math.abs(center - (title.transform.y + firstLine / 2)), title.textProps!.content).toBeLessThanOrEqual(
            1
          )
          expect(num.transform.y).toBeGreaterThanOrEqual(badge.transform.y)
          expect(num.transform.y + num.transform.height).toBeLessThanOrEqual(badge.transform.y + badge.transform.height)
          return { badge, title }
        })
    )
}

describe('R1 세 잡 재렌더 — 후킹(첫 화면)은 카피와 이미지로만(2026-10-30 오너 지시)', () => {
  for (const [key, f] of JOBS) {
    it(`${key}: 후킹 글자는 모두 첫 화면 카피(mainIntro) 값이고 상품명·옵션 사실 줄이 없다, 프리셋 그대로·사진이 첫 화면 안`, async () => {
      const { doc, stats } = await render(f)
      const hook = hookOf(doc.sections)
      const texts = hook.elements.filter((e) => e.type === 'text').map((e) => e.textProps!.content)
      expect(texts.length).toBeGreaterThan(0)
      const copy = Object.values(f.copy.mainIntro)
        .filter((v): v is string => typeof v === 'string')
        .map(squash)
        .join('|')
      for (const text of texts) expect(copy, text).toContain(squash(text))
      const name = f.spec_sheet.productName.replace(`${f.spec_sheet.brandName} `, '')
      expect(texts.some((t) => t.includes(name))).toBe(false)
      expect(hook.elements.some((e) => e.name.startsWith('hero_fact'))).toBe(false)
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)
      const image = hook.elements.find((e) => e.type === 'image' || e.type === 'framed-image')!
      expect(image.transform.y + image.transform.height).toBeLessThanOrEqual(1860)
    })

    it(`${key}: 핵심 포인트 번호 원의 중심이 제목 첫 줄 중심에 있고 숫자가 원 안에 있다`, async () => {
      const rows = pointRows((await render(f)).doc.sections)
      expect(rows.length).toBeGreaterThan(0)
      for (const { title } of rows) {
        // B 배치 점검 #4: 제목 행간 1.3(두세 줄이 벌어지지 않게), 글자는 h2 하한 60 그대로
        expect(title.textProps!.lineHeight).toBe(1.3)
        expect(title.textProps!.fontSize).toBeGreaterThanOrEqual(60)
      }
    })

    it(`${key}: 대조 잡 — 테마가 제목 크기·행간을 바꾼 뒤에도 번호 원이 제목 첫 줄 중심에 있다`, async () => {
      expect(pointRows((await render(f, false)).doc.sections).length).toBeGreaterThan(0)
    })

    it(`${key}: 핵심 포인트·추가 특징 사진 칸은 원본 비율(세로 4:5 상한) — 2:3 피처 컷은 860×1075, 1:1 사용법 컷은 860×860`, async () => {
      const { doc } = await render(f)
      const photos = doc.sections
        .filter((s) => s.sectionType === 'point_div' || s.sectionType === 'sub_div')
        .flatMap((s) => s.elements.filter((e) => /^(point|sub)_\d+_img$/.test(e.name)))
      expect(photos.length).toBeGreaterThan(0)
      const square = new Set<string>(f.images.howToImages)
      for (const photo of photos) {
        const src = photo.imageProps!.src
        // gpt-image-2는 3:4 요청을 1024×1536(2:3)으로, 사용법 컷은 1:1로 만든다(pdp-image-stage ASPECT_TO_SIZE·pdp-image-prompts)
        const sourceH = photo.transform.width * (square.has(src) ? 1 : 1536 / 1024)
        expect(photo.transform, photo.name).toMatchObject({ width: 860, height: square.has(src) ? 860 : 1075 })
        // cover로 채울 때 보이는 세로 비율(예전 860×600 칸은 2:3 컷의 0.47)
        expect(photo.transform.height / sourceH, photo.name).toBeGreaterThanOrEqual(0.8)
      }
    })

    it(`${key}: 이웃 섹션 바탕이 실제 색으로 ${MIN_TONE_DISTANCE} 이상 다르고, 거터는 앞 바탕을 잇고, 모바일 M1~M7 0`, async () => {
      const { doc } = await render(f)
      const bgs = body(doc.sections).map((s) => s.canvas.backgroundColor)
      for (let i = 1; i < bgs.length; i++) {
        if (bgs[i - 1].startsWith('linear-gradient')) continue
        expect(toneDistance(bgs[i], bgs[i - 1]), `${i - 1}→${i} ${bgs[i - 1]} ${bgs[i]}`).toBeGreaterThanOrEqual(
          MIN_TONE_DISTANCE
        )
      }
      doc.sections.forEach((s, i) => {
        if (s.sectionType !== 'divider' || i === 0) return
        const prev = doc.sections[i - 1].canvas.backgroundColor
        if (!prev.startsWith('linear-gradient')) expect(s.canvas.backgroundColor).toBe(prev)
      })
      expect(checkMobileReadability(doc).violations).toEqual([])
    })
  }

  it('대조 잡 P03은 테마가 핵심 포인트 제목 크기·행간을 바꾼다 — 대조 잡 시험이 재정렬 경로를 실제로 지난다', async () => {
    const rows = pointRows((await render(p03, false)).doc.sections)
    expect(rows.some(({ title }) => title.textProps!.fontSize !== 60 || title.textProps!.lineHeight !== 1.3)).toBe(true)
  })

  it('짙은 띠: P02·P03 solution_guide가 짙은 바탕 + 흰 글자(대비 7 이상), 대조 잡은 짙은 띠 없음', async () => {
    for (const f of [p02, p03]) {
      const deep = deepTone(f.copy.designPalette.primary)
      expect(contrastRatio(parseColor(deep)!, [255, 255, 255])).toBeGreaterThanOrEqual(7)
      const solution = (await render(f)).doc.sections.find((s) => s.sectionType === 'solution_guide')!
      expect(solution.canvas.backgroundColor).toBe(deep)
      for (const el of solution.elements.filter((e) => e.type === 'text')) expect(el.textProps!.color).toBe('#FFFFFF')
      const control = (await render(f, false)).doc.sections.find((s) => s.sectionType === 'solution_guide')!
      expect(control.canvas.backgroundColor).not.toBe(deep)
    }
  })
})
