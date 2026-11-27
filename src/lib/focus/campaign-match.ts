export interface CampaignMatchProduct {
  id: string;
  product_name: string | null;
  coupang_exposure_id: string | null;
  product_grade: string | null;
}

export interface CampaignProductMatch {
  product_id: string;
  product_name: string;
  coupang_exposure_id: string | null;
  product_grade: string | null;
  score: number;
}

const CAMPAIGN_PREFIX_PATTERN =
  /^(?:(?:\d{6,8}|[a-z]{1,12}\d+|\d+[a-z]{1,12})[_\-\s]+)+/iu;
const OPERATION_PREFIX_PATTERN =
  /^(?:(?:그로스|매출\s*최적화|매최|sales|product\s*target\s*roas)[_\-\s]+)+/iu;
const ROAS_SUFFIX_PATTERN = /[_\-\s]+\d+(?:\.\d+)?\s*%\s*$/u;
const MIN_MATCH_SCORE = 0.3;

function isPreferredRepresentative(product: CampaignMatchProduct): boolean {
  return product.product_grade === "NEW" || product.product_grade === null;
}

/** 같은 노출ID의 상품 변형 중 NEW/null 등급을 우선해 대표 상품 한 건만 남긴다. */
export function dedupeProductsByExposureId(
  products: CampaignMatchProduct[],
): CampaignMatchProduct[] {
  const representatives = new Map<string, CampaignMatchProduct>();

  for (const product of products) {
    const exposureId = product.coupang_exposure_id?.trim();
    if (!exposureId) continue;

    const current = representatives.get(exposureId);
    if (
      !current ||
      (!isPreferredRepresentative(current) &&
        isPreferredRepresentative(product))
    ) {
      representatives.set(exposureId, {
        ...product,
        coupang_exposure_id: exposureId,
      });
    }
  }

  return [...representatives.values()];
}

/** 캠페인 운영용 접두·접미 정보와 옵션명을 제거해 상품명 비교 문자열을 만든다. */
export function normalizeCampaignName(
  value: string | null | undefined,
): string {
  if (!value) return "";

  let normalized = value.normalize("NFKC").trim();
  normalized = normalized.split(/[,，]/u, 1)[0] ?? "";
  normalized = normalized.replace(ROAS_SUFFIX_PATTERN, "");
  normalized = normalized.replace(CAMPAIGN_PREFIX_PATTERN, "");
  normalized = normalized.replace(OPERATION_PREFIX_PATTERN, "");

  return normalizeComparable(normalized);
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenCoverage(sourceTokens: string[], target: string): number {
  if (sourceTokens.length === 0 || !target) return 0;

  const targetTokens = target.split(" ");
  const matched = sourceTokens.reduce((sum, source) => {
    if (targetTokens.includes(source)) return sum + 1;
    if (source.length >= 2 && target.includes(source)) return sum + 0.9;

    const partial = targetTokens.reduce((best, token) => {
      if (token.length < 2) return best;
      if (source.includes(token) || token.includes(source)) {
        return Math.max(
          best,
          Math.min(source.length, token.length) /
            Math.max(source.length, token.length),
        );
      }
      return best;
    }, 0);
    return sum + partial;
  }, 0);

  return matched / sourceTokens.length;
}

/** 토큰 겹침과 공백 제거 문자열의 포함 관계를 조합해 0~1 점수를 계산한다. */
export function scoreCampaignProduct(
  campaignName: string | null | undefined,
  productName: string | null | undefined,
): number {
  const campaign = normalizeCampaignName(campaignName);
  const product = productName ? normalizeComparable(productName) : "";
  if (!campaign || !product) return 0;

  const campaignCompact = campaign.replace(/\s/g, "");
  const productCompact = product.replace(/\s/g, "");
  if (campaignCompact === productCompact) return 1;

  const shorterLength = Math.min(campaignCompact.length, productCompact.length);
  const longerLength = Math.max(campaignCompact.length, productCompact.length);
  const containmentScore =
    campaignCompact.includes(productCompact) ||
    productCompact.includes(campaignCompact)
      ? 0.8 + 0.2 * (shorterLength / longerLength)
      : 0;
  const campaignCoverage = tokenCoverage(campaign.split(" "), product);
  const productCoverage = tokenCoverage(product.split(" "), campaign);
  const tokenScore = campaignCoverage * 0.7 + productCoverage * 0.3;

  return Math.round(Math.max(containmentScore, tokenScore) * 1_000) / 1_000;
}

/** 점수가 있는 상품만 높은 순서로 반환한다. 동점은 상품명과 ID로 안정 정렬한다. */
export function matchCampaignProducts(
  campaignName: string | null | undefined,
  products: CampaignMatchProduct[],
  topN = 3,
): CampaignProductMatch[] {
  const limit = Math.max(0, Math.min(3, Math.floor(topN)));
  if (limit === 0) return [];

  return dedupeProductsByExposureId(products)
    .flatMap((product) => {
      if (!product.product_name) return [];
      const score = scoreCampaignProduct(campaignName, product.product_name);
      return score >= MIN_MATCH_SCORE
        ? [
            {
              product_id: product.id,
              product_name: product.product_name,
              coupang_exposure_id: product.coupang_exposure_id,
              product_grade: product.product_grade ?? null,
              score,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product_name.localeCompare(right.product_name, "ko-KR") ||
        left.product_id.localeCompare(right.product_id),
    )
    .slice(0, limit);
}
