/**
 * 디자인 컷 긴 페이지(designlong — 오너 지시 2026-10-31 '긴 버전의 디자인 상세페이지로 승부'). 원칙(통합 2026-10-31, R9 긴 페이지
 * 감점 분석): 긴 페이지는 사진이 아니라 정보를 늘린다 — 사실이 없으면 막을 만들지 않는다.
 * D2(designcut2)는 designlong이 없어도 상품 정보 표 하나(T9 — product-info-rows 정본: 상품명·브랜드·색상/수량·사이즈·소재·원산지·사용연령 + 허용 목록 추가 스펙 전부, 사실이
 * 있는 행만, 규제 표현 제외)와 구석구석 보면(T10) 막을 둔다(통합 배정 ③·④). 상품 정보 표가 소재·원산지와 크기·구성 표를 대신한다.
 * - T9 사실 표(사진 없음): 소재·원산지(디자인 컷 전용 — spec.material·origin) / 크기·구성 / 관리·보관 / 구매 전 질문. 뒤 셋은 Track I
 *   긴 페이지와 같은 함수(longTables)로 만든다 — 새 문구 없음, 규제 표현이 든 값과 페이지에 이미 보이는 값은 뺀다(앞 표에 실은 값도).
 *   최소 행 수(소재·원산지 1, 나머지 LONG_MIN_ROWS)에 못 미치면 그 표는 없다
 * - T10 자세히 보기: 계획이 사진을 스스로 늘리지 않는다. 이미지 쪽이 컷마다 보여 줄 목적을 정해 남긴 기록(section_plan.extra_shots —
 *   pdp-long-shot-diversity)의 컷을 기록 순서대로 싣고, 캡션은 그 기록의 caption(없으면 사진만)이다. 2장 미만이면 막이 없다.
 *   계획이 적은 키만 생성된다(designcutTaskFilter — 계획 ∩ 이미지 쪽 기록)
 * 자리: 소재·원산지와 크기·구성은 치수(T6) 뒤(없으면 옵션 T7 뒤), 관리·보관은 사용 단계(T5) 뒤, 자세히 보기는 사용 단계(없으면 마지막
 * POINT) 뒤, 구매 전 질문은 마무리(T8) 앞. 자리가 없으면 마무리 앞, 마무리도 없으면 끝. 같은 자리 뒤에는 넣은 순서대로 이어 붙인다
 */

import type { DesigncutSection, PdpJobRow, PdpSpecSheet } from '../pdp-state'
import { missingRows } from '../editor/utils/sectionConverter/purchaseCheck'
import { AGE_LABEL, productInfoRows } from '../product-info-rows'
import { claimSafeFactRows } from '../eval/claim-lexicon'
import { LONG_MIN_ROWS, LONG_SECTION_TITLE, longTables, readLongRecord } from '../long-sections'
import { inputSlotsOf } from '../input-slots-read'
import { INGREDIENT_MIN, namedIngredientsOf } from '../templatelib/input-values'
import type { NoticeKind, SizeMatrix } from '../input-slots'
import type { ExpansionKind } from '../editor/types/canvas'

type Piece = Omit<DesigncutSection, 'bg' | 'plateKey' | 'plateAspect'>
type LongKind = Exclude<ExpansionKind, 'scenes'> | 'material' | 'shots' | 'info' | 'notice' | 'ingredients' | 'matrix'

/** 긴 막 역할 — 렌더 v2 막 배정은 역할표에 없어 '확인' 막이 된다(layout2 actOf) */
export const LONG_ROLE = 'long_expansion'
/** 긴 막 키 — 'long:' + 종류. 구매 전 질문 표 키는 편집기 T9가 Q 표식 줄로 그린다(templatesLong) */
const longKey = (kind: LongKind) => `long:${kind}`
export const LONG_FAQ_KEY = longKey('faq')
/** D2 주의·보관 표 키(C1 입력 칸, D2 ②) — 편집기 T9가 '주의' 줄 이름 앞에 경고 표식을 단다(templatesLong) */
export const LONG_NOTICE_KEY = longKey('notice')
/** 주의·보관 표 줄 이름 — 입력 종류마다 고정 낱말(입력 글을 이름으로 쓰지 않는다) */
export const NOTICE_ROW_LABEL: Record<NoticeKind, string> = { caution: '주의', storage: '보관', care: '관리' }
/** D2 성분·원재료 표 키(C1 입력 칸, D2 ③) — 편집기 T9가 줄 이름 없이 재료 이름만 줄마다 그린다(templatesLong) */
export const LONG_INGREDIENTS_KEY = longKey('ingredients')
/** D2 사이즈 행렬 표 키(C1 입력 칸) — 편집기 T9가 값이 짧으면 격자, 아니면 사이즈마다 행 블록으로 그린다(templatesLong) */
export const LONG_MATRIX_KEY = longKey('matrix')
const LABEL: Record<LongKind, string> = {
  material: 'MATERIAL',
  size: 'SIZE',
  care: 'CARE',
  faq: 'Q&A',
  // AI가 만든 컷에도 붙는다 — 실제 촬영을 주장하는 말을 쓰지 않는다(2026-11-02, P05 D 심사 r10)
  shots: 'MORE VIEWS',
  info: 'INFO',
  notice: 'NOTICE',
  ingredients: 'INGREDIENTS',
  matrix: 'SIZE',
}
// 구석구석 보면(T10) — '자세히 보기'는 D2 특징 묶음(T11) 이름이다
const TITLE: Record<LongKind, string> = {
  material: '소재·원산지',
  size: LONG_SECTION_TITLE.size,
  care: LONG_SECTION_TITLE.care,
  faq: LONG_SECTION_TITLE.faq,
  shots: '구석구석 보면',
  info: '상품 정보',
  notice: '주의·보관',
  ingredients: '원재료',
  matrix: '사이즈표',
}
const SHOTS_MIN = 2
/** 성분·원재료 표 이름 상한 — K 성분 섹션 이름 칸 상한(ingredients 템플릿 names max)과 같다. 넘으면 일부만 싣지 않고 짓지 않는다 */
const INGREDIENTS_MAX = 8
/** 성분 계열 입력 칸(추가 스펙 키, 공백 뺌) — 이름이 이 칸에서만 나오면 표 제목이 '성분', 아니면 '원재료'(AI 안 씀) */
const COMPONENT_KEYS: ReadonlySet<string> = new Set(['성분', '주성분', '주요성분'])
/** 상품 정보 표 최소 행 — 상품명 밖 사실 2개 이상 */
const INFO_MIN_ROWS = 3
/** 이미지 쪽 기록의 컷 키(근접·밑면·크기 비교는 피처 매크로 자리, 사용 장면은 long_scene)와 목적 */
const SHOT_KEY = /^(features|long_scene):\d+$/
const SHOT_PURPOSES = new Set(['underside', 'scale', 'scene', 'texture', 'angle'])
/** D2 추가 컷 하나 = 섹션 하나(오너 지시 2026-11-01 — 섹션 20개 내외). 한 막에 쌓지 않고 이 템플릿들 뒤에 돌아가며 놓는다 */
const SHOT_ANCHOR_TEMPLATES = new Set(['T3a', 'T11', 'T12', 'T4', 'T5', 'T6', 'T7'])

/** designcut과 designlong이 함께 기록된 잡 */
export function designlongEnabled(job: PdpJobRow): boolean {
  const features = job.section_plan.enrichment?.features ?? []
  return features.includes('designcut') && features.includes('designlong')
}

/** 페이지에 이미 보이는 글 — 계획 조각의 머리·서브·모듈 글(표 값이 같은 말을 되풀이하지 않게) */
export function pieceTexts(pieces: readonly Piece[]): string[] {
  const out: string[] = []
  for (const p of pieces) {
    out.push(...[p.text.eyebrow, p.text.headline, p.text.sub].filter((t): t is string => Boolean(t)))
    for (const m of p.modules) {
      if (m.type === 'M2a') out.push(...m.data.lines)
      if (m.type === 'M1') out.push(...m.data.items)
      if (m.type === 'M7') out.push(...m.data.steps.flatMap((s) => [s.title, s.description ?? '']))
      if (m.type === 'M8') out.push(...m.data.chips.map((c) => c.label))
      if (m.type === 'M4') out.push(m.data.raw)
    }
  }
  return out.filter(Boolean)
}

/**
 * section_plan.extra_shots 읽기(이미지 쪽 기록 — 타입은 그쪽 정본, 여기서는 형식만 본다). 키는 features:N·long_scene:i, 목적은 넷만,
 * 같은 키는 한 번. 형식이 틀린 항목은 버린다
 */
export function readExtraShots(raw: unknown): Array<{ imageKey: string; caption: string }> {
  const r = raw as { version?: unknown; shots?: unknown } | null | undefined
  if (!r || r.version !== 1 || !Array.isArray(r.shots)) return []
  const seen = new Set<string>()
  const out: Array<{ imageKey: string; caption: string }> = []
  for (const s of r.shots as Array<Record<string, unknown> | null>) {
    const key = typeof s?.key === 'string' ? s.key : ''
    if (!SHOT_KEY.test(key) || !SHOT_PURPOSES.has(String(s?.purpose)) || seen.has(key)) continue
    seen.add(key)
    out.push({ imageKey: key, caption: typeof s?.caption === 'string' ? s.caption.trim() : '' })
  }
  return out
}

/** fillacts 사진 막 읽기 — 없거나 형식이 틀리면 null(지금 채움 그대로) */
export function readFillActs(raw: unknown): Array<{ title: string; keys: string[] }> | null {
  const acts = (raw as { acts?: unknown } | null | undefined)?.acts
  if (!Array.isArray(acts) || acts.length === 0) return null
  const out = (acts as Array<Record<string, unknown> | null>).map((a) => ({
    title: typeof a?.title === 'string' ? a.title.trim() : '',
    keys: Array.isArray(a?.keys) ? a.keys.filter((k): k is string => typeof k === 'string' && SHOT_KEY.test(k)) : [],
  }))
  return out.every((a) => a.title && a.keys.length > 0) ? out : null
}

/** fillacts 큰 POINT 사진 — POINT 번호 → 컷 키 */
export function readPointPhotos(raw: unknown): Map<number, string> {
  const shots = (raw as { shots?: unknown } | null | undefined)?.shots
  const out = new Map<number, string>()
  if (!Array.isArray(shots)) return out
  for (const s of shots as Array<Record<string, unknown> | null>) {
    if (typeof s?.point === 'number' && typeof s.key === 'string' && SHOT_KEY.test(s.key)) out.set(s.point, s.key)
  }
  return out
}

const piece = (kind: LongKind, template: 'T9' | 'T10', modules: Piece['modules']): Piece => ({
  key: longKey(kind),
  role: LONG_ROLE,
  template,
  chapter: null,
  productImageKey: null,
  productAlpha: false,
  text: { eyebrow: LABEL[kind], headline: TITLE[kind], sub: null },
  modules,
})
/** D2 추가 컷 섹션 — 캡션이 제목이고 사진 아래 글은 없다. 키가 'long:shot:'으로 시작하면 편집기가 한 장으로도 그린다 */
const shotPiece = (shot: { imageKey: string; caption: string }, i: number): Piece => ({
  ...piece('shots', 'T10', [{ type: 'M10', data: { scenes: [{ imageKey: shot.imageKey, caption: '' }] } }]),
  key: `long:shot:${i}`,
  text: { eyebrow: LABEL.shots, headline: shot.caption || TITLE.shots, sub: null },
})
/** fillacts 사진 막 — 막 제목 한 줄과 사진들. 사진 아래 캡션은 없다 */
const actPiece = (act: { title: string; keys: string[] }, i: number): Piece => ({
  ...piece('shots', 'T10', [{ type: 'M10', data: { scenes: act.keys.map((imageKey) => ({ imageKey, caption: '' })) } }]),
  key: `long:shot:${i}`,
  text: { eyebrow: LABEL.shots, headline: act.title, sub: null },
})
const tablePiece = (kind: LongKind, rows: ReadonlyArray<{ label: string; value: string }>) =>
  piece(kind, 'T9', [{ type: 'M9', data: { rows: rows.map((r) => ({ label: r.label, value: r.value })) } }])

/** 소재·원산지 행 — 입력 값 그대로, 규제 표현이 든 값과 이미 보이는 값은 뺀다 */
function materialRows(job: PdpJobRow, shown: readonly string[]): Array<{ label: string; value: string }> {
  const rows = claimSafeFactRows(
    [
      { label: '소재', value: job.spec_sheet.material?.trim() ?? '' },
      { label: '원산지', value: job.spec_sheet.origin?.trim() ?? '' },
    ].filter((r) => r.value),
    job.spec_sheet.certificationInfo
  )
  return missingRows(
    rows.map((r) => ({ ...r, items: [r.value] })),
    shown
  ).map(({ label, value }) => ({ label, value }))
}

/**
 * D2 상품 정보 표 행 — 정본은 product-info-rows(오너 지시 11-01)
 */
export function infoRows(spec: PdpSpecSheet): Array<{ label: string; value: string }> {
  return productInfoRows(spec)
}

/** 사이즈 행렬 표 행 — 사이즈마다 '치수 값 · 치수 값'(행 블록 그리기와 글 읽기에 쓴다). 격자는 M9 matrix로 그린다 */
export function matrixRows(matrix: SizeMatrix): Array<{ label: string; value: string }> {
  return matrix.rows.map((row) => ({ label: row.label, value: matrix.columns.map((column, i) => `${column} ${row.values[i]}`).join(' · ') }))
}

/**
 * 성분·원재료 표 제목 — 재료 이름이 성분 계열 칸(성분·주성분·주요성분)에서만 나오면 '성분', 원재료 계열 칸이 섞이거나 그쪽뿐이면 '원재료'
 */
export function ingredientTitleOf(spec: Pick<PdpSpecSheet, 'extraSpecs'>): string {
  const rows = Array.isArray(spec.extraSpecs) ? spec.extraSpecs : []
  const isComponent = (key: unknown) => typeof key === 'string' && COMPONENT_KEYS.has(key.replace(/\s+/g, ''))
  const component = namedIngredientsOf({ extraSpecs: rows.filter((r) => isComponent(r?.key)) })
  const other = namedIngredientsOf({ extraSpecs: rows.filter((r) => !isComponent(r?.key)) })
  return component.length > 0 && other.length === 0 ? '성분' : TITLE.ingredients
}

/**
 * 긴 막을 지어 pieces·pageOrder 제자리에 끼운다(제자리 변경). 지은 막 키를 돌려준다. 사실 표(관리·보관·질문)는 designlong 기록 잡만,
 * D2는 소재·원산지·크기·구성 표 대신 상품 정보 표 하나다
 */
export function insertLongPieces(job: PdpJobRow, pieces: Piece[], pageOrder: string[], opts: { d2?: boolean } = {}): string[] {
  const record = designlongEnabled(job) ? readLongRecord(job.section_plan.long) : null
  const shown = pieceTexts(pieces)
  const built: Array<{ kind: LongKind; piece: Piece; anchor?: string }> = []
  const shotAnchors = pieces.filter((p) => SHOT_ANCHOR_TEMPLATES.has(p.template)).map((p) => p.key)
  const info = opts.d2 ? infoRows(job.spec_sheet) : []
  // 사용연령은 고정 표기라 사실 수에 넣지 않는다 — 사실이 모자라는 상품에 표를 만들지 않게
  if (info.filter((r) => r.label !== AGE_LABEL).length >= INFO_MIN_ROWS) {
    built.push({ kind: 'info', piece: tablePiece('info', info) })
    shown.push(...info.map((r) => r.value))
  }
  const material = opts.d2 ? [] : materialRows(job, shown)
  if (material.length > 0) {
    built.push({ kind: 'material', piece: tablePiece('material', material) })
    shown.push(...material.map((r) => r.value))
  }
  // D2 ③ 성분·원재료(R-W8): 입력에 적힌 재료 이름 그대로(C1 inputSlotsOf.ingredients — 규제 표현 거름) 2~8개일 때만. 8개를 넘으면
  // 일부만 실어 그게 전부처럼 읽히지 않게 짓지 않는다(K #631과 같다). 상품 정보 표는 원재료를 싣지 않아 겹치지 않는다.
  // 자리는 사용법 뒤 — 관리·주의 표(아래)보다 먼저 지어 같은 자리 뒤 첫째가 된다
  const ingredients = opts.d2 ? inputSlotsOf(job.spec_sheet).ingredients : []
  if (ingredients.length >= INGREDIENT_MIN && ingredients.length <= INGREDIENTS_MAX) {
    const title = ingredientTitleOf(job.spec_sheet)
    const table = tablePiece('ingredients', ingredients.map((name) => ({ label: title, value: name })))
    built.push({ kind: 'ingredients', piece: { ...table, text: { ...table.text, headline: title } } })
  }
  if (record) {
    const objections = (job.section_plan.internalized_skeleton?.persuasion?.objectionCoverage ?? []).map((o) => ({
      objection: o.objection,
      ...(o.type ? { type: o.type } : {}),
    }))
    const kinds = opts.d2 ? record.kinds.filter((k) => k !== 'size') : record.kinds
    for (const { kind, rows } of longTables(kinds, job.spec_sheet, objections, shown, true, record.reviewFaq ?? []))
      built.push({ kind: kind as LongKind, piece: tablePiece(kind as LongKind, rows) })
  }
  // D2 ② 주의·보관(T1-39): 입력한 주의·보관 줄 다음 추가 스펙 관리 행(C1 inputSlotsOf.notices — 같은 글 한 번, 규제 표현 거름)이 있을 때만.
  // designlong 기록이 관리 표를 이미 지었으면 짓지 않는다(같은 행이 두 번 나오지 않게). 자리는 관리 표와 같다(사용법 뒤)
  if (opts.d2 && !built.some((b) => b.kind === 'care')) {
    // 상품 정보 표가 이미 실은 관리·보관 행(세탁·관리방법·보관방법)은 빼고 — designlong 관리 표와 같은 shown 규칙
    const notices = inputSlotsOf(job.spec_sheet)
      .notices.filter((n) => !shown.includes(n.text))
      .map((n) => ({ label: NOTICE_ROW_LABEL[n.kind], value: n.text }))
    if (notices.length >= LONG_MIN_ROWS.care) built.push({ kind: 'notice', piece: tablePiece('notice', notices) })
  }
  // D2 사이즈 행렬(T1-65·T2-30·T2-31): C1 입력 행렬(머리·사이즈·값 — 규제 표현이 든 행렬은 통째로 빠짐)이 있을 때만. 자리는 사이즈(T6) 바로 앞
  const matrix = opts.d2 ? inputSlotsOf(job.spec_sheet).sizeMatrix : null
  if (matrix) built.push({ kind: 'matrix', piece: piece('matrix', 'T9', [{ type: 'M9', data: { rows: matrixRows(matrix), matrix } }]) })
  const extraShots = (job.section_plan as { extra_shots?: unknown }).extra_shots
  const shots = readExtraShots(extraShots)
  const acts = opts.d2 ? readFillActs(extraShots) : null
  const lastOf = (t: string) => pieces.filter((p) => p.template === t).at(-1)?.key
  if (acts) {
    // 자리: 첫 막은 자세히 보기 뒤, 둘째 막은 상품 정보 표 뒤. POINT 사이에 끼지 않는다(재분석 3절)
    const afterDetail = lastOf('T11') ?? lastOf('T3a')
    const afterTable = built.some((b) => b.kind === 'info') ? 'long:info' : (lastOf('T6') ?? lastOf('T7') ?? lastOf('T5') ?? afterDetail)
    acts.forEach((act, i) => built.push({ kind: 'shots', piece: actPiece(act, i), anchor: i === 0 ? afterDetail : afterTable }))
  } else if (shots.length >= SHOTS_MIN && opts.d2) {
    shots.forEach((shot, i) => built.push({ kind: 'shots', piece: shotPiece(shot, i), anchor: shotAnchors[i % Math.max(1, shotAnchors.length)] }))
  } else if (shots.length >= SHOTS_MIN) {
    built.push({ kind: 'shots', piece: piece('shots', 'T10', [{ type: 'M10', data: { scenes: shots } }]) })
  }

  const byTemplate = (t: string) => pieces.filter((p) => p.template === t).at(-1)?.key ?? null
  const anchorOf = (kind: LongKind): string | null => {
    if (kind === 'material' || kind === 'size' || kind === 'info') return byTemplate('T6') ?? byTemplate('T7')
    if (kind === 'care' || kind === 'notice' || kind === 'ingredients') return byTemplate('T5')
    if (kind === 'shots') return byTemplate('T5') ?? byTemplate('T3a')
    return null
  }
  const insertAt = (index: number, orderIndex: number, p: Piece) => {
    pieces.splice(index, 0, p)
    pageOrder.splice(orderIndex, 0, p.key)
  }
  const lastAfter = new Map<string, string>()
  // 사이즈 행렬은 사이즈(첫 T6) 바로 앞 — 사이즈가 없으면 상품 정보 표 앞. 끝 두 자리(사이즈 → 상품 정보)는 그대로다
  const factsStart = () => pieces.find((x) => x.template === 'T6')?.key ?? pieces.find((x) => x.key === longKey('info'))?.key ?? null
  for (const { kind, piece: p, anchor: fixed } of built) {
    const before = kind === 'matrix' ? factsStart() : null
    if (before) {
      insertAt(pieces.findIndex((x) => x.key === before), pageOrder.indexOf(before), p)
      continue
    }
    const anchor = fixed ?? anchorOf(kind)
    if (anchor) {
      const after = lastAfter.get(anchor) ?? anchor
      insertAt(pieces.findIndex((x) => x.key === after) + 1, pageOrder.indexOf(after) + 1, p)
      lastAfter.set(anchor, p.key)
      continue
    }
    const cta = pieces.find((x) => x.template === 'T8')
    if (cta) insertAt(pieces.indexOf(cta), pageOrder.indexOf(cta.key), p)
    else insertAt(pieces.length, pageOrder.length, p)
  }
  return built.map((b) => b.piece.key)
}
