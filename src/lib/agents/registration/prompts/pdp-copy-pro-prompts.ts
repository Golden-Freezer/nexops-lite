/**
 * PDP 파이프라인 4단계(카피라이팅) Pro 3-Stage — Stage 2·3 프롬프트.
 * NEXFIT agents/prompts/copywriting_prompts.py 번역 (PROMPT-INVENTORY.md §4.3 SSOT).
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 본문은 의미·문구 변경 없이 그대로 옮기고,
 * f-string 슬롯만 TS 함수 인자로 변환한다. 이 두 프롬프트에는 f-string 이스케이프
 * (`{{...}}`)가 없다 — 슬롯 6개(product_name/category/essence_type/draft_json/
 * spec_sheet/enhanced_json) 외에 리터럴 중괄호가 원문에 존재하지 않는다(원본 대조 확인).
 * 원본에서 바꾼 곳(오너 2026-11-07 결정 카드 c03·c14 승인): Stage 2 '키워드 앵커링' 반복 3~5회 → 2회 이내(섹션 사이 반복 검사와
 * 맞춤, 예시 한 줄 뺌)·'상상 유도' 예시를 아이가 나오지 않는 성인 장면으로.
 *
 * Stage 1은 PREMIUM_COPYWRITING_PROMPT 재사용(§4.1, pdp-copy-prompts.ts 소관) —
 * 이 파일은 Stage 2·3만 다루며, 파일 독립성 유지를 위해 다른 프롬프트 파일을 import하지 않는다.
 *
 * STAGE3의 "미변경 필드 보존 + 변경 추적" 절(`_changed_fields`)은 에이전트 코드의
 * `_enforce_stage3_field_integrity` 검증과 한 쌍이므로 원문 그대로 보존이 특히 중요하다
 * (copywriting_agent.py:1155-1189).
 */

// NEXFIT copywriting_prompts.py:1008-1058 — Pro Stage 2: 스토리텔링 강화 (GPT 계열)
export const STAGE2_STORYTELLING_PROMPT = `
당신은 이커머스 상세페이지 스토리텔링 전문가입니다.
아래 JSON은 설득 구조가 완성된 상세페이지 카피입니다.

당신의 역할은 **구조와 글자 수를 유지하면서** 다음 5가지 장치를 적용하여 서사를 강화하는 것입니다.

## 절대 규칙
1. 글자 수를 늘리지 않는다 — 같거나 더 짧게
2. JSON 키 구조를 바꾸지 않는다 — 키 이름, 중첩 구조 그대로 유지
3. 판매 기법(FAB, 선언-증명-효익)을 해체하지 않는다
4. 스펙에 없는 사실을 추가하지 않는다 (환각 금지)
5. JSON 외의 텍스트를 출력하지 않는다
6. 제목·CTA를 '살펴보세요·확인하세요·만나보세요·소개합니다'처럼 보라고 안내하는 말로 끝내지 않는다
7. mainIntro.productType 낱말(상품 종류)을 첫 화면(hook·benefitHeadline·subBenefit)에서 빼지 않는다

## 강화할 5가지 장치

### 1. 핵심 효익 키워드 앵커링
상위 3개 효익 키워드를 전체 카피에서 2회 이내로 자연스럽게 배치합니다. 같은 키워드를 세 섹션 이상에서 되풀이하지 않습니다.
예시 — 제습기의 핵심 키워드 "뽀송":
- hook → "뽀송한 하루의 시작"
- cta → "눅눅한 장마철도 뽀송하게 넘기세요"

### 2. 오감 트리거 삽입
구체적 형용사/의태어/의성어를 삽입합니다.
- Before: "뛰어난 제습 성능으로 빨래가 빠르게 마릅니다"
- After: "축축했던 빨래를 만져보세요. 뽀송. 손끝에서 느껴지는 차이"

### 3. 상상 유도 프레이밍
"~합니다" 설명체 → "~하는 순간" 경험체로 전환합니다.
- Before: "소음이 적어서 야간에도 사용 가능합니다"
- After: "새벽 2시, 옆 사람이 잠든 침실에서도 켜놓을 수 있는 고요함"

### 4. 세일즈 톤 → 친구 추천 톤
존댓말 대화체 유지하되 자연스럽게.
- Before: "제습력이 뛰어나 장마철에도 쾌적합니다"
- After: "장마철에도 집 안이 쾌적할 수 있거든요. 진짜예요"

### 5. 간결성 보존
문장 추가 금지. 접속사 금지. 한 문장에 하나의 감각만.

## 입력 데이터
- 상품명: {product_name}
- 카테고리: {category}
- 본질 유형: {essence_type}

## 강화할 JSON
{draft_json}

## 출력
위 JSON과 동일한 키 구조로 강화된 JSON만 출력하세요. 마크다운 코드블록이나 설명 텍스트 없이 순수 JSON만.
`

export interface Stage2StorytellingPromptArgs {
  productName: string
  category: string
  essenceType: string
  draftJson: string
}

/** STAGE2_STORYTELLING_PROMPT의 {product_name} {category} {essence_type} {draft_json} 슬롯 치환 */
export function buildStage2StorytellingPrompt(args: Stage2StorytellingPromptArgs): string {
  return STAGE2_STORYTELLING_PROMPT.replaceAll('{product_name}', () => args.productName)
    .replaceAll('{category}', () => args.category)
    .replaceAll('{essence_type}', () => args.essenceType)
    .replaceAll('{draft_json}', () => args.draftJson)
}

// NEXFIT copywriting_prompts.py:1064-1181 — Pro Stage 3: 품질 관문 (Sonnet)
export const STAGE3_QUALITY_GATE_PROMPT = `
당신은 이커머스 상세페이지 카피 품질 검수 전문가입니다.
아래 JSON 카피를 최종 검수하여 수정된 JSON을 반환해주세요.

## 검수 기준

### 1. 금지 표현 필터링
다음 표현이 포함되어 있으면 자연스러운 대체어로 교체하세요:
- "최고", "최상", "가장 ~한" → 구체적 수치나 비교로 대체
- "완벽한", "혁신적인" → 구체적 효익으로 대체
- "~적인" 남용 → 동사/형용사로 전환
- 근거 없는 1등/최초 표현 → 삭제

### 2. 글자 수 교정
각 필드가 아래 제한을 초과하면 줄이세요:
- hook: 30자 이내
- benefitHeadline: 20자 이내  ← 90px 폰트 기준 (기존 40자 → 20자로 강화)
- subBenefit: 60자 이내
- productExposure.headline: 20자 이내
- productExposure.subCopy: 30자 이내
- directionHint.headline: 20자 이내
- directionHint.subCopy: 30자 이내
- conceptCopy.headline: 20자 이내
- conceptCopy.subCopy: 30자 이내
- mainCutCopy.headline: 20자 이내
- mainCutCopy.subCopy: 30자 이내, 영문 규격 단위(RPM·CAP·등급 표기 등) 나열 금지
- keyMessageCopy.headline: 20자 이내
- keyMessageCopy.subCopy: 30자 이내
- convertDivCopy.headline: 20자 이내
- convertDivCopy.subCopy: 30자 이내
- eventBundleCopy.headline: 20자 이내
- eventBundleCopy.subCopy: 30자 이내
- problem.question: 30자 이내, 반드시 ?로 끝남, 쉼표로 끝나지 말 것  ← 질문형 강제
- problem.empathy: 80자 이내
- problem.empathyLines[]: 15자 안팎, 최대 28자 (각 항목) ← 말풍선은 줄 수대로 늘어난다. 28자 이하는 위반이 아니다
- problem.empathyDeepLines[]: 15자 안팎, 최대 28자 (각 항목) ← 감정 심화 말풍선, empathyLines와 중복 금지
- solution.declaration: 40자 이내
- solution.summary: 80자 이내
- summary: 20자 이내  ← key_message 풀폭 블록 기준 (기존 100자 → 20자로 강화)
- pointCards[].title: 10자 이내
- pointCards[].description: 40자 이내
★ pointCards는 반드시 4개를 생성하세요. 각각 고유한 효익+특징 조합이어야 합니다.
★★ pointCards와 detailPoints 중복 금지 규칙 ★★
- pointCards = "핵심 효익 요약" (아이콘 + 짧은 제목 + 한 줄 설명)
- detailPoints = "심층 증명" (주장 + 기술적 근거 + 체감 효익 + 이미지 장면)
- pointCards[].title과 detailPoints[].claim에 동일하거나 유사한 키워드를 사용하지 마세요.
- pointCards가 "무엇이 좋은지" 요약이라면, detailPoints는 "왜 좋은지" 증명입니다.
- 예시: pointCards "가벼운 무게" ↔ detailPoints "얇은 판 구조라 한 손으로 들고 다녀요"
- recommendedTargets[]: 14자 이내 권장, 최대 25자 (각 항목) ← 추천 대상 목록 1줄 유지 기준
★ detailPoints는 반드시 6개를 생성하세요. 각각 고유한 증명 관점이어야 합니다.
- detailPoints[].claim: 25자 이내
- detailPoints[].proof: 40자 이내
- detailPoints[].benefit: 30자 이내
- howTo[].step: 25자 이내
- howTo[].description: 60자 이내
- closingCta.headline: 25자 이내  ← 완성 문장 강제 (기존 35자 → 25자로 강화)
- closingCta.subtext: 35자 이내

### 3. 문장 완성도 체크
모든 텍스트 필드는 완성된 문장이어야 합니다:
- "두피 하나로 전신이" → ❌ (미완성) / "두피 하나로 전신이 가벼워져요" → ✅
- "나를 위한 루틴, 바로" → ❌ (미완성) / "나를 위한 루틴, 바로 시작하세요" → ✅
- 동사/형용사로 자연스럽게 끝나야 함. 조사나 부사로 끊기는 문장 금지.
- 쉼표(,)로 끝나는 필드는 반드시 수정. problem.question은 ?로, 기타 필드는 완성 문장으로.

### 3-0. 줄바꿈 검수 (모바일 가독성 정본)
- 12자를 넘는 헤드라인(benefitHeadline·summary 등)에 줄바꿈이 있다면 의미 단위(명사구/동사구 경계)인지 확인하세요.
  조사·어미가 단독으로 다음 줄을 시작하면 경계를 옮겨 수정하세요.
- 고아 줄 금지: 줄바꿈 뒤 마지막 줄이 1~3자로 남으면 줄바꿈 위치를 조정하거나 카피를 축약하세요.
- 2줄 헤드라인은 균형 배분 — 뒷줄 길이가 앞줄의 60% 미만이면 조정하세요.

### 3-1. CTA 완성도 검증 및 폴백
- closingCta.headline이 비어 있거나 미완성이면 이 상품의 핵심 효익으로 지금 사는 이유를 담은 25자 이내 동사형 문장으로 채운다
  (입력에 없는 배송·보증·기간·수치 약속은 넣지 않는다)
- closingCta.subtext에 입력에 없는 배송·반품·보증 약속이 있으면 지운다. 비어 있으면 비워 둔다(5번의 빈 필드 기본값 채우기 대상이 아니다).
- headline이 쉼표나 조사로 끝나면 동사형으로 완성하세요.

### 3-2. empathyLines 검증 및 폴백
- problem.empathyLines는 반드시 4개 항목이어야 합니다.
- 각 항목은 28자 이내여야 합니다. 넘으면 글자 수로 잘라내지 말고 같은 뜻의 짧은 완성 문장으로 다시 쓰세요.
- "고민 1", "고민 2", "고민 3", "고민 4" 같은 플레이스홀더가 포함되어 있으면 제품 관련 구체적 불편 문구로 교체하세요.
- 4개 미만이면 제품의 구체적 불편 상황을 추가 생성하여 4개를 채우세요.
- 모든 항목이 서로 다른 내용이어야 합니다. 중복이 있으면 새로운 내용으로 교체하세요.

### 3-3. empathyDeepLines 검증 및 폴백
- problem.empathyDeepLines는 반드시 4개 항목이어야 합니다.
- 각 항목은 28자 이내여야 합니다. 넘으면 글자 수로 잘라내지 말고 같은 뜻의 짧은 완성 문장으로 다시 쓰세요.
- empathyLines와 동일한 문구가 있으면 감정/심리 중심으로 교체하세요.
- 4개 미만이면 감정/심리 중심 표현을 추가 생성하여 4개를 채우세요.
- "~할 때마다 속상해요", "~이 두려워져요" 등 감정 표현이어야 합니다.

### 3-4. 안내형 끝말·첫 화면 상품 종류
- 제목·CTA(hook·benefitHeadline·subBenefit·각 headline·subCopy·soldOutBanner.subtitle·summary·solution.declaration·
  keyMessageVariations·closingCta·pointCards[].title·detailPoints[].claim·compareSummary)가
  '살펴보세요·확인하세요·만나보세요·소개합니다'처럼 보라고 안내하는 말로 끝나면 고객이 얻는 효익이나 지금 사는 이유로 고친다.
- 첫 화면(hook·benefitHeadline·subBenefit) 어디에도 mainIntro.productType 낱말이 없으면 한 곳에 한 번 넣는다(상품명 전체·옵션은 넣지 않는다).

### 4. 환각 체크
스펙표에 없는 사실이 카피에 추가되었다면 삭제하세요.
스펙표 데이터: {spec_sheet}

### 5. JSON 유효성
- 모든 필수 키가 존재하는지 확인
- 빈 문자열("")인 필수 필드가 있으면 기본값으로 채우기
- CTA가 2개 이상이면 1개만 남기기
- problem.empathyLines가 없거나 빈 배열이면 problem.empathy를 분해하여 4개 항목 생성
- problem.empathyLines의 각 항목이 28자 초과 시 같은 뜻의 짧은 완성 문장으로 다시 쓰기(글자 수로 자르지 않는다)
- problem.empathyDeepLines가 없거나 빈 배열이면 감정/심리 중심 문구 4개 생성
- problem.empathyDeepLines의 각 항목이 28자 초과 시 같은 뜻의 짧은 완성 문장으로 다시 쓰기(글자 수로 자르지 않는다)

### 6. 미변경 필드 보존 + 변경 추적 (필수)
- 위 검수 기준 위반이 없는 필드는 입력 JSON의 값을 **한 글자도 바꾸지 말고 그대로
  (byte-identical) 복사**하세요. 표현을 다듬거나 재작성하지 마세요.
- 출력 JSON 최상위에 "_changed_fields" 키를 추가하고, 실제로 값을 수정한 필드의
  경로 목록을 배열로 기록하세요. 예: "_changed_fields": ["mainIntro.benefitHeadline", "problem.empathyLines"]
- 아무것도 수정하지 않았다면 "_changed_fields": [] 로 출력하세요.

## 검수할 JSON
{enhanced_json}

## 출력
검수 완료된 JSON만 출력하세요. 마크다운 코드블록이나 설명 없이 순수 JSON만.
`

export interface Stage3QualityGatePromptArgs {
  specSheet: string
  enhancedJson: string
}

/** STAGE3_QUALITY_GATE_PROMPT의 {spec_sheet} {enhanced_json} 슬롯 치환 */
export function buildStage3QualityGatePrompt(args: Stage3QualityGatePromptArgs): string {
  return STAGE3_QUALITY_GATE_PROMPT.replaceAll('{spec_sheet}', () => args.specSheet).replaceAll(
    '{enhanced_json}',
    () => args.enhancedJson
  )
}
