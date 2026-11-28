/**
 * 보여 줄 동작·설계(하네스 J63, 통합 decide 42) — 칸 글의 동작·설계 낱말을 낱말표로 고르고(사실 문, LLM 없음) 컷 지시·움직이는 칸·고르기에 싣는다.
 * 순수 함수·태스크 짜기만 본다(이미지·LLM·DB 콜 0). 예문은 J59 P03 칸 글 그대로다(켬 c5555eff·끔 808be0b1).
 */

import { describe, expect, it, vi } from 'vitest'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures, type EnrichmentFeature } from '../enrichment-switch'
import { BEAT_FIRST_LINE, buildMotionPickPrompt, type MotionCandidate } from '../motion/pick'
import { gifPromptOf, MOTION_BEAT_SIZE_LINE } from '../motion/stage'
import { withShowBeat, type MotionTask } from '../motion/task'
import { buildImageTasks } from '../pdp-image-tasks'
import type { PdpJobRow } from '../pdp-state'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from '../__golden__/golden-harness'
import { planMotion } from './line-plan'
import { buildShotBrief, type LineShot } from './shot-brief'
import { canShowBeat, showBeatAction, showBeatCutsOf, showBeatFactsOf, showBeatLine, showBeatOf } from './show-beat'
import type { ShotPerson } from './shot-variety'

/** P03 상품 사실 꼴 — 사용 순서 입력(J59 Usage steps 줄)·핵심 특징 */
const SPEC = {
  keyFeatures: ['실리콘 탄성 돌기', '일체형 손잡이', '생활방수'],
  material: '실리콘, ABS',
  usageSteps: [
    { title: '거품 내기 및 입체 손잡이 쥐기', description: '미온수로 모발을 적셔 거품을 살짝 냅니다.' },
    { title: '돌기면으로 두피 문지르기', description: '작은 원을 그리듯 가볍게 문지릅니다.' },
  ],
}
const FACTS = showBeatFactsOf(SPEC)

/** J59 칸 글 */
const RUB_SPACELESS = '두피를문지르는모습'
const FLEX_COPY = '적당한탄성모\n부드러운자극 — 탄성 — 손톱으로 긁을 걱정 없이\n힘 조절도 한결 수월합니다. — 유연한 탄성모가\n두피에 부드럽게 닿아요.'
const REACH_COPY = '구석까지 닿는\n실리콘 미세모 — 손가락이 닿지 않는 모공 사이까지 구석구석 시원하게 쓸어내요.'
const DEMO_COPY = '거품낸두피에\n직접문질러본모습 — 한 손에 쏙 들어오는 손잡이라\n미끄러짐 없이 문지르기 편해요.'

const person = (beat: ShotPerson['beat'], framing: ShotPerson['framing'] = 'hands'): ShotPerson => ({ framing, beat, face: 'none' })
const shot = (key: string, purpose: string, composition: string, show: string, extra: Partial<LineShot> = {}): LineShot => ({
  key,
  section: 'point_div',
  purpose,
  composition,
  aspect: '1:1',
  show,
  ...extra,
})

describe('낱말표·사실 문(showBeatOf)', () => {
  it('붙어 온 카피도 잡는다 — 띄어 쓴 글과 같은 동작이다(J62)', () => {
    expect(showBeatOf(RUB_SPACELESS, FACTS)?.id).toBe('rub')
    expect(showBeatOf('두피를 문지르는 모습', FACTS)).toEqual(showBeatOf(RUB_SPACELESS, FACTS))
    expect(showBeatOf(DEMO_COPY, FACTS)?.id).toBe('rub')
  })

  it('카피에서 먼저 나오는 낱말을 쓴다 — 제목의 탄성이 본문의 닿음보다 먼저다', () => {
    expect(showBeatOf(FLEX_COPY, FACTS)?.id).toBe('flex')
    expect(showBeatOf(REACH_COPY, FACTS)?.id).toBe('reach')
  })

  it('사실에 없는 동작은 만들지 않는다 — 사실 글에 같은 줄기가 없으면 null', () => {
    const noRub = showBeatFactsOf({ keyFeatures: ['일체형 손잡이'] })
    expect(showBeatOf(RUB_SPACELESS, noRub)).toBeNull()
    expect(showBeatOf(FLEX_COPY, showBeatFactsOf({ keyFeatures: ['일체형 손잡이'] }))?.id).not.toBe('flex')
    expect(showBeatOf(RUB_SPACELESS, '')).toBeNull()
    expect(showBeatOf('', FACTS)).toBeNull()
    // 영어 사실(식별 메모)도 사실이다
    expect(showBeatOf(RUB_SPACELESS, showBeatFactsOf({ identityNote: 'Massage the scalp in small circles.' }))?.id).toBe('rub')
  })

  it('동작·설계 낱말이 없는 칸 글은 null(지시 그대로)', () => {
    expect(showBeatOf('취향에맞게고르는\n브러시옵션', FACTS)).toBeNull()
    expect(showBeatOf('85mmx80mm', FACTS)).toBeNull()
  })

  it('문구는 짧은 영어 한 문장이고, 움직이는 칸 동작은 문구 + 칸 글 첫 줄이다', () => {
    const beat = showBeatOf(FLEX_COPY, FACTS)!
    expect(showBeatLine(beat)).toBe(`Show plainly: ${beat.phrase}.`)
    expect(showBeatLine(beat).length).toBeLessThanOrEqual(90)
    expect(showBeatAction(beat, FLEX_COPY)).toBe(`${beat.phrase} (section text: 적당한탄성모)`)
  })
})

describe('섹션마다 한 컷(showBeatCutsOf)', () => {
  it('손·사용 컷만 받는다 — 재질 근접·밑면·사람 없음은 받지 않는다', () => {
    expect(canShowBeat(shot('k1_a_0', 'action', 'in_hand', ''))).toBe(true)
    expect(canShowBeat(shot('k1_a_0', 'demo', 'front', '', { person: person('after') }))).toBe(true)
    expect(canShowBeat(shot('k1_a_0', 'texture', 'closeup', '', { person: person('during', 'waist_up') }))).toBe(false)
    expect(canShowBeat(shot('k1_a_0', 'underside', 'front', ''))).toBe(false)
    expect(canShowBeat(shot('k1_a_0', 'scene', 'front', '', { person: person('during', 'nobody') }))).toBe(false)
  })

  it('같은 섹션(k 번호)은 첫 받을 수 있는 컷 하나, 같은 이름 섹션 셋은 따로, 매크로뿐인 섹션은 없음', () => {
    const shots = [
      shot('k4_shots_photo_0', 'texture', 'closeup', REACH_COPY),
      shot('k4_shots_photo_1', 'texture', 'closeup', REACH_COPY),
      shot('k5_photo_0', 'texture', 'closeup', FLEX_COPY, { person: person('after', 'waist_up') }),
      shot('k5_detail_0', 'action', 'in_hand', FLEX_COPY, { person: person('after') }),
      shot('k5_extra_0', 'action', 'in_hand', FLEX_COPY),
      shot('k10_photo_0', 'demo', 'front', DEMO_COPY, { section: 'compare', person: person('after') }),
    ]
    const cuts = showBeatCutsOf(shots, FACTS)
    expect([...cuts.keys()]).toEqual(['k5_detail_0', 'k10_photo_0'])
    expect(cuts.get('k5_detail_0')!.id).toBe('flex')
    expect(cuts.get('k10_photo_0')!.id).toBe('rub')
  })
})

describe('컷 지시(buildShotBrief showBeat)', () => {
  it('Purpose 줄 끝에 한 문장만 붙고, 없으면 지금 바이트 그대로다', () => {
    const s = shot('k10_photo_0', 'demo', 'front', DEMO_COPY, { person: person('after') })
    const off = buildShotBrief(s, { size: '85mm x 80mm', category: 'beauty' })
    const line = showBeatLine(showBeatOf(DEMO_COPY, FACTS)!)
    const on = buildShotBrief(s, { size: '85mm x 80mm', category: 'beauty', showBeat: line })
    expect(on.split('\n').find((l) => l.startsWith('Purpose: '))!.endsWith(` ${line}`)).toBe(true)
    expect(on.replace(` ${line}`, '')).toBe(off)
  })
})

describe('showbeat 태스크(buildImageTasks)', () => {
  const SHOTS: LineShot[] = [
    shot('k5_photo_0', 'texture', 'closeup', FLEX_COPY),
    shot('k5_detail_0', 'action', 'in_hand', FLEX_COPY, { person: person('after') }),
    shot('k10_photo_0', 'demo', 'front', DEMO_COPY, { section: 'compare', person: person('during') }),
    shot('k14_lead_0', 'hero', 'front', '취향에맞게고르는\n브러시옵션', { section: 'option_gallery' }),
  ]
  /** 카드 USE 줄·카피 howTo — 비우면 spec만(1단계 꼴) */
  interface Sources {
    use?: string
    howTo?: Array<{ step: string; description: string }>
  }
  function jobOf(features: EnrichmentFeature[], spec: Partial<PdpJobRow['spec_sheet']> = SPEC, sources: Sources = {}): PdpJobRow {
    const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
    const final = job.copy_sections.final
    return {
      ...job,
      spec_sheet: { ...job.spec_sheet, ...spec },
      design_prompts: { ...job.design_prompts, ...(sources.use ? { identity_use: sources.use } : {}) },
      copy_sections: { ...job.copy_sections, ...(final ? { final: { ...final, howTo: sources.howTo ?? [] } } : {}) },
      analysis: { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis'],
      section_plan: { ...job.section_plan, templatelib: { shots: SHOTS } } as PdpJobRow['section_plan'],
    }
  }
  const lineTasks = (features: EnrichmentFeature[], spec?: Partial<PdpJobRow['spec_sheet']>, sources?: Sources) =>
    new Map(buildImageTasks(jobOf(features, spec, sources)).filter((task) => task.shotBrief).map((task) => [task.section, task]))
  const NO_SPEC = { keyFeatures: [], material: 'ABS', usageSteps: [], identityNote: '', usageLocation: '' }

  it('꺼진 잡은 사실이 있어도 태스크가 그대로이고, 켜진 잡은 섹션마다 한 컷의 Purpose·Person 단계만 바뀐다', () => {
    const off = lineTasks(['templatelib'])
    const on = lineTasks(['templatelib', 'showbeat'])
    expect([...on.keys()]).toEqual([...off.keys()])
    const flexLine = showBeatLine(showBeatOf(FLEX_COPY, FACTS)!)
    const rubLine = showBeatLine(showBeatOf(DEMO_COPY, FACTS)!)
    for (const [key, task] of on) {
      const before = off.get(key)!
      if (key === 'k5_detail_0') {
        expect(task.shotBrief).toContain(` ${flexLine}`)
        // 쓴 직후 → 쓰는 중
        expect(before.shotBrief).toContain('just after use, relaxed')
        expect(task.shotBrief!.replace(` ${flexLine}`, '').replace('; the moment of use.', '; just after use, relaxed.')).toBe(before.shotBrief)
      } else if (key === 'k10_photo_0') {
        expect(task.shotBrief!.replace(` ${rubLine}`, '')).toBe(before.shotBrief)
        expect(task.shotBrief).not.toBe(before.shotBrief)
      } else {
        expect(task, key).toEqual(before)
      }
      // 다른 값은 같고, 문장을 받은 컷만 길이 가드용 문장 칸이 붙는다
      const { showBeatLine: line, showBeatSource: source, ...rest } = task
      expect(line, key).toBe(key === 'k5_detail_0' ? flexLine : key === 'k10_photo_0' ? rubLine : undefined)
      expect(source, key).toBe(line ? 'spec' : undefined)
      expect({ ...rest, shotBrief: '' }, key).toEqual({ ...before, shotBrief: '' })
    }
  })

  it('켜진 잡이어도 사실 글(spec·카드·howTo)이 없으면 그대로다', () => {
    expect(lineTasks(['templatelib', 'showbeat'], NO_SPEC)).toEqual(lineTasks(['templatelib'], NO_SPEC))
  })

  it('J63 2단계 — spec에 사실이 없어도(P03: ABS뿐) 카드 USE 줄·카피 howTo가 사실 문이 되고, 출처를 남긴다', () => {
    // 카드 USE 줄(사진 판독)만 — 문지르기·탄성은 카드에 줄기가 없어 받지 않고, 탄성 카피 본문의 '닿아요'는 카드 bristles로 구석 닿음(reach)을 받는다
    const card = lineTasks(['templatelib', 'showbeat'], NO_SPEC, { use: 'Hand holds the rear grip knob between fingers, pressing the bristles against the scalp to brush.' })
    expect(card.get('k10_photo_0')!.showBeatLine).toBeUndefined()
    expect(card.get('k5_detail_0')).toMatchObject({ showBeatSource: 'card' })
    expect(card.get('k5_detail_0')!.showBeatLine).toContain('narrow gaps')
    // 카피 howTo(사용 순서)만 — 문지르기·탄성 줄기가 있어 받는다
    const howTo = [
      { step: '거품 내기', description: '미온수로 모발을 적셔 거품을 냅니다.' },
      { step: '두피 문지르기', description: '유연한 탄성 돌기로 작은 원을 그리듯 문지릅니다.' },
    ]
    const steps = lineTasks(['templatelib', 'showbeat'], NO_SPEC, { howTo })
    expect(steps.get('k10_photo_0')).toMatchObject({ showBeatSource: 'howto' })
    expect(steps.get('k10_photo_0')!.showBeatLine).toBe(showBeatLine(showBeatOf(DEMO_COPY, FACTS)!))
    expect(steps.get('k5_detail_0')).toMatchObject({ showBeatSource: 'howto' })
    // 우선순위 spec → 카드 → howTo — 같은 낱말이 둘 다에 있으면 앞 출처
    const both = lineTasks(['templatelib', 'showbeat'], { ...NO_SPEC, keyFeatures: ['실리콘 탄성 돌기'] }, { howTo })
    expect(both.get('k5_detail_0')).toMatchObject({ showBeatSource: 'spec' })
    expect(both.get('k10_photo_0')).toMatchObject({ showBeatSource: 'howto' })
    // 꺼진 잡은 출처가 있어도 그대로다
    expect(lineTasks(['templatelib'], NO_SPEC, { howTo, use: 'grip knob' })).toEqual(lineTasks(['templatelib'], NO_SPEC))
  })
})

describe('움직이는 칸', () => {
  const gif: MotionTask = { action: RUB_SPACELESS, mode: 'gif', loop: 'back_and_forth', optionPhotos: [] }
  const beat = showBeatOf(RUB_SPACELESS, FACTS)

  it('GIF 칸만 동작 줄을 문구로 바꾸고 표지를 단다 — 대표 칸·옵션 밀기·동작 없음은 받은 값 그대로', () => {
    const on = withShowBeat(gif, beat, RUB_SPACELESS)!
    expect(on).toEqual({ ...gif, action: `${beat!.phrase} (section text: ${RUB_SPACELESS})`, beatShown: true })
    expect(beat!.source).toBe('spec')
    expect(withShowBeat(gif, null, RUB_SPACELESS)).toBe(gif)
    const hero: MotionTask = { ...gif, role: 'hero' }
    expect(withShowBeat(hero, beat, RUB_SPACELESS)).toBe(hero)
    const slide: MotionTask = { ...gif, mode: 'slide' }
    expect(withShowBeat(slide, beat, RUB_SPACELESS)).toBe(slide)
    expect(withShowBeat(undefined, beat, RUB_SPACELESS)).toBeUndefined()
  })

  it('GIF 지시는 표지가 있을 때만 크기 줄 하나를 더한다', () => {
    const plain = gifPromptOf('BASE', gif)
    expect(plain).not.toContain(MOTION_BEAT_SIZE_LINE)
    const on = gifPromptOf('BASE', withShowBeat(gif, beat, RUB_SPACELESS)!)
    expect(on.split('\n').filter((l) => l === `- ${MOTION_BEAT_SIZE_LINE}`)).toHaveLength(1)
    expect(on.replace(`\n- ${MOTION_BEAT_SIZE_LINE}`, '').replace(withShowBeat(gif, beat, RUB_SPACELESS)!.action, RUB_SPACELESS)).toBe(plain)
  })

  it('고르기 프롬프트는 보여 줄 동작이 있는 후보만 이름을 달고 먼저 고르라는 줄을 붙인다 — 없으면 지금 그대로', () => {
    const candidates: MotionCandidate[] = [
      { key: 'k3_photo_0', section: 'solution_guide', purpose: 'action', composition: 'in_hand', show: '틈새 물때 줄인', kinds: ['use', 'transform', 'assemble'] },
      { key: 'k17_clip_0', section: 'motion_band', purpose: 'action', composition: 'in_hand', show: RUB_SPACELESS, kinds: ['use'] },
    ]
    const off = buildMotionPickPrompt({ product: '브러쉬', candidates, max: 1 })
    expect(off).not.toContain(BEAT_FIRST_LINE)
    const marked = candidates.map((c) => (c.key === 'k17_clip_0' ? { ...c, beat: '문지르기' } : c))
    const on = buildMotionPickPrompt({ product: '브러쉬', candidates: marked, max: 1 })
    expect(on.split('\n').filter((l) => l === BEAT_FIRST_LINE)).toHaveLength(1)
    expect(on).toContain(`칸 글: ${RUB_SPACELESS} · 보여 줄 동작: 문지르기`)
    expect(on.replace(`\n${BEAT_FIRST_LINE}`, '').replace(' · 보여 줄 동작: 문지르기', '')).toBe(off)
  })

  it('계획은 사실 글을 받은 잡만 후보에 이름을 단다 — 없으면 후보가 지금 그대로다', async () => {
    const shots: LineShot[] = [shot('k2_photo_0', 'action', 'in_hand', RUB_SPACELESS)]
    const opts = { product: '브러쉬', textBearing: false, optionPhotos: 0, hasBand: false }
    const sent = async (extra: object) => {
      const pick = vi.fn(async () => ({ picks: [], costUsd: 0, error: null }))
      await planMotion(shots, { ...opts, ...extra }, pick)
      return ((pick.mock.calls[0] as unknown[])[0] as { candidates: MotionCandidate[] }).candidates
    }
    expect((await sent({}))[0]).not.toHaveProperty('beat')
    expect((await sent({ beatFacts: [{ source: 'spec', text: FACTS }] }))[0].beat).toBe('문지르기')
  })
})

describe('showbeat 스위치', () => {
  it('J69로 기본 on·K4 목록 안 — 운영(Vercel·작업자)도 켜지고(SKIP 무시), K 잡에서만 기록하며 K가 아니면 빠지고, 로컬 SKIP으로 끈다', () => {
    expect(ENRICHMENT_DEFAULTS.showbeat).toBe(true)
    expect(K4_SWITCHED_ON).toContain('showbeat')
    expect(resolveEnabledFeatures({})).toContain('showbeat')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('showbeat')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toContain('showbeat')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'showbeat' })).toContain('showbeat')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_SKIP: 'showbeat' })).toContain('showbeat')
    // 로컬 대조군 — SKIP에 이 이름 하나만 적으면 나머지 기본값은 그대로다
    const off = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'showbeat' })
    expect(off).not.toContain('showbeat')
    expect(resolveEnabledFeatures({}).filter((f) => f !== 'showbeat')).toEqual(off)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('showbeat')
  })
})
