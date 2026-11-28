/**
 * 사진 없는 옵션 디자인 가드(R2-1, 2026-10-28) — 카드 축(디자인·색상) 값을 실물 사진이 있는 값과 없는 값으로 나누고,
 * AI 컷이 사진 없는 옵션을 지어내지 않게 한다(R1 P02: 체리를 색만 바꾼 데이지로 그림 — 디자인 프롬프트 LLM이 USP 후보
 * "데이지/체리 컬러로 …"를 보고 두 옵션을 나란히 놓는 장면을 썼다).
 * - 원천: 디자인 프롬프트 LLM 입력에서 사진 없는 옵션 이름을 지우고(stripOptionMentions) 규칙 블록을 붙인다
 *   (optionPhotoDesignBlock, pdp-design-agent.ts). 블록도 사진 없는 옵션 이름을 쓰지 않는다 — 모르면 쓰지 못한다.
 * - 예비: 제품 컷 프롬프트에서 같은 이름을 지우고 긍정문을 먼저 쓴 규칙을 붙인다(optionPhotoGuard, pdp-image-tasks.ts).
 *   이미지 모델은 부정문 속 단어를 끌어오기도 해서 규칙에도 사진 없는 옵션 이름을 넣지 않는다.
 * 옵션 섹션은 사진 없는 값을 이름 칩으로만 보여 준다(optionGallery.ts). 옵션 기록이 없는 잡(Track S·대조군)은 무관하다.
 * - 디자인×색상 교차 상품은 두 축을 다 본다(R3 ⑥ — 디자인 축만 보면 사진 없는 색을 놓쳤다). 값마다 사진은 있어도 조합에
 *   사진이 없으면("체크 화이트") 그 조합도 가드 대상이다.
 * - 생성 참조도 실물 사진이 있는 옵션의 사진만 쓴다(guardedReferences, pdp-image-stage.ts — R3 ①).
 * - 축이 셋 이상이라 파서가 라벨을 한 축으로 접은 기록도 라벨을 다시 분류해 디자인·색상 축으로 본다(guardView — R4).
 * - 영어 옵션 값은 옵션 값 자리에서만 지운다(stripAsciiOptions — R4, "white backdrop" 같은 일반 낱말 보존).
 */
import { sanitizeImageUrl } from '../editor/utils/sectionConverter/helpers'
import {
  classifyOptionLabel,
  OPTION_AXIS_KINDS,
  OPTION_AXIS_NAMES,
  type OptionAxis,
  type OptionSpec,
  type OptionVariant,
} from './option-spec'

/** 실물 사진인가 — 편집기 옵션 섹션과 같은 기준(공개 http(s) URL이고 생성 실패·자리표시 URL이 아님, convert.ts·optionGallery.ts) */
export function isRealOptionPhoto(url: string | undefined): boolean {
  const value = url?.trim() ?? ''
  return /^https?:\/\//.test(value) && sanitizeImageUrl(value) !== ''
}

type CardAxisKind = 'design' | 'color'

export interface OptionAxisPhotoCoverage {
  kind: CardAxisKind
  axisName: string
  /** 실물 사진이 있는 값(축 값 순서) */
  photographed: string[]
  /** 실물 사진이 없는 값 */
  unphotographed: string[]
}

export interface OptionPhotoCoverage {
  /** 사진 없는 값이 있는 카드 축(디자인 → 색상). 조합만 빠진 교차 상품은 비어 있을 수 있다 */
  axes: OptionAxisPhotoCoverage[]
  /** 모든 축의 사진 없는 값 — 장면 재료·컷 프롬프트에서 지울 이름 */
  unphotographed: string[]
  /** 디자인×색상 교차일 때 조합("데이지 블랙") — 사진이 있는 조합과, 값마다 사진은 있지만 조합엔 사진이 없는 것. 교차가 아니면 빈 목록 */
  combos: { photographed: string[]; unphotographed: string[] }
}

type CardAxis = OptionAxis & { kind: CardAxisKind }
const isCardAxis = (axis: OptionAxis): axis is CardAxis => axis.kind === 'design' || axis.kind === 'color'

/**
 * 가드가 보는 카드 축과 옵션(R4 ①) — 파서는 변하는 축이 셋 이상이면(too_many_axes) 라벨 통째를 한 디자인 축으로 접는다(편집기
 * 옵션 섹션은 그 모양 그대로 둔다). 그러면 사진 없는 색·디자인 이름이 라벨 속에 묻혀 장면 재료에서 지울 수 없으므로, 가드는 라벨을
 * 다시 분류해 디자인·색상 축을 되살린다. 모든 라벨이 변하는 축 값을 다 가질 때만 — 축이 빠진 라벨 때문에 접힌 기록
 * (inconsistent_axis)은 어느 값이 무엇인지 모르므로 라벨 단위 그대로 본다.
 */
function guardView(spec: OptionSpec): { axes: CardAxis[]; variants: OptionVariant[] } {
  const folded =
    spec.axes.length === 1 && spec.axes[0].kind === 'design' && spec.variants.every((v) => v.values.design === v.label)
  if (folded) {
    const variants = spec.variants.map((v) => ({ ...v, values: classifyOptionLabel(v.label) }))
    const varying = OPTION_AXIS_KINDS.filter((kind) => new Set(variants.map((v) => v.values[kind] ?? '')).size > 1)
    const complete = variants.every((v) => varying.every((kind) => v.values[kind] !== undefined))
    if (varying.length > 2 && complete) {
      const axes = varying
        .map((kind) => ({
          kind,
          name: OPTION_AXIS_NAMES[kind],
          values: [...new Set(variants.map((v) => v.values[kind]!))].sort((a, b) =>
            a.localeCompare(b, 'ko', { numeric: true })
          ),
        }))
        .filter(isCardAxis)
      return { axes, variants }
    }
  }
  return { axes: spec.axes.filter(isCardAxis), variants: spec.variants }
}

/**
 * 카드 축(디자인·색상)에 사진 없는 값이나 사진 없는 조합이 하나라도 있으면 그 구분, 아니면 null(사이즈·수량 축은 생김새가 같다).
 * 값·조합의 사진 판정은 그 값(조합)을 가진 옵션 중 하나라도 실물 사진이 있는가다.
 */
export function optionPhotoCoverage(spec: OptionSpec | null): OptionPhotoCoverage | null {
  if (!spec) return null
  const { axes: cardAxes, variants } = guardView(spec)
  if (cardAxes.length === 0) return null
  const shot = variants.filter((v) => isRealOptionPhoto(v.sourceImage))
  const axes = cardAxes
    .map((axis) => {
      const has = (value: string) => shot.some((v) => v.values[axis.kind] === value)
      return {
        kind: axis.kind,
        axisName: axis.name,
        photographed: axis.values.filter(has),
        unphotographed: axis.values.filter((value) => !has(value)),
      }
    })
    .filter((axis) => axis.unphotographed.length > 0)
  const unphotographed = axes.flatMap((axis) => axis.unphotographed)
  const cross = cardAxes.length === 2
  const combos = cross ? comboCoverage(variants, shot, new Set(unphotographed)) : { photographed: [], unphotographed: [] }
  if (axes.length === 0 && combos.unphotographed.length === 0) return null
  return { axes, unphotographed, combos }
}

/** 디자인×색상 조합 구분 — 사진 없는 값이 든 조합은 값 가드가 이미 막으므로 빼고, 값마다 사진은 있는 조합만 센다 */
function comboCoverage(
  variants: readonly OptionVariant[],
  shot: readonly OptionVariant[],
  unphotographedValues: ReadonlySet<string>
): OptionPhotoCoverage['combos'] {
  const pairs = (list: readonly OptionVariant[]) =>
    list.flatMap(({ values: { design, color } }) => (design && color ? [{ design, color }] : []))
  const photographed = [...new Set(pairs(shot).map((p) => `${p.design} ${p.color}`))]
  const unphotographed = [
    ...new Set(
      pairs(variants)
        .filter((p) => !unphotographedValues.has(p.design) && !unphotographedValues.has(p.color))
        .map((p) => `${p.design} ${p.color}`)
        .filter((combo) => !photographed.includes(combo))
    ),
  ]
  return { photographed, unphotographed }
}

/** 실물 사진이 있는 옵션의 사진 URL(옵션 순서, 중복 제거) — 가드가 걸린 잡의 생성 참조 후보(R3 ①) */
export function optionPhotoUrls(spec: OptionSpec | null): string[] {
  return [...new Set((spec?.variants ?? []).map((v) => v.sourceImage?.trim() ?? '').filter(isRealOptionPhoto))]
}

/**
 * 가드가 걸린 잡의 생성 참조(R3 ①) — 상품 사진(source_images)은 어느 옵션을 찍었는지 표시가 없어, 사진 없는 옵션이 찍힌 사진이
 * 섞이면 "참조 사진 그대로만" 규칙과 어긋난다. 그래서 실물 사진이 있는 옵션의 사진과 같은 그림(바이트 동일)인 상품 사진만
 * 순서대로 남기고, 남지 않은 옵션 사진을 뒤에 붙인다(상품 사진 상한 max장까지 — 옵션이 많아도 참조가 늘지 않게).
 * 옵션 사진을 하나도 못 읽었으면 상품 사진 그대로(참조 없이 그리는 것보다 낫다).
 * 같은 그림 판정은 바이트 동일이다 — 다시 인코딩된 같은 사진은 빠지고 옵션 사진으로 대신한다.
 */
export function guardedReferences<T extends { data: string }>(
  sourceRefs: readonly T[],
  optionRefs: readonly T[],
  max: number
): T[] {
  if (optionRefs.length === 0) return [...sourceRefs]
  const allowed = new Set(optionRefs.map((r) => r.data))
  const kept = sourceRefs.filter((r, i) => allowed.has(r.data) && sourceRefs.findIndex((o) => o.data === r.data) === i)
  const keptData = new Set(kept.map((r) => r.data))
  const extra = optionRefs.filter((r, i) => !keptData.has(r.data) && optionRefs.findIndex((o) => o.data === r.data) === i)
  return [...kept, ...extra].slice(0, max)
}

/** 사진 있는 값·조합 이름 — 사진 없는 이름을 지울 때 이 이름 속 낱말은 지키지 않으면 "오가닉 블랙"이 "오가닉"이 된다 */
export function photographedNames(coverage: OptionPhotoCoverage): string[] {
  return [...new Set([...coverage.axes.flatMap((a) => a.photographed), ...coverage.combos.photographed])]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 옵션을 나열하는 구분자 — "/"·"·"·","·"&" 또는 and·or·및·또는 */
const SEP = String.raw`(?:\s*[/·,&]\s*|\s+(?:and|or|및|또는)\s+)`
const PARTICLE = '(?:와|과|랑|이랑|은|는|이|가|을|를|도|의|로|으로)?'
const NOT_WORD_AFTER = '(?![가-힣A-Za-z])'
/** 영어 옵션 값 뒤에 오면 그 자리를 옵션 값으로 보는 낱말 — "White color", "Cherry pattern", "Black 컬러" */
const OPTION_NOUN = String.raw`(?:colou?rs?(?!\s+(?:balance|temperature|grading|grade|tones?|cast|correction))|colorways?|versions?|variants?|options?|editions?|patterns?|prints?|designs?|styles?|motifs?|컬러|색상|옵션|버전|디자인|패턴)(?![A-Za-z])`
const isAsciiName = (value: string) => /^[\x20-\x7E]+$/.test(value)

/** 영어 옵션 값 나열 구분자 — 한글 문장 속 조사("White와 Black")와 JSON 배열(["Black","White"])도 나열로 본다 */
const ASCII_SEP = String.raw`(?:${SEP}|(?:와|과|랑|이랑)\s+|"\s*,\s*")`
const SHIELD = String.raw`\d+`
const POSITIONED = String.raw`\d+`

/**
 * 영어(ASCII) 옵션 값은 옵션 값 자리에서만 지운다(R4 ② — "White"가 영어 프롬프트의 "white backdrop"·"white marble table" 같은
 * 일반 낱말까지 지웠다). 자리: 다른 옵션 이름이나 지울 값과 나열된 곳("Black/White", "White와 Black", ["Black","White"]),
 * 옵션을 뜻하는 낱말 앞("White color", "Cherry pattern"). 값을 먼저 표시로 바꾸고 자리를 한꺼번에 판정한 뒤 지운다 — 사진 없는
 * 값끼리 나열돼도("White/Black") 마지막 값이 남지 않는다. 이웃 낱말 속 글자는 옵션 이름으로 보지 않는다("textured"의 red).
 * 지우지 않는 자리(일반 낱말과 구별할 수 없다): 값 뒤 상품 명사("Daisy pouch"), 구절 끝("in White."), 하이픈("Cherry-patterned").
 */
function stripAsciiOptions(text: string, ascii: readonly string[], names: readonly string[], shielded: boolean): string {
  const hits: string[] = []
  let out = text
  for (const value of [...ascii].sort((a, b) => b.length - a.length)) {
    const word = String.raw`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])(?:\s*\([^)]*\))?`
    out = out.replace(new RegExp(word, 'gi'), (m) => `${hits.push(m) - 1}`)
  }
  if (hits.length === 0) return text
  const nameAlt = names.map(escapeRe).join('|')
  const option = [
    ...(nameAlt ? [String.raw`(?<![A-Za-z0-9])(?:${nameAlt})(?![A-Za-z0-9])(?:\s*\([^)]*\))?`] : []),
    ...(shielded ? [SHIELD] : []),
    String.raw`\d+`,
  ].join('|')
  const listedBefore = new RegExp(String.raw`(?:${option})${ASCII_SEP}$`, 'i')
  const listedAfter = new RegExp(String.raw`^${ASCII_SEP}(?:${option})`, 'i')
  const nounAfter = new RegExp(String.raw`^[ \t]+${OPTION_NOUN}`, 'i')
  const positioned = new Set<number>()
  for (const m of out.matchAll(/(\d+)/g)) {
    const before = out.slice(Math.max(0, m.index - 200), m.index)
    const after = out.slice(m.index + m[0].length, m.index + m[0].length + 200)
    if (listedBefore.test(before) || listedAfter.test(after) || nounAfter.test(after)) positioned.add(Number(m[1]))
  }
  // 옵션 자리가 아닌 표시는 원래 글로 되돌린다
  out = out.replace(/(\d+)/g, (m, i: string) =>
    positioned.has(Number(i)) ? `${i}` : hits[Number(i)]
  )
  const optionOrPositioned = `${option}|${POSITIONED}`
  return out
    // 다른 옵션 앞에 나열: "White/Black" → "Black", "White, Black and Gray"(모두 지움) → "Gray" 다음 줄에서
    .replace(new RegExp(String.raw`${POSITIONED}${ASCII_SEP}(?=(?:${optionOrPositioned}))`, 'gi'), '')
    // 다른 옵션 뒤에 나열: "Black/White" → "Black"
    .replace(new RegExp(String.raw`${ASCII_SEP}${POSITIONED}`, 'gi'), '')
    // 구절 끝에 혼자 남음: "available in White." → "available in."
    .replace(new RegExp(String.raw`[ \t]+${POSITIONED}(?=[ \t]*(?:$|[,.;:)\n]))`, 'gm'), '')
    // 옵션을 뜻하는 낱말 앞·남은 자리: "in White color" → "in color"
    .replace(new RegExp(String.raw`${POSITIONED}[ \t]*`, 'g'), '')
}

/**
 * 글에서 사진 없는 옵션 이름(뒤 괄호 영문 포함 — "체리(cherry)")과 그 나열 구분자를 지운다. 다른 낱말 속 글자는 건드리지 않는다
 * ("화이트"는 "오프화이트"·"화이트보드"에서 지우지 않음). "데이지/체리 컬러" → "데이지 컬러", "데이지와 체리, 선택" → "데이지, 선택".
 * 이름이 없으면 글을 그대로 돌려준다(공백 정리도 하지 않는다). keep(사진 있는 이름) 속에 든 낱말은 지우지 않는다
 * ("오가닉 블랙"에 사진이 있고 "블랙"에 없으면 "오가닉 블랙"은 그대로). 영어(ASCII) 값은 옵션 값 자리에서만 지운다(stripAsciiOptions).
 */
export function stripOptionMentions(text: string, values: readonly string[], keep: readonly string[] = []): string {
  const present = values.filter((v) => v.trim() && text.toLowerCase().includes(v.toLowerCase()))
  if (present.length === 0) return text
  // 지킬 이름을 자리표시(사용자 영역 문자)로 가렸다가 끝에 되돌린다 — 긴 이름부터
  const shielded: string[] = []
  const shields = keep
    .filter((k) => present.some((v) => k.toLowerCase() !== v.toLowerCase() && k.toLowerCase().includes(v.toLowerCase())))
    .sort((a, b) => b.length - a.length)
  let out = text
  for (const name of shields) {
    out = out.replace(new RegExp(escapeRe(name), 'gi'), (m) => `${shielded.push(m) - 1}`)
  }
  const names = [...new Set([...values, ...keep].filter((n) => n.trim()))]
  out = stripAsciiOptions(out, present.filter(isAsciiName), names, shielded.length > 0)
  for (const value of present) {
    if (isAsciiName(value)) continue
    const name = String.raw`(?<![가-힣A-Za-z0-9])${escapeRe(value)}(?:\s*\([^)]*\))?`
    out = out
      // 앞 옵션 뒤에 나열된 경우: "데이지/체리", "daisy and 체리(cherry)"
      .replace(new RegExp(`${SEP}${name}${PARTICLE}${NOT_WORD_AFTER}`, 'gi'), '')
      // "데이지와 체리"
      .replace(
        new RegExp(String.raw`(?<=[가-힣A-Za-z0-9)])(?:와|과|랑|이랑)\s+${name}${PARTICLE}${NOT_WORD_AFTER}`, 'g'),
        ''
      )
      // 구절 끝: "… pouch 체리." → "… pouch."
      .replace(new RegExp(String.raw`[ \t]+${name}${PARTICLE}${NOT_WORD_AFTER}(?=[ \t]*(?:$|[,.;:)\n]))`, 'gim'), '')
      // 맨 앞·단독: "체리/데이지", "체리와 데이지", "체리를 고르세요"
      .replace(new RegExp(String.raw`${name}${PARTICLE}${NOT_WORD_AFTER}${SEP}?\s*`, 'gi'), '')
  }
  // 구분자·뒤 공백은 정규식이 함께 지운다 — 남는 빈 괄호만 정리하고 나머지 공백은 건드리지 않는다
  return out.replace(/\(\s*\)/g, '').replace(/(\d+)/g, (_, i: string) => shielded[Number(i)])
}

/** 가드 축이 하나이고 빠진 조합이 없으면 그 축 — 한 축 상품(R2-1)의 규칙 문구를 그대로 쓴다 */
const singleAxis = (coverage: OptionPhotoCoverage): OptionAxisPhotoCoverage | null =>
  coverage.axes.length === 1 && coverage.combos.unphotographed.length === 0 ? coverage.axes[0] : null

/** 디자인·색상 둘 다 걸리거나 조합이 빠진 교차 상품의 첫 문장들 — 사진 있는 값·조합만 이름을 쓴다(R3 ⑥) */
function crossLead(coverage: OptionPhotoCoverage): string {
  const lines = coverage.axes.map((axis) =>
    axis.photographed.length > 0
      ? `실물 사진이 있는 ${axis.axisName} 옵션은 ${axis.photographed.join(', ')}뿐입니다.`
      : `이 상품의 ${axis.axisName} 옵션에는 실물 사진이 없습니다.`
  )
  if (coverage.combos.unphotographed.length > 0 && coverage.combos.photographed.length > 0) {
    lines.push(`실물 사진이 있는 디자인·색상 조합은 ${coverage.combos.photographed.join(', ')}뿐입니다.`)
  }
  return [...lines, '제품은 참조 사진에 보이는 디자인·색 그대로만 그리세요.'].join(' ')
}

/** 디자인 프롬프트 LLM에 붙일 규칙 블록 — 사진 없는 옵션 이름은 쓰지 않는다. 가드가 필요 없으면 빈 문자열 */
export function optionPhotoDesignBlock(coverage: OptionPhotoCoverage | null): string {
  if (!coverage) return ''
  const axis = singleAxis(coverage)
  const shown = axis?.photographed.join(', ') ?? ''
  const lead = !axis
    ? crossLead(coverage)
    : axis.photographed.length > 0
      ? `실물 사진이 있는 ${axis.axisName} 옵션은 ${shown}뿐입니다. 제품은 참조 사진의 ${shown} 디자인 그대로만 그리세요.`
      : `이 상품의 ${axis.axisName} 옵션에는 실물 사진이 없습니다. 제품은 참조 사진 그대로만 그리세요.`
  return [
    '',
    '',
    '## 옵션 사진 규칙 (이 상품에 한함)',
    lead,
    '- 다른 옵션·다른 색 버전을 지어내거나, 여러 옵션을 나란히 놓거나, 색만 바꿔 보여 주는 장면을 만들지 마세요.',
    '- 옵션 이름은 상세페이지 글자로만 쓰입니다. 이미지 장면·소품·색 연출(positive)의 재료가 아닙니다.',
  ].join('\n')
}

/**
 * 제품 컷 프롬프트 끝에 붙일 예비 규칙 — 긍정문 먼저, 사진 없는 옵션 이름 없음. 사진 있는 값이 여럿이면 이름을 늘어놓지 않고
 * 참조 사진에 보이는 것만 그리게 한다(참조 사진이 어느 값을 담았는지 여기서는 모른다). 교차 상품은 디자인·색을 함께 말한다.
 * 가드가 필요 없으면 빈 문자열.
 */
export function optionPhotoGuard(coverage: OptionPhotoCoverage | null): string {
  if (!coverage) return ''
  const axis = singleAxis(coverage)
  if (!axis) {
    const anyPhoto = coverage.combos.photographed.length > 0 || coverage.axes.some((a) => a.photographed.length > 0)
    const lead = anyPhoto
      ? 'OPTION DESIGN RULE: show only designs and colors that appear in the reference photos, exactly as photographed.'
      : 'OPTION DESIGN RULE: show the product exactly as in the reference photo.'
    return `${lead} Do not create other designs, colors, design-color combinations or recolored versions of the product.`
  }
  const { kind, photographed } = axis
  const lead =
    photographed.length === 0
      ? 'OPTION DESIGN RULE: show the product exactly as in the reference photo.'
      : photographed.length === 1
        ? `OPTION DESIGN RULE: show only the ${photographed[0]} ${kind} exactly as in the reference photo.`
        : `OPTION DESIGN RULE: show only ${kind}s that appear in the reference photos, exactly as photographed.`
  return `${lead} Do not create other ${kind}s or recolored versions of the product.`
}
