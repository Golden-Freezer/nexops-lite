/**
 * 섹션 잇기(R4 pdp-r4-copy-bridge, docs/plans/pdp-enrichment/09_SECTION_BRIDGES.md 권장안 A) — 설득 단계 순서에서 인접한
 * 섹션 쌍마다 뒤 섹션의 보이는 필드가 앞 섹션의 사실 낱말 하나를 이어받게 정한다. 문구는 정하지 않는다(어떤 낱말을 받을지만).
 * 순수 함수 — 같은 설득 기록이면 같은 잇기. 렌더러는 바꾸지 않는다(받는 말은 이미 보이는 필드 안에 있다).
 */

import type { CopywritingResult } from '../pdp-state'
import { keywordsOf, sameWord } from '../editor/utils/sectionConverter/dedupe'

/** 이어받는 낱말의 종류 — 결과·효과·감각 낱말은 없다(주장 범위) */
export type BridgeAnchor = 'situation' | 'concern' | 'function' | 'feature' | 'hook'

export interface SectionBridge {
  from: string
  to: string
  /** 보내는 쪽 카피 필드(표시용 경로) */
  sendField: string
  /** 받는 쪽 카피 필드 — 경로마다 보이는 필드가 달라 여럿일 수 있다(해결 섹션: 편집기 summary, 디자인 컷·합성 declaration) */
  receiveFields: string[]
  anchor: BridgeAnchor
}

const FEATURE_TITLES = 'pointCards[].title'

/** 보내는 섹션 — 그 섹션의 대표 카피 필드와 넘겨줄 낱말 종류 */
const SENDERS: Record<string, { field: string; anchor: BridgeAnchor }> = {
  hook_3step: { field: 'mainIntro.hook', anchor: 'situation' },
  problem_raise: { field: 'problem.question', anchor: 'concern' },
  problem_empathy: { field: 'problem.question', anchor: 'concern' },
  solution_guide: { field: 'solution.summary', anchor: 'function' },
  main_cut: { field: FEATURE_TITLES, anchor: 'feature' },
  point_div: { field: FEATURE_TITLES, anchor: 'feature' },
  sub_div: { field: FEATURE_TITLES, anchor: 'feature' },
}

const FEATURE_SENDERS = ['main_cut', 'point_div', 'sub_div']

/**
 * 받는 섹션 — 편집기 경로(sectionConverter content.ts·dedupe.ts)에서 화면에 보이는 첫 필드와 받을 수 있는 보내는 섹션.
 * 고민은 첫 화면의 상황에서, 해결은 고민에서, point_div 첫 claim은 해결에서, 증거·대상 안내는 특징에서, CTA는 첫 화면에서 받는다.
 * R1처럼 main_cut이 문제 섹션보다 앞에 와도 고민이 특징 낱말을 받지 않게 섹션 종류로 고른다.
 * main_cut은 받지 않는다 — 설득 플래너에서 늘 첫 화면 바로 뒤라(verifier 스윕 818/818) 첫 화면 낱말이 고민·CTA와 함께 세 곳으로
 * 퍼지고, 제목은 중복 정리의 되풀이 검사를 받아 낱말 하나만 더 겹쳐도 지워진다(R1 P02). 사진·옵션명·입력값 표 섹션도 받지 않는다.
 */
const RECEIVERS: Record<string, { fields: string[]; from: string[] }> = {
  problem_raise: { fields: ['problem.question'], from: ['hook_3step'] },
  problem_empathy: { fields: ['problem.question'], from: ['hook_3step'] },
  solution_guide: { fields: ['solution.declaration', 'solution.summary'], from: ['problem_raise', 'problem_empathy'] },
  // 특징 배정이 claim에 카드 제목 낱말을 넣게 하므로 특징 섹션 뒤에서는 따로 잇지 않는다 — 해결에서만 받는다
  point_div: { fields: ['detailPoints[0].claim'], from: ['solution_guide'] },
  hidden_page: { fields: ['howTo[0].step'], from: FEATURE_SENDERS },
  point_list_div: { fields: ['recommendedTargets[0]'], from: FEATURE_SENDERS },
  cta: { fields: ['closingCta.headline'], from: ['hook_3step'] },
}

/**
 * 설득 단계 순서 → 잇기 목록. 받는 섹션은 받을 수 있는 보내는 섹션 가운데 앞에 나온 가장 가까운 것에서 받는다
 * (사이의 사진·옵션 섹션은 건너뛴다). 받을 곳이 없으면 잇지 않는다. 같은 필드는 한 번만 받는다(문제 섹션이 둘이면 앞 것만).
 */
export function planSectionBridges(stages: ReadonlyArray<{ section: string }>, opts: { hookShort?: boolean } = {}): SectionBridge[] {
  const bridges: SectionBridge[] = []
  const usedFields = new Set<string>()
  const seen: string[] = []
  for (const { section } of stages) {
    const receiver = RECEIVERS[section]
    const from = receiver ? [...seen].reverse().find((s) => receiver.from.includes(s)) : undefined
    const fresh = receiver?.fields.filter((f) => !usedFields.has(f)) ?? []
    if (from && fresh.length > 0) {
      fresh.forEach((f) => usedFields.add(f))
      bridges.push({
        from,
        to: section,
        // hookshort 잡은 hook이 첫 화면에 나오지 않아 보이는 제목에서 잇는다
        sendField: opts.hookShort && from === 'hook_3step' ? 'mainIntro.benefitHeadline' : SENDERS[from].field,
        receiveFields: fresh,
        anchor: section === 'cta' ? 'hook' : SENDERS[from].anchor,
      })
    }
    if (SENDERS[section]) seen.push(section)
  }
  return bridges
}

/** 같은 자리의 다른 꼴 — detailPoints는 {claim} 또는 정규화 전 {title}(closingCta 문자열 꼴은 fieldText가 따로 읽는다) */
const FIELD_ALIASES: Record<string, string[]> = { claim: ['claim', 'title'] }

/** 카피 필드 경로 → 글(배열 경로는 [0]만, pointCards[].title은 제목 전부) */
function fieldText(copy: CopywritingResult, path: string): string {
  if (path === FEATURE_TITLES) return (copy.pointCards ?? []).map((c) => c?.title ?? '').join(' ')
  let node: unknown = copy
  for (const part of path.split('.')) {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(part)
    if (!m) return ''
    // 문자열 CTA(closingCta: "…")는 headline 자리 그대로
    if (typeof node === 'string' && m[1] === 'headline') return node
    if (!node || typeof node !== 'object') return ''
    const record = node as Record<string, unknown>
    node = (FIELD_ALIASES[m[1]] ?? [m[1]]).map((key) => record[key]).find((v) => v !== undefined)
    if (m[2] !== undefined) node = Array.isArray(node) ? node[Number(m[2])] : undefined
  }
  return typeof node === 'string' ? node : ''
}

/**
 * 품질 보고서 bridges(설계 §2.4) — 받는 필드 가운데 하나라도 보내는 필드와 같은 낱말(dedupe keywordsOf·sameWord)을 쓰면 이어진 것.
 * 양쪽 글이 모두 있는 쌍만 센다. 카피 기준이다(편집기에서 그 필드가 실제로 보였는지는 재지 않는다).
 */
export function measureSectionBridges(
  bridges: readonly SectionBridge[],
  copy: CopywritingResult
): { pairs: number; linked: number; unlinked: string[] } {
  let pairs = 0
  let linked = 0
  const unlinked: string[] = []
  for (const b of bridges) {
    const sent = keywordsOf(fieldText(copy, b.sendField))
    const received = b.receiveFields.flatMap((f) => keywordsOf(fieldText(copy, f)))
    if (sent.length === 0 || received.length === 0) continue
    pairs++
    if (received.some((w) => sent.some((s) => sameWord(w, s)))) linked++
    else unlinked.push(b.to)
  }
  return { pairs, linked, unlinked }
}
