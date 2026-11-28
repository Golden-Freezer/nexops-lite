/**
 * 흔한 소재(하네스 J38 — 오너 2026-11-10 05:18 J08 판 P05 메모 "둘 다 플라스틱모, ABS 같은 건 장점이 아니니 마지막 스펙 제외하고 상세페이지 설명에는
 * 표기하지 않는 것이 좋다."). ABS·PP·PE 같은 흔한 플라스틱은 장점이 아니다 — 설명 글(D 원문 카피·K 칸 글·장점 후보)에는 쓰지 않고, 맨 아래 상품 정보 표와
 * 그 요약 칸(정보 칸 사실 타일 — 스펙 요약이라 그대로, 통합 결정 4)에만 둔다. 원산지(templatelib/origin-text, R09b)와 같은 층이고 스위치 없이 운영이다(통합 결정 11-10).
 * 근거 있는 차별 소재는 막지 않는다 — 스테인리스 304·식품 등급 실리콘처럼 흔한 플라스틱이 아닌 소재, '식품 등급 PP'·'PP(BPA 프리)'처럼 등급·인증
 * 한정어가 바로 붙은 값. 순수 함수다.
 */

/** 영문 약자 — 대문자만, 앞뒤가 영문·숫자가 아닐 때(APPLE·PS4·abs 운동은 잡지 않는다) */
const ASCII_PLASTIC = /(?<![A-Za-z0-9])(?:ABS|PP|PE|PS|PVC|HDPE|LDPE)(?![A-Za-z0-9])/g
/** 한글 이름 */
const KOREAN_PLASTIC = /플라스틱|폴리프로필렌|폴리에틸렌|폴리스티렌|폴리염화비닐|합성\s*수지/g
/** 바로 앞에 붙은 등급·인증 한정어(사이 4자 안) — '식품 등급 PP', '식품용 플라스틱' */
const QUALIFIER_BEFORE = /(?:식품\s*(?:등급|용|접촉)|의료\s*(?:등급|용)|BPA\s*(?:free|프리|무첨가)|FDA|LFGB)[^·,，、/+]{0,4}$/i
/** 바로 뒤에 붙은 한정어 — 'PP(BPA 프리)', 'PP 식품 등급' */
const QUALIFIER_AFTER = /^\s*\(?\s*(?:BPA\s*(?:free|프리|무첨가)|식품\s*(?:등급|용))/i
/** 섞인 값 나누기 — '돈모(멧돼지털)·플라스틱', 'ABS+스테인리스+실리콘' */
const PART_SEPARATOR = /\s*[·,，、/+]\s*/

/** 흔한 플라스틱 낱말 위치 — 한정어가 바로 붙은 것은 뺀다 */
function commonHits(text: string): number {
  let hits = 0
  for (const re of [ASCII_PLASTIC, KOREAN_PLASTIC]) {
    for (const match of text.matchAll(re)) {
      const at = match.index ?? 0
      const before = text.slice(Math.max(0, at - 16), at)
      const after = text.slice(at + match[0].length, at + match[0].length + 16)
      if (!QUALIFIER_BEFORE.test(before) && !QUALIFIER_AFTER.test(after)) hits += 1
    }
  }
  return hits
}

/** 글이 흔한 소재를 말하는가(한정어 없이) */
export function mentionsCommonMaterial(text: string): boolean {
  return Boolean(text) && commonHits(text) > 0
}

/**
 * 섞인 소재 값에서 흔한 소재 조각만 뺀다 — '돈모(멧돼지털)·플라스틱' → '돈모(멧돼지털)', 'ABS+스테인리스+실리콘' → '스테인리스·실리콘',
 * 'ABS'·'핸들 소재 ABS' → ''. 뺀 조각이 없으면 값을 그대로 돌려준다(띄어쓰기·구분자도 그대로)
 */
export function withoutCommonMaterial(value: string): string {
  const parts = value.split(PART_SEPARATOR).filter((part) => part.trim())
  const kept = parts.filter((part) => !mentionsCommonMaterial(part))
  return kept.length === parts.length ? value : kept.join('·')
}

/**
 * K 칸 카피 콜에 넘길 사실·장점 후보에서 흔한 소재를 뺀다 — 사실은 그 조각만 빼고(남는 말이 없으면 사실째), 장점 후보는 흔한 소재를 말하면 뺀다.
 * 사실 예산·섹션 구성(factsOf·factBudget)은 그대로 센다(원산지 R09b와 같다)
 */
export function copyInputWithoutCommonMaterial(input: { facts: readonly string[]; usps: readonly string[] }): { facts: string[]; usps: string[] } {
  return {
    facts: input.facts.flatMap((fact) => {
      const kept = withoutCommonMaterial(fact)
      return kept.trim() ? [kept] : []
    }),
    usps: input.usps.filter((usp) => !mentionsCommonMaterial(usp)),
  }
}
