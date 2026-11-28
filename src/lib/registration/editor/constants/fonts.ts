// ─── 폰트 옵션 (TextToolbar / RightPanel 공유) ──────────────────────────────
// 라이선스 원문(SIL OFL 1.1)을 확인한 글꼴만 등록한다 — 출처·예약 이름·가공 내역은 public/fonts/pdp/NOTICE.md.
// license: OFL = SIL Open Font License 1.1(원문 확인) / 확인 못 함 = 원문을 확인하지 못해 파일을 보관하지 않음
// 로딩: 자체 보관 /fonts/pdp/fonts.css(루트 layout — 앱 전체·편집기·미리보기, 내보내기 HTML). 목록을 바꾸면 fonts.css도 함께 바꾼다(fonts-selfhost.test).

/** 자체 보관 글꼴 스타일시트 — 루트 layout(src/app/layout.tsx)이 같은 출처 경로로 싣는다(편집기·미리보기 포함) */
export const PDP_FONT_CSS_PATH = '/fonts/pdp/fonts.css';
/** 앱 출처가 없는 단독 HTML(내보내기·평가 캡처)용 운영 출처 주소 — next.config가 /fonts/pdp에 교차 출처 허용을 붙인다 */
export const PDP_FONT_CSS_URL = `https://nexops-one.vercel.app${PDP_FONT_CSS_PATH}`;

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
  { label: 'GmarketSans Bold',    fontFamily: 'GmarketSansBold', fontWeight: 700, group: 'brand', license: 'OFL' },
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
  { label: 'Paperlogy',             fontFamily: 'Paperlogy', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'Paperlogy Bold',        fontFamily: 'Paperlogy', fontWeight: 700, group: 'gothic', license: 'OFL' },
  { label: 'Paperlogy ExtraBold',   fontFamily: 'Paperlogy', fontWeight: 800, group: 'gothic', license: 'OFL' },
  { label: 'LINE Seed',             fontFamily: 'LINE Seed Sans KR', fontWeight: 400, group: 'gothic', license: 'OFL' },
  { label: 'LINE Seed Bold',        fontFamily: 'LINE Seed Sans KR', fontWeight: 700, group: 'gothic', license: 'OFL' },
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
  { label: 'Gugi',             fontFamily: 'Gugi', fontWeight: 400, group: 'display', license: 'OFL' },
];

/** 추가 폰트 — 손글씨 계열 */
export const HANDWRITING_FONTS: FontOption[] = [
  { label: 'Nanum Pen Script', fontFamily: 'Nanum Pen Script', fontWeight: 400, group: 'handwriting', license: 'OFL' },
  { label: 'Gaegu',            fontFamily: 'Gaegu', fontWeight: 400, group: 'handwriting', license: 'OFL' },
];

/**
 * 예전 문서·생성 계획에만 남은 글꼴 — 선택지에는 없다. 라이선스 원문을 확인하지 못해 파일을 보관하지 않고
 * fonts.css가 같은 이름을 Jua(OFL, 둥근 제목체)로 그린다. 허용 목록에는 남겨 저장 문서·생성 계획의 글꼴 이름을 그대로 둔다.
 */
export const LEGACY_FONTS: FontOption[] = [
  { label: 'Cafe24 Ssurround (Jua로 표시)', fontFamily: 'Cafe24 Ssurround', fontWeight: 700, group: 'display', license: '확인 못 함' },
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

const ALLOWED_FAMILY_SET = new Set([...FONT_OPTIONS, ...LEGACY_FONTS].map((f) => f.fontFamily));

/** 생성 파이프라인(font_scheme 등)이 지정한 폰트가 에디터에서 로드 가능한지 검증 */
export const isAllowedEditorFont = (fontFamily: string): boolean =>
  ALLOWED_FAMILY_SET.has(fontFamily);

export const fontKey = (f: FontOption) => `${f.fontFamily}__${f.fontWeight}`;
