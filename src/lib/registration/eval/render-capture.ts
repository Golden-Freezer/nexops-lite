/**
 * 실 테스트 평가용 렌더 (T7a, 04_TEST_PROGRAM.md §3) — 잡 산출물을 편집기와 같은 경로로 HTML로 만든다.
 *
 * 잡 → assembleEditorDataResponse → buildEditorDocument(신규 진입 강제) → exportRenderHtml.
 * 저장된 편집본이 아니라 파이프라인 산출 그대로를 잰다(useSaved로 저장본 사용 가능).
 * 캡처(Playwright)는 scripts/pdp-eval/capture.mjs가 한다. 파이프라인·편집기 동작은 바꾸지 않는다.
 */

import { assembleEditorDataResponse, type EditorDataRow } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import type { ProEditorDocument } from '@/lib/registration/editor/types/editor'
import type { PdpJobRow } from '@/lib/registration/pdp-state'

/** 폰 한 화면(390×844)을 캔버스(860px 폭) 높이로 환산한 값 — 설계 §4.8 */
export const PHONE_SCREEN_CANVAS_PX = 1860
export const CANVAS_WIDTH_PX = 860

export interface RenderedJob {
  doc: ProEditorDocument
  html: string
  /** exportRenderHtml이 그리는 섹션(보이는 것·높이 10px 이상)의 높이 합 */
  canvasHeight: number
  /** 캔버스 높이를 폰 화면 수로 환산(M8 보고용) */
  phoneScreens: number
  sectionTypes: string[]
}

export interface RenderOptions {
  /** 편집기 저장본이 있으면 그것을 쓴다(기본: 파이프라인 산출로 새로 빌드) */
  useSaved?: boolean
  /**
   * 디자인 컷 렌더 v2로 잰다(PDP-DR-PLAN §1 무료 측정) — 메모리에서만 계획에 layout 2를 붙인다(DB 쓰기 없음).
   * 디자인 컷 계획이 없는 잡은 그대로다
   */
  designcutLayout?: 2
}

/** 계획 기록이 있을 때만 layout을 붙인 사본(원본 잡은 바꾸지 않는다) */
export function withDesigncutLayout(job: PdpJobRow, layout: 2 | undefined): PdpJobRow {
  const plan = job.section_plan?.designcut
  if (!layout || !plan) return job
  return { ...job, section_plan: { ...job.section_plan, designcut: { ...plan, layout } } }
}

export async function renderJobHtml(
  job: PdpJobRow,
  editorRow: EditorDataRow | null = null,
  options: RenderOptions = {},
): Promise<RenderedJob> {
  const response = assembleEditorDataResponse(withDesigncutLayout(job, options.designcutLayout), options.useSaved ? editorRow : null)
  const fresh = !options.useSaved || response.is_new
  const doc = await buildEditorDocument(job.id, fresh ? { ...response, is_new: true, sections_data: [] } : response)

  // exportRenderHtml과 같은 기준으로 보이는 섹션만 센다
  const visible = doc.sections.filter((s) => s.isVisible && s.canvas.height >= 10).sort((a, b) => a.order - b.order)
  const canvasHeight = visible.reduce((sum, s) => sum + s.canvas.height, 0)
  const html = exportRenderHtml(doc.sections, {}, doc.sourceData.designPalette ?? null)

  return {
    doc,
    html,
    canvasHeight,
    phoneScreens: Math.round((canvasHeight / PHONE_SCREEN_CANVAS_PX) * 10) / 10,
    sectionTypes: visible.map((s) => String(s.sectionType)),
  }
}
