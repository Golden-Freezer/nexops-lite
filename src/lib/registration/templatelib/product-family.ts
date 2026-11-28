/**
 * 제품군 — 카테고리 8키 아래 층(통합 11-01 결정). 카테고리 템플릿의 fit.productFamilies와 상품의 spec_sheet.productFamily가 쓰는 값이다.
 * 같은 카테고리라도 사료와 용품, 화장품과 도구는 구매 결정과 사진 언어가 갈려서 둔다. 값은 조사 제안이고 측정 전이다.
 */

import { heroKindOf, type HeroKindChoice } from '../hero-kind'
import type { HeroKind, PdpSpecSheet } from '../pdp-state'

export const PRODUCT_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  beauty: ['cosmetic', 'beauty_tool'],
  pet: ['pet_food', 'pet_goods'],
  fashion: ['apparel', 'accessory', 'sports_support'],
  digital: ['device', 'phone_accessory'],
  household: ['kitchen_storage', 'home_decor', 'garden_diy', 'bedding_fabric', 'daily_care'],
  stationery: ['sticker_deco', 'paper_planner'],
  packaging: ['gift_wrap', 'shipping_bulk'],
  food: ['fresh', 'processed', 'gift_set', 'health_food'],
}

/** 상품의 제품군 — 그 카테고리의 값이 아니면 없는 것으로 본다. 다른 카테고리의 템플릿이 끼어들지 않게 한다 */
export function productFamilyOf(categoryKey: string, value: string | undefined): string | undefined {
  const family = value?.trim()
  return family && PRODUCT_FAMILIES[categoryKey]?.includes(family) ? family : undefined
}

/** 세부 카테고리 → 제품군 — 판정 8종에 없는 구분(product-info-rows의 세부 칸)만 옮긴다 */
const DETAIL_FAMILY: Readonly<Record<string, string>> = { garden: 'garden_diy' }

/**
 * 상품명 낱말 → 제품군(hero-kind의 WORN_RE 방식, 추가 콜 없음). 카테고리마다 위 줄부터 먼저 맞는 값을 쓴다.
 * 더 좁은 쪽을 위에 둔다 — '두피 샴푸 브러쉬'는 도구, '사료 그릇'은 용품, '다이어리 스티커'는 스티커다.
 * 맞는 낱말이 없으면 비운다. 시험 상품은 11개뿐이라 나머지 줄은 낱말 설계 판단이고 측정 전이다.
 */
export const FAMILY_NAME_RULES: Readonly<Record<string, ReadonlyArray<readonly [string, RegExp]>>> = {
  beauty: [
    ['beauty_tool', /브러쉬|브러시|빗|퍼프|뷰러|고데기|드라이기|면도기|족집게|스파츌라|마사지기/],
    ['cosmetic', /크림|세럼|에센스|앰플|토너|스킨|로션|클렌징|파운데이션|쿠션|립스틱|립밤|틴트|마스카라|샴푸|린스|트리트먼트|마스크팩|향수/],
  ],
  pet: [
    ['pet_goods', /빗|브러쉬|브러시|슬리커|그릇|식기|급식기|급수기|장난감|하네스|목줄|리드줄|방석|하우스|켄넬|이동장|배변|화장실|모래|보관통/],
    ['pet_food', /사료|간식|츄르|습식|건식|영양제|캔/],
  ],
  fashion: [
    ['sports_support', /보호대|아대|토시|테이핑|서포터|압박/],
    ['apparel', /티셔츠|셔츠|바지|팬츠|자켓|재킷|코트|원피스|치마|스커트|니트|후드|맨투맨|레깅스|조끼|속옷/],
    ['accessory', /가방|백팩|크로스백|토트백|지갑|벨트|모자|비니|양말|장갑|머플러|스카프|목걸이|팔찌|반지|귀걸이|신발|슬리퍼|운동화/],
  ],
  digital: [
    ['phone_accessory', /스트랩|케이스|거치대|그립톡|보호필름|강화유리|핑거링|폰고리|케이블/],
    ['device', /이어폰|헤드폰|헤드셋|키보드|마우스|모니터|노트북|태블릿|스마트폰|휴대폰|핸드폰|스마트워치|스피커|카메라|공유기|충전기|보조배터리/],
  ],
  household: [
    ['garden_diy', /원예|식물(?!성)|화분|농작물|텃밭|모종|전지가위|공구/],
    ['bedding_fabric', /이불|베개|침구|매트리스|토퍼|담요|패브릭/],
    ['daily_care', /세제|휴지|물티슈|섬유유연제|방향제|청소/],
    ['kitchen_storage', /주방|수납|밀폐|냄비|프라이팬|도마|식기|텀블러|정리함|선반/],
    ['home_decor', /인테리어|조명|무드등|액자|커튼|러그|벽시계/],
  ],
  stationery: [
    ['sticker_deco', /스티커|마스킹|마테|데코|라벨지/],
    ['paper_planner', /다이어리|플래너|노트(?!북)|메모지|메모패드|편지지|엽서|수첩/],
  ],
  packaging: [
    ['gift_wrap', /선물|구디백|답례|포장지|리본|기프트|쇼핑백|파우치/],
    ['shipping_bulk', /택배|박스|뽁뽁이|에어캡|완충|폴리백/],
  ],
  food: [
    ['gift_set', /선물\s*세트|명절/],
    ['health_food', /영양제|비타민|유산균|프로바이오틱스|오메가|홍삼|콜라겐|건강기능/],
    ['processed', /즉석|밀키트|레토르트|통조림|과자|라면|소스|음료|주스|커피|잼/],
    ['fresh', /신선|산지|정육|한우|과일|채소|사과|귤|딸기/],
  ],
}

/**
 * 상품의 제품군 판정(A6 #9) — 입력값 → 세부 카테고리 → 상품명 낱말 → 없으면 비움. 그 카테고리의 값만 낸다.
 * 다른 카테고리의 입력값은 없는 것으로 보고 아래 단계로 내려간다(경고는 부르는 쪽이 낸다).
 */
export function judgeProductFamily(categoryKey: string, spec: { productFamily?: string; categoryDetail?: string; productName?: string }): string | undefined {
  const given = productFamilyOf(categoryKey, spec.productFamily)
  if (given) return given
  const detail = productFamilyOf(categoryKey, DETAIL_FAMILY[spec.categoryDetail?.trim() ?? ''])
  if (detail) return detail
  const name = spec.productName ?? ''
  return FAMILY_NAME_RULES[categoryKey]?.find(([, words]) => words.test(name))?.[0]
}

/**
 * K 첫 화면 유형의 제품군 줄(적용 K6 T1-80 ②, A6 #12 표 5, 통합 11-03 16:3x) — 화장품은 판매 상위 첫 사진이 단색·누끼 61%·공간 9%라 스튜디오다.
 * 뷰티 카테고리 규칙(실사용)은 뷰티 도구 쪽에 맞다. D·R의 첫 화면(hero-kind.ts)은 그대로 둔다
 */
export const FAMILY_HERO_KIND: Readonly<Record<string, HeroKind>> = { cosmetic: 'studio' }

/** K 첫 화면 유형 — 입력값(heroImageMode)과 인쇄물이 먼저고, 그다음 제품군 줄, 없으면 heroKindOf 규칙 그대로다. K 컷 배정·기록·첫 화면 프롬프트가 같이 쓴다 */
export function lineHeroKindOf(
  spec: Pick<PdpSpecSheet, 'heroImageMode' | 'productName' | 'productFamily' | 'categoryDetail'>,
  categoryKey: string,
  textBearing: boolean
): HeroKindChoice {
  const base = heroKindOf(spec, categoryKey, textBearing)
  if (spec.heroImageMode || textBearing) return base
  const family = judgeProductFamily(categoryKey, spec)
  const kind = family ? FAMILY_HERO_KIND[family] : undefined
  return kind ? { kind, reason: `제품군 ${family}` } : base
}
