/**
 * WING 상품등록 폼 매핑 에이전트 (WS-C) — 화면에서 긁은 등록 폼 필드 + 오너가 준비한 상품 정보를
 * 받아, 각 필드에 채울 값을 매핑한다. 카테고리마다 폼이 달라져도 실제 필드에 맞춰 채운다.
 *
 * lib/agents/_base.ts callAgent 공통 래퍼 사용(CLAUDE.md AI Agent Architecture). 이 에이전트는
 * "어떤 값을 어디에 넣을지"만 판단하고, 실제 폼 채우기는 확장 content script가 한다.
 */

import type { AgentConfig, AgentOutput } from '@/lib/agents/types'
import { callAgent } from '@/lib/agents/_base'
import { parseLlmJson } from '@/lib/agents/json-parser'
import { getWingMapperPrompt } from './prompts'

// temperature는 두지 않는다 — claude-sonnet-5는 temperature 파라미터를 거부(400). callAgent는
// temperature가 undefined면 요청에서 생략한다(_base.ts).
const CONFIG: AgentConfig = {
  model: 'claude-sonnet-5',
  maxTokens: 4096,
}

export type WingFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'notice'

export interface WingField {
  /** content script가 부여한 필드 핸들(data-nexops-ref). 매핑 결과를 이 ref로 되돌린다. */
  ref: string
  kind: WingFieldKind
  label: string
  placeholder?: string
  section?: string
  /** select/radio 선택지 */
  options?: string[]
  required?: boolean
}

export interface WingMapProduct {
  productName?: string | null
  brand?: string | null
  salePrice?: number | null
  originalPrice?: number | null
  stock?: number | null
  categoryPath?: string | null
  displayCategoryCode?: number | null
  searchTags?: string[]
  barcode?: string | null
  heroImageUrl?: string | null
  detailHtml?: string | null
  notice?: Record<string, string>
  options?: unknown
  memo?: string | null
}

export interface WingMapInput {
  fields: WingField[]
  product: WingMapProduct
}

export interface WingFill {
  ref: string
  value: string
}
export interface WingMapResult {
  fills: WingFill[]
}

export async function mapWingForm(input: WingMapInput): Promise<AgentOutput<WingMapResult>> {
  const { system, user } = getWingMapperPrompt(input)
  return callAgent<WingMapResult>(
    {
      config: CONFIG,
      system,
      messages: [{ role: 'user', content: user }],
      agentName: 'registration/wing-mapper',
    },
    (text) => {
      const json = parseLlmJson(text) as { fills?: unknown }
      const raw = Array.isArray(json.fills) ? json.fills : []
      const fills: WingFill[] = []
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        if (typeof o.ref !== 'string' || o.value == null) continue
        fills.push({ ref: o.ref, value: String(o.value) })
      }
      return { fills }
    }
  )
}
