/**
 * E-2 레이아웃 배정 `assignLayouts` — docs/plans/pdp-enrichment/00_DESIGN.md §4.3·부록 C. 순수 함수·결정론.
 * 입력은 골격 순서·설득 단계(섹션 → 역할·단계), vocab 역할별 layout 분포, 적용 가능 행렬(preset-safety.json), LLM layout_selections다.
 * 결과는 section_plan.layout_selections(기존 소비 경로)에 쓰고 근거는 persuasion.layouts에 남긴다.
 *
 * 모바일 2열 가드(§4.3-7, M6): 설계 단계에는 카피가 아직 없어 열당 글자 수를 잴 수 없다. 그래서 후보는 행렬의 mobileSafe
 * (실제 카피로 프리셋을 적용해 섹션 단위 M1·M2·M4·M5·M6이 늘지 않은 조합)만 남기고, 편집기 빌드가 실제 카피로 한 번 더 확인한다.
 */

import { ProSectionType as S } from '@/lib/registration/editor/types/section'
import presetSafety from '@/lib/registration/editor/data/layouts/preset-safety.json'
import { PRESET_EXEMPT_SECTIONS } from '@/lib/registration/editor/utils/buildEditorDocument'
import type { Role16 } from '../corpus-v2'
import { lookupRoleVocab, type DesignVocabSnapshot, type RoleVocab } from '../design-vocab'
import type { PersuasionRecord, PersuasionStage } from './persuasion-planner'

export type PresetSafetyMatrix = Record<string, Record<string, { safe: boolean; mobileSafe: boolean }>>
type LayoutRecord = PersuasionRecord['layouts'][number]

const DEFAULT_MATRIX = presetSafety.matrix as PresetSafetyMatrix
const MINIMAL = 'minimal'
const STYLE_CATEGORIES = new Set(['gradient', 'bold'])
const MAX_STYLE_SECTIONS = 2
const STYLE_PRIORITY_STAGES = new Set<PersuasionStage>(['ATTENTION', 'ACTION'])
/** stack_vertical은 역할의 사진 위 글자 비율이 이 이상이면 사진 우선(image_first), 아니면 문구 우선(minimal) */
const IMAGE_FIRST_OVERLAY_SHARE = 0.5

/** 부록 C — vocab layout 키 → 프리셋 카테고리 */
function presetCategory(layoutKey: string, role: RoleVocab): string | null {
  switch (layoutKey) {
    case 'card_grid':
      return 'card'
    case 'split_lr':
    case 'zigzag':
    case 'comparison':
      return 'split'
    case 'list_steps':
      return 'stacked'
    case 'overlay_text':
      return 'overlay'
    case 'full_bleed':
      return 'full_bleed'
    case 'stack_vertical':
      return role.overlay.imageShare >= IMAGE_FIRST_OVERLAY_SHARE ? 'image_first' : MINIMAL
    case 'table':
      return MINIMAL
    default:
      return null
  }
}

export interface LayoutAssignInput {
  sectionOrder: readonly string[]
  stages: PersuasionRecord['stages']
  category: string | null | undefined
  vocab: DesignVocabSnapshot
  llmSelections?: Record<string, string>
  comparisonIntensity?: 'low' | 'medium' | 'high'
  /** 테스트 주입용 — 기본은 커밋된 preset-safety.json */
  matrix?: PresetSafetyMatrix
}

export interface LayoutAssignResult {
  selections: Record<string, string>
  records: LayoutRecord[]
}

/** 등급 레버에 그라데이션 우위가 있는가(전문 > 템플릿). 플랫폼별 레버 중 하나라도. */
function gradientLeverAdvantage(vocab: DesignVocabSnapshot): boolean {
  return Object.values(vocab.platforms).some((p) =>
    p.tierLevers.some((l) => (l.key === 'background:gradient' || l.key === 'gradient:any') && l.pro > l.template)
  )
}

export function assignLayouts(input: LayoutAssignInput): LayoutAssignResult {
  const matrix = input.matrix ?? DEFAULT_MATRIX
  const stageOf = new Map(input.stages.map((s) => [s.section, s]))
  const mobileSafe = (section: string, category: string) =>
    category === MINIMAL || matrix[section]?.[category]?.mobileSafe === true
  const roleVocabOf = (section: string) => {
    const role = stageOf.get(section)?.role
    return role && role !== 'cta' ? (lookupRoleVocab(input.category, role as Role16, input.vocab)?.role ?? null) : null
  }

  // 스타일 카테고리 — LLM이 고른 섹션 중 조건(레버 우위·역할 배경 분포·행렬)을 갖춘 곳, 주목·행동 단계 우선 최대 2곳
  const lever = gradientLeverAdvantage(input.vocab)
  const styleAllowed = new Set(
    input.sectionOrder
      .filter((section) => {
        const pick = input.llmSelections?.[section]
        const bg = roleVocabOf(section)?.background ?? []
        return (
          pick &&
          STYLE_CATEGORIES.has(pick) &&
          lever &&
          bg.some((b) => b.key === 'gradient' && b.share > 0) &&
          mobileSafe(section, pick)
        )
      })
      .map((section, index) => ({
        section,
        index,
        priority: STYLE_PRIORITY_STAGES.has(stageOf.get(section)?.stage as PersuasionStage) ? 0 : 1,
      }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .slice(0, MAX_STYLE_SECTIONS)
      .map((s) => s.section)
  )
  const firstValue = input.sectionOrder.find((section) => stageOf.get(section)?.stage === 'VALUE')

  const selections: Record<string, string> = {}
  const records: LayoutRecord[] = []
  let prev = MINIMAL
  for (const section of input.sectionOrder) {
    if (section === S.DIVIDER) continue
    const set = (category: string, source: LayoutRecord['source'], reason: string) => {
      selections[section] = category
      const llm = input.llmSelections?.[section]
      records.push({ section, category, source, reason, ...(llm ? { llm } : {}) })
      prev = category
    }
    if (PRESET_EXEMPT_SECTIONS.has(section)) {
      set(MINIMAL, 'default', '프리셋 제외 섹션 — 전용 디자인 유지')
      continue
    }
    const roleVocab = roleVocabOf(section)
    const candidates = [
      ...new Set(
        (roleVocab?.layout ?? [])
          .slice(0, 3)
          .map((l) => presetCategory(l.key, roleVocab!))
          .filter((c): c is string => c !== null && mobileSafe(section, c))
      ),
    ]
    // 비교 강도 high(§4.3-5): 첫 가치 섹션은 비교형 split이 LLM 선택보다 앞선다(행렬 통과 시)
    const comparisonFirst =
      input.comparisonIntensity === 'high' && section === firstValue && mobileSafe(section, 'split')
    if (comparisonFirst) candidates.splice(0, candidates.length, 'split', ...candidates.filter((c) => c !== 'split'))
    const pick = input.llmSelections?.[section]
    let category: string
    let source: LayoutRecord['source']
    let reason: string
    if (comparisonFirst) {
      ;[category, source, reason] = ['split', 'vocab', '비교 강도 high — 첫 가치 섹션 비교형 우선']
    } else if (pick && styleAllowed.has(section)) {
      ;[category, source, reason] = [pick, 'llm', '스타일 카테고리 — 그라데이션 레버 우위·역할 배경 분포·행렬 통과']
    } else if (pick && candidates.includes(pick)) {
      ;[category, source, reason] = [pick, 'llm', 'LLM 선택이 실측 후보 안']
    } else if (candidates.length > 0) {
      ;[category, source, reason] = [candidates[0], 'vocab', `실측 1순위 후보${pick ? `(LLM ${pick}는 후보 밖)` : ''}`]
    } else {
      set(MINIMAL, 'default', '행렬(가드·모바일)을 통과한 후보 없음')
      continue
    }
    if (category !== MINIMAL && category === prev) {
      const next = candidates.find((c) => c !== prev)
      set(next ?? MINIMAL, 'conflict', `앞 섹션과 같은 ${category} — ${next ? '다음 후보' : 'minimal'}`)
      continue
    }
    set(category, source, reason)
  }
  return { selections, records }
}
