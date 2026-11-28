/**
 * 새 단계 입력의 근거 글(하네스 R10a) — 기획·사실 감사가 함께 쓴다. C 시제품 실측과 같은 조립:
 * 판매자 입력 = specSheetPromptJson, 분석 = analysisForPrompt(기록 칸을 뺀 것), 리서치 = research_result JSON.
 * 리서치에서는 새 단계가 쓴 기획(page_plan)을 뺀다 — 모델이 쓴 글이 다시 근거가 되지 않게.
 */

import { analysisForPrompt } from '../enrichment-switch'
import { specSheetPromptJson, type AnalysisResult, type PdpSpecSheet, type ResearchResult } from '../pdp-state'

export interface PromptSources {
  spec: string
  analysis: string
  research: string
}

export interface SourceJob {
  spec_sheet: PdpSpecSheet
  analysis: AnalysisResult
  research_result: ResearchResult
}

export function promptSourcesOf(job: SourceJob): PromptSources {
  const research: Record<string, unknown> = { ...(job.research_result ?? {}) }
  delete research.page_plan
  return {
    spec: specSheetPromptJson(job.spec_sheet),
    analysis: JSON.stringify(analysisForPrompt(job.analysis ?? {})),
    research: JSON.stringify(research),
  }
}

/** 모델이 근거로 옮겨 적은 글이 입력 원문에 있는가 — 공백 차이만 무시한다(JSON 글 안의 따옴표 이스케이프는 원문 그대로 비교) */
export function quotedIn(sourceText: string, quote: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
  const q = squash(quote)
  return q.length > 0 && squash(sourceText).includes(q)
}
