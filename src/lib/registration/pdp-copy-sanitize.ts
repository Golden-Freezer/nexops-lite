/**
 * PDP 카피라이팅 금지 표현 정화 + empathyLines/empathyDeepLines 검증 — pdp-copy-rules.ts에서
 * 분리(500줄 초과 방지, CLAUDE.md 모듈화 규칙). NEXFIT agents/copywriting_agent.py
 * :166-246(_check_banned_expressions·_sanitize_text·_sanitize_copy_data), :278-326
 * (_build_empathy_fallbacks), :1259-1357(empathyLines/empathyDeepLines 검증) 이식.
 * LLM 호출 없음 — pdp-copy-agent.ts가 순서대로 적용한다.
 */

import { BANNED_EXPRESSIONS, OTHER_PRODUCT_REPLACEMENTS } from '@/lib/agents/registration/prompts/pdp-copy-prompts'
import type { CopywritingResult } from './pdp-state'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 금지 표현 정화 — copywriting_agent.py:166-246
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 자연스러운 대체어 매핑 — copywriting_agent.py:177-205. 순서 중요(긴 패턴을 짧은 패턴보다 먼저 매칭). */
const SANITIZE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['혁신적인', '새로운'],
  ['궁극적인', '최상의'],
  ['게임 체인저', '효과적인 대안'],
  ['게임체인저', '효과적인 대안'],
  ['완벽한 솔루션', '실용적인 해결책'],
  ['프리미엄 라이프스타일', '편리한 일상'],
  ['스마트한 선택', '현명한 선택'],
  ['새로운 차원', '더 나은 경험'],
  ['한 차원 높은', '한층 나아진'],
  ['당신의 일상을 바꿔드립니다', '일상이 편리해집니다'],
  ['사은품 포장에 탄탄함까지 원하는 셀러', '사은품 포장에 탄탄함까지 원하는 분'],
  ['마케팅 전략', '활용 전략'],
  ['셀러', '소비자'],
  ['판매자', '고객'],
  ['마진', '가성비'],
  ['판매량', '인기'],
  ['매출', '만족도'],
  ['소싱', '엄선'],
  ['도매', '대량'],
  ['위탁', '위임'],
  ['수익률', '효율'],
  ['수익', '만족'],
  ['공급가', '합리적 가격'],
  ['객단가', '구매 금액'],
  ['전환율', '만족률'],
  ['입점', '입문'],
  // 오너 지시 11-01 — 비교 상대 표기, 고민 섹션 문구
  ...OTHER_PRODUCT_REPLACEMENTS,
  ['이런 고민', '고민'],
  ['이런고민', '고민'],
]

/** dict 키·브랜드명 등 고유명사 필드는 정화 대상에서 제외 — copywriting_agent.py:211-214 */
const SANITIZE_SKIP_FIELDS = new Set(['brandAndName', 'brand', 'author', 'cert_badges_text', 'model_used'])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 텍스트에서 발견된 금지 표현 목록 반환(대소문자 무시) — copywriting_agent.py:166-173 */
export function checkBannedExpressions(text: string): string[] {
  const lower = text.toLowerCase()
  return BANNED_EXPRESSIONS.filter((expr) => lower.includes(expr.toLowerCase()))
}

function sanitizeText(text: string): string {
  let result = text
  for (const [banned, replacement] of SANITIZE_REPLACEMENTS) {
    result = result.replace(new RegExp(escapeRegExp(banned), 'gi'), replacement)
  }
  return result
}

/**
 * 값 필드 단위 금지 표현 정화 — copywriting_agent.py:216-246 1:1.
 * dict 키는 치환 대상에서 제외(JSON 구조 훼손 방지), SANITIZE_SKIP_FIELDS는 원문 보존.
 * 반환: [정화된 데이터, 발견된 금지 표현 목록]
 */
export function sanitizeCopyData(data: unknown, field?: string): [unknown, string[]] {
  const found: string[] = []
  if (typeof data === 'string') {
    if (field && SANITIZE_SKIP_FIELDS.has(field)) return [data, found]
    const hits = checkBannedExpressions(data)
    if (hits.length > 0) {
      found.push(...hits)
      return [sanitizeText(data), found]
    }
    return [data, found]
  }
  if (Array.isArray(data)) {
    const out: unknown[] = []
    for (const item of data) {
      const [cleaned, f] = sanitizeCopyData(item, field)
      out.push(cleaned)
      found.push(...f)
    }
    return [out, found]
  }
  if (isPlainObject(data)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      const [cleaned, f] = sanitizeCopyData(v, k)
      out[k] = cleaned
      found.push(...f)
    }
    return [out, found]
  }
  return [data, found]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// empathyLines·empathyDeepLines 검증 — copywriting_agent.py:278-326, 1259-1357
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const EMPATHY_PLACEHOLDERS = ['고민 1', '고민 2', '고민 3', '고민 4', '고민1', '고민2', '고민3', '고민4']
const EMPATHY_DEEP_PLACEHOLDERS = ['감정 1', '감정 2', '감정 3', '감정 4', '심화 1', '심화 2', '심화 3', '심화 4']

function stripPlaceholderLines(lines: unknown, placeholders: string[]): string[] {
  if (!Array.isArray(lines)) return []
  return lines.filter(
    (l): l is string => typeof l === 'string' && l.trim().length > 0 && !placeholders.some((ph) => l.includes(ph)),
  )
}

/**
 * 말풍선 한 줄 상한(앞뒤 따옴표를 뺀 글자 수) — 디자인 컷 T2가 받는 길이(designcut-plan BUBBLE_MAX_CHARS)와 같다.
 * 옛 말풍선(PROBLEM·PROBLEM_EMPATHY)은 줄 수대로 높이가 늘어 이 길이도 그린다.
 */
export const EMPATHY_LINE_MAX_CHARS = 28

const WRAP_QUOTES = /^['"“”‘’「『]+|['"“”‘’」』]+$/g
const lineChars = (line: string) => [...line.replace(WRAP_QUOTES, '').trim()].length

/** 글자 수로 자르면 문장이 끊긴다(R15 P10) — 상한을 넘는 줄은 버리고 폴백이 채운다. 같은 줄은 하나만 남긴다 */
function keepFittingLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (lineChars(line) > EMPATHY_LINE_MAX_CHARS || seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** problem.empathy 텍스트 분할 → question 변환 → product/category 기반 동적 생성 — copywriting_agent.py:278-326 */
function buildEmpathyFallbacks(
  problem: { question?: string; empathy?: string },
  productName: string,
  category: string,
): string[] {
  const fallbacks: string[] = []

  const empathyText = problem.empathy ?? ''
  if (empathyText) {
    for (const sep of [',', '.', '·', '/', '\n']) {
      if (empathyText.includes(sep)) {
        fallbacks.push(
          ...empathyText
            .split(sep)
            .map((p) => p.trim())
            .filter((p) => p.length >= 4),
        )
        break
      }
    }
  }

  const question = problem.question ?? ''
  if (question.length >= 6) {
    const qClean = question.replace(/\?+$/, '').trim()
    if (qClean.length <= 15) fallbacks.push(qClean)
  }

  const namePart = productName ? productName.slice(0, 8) : '상품'
  const catPart = category ? category.slice(0, 8) : '일상'
  fallbacks.push(
    `${namePart} 고민 있으셨죠`,
    `${catPart} 선택 어려우셨죠`,
    `더 나은 ${catPart} 필요했어요`,
    `${namePart} 비교하느라 지쳤죠`,
  )

  return keepFittingLines(fallbacks)
}

/**
 * problem.empathyLines/empathyDeepLines 검증·폴백 채움 — copywriting_agent.py:1259-1357 1:1.
 * 반환: 갱신된 problem 객체(copy에 병합은 호출부 책임).
 */
export function validateEmpathyLines(
  copy: CopywritingResult,
  productName: string,
  category: string,
): NonNullable<CopywritingResult['problem']> {
  const problem = copy.problem ?? {}

  let lines = keepFittingLines(stripPlaceholderLines(problem.empathyLines, EMPATHY_PLACEHOLDERS))
  if (lines.length < 4) {
    for (const candidate of buildEmpathyFallbacks(problem, productName, category)) {
      if (lines.length >= 4) break
      if (!lines.includes(candidate)) lines.push(candidate)
    }
  }
  if (lines.length < 3) {
    const shortName = productName ? productName.slice(0, 8) : '제품'
    const emergency = [
      `${shortName} 준비가 번거로웠어요`,
      '더 간편한 방법이 있었으면 좋겠어요',
      '시간도 아끼고 예쁘게 하고 싶어요',
    ]
    for (const ef of emergency) {
      if (lines.length >= 3) break
      if (!lines.includes(ef)) lines.push(ef)
    }
  }
  lines = lines.slice(0, 4)

  const existingEmpathy = new Set(lines)
  let deepLines = keepFittingLines(stripPlaceholderLines(problem.empathyDeepLines, EMPATHY_DEEP_PLACEHOLDERS)).filter(
    (l) => !existingEmpathy.has(l),
  )
  if (deepLines.length < 4) {
    const shortName = productName ? productName.slice(0, 8) : '제품'
    const deepFallbacks = [
      `${shortName} 쓸 때마다 한숨이 나요`,
      '또 실패할까 봐 걱정돼요',
      '나만 이런 건가 싶어요',
      '포기하고 싶을 때가 많아요',
      '스트레스가 쌓여만 가요',
      '자신감이 점점 떨어져요',
    ]
    for (const fb of deepFallbacks) {
      if (deepLines.length >= 4) break
      if (!deepLines.includes(fb) && !existingEmpathy.has(fb)) deepLines.push(fb)
    }
  }
  deepLines = deepLines.slice(0, 4)

  return { ...problem, empathyLines: lines, empathyDeepLines: deepLines }
}
