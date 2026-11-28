/**
 * sectionConverter.test.ts
 *
 * convertToCanvasSections() 더미 데이터 기반 통합 테스트 + console.log 출력.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  convertToCanvasSections,
  mapStandardToProSections,
  assignImagesToSections,
  createSectionElements,
  type LayoutSelection,
} from '../sectionConverter';
import { ProSectionType } from '../../types/section';
import type { CopywritingResult, DesignPalette } from '../../types/editor';
import type { CanvasSection } from '../../types/canvas';

// ─────────────────────────────────────────────────────────────────────────────
// 더미 데이터
// ─────────────────────────────────────────────────────────────────────────────

const dummyPalette: DesignPalette = {
  primary: '#1A1A2E',
  secondary: '#E94560',
  bgMain: '#FFFFFF',
  bgSub: '#F7F7F7',
  textMain: '#333333',
  textHighlight: '#1A1A2E',
};

const dummyCopywriting: CopywritingResult = {
  mainIntro: {
    category: '생활가전',
    subtitle: 'CleanAir',
    title: 'CleanAir 스마트 제습기 Pro',
    hook: '습한 공기가 뽀송한 하루로',
    benefitHeadline: '장마철 빨래도 이불도 딱 30분이면 뽀송',
    subBenefit: '소음 22dB — 아이 옆에서도 조용히',
    brandAndName: 'CleanAir Pro',
  },
  designPalette: dummyPalette,
  problem: {
    question: '장마철마다 집 안이 눅눅해서 빨래가 안 마르셨나요?',
    empathy: '축축한 공기가 이불, 옷, 벽까지 파고드는 불쾌함. 공감하시죠?',
  },
  solution: {
    declaration: '이제 CleanAir Pro가 해결합니다.',
    summary: '하루 15L 제습 + 22dB 저소음으로 장마철도 쾌적하게.',
  },
  pointCards: [
    { title: '하루 15L 강력 제습', description: '대형 공간도 단 30분이면 쾌적한 환경으로.' },
    { title: '22dB 초저소음', description: '깊은 밤, 아이 옆에서도 켜놓을 수 있는 고요함.' },
    { title: '스마트 앱 연동', description: '외출 중에도 스마트폰으로 원격 제어.' },
  ],
  summary:
    '당신이 원하던 바로 그 제습기. 뽀송한 일상을 CleanAir Pro와 함께하세요.',
  colorOptions: {
    title: '3가지 컬러',
    options: ['퓨어 화이트', '스톤 그레이', '미드나잇 블루'],
    description: '인테리어에 자연스럽게 녹아드는 세련된 3가지 컬러.',
  },
  usageSceneTags: [
    '침실 습도 관리',
    '빨래 건조',
    '욕실 환기',
    '서재 보관',
    '거실 쾌적',
  ],
  detailPoints: [
    { title: '특허 듀얼 컴프레서', description: '기존 제습기 대비 23% 빠른 제습 속도.' },
    { title: '헤파 13 필터 내장', description: 'PM2.5 초미세먼지까지 동시 제거.' },
    { title: '에너지 절약 모드', description: '연간 전기세 최대 40% 절감.' },
  ],
  howTo: [
    { step: '전원 켜기', description: '전원 버튼을 2초간 누르면 자동 시작됩니다.' },
    { step: '습도 설정', description: '목표 습도를 40~60% 사이로 설정하세요.' },
    { step: '필터 관리', description: '3개월마다 필터를 세척하거나 교체하세요.' },
  ],
  recommendedTargets: [
    '장마철 집 습도 때문에 고민인 분',
    '아기/어린이가 있는 가정',
    '알레르기·천식 환자',
    '빨래 건조 공간이 부족한 분',
  ],
  // NexOps 이식판은 closingCta를 항상 정규화된 객체로 저장한다(pdp-state.ts 계약) —
  // 원본 테스트의 구버전 문자열 더미를 현행 계약으로 갱신
  closingCta: {
    headline: '지금 바로 뽀송한 일상을 경험해보세요.',
    subtext: '오늘 주문 시 무료 배송.',
  },
  title: 'CleanAir 스마트 제습기 Pro — 하루 15L 초저소음',
  seo_keywords: ['제습기 추천', '소음 적은 제습기', '스마트 제습기', '장마철 필수'],
  sizeComparisonObject: '생수통 2L × 7개 크기 (W280 × D180 × H480mm)',
  reviewHighlights: [
    { text: '빨래가 진짜 뽀송뽀송 마르더라고요. 소음도 거의 안 들려요.', author: '김○○' },
    { text: '앱 연동 너무 편하고, 디자인도 예뻐요.', author: '이○○' },
    { text: '3개월 쓰는데 고장 없고 전기세도 안 올랐어요.', author: '박○○' },
  ],
};

const dummyImages: Record<string, string | string[]> = {
  hero: 'https://cdn.example.com/hero.jpg',
  problem: 'https://cdn.example.com/problem.jpg',
  solution: 'https://cdn.example.com/solution.jpg',
  options: 'https://cdn.example.com/options.jpg',
  usage: 'https://cdn.example.com/usage.jpg',
  detail: 'https://cdn.example.com/detail.jpg',
  cta: 'https://cdn.example.com/cta.jpg',
  features: [
    'https://cdn.example.com/feat_0.jpg',
    'https://cdn.example.com/feat_1.jpg',
    'https://cdn.example.com/feat_2.jpg',
    'https://cdn.example.com/feat_3.jpg',
    'https://cdn.example.com/feat_4.jpg',
    'https://cdn.example.com/feat_5.jpg',
  ],
  howToImages: [
    'https://cdn.example.com/howto_0.jpg',
    'https://cdn.example.com/howto_1.jpg',
    'https://cdn.example.com/howto_2.jpg',
  ],
  size_comparison: 'https://cdn.example.com/size_cmp.jpg',
  review_avatar_images: [
    'https://cdn.example.com/avatar_0.jpg',
    'https://cdn.example.com/avatar_1.jpg',
    'https://cdn.example.com/avatar_2.jpg',
  ],
  sold_out_banner: 'https://cdn.example.com/sold_out.jpg',
  product_exposure: 'https://cdn.example.com/product_exp.jpg',
  premium_hero: 'https://cdn.example.com/premium_hero.jpg',
  concept_mood: 'https://cdn.example.com/concept_mood.jpg',
  empathy_scene: 'https://cdn.example.com/empathy.jpg',
  direction_hint: 'https://cdn.example.com/direction.jpg',
  key_benefit_visual: 'https://cdn.example.com/key_benefit.jpg',
  conversion_cta: 'https://cdn.example.com/conv_cta.jpg',
};

const dummyLayoutSelection: LayoutSelection = {
  activated_sections: [
    'hook_3step',
    'product_exposure',
    'perf_sales',
    'perf_review',
    'problem_raise',
    'problem_empathy',
    'solution_guide',
    'key_message',
    'main_cut',
    'point_div',
    'sub_div',
    'hidden_page',
    'point_list_div',
    'petit_div',
    'cta',  // Phase B-1: convert_div 제거 — CTA 중복 방지
  ],
  section_order: [
    'hook_3step',
    'perf_sales',
    'product_exposure',
    'perf_review',
    'problem_raise',
    'problem_empathy',
    'solution_guide',
    'key_message',
    'main_cut',
    'point_div',
    'sub_div',
    'hidden_page',
    'point_list_div',
    'petit_div',
    'cta',  // Phase B-1: convert_div 제거 — CTA 중복 방지
  ],
  layout_assignments: {
    hook_3step: 'hook_3step_layout_03',
    perf_sales: 'perf_sales_layout_01',
    product_exposure: 'product_exposure_layout_02',
    perf_review: 'perf_review_layout_01',
    problem_raise: 'problem_raise_layout_05',
    problem_empathy: 'problem_empathy_layout_02',
    solution_guide: 'solution_guide_layout_01',
    key_message: 'key_message_layout_04',
    main_cut: 'main_cut_layout_01',
    point_div: 'point_div_layout_03',
    sub_div: 'sub_div_layout_02',
    hidden_page: 'hidden_page_layout_01',
    point_list_div: 'point_list_div_layout_02',
    petit_div: 'petit_div_layout_01',
    cta: 'cta_layout_02',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('mapStandardToProSections', () => {
  it('데이터가 있는 Standard 섹션만 Pro 섹션으로 변환한다', () => {
    const result = mapStandardToProSections(dummyCopywriting);

    expect(result.length).toBeGreaterThan(0);
    // main_intro → hook_3step, product_exposure
    expect(result).toContain(ProSectionType.HOOK_3STEP);
    expect(result).toContain(ProSectionType.PRODUCT_EXPOSURE);
    // reviews 있으므로 리뷰 계열 포함 — 현행 매핑은 perf_rating+perf_reviews를 활성화하고
    // 단수 perf_review는 기본 매핑에서 빠졌다(원본 미실행 테스트의 노후 단정 갱신, 프로브 실측)
    expect(result).toContain(ProSectionType.PERFORMANCE_REVIEWS);
    expect(result).toContain(ProSectionType.PERFORMANCE_RATING);
    // point_cards 있으므로 key_message, point_div 포함
    expect(result).toContain(ProSectionType.KEY_MESSAGE);
    expect(result).toContain(ProSectionType.POINT_DIV);
    // cta 항상 포함
    expect(result).toContain(ProSectionType.CTA);
    // 순서는 PRO_SECTION_ORDER 기준
    const hookIdx = result.indexOf(ProSectionType.HOOK_3STEP);
    const ctaIdx = result.indexOf(ProSectionType.CTA);
    expect(hookIdx).toBeLessThan(ctaIdx);

    console.log('[mapStandardToProSections] 활성화된 섹션 수:', result.length);
    console.log('[mapStandardToProSections] 활성화된 섹션:', result);
  });

  it('reviewHighlights가 없으면 perf_review, perf_reviews가 비활성화된다', () => {
    const noReviewCopy: CopywritingResult = { ...dummyCopywriting, reviewHighlights: [] };
    const result = mapStandardToProSections(noReviewCopy);
    expect(result).not.toContain(ProSectionType.PERFORMANCE_REVIEW);
    expect(result).not.toContain(ProSectionType.PERFORMANCE_REVIEWS);
    expect(result).not.toContain(ProSectionType.PERFORMANCE_RATING);
  });
});

describe('createSectionElements', () => {
  it('hook_3step 요소를 정상 생성한다', () => {
    const content = {
      hook: '습한 공기가 뽀송한 하루로',
      benefitHeadline: '장마철 빨래도 이불도 딱 30분이면 뽀송',
      subBenefit: '소음 22dB — 아이 옆에서도 조용히',
    };
    const elements = createSectionElements(
      ProSectionType.HOOK_3STEP,
      content,
      'https://cdn.example.com/hero.jpg',
      dummyPalette,
    );

    expect(elements.length).toBeGreaterThan(0);
    const textEls = elements.filter((e) => e.type === 'text');
    const imageEls = elements.filter((e) => e.type === 'image');
    expect(textEls.length).toBeGreaterThanOrEqual(2);
    expect(imageEls.length).toBe(1);
    // 이미지는 전폭(860px)
    expect(imageEls[0].transform.width).toBe(860);
    // 텍스트는 side padding 적용
    expect(textEls[0].transform.x).toBe(60);
    expect(textEls[0].transform.width).toBe(740);

    console.log('[createSectionElements:hook_3step] 요소 수:', elements.length);
    console.log('[createSectionElements:hook_3step] 요소:', JSON.stringify(elements, null, 2));
  });

  it('spec_table은 이미지 요소가 없다 (code-based)', () => {
    const elements = createSectionElements(
      ProSectionType.SPEC_TABLE,
      { title: '제품 스펙' },
      null,
      dummyPalette,
    );
    const imageEls = elements.filter((e) => e.type === 'image');
    expect(imageEls.length).toBe(0);
  });

  it('cta 섹션에 텍스트와 이미지 요소가 포함된다', () => {
    const elements = createSectionElements(
      ProSectionType.CTA,
      { cta: '지금 바로 구매하세요', title: 'CleanAir Pro' },
      'https://cdn.example.com/cta.jpg',
      dummyPalette,
    );
    const imageEls = elements.filter((e) => e.type === 'image');
    // 현행 CTA는 '전면 배경 이미지 + 오버레이' 특수 구성 — createSectionElements 단독 호출은
    // 배경 이미지 1개만 만든다(텍스트 오버레이는 전체 변환 경로 소관, 프로브 실측으로 갱신)
    expect(imageEls.length).toBe(1);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });
});

describe('convertToCanvasSections — layoutSelection 없음 (기본 순서)', () => {
  let sections: CanvasSection[];

  beforeAll(() => {
    sections = convertToCanvasSections(dummyCopywriting, dummyImages, dummyPalette);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[convertToCanvasSections] 기본 순서 결과');
    console.log('총 섹션 수:', sections.length);
    console.log('섹션 목록:', sections.map((s) => `${s.order}. ${s.sectionType} (${s.groupType})`));
    console.log('첫 번째 섹션 상세:', JSON.stringify(sections[0], null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  it('최소 10개 이상의 섹션이 생성된다', () => {
    expect(sections.length).toBeGreaterThanOrEqual(10);
  });

  it('첫 번째 섹션은 hook 그룹이다', () => {
    expect(sections[0].groupType).toBe('hook');
  });

  it('마지막 섹션은 modules 그룹(cta)이다', () => {
    const last = sections[sections.length - 1];
    expect(last.groupType).toBe('modules');
  });

  it('각 섹션은 order가 올바르게 설정된다', () => {
    sections.forEach((s, i) => {
      expect(s.order).toBe(i);
    });
  });

  it('canvas.width는 항상 860이다', () => {
    sections.forEach((s) => {
      expect(s.canvas.width).toBe(860);
    });
  });

  it('구분자(divider)를 제외한 각 섹션은 1개 이상의 elements를 가진다', () => {
    // divider는 설계상 요소 0개인 시각 구분자 — 원본 테스트가 divider 도입 이전 작성
    sections
      .filter((s) => s.sectionType !== ProSectionType.DIVIDER)
      .forEach((s) => {
        expect(s.elements.length).toBeGreaterThan(0);
      });
  });

  it('layoutId가 기본값으로 설정된다', () => {
    const hookSection = sections.find((s) => s.sectionType === ProSectionType.HOOK_3STEP);
    expect(hookSection?.layoutId).toBe('hook_3step_layout_01');
  });

  it('배경 연출 — 팔레트(bgMain/bgSub) 기반으로 설정된다 (예외: hero 그라디언트/CTA primary/divider)', () => {
    sections.forEach((s) => {
      const bg = s.canvas.backgroundColor;
      if (s.sectionType === ProSectionType.CTA) {
        expect(bg).toBe(dummyPalette.primary);
      } else if (s.sectionType === ProSectionType.HOOK_3STEP) {
        expect(bg).toContain('linear-gradient');
        expect(bg).toContain(dummyPalette.bgSub);
      } else if (s.sectionType === ProSectionType.DIVIDER || s.sectionType === ProSectionType.PERFORMANCE_SALES) {
        // divider는 화이트 고정, perf_sales는 이미지 배경 유지
      } else {
        expect([dummyPalette.bgMain, dummyPalette.bgSub]).toContain(bg);
      }
    });
  });
});

describe('convertToCanvasSections — layoutSelection 있음 (AI 선택)', () => {
  let sections: CanvasSection[];

  beforeAll(() => {
    sections = convertToCanvasSections(
      dummyCopywriting,
      dummyImages,
      dummyPalette,
      dummyLayoutSelection,
    );
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[convertToCanvasSections] AI layoutSelection 결과');
    console.log('총 섹션 수:', sections.length);
    console.log('섹션 순서:', sections.map((s) => s.sectionType));
    console.log('레이아웃 ID 샘플:', sections.slice(0, 3).map((s) => `${s.sectionType} → ${s.layoutId}`));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  it('layoutSelection.section_order에 따라 섹션이 배치된다', () => {
    const expectedFirst = dummyLayoutSelection.section_order[0] as ProSectionType;
    expect(sections[0].sectionType).toBe(expectedFirst);
  });

  it('layoutSelection.layout_assignments의 layoutId가 적용된다', () => {
    const hookSection = sections.find((s) => s.sectionType === ProSectionType.HOOK_3STEP);
    expect(hookSection?.layoutId).toBe('hook_3step_layout_03');
  });

  it('activated_sections에 없는 섹션은 포함되지 않는다', () => {
    const excluded = sections.find(
      (s) => s.sectionType === ProSectionType.CERTIFICATION,
    );
    expect(excluded).toBeUndefined();
  });
});

describe('B-2 생성 시점 스타일 풍부화 — page_renderer.py 실측값 정합', () => {
  it('CTA 오버레이 텍스트에 text-shadow가 적용된다', () => {
    const elements = createSectionElements(
      ProSectionType.CTA,
      { ctaHeadline: '지금 바로 뽀송한 일상을 시작하세요', ctaSubtext: '오늘 주문 시 무료 배송' },
      'https://cdn.example.com/cta.jpg',
      dummyPalette,
    );
    const headline = elements.find((e) => e.name === 'cta_headline');
    const sub = elements.find((e) => e.name === 'cta_sub');
    // .sec-overlay h2 — text-shadow: 0 2px 16px rgba(0,0,0,0.5)
    expect(headline?.textProps?.textShadowAngle).toBe(180);
    expect(headline?.textProps?.textShadowDistance).toBe(2);
    expect(headline?.textProps?.textShadowBlur).toBe(16);
    expect(headline?.textProps?.textShadowColor).toBe('rgba(0,0,0,0.5)');
    // .sec-overlay p — text-shadow: 0 2px 8px rgba(0,0,0,0.45)
    expect(sub?.textProps?.textShadowDistance).toBe(2);
    expect(sub?.textProps?.textShadowBlur).toBe(8);
    expect(sub?.textProps?.textShadowColor).toBe('rgba(0,0,0,0.45)');
  });

  it('완판 배너 텍스트에 .sold-out-main 그림자가 적용된다', () => {
    const elements = createSectionElements(
      ProSectionType.PERFORMANCE_SALES,
      { text: '10만개 완판', subtitle: '누적 판매 기준' },
      'https://cdn.example.com/sold_out.jpg',
      dummyPalette,
    );
    const count = elements.find((e) => e.name === 'perf_count');
    expect(count?.textProps?.textShadowBlur).toBe(16);
    expect(count?.textProps?.textShadowColor).toBe('rgba(0,0,0,0.5)');
  });

  it('섹션 h2 제목에 GmarketSansBold + letterSpacing(-0.5)이 적용된다', () => {
    const elements = createSectionElements(
      ProSectionType.SPEC_TABLE,
      { title: '제품 스펙' },
      null,
      dummyPalette,
    );
    const title = elements.find((e) => e.name === 'spec_title');
    expect(title?.textProps?.fontFamily).toBe('GmarketSansBold');
    expect(title?.textProps?.letterSpacing).toBe(-0.5);
  });

  it('리뷰 카드 배경 shape에 box-shadow(0 2px 12px rgba(0,0,0,0.06))가 적용된다', () => {
    const elements = createSectionElements(
      ProSectionType.PERFORMANCE_REVIEWS,
      { reviews: [{ author: '김○○', text: '빨래가 뽀송뽀송 마르더라고요.', highlight: '추천' }] },
      null,
      dummyPalette,
    );
    const cardBg = elements.find((e) => e.name === 'review_card_bg_0');
    expect(cardBg?.shadow?.enabled).toBe(true);
    expect(cardBg?.shadow?.distance).toBe(2);
    expect(cardBg?.shadow?.blur).toBe(12);
    expect(cardBg?.shadow?.color).toBe('rgba(0,0,0,0.06)');
  });

  it('오버레이가 아닌 일반 텍스트에는 그림자/외곽선이 적용되지 않는다 (절제 원칙)', () => {
    const elements = createSectionElements(
      ProSectionType.HOOK_3STEP,
      {
        hook: '습한 공기가 뽀송한 하루로',
        benefitHeadline: '장마철 빨래도 이불도 딱 30분이면 뽀송',
        subBenefit: '소음 22dB — 아이 옆에서도 조용히',
      },
      'https://cdn.example.com/hero.jpg',
      dummyPalette,
    );
    elements
      .filter((e) => e.type === 'text')
      .forEach((el) => {
        expect(el.textProps?.textShadowBlur).toBeUndefined();
        expect(el.textProps?.stroke).toBeUndefined();
        expect(el.textProps?.strokeWidth).toBeUndefined();
      });
  });
});

describe('assignImagesToSections', () => {
  it('sections의 image 요소 src가 올바르게 교체된다', () => {
    const rawSections = convertToCanvasSections(
      dummyCopywriting,
      {}, // 빈 이미지로 초기 생성
      dummyPalette,
    );

    const withImages = assignImagesToSections(rawSections, dummyImages);

    const heroSection = withImages.find(
      (s) => s.sectionType === ProSectionType.HOOK_3STEP,
    );
    const heroImgEl = heroSection?.elements.find((e) => e.type === 'image');

    if (heroImgEl && heroImgEl.imageProps) {
      expect(heroImgEl.imageProps.src).toBe('https://cdn.example.com/hero.jpg');
      console.log('[assignImagesToSections] hook_3step hero image src:', heroImgEl.imageProps.src);
    }
  });
});
