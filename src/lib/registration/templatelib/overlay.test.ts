import { describe, expect, it } from 'vitest'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { blendOver, checkMobileReadability, contrastRatio, parseColor } from '@/lib/registration/editor/utils/mobileReadability'
import { reflowSectionLayout } from '@/lib/registration/editor/utils/reflowSectionLayout'
import { colorSetsOf } from './color-sets'
import { CONCEPTS } from './concepts'
import { renderTemplate } from './engine'
import { ctxOf, imageSlot, templateOf, textSlot } from './engine.fixture'
import { lintTemplate } from './lint'
import { skeletonKey } from './lint-category'
import { OVERLAY_SCRIM_MAX, SCRIM_FADE_H, overlayFilm, scrimFilmSvg, scrimIssues, textsOnScrim } from './overlay'
import { deriveSignature } from './signature'
import type { FlowNode, ImageOverlay, Template } from './template-types'

/** 코드 상수를 가져오면 상수가 틀어져도 시험이 함께 움직인다 — 숫자로 고정한다(A4 완료 기준) */
const MIN_CONTRAST = 4.5
const ALL_SETS = CONCEPTS.flatMap((c) => colorSetsOf(c).sets.map((set) => ({ concept: c, set })))
/** 사진이 될 수 있는 색 — 양 끝과 회색 단계, 원색 */
const PHOTOS: Array<[number, number, number]> = [
  [255, 255, 255],
  [0, 0, 0],
  [32, 32, 32],
  [64, 64, 64],
  [96, 96, 96],
  [128, 128, 128],
  [160, 160, 160],
  [192, 192, 192],
  [224, 224, 224],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
]

const worstContrast = (text: string, fill: string) =>
  Math.min(...PHOTOS.map((photo) => contrastRatio(parseColor(text)!, blendOver(fill, photo)!)))

const overlayNode = (over: Partial<ImageOverlay> = {}, image: Partial<Extract<FlowNode, { kind: 'image' }>> = {}): FlowNode => ({
  kind: 'image',
  slot: 'photo',
  bleed: true,
  overlay: {
    anchor: 'top',
    ink: 'light',
    nodes: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'titleGap' },
      { kind: 'text', slot: 'sub', token: 'BODY' },
    ],
    ...over,
  },
  ...image,
})

const template = (flow: FlowNode[], over: Partial<Template> = {}) =>
  templateOf({
    id: 'key_message.fixture',
    section: 'key_message',
    flow,
    slots: {
      headline: textSlot({ required: true, maxChars: 12, maxLines: 2 }),
      sub: textSlot({ maxChars: 12, maxLines: 1 }),
      photo: imageSlot({ required: true, purpose: ['scene'], aspect: ['3:4', '2:3'], minHeight: 500 }),
      note: textSlot({ maxChars: 12, maxLines: 1 }),
    },
    ...over,
  })

const SLOTS = { headline: '사진 위에 얹는 제목', sub: '보조 문장을 씁니다', photo: 'a' }

const draw = (t: Template, slots: Record<string, string> = SLOTS, ctx = ctxOf()) => {
  const out = renderTemplate(t, slots, ctx)
  if (!out) throw new Error('그리지 못함')
  return out
}

const byName = (out: ReturnType<typeof draw>, name: string) => out.elements.find((el) => el.name === name)

/** 실제로 칠해진 막을 그려진 SVG에서 읽는다 — 글자 뒤 구간의 색과 농도 */
const filmOf = (out: ReturnType<typeof draw>) => {
  const svg = byName(out, 'designcut-scrim-film')?.svgProps?.svgString ?? ''
  const stops = [...svg.matchAll(/offset="([\d.]+)" stop-color="(#[0-9a-fA-F]{6})" stop-opacity="([\d.]+)"/g)].map((m) => ({ offset: Number(m[1]), color: m[2], opacity: Number(m[3]) }))
  const strongest = [...stops].sort((a, b) => b.opacity - a.opacity)[0]
  if (!strongest) return null
  const [r, g, b] = parseColor(strongest.color)!
  return { stops, fill: `rgba(${r}, ${g}, ${b}, ${strongest.opacity})` }
}

const sectionOf = (out: ReturnType<typeof draw>) =>
  ({
    id: 's',
    sectionType: 'key_message',
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: 'designcut_k_x',
    preserveBottomPad: true,
    canvas: { width: 860, height: out.height, backgroundColor: out.background },
    elements: out.elements,
  }) as unknown as CanvasSection

describe('사진 위 글의 막 — 전 색 조합', () => {
  it('색 조합이 비어 있지 않다', () => {
    expect(ALL_SETS.length).toBeGreaterThan(500)
  })

  for (const ink of ['light', 'dark'] as const) {
    it(`${ink}: 어떤 사진 색 위에서도 글자 대비가 ${MIN_CONTRAST} 이상이다`, () => {
      const failures = ALL_SETS.flatMap(({ set }) => {
        const film = overlayFilm(ink, set.colors)
        const worst = worstContrast(film.text, film.fill)
        return worst < MIN_CONTRAST ? [`${set.id} α${film.alpha} ${worst.toFixed(2)}`] : []
      })
      expect(failures).toEqual([])
    })

    it(`${ink}: 그려진 모든 글자도 같다 — 엔진이 막 계산과 다른 글자색을 쓰면 잡는다`, () => {
      const t = template([overlayNode({ ink })])
      const failures = ALL_SETS.flatMap(({ set }) => {
        const out = draw(t, SLOTS, ctxOf({ colors: set.colors }))
        const fill = filmOf(out)?.fill
        if (!fill) return [`${set.id} 막 없음`]
        return out.elements
          .filter((el) => el.type === 'text')
          .flatMap((el) => {
            const worst = worstContrast(el.textProps!.color!, fill)
            return worst < MIN_CONTRAST ? [`${set.id} ${el.name} ${worst.toFixed(2)}`] : []
          })
      })
      expect(failures).toEqual([])
    })
  }

  it('짙은 면이 없는 컨셉은 어두운 글자라 검은 사진이 최악이다 — 흰 사진만 재면 여기서 무너진다', () => {
    const noDeep = ALL_SETS.filter(({ concept }) => !concept.deep)
    expect(noDeep.length).toBeGreaterThan(0)
    for (const { set } of noDeep) {
      const film = overlayFilm('light', set.colors)
      expect(film.dark, set.id).toBe(false)
      expect(contrastRatio(parseColor(film.text)!, blendOver(film.fill, [0, 0, 0])!), set.id).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })

  it('짙은 면이 있는 컨셉의 light는 밝은 글자다', () => {
    const withDeep = ALL_SETS.filter(({ concept }) => concept.deep)
    expect(withDeep.length).toBeGreaterThan(0)
    for (const { set } of withDeep) expect(overlayFilm('light', set.colors).dark, set.id).toBe(true)
  })
})

describe('사진 위 글 그리기', () => {
  it('사진 → 스크림 → 글 순서로 쌓고, 글은 스크림 위에 온전히 얹힌다', () => {
    const out = draw(template([overlayNode()]))
    const [photo, scrim, title] = [byName(out, 'designcut-scene')!, byName(out, 'designcut-scrim')!, byName(out, 'designcut-headline')!]
    expect(photo.zIndex).toBeLessThan(scrim.zIndex)
    expect(scrim.zIndex).toBeLessThan(title.zIndex)
    expect(textsOnScrim(out.elements).size).toBe(2)
    expect(scrimIssues(out.elements)).toEqual([])
  })

  it('풀폭 사진 하나면 섹션이 곧 사진이다 — 위아래 여백이 남지 않는다', () => {
    const out = draw(template([overlayNode()]))
    const photo = byName(out, 'designcut-scene')!
    expect(photo.transform.y).toBe(0)
    expect(out.height).toBe(photo.transform.height)
  })

  it('anchor top은 스크림이 사진 위 끝에, bottom은 사진 아래 끝에 붙는다', () => {
    const top = draw(template([overlayNode({ anchor: 'top' })]))
    expect(byName(top, 'designcut-scrim')!.transform.y).toBe(0)
    const bottom = draw(template([overlayNode({ anchor: 'bottom' })]))
    const [photo, scrim] = [byName(bottom, 'designcut-scene')!, byName(bottom, 'designcut-scrim')!]
    expect(scrim.transform.y + scrim.transform.height).toBe(photo.transform.y + photo.transform.height)
    expect(byName(bottom, 'designcut-headline')!.transform.y).toBeGreaterThan(scrim.transform.y)
  })

  it('막과 흐림 띠가 한 요소다 — 따로 그리면 폰 축척에서 한 줄 틈이 생긴다', () => {
    const top = draw(template([overlayNode({ anchor: 'top' })]))
    const [topScrim, topFilm] = [byName(top, 'designcut-scrim')!.transform, byName(top, 'designcut-scrim-film')!.transform]
    expect(topFilm.y).toBe(topScrim.y)
    expect(topFilm.height).toBe(topScrim.height + SCRIM_FADE_H)
    const bottom = draw(template([overlayNode({ anchor: 'bottom' })]))
    const [bottomScrim, bottomFilm] = [byName(bottom, 'designcut-scrim')!.transform, byName(bottom, 'designcut-scrim-film')!.transform]
    expect(bottomFilm.y + bottomFilm.height).toBe(bottomScrim.y + bottomScrim.height)
    expect(bottomFilm.height).toBe(bottomScrim.height + SCRIM_FADE_H)
  })

  it('글자 뒤 구간은 같은 농도이고 사진 쪽 끝만 0으로 녹는다', () => {
    const film = { color: '#123456', alpha: 0.7 }
    const stops = (svg: string) => [...svg.matchAll(/offset="([\d.]+)" stop-color="#123456" stop-opacity="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(stops(scrimFilmSvg(film, 'a', 600, 200, 'down'))).toEqual([[0, 0.7], [0.75, 0.7], [1, 0]])
    expect(stops(scrimFilmSvg(film, 'a', 600, 200, 'up'))).toEqual([[0, 0], [0.25, 0.7], [1, 0.7]])
  })

  it('그려진 막은 글이 있는 쪽이 진하고 사진 쪽 끝이 0이다 — 방향이 뒤집히면 글 뒤 막이 사라진다', () => {
    const top = filmOf(draw(template([overlayNode({ anchor: 'top' })])))!.stops
    expect(top[0].opacity).toBeGreaterThan(0)
    expect(top[top.length - 1].opacity).toBe(0)
    const bottom = filmOf(draw(template([overlayNode({ anchor: 'bottom' })])))!.stops
    expect(bottom[0].opacity).toBe(0)
    expect(bottom[bottom.length - 1].opacity).toBeGreaterThan(0)
  })

  it('글자 자리 도형은 막 위, 글자 아래이고 투명하다 — 막을 두 겹으로 칠하지 않는다', () => {
    const out = draw(template([overlayNode()]))
    const [film, scrim, title] = [byName(out, 'designcut-scrim-film')!, byName(out, 'designcut-scrim')!, byName(out, 'designcut-headline')!]
    expect(film.zIndex).toBeLessThan(scrim.zIndex)
    expect(scrim.zIndex).toBeLessThan(title.zIndex)
    expect(scrim.shapeProps?.fill).toBe('transparent')
  })

  it('막의 그라데이션 id는 섹션마다 다르다 — 같으면 앞 섹션 색으로 그려진다', () => {
    const id = (out: ReturnType<typeof draw>) => /linearGradient id="([^"]+)"/.exec(byName(out, 'designcut-scrim-film')!.svgProps!.svgString)![1]
    expect(id(draw(template([overlayNode()])))).not.toBe(id(draw(template([overlayNode()]))))
  })

  it('글자는 막의 같은 농도 구간 안에 있다 — 흐림 구간은 대비를 보장하지 않는다', () => {
    for (const anchor of ['top', 'bottom'] as const) {
      const out = draw(template([overlayNode({ anchor })]))
      const scrim = byName(out, 'designcut-scrim')!.transform
      for (const el of out.elements.filter((e) => e.type === 'text')) {
        expect(el.transform.y, `${anchor} ${el.name}`).toBeGreaterThanOrEqual(scrim.y)
        expect(el.transform.y + el.transform.height, `${anchor} ${el.name}`).toBeLessThanOrEqual(scrim.y + scrim.height)
      }
    }
  })

  it('사진이 짧아 흐림 자리가 없어도 막은 사진 안이고 전수 판정을 통과한다', () => {
    const t = template([overlayNode({ anchor: 'bottom' })], {
      slots: { headline: textSlot({ required: true, maxChars: 12, maxLines: 2 }), sub: textSlot({ maxChars: 12, maxLines: 1 }), photo: imageSlot({ required: true, aspect: ['4:3'], minHeight: 500 }), note: textSlot({ maxChars: 12, maxLines: 1 }) },
    })
    const out = draw(t)
    const [photo, film] = [byName(out, 'designcut-scene')!.transform, byName(out, 'designcut-scrim-film')!.transform]
    expect(film.y).toBeGreaterThanOrEqual(photo.y)
    expect(film.y + film.height).toBe(photo.y + photo.height)
    expect(scrimIssues(out.elements)).toEqual([])
  })

  it('글이 모두 비면 스크림도 없다 — 빈 막으로 사진을 가리지 않는다', () => {
    const t = template([overlayNode({ nodes: [{ kind: 'text', slot: 'sub', token: 'BODY' }] })], {
      slots: { sub: textSlot({ maxChars: 12, maxLines: 1 }), photo: imageSlot({ required: true }) },
    })
    const out = draw(t, { photo: 'a' })
    expect(byName(out, 'designcut-scene')).toBeDefined()
    expect(byName(out, 'designcut-scrim')).toBeUndefined()
    expect(byName(out, 'designcut-scrim-film')).toBeUndefined()
  })

  it('M2 — 스크림이 있어 사진 위 글자 위반이 없다', () => {
    const out = draw(template([overlayNode()]))
    expect(checkMobileReadability({ sections: [sectionOf(out)] }).violations.filter((v) => v.rule === 'M2')).toEqual([])
  })
})

describe('사진 위 글과 리플로우', () => {
  const shrink = (out: ReturnType<typeof draw>, by: number) => {
    const section = sectionOf(out)
    for (const el of section.elements) if (el.type === 'text') el.measuredHeight = el.transform.height - by
    reflowSectionLayout(section)
    return section
  }

  for (const anchor of ['top', 'bottom'] as const) {
    it(`${anchor}: 글이 줄어도 사진·스크림이 그대로이고 섹션 높이도 그대로다`, () => {
      const out = draw(template([overlayNode({ anchor })]))
      const before = JSON.parse(JSON.stringify(out.elements)) as typeof out.elements
      const height = out.height
      const section = shrink(out, 30)
      for (const name of ['designcut-scene', 'designcut-scrim', 'designcut-scrim-film']) {
        const was = before.find((el) => el.name === name)!.transform
        const now = section.elements.find((el) => el.name === name)!.transform
        expect({ y: now.y, height: now.height }, name).toEqual({ y: was.y, height: was.height })
      }
      expect(section.canvas.height).toBe(height)
    })
  }

  it('글이 줄어든 만큼 아래 노드를 끌어올리지 않는다 — 사진이 줄 높이를 정하므로 덮지 않는다', () => {
    const t = template([overlayNode(), { kind: 'text', slot: 'note', token: 'BODY' }], {})
    const out = draw(t, { ...SLOTS, note: '아래 글' })
    const noteY = byName(out, 'designcut-note')!.transform.y
    const section = shrink(out, 30)
    const note = section.elements.find((el) => el.name === 'designcut-note')!
    expect(note.transform.y).toBe(noteY)
    expect(note.transform.y).toBeGreaterThanOrEqual(section.elements.find((el) => el.name === 'designcut-scene')!.transform.height)
  })
})

describe('사진 위 글과 모양 값', () => {
  it('서명 용기가 overlay다 — 없으면 풀폭 사진 템플릿과 서명이 같아진다', () => {
    const plain = deriveSignature({ flow: [{ kind: 'image', slot: 'photo', bleed: true }] })
    const over = deriveSignature({ flow: [overlayNode()] })
    expect(over.container).toBe('overlay')
    expect(over.photo).toBe(plain.photo)
  })

  it('서명 정렬은 사진 위 글에서 읽는다', () => {
    const nodes: FlowNode[] = [{ kind: 'text', slot: 'headline', token: 'H1', align: 'center' }]
    expect(deriveSignature({ flow: [overlayNode({ nodes: nodes as ImageOverlay['nodes'] })] }).align).toBe('center')
  })

  it('뼈대 값이 자리·글자색·안쪽 글을 가른다 — 그냥 image로 뭉개지면 뼈대 검사를 빠져나간다', () => {
    const base = skeletonKey([overlayNode()])
    expect(base).not.toBe(skeletonKey([{ kind: 'image', slot: 'photo', bleed: true }]))
    expect(base).not.toBe(skeletonKey([overlayNode({ anchor: 'bottom' })]))
    expect(base).not.toBe(skeletonKey([overlayNode({ ink: 'dark' })]))
    expect(base).not.toBe(skeletonKey([overlayNode({ nodes: [{ kind: 'text', slot: 'headline', token: 'H1' }] })]))
  })
})

describe('전수 검사 overlay 규칙', () => {
  const details = (t: Template) => lintTemplate(t).filter((v) => v.rule === 'overlay').map((v) => v.detail)

  it('쓰지 않는 섹션을 막는다', () => {
    const t = template([overlayNode()], { id: 'review.fixture', section: 'review' })
    expect(details(t).join()).toContain('쓰지 않는 섹션')
  })

  it('풀폭이 아니거나 맨 위 흐름이 아니면 막는다', () => {
    expect(details(template([overlayNode({}, { bleed: false })])).join()).toContain('맨 위 풀폭')
    const nested = template([{ kind: 'panel', fill: 'W', nodes: [overlayNode()] }])
    expect(details(nested).join()).toContain('맨 위 풀폭')
  })

  it('사진 뒤 판과 사진 전체 맞춤을 막는다', () => {
    expect(details(template([overlayNode({}, { plate: { dx: 40, dy: 40 } })])).join()).toContain('판')
    expect(details(template([overlayNode({}, { fit: 'contain' })])).join()).toContain('cover')
  })

  it('강조색 글자를 막는다 — 막 계산은 글자 본색만 보장한다', () => {
    const emphasis = template([overlayNode({ nodes: [{ kind: 'text', slot: 'headline', token: 'H1', emphasis: true }] })])
    expect(details(emphasis).join()).toContain('강조')
    const accent = template([overlayNode({ nodes: [{ kind: 'text', slot: 'headline', token: 'H1', color: 'accent' }] })])
    expect(details(accent).join()).toContain('강조')
  })

  it('글 아닌 노드를 막는다', () => {
    const t = template([overlayNode({ nodes: [{ kind: 'capsule', label: 'POINT' }] as unknown as ImageOverlay['nodes'] })])
    expect(details(t).join()).toContain('글만')
  })

  it(`스크림이 최악 사진 높이의 ${OVERLAY_SCRIM_MAX * 100}%를 넘으면 막는다`, () => {
    const t = template([overlayNode()], {
      slots: {
        headline: textSlot({ required: true, maxChars: 12, maxLines: 2 }),
        sub: textSlot({ maxChars: 12, maxLines: 1 }),
        photo: imageSlot({ required: true, purpose: ['scene'], aspect: ['4:3'], minHeight: 500 }),
        note: textSlot({ maxChars: 12, maxLines: 1 }),
      },
    })
    expect(details(t).join()).toMatch(/스크림 \d+px가 사진/)
  })

  it('맞게 쓰면 overlay 위반이 없다', () => {
    expect(details(template([overlayNode()]))).toEqual([])
  })

  it('글자 자리 도형만 있고 막이 없으면 판정이 잡는다 — 투명 도형만으로는 글이 안 읽힌다', () => {
    const out = draw(template([overlayNode()]))
    const without = out.elements.filter((el) => el.name !== 'designcut-scrim-film')
    expect(scrimIssues(without).join()).toContain('막 없음')
    expect(scrimIssues(out.elements)).toEqual([])
  })

  it('스크림 없이 사진 위에 글만 얹힌 결과는 판정 함수가 스크림 글로 치지 않는다', () => {
    const out = draw(template([overlayNode()]))
    const without = out.elements.filter((el) => el.name !== 'designcut-scrim')
    expect(textsOnScrim(without).size).toBe(0)
  })

  it('글이 스크림보다 아래 z면 스크림 글로 치지 않는다 — 막에 가려 안 읽힌다', () => {
    const out = draw(template([overlayNode()]))
    const title = out.elements.find((el) => el.name === 'designcut-headline')!
    title.zIndex = byName(out, 'designcut-scrim')!.zIndex - 1
    expect(textsOnScrim(out.elements).has(title.id)).toBe(false)
  })

  it('글이 스크림 밖으로 걸치면 스크림 글로 치지 않는다', () => {
    const out = draw(template([overlayNode()]))
    const title = out.elements.find((el) => el.name === 'designcut-headline')!
    title.transform.y = byName(out, 'designcut-scrim')!.transform.height - 5
    expect(textsOnScrim(out.elements).has(title.id)).toBe(false)
  })
})
