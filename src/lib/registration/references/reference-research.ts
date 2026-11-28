/**
 * 리서치 덧붙임 블록 연결(13_REFERENCE_INPUT PR②) — 잡 기록에 기능 스위치 references가 켜져 있고(analysis.enrichment)
 * spec_sheet.referenceInputs가 있을 때만 블록을 만든다. 스위치가 꺼진 잡·레퍼런스 없는 잡은 undefined(리서치 프롬프트 그대로).
 * 원문 가드(재현·유사도)는 이 스위치와 상관없이 레퍼런스가 있으면 걸린다(reference-inputs).
 */

import { buildReferenceResearchBlock } from '@/lib/agents/registration/prompts/pdp-reference-prompts'
import { readJobEnrichment } from '../enrichment-switch'
import type { PdpJobRow } from '../pdp-state'
import { readReferenceInputs } from './reference-inputs'

export function referenceResearchBlock(job: Pick<PdpJobRow, 'analysis' | 'spec_sheet'>): string | undefined {
  if (!readJobEnrichment(job.analysis)?.features.includes('references')) return undefined
  return buildReferenceResearchBlock(readReferenceInputs(job.spec_sheet))
}
