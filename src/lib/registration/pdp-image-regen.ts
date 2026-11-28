/**
 * 편집기 이미지 재생성(pdp-image-regen-api, 묶음 5 API 쪽) — 요청 계약·지시문·재생성 흐름(순수, DB·LLM 없음).
 *
 * 생성은 따로 하지 않는다. 라우트가 그 섹션에 pendingRegen + editorRegen(pending)을 적고 잡을 images 단계로 되돌리면,
 * images 단계(pdp-image-stage)의 재생성 큐가 같은 참조(옵션 사진 가드)·식별 카드·스타일 헌장으로 만들고 정체성 게이트를
 * 거친다. 그래서 웹 API 모델은 run 라우트가, codex-image는 로컬 실행기가 같은 경로로 처리한다.
 * - 프롬프트 직접 덮어쓰기는 받지 않는다(옵션 사진 가드·글자 금지·연령 규칙이 태스크 프롬프트에 있다). 스타일 힌트와
 *   짧은 요청 문구만 맨 끝에 '위 규칙을 넘지 못하는 조정'으로 붙인다.
 * - url은 게이트를 통과한 새 이미지일 때만 바뀐다. 게이트 재생성 1회 뒤에도 미달이면 이전 이미지를 둔다(rejected).
 * - P1-4(마법사 원칙): '유지할 것'(keep)은 지시문에 따로 한 줄, '지금 컷을 바탕으로'(useCurrent)는 지금 컷을 참조 맨 끝에 붙여
 *   그 컷을 고친다(pdp-image-stage). 바뀐 컷은 직전 컷으로 되돌린다(revertEditorRegen — url·장식·비율 맞바꿈, 생성 없음).
 * 클라이언트(편집기 모달)는 이 파일의 타입만 가져다 쓴다.
 */

import { estimateImageCostUsd, ALL_IMAGE_MODELS, type ImageModel, type ImageQuality } from '@/lib/agents/image/types'
import type { GateScoreRow } from '@/lib/agents/registration/prompts/pdp-image-gate-prompts'
import { optionSpecOf } from './internalized/persuasion-signals'
import { optionPhotoCoverage, photographedNames, stripOptionMentions } from './options/option-photo-guard'
import type { EditorRegenRecord, PdpJobRow, RegenStyle, SectionImage } from './pdp-state'

export type { EditorRegenRecord, RegenStyle } from './pdp-state'

/** NEXFIT server/api/regenerate.py _STYLE_HINTS 원문(힌트가 있는 6종 — 모달의 comparison·scene은 서버 힌트가 없다) */
export const REGEN_STYLE_HINTS: Record<RegenStyle, string> = {
  premium_studio:
    'Premium studio lighting, seamless white or neutral gray backdrop, softbox key light with subtle rim light, high-end commercial photography aesthetic.',
  lifestyle: 'Natural lifestyle setting, soft ambient daylight, authentic everyday context, warm and relatable mood.',
  macro: 'Extreme macro close-up, shallow depth of field, textural detail emphasis, precise focus stacking.',
  empathy: 'Emotional empathy-driven composition, soft diffused lighting, relatable human context, gentle warm tones.',
  product_photo:
    'Clean product photography, even lighting, sharp focus on product, minimal shadows, commercial catalog style.',
  infographic:
    'Clean infographic style composition, flat lighting, clear visual hierarchy, minimal distracting background.',
}

export const REGEN_STYLES = Object.keys(REGEN_STYLE_HINTS) as RegenStyle[]
export const REGEN_NOTE_MAX_CHARS = 200
const SECTION_MAX_CHARS = 80

export type RegenRunner = 'web' | 'local'
export type RegenBlockCode = 'busy' | 'already_pending' | 'not_ready' | 'other_work' | 'budget'

export interface RegenBlock {
  code: RegenBlockCode
  error: string
}

export interface RegenRequestBody {
  section: string
  style?: RegenStyle
  note?: string
  /** 유지할 것(P1-4) — note와 같은 정리·상한 */
  keep?: string
  /** 지금 컷을 바탕으로 고친다(P1-4) */
  useCurrent?: boolean
}

/** 잡 모델 단가 기준. maxImageUsd = 정체성 게이트 미달 재생성 1회 포함. 게이트·장식 비전 콜은 따로 소액이 든다 */
export interface RegenEstimate {
  model: ImageModel
  quality: ImageQuality
  /** false = 구독(로컬) 모델이라 API 과금 없음 */
  billed: boolean
  imageUsd: number
  maxImageUsd: number
}

/** POST 200 */
export interface RegenResponse {
  job: PdpJobRow
  section: string
  runner: RegenRunner
  estimate: RegenEstimate
}

/** GET 200 — 쓰기 없는 사전 조회. 막히면 409 대신 blocked */
export interface RegenPreviewResponse {
  section: string
  runner: RegenRunner
  estimate: RegenEstimate
  blocked: RegenBlock | null
  /** 직전 컷으로 되돌릴 수 있는가(done + previousUrl, P1-4) */
  revertible?: boolean
}

/** POST …/images/regenerate/revert 200 */
export interface RegenRevertResponse {
  job: PdpJobRow
  section: string
}

/** 한 줄로 — 제어 문자는 공백, 연속 공백은 하나, 상한에서 자른다 */
export function sanitizeRegenNote(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REGEN_NOTE_MAX_CHARS)
    .trim()
}

export function parseRegenRequest(raw: unknown): { ok: true; value: RegenRequestBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '요청 본문이 필요합니다.' }
  const { section, style, note, keep, useCurrent } = raw as Record<string, unknown>
  if (typeof section !== 'string' || !section.trim() || section.length > SECTION_MAX_CHARS) {
    return { ok: false, error: 'section이 필요합니다.' }
  }
  if (style !== undefined && style !== null && style !== '' && !REGEN_STYLES.includes(style as RegenStyle)) {
    return { ok: false, error: `style은 ${REGEN_STYLES.join(', ')} 중 하나여야 합니다.` }
  }
  if (note !== undefined && note !== null && typeof note !== 'string')
    return { ok: false, error: 'note는 문자열이어야 합니다.' }
  if (keep !== undefined && keep !== null && typeof keep !== 'string')
    return { ok: false, error: 'keep은 문자열이어야 합니다.' }
  const cleanNote = typeof note === 'string' ? sanitizeRegenNote(note) : ''
  const cleanKeep = typeof keep === 'string' ? sanitizeRegenNote(keep) : ''
  return {
    ok: true,
    value: {
      section: section.trim(),
      ...(style ? { style: style as RegenStyle } : {}),
      ...(cleanNote ? { note: cleanNote } : {}),
      ...(cleanKeep ? { keep: cleanKeep } : {}),
      ...(useCurrent === true ? { useCurrent: true } : {}),
    },
  }
}

/** codex-image(로컬 실행기) 잡인가 — 웹 run 라우트는 이 잡을 진행하지 않는다 */
export function regenRunnerOf(job: Pick<PdpJobRow, 'image_model'>): RegenRunner {
  return ALL_IMAGE_MODELS.find((m) => m.id === job.image_model)?.provider === 'local' ? 'local' : 'web'
}

/** 태스크 지정 모델·품질(저가 컷 강등)이 잡 값을 이긴다 — generateSection과 같은 규칙 */
export function estimateEditorRegen(
  job: Pick<PdpJobRow, 'image_model' | 'image_quality'>,
  task: { model?: ImageModel; quality?: ImageQuality }
): RegenEstimate {
  const model = task.model ?? job.image_model
  const quality = task.quality ?? job.image_quality
  // 구독(로컬) 모델은 단가표가 0이다(estimateImageCostUsd)
  const imageUsd = estimateImageCostUsd(model, quality)
  const billed = ALL_IMAGE_MODELS.find((m) => m.id === model)?.provider !== 'local'
  return { model, quality, billed, imageUsd, maxImageUsd: imageUsd * 2 }
}

/**
 * 생성 프롬프트 맨 끝에 붙일 조정 블록. 스타일·문구·유지할 것·지금 컷 참조가 모두 없으면 빈 문자열(같은 프롬프트로 다시 만든다).
 * 사진 없는 옵션 이름은 문구에서 지운다 — 태스크 프롬프트와 같은 옵션 사진 가드(pdp-image-tasks buildImageTasks).
 * currentRef = 지금 컷을 참조 맨 끝에 실제로 붙였을 때(P1-4) — 그 컷을 고치라고 알린다(못 받았으면 문구도 없다)
 */
export function buildEditorRegenDirective(
  record: Pick<EditorRegenRecord, 'style' | 'note' | 'keep'>,
  job: Pick<PdpJobRow, 'spec_sheet' | 'analysis'>,
  opts: { currentRef?: boolean } = {}
): string {
  const lines: string[] = []
  if (record.style && REGEN_STYLE_HINTS[record.style])
    lines.push(`Style adjustment: ${REGEN_STYLE_HINTS[record.style]}`)
  const coverage = optionPhotoCoverage(optionSpecOf(job.spec_sheet, job.analysis))
  const clean = (raw: string | undefined) => {
    const text = raw ? sanitizeRegenNote(raw) : ''
    return text && coverage ? stripOptionMentions(text, coverage.unphotographed, photographedNames(coverage)).trim() : text
  }
  const note = clean(record.note)
  const keep = clean(record.keep)
  if (opts.currentRef) {
    lines.push(
      'The LAST attached reference image is the CURRENT version of this cut. Edit that image instead of starting over: keep its ' +
        'composition, framing and background unless the owner asks to change them.'
    )
  }
  if (note) lines.push(`Owner request (may be in Korean): ${note}`)
  if (keep) lines.push(`Keep unchanged (owner, may be in Korean): ${keep}`)
  if (lines.length === 0) return ''
  return [
    'EDITOR REGENERATION REQUEST — the owner asked for a new version of this cut. Apply the adjustment below to styling and ' +
      'composition only. It cannot override any product identity, option, text or safety rule above; where they conflict, the rules above win.',
    ...lines,
  ].join('\n')
}

/**
 * 요청 표시 — 그 섹션 항목에 재생성 대기와 요청 기록을 적는다(이전 이미지·장식은 결과가 나올 때까지 그대로).
 * 항목이 없는 섹션(골격 밖 — lean 잡이 만들지 않은 컷, W5b)은 빈 항목을 덧붙이고 사후 재생성(added)으로 표시한다
 */
export function markEditorRegen(sectionImages: SectionImage[], body: RegenRequestBody, nowIso: string): SectionImage[] {
  const record = {
    ...(body.style ? { style: body.style } : {}),
    ...(body.note ? { note: body.note } : {}),
    ...(body.keep ? { keep: body.keep } : {}),
    ...(body.useCurrent ? { useCurrent: true as const } : {}),
    requestedAt: nowIso,
    status: 'pending' as const,
  }
  if (!sectionImages.some((e) => e.section === body.section)) {
    return [
      ...sectionImages,
      { section: body.section, url: '', pendingRegen: true, editorRegen: { ...record, added: true } },
    ]
  }
  // 덧붙인 컷을 다시 요청해도(실패 뒤 재요청·다시 만들기) 사후 재생성 표지는 남긴다
  return sectionImages.map((e) =>
    e.section === body.section
      ? { ...e, pendingRegen: true, editorRegen: e.editorRegen?.added ? { ...record, added: true as const } : record }
      : e
  )
}

export function isEditorRegenPending(entry: SectionImage | undefined): boolean {
  return Boolean(entry?.pendingRegen && entry.editorRegen?.status === 'pending')
}

/**
 * 게이트 1회 결과. skip은 두 가지다 — 설계상 게이트가 없는 컷(unjudged 없음)과, 게이트를 돌려야 했지만 판정하지 못한 경우
 * (unjudged = 사유: 참조 없음·run 시간 부족·이미지 받기 실패·채점 실패). 일반 생성은 둘 다 통과로 받지만, 편집기 재생성은
 * 판정하지 못한 이미지로 url을 바꾸지 않는다. callFailed = 채점 호출이 실패했다(시간 초과·API 오류·해석 실패, R12e) — 새 배치 일반 생성은
 * 이 표시가 있으면 통과로 받지 않고 다음 run에 다시 판정한다(지금 배치·편집기 재생성은 이 표시를 보지 않는다).
 */
export type GateVerdict =
  | { verdict: 'pass'; score?: GateScoreRow; costUsd: number }
  | { verdict: 'skip'; unjudged?: string; costUsd: number; callFailed?: true }
  | { verdict: 'fail'; score: GateScoreRow; reason: string; costUsd: number }

export interface EditorRegenDeps {
  /** 컷 1장 생성 — regenScore가 있으면 게이트 재생성 지시문을 붙인다. 실패는 throw하지 않고 error·이전 url로 돌아온다 */
  generate: (regenScore?: GateScoreRow) => Promise<{ entry: SectionImage; costUsd: number }>
  /** 정체성 게이트 1회 */
  judge: (entry: SectionImage) => Promise<GateVerdict>
  /** 게이트 재생성을 시작해도 되는가(run 시간 — 재생성 뒤 게이트까지 — 와 지출 예약) */
  canRegen: () => boolean
  now: () => string
}

/**
 * 요청을 끝낸다 — 이전 항목(url·장식)을 그대로 두고 결과만 기록한다. 시작하지 못한 요청(예산)에도 쓴다.
 * 이전 이미지가 없던 새 컷(사후 재생성)은 빈 항목이 남는다(화면이 사유를 읽는다) — 문구도 그에 맞춘다
 */
export function settleEditorRegen(
  prior: SectionImage,
  status: 'rejected' | 'failed',
  message: string,
  nowIso: string
): SectionImage {
  const request = prior.editorRegen ?? { requestedAt: nowIso, status: 'pending' as const }
  const text = prior.url ? message : message.replace('이전 이미지를 유지했습니다', '새 사진을 넣지 않았습니다')
  return { ...prior, pendingRegen: false, editorRegen: { ...request, status, finishedAt: nowIso, message: text } }
}

/**
 * 편집기 재생성 1건 — 생성 → 게이트 → (미달이면) 재생성 1회 → 게이트. 게이트를 통과했거나 설계상 게이트가 없는 컷만 url을
 * 바꾼다(done, previousUrl). 미달로 끝나면 rejected, 생성이 실패하면 failed, 게이트가 판정하지 못하면 첫 시도는 failed·미달
 * 뒤에는 rejected — 모두 이전 항목을 그대로 두고 기록만 남긴다.
 */
export async function runEditorRegenFlow(
  prior: SectionImage,
  deps: EditorRegenDeps
): Promise<{ entry: SectionImage; costUsd: number }> {
  const request = prior.editorRegen ?? { requestedAt: deps.now(), status: 'pending' as const }
  let costUsd = 0
  const keepPrior = (status: 'rejected' | 'failed', message: string) =>
    settleEditorRegen(prior, status, message, deps.now())
  const produced = (entry: SectionImage) => Boolean(entry.url) && entry.url !== prior.url && !entry.error

  let regenScore: GateScoreRow | undefined
  let lastReason = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await deps.generate(regenScore)
    costUsd += gen.costUsd
    if (!produced(gen.entry)) {
      const error = gen.entry.error || '생성 결과가 없습니다'
      const entry =
        attempt === 0
          ? keepPrior('failed', `재생성 실패 — 이전 이미지를 유지했습니다: ${error}`)
          : keepPrior(
              'rejected',
              `정체성 게이트 미달(${lastReason}) 뒤 재생성도 실패 — 이전 이미지를 유지했습니다: ${error}`
            )
      return { entry, costUsd }
    }
    const gate = await deps.judge(gen.entry)
    costUsd += gate.costUsd
    if (gate.verdict === 'skip' && gate.unjudged) {
      const entry =
        attempt === 0
          ? keepPrior('failed', `정체성 게이트를 판정하지 못해(${gate.unjudged}) 이전 이미지를 유지했습니다`)
          : keepPrior(
              'rejected',
              `정체성 게이트 미달(${lastReason}) 뒤 재생성본을 판정하지 못해(${gate.unjudged}) 이전 이미지를 유지했습니다`
            )
      return { entry, costUsd }
    }
    if (gate.verdict !== 'fail') {
      // 새 항목이라 이전 컷의 장식·비율은 따라오지 않는다 — 장식 하위 단계가 새 url로 다시 고른다
      const entry: SectionImage = {
        ...gen.entry,
        pendingRegen: false,
        // 이전 이미지가 없던 새 컷(사후 재생성)은 되돌릴 이미지가 없다 — previousUrl을 두지 않는다.
        // 되돌리기(P1-4)가 장식·비율까지 되돌리도록 이전 항목의 것을 남긴다
        editorRegen: {
          ...request,
          status: 'done',
          finishedAt: deps.now(),
          ...(prior.url ? { previousUrl: prior.url, previous: decorOf(prior) } : {}),
        },
      }
      return { entry, costUsd }
    }
    lastReason = gate.reason
    if (attempt === 1) break
    if (!deps.canRegen()) {
      const message = `정체성 게이트 미달(${lastReason}) — 이번 run에 다시 만들 시간·예산이 없어 이전 이미지를 유지했습니다`
      return { entry: keepPrior('rejected', message), costUsd }
    }
    regenScore = gate.score
  }
  return { entry: keepPrior('rejected', `정체성 게이트 미달(${lastReason}) — 이전 이미지를 유지했습니다`), costUsd }
}

/** 항목의 장식·비율(되돌리기에 같이 옮기는 것) — 없는 칸은 두지 않는다 */
function decorOf(entry: SectionImage): NonNullable<EditorRegenRecord['previous']> {
  return {
    ...(entry.annotations ? { annotations: entry.annotations } : {}),
    ...(entry.annotationStatus ? { annotationStatus: entry.annotationStatus } : {}),
    ...(entry.imageAspect !== undefined ? { imageAspect: entry.imageAspect } : {}),
    // D2-3 첫 화면 글자 자리 — 그 컷을 잰 기록이라 컷과 함께 맞바꾼다(편집기 겹침이 다른 컷의 측정으로 그려지지 않게)
    ...(entry.copyZone ? { copyZone: entry.copyZone } : {}),
    // 사이즈 단독 컷의 제품 경계 — 치수선이 다른 컷의 측정으로 그려지지 않게 컷과 함께 맞바꾼다
    ...(entry.productBox ? { productBox: entry.productBox } : {}),
  }
}

/**
 * 직전 컷으로 되돌리기(P1-4, 유료 0) — done이고 previousUrl이 있으면 url·장식·비율을 바뀌기 전 것과 맞바꾼다(다시 누르면 되돌림
 * 취소). 예전 기록(장식 기록 없음)은 장식 없이 되돌리고 장식 다시 고르기를 건너뛴다(annotationStatus skipped — 유료 비전 콜 없음).
 * 되돌릴 수 없으면 null
 */
export function revertEditorRegen(entry: SectionImage, nowIso: string): SectionImage | null {
  const record = entry.editorRegen
  if (!record || record.status !== 'done' || !record.previousUrl || !entry.url || entry.pendingRegen) return null
  const back = record.previous ?? {}
  // 장식·비율은 지금 컷의 것이라 빼고, 되돌린 컷의 것으로 다시 채운다
  const rest: SectionImage = { ...entry }
  delete rest.annotations
  delete rest.annotationStatus
  delete rest.imageAspect
  delete rest.copyZone
  delete rest.productBox
  return {
    ...rest,
    url: record.previousUrl,
    ...(back.annotations ? { annotations: back.annotations } : {}),
    annotationStatus: back.annotationStatus ?? 'skipped',
    ...(back.imageAspect !== undefined ? { imageAspect: back.imageAspect } : {}),
    ...(back.copyZone ? { copyZone: back.copyZone } : {}),
    ...(back.productBox ? { productBox: back.productBox } : {}),
    editorRegen: { ...record, previousUrl: entry.url, previous: decorOf(entry), revertedAt: nowIso },
  }
}

export function isRevertible(entry: SectionImage | undefined): boolean {
  return Boolean(entry && revertEditorRegen(entry, ''))
}
