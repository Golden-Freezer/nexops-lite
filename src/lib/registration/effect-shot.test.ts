/**
 * 이미지 지시 효능 맞춤(하네스 J53, 통합 decide 32 — 오너 11-11 00:0x '이미지를 생성할 때도 이런 표현이 잘 반영되고').
 * - 스위치 없음: 뷰티·생활 feature_focus의 전후 → 사용 직후 한 순간(한 장), 청결 규칙·게이트 얼룩에 '깨끗한 거품·물방울은 얼룩 아님'
 * - 스위치 effectshot(처음 기본 off, J65로 기본 on): 기능·사용 컷 Purpose 끝 체감 결과 한 문장, 움직이는 칸 고르기의 효과 보이는 use 먼저
 * - 효능 칸 글(J50으로 풀림)은 컷 지시 Text 줄에 그대로 실린다(J52 ①-1)
 * 순수 함수·태스크 짜기만 본다(이미지·LLM·DB 콜 0).
 */

import { describe, expect, it, vi } from 'vitest'
import { buildVisionGatePrompt, buildRegenDirective } from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'
import { buildFeaturePrompt, CATEGORY_IMAGE_DIRECTIVES, getPhotographyBase } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { ENRICHMENT_DEFAULTS, K4_SWITCHED_ON, resolveEnabledFeatures, type EnrichmentFeature } from './enrichment-switch'
import { buildMotionPickPrompt, USE_FIRST_LINE, type MotionCandidate } from './motion/pick'
import { buildImageTasks } from './pdp-image-tasks'
import type { PdpJobRow } from './pdp-state'
import { buildShotBrief, EFFECT_SHOT_LINE, type LineShot } from './templatelib/shot-brief'
import { planMotion } from './templatelib/line-plan'
import { fixtureToJob, loadEnrichmentFixture, rewindTo } from './__golden__/golden-harness'

/** J50으로 풀린 체감 효능 칸 글(A 실측: claim-lexicon이 막지 않는 예문) */
const EFFECT_TEXT = '묵은 각질 제거로 매끈한 피부결'
const TEXT_LINE = `Text of this section (reference only, never drawn as text): ${EFFECT_TEXT}`

const shot = (purpose: string, composition = 'front', show = EFFECT_TEXT): LineShot => ({ key: `k_${purpose}`, section: 'point_div', purpose, composition, aspect: '1:1', show })

describe('스위치 없음 — 전후 지시·거품은 얼룩 아님', () => {
  it('뷰티·생활 feature_focus에 전후가 없고 사용 직후 한 순간(한 장, 분할·콜라주 없음)이다', () => {
    for (const category of ['beauty', 'household']) {
      const focus = CATEGORY_IMAGE_DIRECTIVES[category].feature_focus!
      expect(focus, category).not.toMatch(/before\/after (skin detail|tidiness)/)
      expect(focus, category).toContain('right after use in one photo (no split before/after)')
      const prompt = buildFeaturePrompt({ featureTitle: EFFECT_TEXT, featureDescription: EFFECT_TEXT, bgSub: '#fff', category }).prompt
      expect(prompt, category).toContain(`Category focus guide: ${focus}`)
      expect(prompt, category).not.toContain('before/after skin detail')
    }
  })

  it('청결 규칙은 깨끗한 거품·물방울을 얼룩으로 보지 않고, 때·각질 덩어리는 계속 그리지 않는다(인쇄 상품 판 포함)', () => {
    for (const textBearing of [false, true]) {
      const base = getPhotographyBase(textBearing)
      expect(base).toContain('absolutely NO stains, dirt, grime')
      expect(base).toContain('- Foam and water drops are not stains; no dirt or skin flakes.')
    }
  })

  it('MS 2k 여유(J53 실측, P02 462d097d 재현 31컷) — 더한 줄은 상한 안 고민 컷의 남은 72자 안이고, 체감 결과 문장은 가장 긴 컷의 여유(293자) 안이다', () => {
    // 그 잡의 고민 컷은 맞추기 없이 4,928자였다 — 72자를 넘기면 사진 기본 블록 하나를 더 덜게 된다. 지금 줄은 줄바꿈 포함 63자(4,991자)
    const cleanLine = '\n- Foam and water drops are not stains; no dirt or skin flakes.'
    expect(getPhotographyBase()).toContain(cleanLine)
    expect(cleanLine.length).toBeLessThanOrEqual(72)
    // 모든 덜기 단계 뒤 가장 긴 컷(기능 컷)이 4,707자 — 켜진 잡은 문장 + 빈칸만큼 길어져 4,860자(여유 140)
    expect(EFFECT_SHOT_LINE.length + 1).toBeLessThanOrEqual(5000 - 4707)
  })

  it('게이트 얼룩 기준 (a)와 얼룩 재생성 지시도 거품·물방울은 얼룩이 아니라고 말한다', () => {
    expect(buildVisionGatePrompt(['k1'])).toContain(
      '(a) dirty stains, mold-like brown/gray blotches, or grime on the product (critical for a hygiene product) — clean foam, lather, water droplets or a foamy wet brush from normal use are not stains;'
    )
    expect(buildRegenDirective({ artifact_reason: 'dirty stain on bristles', same_product: true })).toContain(
      'Clean foam, lather and water droplets from normal use may stay.'
    )
  })
})

describe('효능 칸 글 → 컷 지시 Text 줄(J52 ①-1)', () => {
  it('켜도 꺼도 칸 글이 그대로 Text 줄에 실린다', () => {
    for (const effectShot of [false, true]) {
      const brief = buildShotBrief(shot('feature_proof'), { effectShot })
      expect(brief.split('\n')).toContain(TEXT_LINE)
    }
  })
})

describe('effectshot 컷 지시', () => {
  const purposeOf = (brief: string) => brief.split('\n').find((line) => line.startsWith('Purpose: '))!

  it('기능·사용 컷만 Purpose 줄 끝에 체감 결과 문장을 받고, 꺼진 판은 옵션이 없을 때와 바이트가 같다', () => {
    for (const [purpose, composition] of [['feature_proof', 'front'], ['action', 'in_hand']] as const) {
      const off = buildShotBrief(shot(purpose, composition), { size: '9.6cm', category: 'beauty' })
      expect(buildShotBrief(shot(purpose, composition), { size: '9.6cm', category: 'beauty', effectShot: false })).toBe(off)
      const on = buildShotBrief(shot(purpose, composition), { size: '9.6cm', category: 'beauty', effectShot: true })
      expect(purposeOf(on).endsWith(` ${EFFECT_SHOT_LINE}`), purpose).toBe(true)
      expect(on.replace(` ${EFFECT_SHOT_LINE}`, '')).toBe(off)
    }
  })

  it('다른 목적(고민·장면·질감·대표)은 켜져도 그대로다', () => {
    for (const purpose of ['problem', 'scene', 'texture', 'hero', 'state', 'scale']) {
      expect(buildShotBrief(shot(purpose), { effectShot: true }), purpose).toBe(buildShotBrief(shot(purpose)))
    }
  })

  it('문장은 숫자·분할 전후를 막는다', () => {
    expect(EFFECT_SHOT_LINE).toContain('no numbers or split before/after')
    // K 컷 지시는 MS 맞추기가 덜지 않는다 — 한 문장을 짧게(상한 5,000자)
    expect(EFFECT_SHOT_LINE.length).toBeLessThanOrEqual(160)
  })
})

describe('effectshot 태스크(buildImageTasks)', () => {
  const SHOTS = [
    { key: 'k1_photo_0', section: 'point_div', purpose: 'feature_proof', composition: 'front', aspect: '1:1', show: EFFECT_TEXT },
    { key: 'k2_photo_0', section: 'how_to', purpose: 'action', composition: 'in_hand', aspect: '3:4', show: '거품을 내어 둥글게 문질러요' },
    { key: 'k3_photo_0', section: 'problem_empathy', purpose: 'problem', composition: 'top', aspect: '3:4', show: '등이 늘 찝찝해요' },
  ]
  function jobOf(features: EnrichmentFeature[]): PdpJobRow {
    const job = rewindTo(fixtureToJob(loadEnrichmentFixture('A-track-s')), 'images')
    return {
      ...job,
      analysis: { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis'],
      section_plan: { ...job.section_plan, templatelib: { shots: SHOTS } } as PdpJobRow['section_plan'],
    }
  }
  const lineTasks = (features: EnrichmentFeature[]) => new Map(buildImageTasks(jobOf(features)).filter((task) => task.shotBrief).map((task) => [task.section, task]))

  it('켜진 잡은 기능·사용 컷 지시에만 문장이 붙고, 그 밖의 태스크 값은 꺼진 잡과 같다', () => {
    const off = lineTasks(['templatelib'])
    const on = lineTasks(['templatelib', 'effectshot'])
    expect([...on.keys()]).toEqual([...off.keys()])
    for (const [key, task] of on) {
      const before = off.get(key)!
      const changed = key === 'k1_photo_0' || key === 'k2_photo_0'
      expect(task.shotBrief!.includes(EFFECT_SHOT_LINE), key).toBe(changed)
      expect({ ...task, shotBrief: task.shotBrief!.replace(` ${EFFECT_SHOT_LINE}`, '') }, key).toEqual(before)
    }
    expect(on.get('k1_photo_0')!.shotBrief!.split('\n')).toContain(TEXT_LINE)
  })
})

describe('effectshot 움직이는 칸 고르기', () => {
  const candidates: MotionCandidate[] = [
    { key: 'k2_photo_0', section: 'how_to', purpose: 'action', composition: 'in_hand', show: '거품을 내어 둥글게 문질러요', kinds: ['use', 'transform', 'assemble'] },
    { key: 'k4_photo_0', section: 'main_cut', purpose: 'state', composition: 'front', show: '접어서 보관', kinds: ['transform', 'assemble', 'use'] },
  ]
  const input = { product: '돈모 바디브러쉬', candidates, max: 1 }
  const OLD_KINDS = '- 종류: use = 사용 동작(누르기·빗질·붙이기), transform = 변형(접기·펴기·늘이기), assemble = 조립·끼우기, scale = 손·물건과 크기 비교, slide = 옵션 사진 밀기.'

  it('꺼진 판은 지금 글 그대로다(use 설명·순서 줄 없음)', () => {
    const off = buildMotionPickPrompt(input)
    expect(buildMotionPickPrompt({ ...input, effectUse: false })).toBe(off)
    expect(off.split('\n')).toContain(OLD_KINDS)
    expect(off).not.toContain(USE_FIRST_LINE)
  })

  it('켜진 판은 use에 효과 보이는 동작을 더하고 use를 먼저 고르게 한다 — 나머지 줄은 같다', () => {
    const off = buildMotionPickPrompt(input).split('\n')
    const on = buildMotionPickPrompt({ ...input, effectUse: true }).split('\n')
    expect(on.filter((line) => line === USE_FIRST_LINE)).toHaveLength(1)
    const kinds = on.find((line) => line.startsWith('- 종류: '))!
    expect(kinds).toContain('쓴 효과가 보이는 동작')
    expect(on.filter((line) => line !== USE_FIRST_LINE && line !== kinds)).toEqual(off.filter((line) => line !== OLD_KINDS))
  })

  it('계획은 켜진 잡만 effectUse를 넘긴다 — 꺼진 잡의 고르기 입력은 지금 키 그대로다', async () => {
    const shots: LineShot[] = [{ key: 'k2_photo_0', section: 'how_to', purpose: 'action', composition: 'in_hand', aspect: '1:1', show: '문질러요' }]
    const opts = { product: '브러쉬', textBearing: false, optionPhotos: 0, hasBand: false }
    for (const effectUse of [undefined, false, true]) {
      const pick = vi.fn(async () => ({ picks: [], costUsd: 0, error: null }))
      await planMotion(shots, { ...opts, ...(effectUse === undefined ? {} : { effectUse }) }, pick)
      const sent = (pick.mock.calls[0] as unknown[])[0] as Record<string, unknown>
      expect(Object.keys(sent).sort(), String(effectUse)).toEqual(effectUse ? ['candidates', 'effectUse', 'max', 'product'] : ['candidates', 'max', 'product'])
    }
  })
})

describe('effectshot 스위치', () => {
  it('J65로 기본 on·K4 목록 안 — 운영(Vercel·작업자)도 켜지고(SKIP 무시), K 잡에서만 기록하며 K가 아니면 빠지고, 로컬 SKIP으로 끈다', () => {
    expect(ENRICHMENT_DEFAULTS.effectshot).toBe(true)
    expect(K4_SWITCHED_ON).toContain('effectshot')
    expect(resolveEnabledFeatures({})).toContain('effectshot')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('effectshot')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toContain('effectshot')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'effectshot' })).toContain('effectshot')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_SKIP: 'effectshot' })).toContain('effectshot')
    // 로컬 대조군 — SKIP에 이 이름 하나만 적으면 나머지 기본값은 그대로다
    const off = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'effectshot' })
    expect(off).not.toContain('effectshot')
    expect(resolveEnabledFeatures({}).filter((f) => f !== 'effectshot')).toEqual(off)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('effectshot')
  })
})
