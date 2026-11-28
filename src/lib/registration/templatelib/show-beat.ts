/**
 * 보여 줄 동작·설계 한 줄(showbeat 잡만, 하네스 J63·통합 decide 42).
 * 근거: 오너 J59 메모 — '"두피를 문지르는 모습", "적당한 탄성 마사지 설계" 같은 표현은 이미지나 움직이는 이미지로 직접 보여 줘야 하는데 약하다'.
 * 지금 섹션 카피는 컷 지시에 '참고 글' 한 줄로만 들어가고, 움직이는 칸 동작은 카피 전체라 동작 낱말이 제목 뒤에 묻힌다.
 *
 * 섹션 카피(칸 글)에서 낱말표로 동작·설계 하나를 고른다. LLM을 부르지 않는다(결정적, 유료 0).
 * - 사실 문: 같은 낱말 줄기가 상품 사실에도 있어야 쓴다. 사실에 없는 동작은 만들지 않는다.
 *   출처는 spec 칸(핵심 특징·재질·사용 장소·식별 메모·사용 순서 입력) → 식별 카드 USE 줄 → 카피 howTo 순이다(showBeatFactsOfJob, J63 2단계).
 * - 띄어쓰기: 카피가 붙어 와도('두피를문지르는모습') 잡히게 공백을 지우고 비교한다(J62).
 * - 고르기: 카피에서 가장 먼저 나오는 낱말(제목이 본문보다 먼저)을 쓴다. 못 고르면 null이다(지시 그대로).
 * 순수 함수 — 잡·DB를 읽지 않는다.
 */

import type { PdpSpecSheet } from '../pdp-state'
import { HANDLED, type LineShot } from './shot-brief'

export type ShowBeatId = 'rub' | 'brush' | 'press' | 'rinse' | 'fold' | 'attach' | 'flex' | 'reach' | 'grip' | 'waterproof'

export interface ShowBeat {
  id: ShowBeatId
  /** 동작(손이 하는 일) 또는 설계(부품이 하는 일) */
  kind: 'action' | 'design'
  /** 컷 지시·움직이는 칸에 싣는 영어 장면 문구 */
  phrase: string
  /** 움직이는 칸 고르기 프롬프트(한국어)에 싣는 이름 */
  label: string
  /** 사실 문을 지난 출처(J63 2단계) — 컷 기록 showBeatSource */
  source: ShowBeatSource
}

/** 사실 출처 — spec 칸·식별 카드 USE 줄·카피 howTo */
export type ShowBeatSource = 'spec' | 'card' | 'howto'
export interface ShowBeatFact {
  source: ShowBeatSource
  text: string
}
/** 사실 — 출처 목록, 또는 글 하나(spec 출처로 본다) */
export type ShowBeatFacts = string | readonly ShowBeatFact[]

interface BeatRule extends Omit<ShowBeat, 'source'> {
  /** 카피 낱말(공백 지운 글에 건다) */
  copy: RegExp
  /** 사실 낱말 — 한국어는 공백 지운 글, 영어는 원래 글에 건다 */
  factKo: RegExp
  factEn: RegExp
}

/** 낱말표 — 순서는 같은 자리에서 맞을 때의 우선순위다(동작 먼저) */
const RULES: readonly BeatRule[] = [
  {
    id: 'rub',
    kind: 'action',
    label: '문지르기',
    phrase: 'the hand rubbing it in small circles on the surface it works on, mid-stroke',
    copy: /문지르|문질러|문지름|문지른|마사지|비비|비벼/,
    factKo: /문지르|문질|마사지|비비|비벼/,
    factEn: /\b(rub|rubs|rubbing|massag\w*|scrub\w*)\b/i,
  },
  {
    id: 'brush',
    kind: 'action',
    label: '빗질·쓸기',
    phrase: 'it mid-stroke, moving along the surface it works on',
    copy: /빗질|빗어|빗으면|쓸어|쓸면/,
    factKo: /빗질|빗어|쓸어/,
    factEn: /\b(brush|brushes|brushing|comb|combs|combing|sweep\w*)\b/i,
  },
  {
    id: 'press',
    kind: 'action',
    label: '누르기',
    phrase: 'the hand pressing it down, caught at the press',
    copy: /누르|눌러|꾹/,
    factKo: /누르|눌러|누름/,
    factEn: /\b(press|presses|pressing|push|pushes|pushing)\b/i,
  },
  {
    id: 'rinse',
    kind: 'action',
    label: '헹구기',
    phrase: 'it held under running tap water, rinsing its working part',
    copy: /헹구|헹궈|헹굼|헹군/,
    factKo: /헹구|헹궈|헹굼|물세척|세척/,
    factEn: /\b(rins\w*|washable)\b/i,
  },
  {
    id: 'fold',
    kind: 'action',
    label: '접고 펴기',
    phrase: 'the hands folding or unfolding it, caught midway',
    copy: /접어|접으면|접히|접는|접힌|펼쳐|펼치|펴서|펴면/,
    factKo: /접이|접어|접히|접는|펼쳐|펼치|폴딩/,
    factEn: /\b(fold\w*|unfold\w*|collapsib\w*)\b/i,
  },
  {
    id: 'attach',
    kind: 'action',
    label: '붙이기·끼우기',
    phrase: 'the hand attaching it in place, caught as it goes on',
    copy: /붙이|붙여|끼우|끼워|걸어|거는/,
    factKo: /붙이|부착|끼우|끼워|걸이|거치/,
    factEn: /\b(attach\w*|stick\w*|clip\w*|hook\w*|mount\w*)\b/i,
  },
  {
    id: 'flex',
    kind: 'design',
    label: '탄성(눌렀을 때 휨)',
    phrase: 'its working part visibly bending under light pressure',
    copy: /탄성|휘어|휘는|휘고|유연|말랑/,
    factKo: /탄성|유연|말랑|휘어|휘는/,
    factEn: /\b(elastic\w*|flexib\w*|flexes|bend\w*|springy)\b/i,
  },
  {
    id: 'reach',
    kind: 'design',
    label: '구석까지 닿음',
    phrase: 'its tips reaching down into the narrow gaps it is made for',
    copy: /구석|닿는|닿아|닿지|사이까지|틈새까지/,
    factKo: /돌기|미세모|솔|빗살|핀|팁/,
    factEn: /\b(bristles?|tips?|pins?|teeth|tines?|nubs?)\b/i,
  },
  {
    id: 'grip',
    kind: 'design',
    label: '쥐는 손잡이',
    phrase: 'fingers wrapped firmly around its grip',
    copy: /감기는|감싸|쥐는|쥐어|잡히는|잡혀|그립/,
    factKo: /손잡이|그립|쥐|잡이/,
    factEn: /\b(grip\w*|handle\w*|knob\w*)\b/i,
  },
  {
    id: 'waterproof',
    kind: 'design',
    label: '물에 젖어도 씀',
    phrase: 'water beading and running off it while it keeps working',
    copy: /방수|물에젖|젖어도/,
    factKo: /방수|물에강|물에젖/,
    factEn: /\b(waterproof|water-resistant|water resistant)\b/i,
  },
]

const squeeze = (text: string) => text.replace(/\s+/g, '')

/** 사실 글 — 핵심 특징·재질·사용 장소·식별 메모·사용 순서 입력(제목·설명). 카피·리뷰는 넣지 않는다 */
export function showBeatFactsOf(spec: Pick<PdpSpecSheet, 'keyFeatures' | 'material' | 'usageLocation' | 'identityNote' | 'usageSteps'>): string {
  return [
    ...(spec.keyFeatures ?? []),
    spec.material ?? '',
    spec.usageLocation ?? '',
    spec.identityNote ?? '',
    ...(spec.usageSteps ?? []).flatMap((step) => [step.title, step.description ?? '']),
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * 잡의 사실 출처(J63 2단계, 통합 판단 11-11 10:0x) — 우선순위 spec 칸 → 식별 카드 USE 줄(사진 판독, design_prompts.identity_use) →
 * 카피 howTo(그 잡 copy_sections.final에 실린 사용 순서 글만 — 컷 지시 'Usage steps' 참고 줄·페이지 사용 순서와 같은 글).
 * 근거: P03 J59 두 잡은 spec에 material(ABS)뿐이라 spec만 읽으면 받는 컷이 0이었다. 빈 출처는 넣지 않는다
 */
export function showBeatFactsOfJob(job: {
  spec_sheet: Pick<PdpSpecSheet, 'keyFeatures' | 'material' | 'usageLocation' | 'identityNote' | 'usageSteps'>
  design_prompts?: { identity_use?: string } | null
  copy_sections?: { final?: { howTo?: ReadonlyArray<{ step?: string; description?: string }> } | null } | null
}): ShowBeatFact[] {
  const howTo = (job.copy_sections?.final?.howTo ?? []).flatMap((item) => [item.step ?? '', item.description ?? '']).map((text) => text.trim()).filter(Boolean)
  const facts: ShowBeatFact[] = [
    { source: 'spec', text: showBeatFactsOf(job.spec_sheet) },
    { source: 'card', text: job.design_prompts?.identity_use?.trim() ?? '' },
    { source: 'howto', text: howTo.join('\n') },
  ]
  return facts.filter((fact) => fact.text)
}

/** 출처 목록으로 — 글 하나는 spec 출처로 본다(1단계 꼴) */
const factsList = (facts: ShowBeatFacts): readonly ShowBeatFact[] => (typeof facts === 'string' ? (facts.trim() ? [{ source: 'spec', text: facts }] : []) : facts)

/** 낱말의 사실 문을 지나는 첫 출처(우선순위 순) — 없으면 null */
function factSourceOf(rule: BeatRule, facts: readonly ShowBeatFact[]): ShowBeatSource | null {
  return facts.find((fact) => rule.factKo.test(squeeze(fact.text)) || rule.factEn.test(fact.text))?.source ?? null
}

/** 칸 글의 보여 줄 동작·설계 — 사실 문을 지난 낱말 가운데 카피에서 가장 먼저 나오는 것. 없으면 null. source는 그 사실 문을 지난 첫 출처 */
export function showBeatOf(show: string, facts: ShowBeatFacts): ShowBeat | null {
  const text = squeeze(show)
  const list = factsList(facts)
  if (!text || list.length === 0) return null
  let best: { at: number; rule: BeatRule; source: ShowBeatSource } | null = null
  for (const rule of RULES) {
    const source = factSourceOf(rule, list)
    if (!source) continue
    const hit = rule.copy.exec(text)
    if (hit && (!best || hit.index < best.at)) best = { at: hit.index, rule, source }
  }
  if (!best) return null
  const { id, kind, phrase, label } = best.rule
  return { id, kind, phrase, label, source: best.source }
}

/** 컷 지시 Purpose 끝 문장 */
export const showBeatLine = (beat: ShowBeat): string => `Show plainly: ${beat.phrase}.`

/** 움직이는 칸 동작 — 문구 뒤에 칸 글 첫 줄을 참고로 */
export function showBeatAction(beat: ShowBeat, show: string): string {
  const first = show.split('\n')[0].trim()
  return first ? `${beat.phrase} (section text: ${first})` : beat.phrase
}

/** 손·사람이 상품을 쓰는 컷 목적 — 재질 근접·밑면·대표·수량·색·구성·포장·재료·고민 컷은 받지 않는다 */
const BEAT_PURPOSES: ReadonlySet<string> = new Set(['action', 'feature_proof', 'demo', 'scene', 'state', 'scale'])

/** 이 컷이 보여 줄 동작을 받을 수 있나 — 손·사용 구도이거나 사람(몸·손)이 나오는 사용 목적 컷 */
export function canShowBeat(shot: Pick<LineShot, 'purpose' | 'composition' | 'person'>): boolean {
  if (!BEAT_PURPOSES.has(shot.purpose)) return false
  return HANDLED.has(shot.composition) || Boolean(shot.person && shot.person.framing !== 'nobody')
}

/** 섹션 묶음 키 — 컷 키 'k<섹션 번호>_<칸>_<번호>'의 앞 토막(같은 이름 섹션이 여럿이어도 나뉜다). 꼴이 다르면 섹션 이름 */
export const beatGroupOf = (shot: Pick<LineShot, 'key' | 'section'>): string => /^k\d+(?=_)/.exec(shot.key)?.[0] ?? shot.section

/**
 * 섹션마다 보여 줄 동작을 받을 컷 하나 — 그 섹션에서 동작을 받을 수 있는 첫 컷. 섹션에 그런 컷이 없으면 고르지 않는다(매크로 컷뿐인 섹션의 컷 바꾸기는 2단계).
 * 돌려주는 값: 컷 키 → 동작
 */
export function showBeatCutsOf(shots: readonly LineShot[], facts: ShowBeatFacts): Map<string, ShowBeat> {
  const picked = new Map<string, ShowBeat>()
  const done = new Set<string>()
  for (const shot of shots) {
    const group = beatGroupOf(shot)
    if (done.has(group) || !canShowBeat(shot)) continue
    const beat = showBeatOf(shot.show, facts)
    if (!beat) continue
    picked.set(shot.key, beat)
    done.add(group)
  }
  return picked
}
