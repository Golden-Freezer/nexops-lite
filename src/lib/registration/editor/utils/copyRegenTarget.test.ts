import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../types/canvas'
import { COPY_REGEN_TONES, type CopyRegenResponse } from '@/lib/registration/pdp-copy-regen'
import {
  COPY_REGEN_IMAGES_BUSY,
  COPY_REGEN_TONE_ORDER,
  copyRegenBlockText,
  copyRegenBody,
  copyRegenCostLines,
  copyRegenOutcome,
  copyRegenTargetOf,
  copyTextPatch,
} from './copyRegenTarget'

const text = (id: string, content: string, extra: Partial<CanvasElement> = {}, richContent?: string): CanvasElement =>
  ({
    id,
    type: 'text',
    name: '헤드라인',
    transform: { x: 0, y: 0, width: 700, height: 60, rotation: 0 },
    zIndex: 1,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    textProps: { content, richContent, fontFamily: 'Pretendard', fontSize: 40, fontWeight: 700, fontStyle: 'normal', textDecoration: 'none', color: '#111', textAlign: 'center', lineHeight: 1.3, letterSpacing: 0 },
    ...extra,
  }) as CanvasElement

const sections = (elements: CanvasElement[]): CanvasSection[] => [{ id: 's1', sectionType: 'hook_3step', elements } as unknown as CanvasSection]

const response = (over: Partial<CopyRegenResponse>): CopyRegenResponse => ({
  status: 'ok',
  candidates: [],
  rejected: [],
  costUsd: 0.0123,
  recorded: true,
  estimate: { model: 'claude-sonnet-5', billed: true, maxUsd: 0.05 },
  ...over,
})

describe('서버 계약(pdp-copy-regen.ts)과 같은 값', () => {
  it('어조 라벨 키·순서가 COPY_REGEN_TONES와 같다', () => {
    expect(COPY_REGEN_TONE_ORDER).toEqual([...COPY_REGEN_TONES])
  })
  // 상한(지금 카피 300·요소 이름 60·요청 200)은 아래 대상 판정·요청 본문 시험이 숫자로 고정한다
})

describe('copyRegenTargetOf', () => {
  it('잠기지 않은 글자 요소면 섹션 타입·요소 이름·지금 텍스트(줄바꿈 그대로)를 준다', () => {
    const t = copyRegenTargetOf(sections([text('e1', '물 빠짐 걱정 끝\n하루 한 번이면 충분')]), 's1', 'e1')
    expect(t).toEqual({
      sectionId: 's1',
      elementId: 'e1',
      sectionType: 'hook_3step',
      elementName: '헤드라인',
      currentText: '물 빠짐 걱정 끝\n하루 한 번이면 충분',
      hasRichText: false,
    })
  })

  it('이미지·잠긴 요소·빈 텍스트·300자 초과·없는 섹션/요소는 대상이 아니다(300자는 대상)', () => {
    const img = { ...text('img', 'x'), type: 'image', textProps: undefined } as CanvasElement
    const list = sections([img, text('lock', '잠김', { isLocked: true }), text('blank', '  \n '), text('long', 'a'.repeat(301)), text('max', 'a'.repeat(300))])
    for (const id of ['img', 'lock', 'blank', 'long', 'none']) expect(copyRegenTargetOf(list, 's1', id), id).toBeNull()
    expect(copyRegenTargetOf(list, 's2', 'max')).toBeNull()
    expect(copyRegenTargetOf(list, null, 'max')).toBeNull()
    expect(copyRegenTargetOf(list, 's1', 'max')?.currentText).toHaveLength(300)
  })

  it('요소 이름은 60자로 자르고, 부분 강조(richContent)가 있으면 알린다', () => {
    const t = copyRegenTargetOf(sections([text('e1', '본문', { name: 'n'.repeat(80) }, '<span style="color:red">본문</span>')]), 's1', 'e1')
    expect(t?.elementName).toHaveLength(60)
    expect(t?.hasRichText).toBe(true)
  })
})

describe('copyRegenBody', () => {
  const target = copyRegenTargetOf(sections([text('e1', '지금 카피')]), 's1', 'e1')!
  it('비운 어조·요청은 넣지 않는다(서버 기본값 = 잡 전략)', () => {
    expect(copyRegenBody(target, { tone: null, note: '   ' })).toEqual({ sectionType: 'hook_3step', elementName: '헤드라인', currentText: '지금 카피' })
  })
  it('어조와 다듬은 요청을 넣고, 요청은 200자에서 자른다. 이름이 비면 elementName을 빼고, 요소 ID는 보내지 않는다', () => {
    const body = copyRegenBody({ ...target, elementName: '' }, { tone: 'functional', note: `  ${'가'.repeat(250)}  ` })
    expect(body).toEqual({ sectionType: 'hook_3step', currentText: '지금 카피', tone: 'functional', note: '가'.repeat(200) })
    expect(body).not.toHaveProperty('elementId')
  })
})

describe('copyTextPatch', () => {
  it('content만 후보로 바꾸고 부분 강조 HTML은 지운다(글꼴·크기·색은 그대로)', () => {
    const el = text('e1', '이전', {}, '<span style="color:red">이전</span>')
    const patch = copyTextPatch(el, '새 카피\n둘째 줄')
    expect(patch?.textProps).toEqual({ ...el.textProps, content: '새 카피\n둘째 줄', richContent: undefined })
    expect(Object.keys(patch!)).toEqual(['textProps'])
  })
  it('글자 요소가 아니거나 빈 후보·이미 같은 평문이면 null', () => {
    expect(copyTextPatch({ ...text('i', 'x'), type: 'image' } as CanvasElement, '새')).toBeNull()
    expect(copyTextPatch(text('e1', '같음'), '같음')).toBeNull()
    expect(copyTextPatch(text('e1', '이전'), '  ')).toBeNull()
    // 같은 평문이어도 부분 강조가 남아 있으면 지우는 패치는 만든다
    expect(copyTextPatch(text('e1', '같음', {}, '<span>같음</span>'), '같음')).not.toBeNull()
  })
})

describe('copyRegenOutcome', () => {
  it("'ok'면 후보(최대 3개)와 걸러진 수·비용을 준다", () => {
    const out = copyRegenOutcome(response({ candidates: ['a', 'b', 'c', 'd'], rejected: [{ reason: 'banned', detail: '금지 표현' }] }))
    expect(out).toEqual({ kind: 'candidates', candidates: ['a', 'b', 'c'], filtered: 1, costUsd: 0.0123 })
  })
  it("'rejected'·'failed'·후보 없는 'ok'는 고를 것이 없다 — 서버 문구, 없으면 기본 문구와 걸러진 사유", () => {
    const rejected = copyRegenOutcome(
      response({ status: 'rejected', message: '후보 3개가 모두 길이 검사에서 걸렸습니다.', rejected: [{ reason: 'length', detail: '줄당 22자 초과' }, { reason: 'duplicate', detail: '' }] }),
    )
    expect(rejected).toEqual({ kind: 'none', message: '후보 3개가 모두 길이 검사에서 걸렸습니다.', details: ['줄당 22자 초과'], costUsd: 0.0123 })
    expect(copyRegenOutcome(response({ status: 'failed', costUsd: 0 }))).toMatchObject({ kind: 'none', message: '후보를 만들지 못했습니다.' })
    expect(copyRegenOutcome(response({ status: 'ok', candidates: ['  '] }))).toMatchObject({ kind: 'none', message: '후보가 모두 검사에서 걸러졌습니다.' })
  })
})

describe('copyRegenCostLines', () => {
  it('모델과 한 번 받을 때 상한을 보여 준다', () => {
    expect(copyRegenCostLines({ model: 'claude-sonnet-5', billed: true, maxUsd: 0.0456 })).toEqual([
      '모델 claude-sonnet-5 · 후보 최대 3개를 한 번에 받습니다',
      '이 PC의 Codex로 받습니다(API 요금 0원) — 배포 주소에서는 PC에서 npm run dev를 켠 주소로 열어 주세요',
    ])
  })
})

describe('copyRegenBlockText', () => {
  it("이미지 생성 중(busy·images)은 따로 알리고, 그 밖의 막힘은 서버 문구 그대로", () => {
    expect(copyRegenBlockText({ code: 'busy', busyKind: 'images', error: '이미지 생성 중이라 잠시 뒤 다시 시도해 주세요.' })).toEqual({ text: COPY_REGEN_IMAGES_BUSY, imagesBusy: true })
    expect(COPY_REGEN_IMAGES_BUSY.startsWith('이미지 생성 중이라 잠시 뒤')).toBe(true)
    expect(copyRegenBlockText({ code: 'busy', busyKind: 'job', error: '진행 중입니다.' })).toEqual({ text: '진행 중입니다.', imagesBusy: false })
    expect(copyRegenBlockText({ code: 'budget', error: '월 예산 한도' })).toEqual({ text: '월 예산 한도', imagesBusy: false })
    expect(copyRegenBlockText({ error: '요청 실패(500)' })).toEqual({ text: '요청 실패(500)', imagesBusy: false })
  })
})
