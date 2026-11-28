/**
 * K 컷 거리·높이·사람 박자(shotvary, 세션 B variety F1~F4) — 순수 배정 규칙, 문장, 고정 줄 빼기. 모델 호출 0
 */

import { describe, expect, it } from 'vitest'
import { buildImagePrompts } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { findLineCompositionTwin, isCompositionCut, isLineCompositionCut } from '../shot-composition'
import { buildShotBrief, isHandsOnly, shotRouteOf, type LineShot } from './shot-brief'
import {
  assignShotVariety,
  CTA_FRAMINGS,
  FIRST_ANGLE_TEXT,
  isBodyCut,
  TURN_KEEP,
  turnPhrase,
  VARY_LIGHT_TEXT,
  VARY_PRODUCT_EXCLUDED,
  VARY_REFERENCE_TEXT,
  varyReferenceText,
  varyRefsOf,
  HERO_PERSON,
  isPersonCut,
  personLine,
  SAME_CAMERA_MAX,
  SAME_FACE_MAX,
  SMILE_MAX,
  shotvaryEnabled,
  visibleFaceMax,
  WIDE_PRODUCT_FLOOR,
  withoutFixedScene,
  type ShotPerson,
} from './shot-variety'

type Shot = { purpose: string; composition: string; section?: string; sizeCut?: true; stage?: { name: string } }

/** 한 쪽 컷 — K 탐침(484쪽)에서 많이 나온 짝을 섞었다(사람 컷 7장 안팎) */
const PAGE: Shot[] = [
  { purpose: 'scene', composition: 'in_use', stage: { name: 'place' } },
  { purpose: 'feature_proof', composition: 'angle45', stage: { name: 'showroom' } },
  { purpose: 'scene', composition: 'in_use', stage: { name: 'place' } },
  { purpose: 'state', composition: 'closeup', stage: { name: 'life' } },
  { purpose: 'action', composition: 'in_hand', stage: { name: 'life' } },
  { purpose: 'scale', composition: 'in_use', stage: { name: 'life' } },
  { purpose: 'texture', composition: 'closeup', stage: { name: 'macro' } },
  { purpose: 'scene', composition: 'worn', stage: { name: 'place' } },
  { purpose: 'problem', composition: 'in_use', stage: { name: 'place' } },
  { purpose: 'state', composition: 'in_use', stage: { name: 'life' } },
  { purpose: 'hero', composition: 'front', stage: { name: 'showroom' } },
  { purpose: 'scene', composition: 'in_use', stage: { name: 'place' } },
  { purpose: 'scale', composition: 'front', stage: { name: 'life' } },
  { purpose: 'scene', composition: 'angle45', stage: { name: 'place' } },
  { purpose: 'state', composition: 'in_use', stage: { name: 'life' } },
  { purpose: 'feature_proof', composition: 'top', stage: { name: 'showroom' } },
  { purpose: 'color', composition: 'group', stage: { name: 'showroom' } },
  { purpose: 'quantity', composition: 'flatlay', stage: { name: 'showroom' } },
  { purpose: 'hero', composition: 'side', stage: { name: 'showroom' } },
  { purpose: 'hero', composition: 'front', sizeCut: true, stage: { name: 'showroom' } },
]
const SEEDS = ['c651d0f5-e07c-4d96-998e-34fd8ac8161d', 'eafbe6a3-4d9d-4131-a360-821c641ef189', 'db897d49-eeec-4a9c-8294-67b0f5fed14e', 'job-1', 'job-2', 'job-3']

const people = (out: ReturnType<typeof assignShotVariety>) => out.flatMap((v) => (v.person ? [v.person] : []))
const count = (list: readonly ShotPerson[], test: (p: ShotPerson) => boolean) => list.filter(test).length

describe('K 컷 거리·높이(F1)', () => {
  it.each(SEEDS)('이웃 컷끼리 같은 (거리, 높이)가 없고 한 쌍은 한 쪽에 상한까지다 — seed %s', (seed) => {
    const out = assignShotVariety(PAGE, { pet: false, seed })
    const cams = out.flatMap((v) => (v.camera ? [`${v.camera.distance}|${v.camera.height}`] : []))
    cams.forEach((cam, i) => i > 0 && expect(cam, `${i}`).not.toBe(cams[i - 1]))
    for (const cam of new Set(cams)) expect(cams.filter((c) => c === cam).length, cam).toBeLessThanOrEqual(SAME_CAMERA_MAX)
    expect(new Set(cams).size).toBeGreaterThan(6)
  })

  it('구도가 정한 축은 지킨다 — 바로 위·탁자 높이·눈높이, 근접 무대는 근접·매크로, 치수 칸 컷은 비운다', () => {
    for (const seed of SEEDS) {
      const out = assignShotVariety(PAGE, { pet: false, seed })
      PAGE.forEach((shot, at) => {
        const camera = out[at].camera
        if (shot.sizeCut) return expect(out[at], `${at}`).toEqual({})
        if (shot.composition === 'top' || shot.composition === 'flatlay') expect(camera?.height).toBe('overhead')
        if (shot.composition === 'side') expect(camera?.height).toBe('table')
        if (shot.composition === 'front') expect(camera?.height).toBe('eye_level')
        if (shot.stage?.name === 'macro') expect(['close', 'macro']).toContain(camera?.distance)
      })
    }
  })

  it('같은 입력이면 같은 값이다(seed = 잡 ID)', () => {
    expect(assignShotVariety(PAGE, { pet: true, seed: 'job-1' })).toEqual(assignShotVariety(PAGE, { pet: true, seed: 'job-1' }))
  })
})

describe('K 사람 박자(F1)', () => {
  it('얼굴이 나올 수 있는 컷과 몸을 부르는 구도(손에 든·쓰는·착용) 컷이 박자를 받는다 — 손만 경로는 손만·얼굴 없음, 고민 컷은 받지 않는다', () => {
    const out = assignShotVariety(PAGE, { pet: false, seed: 'job-1' })
    PAGE.forEach((shot, at) => {
      const usageFace = shotRouteOf(shot.purpose).base === 'usage' && !isHandsOnly(shot)
      expect(isPersonCut(shot), `${shot.purpose}|${shot.composition}`).toBe(usageFace)
      const body = shot.purpose !== 'problem' && (usageFace || ['in_hand', 'in_use', 'worn'].includes(shot.composition))
      expect(isBodyCut(shot), `${shot.purpose}|${shot.composition}`).toBe(body)
      expect(Boolean(out[at].person), `${at}`).toBe(body && !shot.sizeCut)
      if (out[at].person && isHandsOnly(shot)) expect(out[at].person, `${at}`).toMatchObject({ framing: 'hands', face: 'none' })
    })
  })

  it.each(SEEDS)('이웃 같은 몸 범위가 없고, 같은 얼굴·웃는 얼굴·얼굴 보이는 컷이 상한 안이다 — seed %s', (seed) => {
    const out = assignShotVariety(PAGE, { pet: false, seed })
    const list = people(out)
    expect(list.length).toBeGreaterThan(5)
    // 이웃 같은 몸 범위 금지는 몸 범위를 고르는 컷(손만 경로가 아닌 컷)에 걸린다
    const chosen = PAGE.flatMap((shot, at) => (out[at].person ? [{ free: !isHandsOnly(shot), person: out[at].person! }] : []))
    chosen.forEach((c, i) => i > 0 && c.free && expect(c.person.framing, `${i}`).not.toBe(chosen[i - 1].person.framing))
    for (const face of ['focused', 'soft_smile', 'laugh', 'glance_away'] as const) expect(count(list, (p) => p.face === face), face).toBeLessThanOrEqual(SAME_FACE_MAX)
    expect(count(list, (p) => p.face === 'soft_smile' || p.face === 'laugh')).toBeLessThanOrEqual(SMILE_MAX)
    expect(count(list, (p) => p.face !== 'none')).toBeLessThanOrEqual(visibleFaceMax(chosen.filter((c) => c.free).length))
    expect(count(list, (p) => p.face !== 'none')).toBeGreaterThan(0)
    // 얼굴은 얼굴이 보이는 몸 범위에만
    for (const p of list) if (['over_shoulder', 'back', 'hands', 'nobody'].includes(p.framing)) expect(p.face).toBe('none')
    // 동작 단계가 한 가지가 아니다
    expect(new Set(list.map((p) => p.beat)).size).toBeGreaterThan(1)
  })

  it('반려 잡은 사람 없이 반려동물과 상품만 나오는 컷을 한 장 이상 둔다', () => {
    for (const seed of SEEDS) expect(people(assignShotVariety(PAGE, { pet: true, seed })).some((p) => p.framing === 'nobody'), seed).toBe(true)
  })

  it('사람 컷이 하나뿐이어도 얼굴 한 장은 남긴다', () => {
    const list = people(assignShotVariety([{ purpose: 'scene', composition: 'in_use' }], { pet: false, seed: 'job-1' }))
    expect(list).toHaveLength(1)
    expect(visibleFaceMax(1)).toBe(1)
  })
})

describe('Person 줄·고정 줄 빼기(F2·F3)', () => {
  it('Person 줄은 같은 사람을 묶고 이 컷의 몸 범위·단계·얼굴을 말한다. 사람 없는 컷은 반려 잡이면 같은 반려동물만', () => {
    const line = personLine({ framing: 'waist_up', beat: 'after', face: 'glance_away' }, false)
    expect(line).toContain('the same one person as the other cuts of this page')
    expect(line).toContain('from the waist up')
    expect(line).toContain('just after use')
    expect(line).toContain('look away from the product')
    expect(personLine({ framing: 'back', beat: 'during', face: 'none' }, false)).toContain('the face out of frame')
    expect(personLine({ framing: 'hands', beat: 'before', face: 'none' }, false)).toContain('no face or head in the frame')
    expect(personLine({ framing: 'nobody', beat: 'after', face: 'none' }, true)).toContain('only the same pet as the other cuts')
    expect(personLine({ framing: 'nobody', beat: 'after', face: 'none' }, false)).toContain('the product on its own')
  })

  it.each(['pet', 'household', 'beauty'])('%s 사용 기본 프롬프트에서 장면·장소·표정·렌즈·상호작용 줄만 빠지고 품질 규칙 묶음은 남는다', (category) => {
    const usage = buildImagePrompts({ productName: '제품', designPalette: { bgMain: '#ffffff' }, category, textBearing: false }).usage.prompt
    expect(usage).toMatch(/^- Expression: /m)
    const out = withoutFixedScene(usage)
    for (const label of ['Scene', 'Environment', 'Expression', 'Lens']) expect(out, label).not.toMatch(new RegExp(`^- ${label}: `, 'm'))
    expect(out).not.toContain('Focus on the interaction moment')
    expect(out).toContain('Human Subject Quality Rules:')
    expect(out).toContain("Model's gaze directed at product or natural direction")
    // 지운 줄 밖은 그대로다
    expect(usage.split('\n').filter((line) => !/^- (Scene|Environment|Expression|Lens): |^- Focus on the interaction moment/.test(line))).toEqual(out.split('\n'))
  })

  it('컷 지시: 계획 칸이 없으면 지금 줄 그대로, 있으면 Camera 줄에 거리·높이, Person 줄, 넓은 컷은 상품 비중 하한(P09)', () => {
    const base: LineShot = { key: 'k3_photo_0', section: 'sub_div', purpose: 'scene', composition: 'in_use', aspect: '3:4', show: '' }
    const plain = buildShotBrief(base, { category: 'household' })
    expect(plain).toContain('Camera: used in its real place\n')
    expect(plain).not.toContain('Person:')
    expect(plain).not.toContain(WIDE_PRODUCT_FLOOR)
    // 칸만 비어 있는 값(undefined)은 바이트가 같다
    expect(buildShotBrief({ ...base, camera: undefined, person: undefined }, { category: 'household' })).toBe(plain)

    const varied = buildShotBrief({ ...base, camera: { distance: 'wide', height: 'standing' }, person: { framing: 'environment', beat: 'during', face: 'focused' } }, { category: 'household' })
    expect(varied).toContain('Camera: used in its real place — wide shot')
    expect(varied).toContain('camera at standing height looking slightly down')
    expect(varied).toMatch(/^Person: the same one person as the other cuts of this page/m)
    expect(varied).toContain(WIDE_PRODUCT_FLOOR)
    // Person 줄은 Camera 줄 바로 뒤, 다른 줄은 그대로다
    const lines = varied.split('\n')
    expect(lines[lines.findIndex((l) => l.startsWith('Camera:')) + 1]).toMatch(/^Person: /)
    expect(varied.split('\n').filter((l) => !l.startsWith('Camera:') && !l.startsWith('Person:') && !l.startsWith('Visible:'))).toEqual(plain.split('\n').filter((l) => !l.startsWith('Camera:') && !l.startsWith('Visible:')))

    const close = buildShotBrief({ ...base, camera: { distance: 'close', height: 'table' } }, { category: 'pet' })
    expect(close).not.toContain(WIDE_PRODUCT_FLOOR)
    expect(buildShotBrief({ ...base, person: { framing: 'nobody', beat: 'after', face: 'none' } }, { category: 'pet' })).toContain('only the same pet')
  })

  it('스위치는 templatelib과 함께 기록된 잡만 켜진다', () => {
    const job = (features: string[]) => ({ analysis: { enrichment: { version: 1, features } } }) as never
    expect(shotvaryEnabled(job(['templatelib', 'shotvary']))).toBe(true)
    expect(shotvaryEnabled(job(['shotvary']))).toBe(false)
    expect(shotvaryEnabled(job(['templatelib']))).toBe(false)
  })
})

describe('K 컷 구도 지문 기록(F5 — 기록만)', () => {
  const img = (section: string, dhash?: string, url = `https://cdn.test/${section}.png`) => ({ section, url, ...(dhash ? { dhash } : {}) })
  it('K 키만 받는다 — shotdiv 정규식은 그대로라 K 컷 재생성 대상이 늘지 않는다', () => {
    expect(isLineCompositionCut('k17_clip_0')).toBe(true)
    expect(isLineCompositionCut('k3_shots_photo_2')).toBe(true)
    for (const section of ['hero', 'features:1', 'long_scene:0', 'motion:0', 'plate:T3c']) expect(isLineCompositionCut(section), section).toBe(false)
    expect(isCompositionCut('k17_clip_0')).toBe(false)
  })

  it('대표 컷·다른 K 컷 가운데 가장 가까운 짝(문턱 안)을 고르고, D 컷·지문 없는 컷·자기 자신은 보지 않는다', () => {
    const a = '0000000000000000'
    const near = '0000000000000007' // 3비트 차
    const far = 'ffffffffffffffff'
    const images = [img('hero', near), img('features:0', a), img('k2_photo_0', far), img('k4_photo_0'), img('k5_photo_0', a, '')]
    expect(findLineCompositionTwin(img('k3_photo_0', a), images)).toEqual({ of: 'hero', distance: 3 })
    expect(findLineCompositionTwin(img('k3_photo_0', a), [img('k2_photo_0', far)])).toBeNull()
    expect(findLineCompositionTwin(img('k3_photo_0'), images)).toBeNull()
    expect(findLineCompositionTwin(img('features:2', a), images)).toBeNull()
    expect(findLineCompositionTwin(img('k3_photo_0', a), [img('k3_photo_0', a)])).toBeNull()
  })
})

describe('대표 컷 0번·마무리 사진(K6 P07 후속 — 웃는 얼굴 5장·마무리 사진 대표 컷 판박이)', () => {
  const smiles = (list: readonly ShotPerson[]) => count(list, (p) => p.face === 'soft_smile' || p.face === 'laugh')
  /** PAGE 끝에 마무리 사진(cta 섹션, 쓰는 장면) 한 장 */
  const CTA_PAGE: Shot[] = [...PAGE, { purpose: 'scene', composition: 'in_use', section: 'cta', stage: { name: 'place' } }]

  it.each(SEEDS)('사람 대표 컷(쓰는 장면·착용)은 0번으로 세어 웃는 얼굴·같은 얼굴·얼굴 보이는 컷 상한과 이웃 몸 범위에 들어간다 — seed %s', (seed) => {
    for (const heroKind of ['in_use', 'worn'] as const) {
      const hero = HERO_PERSON[heroKind]!
      const list = people(assignShotVariety(PAGE, { pet: false, seed, heroKind }))
      const all = [hero, ...list]
      expect(smiles(all), heroKind).toBeLessThanOrEqual(SMILE_MAX)
      expect(smiles(list), heroKind).toBeLessThanOrEqual(SMILE_MAX - 1)
      for (const face of ['focused', 'soft_smile', 'laugh', 'glance_away'] as const) expect(count(all, (p) => p.face === face), `${heroKind} ${face}`).toBeLessThanOrEqual(SAME_FACE_MAX)
      expect(count(all, (p) => p.face !== 'none'), heroKind).toBeLessThanOrEqual(visibleFaceMax(all.length))
      expect(list[0].framing, heroKind).not.toBe(hero.framing)
      // 대표 컷 몫은 기록에 남지 않는다(K 컷 수만큼만)
      expect(list.length, heroKind).toBe(people(assignShotVariety(PAGE, { pet: false, seed })).length)
    }
  })

  it('사람 없는 대표 컷(studio)·유형 없음은 지금 계획 그대로다 — 마무리 사진도 제한하지 않는다', () => {
    for (const seed of SEEDS) {
      for (const pet of [false, true]) {
        expect(assignShotVariety(PAGE, { pet, seed, heroKind: 'studio' }), `${seed} ${pet}`).toEqual(assignShotVariety(PAGE, { pet, seed }))
        const plain = CTA_PAGE.map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => key !== 'section')) as Shot)
        expect(assignShotVariety(CTA_PAGE, { pet, seed }), `${seed} ${pet}`).toEqual(assignShotVariety(plain, { pet, seed }))
        expect(assignShotVariety(CTA_PAGE, { pet, seed, heroKind: 'studio' }), `${seed} ${pet}`).toEqual(assignShotVariety(plain, { pet, seed }))
      }
    }
  })

  it.each(SEEDS)('사람 대표 컷 잡의 마무리 사진(cta)은 얼굴 없는 몸 범위만 받는다 — seed %s', (seed) => {
    for (const pet of [false, true]) {
      for (const heroKind of ['in_use', 'worn'] as const) {
        const person = assignShotVariety(CTA_PAGE, { pet, seed, heroKind }).at(-1)?.person
        expect(person, `${heroKind} ${pet}`).toBeDefined()
        expect(CTA_FRAMINGS.has(person!.framing), `${heroKind} ${pet} ${person!.framing}`).toBe(true)
        expect(person!.face, `${heroKind} ${pet}`).toBe('none')
      }
    }
  })

  it('눈을 돌린 얼굴(glance_away)도 웃지 않는다고 말한다 — 웃는 얼굴 상한 밖 미소를 막는다', () => {
    expect(personLine({ framing: 'waist_up', beat: 'during', face: 'glance_away' }, false)).toContain('no smile')
    expect(personLine({ framing: 'profile', beat: 'after', face: 'focused' }, false)).toContain('no smile')
    expect(personLine({ framing: 'waist_up', beat: 'during', face: 'soft_smile' }, false)).not.toContain('no smile')
  })
})

describe('운영 P08 후속 — 사람 계획 넓히기(①)·상품 보이는 쪽(②)', () => {
  it.each(SEEDS)('손에 든 구도 컷은 목적과 상관없이 손만·얼굴 없음, 쓰는 구도의 증명 컷은 몸 범위를 받고 얼굴 상한에 든다 — seed %s', (seed) => {
    const shots: Shot[] = [
      { purpose: 'scale', composition: 'in_hand' },
      { purpose: 'feature_proof', composition: 'in_hand' },
      { purpose: 'feature_proof', composition: 'in_use' },
      { purpose: 'action', composition: 'in_use' },
      { purpose: 'scene', composition: 'in_use' },
    ]
    const out = assignShotVariety(shots, { pet: false, seed, heroKind: 'in_use' })
    for (const at of [0, 1, 3]) expect(out[at].person, `${at}`).toMatchObject({ framing: 'hands', face: 'none' })
    expect(out[2].person, 'feature_proof·in_use').toBeDefined()
    expect(out[4].person, 'scene·in_use').toBeDefined()
    const all = [HERO_PERSON.in_use!, out[2].person!, out[4].person!]
    expect(count(all, (p) => p.face === 'soft_smile' || p.face === 'laugh')).toBeLessThanOrEqual(SMILE_MAX)
    expect(count(all, (p) => p.face !== 'none')).toBeLessThanOrEqual(visibleFaceMax(all.length))
  })

  it.each(SEEDS)('사람이 안 나오는 상품 컷은 보이는 쪽을 받고 이웃끼리 다르다 — 원천 1장이면 옆·위·기울기만, 2장 이상이면 반대쪽도, 밑면 목적은 뒤집기 — seed %s', (seed) => {
    const one = assignShotVariety(PAGE, { pet: false, seed })
    const turned = one.flatMap((v) => (v.turn ? [v.turn] : []))
    expect(turned.length).toBeGreaterThan(4)
    turned.forEach((t, i) => i > 0 && expect(t, `${i}`).not.toBe(turned[i - 1]))
    for (const t of turned) expect(['side', 'top', 'tilt'], t).toContain(t)
    PAGE.forEach((shot, at) => {
      const person = one[at].person
      const productOnly = !shot.sizeCut && shot.purpose !== 'problem' && (!person || person.framing === 'nobody')
      expect(Boolean(one[at].turn), `${at} ${shot.purpose}|${shot.composition}`).toBe(productOnly)
    })
    const many = assignShotVariety(PAGE, { pet: false, seed, sourcePhotos: 3 }).flatMap((v) => (v.turn ? [v.turn] : []))
    for (const t of many) expect(['side', 'top', 'tilt', 'back']).toContain(t)
    const under = assignShotVariety([...PAGE, { purpose: 'underside', composition: 'side' }], { pet: false, seed })
    expect(under.at(-1)?.turn).toBe('flip')
    expect(assignShotVariety(PAGE, { pet: false, seed })).toEqual(one)
  })

  it('보이는 쪽은 Camera 줄 끝에 붙고 구조는 첫 장 그대로라고 말한다 — 값이 없으면 지금 줄 그대로', () => {
    const base: LineShot = { key: 'k4_photo_0', section: 'point_div', purpose: 'feature_proof', composition: 'angle45', aspect: '3:4', show: '' }
    const withCamera = { ...base, camera: { distance: 'medium', height: 'table' } as const }
    const plain = buildShotBrief(withCamera, { category: 'household' })
    expect(plain).not.toContain(TURN_KEEP)
    const turned = buildShotBrief({ ...withCamera, turn: 'top' }, { category: 'household' })
    const camera = turned.split('\n').find((l) => l.startsWith('Camera:'))!
    expect(camera.endsWith(`; ${turnPhrase('top')}`)).toBe(true)
    expect(camera).toContain('laid down so its top surface faces the camera')
    expect(turned.split('\n').filter((l) => !l.startsWith('Camera:'))).toEqual(plain.split('\n').filter((l) => !l.startsWith('Camera:')))
    expect(buildShotBrief({ ...base, turn: undefined }, { category: 'household' })).toBe(buildShotBrief(base, { category: 'household' }))
  })

  it('맨 끝 참조 안내 — 사람이 보이는 Person 줄 컷만 사람·옷을 받고, 손만·반려만·사람 없는 컷은 빛·색만. 둘 다 첫 장 각도를 풀어 준다', () => {
    for (const framing of ['environment', 'waist_up', 'over_shoulder', 'profile', 'back'] as const) expect(varyRefsOf({ framing, beat: 'during', face: 'none' }), framing).toBe('person')
    for (const framing of ['hands', 'nobody'] as const) expect(varyRefsOf({ framing, beat: 'during', face: 'none' }), framing).toBe('light')
    expect(varyRefsOf(undefined)).toBe('light')
    expect(varyReferenceText('person')).toBe(`${FIRST_ANGLE_TEXT} ${VARY_REFERENCE_TEXT}`)
    expect(varyReferenceText('light')).toBe(`${FIRST_ANGLE_TEXT} ${VARY_LIGHT_TEXT}`)
    expect(VARY_LIGHT_TEXT).toContain('not at all when there is no Person line')
    // 착용 상품(K7 P09 스트랩) — 사람 컷도 상품은 맨 끝 그림(대표 컷)에서 받지 않는다. 'what they wear'로 상품까지 받게 하지 않는다
    expect(VARY_REFERENCE_TEXT).toContain(VARY_PRODUCT_EXCLUDED)
    expect(VARY_REFERENCE_TEXT).not.toContain('what they wear')
    expect(VARY_PRODUCT_EXCLUDED).toContain('even when the person wears or holds it')
    expect(VARY_PRODUCT_EXCLUDED).toContain('only from the FIRST attached image')
    expect(FIRST_ANGLE_TEXT).toContain('not the camera angle or which side faces the camera')
  })
})
