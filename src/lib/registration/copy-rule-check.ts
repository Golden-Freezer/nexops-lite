// 카피 규칙 검사(P1-1a, 상세페이지 마법사 비교 계획 — 통합 2026-10-30) — 제목·CTA의 안내형 끝말과 첫 화면의 상품 종류 낱말을
// 결정론으로 본다. Stage 2 산출에서 찾은 것은 Stage 3 '고칠 곳'으로 넘기고(추가 콜 없음), 최종 카피에 남은 것은 기록만 한다.
//
// - 안내형 끝말: 제목·CTA 칸이 '살펴보세요·확인하세요·만나보세요·소개합니다'처럼 보라고 안내하는 말로 끝나면 걸린다. 그 자리에는
//   고객이 얻는 효익이나 지금 사는 이유가 와야 한다(R7 관찰 — 디자인 컷 CTA '두 칸을 살펴보세요'). 본문(설명·증명)과 사용법
//   (단계·설명)은 보지 않는다 — '물 온도를 확인하세요' 같은 사용 안내는 맞는 말이다.
// - 상품 종류 낱말: 첫 화면(hook·benefitHeadline·subBenefit)에 무엇을 파는지 보이는 낱말이 한 번은 있어야 한다(R7 P01 '톡 붙이는
//   답례 포장 한 장' — 스티커가 없어 포장지로 읽혔다). 상품명 전체·옵션을 다시 넣는 것은 아니다.
//   낱말은 카피가 고른 mainIntro.productType을 상품명과 대조해 쓴다. 상품명 끝 낱말은 종류가 아닐 때가 많다('… 스티커 수제 선물
//   포장'). productType이 없거나 상품명에 없으면 브랜드·수량·쓰임 말을 뺀 상품명 낱말 중 하나가 있으면 된다.

import type { CopywritingResult, PdpSpecSheet } from './pdp-state'

export interface GuideEndingFinding {
  /** 카피 안 위치(예: 'closingCta.headline') */
  path: string
  text: string
}

export interface HookTypeCheck {
  /** 첫 화면에 있어야 하는 낱말 — 하나라도 있으면 된다 */
  words: string[]
  /** 'copy' = 카피가 고른 productType(상품명에 있음), 'name' = 상품명 낱말 */
  source: 'copy' | 'name'
  present: boolean
}

export interface CopyRuleFindings {
  guideEndings: GuideEndingFinding[]
  /** 상품명에서 종류 낱말을 찾지 못하면 null(보지 않는다) */
  hookType: HookTypeCheck | null
}

/**
 * 제목·CTA 칸 — 첫 화면, 오버레이 제목·보조, CTA(문자열 꼴 포함), 완판 배너, 핵심 메시지, 선언, 카드·포인트 제목, 비교 요약.
 * 사용법 단계(howTo)는 보지 않는다 — '사용 전 접착면을 확인하세요'는 맞는 안내다
 */
const TITLE_PATH_RE = new RegExp(
  '^(?:' +
    [
      String.raw`mainIntro\.(?:hook|benefitHeadline|subBenefit)`,
      String.raw`(?:productExposure|directionHint|conceptCopy|mainCutCopy|keyMessageCopy|convertDivCopy|eventBundleCopy)\.(?:headline|subCopy)`,
      String.raw`closingCta(?:\.(?:headline|subtext))?`,
      String.raw`soldOutBanner\.(?:headline|subtitle)`,
      'summary',
      String.raw`solution\.declaration`,
      String.raw`keyMessageVariations\.(?:top|mid|bottom)`,
      String.raw`pointCards\[\d+\]\.title`,
      String.raw`detailPoints\[\d+\]\.claim`,
      'compareSummary',
    ].join('|') +
    ')$'
)

/** 보라고 안내하는 끝말 — 문장·줄 끝에서만 본다(끝 문장부호·이모지·닫는 따옴표는 떼고) */
export const GUIDE_ENDING_RE = new RegExp(
  '(?:' +
    [
      String.raw`(?:살펴|알아|둘러|만나|비교해)\s?보세요`,
      // '얼마나 필요한지 볼까요'·'함께 살펴볼까요'
      String.raw`(?:살펴|알아|둘러|확인해|비교해|^|\s)\s?볼까요`,
      String.raw`확인\s?(?:하세요|해\s?보세요|해\s?주세요)`,
      String.raw`소개(?:합니다|해요|할게요|해\s?드려요|해\s?드릴게요|해\s?드립니다)`,
    ].join('|') +
    ')$'
)
const TRAILING_MARKS = /[\s.!~…♡♥️\p{Extended_Pictographic}"'”’」』)]+$/u

/** 문장마다 — 줄바꿈으로 나뉜 한 문장('확인해\n보세요')은 이어서, 줄마다 끝난 문장은 줄 끝에서 본다 */
export function endsWithGuide(text: string): boolean {
  return text
    .split(/[.!?]/)
    .flatMap((sentence) => [sentence.replace(/\s*\n\s*/g, ' '), ...sentence.split('\n')])
    .map((s) => s.replace(TRAILING_MARKS, '').trim())
    .some((s) => s.length > 0 && GUIDE_ENDING_RE.test(s))
}

function collect(value: unknown, path: string, out: GuideEndingFinding[]): void {
  if (typeof value === 'string') {
    if (TITLE_PATH_RE.test(path) && endsWithGuide(value)) out.push({ path, text: value })
  } else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path ? `${path}.${k}` : k, out)
  }
}

/** 상품명에서 종류 낱말이 아닌 말 — 묶음·쓰임·꾸밈(선물·답례·포장은 쓰임이지 종류가 아니다) */
const NOT_TYPE_WORDS = new Set([
  '세트',
  '구성',
  '묶음',
  '단품',
  '선물',
  '선물용',
  '포장',
  '답례',
  '답례품',
  '수제',
  '핸드메이드',
  '생일',
  '파티',
  '대용량',
  '소용량',
  '정품',
  '국산',
  '국내산',
  '프리미엄',
  '고급',
  '신상',
  '인기',
  '공용',
  '남녀공용',
  '휴대용',
  '가정용',
  '업소용',
  '미니',
  '대형',
  '중형',
  '소형',
])
const NAME_WORD_SPLIT = /[\s,/·|()[\]{}+&【】「」『』<>]+/

/** 종류 낱말이 될 수 있는 말 — 한글이 있고, 브랜드·숫자(수량·규격)·쓰임 말이 아닌 것 */
function typeWordFilter(specSheet: Pick<PdpSpecSheet, 'brandName'>): (word: string) => boolean {
  const brand = new Set((specSheet.brandName ?? '').split(NAME_WORD_SPLIT).filter(Boolean))
  return (w) => /[가-힣]/.test(w) && !brand.has(w) && !/\d/.test(w) && !NOT_TYPE_WORDS.has(w)
}

/** 브랜드·수량·쓰임 말을 뺀 상품명 낱말 */
export function productNameTypeWords(specSheet: Pick<PdpSpecSheet, 'productName' | 'brandName'>): string[] {
  const isType = typeWordFilter(specSheet)
  return [...new Set((specSheet.productName ?? '').split(NAME_WORD_SPLIT).filter((w) => w && isType(w)))]
}

/**
 * 첫 화면에 있어야 하는 종류 낱말 — 카피가 고른 productType이 상품명에 있고 종류 낱말이 될 수 있으면 그것(여러 낱말이면 끝 낱말),
 * 아니면 상품명 낱말. 카피가 쓰임 말('포장')을 골라도 상품명 낱말로 본다(R7 P01 — '포장'으로는 스티커가 보이지 않는다)
 */
export function hookTypeWords(
  copy: CopywritingResult,
  specSheet: Pick<PdpSpecSheet, 'productName' | 'brandName'>
): { words: string[]; source: 'copy' | 'name' } | null {
  const chosen = (copy.mainIntro?.productType ?? '').trim()
  if (chosen && (specSheet.productName ?? '').includes(chosen)) {
    const head = chosen.split(NAME_WORD_SPLIT).filter(Boolean).pop()
    if (head && typeWordFilter(specSheet)(head)) return { words: [head], source: 'copy' }
  }
  const words = productNameTypeWords(specSheet)
  return words.length > 0 ? { words, source: 'name' } : null
}

export function findCopyRuleViolations(
  copy: CopywritingResult,
  specSheet: Pick<PdpSpecSheet, 'productName' | 'brandName'>,
  opts: { hookShort?: boolean } = {}
): CopyRuleFindings {
  const guideEndings: GuideEndingFinding[] = []
  collect(copy, '', guideEndings)
  const type = hookTypeWords(copy, specSheet)
  const intro = copy.mainIntro ?? {}
  // hookshort 잡은 hook이 첫 화면에 나오지 않는다 — 제목이나 보조에 있어야 통과다
  const firstScreen = (opts.hookShort ? [intro.benefitHeadline, intro.subBenefit] : [intro.hook, intro.benefitHeadline, intro.subBenefit]).filter(Boolean).join('\n')
  return {
    guideEndings,
    hookType: type ? { ...type, present: type.words.some((w) => firstScreen.includes(w)) } : null,
  }
}

export function hasCopyRuleViolations(findings: CopyRuleFindings): boolean {
  return findings.guideEndings.length > 0 || findings.hookType?.present === false
}

/** Stage 3에 넘기는 안내형 끝말 수 상한 */
export const GUIDE_FIX_LIMIT = 8

/** Stage 3 '고칠 곳' 블록 — 걸린 것이 없으면 빈 문자열(프롬프트 불변) */
export function buildCopyRuleFixBlock(findings: CopyRuleFindings, opts: { hookShort?: boolean } = {}): string {
  if (!hasCopyRuleViolations(findings)) return ''
  const lines: string[] = []
  for (const f of findings.guideEndings.slice(0, GUIDE_FIX_LIMIT)) {
    lines.push(
      `- [${f.path}] "${f.text.replace(/\n/g, ' ')}" — 보라고 안내하는 끝말 대신 고객이 얻는 효익이나 지금 사는 이유로 끝낸다`
    )
  }
  const type = findings.hookType
  if (type && !type.present) {
    const words = type.words.map((w) => `'${w}'`).join(' 또는 ')
    if (opts.hookShort) lines.push(`- [mainIntro] 첫 화면(benefitHeadline·subBenefit)에 상품 종류 낱말 ${words}이(가) 없다 — benefitHeadline에 먼저 넣고, 들어가지 않으면 subBenefit에 한 번 넣는다(hook에 넣으면 화면에 나오지 않는다)`)
    else lines.push(
      `- [mainIntro] 첫 화면(hook·benefitHeadline·subBenefit)에 상품 종류 낱말 ${words}이(가) 없다 — 셋 중 한 곳에 한 번 넣어 무엇을 파는지 보이게 한다(상품명 전체·옵션은 넣지 않는다)`
    )
  }
  return [
    '## [카피 규칙 — 고칠 곳(결정론 검사)]',
    "이 규칙으로는 아래 칸만 고친다(다른 검수 기준은 그대로 적용한다). 바꾼 필드는 _changed_fields에 적는다. 글자 수 한도·사실 값은 그대로 지키고, 입력에 없는 약속(배송·보증·기간·수치)은 넣지 않는다. '살펴보세요·확인하세요·만나보세요·소개합니다'로 끝내지 않는다.",
    ...lines,
  ].join('\n')
}
