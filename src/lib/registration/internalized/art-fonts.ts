/**
 * fontpair — D2 아트 디렉션의 제목·본문 글꼴 짝(디자인 폰트 계획 ①, 오너 지시 '폰트·컬러·배경도 깔끔하지만 트렌드에 맞게').
 * 상품 성격에 맞는 제목 글꼴 하나와 본문 Pretendard. 자체 보관 22종(public/fonts/pdp) 안에서만 고른다. 같은 상품은 늘 같은 짝(결정론).
 * - playful(아동·어린이집·답례 — palette2와 같은 판정): 둥근 디스플레이 주아(palette2 첫 화면 제목과 같은 값)
 * - premium(뷰티 카테고리, 또는 상품명·대상 줄의 선물세트 낱말): 명조 함렛. '프리미엄·고급'은 쿠팡 상품명의 흔한 검색 수식어라 보지
 *   않는다('프리미엄 강아지 배변패드'가 명조가 되지 않게 — 검수 10-31), 패션도 기능성 의류가 많아 넣지 않는다
 * - handwritten(식품이고 상품명·대상 줄에 손맛 낱말이 있을 때, 연구 A6: 식품 손글씨 20~21%): 손글씨 개구. 식품 전부에 쓰지 않는다
 * - everyday(그 밖 — 생활·기능·반려 등): 굵은 고딕 SUIT
 */

import type { DesigncutFontPair } from '../pdp-state'
import { paletteToneOf, type PaletteToneInput } from './art-palette'
import { HOOK_TYPE } from '../editor/utils/sectionConverter/designCut/tokens'

/** 짝의 제목 글꼴·굵기 — playful은 palette2 첫 화면 제목(HOOK_TYPE.playful)과 같다(굵기가 하나뿐이라 400) */
export const FONT_PAIRS: Record<DesigncutFontPair['tone'], { heading: string; weight: number }> = {
  playful: { heading: HOOK_TYPE.playful.fontFamily, weight: HOOK_TYPE.playful.weight },
  premium: { heading: 'Hahmlet', weight: 700 },
  handwritten: { heading: 'Gaegu', weight: 400 },
  everyday: { heading: 'SUIT Variable', weight: 800 },
}

/** 프리미엄 카테고리(분석 감지 카테고리 키) */
const PREMIUM_CATEGORIES = new Set(['beauty'])
/** 프리미엄 낱말(선물세트) — 상품명·대상 줄·카테고리에서 찾는다 */
const PREMIUM_TERMS = /선물\s?세트|기프트\s?세트/
/** 식품 카테고리 값 — 분석 감지 키와 화면 직접 입력 */
const FOOD_CATEGORIES = new Set(['food', '식품'])
/** 손맛 낱말 */
const HAND_TERMS = /수제|손맛|핸드\s?메이드|집밥|손수|직접\s?(?:빚|만든|담근)/

/** 짝 기록 — 판정 순서: playful(palette2와 같은 판정) → premium(카테고리·낱말) → handwritten(식품 + 손맛 낱말) → everyday */
export function buildFontPair(analysis: unknown, spec: PaletteToneInput | null | undefined): DesigncutFontPair {
  const tone = paletteToneOf(analysis, spec)
  if (tone.tone === 'playful') return { tone: 'playful', basis: tone.basis, ...FONT_PAIRS.playful, body: 'Pretendard' }
  const detected = (analysis as { detected_category?: unknown } | null | undefined)?.detected_category
  if (typeof detected === 'string' && PREMIUM_CATEGORIES.has(detected))
    return { tone: 'premium', basis: 'category', ...FONT_PAIRS.premium, body: 'Pretendard' }
  const text = [spec?.productName, spec?.targetPersona, spec?.category].filter(Boolean).join('\n')
  if (PREMIUM_TERMS.test(text)) return { tone: 'premium', basis: 'premium_terms', ...FONT_PAIRS.premium, body: 'Pretendard' }
  const isFood = FOOD_CATEGORIES.has(String(detected ?? '')) || FOOD_CATEGORIES.has(String(spec?.category ?? ''))
  if (isFood && HAND_TERMS.test(text)) return { tone: 'handwritten', basis: 'hand_terms', ...FONT_PAIRS.handwritten, body: 'Pretendard' }
  return { tone: 'everyday', basis: 'default', ...FONT_PAIRS.everyday, body: 'Pretendard' }
}
