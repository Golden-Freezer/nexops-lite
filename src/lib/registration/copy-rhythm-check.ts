// 카피 리듬 검사(rhythm, 오너 지시 2026-10-31 — 통합 배정) — "카피라이트는 짧은 문장, 한 문장이 두 줄이 되면 의미에 따라 읽는 리듬이
// 어색해지지 않게 줄바꿈", "한 문장 한 문장이 눈에 잘 들어오지 않고 답답한 느낌", "섹션마다 무엇을 보여주고 알려주고 싶은지 확실하게".
// 제목 칸(후킹·제목·카드 제목·주장)의 긴 줄과 어색한 줄바꿈, 본문 칸의 긴 문장·많은 문장을 결정론으로 센다. 최종 카피(와 pro Stage 2
// 산출)의 수는 모든 잡에 copy_sections.copy_rhythm으로 남기고(측정용), rhythm 스위치 잡은 Stage 2에 쓰기 지시를, Stage 3에 고칠 곳을
// 넘긴다(추가 콜 없음). 편집기·합성은 \n을 줄바꿈으로 그린다(white-space: pre-wrap). 문턱은 처음 값이고 R10 기록으로 맞춘다.

import type { CopyRhythmCounts, CopyRhythmRecord, CopywritingResult } from './pdp-state'

/** 제목 한 줄 글자 수 상한(공백 포함) — 오너 지시 '짧은 문장', 통합 권장 한 줄 12~16자 안팎 */
export const HEAD_LINE_MAX = 16
/** 본문 한 문장 글자 수 상한 — 넘으면 정보가 둘 이상 섞인 긴 문장으로 본다 */
export const BODY_SENTENCE_MAX = 40
/** 본문 한 칸 문장 수 상한 — '2~3문장 안에서 제목을 받친다' */
export const BODY_SENTENCE_COUNT_MAX = 3

/**
 * 줄 첫머리가 조사·어미뿐인 줄바꿈('포장이\n끝나요'는 괜찮고 '포장을\n받아요'도 괜찮지만 '포장\n을 받아요'는 어색하다).
 * 지시어로 흔히 줄을 여는 '이'('이 파우치 하나면')와 낱말인 '해'('해 질 무렵')는 넣지 않는다
 */
const FRAGMENT_START =
  /^(?:을|를|가|은|는|에|에서|에게|의|로|으로|와|과|도|만|까지|부터|처럼|보다|하고|해요|합니다|니다|요|죠|예요|이에요|입니다)(?=$|[\s.,!?…~])/

const PRO_COPY_KEYS = ['productExposure', 'directionHint', 'conceptCopy', 'mainCutCopy', 'keyMessageCopy', 'convertDivCopy', 'eventBundleCopy']

type Kind = 'head' | 'body'
interface Field {
  path: string
  text: string
  kind: Kind
}

export interface RhythmFinding {
  path: string
  text: string
  /** 긴 줄 글자 수·긴 문장·문장 수 */
  detail?: string
}
export interface CopyRhythmFindings {
  headFields: number
  bodyFields: number
  headLong: RhythmFinding[]
  badBreaks: RhythmFinding[]
  longSentences: RhythmFinding[]
  crowded: RhythmFinding[]
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** 리듬을 보는 칸 — 제목(후킹·헤드라인·선언·카드 제목·주장·핵심 메시지·마무리)과 본문(부제·설명·증명·효익·보조 문구) */
function fieldsOf(copy: CopywritingResult): Field[] {
  const out: Field[] = []
  const push = (path: string, value: unknown, kind: Kind) => {
    if (typeof value === 'string' && value.trim()) out.push({ path, text: value, kind })
  }
  const intro = obj(copy.mainIntro)
  push('mainIntro.hook', intro.hook, 'head')
  push('mainIntro.benefitHeadline', intro.benefitHeadline, 'head')
  push('mainIntro.subBenefit', intro.subBenefit, 'body')
  push('problem.empathy', obj(copy.problem).empathy, 'body')
  push('solution.declaration', obj(copy.solution).declaration, 'head')
  push('solution.summary', obj(copy.solution).summary, 'body')
  arr(copy.pointCards).forEach((c, i) => {
    push(`pointCards[${i}].title`, obj(c).title, 'head')
    push(`pointCards[${i}].description`, obj(c).description, 'body')
  })
  arr(copy.detailPoints).forEach((p, i) => {
    push(`detailPoints[${i}].claim`, obj(p).claim, 'head')
    push(`detailPoints[${i}].proof`, obj(p).proof, 'body')
    push(`detailPoints[${i}].benefit`, obj(p).benefit, 'body')
  })
  arr(copy.howTo).forEach((h, i) => push(`howTo[${i}].description`, obj(h).description, 'body'))
  const record = copy as unknown as Record<string, unknown>
  for (const key of PRO_COPY_KEYS) {
    push(`${key}.headline`, obj(record[key]).headline, 'head')
    push(`${key}.subCopy`, obj(record[key]).subCopy, 'body')
  }
  const cta = copy.closingCta as unknown
  if (typeof cta === 'string') push('closingCta', cta, 'head')
  else {
    push('closingCta.headline', obj(cta).headline, 'head')
    push('closingCta.subtext', obj(cta).subtext, 'body')
  }
  push('soldOutBanner.headline', obj(copy.soldOutBanner).headline, 'head')
  const variations = obj(copy.keyMessageVariations)
  for (const k of ['top', 'mid', 'bottom']) push(`keyMessageVariations.${k}`, variations[k], 'head')
  return out
}

const linesOf = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)
const visible = (s: string) => s.replace(/\s/g, '').replace(/[.,!?…~"'”’)]/g, '')
/** 본문 문장 — 끝 문장부호 뒤와 줄바꿈에서 나눈다 */
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => visible(s).length > 0)

/** 줄 첫머리가 조사·어미뿐이거나 한두 글자만 남은 줄 — 첫 줄은 보지 않는다 */
export function hasBadBreak(text: string): boolean {
  return linesOf(text)
    .slice(1)
    .some((line) => FRAGMENT_START.test(line) || visible(line).length <= 2)
}

/** hookshort 잡은 첫 화면 세 칸을 copy-hook-short.ts가 따로 잰다(한 줄 7자) — 여기서 16자로 또 재면 지시가 어긋난다 */
const FIRST_SCREEN_PATHS: ReadonlySet<string> = new Set(['mainIntro.hook', 'mainIntro.benefitHeadline', 'mainIntro.subBenefit'])

export function findCopyRhythmIssues(copy: CopywritingResult, opts: { hookShort?: boolean } = {}): CopyRhythmFindings {
  const fields = opts.hookShort ? fieldsOf(copy).filter((f) => !FIRST_SCREEN_PATHS.has(f.path)) : fieldsOf(copy)
  const findings: CopyRhythmFindings = {
    headFields: fields.filter((f) => f.kind === 'head').length,
    bodyFields: fields.filter((f) => f.kind === 'body').length,
    headLong: [],
    badBreaks: [],
    longSentences: [],
    crowded: [],
  }
  for (const f of fields) {
    if (f.text.includes('\n') && hasBadBreak(f.text)) findings.badBreaks.push({ path: f.path, text: f.text })
    if (f.kind === 'head') {
      const longest = Math.max(...linesOf(f.text).map((l) => [...l].length))
      if (longest > HEAD_LINE_MAX) findings.headLong.push({ path: f.path, text: f.text, detail: `${longest}자` })
      continue
    }
    const sentences = sentencesOf(f.text)
    const long = sentences.find((s) => [...s].length > BODY_SENTENCE_MAX)
    if (long) findings.longSentences.push({ path: f.path, text: f.text, detail: long })
    if (sentences.length > BODY_SENTENCE_COUNT_MAX) findings.crowded.push({ path: f.path, text: f.text, detail: `${sentences.length}문장` })
  }
  return findings
}

export function copyRhythmCounts(f: CopyRhythmFindings): CopyRhythmCounts {
  return {
    head_fields: f.headFields,
    body_fields: f.bodyFields,
    head_long: f.headLong.length,
    bad_breaks: f.badBreaks.length,
    long_sentences: f.longSentences.length,
    crowded: f.crowded.length,
  }
}

const EXAMPLE_MAX = 5
const paths = (rows: RhythmFinding[]) => rows.slice(0, EXAMPLE_MAX).map((r) => r.path)

/** copy_rhythm 기록 — final은 최종 카피, before는 pro Stage 2 산출(고치기 전), fix = rhythm 스위치로 고칠 곳을 넘긴 잡 */
export function copyRhythmRecord(final: CopyRhythmFindings, before?: CopyRhythmFindings, fix = false): CopyRhythmRecord {
  return {
    version: 1,
    counts: copyRhythmCounts(final),
    ...(before ? { before: copyRhythmCounts(before) } : {}),
    ...(fix ? { fix: true as const } : {}),
    examples: {
      head_long: paths(final.headLong),
      bad_breaks: paths(final.badBreaks),
      long_sentences: paths(final.longSentences),
      crowded: paths(final.crowded),
    },
  }
}

const RHYTHM_RULES = [
  "섹션마다 '이 섹션이 알려 줄 한 가지'를 먼저 정하고, 그 섹션의 제목(headline·title·claim)이 그 한 가지를 말하게 쓴다. 한 섹션에 여러 이야기를 넣지 않는다.",
  `제목·후킹·카드 제목은 짧은 문장으로 쓴다(한 줄 12~${HEAD_LINE_MAX}자 안팎). 두 줄이 되면 의미 단위(어절 묶음) 사이에서 \\n으로 끊고, 조사·어미만 다음 줄로 넘기지 않는다(예: "끈만 당기면\\n포장 끝" ○, "끈만 당기면 포장\\n이 끝나요" ✕).`,
  `본문은 한 문장에 한 정보로 쓴다. ${BODY_SENTENCE_MAX}자를 넘는 문장은 나누고, ${BODY_SENTENCE_COUNT_MAX}문장 안에서 제목을 받친다.`,
  '내용(사실·수치·효익)은 그대로 두고 문장 모양만 바꾼다. 글자 수 한도·사실 값·섹션 잇기 낱말은 지킨다.',
]

/** 사용 장면 태그는 D 사진 막 제목으로도 나온다(R17 '거실밥자리'·'퇴근후샤워') — 쓰는 단계에서만 지시한다. 고치기 블록은 글 모양 규칙이라 넣지 않는다 */
const SCENE_TAG_RULE = "usageSceneTags는 사진 제목으로도 나온다. 낱말을 붙이지 말고 '#주말 아침 식사'처럼 띄어 쓴다."

/** Stage 2 쓰기 지시(rhythm 스위치 잡) — 사실 값 블록보다 앞에 붙는다 */
export const RHYTHM_WRITE_BLOCK = ['## [리듬 — 짧은 문장·의미 단위 줄바꿈]', ...[...RHYTHM_RULES, SCENE_TAG_RULE].map((r) => `- ${r}`)].join('\n')

/** Stage 3에 넘기는 수 상한 — 종류마다 */
export const RHYTHM_FIX_LIMITS = { headLong: 6, badBreaks: 4, longSentences: 4, crowded: 3 } as const
const clip = (t: string, n = 50) => (t.length > n ? `${t.slice(0, n)}…` : t).replace(/\n/g, '⏎')

/** Stage 3 '고칠 곳' 블록(rhythm 스위치 잡) — 걸린 것이 없으면 빈 문자열(프롬프트 불변) */
export function buildRhythmFixBlock(f: CopyRhythmFindings): string {
  const L = RHYTHM_FIX_LIMITS
  const lines = [
    ...f.headLong
      .slice(0, L.headLong)
      .map((r) => `- 긴 제목: [${r.path}] '${clip(r.text)}' — 한 줄 ${r.detail}. 줄이거나 의미 단위에서 \\n으로 끊는다`),
    ...f.badBreaks
      .slice(0, L.badBreaks)
      .map((r) => `- 어색한 줄바꿈: [${r.path}] '${clip(r.text)}' — 조사·어미(또는 한두 글자)만 다음 줄로 넘어간다. 의미 단위 사이에서 끊는다`),
    ...f.longSentences
      .slice(0, L.longSentences)
      .map((r) => `- 긴 문장: [${r.path}] '${clip(r.detail ?? r.text)}' — 한 문장 한 정보로 나눈다`),
    ...f.crowded
      .slice(0, L.crowded)
      .map((r) => `- 문장이 많은 본문: [${r.path}] — ${r.detail}. ${BODY_SENTENCE_COUNT_MAX}문장 안에서 제목을 받친다`),
  ]
  if (lines.length === 0) return ''
  return ['## [리듬 — 고칠 곳(결정론 검사)]', `${RHYTHM_RULES.slice(1).join(' ')} 바꾼 필드는 _changed_fields에 적는다.`, ...lines].join('\n')
}
