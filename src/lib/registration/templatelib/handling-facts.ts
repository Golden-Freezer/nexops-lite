/**
 * 실물 쓰는 법 줄(점검 고침 3, 오너 2026-11-07 00:06 승인 — 통합 점검 ⑤) — 손·착용·사용 컷에 쥐는 곳·작동면·방향·착용 위치를 알린다.
 * 재료는 판매자 입력(spec_sheet.identityNote)과 식별 카드(design_prompts.identity_card)의 쓰는 법 낱말이 든 문장뿐이다(지어내지 않는다).
 * 둘 다 없으면 null — 부르는 쪽이 줄을 빼고 기록한다. 순수 함수.
 * usefacts 잡(결정 카드 c02·J18)은 재료가 다르다 — 식별 카드 USE 줄·사용 순서 입력(없으면 카피 howTo)뿐(handlingLinesOfUseFacts, 카드 문장 안 씀).
 */

import type { UsageStep } from '../input-slots'

/** 실물 쓰는 법(오너 11-05 '빗을 반대로 쥔 빗질') — GIF 지시(motion/stage gifPromptOf)와 정지 손·몸 컷이 같은 글을 쓴다 */
export const CORRECT_USE_LINE =
  'Use the product exactly the way it is really used: the correct grip and direction, the correct working side or face, the correct way up. Never hold it backwards or upside down, never use the wrong side.'

/** 쓰는 법 낱말 — 쥐는 곳·작동면·방향·착용 위치 */
const USE_WORDS =
  /\b(handle|grip|hold|held|bristles?|teeth|tooth|blade|tip|nozzle|front|back side|top|bottom|upside|strap|wear|worn|attach|adhesive|opening|lid|cap|spout|working (?:side|face|end))\b|손잡이|쥐|잡는|잡고|솔|빗살|날 |칼날|입구|뚜껑|앞면|뒷면|위쪽|아래쪽|윗면|아랫면|착용|끈|붙이|접착|끼우|거는/i

export const HANDLING_FACTS_MAX = { sentences: 2, chars: 240 }

const sentencesOf = (text: string | null | undefined): string[] =>
  (text ?? '')
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 6)

/** 쓰는 법 문장 — 판매자 입력 먼저, 다음 식별 카드. 같은 문장은 한 번, 최대 2문장·240자. 없으면 null */
export function handlingFactsOf(identityNote: string | null | undefined, identityCard: string | null | undefined): string | null {
  const picked: string[] = []
  for (const sentence of [...sentencesOf(identityNote), ...sentencesOf(identityCard)]) {
    if (picked.length >= HANDLING_FACTS_MAX.sentences) break
    if (!USE_WORDS.test(sentence) || picked.includes(sentence)) continue
    const joined = [...picked, sentence].join(' ')
    if (joined.length > HANDLING_FACTS_MAX.chars) {
      if (picked.length === 0) picked.push(`${sentence.slice(0, HANDLING_FACTS_MAX.chars - 1)}…`)
      break
    }
    picked.push(sentence)
  }
  return picked.length > 0 ? picked.join(' ') : null
}

/** Use 줄 머리 — MS 맞추기(ms-prompt-fit)가 식별 카드와 겹친 줄을 찾을 때도 읽는다 */
export const USE_LINE_PREFIX = 'Use (from the seller note and the product photos — follow exactly): '

/** 손·몸 컷의 쓰는 법 블록 — 늘 CORRECT_USE_LINE, 재료가 있으면 Use 줄. missing이면 부르는 쪽이 기록한다 */
export function handlingLinesOf(facts: string | null): { lines: string[]; missing: boolean } {
  return { lines: [`Correct use: ${CORRECT_USE_LINE}`, ...(facts ? [`${USE_LINE_PREFIX}${facts}`] : [])], missing: !facts }
}

/** usefacts 잡 Use 줄 머리 — 재료가 식별 카드 USE 줄(사진 판독)뿐이다 */
export const USE_CARD_LINE_PREFIX = 'Use (read from the product photos — follow exactly): '
/** usefacts 잡 사용 순서 줄 머리 — 판매자 사용 순서 입력·카피 howTo는 한국어 글이라 그리지 않는 참고 글로 싣는다 */
export const USAGE_STEPS_PREFIX = 'Usage steps (reference only, never drawn as text): '
export const USAGE_STEPS_MAX_CHARS = 300

type StepText = { title?: string; description?: string }

const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * 사용 순서 한 줄 — 판매자 사용 순서 입력(usageSteps)이 있으면 그것만, 없으면 카피 howTo. '1. 제목 — 설명; 2. …', 300자를 넘는 단계부터 '…'.
 * 둘 다 없으면 null
 */
export function usageStepsLineOf(
  usageSteps: readonly UsageStep[] | null | undefined,
  howTo: ReadonlyArray<{ step?: string; description?: string }> | null | undefined
): string | null {
  const source: StepText[] = usageSteps?.length ? [...usageSteps] : (howTo ?? []).map((h) => ({ title: h.step, description: h.description }))
  const parts = source.map((s) => [clean(s.title), clean(s.description)].filter(Boolean).join(' — ')).filter(Boolean)
  let line = ''
  for (const [i, part] of parts.entries()) {
    const next = `${line ? `${line}; ` : ''}${i + 1}. ${part}`
    if (next.length > USAGE_STEPS_MAX_CHARS) {
      line = line ? `${line}; …` : `${next.slice(0, USAGE_STEPS_MAX_CHARS - 1)}…`
      break
    }
    line = next
  }
  return line || null
}

/**
 * usefacts 잡의 손·몸 컷 쓰는 법 블록 — 늘 CORRECT_USE_LINE, 재료는 식별 카드 USE 줄과 사용 순서 줄뿐(카드 문장·판매자 확정 특징은 쓰지 않는다).
 * 둘 다 없으면 missing — 부르는 쪽이 useFacts none을 기록한다
 */
export function handlingLinesOfUseFacts(
  useLine: string | null | undefined,
  usageSteps: readonly UsageStep[] | null | undefined,
  howTo: ReadonlyArray<{ step?: string; description?: string }> | null | undefined
): { lines: string[]; missing: boolean } {
  const use = clean(useLine ?? undefined)
  const steps = usageStepsLineOf(usageSteps, howTo)
  const facts = [...(use ? [`${USE_CARD_LINE_PREFIX}${use}`] : []), ...(steps ? [`${USAGE_STEPS_PREFIX}${steps}`] : [])]
  return { lines: [`Correct use: ${CORRECT_USE_LINE}`, ...facts], missing: facts.length === 0 }
}
