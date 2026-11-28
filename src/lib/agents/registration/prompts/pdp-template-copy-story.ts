/**
 * K 칸 카피·섹션 구성 프롬프트에 붙는 기획 1장(pageplan, 결정 카드 c10)·원문 카피(copystory, J36) 블록 — 하네스 J28.
 * 입력 칸이 없으면 모두 빈 글이라 꺼진 잡의 프롬프트는 바이트까지 같다. 기획·원문 글은 앞 단계 모델 글이라 사실 근거로 쓰지 않는다고 적는다
 */

/** 칸 카피 콜의 기획 1장 — 섹션 번호마다 할 말(says)은 섹션 설명 뒤 한 줄로 붙는다 */
export interface SlotCopyPlan {
  promise: string
  target: string
  hookPromise: string
  says: Readonly<Record<number, string>>
}

/** 원문 카피 줄 — 섹션 번호마다 앞 단계 카피 줄 */
export type SlotCopyStory = Readonly<Record<number, readonly string[]>>

/** '## 상품' 뒤에 붙는 기획 1장 블록 */
export function planBlock(plan: SlotCopyPlan | undefined): string {
  if (!plan) return ''
  const rows = [
    plan.promise ? `- 핵심 약속: ${plan.promise}` : '',
    plan.target ? `- 고객·상황: ${plan.target}` : '',
    plan.hookPromise ? `- 첫 화면 약속: ${plan.hookPromise}` : '',
  ].filter(Boolean)
  const said = Object.keys(plan.says).length > 0
  if (rows.length === 0 && !said) return ''
  return `

## 기획 1장(앞 단계가 정한 이 페이지의 약속과 설득 순서 — 칸 글은 이 약속을 이어 간다. 기획 글은 사실 근거가 아니어서 수치·소재·인증은 아래 사실 목록에서만 쓴다)
${[...rows, ...(said ? ["- 섹션마다 '기획:' 줄은 그 섹션이 할 말이다. 그 말을 칸 글로 옮기되 칸 상한을 지킨다."] : [])].join('\n')}`
}

/** '## 상품' 뒤에 붙는 원문 카피 규칙 블록 — 섹션마다 '원문:' 줄이 있을 때만 */
export function storyBlock(story: SlotCopyStory | undefined): string {
  if (!story || Object.keys(story).length === 0) return ''
  return `

## 원문 카피(앞 단계에서 같은 상품으로 쓴 상세페이지 글 — 섹션마다 '원문:' 줄로 붙는다)
- 칸 글은 원문을 새로 쓰지 말고 원문의 이야기 흐름·말투·쓰는 장면을 칸 상한 안에서 옮긴다. 섹션끼리 원문이 잇던 이야기(고민 → 해결 → 장점 → 권유)가 끊기지 않게 한다.
- 본문 칸은 원문 문장을 줄여 문장으로 옮긴다. 낱말만 늘어놓은 개조식으로 바꾸지 않는다. 제목 칸은 원문의 약속을 짧게 잇는다.
- 원문에 있어도 아래 사실 목록에 없는 수치·소재·크기·인증은 쓰지 않는다. 원문의 상품명·브랜드·다른 상품 이야기는 옮기지 않는다.`
}

/** 섹션 설명 뒤에 붙는 줄 — 기획 할 말·원문 줄 */
export function sectionExtras(index: number, plan: SlotCopyPlan | undefined, story: SlotCopyStory | undefined): string {
  const say = plan?.says[index]
  const lines = story?.[index] ?? []
  return [...(say ? [`\n  기획: ${say}`] : []), ...lines.map((line) => `\n  원문: ${line}`)].join('')
}

/** 섹션 구성 콜의 기획 설득 순서 블록 — '## 상품' 뒤에 붙는다 */
export function composePlanBlock(steps: ReadonlyArray<{ section: string; say: string }> | undefined): string {
  if (!steps || steps.length === 0) return ''
  return `

## 기획 1장 설득 순서(앞 단계 기획 — 여기 나온 섹션을 먼저 고른다. 페이지 순서는 지금처럼 코드가 맞춘다)
${steps.map((step, i) => `${i + 1}. ${step.section}: ${step.say}`).join('\n')}`
}
