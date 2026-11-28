import { describe, expect, it } from 'vitest'
import { tidyImageBrief } from '../pdp-image-brief'
import { getPdpTestProduct } from '../__fixtures__/pdp-products'
import { TEMPLATES } from './library'
import { heroOverlayAnchorOf, lineShotsOf } from './line-plan'
import { OVERLAY_SCRIM_MAX } from './overlay'
import type { ShotQuantity } from './input-values'
import type { OrderedSection } from './selection-order'
import { claimTermsIn, regulatedClaimTermsIn } from '../eval/claim-lexicon'
import { PRODUCT_FAMILIES } from './product-family'
import {
  buildFrameBrief,
  buildShotBrief,
  FAMILY_SHOT_FAMILIES,
  familyShotLine,
  handTermsOf,
  HERO_LARGE_BRIEF,
  heroLargeBrief,
  isHandsOnly,
  isStagedCut,
  OVERLAY_CLEAR_PERCENT,
  HANDS_TRUE_SCALE,
  kSizeLines,
  PROPS_TRUE_SCALE,
  shotRouteOf,
  sizeLine,
  sizeWordsLine,
  trueScaleLine,
  usesSetBackground,
  withoutFaceFocus,
  type LineShot,
} from './shot-brief'

const shot = (over: Partial<LineShot> = {}): LineShot => ({ key: 'k3_photo_0', section: 'sub_div', purpose: 'feature_proof', composition: 'closeup', aspect: '3:4', show: '', ...over })

/** 라이브러리가 쓰는 목적·구도 전부 */
function usedValues(field: 'purpose' | 'composition'): string[] {
  const out = new Set<string>()
  const walk = (slots: Record<string, unknown>) => {
    for (const def of Object.values(slots) as Array<{ type?: string; fields?: Record<string, unknown> } & Record<string, unknown>>) {
      if (def.type === 'image') for (const value of def[field] as string[]) out.add(value)
      if (def.type === 'list' && def.fields) walk(def.fields)
    }
  }
  for (const template of TEMPLATES) walk(template.slots as Record<string, unknown>)
  return [...out].sort()
}

describe('사진 위 글 칸의 Frame 줄', () => {
  const scene = shot({ section: 'key_message', purpose: 'scene', composition: 'in_use', show: '글' })

  it('사진 위 글이 아닌 칸은 지시가 글자 하나 바뀌지 않는다', () => {
    expect(buildShotBrief(scene, { size: '가로 10cm' })).toBe(
      [
        '[Shot direction]',
        'This block wins over every instruction above about framing, angle, distance, props, the people shown and how much of the frame the product fills.',
        'Purpose: Show the product in use in a real place where it belongs — not a held-up product shot.',
        'Camera: used in its real place',
        // 적용 K6 ③ T1-53 — 가운데 참조 역할 줄(상품 컷)
        'Refs: any attached images between the first and the last show this same product from other sides, its labels or its photographed options — use them only to get those details right; the structure follows the first image.',
        'Contact: hands grip the real holding part of the product and never pass through it; the product sits on surfaces with a contact shadow.',
        'Visible: the product takes about 30 to 50% of the frame. Keep what matters away from the top and bottom edges — the page crops them a little.',
        'Text of this section (reference only, never drawn as text): 글',
        // 손·사용 구도는 크기 줄 뒤에 손 쪽 가까이 찍기, 이어서 소품 실물 크기(오너 메모 11-06 설계 S2·S3) — '가로'는 풀이할 이름이 아니라 풀이 줄 없음
        'Real size (reference only, never drawn as text): 가로 10cm. In hand terms, 10cm is about 1 adult palm width. Keep hands and objects in true proportion to it. ' +
          'Hands, heads and bodies keep their real size next to the product. To make the product fill its share of the frame, move the camera closer — never enlarge the product itself.',
        'Things the product holds, wraps or sits on keep their real size — never thicken or enlarge them to fit the product.',
        'Never: added text, numbers or logos beyond what is printed on the product itself; parts, colors or quantities not in the reference photos; collage or poster layouts; review-snapshot looks; real brands.',
      ].join('\n')
    )
  })

  it('글이 얹히는 쪽을 비우고 나머지 쪽에 상품을 둔다', () => {
    const lineOf = (anchor: 'top' | 'bottom') => buildShotBrief({ ...scene, overlayAnchor: anchor }).split('\n').find((line) => line.startsWith('Frame: '))!
    expect(lineOf('top')).toContain('Leave the top 60% of the frame')
    expect(lineOf('top')).toContain('wall')
    expect(lineOf('top')).toContain('stays in the bottom 40% and does not cross into the top 60%')
    expect(lineOf('bottom')).toContain('Leave the bottom 60% of the frame')
    expect(lineOf('bottom')).toContain('floor')
    expect(lineOf('bottom')).toContain('stays in the top 40% and does not cross into the bottom 60%')
    expect(lineOf('top')).toContain('draw no text')
  })

  it('사진 위 글 칸은 Visible 비중만 바꾸고 Frame 줄을 더한다 — 다른 줄은 그대로다', () => {
    const plain = buildShotBrief(scene, { size: '가로 10cm' }).split('\n')
    const framed = buildShotBrief({ ...scene, overlayAnchor: 'top' }, { size: '가로 10cm' }).split('\n')
    const rest = (lines: string[]) => lines.filter((line) => !/^(Frame|Visible): /.test(line))
    expect(rest(framed)).toEqual(rest(plain))
    expect(framed.find((line) => line.startsWith('Visible: '))).not.toContain('30 to 50%')
    expect(framed.find((line) => line.startsWith('Visible: '))).toContain('Keep what matters away')
    expect(framed.at(-2)).toMatch(/^Frame: /)
    expect(framed.at(-1)).toMatch(/^Never: /)
  })

  it('상품이 없는 컷은 Visible이 없어도 Frame 줄을 받고, 상품을 있어야 한다고 말하지 않는다', () => {
    const brief = buildShotBrief(shot({ purpose: 'problem', composition: 'in_use', overlayAnchor: 'top' }))
    expect(brief).not.toContain('Visible: ')
    expect(brief).toContain('Frame: ')
    expect(brief).toContain('including any product')
  })

  it('비우는 비율은 막의 상한과 같다 — 상한이 바뀌면 여기서 걸린다', () => {
    expect(OVERLAY_CLEAR_PERCENT / 100).toBe(OVERLAY_SCRIM_MAX)
  })

  it('대표 컷 블록은 Frame 줄만 싣고 브리프 정리를 지나도 남는다', () => {
    const block = buildFrameBrief('bottom').split('\n')
    expect(block).toHaveLength(3)
    expect(block[0]).toBe('[Shot direction]')
    expect(block[2]).toMatch(/^Frame: Leave the bottom 60%/)
    expect(tidyImageBrief(`앞\n\n${buildFrameBrief('top')}`, { sizeHonored: true }).prompt).toContain('Frame: Leave the top 60%')
  })

  const overlayTemplates = TEMPLATES.filter((t) => JSON.stringify(t.flow).includes('"overlay"'))
  const rowOf = (templateId: string, section: string, shots: OrderedSection['shots']) => ({ section, templateId, shots }) as unknown as OrderedSection
  const photo = [{ slot: 'photo', purpose: 'scene', composition: 'in_use' }] as unknown as OrderedSection['shots']

  it('라이브러리의 사진 위 글 칸은 모두 슬롯의 쪽을 컷 기록에 싣는다', () => {
    expect(overlayTemplates.length).toBeGreaterThan(0)
    for (const template of overlayTemplates) {
      const anchor = (template.flow[0] as { overlay: { anchor: string } }).overlay.anchor
      const [made] = lineShotsOf([rowOf(template.id, 'x', photo)], new Map(), [])
      expect(made.overlayAnchor, template.id).toBe(anchor)
    }
  })

  it('사진 위 글이 없는 칸은 기록에 칸 자체가 없다 — 옛 기록과 같은 모양이다', () => {
    const plain = TEMPLATES.find((t) => !JSON.stringify(t.flow).includes('"overlay"') && t.section !== 'hook_3step' && 'photo' in t.slots)!
    const [made] = lineShotsOf([rowOf(plain.id, 'x', photo)], new Map(), [])
    expect(Object.keys(made)).not.toContain('overlayAnchor')
  })

  it('대표 컷을 쓰는 첫 칸의 글 쪽을 찾고, 못 그리는 섹션이나 사진 위 글이 아닌 첫 칸은 비우지 않는다', () => {
    const top = overlayTemplates.find((t) => t.id === 'hook_3step.overlay-top-center')!
    const bottom = overlayTemplates.find((t) => t.id === 'hook_3step.overlay-bottom-left')!
    const plainHook = TEMPLATES.find((t) => t.section === 'hook_3step' && !JSON.stringify(t.flow).includes('"overlay"') && 'photo' in t.slots)!
    const other = rowOf('key_message.overlay-top-left', 'key_message', photo)
    expect(heroOverlayAnchorOf([other, rowOf(top.id, 'hook_3step', photo)], [])).toBe('top')
    expect(heroOverlayAnchorOf([rowOf(bottom.id, 'hook_3step', photo)], [])).toBe('bottom')
    expect(heroOverlayAnchorOf([rowOf(top.id, 'hook_3step', photo)], [`0:${top.id}`])).toBeUndefined()
    expect(heroOverlayAnchorOf([rowOf(plainHook.id, 'hook_3step', photo)], [])).toBeUndefined()
    // 첫 칸 앞의 사진 위 글은 대표 컷이 아니다
    expect(heroOverlayAnchorOf([other], [])).toBeUndefined()
  })
})

describe('컷 지시', () => {
  it('라이브러리가 쓰는 목적·구도마다 자기 문장이 있다(모르는 값이 기본 문장으로 떨어지지 않는다)', () => {
    const fallbackPurpose = buildShotBrief(shot({ purpose: 'no-such' })).split('\n')[2]
    for (const purpose of usedValues('purpose')) {
      const line = buildShotBrief(shot({ purpose })).split('\n')[2]
      expect(line, purpose).toMatch(/^Purpose: /)
      if (purpose !== 'hero') expect(line, purpose).not.toBe(fallbackPurpose)
    }
    const fallbackCamera = buildShotBrief(shot({ composition: 'no-such' })).split('\n')[3]
    for (const composition of usedValues('composition')) {
      const line = buildShotBrief(shot({ composition })).split('\n')[3]
      expect(line, composition).toMatch(/^Camera: /)
      if (composition !== 'front') expect(line, composition).not.toBe(fallbackCamera)
    }
  })

  it('반려동물 고민 컷만 근심하는 얼굴을 막는다(P07 보호자 근심 컷). 다른 카테고리는 기존 고민 컷 그대로다', () => {
    const pet = buildShotBrief(shot({ purpose: 'problem', composition: 'in_use' }), { category: 'pet' })
    expect(pet).toContain('No worried, sad or distressed face')
    expect(pet).toContain('The pet stays calm')
    const household = buildShotBrief(shot({ purpose: 'problem', composition: 'in_use' }), { category: 'household' })
    expect(household).toContain('without this product')
    expect(household).not.toContain('distressed')
    expect(buildShotBrief(shot({ purpose: 'scene' }), { category: 'pet' })).not.toContain('distressed')
  })

  it('기존 고민 프롬프트의 얼굴 중심 줄만 뺀다', () => {
    const prompt = ['앞', '- Facial Expression: tired', '중간', "SCENE FOCUS RULE (ABSOLUTE): Center on the PERSON's face", '뒤'].join('\n')
    expect(withoutFaceFocus(prompt)).toBe('앞\n중간\n뒤')
    expect(withoutFaceFocus('그대로')).toBe('그대로')
  })

  it('손 컷과 동작 컷만 손과 상품만 나온다', () => {
    expect(isHandsOnly({ purpose: 'action', composition: 'in_use' })).toBe(true)
    expect(isHandsOnly({ purpose: 'scale', composition: 'in_hand' })).toBe(true)
    expect(isHandsOnly({ purpose: 'scene', composition: 'in_use' })).toBe(false)
  })

  it('무대 기록이 있으면 Stage 줄을 싣고, 바탕 판단은 기록을 따른다', () => {
    const staged = shot({ purpose: 'feature_proof', composition: 'side', stage: { name: 'showroom', line: 'Stage: 시험 줄' } })
    expect(buildShotBrief(staged)).toContain('Stage: 시험 줄')
    expect(buildShotBrief(shot({ purpose: 'feature_proof', composition: 'side' }))).not.toContain('Stage:')
    // 기록이 없으면 목적으로 정한다 — feature_proof는 세트다
    expect(usesSetBackground(shot({ purpose: 'feature_proof' }))).toBe(true)
    expect(usesSetBackground(staged)).toBe(false)
    expect(usesSetBackground(shot({ stage: { name: 'place', line: '' } }))).toBe(true)
    expect(usesSetBackground(shot({ stage: { name: 'macro', line: '' } }))).toBe(false)
    expect(isStagedCut(staged)).toBe(true)
    expect(isStagedCut(shot({ stage: { name: 'life', line: '' } }))).toBe(false)
    expect(isStagedCut(shot({}))).toBe(false)
  })

  it('사진 위 글 칸은 Stage 줄과 Frame 줄을 함께 싣는다 — Frame이 뒤라 글 자리를 이긴다', () => {
    const brief = buildShotBrief(shot({ stage: { name: 'place', line: 'Stage: 시험 줄' }, overlayAnchor: 'top' }))
    expect(brief.indexOf('Stage: 시험 줄')).toBeGreaterThan(-1)
    expect(brief.indexOf('Frame: ')).toBeGreaterThan(brief.indexOf('Stage: 시험 줄'))
  })

  it('입력 치수를 손에 빗댄다 — 시험 상품의 크기 값', () => {
    expect(handTermsOf('지름 50mm 내외')).toBe('50mm is about 3 adult finger widths')
    expect(handTermsOf('5cm 내외')).toBe('5cm is about 3 adult finger widths')
    expect(handTermsOf('85mm x 80mm')).toBe('85mm is about 1 adult palm width; 80mm is about 1 adult palm width')
    expect(handTermsOf('1cm x 9.6cm')).toBe('1cm is narrower than an adult finger; 9.6cm is about 1 adult palm width')
    expect(handTermsOf('34cm x 19.5cm x 12.5cm')).toBe('34cm is about 2 adult hand lengths; 19.5cm is about 1 adult hand length; 12.5cm is about 1.5 adult palm widths')
    expect(handTermsOf('높이 7.3cm, 지름 3.2cm')).toBe('7.3cm is about 1 adult palm width; 3.2cm is about 2 adult finger widths')
    expect(handTermsOf('1.2m')).toBe('1.2m is about 6.5 adult hand lengths')
  })

  it('치수가 없으면 빗대지 않고, ml·개수는 치수로 읽지 않는다', () => {
    expect(handTermsOf('한 손에 쏙')).toBeNull()
    expect(handTermsOf('500ml 10개입')).toBeNull()
    expect(buildShotBrief(shot({ composition: 'in_hand' }), { size: '한 손에 쏙' })).toContain('한 손에 쏙. Keep hands')
    expect(handTermsOf('1cm 2cm 3cm 4cm')).not.toContain('4cm')
  })

  it('고민 컷은 상품이 없어 상품 줄이 붙지 않는다', () => {
    expect(shotRouteOf('problem')).toEqual({ base: 'problem', stage: 'scene', effectOnly: true })
    const brief = buildShotBrief(shot({ purpose: 'problem', composition: 'in_use' }), { size: '10cm' })
    expect(brief).not.toContain('Contact:')
    expect(brief).not.toContain('Visible:')
    expect(brief).not.toContain('Real size')
    expect(brief).not.toContain('Refs:')
  })

  it('상품이 나오는 컷은 모두 가운데 참조 역할 줄(Refs)을 한 번, Purpose·Camera 뒤에 싣는다(적용 K6 ③ T1-53)', () => {
    for (const purpose of ['hero', 'feature_proof', 'scene', 'action', 'state', 'texture', 'underside', 'scale', 'quantity', 'color', 'group', 'package', 'ingredient']) {
      const lines = buildShotBrief(shot({ purpose, composition: 'front' })).split('\n')
      expect(lines.filter((line) => line.startsWith('Refs: ')).length, purpose).toBe(1)
      expect(lines.findIndex((line) => line.startsWith('Refs: ')), purpose).toBeGreaterThan(lines.findIndex((line) => line.startsWith('Camera: ')))
      expect(lines.at(-1), purpose).toMatch(/^Never: /)
    }
  })

  it('구도 기법(적용 K6 ③ R-L8A): 구성은 완만한 사선, 수량은 가지런한 줄 반복(7개 이상 묶음 그대로), 재료는 이름 적힌 재료만 둘레에', () => {
    const purpose = (value: string) => buildShotBrief(shot({ purpose: value, composition: 'front' })).split('\n')[2]
    expect(purpose('group')).toContain('along a gentle diagonal line')
    expect(purpose('group')).toContain('only the components seen in the reference')
    expect(purpose('quantity')).toContain('repeated in neat even rows')
    expect(purpose('quantity')).toContain('For seven or more pieces show a neat stack or bundle')
    expect(purpose('ingredient')).toContain('only the ingredient named below placed around it, never covering the product')
    // 위에서 찍는 구도는 이미 있다(top·flatlay)
    expect(buildShotBrief(shot({ composition: 'top' })).split('\n')[3]).toBe('Camera: straight overhead view')
    expect(buildShotBrief(shot({ composition: 'flatlay' })).split('\n')[3]).toContain('overhead flat lay')
  })

  it('수량 컷만 수를 적는다 — 구성 칸 수는 정확히, 옵션 수는 가장 큰 수 이하, 수가 없으면 지금 글 그대로(적용 K6 R-B7)', () => {
    const purpose = (value: string, quantity?: ShotQuantity) => buildShotBrief(shot({ purpose: value, composition: 'front' }), { quantity }).split('\n')[2]
    expect(purpose('quantity', { exact: 2, noun: 'pieces' })).toMatch(/repeated in neat even rows\. For seven or more pieces .* Show exactly 2 pieces — no more, no fewer\.$/)
    expect(purpose('quantity', { exact: 1, noun: 'set' })).toContain('Show exactly 1 set — no more, no fewer.')
    expect(purpose('quantity', { max: 6, noun: 'pieces' })).toMatch(/ Show no more than 6 pieces\.$/)
    // 수가 없으면(7개 이상·입력 없음) 컷 지시 전체가 지금과 바이트 같다
    expect(buildShotBrief(shot({ purpose: 'quantity', composition: 'front' }), { quantity: null })).toBe(buildShotBrief(shot({ purpose: 'quantity', composition: 'front' })))
    // 수량 컷이 아니면 수를 주어도 그대로다
    for (const other of ['group', 'hero', 'color', 'package']) {
      expect(buildShotBrief(shot({ purpose: other, composition: 'front' }), { quantity: { exact: 2, noun: 'pieces' } }), other).toBe(buildShotBrief(shot({ purpose: other, composition: 'front' })))
    }
  })

  it('사용 장면은 세트에서, 재질·구성은 단색 바탕에서 찍는다', () => {
    for (const purpose of ['scene', 'action', 'state', 'scale']) expect(shotRouteOf(purpose), purpose).toMatchObject({ base: 'usage', stage: 'scene', effectOnly: false })
    expect(shotRouteOf('feature_proof')).toMatchObject({ base: 'feature', stage: 'scene' })
    for (const purpose of ['hero', 'texture', 'underside', 'quantity', 'color', 'group', 'package']) expect(shotRouteOf(purpose), purpose).toMatchObject({ base: 'feature', stage: 'solid', effectOnly: false })
  })

  it('크기 문장은 상품이 나오는 모든 컷에, 접촉 문장은 손·몸이 나오는 컷에만 붙는다(K4 실물 크기 11-05)', () => {
    const size = '9.7cm x 18.3cm'
    const lines = (brief: string) => brief.split('\n')
    // 손·몸·사용·장면 컷은 크기 줄(D와 같은 sizeLine) + 손 쪽 가까이 찍기(오너 메모 11-06 설계 S3), 뒤에 소품 실물 크기
    for (const [purpose, composition] of [['feature_proof', 'in_hand'], ['scale', 'front'], ['action', 'closeup'], ['scene', 'side'], ['hero', 'worn']]) {
      const brief = lines(buildShotBrief(shot({ purpose, composition }), { size }))
      expect(brief, `${purpose}/${composition}`).toContain(`${sizeLine(size)} ${HANDS_TRUE_SCALE}`)
      expect(brief, `${purpose}/${composition}`).not.toContain(trueScaleLine(size))
      expect(brief, `${purpose}/${composition}`).toContain(PROPS_TRUE_SCALE)
    }
    // 손이 없는 확대·재질·정면 컷도 바탕 소품과 견주어진다 — 전에는 크기 줄이 없어 상품이 실물보다 크게 그려졌다
    for (const purpose of ['hero', 'texture', 'feature_proof', 'underside', 'quantity', 'color', 'group', 'package']) {
      for (const composition of ['front', 'closeup', 'top', 'flatlay']) {
        expect(lines(buildShotBrief(shot({ purpose, composition }), { size })), `${purpose}/${composition}`).toContain(trueScaleLine(size))
      }
    }
    // 효과 컷(상품이 주인공이 아닌 문제 장면)은 지금처럼 크기 줄이 없다
    expect(buildShotBrief(shot({ purpose: 'problem', composition: 'front' }), { size })).not.toContain('Real size')
    // 크게 보이려면 카메라를 가까이 — 상품을 키우지 않는다
    expect(trueScaleLine(size).startsWith(`${sizeLine(size)} `)).toBe(true)
    expect(trueScaleLine(size)).toContain('To show the product larger, move the camera closer; never enlarge the product itself.')
    // 치수가 없으면 크기 줄이 없다(지금과 같다)
    expect(buildShotBrief(shot({ composition: 'in_hand' }))).not.toContain('Real size')
    expect(buildShotBrief(shot({ composition: 'closeup' }))).not.toContain('Real size')
    expect(buildShotBrief(shot({ composition: 'worn' }))).toContain('Contact:')
    expect(buildShotBrief(shot({ composition: 'top' }))).not.toContain('Contact:')
  })

  it('치수 이름 풀이·소품 실물 크기(오너 메모 11-06 설계 S1·S2) — K 컷 지시에만, D 목적 블록의 sizeLine은 그대로', () => {
    // 한국어 치수 이름을 영어로 푼다 — 안쪽 지름은 바깥이 더 크고, 펼침·둘레는 놓인 크기가 아니다
    expect(sizeWordsLine('내측 3.2cm, 펼침 7.3cm')).toBe(
      'Size words (reference only, never drawn as text): 내측 = the inner opening — the outside of the product is larger by its wall; ' +
        '펼침 = opened or unfolded — that size applies only when the product is pictured opened.'
    )
    expect(sizeWordsLine('펼쳤을 때 가로 1cm x 세로 9.6cm')).toContain('펼쳤을 때 = opened or unfolded')
    expect(sizeWordsLine('둘레 60cm')).toContain('둘레 = circumference — not a length the product shows')
    expect(sizeWordsLine('접었을 때 5cm')).toContain('접었을 때 = folded')
    // 풀이할 이름이 없으면 줄 없음
    expect(sizeWordsLine('가로 10cm')).toBeNull()
    expect(sizeWordsLine('9.7cm x 18.3cm')).toBeNull()
    // 줄 순서: 크기 줄 → 풀이(있을 때) → 소품
    expect(kSizeLines('내측 3.2cm', false)).toEqual([trueScaleLine('내측 3.2cm'), sizeWordsLine('내측 3.2cm'), PROPS_TRUE_SCALE])
    expect(kSizeLines('가로 10cm', true)).toEqual([`${sizeLine('가로 10cm')} ${HANDS_TRUE_SCALE}`, PROPS_TRUE_SCALE])
    const brief = buildShotBrief(shot({ purpose: 'feature_proof', composition: 'closeup' }), { size: '내측 3.2cm, 펼침 7.3cm' }).split('\n')
    expect(brief).toContain(sizeWordsLine('내측 3.2cm, 펼침 7.3cm'))
    expect(brief).toContain(PROPS_TRUE_SCALE)
    // D 목적 블록과 대표 컷이 쓰는 문장은 바뀌지 않는다
    expect(sizeLine('가로 10cm')).toBe('Real size (reference only, never drawn as text): 가로 10cm. In hand terms, 10cm is about 1 adult palm width. Keep hands and objects in true proportion to it.')
    expect(heroLargeBrief('내측 3.2cm')).not.toContain('Size words')
    expect(heroLargeBrief('내측 3.2cm')).not.toContain(PROPS_TRUE_SCALE)
    // 효과 컷·치수 없음은 지금처럼 크기 줄이 없다
    expect(buildShotBrief(shot({ purpose: 'problem', composition: 'front' }), { size: '내측 3.2cm' })).not.toContain(PROPS_TRUE_SCALE)
    expect(buildShotBrief(shot({ composition: 'in_hand' }))).not.toContain(HANDS_TRUE_SCALE)
  })

  it('사진 다양화(shotvary) 컷에도 크기 줄이 함께 붙는다 — 카메라·사람 줄(B)과 크기 줄(C)이 서로를 바꾸지 않는다', () => {
    const size = '내측 3.2cm, 펼침 7.3cm'
    const base = shot({ purpose: 'scene', composition: 'in_use' })
    const varied = { ...base, camera: { distance: 'wide', height: 'standing' }, person: { framing: 'environment', beat: 'during', face: 'focused' } } as LineShot
    const plain = buildShotBrief(base, { size }).split('\n')
    const withVariety = buildShotBrief(varied, { size }).split('\n')
    // 크기 줄 셋은 그대로 같은 순서로 붙는다
    for (const line of kSizeLines(size, true)) expect(withVariety).toContain(line)
    expect(withVariety.slice(-4, -1)).toEqual(kSizeLines(size, true))
    // 카메라·사람 줄은 다양화 컷에만, 크기 줄을 빼면 나머지 줄 수는 사람 줄 하나만큼 다르다
    expect(withVariety.find((l) => l.startsWith('Camera: '))).toContain('wide shot')
    expect(withVariety.some((l) => l.startsWith('Person: '))).toBe(true)
    expect(plain.some((l) => l.startsWith('Person: '))).toBe(false)
    expect(withVariety.length - plain.length).toBe(1)
  })

  it('확대 컷은 가장자리가 프레임 밖으로 나가고 큰 일상 소품을 두지 않는다(K4 실물 크기 11-05)', () => {
    const camera = buildShotBrief(shot({ composition: 'closeup' })).split('\n').find((line) => line.startsWith('Camera: '))
    expect(camera).toContain('the product edges run past the frame')
    expect(camera).toContain('no full-size everyday objects (cups, books, phones) beside it')
  })

  it('펼친 길이·둘레는 보이는 크기가 아니라 손에 빗대지 않는다(K4 P08 펼침 7.3cm, 11-05)', () => {
    expect(handTermsOf('펼침 7.3cm, 내측 지름 3.2cm')).toBe('3.2cm is about 2 adult finger widths')
    expect(handTermsOf('내측 지름 3.2cm, 펼친 길이 7.3cm')).toBe('3.2cm is about 2 adult finger widths')
    expect(handTermsOf('둘레 30cm, 높이 5cm')).toBe('5cm is about 3 adult finger widths')
    // 크기 줄에는 입력 글 그대로 싣는다 — 펼친 길이라는 이름이 함께 간다
    expect(sizeLine('펼침 7.3cm, 내측 지름 3.2cm')).toContain('Real size (reference only, never drawn as text): 펼침 7.3cm, 내측 지름 3.2cm. In hand terms, 3.2cm is about 2 adult finger widths.')
    // 보이는 치수가 하나도 없으면 손 비유 줄이 없다
    expect(handTermsOf('펼친 길이 7.3cm')).toBeNull()
  })

  it('펼친 상태가 쓰는 모양인 축 이름(펼쳤을 때 가로·세로)은 손 비유에서 빠지지 않는다(P05 오너 11-05)', () => {
    // 시험 자료 글 그대로 — 치수 바로 앞 이름이 '가로'·'세로'라 펼침 이름에 걸리지 않는다
    const size = getPdpTestProduct('P05')!.specSheet.size!
    expect(size).toBe('펼쳤을 때 가로 1cm x 세로 9.6cm')
    expect(handTermsOf(size)).toBe(handTermsOf('가로 1cm x 세로 9.6cm'))
    expect(handTermsOf(size)).toMatch(/^1cm is .+; 9\.6cm is .+$/)
    // 축 이름 없이 바로 붙으면 펼침 이름에 걸린다 — P08 '펼침 7.3cm'과 같은 처리
    expect(handTermsOf('펼쳤을 때 9.6cm')).toBeNull()
  })

  it('대표 컷 블록도 치수가 있으면 실물 크기 줄을 싣고, 크게는 가까이 찍어서다(K4 실물 크기 11-05)', () => {
    const size = '지름 50mm 원형'
    expect(heroLargeBrief(size)).toContain(trueScaleLine(size))
    expect(heroLargeBrief(size)).toContain('Get there by framing closer, not by making the product bigger than it is.')
    expect(buildFrameBrief('top', size)).toContain(trueScaleLine(size))
    // 치수가 없으면 지금과 글자까지 같다(main 75f1edac의 옛 상수·옛 틀 블록)
    const OLD_HERO_LARGE_BRIEF = [
      '[Shot direction]',
      'This block wins over every instruction above about how much of the frame the product fills.',
      'Size: The product is the largest subject and fills at least half of the frame, whole and in sharp focus. If it is worn or held, frame close on that part of the body so the product stays the largest subject.',
    ].join('\n')
    expect(HERO_LARGE_BRIEF).toBe(OLD_HERO_LARGE_BRIEF)
    for (const empty of [undefined, null, '', '  ']) expect(heroLargeBrief(empty), String(empty)).toBe(OLD_HERO_LARGE_BRIEF)
    for (const anchor of ['top', 'bottom'] as const) {
      expect(buildFrameBrief(anchor, '  ')).toBe(buildFrameBrief(anchor))
      expect(buildFrameBrief(anchor).split('\n')).toHaveLength(3)
      expect(buildFrameBrief(anchor)).not.toContain('Real size')
    }
  })

  it('칸의 글은 그리지 않는 참고 글로 싣고, 글이 없으면 그 줄이 없다', () => {
    expect(buildShotBrief(shot({ show: '핀 끝 보호 캡' }))).toContain('Text of this section (reference only, never drawn as text): 핀 끝 보호 캡')
    expect(buildShotBrief(shot())).not.toContain('Text of this section')
  })

  it('크기 컷은 자·화살표·숫자 없이 접촉으로만 보인다(오너 승인 범위)', () => {
    const brief = buildShotBrief(shot({ purpose: 'scale', composition: 'in_hand' }))
    expect(brief).toContain('through contact')
    expect(brief).toContain('No rulers, arrows or numbers')
    expect(brief).not.toMatch(/mug|pen\b/)
  })
})

describe('제품군 문장(적용 K6 T1-80 ①)', () => {
  /** 통합 11-03 16:3x 승인 표 — 근거 있는 제품군과 그 문장이 붙는 목적 */
  const EXPECTED: Record<string, string[]> = {
    apparel: ['feature_proof', 'texture'],
    cosmetic: ['texture'],
    device: ['feature_proof', 'underside'],
    fresh: ['scene', 'texture'],
    processed: ['action', 'scene'],
    kitchen_storage: ['action', 'scene'],
    bedding_fabric: ['scene'],
    home_decor: ['scene'],
    sports_support: ['action', 'scene'],
  }
  const purposes = usedValues('purpose')
  const compositions = usedValues('composition')
  const allFamilies = [...new Set(Object.values(PRODUCT_FAMILIES).flat())]

  it('근거 있는 제품군은 표의 아홉이고 모두 있는 제품군이다. 문장이 붙는 목적은 라이브러리가 쓰는 목적이다', () => {
    expect([...FAMILY_SHOT_FAMILIES].sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const family of FAMILY_SHOT_FAMILIES) expect(allFamilies, family).toContain(family)
    for (const [family, list] of Object.entries(EXPECTED)) {
      expect(purposes.filter((purpose) => familyShotLine(family, purpose) !== null), family).toEqual(list)
      for (const purpose of list) expect(purposes, `${family} ${purpose}`).toContain(purpose)
    }
  })

  it('제품군마다 문장 하나이고, 맞는 목적 컷의 Purpose 줄 끝에만 붙는다 — 다른 줄은 바이트 같다', () => {
    for (const family of FAMILY_SHOT_FAMILIES) {
      const sentences = new Set<string>()
      for (const purpose of purposes) {
        for (const composition of compositions) {
          const target = shot({ purpose, composition, show: '글' })
          const base = buildShotBrief(target, { size: '가로 10cm', category: 'household' }).split('\n')
          const lines = buildShotBrief(target, { size: '가로 10cm', category: 'household', family }).split('\n')
          const sentence = familyShotLine(family, purpose)
          expect(lines.length, `${family} ${purpose}`).toBe(base.length)
          if (!sentence) {
            expect(lines, `${family} ${purpose}`).toEqual(base)
            continue
          }
          sentences.add(sentence)
          expect(lines[2], `${family} ${purpose}`).toBe(`${base[2]} ${sentence}`)
          expect([...lines.slice(0, 2), ...lines.slice(3)], `${family} ${purpose}`).toEqual([...base.slice(0, 2), ...base.slice(3)])
        }
      }
      expect(sentences.size, family).toBe(1)
    }
  })

  it('근거 없는 제품군·제품군 없음·모르는 값은 컷 지시가 바이트 같다(재료 이름이 있어도)', () => {
    const others = [...allFamilies.filter((family) => !FAMILY_SHOT_FAMILIES.includes(family)), undefined, null, '', 'no-such']
    expect(others).toEqual(expect.arrayContaining(['beauty_tool', 'phone_accessory', 'sticker_deco', 'paper_planner', 'gift_wrap', 'pet_goods', 'pet_food', 'garden_diy']))
    for (const family of others) {
      for (const purpose of purposes) {
        for (const composition of compositions) {
          const target = shot({ purpose, composition })
          expect(buildShotBrief(target, { category: 'pet', family, ingredients: ['사과'] }), `${family} ${purpose} ${composition}`).toBe(buildShotBrief(target, { category: 'pet' }))
        }
      }
    }
  })

  it('신선 식품은 입력에 이름이 있는 재료만 적고, 없으면 이름 없는 문장이다. 다른 제품군은 재료 이름을 읽지 않는다', () => {
    expect(familyShotLine('fresh', 'texture', ['사과', '배'])).toBe('Show the fresh food itself (사과, 배) with its natural color and surface, as it comes.')
    expect(familyShotLine('fresh', 'texture', [])).toBe('Show the fresh food itself with its natural color and surface, as it comes.')
    expect(familyShotLine('fresh', 'scene')).toBe(familyShotLine('fresh', 'texture'))
    for (const family of FAMILY_SHOT_FAMILIES.filter((f) => f !== 'fresh')) {
      for (const purpose of EXPECTED[family]) expect(familyShotLine(family, purpose, ['사과']), family).toBe(familyShotLine(family, purpose))
    }
  })

  it('새 문장은 효능·기능성·규제 낱말이 없다 — claim 사전(한글)과 영어 효능 낱말 둘 다', () => {
    const EN_EFFICACY = /moistur|hydrat|whiten|bright|wrinkle|firm|lift|repair|heal|sooth|acne|anti|clinic|derma|effect|result|before|after|treat|cure|relie|pain|medical|certif/i
    for (const family of FAMILY_SHOT_FAMILIES) {
      for (const purpose of EXPECTED[family]) {
        for (const names of [[], ['사과', '배']]) {
          const sentence = familyShotLine(family, purpose, names)!
          expect(claimTermsIn(sentence), `${family} ${purpose}`).toEqual([])
          expect(regulatedClaimTermsIn(sentence), `${family} ${purpose}`).toEqual([])
          expect(sentence, `${family} ${purpose}`).not.toMatch(EN_EFFICACY)
        }
      }
    }
  })
})

describe('만들 컷 목록', () => {
  const hookId = TEMPLATES.find((t) => t.section === 'hook_3step')!.id
  const row = (section: string, templateId: string, shots: OrderedSection['shots']) => ({ section, templateId, shots }) as unknown as OrderedSection

  it('첫 화면 첫 컷은 대표 컷이라 빼고, 못 그리는 섹션의 컷은 만들지 않는다', () => {
    const sections = [
      row('hook_3step', hookId, [{ slot: 'hero', purpose: 'hero', composition: 'front' }]),
      row('sub_div', hookId, [{ slot: 'photo', purpose: 'texture', composition: 'closeup' }]),
      row('cta', hookId, [{ slot: 'photo', purpose: 'scene', composition: 'in_use' }]),
    ]
    const shots = lineShotsOf(sections, new Map(), ['2:' + hookId])
    expect(shots.map((s) => s.key)).toEqual(['k1_photo_0'])
    expect(shots[0]).toMatchObject({ section: 'sub_div', purpose: 'texture', composition: 'closeup', show: '' })
  })

  it('목록 칸은 그 항목의 글을, 일반 칸은 섹션의 글을 싣고 80자에서 줄인다', () => {
    const sections = [row('sub_div', hookId, [
      { slot: 'items.photo', purpose: 'texture', composition: 'closeup' },
      { slot: 'items.photo', purpose: 'scene', composition: 'in_use' },
      { slot: 'photo', purpose: 'hero', composition: 'front' },
    ])]
    const copy = new Map([[0, { headline: '제목', items: [{ title: '첫째' }, { title: '둘째', desc: '설명' }] }]])
    const shots = lineShotsOf(sections, copy as never, [])
    expect(shots.map((s) => s.show)).toEqual(['첫째', '둘째 — 설명', '제목'])
    const long = lineShotsOf(sections.slice(0, 1), new Map([[0, { headline: '가'.repeat(100) }]]) as never, [])
    expect(long[0].show).toHaveLength(81)
  })

  it('비율은 슬롯이 받는 첫 값이고, 라이브러리의 모든 사진 칸이 값을 낸다', () => {
    const allowed = new Set(['3:4', '4:3', '1:1', '2:3'])
    for (const template of TEMPLATES) {
      const slots = template.slots as Record<string, { type: string; fields?: Record<string, { type: string }> }>
      const names = Object.entries(slots).flatMap(([name, def]) => [
        ...(def.type === 'image' ? [name] : []),
        ...(def.type === 'list' ? Object.entries(def.fields ?? {}).flatMap(([field, sub]) => (sub.type === 'image' ? [`${name}.${field}`] : [])) : []),
      ])
      if (names.length === 0) continue
      const shots = lineShotsOf([row(template.section === 'hook_3step' ? 'x' : template.section, template.id, names.map((slot) => ({ slot, purpose: 'hero', composition: 'front' })))], new Map(), [])
      for (const s of shots) expect(allowed.has(s.aspect), `${template.id} ${s.key}`).toBe(true)
    }
  })
})
