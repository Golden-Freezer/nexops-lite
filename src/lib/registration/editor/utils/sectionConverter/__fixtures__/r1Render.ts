// R1 저장 잡(P02 포장 파우치·P03 두피 브러시·P07 반려동물 식기) 재렌더 — 시험 전용. 이미지 URL은 자리표시, 유료 호출 0.
// 실제 평가 경로(editor-data → buildEditorDocument)처럼 카테고리 v2 테마(있으면)와 레이아웃 프리셋을 함께 적용한다.
import type { DesignPalette } from '../../../types/editor'
import type { EditorDataResponse } from '../../../services/editorApi'
import { buildEditorDocument } from '../../buildEditorDocument'
import { emptyEditorBuildStats } from '@/lib/registration/quality-render-stats'
import { getCorpusSnapshotV2 } from '@/lib/registration/corpus-v2'
import { buildInternalizedTheme } from '@/lib/registration/internalized/internalized-theme'
import { roleSectionMap } from '@/lib/registration/internalized/role-section-map'
import p02 from './r1-p02-d10ea762.json'
import p03 from './r1-p03-f2d72bd0.json'
import p07 from './r1-p07-8e7006a3.json'

export type R1Fixture = typeof p02 | typeof p03 | typeof p07
export const R1_JOBS: Array<[string, R1Fixture]> = [
  ['P02', p02],
  ['P03', p03],
  ['P07', p07],
]

/** persuasion=false면 기록에서 persuasion을 뺀 대조 잡으로 렌더한다 */
export async function renderR1(f: R1Fixture, persuasion = true) {
  const features = (f.section_plan.enrichment.features as string[]).filter((x) => persuasion || x !== 'persuasion')
  const snapshot = getCorpusSnapshotV2(f.spec_sheet.category)
  const palette = f.copy.designPalette as unknown as DesignPalette
  const response = {
    is_new: true,
    sections_data: [],
    layout_assignments: {},
    copywriting_result: f.copy,
    generated_images: f.images,
    spec_sheet: f.spec_sheet,
    section_plan: { ...f.section_plan, enrichment: { ...f.section_plan.enrichment, features } },
    mobile_floor: true,
    internalized_theme: snapshot ? buildInternalizedTheme(snapshot, palette, roleSectionMap(persuasion)) : null,
  } as unknown as EditorDataResponse
  const stats = emptyEditorBuildStats()
  const doc = await buildEditorDocument('r1', response, { stats })
  return { doc, stats }
}
