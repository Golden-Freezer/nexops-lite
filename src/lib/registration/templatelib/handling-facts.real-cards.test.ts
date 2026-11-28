/**
 * 실제 식별 카드 표본(결정 카드 c32, 가정 A6) — handling-facts.test.ts의 카드는 마침표로 나뉜 손글씨라 운영 카드의 모양(머리말 + 쉼표로
 * 이어진 한 문장)에서 생기는 결함을 놓쳤다. 지난 K 라인 시험 잡의 카드 그대로(__fixtures__/identity-cards.json)로 기본 경로를 기록한다.
 * 이 시험은 지금 동작을 고정한다 — 쓰는 법 재료 고침(c02)은 스위치 뒤라 기본 경로는 그대로이고, 켠 경로 시험을 같은 표본으로 더한다.
 */

import { describe, expect, it } from 'vitest'
import samples from '../__fixtures__/identity-cards.json'
import { HANDLING_FACTS_MAX, handlingFactsOf } from './handling-facts'

const CARD_HEAD = 'PRODUCT IDENTITY ('

describe('실제 식별 카드 표본(__fixtures__/identity-cards.json)', () => {
  it('상품 P01~P11마다 한 장, 잡 저장본의 카드 그대로(머리말로 시작, 잡 ID 8자·날짜 있음)', () => {
    expect(samples.cards.map((c) => c.product)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11'])
    expect(new Set(samples.cards.map((c) => c.job)).size).toBe(samples.cards.length)
    for (const c of samples.cards) {
      expect(c.card.startsWith(CARD_HEAD), c.product).toBe(true)
      expect(c.job, c.product).toMatch(/^[0-9a-f]{8}$/)
      expect(c.createdAt, c.product).toMatch(/^2026-\d{2}-\d{2}$/)
    }
  })

  it('운영 카드 모양: 머리말이 "…below):"로 끝나 문장 경계가 없다 — 머리말과 첫 사실이 한 문장으로 붙는다', () => {
    for (const c of samples.cards) {
      const head = c.card.slice(0, c.card.indexOf('):') + 2)
      expect(head, c.product).toMatch(/below[^)]*\):$/)
      expect(/[.!?]$/.test(head), c.product).toBe(false)
    }
  })
})

describe('handlingFactsOf — 실제 카드로 본 기본 경로(결정 카드 c02 결함 기록)', () => {
  const noNote = samples.cards.filter((c) => !c.identityNote)
  const withNote = samples.cards.filter((c) => c.identityNote)

  it('판매자 입력이 없는 카드 10장 모두 Use 재료가 카드 머리말로 시작해 240자에서 잘린다(K8 카드 55/55와 같은 결함)', () => {
    expect(noNote).toHaveLength(10)
    for (const c of noNote) {
      const facts = handlingFactsOf(c.identityNote, c.card)
      expect(facts, c.product).not.toBeNull()
      expect(facts!.startsWith(CARD_HEAD), c.product).toBe(true)
      expect(facts!.length, c.product).toBe(HANDLING_FACTS_MAX.chars)
      expect(facts!.endsWith('…'), c.product).toBe(true)
    }
  })

  it('판매자 입력이 있으면 그 문장이 먼저 — 카드 문장은 상한을 넘어 붙지 않는다(P07)', () => {
    expect(withNote.map((c) => c.product)).toEqual(['P07'])
    const p07 = withNote[0]
    expect(handlingFactsOf(p07.identityNote, p07.card)).toBe(p07.identityNote)
  })
})
