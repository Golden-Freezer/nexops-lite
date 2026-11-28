/**
 * 상품 컷 부품 수 규칙(partsrule, 기본 off) — 구디백 컷에 끈이 하나 더 생기는 불량(재현 H6). 원인으로 본 것: 식별 카드는 멈춘 상태('knotted at bottom corners')를
 * 말하고 장면은 동작('pulling the drawstring')을 말해, 모델이 카드의 끈을 그대로 둔 채 손에 쥔 끈을 하나 더 그린다. 게이트의 부품 판정(강화)은 오탐이 많아 평가 전용이므로
 * 생성 쪽에서 막아 본다. 프롬프트에 블록 하나를 더할 뿐이고 효과는 끔·켬 측정 전까지 알 수 없다(PR 본문의 명령).
 * 한 그림 한 상태·작은 부품(오너 블라인드 메모 11-06 P05): 펼침·접힘이 있는 접이식 빗에서 두 상태를 한 그림에 섞어 덮개가 하나 더 생기고(세 갈래),
 * 작은 걸쇠가 갈고리로 커졌다 — 2.6·NB2.1 두 판 같은 꼴. 식별 카드의 상태 구분(idcardall)과 짝이다
 */

export const PARTS_RULE_BLOCK = [
  'PRODUCT PARTS (count them exactly as in the reference photo):',
  '- Show exactly the parts the reference shows — the same number of cords, straps, handles, lids, tiers and pockets. Never add a second cord, an extra strap or a spare part.',
  '- If a hand holds or pulls a part, it is the SAME part that belongs to the product (the same drawstring, the same handle), not an additional one.',
  '- Positions described in the identity card are the product at rest. When this scene moves a part, that part moves — do not also draw it in its resting position.',
  '- If the reference shows the product in more than one state (for example unfolded and folded), picture exactly one state — never both at once, and never a separate cover, case or second handle.',
  '- Small latches, pins and tips stay as small and as few as in the reference photo.',
].join('\n')

/** 상품 컷에만 붙인다 — 제품이 안 나오는 컷(effectOnly)과 플레이트에는 셀 부품이 없다 */
export function withPartsRule(prompt: string): string {
  return `${prompt}\n\n${PARTS_RULE_BLOCK}`
}
