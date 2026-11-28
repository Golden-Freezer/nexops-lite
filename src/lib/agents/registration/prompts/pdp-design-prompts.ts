/**
 * PDP 파이프라인 3단계(디자인프롬프트) 프롬프트 — NEXFIT agents/design_prompt_agent.py 번역.
 * SSOT: docs/plans/registration-tab/PROMPT-INVENTORY.md §3.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 본문은 의미·문구 변경 없이 그대로 옮기고,
 * 각 상수에 원본 파일:행 출처를 남긴다. LLM 호출 코드는 여기 두지 않는다 — 순수 문자열 조립만.
 *
 * 치환 방식(핵심 — 인벤토리 §0-6): 원본은 프롬프트별로 두 가지 방식을 섞어 쓴다 —
 * SECTION_PLANNING_PROMPT는 `.format()`(agent.py:930-943), DESIGN_PROMPT_ENGINEERING_PROMPT는
 * `str.replace()`(agent.py:1251-1268, JSON 예시의 단일 중괄호와 `.format()` 충돌을 피하기 위해
 * 명시적으로 .format()을 버린 것). 이 파일은 두 프롬프트 모두 `String.replaceAll('{slot}', () => value)`
 * 방식으로 통일한다 — 최종 텍스트는 두 원본 방식 모두 동일한 결과를 내므로 통일해도 무손실이다.
 * 원본이 `{{`/`}}`로 이스케이프한 JSON 예시 중괄호는 이 파일에서는 애초에 단일 중괄호로 저장한다
 * (템플릿 리터럴은 .format()과 달리 중괄호 충돌이 없다) — {slot} 토큰만 실제 치환 대상이다.
 *
 * 팔레트 플레이스홀더 계약(인벤토리 §0-6·§5): "{palette.primary}" 등 토큰은 이 파일의 치환
 * 표(replacements)에 키가 없으므로 손대지 않고 그대로 남는다 — images 단계
 * `_bind_palette_placeholders`가 copywriting 확정 팔레트로 늦게 치환한다.
 *
 * {PRODUCT_CONSISTENCY_RULES} 슬롯은 원문 상수를 여기서 재정의하지 않고 빌더 인자로 받는다
 * — 원문 소유자는 pdp-image-prompts.ts(§5, 순환 import 방지, 인벤토리 §3 지시).
 *
 * 제외(인벤토리 §3 D-1 보류): `_build_short_prompt_scope` — content_length='short' 축은
 * 이번 이식 범위 밖. 이 파일은 full 전용 빌더만 제공한다.
 */

import type { AnalysisResult, ResearchResult, StrategyContract } from '@/lib/registration/pdp-state'

// ─────────────────────────────────────────────────────────────────
// SECTION_PLANNING_PROMPT (1차 콜 — 섹션 구성·순서·레이아웃·폰트 설계)
// NEXFIT design_prompt_agent.py:538-706
// ─────────────────────────────────────────────────────────────────

export const SECTION_PLANNING_PROMPT = `
당신은 이커머스 상세페이지의 설득 구조를 설계하는 전략가입니다.
상품 데이터를 분석하여, 이 상품만의 최적 섹션 구성과 순서를 결정해야 합니다.

## 핵심 원칙: 초반 3초가 전부다

고객이 상세페이지를 열고 스크롤 1~2번 하는 동안(약 3초) 결정합니다:
"이거 더 볼 가치가 있나?"

당신의 가장 중요한 임무는 이 3초에 이 상품의 **가장 강한 설득 무기**를 배치하는 것입니다.

## Step 1: 가장 강한 무기 분석

아래 데이터를 보고, 4가지 무기 중 가장 강한 것을 판단하세요:

- 완판 횟수: {sold_out_count}
- 리뷰 존재: {has_reviews}
- 카테고리: {category}
- 본질 유형: {essence_type}
- Pain Points: {pain_points}
- USP 후보: {usp_candidates}

### 4가지 무기와 초반 배치 전략

**무기 1 — 실적 증거** (완판 3차+, 리뷰 평점 4.5+)
  완판 → 인증 → 후킹 문구 → Hero+아이콘USP → 평점·리뷰

**무기 2 — 시각적 충격** (패션, 뷰티, 인테리어, 식품)
  Hero(프레임 적용)+아이콘USP → 핵심 한 줄 → 포인트

**무기 3 — 문제 공감** (건강, 도구, 생활용품)
  후킹 이미지(문제 상황) → 문제 제기 → 공감 → Hero+아이콘USP

**무기 4 — 감성 연결** (선물, 반려동물, 아기용품)
  감성 키 메시지 → 사용 장면 이미지 → Hero+아이콘USP

## Step 1.5: 전략 계약 (사용자/AI 확정 — 섹션 구조에 반드시 반영)

- 관여도(involvement_level): {involvement_level}
  - high(고관여): 비교·증거·상세 설명 비중 확대 — compare_div, point_list_div, hidden_page,
    spec_table을 우선 활성화하고 USP 전달 계열(sub_div, sub2_div_page)을 충분히 배치하라.
  - low(저관여): 감각·공감 중심 속결 구성 — Hook/감성 계열을 앞세우고 증거 섹션은 압축하라.
- 설득 방향(persuasion_axis): {persuasion_axis}
  (emotion=감성 장면·스토리 중심 / function=기능·수치·증거 중심 / balanced=균형)
- 리뷰 배치(review_position_strategy): {review_position_strategy}
  - front: perf_rating·perf_reviews를 초반(Hook 영역)에 배치
  - middle: 본문 중반(Solution 이후)에 배치
  - back: CTA 직전에 배치
  - dynamic: Step 1 무기 분석 결과에 따라 최적 위치를 스스로 결정
- 후킹 모드(hook_mode): {hook_mode}

이 전략 계약은 Step 1 무기 분석과 함께 section_order 결정의 필수 입력이다.
관여도 high와 low는 활성 섹션 구성과 순서가 눈에 띄게 달라야 한다.

## Step 2: 섹션 선택 및 순서 결정

### 사용 가능한 섹션 (24종, Pro 기준)

초반 구성 (Hook):
  - perf_sales: 완판 실적 배너 (sold_out_count > 0일 때만)
  - certification: 정품 인증 라벨 (certification_info 데이터가 있을 때만 활성화)
  - hook_3step: 후킹 문구 (질문형 또는 이미지 후킹)
  - main_cut: Hero 제품 이미지(프레임 적용) + 아이콘 USP 3~4개
  - perf_rating: 평점 표시
  - perf_reviews: 리뷰 카드형 (캐릭터 썸네일 + 하이라이트 배지)
  - event_banner: 프로모션 배너 (event_banner_info 데이터가 있을 때만 활성화)
  - product_exposure: 제품 추가 앵글
  - event_bundle: 세트/묶음 구성

본문 (Problem → Solution):
  - problem_raise, problem_empathy, direction_suggest, solution_guide, key_message

USP 전달:
  - concept_desc, point_div, sub_div, sub2_div_page, hidden_page

마무리:
  - compare_div, point_list_div, petit_div, spec_table, cta

### 순서 결정 가이드
- **[필수] hook_3step → main_cut 순서로 시작**: 두 섹션이 활성화되면 hook_3step(후킹) 다음 main_cut(Hero)을 배치해 히어로로 페이지를 연다. 사이에 다른 섹션을 끼우지 마라.
- **[필수] 사회적 증거 블록 — perf_sales(완판)·perf_rating(평점)·perf_reviews(리뷰)는 반드시 서로 인접 배치**: "완판 실적 → 평점 → 실구매 후기"가 하나의 신뢰 블록으로 읽히게 나란히 둔다. 위치는 상단 훅이 아니라 **문제→해결 서사 뒤 중반**(solution_guide/product_exposure 이후)에 배치한다. perf_sales를 페이지 최상단(1~2번째)에 홀로 두지 마라.
  · 예외: 완판 실적이 Step1에서 '가장 강한 무기'로 선정될 만큼 압도적이면 perf_sales를 상단 훅으로 앞당길 수 있으나, 그때도 perf_reviews를 가급적 가까이 둔다.
- 첫 1~2개 섹션 = Step 1에서 분석한 가장 강한 무기
- 같은 유형 3개 이상 연속 금지 (리듬감)
- 감정 곡선: Hook → Problem → Solution → USP → CTA
- CTA는 마지막 권장
- 데이터 없는 섹션 제외
- 섹션 수 가이드: 최소 18개 ~ 최대 24개. 쿠팡 상세페이지는 세로 스크롤 길이가 신뢰감과 구매 전환에 직결된다. 섹션이 너무 적으면 "내용이 없다"는 인상을 줘서 이탈률이 올라간다. 18개 미만으로 줄이지 마라. 데이터가 부족한 섹션이라도 카피라이팅에서 AI가 생성할 수 있으므로, 가능하면 20~22개를 목표로 활성화하라.

### 프론트엔드 시각 장치 참고 (섹션 순서 결정 시 활용)
프론트엔드에서 다음 섹션에 시각 정지 포인트가 적용됩니다:
- problem_raise: 상단 3px accent line + 좌측 4px bar → 질문형 카피와 시너지 (강한 질문 배치 권장)
- key_message: 풀폭 브랜드 컬러 블록(60px) → 20자 이내 헤드라인 필수 (summary 필드가 이 섹션에 표시됨)
- cta: 유일한 풀 컬러 배경 → 행동 촉구 문구 필요 (마지막에 배치)
이 3개 섹션이 스크롤 중 시선 정지 역할을 하므로 배치 간격을 적절히 띄워라.
problem_raise와 key_message는 최소 3~5개 섹션 간격을 두고 배치하는 것을 권장한다.
key_message는 solution_guide 직후에 배치하지 않는다 — 사이에 증거 섹션(스펙/포인트/리뷰/비교) 1개 이상을 둔다.

## Step 3: Hero 프레임 선택

| ID | 프레임 | 적합 카테고리 |
|----|--------|-------------|
| wave_mirror | 물결거울 | 뷰티, 케어 |
| wave_wide | 물결거울 와이드 | 범용, 생활용품 |
| blob | 비정형 블롭 | 자연/유기농 |
| petal | 꽃잎 실루엣 | 뷰티, 선물 |
| cloud | 클라우드 | 아기, 반려동물 |
| scallop | 스캘럽 오벌 | 뷰티, 주얼리 |
| hexagon | 헥사곤 | 디지털, 가전 |
| oval | 오벌 민거울 | 뷰티, 스킨케어 |
| fan_arch | 팬 아치 | 인테리어, 가구 |
| keyhole | 키홀 | 선물, 특별한 제품 |
| squircle | 소프트 스퀘어클 | 디지털, 앱 |
| leaf | 리프 | 식품, 유기농 |
| studio | 프레임 없음 (스튜디오컷) | 패션, 식품, 비주얼 제품 |

studio 선택 시 프레임 없이 풀블리드 — 조명/배경 특수효과를 이미지 프롬프트에 반영.

## Step 4: 이미지 후킹 판단

이미지가 텍스트보다 강력한 후킹을 만들 수 있는 경우 image_hooking을 true로:
- 예: 정전기로 엉킨 머리카락 이미지 → "이런 경험 있으세요?"
- 예: 행복한 사용 장면 → "이 시원함, 직접 느껴보세요"

## 입력 데이터
- 스펙 요약: {spec_summary}
- 컬러/옵션: {has_color_options}

## 반드시 JSON으로 응답:
{
    "hook_strategy": {
        "strongest_weapon": "실적증거 | 시각적충격 | 문제공감 | 감성연결",
        "reasoning": "왜 이 무기가 가장 강한지",
        "first_3_seconds": "첫 화면에서 고객이 보게 되는 것",
        "hero_frame": "wave_mirror|wave_wide|blob|petal|cloud|scallop|hexagon|oval|fan_arch|keyhole|squircle|leaf|studio",
        "image_hooking": false
    },
    "activated_sections": ["섹션 ID 목록"],
    "section_order": ["배치 순서 = 상세페이지 위→아래"],
    "section_specs": {"섹션ID": {"headline_max_chars": 30, "body_max_chars": 60, "has_image": true, "image_role": "역할"}},
    "design_direction": "전체 디자인 방향",
    "reasoning": "구성 선택 이유",
    "layout_selections": {"섹션ID": "minimal|bold|image_first|split|overlay|gradient|card|full_bleed|stacked|dynamic"},
    "font_scheme": {
        "hook": {"heading": "폰트명", "body": "폰트명"},
        "problem": {"heading": "폰트명", "body": "폰트명"},
        "usp": {"heading": "폰트명", "body": "폰트명"},
        "modules": {"heading": "폰트명", "body": "폰트명"}
    }
}

font_scheme 규칙 (전부 무료 상업용 라이선스 확인 폰트 — 이 목록 밖 폰트명 금지):
- heading 허용: GmarketSansBold | Cafe24 Ssurround | Black Han Sans | Do Hyeon | Jua | Gothic A1 | Hahmlet | Song Myung | Noto Serif KR
- body 허용: Pretendard | Noto Sans KR | IBM Plex Sans KR | Gowun Dodum | SUIT Variable | Wanted Sans Variable
- **제품 페르소나에 맞춰 heading 선택 (매우 중요 — 톤이 상품과 맞아야 함)**:
  · 파스텔·문구·아동·팬시·귀여운·감성 라운드 톤 → **Cafe24 Ssurround** (둥글고 친근·부드러움)
  · 프리미엄·기능·신뢰·전자/공구/생활 → GmarketSansBold (기본)
  · 강한 임팩트·세일·저가 대량 → Black Han Sans
  · 캐주얼·발랄 → Jua · Do Hyeon
  · 뷰티·식품·스토리텔링 감성 → Noto Serif KR · Hahmlet · Song Myung (명조)
- body는 가독성 우선 Pretendard 기본 (heading이 감성 라운드여도 body는 Pretendard 권장)
- 확신 없으면 GmarketSansBold + Pretendard 유지. 그룹 간 최대 2개 헤딩 폰트까지만 혼용

중요:
- hook_strategy를 먼저 분석 → section_order 결정
- 데이터 없는 섹션 제외
- CTA 1개만
- layout_selections: 연속 섹션 같은 카테고리 반복 금지
`

/** SECTION_PLANNING_PROMPT 슬롯 12종 입력 (agent.py:930-943 호출부 대응) */
export interface SectionPlanningPromptInput {
  soldOutCount: number
  hasReviews: boolean
  category: string
  essenceType: string
  painPoints: NonNullable<ResearchResult['pain_points']>
  uspCandidates: NonNullable<AnalysisResult['usp_candidates']>
  involvementLevel: string
  persuasionAxis: string
  reviewPositionStrategy: string
  hookMode: string
  specSummary: string
  hasColorOptions: boolean
}

/**
 * SECTION_PLANNING_PROMPT 슬롯 치환 — 원본은 `.format()`(agent.py:930)을 쓰지만 이 파일은
 * replace 기반으로 통일한다(파일 상단 원칙 참고). has_reviews/has_color_options는 Python
 * str(bool) 표기("True"/"False")와 바이트 동일하도록 대문자로 렌더한다 — 원본이 LLM에게
 * 보여주는 실제 문구를 그대로 재현하기 위함이다.
 */
export function buildSectionPlanningPrompt(input: SectionPlanningPromptInput): string {
  const replacements: Record<string, string> = {
    sold_out_count: String(input.soldOutCount),
    has_reviews: input.hasReviews ? 'True' : 'False',
    category: input.category,
    essence_type: input.essenceType,
    pain_points: JSON.stringify(input.painPoints),
    usp_candidates: JSON.stringify(input.uspCandidates),
    involvement_level: input.involvementLevel,
    persuasion_axis: input.persuasionAxis,
    review_position_strategy: input.reviewPositionStrategy,
    hook_mode: input.hookMode,
    spec_summary: input.specSummary,
    has_color_options: input.hasColorOptions ? 'True' : 'False',
  }
  let prompt = SECTION_PLANNING_PROMPT
  for (const [slot, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(`{${slot}}`, () => value)
  }
  return prompt
}

// ─────────────────────────────────────────────────────────────────
// DESIGN_PROMPT_ENGINEERING_PROMPT (2차 콜 — 섹션별 이미지 프롬프트 엔지니어링)
// NEXFIT design_prompt_agent.py:387-532
// ─────────────────────────────────────────────────────────────────

export const DESIGN_PROMPT_ENGINEERING_PROMPT = `
당신은 이커머스 상품 이미지 프롬프트 엔지니어링 전문가입니다.
Gemini/Imagen API에 주입할 정밀한 이미지 생성 프롬프트를 작성해야 합니다.

## 핵심 원칙
1. **제품 일관성 100% 유지** — 형태, 색상, 로고, 재질, 비율 완벽 보존
2. **디자인 팔레트 연동** — 배경/소품에 브랜드 컬러 자연스럽게 융화
3. **광원 방향 동기화** — 원본 이미지와 그림자 각도 일치
4. **텍스트 절대 금지** — 모든 이미지에 문자, 워터마크, 로고 텍스트 없음.
   \`negative\` 필드만으로는 부족합니다 — **모든 섹션의 \`positive\` 프롬프트 본문에도**
   "No text, letters, or typography anywhere in the image." 같은 문장을 명시적으로
   포함하세요(size_comparison의 측정 라벨처럼 예외가 명시된 경우 제외).
5. **한국인 모델 사용** — 인물 포함 시 한국인 성인 모델만
6. **캐릭터 IP 금지** — 포켓몬·디즈니·산리오 등 제3자 저작권/트레이드마크 캐릭터나
   애니메이션 마스코트를 소품·배경·장식·패턴으로 제안하지 마세요. 모든 소품은
   무상표(generic/unbranded)여야 합니다. 참조 제품 자체에 라이선스 캐릭터가 있다면
   그 제품만 충실히 재현하고, 그 외의 추가 캐릭터 요소는 그리지 마세요.

## 컷 다양성 규칙 (매우 중요 — 반복 방지)
- 각 컷은 **서로 다른 시각적 앵글**을 담당해야 합니다. 같은 연출(구도·행동·소품)을
  여러 컷에 반복하지 마세요.
- 특히 상품의 대표 기능을 보여주는 **단일 극적 연출(예: 물이 쏟아지는/흐르는 장면,
  제품을 들어올리는 장면 등)은 전체에서 최대 2컷까지만** 사용하세요.
- 나머지 컷은 다음처럼 역할을 분산하세요: ①구조·디테일 클로즈업 ②실사용 장면
  ③정리·수납 상태 ④휴대·이동 ⑤재질 텍스처 ⑥라이프스타일 무드. 각 컷이 전달하는
  메시지가 겹치지 않도록 배분합니다.
- feature 컷들은 detailPoints의 **서로 다른 항목**을 1:1로 담당하게 하고, 같은
  기능을 두 컷이 중복 소구하지 않도록 하세요.

## 문제(problem) 장면 프레이밍 규칙 (매우 중요 — 엉뚱한 컷 방지)
- problem 컷의 \`Scenario:\`는 **제품이 아니라 고객의 상황·감정**을 그리는 장면입니다.
  "고객이 어떤 순간에 무엇 때문에 답답한가"를 **사람 중심**으로 서술하세요.
- **구형·경쟁·일반 버전의 제품(예: "기존 공업용 줄자", 낡은 대체품, 투박한 도구)을
  장면 속 오브젝트로 묘사하지 마세요.** 이미지 모델이 그것을 프레임의 주인공으로 그려
  판매 제품과 혼동을 일으킵니다("이게 파는 물건?"). 손에 든 특정 도구가 주제가 되면 안 됩니다.
- 배송·포장·물류 같은 곁가지 문제 대신, 사용자가 이 상품으로 직접 해소하는 **경험상의
  불편**을 고르세요. 감정이 표정·행동으로 읽히게 하고, 카피의 문제의식과 결이 맞아야 합니다.

## 사용 장면(usage/solution/howto) 환경 추론 규칙 (매우 중요 — 엉뚱한 장소 방지)
- 상품명과 카테고리에서 **이 제품이 실제로 쓰이는 환경**(실내/야외, 계절, 구체적 장소)을
  판단하고, \`usage\`·\`solution\`·\`howto\` 프롬프트에 그 환경을 명시하세요.
- 야외·계절 상품(물놀이·수영장·해변·캠핑·등산·스포츠·정원·낚시 등)을 **주방·거실 같은
  실내 장면으로 그리지 마세요.** 반대로 실내 전용 상품을 야외로 옮기지도 마세요.
- "at home or office", "cozy modern setting" 같은 **범용 실내 문구를 그대로 쓰지 마세요.**
  제품에 맞는 구체적 장소를 직접 서술해야 합니다(예: 여름 물놀이 상품 → 야외 수영장·물놀이터,
  햇빛과 젖은 바닥이 보이는 장면).

## 입력 데이터
- 상품명: {product_name}
- 카테고리: {category}
- 타겟 페르소나: {target_persona}
- 디자인 팔레트:
  - Primary: {primary_color}
  - Secondary: {secondary_color}
  - Background: {bg_color}

※ 팔레트 플레이스홀더 규칙 (매우 중요):
위 Primary/Secondary/Background 값이 "{palette.primary}" 같은 플레이스홀더 토큰이면,
생성하는 모든 이미지 프롬프트 안에 그 토큰 문자열을 **문자 그대로** 유지하세요.
임의의 실제 HEX 색상으로 치환하거나 색상을 창작하지 마세요.
확정된 디자인 팔레트가 이후 이미지 생성 단계에서 이 토큰 자리에 주입됩니다.
예: "Clean {palette.bgMain} background with accents harmonized to {palette.primary}."

- 문제 상황: {problem_question}
- 해결 선언: {solution_declaration}
- 상세 포인트: {detail_points}
- 사용법: {how_to}

## 반드시 JSON 형식으로 응답:

{
    "section_image_prompts": {
        "hero": {
            "positive": "Premium studio product photography of {product_name}. Center-placed product occupying 60-70% frame. 30-degree elevated angle. Soft diffused lighting from top-left. Clean {bg_color} background. Subtle shadow for dimension. Sharp product edges. Aspirational, magazine-quality style. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, logo, blurry edges, harsh shadows, cluttered background, distorted proportions",
            "style": "premium_studio"
        },
        "problem": {
            "positive": "Empathetic lifestyle scene centered on the CUSTOMER's facial expression and situation, showing mild everyday frustration WITHOUT any product visible. Scenario: {problem_question}. Frame the person and their emotion — do NOT depict any product, tool, device, or any old / alternative version of the product as a focal object. The scene must feel WARM and INVITING despite depicting a problem — soft warm natural lighting (golden hour or warm indoor light), warm color temperature, natural saturated colors. Mild frustration or thoughtful expression. Clean commercial product-page quality composition — this image must harmonize with the other bright, premium images on the same page. Korean adult model if person shown.",
            "negative": "any product, any tool, any device, any instrument as a focal object, old or industrial equipment, products displayed on shelves, the product itself, text, letters, watermark, cool blue tones, gray desaturated mood, gloomy, dark, documentary gritty style, exaggerated expressions, children",
            "style": "empathy"
        },
        "solution": {
            "positive": "Bright positive lifestyle photo featuring {product_name} being actively used. Scenario: {solution_declaration}. Warm tones, high saturation, enhanced brightness. Satisfied expression if person included. Clean organized background. Korean adult model if person shown. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, dark tones, cluttered background, distorted product, children",
            "style": "solution_hero"
        },
        "options": {
            "positive": "Clean grid arrangement showing product color/size variations. Same lighting and angle for all items. {bg_color} to subtle gray background. Professional catalog style. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, inconsistent lighting, different angles, cluttered arrangement",
            "style": "catalog"
        },
        "usage": {
            "positive": "Natural lifestyle photo of a Korean adult using {product_name} in the environment where this product is ACTUALLY used — infer that environment from the product name and category (indoor vs outdoor, season, specific place) and describe it concretely. Natural interaction moment. Real usage demonstration. Relatable, authentic mood. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, public transportation, subway, bus, posed unnatural expression, children",
            "style": "lifestyle"
        },
        "detail": {
            "positive": "Extreme macro close-up of {product_name}. Focus on texture and material quality. 80% frame fill. Shallow depth of field. Side lighting emphasizing texture depth. Studio white background. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, blurry texture, flat lighting, complex background",
            "style": "macro"
        },
        "cta": {
            "positive": "Premium aspirational product display of {product_name}. Golden hour warm soft lighting. {primary_color} accent elements. Centerpiece composition. Evokes trust, satisfaction, desire to own. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, cold tones, cluttered, low quality",
            "style": "emotional"
        },
        "size_comparison": {
            "positive": "Clean comparison photo: {product_name} placed side-by-side with {comparison_object}. White studio background. Same eye-level angle. Both items at REAL proportional scale. Subtle dimension arrow lines next to product. Sharp focus. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, distorted proportions, unrealistic scale, cluttered background",
            "style": "technical_comparison"
        }
    },
    "feature_prompts": [
        {
            "title": "기능 제목",
            "positive": "Feature-specific close-up showing the mentioned feature in action or detail. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, irrelevant elements",
            "style": "feature_highlight"
        }
    ],
    "howto_prompts": [
        {
            "step": "사용법 단계",
            "positive": "Usage scenario showing hands/person interacting with product. Focus on action moment. Environmental context clues. Korean adult model if person shown. {PRODUCT_CONSISTENCY_RULES}",
            "negative": "text, letters, watermark, public transportation, children",
            "style": "tutorial"
        }
    ],
    "lighting_params": {
        "direction": "top-left",
        "intensity": 0.85,
        "shadow_angle": 45,
        "ambient_level": 0.35,
        "color_temperature": "warm"
    },
    "color_params": {
        "primary_hex": "{primary_color}",
        "secondary_hex": "{secondary_color}",
        "background_hex": "{bg_color}",
        "tone_mapping": "warm",
        "saturation_level": 0.75
    },
    "composition_notes": "Product should always be the visual hero. Maintain consistent lighting direction across all images. Background colors should complement but not overpower the product. All images should feel cohesive as a set."
}
`

/**
 * A-3(2026-07-29): 텍스트 보유 상품(스티커·엽서·라벨류) 전용 스코프 — NO_TEXT 원칙 4번을 대체.
 * NEXFIT design_prompt_agent.py:210-222. 슬롯 없음 — DESIGN_PROMPT_ENGINEERING_PROMPT 뒤에
 * append만 한다(agent.py:1246, 치환 이전에 붙여도 결과는 동일 — 이 스코프에 슬롯 토큰이 없음).
 */
export const TEXT_BEARING_PROMPT_SCOPE = `

## 텍스트 보유 상품 예외 (이 상품에 한해 위 핵심 원칙 4번을 대체)
이 상품은 **제품에 인쇄된 문구·아트워크가 상품 자체**입니다(스티커·엽서·라벨류).
- 모든 \`positive\`에 "제품에 인쇄된 문구·로고·아트워크는 참조 이미지와 동일하게 보존"하라는
  지시를 영어로 넣으세요. 문구를 지우거나 번역하거나 새로 쓰지 마세요.
- "No text, letters, or typography anywhere in the image." 문장은 **넣지 마세요.**
  대신 "Preserve the printed lettering and artwork on the product exactly as in the reference;
  do not add any text anywhere else in the frame."를 넣으세요.
- \`negative\`에서 "text, letters"를 빼고, 제품 밖 텍스트만 금지하세요
  (예: "text on background, watermark, caption, added lettering").
- 이 제품은 **평면 인쇄물**입니다 — 접시·도자기·머그·상자 같은 입체 물체로 렌더하지 마세요.
`

/**
 * R1 빛·색온도 정본(잡 스위치 light, PDP-DR-PLAN §3) — 위 JSON 예시의 빛 문구 → 대비·밝기만 남긴 문구.
 * 이미지 단계(pdp-image-light)도 LLM이 예시에서 그대로 옮긴 문구를 같은 표로 바꾼다
 */
export const CHARTER_LIGHT_EXAMPLE_SWAPS: ReadonlyArray<readonly [string, string]> = [
  [
    'soft warm natural lighting (golden hour or warm indoor light), warm color temperature, natural saturated colors',
    'soft inviting light, natural saturated colors',
  ],
  ['Soft diffused lighting from top-left.', 'Soft diffused light.'],
  ['Warm tones, high saturation, enhanced brightness.', 'High saturation, enhanced brightness.'],
  ['Side lighting emphasizing texture depth.', 'Texture-revealing contrast.'],
  ['Golden hour warm soft lighting.', 'Soft inviting light.'],
]

/** R1 — 빛 방향·색온도는 이미지 단계의 스타일 헌장 한 곳만 정한다. light 기록 잡의 설계 콜에만 덧붙인다(슬롯 없음) */
export const LIGHT_FROM_CHARTER_SCOPE = `

## 빛·색온도(스타일 헌장이 정한다)
- \`positive\`에 광원 종류(소프트박스·창가·골든아워·텅스텐 등)·빛 방향·색온도(K 값, 따뜻한/차가운 색온도)를 쓰지 마세요.
  이미지 단계가 모든 컷에 같은 스타일 헌장(빛 방향·색온도 하나)을 붙입니다.
- 컷마다 다르게 쓸 수 있는 빛은 대비(부드럽게·강하게)와 밝기(밝게·하이키)뿐입니다.
`

/** DESIGN_PROMPT_ENGINEERING_PROMPT 슬롯 11종 입력 (PRODUCT_CONSISTENCY_RULES 제외 — 별도 인자) */
export interface DesignPromptEngineeringInput {
  productName: string
  category: string
  targetPersona: string
  primaryColor: string
  secondaryColor: string
  bgColor: string
  problemQuestion: string
  solutionDeclaration: string
  detailPoints: string
  howTo: string
  comparisonObject: string
}

/**
 * DESIGN_PROMPT_ENGINEERING_PROMPT 슬롯 12종 치환 — 원본과 동일하게 replace 기반(파일 상단
 * 원칙 참고). `productConsistencyRules`는 pdp-image-prompts.ts(§5) 소유 원문 상수를 호출부가
 * 문자열로 전달한다(순환 import 방지, 인벤토리 §3). "{palette.primary}" 등 팔레트 토큰은
 * replacements 표에 없으므로 그대로 남는다 — images 단계에서 늦게 치환된다.
 */
export function buildDesignPromptEngineeringPrompt(
  input: DesignPromptEngineeringInput,
  productConsistencyRules: string,
  options?: { textBearing?: boolean; lightFromCharter?: boolean }
): string {
  let prompt = DESIGN_PROMPT_ENGINEERING_PROMPT
  if (options?.textBearing) {
    prompt += TEXT_BEARING_PROMPT_SCOPE
  }
  // R1 — 예시의 빛 문구를 대비·밝기만 남긴 문구로 바꾸고 헌장 우선 블록을 붙인다(light 기록 잡만, 그 밖은 원문 그대로)
  if (options?.lightFromCharter) {
    for (const [from, to] of CHARTER_LIGHT_EXAMPLE_SWAPS) prompt = prompt.replaceAll(from, () => to)
    prompt += LIGHT_FROM_CHARTER_SCOPE
  }
  const replacements: Record<string, string> = {
    product_name: input.productName,
    category: input.category,
    target_persona: input.targetPersona,
    primary_color: input.primaryColor,
    secondary_color: input.secondaryColor,
    bg_color: input.bgColor,
    problem_question: input.problemQuestion,
    solution_declaration: input.solutionDeclaration,
    detail_points: input.detailPoints,
    how_to: input.howTo,
    comparison_object: input.comparisonObject,
    PRODUCT_CONSISTENCY_RULES: productConsistencyRules,
  }
  for (const [slot, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(`{${slot}}`, () => value)
  }
  return prompt
}

// ─────────────────────────────────────────────────────────────────
// 프레임 시스템 참조 테이블 — LLM 프롬프트는 아니지만 디자인 단계가 소비하는 규칙 데이터.
// NEXFIT design_prompt_agent.py:286-382. 작업 지시(인벤토리 §3)에 따라 이 파일에 동반 이식한다
// — SSOT 인벤토리는 원래 pdp-design-agent.ts 귀속으로 분류했으나(§3 "동반 이식 규칙 로직"),
// 별도 파일이 아직 없어 여기 둔다. pdp-design-agent.ts가 생기면 그쪽으로 이동을 검토할 것.
// hero_frame(Step 3, wave_mirror 등 13종)과는 별개 어휘 — frame_system은 primary/secondary
// 2종 프레임 스타일 팩 선택이며 section_plan.frame_system 필드로 소비된다.
// ─────────────────────────────────────────────────────────────────

export interface FrameCategoryInfo {
  impression: string
  categories: string[]
  sections: string[]
}

// NEXFIT design_prompt_agent.py:286-327
export const FRAME_CATEGORY_MAP: Record<string, FrameCategoryInfo> = {
  square_clean: {
    impression: '정리감, 정보성',
    categories: ['digital', 'kitchen', 'health'],
    sections: ['proof', 'compare', 'spec'],
  },
  rounded_rect: {
    impression: '범용적, 현대적',
    categories: ['all'],
    sections: ['hero', 'usage', 'review'],
  },
  circle_focus: {
    impression: '포인트 집중',
    categories: ['beauty', 'pet'],
    sections: ['point_highlight'],
  },
  droplet_fresh: {
    impression: '촉촉함, 청결감',
    categories: ['beauty', 'cleaning'],
    sections: ['sensory'],
  },
  pebble_soft: {
    impression: '안전, 따뜻함',
    categories: ['pet', 'baby', 'wellness'],
    sections: ['empathy', 'gentle_proof'],
  },
  petal_soft: {
    impression: '감성, 섬세함',
    categories: ['beauty', 'gift'],
    sections: ['hero', 'cta'],
  },
  editorial_mix: {
    impression: '프리미엄, 편집감',
    categories: ['premium'],
    sections: ['hero', 'concept_desc'],
  },
  notch_split: {
    impression: '기술감, 기능 분해',
    categories: ['digital', 'tech'],
    sections: ['proof', 'hidden_detail'],
  },
}

export interface VisualStyleReferenceInfo {
  bg: string
  lighting: string
  lens: string
  composition: string
}

// NEXFIT design_prompt_agent.py:329-354
export const VISUAL_STYLE_REFERENCE: Record<string, VisualStyleReferenceInfo> = {
  clean_proof: { bg: '화이트/쿨그레이', lighting: '균일 확산광', lens: '50mm/85mm', composition: '정면/45도' },
  warm_story: {
    bg: '웜아이보리/크림',
    lighting: '소프트 톱/사이드',
    lens: '50mm soft',
    composition: '오프센터/인물 맥락',
  },
  premium_editorial: {
    bg: '저채도 베이지/딥그레이',
    lighting: '드라마틱 소프트',
    lens: '35mm+85mm 혼합',
    composition: '여백 비대칭',
  },
  cute_soft: { bg: '파스텔/연핑크', lighting: '소프트 플랫', lens: '50mm', composition: '센터/귀여움 강조' },
}

export interface FrameSystem {
  primary: string
  secondary: string
}

/**
 * strategy_contract와 카테고리 기반 frame_system 선택 — NEXFIT design_prompt_agent.py:357-381
 * 1:1. Object.entries는 삽입 순서를 보존하므로 Python dict 순회 순서(선언 순)와 동일하게
 * 첫 매치에서 break한다.
 */
export function selectFrameSystem(strategyContract: StrategyContract, category: string): FrameSystem {
  const visualStylePack = strategyContract.visual_style_pack ?? 'clean_proof'
  const frameStylePack = strategyContract.frame_style_pack ?? 'rounded_rect'

  let primary: string = frameStylePack
  for (const [frameKey, frameInfo] of Object.entries(FRAME_CATEGORY_MAP)) {
    const cats = frameInfo.categories
    if (cats.includes(category) || cats.includes('all')) {
      if (visualStylePack === 'premium_editorial' && frameKey === 'editorial_mix') {
        primary = frameKey
        break
      } else if (visualStylePack === 'cute_soft' && (frameKey === 'petal_soft' || frameKey === 'pebble_soft')) {
        primary = frameKey
        break
      } else if (visualStylePack === 'clean_proof' && (frameKey === 'square_clean' || frameKey === 'rounded_rect')) {
        primary = frameKey
        break
      }
    }
  }

  const secondary = primary !== 'rounded_rect' ? 'rounded_rect' : 'square_clean'

  return { primary, secondary }
}
