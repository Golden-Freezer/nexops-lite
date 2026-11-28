// 섹션 사이 반복(pdp-copy-facts-r4) — 같은 특징 낱말이 여러 섹션에서 되풀이되는지 결정론으로 찾는다.
//
// 근거(C RESULTS R4): Claude 심사 r4(흐름·중복)가 4잡 모두 2점 — 아이콘 카드·핵심 포인트·추가 특징·추천 대상이 같은 말을 되풀이.
// R2 특징 배정은 pointCards ↔ detailPoints 번호 짝만 정해, 다른 섹션(추천 대상·핵심 메시지·배너·비교·요약)의 되풀이는 못 막았다.
// R4 재합성 4잡 실측(어절 2-그램, 끝 조사를 뗀 꼴이 최상위 섹션 3곳 이상): '7가지 디자인' 8, '손가락 대신' 6, '한 그릇에' 6,
// '반투명 소재' 6 — 옵션 값('세이지 그린' 색·'S L' 사이즈)은 섹션마다 나오는 게 정상이라 뺀다.
// pointCards와 detailPoints는 특징 배정이 같은 특징을 번호 짝으로 다루게 하므로 한 묶음('features')으로 센다.

import type { CopywritingResult, PdpSpecSheet } from './pdp-state'
import { isOptionSpec } from './options/option-spec'

export interface RepeatFinding {
  /** 되풀이된 어절 2-그램 */
  phrase: string
  /** 나온 최상위 섹션(pointCards·detailPoints는 'features') */
  sections: string[]
}

/** 사람이 보는 원천 필드 — 파생 미러(sections·section_copy_blocks·hero_copy 등)와 옵션 목록·이미지 힌트는 보지 않는다 */
const SOURCE_FIELDS = [
  'mainIntro',
  'problem',
  'solution',
  'pointCards',
  'summary',
  'colorOptions',
  'detailPoints',
  'howTo',
  'recommendedTargets',
  'closingCta',
  'productExposure',
  'mainCutCopy',
  'keyMessageCopy',
  'keyMessageVariations',
  'convertDivCopy',
  'directionHint',
  'conceptCopy',
  'eventBundleCopy',
  'soldOutBanner',
  'compareItems',
  'compareSummary',
] as const
// productType(P1-1a)은 첫 화면 검사용 낱말이라 화면에 나오지 않는다
const SKIP_KEYS = new Set(['options', 'imageHint', 'productType'])
const FEATURE_GROUP = 'features'

/** 이 섹션 수 이상에 나오면 반복이다 — R4 실측에서 특징 반복을 잡는 문턱 */
export const REPEAT_MIN_SECTIONS = 3
/** Stage 3에 넘기는 반복 수 상한 — 섹션 수가 많은 순 */
export const REPEAT_FIX_LIMIT = 5

export const WORD_RE = /[가-힣A-Za-z0-9]+/g

/**
 * 끝 조사를 뗀 낱말 — '소재와'·'소재로'를 같은 낱말로 센다(검수 지적: P02 '반투명 소재' 실제 6섹션을 3으로 셌다).
 * 한 글자 '이'·'가'는 떼지 않는다 — '고양이'·'아이'처럼 낱말 끝인 경우가 많다
 */
const TRAILING_PARTICLE = /(?:으로|에서|까지|부터|과|와|을|를|은|는|의|로|에|도|만)$/
export function stem(word: string): string {
  const m = word.match(TRAILING_PARTICLE)
  return m && word.length > m[0].length ? word.slice(0, -m[0].length) : word
}

function sectionOf(field: string): string {
  return field === 'pointCards' || field === 'detailPoints' ? FEATURE_GROUP : field
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) collectStrings(v, out)
  }
}

/** 최상위 섹션별 사람이 보는 글(pointCards·detailPoints는 'features' 한 묶음) — 흐름 검사(copy-flow-check)도 같은 섹션으로 센다 */
export function sectionTexts(copy: CopywritingResult): Map<string, string[]> {
  const record = copy as Record<string, unknown>
  const out = new Map<string, string[]>()
  for (const field of SOURCE_FIELDS) {
    const texts: string[] = []
    collectStrings(record[field], texts)
    if (texts.length === 0) continue
    const section = sectionOf(field)
    out.set(section, [...(out.get(section) ?? []), ...texts])
  }
  return out
}

/** 빼는 낱말 — 옵션 값·옵션명·브랜드(섹션마다 나오는 게 정상인 이름) */
export function repeatExclusionTerms(specSheet: PdpSpecSheet | undefined): string[] {
  const sheet = (specSheet ?? {}) as Record<string, unknown>
  const terms: string[] = []
  const spec = sheet.optionSpec
  if (isOptionSpec(spec)) {
    for (const axis of spec.axes) terms.push(...axis.values)
    for (const variant of spec.variants) terms.push(...Object.values(variant.values).filter((v): v is string => !!v))
  }
  if (Array.isArray(sheet.colorOptions))
    terms.push(...sheet.colorOptions.filter((v): v is string => typeof v === 'string'))
  if (typeof sheet.brandName === 'string') terms.push(sheet.brandName)
  return [...new Set(terms.flatMap((t) => t.match(WORD_RE) ?? []))]
}

/**
 * 섹션 사이 반복 — 섹션 수가 많은 순(같으면 낱말 순). mergeSections는 섹션 이름을 다른 섹션으로 묶어 센다(흐름 검사가 첫 화면과
 * 마지막 띠 한 쌍을 한 곳으로 — copy-flow-check). 없으면 지금 그대로다
 */
export function findCrossSectionRepeats(
  copy: CopywritingResult,
  options: { excludeTerms?: readonly string[]; mergeSections?: Readonly<Record<string, string>> } = {}
): RepeatFinding[] {
  const excluded = new Set(options.excludeTerms ?? [])
  const merge = options.mergeSections ?? {}
  // 조사가 붙은 꼴('그린으로')도 뺀다. 한 글자 값('대'·'S')은 같을 때만 — '대신'처럼 다른 낱말을 빼지 않게
  const isExcludedWord = (w: string) =>
    /^\d+$/.test(w) || [...excluded].some((t) => w === t || (t.length >= 2 && w.startsWith(t)))
  // 세기는 조사를 뗀 꼴로, 보여 주기는 원래 꼴 중 가장 많이 나온 것(같으면 짧은 것)으로 — 뗀 꼴('좋 선택')을 보이지 않게(검수 지적)
  const sectionsOf = new Map<string, Set<string>>()
  const rawCounts = new Map<string, Map<string, number>>()
  for (const [name, texts] of sectionTexts(copy)) {
    const section = merge[name] ?? name
    for (const text of texts) {
      const words = text.match(WORD_RE) ?? []
      for (let i = 0; i + 1 < words.length; i++) {
        if (isExcludedWord(words[i]) || isExcludedWord(words[i + 1])) continue
        const key = `${stem(words[i])} ${stem(words[i + 1])}`
        const raw = `${words[i]} ${words[i + 1]}`
        if (!sectionsOf.has(key)) sectionsOf.set(key, new Set())
        sectionsOf.get(key)!.add(section)
        const raws = rawCounts.get(key) ?? new Map<string, number>()
        raws.set(raw, (raws.get(raw) ?? 0) + 1)
        rawCounts.set(key, raws)
      }
    }
  }
  const shown = (key: string) =>
    [...rawCounts.get(key)!.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
  return [...sectionsOf.entries()]
    .filter(([, s]) => s.size >= REPEAT_MIN_SECTIONS)
    .map(([key, s]) => ({ phrase: shown(key), sections: [...s].sort() }))
    .sort((a, b) => b.sections.length - a.sections.length || a.phrase.localeCompare(b.phrase))
}

/** Stage 3 '고칠 곳' 블록 — 반복이 없으면 빈 문자열(프롬프트 불변) */
/**
 * '고칠 곳'으로 넘긴 반복이 실제로 줄었는지 — Stage 2에서 찾은 앞 limit개의 섹션 수 전후. 재현 Stage 3 비교용(콜 없음).
 * 말을 바꿔 같은 내용을 되풀이한 것은 세지 못한다(낱말 2-그램 근사)
 */
export function repeatFixEffect(
  before: readonly RepeatFinding[],
  after: readonly RepeatFinding[],
  limit: number = REPEAT_FIX_LIMIT,
): { top: Array<{ phrase: string; before: number; after: number }>; reduced: number; gone: number; fresh: number; total: { before: number; after: number } } {
  const afterBy = new Map(after.map((f) => [f.phrase, f.sections.length]))
  const top = before.slice(0, limit).map((f) => ({ phrase: f.phrase, before: f.sections.length, after: afterBy.get(f.phrase) ?? 0 }))
  const known = new Set(before.map((f) => f.phrase))
  return {
    top,
    reduced: top.filter((t) => t.after < t.before).length,
    gone: top.filter((t) => t.after === 0).length,
    fresh: after.filter((f) => !known.has(f.phrase)).length,
    total: { before: before.length, after: after.length },
  }
}

export function buildRepeatFixBlock(findings: readonly RepeatFinding[]): string {
  if (findings.length === 0) return ''
  const lines = findings.slice(0, REPEAT_FIX_LIMIT).map((f) => {
    const elsewhere = f.sections.filter((s) => s !== FEATURE_GROUP)
    return `- '${f.phrase}' — ${elsewhere.join('·')}${f.sections.includes(FEATURE_GROUP) ? '(pointCards·detailPoints에도 있음)' : ''}`
  })
  return [
    '## [섹션 사이 반복 — 고칠 곳(결정론 검사)]',
    '아래 낱말이 여러 섹션에 되풀이된다. 특징의 주 섹션(pointCards·같은 번호 detailPoints) 밖에서는 그 낱말을 빼고 다른 관점(사용 장면·선택 기준·대상)으로 바꿔 써라. 바꾼 필드는 _changed_fields에 적는다. 글자 수 한도·섹션 잇기 낱말·사실 값은 그대로 지킨다.',
    ...lines,
  ].join('\n')
}
