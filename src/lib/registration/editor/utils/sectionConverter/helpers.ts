// sectionConverter/helpers.ts — D1 분할: 원본 sectionConverter.ts 98~219행 순수 이동 (2026-07-04)


import { ProSectionType } from '@/lib/registration/editor/types/section';
import { TYPOGRAPHY, SPACING, IMAGE_SPECS, MULTILINE_HEADING_LINE_HEIGHT } from '@/lib/registration/editor/constants/designTokens';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';


// ─────────────────────────────────────────────────────────────────────────────
// Internal constants
// ─────────────────────────────────────────────────────────────────────────────
const CANVAS_WIDTH = IMAGE_SPECS.canvasWidth;          // 860
const SIDE_PADDING = SPACING.sectionSidePadding;        // 60
const CONTENT_WIDTH = CANVAS_WIDTH - SIDE_PADDING * 2;  // 740

// 이미지 없는 섹션(코드 기반 UI) — 명세서 §2.4
const CODE_BASED_SECTIONS = new Set<ProSectionType>([
  ProSectionType.PERFORMANCE_RATING,
  ProSectionType.EVENT_DISCOUNT,
  ProSectionType.SPEC_TABLE,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function normalizeHashtag(tag: string): string {
  const cleaned = tag.replace(/^[#\s]+/, '').trim();
  return cleaned ? `#${cleaned}` : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ID generator (session-unique, non-crypto)
// ─────────────────────────────────────────────────────────────────────────────
let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}_${_seq}_${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers
// ─────────────────────────────────────────────────────────────────────────────
type TypoLevel = keyof typeof TYPOGRAPHY;

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  return String(val);
}

function getLineHeight(level: TypoLevel): number {
  const t = TYPOGRAPHY[level];
  return 'lineHeight' in t ? (t.lineHeight as number) : 1.5;
}

function getLetterSpacing(level: TypoLevel): number {
  const t = TYPOGRAPHY[level];
  return 'letterSpacing' in t ? (t.letterSpacing as number) : 0;
}

/** placehold.co / 이미지 생성 실패 URL 필터링 */
function sanitizeImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (
    url.includes('placehold.co') ||
    url.includes('placeholder') ||
    url.includes('Generation+Failed') ||
    url.includes('Generation Failed') ||
    url.includes('Image+Generation')
  ) {
    return '';
  }
  return url;
}

/** hex 컬러 → "R,G,B" 문자열 (rgba() 사용용) */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '139,105,20';
  return `${r},${g},${b}`;
}

/** closingCta: dict 또는 string → {headline, subtext} */
function extractCta(cta: unknown): { headline: string; subtext: string } {
  if (typeof cta === 'string') return { headline: cta, subtext: '' };
  if (cta && typeof cta === 'object' && 'headline' in cta) {
    const c = cta as { headline?: unknown; subtext?: unknown };
    return {
      headline: typeof c.headline === 'string' ? c.headline : '',
      subtext: typeof c.subtext === 'string' ? c.subtext : '',
    };
  }
  return { headline: '', subtext: '' };
}

/** detailPoints: {claim,proof,benefit} 또는 {title,description} → {title, description} */
function normalizeDetailPoint(
  p: Record<string, string | undefined>,
): { title: string; description: string } {
  return {
    title: p.title ?? p.claim ?? '',
    description: p.description ?? p.proof ?? p.benefit ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★별점 트랙(2026-07-07): 한글 인지 줄바꿈 추정기
// 기존 `text.length / (fontSize * 0.55~0.6)` 추정은 라틴 폭 기준이라 한글
// (전각, ≈1.0em)을 절반 폭으로 계산 → 줄 수를 최대 절반으로 과소추정했다.
// 텍스트 요소는 마운트 후 실측(reflowSection)으로 스스로 늘어나지만,
// 형제 도형(리뷰카드 배경·말풍선·스텝 박스)은 생성 시점 높이로 고정되므로
// 텍스트가 박스를 이탈/겹침한다. 캔버스 렌더와 동일한 규칙
// (white-space: pre-wrap + word-break: keep-all → 공백 단위 greedy wrap)으로
// 줄 수를 추정해 생성 시점 기하를 실측과 일치시킨다.
// ─────────────────────────────────────────────────────────────────────────────

/** Pretendard 근사 글자폭(px). 한글/CJK/전각 1.0em, 라틴/숫자/기호는 축소 폭 */
function charWidthPx(ch: string, fontSize: number): number {
  const c = ch.codePointAt(0) ?? 0;
  if (
    (c >= 0xac00 && c <= 0xd7a3) || // 한글 음절
    (c >= 0x1100 && c <= 0x11ff) || // 한글 자모
    (c >= 0x3000 && c <= 0x9fff) || // CJK 기호/한자/가나
    (c >= 0xf900 && c <= 0xfaff) || // CJK 호환 한자
    (c >= 0xff00 && c <= 0xff60)    // 전각 영숫자/문장부호
  ) {
    return fontSize;
  }
  if (ch === ' ') return 0.28 * fontSize;
  if (c >= 0x30 && c <= 0x39) return 0.6 * fontSize;  // 숫자
  if (c >= 0x41 && c <= 0x5a) return 0.7 * fontSize;  // 라틴 대문자
  if (c >= 0x61 && c <= 0x7a) return 0.52 * fontSize; // 라틴 소문자
  return 0.45 * fontSize; // 따옴표·문장부호 등
}

// 이모지 감지 + grapheme 분절 — 코드포인트 순회는 ZWJ 시퀀스(👨‍👩‍👧)를 여러
// 글자로 세고 이모지를 0.45em(기타 기호)으로 과소추정해 카드/말풍선 이탈을 유발
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function splitGraphemes(word: string): string[] {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(word), (s) => s.segment);
  }
  return Array.from(word);
}

/** grapheme 단위 폭 — 이모지는 전각보다 넓게(1.2em) 렌더되는 것을 반영 */
function graphemeWidthPx(g: string, fontSize: number): number {
  if (EMOJI_RE.test(g)) return 1.2 * fontSize;
  let w = 0;
  for (const ch of g) w += charWidthPx(ch, fontSize);
  return w;
}

/**
 * word-break: keep-all 기준 greedy wrap 줄 수 추정.
 * \n / <br> 은 강제 개행으로 처리. 컨테이너보다 긴 단어는 폭 단위로 강제 분할.
 * letterSpacing(px)은 렌더 CSS와 동일하게 글자마다 가산한다.
 */
function estimateWrappedLines(
  text: string,
  fontSize: number,
  containerWidth: number,
  letterSpacing = 0,
): number {
  if (!text) return 0;
  const width = Math.max(fontSize, containerWidth);
  let lines = 0;
  for (const paragraph of text.split(/\n|<br\s*\/?>/i)) {
    const words = paragraph.split(' ');
    let lineW = 0;
    let paraLines = 1;
    const spaceW = 0.28 * fontSize + letterSpacing;
    for (const word of words) {
      const glyphs = splitGraphemes(word);
      let wordW = 0;
      for (const g of glyphs) wordW += graphemeWidthPx(g, fontSize) + letterSpacing;
      if (wordW > width) {
        // 초장 단어: 현재 줄을 채운 뒤 폭 단위 분할
        if (lineW > 0) paraLines += 1;
        paraLines += Math.max(0, Math.ceil(wordW / width) - 1);
        lineW = wordW % width || width;
        continue;
      }
      const needed = lineW === 0 ? wordW : lineW + spaceW + wordW;
      if (needed > width) {
        paraLines += 1;
        lineW = wordW;
      } else {
        lineW = needed;
      }
    }
    lines += paraLines;
  }
  return Math.max(1, lines);
}

const HEADING_LEVELS = new Set<TypoLevel>(['display', 'h1', 'h2']);

/**
 * P1-4: 헤딩(display/h1/h2)이 2줄 이상으로 줄바꿈되면 행간을 자동 완화한다.
 * 1줄이면 위계 기본 행간(1.15/1.3) 유지. 비헤딩 레벨은 항상 기본값.
 */
function resolveAutoLineHeight(
  text: string,
  level: TypoLevel,
  fontSize: number,
  containerWidth: number,
  letterSpacing = 0,
): number {
  const base = getLineHeight(level);
  if (!text || !HEADING_LEVELS.has(level)) return base;
  const lines = estimateWrappedLines(text, fontSize, containerWidth, letterSpacing);
  return lines >= 2 ? Math.max(base, MULTILINE_HEADING_LINE_HEIGHT) : base;
}

/** 텍스트 길이 + 폰트 크기 기반 높이 추정 (860px 소스 기준) */
function estimateTextHeight(text: string, level: TypoLevel, lineHeightOverride?: number): number {
  if (!text) return 0;
  const t = TYPOGRAPHY[level];
  const ls = getLetterSpacing(level);
  // P1-4: 명시 행간이 없으면 멀티라인 자동 행간과 동일 규칙으로 추정 —
  // makeTextEl이 부여하는 실제 행간과 y 진행(addText)이 어긋나지 않게 한다
  const lineH = lineHeightOverride ?? resolveAutoLineHeight(text, level, t.fontSize, CONTENT_WIDTH, ls);
  // ★별점 트랙: 한글 인지 wrap 추정으로 교체 (기존 0.6em 근사 → 한글 과소추정)
  // 자간(음수 포함)도 렌더와 동일하게 반영 — 헤딩(-1/-0.5px)의 줄 수 과대추정 교정
  const lines = estimateWrappedLines(text, t.fontSize, CONTENT_WIDTH, ls);
  return Math.ceil(lines * t.fontSize * lineH) + 20;
}

/**
 * 섹션 리듬 A-3 (2026-07-11): 풀블리드 마감 판정.
 * 최하단 요소가 y≤0에서 시작하는 전폭(≥860px) 이미지 = 배너형 섹션
 * (perf_sales·cta·concept_desc 등 이미지가 섹션 전체를 덮는 경우)이면
 * 이미지 가장자리가 곧 섹션 끝 — 하단 패딩을 0으로 마감해 배경 띠를 없앤다.
 * 본문 아래에 놓이는 콘텐츠 이미지(y>0)는 해당 없음(일반 하단 80 유지).
 * 변환(computeSectionHeight)·프리셋 적용(applyLayoutPreset)이 공유하는 정본 판정.
 */
function isFullBleedClosure(elements: CanvasElement[]): boolean {
  if (elements.length === 0) return false;
  const maxBottom = Math.max(
    ...elements.map((e) => e.transform.y + e.transform.height),
  );
  return elements.some(
    (e) =>
      e.type === 'image' &&
      e.transform.width >= CANVAS_WIDTH &&
      e.transform.y <= 0 &&
      e.transform.y + e.transform.height >= maxBottom - 1,
  );
}

/** 모든 요소 중 가장 아래쪽 y + height 기반으로 섹션 높이 계산 */
function computeSectionHeight(elements: CanvasElement[]): number {
  if (elements.length === 0) return 400;
  const bottom = Math.max(
    ...elements.map((e) => e.transform.y + e.transform.height),
  );
  // A-3: 풀블리드 마감 섹션은 하단 패딩 0, 그 외 정본 토큰(80)
  const pad = isFullBleedClosure(elements) ? 0 : SPACING.sectionBottomPadding;
  return bottom + pad;
}


export {
  CANVAS_WIDTH,
  SIDE_PADDING,
  CONTENT_WIDTH,
  CODE_BASED_SECTIONS,
  normalizeHashtag,
  uid,
  str,
  getLineHeight,
  getLetterSpacing,
  sanitizeImageUrl,
  hexToRgb,
  extractCta,
  normalizeDetailPoint,
  estimateWrappedLines,
  resolveAutoLineHeight,
  estimateTextHeight,
  computeSectionHeight,
  isFullBleedClosure,
  splitGraphemes,
  graphemeWidthPx,
};
export type { TypoLevel };
