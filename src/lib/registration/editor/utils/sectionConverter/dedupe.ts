// sectionConverter/dedupe.ts — 특징·사진 중복 정리 (pdp-enrichment R2, LayoutSelection.feature_dedupe 잡만)
//
// R1 심사(P02 d10ea762, r4 흐름·중복 2점): 같은 특징(반투명·컬러 2종·S/L·20개)이 요약 카드·핵심 포인트·추가 특징·선택 안내에서
// 같은 말로 되풀이되고, 같은 피처 컷이 세 번까지 다시 쓰였다. 이 모듈은 카피를 새로 쓰지 않는다 — 이미 생성된 카피 필드와
// 사진을 페이지 전체를 보고 다시 배정만 한다.
// - 특징(pointCards)마다 주 섹션 하나: 앞 3개는 point_div, 나머지는 sub_div. 주 섹션은 그 특징을 다룬 detailPoint(주장·근거)로
//   쓰고, point_div가 있으면 main_cut 요약 카드는 제목만 남긴다(목차).
// - detailPoint는 페이지에서 한 번만 쓴다. sub_div는 주 섹션이 이미 있는 특징과 앞 문장을 되풀이하는 항목을 뺀다.
// - 한 줄 카피(main_cut·product_exposure·petit_div 설명)는 앞 문장을 되풀이하면 다른 후보 필드로 바꾸거나 뺀다.
// - 사진: 활성 섹션의 대표 컷이 아닌 생성 컷 중 아직 쓰지 않은 컷을 먼저 쓰고, 다 쓰면 바로 앞 섹션에 없던 컷만 다시 쓴다.
// - CTA는 25자 안의 완성 문장 후보를 먼저 고르고, 후보가 모두 넘치면 단어 경계에서 자른다.
// - 스펙 표는 입력(spec_sheet) 값만 행으로 만든다. 행이 없으면 섹션을 뺀다(치수·소재를 만들지 않는다).

import { ProSectionType } from '@/lib/registration/editor/types/section';
import type { CopywritingResult } from '@/lib/registration/editor/types/editor';
import { str, sanitizeImageUrl, extractCta, normalizeDetailPoint } from './helpers';
import { contextualCtaHeadline, resolveImageUrl } from './content';
import { productInfoRows } from '@/lib/registration/product-info-rows';

type Images = Record<string, string | string[]>;
type CopyPair = { headline?: string; subCopy?: string } | undefined;

export interface DedupePoint {
  title: string;
  description: string;
  /** sub_div 항목 컷 — 빈 문자열이면 그리지 않는다 */
  image?: string;
}

/** sub_div 계획 항목 — detailPoints 순번과(주 항목이면) 그 항목이 맡은 특징 번호 */
type SubItem = DedupePoint & { index: number; feature?: number };

export interface DedupePlan {
  /** extractContent 결과에 덮어쓸 섹션별 값 */
  content: Partial<Record<ProSectionType, Record<string, unknown>>>;
  /** 남는 내용이 없어 빼는 섹션 */
  drop: Set<ProSectionType>;
  /** 이 계획이 정한 섹션 컷(빈 문자열 = 그리지 않음) — assignImagesToSections가 덮어쓰지 않는다 */
  images: Partial<Record<ProSectionType, string>>;
  /** 카피 배정이 페이지에 싣는다고 기록한 글(섹션 순서) — 생성 쪽이 렌더 규칙을 미리 따를 때 읽는다(render-aware-cuts) */
  shown?: readonly string[];
  /** 사진 배정이 그리는 컷 전체(대표 컷·point_div 피처·추가 특징·추천 컷) — 위와 같은 용도 */
  usedImages?: readonly string[];
}

// ─── 낱말 겹침 ────────────────────────────────────────────────────────────────

/** 겹침 판정에서 빼는 흔한 말 — 특정 특징을 가리키지 않는다 */
const STOPWORDS = new Set([
  '이런', '이렇게', '그리고', '정말', '지금', '바로', '함께', '모든', '위한', '위해', '있어요', '있는', '없이', '가능', '선택', '사용',
]);

/** 두 글자 이상 낱말(중복 제거). 'S/L'처럼 빗금으로 이은 말은 한 낱말로 본다 */
export function keywordsOf(text: string): string[] {
  const words = text.match(/[0-9A-Za-z가-힣]+(?:\/[0-9A-Za-z가-힣]+)*/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 2 && !STOPWORDS.has(w)))];
}

/**
 * 같은 낱말인가 — 조사·어미가 붙은 꼴을 같게 본다: 짧은 쪽이 긴 쪽의 앞부분이거나('데이지'·'데이지와'),
 * 앞 두 글자 이상이 같고 짧은 쪽의 끝 한 글자만 다르다('화사한'·'화사하게'). 숫자가 든 말은 앞부분 일치만('20개'·'20개씩').
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.startsWith(s)) return s.length >= 2;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return i >= 2 && i >= s.length - 1;
}

export function covered(words: readonly string[], other: readonly string[]): number {
  return words.filter((w) => other.some((o) => sameWord(w, o))).length;
}

/** 앞에 나온 문장 하나와 낱말 절반 이상(두 개 이상)이 같으면 되풀이로 본다 */
export function repeatsShown(text: string, shown: readonly string[]): boolean {
  const words = keywordsOf(text);
  if (words.length === 0) return false;
  return shown.some((s) => {
    const hit = covered(words, keywordsOf(s));
    return hit >= 2 && hit * 2 >= words.length;
  });
}

/**
 * detailPoint마다 다루는 특징(pointCards 순번, 없으면 -1). 특징 제목 낱말이 하나 이상 겹쳐야 하고, 점수는 제목 낱말 ×2 + 설명 낱말.
 * 이 페이지 항목 절반 이상에 나오는 낱말(상품군 낱말)은 특징을 가리키지 않으므로 뺀다.
 * 낱말로 짝을 못 찾은 특징 k는 같은 번호의 detailPoint(짝 없는 항목일 때만)로 보충한다 — 카피 지시가 detailPoints 1~4번을
 * pointCards 1~4번과 같은 순서로 쓰게 하고, 피처 컷 features:k도 detailPoints[k]로 만든다.
 */
export function matchFeatures(
  features: ReadonlyArray<{ title: string; description: string }>,
  points: ReadonlyArray<{ title: string; description: string }>,
): number[] {
  const docs = [...features, ...points].map((p) => keywordsOf(`${p.title} ${p.description}`));
  const specific = (w: string) => docs.filter((d) => d.some((x) => sameWord(w, x))).length * 2 < docs.length;
  const titles = features.map((f) => keywordsOf(f.title).filter(specific));
  const descs = features.map((f) => keywordsOf(f.description).filter(specific));
  const owner = points.map((p) => {
    const words = keywordsOf(`${p.title} ${p.description}`);
    let best = -1;
    let bestScore = 0;
    features.forEach((_, k) => {
      const titleHit = covered(titles[k], words);
      if (titleHit === 0) return;
      const score = titleHit * 2 + covered(descs[k], words);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    });
    return best;
  });
  features.forEach((_, k) => {
    if (!owner.includes(k) && owner[k] === -1) owner[k] = k;
  });
  return owner;
}

// ─── CTA·스펙 ─────────────────────────────────────────────────────────────────

export const CTA_MAX = 25;

/** CTA 제목 길이 맞춤 — 넘치면 상한 안의 마지막 띄어쓰기에서 자른다(낱말 중간에서 자르지 않는다, 마침표를 덧붙이지 않는다) */
export function fitCtaHeadline(text: string, max = CTA_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const space = t.lastIndexOf(' ', max);
  const head = space >= 6 ? t.slice(0, space) : t.slice(0, max);
  return head.replace(/[\s,，.!?。·~/]+$/, '');
}

/**
 * CTA 내용 — convert_div가 closingCta.headline을 쓰는 페이지는 subtext, 그 밖에는 행동 촉구 문장(headline)이 CTA 제목이다.
 * 25자 안의 후보를 먼저 고르고, 모두 넘치면 첫 후보를 단어 경계에서 자른다. 후보가 없으면 기존 상품 맥락 폴백.
 */
export function ctaContent(copy: CopywritingResult, convertActive: boolean): Record<string, unknown> {
  const cta = extractCta(copy.closingCta);
  const productName = (copy.mainIntro.title || '').trim();
  const contextual = contextualCtaHeadline(productName);
  const subtext = cta.subtext && cta.subtext !== cta.headline ? cta.subtext : '';
  const candidates = (convertActive ? [subtext] : [cta.headline, subtext]).map((s) => s.trim()).filter(Boolean);
  const headline = candidates.find((s) => s.length <= CTA_MAX) ?? (candidates[0] ? fitCtaHeadline(candidates[0]) : contextual);
  const ctaSubtext =
    headline === contextual && productName && contextual.includes(productName)
      ? copy.mainIntro.subBenefit || copy.summary || ''
      : copy.mainIntro.title || '';
  return { ctaHeadline: headline, ctaSubtext, title: copy.mainIntro.title };
}

/** 스펙 표 행 — 입력에 있는 글자·숫자 값만. 카멜 표기 extra 키는 내부 값이라 뺀다. 규제 표현이 든 행도 뺀다 */
export function specRowsFromInput(specSheet: Record<string, unknown>): Array<{ label: string; value: string }> {
  return productInfoRows(specSheet);
}

// ─── 카피 배정 ────────────────────────────────────────────────────────────────

/** 특징(제목 있는 pointCards 앞 4개)과 detailPoints(주장·근거) — 카피 배정과 생성 쪽 피처 컷 주제가 같은 목록을 쓴다 */
export function pageFeatures(copy: CopywritingResult): {
  features: Array<{ title: string; description: string }>;
  points: Array<{ title: string; description: string }>;
} {
  return {
    features: (copy.pointCards ?? []).slice(0, 4).filter((c) => str(c?.title)),
    points: (copy.detailPoints ?? []).map((p) => normalizeDetailPoint(p as Record<string, string | undefined>)),
  };
}

/** 페이지 전체 카피 배정 — 섹션 순서대로 지나가며 앞에 나온 문장을 기억한다 */
function planCopy(copy: CopywritingResult, order: readonly ProSectionType[], images: Images, plan: DedupePlan): void {
  const has = new Set(order);
  const raw = copy as unknown as Record<string, CopyPair>;
  const { features, points } = pageFeatures(copy);
  const owner = matchFeatures(features, points);
  const used = new Set<number>();
  const shown: string[] = [];
  plan.shown = shown;
  const record = (...texts: unknown[]) => {
    for (const t of texts) if (str(t).trim()) shown.push(str(t).trim());
  };
  const fresh = (t: unknown) => Boolean(str(t).trim()) && !repeatsShown(str(t), shown);
  const pointDivFeatures = has.has(ProSectionType.POINT_DIV) ? Math.min(3, features.length) : 0;
  // concept_desc는 detailPoints[1]을 쓴다(content.ts) — 순서와 상관없이 그 항목은 다른 섹션에 다시 싣지 않는다
  if (has.has(ProSectionType.CONCEPT_DESC) && points[1]) used.add(1);

  for (const type of order) {
    switch (type) {
      case ProSectionType.HOOK_3STEP:
        record(copy.mainIntro.hook, copy.mainIntro.benefitHeadline, copy.mainIntro.subBenefit);
        break;
      case ProSectionType.PROBLEM_RAISE:
        record(copy.problem?.question, ...(copy.problem?.empathyLines ?? []));
        break;
      case ProSectionType.PROBLEM_EMPATHY: {
        // content.ts와 같은 줄 — 깊은 공감 줄이 있으면 그것을 그린다
        const deep = copy.problem?.empathyDeepLines;
        record(...(deep && deep.length > 0 ? deep : (copy.problem?.empathyLines ?? [])));
        break;
      }
      case ProSectionType.CONCEPT_DESC:
        record(points[1]?.title ?? copy.mainIntro.title, points[1]?.description ?? copy.summary);
        break;
      case ProSectionType.SOLUTION_GUIDE:
        record(copy.solution?.summary);
        break;
      case ProSectionType.MAIN_CUT: {
        // 합성(final_html)과 같은 mainCutCopy 우선 — 앞 문장을 되풀이하면 기존 규칙(detailPoints[0])
        const mc = raw.mainCutCopy;
        let headline: string;
        let description: string;
        if (fresh(mc?.headline)) {
          headline = str(mc?.headline);
          description = fresh(mc?.subCopy) ? str(mc?.subCopy) : '';
        } else {
          headline = points[0]?.title || copy.mainIntro.benefitHeadline || copy.mainIntro.title;
          description = points[0]?.description ?? '';
          if (points[0]?.title) used.add(0);
        }
        const titlesOnly = pointDivFeatures > 0;
        const pointCards = titlesOnly ? features.map((f) => ({ title: f.title, description: '' })) : copy.pointCards;
        plan.content[type] = { headline, description, pointCards };
        record(headline, description, ...pointCards.flatMap((c) => [c.title, c.description]));
        break;
      }
      case ProSectionType.POINT_DIV: {
        if (features.length === 0) break;
        // 특징 1~3의 주 섹션 — 그 특징을 다룬 detailPoint(주장·근거), 없으면 카드 원문
        const items = features.slice(0, 3).map((f, k) => {
          const i = owner.findIndex((o, idx) => o === k && !used.has(idx) && points[idx].title);
          if (i < 0) return { title: f.title, description: f.description };
          used.add(i);
          return { title: points[i].title, description: points[i].description };
        });
        plan.content[type] = { points: items };
        record(...items.flatMap((p) => [p.title, p.description]));
        break;
      }
      case ProSectionType.PRODUCT_EXPOSURE: {
        // 컷이 없으면 섹션이 빠진다(shouldActivateSection) — 보이지 않을 문장은 기록하지 않는다
        if (!resolveImageUrl(type, images)) break;
        const candidates = [raw.productExposure, has.has(ProSectionType.KEY_MESSAGE) ? undefined : raw.keyMessageCopy];
        const pick = candidates.find((c) => fresh(c?.headline));
        const headline = str(pick?.headline);
        const subCopy = pick && fresh(pick.subCopy) ? str(pick.subCopy) : '';
        plan.content[type] = { headline, subCopy };
        record(headline, subCopy);
        break;
      }
      case ProSectionType.SUB_DIV: {
        // ① 주 섹션이 아직 없는 특징의 주 항목(특징 순서) → ② 특징 밖 새 관점(제목이 앞 문장을 되풀이하면 빼고, 설명만 겹치면 설명만 뺀다)
        const items: SubItem[] = [];
        // 요약 카드가 설명까지 보인 페이지(point_div 없음)가 아니면, 짝 없는 특징은 카드 원문을 주 항목으로 싣는다
        const cardsShownFull = has.has(ProSectionType.MAIN_CUT) && pointDivFeatures === 0;
        for (let k = pointDivFeatures; k < features.length && items.length < 3; k++) {
          const i = owner.findIndex((o, idx) => o === k && !used.has(idx) && points[idx].title);
          if (i >= 0) {
            used.add(i);
            items.push({ ...points[i], index: i, feature: k });
          } else if (!cardsShownFull) {
            items.push({ title: features[k].title, description: features[k].description, index: -1, feature: k });
          }
        }
        points.forEach((p, i) => {
          if (items.length >= 3 || used.has(i) || !p.title || owner[i] >= 0 || !fresh(p.title)) return;
          used.add(i);
          items.push({ ...p, description: fresh(p.description) ? p.description : '', index: i });
        });
        if (items.length === 0) plan.drop.add(type);
        else plan.content[type] = { sectionTitle: copy.mainIntro.subtitle || '추가 특징', points: items };
        record(...items.flatMap((p) => [p.title, p.description]));
        break;
      }
      case ProSectionType.POINT_LIST_DIV:
        record(...(copy.recommendedTargets ?? []));
        break;
      case ProSectionType.PETIT_DIV: {
        const description = str(copy.colorOptions?.description);
        if (description && !fresh(description)) plan.content[type] = { description: '' };
        else record(description);
        break;
      }
      case ProSectionType.CTA:
        plan.content[type] = ctaContent(copy, has.has(ProSectionType.CONVERT_DIV));
        break;
      default:
        break;
    }
  }
}

// ─── 사진 배정 ────────────────────────────────────────────────────────────────

/** 남는 생성 컷 선호 순서 — 문제 장면·비교·배경·아이콘·옵션 컷은 특징 사진으로 쓰지 않는다 */
const SUB_PREFS = ['features', 'key_benefit_visual', 'howToImages', 'usage', 'concept_mood', 'direction_hint'];
const LIST_PREFS = ['usage', 'howToImages', 'key_benefit_visual', 'features', 'concept_mood', 'direction_hint'];
/** 남는 컷 풀 전체(sub_div·point_list_div가 고르는 키) — 안 쓰는 컷 빼기(W5 section-task-filter)가 이 키는 남긴다 */
export const SPARE_IMAGE_PREFS: readonly string[] = [...new Set([...SUB_PREFS, ...LIST_PREFS])];

function planImages(
  order: readonly ProSectionType[],
  images: Images,
  mobileFloor: boolean,
  plan: DedupePlan,
  split = false,
): void {
  const list = (key: string): string[] => {
    const v = images[key];
    return (Array.isArray(v) ? v : v ? [v] : []).map((u) => sanitizeImageUrl(u)).filter(Boolean);
  };
  // 피처 컷은 번호가 자리다 — 실패한 번호는 빈 칸('')이고, 압축한 목록으로 찾으면 뒤 번호 컷이 한 칸 당겨진다
  const features = images['features'];
  const featureAt = (i: number) =>
    sanitizeImageUrl(str(images[`feature_0${i}`])) || sanitizeImageUrl(Array.isArray(features) ? features[i] : '');
  const pointCount = (
    (plan.content[ProSectionType.POINT_DIV]?.points as unknown[] | undefined) ?? []
  ).length || 3;
  // 섹션별로 그려지는 컷(계획이 정하지 않는 섹션) — 대표 컷 + point_div 피처 + hidden_page 사용법 컷
  const drawn = (t: ProSectionType): string[] => {
    if (t === ProSectionType.POINT_DIV) return Array.from({ length: Math.min(3, pointCount) }, (_, i) => featureAt(i));
    if (t === ProSectionType.HIDDEN_PAGE) return list('howToImages');
    return [resolveImageUrl(t, images) ?? ''];
  };
  const planned = new Set([ProSectionType.SUB_DIV, ProSectionType.POINT_LIST_DIV]);
  const used = new Set(order.filter((t) => !planned.has(t)).flatMap(drawn).filter(Boolean));
  // 주 항목은 그 특징 번호의 컷(장식 라벨이 pointCards[k]) → 항목 번호의 컷
  const ownOf = (p: SubItem) =>
    [p.feature !== undefined ? featureAt(p.feature) : '', featureAt(p.index)].find((u) => u && !used.has(u));
  const subPoints = (plan.content[ProSectionType.SUB_DIV]?.points as SubItem[] | undefined) ?? [];
  // 뒤 항목의 자기 컷은 남는 컷이 아니다 — 앞 항목의 컷이 실패했을 때 그 컷을 먼저 가져가면 컷과 항목이 한 칸씩 엇갈린다
  const reserved = new Set(subPoints.map(ownOf).filter(Boolean));
  const spare = (prefs: readonly string[]) => prefs.flatMap(list).filter((u) => !used.has(u) && !reserved.has(u));

  let previous: string[] = [];
  for (const type of order) {
    if (type === ProSectionType.SUB_DIV && plan.content[type]) {
      const points = plan.content[type].points as SubItem[];
      const current: string[] = [];
      for (const p of points) {
        // 자기 컷 → 남는 컷
        let pick: string | undefined = ownOf(p) ?? spare(SUB_PREFS)[0];
        // 남는 컷이 없을 때: 한 열(모바일 하한)은 사진 없이, 지그재그는 바로 앞 섹션·같은 섹션에 없던, 이미 쓴 피처 컷만(뒤 항목 몫 제외).
        // 나누기 잡(W4-S)은 특징마다 섹션이라 다른 섹션의 컷을 다시 쓰지 않는다 — 사진 없는 글 카드(통합 조건 b)
        if (!pick && !mobileFloor && !split)
          pick = list('features').find((u) => used.has(u) && !previous.includes(u) && !current.includes(u));
        p.image = pick ?? '';
        if (pick) {
          used.add(pick);
          current.push(pick);
        }
      }
      previous = current;
    } else if (type === ProSectionType.POINT_LIST_DIV) {
      // 추천 대상 컷은 사진 없이도 성립한다 — 다 쓴 컷을 다시 쓰지 않는다
      const pick = spare(LIST_PREFS)[0] ?? '';
      plan.images[type] = pick;
      if (pick) used.add(pick);
      previous = pick ? [pick] : [];
    } else if (!plan.drop.has(type)) {
      previous = drawn(type).filter(Boolean);
    }
  }
  plan.usedImages = [...used];
}

/** 특징·사진 중복 정리 계획 — convertToCanvasSections가 섹션 순서를 정한 뒤 한 번 만든다 */
export function planFeatureDedupe(
  copy: CopywritingResult,
  order: readonly ProSectionType[],
  images: Images,
  mobileFloor: boolean,
  opts: { split?: boolean } = {},
): DedupePlan {
  const plan: DedupePlan = { content: {}, drop: new Set(), images: {} };
  planCopy(copy, order, images, plan);
  planImages(order, images, mobileFloor, plan, opts.split === true);
  return plan;
}
