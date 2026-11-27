// LLM 응답 JSON 파싱 공통 유틸 — nexads agents/json_parser.py 방어 패턴 TS 포팅.
// llm-integration 스킬 규율: "순수 JSON만 출력" 프롬프트는 지켜지지 않는다고 가정하고,
// 다단계 fallback으로 추출한다. 실측 빈도순 실패 원인: ① 응답 잘림 ② 코드블록 포장
// ③ trailing comma ④ 문자열 내 리터럴 줄바꿈/제어문자.
//
// ⚠ rfind('}') 류의 끝괄호 탐색 금지 — 문자열 내부 '}'를 잘못 잡아 truncated JSON을 오염시킨다.
//   대신 findBalancedSpan()이 중첩 depth + 문자열 escape/quote를 추적해 진짜 짝을 찾는다.
// 이 모듈은 순수 JSON 추출만 담당한다. 필수 키 기본값 보장 등 후처리는 각 에이전트가 맡는다.

const CODE_BLOCK_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i
const CODE_FENCE_STRIP_RE = /```(?:json)?\s*/gi
const TRAILING_COMMA_RE = /,\s*([}\]])/g
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

/**
 * openChar로 시작하는 첫 구간을 중첩 depth + 문자열 추적으로 찾는다.
 * 문자열 리터럴 내부의 닫는 문자는 무시하고, 진짜 짝이 맞는 닫는 위치만 반환한다.
 * 끝까지 닫히지 않으면(truncated) end = -1.
 * @returns [start, end] — 둘 다 인덱스(포함). 못 찾으면 [-1, -1].
 */
export function findBalancedSpan(
  text: string,
  openChar: string,
  closeChar: string,
  fromIndex = 0,
): [number, number] {
  const start = text.indexOf(openChar, fromIndex)
  if (start === -1) return [-1, -1]

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === openChar) depth++
    else if (c === closeChar) {
      depth--
      if (depth === 0) return [start, i]
    }
  }
  return [start, -1]
}

/** JSON.parse 시도. object(비배열)만 인정, 그 외/실패는 null. */
function tryLoad(text: string): Record<string, unknown> | null {
  try {
    const result: unknown = JSON.parse(text)
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>
    }
  } catch {
    // 다음 단계로 폴백
  }
  return null
}

/** JSON.parse 시도. array만 인정, 그 외/실패는 null. */
function tryLoadArray(text: string): unknown[] | null {
  try {
    const result: unknown = JSON.parse(text)
    if (Array.isArray(result)) return result
  } catch {
    // 다음 단계로 폴백
  }
  return null
}

/**
 * LLM 응답 텍스트에서 JSON object를 다단계 방어로 추출한다.
 * 순서: 직접 파싱 → 코드블록 추출 → brace counting → 제어문자 제거 → trailing comma 수정.
 * 전 단계 실패 시 fallback(기본 null)을 반환한다 — 호출측이 실패를 구분해 재시도/복구하도록.
 */
export function parseLlmJson(
  raw: string,
  fallback: Record<string, unknown> | null = null,
): Record<string, unknown> | null {
  let text = raw.trim()

  const direct = tryLoad(text)
  if (direct !== null) return direct

  const codeMatch = CODE_BLOCK_RE.exec(text)
  if (codeMatch) {
    text = codeMatch[1].trim()
  } else if (text.includes('```')) {
    text = text.replace(CODE_FENCE_STRIP_RE, '').trim()
  }

  const [braceStart, braceEnd] = findBalancedSpan(text, '{', '}')
  if (braceEnd > braceStart && braceStart >= 0) {
    text = text.slice(braceStart, braceEnd + 1)
  }

  text = text.replace(CONTROL_CHARS_RE, '')

  const cleaned = tryLoad(text)
  if (cleaned !== null) return cleaned

  const fixed = tryLoad(text.replace(TRAILING_COMMA_RE, '$1'))
  if (fixed !== null) return fixed

  return fallback
}

/**
 * LLM 응답 텍스트에서 JSON array를 다단계 방어로 추출한다. parseLlmJson과 동일한 순서를
 * array 경계(`[`...`]`) 기준으로 적용한다 — 배열 출력 에이전트(OCR·관련성 필터 등)용.
 */
export function parseLlmJsonArray(
  raw: string,
  fallback: unknown[] | null = null,
): unknown[] | null {
  let text = raw.trim()

  const direct = tryLoadArray(text)
  if (direct !== null) return direct

  const codeMatch = CODE_BLOCK_RE.exec(text)
  if (codeMatch) {
    text = codeMatch[1].trim()
  } else if (text.includes('```')) {
    text = text.replace(CODE_FENCE_STRIP_RE, '').trim()
  }

  const [bracketStart, bracketEnd] = findBalancedSpan(text, '[', ']')
  if (bracketEnd > bracketStart && bracketStart >= 0) {
    text = text.slice(bracketStart, bracketEnd + 1)
  }

  text = text.replace(CONTROL_CHARS_RE, '')

  const cleaned = tryLoadArray(text)
  if (cleaned !== null) return cleaned

  const fixed = tryLoadArray(text.replace(TRAILING_COMMA_RE, '$1'))
  if (fixed !== null) return fixed

  return fallback
}

/**
 * 정규식으로 문자열 필드 하나만 복구한다. JSON 전체 파싱이 실패한 truncated 응답에서도
 * (예: "summary": "...") 값만 뽑아낼 때 사용. 못 찾으면 ''.
 */
export function extractStringField(raw: string, fieldName: string): string {
  const cleaned = raw.replace(CODE_FENCE_STRIP_RE, '')
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`"${escaped}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(cleaned)
  return m ? m[1] : ''
}
