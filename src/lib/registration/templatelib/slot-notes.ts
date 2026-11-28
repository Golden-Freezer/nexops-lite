/**
 * K 슬롯 글의 페이지 기록(적용 T1-15·T1-45, 연구 A2 7-3·7-4, A1 #12) — 같은 끝말 3연속, 세 번째 느낌표부터, 답이 되는 POINT가 없는 고민 글, POINT 제목 길이.
 * 글을 지우지 않고 고치기 콜도 부르지 않는다. 낱말을 근사로 보는 값이라 프롬프트 규칙이 먹는지 재는 기록이지 판정이 아니다. 순수·결정론.
 * 같은 말 반복(pageEchoProblems, 적용 K3)만 고치기 콜을 부른다 — 글은 지우지 않는다.
 */

import { concernKeywords, sharesWord } from '../copy-flow-check'
import { stem, WORD_RE } from '../copy-repeats'
import { sectionText, type CopySlot, type CopyValues, type SlotProblem } from './slot-copy'

export interface NoteSection {
  index: number
  section: string
  slots: readonly CopySlot[]
}

const ENDING_RUN_MAX = 2
const EXCLAIM_MAX = 2
const TITLE_SLOTS = ['headline', 'title'] as const
const CONCERN_SECTIONS: ReadonlySet<string> = new Set(['problem_raise', 'problem_empathy'])
const POINT_SECTION = 'point_div'
const CONCERN_LIST = 'pains'
const CONCERN_FIELD = 'pain'
/** 첫머리가 같은 제목 상한(적용 K3 R-K21: 같은 두 어절로 시작하는 제목이 한 페이지에 3번) — 세 번째부터 고칠 곳이다 */
const OPENING_MAX = 2

function titleOf(values: CopyValues | undefined): { slot: string; text: string } | null {
  for (const slot of TITLE_SLOTS) {
    const text = values?.[slot]
    if (typeof text === 'string' && text.trim()) return { slot, text }
  }
  return null
}

/** 제목 끝말 — 물음표와 존댓말은 낱말이 달라도 같은 끝말로 읽힌다. 그 밖은 끝 두 글자다 */
export function endingOf(title: string): string {
  const flat = title.trim()
  if (/[?？]\s*$/.test(flat)) return '질문'
  const word = flat.replace(/[\s.!…~,·]+$/, '')
  return /(?:요|니다)$/.test(word) ? '존댓말' : word.slice(-2)
}

/** 고민 글 — 목록 칸이 있으면 항목마다, 없으면 제목 하나다 */
function concernsOf(values: CopyValues | undefined): Array<{ slot: string; text: string }> {
  const list = values?.[CONCERN_LIST]
  const rows = Array.isArray(list) ? (list as Array<string | Record<string, string>>).flatMap((row) => (typeof row === 'string' ? [] : [row[CONCERN_FIELD]])) : []
  const items = rows.filter((text): text is string => Boolean(text)).map((text) => ({ slot: `${CONCERN_LIST}.${CONCERN_FIELD}`, text }))
  if (items.length > 0) return items
  const title = titleOf(values)
  return title ? [title] : []
}

/** 섹션 번호 → 기록. 고치기 콜을 부르지 않는 종류만 낸다 */
export function pageCopyNotes(sections: readonly NoteSection[], values: ReadonlyMap<number, CopyValues>): Map<number, SlotProblem[]> {
  const out = new Map<number, SlotProblem[]>()
  const add = (index: number, note: SlotProblem) => out.set(index, [...(out.get(index) ?? []), note])

  let last = ''
  let run = 0
  let exclaims = 0
  for (const { index, slots } of sections) {
    const value = values.get(index)
    const title = titleOf(value)
    if (title) {
      const ending = endingOf(title.text)
      run = ending && ending === last ? run + 1 : 1
      last = ending
      if (run > ENDING_RUN_MAX) add(index, { slot: title.slot, kind: 'ending', detail: `'${ending}' 끝말 ${run}섹션 연속` })
    }
    const before = exclaims
    exclaims += (sectionText(slots, value ?? {}).match(/[!！]/g) ?? []).length
    if (exclaims > EXCLAIM_MAX && exclaims > before) add(index, { slot: '섹션 전체', kind: 'exclaim', detail: `느낌표 ${exclaims}번째(상한 ${EXCLAIM_MAX}번)` })
  }

  const pointText = sections
    .filter((section) => section.section === POINT_SECTION)
    .map((section) => sectionText(section.slots, values.get(section.index) ?? {}))
    .join(' ')
  for (const section of sections) {
    if (!CONCERN_SECTIONS.has(section.section)) continue
    for (const { slot, text } of concernsOf(values.get(section.index))) {
      const keywords = concernKeywords(text)
      if (keywords.length > 0 && !sharesWord(keywords, pointText)) add(section.index, { slot, kind: 'pair', detail: text })
    }
  }
  return out
}

/** 제목 첫머리 — 첫 두 어절. 셀 때는 끝 조사를 뗀 꼴로 본다. 어절이 하나뿐이면 첫머리가 곧 제목이라 없다 */
export function openingOf(title: string): { key: string; shown: string } | null {
  const [first, second] = title.match(WORD_RE) ?? []
  return first && second ? { key: `${stem(first)} ${stem(second)}`, shown: `${first} ${second}` } : null
}

/** 제목의 어절 짝(끝 조사를 뗀 꼴 → 원래 꼴) — 숫자만인 어절과 빼는 낱말(옵션 값·브랜드, copy-repeats와 같은 셈)이 든 짝은 세지 않는다 */
function wordPairs(title: string, excluded: readonly string[]): Map<string, string> {
  const skip = (word: string) => /^\d+$/.test(word) || excluded.some((term) => word === term || (term.length >= 2 && word.startsWith(term)))
  const words = title.match(WORD_RE) ?? []
  const out = new Map<string, string>()
  for (let i = 0; i + 1 < words.length; i++) {
    if (!skip(words[i]) && !skip(words[i + 1])) out.set(`${stem(words[i])} ${stem(words[i + 1])}`, `${words[i]} ${words[i + 1]}`)
  }
  return out
}

/**
 * 같은 말 반복(적용 K3 R-K20·R-K21) — 첫머리(두 어절)가 같은 제목은 페이지에서 세 번째부터, POINT 제목이 앞 POINT 제목과 같은 어절 짝을 쓰면 뒤 POINT를 고칠 곳으로 낸다.
 * 'echo'라 고치기 콜을 부르지만 글은 지우지 않는다(같은 말은 틀린 글이 아니다). 제목 칸만 본다 — 본문은 상품 핵심 낱말이 되풀이되는 게 정상이다. 순수·결정론.
 */
export function pageEchoProblems(sections: readonly NoteSection[], values: ReadonlyMap<number, CopyValues>, excludeTerms: readonly string[] = []): Map<number, SlotProblem[]> {
  const out = new Map<number, SlotProblem[]>()
  const add = (index: number, problem: SlotProblem) => out.set(index, [...(out.get(index) ?? []), problem])
  const openings = new Map<string, number>()
  const pointPairs: Array<Map<string, string>> = []
  for (const { index, section } of sections) {
    const title = titleOf(values.get(index))
    if (!title) continue
    const opening = openingOf(title.text)
    if (opening) {
      const seen = (openings.get(opening.key) ?? 0) + 1
      openings.set(opening.key, seen)
      if (seen > OPENING_MAX) add(index, { slot: title.slot, kind: 'echo', detail: `'${opening.shown}'로 시작하는 제목 ${seen}번째(상한 ${OPENING_MAX}번) — 첫머리를 바꾼다` })
    }
    if (section !== POINT_SECTION) continue
    const pairs = wordPairs(title.text, excludeTerms)
    const shared = [...pairs.keys()].find((key) => pointPairs.some((earlier) => earlier.has(key)))
    if (shared) add(index, { slot: title.slot, kind: 'echo', detail: `앞 POINT 제목과 '${pairs.get(shared)}'가 같다 — 다른 장점·말로 쓴다` })
    pointPairs.push(pairs)
  }
  return out
}

/** POINT 제목 글자 수(공백 뺀 값) — 제목만 훑어도 효익이 보이는지 재는 기록(A2 완료 기준 중앙 8자). 점수·합격선에는 들어가지 않는다 */
export function pointTitleChars(sections: readonly NoteSection[], values: ReadonlyMap<number, CopyValues>): { count: number; medianChars: number | null } {
  const sizes = sections
    .filter((section) => section.section === POINT_SECTION)
    .flatMap((section) => {
      const title = titleOf(values.get(section.index))
      return title ? [title.text.replace(/\s+/g, '').length] : []
    })
    .sort((a, b) => a - b)
  if (sizes.length === 0) return { count: 0, medianChars: null }
  const mid = Math.floor(sizes.length / 2)
  return { count: sizes.length, medianChars: sizes.length % 2 === 1 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2 }
}
