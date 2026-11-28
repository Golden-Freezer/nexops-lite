/**
 * half 면(T2-42) — 섹션 위쪽 옅은 강조 면이 본문 폭 사진의 위 절반까지 내려오는 장치. D 큰 POINT half(templatesVariant buildT3aHalf)와
 * K 반 띠(templatelib engine, 적용 K7-c 4a)가 함께 쓴다. tokens만 가져오는 잎 파일이다 — K 엔진이 D 변형 파일을 가져오면 infoRows를 거쳐 순환한다
 */

import { WHITE, mix, surfaceOf, type Colors } from './tokens'

/** 짙은 띠 위 half 면 — 띠 색에 흰색을 이만큼 섞는다(머리 글자색은 띠 그대로) */
const HALF_ON_DARK = 0.1
/** 띠가 이미 tint일 때 half 면 — 띠 색에 강조색을 이만큼 섞는다 */
const HALF_ON_TINT = 0.12
/**
 * half 면 위 띠 여백 — 섹션 맨 위는 띠 색으로 둔다. layout2는 T3a를 흰 띠로 시작한다고 보고 앞 섹션 바탕(스튜디오·tint)을 고르므로,
 * 면이 맨 위에 닿으면 비슷한 색의 앞 섹션과 경계 없이 이어 붙는다(replan render 41616540457 P02)
 */
export const HALF_TOP = 48
/** half 면 요소 이름 — D·K가 같은 이름이라 편집기 리플로·모바일 판독 규칙을 함께 받는다 */
export const HALF_PLANE_NAME = 'designcut-half-plane'

type Surface = ReturnType<typeof surfaceOf>

/** half 면 색 — 짙은 띠는 흰색을, 띠가 이미 tint면 강조색을 조금 섞은 면(글자색은 띠 그대로), 아니면 tint 면. 대비는 섞은 면 색으로 잰다 */
export function halfPlaneOf(band: Surface, colors: Colors): Surface {
  const tint = surfaceOf('T', colors)
  const sameAsBand = tint.fill.toLowerCase() === band.fill.toLowerCase()
  return band.dark ? { ...band, fill: mix(band.fill, WHITE, HALF_ON_DARK) } : sameAsBand ? { ...band, fill: mix(band.fill, colors.accent, HALF_ON_TINT) } : tint
}
