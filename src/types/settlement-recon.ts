// 정산 대조(Settlement Reconciliation) 공유 타입 — 수집·대조·AI 해설이 공유하는 계약.
// 근거: docs/plans/settlement-recon/DESIGN.md, docs/reports/wing-settlement-recon-20260713.md

/** 확장이 윙에서 수확해 /api/settlement/collect로 보내는 원본 페이로드. */
export interface SettlementCollectPayload {
  vendorId: string
  /** POST /tenants/rfm/v2/settlements/status/api 의 settlementStatusReports 원본 */
  reports: RawSettlementReport[]
  /** POST /tenants/rfm/v2/wallet/histories/search/api 의 walletHistories 원본 */
  walletEvents: RawWalletEvent[]
}

/** 윙 정산현황 API 원본 리포트(주요 필드만 선언, 나머지는 detail로 보존). */
export interface RawSettlementReport {
  settlementCycle?: string
  settlementRatio?: number
  finalSettlementAmount?: number
  settlementGroupKey: string
  settlementDate?: string
  settlementPeriodStartDate?: string
  settlementPeriodEndDate?: string
  settlementStatusReportDetail?: Record<string, unknown>
}

/** 윙 지갑 이력 API 원본 이벤트. bankAccountOwner 등 PII는 수집 라우트에서 제외. */
export interface RawWalletEvent {
  walletEventId: string
  walletEventType?: string
  paymentDate?: string
  amount?: number
}

/** 한 정산주기의 3열 대조 행 — UI·AI가 공유. */
export interface ReconciliationRow {
  settlementGroupKey: string
  cycle: string | null
  periodStart: string | null
  periodEnd: string | null
  settlementDate: string | null
  /** 쿠팡 확정 최종 지급액 */
  coupangFinalPayout: number
  /** 보유 원장으로 계산한 우리 예상 지급액(순이익과 다른 정산금 개념) */
  ourEstimatedPayout: number
  /** 실제 계좌 입금 합(같은 정산일 전후 wallet AUTO_WITHDRAWAL) */
  actualDeposit: number | null
  /** 항목별 대조 라인 */
  lines: ReconciliationLine[]
  /** 쿠팡 확정 지급액 − 우리 예상 지급액 */
  totalDiff: number
}

export interface ReconciliationLine {
  label: string
  /** 우리 계산값(없으면 null — 우리가 못 잡는 항목) */
  ours: number | null
  /** 쿠팡 확정값 */
  coupang: number
  diff: number
  /** 우리 마진공식에 대응 항목이 없는 '신규 확보' 비용인지 */
  ourBlindSpot: boolean
}

/** analyzer-agent 입력(수치는 규칙이 정본, LLM은 해설만). */
export interface SettlementAnalyzeInput {
  cycle: string | null
  periodLabel: string
  coupangFinalPayout: number
  ourEstimatedPayout: number
  actualDeposit: number | null
  totalDiff: number
  lines: ReconciliationLine[]
}

/** analyzer-agent 출력. */
export interface SettlementAnalysisOutput {
  headline: string
  summary: string
  /** 차액을 만든 주요 항목 귀속 서술 */
  diff_attribution: string[]
  /** 설명 불가/이상 신호 */
  anomalies: string[]
  advice: string[]
}
