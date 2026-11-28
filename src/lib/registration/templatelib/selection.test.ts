/**
 * K 라인 선택 규칙 — 컨셉 후보·색·후보 필터·구성 검사·구성 거리·기록 형식. 템플릿은 시험용 가짜 메타데이터다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { EVIDENCE_LOCKED as H0_LOCKED, K_SECTIONS as H0_SECTIONS } from '../../../../scripts/pdp-eval/stage-h0-core.mjs'
import { templateLineLedger } from '../__e2e__/template-ledger'
import { CONCEPTS, conceptById } from './concepts'
import { TEMPLATES } from './library'
import { FONT_PAIR_TABLE } from './font-pairs'
import {
  CANDIDATE_LIMIT,
  buildSelectionRecord,
  FACT_FREE_BODY,
  candidatesFor,
  compositionDistance,
  compositionIssues,
  conceptCandidates,
  fontPairOf,
  medianCompositionDistance,
  pickPalette,
  stableHash,
  type SelectionProfile,
} from './selection'
import { tpl } from './selection.fixture'
import { solveOrder } from './selection-order'
import { copyFactRange, evidenceOf } from './selection-facts'
import { EVIDENCE_LOCKED, K_SECTIONS, type TemplateMeta } from './template-meta'
import { COMPARE_BASIS } from './template-types'

const concept = conceptById('clean-trust')!

const profile = (over: Partial<SelectionProfile> = {}): SelectionProfile => ({
  key: 'P02',
  categoryKey: 'household',
  photoCount: 4,
  productHex: null,
  evidence: new Set(['review']),
  ...over,
})

describe('비교 근거 잠금 — 실제 라이브러리', () => {
  const library = TEMPLATES as unknown as TemplateMeta[]
  const LOCKED = ['compare.cross-check-lists', 'compare.marks-table', 'compare.side-rows', 'compare.tile-duel', 'compare.vs-cards', 'point_div.compare-marks']
  const rich = profile({ photoCount: 6, evidence: new Set(['review', 'rating', 'certification', 'offer', 'faq', 'size', 'option', 'quantity']) })
  const ids = (section: string, p: SelectionProfile) => candidatesFor(section, library, p, concept, Number.POSITIVE_INFINITY).map((t) => t.id)

  it('입력을 다 가진 상품도 근거가 서지 않아 잠긴 변형을 고르지 않는다', () => {
    const full = { reviewQuotes: [{ text: 'x' }], rating: 4.5, reviewCount: 3, certificationInfo: 'KC', eventBannerInfo: 'x', size: '10cm', colorOptions: ['빨강'] } as unknown as Parameters<typeof evidenceOf>[0]
    expect(evidenceOf(full).has(COMPARE_BASIS)).toBe(false)
    expect(library.filter((t) => t.needs.evidence.includes(COMPARE_BASIS)).map((t) => t.id).sort()).toEqual(LOCKED)
    for (const id of LOCKED) expect(ids(id.split('.')[0], rich)).not.toContain(id)
  })

  it('뷰티·식품은 고객의 전후 칸을 고르지 않는다(피부·몸 상태 전후로 읽힘, L7 #10) — 다른 카테고리는 그대로', () => {
    const BEFORE_AFTER = ['compare.before-after-photos', 'direction_suggest.before-after']
    for (const id of BEFORE_AFTER) {
      const section = id.split('.')[0]
      for (const categoryKey of ['beauty', 'food']) expect(ids(section, { ...rich, categoryKey }), `${categoryKey} ${id}`).not.toContain(id)
      for (const categoryKey of ['household', 'pet', 'fashion', 'digital', 'stationery', 'packaging']) expect(ids(section, { ...rich, categoryKey }), `${categoryKey} ${id}`).toContain(id)
    }
  })

  it('우리 장점만 말하는 변형과 고민 엑스는 그대로 고를 수 있다', () => {
    for (const id of ['compare.dark-band', 'compare.checks-card', 'compare.before-after-photos', 'compare.side-advantages', 'compare.number-stack', 'compare.bleed-rule']) {
      expect(ids('compare', rich), id).toContain(id)
    }
    expect(ids('problem_raise', rich)).toContain('problem_raise.cross-list')
  })

  it('근거가 서면 다시 고를 수 있다 — 지운 것이 아니라 잠근 것이다', () => {
    expect(ids('compare', profile({ photoCount: 6, evidence: new Set([COMPARE_BASIS]) }))).toContain('compare.marks-table')
  })
})

describe('섹션 목록', () => {
  it('하네스 H0와 같은 29종·같은 근거 잠금이다', () => {
    expect([...K_SECTIONS]).toEqual(H0_SECTIONS)
    expect(K_SECTIONS).toHaveLength(29)
    expect([...EVIDENCE_LOCKED]).toEqual(H0_LOCKED)
  })
})

describe('컨셉 후보', () => {
  it('막힌 카테고리는 빼고 맞는 카테고리를 앞에 둔다', () => {
    const list = conceptCandidates({ key: 'P02', categoryKey: 'pet' })
    expect(list.map((c) => c.id)).not.toContain('black-gold')
    const firstRest = list.findIndex((c) => !c.categories.includes('pet'))
    expect(list.slice(0, firstRest).every((c) => c.categories.includes('pet'))).toBe(true)
    expect(list.slice(firstRest).every((c) => !c.categories.includes('pet'))).toBe(true)
  })

  it('결정론이고, 상품이 다르면 앞줄이 달라진다', () => {
    const ids = (key: string) => conceptCandidates({ key, categoryKey: 'household' }).map((c) => c.id)
    expect(ids('P02')).toEqual(ids('P02'))
    expect(ids('P02').slice(0, 5)).not.toEqual(ids('P03').slice(0, 5))
    expect(new Set(ids('P02')).size).toBe(ids('P02').length)
  })

  it('해시는 값이 고정이다', () => {
    expect(stableHash('')).toBe(0x811c9dc5)
    expect(stableHash('a')).toBe(0xe40c292c)
  })
})

describe('색·글꼴 고르기', () => {
  it('모든 컨셉에서 색 조합을 고를 수 있고 결정론이다', () => {
    for (const c of CONCEPTS) {
      const picked = pickPalette(c, { key: 'P02', productHex: null })
      expect(picked?.conceptId).toBe(c.id)
      expect(pickPalette(c, { key: 'P02', productHex: null })).toEqual(picked)
    }
  })

  it('상품색에 가까운 강조색을 고른다', () => {
    const pastel = conceptById('pastel-baby')!
    expect(pickPalette(pastel, { key: 'P02', productHex: '#F0746E' })?.accent).toBe('coral')
    expect(pickPalette(pastel, { key: 'P02', productHex: '#1E88C8' })?.accent).toBe('sky')
  })

  it('무채 상품은 컨셉 첫 강조색 안에서 상품마다 다른 바탕·대비를 고른다', () => {
    const picks = new Set(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'].map((key) => pickPalette(concept, { key, productHex: null })?.id))
    expect(picks.size).toBeGreaterThan(1)
    for (const id of picks) expect(id).toContain(`.${concept.accents[0].id}.`)
  })

  it('글꼴 짝은 컨셉이 가리킨 것이다', () => {
    expect(fontPairOf(concept)).toEqual({ id: concept.fontPair, pair: FONT_PAIR_TABLE[concept.fontPair] })
  })
})

describe('섹션 후보', () => {
  it('근거 잠금: 자료 이름이 섹션 이름과 달라도 자료가 없으면 후보가 없다', () => {
    const offer = [tpl('event_offer.a')]
    expect(candidatesFor('event_offer', offer, profile(), concept)).toEqual([])
    expect(candidatesFor('event_offer', offer, profile({ evidence: new Set(['event_offer']) }), concept)).toEqual([])
    expect(candidatesFor('event_offer', offer, profile({ evidence: new Set(['offer']) }), concept).map((t) => t.id)).toEqual(['event_offer.a'])
    const metric = [tpl('perf_metric.a')]
    expect(candidatesFor('perf_metric', metric, profile(), concept)).toEqual([])
    expect(candidatesFor('perf_metric', metric, profile({ evidence: new Set(['rating']) }), concept).map((t) => t.id)).toEqual(['perf_metric.a'])
  })

  it('사진 수·필요한 근거·막힌 카테고리 템플릿을 뺀다', () => {
    const list = [
      tpl('main_cut.ok'),
      tpl('main_cut.photos', { photos: 5 }),
      tpl('main_cut.evidence', { evidence: ['quantity'] }),
      tpl('main_cut.block', { block: ['household'] }),
      tpl('hook_3step.other'),
    ]
    expect(candidatesFor('main_cut', list, profile(), concept).map((t) => t.id)).toEqual(['main_cut.ok'])
    expect(candidatesFor('main_cut', list, profile({ evidence: new Set(['quantity']) }), concept).map((t) => t.id)).toContain('main_cut.evidence')
  })

  it('점수 순서: 컨셉 적합 > 밀도 일치, 평균 점수와 사용 횟수를 반영하고 상위 5개만', () => {
    const other = concept.density === 'high' ? 'low' : 'high'
    const list = [
      tpl('main_cut.plain', { density: other }),
      tpl('main_cut.density', { density: concept.density }),
      tpl('main_cut.concept', { concepts: [concept.id], density: other }),
      tpl('main_cut.used', { concepts: [concept.id], used: 50, density: other }),
      tpl('main_cut.scored', { concepts: [concept.id], avg: 4, density: other }),
      tpl('main_cut.extra1', { density: other }),
      tpl('main_cut.extra2', { density: other }),
    ]
    // 동점이면 씨앗이 순서를 정하므로, 점수로 갈린 순서인지 여러 상품으로 본다
    for (const key of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']) {
      const ids = candidatesFor('main_cut', list, profile({ key }), concept).map((t) => t.id)
      expect(ids).toHaveLength(CANDIDATE_LIMIT)
      expect(ids.slice(0, 4)).toEqual(['main_cut.scored', 'main_cut.concept', 'main_cut.used', 'main_cut.density'])
    }
  })

  it('점수가 같으면 상품 씨앗 순서 — 상품마다 앞줄이 달라진다', () => {
    const list = Array.from({ length: 10 }, (_, i) => tpl(`main_cut.t${i}`))
    const first = (key: string) => candidatesFor('main_cut', list, profile({ key }), concept)[0].id
    expect(new Set(['P01', 'P02', 'P03', 'P04', 'P05', 'P06'].map(first)).size).toBeGreaterThan(1)
    expect(first('P02')).toBe(first('P02'))
  })
})

describe('사실을 쓰지 않는 본문', () => {
  const library = TEMPLATES as unknown as TemplateMeta[]

  it('권유 섹션은 상품 정보 표 앞에 놓이므로 사진 있는 템플릿도 후보다', () => {
    const list = [tpl('convert_div.photo', { section: 'convert_div', photos: 1 }), tpl('convert_div.text', { section: 'convert_div', photos: 0 })]
    expect(candidatesFor('convert_div', list, profile(), concept).map((t) => t.id).sort()).toEqual(['convert_div.photo', 'convert_div.text'])
  })

  it('실제 라이브러리에서 두 섹션 모두 최소 칸이 0인 후보가 있다 — 옵션 모아 보기는 옵션 근거가 있을 때만 열린다', () => {
    const ids = (section: string, p: SelectionProfile) => candidatesFor(section, library, p, concept, Number.POSITIVE_INFINITY)
    const convert = ids('convert_div', profile())
    expect(convert.length).toBeGreaterThanOrEqual(2)
    expect(convert.every((t) => copyFactRange(t).min === 0)).toBe(true)
    expect(convert.some((t) => t.needs.photos > 0)).toBe(true)
    expect(ids('option_gallery', profile())).toEqual([])
    const gallery = ids('option_gallery', profile({ evidence: new Set(['option']) }))
    expect(gallery.length).toBeGreaterThan(0)
    expect(gallery.every((t) => copyFactRange(t).min === 0)).toBe(true)
    expect(FACT_FREE_BODY).toEqual(['option_gallery', 'convert_div'])
  })
})

describe('구성 검사', () => {
  const page = (n: number, extra: string[] = []) => [...Array.from({ length: n - extra.length - 1 }, (_, i) => `s${i}`), 'spec_table', ...extra]
  const none = new Set<string>()

  it('섹션 수 18~22(오너 지시 — 20개 내외)', () => {
    expect(compositionIssues(page(18), none)).toEqual([])
    expect(compositionIssues(page(22), none)).toEqual([])
    expect(compositionIssues(page(17), none)).toEqual(['섹션 17개(18~22)'])
    expect(compositionIssues(page(23), none)).toEqual(['섹션 23개(18~22)'])
  })

  it('큰 POINT 3개까지, 자료 없는 잠금 섹션 금지 — 자료 이름으로 본다', () => {
    const four = page(18, ['point_div', 'point_div', 'point_div', 'point_div'])
    expect(compositionIssues(four, none)).toEqual(['큰 POINT 4개(최대 3)'])
    expect(compositionIssues(page(18, ['faq']), none)).toEqual(['근거 없는 섹션: faq'])
    expect(compositionIssues(page(18, ['faq']), new Set(['faq']))).toEqual([])
    expect(compositionIssues(page(18, ['perf_metric']), new Set(['perf_metric']))).toEqual(['근거 없는 섹션: perf_metric'])
    expect(compositionIssues(page(18, ['perf_metric']), new Set(['rating']))).toEqual([])
  })

  it('후기 자료가 있는데 빠지면 문제다, 상품 정보 표는 자료와 무관하게 필수다', () => {
    expect(compositionIssues(page(18), new Set(['review']))).toEqual(['후기 자료가 있는데 후기 섹션이 없음'])
    expect(compositionIssues(page(18, ['review']), new Set(['review']))).toEqual([])
    const noTable = Array.from({ length: 18 }, (_, i) => `s${i}`)
    expect(compositionIssues(noTable, none)).toEqual(['상품 정보 표가 없음'])
  })
})

describe('구성 거리', () => {
  it('같으면 0, 겹치지 않으면 1, 일부 겹치면 자카드 거리', () => {
    expect(compositionDistance(['a', 'b'], ['a', 'b'])).toBe(0)
    expect(compositionDistance(['a'], ['b'])).toBe(1)
    expect(compositionDistance(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5)
    expect(compositionDistance([], [])).toBe(0)
  })

  it('중앙값 — 짝수·홀수 개, 페이지가 둘 미만이면 null', () => {
    expect(medianCompositionDistance([['a']])).toBeNull()
    expect(medianCompositionDistance([['a'], ['a'], ['b']])).toBe(1)
    expect(medianCompositionDistance([['a'], ['a'], ['a'], ['b']])).toBe(0.5)
  })
})

describe('기록', () => {
  it('하네스 원장이 그대로 읽는다 — 컨셉·대안·색·글꼴·섹션별 템플릿·넘어간 수', () => {
    const order = solveOrder(
      [
        { section: 'main_cut', candidates: [tpl('main_cut.a', { zone: 'intro' })] },
        { section: 'cta', candidates: [tpl('cta.a', { zone: 'decision', notNextTo: ['main_cut.a'] }), tpl('cta.b', { zone: 'decision' })] },
      ],
      concept
    )
    const palette = pickPalette(concept, { key: 'P02', productHex: null })!
    const templatelib = buildSelectionRecord({
      concept,
      alternatives: ['soft-gray', 'simple-life'],
      conceptReason: '실용 비교형',
      palette,
      order,
      reasons: { 'main_cut.a': '사진 한 장으로 충분' },
    })
    expect(templateLineLedger({ templatelib }).templateLine).toEqual({
      concept: concept.id,
      alternatives: ['soft-gray', 'simple-life'],
      palette: palette.id,
      fontPair: concept.fontPair,
      sections: 2,
      distinct: 2,
      templates: [
        { section: 'main_cut', template: 'main_cut.a' },
        { section: 'cta', template: 'cta.b' },
      ],
      fallbacks: 1,
    })
    expect(templatelib.sections[0].reason).toBe('사진 한 장으로 충분')
    expect(templatelib.sections[1]).not.toHaveProperty('reason')
    expect(templatelib.concept.reason).toBe('실용 비교형')
    expect(templatelib.height).toEqual(order.height)
    expect(JSON.parse(JSON.stringify(templatelib))).toEqual(templatelib)
  })
})
