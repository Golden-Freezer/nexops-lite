/**
 * 제목 강조 구절(v2 C5, PDP-DR-PLAN §1) — 제목마다 한 구절만 강조색(밝은 색상각은 형광 띠)으로 칠한다. 순수 함수.
 * 고르는 순서: ① 수량+단위('20장'·'2구' — 입력에 있는 숫자 그대로) → ② USP 낱말(페이지 POINT 제목의 낱말로 시작하는 제목 낱말,
 * 조사는 빼고 그 낱말만) → ③ 없으면 강조하지 않는다. 새 문구를 만들지 않고 제목 글자 일부에 색만 입힌다.
 */

/** 수량+단위 — 숫자 낱말만(한·두 같은 수 낱말은 강조하지 않는다). 사이 공백은 일반·줄바꿈 없는 공백 둘 다(keepCountUnits 뒤) */
const COUNT_RE =
  /(?<![\d.,])\d+(?:[.,]\d+)?[  ]?(?:개입|단계|가지|켤레|시간|세트|장|개|매|분|초|일|주|달|번|종|쌍|팩|구|입|병|롤|겹|배|회|명|마리|칸|줄|cm|mm|ml|kg|g|L|m|%)(?![A-Za-z])/
/** 낱말 경계 — 공백·문장부호·가운뎃점 */
const SPLIT_RE = /[\s ,.!?·'"“”‘’()[\]/~:;…-]+/
/** USP 낱말로 쓰지 않는 일반 낱말(어느 상품에나 나와 강조 뜻이 없다) */
const GENERIC = new Set(['구성', '사용', '정보', '제품', '상품', '선택', '가이드', '준비', '확인', '하나', '모두', '그대로'])

const words = (text: string) => text.split(SPLIT_RE).filter(Boolean)
const MIN_WORD = 2

/** 페이지 POINT 제목의 낱말 — 2자 이상, 일반 낱말 제외, 긴 것부터(겹치면 긴 낱말을 먼저 맞춘다) */
export function uspWordsOf(pointHeadlines: ReadonlyArray<string | null | undefined>): string[] {
  const set = new Set<string>()
  for (const h of pointHeadlines) {
    for (const w of words(h ?? '')) if ([...w].length >= MIN_WORD && !GENERIC.has(w) && !/^\d/.test(w)) set.add(w)
  }
  return [...set].sort((a, b) => [...b].length - [...a].length)
}

/** 제목의 강조 구절(제목 글자 그대로의 부분 문자열) — 없으면 null */
export function accentPhraseOf(headline: string, usp: readonly string[]): string | null {
  const count = COUNT_RE.exec(headline)
  if (count) return count[0]
  for (const w of words(headline)) {
    const hit = usp.find((u) => w.startsWith(u))
    if (hit) return hit
  }
  return null
}

/** 모델이 고른 강조 구절의 글자 수 — 공백을 뺀 수(연구 A2 6-1: 제목의 부분 문자열, 8자 이하). 한 글자는 강조 뜻이 없어 받지 않는다 */
export const ACCENT_MAX_CHARS = 8
const ACCENT_MIN_CHARS = 2
const bare = (s: string) => s.replace(/[\s\u00A0]+/g, '')

/**
 * 모델이 고른 강조 구절(적용 T1-17)을 받을지 — 제목 글자 그대로의 부분 문자열이고, 한 줄 안이며, 공백 뺀 2~8자이고, 제목 전체가 아니어야 한다.
 * 받으면 다듬은 구절, 아니면 null(그리는 쪽이 지금 규칙 accentPhraseOf로 돌아간다). 새 문구를 만들지 않으므로 규제 검사는 제목 글이 이미 받았다.
 */
export function acceptAccent(headline: string | null | undefined, phrase: unknown): string | null {
  if (typeof phrase !== 'string' || !headline) return null
  const p = phrase.trim()
  const chars = [...bare(p)].length
  if (chars < ACCENT_MIN_CHARS || chars > ACCENT_MAX_CHARS || /\n/.test(p)) return null
  if (!headline.includes(p) || bare(p) === bare(headline)) return null
  return p
}

/** 그릴 글(shown — keepFactUnits가 공백 일부를 줄바꿈 없는 공백으로 바꿨다)에서 구절을 찾는다. 두 공백을 같게 본다. 없으면 null */
export function phraseIn(shown: string, phrase: string | null | undefined): string | null {
  if (!phrase) return null
  const space = (s: string) => s.replace(/\u00A0/g, ' ')
  const at = space(shown).indexOf(space(phrase))
  return at === -1 ? null : shown.slice(at, at + phrase.length)
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 강조 구절을 span으로 감싼 richContent — 첫 번째 일치만. css는 'color:#…' 또는 'background-color:rgba(…)'(편집 뒤에도 남게
 * textSanitizer가 둘 다 허용한다). 구절이 글에 없으면 null
 */
export function richWithAccent(shown: string, phrase: string, css: string): string | null {
  const at = shown.indexOf(phrase)
  if (at === -1) return null
  const html = (s: string) => escapeHtml(s).replace(/\n/g, '<br>')
  return `${html(shown.slice(0, at))}<span style="${css}">${html(phrase)}</span>${html(shown.slice(at + phrase.length))}`
}
