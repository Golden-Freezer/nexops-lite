// sectionConverter/content.ts — D1 분할: 원본 sectionConverter.ts 423~716행 순수 이동 (2026-07-04)


import { ProSectionType } from '@/lib/registration/editor/types/section';
import { SECTION_IMAGE_MAPPING } from '@/lib/registration/editor/constants/sectionConfig';
import type { CopywritingResult } from '@/lib/registration/editor/types/editor';
import { normalizeCompareItems, withoutWorryPhrase } from '@/lib/registration/pdp-copy-labels';
import { str, sanitizeImageUrl, extractCta, normalizeDetailPoint } from './helpers';


/**
 * 카피에 CTA가 없을 때의 CTA 제목 — 상품명이 h1 25자 제한("지금 " 3자 + 상품명 + " 담아두세요" 6자) 안이면 상품명 문구, 아니면 범용 문구.
 * 보라고 안내하는 끝말('만나보세요')은 쓰지 않는다(P1-1a)
 */
export function contextualCtaHeadline(productName: string): string {
  return productName && productName.length <= 16 ? `지금 ${productName} 담아두세요` : '지금 구매하기';
}

// ─────────────────────────────────────────────────────────────────────────────
// 이미지 URL 해석: generatedImages Record → 섹션에 맞는 단일 URL (sanitized)
// ─────────────────────────────────────────────────────────────────────────────
// Pro 이미지 없을 때 사용할 fallback 이미지 키 (Section → 대안 이미지 키 순서)
const IMAGE_FALLBACK: Partial<Record<ProSectionType, string[]>> = {
  [ProSectionType.MAIN_CUT]: ['hero'],  // premium_hero 없으면 hero fallback
};

function resolveImageUrl(
  sectionType: ProSectionType,
  images: Record<string, string | string[]>,
): string | null {
  if (sectionType === ProSectionType.DIVIDER) return null;
  const mapping = SECTION_IMAGE_MAPPING[sectionType as string];
  if (!mapping || mapping.imageKey === '') return null;

  // Primary image lookup
  const imgData = images[mapping.imageKey];
  let raw: string | undefined;
  if (imgData) {
    if (Array.isArray(imgData)) {
      raw = imgData[0];
    } else {
      raw = imgData;
    }
  }

  const sanitized = sanitizeImageUrl(raw);
  if (sanitized) return sanitized;

  // feature_XX → features[N] 평탄화 fallback (DB는 리스트로 저장)
  const featureMatch = mapping.imageKey.match(/^feature_(\d+)$/);
  if (featureMatch) {
    const idx = parseInt(featureMatch[1], 10);
    const features = images['features'];
    if (Array.isArray(features) && features[idx]) {
      const featureSanitized = sanitizeImageUrl(features[idx] as string);
      if (featureSanitized) return featureSanitized;
    }
  }

  // howto_XX → howToImages[N] 평탄화 fallback (DB는 리스트로 저장)
  const howtoMatch = mapping.imageKey.match(/^howto_(\d+)$/);
  if (howtoMatch) {
    const idx = parseInt(howtoMatch[1], 10);
    const howToImages = images['howToImages'];
    if (Array.isArray(howToImages) && howToImages[idx]) {
      const howtoSanitized = sanitizeImageUrl(howToImages[idx] as string);
      if (howtoSanitized) return howtoSanitized;
    }
  }

  // Fallback lookup for Pro-specific sections
  const fallbacks = IMAGE_FALLBACK[sectionType];
  if (fallbacks) {
    for (const key of fallbacks) {
      const fallbackData = images[key];
      if (!fallbackData) continue;
      const fallbackRaw = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
      const fallbackSanitized = sanitizeImageUrl(fallbackRaw);
      if (fallbackSanitized) return fallbackSanitized;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 피처 이미지 중복 해소: feature_00~03 / features[] 배열에서 순서대로 추출
// ─────────────────────────────────────────────────────────────────────────────
interface FeatureImageSlots {
  point_div: string;
  sub_div: string;
  point_list_div: string;
}

function buildFeatureImageSlots(
  images: Record<string, string | string[]>,
): FeatureImageSlots {
  const featArr = images['features'];
  const resolve = (idx: number) =>
    sanitizeImageUrl(str(images[`feature_0${idx}`]) || (Array.isArray(featArr) ? featArr[idx] : ''));

  // features[0~2] → point_div, features[3~5] → sub_div (중복 해소)
  return {
    point_div:      resolve(0) ?? '',
    sub_div:        resolve(3) ?? resolve(1) ?? '',
    point_list_div: resolve(4) ?? resolve(2) ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build context (derived from specSheet)
// ─────────────────────────────────────────────────────────────────────────────
interface BuildContext {
  soldOutCount: number | null;
  avgRating: string;
  /** 실제 평점 데이터(reviews[].rating) 존재 여부 — 없으면 perf_rating 비활성 */
  hasRealRating: boolean;
  totalReviewCount: number;
}

function buildContext(specSheet?: Record<string, unknown>): BuildContext {
  const rawCount = specSheet?.sold_out_count;
  const soldOutCount =
    rawCount != null && Number(rawCount) > 0 ? Number(rawCount) : null;

  const reviews = (
    (specSheet?.reviews ?? []) as Array<Record<string, unknown>>
  );
  const totalReviewCount = reviews.length;
  const ratings = reviews
    .map((r) => r.rating ?? r['평점'])
    .filter((r) => r != null)
    .map(Number)
    .filter((n) => !isNaN(n));
  const hasRealRating = ratings.length > 0;
  const avgRating = hasRealRating
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : '';

  return { soldOutCount, avgRating, hasRealRating, totalReviewCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Content extractor: CopywritingResult → section별 content 딕셔너리
// ─────────────────────────────────────────────────────────────────────────────
function extractContent(
  sectionType: ProSectionType,
  copy: CopywritingResult,
  ctx: BuildContext,
): Record<string, unknown> {
  switch (sectionType) {
    // ── Hook Zone ─────────────────────────────────────────────────────────
    case ProSectionType.HOOK_3STEP:
      return {
        hook: copy.mainIntro.hook || copy.mainIntro.benefitHeadline || copy.mainIntro.title,
        benefitHeadline: copy.mainIntro.benefitHeadline ?? copy.mainIntro.title,
        subBenefit: copy.mainIntro.subBenefit ?? copy.summary,
      };
    case ProSectionType.PRODUCT_EXPOSURE:
      return {
        headline: copy.productExposure?.headline || copy.mainIntro.benefitHeadline || copy.mainIntro.title,
        subCopy: copy.productExposure?.subCopy || copy.mainIntro.hook || '',
      };
    case ProSectionType.PERFORMANCE_SALES: {
      const banner = (copy as unknown as Record<string, unknown>).soldOutBanner as { headline?: string; subtitle?: string } | undefined;
      const headline = banner?.headline || (ctx.soldOutCount ? `${ctx.soldOutCount}차 완판` : '');
      const subtitle = banner?.subtitle || '고객님의 성원에 감사드립니다';
      return {
        soldOutCount: ctx.soldOutCount,
        text: headline,
        subtitle,
      };
    }
    case ProSectionType.PERFORMANCE_RATING:
      return { avgRating: ctx.avgRating, hasRealRating: ctx.hasRealRating };
    case ProSectionType.PERFORMANCE_REVIEWS: {
      return {
        reviewCountText: '',
        reviews: copy.reviewHighlights ?? [],
      };
    }
    case ProSectionType.PERFORMANCE_REVIEW:
      // perf_reviews에 통합됨 — 빈 content 반환하여 isSectionValid 필터에서 제거
      return {};
    case ProSectionType.CERTIFICATION: {
      const certCopy = copy.certificationCopy;
      return {
        text: certCopy?.headline ?? '',
        subtitle: certCopy?.sub_copy ?? '',
        highlightText: certCopy?.highlight_text ?? '',
        bulletPoints: certCopy?.bullet_points ?? [],
        warningText: certCopy?.warning_text ?? '',
        certBadgesText: certCopy?.cert_badges_text ?? '',
      };
    }
    case ProSectionType.EVENT_BANNER:
      return { text: '프로모션 이벤트' };
    case ProSectionType.EVENT_BUNDLE:
      return { text: '세트 구성' };
    case ProSectionType.EVENT_DISCOUNT:
      return { text: '특별 할인' };
    case ProSectionType.EVENT_OPTION:
      return {
        title: copy.colorOptions.title,
        options: copy.colorOptions.options,
        description: copy.colorOptions.description,
      };

    // ── Problem Framing ───────────────────────────────────────────────────
    case ProSectionType.PROBLEM_RAISE: {
      const empathyRaw = str(copy.problem.empathy);
      const empathyLines = (copy.problem.empathyLines && copy.problem.empathyLines.length > 0)
        ? copy.problem.empathyLines.slice(0, 4)
        : empathyRaw
          ? empathyRaw.split(/[.!?。]\s+/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 4)
          : [];
      // 저장 카피에 남은 '이런 고민'도 다시 그릴 때 뺀다(오너 지시 11-01)
      return { question: withoutWorryPhrase(str(copy.problem.question)), empathy: empathyRaw, empathyLines };
    }
    case ProSectionType.PROBLEM_EMPATHY: {
      const empathyRaw = str(copy.problem.empathy);
      const deepLines = copy.problem.empathyDeepLines;
      const empathyLines = (deepLines && deepLines.length > 0)
        ? deepLines.slice(0, 4)
        : (copy.problem.empathyLines && copy.problem.empathyLines.length > 0)
          ? copy.problem.empathyLines.slice(0, 4)
          : empathyRaw
            ? empathyRaw.split(/[.!?。]\s+/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 4)
            : [];
      return { empathy: empathyRaw, empathyLines };
    }
    case ProSectionType.DIRECTION_SUGGEST: {
      const directionHint = (copy as CopywritingResult & {
        directionHint?: { headline?: string; subCopy?: string };
      }).directionHint;
      return {
        headline: directionHint?.headline || copy.solution.declaration,
        subCopy: directionHint?.subCopy || '',
      };
    }
    case ProSectionType.SOLUTION_GUIDE:
      return { summary: copy.solution.summary };
    case ProSectionType.KEY_MESSAGE: {
      // hero(benefitHeadline)와 동일 문구 중복 회피: key_message는 mid 변형
      // (다른 각도)을 우선 사용하고, 그것이 hero와 같으면 summary/pointCard로 폴백.
      const heroHeadline = (copy.mainIntro.benefitHeadline || copy.mainIntro.title || '').trim();
      const norm = (s: string) => s.replace(/[\s,·.!?]/g, '');
      const keyMessageCopy = [copy.keyMessageCopy?.headline, copy.keyMessageCopy?.subCopy]
        .map((s) => (s ?? '').trim())
        .filter(Boolean)
        .join('\n');
      const candidates = [
        keyMessageCopy,
        copy.keyMessageVariations?.mid,
        copy.summary,
        copy.keyMessageVariations?.bottom,
        copy.pointCards[0]?.title,
      ].map((s) => (s ?? '').trim()).filter(Boolean);
      const distinct = candidates.find((c) => norm(c) !== norm(heroHeadline));
      return { message: distinct || candidates[0] || '' };
    }

    // ── USP Value Delivery ────────────────────────────────────────────────
    case ProSectionType.MAIN_CUT: {
      const dp0 = copy.detailPoints[0]
        ? normalizeDetailPoint(copy.detailPoints[0] as Record<string, string | undefined>)
        : null;
      return {
        headline: dp0?.title || copy.mainIntro.benefitHeadline || copy.mainIntro.title,
        description: dp0?.description ?? '',
        pointCards: copy.pointCards,
      };
    }
    case ProSectionType.CONCEPT_DESC: {
      const dp1 = copy.detailPoints[1]
        ? normalizeDetailPoint(copy.detailPoints[1] as Record<string, string | undefined>)
        : null;
      return {
        title: dp1?.title ?? copy.mainIntro.title,
        description: dp1?.description ?? copy.summary,
      };
    }
    case ProSectionType.POINT_DIV:
      return { points: copy.pointCards.slice(0, 3) };
    case ProSectionType.SUB_DIV:
      return {
        // Task 6: 하드코딩 '서브 포인트' 대신 실제 부제목 사용
        // sub_div는 detailPoints[3~5] 사용 (point_div의 [0~2]와 중복 해소)
        sectionTitle: copy.mainIntro.subtitle || '추가 특징',
        points: copy.detailPoints.slice(3, 6).length > 0
          ? copy.detailPoints.slice(3, 6).map((p) =>
              normalizeDetailPoint(p as Record<string, string | undefined>),
            )
          : copy.detailPoints.slice(0, 3).map((p) =>  // fallback: 6개 미만이면 기존 방식
              normalizeDetailPoint(p as Record<string, string | undefined>),
            ),
      };
    case ProSectionType.SUB2_DIV_PAGE:
      return { tags: copy.usageSceneTags };
    case ProSectionType.HIDDEN_PAGE:
      return { steps: copy.howTo };

    // ── Flexible Modules ──────────────────────────────────────────────────
    case ProSectionType.COMPARE_DIV:
      return {
        title: '실제 크기 비교',
        // 저장 카피의 옛 3자 비교·단점 칸도 여기서 두 칸으로 맞춘다(오너 지시 11-01)
        compareItems: normalizeCompareItems(copy.compareItems),
        compareSummary: copy.compareSummary ?? '',
      };
    case ProSectionType.COMPARE2_DIV:
      return { title: '상세 비교' };
    case ProSectionType.POINT_LIST_DIV:
      return { targets: copy.recommendedTargets };
    case ProSectionType.PETIT_DIV:
      return {
        title: copy.colorOptions.title,
        options: copy.colorOptions.options,
        description: copy.colorOptions.description,
      };
    case ProSectionType.CONVERT_DIV: {
      const cta = extractCta(copy.closingCta);
      return { ctaHeadline: cta.headline, ctaSubtext: cta.subtext };
    }
    case ProSectionType.SPEC_TABLE:
      return { title: '제품 스펙' };
    case ProSectionType.CTA: {
      const cta = extractCta(copy.closingCta);
      // P1-3: 하드코딩 '지금 구매하기' 폴백을 상품 맥락 기반으로 개선(contextualCtaHeadline)
      const productName = (copy.mainIntro.title || '').trim();
      const contextualCta = contextualCtaHeadline(productName);
      // Task 5: convert_div와 중복 방지 — cta는 subtext(행동 촉구) 사용, 없으면 fallback
      const hasRealAction = !!(cta.subtext && cta.subtext !== cta.headline);
      const ctaActionText = hasRealAction ? cta.subtext : contextualCta;
      // 폴백 헤드라인에 상품명이 이미 들어간 경우 서브텍스트의 상품명 중복 회피
      const ctaSubtext = !hasRealAction && productName && contextualCta.includes(productName)
        ? (copy.mainIntro.subBenefit || copy.summary || '')
        : (copy.mainIntro.title || '');
      return { ctaHeadline: ctaActionText, ctaSubtext, title: copy.mainIntro.title };
    }

    default:
      return {};
  }
}


export { resolveImageUrl, buildFeatureImageSlots, buildContext, extractContent };
