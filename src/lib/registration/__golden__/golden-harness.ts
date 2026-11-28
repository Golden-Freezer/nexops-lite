/**
 * Track S·Track I 골든 하네스 — 오프라인 픽스처(__fixtures__/enrichment, T0 추출)로 파이프라인 단계별
 * 입력(프롬프트)·산출을 고정한다(docs/plans/pdp-enrichment/01_TEST_PLAN.md §2 골든 ①~⑥).
 * 모의(LLM·DB·스토리지)는 pdp-golden.test.ts에 있고, 여기는 픽스처 로드·단계 되감기·요약·정규화만 둔다.
 *
 * 긴 문자열은 길이·sha256·앞부분만 스냅샷에 남긴다(바이트 단위 변화 검출). 원문 비교가 필요하면
 * NEXOPS_GOLDEN_DUMP=<리포 밖 폴더>로 실행해 캡처 원문을 파일로 떨궈 diff한다.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProSectionType } from '../editor/types/section'
import type { DesignPrompts, PdpJobRow, PdpStep } from '../pdp-state'

export const GOLDEN_USER_ID = 'user_golden'
export const GOLDEN_SUPABASE_URL = 'https://golden.supabase.test'
/** 편집기 요소 ID가 Date.now를 쓴다 — 고정 시각으로 묶은 뒤 정규화한다. */
export const GOLDEN_NOW = 1_700_000_000_000

export const TRACK_S_KEYS = ['A-track-s', 'B-track-s', 'C-track-s'] as const
export const TRACK_I_KEYS = ['A-track-i', 'B-track-i', 'C-track-i'] as const
/**
 * 테스트 전용 변형 — v2 스냅샷이 없는 카테고리(stationery)의 구 Track I 잡. 저장 픽스처 B-track-i의 카테고리만
 * 바꿔 standard 폴백 경로(설계·카피·이미지·합성)를 고정한다. T2의 "트랙 판정 전환"이 기록 없는 구 잡을 바꾸면 여기서 드러난다.
 */
export const TRACK_I_VARIANT_KEYS = ['B-track-i-stationery'] as const
const VARIANTS: Record<
  (typeof TRACK_I_VARIANT_KEYS)[number],
  { base: (typeof TRACK_I_KEYS)[number]; category: string }
> = {
  'B-track-i-stationery': { base: 'B-track-i', category: 'stationery' },
}
export type FixtureKey =
  | (typeof TRACK_S_KEYS)[number]
  | (typeof TRACK_I_KEYS)[number]
  | (typeof TRACK_I_VARIANT_KEYS)[number]

export interface EnrichmentFixture {
  fixtureKey: FixtureKey
  sourceJobId: string
  generation_track: string
  mode: string
  image_model: string
  image_quality: string
  spec_sheet: Record<string, unknown>
  source_images: string[]
  analysis: Record<string, unknown>
  research_result: Record<string, unknown>
  section_plan: Record<string, unknown>
  design_prompts: Record<string, unknown>
  copy_sections: Record<string, unknown>
  section_images: Array<Record<string, unknown>>
  corpus_version: string | null
  cost_usd: number
}

const FIXTURE_DIR = resolve(__dirname, '../__fixtures__/enrichment')

export function loadEnrichmentFixture(key: FixtureKey): EnrichmentFixture {
  const variant = VARIANTS[key as keyof typeof VARIANTS]
  const file = variant ? variant.base : key
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${file}.json`), 'utf8')) as EnrichmentFixture
  if (!variant) return fixture
  return {
    ...fixture,
    fixtureKey: key,
    spec_sheet: { ...fixture.spec_sheet, category: variant.category },
    analysis: { ...fixture.analysis, detected_category: variant.category },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 픽스처 → 완료 잡(PdpJobRow). 사용자·사업장·초안은 고정 값, final_html은 compose 골든이 다시 만든다. */
export function fixtureToJob(fixture: EnrichmentFixture): PdpJobRow {
  return clone({
    id: `golden-${fixture.fixtureKey}`,
    user_id: GOLDEN_USER_ID,
    business_id: null,
    draft_id: null,
    spec_sheet: fixture.spec_sheet,
    source_images: fixture.source_images,
    image_model: fixture.image_model,
    image_quality: fixture.image_quality,
    mode: fixture.mode,
    generation_track: fixture.generation_track === 'internalized' ? 'internalized' : 'standard',
    analysis: fixture.analysis,
    research_result: fixture.research_result,
    design_prompts: fixture.design_prompts,
    section_plan: fixture.section_plan,
    copy_sections: fixture.copy_sections,
    section_images: fixture.section_images,
    final_html: '<!-- golden fixture: final_html omitted -->',
    current_step: 'done',
    progress: 100,
    error: null,
    cost_usd: 0,
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
  }) as unknown as PdpJobRow
}

type RunnableStep = Exclude<PdpStep, 'pending' | 'done' | 'failed'>

/**
 * 합성 전체 카피 잡 — 픽스처에 없는 섹션 타입까지 변환되도록 근거 필드를 채운 A(Track S) 변형.
 * 프리셋 적용 가능 행렬(preset-safety)과 mobile 전 섹션 판독(L2)이 함께 쓴다.
 */
export function syntheticFullCopyJob(): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-s'))
  const all = Object.values(ProSectionType).filter((t) => t !== ProSectionType.DIVIDER)
  job.id = 'golden-synthetic-full'
  job.spec_sheet = {
    ...job.spec_sheet,
    colorOptions: ['레드', '블루', '그린', '옐로'],
    rating: 4.8,
    reviewCount: 128,
    soldOutCount: 3000,
    certificationInfo: 'KC 인증',
    eventBannerInfo: '첫 구매 할인',
  }
  job.section_plan = { ...job.section_plan, activated_sections: all, section_order: all, layout_selections: {} }
  // 인증 입력이 있는 잡은 카피 단계가 인증 카피를 만든다(pdp-copy-agent) — 인증 섹션은 그 카피로 켜진다(카피 없이 '정품 인증'을
  // 지어내지 않는다, P0-1). 제목만 입력 인증 문구 그대로 — 프리셋 안전 행렬이 예전(제목만 있는 인증 섹션)과 같은 모양을 잰다
  const final = job.copy_sections.final
  if (final) {
    job.copy_sections = { ...job.copy_sections, final: { ...final, certificationCopy: { headline: 'KC 인증' } } }
  }
  return job
}

/**
 * 완료 잡을 "그 단계 직전" 상태로 되감는다 — 이후 단계 산출을 비운다. images 직전 상태에서는
 * images 단계가 직접 채우는 design_prompts.style_charter·identity_card도 뺀다(그 산출까지 골든 대상).
 */
export function rewindTo(job: PdpJobRow, step: RunnableStep): PdpJobRow {
  const next = clone(job)
  const order: RunnableStep[] = ['analysis', 'research', 'design', 'copywriting', 'images', 'compose']
  const at = order.indexOf(step)
  if (at <= 0) next.analysis = {}
  if (at <= 1) next.research_result = {}
  if (at <= 2) {
    next.section_plan = {}
    next.design_prompts = {}
  }
  if (at <= 3) next.copy_sections = {}
  if (at <= 4) {
    next.section_images = []
    const { style_charter: _style, identity_card: _identity, ...rest } = next.design_prompts as DesignPrompts
    next.design_prompts = rest
  }
  if (at === 5) {
    const { quality_report: _report, ...copyRest } = next.copy_sections
    next.copy_sections = copyRest
  }
  next.final_html = null
  next.current_step = at === 0 ? 'pending' : step
  next.progress = 0
  next.error = null
  return next
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface TextDigest {
  length: number
  sha256: string
  head: string
}

export function digestText(text: string, headLength = 80): TextDigest {
  return { length: text.length, sha256: sha256(text), head: text.slice(0, headLength) }
}

export function digestJson(value: unknown): { sha256: string; length: number } {
  const text = JSON.stringify(value ?? null)
  return { sha256: sha256(text), length: text.length }
}

/** Anthropic·OpenAI 메시지 배열 → 텍스트(이미지 블록은 자리 표시만). */
export function messagesToText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  return messages
    .map((m) => {
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      return content
        .map((block) => {
          const b = block as { type?: string; text?: string }
          return b.type === 'text' ? (b.text ?? '') : `[${b.type ?? 'block'}]`
        })
        .join('\n')
    })
    .join('\n---\n')
}

/** 편집기 문서 정규화 — Date.now(고정)·모듈 순번이 섞인 요소 ID와 생성 시각(createdAt·capturedAt 등)을 표지로 바꾼다. */
export function normalizeEditorJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(new RegExp(`[A-Za-z0-9_:-]*${GOLDEN_NOW}[A-Za-z0-9_:-]*`, 'g'), '<id>')
    .replace(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z"/g, '"<t>"')
}

/** NEXOPS_GOLDEN_DUMP가 있으면 캡처 원문을 파일로 남긴다(리포 밖 폴더 권장). */
export function dumpGolden(name: string, content: string): void {
  const dir = process.env.NEXOPS_GOLDEN_DUMP?.trim()
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.txt`), content, 'utf8')
}
