/**
 * K 라인 템플릿 목업 — 렌더 없이 브라우저에서 바로 열리는 정적 HTML 한 장(15_TEMPLATE_LINE §9). 통합이 아티팩트로 게시한다.
 * 그리기는 편집기 내보내기와 같은 exportRenderHtml을 쓴다. 글자는 '자리' 안내문이고 사진은 구도를 적은 자리표시라 카피·사진이 아니다.
 * 글꼴 짝은 입히지 않는다(자체 보관 글꼴은 앱 밖에서 읽히지 않는다) — 모양을 보는 용도이고, 줄바꿈은 실제와 조금 다를 수 있다. 순수·결정론.
 */

import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { exportRenderHtml } from '@/lib/registration/editor/utils/exportUtils/htmlBuilders'
import { colorSetsOf } from './color-sets'
import { conceptById } from './concepts'
import { renderTemplate, type TemplateContext } from './engine'
import { ICON_NAMES } from './icons'
import { TEMPLATES } from './library'
import { SAMPLE_HEX, sampleContext } from './sample'
import { SECTION_TABLE, type FlowNode, type ImageSlot, type SlotDef, type SlotItem, type SlotValues, type Template, type TextSlot } from './template-types'

const CANVAS_W = 860
/** 폰 폭 390에서 좌우 여백 16을 뺀 칸에 맞춘 배율 */
const FRAME_W = 358
const SCALE = FRAME_W / CANVAS_W

const SLOT_LABELS: Record<string, string> = {
  headline: '제목',
  sub: '설명',
  caption: '사진 설명',
  line: '한 문장',
  title: '항목 제목',
  desc: '항목 설명',
  item: '비교 항목',
  quote: '후기 원문',
  top: '대표 후기',
  note: '메모',
  pain: '고민',
  from: '바꾸기 전',
  to: '바꾼 뒤',
}
const COMPOSITION_LABELS: Record<string, string> = {
  front: '정면',
  side: '측면',
  top: '위에서',
  angle45: '45도',
  in_hand: '손에 든 컷',
  in_use: '사용 컷',
  closeup: '가까이',
  flatlay: '늘어놓은 컷',
  group: '여러 개',
  worn: '착용 컷',
}
/** 상품 정보 표 필수 7행(이 순서) — 실제 값은 B의 공용 함수가 채운다 */
const SPEC_ROW_NAMES = ['상품명', '브랜드', '색상/수량', '사이즈', '소재', '원산지', '사용연령']
const INPUT_TEXT: Record<string, string> = {
  chapter: '2',
  'spec.quantity': '20개',
  'review.rating': '4.8',
  'review.stars': '5',
  'review.count': '후기 128건',
  'sales.total': '35,600개',
  'sales.basis': '2026.02~2026.08 쿠팡 누적 판매',
  'offer.info': '입력한 혜택이 들어가는 자리',
  'certification.name': '입력한 인증 이름',
  'ingredient.name': '입력한 재료 이름',
  'notice.kind': '주의',
  'notice.text': '입력한 주의·보관 글',
  'notice.icon': 'storage',
  'review.name': '김*',
  'spec.size.width': '가로 12cm',
  'spec.size.height': '높이 20cm',
  'option.name': '베이지',
  'badge.rating': '4.8',
  'badge.quantity': '20개',
  'badge.certification': '인증이름',
}
const INPUT_LISTS: Record<string, string[]> = {
  'option.names': ['베이지', '네이비', '올리브'],
  'review.keywords': ['가벼워요', '튼튼해요', '선물용'],
  'ingredient.names': ['재료 이름', '재료 이름', '재료 이름'],
}
const FILL_RATIO = 0.8

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 글자 수 상한의 80%까지 채운 안내문 — 띄어쓰기 단위로 자른다 */
function placeholderText(slot: string, maxChars: number): string {
  const label = SLOT_LABELS[slot] ?? '문구'
  const words = `${label} 자리 여기에 들어갑니다 ${label} 자리 여기에 들어갑니다 ${label} 자리 여기에 들어갑니다 ${label} 자리 여기에 들어갑니다`.split(' ')
  const limit = Math.max(2, Math.round(maxChars * FILL_RATIO))
  const out: string[] = []
  let used = 0
  for (const word of words) {
    if (used + word.length > limit) break
    out.push(word)
    used += word.length
  }
  return out.length > 0 ? out.join(' ') : label.slice(0, limit)
}

/** 흐름에서 표시·별점 슬롯을 찾는다 — 값 형식이 다르다 */
function markSlots(nodes: readonly FlowNode[], marks = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind === 'mark' && node.slot) marks.add(node.slot)
    if (node.kind === 'panel' || node.kind === 'repeat') markSlots(node.nodes, marks)
    if (node.kind === 'row') for (const column of node.columns) markSlots(column.nodes, marks)
  }
  return marks
}

function textValue(name: string, def: TextSlot, marks: Set<string>, index: number): string {
  if (def.choices === 'icon') return ICON_NAMES[index % ICON_NAMES.length]
  if (def.choices === 'hex') return SAMPLE_HEX[index % SAMPLE_HEX.length]
  if (marks.has(name)) return (name === 'other') === (index % 2 === 0) ? 'dash' : 'check'
  if (def.input === 'spec.rows.label' || def.input === 'spec.special.label') return SPEC_ROW_NAMES[index % SPEC_ROW_NAMES.length]
  if (def.input === 'spec.rows.value' || def.input === 'spec.special.value') return '입력값이 들어가는 자리'
  if (def.input && INPUT_TEXT[def.input]) return INPUT_TEXT[def.input]
  return placeholderText(name, def.maxChars)
}

const imageKey = (def: ImageSlot) => `mock|${def.composition[0] ?? 'front'}|${def.aspect[0] ?? '3:4'}`

/** 목업용 슬롯 값 — 모든 슬롯을 채운다. 목록은 max와 3 중 작은 수 */
export function mockSlots(t: Pick<Template, 'flow' | 'slots'>): SlotValues {
  const marks = markSlots(t.flow)
  const values: SlotValues = {}
  for (const [name, def] of Object.entries(t.slots) as Array<[string, SlotDef]>) {
    if (def.type === 'image') values[name] = imageKey(def)
    else if (def.type === 'text') values[name] = textValue(name, def, marks, 0)
    else if (Object.keys(def.fields).length === 0) values[name] = INPUT_LISTS[def.input ?? ''] ?? ['이름표', '이름표', '이름표']
    else {
      const count = name === 'rows' ? def.max : Math.max(def.min, Math.min(def.max, 3))
      values[name] = Array.from({ length: count }, (_, i): SlotItem => {
        const item: SlotItem = {}
        for (const [field, fieldDef] of Object.entries(def.fields)) {
          item[field] = fieldDef.type === 'image' ? imageKey(fieldDef) : textValue(field, fieldDef, marks, i)
        }
        return item
      })
    }
  }
  return values
}

const svgOf = (key: string, bg: string, ink: string) => {
  const [, composition, aspect] = key.split('|')
  const [w, h] = (aspect ?? '3:4').split(':').map(Number)
  const vw = 600
  const vh = Math.round((vw * h) / w)
  const label = COMPOSITION_LABELS[composition] ?? composition
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}"><rect width="${vw}" height="${vh}" fill="${bg}"/><rect x="24" y="24" width="${vw - 48}" height="${vh - 48}" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="3" stroke-dasharray="14 10"/><text x="${vw / 2}" y="${vh / 2}" font-family="sans-serif" font-size="44" font-weight="700" fill="${ink}" fill-opacity=".6" text-anchor="middle" dominant-baseline="middle">${escapeHtml(label)}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** 템플릿이 고른 첫 컨셉의 첫 색 조합 — 없으면 중립 색 */
function contextFor(t: Template): TemplateContext {
  const concept = conceptById(t.fit.concepts[0])
  const set = concept ? colorSetsOf(concept).sets[0] : undefined
  const base = sampleContext(set ? { colors: set.colors } : {})
  return {
    ...base,
    bg: t.surfaces[0],
    usp: ['제목'],
    image: (key) => (key ? svgOf(key, base.colors.photo, base.colors.ink) : null),
  }
}

/** 템플릿 하나의 섹션 HTML(860 폭). 그리지 못하면 null */
export function templateBodyHtml(t: Template): string | null {
  const out = renderTemplate(t, mockSlots(t), contextFor(t))
  if (!out) return null
  const section = {
    id: t.id,
    sectionType: SECTION_TABLE[t.section].proType,
    groupType: 'modules',
    order: 0,
    isVisible: true,
    layoutId: `designcut_k_${t.id}`,
    canvas: { width: CANVAS_W, height: out.height, backgroundColor: out.background },
    elements: out.elements,
  } as unknown as CanvasSection
  const html = exportRenderHtml([section], {})
  const start = html.indexOf('<body>') + '<body>'.length
  return html.slice(start, html.indexOf('</body>')).trim()
}

const SIGNATURE_LABELS: Record<string, string> = {
  none: '없음',
  'bleed-top': '풀폭 위',
  'bleed-bottom': '풀폭 아래',
  inset: '본문 폭',
  offset: '비킴',
  side: '옆',
  pair: '2장',
  grid: '격자',
  left: '왼쪽',
  center: '가운데',
  plate: '판',
  card: '상자',
  band: '띠',
  table: '표',
  tile: '타일',
  bubble: '말풍선',
}

function card(t: Template): string {
  const body = templateBodyHtml(t)
  const s = t.signature
  const sig = `${s.columns}열 · 사진 ${SIGNATURE_LABELS[s.photo]} · ${SIGNATURE_LABELS[s.align]} · 용기 ${SIGNATURE_LABELS[s.container]}`
  const shown = body
    ? `<div class="frame" style="height:${Math.ceil(t.estimatedHeight.max * SCALE)}px"><div class="canvas">${body}</div></div>`
    : '<p class="fail">그리지 못했습니다</p>'
  return `<article class="card" id="${escapeHtml(t.id)}">
  <header>
    <h3>${escapeHtml(t.name)}</h3>
    <p class="id">${escapeHtml(t.id)}</p>
    <dl>
      <div><dt>모양</dt><dd>${escapeHtml(sig)}</dd></div>
      <div><dt>사실</dt><dd>${t.needs.facts.min}~${t.needs.facts.max}개</dd></div>
      <div><dt>사진</dt><dd>필수 ${t.needs.photos}장</dd></div>
      <div><dt>높이</dt><dd>${t.estimatedHeight.min.toLocaleString('en-US')}~${t.estimatedHeight.max.toLocaleString('en-US')}px</dd></div>
      <div><dt>근거</dt><dd>${t.needs.evidence.length ? escapeHtml(t.needs.evidence.join(', ')) : '없음'}</dd></div>
    </dl>
  </header>
  ${shown}
</article>`
}

const PAGE_CSS = `
:root{--bg:#f6f6f4;--surface:#fff;--ink:#1c1c1a;--muted:#6b6b66;--line:#e2e2dd;--accent:#2f5fd0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17171a;--surface:#222226;--ink:#ececea;--muted:#a3a3a0;--line:#37373c;--accent:#8fb0ff}}
:root[data-theme="dark"]{--bg:#17171a;--surface:#222226;--ink:#ececea;--muted:#a3a3a0;--line:#37373c;--accent:#8fb0ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Pretendard,"Noto Sans KR",system-ui,sans-serif;line-height:1.6}
main{max-width:1240px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 8px}
.lede{color:var(--muted);margin:0 0 24px;max-width:70ch}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 32px}
nav a{padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;font-size:14px;background:var(--surface)}
h2{font-size:22px;margin:40px 0 16px;scroll-margin-top:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${FRAME_W}px,1fr));gap:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;max-width:${FRAME_W + 2}px;min-width:0}
.card header{padding:14px 16px;border-bottom:1px solid var(--line)}
.card h3{font-size:16px;margin:0}
.id{font:12px ui-monospace,Menlo,Consolas,monospace;color:var(--muted);margin:2px 0 8px;overflow-wrap:anywhere}
dl{margin:0;font-size:13px}
dl div{display:flex;gap:8px}
dt{color:var(--muted);flex:0 0 32px}
dd{margin:0}
.frame{position:relative;width:${FRAME_W}px;overflow:hidden;background:#fff}
.canvas{width:${CANVAS_W}px;transform:scale(${SCALE});transform-origin:top left;position:absolute;top:0;left:0}
.fail{padding:16px;color:#b3261e}
`

export interface MockOptions {
  title?: string
}

/** 목업 페이지 한 장 — 섹션별로 묶어 모든 템플릿을 그린다 */
export function buildMockHtml(templates: readonly Template[] = TEMPLATES, options: MockOptions = {}): string {
  const sections = [...new Set(templates.map((t) => t.section))]
  const nav = sections.map((s) => `<a href="#${s}">${s} ${templates.filter((t) => t.section === s).length}</a>`).join('')
  const groups = sections
    .map((s) => `<h2 id="${s}">${s}</h2>\n<div class="grid">\n${templates.filter((t) => t.section === s).map(card).join('\n')}\n</div>`)
    .join('\n')
  const title = options.title ?? 'K 템플릿 목업'
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="lede">템플릿 ${templates.length}개. 글자는 자리 안내문이고 사진은 구도를 적은 자리표시입니다. 색은 템플릿이 고른 첫 컨셉의 첫 색 조합입니다. 글꼴 짝은 입히지 않아 줄바꿈이 실제와 조금 다를 수 있습니다.</p>
<nav>${nav}</nav>
${groups}
</main>
</body>
</html>
`
}
