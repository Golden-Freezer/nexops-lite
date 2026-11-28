/**
 * 컷 참조를 모델 상한에 맞춘다(R13 P01: 코덱스 이미지 도구는 5장까지 — 6장이면 12컷 중 4컷을 포기했다).
 * 원천 사진을 앞에서부터 남기고 뒤쪽을 뺀다. tailCount는 원천 사진 뒤에 붙는 참조(hero 스타일·지금 컷)로, 빼지 않는다. 앞을 남기는 이유:
 * - 프롬프트가 참조를 자리로 부른다('FIRST = 상품 실물', 'LAST = hero 스타일') — 중간을 빼야 그 말이 그대로 맞는다
 * - 원천 사진은 대표 사진이 맨 앞이다(오너 샘플 파일 이름 순, 01_ 대표)
 * - 식별 카드가 앞 4장을 함께 읽는다(IDENTITY_CARD_MAX_PHOTOS) — 스타일 참조가 있어도 원천 4장이 남아 카드와 어긋나지 않는다
 * - 옵션 사진 가드가 켜진 잡은 옵션 사진이 이미 앞이다(guardedReferences)
 */

export function fitSourceRefs<T>(sourceRefs: readonly T[], tailCount: number, max: number): { kept: T[]; dropped: number } {
  const kept = sourceRefs.slice(0, Math.max(0, max - tailCount))
  return { kept, dropped: sourceRefs.length - kept.length }
}
