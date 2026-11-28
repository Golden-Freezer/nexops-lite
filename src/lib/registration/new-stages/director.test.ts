import { describe, expect, it } from 'vitest'
import {
  buildDirectorPrompt,
  checkDirectorPlan,
  directorInputOf,
  directorLineOf,
  directorShotsOf,
  parseDirectorPlan,
  runDirector,
  type DirectorPlan,
  type DirectorShot,
} from './director'
import { fakeDeps, TEST_OPTIONS, userText } from './new-stages.fixture'

const SHOTS: DirectorShot[] = [
  { key: 'k1_photo_0', section: 'main_cut', purpose: 'hero', composition: 'front', show: '엉킴 없는\n아침' },
  { key: 'k3_photo_0', section: 'point_div', purpose: 'detail', composition: 'macro', show: '' },
  { key: 'k5_photo_0', section: 'sub2_div_page', purpose: 'scene', composition: 'in use', show: '' },
]

const VALID: DirectorPlan = {
  light: 'Soft window light from the left, warm 4500K.',
  set: 'Pale oak table with a linen backdrop.',
  cuts: [
    { key: 'k1_photo_0', distance: 'mid', people: 'none', direction: 'Brush centered on the table.', exception: '' },
    { key: 'k3_photo_0', distance: 'close', people: 'hand', direction: 'Fingertip on the rounded bristles.', exception: '' },
    { key: 'k5_photo_0', distance: 'wide', people: 'person', direction: 'Woman brushing hair by a bright bathroom mirror.', exception: '실제 쓰는 곳(욕실)' },
  ],
  conflicts_removed: ['컷마다 다른 조명 색'],
}

describe('연출 감독 프롬프트·입력', () => {
  it('컷 목록을 key: 섹션 · 목적 · 구도 · 화면 글로 싣는다', () => {
    const prompt = buildDirectorPrompt({ spec: 'SPEC', card: '', charter: '{"style_charter":null}', shots: SHOTS })
    expect(prompt).toContain('### 식별 카드(상품 사진을 본 비전 모델의 설명)\n(없음)')
    expect(prompt).toContain('- k1_photo_0: main_cut · hero · front · 엉킴 없는 / 아침')
    expect(prompt).toContain('40단어 이하')
    // 고민 컷 규칙(J49 decide 24) — 상품·포장·인쇄 무늬를 소품으로 적지 않는다
    expect(prompt).toContain('- 목적이 problem인 컷은 이 상품을 쓰기 전의 고민 장면이다. 이 상품·그 포장·상품에 인쇄된 무늬를 소품이나 배경으로 적지 않는다')
  })

  it('K 계획 컷과 헌장·조명 값에서 입력을 만든다', () => {
    const shots = directorShotsOf({
      shots: [{ key: 'k1_photo_0', section: 'main_cut', purpose: 'hero', composition: 'front', aspect: '1:1', show: '글', camera: { distance: 'mid' } as never }],
    })
    expect(shots).toEqual([{ key: 'k1_photo_0', section: 'main_cut', purpose: 'hero', composition: 'front', show: '글' }])
    expect(directorShotsOf(undefined)).toEqual([])
    const input = directorInputOf(
      { spec_sheet: { productName: '두피 빗' } as never, design_prompts: { identity_card: 'black brush', style_charter: 'warm', lighting_params: { key: 'left' } } },
      shots,
    )
    expect(input.card).toBe('black brush')
    expect(JSON.parse(input.charter)).toEqual({ style_charter: 'warm', lighting_params: { key: 'left' } })
    expect(directorInputOf({ spec_sheet: {} as never, design_prompts: null }, shots).charter).toBe('{"style_charter":null,"lighting_params":null}')
  })
})

describe('parseDirectorPlan', () => {
  it('맞는 답을 그대로 읽는다', () => {
    expect(parseDirectorPlan(JSON.stringify(VALID))).toEqual(VALID)
  })

  it.each([
    [{ ...VALID, light: ' ' }, 'light'],
    [{ ...VALID, cuts: [{ ...VALID.cuts[0], distance: 'far' }] }, 'distance'],
    [{ ...VALID, cuts: [{ ...VALID.cuts[0], people: 'crowd' }] }, 'people'],
    [{ ...VALID, cuts: [{ ...VALID.cuts[0], direction: '' }] }, 'direction'],
    [{ ...VALID, conflicts_removed: [1] }, 'conflicts_removed[0]'],
  ])('형식 오류 %#', (value, path) => {
    expect(() => parseDirectorPlan(JSON.stringify(value))).toThrow(path)
  })
})

describe('checkDirectorPlan — 규칙 어긋남은 경고만', () => {
  it('규칙을 지킨 계획은 경고 0', () => {
    expect(checkDirectorPlan(VALID, SHOTS)).toEqual([])
  })

  it('모르는 키·빠진 컷·긴 지시·같은 거리/사람 4컷 연속을 경고한다', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ ...SHOTS[0], key }))
    const cut = (key: string) => ({ key, distance: 'close' as const, people: 'none' as const, direction: 'One line.', exception: '' })
    const plan: DirectorPlan = {
      ...VALID,
      cuts: [cut('a'), cut('b'), cut('c'), { ...cut('d'), direction: Array.from({ length: 41 }, () => 'word').join(' ') }, cut('zz')],
    }
    expect(checkDirectorPlan(plan, shots)).toEqual([
      '보낸 적 없는 컷 키 1개(zz)',
      '지시가 빠진 컷 1개(e)',
      '40단어 넘는 지시 1개(d)',
      '같은 거리 4컷 연속(규칙 3컷까지)',
      '같은 사람 유무 4컷 연속(규칙 3컷까지)',
    ])
  })
})

describe('directorLineOf — 컷 지시 뒤에 덧붙일 한 줄', () => {
  it('페이지 빛·세트와 컷 지시를 붙인다', () => {
    expect(directorLineOf(VALID, 'k1_photo_0')).toBe(
      'Art direction: Brush centered on the table. Light: Soft window light from the left, warm 4500K. Set: Pale oak table with a linen backdrop.',
    )
  })

  it('예외 컷은 컷 지시만, 지시가 없는 컷은 null(지금 지시 그대로)', () => {
    expect(directorLineOf(VALID, 'k5_photo_0')).toBe('Art direction: Woman brushing hair by a bright bathroom mirror.')
    expect(directorLineOf(VALID, 'hero')).toBeNull()
  })

  it('상품 없는 컷(lightSetOnly, J49)은 컷 지시 문장 없이 빛·세트만 — 예외 컷·지시 없는 컷은 null', () => {
    expect(directorLineOf(VALID, 'k1_photo_0', { lightSetOnly: true })).toBe(
      'Art direction: Light: Soft window light from the left, warm 4500K. Set: Pale oak table with a linen backdrop.',
    )
    expect(directorLineOf(VALID, 'k5_photo_0', { lightSetOnly: true })).toBeNull()
    expect(directorLineOf(VALID, 'hero', { lightSetOnly: true })).toBeNull()
    // 옵션이 없거나 꺼져 있으면 지금 그대로
    expect(directorLineOf(VALID, 'k1_photo_0', { lightSetOnly: false })).toBe(directorLineOf(VALID, 'k1_photo_0'))
  })
})

describe('runDirector', () => {
  it('route 이름 images/director로 부른다', async () => {
    const { deps, calls, routeNames } = fakeDeps({ text: JSON.stringify(VALID) })
    const record = await runDirector({ spec: 'S', card: 'C', charter: '{}', shots: SHOTS }, deps, TEST_OPTIONS)
    expect(routeNames).toEqual(['images/director'])
    expect(calls[0].request.agentName).toBe('registration/pdp-director')
    expect(userText(calls[0])).toContain('### 컷 목록')
    expect(record).toMatchObject({ stage: 'director', status: 'done', result: VALID, warnings: [] })
  })

  it('컷이 없으면 부르지 않고 no_input 생략', async () => {
    const { deps, calls } = fakeDeps({ text: JSON.stringify(VALID) })
    expect(await runDirector({ spec: 'S', card: '', charter: '{}', shots: [] }, deps, TEST_OPTIONS)).toMatchObject({ status: 'skipped', reason: 'no_input' })
    expect(calls).toHaveLength(0)
  })

  it('빈 답은 failed(empty)', async () => {
    const { deps } = fakeDeps({ text: '' })
    expect(await runDirector({ spec: 'S', card: '', charter: '{}', shots: SHOTS }, deps, TEST_OPTIONS)).toMatchObject({ status: 'failed', failure: { kind: 'empty' } })
  })
})
