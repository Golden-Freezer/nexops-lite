export const LOCAL_CODEX_ONLY_MESSAGE =
  '상세페이지·대표이미지 만들기는 대표님 PC에서만 됩니다. PC에서 `npm run dev`를 켜고 http://localhost:3000 에서 눌러 주세요.'

export function assertLocalCodex(env: NodeJS.ProcessEnv = process.env): void {
  if (env.VERCEL) throw new Error(LOCAL_CODEX_ONLY_MESSAGE)
}
