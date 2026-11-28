/**
 * 게이트 사용 미달 끝 처리(usegate, 결정 카드 c08·J19 — 가정 A3) — 순수 함수. 나은 컷 순위의 사용 맞음, 끝까지 사용 미달인 컷 빼기(대표 컷은 경고),
 * 받는 컷 고르기. 옵션이 없으면 지금 동작 그대로인지 함께 본다.
 */

import { describe, expect, it } from 'vitest'
import type { PdpJobRow, SectionImage } from './pdp-state'
import { betterCutOf, settleLineFailure, strictUseGateOf } from './pdp-image-stage'

const cut = (section: string): SectionImage => ({ section, url: `https://cdn.test/${section}.png`, prompt: 'p' })
const K = { lineGate: {} }

describe('betterCutOf — 사용 맞음 순위(usegate)', () => {
  it('use를 켜면 부품 다음에 사용 맞음을 보고, 끄면 지금 순위(일관성)로 고른다', () => {
    const first = { same_product: true, parts_match: true, use_correct: true, consistency: 0.5 }
    const regen = { same_product: true, parts_match: true, use_correct: false, consistency: 0.9 }
    expect(betterCutOf(first, regen, { use: true })).toBe('first')
    expect(betterCutOf(first, regen)).toBe('regen')
    // 같은 상품·부품이 사용보다 먼저다
    expect(betterCutOf({ parts_match: false, use_correct: true }, { parts_match: true, use_correct: false }, { use: true })).toBe('regen')
    expect(betterCutOf({ same_product: false, use_correct: true }, { same_product: true, use_correct: false }, { use: true })).toBe('regen')
    // 사용까지 같으면 일관성, 모두 같으면 새 컷
    expect(betterCutOf({ use_correct: false, consistency: 0.8 }, { use_correct: false, consistency: 0.6 }, { use: true })).toBe('first')
    expect(betterCutOf({ use_correct: false }, { use_correct: false }, { use: true })).toBe('regen')
  })
})

describe('settleLineFailure — 끝까지 사용 미달(usegate)', () => {
  const useFail = { same_product: true, use_correct: false, use_reason: 'held by the bristles' }

  it('use를 켜면 대표 아닌 컷은 url을 비워 빼고 뺀 주소·까닭을 남긴다', () => {
    const out = settleLineFailure({ section: 'k3_photo_0', ...K }, cut('k3_photo_0'), useFail, '게이트 미달(재판정 뒤)', { use: true })
    expect(out.url).toBe('')
    expect(out.droppedForUse).toEqual({ url: 'https://cdn.test/k3_photo_0.png', reason: '쓰는 법 미달: held by the bristles' })
    expect(out.error).toBe('게이트 미달(재판정 뒤) — 페이지에서 뺌(쓰는 법 미달: held by the bristles)')
    expect(out.droppedForProduct).toBeUndefined()
  })

  it('대표 컷은 첫 화면이라 빼지 않고 경고만 남긴다', () => {
    const out = settleLineFailure({ section: 'hero', ...K }, cut('hero'), useFail, 'e', { use: true })
    expect(out.url).toBe('https://cdn.test/hero.png')
    expect(out.gateWarning).toContain('쓰는 법이 원본과 달라 보임')
    expect(out.droppedForUse).toBeUndefined()
  })

  it('use가 없거나(꺼진 잡·사용 판정이 아닌 컷), 사용이 맞거나, K 컷이 아니면 지금처럼 error만', () => {
    expect(settleLineFailure({ section: 'k3_photo_0', ...K }, cut('k3_photo_0'), useFail, 'e')).toEqual({ ...cut('k3_photo_0'), error: 'e' })
    expect(settleLineFailure({ section: 'k3_photo_0', ...K }, cut('k3_photo_0'), { same_product: true, use_correct: true }, 'e', { use: true })).toEqual({
      ...cut('k3_photo_0'),
      error: 'e',
    })
    expect(settleLineFailure({ section: 'usage' }, cut('usage'), useFail, 'e', { use: true })).toEqual({ ...cut('usage'), error: 'e' })
  })

  it('상품 불일치가 먼저다 — 사용도 미달이어도 상품 불일치로 뺀다', () => {
    const out = settleLineFailure({ section: 'k3_photo_0', ...K }, cut('k3_photo_0'), { ...useFail, same_product: false, artifact_reason: 'other bag' }, 'e', { use: true })
    expect(out.droppedForProduct?.reason).toBe('상품 불일치: other bag')
    expect(out.droppedForUse).toBeUndefined()
  })
})

describe('strictUseGateOf — 받는 컷', () => {
  const jobWith = (features: string[]) => ({ analysis: { enrichment: { version: 1, features } } }) as unknown as Pick<PdpJobRow, 'analysis'>

  it('usegate 잡의 사용 판정(useGate) K 컷만', () => {
    expect(strictUseGateOf(jobWith(['templatelib', 'usegate']), { lineGate: {}, useGate: true })).toBe(true)
    expect(strictUseGateOf(jobWith(['templatelib']), { lineGate: {}, useGate: true })).toBe(false)
    expect(strictUseGateOf(jobWith(['templatelib', 'usegate']), { lineGate: {} })).toBe(false)
    expect(strictUseGateOf(jobWith(['templatelib', 'usegate']), { useGate: true })).toBe(false)
  })
})
