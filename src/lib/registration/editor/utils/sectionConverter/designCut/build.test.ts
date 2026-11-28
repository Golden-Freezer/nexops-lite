/**
 * 디자인 컷 글의 수량+단위 묶음(keepCountUnits, #278 규칙) — CTA '두 / 칸을 살펴보세요'처럼 수와 단위가 줄에서 갈리지 않게
 * 그릴 글과 미리 재는 높이가 같은 묶음을 쓴다.
 */

import { describe, expect, it } from 'vitest'
import { CutBuilder, measureCutText } from './build'
import { readDesignCut, toCutSection } from './contract'
import { buildT8 } from './templatesScene'
import { TYPE, colorsOf, radiusOf } from './tokens'
import { designCutPlanForB } from './designCut.fixture'

const NBSP = ' '

describe('CutBuilder.text — 수량+단위는 한 줄에', () => {
  it('글·캡슐 모두 수와 단위 사이를 줄바꿈 없는 공백으로, 높이는 묶은 글로 잰다', () => {
    const b = new CutBuilder()
    const head = b.text('h', '밥그릇·물그릇, 두 칸을 살펴보세요', TYPE.H1, 60, 100, 740, '#111111', 'center')
    expect(head.el.textProps?.content).toBe(`밥그릇·물그릇, 두${NBSP}칸을 살펴보세요`)
    expect(head.bottom - 100).toBe(measureCutText('밥그릇·물그릇, 두 칸을 살펴보세요', TYPE.H1.size, TYPE.H1.lineHeight, 740))
    b.capsule('c', '20 개 구성', TYPE.LABEL, 60, 300, { text: '#FFFFFF', radius: 32 })
    expect(b.elements.some((e) => e.textProps?.content === `20${NBSP}개 구성`)).toBe(true)
  })

  it('수·단위가 아닌 띄어쓰기는 그대로', () => {
    const b = new CutBuilder()
    expect(b.text('t', '세로 길이 넉넉해요', TYPE.BODY, 60, 0, 740, '#111111').el.textProps?.content).toBe('세로 길이 넉넉해요')
  })

  it('T8 마무리 헤드라인도 묶는다', () => {
    const plan = readDesignCut({ designcut: designCutPlanForB(false) })!
    const cta = toCutSection(plan.sections.find((s) => s.key === 'cta')!)
    const ctx = {
      section: { ...cta, text: { ...cta.text, headline: '밥그릇·물그릇, 두 칸을 살펴보세요' } },
      colors: colorsOf(plan),
      radius: radiusOf(plan.motif),
      image: () => null,
    }
    const result = buildT8(ctx)!
    const contents = result.elements.map((e) => e.textProps?.content).filter(Boolean)
    expect(contents).toContain(`밥그릇·물그릇, 두${NBSP}칸을 살펴보세요`)
  })
})

describe('CutBuilder.image — decor 둥근 틀 반경(T1-28)', () => {
  const props = (opts: Parameters<CutBuilder['image']>[6]) => new CutBuilder().image('p', 'https://img.test/a.png', 60, 100, 740, 740, opts).framedImageProps
  /** 지금(main) 요소 값 — D가 쓰는 decor 둥근 틀은 이 값 그대로여야 한다. 코드 상수를 가져오지 않고 고정한다 */
  const DECOR_NOW = {
    src: 'https://img.test/a.png',
    alt: 'p',
    frameId: 'roundedRect',
    clipPath: 'inset(0 round 16px)',
    viewBox: '0 0 100 100',
    bgColor: '#FFFFFF',
    objectFit: 'cover',
    imageType: 'designcut_product',
    isUserUploaded: false,
  }

  it('opts.radius가 없으면 DECOR_RADIUS 16 그대로이고 cornerRadius 칸이 없다', () => {
    expect(props({ frame: 'decor', fit: 'cover', imageType: 'designcut_product' })).toStrictEqual(DECOR_NOW)
    expect(props({ frame: 'decor', sharp: false, fit: 'cover', imageType: 'designcut_product' })).toStrictEqual(DECOR_NOW)
  })

  it('opts.radius가 있으면 decor 둥근 틀만 그 반경을 clipPath·cornerRadius에 쓴다', () => {
    expect(props({ frame: 'decor', radius: 24, fit: 'cover', imageType: 'designcut_product' })).toStrictEqual({ ...DECOR_NOW, clipPath: 'inset(0 round 24px)', cornerRadius: 24 })
  })

  it('직각 decor·plain·원·아치는 radius가 있어도 지금과 같다', () => {
    expect(props({ frame: 'decor', sharp: true, radius: 24 })).toMatchObject({ frameId: 'rect', clipPath: 'none' })
    expect(props({ frame: 'decor', sharp: true, radius: 24 })).not.toHaveProperty('cornerRadius')
    // D plain 호출(templatesInfo 문제 사진)은 radius를 clip-path로만 쓴다
    expect(props({ frame: 'plain', radius: 28 })).toMatchObject({ frameId: 'designcut', clipPath: 'inset(0 round 28px)' })
    expect(props({ frame: 'plain', radius: 28 })).not.toHaveProperty('cornerRadius')
    expect(props({ frame: 'circle', radius: 24 })).not.toHaveProperty('cornerRadius')
    expect(props({ frame: 'arch', radius: 24 })).not.toHaveProperty('cornerRadius')
  })
})
