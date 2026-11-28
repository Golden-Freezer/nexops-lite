/**
 * PDP 이미지 단계 전용 LLM 호출 2종 — 식별카드 판독 + Vision 게이트 채점.
 * NEXFIT agents/image_identity.py(build_identity_card) + agents/image_generation_agent.py
 * (`_vision_score_consistency`) 이식. 프롬프트 본문은 pdp-image-gate-prompts.ts 소유 — 여기는
 * 모델 계층(callLlm, 단계 images/identity·images/gate) 배선만(CLAUDE.md AI 호출/순수 로직 분리 원칙 — 오케스트레이션은
 * lib/registration/pdp-image-stage.ts 소관).
 */

import { billedCostOf } from '../billed-usage'
import type { ImageBlockParam } from '@/lib/agents/llm/message-types'
import type { RunContext } from '../types'
import { callLlm } from '../llm'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { parseLlmJson } from '../json-parser'
import {
  buildIdentityCardAllPhotosPrompt,
  buildIdentityCardMultiPrompt,
  buildVisionGatePrompt,
  IDENTITY_CARD_PROMPT,
  IDENTITY_CARD_MAX_CHARS,
  IDENTITY_CARD_MULTI_MAX_CHARS,
  type VisionGateCutScore,
  withIdentityRoles,
  withIdentityStates,
  withIdentityUse,
} from './prompts/pdp-image-gate-prompts'
import type { VisionImage } from './thumbnail-vision-agent'

function imageBlock(image: VisionImage): ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
}

// NEXFIT image_identity.py:_clean_identity_text — 길이 상한만 강제(형식은 프롬프트가 규정). 여러 줄 응답은 한 줄로 모은다
// (카드는 한 줄 블록 — brief 정리의 identity 단계가 첫 줄 끝에 문장을 붙인다)
function cleanIdentityText(raw: string, maxChars: number): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}

// NEXFIT image_identity.py:format_identity_card. 여러 장 카드는 사진 수와 '도안은 목록 중 하나'를 머리에 적는다
/** 전 사진 응답 나누기 — UNCERTAIN 앞은 확정(카드), 뒤는 기록만. 'none'은 없음 */
function splitUncertain(text: string): { description: string; uncertain: string } {
  const [description, ...rest] = text.split(/\bUNCERTAIN\s*:/i)
  const tail = rest.join(' ').replace(/\s+/g, ' ').trim()
  return { description: description.trim().replace(/[,;.\s]+$/, ''), uncertain: /^(none|n\/a)\.?$/i.test(tail) ? '' : tail.slice(0, IDENTITY_CARD_MAX_CHARS) }
}

/** USE 줄 길이 상한 — 프롬프트는 25단어를 묻는다 */
export const IDENTITY_USE_MAX_CHARS = 200

// USE 줄 머리 — 줄 맨 앞(대소문자 무시), 또는 한 줄로 붙여 쓴 경우 문장 부호 뒤의 'USE:'
const USE_HEAD = /(?:^|\n)[ \t]*use[ \t]*:|(?<=[.;,][ \t]*)USE[ \t]*:/i

/**
 * USE 줄 꺼내기(usefacts 잡, 결정 카드 c02) — 응답 어디에 있든 'USE:'부터 그 줄 끝(같은 줄의 UNCERTAIN 앞)까지가 USE 줄이고, 나머지는
 * 지금 길(UNCERTAIN 나누기·카드 정리)로 간다. 'none'·빈 줄은 없음. 머리가 없으면 응답 그대로·USE 없음
 */
export function splitUseLine(text: string): { rest: string; use: string } {
  const head = USE_HEAD.exec(text)
  if (!head) return { rest: text, use: '' }
  const tail = text.slice(head.index + head[0].length)
  const end = tail.search(/\n|\bUNCERTAIN\s*:/i)
  const body = (end < 0 ? tail : tail.slice(0, end)).replace(/\s+/g, ' ').trim()
  const after = end < 0 ? '' : tail[end] === '\n' ? tail.slice(end) : `\n${tail.slice(end)}`
  const rest = `${text.slice(0, head.index).replace(/[ \t]+$/, '')}${after}`
  if (!body || /^(none|n\/a)\.?$/i.test(body)) return { rest, use: '' }
  return { rest, use: body.length > IDENTITY_USE_MAX_CHARS ? `${body.slice(0, IDENTITY_USE_MAX_CHARS - 1)}…` : body }
}

function formatIdentityCard(description: string, photoCount: number, allPhotos: boolean): string {
  const cleaned = cleanIdentityText(description, photoCount > 1 ? IDENTITY_CARD_MULTI_MAX_CHARS : IDENTITY_CARD_MAX_CHARS)
  if (!cleaned) return ''
  if (allPhotos) {
    return `PRODUCT IDENTITY (read from the user's ${photoCount} reference photos — the generated product must match every detail below): ${cleaned}`
  }
  if (photoCount > 1) {
    return `PRODUCT IDENTITY (read from the user's ${photoCount} reference photos — the generated product must match every detail below; printed designs come only from the reference photos, as listed below): ${cleaned}`
  }
  return `PRODUCT IDENTITY (read from the user's reference photo — the generated product must match every detail below): ${cleaned}`
}

/**
 * 참조 이미지 판독 → 식별카드 블록. 실패해도 잡을 실패시키지 않는다 — 빈 문자열 반환,
 * 호출부는 카드 없이 진행(원본 graceful degradation, image_identity.py:134-140).
 * others: 인쇄물의 나머지 원천 사진(호출부가 최대 3장으로 자른다) — 있으면 사진 전부를 한 번에 보고 도안을 사진 순서대로 적는다
 */
export async function readIdentityCard(
  reference: VisionImage,
  runContext?: RunContext,
  others: VisionImage[] = [],
  /**
   * allPhotos: 인쇄물이 아닌 상품의 전 사진 판독(idcardall). 없으면 others는 인쇄물 도안 판독이다.
   * states: 상태 구분 문장(idcardall 잡, 오너 메모 11-06 P05) — 한 장·전 사진 프롬프트에만 끼우고 인쇄물 도안 프롬프트에는 넣지 않는다
   * use: 쓰는 법 USE 줄(usefacts 잡, 결정 카드 c02) — 세 프롬프트 모두에 끼우고 응답에서 꺼내 use로 따로 돌려준다(카드에 넣지 않는다)
   * roleLine: 사진 역할 한 줄(photoroles 잡, 결정 카드 c12) — 보내는 사진 가운데 옵션 사진을 알린다. 세 프롬프트 모두 Rules 줄 앞에
   */
  options: { allPhotos?: boolean; states?: boolean; use?: boolean; roleLine?: string } = {},
): Promise<{ card: string; costUsd: number; uncertain?: string; use?: string }> {
  const photos = [reference, ...others]
  const allPhotos = Boolean(options.allPhotos) && photos.length > 1
  const printedMulti = !allPhotos && photos.length > 1
  const basePrompt = allPhotos
    ? buildIdentityCardAllPhotosPrompt(photos.length)
    : printedMulti
      ? buildIdentityCardMultiPrompt(photos.length)
      : IDENTITY_CARD_PROMPT
  const statePrompt = options.states && !printedMulti ? withIdentityStates(basePrompt) : basePrompt
  // 역할 줄은 Rules 줄 앞, USE 줄은 끝맺음 줄 자리 — 서로 다른 자리라 둘 다 켠 잡도 겹치지 않는다. 둘 다 꺼지면 지금 프롬프트 그대로
  const rolePrompt = options.roleLine ? withIdentityRoles(statePrompt, options.roleLine) : statePrompt
  const prompt = options.use ? withIdentityUse(rolePrompt) : rolePrompt
  const route = pdpRoute('images/identity')
  const result = await callLlm<string>(
    route,
    {
      system: options.use
        ? 'You catalogue product photos for another image model. Answer with the description and the USE line only.'
        : 'You catalogue product photos for another image model. Answer with the description only.',
      messages: [{ role: 'user', content: [...photos.map(imageBlock), { type: 'text', text: prompt }] }],
      // 전 사진은 최대 8장이라 더 기다린다 — 실패하면 카드 없이 진행해 부품을 잃는다. 새 배치는 route 콜 시간(Argon high, R03)
      timeoutMs: route.callTimeoutMs ?? (allPhotos ? 60_000 : 30_000),
      agentName: 'registration/pdp-image-identity',
      runContext,
    },
    (text) => text
  )
  if (!result.success) {
    console.warn('[registration/pdp-image] 식별카드 판독 실패 — 카드 없이 진행:', result.error.message)
    return { card: '', costUsd: billedCostOf(result) }
  }
  // USE 줄은 먼저 꺼낸다(USE를 묻지 않은 잡은 응답 그대로) — 카드에도 UNCERTAIN 기록에도 섞이지 않는다
  const { rest, use } = options.use ? splitUseLine(result.data) : { rest: result.data, use: '' }
  // 전 사진은 확정만 카드에 싣는다 — 한 장에만 있거나 사진끼리 어긋나는 특징은 생성에 보내지 않고 기록만
  const { description, uncertain } = allPhotos ? splitUncertain(rest) : { description: rest, uncertain: '' }
  const card = formatIdentityCard(description, photos.length, allPhotos)
  if (!card) console.warn('[registration/pdp-image] 식별카드 판독 결과가 비어 있음 — 카드 없이 진행')
  return { card, costUsd: billedCostOf(result), ...(uncertain ? { uncertain } : {}), ...(use ? { use } : {}) }
}

function parseGateRows(text: string, fallbackCut: string): VisionGateCutScore[] {
  const parsed = parseLlmJson(text) as unknown
  let rows: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : null
  // 단건 호출(cutNames 1개)에서는 모델이 배열 대신 단일 객체를 반환한다(E2E 2026-08-10 전 컷 실측) — 1행으로 수용
  if (!rows && parsed && typeof parsed === 'object') rows = [parsed]
  if (!rows) throw new Error('게이트 채점 응답이 배열이 아닙니다')
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ ...r, cut: typeof r.cut === 'string' ? r.cut : fallbackCut }) as VisionGateCutScore)
}

/**
 * 컷 1장 채점 — 참조 1장 + 생성 컷 1장을 원본 게이트 프롬프트로 판정(cutNames=[cutName] 단건 호출).
 * 판정 실패는 null이다. 지금 배치는 재생성 트리거 없이 통과와 같은 처리(원본 "채점 호출 실패 → 게이트 통과" 방침)이고, 새 배치 일반 생성은
 * 호출 실패(callFailed)를 다음 run에 다시 판정한다(R12e, pdp-image-stage gateAndMaybeRegen). 정책은 부르는 쪽이 정한다.
 * limits: run 시간 예산이 빠듯할 때 호출자가 시도 상한·재시도를 줄인다. 없으면 route 콜 시간·재시도(새 배치 90초 × 2시도), route에 값이
 * 없으면 지금 값(60초 × 3시도).
 * reference는 운영에서 1장이다. 여러 장은 재현 H6의 강화 판정 비교 전용이다.
 * stage: GIF 칸 프레임 모음 검사는 'images/gif-gate'(R03 — 지금 배치는 게이트와 같은 값, 새 배치는 Opus xhigh).
 * truncated: 잘림 감지 route(새 배치)에서 재시도 뒤에도 잘리거나 빈 답이었다 — 호출부가 '게이트 판정 못 함'으로 남긴다(통합 R03 권장안)
 * callFailed: 잘림이 아닌 호출 실패(시간 초과·API 오류·응답 해석 실패) — 표시만 하고 정책은 부르는 쪽이 정한다(R12e)
 */
export async function judgeImageGate(
  reference: VisionImage | readonly VisionImage[],
  cutName: string,
  generated: VisionImage,
  runContext?: RunContext,
  limits?: { timeoutMs: number; maxRetries: number },
  promptOptions?: { partsCheck?: boolean; useCheck?: boolean; stagedCut?: boolean; lineCut?: boolean; realSize?: string; expectedUse?: string },
  stage: 'images/gate' | 'images/gif-gate' = 'images/gate',
): Promise<{ score: VisionGateCutScore | null; costUsd: number; truncated?: true; callFailed?: true }> {
  const references: readonly VisionImage[] = Array.isArray(reference) ? reference : [reference as VisionImage]
  const route = pdpRoute(stage)
  const result = await callLlm<VisionGateCutScore[]>(
    route,
    {
      system: 'You are a meticulous product-photo QA judge. Respond only with the requested JSON.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVisionGatePrompt([cutName], { ...promptOptions, referenceCount: references.length }) },
            ...references.map(imageBlock),
            imageBlock(generated),
          ],
        },
      ],
      // 새 배치 게이트는 route 콜 시간·재시도(R12e — 90초·재시도 1), 지금 배치는 route에 값이 없어 지금 값(60초·에이전트 기본 재시도)
      timeoutMs: limits?.timeoutMs ?? route.callTimeoutMs ?? 60_000,
      // limits는 run 남은 시간에서 계산한 제한이다 — 갈래(M) 배율을 곱하지 않는다(잡 진행 잠금 기한)
      ...(limits
        ? { maxRetries: limits.maxRetries, timeoutFixed: true }
        : route.callMaxRetries !== undefined
          ? { maxRetries: route.callMaxRetries }
          : {}),
      // GIF 검사는 따로 남긴다(R03 — model-trace가 단계별로 센다, scripts/pdp-eval/model-trace.mjs ROUTE_AGENTS)
      agentName: stage === 'images/gif-gate' ? 'registration/pdp-image-gif-gate' : 'registration/pdp-image-gate',
      runContext,
    },
    (text) => parseGateRows(text, cutName)
  )
  if (!result.success) {
    // 잘림 감지 route만 — 끝까지 잘림·빈 답(parse 실패에 stopReason)을 '판정 못 함'으로 가른다. 지금 배치는 지금 그대로
    const truncated = route.failOnTruncation === true && result.error.stage === 'parse' && Boolean(result.error.stopReason)
    if (truncated) {
      console.warn(`[registration/pdp-image] '${cutName}' 게이트 판정 못 함 — 응답 잘림·빈 답(${result.error.stopReason}):`, result.error.message)
      return { score: null, costUsd: billedCostOf(result), truncated: true }
    }
    // 처리(지금 배치 = 통과와 같은 처리, 새 배치 일반 생성 = 다음 run 다시 판정)는 부르는 쪽 로그가 남긴다
    console.warn(`[registration/pdp-image] '${cutName}' 게이트 채점 호출 실패(${result.error.stage}):`, result.error.message)
    return { score: null, costUsd: billedCostOf(result), callFailed: true }
  }
  const row = result.data.find((r) => r.cut === cutName) ?? result.data[0] ?? null
  return { score: row, costUsd: billedCostOf(result) }
}
