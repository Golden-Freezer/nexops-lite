// 글자 수 상한 자르기 — 상한은 지금처럼 UTF-16 단위로 세되, 서로게이트 쌍(이모지 등) 가운데에서 끊기면 한 단위 앞에서 자른다.
// 직접 API로 들어온 입력도 깨진 글자 없이 저장·프롬프트에 들어가게 한다(화면은 같은 규칙으로 막는다). 순수 함수.
// 짝 없는 서로게이트(이미 깨진 입력)는 지운다. 정상 입력은 바뀌지 않는다.

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** 짝 없는 서로게이트만 지운다(이모지 반쪽 등) */
export function dropLoneSurrogates(text: string): string {
  return text.replace(LONE_SURROGATE_RE, '')
}

/** 앞에서 max 단위까지 자른다. 마지막 단위가 상위 서로게이트면 그 쌍을 통째로 뺀다 */
export function clipUtf16(text: string, max: number): string {
  const clean = dropLoneSurrogates(text)
  if (clean.length <= max) return clean
  if (max <= 0) return ''
  const last = clean.charCodeAt(max - 1)
  return clean.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}
