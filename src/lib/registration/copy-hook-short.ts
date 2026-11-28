// 첫 화면 글 줄이기(hookshort 스위치, 오너 지시 2026-11-01 '후킹은 첫 1~3초가 중요하니 글을 많이 넣지 않는다') — D2 첫 화면에 큰 제목 2줄과
// 보조 한 줄만 둔다. 저장 15잡의 첫 화면은 공백 뺀 44~64자였고, 이 상한이면 약 24자다. 1~3초에 읽히는 글자 수는 재지 않은 설계 판단이다.
// 큰 제목이 한 줄 약 7자인 것은 첫 화면 제목 크기(HOOK_TYPE 104)에서 온다. 리듬 규칙의 한 줄 12~16자는 그보다 작은 제목 기준이라 이 칸에 맞지 않는다.
// 이 파일은 쓰기 지시와 결정론 검사만 맡는다. 첫 화면 그리기(buildT1Scene·heroText)는 따로 있다. K 라인 상한은 templatelib/slot-copy.ts.

import { hasBadBreak } from './copy-rhythm-check'
import type { CopywritingResult } from './pdp-state'

export const HOOK_SHORT = { headlineChars: 12, headlineLines: 2, headlineLineChars: 7, subChars: 12, subLines: 1 } as const

/** Stage 3가 고칠 수 있는 칸 — 첫 화면과, 빠지는 사실을 받는 POINT 카드 */
export const HOOK_SHORT_TARGETS = ['mainIntro', 'pointCards'] as const

export interface HookShortFinding {
  path: 'mainIntro.benefitHeadline' | 'mainIntro.subBenefit'
  text: string
  detail: string
}

const charCount = (text: string) => text.replace(/\s+/g, '').length
const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

export function findHookShortIssues(copy: CopywritingResult): HookShortFinding[] {
  const intro = copy.mainIntro ?? {}
  const out: HookShortFinding[] = []
  const headline = intro.benefitHeadline?.trim() ?? ''
  if (headline) {
    const lines = linesOf(headline)
    const longest = Math.max(...lines.map((line) => [...line].length))
    const add = (detail: string) => out.push({ path: 'mainIntro.benefitHeadline', text: headline, detail })
    if (charCount(headline) > HOOK_SHORT.headlineChars) add(`공백 뺀 ${charCount(headline)}자(상한 ${HOOK_SHORT.headlineChars}자)`)
    if (lines.length > HOOK_SHORT.headlineLines) add(`${lines.length}줄(상한 ${HOOK_SHORT.headlineLines}줄)`)
    if (longest > HOOK_SHORT.headlineLineChars) add(`한 줄 ${longest}자(상한 ${HOOK_SHORT.headlineLineChars}자)`)
    if (lines.length > 1 && hasBadBreak(headline)) add('줄 첫머리가 조사·어미이거나 한두 글자만 남았다')
  }
  const sub = intro.subBenefit?.trim() ?? ''
  if (sub) {
    const add = (detail: string) => out.push({ path: 'mainIntro.subBenefit', text: sub, detail })
    if (charCount(sub) > HOOK_SHORT.subChars) add(`공백 뺀 ${charCount(sub)}자(상한 ${HOOK_SHORT.subChars}자)`)
    if (linesOf(sub).length > HOOK_SHORT.subLines) add(`${linesOf(sub).length}줄(상한 ${HOOK_SHORT.subLines}줄)`)
  }
  return out
}

const RULES = [
  '이 규칙이 다른 글자 수·줄 수 규칙보다 앞선다. 첫 화면에는 benefitHeadline과 subBenefit만 나온다.',
  `benefitHeadline은 공백 뺀 ${HOOK_SHORT.headlineChars}자 안, ${HOOK_SHORT.headlineLines}줄 안, 한 줄 ${HOOK_SHORT.headlineLineChars}자 안(공백 포함)으로 쓴다. 두 줄이면 의미 단위 사이에서 \\n으로 끊는다.`,
  `subBenefit은 공백 뺀 ${HOOK_SHORT.subChars}자 안의 한 줄이다. 문장이 아니라 구절로 쓴다.`,
  'mainIntro.productType 낱말은 benefitHeadline에 먼저 넣고, 들어가지 않으면 subBenefit에 넣는다.',
  '짧아지면서 빠지는 특징·사실은 버리지 말고 pointCards[].title·description에 옮긴다. 새 사실은 만들지 않는다.',
  'hook 칸은 지우지 않는다. 다만 첫 화면에 나오지 않으니 사실이나 상품 종류 낱말을 여기에만 두지 않는다.',
]

/** Stage 2 쓰기 지시(hookshort 스위치 잡) — 사실 값 블록보다 앞에 붙는다 */
export const HOOK_SHORT_WRITE_BLOCK = ['## [첫 화면 글 줄이기 — 1~3초 안에 읽히게]', ...RULES.map((rule) => `- ${rule}`)].join('\n')

const clip = (text: string, n = 40) => (text.length > n ? `${text.slice(0, n)}…` : text).replace(/\n/g, '⏎')

/** Stage 3 '고칠 곳' 블록 — 걸린 것이 없으면 빈 문자열(프롬프트 불변) */
export function buildHookShortFixBlock(findings: readonly HookShortFinding[]): string {
  if (findings.length === 0) return ''
  return [
    '## [첫 화면 글 — 고칠 곳(결정론 검사)]',
    '이 규칙으로는 아래 칸을 고치고, 빠지는 특징·사실은 pointCards[].title·description에 옮긴다. 새 사실은 만들지 않는다. 바꾼 필드는 _changed_fields에 적는다.',
    ...RULES.slice(1, 3).map((rule) => `- ${rule}`),
    ...findings.map((f) => `- [${f.path}] '${clip(f.text)}' — ${f.detail}`),
  ].join('\n')
}
