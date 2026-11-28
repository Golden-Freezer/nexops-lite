/**
 * 적용 D6 P2 — 큰 POINT 새 형태 변형 half(T2-42 절반 색 면 + 경계 사진)·cards(T2-16·T2-20 설명 문장 카드). 순환 다섯 가지, cards는
 * 설명 2~4문장일 때만, 계약 왕복, 조립(요소 이름·사진 폭·M5·설명 글 그대로·겹침 없음). LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { pointVariant } from '@/lib/registration/internalized/designcut-structure'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutPlanForB } from './designCut.fixture'
import { isLightTint } from './layout2'
import { cardSentences, fitsCards } from './pointCards'
import { isBandEndPoint } from './templatesVariant'
import { CONTENT_W, MARGIN, SCENE_SPACE, W, mix } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}
const IMAGES = { hero: 'https://img.test/hero.png', features: Array.from({ length: 6 }, (_, i) => `https://img.test/f${i}.png`) }
const TWO = '붙이기만 하면 감사 인사가 끝나요. 문구를 따로 고민하지 않아도 돼요.'
const THREE = '50매가 한 묶음이에요! 답례품을 한 번에 포장해요. 남은 장은 다음 선물에 써요?'

type Opts = { variants?: string[]; subs?: (string | null)[]; base?: string; corners?: 'soft' | 'sharp'; aspect?: number }
/** 고정물 계획(장면 모드) — 큰 POINT 1~3장에 변형·설명을 덮어쓴다 */
const compose = ({ variants = ['half', 'cards', 'grid'], subs = [], base = '#FFFFFF', corners = 'soft', aspect }: Opts = {}) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  plan.artDirection = { ...ART, corners, background: { ...ART.background, base } }
  plan.sections
    .filter((s) => s.key.startsWith('point_div:'))
    .forEach((s, i) => {
      Object.assign(s, { layoutVariant: variants[i] })
      if (subs[i] !== undefined) s.text = { ...s.text, sub: subs[i] }
    })
  const imageAspects = aspect ? Object.fromEntries([IMAGES.hero, ...IMAGES.features].map((u) => [u, aspect])) : null
  return composeDesignCut([], readDesignCut({ designcut: plan })!, { images: IMAGES, sectionOrder: [], imageAspects })
}
const points = (out: CanvasSection[]) => out.filter((s) => s.layoutId === 'designcut_T3a')
const named = (sec: CanvasSection, name: string) => sec.elements.filter((e) => e.name === name)
const one = (sec: CanvasSection, name: string) => {
  const [el] = named(sec, name)
  expect(el, name).toBeDefined()
  return el
}
const bottom = (e: CanvasElement) => e.transform.y + e.transform.height
const overlaps = (a: CanvasElement, b: CanvasElement) =>
  a.transform.x < b.transform.x + b.transform.width &&
  b.transform.x < a.transform.x + a.transform.width &&
  a.transform.y < bottom(b) &&
  b.transform.y < bottom(a)
const cardsOf = (sec: CanvasSection) => sec.elements.filter((e) => /^designcut-point-card-\d+$/.test(e.name ?? ''))
const cardTextsOf = (sec: CanvasSection) => sec.elements.filter((e) => /^designcut-point-card-text-\d+$/.test(e.name ?? ''))

describe('문장 카드 나눔(pointCards)', () => {
  it('. ! ? 뒤 띄어쓰기·줄바꿈에서만 나누고 글자는 그대로다', () => {
    expect(cardSentences(TWO)).toEqual(['붙이기만 하면 감사 인사가 끝나요.', '문구를 따로 고민하지 않아도 돼요.'])
    expect(cardSentences(THREE)).toEqual(['50매가 한 묶음이에요!', '답례품을 한 번에 포장해요.', '남은 장은 다음 선물에 써요?'])
    expect(cardSentences('첫 문장이에요.\n둘째 문장이에요.')).toEqual(['첫 문장이에요.', '둘째 문장이에요.'])
    // 문장부호·문장 끝말 없는 줄바꿈은 한 문장 안 줄 나눔 — 나누지 않는다
    expect(cardSentences('문구 고민 없이 붙이기만\n하면 감사 인사 끝')).toEqual(['문구 고민 없이 붙이기만\n하면 감사 인사 끝'])
    expect(cardSentences('간식 넣고 끈을 당기면\n별도 리본이 필요 없어요')).toEqual(['간식 넣고 끈을 당기면\n별도 리본이 필요 없어요'])
    // 문장 끝말(요·다·죠) 바로 뒤 줄바꿈은 문장 끝 — D 카피는 마침표 없이 두 문장을 줄로 나눈다(R17-L P01 POINT)
    expect(cardSentences('봉투 겉면에 붙여요\n구디백 포장 데코로 써요')).toEqual(['봉투 겉면에 붙여요', '구디백 포장 데코로 써요'])
    expect(cardSentences('가볍다\n오래 쓴다')).toEqual(['가볍다', '오래 쓴다'])
    // 소수점·숫자 뒤 점은 띄어쓰기가 없으면 문장 끝이 아니다
    expect(cardSentences('두께 0.5mm예요. 가벼워요.')).toEqual(['두께 0.5mm예요.', '가벼워요.'])
    for (const text of [TWO, THREE]) expect(cardSentences(text).join(' ')).toBe(text)
    expect(cardSentences(null)).toEqual([])
    expect(cardSentences('   ')).toEqual([])
  })

  it('카드는 2~4문장일 때만', () => {
    expect(fitsCards('한 문장이에요.')).toBe(false)
    expect(fitsCards(TWO)).toBe(true)
    expect(fitsCards('하나. 둘. 셋. 넷.')).toBe(true)
    expect(fitsCards('하나. 둘. 셋. 넷. 다섯.')).toBe(false)
    expect(fitsCards(null)).toBe(false)
  })
})

describe('큰 POINT 변형 순환(계획)', () => {
  it('장 번호 순서로 scene → zigzag → grid → half → cards를 돈다', () => {
    expect(Array.from({ length: 10 }, (_, i) => pointVariant(i + 1, TWO))).toEqual([
      'scene', 'zigzag', 'grid', 'half', 'cards', 'scene', 'zigzag', 'grid', 'half', 'cards',
    ])
  })

  it('cards 차례인데 설명이 2~4문장이 아니면 grid(앞 half·다음 scene과 다름) — 다른 차례는 설명과 상관없다', () => {
    for (const sub of [null, '한 문장이에요.', '하나. 둘. 셋. 넷. 다섯.', '문구 고민 없이 붙이기만\n하면 감사 인사 끝']) {
      expect(pointVariant(5, sub), String(sub)).toBe('grid')
      expect(pointVariant(10, sub), String(sub)).toBe('grid')
      expect([1, 2, 3, 4, 6].map((n) => pointVariant(n, sub))).toEqual(['scene', 'zigzag', 'grid', 'half', 'scene'])
    }
    expect(pointVariant(5, '봉투 겉면에 붙여요\n구디백 포장 데코로 써요')).toBe('cards')
    // 설명 없이 부르면 같은 앞 넷, cards 차례는 grid
    expect([1, 2, 3, 4, 5].map((n) => pointVariant(n))).toEqual(['scene', 'zigzag', 'grid', 'half', 'grid'])
  })

  it('계약이 half·cards를 그대로 읽고, 모르는 이름은 버린다', () => {
    const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
    const [a, b, c] = plan.sections.filter((s) => s.key.startsWith('point_div:'))
    Object.assign(a, { layoutVariant: 'half' })
    Object.assign(b, { layoutVariant: 'cards' })
    Object.assign(c, { layoutVariant: 'halves' })
    const read = readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!
    const byKey = (key: string) => read.sections.find((s) => s.key === key)!
    expect(byKey(a.key).layoutVariant).toBe('half')
    expect(byKey(b.key).layoutVariant).toBe('cards')
    expect(byKey(c.key)).not.toHaveProperty('layoutVariant')
  })

  it('흰 띠 여백으로 끝나는 변형(layout2 바탕 교대) — half·cards도 zigzag·grid와 같다', () => {
    for (const v of ['zigzag', 'grid', 'half', 'cards']) expect(isBandEndPoint({ template: 'T3a', layoutVariant: v }), v).toBe(true)
    for (const v of [undefined, 'scene', 'list']) expect(isBandEndPoint({ template: 'T3a', layoutVariant: v }), String(v)).toBe(false)
    expect(isBandEndPoint({ template: 'T4', layoutVariant: 'half' })).toBe(false)
  })
})

describe('큰 POINT half — 위쪽 옅은 강조 면 + 경계에 걸친 사진', () => {
  it('면은 맨 아래 z·풀폭이고 섹션 위 48 띠 여백 아래에서 사진(본문 폭) 위 절반까지 내려온다, 머리는 면 위', () => {
    const half = points(compose())[0]
    const plane = one(half, 'designcut-half-plane')
    const photo = one(half, 'designcut-scene')
    expect(photo.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
    // 섹션 맨 위는 띠 색 — 앞 섹션 바탕(스튜디오·tint)과 면이 이어 붙지 않는다
    expect(plane.transform).toMatchObject({ x: 0, y: 48, width: W })
    expect(bottom(plane)).toBe(photo.transform.y + Math.round(photo.transform.height / 2))
    expect(Math.min(...half.elements.map((e) => e.zIndex))).toBe(plane.zIndex)
    // 흰 띠면 tint 면
    expect(isLightTint(plane.shapeProps?.fill)).toBe(true)
    // 템플릿 머리 글만 — 편집기 장식 라벨(annotation-*)은 섹션 위 여백에 따로 놓인다
    const texts = half.elements.filter((e) => e.type === 'text' && e.name?.startsWith('designcut-'))
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) {
      expect(t.transform.y, t.name).toBeGreaterThan(plane.transform.y)
      expect(bottom(t), t.name).toBeLessThanOrEqual(bottom(plane))
    }
    expect(photo.transform.y - bottom(one(half, 'designcut-sub'))).toBe(SCENE_SPACE.photoGap)
  })

  it('머리(캡슐·번호·제목·설명) 자리는 grid와 같다(오너 지시 11-01 POINT 카피 자리 같음)', () => {
    const [half, , grid] = points(compose({ variants: ['half', 'scene', 'grid'] }))
    const head = (sec: CanvasSection) =>
      ['designcut-chapter-number', 'designcut-headline'].map((name) => {
        const { x, y, width } = one(sec, name).transform
        return { name, x, y, width, size: one(sec, name).textProps?.fontSize }
      })
    expect(head(half)).toEqual(head(grid))
  })

  it('짙은 띠면 띠 색에 흰색 10%를 섞은 면(글자색은 띠 기준 흰색)', () => {
    const half = points(compose({ base: '#1E2430' }))[0]
    expect(one(half, 'designcut-half-plane').shapeProps?.fill).toBe(mix('#1E2430', '#FFFFFF', 0.1))
    expect(one(half, 'designcut-headline').textProps?.color?.toUpperCase()).toBe('#FFFFFF')
  })
})

describe('큰 POINT cards — 설명 문장마다 카드', () => {
  it('머리에 설명이 없고, 카드 글은 설명 문장 그대로·카드 안·겹침 없이 쌓이고 사진은 마지막 카드 88 아래', () => {
    const cards = points(compose({ subs: [null, THREE] }))[1]
    expect(named(cards, 'designcut-sub')).toEqual([])
    const boxes = cardsOf(cards)
    const texts = cardTextsOf(cards)
    // 수량+단위('한 번')는 빌더가 줄바꿈 없는 공백으로 묶는다(keepFactUnits — 모든 글 같은 규칙) — 그 밖 글자는 그대로
    expect(texts.map((t) => t.textProps?.content?.replace(/ /g, ' '))).toEqual(cardSentences(THREE))
    expect(boxes).toHaveLength(3)
    for (const [i, box] of boxes.entries()) {
      expect(box.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
      expect(box.containerOf).toEqual([texts[i].id])
      expect(texts[i].transform.y).toBeGreaterThan(box.transform.y)
      expect(bottom(texts[i])).toBeLessThan(bottom(box))
      expect(box.zIndex).toBeLessThan(texts[i].zIndex)
      if (i > 0) expect(box.transform.y).toBeGreaterThan(bottom(boxes[i - 1]))
    }
    expect(boxes[0].transform.y - bottom(one(cards, 'designcut-headline'))).toBe(SCENE_SPACE.titleGap)
    const photo = one(cards, 'designcut-scene')
    expect(photo.transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
    expect(photo.transform.y - bottom(boxes[2])).toBe(SCENE_SPACE.photoGap)
    for (const box of boxes) expect(overlaps(box, photo)).toBe(false)
  })

  it('밝은 띠는 패널 카드(흰 띠 위 스튜디오 회색), 짙은 띠는 흰 카드·짙은 글', () => {
    const light = cardsOf(points(compose({ subs: [null, TWO] }))[1])
    for (const box of light) expect(box.shapeProps?.fill?.toUpperCase()).not.toBe('#FFFFFF')
    const dark = points(compose({ subs: [null, TWO], base: '#1E2430' }))[1]
    for (const box of cardsOf(dark)) expect(box.shapeProps?.fill).toBe('#FFFFFF')
    for (const t of cardTextsOf(dark)) expect(t.textProps?.color?.toUpperCase()).not.toBe('#FFFFFF')
  })

  it('저장된 설명이 2~4문장이 아니면 grid로 그린다(설명은 머리에)', () => {
    const [, cards] = points(compose({ subs: [null, '한 문장이에요.'] }))
    expect(cardsOf(cards)).toEqual([])
    expect(one(cards, 'designcut-sub').textProps?.content).toBe('한 문장이에요.')
    expect(one(cards, 'designcut-scene').transform).toMatchObject({ x: MARGIN, width: CONTENT_W })
  })
})

describe('판독 규칙·범위', () => {
  it('half·cards에 글자 하한·대비·상품 컷 높이·2열(M1·M2·M5·M6) 위반 없음, 가로 사진도 500 이상, 사진은 장식 액자', () => {
    for (const corners of ['soft', 'sharp'] as const) {
      for (const base of ['#FFFFFF', '#1E2430']) {
        for (const aspect of [undefined, 4 / 3]) {
          const out = points(compose({ subs: [null, THREE], corners, base, aspect }))
          const tag = `${corners}·${base}·${aspect ?? '미상'}`
          const report = checkMobileReadability({ sections: out.slice(0, 2) })
          expect(report.violations.filter((v) => ['M1', 'M2', 'M5', 'M6'].includes(v.rule)), tag).toEqual([])
          for (const sec of out.slice(0, 2)) {
            expect(one(sec, 'designcut-scene').transform.height, tag).toBeGreaterThanOrEqual(500)
            expect(one(sec, 'designcut-scene').framedImageProps?.frameId, tag).toBe(corners === 'soft' ? 'roundedRect' : 'rect')
          }
        }
      }
    }
  })

  it('전체 문서 — half·cards를 켠 장면 모드 문서에 연속 빈 영역(M4) 위반 없음', () => {
    const out = compose({ subs: [null, THREE] })
    expect(checkMobileReadability({ sections: out }).violations.filter((v) => v.rule === 'M4')).toEqual([])
  })

  it('장면 모드가 아니면(아트 디렉션 없음) half·cards를 무시한다 — 지금 그리기', () => {
    const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
    plan.layout = 2
    const pts = plan.sections.filter((s) => s.key.startsWith('point_div:'))
    const draw = () => points(composeDesignCut([], readDesignCut({ designcut: JSON.parse(JSON.stringify(plan)) })!, { images: IMAGES, sectionOrder: [] }))
    const before = draw().map((s) => s.elements.map((e) => e.name))
    Object.assign(pts[0], { layoutVariant: 'half' })
    Object.assign(pts[1], { layoutVariant: 'cards' }, { text: { ...pts[1].text, sub: TWO } })
    const after = draw()
    expect(after.map((s) => s.elements.map((e) => e.name))[0]).toEqual(before[0])
    for (const sec of after) {
      expect(named(sec, 'designcut-half-plane')).toEqual([])
      expect(cardsOf(sec)).toEqual([])
    }
  })
})
