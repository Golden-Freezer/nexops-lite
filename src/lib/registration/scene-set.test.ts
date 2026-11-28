import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONTEXTS, DEFAULT_CONTEXTS } from '@/lib/agents/registration/prompts/pdp-plate-prompts'
import { styleLightingOf } from './pdp-image-tasks'
import type { PdpJobRow } from './pdp-state'
import {
  buildD2SceneSet,
  buildLineSceneSet,
  buildSceneSet,
  describeSceneSet,
  isLightNeutral,
  SCENE_SEASON,
  sceneSetInputOf,
  windowSideOf,
  type SceneSetInput,
} from './scene-set'

const input = (over: Partial<SceneSetInput> = {}): SceneSetInput => ({
  category: 'pet',
  palette: { bgMain: '#fff7f0' },
  light: { direction: 'top-left' },
  productText: '',
  seed: 'job-1',
  ...over,
})
const CATEGORIES = [...Object.keys(CONTEXTS), 'packaging', 'unknown']
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
/** seed 여러 개로 나올 수 있는 소품 전부 */
const propsSeen = (over: Partial<SceneSetInput>) => new Set(seeds(60).flatMap((seed) => buildSceneSet(input({ ...over, seed })).props))

describe('끈 잡·R 세트(buildSceneSet)는 글자까지 그대로다', () => {
  it('카테고리 9·seed 5·상품 글 2 조합의 세트 줄 해시 — 값은 K 어휘를 넣기 전에 찍었다', () => {
    const rows: string[] = []
    for (const category of ['household', 'food', 'beauty', 'stationery', 'digital', 'fashion', 'pet', 'packaging', 'unknown']) {
      for (const seed of ['a', 'job-1', 'P01', 'zzz', '842a5ef1']) {
        for (const productText of ['', '타월 화분 접시 노트 바구니']) {
          rows.push(describeSceneSet(buildSceneSet({ category, palette: { bgMain: '#FFFFFF' }, light: { direction: 'top-left' }, productText, seed })))
        }
      }
    }
    expect(rows).toHaveLength(90)
    expect(createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16)).toBe('743b52cf6650bf3d')
  })
})

describe('buildLineSceneSet — K 세트 어휘', () => {
  const lineOf = (over: Partial<SceneSetInput>, parts?: string[]) => {
    const at = input(over)
    return buildLineSceneSet(buildSceneSet(at), at, parts)
  }
  const PLANT = /plant|succulent|herb|eucalyptus|flower|sprig|vase|moss|leaf|leaves|greenery|bouquet/i

  it('8키와 모르는 카테고리 모두 식물 소품과 오크 바닥이 없다 — 옛 표의 식물 소품이 실제로 걸러지는지도 본다', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(60)) {
        const set = lineOf({ category, seed })
        expect(set.props.join(' '), `${category} ${seed}`).not.toMatch(PLANT)
        expect(set.floor, `${category} ${seed}`).not.toMatch(/oak/i)
        expect(set.props.length, `${category} ${seed}`).toBe(2)
        expect(new Set(set.props).size).toBe(2)
      }
    }
    // 같은 입력의 기준 세트에는 식물·오크가 나온다 — 위 시험이 빈 검사가 아니다
    const old = seeds(60).map((seed) => buildSceneSet(input({ category: 'household', seed })))
    expect(old.some((set) => PLANT.test(set.props.join(' ')))).toBe(true)
    expect(old.some((set) => /oak/i.test(set.floor))).toBe(true)
  })

  it('장소·벽·창·계절은 기준 세트 그대로이고 같은 입력이면 같은 값이다', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(20)) {
        const at = input({ category, seed })
        const base = buildSceneSet(at)
        const set = buildLineSceneSet(base, at)
        const place = (CONTEXTS[category] ?? DEFAULT_CONTEXTS).find((p) => base.floor.endsWith(p))!
        expect(set.floor.endsWith(place), `${set.floor} / ${base.floor}`).toBe(true)
        expect({ wall: set.wall, window: set.window, season: set.season }).toEqual({ wall: base.wall, window: base.window, season: base.season })
        expect(buildLineSceneSet(base, at)).toEqual(set)
      }
    }
  })

  it('키마다 바닥과 소품이 잡에 따라 갈린다', () => {
    for (const category of CATEGORIES) {
      const sets = seeds(60).map((seed) => lineOf({ category, seed }))
      expect(new Set(sets.map((set) => set.floor)).size, category).toBeGreaterThan(2)
      expect(new Set(sets.flatMap((set) => set.props)).size, category).toBeGreaterThanOrEqual(3)
    }
  })

  it('조사 문서의 식품 소쿠리·종이결이 나오고, 상품과 같은 종류 소품은 빠진다', () => {
    const food = seeds(60).map((seed) => lineOf({ category: 'food', seed }))
    expect(food.some((set) => set.props.includes('a woven bamboo basket'))).toBe(true)
    expect(food.some((set) => set.floor.startsWith('paper-grain-covered'))).toBe(true)
    const made = seeds(60).flatMap((seed) => lineOf({ category: 'food', seed, productText: '대나무 소쿠리 바구니' }).props)
    expect(made).not.toContain('a woven bamboo basket')
  })

  it('입력에 적힌 부속이 먼저 오고 합쳐 2개를 넘지 않는다', () => {
    const one = lineOf({ category: 'digital' }, ['연결 태그'])
    expect(one.props).toHaveLength(2)
    expect(one.props[0]).toBe('the 연결 태그 that comes with this product, exactly as in the reference photos')
    expect(one.props[1]).not.toMatch(PLANT)
    expect(lineOf({ category: 'digital' }, ['가', '나', '다']).props.map((text) => text.slice(4, 5))).toEqual(['가', '나'])
    expect(describeSceneSet(one)).toContain('the 연결 태그 that comes with this product')
  })
})

describe('buildD2SceneSet — D2 세트도 K 어휘 표(적용 D4 ⓒ)', () => {
  const PLANT = /plant|succulent|herb|eucalyptus|flower|sprig|vase|moss|leaf|leaves|greenery|bouquet/i

  it('K 세트(부속 없이)와 같은 값 — 오크 바닥·식물 소품이 없고 소품은 2개, 장소·벽(컷 바탕 톤)·창·계절은 기준 세트 그대로', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(30)) {
        for (const bgMain of ['#FFFFFF', '#1f3a5f']) {
          const at = input({ category, seed, palette: { bgMain }, light: { direction: 'top-right' } })
          const base = buildSceneSet(at)
          const set = buildD2SceneSet(at)
          expect(set, `${category} ${seed}`).toEqual(buildLineSceneSet(base, at))
          expect(set.floor, `${category} ${seed}`).not.toMatch(/oak/i)
          expect(set.props.join(' '), `${category} ${seed}`).not.toMatch(PLANT)
          expect(set.props).toHaveLength(2)
          expect({ wall: set.wall, window: set.window, season: set.season }).toEqual({ wall: base.wall, window: base.window, season: base.season })
          expect(set.props.some((p) => p.startsWith('the '))).toBe(false)
        }
      }
    }
    expect(buildD2SceneSet(input({ palette: { bgMain: '#FFFFFF' } })).wall).toContain('(tone close to #FFFFFF)')
  })

  it('K 세트는 기준 세트가 D2 어휘로 바뀌어도 바이트 같다 — K는 바닥·소품을 다시 고르고 장소·벽·창·계절은 같다', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(30)) {
        const at = input({ category, seed })
        for (const parts of [[], ['연결 태그']]) {
          expect(buildLineSceneSet(buildD2SceneSet(at), at, parts), `${category} ${seed}`).toEqual(buildLineSceneSet(buildSceneSet(at), at, parts))
        }
      }
    }
  })

  it('상품과 같은 종류 소품은 D2에서도 빠진다', () => {
    const made = seeds(60).flatMap((seed) => buildD2SceneSet(input({ category: 'household', seed, productText: '접시 트레이 쟁반' })).props)
    expect(made).not.toContain('a ceramic tray')
    expect(made.length).toBe(120)
  })
})

describe('buildSceneSet — 잡 하나에 세트 하나(결정론)', () => {
  it('같은 입력이면 늘 같은 세트, 잡이 다르면 세트가 갈린다', () => {
    expect(buildSceneSet(input())).toEqual(buildSceneSet(input()))
    const sets = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(buildSceneSet(input({ seed: `job-${i}` })))))
    expect(sets.size).toBeGreaterThan(5)
  })

  it('받침면 장소는 플레이트와 같은 표(CONTEXTS)에서, 소품은 2~3개이고 서로 다르다, 계절은 중립', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(20)) {
        const set = buildSceneSet(input({ category, seed }))
        const places = CONTEXTS[category] ?? DEFAULT_CONTEXTS
        expect(places.some((p) => set.floor.endsWith(p)), `${category}: ${set.floor}`).toBe(true)
        expect(set.props.length).toBeGreaterThanOrEqual(2)
        expect(set.props.length).toBeLessThanOrEqual(3)
        expect(new Set(set.props).size).toBe(set.props.length)
        expect(set.season).toBe(SCENE_SEASON)
      }
    }
  })

  it('받침면은 밝은 재질만 — 짙은 나무·돌이 없다', () => {
    for (const category of CATEGORIES) {
      for (const seed of seeds(20)) expect(buildSceneSet(input({ category, seed })).floor, category).not.toMatch(/walnut|dark|black|charcoal/i)
    }
  })

  it('창은 헌장 광원과 같은 쪽', () => {
    expect(windowSideOf('top-left')).toBe('left')
    expect(windowSideOf('upper right')).toBe('right')
    expect(windowSideOf('back light')).toBe('back')
    expect(windowSideOf('overhead')).toBe('left')
    expect(buildSceneSet(input({ light: { direction: 'top-right' } })).window).toContain('from the right')
  })

  it('벽은 바탕색이 밝은 뉴트럴(L*≥94·C*≤6)일 때만 그 톤을 따른다 — 짙은 브랜드색이면 재질만', () => {
    expect(isLightNeutral('#fff7f0')).toBe(true)
    expect(isLightNeutral('#ffffff')).toBe(true)
    expect(isLightNeutral('#c2410c')).toBe(false)
    expect(isLightNeutral('#e8f0ff')).toBe(false)
    expect(isLightNeutral('not-a-color')).toBe(false)
    expect(buildSceneSet(input()).wall).toContain('#fff7f0')
    expect(buildSceneSet(input({ palette: { bgMain: '#c2410c' } })).wall).not.toContain('#')
    expect(buildSceneSet(input({ palette: {} })).wall).not.toContain('#')
  })

  it('상품명과 같은 종류 소품은 빠진다 — 상품·구성품으로 오인되지 않게(A 검토)', () => {
    expect(propsSeen({ category: 'household' })).toContain('a clear glass jar')
    expect(propsSeen({ category: 'household', productText: '스텐 밀폐 보관용기 3종' })).not.toContain('a clear glass jar')
    expect(propsSeen({ category: 'household', productText: '원목 트레이' })).not.toContain('a ceramic tray')
    expect(propsSeen({ category: 'stationery' })).toContain('a closed notebook')
    expect(propsSeen({ category: 'stationery', productText: '스프링 노트 5권' })).not.toContain('a closed notebook')
    expect(propsSeen({ category: 'pet', productText: '고양이 낚싯대 장난감' })).not.toContain('a rope toy')
    // 걸러도 2개 아래로 줄지 않는다(기본 중립 소품으로 채움)
    for (const seed of seeds(20)) {
      expect(buildSceneSet(input({ category: 'household', productText: '타월 화분 트레이 보관용기', seed })).props.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('포장 상품 세트에는 리본·포장지가 없다(함께 오는 구성으로 읽히지 않게), 반려동물 세트에는 그릇 소품이 없다', () => {
    expect([...propsSeen({ category: 'packaging' })].join(' ')).not.toMatch(/ribbon|tissue|wrapping|gift/i)
    expect([...propsSeen({ category: 'pet' })].join(' ')).not.toMatch(/bowl|dish|plate/)
  })

  it('describeSceneSet — 헌장 setDesc 한 줄에 바닥·벽·창·계절·소품이 다 들어간다', () => {
    const set = buildSceneSet(input())
    const text = describeSceneSet(set)
    for (const part of [set.floor, set.wall, set.window, set.season, ...set.props]) expect(text).toContain(part)
    expect(text).not.toContain('\n')
  })
})

describe('sceneSetInputOf — 잡에서 세트 입력을 읽는다', () => {
  it('카테고리·팔레트·광원 방향·상품명+핵심 특징·잡 ID — 광원 방향은 styleLightingOf와 같은 값', () => {
    const job = {
      id: 'job-9',
      analysis: { detected_category: 'food' },
      spec_sheet: { productName: '원목 도마', keyFeatures: ['양면 사용', '미끄럼 방지'] },
      copy_sections: { final: { designPalette: { bgMain: '#ffffff' } } },
      design_prompts: { lighting_params: { direction: 'right' } },
    } as unknown as PdpJobRow
    expect(sceneSetInputOf(job)).toEqual({
      category: 'food',
      palette: { bgMain: '#ffffff' },
      light: { direction: 'right' },
      productText: '원목 도마 양면 사용 미끄럼 방지',
      seed: 'job-9',
    })
    expect(sceneSetInputOf(job).light.direction).toBe(styleLightingOf(job).direction)
    expect(new Set(seeds(30).flatMap((seed) => buildSceneSet({ ...sceneSetInputOf(job), seed }).props))).not.toContain('a wooden cutting board')
  })

  it('기록이 비어 있으면 spec 카테고리·빈 팔레트·top-left(styleLightingOf 기본과 같다)', () => {
    const bare = { id: 'j', analysis: {}, spec_sheet: { category: 'beauty' }, copy_sections: {}, design_prompts: {} } as unknown as PdpJobRow
    expect(sceneSetInputOf(bare)).toEqual({ category: 'beauty', palette: {}, light: { direction: 'top-left' }, productText: '', seed: 'j' })
    expect(sceneSetInputOf(bare).light.direction).toBe(styleLightingOf(bare).direction)
  })
})
