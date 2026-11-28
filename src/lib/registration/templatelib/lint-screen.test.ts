/**
 * 화면 단계 복제 검사 시험 — 아래 첫 안은 판정을 모두 통과했지만 공용과 같아 보여 사람이 눈으로 고쳤다. 그대로 넣어 검사기가 잡는지 본다.
 * 자료 lint-screen.fixture.json은 fashion 5건(#559 첫 커밋 5bddc441)과 다른 키 5건(#531·#533·#538·#548 첫 커밋)을 커밋에서 그대로 옮겼다.
 */

import { describe, expect, it } from 'vitest'
import { imageSlot } from './engine.fixture'
import { TEMPLATES, templateById } from './library'
import { lintCategoryTemplates, screenDuplicates, screenKey, screenOrderPairs, skeletonKey } from './lint-category'
import firstDraft from './lint-screen.fixture.json'
import knownList from './screen-known.json'
import type { FlowNode, Template } from './template-types'

const draft = (id: string) => {
  const found = (firstDraft as unknown as Template[]).find((t) => t.id === id)
  if (!found) throw new Error(`자료에 없음: ${id}`)
  return found
}
const common = (id: string) => {
  const found = templateById(id)
  if (!found) throw new Error(`라이브러리에 없음: ${id}`)
  return found
}

const FIRST_DRAFT_PAIRS: Array<[string, string, string]> = [
  ['point_list_div.fashion-rows-side-photo', 'point_list_div.side-center', 'H,row@0.5(list1(s)|photo)'],
  ['point_div.fashion-bleed-tags', 'point_div.scene-band', 'H,photo:bleed'],
  ['petit_div.fashion-bleed-line', 'petit_div.top-center', 'photo:bleed,H'],
  ['direction_suggest.fashion-title-bleed-tags', 'direction_suggest.center-bleed', 'H,photo:bleed'],
  ['problem_empathy.fashion-center-bleed-note', 'problem_empathy.quote-bleed', 'H,photo:bleed'],
  ['solution_guide.packaging-fill-pair', 'solution_guide.pair-actions', 'H,list2(photo)'],
  ['solution_guide.food-cook-store-trio', 'solution_guide.grid-center', 'H,list3(photo)'],
]
/** 자료의 나머지 3건 — 적용 K13에서 후킹이 복제 검사 예외가 되고(2건) 공용 main_cut.package-pair 모양이 바뀌어(1건) 이 시험에서 뺐다 */
const RETIRED_DRAFTS = 3

describe('눈으로 고친 첫 안 10건', () => {
  it('자료가 10건이고 모두 카테고리 칸이다', () => {
    expect(firstDraft).toHaveLength(FIRST_DRAFT_PAIRS.length + RETIRED_DRAFTS)
    for (const [cellId] of FIRST_DRAFT_PAIRS) expect(draft(cellId).fit.categories?.length, cellId).toBeGreaterThan(0)
  })

  it.each(FIRST_DRAFT_PAIRS)('%s를 공용 %s와 같은 화면으로 잡는다', (cellId, commonId, key) => {
    const cell = draft(cellId)
    const base = common(commonId)
    // 옛 키로는 다르다 — 그래서 판정을 통과했다
    expect(skeletonKey(cell.flow)).not.toBe(skeletonKey(base.flow))
    expect(screenKey(cell.flow, cell.slots)).toBe(key)
    expect(screenKey(base.flow, base.slots)).toBe(key)
    const violations = lintCategoryTemplates([base, cell], [])
    expect(violations).toHaveLength(1)
    expect(violations[0].template).toBe(cellId)
    expect(violations[0].detail).toContain(`공용 ${commonId}와 화면 단계가 같음`)
    expect(violations[0].detail).toContain(key)
  })

  it('알려진 목록에 넣으면 옛 규칙만 남아 모두 통과한다 — 새 규칙만 이 첫 안을 잡는다', () => {
    for (const [cellId, commonId] of FIRST_DRAFT_PAIRS) {
      expect(lintCategoryTemplates([common(commonId), draft(cellId)], [`${cellId}|${commonId}`])).toEqual([])
    }
  })

  it('고친 지금 칸은 그 공용과 다르다', () => {
    const list = knownList as string[]
    for (const [cellId, commonId] of FIRST_DRAFT_PAIRS) {
      const section = draft(cellId).section
      const categories = draft(cellId).fit.categories ?? []
      const now = TEMPLATES.filter((t) => t.section === section && t.fit.categories?.some((c) => categories.includes(c)) && !list.includes(`${t.id}|${commonId}`))
      expect(now.length, cellId).toBeGreaterThan(0)
      for (const t of now) expect(screenKey(t.flow, t.slots), t.id).not.toBe(screenKey(common(commonId).flow, common(commonId).slots))
    }
  })
})

describe('screenKey', () => {
  const key = (nodes: FlowNode[]) => screenKey(nodes)
  const title = (over: Partial<Extract<FlowNode, { kind: 'text' }>> = {}): FlowNode => ({ kind: 'text', slot: 'h', token: 'H1', ...over })
  const small = (over: Partial<Extract<FlowNode, { kind: 'text' }>> = {}): FlowNode => ({ kind: 'text', slot: 's', token: 'BODY', ...over })
  const photo = (over: Partial<Extract<FlowNode, { kind: 'image' }>> = {}): FlowNode => ({ kind: 'image', slot: 'p', ...over })
  const row = (...columns: Array<[number, FlowNode[]]>): FlowNode => ({ kind: 'row', columns: columns.map(([w, nodes]) => ({ w, nodes })) })

  it.each<[string, FlowNode[], FlowNode[]]>([
    ['글 정렬', [title(), photo()], [title({ align: 'center' }), photo()]],
    ['제목 단계', [title(), photo()], [title({ token: 'H2' }), photo()]],
    ['제목 아래 작은 글', [title(), small(), photo()], [title(), photo()]],
    ['사진 있는 칸의 끝 작은 글', [title(), photo(), small()], [title(), photo()]],
    ['사진 있는 칸의 태그', [title(), photo(), { kind: 'tags', slot: 't' }], [title(), photo()]],
    ['사진 있는 칸의 구분선', [title(), { kind: 'divider' }, photo()], [title(), photo()]],
    ['이름표 캡슐', [{ kind: 'capsule', label: 'POINT' }, title(), photo()], [title(), photo()]],
    ['고정 이름표', [{ kind: 'label', label: '우리 제품' }, title(), photo()], [title(), photo()]],
    ['글 앞 표시', [{ kind: 'mark', value: 'check' }, title(), photo()], [title(), photo()]],
    ['글만 든 가로 칸(POINT 머리)', [row([150, [title({ token: 'DISPLAY' })]], [580, [title()]]), photo()], [title(), photo()]],
    ['좌우 반전', [row([440, [photo()]], [276, [title()]])], [row([276, [title()]], [440, [photo()]])]],
    ['같은 구간의 칸 폭', [row([440, [photo()]], [276, [title()]])], [row([420, [photo()]], [296, [title()]])]],
    ['사진 밑 작은 글', [row([358, [photo(), small()]], [358, [photo(), small()]])], [row([358, [photo()]], [358, [photo()]])]],
    ['같은 폭 같은 내용의 가로 칸과 반복', [row([358, [photo()]], [358, [photo()]])], [{ kind: 'repeat', slot: 'l', columns: 2, nodes: [photo()] }]],
    ['같은 폭 3칸과 3열 반복', [row([230, [photo()]], [230, [photo()]], [230, [photo()]])], [{ kind: 'repeat', slot: 'l', columns: 3, nodes: [photo()] }]],
    ['반복 구분선', [{ kind: 'repeat', slot: 'l', rule: true, nodes: [small()] }, photo()], [{ kind: 'repeat', slot: 'l', nodes: [small()] }, photo()]],
    ['반복 화살표', [{ kind: 'repeat', slot: 'l', connector: 'arrow', nodes: [small()] }, photo()], [{ kind: 'repeat', slot: 'l', nodes: [small()] }, photo()]],
    ['사진 위 글 색·내용', [photo({ bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] } })], [photo({ bleed: true, overlay: { anchor: 'top', ink: 'dark', nodes: [{ kind: 'text', slot: 'h', token: 'H1' }] } })]],
    ['어긋난 쪽', [photo({ x: 60, w: 600 })], [photo({ x: 200, w: 600 })]],
    ['판 안 여백', [{ kind: 'panel', fill: 'T', x: 60, w: 600, nodes: [title()] }], [{ kind: 'panel', fill: 'T', nodes: [title()] }]],
  ])('%s은 화면 단계에서 같다', (_name, a, b) => {
    expect(key(a)).toBe(key(b))
  })

  it.each<[string, FlowNode[], FlowNode[]]>([
    ['풀폭 사진', [title(), photo({ bleed: true })], [title(), photo()]],
    ['사진 위 글 있음', [photo({ bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] } })], [photo({ bleed: true })]],
    ['사진 위 글 위치', [photo({ bleed: true, overlay: { anchor: 'top', ink: 'light', nodes: [] } })], [photo({ bleed: true, overlay: { anchor: 'bottom', ink: 'light', nodes: [] } })]],
    ['어긋난 판', [title(), photo({ plate: { dx: -48, dy: 48 } })], [title(), photo()]],
    ['어긋난 사진', [title(), photo({ x: 120, w: 620 })], [title(), photo()]],
    ['글과 사진 순서', [title(), photo()], [photo(), title()]],
    ['칸 폭 구간', [row([358, [photo()]], [358, [title()]])], [row([440, [photo()]], [276, [title()]])]],
    ['넓은·좁은 사진 짝과 같은 폭 짝', [row([440, [photo()]], [276, [photo()]])], [row([358, [photo()]], [358, [photo()]])]],
    ['같은 폭이라도 내용이 다른 칸과 반복', [row([358, [photo()]], [358, [title()]])], [{ kind: 'repeat', slot: 'l', columns: 2, nodes: [photo()] }]],
    ['칸 수', [row([358, [photo()]], [358, [photo()]])], [row([230, [photo()]], [230, [photo()]], [230, [photo()]])]],
    ['칸 안 제목', [row([358, [photo()]], [358, [title()]])], [row([358, [photo()]], [358, [small()]])]],
    ['반복 열', [{ kind: 'repeat', slot: 'l', columns: 2, nodes: [photo()] }], [{ kind: 'repeat', slot: 'l', columns: 3, nodes: [photo()] }]],
    ['반복 내용', [{ kind: 'repeat', slot: 'l', nodes: [photo()] }, photo()], [{ kind: 'repeat', slot: 'l', nodes: [small()] }, photo()]],
    ['판 색', [{ kind: 'panel', fill: 'T', nodes: [title()] }], [{ kind: 'panel', fill: 'N', nodes: [title()] }]],
    ['판 풀폭', [{ kind: 'panel', fill: 'T', nodes: [title()] }], [{ kind: 'panel', fill: 'T', bleed: true, nodes: [title()] }]],
    ['판 안 제목', [{ kind: 'panel', fill: 'T', nodes: [title()] }, photo()], [{ kind: 'panel', fill: 'T', nodes: [small()] }, photo()]],
    ['글만 있는 칸의 제목', [small()], [title()]],
    ['글만 있는 칸의 태그', [title(), { kind: 'tags', slot: 't' }], [title()]],
    ['글만 있는 칸의 구분선', [title(), { kind: 'divider' }, small()], [title(), small()]],
    ['글만 있는 칸의 끝 작은 글 사이 표', [title(), { kind: 'rating', slot: 'r' }, small()], [title(), { kind: 'rating', slot: 'r' }]],
    ['사진 사이 작은 글을 뺀 사진 수', [photo({ bleed: true }), small(), photo({ bleed: true })], [photo({ bleed: true })]],
    // 원·아치 틀(K-FRAME.md) — 사각 사진과 화면이 다르다
    ['원 틀', [title(), photo({ frame: 'circle' })], [title(), photo()]],
    ['아치 틀', [title(), photo({ frame: 'arch' })], [title(), photo()]],
    ['원과 아치', [title(), photo({ frame: 'circle' })], [title(), photo({ frame: 'arch' })]],
    ['어긋난 아치', [title(), photo({ x: 210, w: 440, frame: 'arch' })], [title(), photo({ x: 210, w: 440 })]],
    ['판 위 원', [title(), photo({ plate: { dx: -48, dy: 48 }, frame: 'circle' })], [title(), photo({ plate: { dx: -48, dy: 48 } })]],
    ['반복 안 아치', [title(), { kind: 'repeat', slot: 'l', columns: 2, nodes: [photo({ frame: 'arch' })] }], [title(), { kind: 'repeat', slot: 'l', columns: 2, nodes: [photo()] }]],
  ])('%s이 다르면 화면도 다르다', (_name, a, b) => {
    expect(key(a)).not.toBe(key(b))
  })

  it('둥근 모서리(decor)·직각(plain) 틀은 사각이라 틀 없는 사진과 같다', () => {
    expect(key([title(), photo({ frame: 'decor' })])).toBe(key([title(), photo()]))
    expect(key([title(), photo({ frame: 'plain' })])).toBe(key([title(), photo()]))
    expect(key([title(), photo({ x: 210, w: 440, frame: 'arch' })])).toBe('H,photo:offset:arch')
  })

  it('사각 2장 카테고리 칸은 공용 sub_div.arch-pair(아치 2장)와 화면 단계가 같다고 막히지 않는다(K-FRAME.md 뒤에 칸을 짤 때)', () => {
    const archPair = common('sub_div.arch-pair')
    expect(screenKey(archPair.flow, archPair.slots)).toBe('H,list2(photo:arch)')
    const square = JSON.parse(JSON.stringify(archPair).replace(/"frame":"arch",?/g, '')) as Template
    const cell: Template = { ...square, id: 'sub_div.living-square-pair', fit: { ...square.fit, categories: ['living'] } }
    expect(screenKey(cell.flow, cell.slots)).toBe('H,list2(photo)')
    const details = lintCategoryTemplates([archPair, cell], []).map((v) => v.detail)
    expect(details.some((d) => d.includes('화면 단계가 같음'))).toBe(false)
  })

  it.each(['HOOK', 'H1', 'H2', 'H3', 'DISPLAY'] as const)('%s는 제목 블록이다', (token) => {
    expect(key([small({ token })])).toBe('H')
  })

  it.each(['BODY', 'BODY_BOLD', 'LABEL', 'CAPTION'] as const)('%s는 작은 글 블록이다', (token) => {
    expect(key([small({ token })])).toBe('s')
  })

  it('이웃 글은 한 블록이고 사이에 다른 것이 있으면 나뉜다', () => {
    expect(key([title(), small(), small()])).toBe('H')
    expect(key([small(), small()])).toBe('s')
    expect(key([title(), photo(), title()])).toBe('H,photo,H')
    expect(key([title(), { kind: 'divider' }, title(), photo()])).toBe('H,photo')
  })

  it('사진이 판·반복·가로 칸 안에 있어도 사진 있는 칸이다', () => {
    expect(key([small(), { kind: 'panel', fill: 'T', nodes: [photo()] }])).toBe('panel:T(photo)')
    expect(key([small(), { kind: 'repeat', slot: 'l', nodes: [photo()] }])).toBe('list1(photo)')
    expect(key([small(), row([358, [photo()]], [358, [small()]])])).toBe('row@0.5(photo|s)')
    expect(key([small(), { kind: 'dimension', slot: 'd', widthSlot: 'w', heightSlot: 'h' }])).toBe('dimension')
  })

  describe('격자 줄 수', () => {
    const grid = (columns: 1 | 2 | 3): FlowNode => ({ kind: 'repeat', slot: 'l', columns, nodes: [photo()] })
    const items = (min: number, max: number) => ({ l: { type: 'list', required: true, min, max, fields: {} } }) as Template['slots']
    const pair = row([358, [photo()]], [358, [photo()]])

    it('항상 여러 줄이면 격자이고 같은 폭 2장과 다르다', () => {
      expect(screenKey([grid(2)], items(4, 4))).toBe('grid2x2(photo)')
      expect(screenKey([grid(2)], items(5, 6))).toBe('grid2x3(photo)')
      expect(screenKey([grid(3)], items(6, 6))).toBe('grid3x2(photo)')
      expect(screenKey([grid(2)], items(4, 4))).not.toBe(screenKey([pair]))
    })

    it('한 줄이 될 수 있으면 같은 폭 가로 칸과 같다 — 항목이 적은 상품에서 같은 화면이다', () => {
      expect(screenKey([grid(2)], items(2, 2))).toBe(screenKey([pair]))
      expect(screenKey([grid(2)], items(2, 4))).toBe(screenKey([pair]))
      expect(screenKey([grid(3)], items(3, 6))).toBe('list3(photo)')
    })

    it('1열 반복은 항목이 많아도 줄 목록이다', () => {
      expect(screenKey([grid(1)], items(4, 4))).toBe('list1(photo)')
    })

    it('사진 한 칸짜리 슬롯 이름이 겹쳐도 목록이 아니면 줄을 안 센다', () => {
      expect(screenKey([grid(2)], { l: { type: 'image', required: true, purpose: [], composition: [], aspect: [], minHeight: 0 } })).toBe('list2(photo)')
    })

    it('실제 공용: 4칸 격자와 같은 폭 2장은 다르고, 같은 4칸 격자끼리는 같다', () => {
      const of = (id: string) => screenKey(common(id).flow, common(id).slots)
      expect(of('product_exposure.four-sides')).toBe('grid2x2(photo)')
      expect(of('product_exposure.four-sides')).not.toBe(of('product_exposure.beauty-scale-detail'))
    })
  })

  it('작은 글만 있어 다 빠지는 곳은 비우지 않는다', () => {
    expect(key([{ kind: 'panel', fill: 'T', nodes: [small()] }, photo()])).toBe('panel:T(s),photo')
    expect(key([{ kind: 'repeat', slot: 'l', nodes: [small()] }, photo()])).toBe('list1(s),photo')
  })
})

describe('screenDuplicates·screenOrderPairs', () => {
  const base = common('petit_div.top-center')
  const cellOf = (id: string, flow: FlowNode[], section = base.section): Template =>
    ({ ...base, id, section, preview: `mock/${id}.html`, fit: { ...base.fit, categories: ['fashion'] }, flow }) as Template
  const bleed: FlowNode = { kind: 'image', slot: 'photo', bleed: true, gapAfter: 'photoGap' }
  const line: FlowNode = { kind: 'text', slot: 'line', token: 'H2' }

  it('같은 섹션 공용과 키가 같으면 짝을 낸다', () => {
    const cell = cellOf('petit_div.x', [bleed, line])
    expect(screenDuplicates([base, cell])).toEqual([{ cell: cell.id, common: base.id, section: base.section, key: 'photo:bleed,H' }])
  })

  it('다른 섹션 공용과 키가 같은 것은 내지 않는다', () => {
    const elsewhere = { ...base, id: 'key_message.base', section: 'key_message' } as Template
    expect(screenDuplicates([elsewhere, cellOf('petit_div.x', [bleed, line])])).toEqual([])
  })

  it('공용끼리와 칸끼리는 내지 않는다', () => {
    const twin = { ...base, id: 'petit_div.twin' } as Template
    expect(screenDuplicates([base, twin])).toEqual([])
    expect(screenDuplicates([cellOf('petit_div.a', [bleed, line]), cellOf('petit_div.b', [bleed, line])])).toEqual([])
  })

  it('순서만 다른 짝은 따로 내고 같은 키 짝에는 넣지 않는다', () => {
    const flipped = cellOf('petit_div.flip', [line, bleed])
    expect(screenDuplicates([base, flipped])).toEqual([])
    expect(screenOrderPairs([base, flipped])).toEqual([{ cell: flipped.id, common: base.id, section: base.section, key: 'H,photo:bleed' }])
    expect(screenOrderPairs([base, cellOf('petit_div.same', [bleed, line])])).toEqual([])
  })

  it('순서만 다른 짝은 위반이 아니다', () => {
    expect(lintCategoryTemplates([base, cellOf('petit_div.flip', [line, bleed])], [])).toEqual([])
  })
})

describe('알려진 목록', () => {
  const base = common('petit_div.top-center')
  const cellOf = (id: string, flow: FlowNode[]): Template =>
    ({ ...base, id, preview: `mock/${id}.html`, fit: { ...base.fit, categories: ['fashion'] }, flow, slots: { ...base.slots, photo: imageSlot({ required: true, purpose: ['scale'] }) } }) as Template
  const same = cellOf('petit_div.x', [{ kind: 'image', slot: 'photo', bleed: true }, { kind: 'text', slot: 'line', token: 'H3' }])
  const other = cellOf('petit_div.y', [{ kind: 'image', slot: 'photo' }, { kind: 'text', slot: 'line', token: 'H3' }])

  it('목록에 없으면 위반, 있으면 통과', () => {
    expect(lintCategoryTemplates([base, same], []).map((v) => v.template)).toEqual([same.id])
    expect(lintCategoryTemplates([base, same], [`${same.id}|${base.id}`])).toEqual([])
  })

  it('목록의 다른 짝은 이 짝을 풀어 주지 않는다', () => {
    expect(lintCategoryTemplates([base, same], [`${same.id}|petit_div.none`])).toHaveLength(1)
  })

  it('더 안 걸리는 항목은 실패한다 — 고치면 목록이 줄어든다', () => {
    const violations = lintCategoryTemplates([base, other], [`${other.id}|${base.id}`])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ template: other.id, rule: 'category' })
    expect(violations[0].detail).toContain('알려진 목록')
    expect(violations[0].detail).toContain(base.id)
  })

  it('일부 템플릿만 넣은 검사에서 빠진 짝은 묻지 않는다', () => {
    expect(lintCategoryTemplates([base], [`petit_div.x|${base.id}`])).toEqual([])
    expect(lintCategoryTemplates([other], [`${other.id}|${base.id}`])).toEqual([])
  })

  it('라이브러리의 목록은 있는 칸과 공용만 적고, 정렬돼 있고, 겹치지 않는다', () => {
    const list = knownList as string[]
    expect(new Set(list).size).toBe(list.length)
    expect([...list].sort()).toEqual(list)
    for (const entry of list) {
      const [cellId, commonId] = entry.split('|')
      expect(templateById(cellId)?.fit.categories?.length ?? 0, entry).toBeGreaterThan(0)
      expect(templateById(commonId)?.fit.categories ?? [], entry).toEqual([])
    }
  })

  it('라이브러리 전체에서 걸린 짝과 목록이 정확히 같다', () => {
    expect(screenDuplicates(TEMPLATES).map((p) => `${p.cell}|${p.common}`).sort()).toEqual(knownList)
  })
})
