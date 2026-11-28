/**
 * fillacts 페이지 재구성(통합 결정 2026-11-01 — R15-L 5상품 공통 불통과 사유가 '상품 정보 표 뒤 실사용 사진 재등장'이고 섹션 12~16으로 R6 미달).
 * 계획(designcut-plan.ts)이 D2 fillacts 잡에서만 부른다. 순수·결정론 — 새 문구를 만들지 않고 카피가 이미 쓴 글만 싣는다.
 * - 자리(오너 지시 2026-11-01 17:02 '사이즈와 상품 정보 섹션은 항상 맨 마지막 또는 맨 마지막 바로 앞'): 페이지 끝 두 자리가 사이즈 → 상품 정보다.
 *   사이즈가 없으면 상품 정보가 맨 끝이다. 사진 막·후기·구매 전 질문·마무리는 모두 그 앞이다(계획 기록 factsLast)
 * - 빈 섹션: 같은 사진을 되풀이하지 않고 본문 섹션으로 채운다. 먼저 플래너가 뺀 정보 섹션 가운데 근거 게이트를 넘는 것(사용 방법·추천 대상·옵션),
 *   그래도 목표에 못 미치면 카피의 메시지 + 그 글을 주제로 만든 자기 컷(extra_shots의 message 기록, shot-diversity planFillActs)
 * - K(템플릿 라인)는 자기 구성 규칙이 있어 여기를 지나지 않는다
 */

import { hasEnrichmentFeature } from '../enrichment-switch'
import { isFactClaimSafe } from '../eval/claim-lexicon'
import type { DesigncutHeadVariant, DesigncutPlan, DesigncutSection, PdpJobRow } from '../pdp-state'
import { pointVariant, skeletonOf } from './designcut-structure'
import { evidenceOf, type Evidence } from './persuasion-signals'

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>

/**
 * D2 페이지 채움 목표(오너 지시 2026-11-01 — 섹션 20개 내외, 플래너 D2_LENGTH [18,22]의 가운데). 저장된 5잡으로 잰 값: 18개면 28,469~30,374px, 컷 하나당 1,232px이라
 * 20개면 모두 30,000px을 넘는다
 */
export const D2_SECTION_TARGET = 20

/** 메시지 섹션 역할 — 렌더 v2 막 배정은 역할표에 없어 '확인' 막이 된다(layout2 actOf) */
export const FILL_MESSAGE_ROLE = 'fill_message'

/**
 * 첫 근거 자리 상한(적용 D3 P2 T1-35 자리 띠) — 페이지 위치(순번 ÷ (칸 수 − 1), 기존 빌더 섹션 포함)가 이보다 뒤면 근거를 막1 앞으로 당긴다.
 * 잣대는 plan-metrics firstProofAt과 같다. R17-L 저장 11잡 9곳이 0.474였다(P0 #652)
 */
export const FIRST_PROOF_AT_MAX = 0.45
/** 근거 역할(후기·인증) — plan-metrics PROOF_ROLES와 같다 */
const PROOF_ROLES: ReadonlySet<string> = new Set(['social_proof', 'certification_evidence'])

/** 플래너가 뺐어도 근거가 있으면 싣는 정보 섹션 — 그릴 내용(단계 2개·추천 3개·옵션 2개)은 계획의 역할 분기가 다시 본다. 측정의 근거 판정(page-measure isSupported)과 같은 기준 */
const INFO_SECTIONS: ReadonlyArray<{ key: string; role: string; supported: (ev: Evidence, job: PdpJobRow) => boolean }> = [
  { key: 'hidden_page', role: 'how_to_guide', supported: (ev) => ev.usageBasis },
  { key: 'point_list_div', role: 'target_recommendation', supported: () => true },
  { key: 'petit_div', role: 'option_catalog', supported: (ev, job) => ev.optionSpec || (job.spec_sheet.colorOptions?.length ?? 0) >= 2 },
]

/**
 * 메시지 섹션 — 카피 칸. D2 페이지에 나오지 않는 글이다. 사진으로 보여 주기 쉬운 것이 앞, 권유에 가까운 directionHint가 마지막. 키 앞부분이 섹션 유형이 된다 —
 * mainCutCopy는 main_cut 유형으로 두지 않는다(규칙 R1·주석이 그 유형을 첫 화면으로 읽는다)
 */
const MESSAGE_SECTIONS = [
  { key: 'key_message:body', copy: 'keyMessageCopy' },
  { key: 'key_message:main', copy: 'mainCutCopy' },
  { key: 'concept_desc:body', copy: 'conceptCopy' },
  { key: 'product_exposure:body', copy: 'productExposure' },
  { key: 'direction_suggest:body', copy: 'directionHint' },
] as const

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

/** 재구성 대상 — D2 잡이 확인한 뒤 부른다 */
export function fillBodyEnabled(job: PdpJobRow): boolean {
  return hasEnrichmentFeature(job.analysis, 'fillacts') && !hasEnrichmentFeature(job.analysis, 'templatelib')
}

/** 플래너가 뺀 정보 섹션을 마무리 앞에 더한 순서(자리는 arrangeFillPage가 정한다). roleOf에 역할을 더한다(제자리 변경) */
export function withInfoSections(job: PdpJobRow, order: readonly string[], roleOf: Map<string, string>): string[] {
  const roles = new Set(order.map((key) => roleOf.get(key)))
  const ev = evidenceOf(job.spec_sheet, job.analysis)
  const added = INFO_SECTIONS.filter((s) => !roles.has(s.role) && !order.includes(s.key) && s.supported(ev, job))
  for (const s of added) roleOf.set(s.key, s.role)
  const at = order.indexOf('cta')
  const keys = added.map((s) => s.key)
  return at === -1 ? [...order, ...keys] : [...order.slice(0, at), ...keys, ...order.slice(at)]
}

/** extra_shots에 기록된 메시지 컷 — 메시지 섹션 키 → 컷 키. 형식이 틀리면 빈 모음 */
export function readMessageCuts(raw: unknown): Map<string, string> {
  const shots = (raw as { shots?: unknown } | null | undefined)?.shots
  const out = new Map<string, string>()
  if (!Array.isArray(shots)) return out
  for (const s of shots as Array<Record<string, unknown> | null>) {
    if (typeof s?.message === 'string' && typeof s.key === 'string') out.set(s.message, s.key)
  }
  return out
}

/**
 * 메시지 머리 순환(적용 D6 P3 T2-40·T2-53) — 첫 메시지는 지금 머리(형태 half의 tint 면 위에 강조색 띠가 겹치지 않게), 둘째 강조색 띠(band),
 * 셋째 짧은 선 + 가운데 제목(rule). 큰 POINT 머리는 바꾸지 않는다(오너 11-01 'POINT 1·2·3 카피 자리 같음')
 */
const MESSAGE_HEADS: ReadonlyArray<DesigncutHeadVariant | null> = [null, 'band', 'rule']
export const messageHeadVariant = (order: number): DesigncutHeadVariant | null => MESSAGE_HEADS[(order - 1) % MESSAGE_HEADS.length]

/**
 * 메시지 섹션 최대 count개 — 장 번호 없는 사진 섹션(T3a). 페이지 제목과 같거나 한쪽이 다른 쪽을 담는 메시지와 규제 표현이 든 메시지는 뺀다.
 * 형태는 이어져도 셋째가 밀려나지 않게 돌아가며 준다(spreadRuns가 표 뒤로 옮기지 않게). 컷 기록이 아직 없으면(컷 계획을 세우는 중·옛 잡) 대표 컷 자리로 둔다
 */
export function messagePieces(job: PdpJobRow, pieces: readonly Piece[], count: number, cuts: ReadonlyMap<string, string>): Piece[] {
  if (count <= 0) return []
  // 형태 순환은 큰 POINT(장 번호 있음) 뒤에서 잇는다 — 메시지가 1번부터 다시 돌면 큰 POINT 셋과 같은 scene·zigzag·grid가 되풀이된다(D6 P2)
  const bigPoints = pieces.filter((p) => typeof p.chapter === 'number').length
  const copy = (job.copy_sections.final ?? {}) as unknown as Record<string, { headline?: unknown; subCopy?: unknown } | undefined>
  const seen = pieces.flatMap((p) => (p.text.headline ? [norm(p.text.headline)] : []))
  const repeats = (headline: string) => {
    const n = norm(headline)
    return seen.some((s) => s.includes(n) || n.includes(s))
  }
  const out: Piece[] = []
  for (const m of MESSAGE_SECTIONS) {
    if (out.length >= count) break
    const headline = str(copy[m.copy]?.headline)
    const sub = str(copy[m.copy]?.subCopy)
    if (!headline || repeats(headline) || !isFactClaimSafe(`${headline} ${sub ?? ''}`, job.spec_sheet.certificationInfo)) continue
    seen.push(norm(headline))
    out.push({
      key: m.key,
      role: FILL_MESSAGE_ROLE,
      template: 'T3a',
      chapter: null,
      productImageKey: cuts.get(m.key) ?? 'hero',
      productAlpha: false,
      text: { eyebrow: null, headline, sub },
      modules: [],
      layoutVariant: pointVariant(bigPoints + out.length + 1, sub),
      ...((head) => (head ? { headVariant: head } : {}))(messageHeadVariant(out.length + 1)),
    })
  }
  return out
}

/**
 * 특징 뒤 순서를 다시 짠다(제자리 변경) — 막1 → 본문 첫째(대개 후기) → 막2 → 나머지 본문 → 옵션 → 구매 전 질문·마무리(그 뒤 kept 포함) → 사이즈 행렬(D2, 있을 때) → 사이즈 → 상품 정보.
 * 메시지는 사진·정보 사이에 하나씩 끼우고 남으면 옵션 앞에 놓는다. 그 뒤 같은 뼈대가 붙은 자리에 메시지를 옮겨 뗀다(separateSkeletons).
 * 마지막으로 첫 근거가 너무 뒤면 막1 앞으로 당긴다(proofBeforeFirstAct)
 */
export function arrangeFillPage(pieces: Piece[], pageOrder: string[]): void {
  const byKey = new Map(pieces.map((p) => [p.key, p]))
  const template = (key: string) => byKey.get(key)?.template
  const isAct = (key: string) => template(key) === 'T10'
  const isMessage = (key: string) => byKey.get(key)?.role === FILL_MESSAGE_ROLE
  const isOption = (key: string) => template(key) === 'T7'
  const isTable = (key: string) => template(key) === 'T6' || key === 'long:info'
  // 사이즈 행렬(long:matrix)은 사이즈 바로 앞에 따라간다 — 끝 두 자리 판정(factsTailOf)에는 들지 않는다
  const isMatrix = (key: string) => key === 'long:matrix'
  const isFeature = (key: string) => template(key) === 'T11' || (template(key) === 'T3a' && byKey.get(key)?.chapter !== null)
  const moved = (key: string) => isAct(key) || isMessage(key) || isOption(key) || isTable(key) || isMatrix(key)

  const from = pageOrder.reduce((last, key, i) => (isFeature(key) ? i + 1 : last), 0)
  const head = pageOrder.slice(0, from).filter((key) => !moved(key))
  const rest = pageOrder.slice(from).filter((key) => !moved(key))
  const closeAt = rest.findIndex((key) => key === 'long:faq' || template(key) === 'T8')
  const body = closeAt === -1 ? rest : rest.slice(0, closeAt)
  const close = closeAt === -1 ? [] : rest.slice(closeAt)
  const acts = pageOrder.filter(isAct)
  const story = [...acts.slice(0, 1), ...body.slice(0, 1), ...acts.slice(1), ...body.slice(1)]
  const messages = pageOrder.filter(isMessage)
  const woven = story.flatMap((key, i) => (messages[i] ? [key, messages[i]] : [key]))
  const sizes = pageOrder.filter((key) => template(key) === 'T6')
  const infos = pageOrder.filter((key) => isTable(key) && template(key) !== 'T6')
  const facts = [...pageOrder.filter(isMatrix), ...sizes, ...infos]
  const spare = messages.slice(story.length)
  const next = [...head, ...woven, ...spare, ...pageOrder.filter(isOption), ...close, ...facts]
  separateSkeletons(next, byKey, new Set(spare), next.length - facts.length)
  proofBeforeFirstAct(next, byKey, acts[0])
  pageOrder.splice(0, pageOrder.length, ...next)
  const index = new Map(pageOrder.map((key, i) => [key, i]))
  pieces.sort((a, b) => (index.get(a.key) ?? 0) - (index.get(b.key) ?? 0))
}

/**
 * 같은 뼈대 이웃 떼기(적용 D3 P1 R-I4, 제자리 변경) — 큰 POINT 밖 같은 템플릿·변형이 붙어 있으면 메시지 하나를 그 사이로 옮긴다. 끝 사실 묶음(사이즈표·사이즈·
 * 상품 정보, factsFrom부터) 안의 이웃은 그대로 두고(끝 두 자리 규칙), 그 앞 섹션과 끝 묶음 첫 섹션 사이에는 넣는다. 옮길 메시지는 옵션 앞에 남은 메시지(spare)가
 * 먼저이고, 다음은 가까운 순서다. 빼면 그 자리에 같은 뼈대 이웃이 새로 생기는 메시지는 옮기지 않는다. 메시지가 모자라면 그 이웃은 그대로다 —
 * 사실 표(T9)는 D에 다른 표 뼈대가 없어 표를 빼지 않는다(통합 11-03 12:52)
 */
/** 두 키가 같은 뼈대인가 — 큰 POINT·기존 빌더 섹션·없는 칸은 늘 아니다 */
function sameSkeletonOf(byKey: ReadonlyMap<string, Piece>) {
  const sig = (key: string | undefined) => {
    const piece = key === undefined ? undefined : byKey.get(key)
    return piece ? skeletonOf(piece) : null
  }
  return { sig, same: (a: string | undefined, b: string | undefined) => sig(a) !== null && sig(a) === sig(b) }
}

/**
 * 첫 근거 당기기(적용 D3 P2 T1-35, 제자리 변경) — 근거 역할 첫 섹션의 페이지 위치가 FIRST_PROOF_AT_MAX보다 뒤이고 막1(firstAct)이 그 앞에 있으면
 * 근거를 막1 바로 앞으로 옮긴다. 빼거나 넣는 자리에 같은 뼈대가 새로 붙으면 옮기지 않는다(이웃 떼기를 깨지 않게). 막1이 없으면 그대로다
 */
export function proofBeforeFirstAct(order: string[], byKey: ReadonlyMap<string, Piece>, firstAct: string | undefined): void {
  const { same } = sameSkeletonOf(byKey)
  const at = order.findIndex((key) => PROOF_ROLES.has(byKey.get(key)?.role ?? ''))
  const actAt = firstAct === undefined ? -1 : order.indexOf(firstAct)
  if (at === -1 || actAt === -1 || actAt > at || at / (order.length - 1) <= FIRST_PROOF_AT_MAX) return
  const proof = order[at]
  if (same(order[at - 1], order[at + 1]) || same(order[actAt - 1], proof) || same(proof, order[actAt])) return
  order.splice(at, 1)
  order.splice(actAt, 0, proof)
}

export function separateSkeletons(order: string[], byKey: ReadonlyMap<string, Piece>, spare: ReadonlySet<string>, factsFrom: number): void {
  const { sig, same } = sameSkeletonOf(byKey)
  const isMessage = (key: string) => byKey.get(key)?.role === FILL_MESSAGE_ROLE
  const left = new Set<string>()
  for (let guard = 0; guard < order.length * 2; guard++) {
    const at = order.findIndex((key, i) => i > 0 && i - 1 < factsFrom && !left.has(key) && same(order[i - 1], key))
    if (at === -1) return
    const pick = order
      .map((key, i) => ({ key, i }))
      // 짝 자신은 짝과 뼈대가 같아 여기서 빠진다
      .filter(({ key, i }) => isMessage(key) && sig(key) !== sig(order[at]) && !same(order[i - 1], order[i + 1]))
      .sort((a, b) => Number(spare.has(b.key)) - Number(spare.has(a.key)) || Math.abs(a.i - at) - Math.abs(b.i - at) || a.i - b.i)[0]
    if (!pick) {
      left.add(order[at])
      continue
    }
    order.splice(pick.i, 1)
    order.splice(pick.i < at ? at - 1 : at, 0, pick.key)
  }
}

/** 끝 자리 판정(원장·시험) — 사이즈·상품 정보가 이 순서로 페이지 맨 끝인지. 둘 다 없으면 ok. last는 실제 끝 두 키 */
export function factsTailOf(plan: Pick<DesigncutPlan, 'sections' | 'order'>): { ok: boolean; last: string[] } {
  const template = (key: string) => plan.sections.find((s) => s.key === key)?.template
  const want = [...plan.order.filter((key) => template(key) === 'T6'), ...plan.order.filter((key) => key === 'long:info')]
  const tail = want.length === 0 ? [] : plan.order.slice(-want.length)
  return { ok: tail.join('|') === want.join('|'), last: plan.order.slice(-2) }
}
