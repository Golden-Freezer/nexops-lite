// sectionConverter/sections.ts — D1 분할: 원본 sectionConverter.ts 34~46행, 717~1943행 순수 이동 (2026-07-04)


import { ProSectionType } from '@/lib/registration/editor/types/section';
import { SPACING, IMAGE_SPECS, SEMANTIC_TYPOGRAPHY, REVIEW_CARD_DEFAULTS, SECTION_HEADER_FONT_SIZE, SECTION_HEADER_ACCENT_W, SECTION_HEADER_ACCENT_H } from '@/lib/registration/editor/constants/designTokens';
import type { CanvasElement, ReviewCardParams } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import { getHeroFrame } from '@/lib/registration/editor/data/frames';
import {
  CANVAS_WIDTH,
  SIDE_PADDING,
  CONTENT_WIDTH,
  normalizeHashtag,
  str,
  sanitizeImageUrl,
  hexToRgb,
  estimateWrappedLines,
  estimateTextHeight,
  resolveAutoLineHeight,
  getLetterSpacing,
} from './helpers';
import type { TypoLevel } from './helpers';
import { getUSPSvgString, buildStarsSvg } from './svg';
import { makeTextEl, makeImageEl, makeShapeEl, makeSvgEl, makeFramedImageEl } from './elements';
import { measureTextBlock } from './measure';


// ─────────────────────────────────────────────────────────────────────────────
// B-2 생성 시점 스타일 상수 (2026-07-07) — SEMANTIC_TYPOGRAPHY에서 관리
// page_renderer.py 실측값을 그대로 이식해 HTML 렌더 경로와 시각 정합을 맞춘다.
// 절제 원칙: 그림자는 이미지 오버레이 텍스트의 가독성 목적에만 적용한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 섹션 메인 제목 폰트 — page_renderer.py "h1, h2 { GmarketSansBold }" 규칙 */
const H2_TITLE_FONT = { fontFamily: SEMANTIC_TYPOGRAPHY.sectionHeadingFont };

/** 평점 별(★) 색상 — 팔레트 무관 범용 앰버(선명·'별점'으로 즉시 인지). 기존 머스터드 #D4A017 대체 */
const RATING_STAR_COLOR = '#FBBF24';

/** 오버레이 헤딩 그림자 — .sec-overlay h2 / .sold-out-main (0 2px 16px rgba(0,0,0,0.5)) */
const OVERLAY_HEADING_SHADOW = SEMANTIC_TYPOGRAPHY.overlayHeadingShadow;

/** 오버레이 본문 그림자 — .sec-overlay p (0 2px 8px rgba(0,0,0,0.45)) */
const OVERLAY_BODY_SHADOW = SEMANTIC_TYPOGRAPHY.overlayBodyShadow;

/**
 * T6: 섹션 최상단 내부 패딩 — 80 → 140(×1.75), 하단 SPACING.sectionBottomPadding(140)과 대칭.
 * full-bleed 섹션(CTA/PERFORMANCE_SALES 등)은 이미지가 섹션을 꽉 채우는 별도 오버레이 경로를
 * 쓰므로 이 상수를 참조하지 않는다 — 영향 없음(아래 case 블록 참조).
 */
const SECTION_TOP_PAD = 140;

function contrastInkForHex(hex: string): '#FFFFFF' | '#1A1A1A' {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) return '#FFFFFF';
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const linearize = (offset: number): number => {
    const channel = parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linearize(0) + 0.7152 * linearize(2) + 0.0722 * linearize(4);
  return luminance > 0.2 ? '#1A1A1A' : '#FFFFFF';
}


// ─────────────────────────────────────────────────────────────────────────────
// 섹션 빌드 시 createSectionElements에 전달되는 추가 컨텍스트
// ─────────────────────────────────────────────────────────────────────────────
interface SectionBuildExtra {
  hookStrategy?: {
    hero_frame?: string;
    image_hooking?: boolean;
  };
  brandName?: string;
  allImages?: Record<string, string | string[]>;
  specSheet?: Record<string, unknown>;
  /** 트랙 4: 리뷰 카드 파라미터 (프리셋/사용자 오버라이드, perf_reviews 전용) */
  cardParams?: Partial<ReviewCardParams>;
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. createSectionElements
//    섹션 타입 + content + imageUrl → CanvasElement[]
// ─────────────────────────────────────────────────────────────────────────────
export function createSectionElements(
  sectionType: ProSectionType,
  content: Record<string, unknown>,
  imageUrl: string | null,
  palette: DesignPalette,
  extra?: SectionBuildExtra,
): CanvasElement[] {
  const elements: CanvasElement[] = [];
  let y = SECTION_TOP_PAD; // 섹션 최상단 내부 패딩

  /** 텍스트 추가 후 y 진행 */
  function addText(
    name: string,
    text: string,
    level: TypoLevel,
    color: string = palette.textMain,
    align: 'left' | 'center' | 'right' = 'center',
    zIndex = 2,
    overrides?: Parameters<typeof makeTextEl>[9],
  ): void {
    if (!text) return;
    elements.push(
      makeTextEl(name, text, level, SIDE_PADDING, y, CONTENT_WIDTH, color, align, zIndex, overrides),
    );
    y += estimateTextHeight(text, level) + SPACING.bodyToCaption;
  }

  /**
   * 섹션 라벨 헤더 — accent 라인(짧은 컬러 바) + 68px 헤딩.
   * '핵심 포인트'·'추가 특징'·'사용 방법' 같은 내비게이션 라벨을 강조한다
   * (콘텐츠 헤드라인 h2 60px과 구분되는 상위 강조 68px + accent).
   */
  function addSectionHeader(name: string, text: string): void {
    if (!text) return;
    const ACCENT_W = SECTION_HEADER_ACCENT_W;
    const ACCENT_H = SECTION_HEADER_ACCENT_H;
    elements.push(
      makeShapeEl(
        `${name}_accent`, 'roundedRect',
        Math.floor((CANVAS_WIDTH - ACCENT_W) / 2), y, ACCENT_W, ACCENT_H,
        { fill: palette.primary, borderRadius: ACCENT_H / 2 }, 2,
      ),
    );
    y += ACCENT_H + 20;
    const fs = SECTION_HEADER_FONT_SIZE;
    const headH = Math.ceil(fs * 1.3 * estimateWrappedLines(text, fs, CONTENT_WIDTH));
    elements.push(
      makeTextEl(
        name, text, 'h2', SIDE_PADDING, y, CONTENT_WIDTH, palette.primary, 'center', 2,
        { fontSize: fs, fontWeight: 800, lineHeight: 1.3, height: headH, ...H2_TITLE_FONT },
      ),
    );
    // B-1(섹션 리듬): 헤더→첫 콘텐츠 정본 갭 60 — 각 빌더는 헤더 뒤 추가 gap을 더하지 않는다
    y += headH + SPACING.headerToContent;
  }

  /** 전폭 이미지 추가 후 y 진행 */
  function addImage(
    name: string,
    src: string,
    imageType: string,
    imgH: number,
    opacity = 1,
  ): void {
    const el = makeImageEl(name, src, imageType, 0, y, CANVAS_WIDTH, imgH);
    el.opacity = opacity;
    elements.push(el);
    y += imgH + SPACING.imageToImage;
  }

  function gap(n: number): void {
    y += n;
  }

  /** 이미지+텍스트 항목 사이 세로 rhythm line (Task 5) */
  function addRhythmLine(name: string): void {
    const rlEl = makeShapeEl(
      name, 'rect',
      CANVAS_WIDTH / 2 - 1, y, 2, 80,
      { fill: palette.primary }, 2,  // 팔레트 연동(기존 골드 #C8A96E)
    );
    rlEl.opacity = 0.3;
    elements.push(rlEl);
    y += 80;
  }

  const imgSrc = imageUrl ?? '';
  const IMG_3_4 = IMAGE_SPECS.aspectRatio_3_4.height;    // 1147
  const IMG_1_1 = IMAGE_SPECS.aspectRatio_1_1.height;    // 860
  const IMG_16_9 = IMAGE_SPECS.aspectRatio_16_9.height;  // 484

  switch (sectionType) {
    // ────────────────────────────────────────────────────── Hook Zone ──── //

    case ProSectionType.HOOK_3STEP: {
      addText('hook_text', str(content.hook), 'body', palette.primary);
      gap(SPACING.h3ToH1);
      addText('benefit_headline', str(content.benefitHeadline), 'h1', palette.textHighlight);
      gap(SPACING.h1ToBody);
      addText('sub_benefit', str(content.subBenefit), 'body');
      if (imgSrc) { gap(SPACING.captionToImage); addImage('hero_image', imgSrc, 'hero', IMG_3_4); }
      break;
    }

    // ── 인증 섹션 빌더 — 다크 배경, 골드 배지, 공식 판매처 카피 ──
    case ProSectionType.CERTIFICATION: {
      const certBadge = sanitizeImageUrl(
        str((extra?.allImages ?? {})['certification_badge']) || imgSrc,
      );
      const brandName = extra?.brandName ?? '';
      const certTitle = str(content.text) || `${brandName} 정품 인증`;
      const certSub = str(content.subtitle) || '';
      const certHighlight = str(content.highlightText) || '';
      const certBullets: string[] = Array.isArray(content.bulletPoints)
        ? (content.bulletPoints as string[])
        : [];
      const certWarning = str(content.warningText) || '';
      const certBadgesText = str(content.certBadgesText) || '';

      let yPos = 50;

      // 실측 정합(★별점 트랙 동일 클래스): 기존 고정 높이(50/80/40/28)는
      // h2 60px·body 45px 실측(78/76~153/78/42)과 크게 어긋나 마운트 reflow가
      // 섹션 전체를 수십 px 밀었다 → 실제 wrap 기반 높이 + 그만큼 yPos 전진.
      // P1-4: makeTextEl이 부여할 유효 행간(멀티라인 자동 완화 포함)과 동일하게 계산
      const certTitleLH = resolveAutoLineHeight(certTitle, 'h2', 60, 500, getLetterSpacing('h2'));
      const certTitleH = Math.ceil(60 * certTitleLH * estimateWrappedLines(certTitle, 60, 500));
      elements.push(
        makeTextEl(
          'cert_title', certTitle,
          'h2', 60, yPos, 500, palette.textMain, 'left', 2,
          { fontWeight: 700, height: certTitleH, ...H2_TITLE_FONT },
        ),
      );
      yPos += certTitleH + 10;

      // 서브카피: 신뢰 메시지
      if (certSub) {
        const certSubH = Math.ceil(45 * 1.7 * estimateWrappedLines(certSub, 45, 500));
        elements.push(
          makeTextEl(
            'cert_sub', certSub,
            'body', 60, yPos, 500, '#999999', 'left', 4,
            { height: certSubH },
          ),
        );
        yPos += certSubH + 10;
      }

      // 강조 텍스트: "100% 정품 보증"
      if (certHighlight) {
        const certHighlightLH = resolveAutoLineHeight(certHighlight, 'h2', 60, 460, getLetterSpacing('h2'));
        const certHighlightH = Math.ceil(60 * certHighlightLH * estimateWrappedLines(certHighlight, 60, 460));
        elements.push(
          makeTextEl(
            'cert_highlight', certHighlight,
            'h2', 60, yPos, 460, '#f0d060', 'left', 1,
            { fontWeight: 700, height: certHighlightH },
          ),
        );
        yPos += certHighlightH + 10;
      }

      // 불릿 포인트 (caption 28×1.5 = 42px/행)
      certBullets.forEach((bp, i) => {
        const bulletH = Math.ceil(28 * 1.5 * estimateWrappedLines(`✓ ${bp}`, 28, 460));
        elements.push(
          makeTextEl(
            `cert_bullet_${i}`, `✓ ${bp}`,
            'caption', 60, yPos, 460, 'rgba(255,255,255,0.75)', 'left', 2,
            { height: bulletH },
          ),
        );
        yPos += bulletH + 6;
      });

      // 배지 이미지 — 우측, 텍스트와 나란히
      if (certBadge) {
        elements.push(
          makeImageEl('cert_badge', certBadge, 'certification_badge',
                      560, 110, 200, 200, 1, 'contain'),
        );
      }

      // 인증 배지 텍스트 (KC | FDA | ISO) — caption 실측 42px 정합
      if (certBadgesText) {
        elements.push(
          makeTextEl(
            'cert_badges', certBadgesText,
            'caption', 60, yPos + 10, 700, palette.primary || '#c9a94e', 'center', 2,
            { fontWeight: 600, height: 42 },
          ),
        );
        yPos += 58;
      }

      // 경고 문구
      if (certWarning) {
        const certWarningH = Math.ceil(28 * 1.5 * estimateWrappedLines(`※ ${certWarning}`, 28, 700));
        elements.push(
          makeTextEl(
            'cert_warning', `※ ${certWarning}`,
            'caption', 60, yPos + 10, 700, '#777777', 'center', 2,
            { height: certWarningH },
          ),
        );
      }
      break;
    }

    case ProSectionType.EVENT_BANNER: {
      addText('event_title', str(content.text) || '프로모션 이벤트', 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
      if (imgSrc) addImage('event_banner_img', imgSrc, 'event_banner', IMG_16_9);
      break;
    }

    // ── 수정 2: 완판 — opacity 0.45 + AI 문구 ──
    case ProSectionType.PERFORMANCE_SALES: {
      const countText = str(content.text);
      const subtitleText = str(content.subtitle);
      if (imgSrc) {
        const BANNER_H = IMG_16_9; // 484px — 섹션 높이 = 이미지 높이
        const MID_Y = Math.floor(BANNER_H / 2);
        const bgImg = makeImageEl('sold_out_bg', imgSrc, 'sold_out_banner', 0, 0, CANVAS_WIDTH, BANNER_H, 1);
        bgImg.opacity = 1;
        elements.push(bgImg);
        const headlineH = estimateTextHeight(countText || '완판', 'display');
        const subH = subtitleText ? estimateTextHeight(subtitleText, 'caption') : 0;
        const totalTextH = headlineH + (subtitleText ? 20 + subH : 0);
        const textStartY = MID_Y - Math.floor(totalTextH / 2);
        if (countText) {
          elements.push(
            // B-2: 흰 텍스트가 이미지 위에 직접 얹히므로 .sold-out-main 그림자 이식
            makeTextEl('perf_count', countText, 'display', SIDE_PADDING, textStartY, CONTENT_WIDTH, '#FFFFFF', 'center', 3, { ...OVERLAY_HEADING_SHADOW }),
          );
        }
        if (subtitleText) {
          elements.push(
            makeTextEl('perf_subtitle', subtitleText, 'caption', SIDE_PADDING, textStartY + headlineH + 20, CONTENT_WIDTH, 'rgba(255,255,255,0.85)', 'center', 3, { ...OVERLAY_BODY_SHADOW }),
          );
        }
        y = BANNER_H;
      } else {
        if (countText) addText('perf_count', countText, 'display', palette.primary);
        if (subtitleText) addText('perf_subtitle', subtitleText, 'caption', palette.textMain);
      }
      break;
    }

    // ── 수정 3 + c10: 평점 — AI 배경 + 원형 뱃지 + 큰 숫자 + SVG 별점 밀착 ──
    case ProSectionType.PERFORMANCE_RATING: {
      const avgRating = str(content.avgRating) || '5.0';
      const ratingBg = sanitizeImageUrl(str((extra?.allImages ?? {})['rating_bg']));
      const brandRgbRating = hexToRgb(palette.primary);

      // AI 배경 이미지 (opacity 0.18)
      if (ratingBg) {
        const bgEl = makeImageEl('rating_bg', ratingBg, 'rating_bg', 0, 0, CANVAS_WIDTH, 500, 1);
        bgEl.opacity = 0.18;
        elements.push(bgEl);
      }

      // c10: 원형 뱃지 배경 (숫자 뒤)
      // T6 정합: 레이블 y=SECTION_TOP_PAD 기준 상대 오프셋(기존 100 기준 +45/+80/+250/+340 유지)
      const ratingLabelY = SECTION_TOP_PAD;
      elements.push(makeShapeEl(
        'rating_circle_bg', 'circle',
        CANVAS_WIDTH / 2 - 120, ratingLabelY + 45, 240, 240,
        {
          fill: `rgba(${brandRgbRating}, 0.06)`,
          stroke: `rgba(${brandRgbRating}, 0.15)`,
          strokeWidth: 2,
          cx: CANVAS_WIDTH / 2,
          cy: ratingLabelY + 165,
          radius: 120,
        },
        1,
      ));

      // 레이블 — 팔레트 연동(기존 머스터드 골드 #7a6520 → 브랜드 컬러)
      elements.push(
        makeTextEl('rating_label', '구매 만족도', 'caption', SIDE_PADDING, ratingLabelY, CONTENT_WIDTH, palette.primary, 'center', 2, { height: 42 }),
      );
      // 큰 평점 숫자 — 팔레트 연동(기존 골드 #8B6914 → 브랜드 컬러)
      elements.push(
        makeTextEl('rating_number', avgRating, 'display', SIDE_PADDING, ratingLabelY + 80, CONTENT_WIDTH, palette.primary, 'center', 2, { fontSize: 120, fontWeight: 900, height: 138 }),
      );
      // SVG 별점 — 범용 평점 앰버(선명한 #FBBF24, 팔레트 무관하게 '별점'으로 읽힘)
      const starSvg = buildStarsSvg(parseFloat(avgRating), { size: 40, color: RATING_STAR_COLOR, gap: 8 });
      elements.push(
        makeSvgEl('rating_stars', starSvg, 260, ratingLabelY + 250, 340, 50, 2),
      );
      y = ratingLabelY + 340;
      break;
    }

    // ── 수정 C-3: 리뷰 카드 — 52px 아바타 + 이름+별점 + 텍스트 + 배지 (목업 06번) ──
    case ProSectionType.PERFORMANCE_REVIEWS: {
      // 원시 리뷰 데이터: specSheet.reviews 우선, 없으면 reviewHighlights
      const rawReviews = (
        (extra?.specSheet?.reviews as Array<Record<string, unknown>> | undefined) ??
        (content.reviews as Array<Record<string, unknown>>) ??
        []
      );
      const totalReviewCount = rawReviews.length;
      const reviewCountText = str(content.reviewCountText);

      // 트랙 4 D-1: 하드코딩 상수 → REVIEW_CARD_DEFAULTS 토큰 + 프리셋/사용자 오버라이드
      const RC = { ...REVIEW_CARD_DEFAULTS, ...(extra?.cardParams ?? {}) };
      const MAX_REVIEW_CARDS = RC.maxCards;
      // 아바타 배경 — 팔레트 무관 중립 톤(기존 크림/골드 계열 → 어떤 팔레트에도 어울리는 뉴트럴)
      const AVATAR_COLORS = ['#EEF0F3', '#E7EAEE', '#F0EDF1', '#E9EEF0', '#EDEBEF'];
      const brandRgbReview = hexToRgb(palette.primary);
      const CARD_GAP = RC.gap;
      const CARD_PADDING = RC.padding;
      const AVATAR_SIZE = RC.avatarSize;
      const AVATAR_RADIUS = RC.avatarRadius;
      const CARD_MX = RC.marginX;
      const CARD_W = CANVAS_WIDTH - CARD_MX * 2;  // 기본 780

      // ── 헤더
      // T6 정합: 레이블 y=SECTION_TOP_PAD, 카드 시작은 레이블 하단(+42) + 기존 갭(38) 유지
      const reviewLabelY = SECTION_TOP_PAD;
      elements.push(
        makeTextEl('review_count_label', '실제 구매 후기', 'caption', SIDE_PADDING, reviewLabelY, CONTENT_WIDTH, palette.primary, 'center', 2, { height: 42 }),
      );
      // ── 리뷰 카드 (동적 높이)
      const selectedReviews = rawReviews.slice(0, MAX_REVIEW_CARDS);
      const maxTextW = CARD_W - CARD_PADDING * 2;  // 기본 732
      const RV_FONT = RC.bodyFontSize;
      const RV_LINE_H = RC.bodyLineHeight;
      let cardY = reviewLabelY + 80;

      selectedReviews.forEach((review, i) => {
        const author = str(review['author'] ?? review['작성자'] ?? '구매고객');
        const rawText = str(review['text'] ?? review['내용'] ?? review['review_text'] ?? '');
        const highlights = review['highlights'] as string[] | undefined;
        const highlight = highlights?.[0] ?? str(review['highlight'] ?? '');
        const initial = author.charAt(0);
        const displayText = `"${rawText}"`;

        // ★별점 트랙: 텍스트 높이 추정 — 실제 렌더 문자열(따옴표 포함)을
        // 한글 인지 wrap 추정기로 계산. 기존 0.55em 근사는 한글 줄 수를
        // 최대 절반으로 과소추정 → 3줄 리뷰가 카드박스를 44px 이탈하고
        // 이후 카드 전체(별점 포함)가 생성 좌표에서 +44px 밀렸다.
        const textLines = estimateWrappedLines(displayText, RV_FONT, maxTextW);
        const textH = Math.ceil(textLines * RV_FONT * RV_LINE_H);

        // 카드 전체 높이: 상단패딩 + 아바타행(max(avatar,name+stars)) + 간격 + 텍스트 + 배지행 + 하단패딩
        const headerRowH = Math.max(AVATAR_SIZE, 42 + 32);  // 아바타 vs 이름(28px)+별점(24px)
        const badgeH = highlight ? 38 : 0;
        const cardH = CARD_PADDING + headerRowH + 16 + textH + (badgeH > 0 ? 12 + badgeH : 0) + CARD_PADDING;

        // 카드 자식 요소를 먼저 생성해 실제 id를 확보한다 (containerOf는 id 기반)
        const avatarX = CARD_MX + CARD_PADDING;
        const avatarY = cardY + CARD_PADDING;
        const nameX = avatarX + AVATAR_SIZE + 16;
        const textY = cardY + CARD_PADDING + headerRowH + 16;

        const cardChildren: CanvasElement[] = [
          // 아바타 (둥근 사각형 52×52)
          makeShapeEl(
            `review_avatar_${i}`,
            'roundedRect',
            avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE,
            { fill: AVATAR_COLORS[i % AVATAR_COLORS.length], borderRadius: AVATAR_RADIUS },
            2,
          ),
          // 아바타 이니셜 — 52px 아바타 원 내부 고정 지오메트리 (하한 예외)
          makeTextEl(
            `review_initial_${i}`, initial, 'body',
            avatarX, avatarY + Math.floor((AVATAR_SIZE - 45) / 2), AVATAR_SIZE, palette.primary, 'center', 3,
            { fontSize: 22, fontWeight: 700, height: 37, allowBelowMin: true },
          ),
          // 이름 (28px) — 폭은 카드 우측 내부 패딩까지로 제한
          makeTextEl(
            `review_author_${i}`, `${author} 고객님`, 'caption',
            nameX, avatarY, CARD_W - CARD_PADDING * 2 - AVATAR_SIZE - 16, palette.textMain, 'left', 2,
            { fontSize: 28, fontWeight: 500, height: 40 },
          ),
          // 별점 (★★★★★, 24px) — 범용 평점 앰버, 기호 행: 하한 예외
          makeTextEl(
            `review_stars_${i}`, '★★★★★', 'caption',
            nameX, avatarY + 42, 180, RATING_STAR_COLOR, 'left', 2,
            { fontSize: 24, height: 32, allowBelowMin: true },
          ),
          // 리뷰 텍스트 (28px)
          makeTextEl(
            `review_text_${i}`, displayText, 'caption',
            CARD_MX + CARD_PADDING, textY, maxTextW, palette.textMain, 'left', 2,
            { fontSize: RV_FONT, lineHeight: RV_LINE_H, height: textH },
          ),
          // 키워드 배지 (28px, palette.primary)
          ...(highlight ? [makeTextEl(
            `review_badge_${i}`, highlight, 'caption',
            CARD_MX + CARD_PADDING, textY + textH + 12, 320, palette.primary, 'left', 2,
            { fontSize: 28, fontWeight: 500, height: badgeH },
          )] : []),
        ];

        // 카드 배경 (흰색 라운드, borderRadius:20)
        // B-2: .review-card-bubble box-shadow 이식 — 카드 입체감 정합
        const reviewCardBg = makeShapeEl(
          `review_card_bg_${i}`,
          'roundedRect',
          CARD_MX, cardY, CARD_W, cardH,
          { fill: '#FFFFFF', stroke: `rgba(${brandRgbReview}, 0.18)`, strokeWidth: 1, borderRadius: 20 },
          1,
        );
        reviewCardBg.shadow = { ...SEMANTIC_TYPOGRAPHY.reviewCardShadow };
        // 컨테이너 연동 — 자식 텍스트 실측 성장 시 reflowSection이 카드 높이를
        // 함께 확장한다 (추정 오차 발생 시 본문이 카드 테두리를 뚫는 겹침 방지)
        reviewCardBg.containerOf = cardChildren.map((c) => c.id);
        elements.push(reviewCardBg, ...cardChildren);

        cardY += cardH + CARD_GAP;
      });

      y = cardY + 30;
      break;
    }

    case ProSectionType.PRODUCT_EXPOSURE: {
      addText('pe_headline', str(content.headline), 'h2', palette.textMain, 'center', 2, { ...H2_TITLE_FONT });
      const subCopy = str(content.subCopy);
      if (subCopy) {
        gap(SPACING.h1ToBody);
        addText('pe_sub', subCopy, 'body', palette.textMain);
      }
      if (imgSrc) { gap(SPACING.captionToImage); addImage('product_img', imgSrc, 'product_exposure', IMG_3_4); }
      break;
    }

    case ProSectionType.PERFORMANCE_REVIEW: {
      // perf_reviews에 통합됨 — 요소 생략 → isSectionValid에서 필터
      break;
    }

    case ProSectionType.EVENT_BUNDLE: {
      addText('bundle_title', str(content.text) || '세트 구성', 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
      if (imgSrc) addImage('bundle_img', imgSrc, 'bundle_arrangement', IMG_3_4);
      break;
    }

    case ProSectionType.EVENT_DISCOUNT: {
      addText('discount_title', str(content.text) || '특별 할인', 'h1', palette.primary);
      addText('discount_sub', '오늘만 특별가', 'body', palette.textMain);
      break;
    }

    case ProSectionType.EVENT_OPTION: {
      addText('option_title', str(content.title), 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
      const opts = (content.options as string[]) ?? [];
      opts.slice(0, 5).forEach((opt, i) => {
        addText(`option_${i}`, opt, 'body');
        gap(10);
      });
      if (imgSrc) { gap(SPACING.captionToImage); addImage('option_img', imgSrc, 'options', IMG_3_4); }
      break;
    }

    // ──────────────────────────────────────────── Problem Framing ──── //

    // ── V4.8-B1: 세로 누적형 스텝 (raise_stacked_steps) ──
    case ProSectionType.PROBLEM_RAISE: {
      // trailing comma 제거: "이런 고민 있으신가요," → "이런 고민 있으신가요?"
      const questionRaw = str(content.question);
      const questionText = questionRaw.replace(/[,，]+$/, '').replace(/[,，]+(\?|！|!)?$/, '?').trim();

      // 타이틀 (질문형, 60px/800 — 동적 높이, 한글 인지 wrap 추정)
      const TITLE_FONT = 60;
      const TITLE_LH = 1.4;
      const titleLines = estimateWrappedLines(questionText, TITLE_FONT, CONTENT_WIDTH);
      const titleH = Math.ceil(TITLE_FONT * TITLE_LH * titleLines);

      elements.push(makeTextEl(
        'problem_question', questionText, 'h2',
        // A-1(섹션 리듬): 상단 패딩 60 → 80 정본화, T6: 80 → 140(×1.75)
        SIDE_PADDING, SECTION_TOP_PAD, CONTENT_WIDTH, palette.primary, 'center', 2,
        { fontWeight: 800, height: titleH, ...H2_TITLE_FONT },
      ));

      // empathyLines 기반 세로 스텝
      const empathyLinesProblem = (content.empathyLines as string[]) ?? [];
      const steps = empathyLinesProblem.length >= 2
        ? empathyLinesProblem.slice(0, 4)
        : ['고민 1', '고민 2', '고민 3', '고민 4'];

      const STEP_START_Y = SECTION_TOP_PAD + titleH + 40; // titleY(T6: SECTION_TOP_PAD) + titleH + gap
      const STEP_MAX_W = 700;
      const STEP_X = Math.floor((CANVAS_WIDTH - STEP_MAX_W) / 2);
      const BORDER_W = 4;
      const STEP_PAD_Y = 28;
      const STEP_FONT = 45;  // 일괄상향: 모바일 본문 하한(45px→20px)
      const STEP_LH = 1.5;
      const brandRgbProblem = hexToRgb(palette.primary);

      // 텍스트 너비 기준으로 줄 수 추정 → 동적 높이 (한글 인지 wrap)
      const STEP_TEXT_W = STEP_MAX_W - 132; // 24+60+24 좌측 + 24 우측
      const estimateLines = (text: string) => estimateWrappedLines(text, STEP_FONT, STEP_TEXT_W);

      let stepCurY = STEP_START_Y;
      steps.forEach((line, idx) => {
        const isLast = idx === steps.length - 1;
        const lines = estimateLines(line);
        const textH = Math.ceil(STEP_FONT * STEP_LH * lines);
        const stepH = textH + STEP_PAD_Y * 2;
        const stepBg = isLast ? `rgba(${brandRgbProblem}, 0.06)` : 'transparent';
        const leftColor = isLast ? palette.primary : '#BBBBBB';

        // 자식 텍스트 먼저 생성 — containerOf는 실제 id 기반
        // 스텝 번호 (01~04) — 실측 정합: 단일행 45px×1.5 = 68px
        // (기존 height:textH는 스텝 '본문' 높이를 재사용해 실측과 불일치
        //  → reflow가 아래 스텝을 밀어 박스-텍스트 어긋남 발생)
        const stepNum = String(idx + 1).padStart(2, '0');
        const stepNumEl = makeTextEl(
          `step_num_${idx}`, stepNum, 'body',
          STEP_X + 24, stepCurY + STEP_PAD_Y, 68, leftColor, 'left', 3,
          { fontSize: 45, fontWeight: 800, lineHeight: 1.5, height: 68 },
        );
        const stepTextEl = makeTextEl(
          `step_text_${idx}`, line, 'body',
          STEP_X + 108, stepCurY + STEP_PAD_Y, STEP_TEXT_W, palette.textMain, 'left', 3,
          { fontSize: STEP_FONT, fontWeight: isLast ? 700 : 400, lineHeight: STEP_LH, height: textH },
        );
        const stepChildIds = [stepNumEl.id, stepTextEl.id];

        // 배경 rect — 컨테이너 연동: 스텝 텍스트 실측 성장 시 박스도 함께 확장
        const stepBgEl = makeShapeEl(
          `step_bg_${idx}`, 'rect',
          STEP_X, stepCurY, STEP_MAX_W, stepH,
          { fill: stepBg },
          1,
        );
        stepBgEl.containerOf = stepChildIds;
        // 좌측 border (4px) — 박스와 동일하게 연동
        const stepBorderEl = makeShapeEl(
          `step_border_${idx}`, 'rect',
          STEP_X, stepCurY, BORDER_W, stepH,
          { fill: leftColor },
          2,
        );
        stepBorderEl.containerOf = stepChildIds;
        elements.push(stepBgEl, stepBorderEl, stepNumEl, stepTextEl);
        stepCurY += stepH;
      });

      y = stepCurY + 40;

      // 이미지
      if (imgSrc) {
        gap(SPACING.captionToImage);
        addImage('problem_img', imgSrc, 'problem', IMG_3_4);
      }
      break;
    }

    // ── V4.8-B2: 좌우 교차 베이지 말풍선 ──
    case ProSectionType.PROBLEM_EMPATHY: {
      const empathyLines = (content.empathyLines as string[]) ?? [];
      const empathyFallback = str(content.empathy);

      let bubbles = empathyLines.length > 0
        ? empathyLines
        : (empathyFallback ? [empathyFallback] : []);

      // 최소 3개 보장 (백엔드 동기화)
      if (bubbles.length < 3) {
        const subCopy = str(content.sub_copy);
        if (subCopy) {
          const splits = subCopy.replace(/\./g, '.\n').split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
          for (const s of splits) {
            if (!bubbles.includes(s)) bubbles.push(s);
            if (bubbles.length >= 3) break;
          }
        }
      }
      if (bubbles.length < 2) {
        bubbles = [
          '머리카락이 자꾸 엉켜서 스트레스예요',
          '두피가 딱딱하게 굳어서 머리가 무거워요',
          '빗질할 때마다 따끔해서 손이 안 가요',
          '어깨까지 뻣뻣한데 뭘 해야 할지 모르겠어요',
        ];
      }

      // 상단 안내 텍스트
      elements.push(makeTextEl(
        'empathy_header', '이런 생각, 해보신 적 있으시죠?', 'caption',
        SIDE_PADDING, y, CONTENT_WIDTH, '#999999', 'center', 2,
        { fontSize: 32, height: 48 },
      ));
      y += 96; // 48 header + 48 margin

      const brandRgbEmpathy = hexToRgb(palette.primary);
      const BUBBLE_MAX_W = Math.floor(CANVAS_WIDTH * 0.75);
      const BUBBLE_PAD = 24;
      const BUBBLE_PAD_X = 36;
      const BUBBLE_FONT = 45;  // 일괄상향: 모바일 본문 하한(45px→20px)
      const BUBBLE_LH = 1.5;
      const BUBBLE_GAP = 20;
      const BUBBLE_TEXT_W = BUBBLE_MAX_W - BUBBLE_PAD_X * 2;

      // 텍스트 줄 수 기반 동적 높이 (한글 인지 wrap — 말풍선 bg는 shape라
      // reflow가 못 늘리므로 생성 시점 추정이 정확해야 이탈이 없다)
      const estimateBubbleLines = (text: string) => estimateWrappedLines(text, BUBBLE_FONT, BUBBLE_TEXT_W);

      bubbles.slice(0, 4).forEach((line, i) => {
        const isRight = i % 2 === 0;  // 짝수: 오른쪽 (백엔드 동일)
        const bx = isRight ? CANVAS_WIDTH - BUBBLE_MAX_W - 50 : 50;
        const displayText = `\u201C${line}\u201D`;
        const lines = estimateBubbleLines(displayText);
        const textH = Math.ceil(BUBBLE_FONT * BUBBLE_LH * lines);
        const bubbleH = textH + BUBBLE_PAD * 2;

        // 팔레트 기반 말풍선: 짝수(우) 진하게, 홀수(좌) 연하게
        const bubbleFill = isRight
          ? `rgba(${brandRgbEmpathy}, 0.08)`
          : `rgba(${brandRgbEmpathy}, 0.04)`;

        const bubbleTextEl = makeTextEl(
          `bubble_text_${i}`, displayText, 'body',
          bx + BUBBLE_PAD_X, y + BUBBLE_PAD, BUBBLE_TEXT_W, palette.textMain, 'left', 3,
          { fontSize: BUBBLE_FONT, fontWeight: 400, lineHeight: BUBBLE_LH, height: textH },
        );
        const bubbleBgEl = makeShapeEl(
          `bubble_bg_${i}`, 'roundedRect',
          bx, y, BUBBLE_MAX_W, bubbleH,
          { fill: bubbleFill, borderRadius: 24 },
          2,
        );
        // 컨테이너 연동 — 말풍선 텍스트 실측 성장 시 배경도 함께 확장 (id 기반)
        bubbleBgEl.containerOf = [bubbleTextEl.id];
        elements.push(bubbleBgEl, bubbleTextEl);
        y += bubbleH + BUBBLE_GAP;
      });

      y += 30;
      break;
    }

    case ProSectionType.DIRECTION_SUGGEST: {
      addText('direction_text', str(content.headline), 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
      const subCopy = str(content.subCopy);
      if (subCopy) {
        gap(SPACING.h1ToBody);
        addText('direction_sub', subCopy, 'body', palette.textMain);
      }
      if (imgSrc) { gap(SPACING.captionToImage); addImage('direction_img', imgSrc, 'direction_hint', IMG_3_4); }
      break;
    }

    case ProSectionType.SOLUTION_GUIDE: {
      addText('solution_text', str(content.summary), 'body', palette.textMain);
      if (imgSrc) { gap(SPACING.captionToImage); addImage('solution_img', imgSrc, 'solution', IMG_3_4); }
      break;
    }

    case ProSectionType.KEY_MESSAGE: {
      const message = str(content.message);
      let headline = message;
      let subCopy = '';

      if (message.includes('\n')) {
        // §4-3a: BE가 의미 단위 줄바꿈(\n)을 명시한 경우 그 경계를 그대로 존중
        const nl = message.indexOf('\n');
        headline = message.slice(0, nl).trim();
        subCopy = message.slice(nl + 1).replace(/\n+/g, ' ').trim();
      } else if (message.length > 0) {
        // c10: 콤마/마침표 기반 분리 → 20자 제한 강제
        const splitIdx = message.search(/[,，.!?。]/);
        if (splitIdx > 5 && splitIdx < message.length - 2) {
          headline = message.slice(0, splitIdx).trim();
          subCopy = message.slice(splitIdx + 1).trim();
        } else if (message.length > 20) {
          // 카피 문맥 수리(2026-07-11): 기존 lastIndexOf(' ', 20)은 '가장 긴 머리'를
          // 만들어 꼬리가 어절 파편("전시하는 방법")으로 남았다 → 중앙에 가장 가까운
          // 공백에서 분리해 헤드/서브를 균형 배분(§4-2 준용)
          let best = -1;
          for (let sp = message.indexOf(' '); sp !== -1 && sp <= 20; sp = message.indexOf(' ', sp + 1)) {
            if (best === -1 || Math.abs(sp - message.length / 2) < Math.abs(best - message.length / 2)) best = sp;
          }
          headline = best > 5 ? message.slice(0, best) : message.slice(0, 20);
          subCopy = message.slice(headline.length).trim();
        }
      }
      // 20자 초과분은 서브카피로 이월 — 절단이 아니라 이월이므로 카피 소실 없음
      if (headline.length > 20) {
        subCopy = headline.slice(20).trim() + (subCopy ? ' ' + subCopy : '');
        headline = headline.slice(0, 20);
      }

      const ink = contrastInkForHex(palette.primary);
      y = SECTION_TOP_PAD;
      // addText는 레벨(h1=90px) 추정으로 y를 전진시켜 68px 실렌더와 어긋난 공백을 만든다
      // — 실측 높이로 직접 push + 수동 전진 (컬러 블록 내부 겹간격 방지)
      const keyHeadH = Math.max(82, measureTextBlock(headline, 68, 1.2));
      elements.push(makeTextEl(
        'key_headline', headline, 'h1',
        SIDE_PADDING, y, CONTENT_WIDTH, ink, 'center', 2,
        { fontSize: 68, lineHeight: 1.2, height: keyHeadH },
      ));
      y += keyHeadH + SPACING.bodyToCaption;
      if (subCopy) {
        gap(SPACING.h1ToBody);
        addText('key_sub', subCopy, 'body', ink);
      }
      const blockHeight = y + SECTION_TOP_PAD;
      elements.unshift(makeShapeEl(
        'key_msg_bg', 'rect',
        0, 0, CANVAS_WIDTH, blockHeight,
        { fill: palette.primary }, 0,
      ));
      y = blockHeight;
      break;
    }

    // ──────────────────────────────────────────── USP Value Delivery ── //

    // ── Task 2: 후킹 문구를 hero 위로 + Task 3: USP SVG 아이콘 ──
    case ProSectionType.MAIN_CUT: {
      const heroFrameId = extra?.hookStrategy?.hero_frame || 'wave_wide';
      const frame = getHeroFrame(heroFrameId);
      const heroImageHeight = IMG_3_4;

      // A-1(섹션 리듬): 상단 패딩 80 정본화 — c12의 40 시작(y -= 40)을 폐기,
      // 전 섹션 시작 y=80으로 통일해 경계 리듬 160을 만든다

      // ── 카피 먼저 (후킹 문구 → 부제 → hero → USP 순서) ──
      const headlineText = str(content.headline);
      const descText = str(content.description);
      if (headlineText) {
        const headlineH = Math.max(130, measureTextBlock(headlineText, 64, 1.3));
        elements.push(makeTextEl(
          'main_cut_headline', headlineText, 'h2',
          SIDE_PADDING, y, CONTENT_WIDTH, '#1a1611', 'center', 2,
          { fontSize: 64, fontWeight: 800, height: headlineH, lineHeight: 1.3, ...H2_TITLE_FONT },
        ));
        y += headlineH + 20;
      }
      if (descText) {
        const descH = Math.max(50, measureTextBlock(descText, 28, 1.5) + 20);
        elements.push(makeTextEl(
          'main_cut_desc', descText, 'caption',
          SIDE_PADDING, y, CONTENT_WIDTH, palette.primary, 'center', 2,
          { fontSize: 28, lineHeight: 1.5, height: descH },
        ));
        y += descH;
      }

      // hero 이미지 (텍스트 아래)
      if (imgSrc) {
        gap(20);
        const heroY = y;
        if (frame.clipPath) {
          // 프레임 있음: clipPath 적용 + 골드 테두리
          const frameBgColor = frame.bgColor === 'dark' ? '#1a1611' : '#F5F0E8';
          elements.push(
            makeFramedImageEl(
              'main_cut_hero',
              imgSrc,
              frame.id,
              frame.clipPath,
              frame.viewBox,
              frameBgColor,
              0, heroY, CANVAS_WIDTH, heroImageHeight,
              1,
            ),
          );
          // Task 2: borderPath SVG 장식 제거 (export HTML에 불필요한 blob SVG 노출 방지)
        } else {
          // studio: 풀블리드
          elements.push(makeImageEl('main_cut_img', imgSrc, 'premium_hero', 0, heroY, CANVAS_WIDTH, heroImageHeight, 1));
        }
        y = heroY + heroImageHeight + 40;  // hero↔USP 간격 압축 (110→40px)
      }

      // c12: USP 2×2 그리드 (기존 4-in-a-row → 2열 2행)
      const pointCards = (content.pointCards as Array<{ title: string; description: string }>) ?? [];
      const uspItems = pointCards.slice(0, 4);
      if (uspItems.length > 0) {
        gap(40);  // USP 전 간격 압축 (h1ToBody=90 → 40px)
        const USP_CELL_W = 390;
        const USP_SUB_W = USP_CELL_W - 20;
        // 카피 소실 금지(2026-07-11): 기존 '2줄 초과 시 글자 단위 절삭' 루프가 설명
        // 꼬리를 잘랐다 → 설명 전문을 보존하고, 가장 긴 설명 기준으로 셀 높이를
        // 동적 산출해 2×2 그리드 정렬과 셀 내 수납을 동시에 유지한다.
        // (레이아웃: 아이콘 16+80 → 라벨 108+54 → 설명 174+H → 하단 여백 16)
        const uspSubHs = uspItems.map((u) =>
          u.description
            ? Math.ceil(estimateWrappedLines(u.description, 28, USP_SUB_W) * 28 * 1.4)
            : 0,
        );
        const USP_CELL_H = Math.max(260, 174 + Math.max(...uspSubHs) + 16);
        const USP_GAP = 24;
        const USP_X = Math.floor((CANVAS_WIDTH - USP_CELL_W * 2 - USP_GAP) / 2);
        const ICON_SIZE = 80;
        const brandRgbUsp = hexToRgb(palette.primary);
        // V4.12.1: usp_icons 실제 이미지 지원
        const uspIconArr = (extra?.allImages ?? {})['usp_icons'];
        // V4.12.4: hero URL 오염 방지 — hero/premium_hero와 동일한 URL은 SVG fallback
        const heroUrls = new Set<string>();
        const _allImgs = extra?.allImages ?? {};
        if (_allImgs['hero']) heroUrls.add(String(_allImgs['hero']));
        if (_allImgs['premium_hero']) heroUrls.add(String(_allImgs['premium_hero']));

        uspItems.forEach((usp, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const cellX = USP_X + col * (USP_CELL_W + USP_GAP);
          const cellY = y + row * (USP_CELL_H + USP_GAP);

          // 셀 자식(아이콘/제목/설명)을 먼저 생성 — containerOf는 실제 id 기반
          const cellChildren: CanvasElement[] = [];

          // 아이콘: usp_icons 실제 이미지 우선, 없으면 SVG fallback
          const iconX = cellX + Math.floor((USP_CELL_W - ICON_SIZE) / 2);
          const rawUspUrl = Array.isArray(uspIconArr) && uspIconArr[i] ? sanitizeImageUrl(uspIconArr[i] as string) : '';
          const uspIconUrl = rawUspUrl && !heroUrls.has(rawUspUrl) ? rawUspUrl : '';
          if (uspIconUrl) {
            cellChildren.push(makeImageEl(
              `usp_icon_${i}`, uspIconUrl, `usp_icon_${i}`,
              iconX, cellY + 16, ICON_SIZE, ICON_SIZE, 3, 'cover',
            ));
          } else {
            cellChildren.push(makeSvgEl(
              `usp_icon_${i}`,
              getUSPSvgString(usp.title, palette.primary),
              iconX, cellY + 16,
              ICON_SIZE, ICON_SIZE, 3,
            ));
          }

          // 제목 — 아이콘 아래 중앙 정렬
          cellChildren.push(makeTextEl(
            `usp_label_${i}`, usp.title, 'caption',
            cellX + 10, cellY + 108, USP_CELL_W - 20, palette.primary, 'center', 3,
            { fontSize: 36, fontWeight: 700, height: 54 },
          ));

          // 설명 — 제목 아래 중앙 정렬, 전문 보존 (셀 높이가 최장 설명 기준 동적)
          if (usp.description) {
            cellChildren.push(makeTextEl(
              `usp_sub_${i}`, usp.description, 'caption',
              // B-2(섹션 리듬): 라벨(bottom 162)→설명 갭 2 → 12px (y 164 → 174)
              cellX + 10, cellY + 174, USP_SUB_W, '#666666', 'center', 3,
              { fontSize: 28, height: uspSubHs[i], lineHeight: 1.4 },
            ));
          }

          // 셀 배경 — 컨테이너 연동: 셀 내부 텍스트 실측 성장 시 셀도 함께 확장
          const uspCellEl = makeShapeEl(
            `usp_cell_${i}`, 'roundedRect',
            cellX, cellY, USP_CELL_W, USP_CELL_H,
            { fill: `rgba(${brandRgbUsp}, 0.04)`, stroke: `rgba(${brandRgbUsp}, 0.1)`, strokeWidth: 1, borderRadius: 16 },
            2,
          );
          uspCellEl.containerOf = cellChildren.map((c) => c.id);
          elements.push(uspCellEl, ...cellChildren);
        });

        y += Math.ceil(uspItems.length / 2) * (USP_CELL_H + USP_GAP);
      }
      break;
    }

    case ProSectionType.CONCEPT_DESC: {
      const conceptTitle = str(content.title);
      const conceptDesc = str(content.description);
      if (imgSrc) {
        // c12: 이미지 풀블리드 + 반투명 오버레이 + 흰색 텍스트 on top (에어퍼프 패턴)
        const OVERLAY_H = IMG_3_4;
        elements.push(makeImageEl('concept_img', imgSrc, 'concept_mood', 0, 0, CANVAS_WIDTH, OVERLAY_H, 1));
        elements.push(makeShapeEl(
          'concept_overlay', 'rect',
          0, 0, CANVAS_WIDTH, OVERLAY_H,
          { fill: 'rgba(0,0,0,0.42)' }, 2,
        ));
        const textStartY = Math.floor(OVERLAY_H * 0.35);
        // F2e(라운드2 P2): .sec-overlay h2 line-height 1.3→1.8 정합
        const conceptTitleH = conceptTitle ? Math.max(130, measureTextBlock(conceptTitle, 60, 1.8)) : 0;
        if (conceptTitle) {
          elements.push(makeTextEl(
            'concept_title_overlay', conceptTitle, 'h2',
            SIDE_PADDING, textStartY, CONTENT_WIDTH, '#FFFFFF', 'center', 3,
            // B-2: .sec-overlay h2 정합 — GmarketSansBold + 헤딩 그림자
            { fontSize: 60, fontWeight: 800, height: conceptTitleH, lineHeight: 1.8, ...H2_TITLE_FONT, ...OVERLAY_HEADING_SHADOW },
          ));
        }
        if (conceptDesc) {
          const conceptDescH = Math.max(100, measureTextBlock(conceptDesc, 45, 1.5));
          elements.push(makeTextEl(
            'concept_desc_overlay', conceptDesc, 'body',
            SIDE_PADDING, textStartY + conceptTitleH + 20, CONTENT_WIDTH, 'rgba(255,255,255,0.85)', 'center', 3,
            { fontSize: 45, height: conceptDescH, lineHeight: 1.5, ...OVERLAY_BODY_SHADOW },
          ));
        }
        y = OVERLAY_H;
      } else {
        addText('concept_title', conceptTitle, 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
        gap(SPACING.h1ToBody);
        addText('concept_desc_text', conceptDesc, 'body');
      }
      break;
    }

    case ProSectionType.POINT_DIV: {
      // c12: 넘버링 POINT 카드 — ①②③ 뱃지 + 좌측정렬 (유닉스 패턴)
      addSectionHeader('chapter_title', '핵심 포인트');
      const points = (content.points as Array<{ title: string; description: string }>) ?? [];
      const allImgsPoint = extra?.allImages ?? {};
      const featArrPoint = allImgsPoint['features'];
      const BADGE_SIZE = 64;
      const TITLE_X = SIDE_PADDING + BADGE_SIZE + 20;
      const TITLE_W = CANVAS_WIDTH - TITLE_X - SIDE_PADDING;

      points.slice(0, 3).forEach((p, i) => {
        if (i > 0) {
          gap(40);
          addRhythmLine(`point_vline_${i}`);
          gap(40);
        }

        // 넘버 뱃지 (브랜드 컬러 원)
        const badgeY = y;
        elements.push(makeShapeEl(
          `point_badge_${i}`, 'circle',
          SIDE_PADDING, badgeY, BADGE_SIZE, BADGE_SIZE,
          { fill: palette.primary, cx: SIDE_PADDING + BADGE_SIZE / 2, cy: badgeY + BADGE_SIZE / 2, radius: BADGE_SIZE / 2 },
          3,
        ));
        elements.push(makeTextEl(
          `point_num_${i}`, String(i + 1), 'h2',
          SIDE_PADDING, badgeY + 8, BADGE_SIZE, '#FFFFFF', 'center', 4,
          // 64px 원형 뱃지 내부 고정 지오메트리 (하한 예외)
          { fontSize: 36, fontWeight: 700, height: BADGE_SIZE - 17, allowBelowMin: true },
        ));

        // 포인트 제목 (넘버 뱃지 우측, 좌측 정렬)
        elements.push(makeTextEl(
          `point_${i}_title`, p.title, 'h2',
          TITLE_X, badgeY + 4, TITLE_W, palette.textHighlight, 'left', 3,
          { fontSize: 60, fontWeight: 800, height: 78 },
        ));

        // 포인트 설명 (넘버 뱃지 우측, 제목 아래)
        const pointDescH = Math.ceil(45 * 1.5 * estimateWrappedLines(p.description, 45, TITLE_W));
        elements.push(makeTextEl(
          `point_${i}_desc`, p.description, 'body',
          TITLE_X, badgeY + 94, TITLE_W, palette.textMain, 'left', 3,
          { fontSize: 45, height: pointDescH, lineHeight: 1.5 },
        ));

        y = badgeY + 94 + pointDescH + 20;

        // 포인트별 이미지 (feature_00~02)
        const featureKey = `feature_0${i}`;
        const rawImg = allImgsPoint[featureKey];
        let featureImg = sanitizeImageUrl(
          rawImg ? (Array.isArray(rawImg) ? (rawImg[0] ?? '') : rawImg as string) : '',
        );
        if (!featureImg && Array.isArray(featArrPoint) && featArrPoint[i]) {
          featureImg = sanitizeImageUrl(featArrPoint[i] as string) || '';
        }
        if (!featureImg && imgSrc && i === 0) featureImg = imgSrc;
        if (featureImg) {
          gap(SPACING.h1ToBody);
          // c13: point_div 이미지 860→600px (섹션 높이 4022→~2660px)
          addImage(`point_${i}_img`, featureImg, `feature_0${i}`, 600);
        }
      });
      break;
    }

    case ProSectionType.SUB_DIV: {
      // c12: 좌우 교차 지그재그 배치 (에어퍼프 패턴)
      addSectionHeader('sub_chapter_title', str(content.sectionTitle) || '추가 특징');
      const subPoints = (content.points as Array<{ title: string; description: string }>) ?? [];
      const allImgsSub = extra?.allImages ?? {};
      const featArrSub = allImgsSub['features'];

      const HALF_IMG_W = 400;
      const HALF_IMG_H = 400;
      const TEXT_PAD = 40;
      const TEXT_W_SUB = CANVAS_WIDTH - HALF_IMG_W - TEXT_PAD * 2;
      const BLOCK_H = 440;

      subPoints.slice(0, 3).forEach((p, i) => {
        if (i > 0) gap(20);
        const baseY = y;
        const isOdd = i % 2 === 1;

        // sub_div는 features[3~5] 사용 (point_div의 features[0~2]와 중복 해소)
        const subIdx = i + 3;
        const featureKey = `feature_0${subIdx}`;
        const rawImg = allImgsSub[featureKey];
        let featureImg = sanitizeImageUrl(
          rawImg ? (Array.isArray(rawImg) ? (rawImg[0] ?? '') : rawImg as string) : '',
        );
        if (!featureImg && Array.isArray(featArrSub) && featArrSub[subIdx]) {
          featureImg = sanitizeImageUrl(featArrSub[subIdx] as string) || '';
        }
        // fallback: features[3~5] 없으면 features[0~2]로 폴백 (하위호환)
        if (!featureImg && Array.isArray(featArrSub) && featArrSub[i]) {
          featureImg = sanitizeImageUrl(featArrSub[i] as string) || '';
        }

        // 카피 소실 금지(2026-07-11): 기존 15자 절단은 "10개 세트, 공간 전체를[채워요]"처럼
        // 문장 중간을 잘랐다. subTitleH·행 전진(y = baseY + max(...))이 wrap 줄 수 기준이라
        // 전문을 보존해도 겹침 없이 행이 늘어난다
        const subTitle = p.title;

        // 하프 컬럼(380px) 물리 제약 — 제목 48/설명 38px (모바일 21/16.6px, 하한 예외)
        const subTitleH = Math.ceil(48 * 1.4 * estimateWrappedLines(subTitle, 48, TEXT_W_SUB));
        const subDescH = Math.ceil(38 * 1.5 * estimateWrappedLines(p.description, 38, TEXT_W_SUB));
        const subDescY = baseY + 60 + subTitleH + 14;
        if (!isOdd) {
          // 짝수 (0, 2): 좌 이미지 + 우 텍스트
          if (featureImg) {
            elements.push(makeImageEl(
              `sub_${i}_img`, featureImg, `feature_0${subIdx}`,
              0, baseY, HALF_IMG_W, HALF_IMG_H, 1, 'cover',
            ));
          }
          const textX = HALF_IMG_W + TEXT_PAD;
          elements.push(makeTextEl(
            `sub_${i}_title`, subTitle, 'h2',
            textX, baseY + 60, TEXT_W_SUB, palette.textHighlight, 'left', 3,
            { fontSize: 48, fontWeight: 800, lineHeight: 1.4, height: subTitleH, allowBelowMin: true },
          ));
          elements.push(makeTextEl(
            `sub_${i}_desc`, p.description, 'body',
            textX, subDescY, TEXT_W_SUB, '#555555', 'left', 3,
            { fontSize: 38, height: subDescH, lineHeight: 1.5, allowBelowMin: true },
          ));
        } else {
          // 홀수 (1): 좌 텍스트 + 우 이미지
          elements.push(makeTextEl(
            `sub_${i}_title`, subTitle, 'h2',
            TEXT_PAD, baseY + 60, TEXT_W_SUB, palette.textHighlight, 'right', 3,
            { fontSize: 48, fontWeight: 800, lineHeight: 1.4, height: subTitleH, allowBelowMin: true },
          ));
          elements.push(makeTextEl(
            `sub_${i}_desc`, p.description, 'body',
            TEXT_PAD, subDescY, TEXT_W_SUB, '#555555', 'right', 3,
            { fontSize: 38, height: subDescH, lineHeight: 1.5, allowBelowMin: true },
          ));
          if (featureImg) {
            elements.push(makeImageEl(
              `sub_${i}_img`, featureImg, `feature_0${subIdx}`,
              CANVAS_WIDTH - HALF_IMG_W, baseY, HALF_IMG_W, HALF_IMG_H, 1, 'cover',
            ));
          }
        }

        // 텍스트 컬럼이 이미지(400px)보다 길면 실높이로 확장
        y = baseY + Math.max(BLOCK_H, 60 + subTitleH + 14 + subDescH + 40);
      });
      break;
    }

    case ProSectionType.SUB2_DIV_PAGE: {
      // 타이틀 제거 — 해시태그 pill이 직접 렌더링됨
      // A-1(섹션 리듬): 상단 패딩 170(80+90) → 80 정본화 (h1ToBody 가산 제거)
      const tags = (content.tags as string[]) ?? [];
      if (tags.length > 0) {
        const COLS = 2;
        const PILL_W = 330;
        const PILL_H = 70;
        const GAP_X = 30;
        const GAP_Y = 20;
        const START_X = Math.floor((CANVAS_WIDTH - PILL_W * COLS - GAP_X) / 2);
        const START_Y = y;
        const brandRgbTags = hexToRgb(palette.primary);
        const validTags = tags.map(normalizeHashtag).filter(Boolean).slice(0, 6);
        validTags.forEach((normalized, i) => {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const px = START_X + col * (PILL_W + GAP_X);
          const py = START_Y + row * (PILL_H + GAP_Y);
          // pill 배경
          elements.push(makeShapeEl(
            `tag_bg_${i}`, 'roundedRect',
            px, py, PILL_W, PILL_H,
            { fill: `rgba(${brandRgbTags}, 0.06)`, stroke: `rgba(${brandRgbTags}, 0.15)`, strokeWidth: 2, borderRadius: 35 },
            2,
          ));
          // pill 텍스트 — 70px pill 내부 고정 지오메트리 (하한 예외)
          elements.push(makeTextEl(
            `tag_txt_${i}`, normalized, 'body',
            px, py + 10, PILL_W, palette.primary, 'center', 3,
            { fontSize: 34, fontWeight: 500, height: 51, allowBelowMin: true },
          ));
        });
        const rowCount = Math.ceil(validTags.length / COLS);
        y = START_Y + rowCount * (PILL_H + GAP_Y);
      }
      // c14: 태그→이미지 간격 60px (captionToImage:110 → 태그 전용 tagToImage:60)
      if (imgSrc) { gap(60); addImage('usage_img', imgSrc, 'usage', IMG_3_4); }
      break;
    }

    case ProSectionType.HIDDEN_PAGE: {
      // c12: 가로 STEP 카드 — 좌 이미지 + 우 텍스트 (유닉스 패턴, 4960→1600px)
      addSectionHeader('howto_title', '사용 방법');
      const steps = (content.steps as Array<{ step: string; description: string }>) ?? [];
      const allImgsHowto = extra?.allImages ?? {};
      const howtoArr = allImgsHowto['howToImages'];

      const STEP_IMG_SIZE = 360;
      const STEP_TEXT_X = SIDE_PADDING + STEP_IMG_SIZE + 40;
      const STEP_TEXT_W = CANVAS_WIDTH - STEP_TEXT_X - SIDE_PADDING;
      const STEP_BLOCK_H = 420;

      steps.slice(0, 3).forEach((s, i) => {
        if (i > 0) gap(40);
        const baseY = y;

        // STEP별 이미지 (howto_00~02, 좌측 정사각)
        const howtoKey = `howto_0${i}`;
        const rawImg = allImgsHowto[howtoKey];
        let howtoImg = sanitizeImageUrl(
          rawImg ? (Array.isArray(rawImg) ? (rawImg[0] ?? '') : rawImg as string) : '',
        );
        if (!howtoImg && Array.isArray(howtoArr) && howtoArr[i]) {
          howtoImg = sanitizeImageUrl(howtoArr[i] as string) || '';
        }
        if (!howtoImg) {
          const howto0 = sanitizeImageUrl(
            str(allImgsHowto['howto_00']) ||
            (Array.isArray(howtoArr) ? (howtoArr[0] ?? '') : '') as string,
          );
          howtoImg = howto0 || imgSrc || '';
        }
        if (howtoImg) {
          elements.push(makeImageEl(
            `howto_${i}_img`, howtoImg, `howto_0${i}`,
            0, baseY, STEP_IMG_SIZE, STEP_IMG_SIZE, 1, 'cover',
          ));
        }

        // c13: STEP 넘버 — 브랜드 컬러 레이블 (28px, 캡션 하한)
        elements.push(makeTextEl(
          `step_${i}_num_label`, `STEP ${i + 1}`, 'caption',
          STEP_TEXT_X, baseY + 20, STEP_TEXT_W, palette.primary, 'left', 3,
          { fontSize: 28, fontWeight: 700, height: 42 },
        ));

        // c13: 제목 — "Step N —" 제거, 제목만 (STEP 넘버와 중복 방지)
        // 하프 컬럼(340px) 물리 제약 — 48px (모바일 21px, 하한 예외)
        // 실측 정합: 실제 줄 수 기반 높이 (고정 박스면 설명과 겹치고 reflow가 스텝 전체를 밀었다)
        const stepTitleH = Math.ceil(48 * 1.4 * estimateWrappedLines(s.step, 48, STEP_TEXT_W));
        elements.push(makeTextEl(
          `step_${i}_title`, s.step, 'h2',
          STEP_TEXT_X, baseY + 66, STEP_TEXT_W, '#1a1a1a', 'left', 3,
          { fontSize: 48, fontWeight: 800, lineHeight: 1.4, height: stepTitleH, allowBelowMin: true },
        ));

        // 우측: 설명 — 제목 실높이 아래로 배치 + 실제 줄 수 기반 높이
        // 하프 컬럼 물리 제약 — 38px (모바일 16.6px, 하한 예외)
        const stepDescH = Math.ceil(38 * 1.5 * estimateWrappedLines(s.description, 38, STEP_TEXT_W));
        elements.push(makeTextEl(
          `step_${i}_desc`, s.description, 'body',
          STEP_TEXT_X, baseY + 66 + stepTitleH + 10, STEP_TEXT_W, '#666666', 'left', 3,
          { fontSize: 38, height: stepDescH, lineHeight: 1.5, allowBelowMin: true },
        ));

        // 블록 높이: 기본 420px, 텍스트가 더 길면 실높이 + 하단 여백
        y = baseY + Math.max(STEP_BLOCK_H, 66 + stepTitleH + 10 + stepDescH + 20);
      });
      break;
    }

    // ──────────────────────────────────────────── Flexible Modules ──── //

    case ProSectionType.COMPARE_DIV: {
      const cmpItems = (content.compareItems as Array<{ name: string; pros: string; cons: string }>) ?? [];
      const cmpSummary = str(content.compareSummary);
      const hasTable = cmpItems.filter((it) => it && it.name).length >= 2;

      addSectionHeader('compare_title', hasTable ? '제품 비교' : (str(content.title) || '실제 크기 비교'));

      // 3-way 비교 테이블 (경쟁 대안 대비 pros/cons, 마지막 항목 = 본 상품 강조)
      // B-1: 헤더 뒤 추가 gap 제거 (120 → headerToContent 60)
      if (hasTable) {
        const brandRgbCmp = hexToRgb(palette.primary);
        const CARD_W = CONTENT_WIDTH;
        const PAD = 32;
        const TXT_W = CARD_W - PAD * 2;
        cmpItems.forEach((item, i) => {
          if (!item || !item.name) return;
          const isOwn = i === cmpItems.length - 1;
          const NAME_H = 60;
          const prosH = item.pros ? Math.ceil(34 * 1.5 * estimateWrappedLines(`✓ ${item.pros}`, 34, TXT_W)) : 0;
          const consH = item.cons ? Math.ceil(34 * 1.5 * estimateWrappedLines(`✗ ${item.cons}`, 34, TXT_W)) : 0;
          const cardH = PAD + NAME_H + (prosH ? 8 + prosH : 0) + (consH ? 8 + consH : 0) + PAD;
          const cardY = y;

          const children: CanvasElement[] = [];
          children.push(makeTextEl(
            `cmp_name_${i}`, `${isOwn ? '★ ' : ''}${item.name}`, 'body',
            SIDE_PADDING + PAD, cardY + PAD, TXT_W, isOwn ? palette.primary : palette.textMain, 'left', 3,
            { fontSize: 45, fontWeight: 800, height: NAME_H },
          ));
          let cy2 = cardY + PAD + NAME_H + 8;
          if (prosH) {
            children.push(makeTextEl(
              `cmp_pros_${i}`, `✓ ${item.pros}`, 'body',
              SIDE_PADDING + PAD, cy2, TXT_W, isOwn ? palette.primary : '#4a4a4a', 'left', 3,
              { fontSize: 34, lineHeight: 1.5, height: prosH, allowBelowMin: true },
            ));
            cy2 += prosH + 8;
          }
          if (consH) {
            children.push(makeTextEl(
              `cmp_cons_${i}`, `✗ ${item.cons}`, 'body',
              SIDE_PADDING + PAD, cy2, TXT_W, '#9a9a9a', 'left', 3,
              { fontSize: 34, lineHeight: 1.5, height: consH, allowBelowMin: true },
            ));
          }

          const cardBg = makeShapeEl(
            `cmp_card_${i}`, 'roundedRect',
            SIDE_PADDING, cardY, CARD_W, cardH,
            isOwn
              ? { fill: `rgba(${brandRgbCmp}, 0.08)`, stroke: `rgba(${brandRgbCmp}, 0.35)`, strokeWidth: 2, borderRadius: 20 }
              : { fill: '#FFFFFF', stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, borderRadius: 20 },
            1,
          );
          cardBg.containerOf = children.map((c) => c.id);
          elements.push(cardBg, ...children);
          y = cardY + cardH + 16;
        });

        if (cmpSummary) {
          gap(24);
          addText('compare_summary', cmpSummary, 'body', palette.primary, 'center');
        }
      }

      // 실제 크기 참조 이미지
      if (imgSrc) { gap(SPACING.captionToImage); addImage('compare_img', imgSrc, 'size_comparison', IMG_1_1); }
      break;
    }

    case ProSectionType.COMPARE2_DIV: {
      addSectionHeader('compare2_title', str(content.title) || '상세 비교');
      // B-1: 헤더 뒤 추가 gap 제거 (헤더→콘텐츠 정본 60)
      if (imgSrc) { addImage('compare2_img', imgSrc, 'comparison_scene', IMG_3_4); }
      break;
    }

    case ProSectionType.POINT_LIST_DIV: {
      addSectionHeader('list_title', '이런 분께 추천드려요');
      // B-1: 헤더 뒤 추가 gap 제거 (128 → headerToContent 60) —
      // 행 상단 = 텍스트 상단(TARGET_TOP 0)이라 헤더→첫 target 갭이 정확히 60
      const targets = (content.targets as string[]) ?? [];
      const CIRCLE_SIZE = 48;
      const CIRCLE_MARGIN_RIGHT = 20;
      const TEXT_X = SIDE_PADDING + CIRCLE_SIZE + CIRCLE_MARGIN_RIGHT;
      const TEXT_W = CONTENT_WIDTH - CIRCLE_SIZE - CIRCLE_MARGIN_RIGHT;
      const brandRgbList = hexToRgb(palette.primary);
      // B-3(섹션 리듬): 행 상단을 텍스트 기준(0)으로 재정렬 — 기존 TARGET_TOP 8은
      // 헤더 갭·행 간격 측정에 8px 오프셋을 끼워 넣었다
      const TARGET_TOP = 0;
      // 체크 원을 텍스트 '첫 줄'에 정렬 (기존: 행 세로중앙 → 다줄 텍스트에서 첫 줄 대비 아래로 어긋남)
      const FIRST_LINE_CENTER = TARGET_TOP + Math.round((45 * 1.5) / 2); // ≈ 34
      const circleTop = Math.max(0, FIRST_LINE_CENTER - CIRCLE_SIZE / 2); // ≈ 10
      targets.forEach((t, i) => {
        const targetLines = estimateWrappedLines(t, 45, TEXT_W);
        const targetTextH = Math.ceil(45 * 1.5 * targetLines);
        // 원형 배경 — 첫 줄 중심에 정렬
        elements.push(makeShapeEl(
          `list_circle_${i}`, 'circle',
          SIDE_PADDING, y + circleTop, CIRCLE_SIZE, CIRCLE_SIZE,
          {
            fill: `rgba(${brandRgbList}, 0.12)`,
            stroke: `rgba(${brandRgbList}, 0.25)`, strokeWidth: 1,
            cx: SIDE_PADDING + CIRCLE_SIZE / 2, cy: y + FIRST_LINE_CENTER, radius: CIRCLE_SIZE / 2,
          },
          2,
        ));
        // 체크 기호 — 48px 원 내부 고정 지오메트리 (하한 예외), 원과 동일 y
        elements.push(makeTextEl(
          `list_check_${i}`, '✓', 'body',
          SIDE_PADDING, y + circleTop, CIRCLE_SIZE, palette.primary, 'center', 3,
          { fontSize: 26, fontWeight: 700, lineHeight: CIRCLE_SIZE / 26, height: CIRCLE_SIZE, allowBelowMin: true },
        ));
        // 추천 대상 텍스트 — 45px, 첫 줄이 체크와 정렬됨
        elements.push(makeTextEl(
          `target_${i}`, t, 'body',
          TEXT_X, y + TARGET_TOP, TEXT_W, palette.textMain, 'left', 3,
          { fontSize: 45, fontWeight: 500, lineHeight: 1.5, height: targetTextH },
        ));
        // 행 하단 = 텍스트 하단과 원 하단 중 큰 쪽
        const rowBottom = Math.max(TARGET_TOP + targetTextH, circleTop + CIRCLE_SIZE);
        // B-3(섹션 리듬): 행 간격 34px(모바일 15px) 균일 — 기존 16은 행 상단
        // 오프셋 8과 합쳐 시각 간격 24를 만들었고, 2줄 텍스트 행에서 측정 갭이
        // 34/101로 출렁였다. 행 하단→다음 행 상단을 항상 34로 고정한다.
        y += rowBottom + 34;
      });
      // c13: 이미지 높이 IMG_1_1(860)→600px
      if (imgSrc) { gap(SPACING.captionToImage); addImage('targets_img', imgSrc, 'features', 600); }
      break;
    }

    case ProSectionType.PETIT_DIV: {
      // 컬러/옵션 섹션 리디자인 — 타이틀 + 설명 + 옵션 컬러칩 pill 그리드 + 옵션 그리드 이미지.
      // (기존: 옵션이 맨몸 caption 줄글 + 이미지 없음 → 빈 섹션처럼 보인다는 피드백)
      addSectionHeader('petit_title', str(content.title));
      const petitDesc = str(content.description);
      if (petitDesc) addText('petit_desc', petitDesc, 'body');

      const petitOpts = ((content.options as string[]) ?? []).filter(Boolean).slice(0, 6);
      if (petitOpts.length > 0) {
        gap(40);
        const P_COLS = Math.min(3, petitOpts.length);
        const P_PILL_W = 220;
        const P_PILL_H = 64;
        const P_GAP = 20;
        const P_START_X = Math.floor((CANVAS_WIDTH - P_PILL_W * P_COLS - P_GAP * (P_COLS - 1)) / 2);
        const P_START_Y = y;
        const brandRgbPetit = hexToRgb(palette.primary);

        petitOpts.forEach((opt, i) => {
          const col = i % P_COLS;
          const row = Math.floor(i / P_COLS);
          const px = P_START_X + col * (P_PILL_W + P_GAP);
          const py = P_START_Y + row * (P_PILL_H + P_GAP);

          const optTextEl = makeTextEl(
            `petit_opt_txt_${i}`, opt, 'caption',
            px + 10, py + 11, P_PILL_W - 20, palette.textMain, 'center', 3,
            { fontSize: 28, fontWeight: 500, height: 42, lineHeight: 1.5 },
          );
          const optBgEl = makeShapeEl(
            `petit_opt_bg_${i}`, 'roundedRect',
            px, py, P_PILL_W, P_PILL_H,
            { fill: `rgba(${brandRgbPetit}, 0.06)`, stroke: `rgba(${brandRgbPetit}, 0.18)`, strokeWidth: 1.5, borderRadius: 32 },
            2,
          );
          // 컨테이너 연동 — 긴 옵션명이 wrap되어도 pill이 함께 늘어난다
          optBgEl.containerOf = [optTextEl.id];
          elements.push(optBgEl, optTextEl);
        });

        const petitRows = Math.ceil(petitOpts.length / P_COLS);
        y = P_START_Y + petitRows * (P_PILL_H + P_GAP);
      }

      const PETIT_IMG_H = 860;
      if (imgSrc) { gap(60); addImage('petit_img', imgSrc, 'options', PETIT_IMG_H); }
      break;
    }

    case ProSectionType.CONVERT_DIV: {
      // c13: 패턴 C — 이미지 풀블리드 + 어두운 오버레이 + 흰색 텍스트 (concept_desc 동일)
      const ctaH = str(content.ctaHeadline);
      const ctaS = str(content.ctaSubtext);
      const CONVERT_H = 1200;
      if (imgSrc) {
        elements.push(makeImageEl('convert_img', imgSrc, 'conversion_cta', 0, 0, CANVAS_WIDTH, CONVERT_H, 1));
        elements.push(makeShapeEl(
          'convert_overlay', 'rect',
          0, 0, CANVAS_WIDTH, CONVERT_H,
          { fill: 'rgba(0,0,0,0.42)' }, 2,
        ));
        const textStartY = Math.floor(CONVERT_H * 0.3);
        // F2e(라운드2 P2): .sec-overlay h2 line-height 1.3→1.8 정합
        const convertHeadlineH = ctaH ? Math.max(130, measureTextBlock(ctaH, 60, 1.8)) : 0;
        if (ctaH) {
          elements.push(makeTextEl(
            'convert_headline', ctaH, 'h2',
            SIDE_PADDING, textStartY, CONTENT_WIDTH, '#FFFFFF', 'center', 3,
            // B-2: .sec-overlay h2 정합 — GmarketSansBold + 헤딩 그림자
            { fontSize: 60, fontWeight: 800, height: convertHeadlineH, lineHeight: 1.8, ...H2_TITLE_FONT, ...OVERLAY_HEADING_SHADOW },
          ));
        }
        if (ctaS) {
          const convertSubH = Math.max(100, measureTextBlock(ctaS, 45, 1.5));
          elements.push(makeTextEl(
            'convert_sub', ctaS, 'body',
            SIDE_PADDING, textStartY + convertHeadlineH + 20, CONTENT_WIDTH, 'rgba(255,255,255,0.85)', 'center', 3,
            { fontSize: 45, height: convertSubH, lineHeight: 1.5, ...OVERLAY_BODY_SHADOW },
          ));
        }
        y = CONVERT_H;
      } else {
        addText('convert_headline', ctaH, 'h2', palette.primary, 'center', 2, { ...H2_TITLE_FONT });
        if (ctaS) { gap(SPACING.h1ToBody); addText('convert_sub', ctaS, 'body', palette.textMain); }
      }
      break;
    }

    // ── 수정 7 + c10: 스펙 테이블 — 구분선 + 32px + 브랜드 컬러 레이블 ──
    case ProSectionType.SPEC_TABLE: {
      addSectionHeader('spec_title', '제품 스펙');
      const specRows = (content.specRows as Array<{ label: string; value: string }> | string[]) ?? [];
      // B-1: 헤더 뒤 추가 gap 제거 (120 → headerToContent 60)
      if (specRows.length > 0) {
        const SPEC_FONT = 32;
        const ROW_H = 70;
        const brandRgbSpec = hexToRgb(palette.primary);
        const LINE_COLOR = `rgba(${brandRgbSpec}, 0.1)`;
        specRows.forEach((row, i) => {
          if (typeof row === 'string') {
            addText(`spec_row_${i}`, row, 'body', palette.textMain);
          } else {
            const rowY = y;
            // 행 상단 구분선
            elements.push(makeShapeEl(`spec_line_${i}`, 'rect', SIDE_PADDING, rowY, CONTENT_WIDTH, 1, { fill: LINE_COLOR }, 2));
            // 레이블 (브랜드 컬러, bold) — 스펙표는 보조 정보(caption 위계, 하한 28 충족)
            // 실측 정합: 32×1.3=41.6 ≈ 42(ROW_H-28)
            elements.push(makeTextEl(`spec_label_${i}`, row.label, 'caption', SIDE_PADDING + 16, rowY + 14, 200, palette.primary, 'left', 3, { fontWeight: 700, fontSize: SPEC_FONT, lineHeight: 1.3, height: ROW_H - 28 }));
            // 값 (다크) — 긴 값은 wrap → 실제 줄 수만큼 행 높이 확장 (기존 고정 70px → 겹침)
            const specValW = CONTENT_WIDTH - 252;
            const specValH = Math.ceil(SPEC_FONT * 1.3 * estimateWrappedLines(row.value, SPEC_FONT, specValW));
            elements.push(makeTextEl(`spec_val_${i}`, row.value, 'caption', SIDE_PADDING + 236, rowY + 14, specValW, '#1a1a1a', 'left', 3, { fontSize: SPEC_FONT, lineHeight: 1.3, height: specValH }));
            y += Math.max(ROW_H, specValH + 28);
            // 마지막 행 하단 구분선
            if (i === specRows.length - 1) {
              elements.push(makeShapeEl('spec_line_bottom', 'rect', SIDE_PADDING, y, CONTENT_WIDTH, 1, { fill: LINE_COLOR }, 2));
            }
          }
        });
      } else {
        addText('spec_note', '상세 제원은 아래 표를 확인하세요.', 'caption', palette.textMain);
      }
      break;
    }

    // ── c13: CTA — 700px 압축 + 25자 완전 문장 + 텍스트 y 조정 ──
    case ProSectionType.CTA: {
      const ctaRaw = str(content.ctaHeadline);
      // c13: 25자 제한 + 완전한 문장 보장
      let ctaH = ctaRaw;
      if (ctaRaw.length > 25) {
        ctaH = ctaRaw.slice(0, 25).replace(/[,，.!?。\s]+$/, '');
        if (!/[요다세요]$/.test(ctaH)) {
          const lastSpace = ctaH.lastIndexOf(' ');
          ctaH = (lastSpace > 10 ? ctaH.slice(0, lastSpace) : ctaH) + '.';
        }
      }
      const ctaS = str(content.ctaSubtext);
      // c13: 700px 압축 (기존 IMG_3_4=1147px)
      const CTA_H = 700;
      if (imgSrc) {
        const bgImg = makeImageEl('cta_bg', imgSrc, 'cta', 0, 0, CANVAS_WIDTH, CTA_H, 1);
        bgImg.opacity = 0.3;
        elements.push(bgImg);
        const startY = 200;  // c13: 비율 → 고정 200px (0.3*700=210과 유사)
        // P1-4: h1 멀티라인(25자≈2~3줄) 자동 행간과 동일한 값으로 높이 계산
        const ctaHeadlineLH = resolveAutoLineHeight(ctaH, 'h1', 90, CONTENT_WIDTH, getLetterSpacing('h1'));
        const ctaHeadlineH = ctaH ? Math.max(180, measureTextBlock(ctaH, 90, ctaHeadlineLH)) : 0;
        // B-2: 흰 텍스트가 반투명 이미지 위에 얹히므로 오버레이 그림자 이식 (h1은 이미 GmarketSansBold)
        if (ctaH) elements.push(makeTextEl('cta_headline', ctaH, 'h1', SIDE_PADDING, startY, CONTENT_WIDTH, '#FFFFFF', 'center', 3, { fontWeight: 800, height: ctaHeadlineH, ...OVERLAY_HEADING_SHADOW }));
        if (ctaS) elements.push(makeTextEl('cta_sub', ctaS, 'body', SIDE_PADDING, startY + ctaHeadlineH + 20, CONTENT_WIDTH, 'rgba(255,255,255,0.85)', 'center', 3, { ...OVERLAY_BODY_SHADOW }));
        y = CTA_H;
      } else {
        if (ctaH) addText('cta_headline', ctaH, 'h1', '#FFFFFF');
        if (ctaS) addText('cta_sub', ctaS, 'body', 'rgba(255,255,255,0.85)');
      }
      break;
    }

    default:
      break;
  }

  return elements;
}


export type { SectionBuildExtra };
