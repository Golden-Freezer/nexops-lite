/**
 * D2-3 첫 화면 글자 자리(C4) 순수 함수 — 위쪽 띠 측정(밝기 퍼짐·잔결·글자 대비), 지시 블록(강화 지시 포함), 재생성 대상·결과 정리.
 */

import { describe, expect, it } from 'vitest'
import { buildStyleCharter } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  buildCopyZoneBlock,
  COPY_ZONE_HEADER,
  COPY_ZONE_LIMITS,
  copyZoneRetryPending,
  measureCopyZone,
  needsCopyZoneRetry,
  settleCopyZoneRetry,
  withCopyZone,
  type CopyZoneMeasure,
  type HeroCopyZoneRecord,
} from './hero-copy-zone'
import { applyD2SceneCut } from '../pdp-image-scene'
import { canonLight } from '../pdp-image-light'
import { tidyImageBrief } from '../pdp-image-brief'
import type { SectionImage } from '../pdp-state'

const W = 64
const H = 85

/** 위 36%는 top(x, y)가 정한 값, 그 아래는 상품 덩어리(어두운 직사각형) + 밝은 바탕 */
function frame(top: (x: number, y: number) => number): Uint8Array {
  const gray = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      gray[y * W + x] = y < H * 0.36 ? top(x, y) : x > 12 && x < 52 && y > 38 ? 60 : 200
    }
  }
  return gray
}

const PASS: CopyZoneMeasure = { pass: true, std: 3, gradient: 0.5, contrast: 14, ink: 'dark' }
const FAIL: CopyZoneMeasure = { pass: false, std: 70, gradient: 40, contrast: 2, ink: 'dark', reasons: ['detail'] }
const zoneOf = (measure: CopyZoneMeasure, extra: Partial<HeroCopyZoneRecord> = {}): HeroCopyZoneRecord => ({
  version: 1,
  zone: { from: 0, to: 0.33 },
  attempt: 1,
  measure,
  ...extra,
})
const hero = (url: string, copyZone?: HeroCopyZoneRecord, extra: Partial<SectionImage> = {}): SectionImage => ({
  section: 'hero',
  url,
  ...(copyZone ? { copyZone } : {}),
  ...extra,
})

describe('measureCopyZone — 위쪽 띠(세로 2~30%, 가로 5~95%)', () => {
  it('고른 밝은 띠는 통과하고 짙은 글자색을 고른다', () => {
    const m = measureCopyZone(frame(() => 236), W, H)!
    expect(m).toMatchObject({ pass: true, std: 0, gradient: 0, ink: 'dark' })
    expect(m.contrast).toBeGreaterThan(10)
    expect(m.reasons).toBeUndefined()
  })

  it('고른 어두운 띠는 흰 글자색으로 통과한다', () => {
    const m = measureCopyZone(frame(() => 40), W, H)!
    expect(m).toMatchObject({ pass: true, ink: 'light' })
    expect(m.contrast).toBeGreaterThan(COPY_ZONE_LIMITS.contrast)
  })

  it('중간 회색 띠는 고르더라도 어느 글자색도 대비가 모자라 contrast로 미달', () => {
    const m = measureCopyZone(frame(() => 128), W, H)!
    expect(m.pass).toBe(false)
    expect(m.reasons).toEqual(['contrast'])
    expect(m.contrast).toBeLessThan(COPY_ZONE_LIMITS.contrast)
  })

  it('줄무늬(창살·선반)는 detail로 미달 — 대비가 갈리는 화소가 섞이면 contrast도 함께', () => {
    const m = measureCopyZone(frame((x) => (Math.floor(x / 2) % 2 ? 40 : 220)), W, H)!
    expect(m.pass).toBe(false)
    expect(m.reasons).toContain('detail')
    expect(m.std).toBeGreaterThan(COPY_ZONE_LIMITS.std)
    expect(m.gradient).toBeGreaterThan(COPY_ZONE_LIMITS.gradient)
  })

  it('상품 윗부분이 띠 안으로 올라오면 미달, 띠 아래(30% 밑)의 복잡함은 보지 않는다', () => {
    const intruding = frame((x, y) => (x > 20 && x < 44 && y > 12 ? 50 : 236))
    expect(measureCopyZone(intruding, W, H)!.reasons).toContain('detail')
    const busyBelow = frame(() => 236)
    for (let y = Math.ceil(H * 0.31); y < H; y++) for (let x = 0; x < W; x++) busyBelow[y * W + x] = x % 2 ? 0 : 255
    expect(measureCopyZone(busyBelow, W, H)!.pass).toBe(true)
  })

  it('잴 화소가 모자라거나 화소 수가 크기와 맞지 않으면 null', () => {
    expect(measureCopyZone(new Uint8Array(4), 2, 2)).toBeNull()
    expect(measureCopyZone(new Uint8Array(10), W, H)).toBeNull()
  })
})

describe('글자 자리 지시 블록', () => {
  it('위 33%를 글자 없이 비우고 상품은 아래 2/3·폭 55% 이상 — 가운데 배치·채움 비율보다 앞선다', () => {
    const block = buildCopyZoneBlock()
    // D2 첫 화면 지시는 글자 하나 바뀌지 않는다 — K 사진 위 글과 문구를 나눠 쓴 뒤에도 그대로다
    expect(block).toBe(
      '[Copy zone]\n' +
        'Leave the top third of the frame (the top 33%) as a calm, low-detail part of the set — one even tone of wall or softly out-of-focus background, ' +
        'with no props, no product parts and no strong edges, patterns, shadows or bright highlights in it. The page layout adds its headline there later, ' +
        'so draw no text, letters, numerals, logos or signs in it. Place the whole product in the lower two thirds — its top edge below the top third and ' +
        'its width at least 55% of the frame width. This wins over any centered placement or frame-fill share above.'
    )
    expect(block.startsWith(COPY_ZONE_HEADER)).toBe(true)
    for (const phrase of ['top 33%', 'low-detail', 'draw no text', 'lower two thirds', '55% of the frame width', 'centered placement']) {
      expect(block, phrase).toContain(phrase)
    }
    expect(block).not.toContain('previous attempt')
  })

  it('강화 지시는 처음 컷의 미달 사유를 한 줄씩 덧붙인다', () => {
    const detail = buildCopyZoneBlock(FAIL)
    expect(detail).toContain('too much detail')
    expect(detail).not.toContain('mid tone')
    const both = buildCopyZoneBlock({ ...FAIL, reasons: ['detail', 'contrast'] })
    expect(both).toContain('too much detail')
    expect(both).toContain('clearly light or clearly dark')
    expect(buildCopyZoneBlock(PASS)).toBe(buildCopyZoneBlock())
  })

  it('첫 화면 컷에만 붙는다', () => {
    expect(withCopyZone('P', 'hero')).toBe(`P\n\n${buildCopyZoneBlock()}`)
    for (const section of ['features:0', 'cta', 'problem', 'detail']) expect(withCopyZone('P', section), section).toBe('P')
  })

  it('D2 세트 장면 블록 뒤에 붙고, 빛 정본·브리프 정리를 거쳐도 남는다', () => {
    const charter = buildStyleCharter({
      bgHex: '#fff7f0',
      colorTemp: 'Warm-neutral 5000K',
      direction: 'top-left',
      shadowAngle: 45,
      propColors: '#c2410c',
      mood: 'cozy',
      setDesc: 'one continuous set',
    })
    const out = withCopyZone(applyD2SceneCut(`HERO\n\n${charter}`, 'hero'), 'hero', FAIL)
    expect(out.indexOf(COPY_ZONE_HEADER)).toBeGreaterThan(out.indexOf('[Set scene]'))
    const tidied = tidyImageBrief(canonLight(out).prompt, { sizeHonored: true }).prompt
    expect(tidied).toContain(COPY_ZONE_HEADER)
    expect(tidied).toContain('55% of the frame width')
    expect(tidied).toContain('too much detail')
  })
})

describe('needsCopyZoneRetry·copyZoneRetryPending — 다시 만들어 볼 첫 화면 컷', () => {
  it('첫 지시 컷이 미달이고 아직 재생성 결과가 없을 때만', () => {
    expect(needsCopyZoneRetry(hero('u1', zoneOf(FAIL)))).toBe(true)
    expect(needsCopyZoneRetry(hero('u1', zoneOf(PASS)))).toBe(false)
    expect(needsCopyZoneRetry(hero('u1', zoneOf(FAIL, { attempt: 2 })))).toBe(false)
    for (const retry of ['pending', 'kept', 'skipped'] as const) {
      expect(needsCopyZoneRetry(hero('u1', zoneOf(FAIL, { retry }))), retry).toBe(false)
    }
  })

  it('미룬 재생성(pending)만 다음 run의 일 — 다른 조건은 같다', () => {
    expect(copyZoneRetryPending(hero('u1', zoneOf(FAIL, { retry: 'pending' })))).toBe(true)
    expect(copyZoneRetryPending(hero('u1', zoneOf(FAIL)))).toBe(false)
    expect(copyZoneRetryPending(hero('u1', zoneOf(FAIL, { retry: 'skipped' })))).toBe(false)
    expect(copyZoneRetryPending(hero('u1', zoneOf(FAIL, { retry: 'pending' }), { error: '게이트 미달' }))).toBe(false)
    expect(copyZoneRetryPending({ ...hero('u1', zoneOf(FAIL, { retry: 'pending' })), section: 'cta' })).toBe(false)
  })

  it('재지 못한 컷·기록 없는 컷·첫 화면이 아닌 컷·오류나 게이트 대기 컷은 다시 만들지 않는다', () => {
    expect(needsCopyZoneRetry(hero('u1', { version: 1, zone: { from: 0, to: 0.33 }, attempt: 1, failed: 'decode_failed' }))).toBe(false)
    expect(needsCopyZoneRetry(hero('u1'))).toBe(false)
    expect(needsCopyZoneRetry({ ...hero('u1', zoneOf(FAIL)), section: 'cta' })).toBe(false)
    expect(needsCopyZoneRetry(hero('u1', zoneOf(FAIL), { error: '게이트 미달(재생성 소진, 정체성)' }))).toBe(false)
    expect(needsCopyZoneRetry(hero('u1', zoneOf(FAIL), { pendingRegen: true }))).toBe(false)
    expect(needsCopyZoneRetry(hero('', zoneOf(FAIL)))).toBe(false)
  })
})

describe('settleCopyZoneRetry — 다시 만든 컷을 쓸지', () => {
  const first = hero('u1', zoneOf(FAIL), { pendingRegen: false })
  const retryPass = hero('u2', zoneOf(PASS, { attempt: 2 }))

  it('게이트 통과(또는 skip)이고 글자 자리를 통과하면 다시 만든 컷을 쓰고 처음 잰 값을 other로 남긴다', () => {
    for (const verdict of ['pass', 'skip'] as const) {
      const out = settleCopyZoneRetry(first, retryPass, verdict)
      expect(out.url, verdict).toBe('u2')
      expect(out.copyZone).toMatchObject({ attempt: 2, measure: PASS, other: FAIL })
      expect(out.copyZone?.retry).toBeUndefined()
      expect(out.pendingRegen).toBe(false)
    }
  })

  it('게이트 미달·글자 자리 미달이면 처음 컷을 두고 kept + 다시 만든 컷의 잰 값', () => {
    const gateFail = settleCopyZoneRetry(first, retryPass, 'fail')
    expect(gateFail.url).toBe('u1')
    expect(gateFail.copyZone).toMatchObject({ attempt: 1, measure: FAIL, retry: 'kept', other: PASS })
    const stillBusy = settleCopyZoneRetry(first, hero('u2', zoneOf(FAIL, { attempt: 2 })), 'pass')
    expect(stillBusy.url).toBe('u1')
    expect(stillBusy.copyZone).toMatchObject({ retry: 'kept', other: FAIL })
  })

  it('생성 실패(오류·같은 url)·게이트를 보지 못한 경우는 처음 컷을 두고 other 없이 kept', () => {
    const failed = settleCopyZoneRetry(first, hero('u1', undefined, { error: 'hero 생성 실패: 500' }), null)
    expect(failed).toEqual({ ...first, copyZone: { ...first.copyZone!, retry: 'kept' } })
    expect(settleCopyZoneRetry(first, retryPass, null).url).toBe('u1')
  })
})
