/**
 * 등록 에이전트용 JSON 추출 — 공용 parseLlmJson이 실패하면 문자열 안의 날 줄바꿈·탭을 이스케이프해 한 번 더 시도한다.
 *
 * 2026-10-27 T5 실측: design-prompt 응답(9,192토큰, end_turn)이 프롬프트 템플릿의 여러 줄 블록
 * ("PRODUCT CONSISTENCY RULES" 등)을 문자열 값에 줄바꿈째 옮겨 적어 JSON.parse가 "Bad control character"로 실패했다.
 * parseLlmJson의 제어문자 제거는 \n·\r을 일부러 남겨 두므로(문자열 밖 줄바꿈은 정상) 이 경우를 받지 못한다.
 * 공용 파서(json-parser.ts)로 옮기는 것은 후속 — 여기서는 등록 에이전트만 쓴다.
 */

import { parseLlmJson } from '../json-parser'

/** JSON 문자열 리터럴 안의 날 줄바꿈·캐리지리턴·탭만 이스케이프한다. 문자열 밖은 그대로 둔다. */
export function escapeRawControlsInStrings(text: string): string {
  let out = ''
  let inString = false
  let escape = false
  for (const c of text) {
    if (escape) {
      escape = false
      out += c
      continue
    }
    if (inString && c === '\\') {
      escape = true
      out += c
      continue
    }
    if (c === '"') {
      inString = !inString
      out += c
      continue
    }
    if (inString && c === '\n') out += '\\n'
    else if (inString && c === '\r') out += '\\r'
    else if (inString && c === '\t') out += '\\t'
    else out += c
  }
  return out
}

export function parseRegistrationJson(text: string): Record<string, unknown> | null {
  return parseLlmJson(text) ?? parseLlmJson(escapeRawControlsInStrings(text))
}
