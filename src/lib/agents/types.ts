// AI 에이전트 공통 타입 정의

/** 에이전트 모델 설정 */
export interface AgentConfig {
  model: 'claude-sonnet-5' | 'claude-haiku-4-5-20251001'
  maxTokens: number
  /**
   * Claude 5 계열(claude-sonnet-5)은 sampling 파라미터를 400으로 거부하므로
   * (temperature is deprecated) Haiku 등 지원 모델에서만 설정한다. 미설정 시 전송 생략.
   */
  temperature?: number
  /**
   * Sonnet 5는 adaptive thinking이 기본 켜짐 — thinking 토큰이 maxTokens를 잠식해
   * 결정적 추출/생성(JSON) 에이전트의 출력이 잘릴 수 있다. true면 thinking을 명시적으로 끈다.
   * (Haiku 4.5 등 구세대 모델은 thinking 파라미터 미전송이 곧 비활성이므로 설정 불필요.)
   */
  disableThinking?: boolean
}

/** 업무 실행 원장과 개별 AI 호출을 연결하는 선택 컨텍스트 */
export interface RunContext {
  runId?: string
  userId?: string
  businessId?: string
  stage?: string
}

/** 에이전트 입력 */
export interface AgentInput {
  type: string
  data: unknown
}

/** 에이전트 호출 실패 사유 */
export interface AgentError {
  message: string
  /** budget = 월 AI 예산 소진으로 호출 자체가 차단됨 (budget.ts) */
  stage: 'api' | 'timeout' | 'parse' | 'budget'
  attempts: number
}

/** 에이전트 호출 사용량 */
export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  cost: number
}

/** 에이전트 출력 — 판별 유니언(success로 분기, 실패 사유는 error로 전파) */
export type AgentOutput<T = unknown> =
  | { success: true; data: T; usage: AgentUsage; duration: number }
  | { success: false; error: AgentError; usage: AgentUsage; duration: number }

/** OCR 에이전트 입력 */
export interface OcrAgentInput extends AgentInput {
  type: 'ocr'
  data: {
    image: string       // base64 이미지 데이터
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
    slot: 'A' | 'B' | 'C' | 'D'  // A/B: 자동완성, C/D: 연관검색어
  }
}

/** OCR 에이전트 출력 */
export interface OcrAgentOutput {
  keywords: string[]
  slot: 'A' | 'B' | 'C' | 'D'
}

/** 상품명 생성 에이전트 입력 */
export interface GeneratorAgentInput extends AgentInput {
  type: 'generate'
  data: {
    brandName: string
    coreKeyword: string
    marketSize: 'large' | 'small'
    targetKeyword: string
    subKeywords: string[]
    excludedKeywords: string[]
    productAttributes: Record<string, string[]>
    keywordAnalysis: Record<string, string[]>
  }
}

/** 상품명 생성 에이전트 출력 */
export interface GeneratorAgentOutput {
  names: Array<{
    name: string
    words: Array<{ word: string; role: string }>
    score: number
    reason: string
  }>
  tags: string[]
}

/** 카테고리 매칭 에이전트 입력 */
export interface CategoryMatcherInput extends AgentInput {
  type: 'category-match'
  data: {
    keyword: string
    categories: Array<{
      major: string
      mid: string | null
      sub: string | null
      rate: number
    }>
  }
}

/** 카테고리 매칭 에이전트 출력 */
export interface CategoryMatcherOutput {
  major: string
  mid: string | null
  sub: string | null
  confidence: number
  reason: string
}

// ── 광고 코칭 에이전트 (ads/coach-agent) ──
// 규칙분석(analyzer) 리포트를 절대 진실로 받아, 셀러 친화 자연어 코칭으로 표현만 보강한다.
// LLM은 수치·권고를 새로 만들지 않는다(입력 리포트의 표현 재구성만).

/** 코칭 에이전트가 소비하는 압축 입력 — analyzer 리포트의 사람 대면 부분만 추린 것. */
export interface CampaignCoachInput {
  campaign_name: string
  week_label: string
  week_grade: string
  executive_summary: string
  wow_summary: string
  search_nonsearch_story: string
  trend_narrative: string
  cost_efficiency_narrative: string
  insights: Array<{ type: string; title: string; text: string }>
  decision_matrix: Array<{ q: string; a: string }>
  action_items: Array<{ priority: string; text: string; tag: string }>
  keyword_narrative: string
  top_waste: string[]
  top_gems: string[]
  inventory: { risk_count: number; cross_insights: string[] } | null
}

/** 코칭 에이전트 출력 — 캠페인별 자연어 코칭. */
export interface CampaignCoachingOutput {
  headline: string
  summary: string
  good_points: string[]
  watch_outs: string[]
  action_plan: Array<{ priority: string; text: string }>
  encouragement: string
}
