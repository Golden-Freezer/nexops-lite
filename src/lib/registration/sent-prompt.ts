/**
 * 이미지 모델에 실제로 보낸 프롬프트 기록(점검 고침 0, 오너 11-07 00:1x 승인) — section_images[].prompt는 바탕 글(task.prompt)뿐이라
 * 뒤에 붙는 식별 카드·참조 역할 안내·헌장·연출·재생성 지시가 기록에 없었다(통합 점검 ⑦). 정지 컷은 generateImage에, GIF 칸은 엔진에
 * 넘긴 글 그대로를 남긴다. 길이와 sha256 앞 16자를 같이 남겨 잘림·바뀜을 대조한다. 코덱스 구독 경로의 재작성은 codexTrace가 따로 남긴다
 */
import { createHash } from 'node:crypto'

export interface SentPromptRecord {
  sentPrompt: string
  sentPromptMeta: { length: number; sha256: string }
}

/** 보낸 글 → 기록 칸. 빈 글이면 칸을 만들지 않는다(보내지 않은 컷) */
export function sentPromptRecord(prompt: string | null | undefined): SentPromptRecord | Record<string, never> {
  if (!prompt) return {}
  return { sentPrompt: prompt, sentPromptMeta: { length: prompt.length, sha256: createHash('sha256').update(prompt).digest('hex').slice(0, 16) } }
}
