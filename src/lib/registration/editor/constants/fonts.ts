// ─── 폰트 옵션 (TextToolbar / RightPanel 공유) ──────────────────────────────
// 전 폰트 무료 상업용 라이선스 확인본만 등록한다 (트랙 7).
// license: OFL = SIL Open Font License / 무료상업 = 배포처 무료 상업용 고지
// 로딩: Google Fonts link 또는 CDN @font-face — frontend/src/app/layout.tsx 참조

export interface FontOption {
  label: string;
  fontFamily: string;
  fontWeight: number;
  /** 셀렉터 분류: brand=브랜드 추천, gothic=고딕, serif=명조, display=디스플레이, handwriting=손글씨 */
  group: 'brand' | 'gothic' | 'serif' | 'display' | 'handwriting';
  /** 라이선스 근거 (상업용 안전성 문서화) */
  license: string;
}

/** 브랜드 추천 폰트 (Pretendard + GmarketSans) */
export const BRAND_FONTS: FontOption[] = [
  { label: 'Pretendard Regular',  fontFamily: 'Pretendard', fontWeight: 400, group: 'brand', license: 'OFL' },
  { label: 'Pretendard Medium',   fontFamily: 'Pretendard', fontWeight: 500, group: 'brand', license: 'OFL' },
  { label: 'Pretendard Bold',     fontFamily: 'Pretendard', fontWeight: 700, group: 'brand', license: 'OFL' },
  { label: 'Pretendard Black',    fontFamily: 'Pretendard', fontWeight: 900, group: 'brand', license: 'OFL' },
  { label: 'GmarketSans Bold',    fontFamily: 'GmarketSansBold', fontWeight: 700, group: 'brand', license: '무료상업(G마켓 고지)' },
];

/** 추가 폰트 — 고딕 계열 */
export const GOTHIC_FONTS: FontOption[] = [
  { label: 'Noto Sans KR',          fontFamily: 'Noto Sans KR', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'Noto Sans KR Bold',     fontFamily: 'Noto Sans KR', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Nanum Gothic',          fontFamily: 'Nanum Gothic', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'Nanum Gothic Bold',     fontFamily: 'Nanum Gothic', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Nanum Gothic ExBold',   fontFamily: 'Nanum Gothic', fontWeight: 800, group: 'gothic', license: 'OFL' },
  { label: 'IBM Plex Sans KR',      fontFamily: 'IBM Plex Sans KR', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'IBM Plex Sans KR Bold', fontFamily: 'IBM Plex Sans KR', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Gothic A1',             fontFamily: 'Gothic A1', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'Gothic A1 Bold',        fontFamily: 'Gothic A1', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Gothic A1 Black',       fontFamily: 'Gothic A1', fontWeight: 900, group: 'gothic', license: 'OFL' },
  { label: 'Gowun Dodum',           fontFamily: 'Gowun Dodum', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'SUIT',                  fontFamily: 'SUIT Variable', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'SUIT Bold',             fontFamily: 'SUIT Variable', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Wanted Sans',           fontFamily: 'Wanted Sans Variable', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'Wanted Sans Bold',      fontFamily: 'Wanted Sans Variable', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'LINE Seed',             fontFamily: 'LINE Seed Sans KR', fontWeight: 400, group: 'gothic', license: '무료상업(LINE OFL)' },
  { label: 'LINE Seed Bold',        fontFamily: 'LINE Seed Sans KR', fontWeight: 700, group: 'gothic', license: '무료상업(LINE OFL)' },
];

/** 추가 폰트 — 명조/세리프 계열 */
export const SERIF_FONTS: FontOption[] = [
  { label: 'Nanum Myeongjo',      fontFamily: 'Nanum Myeongjo', fontWeight: 400, group: 'serif', license: 'OFL' },
  { label: 'Nanum Myeongjo Bold', fontFamily: 'Nanum Myeongjo', fontWeight: 700, group: 'serif', license: 'OFL' },
  { label: 'Noto Serif KR',       fontFamily: 'Noto Serif KR', fontWeight: 400, group: 'serif', license: 'OFL' },
  { label: 'Noto Serif KR Bold',  fontFamily: 'Noto Serif KR', fontWeight: 700, group: 'serif', license: 'OFL' },
  { label: 'Gowun Batang',        fontFamily: 'Gowun Batang', fontWeight: 400, group: 'serif', license: 'OFL' },
  { label: 'Hahmlet',             fontFamily: 'Hahmlet', fontWeight: 400, group: 'serif', license: 'OFL' },
  { label: 'Hahmlet Bold',        fontFamily: 'Hahmlet', fontWeight: 700, group: 'serif', license: 'OFL' },
  { label: 'Song Myung',          fontFamily: 'Song Myung', fontWeight: 400, group: 'serif', license: 'OFL' },
];

/** 추가 폰트 — 디스플레이/임팩트 계열 */
export const DISPLAY_FONTS: FontOption[] = [
  { label: 'Black Han Sans',   fontFamily: 'Black Han Sans', fontWeight: 400, group: 'display', license: 'OFL' },
  { label: 'Do Hyeon',         fontFamily: 'Do Hyeon', fontWeight: 400, group: 'display', license: 'OFL' },
  { label: 'Jua',              fontFamily: 'Jua', fontWeight: 400, group: 'display', license: 'OFL' },
  { label: 'Cafe24 Ssurround', fontFamily: 'Cafe24 Ssurround', fontWeight: 700, group: 'display', license: '무료상업(카페24 고지)' },
  { label: 'Gugi',             fontFamily: 'Gugi', fontWeight: 400, group: 'display', license: 'OFL' },
];

/** 추가 폰트 — 손글씨 계열 */
export const HANDWRITING_FONTS: FontOption[] = [
  { label: 'Nanum Pen Script', fontFamily: 'Nanum Pen Script', fontWeight: 400, group: 'handwriting', license: 'OFL' },
  { label: 'Gaegu',            fontFamily: 'Gaegu', fontWeight: 400, group: 'handwriting', license: 'OFL' },
];

/** 추가 폰트 전체 (하위 호환 — 기존 EXTRA_FONTS 소비처용) */
export const EXTRA_FONTS: FontOption[] = [
  ...GOTHIC_FONTS,
  ...SERIF_FONTS,
  ...DISPLAY_FONTS,
  ...HANDWRITING_FONTS,
];

/** 전체 폰트 목록 (하위 호환) */
export const FONT_OPTIONS: FontOption[] = [...BRAND_FONTS, ...EXTRA_FONTS];

/** 셀렉터 optgroup 표시용 그룹 정의 (순서 = 표시 순서) */
export const FONT_GROUPS: Array<{ key: FontOption['group']; label: string; fonts: FontOption[] }> = [
  { key: 'brand',       label: '브랜드 추천', fonts: BRAND_FONTS },
  { key: 'gothic',      label: '고딕',        fonts: GOTHIC_FONTS },
  { key: 'serif',       label: '명조',        fonts: SERIF_FONTS },
  { key: 'display',     label: '디스플레이',  fonts: DISPLAY_FONTS },
  { key: 'handwriting', label: '손글씨',      fonts: HANDWRITING_FONTS },
];

const ALLOWED_FAMILY_SET = new Set(FONT_OPTIONS.map((f) => f.fontFamily));

/** 생성 파이프라인(font_scheme 등)이 지정한 폰트가 에디터에서 로드 가능한지 검증 */
export const isAllowedEditorFont = (fontFamily: string): boolean =>
  ALLOWED_FAMILY_SET.has(fontFamily);

export const fontKey = (f: FontOption) => `${f.fontFamily}__${f.fontWeight}`;
