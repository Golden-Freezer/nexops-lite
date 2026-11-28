// 카피 사실 값(pdp-copy-facts-r4) — 옵션 개수·수량처럼 입력에서 계산되는 값을 카피에 사실로 주고, 최종 카피의 어긋난 개수를 고친다.
//
// 원인(R4 P01 844d1231): 카피 프롬프트 스펙 JSON은 등록 옵션 구조(optionSpec)를 빼서(buildSpecSheetJson) 모델이 옵션명 13개
// ('20개 생일답례-01' … '50개 생일답례-07')만 보고 번호 최댓값 07을 디자인 개수로 읽었다('7가지 디자인' 11곳 — 실제 6종).
// 같은 optionSpec으로 만들던 첫 화면 스펙 줄(editor heroFacts — 2026-10-30 오너 지시로 뺐다)은 결정론이라 맞았다 — 값 정리(trim·중복 제거)를 같은 규칙으로 한다.
//
// 가드는 축 낱말과 붙은 'N가지/N종'만 숫자를 고친다(통합 결정). 고치지 않고 경고만 남기는 것(검수 지적 반영):
// - 맞는 개수: 축 전체 개수뿐 아니라 빠진 조합의 값별 개수('30개는 1가지 디자인')도 맞다
// - 다른 축 값 하나를 짚은 문장('30개는 7가지 디자인') — 그 값의 개수가 맞는지 숫자 하나로 고칠 수 없다
// - 범위('6~7가지')·묶음 구성('컬러 4종 세트')·등록 옵션명 속 숫자
// - 일반 낱말('N가지 구성')·떨어진 꼴('디자인은 7가지')·수량('N개')·빠진 조합을 모든 조합처럼 쓴 문장
// 고치지 않는 칸: 등록 옵션명(options — 한 글자도 바꾸지 않는다)·리뷰 원문(reviewHighlights)·상품명(최상위 title).

import type { CopywritingResult, PdpSpecSheet } from './pdp-state'
import { isOptionSpec, type OptionAxisKind } from './options/option-spec'

export interface CopyFactAxis {
  kind: OptionAxisKind
  name: string
  /** 서로 다른 값(trim·중복 제거, 등록 순서) */
  values: string[]
}

export interface CopyFacts {
  axes: CopyFactAxis[]
  /** 등록 옵션 수 */
  variantCount: number
  /** 축이 둘일 때 모든 조합이 있지는 않으면 첫 축 값별 있는 값 — 예: '30개: 생일답례-04'(축 순서는 수량·디자인·색상·사이즈) */
  partialCombos: string[]
  /** 축마다 맞는 개수 — 전체 개수 + 빠진 조합의 값별 개수(축 둘일 때, 양방향) */
  validCounts: Partial<Record<OptionAxisKind, number[]>>
  /** 보호어(등록 옵션명·값·상품명) — 글 속 그 자리의 숫자는 고치지 않는다 */
  optionTerms: string[]
}

export interface FactCorrection {
  /** 카피 안 위치(예: 'pointCards[0].title') */
  path: string
  from: string
  to: string
}

type CountAxisKind = Exclude<OptionAxisKind, 'quantity'>

/**
 * 축 낱말 — 'N가지/N종' 바로 앞뒤에 붙으면 그 축 개수로 대조한다(긴 낱말 먼저). 옵션이 아닌 뜻으로도 흔히 쓰는 '스타일'·'타입'은
 * 넣지 않는다(검수 지적 — '3가지 스타일로 연출')
 */
const AXIS_NOUNS: Record<CountAxisKind, readonly string[]> = {
  design: ['디자인', '패턴', '도안'],
  color: ['색상', '컬러', '색깔', '색'],
  size: ['사이즈', '크기'],
}
const GENERIC_NOUNS = ['옵션', '구성', '종류', '선택지']
/** 묶음 구성 — 'N종 세트'는 한 상품의 구성이라 옵션 개수가 아니다. '입'은 뒤에 한글이 없을 때만('입니다'·'입구' 제외) */
const BUNDLE_WORDS = '(?:세트|팩|묶음|입(?![가-힣]))'
const BUNDLE_AFTER = new RegExp(`^\\s*${BUNDLE_WORDS}`)
/** 범위 앞부분('6~')이 붙은 숫자 */
const RANGE_BEFORE = /[\d][\s]*[~∼–-]\s*$/

const LIST_MAX = 4
/** 잡 오류 칸에 남기는 사실 값 경고 수 상한 */
const WARNING_MAX = 4

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

export function buildCopyFacts(specSheet: PdpSpecSheet | undefined): CopyFacts | null {
  const spec = (specSheet as Record<string, unknown> | undefined)?.optionSpec
  if (!isOptionSpec(spec) || spec.axes.length === 0) return null
  const axes = spec.axes
    .map((a) => ({ kind: a.kind, name: a.name, values: uniqueValues(a.values) }))
    .filter((a) => a.values.length > 0)
  if (axes.length === 0) return null
  const partialCombos: string[] = []
  const validCounts: Partial<Record<OptionAxisKind, number[]>> = {}
  for (const axis of axes) validCounts[axis.kind] = [axis.values.length]
  if (axes.length === 2) {
    const [first, second] = axes
    const presentOf = (by: CopyFactAxis, value: string, of: CopyFactAxis) =>
      uniqueValues(spec.variants.filter((v) => v.values[by.kind]?.trim() === value).map((v) => v.values[of.kind] ?? ''))
    for (const value of first.values) {
      const present = presentOf(first, value, second)
      if (present.length > 0 && present.length < second.values.length) {
        partialCombos.push(
          `${value}: ${present.length <= LIST_MAX ? present.join('·') : `${second.name} ${present.length}가지`}`
        )
      }
      if (present.length > 0) validCounts[second.kind]!.push(present.length)
    }
    for (const value of second.values) {
      const present = presentOf(second, value, first)
      if (present.length > 0) validCounts[first.kind]!.push(present.length)
    }
  }
  for (const axis of axes) validCounts[axis.kind] = [...new Set(validCounts[axis.kind])]
  // 보호어 — 등록 옵션명·값과 상품명(히어로 상품명 mainIntro.brandAndName 등에 그대로 실린다, 검수 지적)
  const optionTerms = uniqueValues([
    ...spec.variants.map((v) => v.label),
    ...axes.flatMap((a) => a.values),
    ...(typeof specSheet?.productName === 'string' ? [specSheet.productName] : []),
  ])
  return { axes, variantCount: spec.variants.length, partialCombos, validCounts, optionTerms }
}

/** 카피 프롬프트 블록 — 개수·수량 숫자는 이 값만 쓰게. 사실 값이 없으면 빈 문자열 */
export function buildCopyFactsBlock(facts: CopyFacts | null): string {
  if (!facts) return ''
  const lines = ['## [사실 값 — 옵션 개수·수량 숫자는 이 값만 쓴다]']
  for (const axis of facts.axes) {
    const list = axis.values.length <= LIST_MAX ? `: ${axis.values.join('/')}` : ''
    lines.push(
      axis.kind === 'quantity'
        ? `- ${axis.name}: ${axis.values.join('/')}`
        : `- ${axis.name} ${axis.values.length}가지${list}`
    )
  }
  lines.push(`- 등록 옵션 ${facts.variantCount}개(${facts.axes.map((a) => a.name).join('·')} 조합)`)
  if (facts.partialCombos.length > 0) {
    const [first, second] = facts.axes
    lines.push(
      // 조사가 앞 낱말 받침을 따르므로 축 이름 뒤에 조사를 붙이지 않는 문장으로 쓴다
      `- 모든 조합이 있지는 않다 — ${facts.partialCombos.join(' / ')}. 모든 ${first.name}·${second.name} 조합이 있는 것처럼 쓰지 마라.`
    )
  }
  lines.push('- 옵션명 속 번호(예: -07)는 이름이다. 번호 최댓값을 개수로 읽지 마라. 개수를 말할 때는 위 개수만 쓴다.')
  return lines.join('\n')
}

type Walked = { path: string; text: string }

/** 고치지 않는 칸 — 등록 옵션명 목록·리뷰 원문(재작성 불가)·상품명 */
function skipped(key: string, path: string): boolean {
  return key === 'options' || key === 'reviewHighlights' || path === 'title'
}

function walkStrings(value: unknown, path: string, out: Walked[]): void {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const child = path ? `${path}.${k}` : k
      if (!skipped(k, child)) walkStrings(v, child, out)
    }
  }
}

function setAt(root: Record<string, unknown>, path: string, text: string): void {
  const keys = path.match(/[^.[\]]+/g) ?? []
  let node: Record<string, unknown> | unknown[] = root
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    node = (Array.isArray(node) ? node[Number(key)] : node[key]) as Record<string, unknown> | unknown[]
  }
  const last = keys[keys.length - 1]
  if (Array.isArray(node)) node[Number(last)] = text
  else node[last] = text
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 조사 — 축 낱말 뒤에 붙어도 같은 낱말로 본다(조사 뒤에 한글이 이어지면 다른 낱말: '색도화지') */
const PARTICLES = '을|를|이|가|은|는|의|으로|로|과|와|도|만|까지|부터|중|에서|에|별|씩|이에요|예요|입니다|이다|이고|이며'
/** 축 낱말 뒤 경계 — 글 끝·한글 아닌 글자·(조사 + 한글 아닌 글자) */
const NOUN_END = `(?=$|[^가-힣]|(?:${PARTICLES})+(?![가-힣]))`

/** 'N가지/N종' + 축 낱말 — 숫자가 앞(숫자 앞이 다른 숫자가 아님) 또는 낱말이 앞(낱말 앞이 한글이 아님: '특색'·'배색' 제외) */
function axisCountRegexes(nouns: readonly string[]): RegExp[] {
  const alt = [...nouns].sort((a, b) => b.length - a.length).map(escapeRe).join('|')
  return [
    new RegExp(`(?<!\\d)(\\d+)(\\s*(?:가지|종)(?:의)?\\s*)(${alt})${NOUN_END}`, 'g'),
    new RegExp(`(?<![가-힣])(${alt})(\\s*)(\\d+)(\\s*(?:가지|종))`, 'g'),
  ]
}

/** 글에 나온 축 값 — 수량은 숫자(같은 단위가 글에 있을 때), 짧은 영문 값('S')은 낱말 경계가 있을 때만 */
function mentionedValues(axis: CopyFactAxis, text: string): Set<string> {
  const found = new Set<string>()
  for (const value of axis.values) {
    if (axis.kind === 'quantity') {
      const num = value.match(/\d+/)?.[0]
      const unit = value.replace(/[\d\s]/g, '')
      if (num && (!unit || text.includes(unit)) && new RegExp(`(?<!\\d)${num}(?!\\d)`).test(text)) found.add(value)
    } else if (/^[A-Za-z0-9]{1,3}$/.test(value)) {
      if (new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`).test(text)) found.add(value)
    } else if (text.includes(value)) found.add(value)
  }
  return found
}

/** 수량 단위('20개' → '개') */
function unitOf(axis: CopyFactAxis): string {
  return axis.values[0]?.replace(/[\d\s]/g, '') || '개'
}

/** 축 낱말과 붙은 개수들 */
function countsIn(axis: CopyFactAxis, text: string): number[] {
  return axisCountRegexes(AXIS_NOUNS[axis.kind as CountAxisKind]).flatMap((re) =>
    // 숫자가 앞이면 1번 묶음, 낱말이 앞이면 3번 묶음이 숫자다
    [...text.matchAll(re)].map((m) => Number(/^\d/.test(m[1]) ? m[1] : m[3]))
  )
}

/** 한 축의 여러 값을 말하는 글인지 — 값 둘 이상·수량 범위(단위 포함)·개수 표현·'모든 X'·'X별' */
function mentionsMany(axis: CopyFactAxis, text: string): boolean {
  if (mentionedValues(axis, text).size >= 2) return true
  if (axis.kind === 'quantity') {
    return new RegExp(`\\d+\\s*[~∼–-]\\s*\\d+\\s*${escapeRe(unitOf(axis))}`).test(text)
  }
  const nouns = AXIS_NOUNS[axis.kind as CountAxisKind]
  if (axisCountRegexes(nouns).some((re) => re.test(text))) return true
  return nouns.some((n) => text.includes(`모든 ${n}`) || text.includes(`전 ${n}`) || text.includes(`${n}별`))
}

/**
 * 최종 카피 대조 — 축 낱말과 붙은 개수가 사실(맞는 개수 목록)과 다르면 숫자를 축 전체 개수로 고치고(나머지 글자·조사는 그대로),
 * 고칠 수 없거나 판단이 애매한 것은 경고만. 입력 카피는 바꾸지 않는다(고친 사본을 돌려준다). 같은 문장이 파생 칸(sections·hero_copy
 * 등)에 복제돼 있어 고치지 않는 칸 말고 모든 글자 칸을 본다.
 */
export function correctCopyFacts(
  copy: CopywritingResult,
  facts: CopyFacts
): { copy: CopywritingResult; corrections: FactCorrection[]; warnings: string[] } {
  const fixed = structuredClone(copy) as Record<string, unknown>
  const strings: Walked[] = []
  walkStrings(fixed, '', strings)
  const corrections: FactCorrection[] = []
  const warned = new Set<string>()
  const warnings: string[] = []
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(message)
  }
  const validOf = (axis: CopyFactAxis) => facts.validCounts[axis.kind] ?? [axis.values.length]
  const allValid = new Set([...facts.axes.flatMap(validOf), facts.variantCount])
  const quantity = facts.axes.find((a) => a.kind === 'quantity')
  const protectedTerms = facts.optionTerms.filter((t) => /\d/.test(t))
  const allNouns = [...Object.values(AXIS_NOUNS).flat(), ...GENERIC_NOUNS]

  /** 등록 옵션명이 글에 그대로 들어간 자리인지 — 그 안의 숫자는 이름이다(앞선 치환으로 위치가 바뀌므로 그때그때 본다) */
  const isGuarded = (str: string, at: number) =>
    protectedTerms.some((term) => {
      for (let i = str.indexOf(term); i >= 0; i = str.indexOf(term, i + 1)) if (at >= i && at < i + term.length) return true
      return false
    })

  for (const { path, text } of strings) {
    let next = text
    /** 이 글에서 이미 경고한 개수 — 아래 '사실 값에 없는 개수' 경고와 겹치지 않게 */
    const noted = new Set<string>()
    for (const axis of facts.axes) {
      if (axis.kind === 'quantity') continue
      const total = axis.values.length
      const valid = validOf(axis)
      // 다른 축 값 하나만 짚은 문장('30개는 …')은 그 값의 개수라 전체 개수로 고칠 수 없다
      const others = facts.axes.filter((a) => a !== axis)
      const pointsAtOneValue = others.length === 1 && mentionedValues(others[0], text).size === 1
      /** 고칠 숫자 또는 null(그대로) — all은 지금 치환 중인 글, at은 숫자 위치 */
      const decide = (whole: string, n: string, all: string, at: number, end: number): string | null => {
        const count = Number(n)
        if (valid.includes(count) || isGuarded(all, at) || BUNDLE_AFTER.test(all.slice(end))) return null
        if (RANGE_BEFORE.test(all.slice(0, at))) {
          warnOnce(`r:${whole}`, `[CopyFacts] 범위로 쓴 개수 '${whole}'(${path}) — ${axis.name} ${total}가지 확인`)
          return null
        }
        if (pointsAtOneValue) {
          noted.add(n)
          warnOnce(
            `p:${whole}`,
            `[CopyFacts] 옵션 값 하나의 개수가 사실과 다름 '${whole}'(${path}) — ${facts.partialCombos.join(' / ') || `${axis.name} ${total}가지`}`
          )
          return null
        }
        return String(total)
      }
      const [numFirst, nounFirst] = axisCountRegexes(AXIS_NOUNS[axis.kind as CountAxisKind])
      next = next.replace(numFirst, (whole, n: string, mid: string, noun: string, at: number, all: string) => {
        const to = decide(whole, n, all, at, at + whole.length)
        return to === null ? whole : `${to}${mid}${noun}`
      })
      next = next.replace(
        nounFirst,
        (whole, noun: string, gap: string, n: string, unit: string, at: number, all: string) => {
          const to = decide(whole, n, all, at + noun.length + gap.length, at + whole.length)
          return to === null ? whole : `${noun}${gap}${to}${unit}`
        }
      )
    }
    if (next !== text) {
      corrections.push({ path, from: text, to: next })
      setAt(fixed, path, next)
    }

    // 고치지 않은 개수 — 축·일반 낱말이 함께 있는 글에서 사실 값에 없는 'N가지/N종/N종류'('7가지 귀여운 디자인'·'디자인은 7가지')
    if (allNouns.some((noun) => next.includes(noun))) {
      for (const m of next.matchAll(new RegExp(`(?<![\\d~∼–-])(\\d+)\\s*(?:가지|종류|종)(?!\\s*${BUNDLE_WORDS})`, 'g'))) {
        if (!allValid.has(Number(m[1])) && !noted.has(m[1]) && !isGuarded(next, m.index ?? 0)) {
          warnOnce(`g:${m[0]}`, `[CopyFacts] 사실 값에 없는 개수 '${m[0]}'(${path}) — 등록 옵션 ${facts.variantCount}개 확인`)
        }
      }
    }
    if (quantity) {
      const unit = unitOf(quantity)
      const nums = [...next.matchAll(new RegExp(`(?<![\\d~∼–-])(\\d+)\\s*${escapeRe(unit)}`, 'g'))].map((m) => `${m[1]}${unit}`)
      const known = new Set(quantity.values.map((v) => v.replace(/\s+/g, '')))
      if (nums.some((n) => known.has(n))) {
        for (const n of nums) {
          if (!known.has(n)) warnOnce(`q:${n}`, `[CopyFacts] 등록 수량(${[...known].join('/')})에 없는 수량 '${n}'(${path})`)
        }
      }
    }
    // 빠진 조합이 있는데 두 축 모두 여러 값을 말하면 모든 조합처럼 읽힌다(고친 뒤 문장으로 판단). 값별 개수('30개는 1가지
    // 디자인')를 함께 쓴 문장은 조합을 나눠 말한 것이라 뺀다
    const statesPerValue = facts.axes.some(
      (a) => a.kind !== 'quantity' && countsIn(a, next).some((n) => n !== a.values.length && validOf(a).includes(n))
    )
    if (
      facts.partialCombos.length > 0 &&
      facts.axes.length === 2 &&
      !statesPerValue &&
      facts.axes.every((a) => mentionsMany(a, next))
    ) {
      warnOnce(
        `c:${next}`,
        `[CopyFacts] 모든 조합이 있지는 않은데(${facts.partialCombos.join(' / ')}) 모든 조합처럼 읽힘: '${next.slice(0, 40)}'(${path})`
      )
    }
  }
  // 경고는 잡 오류 칸에 이어 붙으므로 앞의 몇 건만 — 나머지는 개수로
  const shown = warnings.slice(0, WARNING_MAX)
  if (warnings.length > WARNING_MAX) shown.push(`[CopyFacts] 경고 외 ${warnings.length - WARNING_MAX}건`)
  if (corrections.length > 0) {
    shown.unshift(`[CopyFacts] 옵션 개수 ${corrections.length}곳 정정 — copy_sections.fact_corrections 참조`)
  }
  return { copy: fixed as CopywritingResult, corrections, warnings: shown }
}
