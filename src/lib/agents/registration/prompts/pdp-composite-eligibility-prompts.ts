/**
 * 원본 합성 자격 판정 프롬프트(묶음 4, 12_ORIGINAL_COMPOSITE.md §2).
 * 본문은 NEXFIT agents/photo_cutout.py `_ELIGIBILITY_PROMPT` 원문 그대로다. NEXOPS 규칙은 덧붙임 블록으로만 더한다
 * (공급처 표기 — 가격·브랜드 표기 금지 규칙, 콜라주 — B 누끼 실험에서 두 방법 모두 실패한 범주).
 */

// NEXFIT agents/photo_cutout.py _ELIGIBILITY_PROMPT 원문
export const COMPOSITE_ELIGIBILITY_PROMPT =
  'You are screening a product reference photo for an image compositing pipeline.\n' +
  'Judge the attached photo on two points:\n' +
  '- has_person: true if ANY human body part is visible (hand, finger, arm, face, torso, leg). ' +
  'Even a single hand holding the product counts as true.\n' +
  '- flat_print: true if the product is a FLAT PRINTED item (sticker, label, card, poster, ' +
  'packaging film, paper) whose body is a plain light color similar to the photo background — ' +
  'such products cannot be separated from their background reliably. ' +
  'A three-dimensional object is always false.\n' +
  '- reason: one short English clause explaining the judgement.\n' +
  'Respond with ONLY JSON, no markdown: {"has_person": false, "flat_print": false, "reason": ""}'

// NEXOPS 덧붙임 — 같은 JSON에 두 키를 더한다
export const COMPOSITE_ELIGIBILITY_ADDENDUM =
  'ADDITIONAL CHECKS — add these two keys to the same JSON object:\n' +
  '- supplier_marks: true if the photo shows text, a logo, a price tag, a promotional badge (for example "1+1" or "SALE") ' +
  'or a watermark that is NOT printed on the product itself (overlaid on the photo, on the background or on a separate card). ' +
  "Print that is part of the product's own surface or packaging does not count.\n" +
  '- collage: true if the photo is made of several panels or tiles joined together (a grid, side-by-side views or inset photos).\n' +
  'Final JSON shape: {"has_person": false, "flat_print": false, "supplier_marks": false, "collage": false, "reason": ""}'

/** 공급자는 system을 늘 보낸다(빈 문자열 불가) — 판정 내용은 user 메시지의 원문·덧붙임이 정한다 */
export const COMPOSITE_ELIGIBILITY_SYSTEM = 'Follow the instructions in the user message exactly.'

export function buildCompositeEligibilityPrompt(): string {
  return `${COMPOSITE_ELIGIBILITY_PROMPT}\n\n${COMPOSITE_ELIGIBILITY_ADDENDUM}`
}
