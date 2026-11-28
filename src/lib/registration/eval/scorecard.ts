/**
 * 실 테스트 점수표 (T7b, docs/plans/pdp-enrichment/04_TEST_PROGRAM.md §3) — 자동 지표 40점 + 심사 60점 − 감점.
 *
 * 순수 함수다. 편집기 문서에서 지표 입력을 재는 일은 page-measure.ts, 잡 → 점수 JSON은 scripts/pdp-eval/score.mjs가 한다.
 * 출력(buildScorecard)은 report.mjs 입력(program.json entries) 형식과 같다.
 * - 자동: 설득 R1~R8 1.5씩(12) · 상위 3개 고민 응답률(8) · 모바일 M1~M7 2씩(14) · 배치 리듬(3) · 강조 장식(3)
 * - 심사: 두 심사위원 16개 점수 평균 m → (m − 1) ÷ 4 × 60. 같은 항목이 2점 넘게 갈리면 표시한다
 * - 감점: 규제 표현 1건당 −10(자동 검사 + 심사위원 지적, 같은 주장은 1건). 자동·Claude·코덱스 가운데 둘 이상이 짚은 주장만 감점하고,
 *   하나만 짚은 주장은 판정 갈림(split)으로 남긴다(2026-10-30 — 같은 그림 재심사에서 한 명 지적으로 ±10이 흔들려서).
 *   그 갈림만 짚은 심사위원의 r8은 짚지 않은 쪽 r8로 보정한다(adjustR8 — 보정 전 심사 점수는 judgeScoreBeforeR8)
 * - 규제 표현은 claim-lexicon의 규제 묶음(인증·인허가·시험 certification, 의학·기능성 medical)이다. 사용 경험·체감 효익은 감점하지 않는다
 *   (2026-10-30 오너 지시 — 심사 지시문의 CLAIM_SCOPE와 같은 범위)
 * 총점은 모바일을 재고 두 심사위원이 모두 있을 때만 낸다(04 §3 — 심사는 둘의 평균).
 * - 채점 v2(PDP-DR-PLAN §0, 2026-10-31): 심사 r9(페이지 디자인 일관성)·r10(사진 자연스러움)을 더한다. r1~r8과 v1 총점은 그대로이고,
 *   v2 총점은 심사 10항목 평균으로 환산한 심사 점수를 쓴다(쓴 심사위원이 모두 r9·r10을 매겼을 때만 — 예전 8항목 결과는 v1만).
 *   합격선(PASS_LINE)은 v1 총점 80·심사 42/60·감점 0이고, v2는 같은 선을 v2 총점·심사에 대고 상품 일치 통과와 r9·r10 평균 3.5 이상을
 *   더한다. 상품 일치(product-match.mjs, 원본 사진 대 캡처 화면, 비블라인드)는 통과/불통과만 쓰고 점수에는 섞지 않는다
 * - r11 대상 적합(2026-10-31 통합 승인, R10부터): 대상 한 줄을 준 심사만 매긴다. 첫 회차는 audience로 기록만 하고 심사 점수·총점·
 *   합격선 어디에도 넣지 않는다(눈금을 본 뒤 넣을지 정한다)
 */

import {
  claimTermsIn,
  isClaimTermSupported,
  normalizeClaimText,
  regulatedClaimTermsIn,
  type RegulatedClaim,
  type RegulatedKind,
} from './claim-lexicon'
import type { StructureChecks } from './structure-checks'
import { PAGE_MIN_HEIGHT, PAGE_PASS_HEIGHT } from '../templatelib/template-types'

export const AUTO_POINTS = { persuasion: 12, objections: 8, mobile: 14, rhythm: 3, annotations: 3 } as const
export const PERSUASION_RULE_POINTS = 1.5
export const MOBILE_RULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const
export const MOBILE_RULE_POINTS = 2
export const JUDGE_POINTS = 60
export const CLAIM_PENALTY_POINTS = 10
/** 감점에 필요한 출처 수(자동 검사·Claude·코덱스 중) — 심사위원이 둘이라 과반은 둘 */
export const PENALTY_MIN_SOURCES = 2
/** 이 값보다 크게 갈리면 표시한다(2점 차이는 표시하지 않는다) */
export const DISAGREEMENT_GAP = 2
export const RUBRIC_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'] as const
/** 채점 v2가 더한 심사 항목(r9 페이지 디자인 일관성·r10 사진 자연스러움) — 예전 심사 결과에는 없다 */
export const RUBRIC_V2_EXTRA_KEYS = ['r9', 'r10'] as const
export const RUBRIC_V2_KEYS = [...RUBRIC_KEYS, ...RUBRIC_V2_EXTRA_KEYS] as const
/** r11 대상 적합 — 기록만(점수·총점·합격선 밖) */
export const AUDIENCE_KEY = 'r11' as const
/**
 * 기록 항목(오너 지적 11-01) — r12 글↔사진 일치, r13 첫 화면 효익 장면, r14 첫 화면 글 3초. 점수·총점에는 넣지 않고, v2 합격선에만
 * 항목별 하한으로 쓴다(결정 카드 c31·J16). 물은 심사에만 있다(judge-codex는 기본으로 묻는다, --no-records로 끔)
 */
export const RECORD_KEYS = ['r12', 'r13', 'r14'] as const
/**
 * 합격선 — v1은 총점·심사·감점, v2는 같은 선을 v2 값에 대고 상품 일치 통과와 r9·r10 평균(designMean)을 더한다.
 * records(J16, 오너 I5-3 C6 '기준선 측정 뒤 합격선 반영'): v2만, 기록이 있는 항목만 두 심사 평균이 하한 이상이어야 한다 — 기록이 없는 옛 결과는 그대로다.
 * 하한은 11-09 기준선(K2~K7·R15~R18 심사 118잡, 재심사 없이 기존 기록): r12 2~4.5(평균 약 3.2) → 2.5, r13은 1~2.5와 4~5 두 덩이 → 3.0,
 * r14는 K 라운드 모두 5·R 2~5 → 3.5. 기존 v2 합격 32잡 중 27잡이 그대로 합격이다
 */
export const PASS_LINE = { total: 80, judge: 42, penalties: 0, designMean: 3.5, records: { r12: 2.5, r13: 3.0, r14: 3.5 } } as const
/** 860 폭 세로 길이 기준 — 정본은 template-types.ts다(오너 11-02: 합격점은 780 파일 25,000. 초과 무관). 점수에는 넣지 않고 표시만 한다 */
export const PAGE_HEIGHT_PASS_PX = PAGE_PASS_HEIGHT
export const PAGE_HEIGHT_MARK_PX = PAGE_MIN_HEIGHT
/** fail 통과선 미만, pass 통과선 이상, mark 합격점 이상 */
export type PageHeightVerdict = 'fail' | 'pass' | 'mark'
export const pageHeightVerdict = (height: number): PageHeightVerdict => (height >= PAGE_HEIGHT_MARK_PX ? 'mark' : height >= PAGE_HEIGHT_PASS_PX ? 'pass' : 'fail')
export const JUDGE_NAMES = ['claude', 'codex'] as const
/** 심사 지적 종류 → 규제 묶음(efficacy = 질병·의학·기능성 효능, 나머지는 인증·인허가·절대 안전·환경 표시). other는 notes로만 */
export const JUDGE_KIND_TO_REGULATED: Readonly<Record<string, RegulatedKind>> = {
  efficacy: 'medical',
  safety: 'certification',
  certification: 'certification',
  eco: 'certification',
}

export type MobileRuleId = (typeof MOBILE_RULE_IDS)[number]
export type RubricKey = (typeof RUBRIC_KEYS)[number]
export type RubricV2ExtraKey = (typeof RUBRIC_V2_EXTRA_KEYS)[number]
export type RubricV2Key = (typeof RUBRIC_V2_KEYS)[number]
export type JudgeName = (typeof JUDGE_NAMES)[number]

export interface RuleResult {
  id: string
  pass: boolean
  detail?: string
}

export interface ObjectionStatus {
  objection: string
  answeredBy: string | null
  note?: string
  /** answered = 응답 섹션이 렌더됨, noted = 응답 섹션 없이 미응답 사유가 기록됨, silent = 둘 다 없음 */
  status: 'answered' | 'noted' | 'silent'
}

/** 편집기 문서 한 장에서 잰 자동 지표 입력(page-measure.ts가 만든다) */
export interface PageMeasurement {
  /** 설득 규칙 판정 순서 — 긴 상세페이지 확장 섹션은 빠진다(아래 expansions) */
  order: string[]
  /** 860 폭 세로 길이(px) — 그려진 섹션 전부, 구분선 포함. 예전 측정 파일에는 없다 */
  pageHeight?: number
  /** 긴 상세페이지 확장 섹션(크기·구성·관리·보관·구매 전 질문) — 그려진 것만, 페이지 순서. 없으면 칸이 없다 */
  expansions?: string[]
  persuasion: { source: 'record' | 'derived'; grammar: string; lengthTarget: [number, number]; rules: RuleResult[] }
  /** 상위 3개 고민 */
  objections: ObjectionStatus[]
  /**
   * 섹션 → 렌더된 레이아웃 카테고리(프리셋 미적용 = minimal), 실제 적용 수, 인접 중복.
   * assigned·guardDropped는 S2 보고용(점수 아님): 배정(layout_selections, minimal·PRESET_EXEMPT 제외)과 그중 렌더에 반영되지 않은 섹션
   */
  layouts: { categories: Record<string, string>; applied: number; repeats: string[]; assigned: number; guardDropped: string[] }
  /** targetCuts = 잡의 대상 컷(features·size_comparison·howto) URL 수, targets = 그중 렌더된 것, decorated = 장식이 얹힌 것 */
  annotations: { targetCuts: number; targets: number; decorated: number }
  /** checkMobileReadability 결과(규칙별 위반 수). 검사기를 못 쓰면 null(미측정) */
  mobile: { counts: Partial<Record<MobileRuleId, number>>; phoneScreens?: number } | null
  claims: RegulatedClaim[]
  /** 주장 면제 근거(spec.certificationInfo) — 표현 단위로 대조한다 */
  claimEvidence: string
  /**
   * 이미지 사용률(W5) — 잡이 만든 컷(section_images 성공 URL) 가운데 렌더 문서에 실제로 나온 컷. 안 쓰는 컷 빼기(lean) 측정 지표.
   * 점수에는 쓰지 않는다(보고용). cutPlan은 지금 코드의 이미지 태스크 집계 — 피처 컷의 설계·카피 출처 수와 렌더가 그리지 않아 안 만드는
   * 컷(render-aware-cuts)
   */
  images?: { generated: number; used: number; rate: number; cutPlan?: { design: number; copy: number; skipped: string[] } }
  /** 구조 자동 검사(structure-checks.ts) — POINT 머리 일치, 상품 정보 표 행. 기록만, 점수에는 쓰지 않는다 */
  structure?: StructureChecks
}

export interface JudgeItem {
  score: number
  reason: string
}

export interface JudgeResult {
  label: string
  /** r1~r8은 늘 있고 r9·r10은 채점 v2 심사만, r11은 대상 줄을 준 심사만, r12·r13은 기록 항목을 물은 심사만 있다 */
  items: Record<RubricKey, JudgeItem> & Partial<Record<RubricV2ExtraKey | typeof AUDIENCE_KEY | (typeof RECORD_KEYS)[number], JudgeItem>>
  violations: Array<{ text: string; kind: string; screen: number }>
  summary: string
}
export type Judges = Partial<Record<JudgeName, JudgeResult>>

/** 상품 일치 검사 결과(scripts/pdp-eval/product-match.mjs) — 원본 사진 대 캡처 화면의 색·모양·구성 수 차이 */
export interface ProductMatch {
  pass: boolean
  /** from: 브랜드 로고·글자 빠짐이라 other로 낮춘 차이의 원래 종류(product-match.mjs validateProductMatch) */
  differences: Array<{ screen: number; aspect: 'color' | 'shape' | 'count' | 'other'; text: string; from?: 'color' | 'shape' }>
  summary: string
}

export interface AutoScore {
  total: number
  items: { persuasion: number; objections: number; mobile: number | null; rhythm: number; annotations: number }
  /** 모바일까지 모두 잰 경우만 true */
  complete: boolean
}

export interface Penalty {
  text: string
  kind: string
  sources: string[]
  /** report.mjs 표시용(sources를 + 로 이은 것) */
  source: string
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function scoreAuto(m: PageMeasurement): AutoScore {
  const persuasion = m.persuasion.rules.filter((r) => r.pass).length * PERSUASION_RULE_POINTS
  const covered = m.objections.filter((o) => o.status !== 'silent').length
  const objections = m.objections.length ? (AUTO_POINTS.objections * covered) / m.objections.length : AUTO_POINTS.objections
  const mobile = m.mobile
    ? MOBILE_RULE_IDS.filter((id) => (m.mobile!.counts[id] ?? 0) === 0).length * MOBILE_RULE_POINTS
    : null
  const rhythm = m.layouts.repeats.length === 0 ? AUTO_POINTS.rhythm : 0
  const { targetCuts, targets, decorated } = m.annotations
  // 잡에 대상 컷이 아예 없으면 장식할 곳이 없으므로 깎지 않는다. 대상 컷이 있는데 렌더에서 하나도 못 찾으면 0(매칭 실패를 만점으로 숨기지 않는다)
  const annotations = targets
    ? (AUTO_POINTS.annotations * Math.min(decorated, targets)) / targets
    : targetCuts === 0
      ? AUTO_POINTS.annotations
      : 0
  const items = {
    persuasion: round2(persuasion),
    objections: round2(objections),
    mobile,
    rhythm,
    annotations: round2(annotations),
  }
  const total = round2(items.persuasion + items.objections + (mobile ?? 0) + rhythm + items.annotations)
  return { total, items, complete: mobile !== null }
}

/** 두 심사위원(있는 것만) 점수 결합과 2점 넘는 차이 항목. keys는 v1(r1~r8, 기본) 또는 v2(r1~r10 — 쓴 심사위원이 모두 매긴 경우만 넘긴다) */
export function combineJudges(
  judges: Judges,
  keys: readonly RubricV2Key[] = RUBRIC_KEYS
): { judgeScore: number | null; mean: number | null; used: JudgeName[]; disagreements: RubricV2Key[] } {
  const used = JUDGE_NAMES.filter((name) => judges[name])
  const scores = used.flatMap((name) => keys.map((key) => judges[name]!.items[key]!.score))
  if (scores.length === 0) return { judgeScore: null, mean: null, used, disagreements: [] }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const { claude, codex } = judges
  const disagreements =
    claude && codex ? keys.filter((key) => Math.abs(claude.items[key]!.score - codex.items[key]!.score) > DISAGREEMENT_GAP) : []
  return { judgeScore: round2(((mean - 1) / 4) * JUDGE_POINTS), mean: round2(mean), used, disagreements }
}

/**
 * 규제 표현 하나가 스펙 근거(인증 정보)로 뒷받침되는가 — 표현을 옛 4종으로 읽어 같은 대조를 쓴다
 * (인증 주체·특허·성적서, 친환경 인증, 나머지는 같은 표현). 옛 사전에 없는 표현은 묶음 종류로 대조한다.
 */
function isRegulatedTermSupported(kind: RegulatedKind, term: string, evidence: string): boolean {
  const legacy = claimTermsIn(term)[0]?.kind ?? (kind === 'medical' ? 'efficacy' : 'certification')
  return isClaimTermSupported(legacy, term, evidence)
}

/**
 * 감점 합치기 — 자동 검사(규제 묶음)에 심사위원 지적을 붙이고, 어디에도 안 붙는 지적은 새 건으로 센다.
 * 지적 종류는 JUDGE_KIND_TO_REGULATED로 규제 묶음 종류로 옮긴다.
 * 지적 문구에서 규제 표현을 찾으면 그 표현의 묶음에 붙인다(지적 종류와 같은 표현 우선 — 다른 종류 묶음이 지적을 삼키지 않게).
 * 근거로 면제되는 표현은 남는 표현이 있으면 붙이지 않는다 — 면제된 'KC 인증' 묶음이 같은 지적의 '친환경'을 끌어안아 면제가 깨지지 않게.
 * 규제 표현이 없으면 같은 종류 묶음과 문구 포함 관계로 맞춘다(심사위원끼리 같은 문구면 1건).
 * 스펙 근거(인증 정보)로 표현이 모두 뒷받침되는 묶음은 감점하지 않고 waived로 남긴다. other 지적은 notes로만 남긴다.
 * 남은 묶음 가운데 출처(자동·Claude·코덱스)가 PENALTY_MIN_SOURCES 이상인 것만 penalties, 나머지는 split(판정 갈림)이다.
 */
export function mergePenalties(
  claims: readonly RegulatedClaim[],
  judges: Judges,
  claimEvidence: string
): { penalties: Penalty[]; split: Penalty[]; waived: Penalty[]; notes: Array<{ text: string; source: JudgeName }> } {
  type Group = { text: string; kind: RegulatedKind; terms: string[]; keys: string[]; sources: Set<string> }
  const termSupported = (kind: RegulatedKind, term: string) => isRegulatedTermSupported(kind, term, claimEvidence)
  const groups: Group[] = claims.map((c) => ({
    text: c.terms.join(' · '),
    kind: c.kind,
    terms: [...c.terms],
    keys: c.terms.map(normalizeClaimText),
    sources: new Set(['auto']),
  }))
  /** 지적 하나에서 찾은 같은 종류 표현들 → 묶음 하나(표현을 공유하는 기존 묶음은 모두 합친다 — findRegulatedClaims의 '한 문구 = 1건'과 같다) */
  const groupFor = (kind: RegulatedKind, terms: string[]) => {
    const keys = terms.map(normalizeClaimText)
    const hits = groups.filter((g) => g.kind === kind && g.terms.some((t) => keys.includes(normalizeClaimText(t))))
    const target = hits[0] ?? { text: terms.join(' · '), kind, terms: [], keys: [], sources: new Set<string>() }
    if (!hits.length) groups.push(target)
    for (const other of hits.slice(1)) {
      target.terms.push(...other.terms.filter((t) => !target.terms.includes(t)))
      target.keys.push(...other.keys.filter((k) => !target.keys.includes(k)))
      other.sources.forEach((src) => target.sources.add(src))
      target.text = target.terms.join(' · ')
      groups.splice(groups.indexOf(other), 1)
    }
    for (const term of terms) {
      if (target.terms.some((t) => normalizeClaimText(t) === normalizeClaimText(term))) continue
      target.terms.push(term)
      target.keys.push(normalizeClaimText(term))
    }
    return target
  }
  const notes: Array<{ text: string; source: JudgeName }> = []
  for (const name of JUDGE_NAMES) {
    for (const v of judges[name]?.violations ?? []) {
      const kind = Object.hasOwn(JUDGE_KIND_TO_REGULATED, v.kind) ? JUDGE_KIND_TO_REGULATED[v.kind] : undefined
      if (!kind) {
        notes.push({ text: v.text, source: name })
        continue
      }
      const found = regulatedClaimTermsIn(v.text, { negation: true })
      const sameKind = found.filter((f) => f.kind === kind)
      const candidates = sameKind.length ? sameKind : found
      const open = candidates.filter((f) => !termSupported(f.kind, f.term))
      const attach = open.length ? open : candidates
      if (attach.length) {
        for (const termKind of new Set(attach.map((f) => f.kind))) {
          groupFor(termKind, attach.filter((f) => f.kind === termKind).map((f) => f.term)).sources.add(name)
        }
        continue
      }
      const key = normalizeClaimText(v.text)
      const match = key
        ? groups.find((g) => g.kind === kind && g.keys.some((k) => k && (key.includes(k) || k.includes(key))))
        : undefined
      if (match) {
        match.sources.add(name)
        if (!match.keys.includes(key)) match.keys.push(key)
      } else {
        groups.push({ text: v.text, kind, terms: [], keys: [key], sources: new Set([name]) })
      }
    }
  }
  const toPenalty = (g: Group): Penalty => {
    const sources = [...g.sources]
    return { text: g.text, kind: g.kind, sources, source: sources.join('+') }
  }
  // 표현이 하나라도 있고 모두 근거가 있을 때만 면제(규제 표현 없는 지적은 면제하지 않는다)
  const supported = (g: Group) => g.terms.length > 0 && g.terms.every((t) => termSupported(g.kind, t))
  const open = groups.filter((g) => !supported(g))
  return {
    penalties: open.filter((g) => g.sources.size >= PENALTY_MIN_SOURCES).map(toPenalty),
    split: open.filter((g) => g.sources.size < PENALTY_MIN_SOURCES).map(toPenalty),
    waived: groups.filter(supported).map(toPenalty),
    notes,
  }
}

/**
 * r8 과반 보정(2026-10-30 통합 결정, 감점 과반과 맞춤) — 규제 표현을 한 심사위원만 짚어 감점 없이 판정 갈림으로 남았으면, 그 심사위원의
 * r8을 짚지 않은 쪽 r8로 바꾼다(짚지 않은 쪽이 같거나 낮으면 5). 짚은 지적 하나라도 감점이 됐거나(자동 검사와 겹침) 다른 심사위원도
 * 지적했으면 그대로 둔다. 같은 그림 재심사에서 한 명의 r8 = 1이 심사 점수를 3.75씩 흔들었다(R6b P07)
 */
export function adjustR8(
  judges: Judges,
  penalties: readonly Penalty[],
  split: readonly Penalty[]
): { judges: Judges; adjusted: Array<{ judge: JudgeName; from: number; to: number }> } {
  const flagged = (name: JudgeName, list: readonly Penalty[]) => list.some((p) => p.sources.includes(name))
  const out: Judges = { ...judges }
  const adjusted: Array<{ judge: JudgeName; from: number; to: number }> = []
  for (const name of JUDGE_NAMES) {
    const judge = judges[name]
    const other = JUDGE_NAMES.find((n) => n !== name)!
    if (!judge || !flagged(name, split) || flagged(name, penalties)) continue
    if (flagged(other, penalties) || flagged(other, split)) continue
    const from = judge.items.r8.score
    const otherR8 = judges[other]?.items.r8.score
    const to = otherR8 !== undefined && otherR8 > from ? otherR8 : 5
    if (to === from) continue
    out[name] = { ...judge, items: { ...judge.items, r8: { ...judge.items.r8, score: to } } }
    adjusted.push({ judge: name, from, to })
  }
  return { judges: out, adjusted }
}

export interface ScorecardMeta {
  product: string
  round: string
  jobId: string
  label: string
  costUsd?: number | null
  durationMin?: number | null
  captureDir?: string | null
}

/** 심사 결과가 채점 v2 항목(r9·r10)을 모두 매겼는가 */
export function hasV2Items(judge: JudgeResult): boolean {
  return RUBRIC_V2_EXTRA_KEYS.every((key) => Number.isFinite(judge.items[key]?.score))
}

/**
 * 채점 v2 — 쓴 심사위원이 모두 r9·r10을 매겼을 때만 심사 10항목 점수와 r9·r10 평균(designMean)을 낸다. 아니면 null(v1만)
 */
export function combineJudgesV2(judges: Judges): (ReturnType<typeof combineJudges> & { designMean: number }) | null {
  const used = JUDGE_NAMES.filter((name) => judges[name])
  if (used.length === 0 || !used.every((name) => hasV2Items(judges[name]!))) return null
  const design = used.flatMap((name) => RUBRIC_V2_EXTRA_KEYS.map((key) => judges[name]!.items[key]!.score))
  return { ...combineJudges(judges, RUBRIC_V2_KEYS), designMean: round2(design.reduce((a, b) => a + b, 0) / design.length) }
}

/**
 * r11 대상 적합 기록 — 매긴 심사위원의 점수와 평균(매긴 심사위원이 없으면 null). 심사 점수·총점·합격선에는 넣지 않는다
 */
export function audienceFit(judges: Judges): { mean: number; scores: Partial<Record<JudgeName, number>> } | null {
  return recordedItem(judges, AUDIENCE_KEY)
}

function recordedItem(judges: Judges, key: typeof AUDIENCE_KEY | (typeof RECORD_KEYS)[number]): { mean: number; scores: Partial<Record<JudgeName, number>> } | null {
  const scores: Partial<Record<JudgeName, number>> = {}
  for (const name of JUDGE_NAMES) {
    const score = judges[name]?.items[key]?.score
    if (Number.isFinite(score)) scores[name] = score
  }
  const values = Object.values(scores) as number[]
  return values.length ? { mean: round2(values.reduce((a, b) => a + b, 0) / values.length), scores } : null
}

/** 기록 항목(r12·r13·r14) — 물은 항목만 싣는다. 점수·총점에는 넣지 않고 v2 합격선(PASS_LINE.records)에만 쓴다 */
export function recordItems(judges: Judges): Partial<Record<(typeof RECORD_KEYS)[number], { mean: number; scores: Partial<Record<JudgeName, number>> }>> {
  return Object.fromEntries(RECORD_KEYS.flatMap((key) => {
    const value = recordedItem(judges, key)
    return value ? [[key, value]] : []
  }))
}

/** 기록 항목 하한(PASS_LINE.records) 아래인 항목 — 기록이 없는 항목은 세지 않는다 */
export function recordsBelowLine(records: Partial<Record<(typeof RECORD_KEYS)[number], { mean: number }>> | null | undefined): Array<(typeof RECORD_KEYS)[number]> {
  return RECORD_KEYS.filter((key) => {
    const mean = records?.[key]?.mean
    return Number.isFinite(mean) && (mean as number) < PASS_LINE.records[key]
  })
}

/** 합격선 판정 — 총점이 없으면(심사·모바일 빠짐) null. v2는 상품 일치 검사가 없어도 null. v2는 기록 항목 하한도 본다(기록이 있는 항목만) */
export function judgePass(input: {
  total: number | null
  judgeScore: number | null
  penalties: number
  v2?: { total: number | null; judgeScore: number | null; designMean: number } | null
  productMatch?: ProductMatch | null
  records?: Partial<Record<(typeof RECORD_KEYS)[number], { mean: number }>> | null
}): { v1: boolean | null; v2: boolean | null } {
  const line = (total: number | null, judgeScore: number | null) =>
    total === null || judgeScore === null
      ? null
      : total >= PASS_LINE.total && judgeScore >= PASS_LINE.judge && input.penalties <= PASS_LINE.penalties
  const v1 = line(input.total, input.judgeScore)
  const base = input.v2 ? line(input.v2.total, input.v2.judgeScore) : null
  const v2 =
    base === null || !input.v2 || !input.productMatch
      ? null
      : base && input.productMatch.pass && input.v2.designMean >= PASS_LINE.designMean && recordsBelowLine(input.records).length === 0
  return { v1, v2 }
}

/** 점수 JSON 한 건(report.mjs entries 형식 + 상세). productMatch는 상품 일치 검사 결과(없으면 v2 합격 판정이 null) */
export function buildScorecard(
  meta: ScorecardMeta,
  m: PageMeasurement,
  judges: Judges = {},
  extra: { productMatch?: ProductMatch | null } = {}
) {
  const auto = scoreAuto(m)
  const { penalties, split, waived, notes } = mergePenalties(m.claims, judges, m.claimEvidence)
  const r8 = adjustR8(judges, penalties, split)
  const { judgeScore, mean, used, disagreements } = combineJudges(r8.judges)
  const missing = [
    ...(auto.complete ? [] : ['mobile']),
    ...JUDGE_NAMES.filter((name) => !judges[name]).map((name) => `judge:${name}`),
  ]
  // 모바일을 못 쟀거나 심사위원이 둘 다 있지 않으면 총점을 내지 않는다(부분 합이 보고서 평균에 섞이지 않게)
  const total =
    judgeScore !== null && missing.length === 0
      ? round2(auto.total + judgeScore - penalties.length * CLAIM_PENALTY_POINTS)
      : null
  const v2Judges = combineJudgesV2(r8.judges)
  const v2 = v2Judges
    ? {
        total:
          v2Judges.judgeScore !== null && missing.length === 0
            ? round2(auto.total + v2Judges.judgeScore - penalties.length * CLAIM_PENALTY_POINTS)
            : null,
        judgeScore: v2Judges.judgeScore,
        judgeMean: v2Judges.mean,
        designMean: v2Judges.designMean,
        disagreements: v2Judges.disagreements,
      }
    : null
  const productMatch = extra.productMatch ?? null
  const records = recordItems(judges)
  return {
    ...meta,
    costUsd: meta.costUsd ?? null,
    durationMin: meta.durationMin ?? null,
    captureDir: meta.captureDir ?? null,
    ...(m.pageHeight !== undefined ? { pageHeight: m.pageHeight, pageHeightVerdict: pageHeightVerdict(m.pageHeight), pageHeightShort: m.pageHeight < PAGE_HEIGHT_PASS_PX } : {}),
    total,
    complete: missing.length === 0,
    missing,
    auto: { total: auto.total, items: auto.items },
    /** 심사위원 원본 응답(r8 보정 전) */
    judges: Object.fromEntries(used.map((name) => [name, judges[name]])),
    judgeScore,
    judgeMean: mean,
    /** r8 과반 보정 전 심사 점수 — 보정이 없으면 judgeScore와 같다(결과 문서에 두 값을 함께 적는다) */
    judgeScoreBeforeR8: combineJudges(judges).judgeScore,
    r8Adjustments: r8.adjusted,
    penalties,
    penaltyPoints: -penalties.length * CLAIM_PENALTY_POINTS,
    /** 출처 하나만 짚은 주장(감점 없음) — 비교표에 갈림 건수로 적는다 */
    splitClaims: split,
    disagreements,
    /** 채점 v2(r9·r10) — 쓴 심사위원이 모두 매겼을 때만. total은 v1처럼 모바일·두 심사위원이 다 있을 때만 */
    v2,
    /** r11 대상 적합(대상 줄을 준 심사만) — 기록만, 점수·총점·합격선 밖 */
    audience: audienceFit(judges),
    /** 기록 항목 r12·r13·r14(물은 심사만) — 점수·총점 밖, v2 합격선에만(하한 아래 항목은 recordsBelow) */
    records,
    recordsBelow: recordsBelowLine(records),
    /** 구조 자동 검사 — 기록만 */
    ...(m.structure ? { structure: m.structure } : {}),
    /** 상품 일치 검사(비블라인드, 통과/불통과만 — 점수에 섞지 않는다) */
    productMatch,
    /** 합격선(PASS_LINE) — 잴 수 없으면 null */
    pass: judgePass({ total, judgeScore, penalties: penalties.length, v2, productMatch, records }),
    detail: {
      order: m.order,
      persuasion: m.persuasion,
      objections: m.objections,
      layouts: m.layouts,
      annotations: {
        ...m.annotations,
        ...(m.annotations.targets
          ? {}
          : { note: m.annotations.targetCuts ? '대상 컷이 렌더에서 보이지 않음 — 0점' : '대상 컷 없음 — 깎지 않음' }),
      },
      mobile: m.mobile,
      ...(m.images ? { images: m.images } : {}),
      waivedClaims: waived,
      judgeNotes: notes,
    },
  }
}

export type Scorecard = ReturnType<typeof buildScorecard>
