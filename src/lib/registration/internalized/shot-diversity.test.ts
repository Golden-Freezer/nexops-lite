/**
 * 컷 목적 다양화(shotdiv) 순수 계획 — POINT 컷 목적(제목 먼저·한 번씩·앵글), 추가 컷(POINT가 안 쓴 목적·근거 있을 때만·키 번호),
 * 캡션 검사(붙어쓰기·목적 낱말), 프롬프트 블록. DB·생성 호출 없음.
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow } from '../pdp-state'
import {
  FILL_ANGLES,
  SHOT_ANGLES,
  applyShotPurpose,
  designcutDrawnKeys,
  planExtraShots,
  readExtraShots,
  shotPurposeContextOf,
  withAngleRetry,
} from './shot-diversity'
import { buildShotBrief, CONTACT_LINE, FAMILY_SHOT_FAMILIES, familyShotLine, sizeLine } from '../templatelib/shot-brief'
import { PRODUCT_FAMILIES } from '../templatelib/product-family'

const card = (title: string, description = '') => ({ title, description })
const point = (claim: string, benefit = '') => ({ claim, benefit })

function jobOf(
  cards: Array<{ title: string; description: string }>,
  spec: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): PdpJobRow {
  return {
    copy_sections: {
      final: {
        pointCards: cards,
        detailPoints: cards.map((c) => point(c.title, c.description)),
        usageSceneTags: ['여행 가방 정리', '욕실 소품 보관', '아이 간식 포장'],
        ...extra,
      },
    },
    spec_sheet: { productName: '테스트 파우치', ...spec },
    section_plan: { section_order: ['main_intro', 'point_div'] },
  } as unknown as PdpJobRow
}

const SIZE = { size: '16.5cm x 20.7cm(데이지 S)', material: 'PE' }

describe('planExtraShots — POINT 컷 목적', () => {
  it('주제가 구조·동작·소재·크기를 말하면 그 증명 목적을, 같은 목적은 한 번씩 준다', () => {
    const plan = planExtraShots(
      jobOf([card('바닥이 잡힌 입체'), card('끈만 당기면 닫혀요'), card('도톰한 소재'), card('넉넉한 크기')], SIZE),
      4
    )!
    expect(plan.points.map((p) => p.purpose)).toEqual(['underside', 'action', 'texture', 'scale'])
    expect(plan.points.map((p) => p.key)).toEqual(['features:0', 'features:1', 'features:2', 'features:3'])
  })

  it('맞는 목적이 없거나 이미 쓴 목적이면 서로 다른 앵글 — 제목 낱말이 설명 낱말보다 먼저 목적을 가진다', () => {
    const plan = planExtraShots(
      jobOf([card('튼튼해요', '바닥이 입체라 잘 서요'), card('바닥 걱정 없어요'), card('선물하기 좋아요'), card('오래 써요')], SIZE),
      4
    )!
    // 1번 제목이 밑면을 먼저 가져가고, 0번은 설명의 밑면이 이미 쓰여 앵글
    expect(plan.points.map((p) => p.purpose)).toEqual(['angle', 'underside', 'angle', 'angle'])
    expect(plan.points.filter((p) => p.purpose === 'angle').map((p) => p.angle)).toEqual([0, 1, 2])
  })

  it('제목이 장소·상황을 말하면 장면 컷이다 — 다른 낱말보다 먼저고, 장소가 달라 여러 번 나와도 된다', () => {
    const plan = planExtraShots(jobOf([card('욕실에도 두세요'), card('사무실 책상 위에서'), card('도톰한 소재'), card('오래 써요')], SIZE), 4)!
    expect(plan.points.map((p) => p.purpose)).toEqual(['scene', 'scene', 'texture', 'angle'])
    // 앵글 번호는 앵글 컷만 받는다
    expect(plan.points[3].angle).toBe(0)
  })

  it('장소 낱말이 설명에만 있으면 장면 컷으로 바꾸지 않는다 — 주제 글로만 남는다', () => {
    const plan = planExtraShots(jobOf([card('오래 써요', '욕실에서도 녹슬지 않아요'), card('선물'), card('디자인'), card('색감')], SIZE), 4)!
    expect(plan.points[0].purpose).toBe('angle')
    expect(plan.points[0].show).toContain('욕실')
  })

  it('장면 컷 제목은 캡션 검사에서 어긋나지 않는다', () => {
    const plan = planExtraShots(jobOf([card('욕실에도 두세요'), card('선물'), card('디자인'), card('색감')], SIZE), 4)!
    expect(plan.captions.mismatched).not.toContain('features:0')
  })

  it('사양에 크기가 없으면 크기 낱말이 있어도 크기 비교를 주지 않는다', () => {
    const plan = planExtraShots(jobOf([card('넉넉한 크기'), card('선물'), card('디자인'), card('색감')], { material: 'PE' }), 4)!
    expect(plan.points[0].purpose).toBe('angle')
    expect(plan.shots.some((s) => s.purpose === 'scale')).toBe(false)
  })
})

describe('planExtraShots — 길이 채움(D2, 오너 지시 11-01)', () => {
  // 제목에 목적 낱말이 없는 특징 6개 — POINT 컷이 앵글 0~3을 쓴다
  const CARDS = ['하나', '둘', '셋', '넷', '다섯', '여섯'].map((n) => card(`특징 ${n}`))
  const tagged = () => jobOf(CARDS, SIZE, { usageSceneTags: ['#캠핑', '#차박', '#피크닉'] })

  it('fill이 0이면 기본 계획과 같다', () => {
    const j = tagged()
    expect(planExtraShots(j, 6, { fill: 0 })).toEqual(planExtraShots(j, 6))
  })

  it('남은 사용 장면 태그와 앵글을 번갈아 더한다 — 첫 태그는 되풀이하지 않고, 번호·키가 겹치지 않는다', () => {
    const j = tagged()
    const base = planExtraShots(j, 6)!
    const filled = planExtraShots(j, 6, { fill: 4 })!
    const added = filled.shots.slice(base.shots.length)
    expect(added.map((s) => s.purpose)).toEqual(['scene', 'angle', 'scene', 'angle'])
    expect(added.filter((s) => s.purpose === 'scene').map((s) => [s.key, s.caption])).toEqual([
      ['long_scene:1', '차박'],
      ['long_scene:2', '피크닉'],
    ])
    const keys = filled.shots.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const shot of added.filter((s) => s.purpose === 'angle')) {
      expect(shot.key).toMatch(/^features:\d+$/)
      expect(shot.caption?.length).toBeGreaterThan(0)
    }
  })

  it('앵글은 새 앵글 먼저, POINT가 쓴 앵글은 다시 쓰지 않는다', () => {
    const j = tagged()
    const filled = planExtraShots(j, 6, { fill: 12 })!
    const pointAngles = filled.points.flatMap((p) => (p.purpose === 'angle' ? [p.angle] : []))
    expect(new Set(pointAngles)).toEqual(new Set([0, 1, 2, 3]))
    // 태그·앵글이 다 떨어지면 더 만들지 않는다 — 같은 컷을 늘리지 않는다
    expect(filled.shots.filter((s) => s.purpose === 'angle').map((s) => s.angle)).toEqual([4, 5, 6, 7])
    expect(filled.shots.filter((s) => s.purpose === 'scene').map((s) => s.caption)).toEqual(['캠핑', '차박', '피크닉'])
  })

  it('앵글 컷 프롬프트는 그 앵글을 지시한다 — 지어낸 부품을 막는 규칙은 그대로', () => {
    const j = tagged()
    const filled = planExtraShots(j, 6, { fill: 2 })!
    const angle = filled.shots.find((s) => s.purpose === 'angle')!
    const prompt = applyShotPurpose('base', angle.key, filled)
    expect(prompt).toContain(FILL_ANGLES[0])
    expect(prompt).toContain('never invent hidden parts')
  })

  it('캡션 검사는 앵글 컷을 짝 어긋남으로 세지 않는다', () => {
    const filled = planExtraShots(tagged(), 6, { fill: 6 })!
    const angleKeys = filled.shots.filter((s) => s.purpose === 'angle').map((s) => s.key)
    for (const key of angleKeys) expect(filled.captions.mismatched).not.toContain(key)
  })
})

describe('planExtraShots — 추가 컷(T10 구석구석 보면)', () => {
  it('실사용 → 디테일(질감) → 남은 증명(근거 있을 때만) 순 — 키는 POINT 다음 번호(4 이상), 실사용은 long_scene:0', () => {
    const plan = planExtraShots(
      jobOf([card('선물하기 좋아요'), card('깔끔한 디자인'), card('어디든 어울려요'), card('오래 써요')], {
        ...SIZE,
        extraSpecs: [{ key: '바닥', value: '입체 바닥' }],
      }),
      4
    )!
    expect(plan.shots).toEqual([
      { key: 'long_scene:0', purpose: 'scene', proves: 'usageSceneTags', caption: '여행 가방 정리' },
      { key: 'features:4', purpose: 'texture', proves: 'spec.material', caption: '가까이 본 PE 소재' },
      { key: 'features:5', purpose: 'underside', proves: 'spec.extraSpecs[0]', caption: '밑면과 안쪽까지' },
      { key: 'features:6', purpose: 'scale', proves: 'spec.size', caption: '실제 크기 16.5cm x 20.7cm' },
    ])
    // POINT가 6장을 쓰면 6번부터
    const six = planExtraShots(
      jobOf(['가', '나', '다', '라', '마', '바'].map((t) => card(`${t} 디자인`)), { ...SIZE }),
      6
    )!
    expect(six.shots.filter((s) => s.key.startsWith('features:')).map((s) => s.key)).toEqual(['features:6', 'features:7'])
  })

  it('POINT가 질감·밑면을 다 쓰면 디테일은 질감을 한 번 더(유일한 예외) — 늘 2장 이상, 근거 없는 밑면은 만들지 않는다', () => {
    const covered = planExtraShots(
      jobOf([card('바닥이 잡힌 입체'), card('끈만 당기면 닫혀요'), card('도톰한 소재'), card('넉넉한 크기')], SIZE),
      4
    )!
    expect(covered.shots.map((s) => [s.purpose, s.proves])).toEqual([
      ['scene', 'usageSceneTags'],
      ['texture', 'spec.material'],
    ])
    // 근거가 하나도 없으면 디테일은 상품 표면 근접(proves detail) — 밑면·크기 컷은 없다
    const noProof = planExtraShots(jobOf([card('선물'), card('디자인'), card('색감'), card('포장')]), 4)!
    expect(noProof.shots.map((s) => [s.purpose, s.proves, s.caption])).toEqual([
      ['scene', 'usageSceneTags', '여행 가방 정리'],
      ['texture', 'detail', '가까이 본 소재'],
    ])
  })

  it('POINT가 질감만 썼고 밑면 근거가 있으면 디테일은 밑면', () => {
    const plan = planExtraShots(
      jobOf([card('도톰한 소재'), card('선물'), card('디자인'), card('색감')], { ...SIZE, extraSpecs: [{ key: '바닥', value: '입체' }] }),
      4
    )!
    expect(plan.shots.map((s) => [s.key, s.purpose])).toEqual([
      ['long_scene:0', 'scene'],
      ['features:4', 'underside'],
      ['features:5', 'scale'],
    ])
  })

  it('POINT 밖 detailPoints의 구조 주장이 밑면 컷의 근거가 된다', () => {
    const job = jobOf([card('선물'), card('디자인'), card('색감'), card('포장')])
    const final = job.copy_sections.final as unknown as { detailPoints: unknown[] }
    final.detailPoints = [...final.detailPoints, point('안쪽 이중 지퍼 포켓')]
    const plan = planExtraShots(job, 4)!
    expect(plan.shots.find((s) => s.purpose === 'underside')).toMatchObject({
      key: 'features:5',
      proves: 'detailPoints[4]',
      show: '안쪽 이중 지퍼 포켓',
    })
  })

  it('POINT 컷마다 그 컷 주제 글(제목 — 설명)을 show로 남기고 80자에서 자른다 — 사양 근거 추가 컷은 show가 없다', () => {
    const long = '가'.repeat(90)
    const plan = planExtraShots(
      jobOf([card('커피와 간식', '선생님께 건넬 커피와 간식도 함께 담아요'), card(long), card('디자인'), card('색감')], SIZE),
      4
    )!
    expect(plan.points[0]).toMatchObject({ purpose: 'angle', show: '커피와 간식 — 선생님께 건넬 커피와 간식도 함께 담아요' })
    expect(plan.points[1].show).toBe(`${'가'.repeat(80)}…`)
    expect(plan.shots.filter((s) => s.proves?.startsWith('spec.')).every((s) => s.show === undefined)).toBe(true)
  })

  it('실사용은 태그가 하나뿐이어도 그 태그로, 기본값 태그뿐이거나 없으면 일상 사용 장면. 최종 카피가 없으면 계획이 없다', () => {
    const one = planExtraShots(jobOf([card('선물')], {}, { usageSceneTags: ['#여행'] }), 4)!
    expect(one.shots[0]).toEqual({ key: 'long_scene:0', purpose: 'scene', proves: 'usageSceneTags', caption: '여행' })
    const none = planExtraShots(jobOf([card('선물')], {}, { usageSceneTags: ['일상', ''] }), 4)!
    expect(none.shots[0]).toEqual({ key: 'long_scene:0', purpose: 'scene', proves: 'everyday', caption: '일상 속 사용 모습' })
    expect(none.shots).toHaveLength(2)
    expect(planExtraShots({ ...jobOf([]), copy_sections: {} } as PdpJobRow, 4)).toBeNull()
  })
})

describe('planExtraShots — 캡션 검사(기록만)', () => {
  it('띄어쓰기 없이 7음절 넘게 붙은 한글은 붙어쓰기 의심, 목적 낱말이 캡션에 없으면 짝 어긋남', () => {
    const plan = planExtraShots(
      jobOf([card('튼튼해요', '바닥이 입체라 잘 서요'), card('선물'), card('디자인'), card('색감')], SIZE, {
        usageSceneTags: ['사워중두피마사지', '욕실 정리'],
      }),
      4
    )!
    expect(plan.captions.unspaced).toEqual(['long_scene:0:사워중두피마사지', 'usageSceneTags[0]:사워중두피마사지'])
    // 0번 컷은 설명의 밑면을 보여 주는데 캡션(제목) '튼튼해요'에는 그 낱말이 없다
    expect(plan.captions.mismatched).toEqual(['features:0'])
    expect(plan.captions.checked).toBeGreaterThan(0)
  })
})

describe('applyShotPurpose — 항목 뜻을 컷 지시로', () => {
  const plan = (point: Record<string, unknown>) => ({ version: 1, shots: [], points: [{ key: 'features:0', ...point }], captions: { checked: 0, unspaced: [], mismatched: [] } }) as never

  it('POINT 장면 컷은 세트를 떠나고, 주제 글을 싣는다', () => {
    const block = applyShotPurpose('BASE', 'features:0', plan({ purpose: 'scene', show: '욕실에도 두세요' }))
    expect(block).toContain('in this different place or situation')
    expect(block).toContain('욕실에도 두세요')
    expect(block).not.toContain('Keep the shared set')
    expect(block).toContain('Keep the light and the exact product identity')
  })

  it('주제 글이 있는 앵글은 뜻을 그리고 손을 금지하지 않는다', () => {
    const block = applyShotPurpose('BASE', 'features:0', plan({ purpose: 'angle', angle: 0, show: '오래 써요' }))
    expect(block).toContain('Make the meaning of this feature readable')
    expect(block).not.toContain('no hand holds it')
    expect(block).toContain('Keep the shared set')
  })

  it('주제 글이 없는 앵글(채움 컷·옛 기록)은 정물 그대로다', () => {
    const block = applyShotPurpose('BASE', 'features:0', plan({ purpose: 'angle', angle: 0 }))
    expect(block).toContain('no hand holds it')
    expect(block).not.toContain('Make the meaning')
  })
})

describe('applyShotPurpose·withAngleRetry·readExtraShots', () => {
  const plan = planExtraShots(
    jobOf([card('바닥이 잡힌 입체'), card('선물'), card('디자인'), card('색감')], SIZE),
    4
  )!

  it('주장 글이 있으면 목적 블록 끝에 다시 적는다 — 목적은 각도·거리만 바꾸고 주장이 말하는 물건·장면은 남긴다. show가 없는 예전 기록은 그대로', () => {
    const coffee = planExtraShots(jobOf([card('커피와 간식', '커피와 간식도 함께 담아요'), card('디자인'), card('색감'), card('포장')], SIZE), 4)!
    const block = applyShotPurpose('BASE', 'features:0', coffee, SIZE.size)
    expect(block).toContain('Feature this cut must show (reference only, never drawn as text): 커피와 간식 — 커피와 간식도 함께 담아요.')
    expect(block).toContain('changes only the camera angle and distance')
    expect(block.indexOf(SHOT_ANGLES[0])).toBeLessThan(block.indexOf('Feature this cut must show'))
    const legacy = { ...coffee, points: coffee.points.map((p) => ({ key: p.key, purpose: p.purpose, angle: p.angle })) }
    expect(applyShotPurpose('BASE', 'features:0', legacy, SIZE.size)).not.toContain('Feature this cut must show')
    expect(block).toContain('Show only product structure the original photo shows')
  })

  it('목적 블록은 맨 끝에 붙고, 크기 비교만 사양 크기 참고 줄을 단다. 기록에 없는 컷은 그대로', () => {
    const under = applyShotPurpose('BASE', 'features:0', plan, SIZE.size)
    expect(under.startsWith('BASE\n\n[Shot purpose]\n')).toBe(true)
    expect(under).toContain('the bottom, the inside or the opening')
    expect(under).toContain('no hand holds it')
    expect(under).not.toContain('Real size')
    const scale = applyShotPurpose('BASE', 'features:5', plan, SIZE.size)
    expect(plan.shots.find((s) => s.key === 'features:5')?.purpose).toBe('scale')
    expect(scale).toContain(`Real size (reference only, never drawn as text): ${SIZE.size}`)
    expect(applyShotPurpose('BASE', 'features:1', plan)).toContain(SHOT_ANGLES[0])
    expect(applyShotPurpose('BASE', 'features:2', plan)).toContain(SHOT_ANGLES[1])
    expect(applyShotPurpose('BASE', 'hero', plan)).toBe('BASE')
    expect(applyShotPurpose('BASE', 'features:0', null)).toBe('BASE')
  })

  it('계획이 그리는 키 — 섹션 상품 컷과 모듈 데이터의 imageKey(T10 막 scenes 포함), 계획이 없으면 빈 모음', () => {
    const plan = {
      sections: [
        { productImageKey: 'hero', modules: [] },
        { productImageKey: null, modules: [{ type: 'M2b', data: { imageKey: 'usage' } }] },
        {
          productImageKey: null,
          modules: [{ type: 'M10', data: { scenes: [{ imageKey: 'features:4', caption: '밑면' }, { imageKey: 'long_scene:0' }] } }],
        },
      ],
    } as unknown as Parameters<typeof designcutDrawnKeys>[0]
    expect([...designcutDrawnKeys(plan)]).toEqual(['hero', 'usage', 'features:4', 'long_scene:0'])
    expect(designcutDrawnKeys(null).size).toBe(0)
  })

  it('다른 각도 지시는 거의 같은 구도였던 컷 이름을 담고, 모양이 틀린 기록은 읽지 않는다', () => {
    expect(withAngleRetry('BASE', 'features:0')).toContain('the features:0 cut')
    expect(readExtraShots(plan)).toBe(plan)
    expect(readExtraShots({ version: 2, shots: [], points: [] })).toBeNull()
    expect(readExtraShots({ version: 1, shots: 'x' })).toBeNull()
    expect(readExtraShots(null)).toBeNull()
  })
})

describe('applyShotPurpose — K 컷 지시와 같은 문장(적용 D4 ⓑ)', () => {
  const plan = (purpose: string) => ({ version: 1, shots: [], points: [{ key: 'features:0', purpose, angle: 0 }], captions: { checked: 0, unspaced: [], mismatched: [] } }) as never
  const block = (purpose: string, size?: string, context?: Parameters<typeof applyShotPurpose>[4]) => applyShotPurpose('BASE', 'features:0', plan(purpose), size, context)
  const PURPOSES = ['underside', 'texture', 'scale', 'action', 'scene', 'angle']

  it('손이 나오는 목적(action·scale)만 접촉 줄, 크기 목적(scale·action·scene)만 손에 빗댄 크기 줄 — 사양 크기가 없으면 크기 줄이 없다', () => {
    for (const purpose of PURPOSES) {
      const out = block(purpose, SIZE.size)
      expect(out.includes(CONTACT_LINE), purpose).toBe(['action', 'scale'].includes(purpose))
      expect(out.includes(sizeLine(SIZE.size)), purpose).toBe(['scale', 'action', 'scene'].includes(purpose))
      expect(block(purpose), purpose).not.toContain('Real size')
    }
    expect(sizeLine(SIZE.size)).toContain('In hand terms')
  })

  it('접촉·크기 줄은 K 컷 지시의 문장과 바이트가 같다', () => {
    const k = buildShotBrief({ key: 'k0_a_0', section: 'x', purpose: 'action', composition: 'in_hand', aspect: '1:1', show: '' }, { size: SIZE.size })
    expect(k).toContain(`\n${CONTACT_LINE}\n`)
    expect(k).toContain(sizeLine(SIZE.size))
    const d = block('action', SIZE.size)
    expect(d).toContain(`\n${CONTACT_LINE}\n`)
    expect(d).toContain(sizeLine(SIZE.size))
  })

  it('제품군 문장은 근거 있는 제품군의 맞는 목적 줄 끝에만 — 근거 없는 제품군·제품군 없음·값을 안 넘긴 호출은 그대로', () => {
    for (const family of FAMILY_SHOT_FAMILIES) {
      for (const purpose of PURPOSES) {
        const sentence = familyShotLine(family, purpose)
        const plain = block(purpose, SIZE.size)
        const out = block(purpose, SIZE.size, { family })
        if (!sentence) expect(out, `${family} ${purpose}`).toBe(plain)
        else expect(out.split('\n'), `${family} ${purpose}`).toEqual(plain.split('\n').map((line, i) => (i === 4 ? `${PURPOSE_LINE(purpose)} ${sentence}` : line)))
      }
    }
    const others = [...new Set(Object.values(PRODUCT_FAMILIES).flat())].filter((family) => !FAMILY_SHOT_FAMILIES.includes(family))
    for (const family of [...others, null, undefined, 'no-such']) {
      for (const purpose of PURPOSES) expect(block(purpose, SIZE.size, { family, ingredients: ['사과'] }), `${family} ${purpose}`).toBe(block(purpose, SIZE.size))
    }
    expect(block('scene', SIZE.size, { family: 'fresh', ingredients: ['사과'] })).toContain('Show the fresh food itself (사과) with')
  })

  it('잡의 목적 블록 값 — 제품군은 K 선택과 같은 판정, 재료 이름은 규제 표현을 거른다', () => {
    const cream = { ...jobOf([card('a')], { productName: '수분 크림', extraSpecs: [{ key: '성분', value: '히알루론산, 치료 성분' }] }), analysis: { detected_category: 'beauty' } } as unknown as PdpJobRow
    expect(shotPurposeContextOf(cream)).toEqual({ family: 'cosmetic', ingredients: ['히알루론산'] })
    const none = { ...jobOf([card('a')]), analysis: { detected_category: 'household' } } as unknown as PdpJobRow
    expect(shotPurposeContextOf(none)).toEqual({ family: null, ingredients: [] })
  })
})

/** 목적 블록의 목적 줄(제품군 문장 전) — angle은 Framing 줄 */
function PURPOSE_LINE(purpose: string): string {
  return applyShotPurpose('BASE', 'features:0', { version: 1, shots: [], points: [{ key: 'features:0', purpose, angle: 0 }], captions: { checked: 0, unspaced: [], mismatched: [] } } as never).split('\n')[4]
}
