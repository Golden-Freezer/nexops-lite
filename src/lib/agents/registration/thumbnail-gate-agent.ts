/**
 * 동일성 게이트 Judge — NEXFIT gate.py 판정 로직 + Sonnet 5 vision 호출.
 * 게이트는 차단이 아니라 신호다: 미달 컷 재시도 트리거를 주고, 재판정 실패여도 잡은 성공한다(원본 방침).
 * Pillow 점유율 실측은 이식하지 않는다 — VLM의 tight_bbox_occupancy 추정을 그대로 쓴다(설계문서 결정 A).
 */

import type { AgentConfig, RunContext } from '../types'
import { callAgent, type ImageBlockParam } from '../_base'
import { parseLlmJson } from '../json-parser'
import {
  GATE_PROMPT,
  CUT_OCCUPANCY_TARGET,
  CUTOUT_OCCUPANCY_HARD_FLOOR,
  DEFAULT_OCCUPANCY_TARGET,
  CONSISTENCY_SCORE_MIN,
} from './prompts/thumbnail-gate-prompts'
import type { VisionImage } from './thumbnail-vision-agent'
import type { CutGateDetail, GateResult } from '@/lib/registration/thumbnail-types'

// 판정 정확도가 게이트의 존재 이유이므로 상위 모델(설계문서 결정 C). Sonnet 5는 temperature 거부 — 미설정.
const GATE_CONFIG: AgentConfig = {
  model: 'claude-sonnet-5',
  maxTokens: 2000,
  disableThinking: true,
}

// NEXFIT gate.py:98-119
export function failedDetail(message: string): CutGateDetail {
  return {
    passed: false,
    message,
    identity: {
      passed: false,
      same_product: false,
      consistency: 0,
      has_artifact: false,
      message,
    },
    presentation: {
      passed: false,
      not_continuous_single_photo: true,
      rectangular_boundary: false,
      planar_source_remnant: false,
      flat_margin_band: false,
      tight_bbox_occupancy: null,
      warning: null,
      message,
    },
  }
}

/**
 * 컷 1개 판정 — NEXFIT gate.py:122-230 _evaluate_cut 1:1.
 * 위반 boolean은 `!== false`로 읽는다(누락/None=위반, 보수적).
 * flat_margin_band는 cutout에 적용하지 않는다 — 순백 배경이 규격컷 스펙 자체(원본 상시 재시도 원인 교훈).
 */
export function evaluateCut(raw: unknown, cut: 'cutout' | 'studio'): CutGateDetail {
  if (!raw || typeof raw !== 'object') return failedDetail(`${cut} 게이트 응답이 없습니다.`)
  const { identity: identityRaw, presentation: presentationRaw } = raw as Record<string, unknown>
  if (
    !identityRaw ||
    typeof identityRaw !== 'object' ||
    !presentationRaw ||
    typeof presentationRaw !== 'object'
  ) {
    return failedDetail(`${cut} 게이트 축 응답이 올바르지 않습니다.`)
  }
  const identity = identityRaw as Record<string, unknown>
  const presentation = presentationRaw as Record<string, unknown>

  let consistency = Number(identity.consistency)
  if (!Number.isFinite(consistency)) consistency = 0
  consistency = Math.min(Math.max(consistency, 0), 1)
  const sameProduct = identity.same_product === true
  const hasArtifact = identity.has_artifact === true
  const identityPassed = sameProduct && !hasArtifact && consistency >= CONSISTENCY_SCORE_MIN
  const identityMessage = identityPassed
    ? null
    : `identity 미통과 (consistency=${consistency.toFixed(2)}, ` +
      `same_product=${sameProduct}, artifact=${hasArtifact}): ` +
      `${String(identity.artifact_reason || '') || '참조 상품과의 일치도를 확인해 주세요.'}`

  const notContinuous = presentation.not_continuous_single_photo !== false
  const rectangularBoundary = presentation.rectangular_boundary !== false
  const planarSourceRemnant = presentation.planar_source_remnant !== false
  const flatMarginBand = cut !== 'cutout' && presentation.flat_margin_band !== false
  let presentationPassed = !(notContinuous || rectangularBoundary || planarSourceRemnant || flatMarginBand)

  // 원본(gate.py:167-171)은 float(None)이 TypeError → None. Number(null)===0 이라 그대로 옮기면
  // null이 점유율 0으로 강제변환돼 하드 플로어 오탐(가짜 미달 실패 + 재생성 예산 낭비)이 난다.
  const rawOccupancy = presentation.tight_bbox_occupancy
  let occupancy: number | null = null
  if (typeof rawOccupancy === 'number' && Number.isFinite(rawOccupancy)) {
    occupancy = rawOccupancy
  } else if (typeof rawOccupancy === 'string' && rawOccupancy.trim() !== '') {
    const parsed = Number(rawOccupancy)
    occupancy = Number.isFinite(parsed) ? parsed : null
  }

  const expected = CUT_OCCUPANCY_TARGET[cut] ?? DEFAULT_OCCUPANCY_TARGET
  // 규격컷은 "축소돼 보임"이 실제 불만 — 명백한 점유율 미달을 하드 실패로 승격(임계 0.30, 실측 분포 기반)
  const lowOccupancyFail = cut === 'cutout' && occupancy !== null && occupancy < CUTOUT_OCCUPANCY_HARD_FLOOR
  presentationPassed = presentationPassed && !lowOccupancyFail

  let warning: string | null = null
  if (occupancy === null) {
    warning = 'tight bounding-box 점유율을 판정하지 못했습니다.'
  } else if (!(expected[0] <= occupancy && occupancy <= expected[1])) {
    warning = `점유율 추정치 ${occupancy.toFixed(2)}가 권장 범위 ${expected[0].toFixed(2)}-${expected[1].toFixed(2)} 밖입니다.`
  }

  const violations: string[] = []
  if (notContinuous) violations.push('연속된 한 장의 사진이 아님')
  if (rectangularBoundary) violations.push('상품과 원본 배경을 감싸는 사각 경계')
  if (planarSourceRemnant) violations.push('원본 장면의 평면 변환 잔존')
  if (flatMarginBand) violations.push('장면을 둘러싼 평평한 단색 여백 띠')
  if (lowOccupancyFail && occupancy !== null) {
    violations.push(`규격컷 상품 점유율 미달(${occupancy.toFixed(2)} < ${CUTOUT_OCCUPANCY_HARD_FLOOR.toFixed(2)})`)
  }
  const presentationMessage = presentationPassed
    ? null
    : `presentation 미통과: ${violations.join(', ')}. ${String(presentation.presentation_reason || '')}`.trim()

  const messages = [identityMessage, presentationMessage].filter((m): m is string => !!m)
  return {
    passed: identityPassed && presentationPassed,
    message: messages.length > 0 ? messages.join(' ') : null,
    identity: {
      passed: identityPassed,
      same_product: sameProduct,
      consistency,
      has_artifact: hasArtifact,
      message: identityMessage,
    },
    presentation: {
      passed: presentationPassed,
      not_continuous_single_photo: notContinuous,
      rectangular_boundary: rectangularBoundary,
      planar_source_remnant: planarSourceRemnant,
      flat_margin_band: flatMarginBand,
      tight_bbox_occupancy: occupancy,
      warning,
      message: presentationMessage,
    },
  }
}

// NEXFIT gate.py:233-249
export function composeGate(rawScores: unknown): GateResult {
  const scores = (rawScores && typeof rawScores === 'object' ? rawScores : {}) as Record<string, unknown>
  const cuts = {
    cutout: evaluateCut(scores.cutout, 'cutout'),
    studio: evaluateCut(scores.studio, 'studio'),
  }
  const passed = cuts.cutout.passed && cuts.studio.passed
  const messages = (['cutout', 'studio'] as const)
    .filter((cut) => !cuts[cut].passed)
    .map((cut) => `${cut}: ${cuts[cut].message}`)
  return { passed, message: passed ? null : messages.join(' | '), cuts }
}

// NEXFIT gate.py:252-254
export function failedGate(message: string): GateResult {
  return {
    passed: false,
    message,
    cuts: { cutout: failedDetail(message), studio: failedDetail(message) },
  }
}

function imageBlock(image: VisionImage): ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }
}

/**
 * 게이트 판정 실행 — NEXFIT service.py:322-349 _score_gate.
 * 입력 순서 계약: 참조 전량(원본 소스만 — 체이닝된 cutout 제외) → 생성 cutout → 생성 studio.
 * 참조는 반드시 배열로(단일 전달로 게이트가 항상 "판정 실패"였던 원본 버그 이력).
 * 판정 자체가 실패하면 failedGate — 잡은 실패시키지 않는다(게이트는 신호).
 */
export async function scoreGate(
  references: VisionImage[],
  cutout: VisionImage,
  studio: VisionImage,
  runContext?: RunContext,
): Promise<{ gate: GateResult; costUsd: number }> {
  const result = await callAgent<GateResult>(
    {
      config: GATE_CONFIG,
      system: 'You are a meticulous product-photo QA judge. Respond only with the requested JSON.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: GATE_PROMPT },
            ...references.map(imageBlock),
            imageBlock(cutout),
            imageBlock(studio),
          ],
        },
      ],
      timeoutMs: 120_000,
      agentName: 'registration/thumbnail-gate',
      runContext,
    },
    (text) => {
      const parsed = parseLlmJson(text)
      if (!parsed) throw new Error('게이트 응답 JSON 파싱 실패')
      return composeGate(parsed)
    }
  )
  if (result.success) return { gate: result.data, costUsd: result.usage.cost }
  return { gate: failedGate(`제품 게이트 판정 실패: ${result.error.message}`), costUsd: result.usage.cost }
}
