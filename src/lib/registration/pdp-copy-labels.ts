/**
 * 상세페이지 고정 표기(오너 지시 11-01, K·D·R 공통) — 새 카피와 저장된 카피를 같은 표기로 맞춘다.
 * 편집기 화면에서도 쓰므로 순수 함수만 둔다.
 * - 비교: 상대는 '기존 제품', 우리 쪽은 '우리 제품'. 타사 제품처럼 보이지 않게 이름은 코드가 정하고, 상대를 깎아내리는 단점 칸은 버린다.
 * - 고민 섹션: '이런 고민' 문구를 쓰지 않는다.
 */

export const COMPARE_OTHER_NAME = '기존 제품'
export const COMPARE_OURS_NAME = '우리 제품'

export interface CompareItem {
  name: string
  pros: string
}

const prosOf = (item: unknown): string => {
  if (typeof item !== 'object' || item === null) return ''
  const pros = (item as { pros?: unknown }).pros
  return typeof pros === 'string' ? pros.trim() : ''
}

/**
 * 비교 항목을 [기존 제품, 우리 제품] 두 칸으로 맞춘다. 마지막 항목이 우리 쪽이다(모델 답과 옛 3자 비교 저장본 공통).
 * 한쪽이라도 쓸 글이 없으면 비교를 그리지 않는다 — 상대 칸에 단점만 있던 저장본은 여기서 빠진다.
 */
export function normalizeCompareItems(raw: unknown): CompareItem[] {
  if (!Array.isArray(raw) || raw.length < 2) return []
  const ours = prosOf(raw[raw.length - 1])
  const other = raw.slice(0, -1).map(prosOf).find(Boolean)
  if (!ours || !other) return []
  return [
    { name: COMPARE_OTHER_NAME, pros: other },
    { name: COMPARE_OURS_NAME, pros: ours },
  ]
}

const WORRY_PHRASE = /이런\s*고민/
const WORRY_PHRASE_ALL = new RegExp(WORRY_PHRASE.source, 'g')

export const hasWorryPhrase = (text: string): boolean => WORRY_PHRASE.test(text)

/** 문장에 든 '이런 고민'을 '고민'으로 — '이런 고민 있으신가요?' → '고민 있으신가요?' */
export const withoutWorryPhrase = (text: string): string => text.replace(WORRY_PHRASE_ALL, '고민')
