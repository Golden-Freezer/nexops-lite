// 카피 흐름 검사(P1-1b, 통합 배정 2026-10-31) — 섹션 사이 반복과 고민↔답 잇기를 결정론으로 센다. 최종 카피(와 pro Stage 2 산출)의
// 수는 모든 잡에 copy_sections.copy_flow로 남기고(측정용, 채점과 별개), flow 스위치 잡은 Stage 2 산출에서 찾은 것을 Stage 3 '고칠 곳'
// 으로 넘긴다(추가 콜 없음). 근거는 R9 심사 r4(흐름·반복) 2.0~2.5, r2(고민 해소) 2.5~3.5 메모다:
// - 같은 특징을 첫 화면·아이콘·포인트·추가 특징·마지막 띠에서 말만 바꿔 되풀이('끈 당겨 마감 / 끈을 당겨 입구를 모아요 …')
// - 같은 수치·사실('20매'·'반투명')이 여러 번
// - 소제목 아래 설명이 제목을 거의 그대로 다시 씀('바닥이 잡힌 입체 형태예요 / 바닥이 잡혀 있는 입체 구조')
// - 마지막 띠가 첫 화면 문구를 그대로 반복
// - 페이지가 꺼낸 고민('이름도 하나씩 챙겨요')에 끝까지 답하지 않음
// 형태소 분석 없이 낱말(끝 조사를 뗀 꼴)과 앞 두 글자로 보는 근사다 — 말을 바꾼 되풀이('끈을 당기세요'↔'끈 당겨')는 일부만 잡는다.
// 문턱은 처음 값이고 R9 2차 기록으로 맞춘다.

import { hookTypeWords } from './copy-rule-check'
import { findCrossSectionRepeats, repeatExclusionTerms, sectionTexts, stem, WORD_RE, type RepeatFinding } from './copy-repeats'
import type { CopyFlowCounts, CopyFlowRecord, CopywritingResult, PdpSpecSheet } from './pdp-state'

/** 첫 화면과 마지막 띠 한 쌍은 한 곳으로 센다 — 마지막 띠가 핵심 효익을 다시 정리하는 것은 정상 설득 패턴이다(통합 보정) */
const FLOW_MERGE: Readonly<Record<string, string>> = { closingCta: 'mainIntro' }
const FEATURE_GROUP = 'features'
/** 특징 제목 낱말이 2개 이상 나오는 특징 묶음 밖 섹션이 이만큼이면 같은 특징의 되풀이다 */
export const FEATURE_ECHO_MIN_SECTIONS = 2
/** 단위 붙은 숫자가 이 섹션 수 이상이면 같은 수치의 되풀이다 */
export const NUMBER_MIN_SECTIONS = 3
/** 설명이 제목 낱말을 2개 이상 되풀이하고 새 낱말이 이 수 이하이면 제목을 다시 쓴 것이다 */
export const RESTATE_MAX_NEW = 2

/** 낱말 목록에서 빼는 말 — 꾸밈·연결·고민 말(무엇을 말하는지 가리지 않는 말). 낱말은 끝 조사를 뗀 꼴로 보므로 뗀 꼴('있는' → '있')도 담는다 */
const STOPWORDS = new Set(
  ('정말 너무 매번 항상 자꾸 하나씩 하나하나 모두 모든 조금 많이 이제 지금 바로 그냥 혹시 어떻게 어떤 무엇 뭐 왜 언제 고민 걱정 문제 ' +
    '생각 마음 때문 때마다 우리 요즘 막상 은근 쉽게 편하게 간편하게 있는 없는 하는 되는 같은 이런 그런 이렇게 그렇게 할 수 것 거 더 잘 ' +
    '또 늘 다 제 내 이 그 저 한 두 세 번 때 날 분 점 중 안 속 위 밖 함께 같이 다시 직접 꼭 딱 쏙 톡')
    .split(' ')
    .filter(Boolean)
    .flatMap((w) => [w, stem(w)])
)
/** 고민의 핵심 낱말에서 빼는 풀이말 꼴(동사·형용사 끝) — '챙겨요'·'번거롭다'·'없을까' */
const PREDICATE_END = /(?:요|다|죠|까|네|니|며|데)$/

export interface FeatureEcho {
  /** 특징 제목(pointCards[i].title, 없으면 detailPoints[i].claim) */
  title: string
  /** 그 특징을 다시 말한 섹션(특징 묶음 밖, 첫 화면·마지막 띠는 mainIntro 하나) */
  sections: string[]
}
export interface NumberRepeat {
  token: string
  sections: string[]
}
export interface RestatedItem {
  path: string
  title: string
  body: string
}
export interface ClosingEcho {
  path: string
  text: string
  /** 첫 화면과 같은 낱말 묶음 */
  phrase: string
}
export interface ConcernCheck {
  path: string
  text: string
  keywords: string[]
  answered: boolean
}
/** 주장과 근거가 핵심 낱말을 하나도 같이 쓰지 않는 포인트(R9-P02 dp5 '선생님께 건넬 간식도 담아요' / '데이지 무늬의 반투명 디자인') */
export interface MismatchedClaim {
  path: string
  claim: string
  proof: string
}
export interface CopyFlowFindings {
  phrases: RepeatFinding[]
  features: FeatureEcho[]
  numbers: NumberRepeat[]
  restated: RestatedItem[]
  closingEcho: ClosingEcho[]
  /** 핵심 낱말이 있어 판정한 고민만 */
  concerns: ConcernCheck[]
  mismatched: MismatchedClaim[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const wordsOf = (text: string): string[] => (text.match(WORD_RE) ?? []).map(stem)
/** 같은 낱말 — 끝 조사를 뗀 꼴이 같거나, 두 글자 이상이면 앞 두 글자가 같다('이름'↔'이름표', '번거로운'↔'번거롭지') */
const sameWord = (a: string, b: string) => a === b || (a.length >= 2 && b.length >= 2 && a.slice(0, 2) === b.slice(0, 2))

interface Context {
  isExcluded: (word: string) => boolean
  sections: Map<string, string[]>
}

function contextOf(copy: CopywritingResult, specSheet: PdpSpecSheet): Context {
  // 옵션 값·브랜드·상품 종류 낱말은 섹션마다 나오는 게 정상이라 세지 않는다. 종류 낱말은 카피가 고른 것만 — 상품명 낱말로 대신하면
  // '끈'처럼 특징 낱말까지 빠진다
  const type = hookTypeWords(copy, specSheet)
  const excluded = [...repeatExclusionTerms(specSheet), ...(type?.source === 'copy' ? type.words : [])]
  const isExcluded = (w: string) => excluded.some((t) => w === t || (t.length >= 2 && w.startsWith(t)))
  const sections = new Map<string, string[]>()
  for (const [name, texts] of sectionTexts(copy)) {
    const section = FLOW_MERGE[name] ?? name
    sections.set(section, [...(sections.get(section) ?? []), ...texts])
  }
  return { isExcluded, sections }
}

/** 내용 낱말 — 숫자·꾸밈 말·옵션·브랜드·종류 낱말을 뺀 끝 조사 뗀 꼴 */
function contentWords(text: string, ctx: Context): string[] {
  return wordsOf(text).filter((w) => !/\d/.test(w) && !STOPWORDS.has(w) && !ctx.isExcluded(w))
}

function featureEchoes(copy: CopywritingResult, ctx: Context): FeatureEcho[] {
  const cards = copy.pointCards ?? []
  const titles = (cards.length > 0 ? cards.map((c) => str(c?.title)) : (copy.detailPoints ?? []).map((p) => str(p?.claim))).filter(Boolean)
  const sectionWords = [...ctx.sections.entries()]
    .filter(([s]) => s !== FEATURE_GROUP)
    .map(([s, texts]) => [s, new Set(texts.flatMap((t) => wordsOf(t)))] as const)
  return titles.flatMap((title) => {
    const words = [...new Set(contentWords(title, ctx))]
    if (words.length < 2) return []
    const sections = sectionWords.filter(([, set]) => words.filter((w) => set.has(w)).length >= 2).map(([s]) => s)
    return sections.length >= FEATURE_ECHO_MIN_SECTIONS ? [{ title, sections: sections.sort() }] : []
  })
}

function numberRepeats(ctx: Context): NumberRepeat[] {
  const sectionsOf = new Map<string, Set<string>>()
  for (const [section, texts] of ctx.sections) {
    for (const w of texts.flatMap(wordsOf)) {
      if (!/\d/.test(w) || /^\d+$/.test(w) || ctx.isExcluded(w)) continue
      sectionsOf.set(w, (sectionsOf.get(w) ?? new Set()).add(section))
    }
  }
  return [...sectionsOf.entries()]
    .filter(([, s]) => s.size >= NUMBER_MIN_SECTIONS)
    .map(([token, s]) => ({ token, sections: [...s].sort() }))
    .sort((a, b) => b.sections.length - a.sections.length || a.token.localeCompare(b.token))
}

/** 제목·설명 짝 — 카드·포인트·Pro 카피(제목·보조) */
function titleBodyPairs(copy: CopywritingResult): Array<{ path: string; title: string; body: string }> {
  const pairs: Array<{ path: string; title: string; body: string }> = []
  ;(copy.pointCards ?? []).forEach((c, i) => pairs.push({ path: `pointCards[${i}]`, title: str(c?.title), body: str(c?.description) }))
  ;(copy.detailPoints ?? []).forEach((p, i) => {
    pairs.push({ path: `detailPoints[${i}].proof`, title: str(p?.claim), body: str(p?.proof) })
    pairs.push({ path: `detailPoints[${i}].benefit`, title: str(p?.claim), body: str(p?.benefit) })
  })
  const record = copy as unknown as Record<string, { headline?: unknown; subCopy?: unknown } | undefined>
  for (const key of ['productExposure', 'directionHint', 'conceptCopy', 'mainCutCopy', 'keyMessageCopy', 'convertDivCopy', 'eventBundleCopy']) {
    pairs.push({ path: key, title: str(record[key]?.headline), body: str(record[key]?.subCopy) })
  }
  return pairs.filter((p) => p.title && p.body)
}

function restatedItems(copy: CopywritingResult, ctx: Context): RestatedItem[] {
  return titleBodyPairs(copy).filter(({ title, body }) => {
    const titleWords = [...new Set(contentWords(title, ctx))]
    const bodyWords = [...new Set(contentWords(body, ctx))]
    const shared = titleWords.filter((t) => bodyWords.some((b) => sameWord(t, b))).length
    const added = bodyWords.filter((b) => !titleWords.some((t) => sameWord(t, b))).length
    return shared >= 2 && added <= RESTATE_MAX_NEW
  })
}

/** 낱말 묶음(조사 뗀 꼴 두 낱말) — 옵션·브랜드·종류 낱말끼리의 묶음은 뺀다 */
function pairsOf(text: string, ctx: Context): string[] {
  const words = wordsOf(text)
  const out: string[] = []
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]]
    if ((ctx.isExcluded(a) || /^\d+$/.test(a)) && (ctx.isExcluded(b) || /^\d+$/.test(b))) continue
    if (STOPWORDS.has(a) && STOPWORDS.has(b)) continue
    out.push(`${a} ${b}`)
  }
  return out
}

function closingEchoes(copy: CopywritingResult, ctx: Context): ClosingEcho[] {
  const intro = copy.mainIntro ?? {}
  const first = new Set([intro.hook, intro.benefitHeadline, intro.subBenefit].flatMap((t) => pairsOf(str(t), ctx)))
  const cta = copy.closingCta as unknown
  const closing: Array<[string, string]> =
    typeof cta === 'string'
      ? [['closingCta', cta]]
      : [
          ['closingCta.headline', str((cta as { headline?: unknown } | undefined)?.headline)],
          ['closingCta.subtext', str((cta as { subtext?: unknown } | undefined)?.subtext)],
        ]
  return closing.flatMap(([path, text]) => {
    const phrase = pairsOf(text, ctx).find((p) => first.has(p))
    return text && phrase ? [{ path, text, phrase }] : []
  })
}

/**
 * 고민 — 고민 질문·공감 줄, 첫 화면·공감 문단의 물음 문장. 깊은 공감 줄(empathyDeepLines — '특별한 날인데 아쉬워요'·'매번 대충 넘기게
 * 돼요')은 답할 고민이 아니라 마음을 읽는 줄이라 보지 않는다
 */
function concernSources(copy: CopywritingResult): Array<{ path: string; text: string }> {
  const problem = copy.problem ?? {}
  const intro = copy.mainIntro ?? {}
  const questionsIn = (path: string, text: unknown) =>
    (str(text).match(/[^.!?\n]*\?/g) ?? []).map((q) => ({ path, text: q.trim() })).filter((q) => q.text.length > 1)
  return [
    ...(str(problem.question) ? [{ path: 'problem.question', text: str(problem.question) }] : []),
    ...(problem.empathyLines ?? []).map((t, i) => ({ path: `problem.empathyLines[${i}]`, text: str(t) })),
    ...questionsIn('problem.empathy', problem.empathy),
    ...(['hook', 'benefitHeadline', 'subBenefit'] as const).flatMap((k) => questionsIn(`mainIntro.${k}`, intro[k])),
  ].filter((c) => c.text)
}

function concernChecks(copy: CopywritingResult, ctx: Context): ConcernCheck[] {
  // 답은 본문 섹션에서 — 첫 화면(마지막 띠 포함)과 고민 섹션 자신은 답으로 보지 않는다
  const answerWords = [...ctx.sections.entries()]
    .filter(([s]) => s !== 'mainIntro' && s !== 'problem')
    .flatMap(([, texts]) => texts.flatMap(wordsOf))
  const seen = new Set<string>()
  return concernSources(copy).flatMap(({ path, text }) => {
    if (seen.has(text)) return []
    seen.add(text)
    const keywords = [...new Set(contentWords(text, ctx).filter((w) => w.length >= 2 && !PREDICATE_END.test(w)))]
    if (keywords.length === 0) return []
    return [{ path, text, keywords, answered: keywords.some((k) => answerWords.some((a) => sameWord(k, a))) }]
  })
}

/** 고민 글의 핵심 낱말(concernChecks와 같은 거름) — K 슬롯 고민 글과 D 짝 재기가 함께 쓴다 */
export function concernKeywords(text: string, isExcluded: (word: string) => boolean = () => false): string[] {
  return [...new Set(wordsOf(text).filter((w) => !/\d/.test(w) && !STOPWORDS.has(w) && !isExcluded(w) && w.length >= 2 && !PREDICATE_END.test(w)))]
}

/** 핵심 낱말 중 하나라도 글에 있는가 */
export function sharesWord(keywords: readonly string[], text: string): boolean {
  const words = wordsOf(text)
  return keywords.some((k) => words.some((w) => sameWord(k, w)))
}

/**
 * 고민 줄과 POINT의 짝(적용 T1-45 D) — 공감 줄마다 pointCards·detailPoints가 같은 낱말로 답하는지 센다. 낱말 근사라 말을 바꾼 답은 못 본다.
 * 저장 글과 V2 글을 비교하는 재기 함수이고 '고칠 곳'에는 넣지 않는다(근거를 다른 말로 받치는 정상 짝도 걸린다, mismatchedClaims와 같은 이유)
 */
export function concernPointPairs(copy: CopywritingResult, specSheet: PdpSpecSheet): { lines: number; paired: number } {
  const ctx = contextOf(copy, specSheet)
  const points = [...(copy.pointCards ?? []).flatMap((p) => [str(p?.title), str(p?.description)]), ...(copy.detailPoints ?? []).flatMap((p) => [str(p?.claim), str(p?.proof)])].join(' ')
  const lines = (copy.problem?.empathyLines ?? []).map((line) => concernKeywords(str(line), ctx.isExcluded)).filter((words) => words.length > 0)
  return { lines: lines.length, paired: lines.filter((words) => sharesWord(words, points)).length }
}

/**
 * 주장과 근거가 어긋난 포인트 — 두 글 모두 핵심 낱말(두 글자 이상)이 있는데 같은 낱말이 하나도 없다. 근거가 주장을 다른 말로 받치는
 * 정상 짝도 걸린다 — 골든 A-track-s 후보 3건('색감이 만드는 장면 차이' / '화려한 컬러 꽃가루가 배경 전체를 채움' 등)이 모두 그랬다.
 * 그래서 기록(후보 수)에만 남기고 Stage 3 고칠 곳에는 넣지 않는다 — 실 회차 기록으로 문턱을 맞춘 뒤 정한다
 */
function mismatchedClaims(copy: CopywritingResult, ctx: Context): MismatchedClaim[] {
  const key = (text: string) => contentWords(text, ctx).filter((w) => w.length >= 2)
  return (copy.detailPoints ?? []).flatMap((p, i) => {
    const [claim, proof] = [str(p?.claim), str(p?.proof)]
    const [a, b] = [key(claim), key(proof)]
    if (a.length === 0 || b.length === 0 || a.some((x) => b.some((y) => sameWord(x, y)))) return []
    return [{ path: `detailPoints[${i}]`, claim, proof }]
  })
}

export function findCopyFlowIssues(copy: CopywritingResult, specSheet: PdpSpecSheet): CopyFlowFindings {
  const ctx = contextOf(copy, specSheet)
  return {
    phrases: findCrossSectionRepeats(copy, { excludeTerms: repeatExclusionTerms(specSheet), mergeSections: FLOW_MERGE }),
    features: featureEchoes(copy, ctx),
    numbers: numberRepeats(ctx),
    restated: restatedItems(copy, ctx),
    closingEcho: closingEchoes(copy, ctx),
    concerns: concernChecks(copy, ctx),
    mismatched: mismatchedClaims(copy, ctx),
  }
}

export function copyFlowCounts(f: CopyFlowFindings): CopyFlowCounts {
  return {
    phrases: f.phrases.length,
    features: f.features.length,
    numbers: f.numbers.length,
    restated: f.restated.length,
    closing_echo: f.closingEcho.length,
    concerns: f.concerns.length,
    unanswered: f.concerns.filter((c) => !c.answered).length,
    mismatched: f.mismatched.length,
  }
}

const EXAMPLE_MAX = 5
const clip = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t).replace(/\n/g, ' ')

/** copy_flow 기록 — final은 최종 카피, before는 pro Stage 2 산출(고치기 전), fix = flow 스위치로 고칠 곳을 넘긴 잡 */
export function copyFlowRecord(final: CopyFlowFindings, before?: CopyFlowFindings, fix = false): CopyFlowRecord {
  return {
    version: 1,
    counts: copyFlowCounts(final),
    ...(before ? { before: copyFlowCounts(before) } : {}),
    ...(fix ? { fix: true as const } : {}),
    examples: {
      phrases: final.phrases.slice(0, EXAMPLE_MAX).map((p) => p.phrase),
      features: final.features.slice(0, EXAMPLE_MAX).map((e) => clip(e.title)),
      numbers: final.numbers.slice(0, EXAMPLE_MAX).map((n) => n.token),
      restated: final.restated.slice(0, EXAMPLE_MAX).map((r) => r.path),
      closing_echo: final.closingEcho.slice(0, EXAMPLE_MAX).map((e) => e.phrase),
      unanswered: final.concerns.filter((c) => !c.answered).slice(0, EXAMPLE_MAX).map((c) => clip(c.text)),
      mismatched: final.mismatched.slice(0, EXAMPLE_MAX).map((m) => m.path),
    },
  }
}

/** Stage 3에 넘기는 수 상한 — 종류마다 */
export const FLOW_FIX_LIMITS = { phrases: 5, features: 4, numbers: 3, restated: 4, closingEcho: 2, unanswered: 3 } as const

/** Stage 3 '고칠 곳' 블록(flow 스위치 잡) — 걸린 것이 없으면 빈 문자열(프롬프트 불변). 주장·근거 어긋남 후보는 기록만 한다 */
export function buildFlowFixBlock(f: CopyFlowFindings): string {
  const L = FLOW_FIX_LIMITS
  const where = (sections: string[]) => sections.join('·')
  const lines = [
    ...f.phrases.slice(0, L.phrases).map((p) => `- 되풀이 문구: '${p.phrase}' — ${where(p.sections)}`),
    ...f.features.slice(0, L.features).map((e) => `- 되풀이 특징: '${clip(e.title)}' — 특징 섹션 밖 ${where(e.sections)}에서 다시 말함`),
    ...f.numbers
      .slice(0, L.numbers)
      .map((n) => `- 되풀이 수치: '${n.token}' — ${where(n.sections)}. 수치는 한 섹션에서 한 번 말하고 다른 섹션은 그 수치가 주는 쓸모로 쓴다`),
    ...f.restated
      .slice(0, L.restated)
      .map((r) => `- 제목 되풀이: [${r.path}] '${clip(r.title, 40)}' / '${clip(r.body, 50)}' — 설명은 제목을 다시 말하지 말고 근거·장면을 더한다`),
    ...f.closingEcho
      .slice(0, L.closingEcho)
      .map((e) => `- 마지막 띠가 첫 화면과 같은 말: [${e.path}] '${clip(e.text, 50)}'('${e.phrase}') — 같은 문장·같은 낱말 묶음 대신 구매 이유 요약이나 다른 말로 쓴다`),
    ...f.concerns
      .filter((c) => !c.answered)
      .slice(0, L.unanswered)
      .map(
        (c) =>
          `- 답 없는 고민: [${c.path}] '${clip(c.text, 50)}' — ① 뒤 섹션(solution·특징·사용법)에서 입력 사실로 답한다 ② 답할 사실이 없으면 답할 수 있는 고민으로 바꾼다 ③ 그래도 안 되면 이 줄을 뺀다`
      ),
  ]
  if (lines.length === 0) return ''
  return [
    '## [흐름 — 고칠 곳(결정론 검사)]',
    '같은 효익·수치는 그 특징의 주 섹션(pointCards·같은 번호 detailPoints)에서 한 번 살려 말하고, 다른 섹션은 새 근거(입력 사실·후기·사용 장면·선택 기준·대상)로 바꿔 쓴다. 새로 쓸 사실이 없으면 되풀이한 문장을 지우고 칸을 짧게 둔다(목록 칸은 그 항목을 빼고, 필수 칸은 비우지 않는다). 첫 화면과 마지막 띠(closingCta)는 핵심 효익을 다시 정리해도 되지만 같은 문장·같은 낱말 묶음을 그대로 되풀이하지 않는다. 입력에 없는 사실·수치·장면 세부는 지어내지 않고, 규제 표현(인증·인허가·의학·기능성)은 쓰지 않는다. 바꾼 필드는 _changed_fields에 적는다. 글자 수 한도·섹션 잇기 낱말·사실 값은 그대로 지킨다.',
    ...lines,
  ].join('\n')
}
