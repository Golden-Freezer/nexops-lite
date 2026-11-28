/**
 * 큰 POINT 문장 카드(cards, 적용 D6 P2 T2-16·T2-20) — 계획(internalized/designcut-structure pointVariant)과 편집기(templatesVariant
 * buildT3aCards)가 같은 규칙으로 설명 글을 나눈다. 순수 함수이고 새 글을 만들지 않는다
 */

/** 문장 카드는 설명이 이 범위의 문장 수일 때만 — 한 문장이면 카드가 한 장뿐이고, 많으면 섹션이 길어진다 */
export const CARD_SENTENCES = { min: 2, max: 4 } as const

/**
 * 설명 글을 문장 끝에서만 나눈다 — . ! ? 뒤 띄어쓰기·줄바꿈, 그리고 문장 끝말(요·다·죠) 바로 뒤 줄바꿈(D 카피는 마침표 없이
 * '붙여요\n데코로 써요'처럼 쓴다). 글자는 그대로이고 새 글을 만들지 않는다. 그 밖의 줄바꿈은 한 문장 안 줄 나눔이라('당기면\n리본이
 * 필요 없어요') 나누지 않고 카드 안에 그대로 둔다
 */
export function cardSentences(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/(?<=[.!?])\s+|(?<=[요다죠])[ \t]*\n\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 이 설명으로 문장 카드를 그릴 수 있는지(2~4문장) */
export function fitsCards(text: string | null | undefined): boolean {
  const n = cardSentences(text).length
  return n >= CARD_SENTENCES.min && n <= CARD_SENTENCES.max
}
