/**
 * 적용 T1-66 D — 구매 전 질문 표(T9 long:faq)의 'Q. '·'A. ' 글 접두를 강조색 Q 표식으로 바꾸고, 고민 말풍선(T2) 꼬리를 K 규칙(사람 말 자리만,
 * 반경이 꼬리 값 이하면 꼬리 없음)에 맞춘다. 판정: 줄마다 표식 하나·접두 없음, 후기 질문 줄도 같은 표식, 답은 전폭(M6 0·답 줄 수가 늘지 않음),
 * 글 1.2배에서도 상자 겹침 0. 질문은 K faq.rule-rows 질문 단계(본문 굵게)·답은 본문 — 후속(통합 11-03, 질문이 답보다 작던 위계 바로잡기).
 * 저장된 계획 행은 접두가 붙어 있다(R-L D 잡 7개 — 2026-11-03 읽기 전용 조회).
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore'
import { checkMobileReadability, MOBILE_LIMITS } from '@/lib/registration/editor/utils/mobileReadability'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { LONG_FAQ_KEY, LONG_ROLE } from '@/lib/registration/internalized/designcut-long'
import { FAQ_ANSWER_PREFIX, FAQ_QUESTION, FAQ_QUESTION_PREFIX, REVIEW_ANSWER_SOURCE, withoutFaqPrefix } from '@/lib/registration/long-sections'
import { REVIEW_FAQ_ANSWER_MAX_CHARS, REVIEW_FAQ_QUESTION_MAX_CHARS } from '@/lib/registration/reviews/review-faq'
import { cutTextLines } from './build'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { BUBBLE_TAIL_RADIUS, MARK_COLUMN_W } from './templatesInfo'
import { FAQ_MARK } from './templatesLong'
import { CONTENT_W, MARGIN, SCENE_TYPE, TYPE } from './tokens'

const ART = {
  set: { floor: 'light oak floor', wall: 'warm white plaster wall', window: 'soft daylight', season: 'spring', props: ['linen cloth'] },
  background: { base: '#FFFFFF', studio: '#F5F2EF', accent: '#2B6CD9' },
}
/** 저장된 계획 행 모양 — 후기 질문 두 줄(답에 출처) + 고정 질문 한 줄 */
const REVIEW_ANSWER = '설거지 뒤에 물기가 금방 말라서 매일 쓰기에도 관리가 편하고 냄새도 배지 않아요.'
const SAVED_ROWS = [
  { label: `${FAQ_QUESTION_PREFIX}식기세척기에 넣어도 괜찮나요?`, value: `${FAQ_ANSWER_PREFIX}"${REVIEW_ANSWER}" — ${REVIEW_ANSWER_SOURCE}` },
  { label: `${FAQ_QUESTION_PREFIX}가볍게 밀려다니지 않나요?`, value: `${FAQ_ANSWER_PREFIX}"바닥에 안정적으로 놓여 있어요." — ${REVIEW_ANSWER_SOURCE}` },
  { label: `${FAQ_QUESTION_PREFIX}${FAQ_QUESTION.material_eco}`, value: `${FAQ_ANSWER_PREFIX}소재: 폴리프로필렌` },
]

type Mode = 'v1' | 'v2' | 'scene'
type Plan = ReturnType<typeof designCutPlanForB> & { layout?: 2; artDirection?: unknown }
function planOf(mode: Mode, opts: { sharp?: boolean; rows?: typeof SAVED_ROWS; key?: string } = {}): Plan {
  const plan = designCutPlanForB() as Plan
  if (mode !== 'v1') plan.layout = 2
  if (mode === 'scene') plan.artDirection = { ...ART, corners: opts.sharp ? 'sharp' : 'soft' }
  if (opts.sharp) Object.assign(plan, { motif: { badge: 'SHARP' } })
  const key = opts.key ?? LONG_FAQ_KEY
  plan.sections.push({
    ...plan.sections[0],
    key,
    role: LONG_ROLE,
    template: 'T9',
    bg: 'N',
    plateKey: null,
    productImageKey: null,
    text: { eyebrow: 'Q&A', headline: '구매 전 질문', sub: null },
    modules: [{ type: 'M9', data: { rows: opts.rows ?? SAVED_ROWS } }],
  } as never)
  plan.order.splice(plan.order.indexOf('cta'), 0, key)
  return plan
}
const docOf = async (plan: unknown) => {
  const job = designCutJobB({ plan })
  return buildEditorDocument(job.id, assembleEditorDataResponse(job, null))
}
const t9 = (doc: { sections: CanvasSection[] }) => doc.sections.find((s) => s.layoutId === 'designcut_T9')!
const named = (sec: CanvasSection, re: RegExp) => sec.elements.filter((e) => re.test(e.name)).sort((a, b) => a.transform.y - b.transform.y)
const content = (e: CanvasElement) => e.textProps!.content
const bottomOf = (e: CanvasElement) => e.transform.y + e.transform.height
const MODES: Mode[] = ['v1', 'v2', 'scene']

describe('구매 전 질문 표 — Q 표식 줄(T1-66 D)', () => {
  it.each(MODES)('%s: 줄마다 강조색 Q 표식 하나, 질문·답 글에 접두가 없다(후기 질문 줄도 같다)', async (mode) => {
    const sec = t9(await docOf(planOf(mode)))
    const marks = named(sec, /^designcut-mark-\d+-text$/)
    expect(marks.map(content)).toEqual(SAVED_ROWS.map(() => FAQ_MARK))
    const markBg = named(sec, /^designcut-mark-\d+-bg$/)
    expect(new Set(markBg.map((e) => e.shapeProps!.fill)).size).toBe(1)
    expect(markBg[0].shapeProps!.stroke).toBeUndefined()
    const questions = named(sec, /^designcut-purchase-label-\d+$/).map(content)
    const answers = named(sec, /^designcut-purchase-value-\d+$/).map(content)
    expect(questions).toEqual(SAVED_ROWS.map((r) => r.label.slice(FAQ_QUESTION_PREFIX.length)))
    expect(answers).toEqual(SAVED_ROWS.map((r) => r.value.slice(FAQ_ANSWER_PREFIX.length)))
    expect(answers.slice(0, 2).every((a) => a.endsWith(`— ${REVIEW_ANSWER_SOURCE}`))).toBe(true)
    for (const e of sec.elements.filter((x) => x.textProps)) expect(content(e)).not.toMatch(/^[QA]\. /)
  })

  it.each(MODES)('%s: 표식은 질문 왼쪽 열(88)에만, 답은 전폭이고 표식·질문 아래에서 시작한다 — 모바일 검사 위반 0', async (mode) => {
    const doc = await docOf(planOf(mode, { sharp: mode === 'scene' }))
    const sec = t9(doc)
    const [bgs, qs, as] = [/^designcut-mark-\d+-bg$/, /^designcut-purchase-label-\d+$/, /^designcut-purchase-value-\d+$/].map((re) => named(sec, re))
    SAVED_ROWS.forEach((_, i) => {
      expect(bgs[i].transform.x).toBe(MARGIN)
      expect(bgs[i].transform.x + bgs[i].transform.width).toBeLessThan(qs[i].transform.x)
      expect(qs[i].transform.x).toBe(MARGIN + MARK_COLUMN_W)
      expect(qs[i].transform.width).toBe(CONTENT_W - MARK_COLUMN_W)
      expect(as[i].transform.x).toBe(MARGIN)
      expect(as[i].transform.width).toBe(CONTENT_W)
      expect(as[i].transform.y).toBeGreaterThanOrEqual(Math.max(bottomOf(bgs[i]), bottomOf(qs[i])))
      // 캡슐과 질문 첫 줄이 같은 가운데 높이
      const lineH = Math.ceil(qs[i].textProps!.fontSize * qs[i].textProps!.lineHeight!)
      expect(Math.abs(bgs[i].transform.y + bgs[i].transform.height / 2 - (qs[i].transform.y + lineH / 2))).toBeLessThanOrEqual(1)
      if (i > 0) expect(bgs[i].transform.y).toBeGreaterThan(bottomOf(as[i - 1]))
    })
    // 표 섹션만 따로 잰다 — M3(첫 화면 상품 사진)은 페이지 규칙이라 뺀다. 페이지 전체에서도 M6은 0이다
    expect(checkMobileReadability({ ...doc, sections: [sec] }).violations.filter((v) => v.rule !== 'M3')).toEqual([])
    expect(checkMobileReadability(doc).violations.filter((v) => v.rule === 'M6')).toEqual([])
  })

  it.each(MODES)('%s: 글이 1.2배 길어도 표식·질문·답 상자가 겹치지 않고 M6 0', async (mode) => {
    const longer = (s: string) => s + s.slice(0, Math.ceil(s.length * 0.2))
    const rows = SAVED_ROWS.map((r) => ({ label: FAQ_QUESTION_PREFIX + longer(withoutFaqPrefix(r.label, FAQ_QUESTION_PREFIX)), value: longer(r.value) }))
    const doc = await docOf(planOf(mode, { rows }))
    const sec = t9(doc)
    const boxes = named(sec, /^designcut-(mark-\d+-bg|purchase-(label|value)-\d+)$/)
    for (const a of boxes)
      for (const b of boxes) {
        if (a === b) continue
        const apart =
          bottomOf(a) <= b.transform.y || bottomOf(b) <= a.transform.y || a.transform.x + a.transform.width <= b.transform.x || b.transform.x + b.transform.width <= a.transform.x
        expect(apart, `${a.name} × ${b.name}`).toBe(true)
      }
    expect(checkMobileReadability({ ...doc, sections: [sec] }).violations.filter((v) => v.rule === 'M6')).toEqual([])
  })

  it('다른 사실 표(long:size)는 표식 없이 지금처럼 이름이 전폭이다', async () => {
    const rows = [
      { label: '사이즈', value: '12 × 8 cm' },
      { label: '무게', value: '120g' },
    ]
    const sec = t9(await docOf(planOf('v2', { key: 'long:size', rows: rows as never })))
    expect(named(sec, /^designcut-mark-/)).toEqual([])
    const labels = named(sec, /^designcut-purchase-label-\d+$/)
    expect(labels.map(content)).toEqual(['사이즈', '무게'])
    expect(labels.every((e) => e.transform.x === MARGIN && e.transform.width === CONTENT_W)).toBe(true)
  })

  it.each(MODES)('%s: 질문은 K 질문 단계(본문 굵게·본문 색), 답은 본문 — 질문 글자가 답보다 작지 않고 더 굵다', async (mode) => {
    const sec = t9(await docOf(planOf(mode)))
    const tokens = mode === 'scene' ? SCENE_TYPE : TYPE
    const qs = named(sec, /^designcut-purchase-label-\d+$/).map((e) => e.textProps!)
    const as = named(sec, /^designcut-purchase-value-\d+$/).map((e) => e.textProps!)
    qs.forEach((q, i) => {
      expect(q.fontSize).toBe(tokens.BODY_BOLD.size)
      expect(q.fontWeight).toBe(tokens.BODY_BOLD.weight)
      expect(as[i].fontSize).toBe(tokens.BODY.size)
      expect(as[i].fontWeight).toBe(tokens.BODY.weight)
      expect(q.fontSize).toBeGreaterThanOrEqual(as[i].fontSize)
      expect(q.fontWeight!).toBeGreaterThan(as[i].fontWeight!)
      expect(q.color).toBe(as[i].color)
    })
  })

  it('질문 표만 마운트 리플로우 — 질문이 실측에서 한 줄 줄거나 늘면 답·다음 행이 같이 움직이고 캡슐과 겹치지 않는다', async () => {
    const doc = await docOf(planOf('scene', { sharp: true }))
    const sec = t9(doc)
    expect(sec.needsInitialReflow).toBe(true)
    const size = t9(await docOf(planOf('scene', { key: 'long:size', rows: [{ label: '사이즈', value: '12 × 8 cm' }, { label: '무게', value: '120g' }] as never })))
    expect(size.needsInitialReflow).toBeFalsy()
    const store = useEditorStore
    for (const delta of [-1, 1]) {
      store.getState().initDocument(structuredClone({ ...doc, sections: [sec] }))
      try {
        const els = () => store.getState().document!.sections[0].elements
        const get = (n: string) => els().find((e) => e.name === n)!
        const q0 = get('designcut-purchase-label-0')
        const line = Math.round(q0.textProps!.fontSize * q0.textProps!.lineHeight!)
        const before = { answer: get('designcut-purchase-value-0').transform.y, nextMark: get('designcut-mark-1-bg').transform.y, mark: get('designcut-mark-0-bg').transform.y }
        // 편집기 마운트 실측(setMeasuredHeight)과 같은 입력 — 첫 질문이 한 줄 짧거나(실측 1줄) 길다(글 1.2배)
        store.getState().setMeasuredHeight(sec.id, q0.id, q0.transform.height + delta * line)
        store.getState().reflowSection(sec.id)
        expect(get('designcut-mark-0-bg').transform.y).toBe(before.mark)
        expect(get('designcut-purchase-value-0').transform.y).toBe(before.answer + delta * line)
        expect(get('designcut-mark-1-bg').transform.y).toBe(before.nextMark + delta * line)
        expect(get('designcut-purchase-value-0').transform.y).toBeGreaterThanOrEqual(bottomOf(get('designcut-mark-0-bg')))
        expect(get('designcut-purchase-value-0').transform.y).toBeGreaterThanOrEqual(bottomOf(get('designcut-purchase-label-0')))
      } finally {
        store.getState().clearDocument()
      }
    }
  })

  it('줄 수 — 답은 늘지 않고, 질문은 행당 1줄까지만 는다(고정 질문 전부, 후기 질문·답 상한 길이 — T1-66 직후 대비)', () => {
    const questions = [...Object.values(FAQ_QUESTION), '가'.repeat(REVIEW_FAQ_QUESTION_MAX_CHARS - 1) + '?']
    const answers = [`소재: 폴리프로필렌`, `"${REVIEW_ANSWER}" — ${REVIEW_ANSWER_SOURCE}`, `"${'나'.repeat(REVIEW_FAQ_ANSWER_MAX_CHARS - 1)}." — ${REVIEW_ANSWER_SOURCE}`]
    const Q_W = CONTENT_W - MARK_COLUMN_W
    for (const type of [TYPE, SCENE_TYPE]) {
      const before = type === TYPE ? TYPE.BODY_BOLD : SCENE_TYPE.BODY
      for (const q of questions) {
        const grown = cutTextLines(q, type.BODY_BOLD, Q_W) - cutTextLines(q, type.LABEL, Q_W)
        expect(grown, q).toBeLessThanOrEqual(1)
        expect(grown, q).toBeGreaterThanOrEqual(0)
      }
      for (const a of answers) expect(cutTextLines(a, type.BODY, CONTENT_W)).toBeLessThanOrEqual(cutTextLines(a, before, CONTENT_W))
    }
  })

  it('M6 — 표식 옆 질문은 늘 2열 기준 안이다(후기 질문 상한·고정 질문 ≤ 40자, 열 폭 ≥ 380)', () => {
    expect(REVIEW_FAQ_QUESTION_MAX_CHARS).toBeLessThanOrEqual(MOBILE_LIMITS.twoColumnMaxChars)
    for (const q of Object.values(FAQ_QUESTION)) expect(q.replace(/\s+/g, '').length).toBeLessThanOrEqual(MOBILE_LIMITS.twoColumnMaxChars)
    expect(CONTENT_W - MARK_COLUMN_W).toBeGreaterThanOrEqual(MOBILE_LIMITS.twoColumnMinWidthPx)
  })

  it('접두 떼기는 앞에 붙은 접두만 — 접두가 없는 글(새 계획·다른 표)은 그대로다', () => {
    expect(withoutFaqPrefix('Q. 소재는?', FAQ_QUESTION_PREFIX)).toBe('소재는?')
    expect(withoutFaqPrefix('소재는? Q. ', FAQ_QUESTION_PREFIX)).toBe('소재는? Q. ')
    expect(withoutFaqPrefix('A. "좋아요"', FAQ_ANSWER_PREFIX)).toBe('"좋아요"')
  })
})

describe('고민 말풍선 꼬리(T2) — K 규칙과 같다(T1-66 D)', () => {
  const radiiOf = async (mode: Mode, sharp: boolean) => {
    const plan = planOf(mode, { sharp })
    const sec = (await docOf(plan)).sections.find((s) => s.layoutId === 'designcut_T2')!
    return named(sec, /^designcut-bubble-\d+$/).map((e) => ({ radii: e.shapeProps!.borderRadii, radius: e.shapeProps!.borderRadius }))
  }

  it('둥근 컨셉 — 꼬리 쪽 모서리 하나만 8(1·3번 오른쪽 아래, 2번 왼쪽 아래)', async () => {
    for (const mode of ['v1', 'v2'] as const) {
      const bubbles = await radiiOf(mode, false)
      expect(bubbles.length).toBeGreaterThanOrEqual(2)
      bubbles.forEach(({ radii }, i) => {
        expect(radii).toBeDefined()
        expect(radii!.filter((r) => r === BUBBLE_TAIL_RADIUS)).toHaveLength(1)
        expect(radii!.indexOf(BUBBLE_TAIL_RADIUS)).toBe(i % 2 === 1 ? 3 : 2)
      })
    }
  })

  it('각진 컨셉(반경 ≤ 8) — 꼬리 없이 네 모서리 같은 반경(꼬리 모서리가 더 둥글어지지 않는다)', async () => {
    for (const mode of ['v1', 'v2', 'scene'] as const) {
      for (const { radii, radius } of await radiiOf(mode, true)) {
        expect(radii).toBeUndefined()
        expect(radius).toBeLessThanOrEqual(BUBBLE_TAIL_RADIUS)
      }
    }
  })
})
