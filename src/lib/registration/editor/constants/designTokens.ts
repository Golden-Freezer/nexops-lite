// ─────────────────────────────────────────────
// 디자인 시스템 토큰 (명세서 4.0~4.4)
// 모든 수치는 860px 소스 이미지 기준 (쿠팡 모바일 ×0.436 축소 표시)
// ─────────────────────────────────────────────

/**
 * NEXFIT Design Identity
 * "Pastel-clinical Premium SaaS" — glassy, confident, breathy.
 * Pastel Blue (#7EB8C9) × Olive (#8B9E6B) duo gradient,
 * GmarketSansBold display × Pretendard body,
 * cubic-bezier(0.16, 1, 0.3, 1) premium easing throughout.
 */

// ─────────────────────────────────────────────
// Z-Index 계층 (에디터 전용)
// ─────────────────────────────────────────────
export const Z_INDEX = {
  base: 0,
  snapGuide: 50,
  element: 50,
  selection: 9998,
  dragging: 9997,
  marquee: 9999,
  toolbar: 9999,
  contextMenu: 10000,
  dropdown: 100,
  modal: 1000,
  toast: 9999,
  tooltip: 600,
  zoomControl: 500,
  scrollProgress: 100,
} as const;

// ─────────────────────────────────────────────
// 모션 토큰 (JS 레이어)
// ─────────────────────────────────────────────
export const MOTION = {
  easePremium: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeSnap: 'cubic-bezier(0.4, 0, 0.2, 1)',
  durationMicro: '200ms',
  durationShort: '400ms',
  durationMedium: '600ms',
  durationLong: '1000ms',
} as const;

// ─────────────────────────────────────────────
// 모바일 축소 계수
// ─────────────────────────────────────────────
export const MOBILE_SCALE_FACTOR = 0.436;

// ─────────────────────────────────────────────
// 폰트 크기 최소 기준 (소스 px)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 섹션 라벨 헤더 (핵심 포인트·추가 특징·사용 방법 등)
// 빌더가 addSectionHeader로 68px + accent 라인을 부여한다. 프리셋이 적용돼
// 슬롯ID로 재매핑돼도 동일 스타일을 유지하도록 applyLayoutPreset이 이 목록을 참조.
// ─────────────────────────────────────────────
export const SECTION_LABEL_HEADER_SLOTS = new Set<string>([
  'chapter_title', 'sub_chapter_title', 'howto_title', 'spec_title',
  'list_title', 'compare_title', 'compare2_title', 'petit_title',
]);
export const SECTION_HEADER_FONT_SIZE = 68;
export const SECTION_HEADER_ACCENT_W = 48;
export const SECTION_HEADER_ACCENT_H = 5;

export const MIN_FONT_SIZES = {
  display: 72,    // 모바일: 31px — 임팩트 타이틀 하한
  h1: 72,         // 모바일: 31px — 히어로 헤드라인 하한
  h2: 60,         // 모바일: 26px — 섹션 제목 하한 (body 45와 위계 확보)
  body: 45,       // 모바일: 20px — 편안한 읽기
  caption: 28,    // 모바일: 12px — 보조 정보 최소 가독성
  footer: 24,     // 모바일: 10px — 법적 최소 (footer만 허용)
} as const;

// ─────────────────────────────────────────────
// 타이포그래피 위계 5단계 (명세서 4.1)
// Display × Body 공식 페어링:
// Display/H1: GmarketSansBold 900 — 임팩트·한글 특화
// H2~Caption: Pretendard 400~800 — 가독성·중립성
// ─────────────────────────────────────────────
export const TYPOGRAPHY = {
  display: {
    role: '임팩트 타이틀 (완판 배너, 이벤트)',
    fontFamily: 'GmarketSansBold',
    fontSize: 90,               // 모바일: 39px — 한눈에 시선 포착
    fontWeight: 700,            // 트랙 5: GmarketSansBold 실보유 웨이트(700)로 정렬 — 900 요청은 faux bold(합성 볼드) 유발
    letterSpacing: -1,
    lineHeight: 1.15,
  },
  h1: {
    role: '히어로 효익 헤드라인 (페이지에서 가장 큰 텍스트)',
    fontFamily: 'GmarketSansBold',
    fontSize: 90,               // 모바일: 39px — ~12자/줄, 25자 max = 2~3줄
    fontWeight: 700,            // 트랙 5: faux bold 정리 (900 → 실보유 700)
    lineHeight: 1.8,            // F2e(라운드2 P2): page_renderer.py .benefit-headline 1.2→1.8 정합
    letterSpacing: -1,
    maxChars: 25,
  },
  h2: {
    role: '섹션 메인 제목 (problem/solution/CTA/claim)',
    fontFamily: 'GmarketSansBold', // 트랙 5: page_renderer.py "h1, h2 { GmarketSansBold }" 규칙으로 전 h2 통일 (기존 일부만 오버라이드 → 비일관)
    fontSize: 60,               // 모바일: 26px — ~16자/줄, claim 25자 = 1~2줄
    fontWeight: 700,            // GmarketSansBold 실보유 웨이트
    lineHeight: 1.8,            // F2e(라운드2 P2): page_renderer.py 7개 헤더 선택자 1.2~1.3→1.8 정합
    letterSpacing: -0.5,        // B-2: page_renderer.py 헤딩 규칙(letter-spacing: -0.5px) 정합
  },
  body: {
    role: '본문 텍스트 (empathy, proof, benefit, hook, description)',
    fontFamily: 'Pretendard',
    fontSize: 45,               // 모바일: 20px — ~22자/줄, "15~25자/줄" 규칙에 최적
    fontWeight: 400,
    lineHeight: 1.7,
  },
  caption: {
    role: '보조 텍스트 (브랜드명, 카테고리, 스펙표, 주석)',
    fontFamily: 'Pretendard',
    fontSize: 28,               // 모바일: 12px — 보조 정보
    fontWeight: 400,
    color: '#888888',
  },
} as const;

// ─────────────────────────────────────────────
// 멀티라인 헤딩 자동 행간 (P1-4, 2026-07-11)
// display(1.15)는 1줄 기준의 빽빽한 행간 — 2줄 이상으로 줄바꿈되면 이 값으로 완화한다.
// h1·h2는 F2e(라운드2 P2, 2026-07-12)에서 기본 행간을 1.8로 올려 이 값보다 항상 커졌으므로
// resolveAutoLineHeight의 Math.max(base, 이 값) 비교에서 사실상 무영향(base가 그대로 채택됨).
// 변환(makeTextEl)·편집 커밋(exitEditMode)이 공유하는 정본.
// 사용자가 행간을 직접 편집한 요소(userStyledKeys: lineHeight)에는 적용하지 않는다.
// ─────────────────────────────────────────────
export const MULTILINE_HEADING_LINE_HEIGHT = 1.4;

// ─────────────────────────────────────────────
// 균형 줄바꿈 대상 헤딩 하한 (섹션 리듬 §4-3b, 2026-07-11)
// fontSize ≥ 60(h2/섹션헤더 68/h1 90/display)에 CSS text-wrap: balance를 적용해
// 2줄 헤드라인의 고아 줄(마지막 줄 1~3자)을 렌더 시점에 제거한다.
// 캔버스(CanvasElement)·export HTML(htmlBuilders)이 공유하는 정본.
// balance는 줄 수를 바꾸지 않으므로 높이 추정(estimateWrappedLines)과 충돌하지 않는다.
// ─────────────────────────────────────────────
export const BALANCED_HEADING_MIN_FONT = 60;

// ─────────────────────────────────────────────
// 시맨틱 타이포그래피 매핑 (요소 → 위계 레벨)
// ─────────────────────────────────────────────
export const SEMANTIC_TYPOGRAPHY = {
  // Hero 섹션
  benefitHeadline: 'h1',        // 90px → 39px — 가장 크고 굵게
  hook: 'body',                 // 45px → 20px — benefitHeadline 위에
  subBenefit: 'body',           // 45px → 20px — benefitHeadline 아래
  categoryBadge: 'caption',     // 28px → 12px — 카테고리 라벨
  brandName: 'caption',         // 28px → 12px — 브랜드명 (작게)

  // Problem / Solution
  sectionHeading: 'h2',         // 60px → 26px — "이런 경험 있지 않으세요?"
  empathyBody: 'body',          // 45px → 20px — 공감 확장 텍스트
  solutionSummary: 'body',      // 45px → 20px — 해결 선언 보조

  // Point Cards
  pointCardTitle: 48,           // → 21px (h2와 body 사이)
  pointCardDesc: 38,            // → 17px (body 근접)

  // Detail Points (선언-증명-효익)
  claim: 'h2',                  // 60px → 26px — 선언은 굵고 크게
  proof: 38,                    // → 17px — 증명은 body 근접
  benefit: 'body',              // 45px → 20px — 효익은 body

  // CTA
  ctaHeadline: 'h2',            // 60px → 26px
  ctaSubtext: 38,               // → 17px

  // Spec Table
  specTableHeader: 'caption',   // 28px → 12px
  specTableBody: 'caption',     // 28px → 12px

  // Legal / Footer
  footerDisclaimer: 24,         // → 10px (법적 최소)

  // Sold-out banner
  soldOutMain: 'display',       // 90px → 39px

  // ─────────────────────────────────────────
  // B-2 생성 시점 스타일 풍부화 (2026-07-07)
  // page_renderer.py의 실측값을 이식해 HTML 렌더와 캔버스 초기 변환의
  // 시각 정합을 맞춘다. CSS "0 2px 16px" = angle 180°(정하방)·distance 2px·blur 16px.
  // 절제 원칙: 그림자는 이미지 오버레이 텍스트의 가독성 목적에만 사용한다.
  // ─────────────────────────────────────────

  /** 섹션 헤딩 폰트 — page_renderer.py "h1, h2 { font-family: GmarketSansBold }" 규칙 */
  sectionHeadingFont: 'GmarketSansBold',

  /** 오버레이 헤딩 그림자 — .sec-overlay h2 / .sold-out-main: text-shadow: 0 2px 16px rgba(0,0,0,0.5) */
  overlayHeadingShadow: {
    textShadowAngle: 180,
    textShadowDistance: 2,
    textShadowBlur: 16,
    textShadowColor: 'rgba(0,0,0,0.5)',
  },

  /** 오버레이 본문 그림자 — .sec-overlay p: text-shadow: 0 2px 8px rgba(0,0,0,0.45) */
  overlayBodyShadow: {
    textShadowAngle: 180,
    textShadowDistance: 2,
    textShadowBlur: 8,
    textShadowColor: 'rgba(0,0,0,0.45)',
  },

  /** 리뷰 카드 그림자 — .review-card-bubble: box-shadow: 0 2px 12px rgba(0,0,0,0.06) */
  reviewCardShadow: {
    enabled: true,
    angle: 180,
    distance: 2,
    blur: 12,
    spread: 0,
    color: 'rgba(0,0,0,0.06)',
  },
} as const;

// ─────────────────────────────────────────────
// 섹션 그룹별 추천 폰트 스킴 (트랙 5)
// heading = display/h1/h2 레벨, body = body/caption 레벨.
// 생성 파이프라인(section_plan.font_scheme)이 그룹별로 오버라이드할 수 있으며,
// 지정 폰트는 반드시 화이트리스트(에디터 로드 가능 목록)에 있어야 적용된다.
// ─────────────────────────────────────────────
export type SectionGroupKey = 'hook' | 'problem' | 'usp' | 'modules';

export interface GroupFontPair {
  heading: string;
  body: string;
}

export const SECTION_FONT_SCHEME: Record<SectionGroupKey, GroupFontPair> = {
  hook:    { heading: 'GmarketSansBold', body: 'Pretendard' },
  problem: { heading: 'GmarketSansBold', body: 'Pretendard' },
  usp:     { heading: 'GmarketSansBold', body: 'Pretendard' },
  modules: { heading: 'GmarketSansBold', body: 'Pretendard' },
};

/** 생성 파이프라인이 헤딩에 지정할 수 있는 폰트 화이트리스트 (전부 무료 상업용·에디터 로드 가능) */
export const HEADING_FONT_WHITELIST = [
  'GmarketSansBold', 'Black Han Sans', 'Do Hyeon', 'Jua',
  'Gothic A1', 'Hahmlet', 'Song Myung', 'Noto Serif KR',
  'Cafe24 Ssurround',
] as const;

/** 생성 파이프라인이 본문에 지정할 수 있는 폰트 화이트리스트 */
export const BODY_FONT_WHITELIST = [
  'Pretendard', 'Noto Sans KR', 'IBM Plex Sans KR', 'Gowun Dodum',
  'SUIT Variable', 'Wanted Sans Variable',
] as const;

// ─────────────────────────────────────────────
// 리뷰 카드 기본 파라미터 (트랙 4 D-1: sections.ts 하드코딩 외부화)
// 프리셋 cardParams / 섹션 reviewCardParams가 이 기본값을 오버라이드한다
// ─────────────────────────────────────────────
export const REVIEW_CARD_DEFAULTS = {
  maxCards: 5,          // 최대 카드 수
  gap: 16,              // 카드 간 세로 간격 px
  padding: 24,          // 카드 내부 패딩 px
  marginX: 40,          // 카드 좌우 마진 px
  avatarSize: 52,       // 아바타 한 변 px
  avatarRadius: 14,     // 아바타 라운드 px
  bodyFontSize: 34,     // 본문 폰트 px (모바일 ~15px — 전폭 카드 기준 가독 하한)
  bodyLineHeight: 1.6,  // 본문 행간 배수
} as const;

// ─────────────────────────────────────────────
// 수직 간격 체계 (명세서 4.2)
// ─────────────────────────────────────────────
export const SPACING = {
  // T6(2026-07-12): 상하단 여백 1.75배 확장, page_renderer.py(백엔드 200→350px)와 정책 정합.
  // ⚠ sectionTopMargin은 현재 프론트 어디에서도 소비되지 않는 죽은 상수다(grep 0건) — 백엔드·값 정합용 참조값.
  // 실제 프론트 섹션 최상단 패딩은 sections.ts의 SECTION_TOP_PAD(=140, 80×1.75)이 담당하며 이미 T6로 상향됨.
  sectionTopMargin: 350,        // 200×1.75 — 모바일: 153px — 섹션 간 충분한 호흡
  h3ToH1: 60,                   // 모바일: 26px — 서브타이틀→헤드라인
  h1ToBody: 90,                 // 모바일: 39px — 헤드라인→본문 (넉넉)
  bodyToCaption: 30,            // 모바일: 13px — 본문→별첨
  headerToContent: 60,          // 모바일: 26px — 섹션 라벨 헤더(68px)→첫 콘텐츠 정본 갭 (섹션 리듬 B-1, T6 대상 아님)
  captionToImage: 110,          // 모바일: 48px — 별첨→이미지 전환
  imageToImage: 35,             // 모바일: 15px — 이미지 연속 배치
  sectionSidePadding: 60,       // 모바일: 26px — 좌우 여백 (T6 대상 아님)
  sectionBottomPadding: 140,    // 80×1.75 — 모바일: 61px — 섹션 하단 여백 (변환·프리셋·리플로우 공통 정본, full-bleed 예외는 helpers.ts isFullBleedClosure가 0으로 오버라이드)
} as const;

// ─────────────────────────────────────────────
// 마케팅 레이어 다크 그라운드 토큰 (프론트엔드 리뉴얼 SPEC §3-2)
// 히어로·주요 마케팅 섹션의 니어블랙 그라운드. 브랜드 듀오 컬러는
// 라이트 배경의 주조색이 아니라 다크 배경 위 액센트·글로우·광원으로만 쓴다.
// CSS 레이어 정본은 globals.css의 --brand-dark-* 변수 — 두 곳은 항상 동기화.
// 앱 내부 페이지(라이트)에는 적용하지 않는다.
// ─────────────────────────────────────────────
export const DARK_GROUND = {
  // 2026-07-13 피드백 v2: 쿨 니어블랙(#0B0E13 계열) → 웜 니어블랙으로 보정.
  // 20-30 여성·이커머스 대중성 벤치마크(Vev/Lounge Lizard 컨센서스) — 무채색 블랙은 차갑게 읽힘.
  bg: '#14110E',                            // 웜 니어블랙 베이스 (브라운 기 혼합)
  bgElevated: '#1D1915',                    // 카드·패널 승강면
  bgGlass: 'rgba(24, 20, 17, 0.72)',        // 글래스 패널 (네비·피처 카드 한정)
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  text: 'rgba(255, 255, 255, 0.92)',
  textMuted: 'rgba(255, 255, 255, 0.56)',
  textFaint: 'rgba(255, 255, 255, 0.36)',
  glowPrimary: 'rgba(126, 184, 201, 0.32)', // Pastel Blue 발광
  glowAccent: 'rgba(139, 158, 107, 0.26)',  // Olive 발광
} as const;

// ─────────────────────────────────────────────
// 데이터 밀도 토큰 (프론트엔드 리뉴얼 SPEC §3-6 — 앱 내부 데이터 화면 공용)
// 셀 텍스트 하한 13px. text-[10px]/[9px] 등 13px 미만 arbitrary value 금지 —
// 데이터 화면의 글자 크기는 반드시 이 토큰의 클래스 문자열로만 지정한다.
// 숫자 컬럼은 numericCell(우측 정렬 + tabular-nums) 사용, 천단위 콤마 필수.
// ─────────────────────────────────────────────
export const DATA_DENSITY = {
  /** 테이블 본문 셀 — 하한 13px */
  cell: 'text-[13px] leading-snug',
  /** 숫자 셀 — 우측 정렬 + 등폭 숫자 */
  numericCell: 'text-[13px] leading-snug text-right tabular-nums',
  /** 테이블 헤더 */
  header: 'text-[13px] font-medium',
  /** 보조 메타 정보 (리스트 아래 줄, 부가 설명) */
  meta: 'text-[13px] text-[var(--brand-text-muted)]',
  /** 배지·칩 라벨 */
  badge: 'text-[13px] font-medium',
  /** 행 패딩 표준 */
  rowPad: 'px-3 py-2.5',
  /** 압축 행 패딩 (밀도 높은 목록) */
  rowPadCompact: 'px-2.5 py-2',
} as const;

// ─────────────────────────────────────────────
// 이미지 규격 (명세서 4.3)
// ─────────────────────────────────────────────
export const IMAGE_SPECS = {
  canvasWidth: 860,             // 쿠팡 표준 폭

  // 비율별 규격
  aspectRatio_3_4: { width: 860, height: 1147 },  // 제품 히어로, 솔루션, CTA
  aspectRatio_1_1: { width: 860, height: 860 },    // 매크로, HowTo
  aspectRatio_16_9: { width: 860, height: 484 },   // 배너 (sold_out, event)

  // 이미지 모서리 — 쿠팡: 이미지 라운딩 없음 (전폭 사용)
  borderRadius: 0,

  // 이미지 내 텍스트 금지 (AI 생성 이미지에 적용)
  noTextInImages: true,

  // 출력 포맷
  outputFormat: 'PNG' as const,
  maxFileSize: '10MB',
} as const;
