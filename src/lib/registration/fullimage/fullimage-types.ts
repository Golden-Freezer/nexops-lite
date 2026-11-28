/**
 * 통이미지(편집 가능) 실험 — 기록 형식·섹션 표·승인 카피 추출. 순수, LLM·이미지 호출 없음.
 * 설계: .devflow-worktrees/nexops/PDP-FULLIMAGE-DESIGN.md(통합 승인 2026-10-30). 기능 스위치 fullimage(기본 off).
 *
 * 편집기에는 판독한 글자가 아니라 승인 카피 원문을 넣는다. 기본 표시는 언제나 '바탕 + 텍스트 요소'다.
 * 바탕 만드는 순서는 두 안을 같은 함수로 잰 뒤 정한다: A = 통이미지 → 글자 지운 바탕, B = 글자 자리 비운 바탕(G) → 글자 얹은 통이미지.
 */

import type { CopywritingResult } from '../pdp-state'

export type FullImageSection = 'hero' | 'main_cut' | 'cta'
export type FullImageOrder = 'A' | 'B'
export type CopyRole = 'headline' | 'sub' | 'support'

/** 이미지 기준 0~1 상자 */
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ApprovedLine {
  copyPath: string
  text: string
  role: CopyRole
}

export interface FullImageSectionSpec {
  section: FullImageSection
  /** 생성 비율(가로:세로) — 코덱스는 비율만 지킨다(±3%) */
  aspect: { w: number; h: number }
  copy: Array<{ path: string; role: CopyRole }>
  /** G(글자 자리 비운 이미지)의 글자 띠 — 이미지 높이 비율 */
  zone: { from: number; to: number }
}

/** 시작 대상 3개 섹션(설계 §3 섹션 표) */
export const FULLIMAGE_SECTIONS: Record<FullImageSection, FullImageSectionSpec> = {
  hero: {
    section: 'hero',
    aspect: { w: 3, h: 4 },
    copy: [
      { path: 'mainIntro.benefitHeadline', role: 'headline' },
      { path: 'mainIntro.subBenefit', role: 'sub' },
    ],
    zone: { from: 0, to: 0.35 },
  },
  main_cut: {
    section: 'main_cut',
    aspect: { w: 3, h: 4 },
    copy: [
      { path: 'mainCutCopy.headline', role: 'headline' },
      { path: 'mainCutCopy.subCopy', role: 'sub' },
    ],
    zone: { from: 0, to: 0.3 },
  },
  cta: {
    section: 'cta',
    aspect: { w: 4, h: 3 },
    copy: [
      { path: 'closingCta.headline', role: 'headline' },
      { path: 'closingCta.subtext', role: 'sub' },
    ],
    zone: { from: 0.3, to: 0.7 },
  },
}

/**
 * 역할별 글자 수 상한 — 하한 크기(제목 72·본문 45·라벨 32, 캔버스 860)로 폭 84% 안에 2줄(라벨 1줄)이 들어가는 어림값.
 * 넘는 제목은 그 섹션을 통이미지 대상에서 뺀다(G로). 넘는 보조 문구는 뺀다 — 줄이지 않는다
 */
export const ROLE_MAX_CHARS: Record<CopyRole, number> = { headline: 22, sub: 36, support: 12 }

export interface FullImageBlock {
  copyPath: string
  /** 승인 카피 원문(판독 글이 아님). 판독 줄바꿈이 원문과 같은 글이면 그 위치를 \n으로 남긴다 */
  text: string
  role: CopyRole
  box: TextBox
  lines: number
  color: string
  weight: 400 | 500 | 600 | 700 | 800 | 900
  family: 'sans' | 'display' | 'rounded'
  align: 'left' | 'center' | 'right'
}

export interface FullImageChecks {
  /** 승인 카피 중 통이미지에서 읽히지 않은 줄 */
  ocrMissing: string[]
  /** 승인 카피에 없는 글(새 문구·반복) */
  ocrExtra: string[]
  /** 판독 글에서 찾은 규제·연령·학부모 위반 */
  violations: string[]
  /** 표시 바탕에 남은 광고 글자(안 A의 지운 바탕, 안 B는 G 바탕) */
  residualText: string[]
  /** 글자 상자 밖 평균 절대차(0~255) — 안 A는 통이미지↔지운 바탕, 안 B는 G↔글자 얹은 통이미지 */
  drift: number | null
  /** 하한까지 올린 텍스트 요소 수 */
  raisedToFloor: number
  retries: { generate: number; background: number }
}

export interface FullImageRecord {
  version: 1
  order: FullImageOrder
  /** overlay = 바탕 + 판독 블록, fallback = G(글자 자리 비운 이미지 + 섹션 기본 배치) */
  mode: 'overlay' | 'fallback'
  /** 글자가 든 통이미지 — 비교용 보관, 페이지에 그대로 쓰지 않는다 */
  sourceUrl: string | null
  /** 표시 바탕 */
  backgroundUrl: string
  /** 실제 가로/세로 */
  aspect: number
  blocks: FullImageBlock[]
  checks: FullImageChecks
  fallbackReason?: string
}

function readPath(copy: CopywritingResult, path: string): string {
  let cur: unknown = copy
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return ''
    cur = (cur as Record<string, unknown>)[key]
  }
  return typeof cur === 'string' ? cur.trim() : ''
}

/** 줄바꿈을 지운 글자 수(서로게이트 쌍은 한 글자) */
const glyphCount = (text: string) => [...text.replace(/\s*\n\s*/g, ' ')].length

/** 연령 고지('만 N세 이상', compliance-gate ageNoticePhrase와 같은 골격)가 든 줄은 뺄 수 없다 — 넘치면 섹션째 G로 */
const REQUIRED_LINE = /만 \d+세 이상/

/**
 * 섹션의 승인 카피 줄 — 빈 칸은 빼고, 상한을 넘는 보조·부제는 뺀다(줄이지 않는다). 제목이 없거나 상한을 넘으면, 또는 연령 고지 줄이
 * 넘치면 eligible=false(G로)
 */
export function approvedLinesFor(
  spec: FullImageSectionSpec,
  copy: CopywritingResult
): { lines: ApprovedLine[]; dropped: string[]; eligible: boolean } {
  const lines: ApprovedLine[] = []
  const dropped: string[] = []
  let eligible = true
  for (const { path, role } of spec.copy) {
    const text = readPath(copy, path)
    if (!text) {
      if (role === 'headline') eligible = false
      continue
    }
    if (glyphCount(text) > ROLE_MAX_CHARS[role]) {
      if (role === 'headline' || REQUIRED_LINE.test(text)) eligible = false
      dropped.push(path)
      continue
    }
    lines.push({ copyPath: path, text, role })
  }
  return { lines, dropped, eligible: eligible && lines.some((l) => l.role === 'headline') }
}
