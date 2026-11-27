/**
 * 정산 대조 분석 에이전트 — 규칙 대조표(ReconciliationRow)를 입력으로 차액 귀속 해설 생성.
 * 대조 수치(reconcile)가 절대 진실이며, LLM은 해설만 보강한다(수치 신규 생성 금지).
 * Claude Haiku 4.5 기준(해설=대조표 표현 보강이라 경량 모델로 충분), _base.ts callAgent 규약 준수.
 */

import type { AgentConfig, AgentOutput } from '../types'
import type { SettlementAnalyzeInput, SettlementAnalysisOutput } from '@/types/settlement-recon'
import { callAgent } from '../_base'
import { parseLlmJson } from '../json-parser'
import { getAnalyzerSystemPrompt, getAnalyzerUserPrompt } from './prompts'
import { normalizeAnalysis } from './shape'

const ANALYZER_CONFIG: AgentConfig = {
  model: 'claude-haiku-4-5-20251001', // 해설은 표현 보강이라 Haiku 4.5로 충분(coach-agent와 동일 근거)
  maxTokens: 1500, // 짧은 해설 출력 — 잘림 여유 확보
  temperature: 0.4, // 표현에 약간의 온기, 그러나 수치 창작을 억제하는 낮은 값 유지
}

/**
 * 정산 대조 결과(ReconciliationRow에서 파생된 SettlementAnalyzeInput)를 받아 차액 귀속
 * 해설을 생성한다. 실패 시(파싱 실패 포함) success:false를 반환하며, 이때 호출측은 규칙
 * 대조표만으로 폴백하면 된다(해설은 표현 보강일 뿐이므로). 1회 시도·18초 타임아웃으로 짧게
 * 잡아 Vercel 함수 한도 안에 여유 있게 들어오게 한다(coaching 라우트와 동일 근거, audit §3-3).
 */
export async function analyzeSettlement(
  input: SettlementAnalyzeInput,
): Promise<AgentOutput<SettlementAnalysisOutput>> {
  return callAgent<SettlementAnalysisOutput>(
    {
      config: ANALYZER_CONFIG,
      system: getAnalyzerSystemPrompt(),
      messages: [{ role: 'user', content: getAnalyzerUserPrompt(input) }],
      maxRetries: 0,
      timeoutMs: 18_000,
      agentName: 'settlement/analyzer',
    },
    (text) => {
      const parsed = parseLlmJson(text)
      if (parsed === null) {
        // 침묵 실패 금지 — 재시도를 트리거하도록 명시적으로 던진다(원문 앞부분 로그 동봉).
        throw new Error(`settlement-analyzer: JSON 파싱 실패 — ${text.slice(0, 200)}`)
      }
      return normalizeAnalysis(parsed)
    },
  )
}
