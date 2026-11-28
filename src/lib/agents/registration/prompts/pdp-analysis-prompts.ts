/**
 * PDP 파이프라인 1단계(데이터분석) 프롬프트 — NEXFIT agents/data_analysis_agent.py 번역.
 *
 * 원칙(원본 보존 — 설계문서 §7): 프롬프트 본문은 의미·문구 변경 없이 그대로 옮기고,
 * f-string 슬롯만 TS 함수 인자로 변환한다. JSON 예시 블록의 이중 중괄호(`{{...}}`)는
 * f-string 이스케이프이므로 여기서는 단일 중괄호로 복원했다 — 원문과 바이트 동일한 JSON 형태.
 * 도메인 치환(쿠팡 문맥 주입)은 이 번역 단계의 범위 밖이다(PROMPT-INVENTORY.md §7.0).
 */

// NEXFIT data_analysis_agent.py:32-46 — 슬롯 없음, 스펙 JSON은 문자열 뒤에 단순 append(:265)
export const CATEGORY_DETECTION_PROMPT = `
당신은 이커머스 상품 카테고리 분류 전문가입니다.
주어진 스펙표와 이미지 정보를 분석하여 다음 카테고리 중 가장 적합한 것을 선택하세요:
- 패션 (fashion)
- 식품 (food)
- 디지털/가전 (digital)
- 뷰티 (beauty)
- 문구류 (stationery)
- 포장재 (packaging)
- 생활용품 (household)
- 반려동물용품 (pet)

반드시 JSON 형식으로 응답해주세요:
{"category": "카테고리_id", "confidence": 0.95, "reasoning": "분류 근거"}
`

/**
 * CATEGORY_DETECTION_PROMPT 뒤에 스펙 JSON을 단순 append — 원본 join과 동일
 * (data_analysis_agent.py:265: `CATEGORY_DETECTION_PROMPT + f"\n\n스펙표: {json.dumps(spec_sheet, ...)}"`).
 * 사용자가 이미 카테고리를 지정한 경우 이 콜 자체를 생략하는 것은 호출부(에이전트) 책임.
 */
export function buildCategoryDetectionPrompt(specSheetJson: string): string {
  return `${CATEGORY_DETECTION_PROMPT}\n\n스펙표: ${specSheetJson}`
}

// NEXFIT data_analysis_agent.py:48-89
export const DATA_ANALYSIS_PROMPT = `
당신은 이커머스 상품 데이터 분석 전문가입니다.
주어진 상품 스펙표와 리뷰 데이터를 분석하여 상세페이지 제작에 필요한 정보를 추출하세요.

## 분석할 데이터:
- 스펙표: {spec_sheet}
- 리뷰 요약: {reviews_summary}
- 감지된 카테고리: {category}

## 반드시 JSON 형식으로 응답:
{
    "keywords": ["핵심 키워드 10~15개"],
    "pros": ["장점 3~5개 (리뷰 기반)"],
    "cons": ["단점 2~3개 (리뷰 기반, 카피라이팅 시 반전 활용)"],
    "usp_candidates": ["USP 후보 3~5개"],
    "raw_summary": "전체 분석 요약 텍스트 (200자 이내)",
    "benefit_clusters": [
        {"name": "효익명", "weight": 0.4},
        {"name": "효익명2", "weight": 0.3}
    ],
    "pain_clusters": [
        {"pain": "고객 불편 설명", "urgency": "medium"}
    ],
    "objection_priority": ["가장 큰 반론1", "반론2"],
    "decision_profile": {
        "involvement_level": "high 또는 low (고관여: 가전/IT/건강기능식품/고가패션, 저관여: 생활용품/식품/뷰티소모품)",
        "comparison_intensity": "low 또는 medium 또는 high",
        "proof_sensitivity": "low 또는 medium 또는 high",
        "visual_hook_need": "low 또는 medium 또는 high",
        "explanation_depth": "quick 또는 standard 또는 deep",
        "price_resistance": "low 또는 medium 또는 high",
        "repeatability": "one_off 또는 repeat",
        "giftability": "low 또는 medium 또는 high",
        "urgency_level": "low 또는 medium 또는 high"
    }
}

중요:
- benefit_clusters의 weight 합계는 1.0, 최대 5개
- decision_profile의 9개 축 모두 반드시 포함
- 스펙표에 없는 정보를 창조하지 마세요 (환각 방지)
`

export interface DataAnalysisPromptArgs {
  specSheet: string
  reviewsSummary: string
  category: string
}

/** DATA_ANALYSIS_PROMPT의 {spec_sheet} {reviews_summary} {category} 슬롯 치환 */
export function buildDataAnalysisPrompt(args: DataAnalysisPromptArgs): string {
  return DATA_ANALYSIS_PROMPT.replace('{spec_sheet}', () => args.specSheet)
    .replace('{reviews_summary}', () => args.reviewsSummary)
    .replace('{category}', () => args.category)
}
