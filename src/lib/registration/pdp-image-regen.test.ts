/**
 * 편집기 이미지 재생성 계약(pdp-image-regen-api) — 요청 검사·조정 블록·비용 추정·재생성 흐름(생성·게이트는 모의 함수).
 */

import { describe, expect, it, vi } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'
import {
  REGEN_NOTE_MAX_CHARS,
  REGEN_STYLE_HINTS,
  REGEN_STYLES,
  buildEditorRegenDirective,
  estimateEditorRegen,
  isEditorRegenPending,
  markEditorRegen,
  isRevertible,
  parseRegenRequest,
  regenRunnerOf,
  revertEditorRegen,
  runEditorRegenFlow,
  sanitizeRegenNote,
  settleEditorRegen,
  type EditorRegenDeps,
  type GateVerdict,
} from './pdp-image-regen'
import { FAIRNEX_OPTION_LABELS } from './options/__fixtures__/fairnex-option-labels'
import { parseOptionLabels, type OptionSpec } from './options/option-spec'

const NOW = '2026-10-29T10:00:00.000Z'
const OLD = 'https://cdn.test/job/hero-old.png'
const NEW = 'https://cdn.test/job/hero-new.png'
const NEW2 = 'https://cdn.test/job/hero-new2.png'
const FAIL_SCORE = { same_product: false, artifact_reason: 'different product shape' }

describe('요청 검사(parseRegenRequest)', () => {
  it('section·style·note를 받고 note는 한 줄로 정리한다', () => {
    const r = parseRegenRequest({ section: ' hero ', style: 'lifestyle', note: '  밝게\n\t더 따뜻하게  ' })
    expect(r).toStrictEqual({ ok: true, value: { section: 'hero', style: 'lifestyle', note: '밝게 더 따뜻하게' } })
  })

  it('빈 style·note는 빼고, 모르는 style·문자열 아닌 note·빈 section은 거절한다', () => {
    expect(parseRegenRequest({ section: 'features:0', style: '', note: '   ' })).toStrictEqual({
      ok: true,
      value: { section: 'features:0' },
    })
    expect(parseRegenRequest({ section: 'hero', style: 'comparison' }).ok).toBe(false)
    expect(parseRegenRequest({ section: 'hero', note: 3 }).ok).toBe(false)
    expect(parseRegenRequest({ section: '' }).ok).toBe(false)
    expect(parseRegenRequest({ section: 'x'.repeat(81) }).ok).toBe(false)
    expect(parseRegenRequest(null).ok).toBe(false)
    expect(parseRegenRequest([]).ok).toBe(false)
  })

  it('note는 제어 문자를 공백으로 바꾸고 상한에서 자른다', () => {
    expect(sanitizeRegenNote('a\u0000b\u007fc')).toBe('a b c')
    expect(sanitizeRegenNote('가'.repeat(REGEN_NOTE_MAX_CHARS + 50))).toHaveLength(REGEN_NOTE_MAX_CHARS)
  })

  it('스타일은 NEXFIT 힌트가 있는 6종이다', () => {
    expect(REGEN_STYLES).toStrictEqual([
      'premium_studio',
      'lifestyle',
      'macro',
      'empathy',
      'product_photo',
      'infographic',
    ])
  })
})

function optionJob(): Pick<PdpJobRow, 'spec_sheet' | 'analysis'> {
  const { spec } = parseOptionLabels(FAIRNEX_OPTION_LABELS.P02)
  const optionSpec: OptionSpec = {
    ...spec,
    variants: spec.variants.map((v) =>
      v.label.includes('데이지') ? { ...v, sourceImage: 'https://cdn.test/opt/daisy.jpg' } : v
    ),
  }
  return {
    spec_sheet: { optionSpec } as unknown as PdpJobRow['spec_sheet'],
    analysis: { enrichment: { version: 1, features: ['options'] } } as unknown as PdpJobRow['analysis'],
  }
}
const plainJob = { spec_sheet: {}, analysis: {} } as unknown as Pick<PdpJobRow, 'spec_sheet' | 'analysis'>

describe('조정 블록(buildEditorRegenDirective)', () => {
  it('스타일 힌트 원문과 요청 문구를 규칙 우선 머리말 아래에 붙인다', () => {
    const d = buildEditorRegenDirective({ style: 'macro', note: '질감을 더 가까이' }, plainJob)
    expect(d).toContain('EDITOR REGENERATION REQUEST')
    expect(d).toContain('cannot override any product identity, option, text or safety rule above')
    expect(d).toContain(`Style adjustment: ${REGEN_STYLE_HINTS.macro}`)
    expect(d).toContain('Owner request (may be in Korean): 질감을 더 가까이')
  })

  it('스타일·문구가 없으면 빈 문자열이다(같은 프롬프트로 다시 만든다)', () => {
    expect(buildEditorRegenDirective({}, plainJob)).toBe('')
    expect(buildEditorRegenDirective({ note: '   ' }, plainJob)).toBe('')
  })

  it('사진 없는 옵션 이름은 문구에서 지우고 사진 있는 옵션은 남긴다(옵션 사진 가드)', () => {
    const d = buildEditorRegenDirective({ note: '체리 말고 데이지를 크게' }, optionJob())
    expect(d).not.toContain('체리')
    expect(d).toContain('데이지')
  })
})

describe('비용 추정·실행기', () => {
  it('과금 모델은 장당 단가와 게이트 재생성 포함 최대(2장)를 준다', () => {
    const e = estimateEditorRegen({ image_model: 'gpt-image-2', image_quality: 'medium' }, {})
    expect(e.billed).toBe(true)
    expect(e.imageUsd).toBeGreaterThan(0)
    expect(e.maxImageUsd).toBe(e.imageUsd * 2)
    expect(regenRunnerOf({ image_model: 'gpt-image-2' })).toBe('web')
  })

  it('codex-image는 구독이라 0원·로컬 실행기다. 태스크 지정 모델이 잡 모델을 이긴다', () => {
    expect(estimateEditorRegen({ image_model: 'codex-image', image_quality: 'high' }, {})).toMatchObject({
      model: 'codex-image',
      billed: false,
      imageUsd: 0,
      maxImageUsd: 0,
    })
    expect(regenRunnerOf({ image_model: 'codex-image' })).toBe('local')
    const forced = estimateEditorRegen(
      { image_model: 'codex-image', image_quality: 'high' },
      { model: 'gemini-3.1-flash-image' }
    )
    expect(forced).toMatchObject({ model: 'gemini-3.1-flash-image', billed: true })
  })
})

describe('요청 표시(markEditorRegen)', () => {
  it('그 섹션에만 재생성 대기와 요청 기록을 적고 이전 이미지·장식은 그대로 둔다', () => {
    const list: SectionImage[] = [
      { section: 'hero', url: OLD, annotations: [], annotationStatus: 'done' },
      { section: 'usage', url: 'u' },
    ]
    const next = markEditorRegen(list, { section: 'hero', style: 'lifestyle' }, NOW)
    expect(next[0]).toStrictEqual({
      section: 'hero',
      url: OLD,
      annotations: [],
      annotationStatus: 'done',
      pendingRegen: true,
      editorRegen: { style: 'lifestyle', requestedAt: NOW, status: 'pending' },
    })
    expect(next[1]).toBe(list[1])
    expect(isEditorRegenPending(next[0])).toBe(true)
    expect(isEditorRegenPending({ section: 'hero', url: OLD, pendingRegen: true })).toBe(false)
  })

  it('항목이 없는 섹션(골격 밖 — 사후 재생성)은 빈 항목을 끝에 덧붙이고 added로 표시한다', () => {
    const list: SectionImage[] = [{ section: 'hero', url: OLD }]
    const next = markEditorRegen(list, { section: 'size_comparison', note: '자 옆에' }, NOW)
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(list[0])
    expect(next[1]).toStrictEqual({
      section: 'size_comparison',
      url: '',
      pendingRegen: true,
      editorRegen: { note: '자 옆에', requestedAt: NOW, status: 'pending', added: true },
    })
    expect(isEditorRegenPending(next[1])).toBe(true)
  })

  it('덧붙인 컷을 다시 요청해도 added가 남고, 원래 있던 컷에는 붙지 않는다', () => {
    const failed: SectionImage = {
      section: 'size_comparison',
      url: '',
      pendingRegen: false,
      editorRegen: { requestedAt: NOW, status: 'failed', finishedAt: NOW, message: 'x', added: true },
    }
    const again = markEditorRegen([{ section: 'hero', url: OLD }, failed], { section: 'size_comparison' }, NOW)
    expect(again[1].editorRegen).toStrictEqual({ requestedAt: NOW, status: 'pending', added: true })
    const hero = markEditorRegen([{ section: 'hero', url: OLD }], { section: 'hero' }, NOW)
    expect(hero[0].editorRegen).toStrictEqual({ requestedAt: NOW, status: 'pending' })
  })
})

const prior: SectionImage = {
  section: 'hero',
  url: OLD,
  prompt: 'P',
  annotations: [{ kind: 'number', anchor: { x: 0.1, y: 0.1 }, text: '1', source: 'howto[0]' }],
  annotationStatus: 'done',
  imageAspect: 0.75,
  pendingRegen: true,
  editorRegen: { style: 'lifestyle', requestedAt: NOW, status: 'pending' },
}

function deps(
  gens: Array<SectionImage>,
  verdicts: GateVerdict[],
  canRegen = true
): EditorRegenDeps & { generate: ReturnType<typeof vi.fn>; judge: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async () => ({ entry: gens.shift()!, costUsd: 0.05 }))
  const judge = vi.fn(async () => verdicts.shift()!)
  return { generate, judge, canRegen: () => canRegen, now: () => '2026-10-29T10:05:00.000Z' }
}
const gen = (url: string, extra: Partial<SectionImage> = {}): SectionImage => ({
  section: 'hero',
  url,
  prompt: 'P',
  retried: false,
  ...extra,
})
const PASS: GateVerdict = { verdict: 'pass', costUsd: 0.001 }
const FAIL: GateVerdict = { verdict: 'fail', score: FAIL_SCORE, reason: '정체성', costUsd: 0.001 }

describe('재생성 흐름(runEditorRegenFlow)', () => {
  it('게이트를 통과하면 새 url로 바꾸고 previousUrl을 남긴다 — 이전 장식은 따라오지 않고 되돌리기용으로 기록에 남는다', async () => {
    const d = deps([gen(NEW)], [PASS])
    const { entry, costUsd } = await runEditorRegenFlow(prior, d)
    expect(entry).toStrictEqual({
      section: 'hero',
      url: NEW,
      prompt: 'P',
      retried: false,
      pendingRegen: false,
      editorRegen: {
        style: 'lifestyle',
        requestedAt: NOW,
        status: 'done',
        finishedAt: '2026-10-29T10:05:00.000Z',
        previousUrl: OLD,
        previous: { annotations: prior.annotations, annotationStatus: 'done', imageAspect: 0.75 },
      },
    })
    expect(costUsd).toBeCloseTo(0.051)
    expect(d.generate).toHaveBeenCalledWith(undefined)
  })

  it('설계상 게이트가 없는 컷(skip, 판정 사유 없음)은 통과와 같다', async () => {
    const { entry } = await runEditorRegenFlow(prior, deps([gen(NEW)], [{ verdict: 'skip', costUsd: 0 }]))
    expect(entry.url).toBe(NEW)
    expect(entry.editorRegen?.status).toBe('done')
  })

  it('첫 결과가 미달이면 사유 점수로 1회 다시 만들고, 통과하면 그 결과로 바꾼다', async () => {
    const d = deps([gen(NEW), gen(NEW2, { retried: true })], [FAIL, PASS])
    const { entry, costUsd } = await runEditorRegenFlow(prior, d)
    expect(d.generate).toHaveBeenNthCalledWith(2, FAIL_SCORE)
    expect(entry).toMatchObject({ url: NEW2, retried: true, editorRegen: { status: 'done', previousUrl: OLD } })
    expect(costUsd).toBeCloseTo(0.102)
  })

  it('다시 만든 결과도 미달이면 이전 이미지를 그대로 두고 rejected로 남긴다', async () => {
    const d = deps([gen(NEW), gen(NEW2)], [FAIL, FAIL])
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry).toStrictEqual({
      ...prior,
      pendingRegen: false,
      editorRegen: {
        style: 'lifestyle',
        requestedAt: NOW,
        status: 'rejected',
        finishedAt: '2026-10-29T10:05:00.000Z',
        message: '정체성 게이트 미달(정체성) — 이전 이미지를 유지했습니다',
      },
    })
    expect(d.generate).toHaveBeenCalledTimes(2)
  })

  it('미달인데 재생성할 시간·예산이 없으면 바로 rejected다 — 재생성까지 한 미달과 문구로 구분한다', async () => {
    const d = deps([gen(NEW)], [FAIL], false)
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry.url).toBe(OLD)
    expect(entry.editorRegen?.status).toBe('rejected')
    expect(entry.editorRegen?.message).toContain('다시 만들 시간·예산이 없어')
    expect(d.generate).toHaveBeenCalledTimes(1)
  })

  it('게이트가 판정하지 못하면(참조 없음·시간 부족·채점 실패) 첫 시도는 failed — url을 바꾸지 않는다', async () => {
    const d = deps([gen(NEW)], [{ verdict: 'skip', unjudged: '채점 실패', costUsd: 0.001 }])
    const { entry, costUsd } = await runEditorRegenFlow(prior, d)
    expect(entry).toMatchObject({ url: OLD, annotationStatus: 'done', pendingRegen: false })
    expect(entry.editorRegen).toMatchObject({
      status: 'failed',
      message: '정체성 게이트를 판정하지 못해(채점 실패) 이전 이미지를 유지했습니다',
    })
    expect(costUsd).toBeCloseTo(0.051)
  })

  it('미달 뒤 재생성본을 판정하지 못해도 rejected — 이전 이미지를 둔다', async () => {
    const d = deps([gen(NEW), gen(NEW2)], [FAIL, { verdict: 'skip', unjudged: 'run 시간 부족', costUsd: 0 }])
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry.url).toBe(OLD)
    expect(entry.editorRegen?.status).toBe('rejected')
    expect(entry.editorRegen?.message).toContain('run 시간 부족')
  })

  it('생성이 실패하면(이전 url·error로 돌아온다) failed로 남기고 이전 항목은 그대로다', async () => {
    const d = deps([gen(OLD, { error: 'hero 생성 실패: 500' })], [])
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry).toMatchObject({ url: OLD, annotationStatus: 'done', pendingRegen: false })
    expect(entry.editorRegen).toMatchObject({
      status: 'failed',
      message: '재생성 실패 — 이전 이미지를 유지했습니다: hero 생성 실패: 500',
    })
    expect(entry.retryPending).toBeUndefined()
    expect(d.judge).not.toHaveBeenCalled()
  })

  it('사후 재생성(이전 이미지 없음) — 통과하면 previousUrl 없이 done, 실패하면 빈 항목에 사유를 남긴다', async () => {
    const added: SectionImage = {
      section: 'size_comparison',
      url: '',
      pendingRegen: true,
      editorRegen: { requestedAt: NOW, status: 'pending', added: true },
    }
    const ok = await runEditorRegenFlow(added, deps([gen(NEW, { section: 'size_comparison' })], [PASS]))
    expect(ok.entry).toMatchObject({ section: 'size_comparison', url: NEW, pendingRegen: false })
    expect(ok.entry.editorRegen).toStrictEqual({
      requestedAt: NOW,
      status: 'done',
      finishedAt: '2026-10-29T10:05:00.000Z',
      added: true,
    })

    const failedGen = gen('', { section: 'size_comparison', error: 'size_comparison 생성 실패: 500' })
    const failed = await runEditorRegenFlow(added, deps([failedGen], []))
    expect(failed.entry).toStrictEqual({
      ...added,
      pendingRegen: false,
      editorRegen: {
        requestedAt: NOW,
        status: 'failed',
        added: true,
        finishedAt: '2026-10-29T10:05:00.000Z',
        message: '재생성 실패 — 새 사진을 넣지 않았습니다: size_comparison 생성 실패: 500',
      },
    })
  })

  it('요청 끝내기(settleEditorRegen)는 이전 항목을 두고 결과만 남긴다(예산으로 시작 못 한 요청)', () => {
    expect(settleEditorRegen(prior, 'failed', '월 AI 예산 한도', NOW)).toStrictEqual({
      ...prior,
      pendingRegen: false,
      editorRegen: {
        style: 'lifestyle',
        requestedAt: NOW,
        status: 'failed',
        finishedAt: NOW,
        message: '월 AI 예산 한도',
      },
    })
  })

  it('미달 뒤 재생성이 실패해도 rejected이고 이전 이미지를 둔다', async () => {
    const d = deps([gen(NEW), gen(OLD, { error: 'hero 생성 실패: timeout' })], [FAIL])
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry.url).toBe(OLD)
    expect(entry.editorRegen?.status).toBe('rejected')
    expect(entry.editorRegen?.message).toContain('hero 생성 실패: timeout')
  })

  it('새 url이 와도 error가 실려 있으면 결과로 받지 않는다(failed, 게이트 안 부름)', async () => {
    const d = deps([gen(NEW, { error: 'hero 생성 실패: 업로드 뒤 검증 실패' })], [])
    const { entry } = await runEditorRegenFlow(prior, d)
    expect(entry.url).toBe(OLD)
    expect(entry.editorRegen?.status).toBe('failed')
    expect(d.judge).not.toHaveBeenCalled()
  })
})

describe('유지할 것·지금 컷 참조(P1-4)', () => {
  it('keep은 note처럼 한 줄로 정리하고, useCurrent는 true일 때만 받는다', () => {
    expect(parseRegenRequest({ section: 'hero', keep: ' 제품 각도\n그대로 ', useCurrent: true })).toStrictEqual({
      ok: true,
      value: { section: 'hero', keep: '제품 각도 그대로', useCurrent: true },
    })
    expect(parseRegenRequest({ section: 'hero', keep: '  ', useCurrent: 'yes' })).toStrictEqual({ ok: true, value: { section: 'hero' } })
    expect(parseRegenRequest({ section: 'hero', keep: 3 })).toMatchObject({ ok: false, error: 'keep은 문자열이어야 합니다.' })
  })

  it('요청 표시는 keep·useCurrent를 기록에 남긴다', () => {
    const list = markEditorRegen([{ section: 'hero', url: OLD }], { section: 'hero', keep: '소품 그대로', useCurrent: true }, NOW)
    expect(list[0].editorRegen).toStrictEqual({ keep: '소품 그대로', useCurrent: true, requestedAt: NOW, status: 'pending' })
  })

  it('조정 블록: 지금 컷을 붙였으면 그 컷을 고치라고, 유지할 것은 따로 한 줄(옵션 사진 가드 같음)', () => {
    const job = { spec_sheet: {}, analysis: {} } as unknown as PdpJobRow
    const block = buildEditorRegenDirective({ note: '배경 밝게', keep: '제품 각도' }, job, { currentRef: true })
    expect(block).toContain('The LAST attached reference image is the CURRENT version of this cut.')
    expect(block).toContain('Owner request (may be in Korean): 배경 밝게')
    expect(block).toContain('Keep unchanged (owner, may be in Korean): 제품 각도')
    // 지금 컷을 못 받았으면(currentRef 없음) 그 안내는 없다. 유지할 것만 있어도 블록이 생긴다
    const keepOnly = buildEditorRegenDirective({ keep: '제품 각도' }, job)
    expect(keepOnly).not.toContain('CURRENT version')
    expect(keepOnly).toContain('Keep unchanged')
    expect(buildEditorRegenDirective({}, job, { currentRef: true })).toContain('CURRENT version')
  })
})

describe('직전 컷으로 되돌리기(revertEditorRegen)', () => {
  const doneEntry: SectionImage = {
    section: 'hero',
    url: NEW,
    prompt: 'P',
    annotations: [{ kind: 'number', anchor: { x: 0.5, y: 0.5 }, text: '2', source: 'howto[1]' }],
    annotationStatus: 'done',
    imageAspect: 1,
    pendingRegen: false,
    editorRegen: {
      requestedAt: NOW,
      status: 'done',
      previousUrl: OLD,
      previous: { annotations: prior.annotations, annotationStatus: 'done', imageAspect: 0.75 },
    },
  }

  it('url·장식·비율을 바뀌기 전 것과 맞바꾸고, 다시 되돌리면 원래대로(되돌림 취소)', () => {
    const back = revertEditorRegen(doneEntry, '2026-10-29T11:00:00.000Z')!
    expect(back).toMatchObject({ url: OLD, annotations: prior.annotations, annotationStatus: 'done', imageAspect: 0.75 })
    expect(back.editorRegen).toMatchObject({
      status: 'done',
      previousUrl: NEW,
      previous: { annotations: doneEntry.annotations, annotationStatus: 'done', imageAspect: 1 },
      revertedAt: '2026-10-29T11:00:00.000Z',
    })
    const again = revertEditorRegen(back, '2026-10-29T11:01:00.000Z')!
    expect(again).toMatchObject({ url: NEW, annotations: doneEntry.annotations, imageAspect: 1 })
    expect(again.editorRegen?.previousUrl).toBe(OLD)
  })

  it('사이즈 단독 컷의 제품 경계도 컷과 함께 맞바꾼다 — 치수선이 다른 컷의 측정으로 그려지지 않게', () => {
    const oldBox = { left: 0.2, top: 0.2, width: 0.6, height: 0.6, aspect: 0.75 }
    const newBox = { left: 0.3, top: 0.1, width: 0.4, height: 0.8, aspect: 0.75 }
    const sized: SectionImage = {
      ...doneEntry,
      section: 'size_single',
      productBox: newBox,
      editorRegen: { requestedAt: NOW, status: 'done', previousUrl: OLD, previous: { productBox: oldBox } },
    }
    const back = revertEditorRegen(sized, NOW)!
    expect(back).toMatchObject({ url: OLD, productBox: oldBox })
    expect(back.editorRegen?.previous?.productBox).toEqual(newBox)
    expect(revertEditorRegen(back, NOW)).toMatchObject({ url: NEW, productBox: newBox })
    // 되돌린 컷을 재지 못했으면 지금 컷의 경계를 남기지 않는다
    const unmeasured = revertEditorRegen({ ...sized, editorRegen: { requestedAt: NOW, status: 'done', previousUrl: OLD, previous: {} } }, NOW)!
    expect(unmeasured.productBox).toBeUndefined()
  })

  it('예전 기록(장식 기록 없음)은 장식 없이 되돌리고 장식 다시 고르기를 건너뛴다(skipped — 유료 비전 콜 없음)', () => {
    const legacy: SectionImage = { ...doneEntry, editorRegen: { requestedAt: NOW, status: 'done', previousUrl: OLD } }
    const back = revertEditorRegen(legacy, NOW)!
    expect(back.url).toBe(OLD)
    expect(back.annotations).toBeUndefined()
    expect(back.annotationStatus).toBe('skipped')
    expect(back.imageAspect).toBeUndefined()
  })

  it('done이 아니거나 previousUrl이 없거나 재생성 대기 중이면 되돌릴 수 없다', () => {
    expect(revertEditorRegen({ ...doneEntry, editorRegen: { ...doneEntry.editorRegen!, status: 'rejected' } }, NOW)).toBeNull()
    expect(revertEditorRegen({ ...doneEntry, editorRegen: { requestedAt: NOW, status: 'done' } }, NOW)).toBeNull()
    expect(revertEditorRegen({ ...doneEntry, pendingRegen: true }, NOW)).toBeNull()
    expect(isRevertible(doneEntry)).toBe(true)
    expect(isRevertible(undefined)).toBe(false)
  })
})
