import { describe, expect, it } from 'vitest'
import { fitMsPrompt } from './ms-prompt-fit'
import {
  BATH_SAFE_CAMERA,
  BATH_SAFE_CAMERA_OPEN,
  BATH_SAFE_FRAMING,
  NSFW_RETRY_BLOCK,
  NSFW_RETRY_CAMERA,
  NSFW_RETRY_DIRECTION,
  NSFW_RETRY_PERSON,
  NSFW_RETRY_STAGE,
  isBathPersonScene,
  nsfwRetryPrompt,
  sceneSafetyOf,
  withBathSceneSafety,
} from './scene-safety'
import { personLine } from './templatelib/shot-variety'

const BODY_PERSON = personLine({ framing: 'environment', beat: 'before', face: 'glance_away' }, false)
const WAIST_PERSON = personLine({ framing: 'waist_up', beat: 'during', face: 'focused' }, false)
const HANDS_PERSON = personLine({ framing: 'hands', beat: 'during', face: 'none' }, false)
const NO_PERSON = personLine({ framing: 'nobody', beat: 'during', face: 'none' }, false)

/** J59 c5555eff 실패 컷과 같은 꼴의 지시 — 바탕 블록 · 컷 지시 블록 · 감독 줄 */
function cutPrompt(o: { person?: string; stage?: string; show?: string; director?: string; base?: string }): string {
  const shot = [
    '[Shot direction]',
    'This block wins over every instruction above about framing, angle, distance, props, the people shown and how much of the frame the product fills.',
    'Purpose: Show the product in use in a real place where it belongs — not a held-up product shot.',
    'Camera: used in its real place — wide shot — the room around the subject, the main subject still large and clear; camera at standing height looking slightly down',
    ...(o.person ? [o.person] : []),
    o.stage ?? 'Stage: the shared set in "Set description", with at most two small props.',
    // 상품이 나오는 컷의 상품 참조 줄(shot-brief REFS_LINE) — 상품 없는 고민 컷(J68 open)만 없다
    'Refs: any attached images between the first and the last show this same product from other sides.',
    ...(o.show ? [`Text of this section (reference only, never drawn as text): ${o.show}`] : []),
    'Never: added text, numbers or logos beyond what is printed on the product itself.',
  ].join('\n')
  return [o.base ?? 'LIFESTYLE USAGE SHOT:\n- scalp brush being used in its intended environment', shot, ...(o.director ? [o.director] : [])].join('\n\n')
}

const SHOWER_DIRECTOR = 'Art direction: Relaxed person finishing a shower, massaging scalp with the brush in a warm white tiled shower, steam softly present.'
const COUNTER_DIRECTOR =
  'Art direction: Adult with damp lathered hair at the white bathroom counter gently massaging the scalp. Light: Single soft diffused key from top-left. Set: Matte white ceramic bathroom counter.'

describe('① 샤워·목욕 장면 사람 컷 예방 줄(J60)', () => {
  it('몸이 나오는 사람 컷이 샤워 장면이면 Camera 줄을 세면대 앞 가슴 위 구도로, Person 줄 몸 범위를 가슴 위·같은 옷으로 바꾼다(줄 수 그대로)', () => {
    const prompt = cutPrompt({ person: BODY_PERSON, director: SHOWER_DIRECTOR })
    const out = withBathSceneSafety(prompt)
    expect(out).not.toBeNull()
    const before = prompt.split('\n')
    const lines = out!.split('\n')
    expect(lines).toHaveLength(before.length)
    expect(lines).toContain(BATH_SAFE_CAMERA)
    const person = lines.find((l) => l.startsWith('Person: '))!
    expect(person).toContain(`In this cut: ${BATH_SAFE_FRAMING}; the moment just before use`)
    expect(person).not.toContain('seen whole within the place')
    // Camera·Person 줄 말고는 그대로(감독 줄·목적·무대)
    expect(lines.filter((l, i) => l !== before[i])).toHaveLength(2)
    // 바꾼 지시에 다시 해도 더 바뀌지 않는다
    expect(withBathSceneSafety(out!)).toBeNull()
    expect(sceneSafetyOf(prompt, false)).toEqual({ prompt: out, kind: 'bath' })
    expect(out!.length - prompt.length).toBeLessThan(120)
  })

  it('장면 글은 무대 줄·섹션 글(한글)·감독 줄 어디서든 읽는다', () => {
    expect(isBathPersonScene(cutPrompt({ person: WAIST_PERSON, stage: 'Stage: a real place that fits "샤워" — another real place where it is.' }))).toBe(true)
    expect(isBathPersonScene(cutPrompt({ person: WAIST_PERSON, show: '물에 젖는 샤워 중에도\n방수 기능으로 편히 써요.' }))).toBe(true)
    expect(isBathPersonScene(cutPrompt({ person: BODY_PERSON, director: 'Art direction: Person relaxing in a bathtub with the brush.' }))).toBe(true)
    expect(isBathPersonScene(cutPrompt({ person: BODY_PERSON, show: '반신욕하며 목욕 시간에' }))).toBe(true)
  })

  it('샤워·목욕 장면이 아니면 바이트 그대로 — 욕실 카운터·선반 세트, 바탕 블록에만 있는 낱말', () => {
    expect(withBathSceneSafety(cutPrompt({ person: BODY_PERSON, director: COUNTER_DIRECTOR }))).toBeNull()
    expect(withBathSceneSafety(cutPrompt({ person: BODY_PERSON, base: 'LIFESTYLE USAGE SHOT:\n- 카테고리 뷰티>바디>샤워/입욕용품' }))).toBeNull()
    expect(withBathSceneSafety(cutPrompt({ person: BODY_PERSON }))).toBeNull()
    expect(sceneSafetyOf(cutPrompt({ person: BODY_PERSON, director: COUNTER_DIRECTOR }), false)).toBeNull()
  })

  it('손만·사람 없는 컷, Person 줄이 없는 지시는 샤워 장면이어도 그대로', () => {
    expect(withBathSceneSafety(cutPrompt({ person: HANDS_PERSON, director: SHOWER_DIRECTOR }))).toBeNull()
    expect(withBathSceneSafety(cutPrompt({ person: NO_PERSON, director: SHOWER_DIRECTOR }))).toBeNull()
    expect(withBathSceneSafety(cutPrompt({ director: SHOWER_DIRECTOR }))).toBeNull()
  })

  it('바꾸는 글은 긍정 서술이다 — 노출·금지 낱말을 나열하지 않는다', () => {
    expect(`${BATH_SAFE_CAMERA} ${BATH_SAFE_FRAMING}`).not.toMatch(/\b(no|not|never|nude|naked|bare|skin|body|shower|bath)\b/i)
    expect(NSFW_RETRY_DIRECTION).not.toMatch(/\b(no|not|never|nude|naked|bare|skin|shower|bath)\b/i)
    expect(NSFW_RETRY_STAGE).not.toMatch(/\b(shower|bath|bathroom)\b/i)
  })
})

describe('② nsfw 재시도 지시(J60)', () => {
  it('사람·구도·무대·감독 지시를 욕실 밖 손 구도로 바꾼다(예방 구도도 덮는다) — 나머지 줄은 그대로', () => {
    const prompt = withBathSceneSafety(cutPrompt({ person: BODY_PERSON, director: SHOWER_DIRECTOR, show: '오늘 저녁 샤워부터' }))!
    const out = nsfwRetryPrompt(prompt)
    const lines = out.split('\n')
    expect(lines).toContain(NSFW_RETRY_PERSON)
    expect(lines).toContain(NSFW_RETRY_CAMERA)
    expect(lines).toContain(NSFW_RETRY_STAGE)
    expect(lines).toContain(`Art direction: ${NSFW_RETRY_DIRECTION}`)
    expect(lines).not.toContain(BATH_SAFE_CAMERA)
    expect(out).not.toContain(BATH_SAFE_FRAMING)
    expect(out).not.toContain('tiled shower')
    expect(out).toContain('Purpose: Show the product in use')
    expect(out).toContain('Text of this section (reference only, never drawn as text): 오늘 저녁 샤워부터')
    expect(out).not.toContain(NSFW_RETRY_BLOCK)
    expect(sceneSafetyOf(prompt, true)).toEqual({ prompt: out, kind: 'nsfw-retry' })
  })

  it('감독 줄의 빛 규칙(Light)은 남기고 세트(Set)는 뺀다', () => {
    const out = nsfwRetryPrompt(cutPrompt({ person: WAIST_PERSON, director: COUNTER_DIRECTOR }))
    expect(out.split('\n')).toContain(`Art direction: ${NSFW_RETRY_DIRECTION} Light: Single soft diffused key from top-left.`)
    expect(out).not.toContain('Set: Matte white ceramic bathroom counter')
  })

  it('사람 없는 컷의 Person 줄은 그대로 두고, 바꿀 줄이 없는 지시는 안전 장면 블록을 끝에 붙인다', () => {
    expect(nsfwRetryPrompt(cutPrompt({ person: NO_PERSON, director: SHOWER_DIRECTOR })).split('\n')).toContain(NO_PERSON)
    const plain = 'LIFESTYLE USAGE SHOT:\n- scalp brush being used in a steamy shower'
    expect(nsfwRetryPrompt(plain)).toBe(`${plain}\n\n${NSFW_RETRY_BLOCK}`)
  })

  it('MS 5,000자 맞추기 — 바꾼 줄은 덜리지 않는 블록에 있어 맞춘 뒤에도 남는다', () => {
    const filler = Array.from({ length: 12 }, (_, i) => `Photography setup ${i}: ${'soft daylight studio rule. '.repeat(20)}`).join('\n\n')
    const long = cutPrompt({ person: BODY_PERSON, director: SHOWER_DIRECTOR }).replace('\n\n[Shot direction]', `\n\n${filler}\n\n[Shot direction]`)
    expect(long.length).toBeGreaterThan(5000)
    const bath = fitMsPrompt(withBathSceneSafety(long)!)
    expect(bath.fits).toBe(true)
    expect(bath.prompt).toContain(BATH_SAFE_CAMERA)
    expect(bath.prompt).toContain(BATH_SAFE_FRAMING)
    const retry = fitMsPrompt(nsfwRetryPrompt(long))
    expect(retry.fits).toBe(true)
    expect(retry.prompt).toContain(NSFW_RETRY_PERSON)
    expect(retry.prompt).toContain(`Art direction: ${NSFW_RETRY_DIRECTION}`)
  })
})

/** J61 컷 확인 c5555eff k2(끔)과 같은 꼴의 상품 없는 고민 컷 — 바탕 블록 Context 줄(카피 질문 여러 줄) · Person·Refs 줄 없는 컷 지시 · 감독 줄 */
function problemPrompt(o: { context?: string; scene?: string; person?: string; stage?: string } = {}): string {
  const base = [
    'PROBLEM SCENARIO IMAGE:',
    `Context: ${o.context ?? '샤워할 때 머리 감고도\n정수리가 답답한가요?'}`,
    `Category-specific scene: ${o.scene ?? 'Person at vanity mirror examining skin texture'}`,
    'Visual Elements:',
    '- The scene should feel WARM and INVITING despite depicting a problem',
  ].join('\n')
  const shot = [
    '[Shot direction]',
    'This block wins over every instruction above about framing, angle, distance, props, the people shown and how much of the frame the product fills.',
    'Purpose: Show the everyday inconvenience named below — without this product.',
    'Camera: used in its real place — wide shot — the room around the subject, the main subject still large and clear; camera at eye level',
    ...(o.person ? [o.person] : []),
    o.stage ?? 'Stage: a real place that fits "정수리 개운함" — if the product is not used there, another real place where it is.',
    'Text of this section (reference only, never drawn as text): 손으로감아도\n두피가덜씻겨',
    'Never: added text, numbers or logos beyond what is printed on the product itself.',
  ].join('\n')
  return [base, 'DO NOT show the product itself in this image.', shot, 'Art direction: Light: Single soft diffused key from top-left. Set: Matte white ceramic bathroom counter.'].join('\n\n')
}

describe('① 섹션 글(Context)·사람 줄 없는 고민 컷까지(J68)', () => {
  it('Context 줄이 샤워를 말하는 상품 없는 고민 컷은 Camera 줄 하나만 세면대 앞 가슴 위·긴소매 윗옷 구도로 바꾼다', () => {
    const prompt = problemPrompt()
    const out = withBathSceneSafety(prompt)
    expect(out).not.toBeNull()
    const before = prompt.split('\n')
    const lines = out!.split('\n')
    expect(lines).toHaveLength(before.length)
    expect(lines.filter((l, i) => l !== before[i])).toEqual([BATH_SAFE_CAMERA_OPEN])
    expect(withBathSceneSafety(out!)).toBeNull()
    expect(sceneSafetyOf(prompt, false)).toEqual({ prompt: out, kind: 'bath' })
    expect(out!.length - prompt.length).toBeLessThan(120)
  })

  it('Context 줄 다음 카피 줄도 읽고, 카테고리 고정 장면 줄·목록 줄은 읽지 않는다', () => {
    expect(isBathPersonScene(problemPrompt({ context: '손으로 감아도\n샤워 뒤에도 찝찝한가요?' }))).toBe(true)
    expect(isBathPersonScene(problemPrompt({ context: '머리를 감고도\n정수리가 답답한가요?' }))).toBe(false)
    expect(isBathPersonScene(problemPrompt({ context: '머리를 감고도', scene: 'Person after a shower at the mirror' }))).toBe(false)
  })

  it('고민 컷에 Person 줄이 있으면 그 갈래대로 — 몸 컷은 J60 구도, 손만·사람 없음은 그대로', () => {
    expect(withBathSceneSafety(problemPrompt({ person: BODY_PERSON }))!.split('\n')).toContain(BATH_SAFE_CAMERA)
    expect(withBathSceneSafety(problemPrompt({ person: HANDS_PERSON }))).toBeNull()
    expect(withBathSceneSafety(problemPrompt({ person: NO_PERSON }))).toBeNull()
  })

  it('상품 컷(Refs 줄)은 Person 줄이 없으면 Context가 샤워를 말해도 그대로, 몸 컷이면 J60 구도', () => {
    const context = 'FEATURE IMAGE:\nContext: 물에 젖는 샤워 중에도\n- clean product shot'
    expect(withBathSceneSafety(cutPrompt({ base: context }))).toBeNull()
    expect(withBathSceneSafety(cutPrompt({ base: context, person: WAIST_PERSON }))!.split('\n')).toContain(BATH_SAFE_CAMERA)
  })

  it('컷 지시 블록이 없는 지시는 그대로, 바꾸는 글은 긍정 서술이다', () => {
    expect(withBathSceneSafety('PROBLEM SCENARIO IMAGE:\nContext: 샤워할 때 머리 감고도')).toBeNull()
    expect(BATH_SAFE_CAMERA_OPEN).not.toMatch(/\b(no|not|never|nude|naked|bare|skin|body|shower|bath|towel)\b/i)
  })
})
