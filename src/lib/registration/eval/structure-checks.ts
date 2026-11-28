/**
 * 구조 자동 검사(오너 지적 11-01, 하네스 재분석) — 심사에 묶여 드러나지 않던 구조 문제를 낱개로 잰다. 첫 회차는 기록만이다(점수·합격선 밖).
 * - pointHeads: 큰 POINT 섹션의 머리(첫 사진 위 요소)가 같은 자리·같은 모양인가. 사진 배치는 달라도 된다.
 * - infoTable: 상품 정보 표 행 수와 허용 밖 행 이름(필수 7행·특별한 내용). 디자인 컷 계획의 표(long:info)와 K 슬롯 표를 읽는다.
 * - hookText: 첫 화면 글의 양(오너 지시 11-01: 후킹은 1~3초). 글 상자 수와 공백 뺀 글자 수만 잰다.
 * - pageTail: 사이즈·상품 정보 섹션의 자리(오너 지시 11-01: 맨 마지막 또는 그 바로 앞). 끝에서 몇 번째인지와 끝 자리를 지켰는지.
 *   끝 순서는 구매 전 확인 → 사이즈 → 상품 정보이고, 사이즈가 없으면 상품 정보가 맨 끝이다. 구매 전 확인 표는 그 바로 앞에만 올 수 있다.
 * - pointBadges: 큰 POINT 단추의 색(오너 지시 11-01: 색상을 동일하게). 단추 면 색을 모아 같은지 본다.
 * - plan: 계획 지표(plan-metrics.ts) — 구조 6칸·바탕·컷·인포그래픽 유형 수. 기록만이고 합격선에 넣지 않는다.
 * 순수·결정론. 편집기 문서 요소의 이름·위치만 읽고 글을 옮기지 않는다.
 */

import type { CanvasElement, CanvasSection } from '../editor/types/canvas'
import type { DesigncutSection, PdpJobRow } from '../pdp-state'
import { isListedInfoLabel } from '../product-info-rows'
import { templateById } from '../templatelib/library'
import { jobPlanMetrics, type PlanMetrics } from './plan-metrics'

/** 필수 7행 + 특별한 내용 3행(15_TEMPLATE_LINE §4 spec.rows·spec.special) */
export const INFO_ROWS_LIMIT = 10
/** 풀폭 띠·전면 바탕 도형은 머리 요소로 세지 않는다 — 바탕이라 글 자리가 아니다(M4 판정과 같은 80%) */
const BAND_SHARE = 0.8
/** 큰 POINT 단추 — 디자인 컷 장 머리 캡슐과 K 캡슐의 면 도형 */
const POINT_BADGE = /^designcut-(chapter|capsule)-bg$/
/** 사이즈 섹션 — 디자인 컷 치수 템플릿. K에는 따로 없고 치수는 표 안에 든다 */
const SIZE_LAYOUT = 'designcut_T6'
/** 상품 정보 섹션 — K 표. 디자인 컷 표는 같은 T9를 다른 표도 쓰므로 계획 키로 가른다(tableKinds). 소재·원산지 표(long:material)는 D2에 없고 상품 정보 표가 아니다 */
const K_INFO_LAYOUT = 'designcut_k_spec_table.'
const TABLE_LAYOUT = 'designcut_T9'
const INFO_PLAN_KEY = 'long:info'
/** 구매 전 확인 표 — 끝 두 자리를 차지하지 않고 그 바로 앞에만 올 수 있다 */
const PURCHASE_LAYOUT = 'designcut_purchase'
/** 큰 POINT — 디자인 컷 T3a와 K point_div만. 추가 컷·자세히 보기도 섹션 종류가 point_div라 종류로 가를 수 없다 */
const BIG_POINT_LAYOUT = /^designcut_(T3a$|k_point_div\.)/
const PHOTO_TYPES: ReadonlySet<CanvasElement['type']> = new Set(['image', 'framed-image'])

export interface StructureChecks {
  /** consistent: 큰 POINT가 둘 이상일 때만 판정한다(없으면 null). signatures: 섹션마다 머리 모양 */
  pointHeads: { count: number; consistent: boolean | null; signatures: string[] }
  /** 표가 없으면 null */
  infoTable: { rows: number; limit: number; overLimit: boolean; unknownLabels: string[] } | null
  /** 첫 섹션이 없으면 null. 기록만이고 문턱을 두지 않는다 */
  hookText: { blocks: number; chars: number } | null
  /**
   * 사이즈·상품 정보의 자리 — 끝에서 몇 번째인가(0이 맨 끝). ok: 페이지 끝이 구매 전 확인 → 사이즈 → 상품 정보 순서다(없는 것은 건너뛴다).
   * 사이즈·상품 정보가 둘 다 없으면 null. 기록만이고 합격선에 넣지 않는다
   */
  pageTail: { total: number; purchaseFromEnd: number[]; sizeFromEnd: number[]; infoFromEnd: number[]; ok: boolean | null }
  /** 큰 POINT 단추의 면 색 — same: 단추가 둘 이상일 때만 판정한다(없으면 null). 기록만이고 합격선에 넣지 않는다 */
  pointBadges: { count: number; same: boolean | null; colors: string[] }
  /** 계획 지표 — 디자인 컷 계획이 없는 잡은 null */
  plan: PlanMetrics | null
}

const isBand = (el: CanvasElement, section: CanvasSection) => el.type === 'shape' && el.transform.width >= section.canvas.width * BAND_SHARE

/** 머리 모양 — 첫 사진 위 요소의 이름·가로 자리·글자 수준. 세로 자리는 제목 줄 수로 달라지므로 넣지 않고, 순서로만 본다 */
export function headSignature(section: CanvasSection): string {
  const visible = section.elements.filter((el) => el.isVisible !== false && !isBand(el, section))
  const photoTops = visible.filter((el) => PHOTO_TYPES.has(el.type)).map((el) => el.transform.y)
  const top = photoTops.length > 0 ? Math.min(...photoTops) : Number.POSITIVE_INFINITY
  return visible
    .filter((el) => !PHOTO_TYPES.has(el.type) && el.transform.y < top)
    .sort((a, b) => a.transform.y - b.transform.y || a.transform.x - b.transform.x)
    .map((el) => [el.name ?? el.type, Math.round(el.transform.x), el.textProps?.typoLevel ?? ''].join(':'))
    .join('|')
}

const isBigPoint = (section: CanvasSection) => BIG_POINT_LAYOUT.test(section.layoutId ?? '')

function checkPointHeads(sections: readonly CanvasSection[]): StructureChecks['pointHeads'] {
  const signatures = sections.filter(isBigPoint).map(headSignature)
  return { count: signatures.length, consistent: signatures.length < 2 ? null : new Set(signatures).size === 1, signatures }
}

/** 계획에 기록된 표 행 이름 — 디자인 컷 표(M9) 또는 K 슬롯 표(rows·special) */
function infoLabels(section: DesigncutSection): string[] | null {
  const ref = section.templateRef
  if (ref) {
    const list = (name: string) => (Array.isArray(ref.slots[name]) ? (ref.slots[name] as unknown[]) : [])
    const rows = [...list('rows'), ...list('special')]
    return ref.id.startsWith('spec_table.') && rows.length > 0 ? rows.map((row) => String((row as { label?: unknown } | null)?.label ?? '')) : null
  }
  if (section.key !== 'long:info') return null
  for (const mod of section.modules) if (mod.type === 'M9') return mod.data.rows.map((row) => row.label)
  return null
}

function checkInfoTable(job: PdpJobRow): StructureChecks['infoTable'] {
  const labels = (job.section_plan?.designcut?.sections ?? []).map(infoLabels).find((found) => found !== null)
  if (!labels) return null
  return { rows: labels.length, limit: INFO_ROWS_LIMIT, overLimit: labels.length > INFO_ROWS_LIMIT, unknownLabels: labels.filter((label) => !isListedInfoLabel(label)) }
}

/** 첫 화면 글의 양 — 보이는 글 상자만. 강조 표시가 든 글도 태그를 빼고 센다 */
function checkHookText(sections: readonly CanvasSection[]): StructureChecks['hookText'] {
  const first = sections[0]
  if (!first) return null
  const texts = first.elements
    .filter((el) => el.isVisible !== false && el.type === 'text')
    .map((el) => (el.textProps?.content ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ''))
    .filter(Boolean)
  return { blocks: texts.length, chars: texts.reduce((sum, t) => sum + t.length, 0) }
}

/** 디자인 컷 표(T9)가 그려진 순서대로 상품 정보 표인가 — 문서에는 계획 키가 없어 계획 순서로 맞춘다 */
function tableKinds(job: PdpJobRow): boolean[] {
  const plan = job.section_plan?.designcut
  if (!plan) return []
  const byKey = new Map(plan.sections.map((section) => [section.key, section]))
  const keys = plan.order?.length ? plan.order : plan.sections.map((section) => section.key)
  return keys.filter((key) => byKey.get(key)?.template === 'T9').map((key) => key === INFO_PLAN_KEY)
}

type TailKind = 'purchase' | 'size' | 'info'
const TAIL_ORDER: readonly TailKind[] = ['purchase', 'size', 'info']

function checkPageTail(job: PdpJobRow, sections: readonly CanvasSection[]): StructureChecks['pageTail'] {
  const tables = tableKinds(job)
  let tableIndex = 0
  const kinds = sections.map((section): TailKind | null => {
    const layout = section.layoutId ?? ''
    if (layout === TABLE_LAYOUT) return tables[tableIndex++] ? 'info' : null
    if (layout === SIZE_LAYOUT) return 'size'
    if (layout === PURCHASE_LAYOUT) return 'purchase'
    return layout.startsWith(K_INFO_LAYOUT) ? 'info' : null
  })
  const fromEnd = (kind: TailKind) => kinds.flatMap((k, i) => (k === kind ? [kinds.length - 1 - i] : [])).reverse()
  const [purchaseFromEnd, sizeFromEnd, infoFromEnd] = [fromEnd('purchase'), fromEnd('size'), fromEnd('info')]
  // 있어야 할 끝 — 페이지에 있는 것을 이 순서로 세운 값과 실제 끝이 같아야 한다. 다른 자리에 있으면 개수가 어긋나 걸린다
  const want = TAIL_ORDER.flatMap((kind) => kinds.filter((k) => k === kind))
  const judged = sizeFromEnd.length + infoFromEnd.length > 0
  const ok = judged ? kinds.slice(-want.length).join('|') === want.join('|') : null
  return { total: sections.length, purchaseFromEnd, sizeFromEnd, infoFromEnd, ok }
}

/** 단추 색 — 면 색, 테두리만 있는 단추는 테두리 색. 대소문자는 맞춘다 */
function badgeColor(el: CanvasElement): string {
  const props = el.shapeProps
  const fill = props?.fill && props.fill !== 'transparent' ? props.fill : (props?.stroke ?? '')
  return String(fill).toLowerCase()
}

function checkPointBadges(sections: readonly CanvasSection[]): StructureChecks['pointBadges'] {
  const colors = sections.filter(isBigPoint).flatMap((section) => {
    const badges = section.elements.filter((el) => el.isVisible !== false && POINT_BADGE.test(el.name ?? ''))
    const first = [...badges].sort((a, b) => a.transform.y - b.transform.y)[0]
    return first ? [badgeColor(first)] : []
  })
  return { count: colors.length, same: colors.length < 2 ? null : new Set(colors).size === 1, colors }
}

function checkPlan(job: PdpJobRow, sections: readonly CanvasSection[]): PlanMetrics | null {
  const plan = job.section_plan?.designcut
  return plan
    ? jobPlanMetrics(plan, sections, {
        templateOf: templateById,
        extraShots: job.section_plan?.extra_shots,
        lineShots: job.section_plan?.templatelib?.shots,
        stages: job.section_plan?.designcut_stages,
      })
    : null
}

export function checkStructure(job: PdpJobRow, sections: readonly CanvasSection[]): StructureChecks {
  return {
    pointHeads: checkPointHeads(sections),
    infoTable: checkInfoTable(job),
    hookText: checkHookText(sections),
    pageTail: checkPageTail(job, sections),
    pointBadges: checkPointBadges(sections),
    plan: checkPlan(job, sections),
  }
}
