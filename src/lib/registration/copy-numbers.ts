// 숫자·단위 대조(P0-2, 상세페이지 마법사 비교 계획 — 통합 2026-10-30) — 최종 카피에 숫자로 쓴 값+단위가 입력(상품 정보·리뷰 원문·
// 인증·이벤트·옵션)에 없으면 찾는다. 파이프라인이 재작성을 1회 지시하고, 남은 것은 경고·기록만 한다(지우거나 고치지 않는다).
//
// - 카피는 숫자로 쓴 것만 본다. '하루 종일'·'한 번 써 보면'처럼 숫자 없이 말하는 체감 표현은 건드리지 않는다(오너 기준).
// - 숫자 합성어(1회성·1회용·1인분·500ml용)는 숫자 주장이 아니라 낱말이라 보지 않는다(통합 결정) — 낱말 자체의 사실은 다른 검사가 맡는다.
// - 입력은 순우리말 수(하루·이틀·두 번·석 달 …)를 숫자로 바꿔 대조한다 — 입력이 '하루 두 번'이면 카피의 '1일 2회'는 근거가 있다.
//   관용 표현('하루 종일'·'한 번에')은 수로 바꾸지 않는다 — 숫자 없는 표현이 수치 주장의 근거가 되지 않게.
// - 같은 양은 환산해 비교한다(1.5L = 1,500ml, 24시간 = 1일, 1년 = 12개월, 3만원 = 30,000원). 동의어(번=회, 살=세, 매=장, P=개).
// - 범위·치수 묶음('3~5세'·'30x40cm'·'W30×H40cm')은 숫자마다 단위를 붙인다. 천 단위 쉼표('1,500')는 한 숫자다.
// - 한글 단위는 숫자에 붙여 쓴 것만 본다('POINT 2 분리형'의 '2 분'은 아니다). 영문·기호 단위는 띄어 써도 본다.
// - 입력의 숫자 칸(평점·완판 차수·리뷰 수·사용 연령)은 칸마다 정한 단위만 받친다(평점 5가 '5년'을 받치지 않는다).
// - 'N가지'·'N종류'·'N단계'는 구성 번호라 보지 않는다. 'N종'은 등록 옵션 구조가 있으면 사실 값 정정(copy-facts)이 맡고, '1종'은
//   단일 구성 설명이라 보지 않는다.
// - 경쟁사 리뷰·레퍼런스는 다른 상품의 사실이라 입력으로 보지 않는다.

import { isOptionSpec } from './options/option-spec'
import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

export interface NumberFinding {
  /** 카피 안 위치(예: 'pointCards[0].description') */
  path: string
  /** 걸린 숫자+단위(예: '24시간') */
  token: string
  /** 그 칸의 글(80자까지) */
  text: string
}

export interface NumberSources {
  /** 양별로 환산한 값('len:300' 등) */
  keys: Set<string>
  /** 입력에 나온 모든 숫자 — 연도('2025년')만 이것으로 본다 */
  numbers: Set<number>
  /** 등록 옵션 구조가 있어 'N종'을 사실 값 정정이 맡는지 */
  optionCounts: boolean
}

type UnitDef = { cls: string; factor: number } | null

/** [표기들, 양, 기준 단위로의 배수]. 같은 양끼리 환산해 비교한다. 양 이름이 빈 칸이면 표기 자체가 양이다. 한글 단위 뒤 제한은 표기에 붙인다 */
const UNIT_TABLE: Array<[readonly string[], string, number]> = [
  [['mm', '㎜', '밀리미터'], 'len', 1],
  [['cm', '㎝', '센티미터', '센티'], 'len', 10],
  [['km', '㎞', '킬로미터'], 'len', 1_000_000],
  [['m', '미터'], 'len', 1000],
  [['mg', '㎎', '밀리그램'], 'mass', 1],
  [['g', '그램'], 'mass', 1000],
  [['kg', '㎏', '킬로그램', '킬로'], 'mass', 1_000_000],
  [['ml', 'mL', '㎖', '밀리리터', 'cc'], 'vol', 1],
  [['L', 'ℓ', '리터'], 'vol', 1000],
  [['%', '％', '퍼센트'], 'pct', 1],
  // '자극 1도 없는'·'1도 모르는'은 관용이다
  [['℃', '°C', '°', '도(?!\\s*(?:없|안 |못|모르))'], 'temp', 1],
  [['초'], 'time', 1],
  [['분(?!의)'], 'time', 60],
  [['시간'], 'time', 3600],
  [['일'], 'time', 86_400],
  [['주일', '주(?!년)'], 'time', 604_800],
  [['개월', '달(?!러)'], 'month', 1],
  [['년'], 'month', 12],
  [['원'], 'won', 1],
  // 'N만 회전'(RPM을 풀어 쓴 꼴 — 카피 규칙)은 횟수가 아니다
  [['RPM', 'rpm', '회전'], 'rpm', 1],
  [['번', '회'], 'times', 1],
  [['세(?!요)', '살'], 'age', 1],
  [['인치', 'inch'], 'inch', 1],
  [['개입', '개', '입(?![가-힣])', 'P', 'pcs', 'ea'], '개', 1],
  [['매', '장'], '장', 1],
  [['봉지', '봉'], '봉', 1],
  [['세트', 'set'], '세트', 1],
  [['kcal', '칼로리'], 'kcal', 1],
  [['위(?!생|치)', '등(?!급|분)'], '위', 1],
  [['종(?!류)'], '종', 1],
  [['팩', '구', '배', '겹', '층', '칸', '인분', '명', '건', '박스', '롤', '켤레', '쌍'], '', 1],
  [['포(?!인)', '캡슐', '알', '병', '캔', '단', '차(?!원)', '점(?!\\s*만점)'], '', 1],
  [['mAh', 'Wh', 'W', 'V', 'Hz', 'dB', 'ppm', '평', '㎡'], '', 1],
]
/** 보지 않는 단위 — 구성 번호. 정규식에는 넣어 '3단계'가 '3단'으로, '3종류'가 '3종'으로 걸리지 않게 한다 */
const SKIPPED_UNITS = ['가지', '종류', '단계']

const UNIT_OF = new Map<string, UnitDef>()
const UNIT_PATTERNS: string[] = []
for (const [aliases, cls, factor] of UNIT_TABLE) {
  for (const alias of aliases) {
    const word = alias.replace(/\(\?.*$/, '')
    UNIT_OF.set(word, { cls: cls || word, factor })
    // 영문 단위는 뒤에 영문자·숫자가 이어지면 다른 낱말이다('3min'·'5gb'·'10W30')
    UNIT_PATTERNS.push(/^[A-Za-z]+$/.test(word) ? `${word}(?![A-Za-z\\d])` : alias)
  }
}
for (const word of SKIPPED_UNITS) {
  UNIT_OF.set(word, null)
  UNIT_PATTERNS.push(word)
}
UNIT_PATTERNS.sort((a, b) => b.replace(/\(\?.*$/, '').length - a.replace(/\(\?.*$/, '').length)

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`
/** 범위·치수 묶음의 사이 — '3~5', '30x40', '2-3' */
const SEP = String.raw`\s*[~∼～–\-xX×*]\s*`
/** 앞이 숫자·영문자·'+'이면 다른 숫자의 일부다('EN71'·'1+1') */
const TOKEN_RE = new RegExp(
  `(?<![\\d.,+A-Za-z])((?:(?:${NUM})${SEP})*(?:${NUM}))(\\s*)(만|천|억)?\\s*(${UNIT_PATTERNS.join('|')})`,
  'g'
)
const MULTIPLIER: Record<string, number> = { 만: 10_000, 천: 1000, 억: 100_000_000 }
/** 숫자 합성어 — 단위 바로 뒤에 붙으면 낱말이다('1회성'·'1회용'·'500ml용') */
const COMPOUND_AFTER = /^[용성]/

const toNumber = (s: string) => Number(s.replace(/,/g, ''))
const keyOf = (cls: string, value: number) => `${cls}:${Number(value.toFixed(6))}`

/** 대문자 단위('30CM'·'2KG'·'10PCS')는 소문자 표기로 */
const UNIT_CASE: Record<string, string> = {
  cm: 'cm',
  mm: 'mm',
  ml: 'ml',
  kg: 'kg',
  km: 'km',
  mg: 'mg',
  kcal: 'kcal',
  ppm: 'ppm',
  cc: 'cc',
  inch: 'inch',
  pcs: 'pcs',
  ea: 'ea',
  set: 'set',
  mah: 'mAh',
  rpm: 'rpm',
}

/** 표기 정리 — 대문자 단위, 치수 머리글자('W30×H40'), 금액 묶음('1만 2천원' → '12000원') */
function normalizeNotation(text: string): string {
  return text
    .replace(/(\d)\s*([A-Za-z]{2,4})(?![A-Za-z])/g, (whole, d: string, unit: string) => {
      const canon = UNIT_CASE[unit.toLowerCase()]
      return canon ? `${d}${canon}` : whole
    })
    .replace(/(?<![A-Za-z\d])[WHDL](?=\d)/g, '')
    .replace(/(?<![\d,])(\d+)\s*만\s*(\d+)\s*천/g, (_, a: string, b: string) =>
      String(Number(a) * 10_000 + Number(b) * 1000)
    )
    .replace(/(?<![\d,])(\d+)\s*만\s*(\d{1,3},\d{3}|\d{1,4})(?=\s*원)/g, (_, a: string, b: string) =>
      String(Number(a) * 10_000 + toNumber(b))
    )
}

interface Token {
  /** 걸린 글자(표기 정리 뒤) */
  raw: string
  /** 단위 앞 숫자(배수 전) */
  nums: number[]
  unit: string
  def: Exclude<UnitDef, null>
  multiplier: number
}

function tokensOf(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const [raw, numbers, gap, mult, unit] = m
    const def = UNIT_OF.get(unit)
    if (!def) continue
    // 한글 단위는 숫자에 붙여 쓴 것만('STEP 1 세척'·'TOP 3 일상템'은 아니다) — 배수('3만 원')는 띄어 써도 된다
    if (!mult && gap && /^[가-힣]/.test(unit)) continue
    if (COMPOUND_AFTER.test(text.slice((m.index ?? 0) + raw.length))) continue
    const nums = numbers.split(new RegExp(SEP)).map(toNumber)
    if (unit === '인분' && nums.length === 1 && nums[0] === 1) continue
    out.push({ raw, nums, unit, def, multiplier: mult ? MULTIPLIER[mult] : 1 })
  }
  return out
}

/** 순우리말 수 — 입력 쪽에만 쓴다(카피의 숫자 없는 표현은 보지 않는다) */
const NATIVE: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  석: 3,
  네: 4,
  넉: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
  스무: 20,
}
const NATIVE_ALT = Object.keys(NATIVE).join('|')
/** 붙여 써도 되는 세는 말('두개'·'한번') */
const NATIVE_ATTACHED = new RegExp(`(?<![가-힣\\d])(${NATIVE_ALT})\\s*(번|개|장|명|배|시간|켤레|세트|팩)`, 'g')
/** 띄어 쓸 때만 보는 세는 말 — 붙으면 다른 낱말이다('세포'·'한달음') */
const NATIVE_SPACED = new RegExp(
  `(?<![가-힣\\d])(${NATIVE_ALT})\\s+(쌍|달|주|살|병|알|봉지|봉|캔|포|겹|층|칸|잔|스푼|캡슐)`,
  'g'
)
const NATIVE_WORDS: Array<[RegExp, string]> = [
  // 관용 — 수가 아니다
  [/한\s?번에/g, '단번에'],
  [/(?<![가-힣\d])하루(?!\s*종일|도|하루)/g, '1일'],
  [/(?<![가-힣\d])이틀/g, '2일'],
  [/(?<![가-힣\d])사흘/g, '3일'],
  [/(?<![가-힣\d])나흘/g, '4일'],
  [/(?<![가-힣\d])닷새/g, '5일'],
  [/(?<![가-힣\d])열흘/g, '10일'],
  [/(?<![가-힣\d])보름/g, '15일'],
  [/(?<![가-힣\d])일주일/g, '1주일'],
  [/(?<![가-힣\d])일회(?=용|성)/g, '1회'],
  [/(?<![가-힣\d])일\s?년/g, '1년'],
  [/(?<![가-힣\d])반년/g, '6개월'],
]

export function normalizeNativeNumbers(text: string): string {
  let out = text
  for (const [re, to] of NATIVE_WORDS) out = out.replace(re, to)
  const toDigits = (_: string, n: string, counter: string) => `${NATIVE[n]}${counter}`
  return out.replace(NATIVE_ATTACHED, toDigits).replace(NATIVE_SPACED, toDigits)
}

/** 날짜('10/31까지') — 이벤트 입력에서만 읽는다(리뷰 직렬화의 '평점 5/5'·옵션 사진 경로를 날짜로 읽지 않게) */
const DATE_RE = /(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g
/** 숫자 칸 — 칸마다 받쳐 주는 양(문자열 숫자 '14'도 같다) */
const NUMERIC_FIELD_CLASSES: Record<string, readonly string[]> = {
  rating: ['점'],
  soldOutCount: ['차', 'times'],
  reviewCount: ['개', '명', '건'],
  minAgeYears: ['age'],
}
/** 같은 칸의 측정값 — 짧은 칸에 단위가 한쪽에만 붙은 치수('가로 30 x 세로 40cm')는 그 칸의 숫자 모두에 단위를 붙인다 */
const MEASURE_CLASSES = new Set(['len', 'mass', 'vol'])
const SHORT_FIELD = 60
const ADDRESS_RE = /^(?:https?:|data:|blob:)|^\/\S*\/\S*$/

/** 입력으로 보지 않는 칸 — 다른 상품의 사실(경쟁사 리뷰·레퍼런스)과 화면·사진 지시·사진 주소 */
const SOURCE_SKIP_KEYS = new Set([
  'competitorReviews',
  'referenceInputs',
  'reviewFiles',
  'draftPrefill',
  'searchTags',
  'heroImageMode',
  'imagePhotoStyle',
  'photographyNote',
  'brandHexColor',
  'generationTrack',
  'contentLength',
  'sourceImage',
  // 우리 판매량(J51) — 등록상품ID·옵션별 판매·묶음 수량은 카피가 보지 않는다. 카피 숫자는 합·기간 문구(ownSales)만 받친다
  'ownSalesProductIds',
  'ownSalesBundleQty',
  'ownSalesSnapshot',
])

function addText(sources: NumberSources, text: string, field: string): void {
  if (ADDRESS_RE.test(text.trim())) return
  const normalized = normalizeNotation(normalizeNativeNumbers(text))
  const tokens = tokensOf(normalized)
  for (const token of tokens) {
    for (const n of token.nums) sources.keys.add(keyOf(token.def.cls, n * token.multiplier * token.def.factor))
  }
  const numbers = [...normalized.matchAll(new RegExp(NUM, 'g'))].map((m) => toNumber(m[0]))
  for (const n of numbers) sources.numbers.add(n)
  if (normalized.length <= SHORT_FIELD) {
    for (const token of tokens.filter((t) => MEASURE_CLASSES.has(t.def.cls))) {
      for (const n of numbers) sources.keys.add(keyOf(token.def.cls, n * token.def.factor))
    }
  }
  if (field === 'eventBannerInfo') {
    for (const m of normalized.matchAll(DATE_RE)) sources.keys.add(keyOf('time', Number(m[2]) * 86_400))
  }
}

function addNumber(sources: NumberSources, value: number, field: string): void {
  sources.numbers.add(value)
  for (const cls of NUMERIC_FIELD_CLASSES[field] ?? []) sources.keys.add(keyOf(cls, value))
}

function walkSource(value: unknown, field: string, sources: NumberSources): void {
  if (typeof value === 'number' && Number.isFinite(value)) addNumber(sources, value, field)
  else if (typeof value === 'string') {
    if (NUMERIC_FIELD_CLASSES[field] && /^\d+(?:\.\d+)?$/.test(value.trim())) addNumber(sources, Number(value), field)
    else addText(sources, value, field)
  } else if (Array.isArray(value)) value.forEach((v) => walkSource(v, field, sources))
  else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    // 추가 스펙 {key: '용량(ml)', value: '500'} — 이름 괄호 속 단위를 값에 붙인다
    const unitInKey = typeof rec.key === 'string' ? /\(([^)]+)\)\s*$/.exec(rec.key)?.[1] : undefined
    if (unitInKey && typeof rec.value === 'string') addText(sources, `${rec.value}${unitInKey}`, field)
    for (const [k, v] of Object.entries(rec)) if (!SOURCE_SKIP_KEYS.has(k)) walkSource(v, k, sources)
  }
}

/** 입력에서 계산되는 개수 — 등록 옵션 수·축마다 값 수·색상 옵션 수(카피의 'N개'·'N종'을 받쳐 준다) */
function countsOf(specSheet: PdpSpecSheet | undefined): number[] {
  const counts = [new Set(specSheet?.colorOptions ?? []).size]
  const spec = (specSheet as Record<string, unknown> | undefined)?.optionSpec
  if (isOptionSpec(spec)) {
    counts.push(spec.variants.length, ...spec.axes.map((a) => new Set(a.values.map((v) => v.trim())).size))
  }
  return counts.filter((n) => n > 0)
}

/** 자사 리뷰 파일 통계의 건수 — 없으면 빈 목록 */
function reviewStatCounts(specSheet: PdpSpecSheet | undefined): number[] {
  const own = specSheet?.reviewFiles?.own as { sampled?: unknown; stats?: { total_rows?: unknown; text_review_count?: unknown; rating_counts?: Record<string, unknown> } } | undefined
  const values = [own?.sampled, own?.stats?.total_rows, own?.stats?.text_review_count, ...Object.values(own?.stats?.rating_counts ?? {})]
  return values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
}

/** 입력 숫자 — 상품 정보 전체(리뷰 원문·인증·이벤트·옵션 구조 포함)와 입력에서 계산되는 개수 */
export function buildNumberSources(specSheet: PdpSpecSheet | undefined, { reviewStats = false }: { reviewStats?: boolean } = {}): NumberSources {
  const spec = (specSheet as Record<string, unknown> | undefined)?.optionSpec
  const sources: NumberSources = {
    keys: new Set(),
    numbers: new Set(),
    optionCounts: isOptionSpec(spec) && spec.axes.length > 0,
  }
  walkSource(specSheet ?? {}, '', sources)
  for (const n of countsOf(specSheet)) {
    sources.keys.add(keyOf('개', n))
    sources.keys.add(keyOf('종', n))
    sources.numbers.add(n)
  }
  // 자사 리뷰 파일 통계(전체·글 리뷰·표집·별점별 건수) — 재현 검사만 켠다. 리뷰 글 머리의 '5점 292'는 단위가 없어 글로는 '292건'과 맞지 않는다.
  // 운영 카피 게이트는 끈 채로 둔다(지금과 같다)
  if (reviewStats) {
    for (const n of reviewStatCounts(specSheet)) addNumber(sources, n, 'reviewCount')
  }
  return sources
}

/** 숫자 하나가 입력에 있는지 — 환산 값, 연도(1900~2100년은 입력에 그 숫자가 있으면) */
function supported(token: Token, n: number, sources: NumberSources): boolean {
  if (sources.keys.has(keyOf(token.def.cls, n * token.multiplier * token.def.factor))) return true
  return token.unit === '년' && n >= 1900 && n <= 2100 && sources.numbers.has(n)
}

/**
 * 보지 않는 칸 — 등록 옵션명·리뷰 원문 발췌·상품명(최상위 title)·사진 지시·내부 기록, 그리고 카피 규칙이 본 칸에서 만드는 파생 칸
 * (hero_copy·sections·section_copy_blocks·cta_variants는 같은 문장을 되풀이하고, objection_handlers의 질문은 분석 산출이라
 * 재작성으로 바뀌지 않는다)
 */
const COPY_SKIP_KEYS = new Set([
  'options',
  'reviewHighlights',
  'designPalette',
  'imageHint',
  'image_direction',
  'sizeComparisonObject',
  'seo_keywords',
  'review_strategy',
  'trust_gate',
  'skeleton_excluded',
  'persuasion',
  'evidenceLevel',
  'annotations',
  'layouts',
  'bridges',
  'hero_copy',
  'sections',
  'section_copy_blocks',
  'objection_handlers',
  'cta_variants',
])

function walkCopy(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (Array.isArray(value)) value.forEach((v, i) => walkCopy(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const child = path ? `${path}.${k}` : k
      if (!COPY_SKIP_KEYS.has(k) && child !== 'title') walkCopy(v, child, out)
    }
  }
}

/** 최종 카피에서 입력에 없는 숫자+단위 — 같은 글의 같은 숫자는 칸이 달라도 한 번만 */
export function findUnsupportedNumbers(copy: CopywritingResult, sources: NumberSources): NumberFinding[] {
  const strings: Array<{ path: string; text: string }> = []
  walkCopy(copy, '', strings)
  const findings: NumberFinding[] = []
  const seen = new Set<string>()
  for (const { path, text } of strings) {
    for (const token of tokensOf(normalizeNotation(text))) {
      // 'N종'은 등록 옵션 구조가 있으면 사실 값 정정이 맡고, '1종'(단일 구성)은 구성 설명이라 보지 않는다
      if (token.unit === '종' && (sources.optionCounts || token.nums.every((n) => n === 1))) continue
      if (token.nums.every((n) => supported(token, n, sources))) continue
      const key = `${token.raw}|${text}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ path, token: token.raw.trim(), text: text.length > 80 ? `${text.slice(0, 80)}…` : text })
    }
  }
  return findings
}

/** 재작성 지시 — 걸린 숫자를 지우거나 입력 값으로 고치게 한다(1회). 숫자 없는 체감 표현은 그대로 써도 된다고 함께 말한다 */
export function buildNumberRewriteDirective(findings: readonly NumberFinding[]): string {
  const lines = findings.slice(0, 15).map((f) => `- [${f.path}] "${f.text}" (${f.token})`)
  return (
    '[숫자·단위 재작성 지시] 아래 숫자·단위는 상품 정보·리뷰 원문·인증·이벤트 입력에 없다. 그 숫자를 빼거나 입력에 있는 값으로 고쳐 ' +
    '다시 써라. 숫자 없이 체감으로 말하는 표현은 그대로 써도 된다:\n' +
    lines.join('\n')
  )
}
