/**
 * D 장면 모드 글자 크기(보고서 적용 D1 — A2 #1·#2·#3·#6) — 크기·본문 굵기는 K 글자(templatelib K_TYPE)와 같고, 장면 모드가 아닌 잡은 그대로.
 * 번호 원(80) 안 숫자는 키우지 않는다. LLM·DB 없음
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { K_HOOK_STEP_SIZES, K_TYPE } from '@/lib/registration/templatelib/engine'
import { HOOK_STEP_SIZES, SCENE_HOOK_STEP_SIZES, cutTextLines, fitHookToken } from './build'
import { composeDesignCut } from './compose'
import { readDesignCut } from './contract'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { insertPurchaseCheck } from './purchaseCut'
import { CONTENT_W, HOOK_TYPE, SCENE_TYPE, TYPE, colorsOf, radiusOf } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight from the left window', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
  corners: 'soft',
}

/** art: 장면 모드(계획 layout 2 + 아트 디렉션). 아니면 장면 모드가 아닌 디자인 컷 잡 */
const docOf = (art: boolean) => {
  const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
  plan.layout = 2
  if (art) plan.artDirection = ART
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
type Doc = Awaited<ReturnType<typeof docOf>>
const named = (doc: Doc, prefix: string): CanvasElement[] =>
  doc.sections.flatMap((s) => s.elements.filter((e) => e.name?.startsWith(prefix)))
const sizes = (els: CanvasElement[]) => [...new Set(els.map((e) => e.textProps!.fontSize))]

describe('D 장면 모드 글자 크기 — K와 같다', () => {
  it('토큰: 제목·소제목·본문 크기와 본문 굵기, 첫 화면 큰 제목과 줄임 단계가 K와 같고 장면 밖 TYPE은 그대로다', () => {
    const keys = ['H1', 'H2', 'H3', 'BODY', 'BODY_BOLD'] as const
    expect(keys.map((k) => SCENE_TYPE[k].size)).toEqual(keys.map((k) => K_TYPE[k].size))
    expect(keys.map((k) => SCENE_TYPE[k].weight)).toEqual(keys.map((k) => K_TYPE[k].weight))
    expect([HOOK_TYPE.calm.size, HOOK_TYPE.playful.size]).toEqual([K_TYPE.HOOK.size, K_TYPE.HOOK.size])
    expect(SCENE_HOOK_STEP_SIZES).toEqual(K_HOOK_STEP_SIZES)
    expect([TYPE.H1.size, TYPE.H2.size, TYPE.H3.size, TYPE.BODY.size, TYPE.BODY.weight]).toEqual([72, 60, 48, 45, 500])
  })

  it('사용 순서 번호는 80 원 안 한 줄이라 48 그대로, 단계 제목·설명은 커진다(장면 모드)', async () => {
    const doc = await docOf(true)
    const numbers = named(doc, 'designcut-step-number-')
    expect(numbers.length).toBeGreaterThan(1)
    expect(sizes(numbers)).toEqual([TYPE.H3.size])
    // 번호 상자는 원(80) 안 — 장면 줄 간격(1.5)을 쓰면 82가 돼 원 밖 바탕으로 대비를 잰다
    numbers.forEach((n, i) => {
      const circle = named(doc, `designcut-step-${i}`).find((e) => e.name === `designcut-step-${i}`)!
      expect(n.transform.y + n.transform.height, `${i}`).toBeLessThanOrEqual(circle.transform.y + circle.transform.height)
    })
    expect(sizes(named(doc, 'designcut-step-title-'))).toEqual([SCENE_TYPE.BODY_BOLD.size])
    expect(sizes(named(doc, 'designcut-step-desc-'))).toEqual([SCENE_TYPE.BODY.size])
  })

  it('사실 표 값은 장면 모드에서 본문 굵기(400), 장면 모드가 아니면 굵은 본문 그대로', () => {
    const plan = readDesignCut({ designcut: designCutPlanForB() })!
    const base = { colors: colorsOf(plan), radius: radiusOf(plan.motif), image: () => null }
    const body = { id: 's', sectionType: 'main_cut', groupType: 'modules', order: 0, isVisible: true, layoutId: 'x', canvas: { width: 860, height: 400, backgroundColor: '#FFFFFF' }, elements: [] } as unknown as CanvasSection
    const spec = { size: '가로 30 x 세로 40cm', colorOptions: ['데이지', '체리'] }
    const values = (ctx: typeof base & Record<string, unknown>) =>
      insertPurchaseCheck([body], spec, ctx).sections.flatMap((s) => s.elements.filter((e) => e.name?.startsWith('designcut-purchase-value-')))
    const scene = values({ ...base, type: SCENE_TYPE, scene: { band: '#FFFFFF' } })
    expect(scene.length).toBe(2)
    expect([...new Set(scene.map((e) => `${e.textProps!.fontSize}/${e.textProps!.fontWeight}`))]).toEqual([`${SCENE_TYPE.BODY.size}/400`])
    const plain = values(base)
    expect([...new Set(plain.map((e) => `${e.textProps!.fontSize}/${e.textProps!.fontWeight}`))]).toEqual([`${TYPE.BODY_BOLD.size}/${TYPE.BODY_BOLD.weight}`])
  })

  it('첫 화면 큰 제목은 112에서 108·104를 거쳐 줄인다 — 104에 두 줄로 들던 제목이 100으로 작아지지 않는다', () => {
    const at = (size: number, text: string) => cutTextLines(text, { ...HOOK_TYPE.calm, size }, CONTENT_W)
    const text = Array.from({ length: 30 }, (_, n) => '가'.repeat(n + 2)).find((t) => at(108, t) > 2 && at(104, t) <= 2)
    expect(text).toBeDefined()
    expect(fitHookToken(HOOK_TYPE.calm, text!, CONTENT_W, SCENE_HOOK_STEP_SIZES).size).toBe(104)
    expect(fitHookToken(HOOK_TYPE.calm, text!, CONTENT_W, HOOK_STEP_SIZES).size).toBe(100)
    // 띠형 첫 화면(글자 자리 기록 없음, palette2 calm)도 같은 단계로 줄인다
    const plan = designCutPlanForB() as ReturnType<typeof designCutPlanForB> & Record<string, unknown>
    plan.layout = 2
    plan.artDirection = { ...ART, palette2: { tone: 'calm', basis: 'default' } }
    const job = designCutJobB({ plan })
    const images = assembleEditorDataResponse(job, null).generated_images as Record<string, string | string[]>
    const read = readDesignCut(job.section_plan)!
    const hero = read.sections.find((s) => s.template === 'T1')!
    hero.text = { ...hero.text, headline: text! }
    const t1 = composeDesignCut([], read, { images, sectionOrder: [] }).find((s) => s.layoutId === 'designcut_T1')!
    expect(t1.elements.find((e) => e.name === 'designcut-headline')!.textProps!.fontSize).toBe(104)
  })

  it('장면 모드 문서 전체 모바일 검사 위반 0(글자가 커져도 말풍선·표·카드가 글을 품는다)', async () => {
    expect(checkMobileReadability(await docOf(true)).violations).toEqual([])
  })
})
