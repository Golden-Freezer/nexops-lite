// 정산 대조 분석 에이전트 프롬프트 — 규칙 대조표(ReconciliationRow)를 셀러 친화 자연어로 해설.
//
// llm-integration §2 "도메인 규칙 3중 주입": LLM이 어겨선 안 되는 핵심 규칙
// (수치를 새로 만들지 말 것)을 ① 시스템 프롬프트 ② 데이터 필드 프레이밍 ③ 유저 메시지
// 세 곳에 모두 명시한다. 한 곳만으로는 누락된다.

import type { SettlementAnalyzeInput } from '@/types/settlement-recon'

/** 핵심 불변 규칙 — 세 곳에 반복 주입한다. */
const TRUTH_RULE =
  '주어진 대조 데이터(우리 계산 vs 쿠팡 확정)가 절대 진실이다. 데이터에 없는 금액·비율을 ' +
  '지어내거나 새로운 항목을 추가하지 말 것. 너의 역할은 이미 계산된 대조 결과를 ' +
  '쿠팡 1인 셀러가 이해하기 쉬운 한국어로 재표현하는 것뿐이다 — 수치의 재계산·창작 금지.'

export function getAnalyzerSystemPrompt(): string {
  return `당신은 쿠팡 로켓그로스 셀러의 정산 대조 분석가입니다. 정산 시스템이 이미 계산한 ` +
    `"우리 예상 지급액 vs 쿠팡 확정 지급액" 대조 데이터를 받아, 차액이 왜 났는지 항목별로 귀속 설명합니다.\n\n` +
    `${TRUTH_RULE}\n\n` +
    `역할:\n` +
    `1. 차액을 만든 주요 항목을 귀속 설명한다(diff_attribution) — 각 라인의 ours/coupang/diff를 근거로.\n` +
    `2. ourBlindSpot=true인 항목은 "우리가 지금까지 못 잡던 비용"임을 셀러에게 명확히 알린다.\n` +
    `3. 귀속 라인들의 합으로 설명되지 않는 잔여 차액(설명 불가)은 이상 신호로 anomalies에 표시한다.\n\n` +
    `반드시 아래 JSON 형식으로만 응답하세요(코드블록·설명 없이 JSON 객체 하나):\n` +
    `{\n` +
    `  "headline": "이번 정산주기 차액 상황을 한 줄로",\n` +
    `  "summary": "2~3문장 종합 설명 (핵심 금액을 데이터 그대로 인용)",\n` +
    `  "diff_attribution": ["항목별 차액 귀속 설명", "..."],\n` +
    `  "anomalies": ["설명 불가/이상 신호 (없으면 빈 배열)"],\n` +
    `  "advice": ["셀러가 다음에 할 수 있는 조치", "..."]\n` +
    `}`
}

export function getAnalyzerUserPrompt(input: SettlementAnalyzeInput): string {
  const linesText = input.lines.length
    ? input.lines
        .map((l) => {
          const ours = l.ours === null ? '우리 계산 없음(우리가 못 잡던 항목)' : `${l.ours.toLocaleString()}원`
          const blindSpot = l.ourBlindSpot ? ' [ourBlindSpot]' : ''
          return `- ${l.label}: 우리=${ours} / 쿠팡=${l.coupang.toLocaleString()}원 / 차액=${l.diff.toLocaleString()}원${blindSpot}`
        })
        .join('\n')
    : '- (항목별 라인 없음)'

  return `아래는 "${input.periodLabel}"(정산주기 ${input.cycle ?? '알수없음'}) 정산 대조 데이터입니다. ` +
    `${TRUTH_RULE}\n\n` +
    `[요약]\n` +
    `- 쿠팡 확정 최종 지급액: ${input.coupangFinalPayout.toLocaleString()}원\n` +
    `- 우리 예상 지급액(보유 원장 기준): ${input.ourEstimatedPayout.toLocaleString()}원\n` +
    `- 실제 계좌입금 합: ${input.actualDeposit === null ? '데이터 없음' : `${input.actualDeposit.toLocaleString()}원`}\n` +
    `- 확정−예상 총차액: ${input.totalDiff.toLocaleString()}원\n\n` +
    `[항목별 대조 라인]\n${linesText}\n\n` +
    `위 데이터만을 근거로 분석 JSON을 생성하세요. 새로운 금액·비율을 지어내지 마세요.`
}
