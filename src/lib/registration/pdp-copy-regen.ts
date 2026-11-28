/**
 * 편집기 카피 재생성(pdp-copy-regen-api, 묶음 5 API 쪽) — 요청·응답 계약과 입력 정리(순수, DB·LLM 없음).
 *
 * 즉시 처리다(NEXFIT /pdp/{id}/text/regenerate와 같다). POST가 LLM 1콜로 메인 1개 + 대안 2개를 받아 가드를 통과한 것만 돌려준다.
 * 대기열·images 단계 되돌리기는 없다 — 텍스트 한 칸이라 잡 단계를 건드리지 않는다.
 * - 서버는 copy_sections·final_html·편집기 저장본을 바꾸지 않는다. 편집기가 고른 후보를 캔버스 요소에 넣고 기존 저장 경로로 저장한다.
 * - 하나도 통과하지 못하면(rejected) 또는 모델 호출이 실패하면(failed) 이전 카피를 그대로 둔다(화면이 바꾸지 않는다).
 * - 프롬프트 덮어쓰기는 받지 않는다. 현재 카피(300자)·요청 메모(200자)는 정리해 구분자 태그 안에 데이터로만 넣는다.
 * 편집기도 이 파일을 가져다 쓴다 — 무거운 import를 두지 않는다(가드는 pdp-copy-regen-guard, 검사·흐름은 pdp-copy-regen-request).
 */

import { ProSectionType } from './editor/types/section'
import type { CopyRegenRejectReason, EditorCopyRegenRecord, SectionPlan } from './pdp-state'

export type { CopyRegenRejectReason, EditorCopyRegenRecord } from './pdp-state'

export const COPY_REGEN_TONES = ['emotional', 'functional', 'balanced'] as const
export type CopyRegenTone = (typeof COPY_REGEN_TONES)[number]

export const COPY_REGEN_TEXT_MAX_CHARS = 300
export const COPY_REGEN_NOTE_MAX_CHARS = 200
export const COPY_REGEN_ELEMENT_MAX_CHARS = 60
export const COPY_REGEN_RECORD_LIMIT = 20

const SECTION_TYPES = new Set<string>(Object.values(ProSectionType))

export type CopyRegenBlockCode = 'busy' | 'not_ready' | 'budget'

export interface CopyRegenBlock {
  code: CopyRegenBlockCode
  error: string
  /** busy일 때만 — images = 이미지 생성 중(로컬 실행기 포함), job = 그 밖의 진행 */
  busyKind?: 'images' | 'job'
}

export interface CopyRegenRequestBody {
  sectionType: ProSectionType
  /** 캔버스 요소 이름 — 역할 힌트(제목·본문 등)로만 쓴다 */
  elementName?: string
  /** 지금 화면의 텍스트(줄바꿈 \n 유지) */
  currentText: string
  tone?: CopyRegenTone
  note?: string
}

/** 상한 기준 추정 — 시도 2회(재시도 1회) × (입력 + 출력 상한) */
export interface CopyRegenEstimate {
  model: string
  billed: true
  maxUsd: number
}

export interface CopyRegenRejection {
  reason: CopyRegenRejectReason
  detail: string
}

/** POST 200 — rejected·failed는 이전 카피를 그대로 둔다 */
export interface CopyRegenResponse {
  status: EditorCopyRegenRecord['status']
  /**
   * 가드를 통과한 후보만(0~3개, 순서 = 메인·대안1·대안2). 평문이다 — 꺾쇠(<·>)가 남을 수 있으므로 편집기는 텍스트 요소의
   * content에 넣고 richContent는 비운다(richContent는 HTML로 그대로 쓰인다)
   */
  candidates: string[]
  /** 걸러진 후보의 사유(후보 원문은 돌려주지 않는다) */
  rejected: CopyRegenRejection[]
  message?: string
  costUsd: number
  /** 잡 비용·기록 저장 성공 여부 — false여도 호출 비용은 ai_usage_log에 남는다 */
  recorded: boolean
  estimate: CopyRegenEstimate
}

/** GET 200 — 쓰기 없는 사전 조회. 막히면 409 대신 blocked */
export interface CopyRegenPreviewResponse {
  sectionType: ProSectionType
  estimate: CopyRegenEstimate
  blocked: CopyRegenBlock | null
}

/** POST 409 본문 — 이미지 재생성(#174)과 같은 모양(busy면 busy: true) */
export interface CopyRegenConflictBody {
  error: string
  code: CopyRegenBlockCode
  busy?: true
  busyKind?: CopyRegenBlock['busyKind']
}

/** 태그를 닫거나 여는 글자(전각·홑화살괄호 포함) — 데이터 구분자(<current_copy>·<owner_note>)를 흉내 내지 못하게 지운다 */
const DELIMITER_RE = /[<>＜＞〈〉‹›]/g
/** 일반 공백으로 바꿀 유니코드 공백(NBSP 등) — 금지 표현 검사를 공백 모양으로 비켜 가지 못하게 */
const UNICODE_SPACE_RE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g
/** 지울 보이지 않는 글자 — 폭 없는 공백·결합 문자(소프트 하이픈·CGJ·몽골 모음 구분자·방향 표시·변이 선택자)·한글 채움 문자. 금지 표현 사이에 끼워 검사를 비켜 가지 못하게(검수 지적) */
const ZERO_WIDTH_RE =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g
/** 남은 제어 문자(줄바꿈 제외)·줄 구분 문자 → 공백 */
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g

/**
 * 카피 정리(구분자 글자는 둔다) — 줄바꿈은 \n 하나로, 유니코드 공백은 일반 공백, 폭 없는 글자는 지우고, 그 밖의 제어 문자는 공백,
 * 줄 끝 공백·빈 줄 연속은 줄인다. 가드가 모델 후보에 쓴다('3kg > 2kg'의 >는 남긴다)
 */
export function normalizeCopyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH_RE, '')
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(CONTROL_RE, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 구분자 글자를 지운다 — 현재 카피(구분자 글자를 지운 값)와 후보(그대로 둔 값)를 같은 기준으로 비교할 때도 쓴다 */
export function stripCopyDelimiters(text: string): string {
  return text.replace(DELIMITER_RE, '')
}

/** 현재 카피 정리 — normalizeCopyText + 구분자 글자 제거, 상한에서 자른다(프롬프트 데이터) */
export function sanitizeCopyRegenText(raw: string, maxChars = COPY_REGEN_TEXT_MAX_CHARS): string {
  return normalizeCopyText(stripCopyDelimiters(raw)).slice(0, maxChars).trim()
}

/** 요청 메모 — 한 줄로(공백·제어 문자는 공백 하나), 폭 없는 글자·구분자 글자를 지우고 상한에서 자른다 */
export function sanitizeCopyRegenNote(raw: string): string {
  return raw
    .replace(DELIMITER_RE, '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, COPY_REGEN_NOTE_MAX_CHARS)
    .trim()
}

/** 요소 이름은 식별자 모양(영문·숫자·밑줄·하이픈)만 프롬프트에 싣는다 — 구분자 밖 한 줄이라 문장은 받지 않는다(아니면 뺀다) */
const ELEMENT_NAME_RE = /^[A-Za-z0-9_-]+$/

type Parsed = { ok: true; value: CopyRegenRequestBody } | { ok: false; error: string }

export function parseCopyRegenRequest(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '요청 본문이 필요합니다.' }
  const { sectionType, elementName, currentText, tone, note } = raw as Record<string, unknown>
  if (typeof sectionType !== 'string' || !SECTION_TYPES.has(sectionType)) {
    return { ok: false, error: 'sectionType이 올바르지 않습니다.' }
  }
  if (elementName !== undefined && elementName !== null && typeof elementName !== 'string') {
    return { ok: false, error: 'elementName은 문자열이어야 합니다.' }
  }
  if (typeof elementName === 'string' && elementName.length > COPY_REGEN_ELEMENT_MAX_CHARS) {
    return { ok: false, error: `elementName은 ${COPY_REGEN_ELEMENT_MAX_CHARS}자 이하여야 합니다.` }
  }
  if (typeof currentText !== 'string') return { ok: false, error: 'currentText가 필요합니다.' }
  if (currentText.length > COPY_REGEN_TEXT_MAX_CHARS) {
    return { ok: false, error: `currentText는 ${COPY_REGEN_TEXT_MAX_CHARS}자 이하여야 합니다.` }
  }
  const cleanText = sanitizeCopyRegenText(currentText)
  if (!cleanText) return { ok: false, error: 'currentText가 필요합니다.' }
  if (tone !== undefined && tone !== null && tone !== '' && !COPY_REGEN_TONES.includes(tone as CopyRegenTone)) {
    return { ok: false, error: `tone은 ${COPY_REGEN_TONES.join(', ')} 중 하나여야 합니다.` }
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return { ok: false, error: 'note는 문자열이어야 합니다.' }
  }
  const cleanName =
    typeof elementName === 'string' && ELEMENT_NAME_RE.test(elementName.trim()) ? elementName.trim() : ''
  const cleanNote = typeof note === 'string' ? sanitizeCopyRegenNote(note) : ''
  return {
    ok: true,
    value: {
      sectionType: sectionType as ProSectionType,
      ...(cleanName ? { elementName: cleanName } : {}),
      currentText: cleanText,
      ...(tone ? { tone: tone as CopyRegenTone } : {}),
      ...(cleanNote ? { note: cleanNote } : {}),
    },
  }
}

/** 사전 조회(GET) — sectionType만 본다. 추정은 요소 이름·텍스트·메모 상한을 가정한다(텍스트를 주소에 싣지 않는다) */
export function parseCopyRegenPreview(raw: { sectionType?: string | null }): Parsed {
  const sectionType = raw.sectionType ?? ''
  if (!SECTION_TYPES.has(sectionType)) return { ok: false, error: 'sectionType이 올바르지 않습니다.' }
  return {
    ok: true,
    value: {
      sectionType: sectionType as ProSectionType,
      elementName: 'e'.repeat(COPY_REGEN_ELEMENT_MAX_CHARS),
      currentText: '가'.repeat(COPY_REGEN_TEXT_MAX_CHARS),
      note: '가'.repeat(COPY_REGEN_NOTE_MAX_CHARS),
    },
  }
}

/** 기록 덧붙임 — 최근 COPY_REGEN_RECORD_LIMIT건만 남긴다(나머지 계획 기록은 그대로) */
export function appendCopyRegenRecord(plan: SectionPlan, record: EditorCopyRegenRecord): SectionPlan {
  const records = [...(plan.editor_copy_regen ?? []), record].slice(-COPY_REGEN_RECORD_LIMIT)
  return { ...plan, editor_copy_regen: records }
}
