/**
 * 리뷰 정화(LLM 전, 결정적) — NEXFIT agents/review_scrubber.py ① 정제 이식 + 계약 추가분.
 * - 개인정보: 연락처·이메일·링크·주민번호(원본) + 주문번호(하이픈만 허용한 10자리 이상 숫자열)·주소(시·도로 시작해
 *   하위 구역까지 있는 주소, 구 + 동·로·길 + 번지, 동·호). 리뷰어번호는 파서가 아예 읽지 않고, 이름은 읽는 즉시 가린다(P1-6).
 *   본문에 손님이 직접 쓴 사람 이름은 일반 낱말과 구분할 수 없어 지우지 않는다.
 * - 중복(정규화 본문이 같은 도배)과 개인정보만 남은 행은 버린다.
 * - 경쟁사 파일: 판매자명(법인 표기를 뗀 변형)과 상품옵션명 앞부분의 상품명·앞머리 브랜드를 본문·제목에서 지운다.
 */

import type { ParsedReview } from './review-types'

/** 시·도 이름(약칭 포함) — 앞에 이 이름이 와야 주소로 본다("사용시 입구" 같은 오탐 방지) */
const REGION =
  '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북|충청남|전라북|전라남|경상북|경상남)(?:특별시|광역시|특별자치시|특별자치도|도|시)?'
const ADDRESS_RE = new RegExp(
  `${REGION}\\s*[가-힣]{1,6}(?:시|군|구)(?:\\s*[가-힣0-9]{1,10}(?:구|동|읍|면|리|로|길))+(?:\\s*\\d{1,5}(?:-\\d{1,5})?(?:번길|번지)?)?`,
  'g'
)
/**
 * 시·도 없이 구 + 동·로·길 + 번지까지 쓴 주소. 번지는 하이픈 지번·번길·번지이거나, 뒤에 글자·숫자·점이 붙지 않은 숫자만 —
 * "친구 추천으로 2개", "가구 뒤로 10cm", "운동기구 자동 3단계" 같은 일상 문장(숫자 뒤 단위)은 주소로 보지 않는다.
 */
const DISTRICT_ADDRESS_RE =
  /[가-힣]{1,6}구\s*[가-힣0-9]{1,10}(?:동|로|길)\s*\d{1,5}(?:-\d{1,5}(?!\d)|\s*번(?:길|지)|(?![\d가-힣A-Za-z.]))/g

/** 순서가 중요하다 — 주민번호·연락처를 긴 숫자열보다 먼저 지운다 */
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '(연락처 삭제)'],
  [/\b\d{2,3}[-.\s]\d{3,4}[-.\s]\d{4}\b/g, '(연락처 삭제)'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '(이메일 삭제)'],
  [/(?:https?:\/\/|www\.)\S+/g, '(링크 삭제)'],
  [/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '(식별번호 삭제)'],
  // 구분자는 하이픈만 — 띄어 쓴 치수 목록("245 250 255 260")·날짜는 지우지 않는다
  [/\d(?:-?\d){9,}/g, '(번호 삭제)'],
  [ADDRESS_RE, '(주소 삭제)'],
  [DISTRICT_ADDRESS_RE, '(주소 삭제)'],
  [/\d{1,4}\s*동\s*\d{1,4}\s*호/g, '(주소 삭제)'],
]

const NORMALIZE_RE = /[\s.,!?~…'"‘’“”·]+/g
const DELETED_MARK_RE = /\([^)]*삭제\)/g

export function normalizeReviewText(text: string): string {
  return (text ?? '').replace(NORMALIZE_RE, '').toLowerCase()
}

export function scrubPii(text: string): string {
  let out = text ?? ''
  for (const [pattern, replacement] of PII_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

const CORP_MARK_RE = /\(주\)|㈜|주식회사|\(유\)|유한회사/g
const LATIN_LEAD_RE = /^[A-Za-z][\w&'.-]*(?:\s+[A-Za-z][\w&'.-]*)*/
/** 영문 약어(USB·LED·LCD 등 대문자·숫자 4자 이하 한 낱말)는 브랜드가 아니라 상품 속성으로 본다 */
const ACRONYM_RE = /^[A-Z0-9]{1,4}$/

/**
 * 경쟁사 이름 — strip은 본문·제목에서 지울 이름, check는 분석 산출 검사(재현 가드 ①)에 쓸 이름.
 * - 판매자명(원문, 법인 표기를 뗀 이름)·상품명 전체(상품옵션명 첫 쉼표 앞, 앞 [꼬리표] 뗌)·영문 브랜드 앞머리 → 둘 다.
 * - 한글 첫 낱말 앞머리(대개 브랜드지만 "무선"·"스텐" 같은 일반어일 수 있다) → strip만. 산출 검사에 넣으면
 *   상품 핵심 속성에 대한 정상 불만 유형("무선 연결 끊김")이 탈락한다.
 * - 영문 약어 앞머리(USB·LED) → 어디에도 넣지 않는다. 두 글자 미만은 버린다. 긴 이름부터 지우도록 정렬한다.
 */
export function competitorNames(sellers: string[], productTitles: string[] = []): { strip: string[]; check: string[] } {
  const strip = new Set<string>()
  const check = new Set<string>()
  const add = (v: string, toCheck: boolean) => {
    const t = v.trim()
    if (t.length < 2) return
    strip.add(t)
    if (toCheck) check.add(t)
  }
  for (const seller of sellers) {
    add(seller, true)
    add(seller.replace(CORP_MARK_RE, ''), true)
  }
  for (const raw of productTitles) {
    const title = raw.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim()
    if (title.length >= 4) add(title, true)
    const latin = title.match(LATIN_LEAD_RE)?.[0]
    if (latin) {
      if (!ACRONYM_RE.test(latin)) add(latin, true)
      continue
    }
    const lead = title.split(/\s+/)[0] ?? ''
    if (!/^[\d+]/.test(lead)) add(lead, false)
  }
  const byLength = (a: string, b: string) => b.length - a.length
  return { strip: [...strip].sort(byLength), check: [...check].sort(byLength) }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 두 글자 이하 이름은 앞이 글자가 아닐 때만 맞춘다("플라스틱" 속 "라스" 같은 일반어 오탐 방지) */
function nameRegex(name: string): RegExp {
  const body = escapeRegExp(name)
  return new RegExp(name.length <= 2 ? `(?<![가-힣A-Za-z0-9])${body}` : body, 'gi')
}

export function stripNames(text: string, names: string[]): string {
  let out = text ?? ''
  for (const name of names) out = out.replace(nameRegex(name), '(상호 삭제)')
  return out
}

export function containsName(text: string, names: string[]): boolean {
  return names.some((name) => nameRegex(name).test(text ?? ''))
}

/**
 * 정제: 개인정보 지움 → (경쟁사) 판매자명·상품명 지움 → 개인정보만 남은 행·중복 버림. 표집 전에 부른다.
 * 반환 dropped는 버린 행 수다.
 */
export function sanitizeReviews(
  reviews: ParsedReview[],
  options: { removeNames?: string[] } = {}
): { reviews: ParsedReview[]; dropped: number } {
  const names = options.removeNames ?? []
  const seen = new Set<string>()
  const kept: ParsedReview[] = []
  let dropped = 0
  for (const r of reviews) {
    const body = stripNames(scrubPii(r.body), names)
    if (normalizeReviewText(body.replace(DELETED_MARK_RE, '')).length < 5) {
      dropped += 1
      continue
    }
    const key = normalizeReviewText(body)
    if (seen.has(key)) {
      dropped += 1
      continue
    }
    seen.add(key)
    kept.push({
      ...r,
      body,
      title: stripNames(scrubPii(r.title), names),
      option: stripNames(scrubPii(r.option), names),
    })
  }
  return { reviews: kept, dropped }
}
