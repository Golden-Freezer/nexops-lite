/**
 * K 라인 글꼴 짝 — 자체 보관 글꼴(public/fonts/pdp, 라이선스 OFL 확인분) 안에서 제목 글꼴 하나와 본문 Pretendard를 묶는다.
 * 시험이 fonts.css의 글꼴·굵기와 FONT_OPTIONS 라이선스를 대조한다. 본문은 판독을 위해 늘 Pretendard다(D 라인 fontpair와 같다).
 */

export const FONT_PAIR_IDS = [
  'gothic-suit',
  'gothic-wanted',
  'gothic-paperlogy',
  'gothic-line',
  'gothic-a1',
  'round-jua',
  'round-gmarket',
  'round-gowun',
  'serif-hahmlet',
  'serif-noto',
  'serif-song',
  'serif-gowun',
  'impact-blackhan',
  'impact-dohyeon',
  'retro-gugi',
  'hand-gaegu',
] as const
export type FontPairId = (typeof FONT_PAIR_IDS)[number]

export interface FontPair {
  heading: string
  weight: number
  body: 'Pretendard'
  /** 제목 자간(글자 크기 대비, em) — 굵은 고딕 계열만 둔다. 없으면 기본 제목 자간(TYPOGRAPHY h1·display −1px, h2 −0.5px) 그대로 */
  tracking?: number
}

/**
 * 굵은 고딕 제목 자간 −1.5%(K9, 상세페이지 조사 L10 적용 후보 8) — 제목 자간을 좁게 쓴 편이 44/101(와디즈 15/21)이었다.
 * 명조·손글씨·둥근 400·레트로는 기본 자간 그대로다
 */
export const GOTHIC_HEADING_TRACKING = -0.015

const pair = (heading: string, weight: number, tracking?: number): FontPair => ({ heading, weight, body: 'Pretendard', ...(tracking === undefined ? {} : { tracking }) })
const gothic = (heading: string, weight: number) => pair(heading, weight, GOTHIC_HEADING_TRACKING)

export const FONT_PAIR_TABLE: Record<FontPairId, FontPair> = {
  'gothic-suit': gothic('SUIT Variable', 800),
  'gothic-wanted': gothic('Wanted Sans Variable', 700),
  'gothic-paperlogy': gothic('Paperlogy', 800),
  'gothic-line': gothic('LINE Seed Sans KR', 700),
  'gothic-a1': gothic('Gothic A1', 900),
  'round-jua': pair('Jua', 400),
  'round-gmarket': gothic('GmarketSansBold', 700),
  'round-gowun': pair('Gowun Dodum', 400),
  'serif-hahmlet': pair('Hahmlet', 700),
  'serif-noto': pair('Noto Serif KR', 700),
  'serif-song': pair('Song Myung', 400),
  'serif-gowun': pair('Gowun Batang', 400),
  'impact-blackhan': gothic('Black Han Sans', 400),
  'impact-dohyeon': gothic('Do Hyeon', 400),
  'retro-gugi': pair('Gugi', 400),
  'hand-gaegu': pair('Gaegu', 400),
}

/** 저장된 짝(제목 글꼴·굵기)의 제목 자간 — 짝 표에 있는 고딕 계열만 값이 있다 */
export function headingTrackingOf(stored: { heading: string; weight: number }): number | undefined {
  return Object.values(FONT_PAIR_TABLE).find((p) => p.heading === stored.heading && p.weight === stored.weight)?.tracking
}
