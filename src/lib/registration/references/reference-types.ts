/**
 * 레퍼런스 입력(기존 상세페이지 캡처·PDF) — 오너 조건(2026-10-30): **레퍼런스 분석용으로만** 쓴다.
 * - 업로드 때 한 번 분석하고 파일·이미지는 저장하지 않는다(생성 참조 경로가 없다).
 * - 분석 산출(insights: 구조·설득 흐름·레이아웃 패턴·소구 유형)만 리서치에 덧붙임 블록으로 넣는다. 카피·이미지 단계에는 넣지 않는다.
 * - 받아쓴 원문(transcript)은 경쟁사 재현 가드·유사도 검사 전용이다(프롬프트 제외 — SPEC_PROMPT_EXCLUDED_KEYS).
 *   자사 기존 페이지(own)의 원문은 가드에서 뺀다 — 우리 자신의 기존 문구를 다시 쓰는 것은 막지 않는다.
 */

export const REFERENCE_KINDS = ['own', 'competitor', 'other'] as const
export type ReferenceKind = (typeof REFERENCE_KINDS)[number]

export const REFERENCE_LIMITS = {
  /** 잡당 레퍼런스 수 */
  perJob: 3,
  /**
   * 요청 본문 상한 — Vercel 함수의 요청 본문 상한(약 4.5MB) 안에 둔다(운영에서는 더 큰 파일이 라우트에 닿기 전에 막힌다).
   * 긴 캡처는 화면이 폭 860 띠 JPEG로 줄여 4MB 이하로 묶어 보내고(PR③), PDF는 4MB 이하만 받는다(통합 결정 2026-10-30)
   */
  imageMaxBytes: 4 * 1024 * 1024,
  pdfMaxBytes: 4 * 1024 * 1024,
  pdfMaxPages: 30,
  /** 이보다 좁은 캡처는 상세페이지로 보지 않는다(글자를 읽을 수 없다) */
  imageMinWidth: 500,
  /** 띠 표집 — 폭 860으로 줄이고(키우지 않음) 1,400px 띠를 80px 겹쳐 자른다. 길면 균등 표집해 16장까지 */
  stripWidth: 860,
  stripHeight: 1400,
  stripOverlap: 80,
  maxStrips: 16,
  /** 한 콜에 보내는 띠 수 — 앞 묶음의 마지막 섹션 역할을 다음 묶음에 넘긴다 */
  stripsPerCall: 8,
  transcriptMaxChars: 20_000,
  sectionsMax: 40,
  appealsPerSection: 4,
  appealMaxChars: 20,
  visualMaxChars: 60,
  moveMaxChars: 40,
  observationsMax: 4,
  observationMaxChars: 60,
  fileNameMaxChars: 120,
} as const

/** 섹션 역할 — 우리 설득 역할 어휘에 맞춘 분류(레퍼런스 쪽 표기는 버린다) */
export const REFERENCE_ROLES = [
  'hook',
  'problem',
  'solution',
  'usp',
  'proof',
  'howto',
  'spec',
  'option',
  'comparison',
  'faq',
  'cta',
  'shipping',
  'brand',
  'other',
] as const
export type ReferenceRole = (typeof REFERENCE_ROLES)[number]

/** 화면 표시용 역할 이름 — 저장값·리서치 블록은 영문 역할 그대로 둔다 */
export const REFERENCE_ROLE_LABELS: Record<ReferenceRole, string> = {
  hook: '후킹',
  problem: '문제 제기',
  solution: '해결',
  usp: '핵심 장점',
  proof: '근거',
  howto: '사용법',
  spec: '제원',
  option: '옵션·구성',
  comparison: '비교',
  faq: '자주 묻는 질문',
  cta: '구매 유도',
  shipping: '배송·교환',
  brand: '브랜드',
  other: '기타',
}

export const REFERENCE_LAYOUTS = [
  'full_photo',
  'two_column',
  'icon_grid',
  'table',
  'speech_bubble',
  'comparison',
  'before_after',
  'text_block',
  'collage',
  'banner',
  'other',
] as const
export type ReferenceLayout = (typeof REFERENCE_LAYOUTS)[number]

export const REFERENCE_DENSITIES = ['low', 'medium', 'high'] as const
export type ReferenceDensity = (typeof REFERENCE_DENSITIES)[number]

export interface ReferenceSection {
  /** 페이지 세로 위치(%) — 시작·끝 */
  start: number
  end: number
  role: ReferenceRole
  layout: ReferenceLayout
  /** 연출 한 줄(실사·모델·제품 단독·인포그래픽, 색감) */
  visual: string
  /** 설득 동작(공감→약속, 주장→근거 등) */
  move: string
  /** 소구 유형 — 일반화한 말(원문 문구가 아니다) */
  appeals: string[]
  density: ReferenceDensity
}

export interface ReferenceInsights {
  version: 1
  sections: ReferenceSection[]
  /** 역할 순서(코드가 만든다 — 예: hook → problem → usp ×3 → cta) */
  flow: string
  strengths: string[]
  weaknesses: string[]
  /** 원문에서 찾은 규제 표현 의심 수(규제 사전 — 수치만, 문구는 남기지 않는다) */
  regulatedSuspects: number
}

export interface ReferenceInput {
  id: string
  kind: ReferenceKind
  fileName: string
  source: 'image' | 'pdf'
  /** 분석한 띠 수(이미지) 또는 쪽 수(PDF) */
  units: number
  insights: ReferenceInsights
  /** 받아쓴 원문 — 가드 전용, 프롬프트에 넣지 않는다 */
  transcript: string
  costUsd: number
  analyzedAt: string
  warnings: string[]
}
