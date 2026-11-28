// R2-1 사진 없는 옵션 디자인 가드 — 구분(결정론)과 이미지 태스크 연결. 옵션 기록이 없는 잡은 프롬프트가 그대로임을 함께 고정한다.

import { describe, expect, it } from 'vitest'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import type { EnrichmentRecord } from '../enrichment-switch'
import { buildImageTasks } from '../pdp-image-tasks'
import type { PdpJobRow } from '../pdp-state'
import { FAIRNEX_OPTION_LABELS } from './__fixtures__/fairnex-option-labels'
import {
  guardedReferences,
  isRealOptionPhoto,
  optionPhotoCoverage,
  optionPhotoDesignBlock,
  optionPhotoGuard,
  optionPhotoUrls,
  photographedNames,
  stripOptionMentions,
} from './option-photo-guard'
import { parseOptionLabels, type OptionSpec } from './option-spec'

const ON: EnrichmentRecord = { version: 1, features: ['vocab', 'persuasion', 'options'] }
const OFF: EnrichmentRecord = { version: 1, features: ['vocab', 'persuasion'] }

function specOf(
  key: keyof typeof FAIRNEX_OPTION_LABELS,
  photographed: (label: string) => boolean = () => false
): OptionSpec {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS[key])
  return {
    ...spec,
    variants: spec.variants.map((v) =>
      photographed(v.label) ? { ...v, sourceImage: `https://cdn.test/${v.label}.jpg` } : v
    ),
  }
}
const daisyOnly = () => specOf('P02', (label) => label.includes('데이지'))

/**
 * 디자인×색상 교차 픽스처(R3 ⑥) — 실 테스트 10상품에는 교차 상품이 없다(P01 수량×디자인, P02 디자인·사이즈, 04 §1).
 * 실제 등록명 중 coolSleeve "손등-블랙"은 한 낱말이라 디자인 한 축으로 읽힌다. 그래서 파서가 두 축으로 나누는 합성 이름을 쓴다.
 */
const CROSS_LABELS = ['꽃무늬 블랙', '꽃무늬 화이트', '체크 블랙', '체크 화이트']
function crossSpec(photographed: readonly string[]): OptionSpec {
  const { spec } = parseOptionLabels(CROSS_LABELS)
  return {
    ...spec,
    variants: spec.variants.map((v) =>
      photographed.includes(v.label) ? { ...v, sourceImage: `https://cdn.test/${encodeURIComponent(v.label)}.jpg` } : v
    ),
  }
}

describe('optionPhotoCoverage', () => {
  it('P02: 데이지만 사진 — 체리는 사진 없는 값', () => {
    expect(optionPhotoCoverage(daisyOnly())).toEqual({
      axes: [{ kind: 'design', axisName: '디자인', photographed: ['데이지'], unphotographed: ['체리'] }],
      unphotographed: ['체리'],
      combos: { photographed: [], unphotographed: [] },
    })
  })

  it('모든 값에 사진이 있거나 옵션 기록이 없으면 null', () => {
    expect(optionPhotoCoverage(specOf('P02', () => true))).toBeNull()
    expect(optionPhotoCoverage(null)).toBeNull()
  })

  it('카드 축이 수량뿐이면 null(생김새가 같다)', () => {
    expect(optionPhotoCoverage(specOf('P05'))).toBeNull()
  })

  it('색상 축에 사진이 하나도 없으면 전부 사진 없는 값', () => {
    const coverage = optionPhotoCoverage(specOf('neckWarmer'))
    expect(coverage?.axes.map((a) => [a.kind, a.photographed])).toEqual([['color', []]])
    expect(coverage?.unphotographed).toEqual(['라이트 크림', '오가닉 블랙'])
  })

  it('사진 판정은 편집기 옵션 섹션과 같다 — 공개 http(s) URL만, 자리표시·생성 실패·저장소 경로·공백은 없는 사진', () => {
    expect(isRealOptionPhoto('https://cdn.test/a.jpg')).toBe(true)
    for (const url of [
      '  ',
      'user/registration/a.jpg',
      'https://placehold.co/600x400',
      'https://x.test/Generation+Failed.png',
      undefined,
    ])
      expect(isRealOptionPhoto(url)).toBe(false)
    const spec = daisyOnly()
    const storagePath = {
      ...spec,
      variants: spec.variants.map((v) => ({
        ...v,
        sourceImage: v.sourceImage ? 'user/registration/daisy.jpg' : undefined,
      })),
    }
    expect(optionPhotoCoverage(storagePath)?.axes[0].photographed).toEqual([])
  })
})

describe('optionPhotoCoverage — 디자인×색상 교차(R3 ⑥)', () => {
  it('파서가 교차 픽스처를 디자인·색상 두 축으로 나눈다', () => {
    expect(crossSpec([]).axes.map((a) => [a.kind, a.values])).toEqual([
      ['design', ['꽃무늬', '체크']],
      ['color', ['블랙', '화이트']],
    ])
  })

  it('디자인 값은 다 사진이 있어도 사진 없는 색(화이트)을 가드한다 — 이전엔 첫 축(디자인)만 봐서 가드가 없었다', () => {
    const coverage = optionPhotoCoverage(crossSpec(['꽃무늬 블랙', '체크 블랙']))
    expect(coverage).toEqual({
      axes: [{ kind: 'color', axisName: '색상', photographed: ['블랙'], unphotographed: ['화이트'] }],
      unphotographed: ['화이트'],
      combos: { photographed: ['꽃무늬 블랙', '체크 블랙'], unphotographed: [] },
    })
    const guard = optionPhotoGuard(coverage)
    expect(guard).toBe(
      'OPTION DESIGN RULE: show only the 블랙 color exactly as in the reference photo. Do not create other colors or recolored versions of the product.'
    )
    expect(optionPhotoDesignBlock(coverage)).toContain('실물 사진이 있는 색상 옵션은 블랙뿐입니다')
    expect(optionPhotoDesignBlock(coverage)).not.toContain('화이트')
  })

  it('두 축 모두 사진 없는 값이 있으면 축마다 사진 있는 값만 쓰고, 지울 이름은 두 축을 합친다', () => {
    const coverage = optionPhotoCoverage(crossSpec(['꽃무늬 블랙']))!
    expect(coverage.axes.map((a) => [a.kind, a.unphotographed])).toEqual([
      ['design', ['체크']],
      ['color', ['화이트']],
    ])
    expect(coverage.unphotographed).toEqual(['체크', '화이트'])
    // 사진 없는 값이 든 조합은 값 가드가 막으므로 조합 목록에 넣지 않는다
    expect(coverage.combos.unphotographed).toEqual([])
    const block = optionPhotoDesignBlock(coverage)
    expect(block).toContain(
      '실물 사진이 있는 디자인 옵션은 꽃무늬뿐입니다. 실물 사진이 있는 색상 옵션은 블랙뿐입니다. 제품은 참조 사진에 보이는 디자인·색 그대로만 그리세요.'
    )
    const guard = optionPhotoGuard(coverage)
    expect(guard.startsWith('OPTION DESIGN RULE: show only designs and colors that appear in the reference photos')).toBe(true)
    for (const name of ['체크', '화이트']) {
      expect(block).not.toContain(name)
      expect(guard).not.toContain(name)
    }
    expect(stripOptionMentions('꽃무늬/체크 패턴, 블랙·화이트 컬러', coverage.unphotographed)).toBe('꽃무늬 패턴, 블랙 컬러')
  })

  it('값마다 사진은 있지만 조합이 빠지면(체크 블랙·꽃무늬 화이트) 조합 가드 — 사진 있는 조합만 이름을 쓴다', () => {
    const coverage = optionPhotoCoverage(crossSpec(['꽃무늬 블랙', '체크 화이트']))!
    expect(coverage.axes).toEqual([])
    expect(coverage.unphotographed).toEqual([])
    expect(coverage.combos).toEqual({ photographed: ['꽃무늬 블랙', '체크 화이트'], unphotographed: ['꽃무늬 화이트', '체크 블랙'] })
    const block = optionPhotoDesignBlock(coverage)
    expect(block).toContain('실물 사진이 있는 디자인·색상 조합은 꽃무늬 블랙, 체크 화이트뿐입니다.')
    expect(block).not.toContain('꽃무늬 화이트')
    expect(block).not.toContain('체크 블랙')
    expect(optionPhotoGuard(coverage)).toBe(
      'OPTION DESIGN RULE: show only designs and colors that appear in the reference photos, exactly as photographed. Do not create other designs, colors, design-color combinations or recolored versions of the product.'
    )
  })

  it('모든 조합에 사진이 있거나 사진이 하나도 없으면', () => {
    expect(optionPhotoCoverage(crossSpec(CROSS_LABELS))).toBeNull()
    const none = optionPhotoCoverage(crossSpec([]))!
    expect(none.axes.map((a) => a.photographed)).toEqual([[], []])
    expect(optionPhotoGuard(none).startsWith('OPTION DESIGN RULE: show the product exactly as in the reference photo.')).toBe(
      true
    )
    expect(optionPhotoDesignBlock(none)).toContain('이 상품의 디자인 옵션에는 실물 사진이 없습니다.')
  })
})

describe('optionPhotoCoverage — 축 셋 이상으로 접힌 기록(R4)', () => {
  // 파서는 변하는 축이 셋 이상이면 라벨 통째를 한 디자인 축으로 접는다(too_many_axes, 편집기 옵션 섹션은 그대로)
  const folded = (labels: string[], photographed: readonly string[]) => {
    const { spec, warnings, fallback } = parseOptionLabels(labels)
    expect(fallback).toBe(true)
    return {
      warnings: warnings.map((w) => w.code),
      spec: {
        ...spec,
        variants: spec.variants.map((v) =>
          photographed.includes(v.label) ? { ...v, sourceImage: `https://cdn.test/${encodeURIComponent(v.label)}.jpg` } : v
        ),
      },
    }
  }

  it('수량×디자인×색상: 라벨을 다시 분류해 사진 없는 색(화이트)만 가드한다 — 이전엔 라벨 통째라 "화이트"를 지울 수 없었다', () => {
    const labels = ['20개 꽃무늬 블랙', '20개 꽃무늬 화이트', '50개 체크 블랙', '50개 체크 화이트', '20개 체크 블랙']
    const { spec, warnings } = folded(labels, ['20개 꽃무늬 블랙', '50개 체크 블랙'])
    expect(warnings).toEqual(['too_many_axes'])
    expect(spec.axes.map((a) => a.kind)).toEqual(['design'])
    const coverage = optionPhotoCoverage(spec)
    expect(coverage).toEqual({
      axes: [{ kind: 'color', axisName: '색상', photographed: ['블랙'], unphotographed: ['화이트'] }],
      unphotographed: ['화이트'],
      combos: { photographed: ['꽃무늬 블랙', '체크 블랙'], unphotographed: [] },
    })
    expect(stripOptionMentions('블랙/화이트 두 컬러 꽃무늬 파우치', coverage!.unphotographed, photographedNames(coverage!))).toBe(
      '블랙 두 컬러 꽃무늬 파우치'
    )
  })

  it('디자인×색상×사이즈: 사이즈는 생김새가 같아 보지 않고, 빠진 조합(체크 화이트)은 조합 가드', () => {
    const labels = ['꽃무늬 블랙 S', '꽃무늬 블랙 M', '꽃무늬 화이트 S', '체크 블랙 S', '체크 화이트 M']
    const coverage = optionPhotoCoverage(folded(labels, ['꽃무늬 블랙 S', '꽃무늬 화이트 S', '체크 블랙 S']).spec)
    expect(coverage).toEqual({
      axes: [],
      unphotographed: [],
      combos: { photographed: ['꽃무늬 블랙', '꽃무늬 화이트', '체크 블랙'], unphotographed: ['체크 화이트'] },
    })
    // 모든 디자인·색 조합에 사진이 있으면 사이즈 사진이 빠져도 가드하지 않는다
    expect(optionPhotoCoverage(folded(labels, ['꽃무늬 블랙 S', '꽃무늬 화이트 S', '체크 블랙 S', '체크 화이트 M']).spec)).toBeNull()
  })

  it('수량×색상×사이즈: 색상 축만 되살아나 한 축 문구로 가드한다', () => {
    const labels = ['1개 블랙 S', '1개 화이트 M', '2개 블랙 M', '2개 화이트 S']
    const coverage = optionPhotoCoverage(folded(labels, ['1개 블랙 S', '2개 블랙 M']).spec)
    expect(coverage?.axes).toEqual([{ kind: 'color', axisName: '색상', photographed: ['블랙'], unphotographed: ['화이트'] }])
    expect(optionPhotoGuard(coverage)).toBe(
      'OPTION DESIGN RULE: show only the 블랙 color exactly as in the reference photo. Do not create other colors or recolored versions of the product.'
    )
  })

  it('영어 라벨이 축 셋 이상으로 접혀도 되살린 색 축은 값 순서대로, 가드 문구에 사진 없는 색이 없다', () => {
    const labels = ['20pcs Flower White S', '20pcs Flower Black S', '50pcs Check White M', '50pcs Check Black M']
    const coverage = optionPhotoCoverage(folded(labels, ['20pcs Flower Black S', '50pcs Check Black M']).spec)
    expect(coverage?.unphotographed).toEqual(['White'])
    expect(optionPhotoDesignBlock(coverage)).not.toContain('White')
  })

  it('축 셋 이상인데 축 값이 빠진 라벨이 있으면 라벨 단위 그대로(되살리지 않는다)', () => {
    const labels = ['20개 꽃무늬 블랙', '20개 꽃무늬 화이트', '50개 체크 블랙', '50개 체크']
    const { spec } = parseOptionLabels(labels)
    const coverage = optionPhotoCoverage({
      ...spec,
      variants: spec.variants.map((v) => (v.label.includes('블랙') ? { ...v, sourceImage: `https://cdn.test/${encodeURIComponent(v.label)}.jpg` } : v)),
    })
    expect(coverage?.axes.map((a) => a.kind)).toEqual(['design'])
    expect(coverage?.unphotographed).toEqual(['20개 꽃무늬 화이트', '50개 체크'])
  })

  it('축이 빠진 라벨로 접힌 기록(inconsistent_axis)은 어느 값이 무엇인지 모르므로 라벨 단위 그대로(faceBand)', () => {
    const { spec, warnings } = folded([...FAIRNEX_OPTION_LABELS.faceBand], ['6개 혼합 3종'])
    expect(warnings).toEqual(['inconsistent_axis'])
    expect(optionPhotoCoverage(spec)?.axes).toEqual([
      { kind: 'design', axisName: '디자인', photographed: ['6개 혼합 3종'], unphotographed: ['6개 러블리핑크'] },
    ])
  })
})

describe('생성 참조 — 실물 사진이 있는 옵션의 사진만(R3 ①)', () => {
  const img = (data: string) => ({ data, mediaType: 'image/jpeg' })

  it('optionPhotoUrls: 실물 사진만, 옵션 순서, 중복 제거', () => {
    const spec = crossSpec(['꽃무늬 블랙', '체크 블랙'])
    const shared = { ...spec, variants: [...spec.variants, { ...spec.variants[0], label: '꽃무늬 블랙 2' }] }
    expect(optionPhotoUrls(shared)).toEqual([
      `https://cdn.test/${encodeURIComponent('꽃무늬 블랙')}.jpg`,
      `https://cdn.test/${encodeURIComponent('체크 블랙')}.jpg`,
    ])
    expect(optionPhotoUrls(specOf('P02'))).toEqual([])
    expect(optionPhotoUrls(null)).toEqual([])
  })

  it('상품 사진 중 옵션 사진과 같은 그림만 순서대로 남기고, 남지 않은 옵션 사진을 뒤에 붙인다', () => {
    const source = [img('cherry'), img('daisy'), img('daisy'), img('both')]
    expect(guardedReferences(source, [img('daisy')], 6).map((r) => r.data)).toEqual(['daisy'])
    expect(guardedReferences(source, [img('mint'), img('daisy'), img('mint')], 6).map((r) => r.data)).toEqual([
      'daisy',
      'mint',
    ])
  })

  it('옵션이 많아도 상품 사진 상한(max)까지만 — 남긴 상품 사진이 앞', () => {
    const options = Array.from({ length: 10 }, (_, i) => img(`opt-${i}`))
    const refs = guardedReferences([img('x'), img('opt-7')], options, 6).map((r) => r.data)
    expect(refs).toEqual(['opt-7', 'opt-0', 'opt-1', 'opt-2', 'opt-3', 'opt-4'])
  })

  it('옵션 사진을 하나도 못 읽었으면 상품 사진 그대로', () => {
    const source = [img('a'), img('b')]
    expect(guardedReferences(source, [], 6)).toEqual(source)
  })
})

describe('stripOptionMentions — 사진 없는 옵션 이름 지우기', () => {
  it.each([
    ['데이지/체리 컬러로 감성적 선물 연출', '데이지 컬러로 감성적 선물 연출'],
    [
      'in 데이지(daisy) and 체리(cherry) color options arranged together',
      'in 데이지(daisy) color options arranged together',
    ],
    ['(S/L size, 데이지/체리 color options)', '(S/L size, 데이지 color options)'],
    ['데이지와 체리, 분위기 따라 선택', '데이지, 분위기 따라 선택'],
    ['체리와 데이지 중 고르세요', '데이지 중 고르세요'],
    ['체리를 고르세요', '고르세요'],
  ])('%s → %s', (text, expected) => {
    expect(stripOptionMentions(text, ['체리'])).toBe(expected)
  })

  it('사진 있는 이름(keep) 속 낱말은 지우지 않는다 — "오가닉 블랙"에 사진이 있고 "블랙"에 없을 때', () => {
    expect(stripOptionMentions('데이지 오가닉 블랙 파우치, 블랙 컬러', ['블랙'], ['오가닉 블랙'])).toBe(
      '데이지 오가닉 블랙 파우치 컬러'
    )
    expect(stripOptionMentions('Organic Black / black pouches', ['black'], ['organic black'])).toBe('Organic Black pouches')
    // keep이 없으면 기존처럼 지운다
    expect(stripOptionMentions('데이지 오가닉 블랙 파우치', ['블랙'])).toBe('데이지 오가닉 파우치')
  })

  it('영어 값은 옵션 값 자리에서만 지운다 — 일반 낱말(white backdrop·white marble)은 그대로(R4)', () => {
    const generic = 'Pouch on a white seamless backdrop beside a white marble table, soft white light.'
    expect(stripOptionMentions(generic, ['White'], ['Black'])).toBe(generic)
    // 다른 옵션 이름과 나열된 자리
    expect(stripOptionMentions('Black/White color options', ['White'], ['Black'])).toBe('Black color options')
    expect(stripOptionMentions('White and Black pouches', ['White'], ['Black'])).toBe('Black pouches')
    expect(stripOptionMentions('in black (블랙) or white (화이트) colorways', ['White'], ['Black'])).toBe(
      'in black (블랙) colorways'
    )
    // 옵션을 뜻하는 낱말 앞
    expect(stripOptionMentions('the pouch in White color', ['White'], ['Black'])).toBe('the pouch in color')
    expect(stripOptionMentions('Cherry pattern pouch', ['Cherry'], ['Daisy'])).toBe('pattern pouch')
    expect(stripOptionMentions('White 컬러로 깔끔하게', ['White'], ['Black'])).toBe('컬러로 깔끔하게')
    // 다른 낱말 속 글자·한글 값 규칙은 그대로
    expect(stripOptionMentions('Whiteboard and off-white tones', ['White'], ['Black'])).toBe('Whiteboard and off-white tones')
    expect(stripOptionMentions('화이트 배경의 블랙 파우치', ['화이트'], ['블랙'])).toBe('배경의 블랙 파우치')
  })

  it('사진 없는 영어 값끼리 나열돼도 모두 지운다 — 앞 값을 지운 뒤 뒤 값이 남지 않게(R4 검수)', () => {
    expect(stripOptionMentions('available in White/Black.', ['White', 'Black'])).toBe('available in.')
    expect(stripOptionMentions('White, Black and Gray pouches', ['White', 'Black', 'Gray'])).toBe('pouches')
    expect(stripOptionMentions('Red, White and Black pouches', ['White', 'Black'], ['Red'])).toBe('Red pouches')
  })

  it('이웃 낱말 속 글자는 옵션 이름으로 보지 않는다 — "textured"의 red, "golden"의 gold(R4 검수)', () => {
    for (const [text, keep] of [
      ['a textured, white backdrop', ['Red']],
      ['soft white, golden hour light', ['Gold']],
      ['white greenery and white bluetooth speaker', ['Green', 'Blue']],
    ] as const) {
      expect(stripOptionMentions(text, ['White'], keep)).toBe(text)
    }
  })

  it('한글 문장 속 조사 나열과 JSON 배열의 영어 값도 옵션 자리로 지운다', () => {
    expect(stripOptionMentions('White와 Black 두 가지', ['White'], ['Black'])).toBe('Black 두 가지')
    expect(stripOptionMentions('Black과 White 두 가지', ['White'], ['Black'])).toBe('Black 두 가지')
    expect(stripOptionMentions('{"colors":["Black","White"]}', ['White'], ['Black'])).toBe('{"colors":["Black"]}')
    expect(stripOptionMentions('{"colors":["White","Black"]}', ['White'], ['Black'])).toBe('{"colors":["Black"]}')
  })

  it('대문자·사진 용어: "WHITE COLOR"는 지우고 "white color balance"는 둔다', () => {
    expect(stripOptionMentions('WHITE COLOR pouch', ['White'], ['Black'])).toBe('COLOR pouch')
    const photo = 'neutral white color balance, white color temperature 5600K'
    expect(stripOptionMentions(photo, ['White'], ['Black'])).toBe(photo)
  })

  it('영어 값의 지우지 않는 자리(일반 낱말과 구별할 수 없다) — 값 뒤 상품 명사·구절 끝 단독·하이픈', () => {
    for (const text of ['Daisy pouch with ribbon', 'a pouch in White.', 'Cherry-patterned pouch', 'Organic Black pouch / black']) {
      expect(stripOptionMentions(text, ['Daisy', 'White', 'Cherry', 'black'], ['organic black'])).toBe(text)
    }
  })

  it('photographedNames: 축마다 사진 있는 값과 사진 있는 조합', () => {
    expect(photographedNames(optionPhotoCoverage(crossSpec(['꽃무늬 블랙', '체크 블랙']))!)).toEqual([
      '블랙',
      '꽃무늬 블랙',
      '체크 블랙',
    ])
  })

  it('다른 낱말 속 글자는 건드리지 않고, 이름이 없으면 글을 그대로 돌려준다', () => {
    expect(stripOptionMentions('오프화이트 파우치와 화이트보드', ['화이트'])).toBe('오프화이트 파우치와 화이트보드')
    const indented = 'line one\n  watermarks,  brand names'
    expect(stripOptionMentions(indented, ['체리'])).toBe(indented)
    expect(stripOptionMentions(`${indented} 체리`, ['체리'])).toBe(indented)
  })
})

describe('optionPhotoGuard·optionPhotoDesignBlock — 긍정문 먼저, 사진 없는 옵션 이름 없음', () => {
  it('사진 있는 값이 하나면 그 디자인만 참조 사진 그대로', () => {
    const guard = optionPhotoGuard(optionPhotoCoverage(daisyOnly()))
    expect(guard.startsWith('OPTION DESIGN RULE: show only the 데이지 design exactly as in the reference photo.')).toBe(
      true
    )
    expect(guard).toContain('Do not create other designs or recolored versions of the product.')
    expect(guard).not.toContain('체리')
  })

  it('사진 있는 값이 여럿이면 이름을 늘어놓지 않고 참조 사진에 보이는 것만', () => {
    const coverage = optionPhotoCoverage(specOf('P01', (label) => !label.endsWith('-07')))
    const [axis] = coverage!.axes
    expect(axis.photographed.length).toBeGreaterThan(1)
    const guard = optionPhotoGuard(coverage)
    expect(guard.startsWith('OPTION DESIGN RULE: show only designs that appear in the reference photos')).toBe(true)
    for (const name of [...axis.photographed, ...axis.unphotographed]) expect(guard).not.toContain(name)
  })

  it('사진이 하나도 없으면 참조 사진 그대로만', () => {
    const coverage = optionPhotoCoverage(specOf('neckWarmer'))
    const guard = optionPhotoGuard(coverage)
    expect(guard.startsWith('OPTION DESIGN RULE: show the product exactly as in the reference photo.')).toBe(true)
    for (const name of coverage!.unphotographed) expect(guard).not.toContain(name)
  })

  it('디자인 LLM 블록: 사진 있는 값만 이름을 쓰고 사진 없는 값은 쓰지 않는다', () => {
    const block = optionPhotoDesignBlock(optionPhotoCoverage(daisyOnly()))
    expect(block).toContain('## 옵션 사진 규칙')
    expect(block).toContain('실물 사진이 있는 디자인 옵션은 데이지뿐입니다')
    expect(block).not.toContain('체리')
    expect(optionPhotoDesignBlock(null)).toBe('')
  })

  it('가드가 필요 없으면 빈 문자열', () => {
    expect(optionPhotoGuard(null)).toBe('')
  })

  it('한 축 상품의 규칙 문구는 R2-1과 바이트까지 같다(P02)', () => {
    const coverage = optionPhotoCoverage(daisyOnly())
    expect(optionPhotoGuard(coverage)).toBe(
      'OPTION DESIGN RULE: show only the 데이지 design exactly as in the reference photo. Do not create other designs or recolored versions of the product.'
    )
    expect(optionPhotoDesignBlock(coverage)).toBe(
      [
        '',
        '',
        '## 옵션 사진 규칙 (이 상품에 한함)',
        '실물 사진이 있는 디자인 옵션은 데이지뿐입니다. 제품은 참조 사진의 데이지 디자인 그대로만 그리세요.',
        '- 다른 옵션·다른 색 버전을 지어내거나, 여러 옵션을 나란히 놓거나, 색만 바꿔 보여 주는 장면을 만들지 마세요.',
        '- 옵션 이름은 상세페이지 글자로만 쓰입니다. 이미지 장면·소품·색 연출(positive)의 재료가 아닙니다.',
      ].join('\n')
    )
  })
})

describe('이미지 태스크 — 제품 컷에만 가드', () => {
  const job = (optionSpec: OptionSpec | undefined, record: EnrichmentRecord | null = ON): PdpJobRow => {
    const base = fixtureToJob(loadEnrichmentFixture('A-track-i'))
    return {
      ...base,
      spec_sheet: { ...base.spec_sheet, ...(optionSpec ? { optionSpec } : {}) },
      analysis: { ...base.analysis, ...(record ? { enrichment: record } : { enrichment: undefined }) },
    } as PdpJobRow
  }

  it('사진 없는 옵션이 있으면 제품이 나오는 컷 끝에 붙이고, 효과 컷(문제 장면·아이콘)은 그대로', () => {
    const guard = optionPhotoGuard(optionPhotoCoverage(daisyOnly()))
    const plain = new Map(buildImageTasks(job(undefined)).map((t) => [t.section, t.prompt]))
    const tasks = buildImageTasks(job(daisyOnly()))
    expect(tasks.length).toBe(plain.size)
    for (const t of tasks) {
      if (t.effectOnly) expect(t.prompt).toBe(plain.get(t.section))
      else expect(t.prompt).toBe(`${plain.get(t.section)}\n${guard}`)
    }
    expect(tasks.some((t) => !t.effectOnly)).toBe(true)
    expect(tasks.some((t) => t.effectOnly)).toBe(true)
  })

  it('제품 컷 본문(디자인 프롬프트 LLM 출력)에 남은 사진 없는 옵션 이름도 지운다 — R1 P02 features:3', () => {
    const base = job(daisyOnly())
    const positive =
      'Feature-specific styled flat-lay of the pouch in 데이지(daisy) and 체리(cherry) color options arranged together.'
    const withDesign = {
      ...base,
      design_prompts: { ...base.design_prompts, feature_prompts: [{ title: '컬러', positive, negative: '' }] },
    } as PdpJobRow
    const feature = buildImageTasks(withDesign).find((t) => t.section === 'features:0')!
    expect(feature.prompt).not.toMatch(/체리|cherry/i)
    expect(feature.prompt).toContain('in 데이지(daisy) color options arranged together')
    expect(feature.prompt.endsWith(optionPhotoGuard(optionPhotoCoverage(daisyOnly())))).toBe(true)
  })

  it('디자인×색상 교차: 사진 없는 색이 있으면 제품 컷에 색상 가드가 붙고 그 색 이름은 지운다(R3 ⑥)', () => {
    const spec = crossSpec(['꽃무늬 블랙', '체크 블랙'])
    const guard = optionPhotoGuard(optionPhotoCoverage(spec))
    const plain = new Map(buildImageTasks(job(undefined)).map((t) => [t.section, t.prompt]))
    const tasks = buildImageTasks(job(spec))
    for (const t of tasks) {
      if (t.effectOnly) expect(t.prompt).toBe(plain.get(t.section))
      else expect(t.prompt).toBe(`${stripOptionMentions(plain.get(t.section)!, ['화이트'])}\n${guard}`)
    }
    expect(tasks.some((t) => !t.effectOnly)).toBe(true)
  })

  it('영어 옵션 값: 제품 컷에서 옵션 자리의 사진 없는 색만 지우고 배경 낱말(white backdrop)은 둔다(R4)', () => {
    const { spec } = parseOptionLabels(['20pcs Flower Black', '20pcs Flower White', '50pcs Check Black', '50pcs Check White'])
    const shot = {
      ...spec,
      variants: spec.variants.map((v) =>
        v.values.color === 'Black' ? { ...v, sourceImage: `https://cdn.test/${encodeURIComponent(v.label)}.jpg` } : v
      ),
    }
    const base = job(shot)
    const positive = 'Pouch on a white seamless backdrop, shown in Black/White color options.'
    const withDesign = {
      ...base,
      design_prompts: { ...base.design_prompts, feature_prompts: [{ title: '컬러', positive, negative: '' }] },
    } as PdpJobRow
    const feature = buildImageTasks(withDesign).find((t) => t.section === 'features:0')!
    expect(feature.prompt).toContain('Pouch on a white seamless backdrop, shown in Black color options.')
    expect(feature.prompt.endsWith(optionPhotoGuard(optionPhotoCoverage(shot)))).toBe(true)
  })

  it('options 기록이 없거나(Track S·대조군) 모든 옵션에 사진이 있으면 프롬프트가 기존과 같다', () => {
    const plain = buildImageTasks(job(undefined)).map((t) => t.prompt)
    expect(buildImageTasks(job(daisyOnly(), OFF)).map((t) => t.prompt)).toEqual(plain)
    expect(buildImageTasks(job(daisyOnly(), null)).map((t) => t.prompt)).toEqual(plain)
    expect(buildImageTasks(job(specOf('P02', () => true))).map((t) => t.prompt)).toEqual(plain)
    expect(buildImageTasks(job(crossSpec(CROSS_LABELS))).map((t) => t.prompt)).toEqual(plain)
  })
})
