/**
 * 품질 보고서용 편집기 최초 빌드 측정(설계 §4.6, pdp-enrichment T4b) — compose 단계가 ENRICHMENT 기록 잡에만 편집기 문서를
 * 한 번 만들어 런타임 레이아웃 가드 탈락과 장식 렌더 결과(영역 밖 제외 등)를 센다. 편집기 최초 빌드와 같은 입력·함수를 쓴다
 * (assembleEditorDataResponse → buildEditorDocument). 순수 계산이고 DB·외부 호출은 없다.
 * editor-data가 pdp-enrichment-stage를 import하므로 순환을 피해 별도 파일로 둔다.
 */

import { assembleEditorDataResponse } from './editor-data'
import { buildEditorDocument, type EditorBuildStats } from './editor/utils/buildEditorDocument'
import type { PdpJobRow } from './pdp-state'

export function emptyEditorBuildStats(): EditorBuildStats {
  return {
    layouts: { tried: 0, applied: 0, guardDropped: 0, mobileReverted: 0 },
    annotations: { placed: 0, outOfView: 0, noRoom: 0, screenCap: 0, notShown: 0 },
  }
}

/** 편집기 최초 빌드를 한 번 만들어 측정값과 걸린 시간(ms)을 돌려준다 */
export async function measureEditorBuild(job: PdpJobRow): Promise<{ stats: EditorBuildStats; ms: number }> {
  const started = Date.now()
  const stats = emptyEditorBuildStats()
  const response = assembleEditorDataResponse(job, null)
  await buildEditorDocument(job.id, { ...response, is_new: true, sections_data: [] }, { stats })
  return { stats, ms: Date.now() - started }
}
