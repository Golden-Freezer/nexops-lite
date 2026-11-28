/**
 * 새 단계 ④ 첫 화면 심사(하네스 R10a) — compose 뒤 done 전, 모바일 상세페이지 첫 화면(860px 폭 페이지의 위 1860px 캡처)을 비전 모델이 보고
 * 3초 안에 '무엇인지'와 '왜 갖고 싶은지'가 보이는지 판정한다. 기록+경고만(고치지 않는다). 결과 키 section_plan.first_screen.
 * 웹 잡은 운영 렌더러가 없어 캡처를 만들 수 없다 → '생략'(web_no_renderer)으로 기록한다(I4-4 11). 캡처는 Railway 렌더 실행기만 만든다.
 * 아직 어디서도 부르지 않는다. 프롬프트는 A 비전 실측 4차 시제품(model-eval/lib/tasks.mjs FS_SYSTEM·FS_PROMPT) 그대로다.
 */

import {
  parseStrictJsonObject,
  reqBoolean,
  reqString,
  runNewStageCall,
  skippedRecord,
  type NewStageCallOptions,
  type NewStageDeps,
  type NewStageRecord,
} from './common'

export const FS_SYSTEM = 'You are a meticulous e-commerce page reviewer. Respond only with the requested JSON.'
export const FS_PROMPT =
  'This image is the first screen of a Korean mobile product detail page: the top 1860px of an 860px-wide page, which is what a shopper sees before scrolling. ' +
  'Decide whether a shopper can tell within 3 seconds WHAT the product is and WHY they would want it. ' +
  'Respond only with JSON: {"what_clear": true|false, "what": "...", "why_clear": true|false, "why": "...", "pass": true|false, "fix": "one short instruction when pass is false, otherwise empty"}. ' +
  'pass is true only when both what_clear and why_clear are true.'

/** 첫 화면 캡처 — base64(접두어 없음) */
export interface FirstScreenCapture {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
}

export interface FirstScreenVerdict {
  what_clear: boolean
  what: string
  why_clear: boolean
  why: string
  pass: boolean
  /** 고칠 곳 한 줄 — 기록만 한다 */
  fix: string
}

export function parseFirstScreen(text: string): FirstScreenVerdict {
  const o = parseStrictJsonObject(text)
  return {
    what_clear: reqBoolean(o, 'what_clear', '$'),
    what: reqString(o, 'what', '$'),
    why_clear: reqBoolean(o, 'why_clear', '$'),
    why: reqString(o, 'why', '$'),
    pass: reqBoolean(o, 'pass', '$'),
    fix: reqString(o, 'fix', '$'),
  }
}

/** 경고 — 불합격(무엇·왜 중 어느 쪽)과 답의 모순(pass가 두 판정과 다름·불합격인데 고칠 곳 없음) */
export function checkFirstScreen(verdict: FirstScreenVerdict): string[] {
  const warnings: string[] = []
  if (!verdict.pass) {
    const missing = [!verdict.what_clear ? '무엇인지' : null, !verdict.why_clear ? '왜 갖고 싶은지' : null].filter(Boolean).join('·')
    warnings.push(`첫 화면 심사 불합격${missing ? `(${missing} 안 보임)` : ''}${verdict.fix.trim() ? ` — ${verdict.fix.trim()}` : ''}`)
  }
  if (verdict.pass !== (verdict.what_clear && verdict.why_clear)) warnings.push('pass가 what_clear·why_clear 판정과 다름')
  if (!verdict.pass && !verdict.fix.trim()) warnings.push('불합격인데 고칠 곳(fix)이 비어 있음')
  return warnings
}

/** 웹 잡 기록 — 운영 렌더러가 없어 부르지 않는다 */
export function firstScreenSkippedForWeb(): NewStageRecord<FirstScreenVerdict> {
  return skippedRecord('firstScreen', 'web_no_renderer')
}

/** 캡처가 없으면(웹 잡) 부르지 않고 생략(web_no_renderer)으로 기록한다 */
export async function runFirstScreen(
  capture: FirstScreenCapture | null,
  deps: NewStageDeps,
  options: NewStageCallOptions,
): Promise<NewStageRecord<FirstScreenVerdict>> {
  if (!capture) return firstScreenSkippedForWeb()
  return runNewStageCall(
    {
      stage: 'firstScreen',
      system: FS_SYSTEM,
      content: [
        { type: 'image', source: { type: 'base64', media_type: capture.mediaType, data: capture.data } },
        { type: 'text', text: FS_PROMPT },
      ],
      parse: parseFirstScreen,
      check: checkFirstScreen,
    },
    deps,
    options,
  )
}
