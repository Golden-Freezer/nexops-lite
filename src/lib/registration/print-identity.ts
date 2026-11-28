/**
 * 상품 정확성(2026-10-31, 상품 일치 불통과 P01 스티커·P07 그릇) — 상품 컷에 붙일 인쇄 도안·무늬 블록과 식별카드가 함께 볼 사진을
 * 고른다(순수). Track S·I 모두(통합 결정 — 상품 정확성은 #271과 같은 판단).
 * - 인쇄물(isTextBearingJob): 도안 규칙 — 참조 사진의 도안만, 여러 장이면 반복, 새 도안·섞기 금지. 원천이 2장 이상이면 식별카드가
 *   사진을 최대 4장까지 함께 보고 도안을 사진 순서대로 적는다
 * - 그 밖의 상품: 식별카드가 인쇄 그림·무늬를 적었을 때만 무늬 보존 줄(지울 것은 브랜드명·글자뿐)
 */

import { buildPrintedDesignsRule, PRINTED_MARKS_RULE } from '@/lib/agents/registration/prompts/pdp-image-prompts'
import { IDENTITY_CARD_ALL_MAX_PHOTOS, IDENTITY_CARD_MAX_PHOTOS } from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'

/**
 * 인쇄 그림·무늬 낱말 — 'paw print'·'decals'·'floral pattern'·'cartoon cat'·'polka dots' 등. 'printed'(소재 설명)·'design'(모양 뜻으로도
 * 쓴다)은 넣지 않는다
 */
export const PRINTED_MARK_PATTERN =
  /\b(?:decals?|prints?|patterns?|patterned|motifs?|icons?|illustrations?|illustrated|graphics?|emblems?|pictures?|drawings?|cartoons?|stripes?|striped|dots|polka)\b/i
/** 같은 구절에서 낱말 앞의 부정('no printed graphics'·'without patterns') — 무늬가 없다는 뜻이라 세지 않는다 */
const NEGATION = /\b(?:no|without|free of|lacking)\b/i
/** 브랜드 로고 구절('green leaf logo icon') — 로고는 보존 대상이 아니다(일관성 규칙 3·NO_TEXT가 지운다) */
const LOGO = /\blogos?\b/i

/** 식별카드가 인쇄 그림·무늬를 적었는지 — 쉼표·세미콜론 구절마다 본다(부정 구절·로고 구절 제외) */
export function hasPrintedMarks(card: string | null | undefined): boolean {
  if (!card) return false
  return card.split(/[,;]/).some((phrase) => {
    const m = PRINTED_MARK_PATTERN.exec(phrase)
    return m !== null && !NEGATION.test(phrase.slice(0, m.index)) && !LOGO.test(phrase)
  })
}

export function printIdentityBlock(input: {
  textBearing: boolean
  /** 상품 컷 앞에 붙는 원천 사진 수 */
  photoCount: number
  identityCard?: string | null
}): string | null {
  if (input.photoCount < 1) return null
  if (input.textBearing) return buildPrintedDesignsRule(input.photoCount)
  return hasPrintedMarks(input.identityCard) ? PRINTED_MARKS_RULE : null
}

/** 식별카드가 첫 사진과 함께 볼 나머지 원천 사진 — 인쇄물은 합쳐 최대 4장, 그 밖의 상품은 allPhotos(idcardall)일 때만 합쳐 최대 8장 */
export function identityCardOthers<T>(refs: readonly T[], textBearing: boolean, allPhotos = false): T[] {
  if (refs.length <= 1) return []
  if (textBearing) return refs.slice(1, IDENTITY_CARD_MAX_PHOTOS)
  return allPhotos ? refs.slice(1, IDENTITY_CARD_ALL_MAX_PHOTOS) : []
}
