import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import { MIN_FONT_SIZES } from '../constants/designTokens'
import {
  ACCENT_SMALL_CONTRAST,
  LEGIBLE_SECTIONS,
  SCENE_IMAGE_TYPES,
  SCENE_PHOTO_MAX_PX,
  applyLegibleText,
  backgroundStops,
  capScenePhotos,
  isAccentColor,
  legibleColor,
  textBackdrops,
} from './applyLegibility'
import { checkMobileReadability, contrastRatio, parseColor } from './mobileReadability'
import { makeImageEl, makeShapeEl, makeTextEl } from './sectionConverter/elements'
import { R1_JOBS, renderR1 } from './sectionConverter/__fixtures__/r1Render'

const section = (sectionType: string, elements: CanvasElement[], backgroundColor = '#FFF7ED', height = 2400) =>
  ({
    id: sectionType,
    sectionType,
    canvas: { width: 860, height, backgroundColor },
    elements,
  }) as unknown as CanvasSection
const named = (s: CanvasSection, name: string) => s.elements.find((e) => e.name === name)!
const contrastOn = (color: string, bg: string) => contrastRatio(parseColor(color)!, parseColor(bg)!)
/** 가장 센 채널(r·g·b) — 같은 색상 계열인지 거칠게 본다 */
const dominant = (color: string) => {
  const rgb = parseColor(color)!
  return 'rgb'[rgb.indexOf(Math.max(...rgb))]
}

/** 보조 문구·카드 설명 — 제목급·3자 이하 숫자·기호 표식·장식 제외(모듈 판정과 같은 기준으로 다시 센다) */
function supportingTexts(s: CanvasSection) {
  const isMark = (text: string) => [...text].length <= 3 && /^(?:[0-9\p{P}\p{S}]+|[A-Za-z])$/u.test(text)
  return s.elements.filter(
    (e) =>
      e.type === 'text' &&
      e.isVisible !== false &&
      !['display', 'h1', 'h2'].includes(e.textProps?.typoLevel ?? '') &&
      !isMark((e.textProps?.content ?? '').replace(/\s+/g, '')) &&
      !e.name.startsWith('annotation-')
  )
}

describe('capScenePhotos — 인물·연출 컷 높이 상한 1:1', () => {
  it('고민 장면(사람만): 1147 → 860, 아래 요소·섹션을 그만큼 올리고, 위쪽 정렬로 머리를 남긴다(원본 비율과 무관, 자르기 창 없음)', () => {
    const photo = makeImageEl('problem_img', 'https://img.test/problem.png', 'problem', 0, 934, 860, 1147)
    const below = makeTextEl('after', '사진 아래 문구', 'body', 60, 2121, 740, '#262626')
    const [out] = capScenePhotos([section('problem_raise', [photo, below], '#FFF7ED', 2221)])
    expect(named(out, 'problem_img').transform.height).toBe(SCENE_PHOTO_MAX_PX)
    expect(named(out, 'after').transform.y).toBe(2121 - 287)
    expect(out.canvas.height).toBe(2221 - 287)
    // 자르기 창은 원본 비율을 가정해야 한다(Gemini·사진 교체는 2:3이 아닐 수 있다) — 위쪽 정렬(object-position top)만
    expect(named(out, 'problem_img').verticalAlign).toBe('top')
    expect(named(out, 'problem_img').imageProps!.cropRect).toBeUndefined()
  })

  it('제품이 나오는 장면(solution·usage)은 가운데 그대로 — 자르기 창 없이 높이만', () => {
    const photo = makeImageEl('image', 'https://img.test/solution.png', 'solution', 0, 0, 860, 1147)
    const [out] = capScenePhotos([section('solution_guide', [photo])])
    expect(named(out, 'image').transform.height).toBe(SCENE_PHOTO_MAX_PX)
    expect(named(out, 'image').imageProps!.cropRect).toBeUndefined()
    expect(named(out, 'image').verticalAlign).toBeUndefined()
  })

  it('상품 사진·글자를 얹은 사진·직접 자른 사진·좁은 사진·이미 낮은 사진은 그대로', () => {
    const product = makeImageEl('product_img', 'https://img.test/p.png', 'product_exposure', 0, 300, 860, 1147)
    const hero = makeImageEl('hero_image', 'https://img.test/h.png', 'hero', 0, 0, 860, 1147)
    const overlay = makeImageEl('cta_like', 'https://img.test/s.png', 'solution', 0, 0, 860, 1147)
    const overText = makeTextEl('over', '사진 위 문구입니다', 'body', 60, 400, 740, '#FFFFFF', 'center', 5)
    const cropped = makeImageEl('usage_img', 'https://img.test/u.png', 'usage', 0, 0, 860, 1147)
    cropped.imageProps!.cropRect = { x: 0, y: 0, width: 100, height: 80 }
    const narrow = makeImageEl('usage_img', 'https://img.test/u.png', 'usage', 60, 0, 600, 1147)
    const short = makeImageEl('usage_img', 'https://img.test/u.png', 'usage', 0, 0, 860, 600)
    for (const s of [
      section('product_exposure', [product]),
      section('hook_3step', [hero]),
      section('solution_guide', [overlay, overText]),
      section('point_list_div', [cropped]),
      section('point_list_div', [narrow]),
      section('point_list_div', [short]),
    ]) {
      expect(capScenePhotos([s])[0]).toBe(s)
    }
    expect([...SCENE_IMAGE_TYPES]).not.toContain('hero')
  })
})

describe('applyLegibleText — hook·main_cut·problem 보조 문구와 카드 설명', () => {
  it('2열 요약 카드: 라벨 36 → 본문 하한 45, 한 행씩 카드 바탕을 늘리고 아래 행·요소를 내린다', () => {
    const els: CanvasElement[] = []
    for (const [i, x] of [
      [0, 28],
      [1, 442],
      [2, 28],
      [3, 442],
    ] as const) {
      const y = i < 2 ? 1477 : 1679
      els.push(makeShapeEl(`usp_cell_${i}`, 'roundedRect', x, y, 390, 178, { fill: 'rgba(194,65,12, 0.04)' }, 1))
      els.push(
        makeTextEl(`usp_label_${i}`, '은은한 반투명', 'caption', x + 5, y + 108, 380, '#c2410c', 'center', 3, {
          fontSize: 36,
          fontWeight: 700,
          height: 54,
        })
      )
    }
    els.push(makeTextEl('after', '카드 아래 문구', 'body', 60, 1900, 740, '#262626'))
    const [out] = applyLegibleText([section('main_cut', els, '#FFF7ED', 2000)])
    for (let i = 0; i < 4; i++) {
      const label = named(out, `usp_label_${i}`)
      expect(label.textProps!.fontSize).toBe(MIN_FONT_SIZES.body)
      expect(label.textProps!.typoLevel).toBe('body')
      const cell = named(out, `usp_cell_${i}`)
      expect(cell.transform.y + cell.transform.height).toBeGreaterThanOrEqual(
        label.transform.y + label.transform.height
      )
    }
    const delta = named(out, 'usp_label_0').transform.height - 54
    expect(delta).toBeGreaterThan(0)
    expect(named(out, 'usp_cell_2').transform.y).toBe(1679 + delta)
    expect(named(out, 'after').transform.y).toBe(1900 + 2 * delta)
    expect(out.canvas.height).toBe(2000 + 2 * delta)
    // 글자 규칙(하한·대비·2열)만 — 합성 섹션이라 첫 화면(M3)·빈 영역(M4)은 재지 않는다
    const textRules = new Set(['M1', 'M2', 'M6'])
    expect(checkMobileReadability({ sections: [out] }).violations.filter((v) => textRules.has(v.rule))).toEqual([])
  })

  it('3자 라벨(초경량·LED)이 섞인 2열 카드: 넷 다 45·같은 색, 한 행의 카드 바탕 높이가 같다', () => {
    const labels = ['초경량', '은은한 반투명', '방수 원단 소재', 'LED']
    const els: CanvasElement[] = []
    labels.forEach((text, i) => {
      const x = i % 2 === 0 ? 28 : 442
      const y = i < 2 ? 1477 : 1679
      els.push(makeShapeEl(`usp_cell_${i}`, 'roundedRect', x, y, 390, 178, { fill: 'rgba(194,65,12, 0.04)' }, 1))
      els.push(
        makeTextEl(`usp_label_${i}`, text, 'caption', x + 5, y + 108, 380, '#c2410c', 'center', 3, {
          fontSize: 36,
          fontWeight: 700,
          height: 54,
        })
      )
    })
    const [out] = applyLegibleText([section('main_cut', els, '#FFF7ED', 2000)])
    const sizes = labels.map((_, i) => named(out, `usp_label_${i}`).textProps!.fontSize)
    expect(new Set(sizes)).toEqual(new Set([MIN_FONT_SIZES.body]))
    expect(new Set(labels.map((_, i) => named(out, `usp_label_${i}`).textProps!.color)).size).toBe(1)
    for (const [a, b] of [
      [0, 1],
      [2, 3],
    ])
      expect(named(out, `usp_cell_${a}`).transform.height).toBe(named(out, `usp_cell_${b}`).transform.height)
  })

  it('다른 열의 긴 문구(같이 늘어남) 옆에 같은 열로 쌓인 두 문구: 위 문구가 늘면 아래 문구도 그만큼 내려가 겹치지 않는다', () => {
    const top = makeTextEl('left_label', '왼쪽 위 문구', 'caption', 60, 100, 360, '#262626', 'left', 2, { height: 50 })
    const under = makeTextEl('left_sub', '왼쪽 아래 문구', 'caption', 60, 170, 360, '#262626', 'left', 2, {
      height: 30,
    })
    // 옆 열의 긴 문구도 같이 늘어난다 — 한 줄(band)로 묶던 예전 방식에서는 left_sub가 안 내려가 겹쳤다(verifier 탐침)
    const side = makeTextEl(
      'right_desc',
      '오른쪽 열에 길게 이어지는 설명 문구가 여러 줄로 내려갑니다',
      'caption',
      460,
      100,
      340,
      '#262626',
      'left',
      2,
      { height: 300 }
    )
    const [out] = applyLegibleText([section('main_cut', [top, under, side])])
    const a = named(out, 'left_label')
    const b = named(out, 'left_sub')
    expect(a.textProps!.fontSize).toBe(MIN_FONT_SIZES.body)
    expect(named(out, 'right_desc').textProps!.fontSize).toBe(MIN_FONT_SIZES.body)
    expect(b.transform.y).toBeGreaterThanOrEqual(a.transform.y + a.transform.height)
    expect(named(out, 'right_desc').transform.y).toBe(100)
  })

  it('세로로 감싼 도형은 가로로 겹치지 않아도 늘어난다(고민 목록 왼쪽 4px 띠)', () => {
    const box = makeShapeEl('step_bg_0', 'rect', 80, 288, 700, 124, { fill: 'transparent' }, 1)
    const bar = makeShapeEl('step_border_0', 'rect', 80, 288, 4, 124, { fill: '#BBBBBB' }, 2)
    const text = makeTextEl('step_text_0', '봉투 크기가 안 맞아요', 'caption', 188, 316, 568, '#262626', 'left', 3, {
      fontSize: 37,
      height: 68,
    })
    const [out] = applyLegibleText([section('problem_raise', [box, bar, text])])
    expect(named(out, 'step_text_0').textProps!.fontSize).toBe(MIN_FONT_SIZES.body)
    expect(named(out, 'step_border_0').transform.height).toBe(named(out, 'step_bg_0').transform.height)
  })

  it('제목급·3자 이하 표식·법정 표시·사진 위 글자·대상 밖 섹션은 그대로', () => {
    const photo = makeImageEl('hero_image', 'https://img.test/h.png', 'hero', 0, 0, 860, 860, 1)
    const kept = [
      makeTextEl('benefit_headline', '포장 고민 한 번에 끝', 'h2', 60, 900, 740, '#c2410c'),
      makeTextEl('step_num_0', '01', 'caption', 60, 1100, 68, '#707070'),
      makeTextEl('legal_notice', '실제 색상은 화면과 다를 수 있습니다', 'caption', 60, 1200, 740, '#555555'),
      makeTextEl('overlay_sub', '사진 위에 놓인 문구', 'caption', 60, 400, 740, '#FFFFFF', 'center', 5),
    ]
    const hook = section('hook_3step', [photo, ...kept])
    expect(applyLegibleText([hook])[0]).toBe(hook)
    const point = section('point_div', [
      makeTextEl('point_0_desc', '설명 문구입니다', 'caption', 60, 100, 740, '#c2410c'),
    ])
    expect(applyLegibleText([point])[0]).toBe(point)
    expect(LEGIBLE_SECTIONS.has('point_div')).toBe(false)
  })

  it('사용자가 직접 정한 크기·색은 두고, 하한을 이미 넘는 글자는 바꾸지 않는다', () => {
    const styled = makeTextEl(
      'main_cut_desc',
      '촘촘한 돌기가 두피를 눌러요',
      'caption',
      60,
      230,
      740,
      '#c2410c',
      'center',
      2,
      {
        fontSize: 28,
      }
    )
    styled.textProps!.userStyledKeys = ['fontSize', 'color']
    const big = makeTextEl('hook_text', '봉투 하나로 분위기가 달라져요', 'body', 60, 920, 740, '#262626')
    const s = section('main_cut', [styled, big])
    expect(applyLegibleText([s])[0]).toBe(s)
  })

  it('그라디언트 바탕(hook): 모든 색 끝에서 4.5 이상이 되게 같은 색상을 진하게 — 검사기는 단색만 재서 놓치던 경우', () => {
    const gradient = 'linear-gradient(180deg, #E8E6DC 0%, #F5F3EC 100%)'
    expect(backgroundStops(gradient)).toEqual(['#E8E6DC', '#F5F3EC'])
    const text = makeTextEl('hook_text', '강아지도 고양이도, 이 식기 하나로 끝', 'body', 60, 920, 740, '#5C7A5C')
    expect(contrastOn('#5C7A5C', '#E8E6DC')).toBeLessThan(4.5)
    const [out] = applyLegibleText([section('hook_3step', [text], gradient)])
    const color = named(out, 'hook_text').textProps!.color
    for (const stop of ['#E8E6DC', '#F5F3EC']) expect(contrastOn(color, stop)).toBeGreaterThanOrEqual(4.5)
    const [r, g, b] = parseColor(color)!
    expect(g).toBeGreaterThan(r) // 초록 계열 그대로(회색·검정으로 바꾸지 않는다)
    expect(g).toBeGreaterThan(b)
  })

  it('그라디언트 색 끝을 하나라도 못 읽으면(색 이름·반투명) 판정하지 않는다', () => {
    expect(backgroundStops('linear-gradient(180deg, white 0%, #fdf2f8 100%)')).toEqual([])
    expect(backgroundStops('linear-gradient(to bottom, #fff7ed, #0000007f)')).toEqual([])
    expect(backgroundStops('linear-gradient(to bottom, #fff7ed 0%, rgb(253, 242, 248) 100%)')).toEqual([
      '#fff7ed',
      'rgb(253, 242, 248)',
    ])
    expect(backgroundStops('#FFF7ED')).toEqual(['#FFF7ED'])
  })

  it('반투명 카드 바탕은 섹션 바탕(그라디언트면 색 끝마다)에 합성해서 잰다 / 이미 4.5 이상이면 색 그대로', () => {
    const cell = makeShapeEl('usp_cell_0', 'roundedRect', 28, 100, 390, 300, { fill: 'rgba(194,65,12, 0.04)' }, 1)
    const label = makeTextEl('usp_label_0', '은은한 반투명', 'body', 33, 200, 380, '#c2410c', 'center', 3)
    // 분홍 끝(#fdf2f8)에 4% 주황을 합성하면 4.5 아래 — 그 끝 기준으로 진하게
    const onGradient = textBackdrops(
      label,
      section('main_cut', [cell, label], 'linear-gradient(180deg, #fff7ed 0%, #fdf2f8 100%)')
    )
    expect(onGradient).toHaveLength(2)
    const fixed = legibleColor('#c2410c', onGradient as Array<[number, number, number]>)
    for (const bg of onGradient as Array<[number, number, number]>)
      expect(contrastRatio(parseColor(fixed)!, bg)).toBeGreaterThanOrEqual(4.5)
    // 단색 크림(#FFF7ED) 위 카드는 4.63 — 그대로
    const onCream = textBackdrops(label, section('main_cut', [cell, label], '#FFF7ED'))
    expect(legibleColor('#c2410c', onCream as Array<[number, number, number]>)).toBe('#c2410c')
  })
})

describe('강조색 작은 글자 — 대비 7(같은 색상 계열), 안 되면 4.5 색 + 굵기 한 단계', () => {
  const P02_HOOK = 'linear-gradient(180deg, #fff7ed 0%, #fdf2f8 100%)'
  const stops: Array<[number, number, number]> = [parseColor('#fff7ed')!, parseColor('#fdf2f8')!]
  const minContrast = (color: string) => Math.min(...stops.map((b) => contrastRatio(parseColor(color)!, b)))

  it('강조색 판정: 주황·분홍·세이지는 강조색, 먹색·회색 본문은 아니다', () => {
    for (const c of ['#c2410c', '#d63384', '#4a624a', '#567256']) expect(isAccentColor(c), c).toBe(true)
    for (const c of ['#262626', '#232823', '#1a1611', '#555555', '#707070']) expect(isAccentColor(c), c).toBe(false)
  })

  it('P02 hook 주황 45px(4.74 — 4.5는 넘음)도 7 이상으로, 주황 계열 그대로(굵기 그대로)', () => {
    const text = makeTextEl(
      'hook_text',
      '봉투 하나로 선물 분위기가 달라져요',
      'body',
      60,
      920,
      740,
      '#c2410c',
      'center',
      2,
      {
        fontWeight: 600,
      }
    )
    expect(minContrast('#c2410c')).toBeGreaterThanOrEqual(4.5)
    const out = named(applyLegibleText([section('hook_3step', [text], P02_HOOK)])[0], 'hook_text')
    expect(minContrast(out.textProps!.color)).toBeGreaterThanOrEqual(ACCENT_SMALL_CONTRAST)
    const [r, g, b] = parseColor(out.textProps!.color)!
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(out.textProps!.fontWeight).toBe(600)
  })

  it('같은 색상 계열로 7을 못 넘는 중간 톤 바탕: 4.5 색 + 굵기 한 단계(700 → 800)', () => {
    const label = makeTextEl('usp_label_0', '은은한 반투명', 'body', 33, 200, 380, '#c2410c', 'center', 3, {
      fontWeight: 700,
    })
    const out = named(applyLegibleText([section('main_cut', [label], '#B0B0B0')])[0], 'usp_label_0')
    const ratio = contrastRatio(parseColor(out.textProps!.color)!, [176, 176, 176])
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeLessThan(ACCENT_SMALL_CONTRAST)
    expect(out.textProps!.fontWeight).toBe(800)
  })

  it('밝음·어둠이 섞인 그라디언트처럼 4.5도 못 맞추면 색·굵기 그대로(굵기만 올려 가리지 않는다)', () => {
    const text = makeTextEl(
      'hook_text',
      '봉투 하나로 분위기가 달라져요',
      'body',
      60,
      920,
      740,
      '#c2410c',
      'center',
      2,
      {
        fontWeight: 600,
      }
    )
    const s = section('hook_3step', [text], 'linear-gradient(180deg, #FFFFFF 0%, #1E3A8A 100%)')
    expect(applyLegibleText([s])[0]).toBe(s)
  })

  it('먹색 본문·본문 1.25배를 넘는 강조 글자는 4.5 기준 그대로', () => {
    const neutral = makeTextEl('sub_benefit', '은은하게 비치는 반투명 소재', 'body', 60, 900, 740, '#555555')
    const large = makeTextEl(
      'hook_text',
      '봉투 하나로 분위기가 달라져요',
      'body',
      60,
      1100,
      740,
      '#c2410c',
      'center',
      2,
      {
        fontSize: 60,
      }
    )
    const s = section('hook_3step', [neutral, large], P02_HOOK)
    expect(applyLegibleText([s])[0]).toBe(s)
  })
})

describe('R1 세 잡 재렌더 — persuasion 기록 잡만, 대조 잡은 그대로', () => {
  for (const [key, f] of R1_JOBS) {
    it(`${key}: 보조 문구·카드 설명 ≥ 45px·바탕(그라디언트 색 끝 모두) 대비 ≥ 4.5(강조색 작은 글자 ≥ 7), 장면 사진 ≤ 860, 프리셋 탈락 0, M1~M7 0`, async () => {
      const { doc, stats } = await renderR1(f)
      const primary = f.copy.designPalette.primary
      for (const s of doc.sections.filter((x) => LEGIBLE_SECTIONS.has(String(x.sectionType)))) {
        for (const el of supportingTexts(s)) {
          const backdrops = textBackdrops(el, s)
          if (backdrops === 'photo') continue
          expect(el.textProps!.fontSize, `${s.sectionType}.${el.name}`).toBeGreaterThanOrEqual(MIN_FONT_SIZES.body)
          // 세 잡 모두 같은 색상 계열로 7에 닿는다(굵기 대안 없이). 빌더가 강조색(primary)으로 칠하는 문구는 출력 색으로 판정하지 않고
          // 이름으로 7을 요구하고, 색상 계열(가장 센 채널)이 primary와 같은지 본다 — 진하게 하면 채도 값은 줄 수 있다
          const accentByBuilder = /^(hook_text|main_cut_desc|usp_label_\d+)$/.test(el.name)
          if (accentByBuilder) expect(dominant(el.textProps!.color), `${el.name} 색상 계열`).toBe(dominant(primary))
          const need = accentByBuilder || isAccentColor(el.textProps!.color) ? ACCENT_SMALL_CONTRAST : 4.5
          for (const bg of backdrops)
            expect(
              contrastRatio(parseColor(el.textProps!.color)!, bg),
              `${s.sectionType}.${el.name} ${el.textProps!.color}`
            ).toBeGreaterThanOrEqual(need)
        }
      }
      const scenes = doc.sections.flatMap((s) =>
        s.elements.filter((e) => SCENE_IMAGE_TYPES.has(e.imageProps?.imageType ?? e.framedImageProps?.imageType ?? ''))
      )
      for (const photo of scenes) expect(photo.transform.height, photo.name).toBeLessThanOrEqual(SCENE_PHOTO_MAX_PX)
      expect(stats.layouts.guardDropped, JSON.stringify(stats.layouts)).toBe(0)
      expect(checkMobileReadability(doc).violations).toEqual([])
      const hero = doc.sections[0].elements.find((e) => e.type === 'image' || e.type === 'framed-image')!
      expect(hero.transform.y + hero.transform.height).toBeLessThanOrEqual(1860)
    })
  }

  it('P02 hook 주황 문구(45px·4.74): 7 이상 주황 계열로 바뀐다 / 대조 잡은 그대로', async () => {
    const hookText = (sections: CanvasSection[]) =>
      sections.find((s) => s.sectionType === 'hook_3step')!.elements.find((e) => e.name === 'hook_text')!
    const [, p02] = R1_JOBS[0]
    const { doc } = await renderR1(p02)
    const hook = doc.sections.find((s) => s.sectionType === 'hook_3step')!
    const el = hookText(doc.sections)
    expect(el.textProps!.color.toLowerCase()).not.toBe('#c2410c')
    for (const bg of textBackdrops(el, hook) as Array<[number, number, number]>)
      expect(contrastRatio(parseColor(el.textProps!.color)!, bg)).toBeGreaterThanOrEqual(ACCENT_SMALL_CONTRAST)
    const [r, g, b] = parseColor(el.textProps!.color)!
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(hookText((await renderR1(p02, false)).doc.sections).textProps!.color.toLowerCase()).toBe('#c2410c')
  })

  it('P02·P03: 고민 장면 1147 → 860(위쪽 정렬), 해결 장면 1147 → 860(가운데) / 대조 잡은 3:4 그대로·라벨 36', async () => {
    for (const [, f] of R1_JOBS.slice(0, 2)) {
      const { doc } = await renderR1(f)
      const find = (type: string) =>
        doc.sections.flatMap((s) => s.elements).find((e) => e.imageProps?.imageType === type)!
      expect(find('problem').transform.height).toBe(860)
      expect(find('problem').verticalAlign).toBe('top')
      expect(find('solution').transform.height).toBe(860)
      expect(find('solution').imageProps!.cropRect).toBeUndefined()

      const control = (await renderR1(f, false)).doc
      const all = control.sections.flatMap((s) => s.elements)
      expect(all.find((e) => e.imageProps?.imageType === 'problem')!.transform.height).toBe(1147)
      expect(all.find((e) => e.name === 'usp_label_0')!.textProps!.fontSize).toBe(36)
    }
  })
})
