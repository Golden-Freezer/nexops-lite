import type { CanvasSection, ReviewCardParams } from '@/lib/registration/editor/types/canvas';
import { REVIEW_CARD_DEFAULTS } from '@/lib/registration/editor/constants/designTokens';
import { estimateWrappedLines } from '@/lib/registration/editor/utils/sectionConverter';

// ─── 리뷰 카드 재배치 (트랙 4 D-2) ───────────────────────────────────────────
// StyleTab에서 카드 간격/패딩/본문 크기 변경 시, 기존 요소의 텍스트 내용을
// 유지한 채 카드 기하만 converter(sections.ts PERFORMANCE_REVIEWS)와 동일한
// 규칙으로 다시 계산한다. 텍스트 measuredHeight는 비워 재실측을 유도하고,
// 오차는 컨테이너 연동 reflow(containerOf)가 흡수한다.

const CANVAS_W = 860;
const HEADER_ROW_H = Math.max(REVIEW_CARD_DEFAULTS.avatarSize, 42 + 32); // 아바타 vs 이름(28px)+별점(24px)
const BADGE_H = 38;

export function relayoutReviewCards(
  section: CanvasSection,
  params: ReviewCardParams,
): CanvasSection {
  const els = section.elements.map((e) => ({ ...e, transform: { ...e.transform } }));
  // 요소 id는 uid 난수 — 카드 파트 식별은 converter가 부여한 name으로 한다
  const byId = new Map(els.map((e) => [e.name, e]));

  const { marginX: CARD_MX, avatarSize: AVATAR_SIZE, bodyLineHeight } = REVIEW_CARD_DEFAULTS;
  const CARD_W = CANVAS_W - CARD_MX * 2;
  const maxTextW = CARD_W - params.padding * 2;

  // 첫 카드 시작 y는 기존 배치(헤더 라벨 아래)를 존중
  let cardY = byId.get('review_card_bg_0')?.transform.y ?? 160;

  for (let i = 0; ; i++) {
    const bg = byId.get(`review_card_bg_${i}`);
    if (!bg) break;
    const text = byId.get(`review_text_${i}`);
    const badge = byId.get(`review_badge_${i}`);
    const avatar = byId.get(`review_avatar_${i}`);
    const initial = byId.get(`review_initial_${i}`);
    const author = byId.get(`review_author_${i}`);
    const stars = byId.get(`review_stars_${i}`);

    const bodyText = text?.textProps?.content ?? '';
    const lineH = text?.textProps?.lineHeight ?? bodyLineHeight;
    const textLines = estimateWrappedLines(bodyText, params.bodyFontSize, maxTextW);
    const textH = Math.ceil(textLines * params.bodyFontSize * lineH);
    const badgeH = badge ? BADGE_H : 0;
    const cardH =
      params.padding + HEADER_ROW_H + 16 + textH + (badgeH > 0 ? 12 + badgeH : 0) + params.padding;

    const avatarX = CARD_MX + params.padding;
    const avatarY = cardY + params.padding;
    const nameX = avatarX + AVATAR_SIZE + 16;
    const textY = cardY + params.padding + HEADER_ROW_H + 16;

    bg.transform.y = cardY;
    bg.transform.height = cardH;
    if (avatar) {
      avatar.transform.x = avatarX;
      avatar.transform.y = avatarY;
    }
    if (initial) {
      initial.transform.x = avatarX;
      initial.transform.y = avatarY + Math.floor((AVATAR_SIZE - 45) / 2);
    }
    if (author) {
      author.transform.x = nameX;
      author.transform.y = avatarY;
      author.transform.width = CARD_W - params.padding * 2 - AVATAR_SIZE - 16;
    }
    if (stars) {
      stars.transform.x = nameX;
      stars.transform.y = avatarY + 42;
    }
    if (text) {
      text.transform.x = CARD_MX + params.padding;
      text.transform.y = textY;
      text.transform.width = maxTextW;
      text.transform.height = textH;
      text.textProps = { ...text.textProps!, fontSize: params.bodyFontSize };
      text.measuredHeight = undefined; // 재실측 유도 → 컨테이너 연동 reflow가 보정
    }
    if (badge) {
      badge.transform.x = CARD_MX + params.padding;
      badge.transform.y = textY + textH + 12;
    }

    cardY += cardH + params.gap;
  }

  // 섹션 높이 재계산 — computeSectionHeight와 동일 규칙(최하단 + 80)
  const maxBottom = els.reduce((m, e) => Math.max(m, e.transform.y + e.transform.height), 0);
  const height = section.userAdjustedHeight
    ? Math.max(section.canvas.height, maxBottom)
    : maxBottom + 80;

  return {
    ...section,
    elements: els,
    reviewCardParams: { ...params },
    canvas: { ...section.canvas, height },
    // 재배치 직후 한정으로 실측·자동 reflow 재허용 — 추정 오차를 흡수한 뒤
    // 다음 저장에서 다시 정산(해제)된다
    needsInitialReflow: true,
  };
}
