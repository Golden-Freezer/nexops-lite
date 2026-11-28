/**
 * 상세페이지 단계별 모델 지정(묶음 1 모델 계층) — 단계 이름 키 한 곳에서 정한다. 기록 잡 여부와 관계없다(통합 조건 ③).
 * 기본 모델은 웹·로컬이 같은 한 표다(pdp-model-refresh, 통합 결정 2026-10-29): 구조화 추출은 Haiku 5.5, 생성·설계·비전은
 * Sonnet 5.5(thinking 끔 = between_tools), 교차 강화 copy/stage2는 gpt-6.1-sol API. 상한은 이전 표 그대로다.
 * 폴백은 두지 않는다(오너 결정: 단계별 고정 모델만, 결정 E). 이미지 생성 모델은 잡이 고른다(agents/image, 여기 없음).
 * 지금 기본 표는 Claude·GPT만 쓴다(오너 2026-10-29). 오너 2026-11-07 18:53 방침("GEMINI와 이미지 생성 등 꼭 API를 사용하는 것을
 * 제외하고 구독")에 따라 Gemini는 API 단계로 받는다 — gemini-4-argon(thinkingLevel low·medium·high)을 PDP 단계에 두면 callLlm이 막지
 * 않는다(R02, agents/llm/llm-gemini-pdp.test.ts). 새 배치 표(게이트·식별 카드 Argon high 등)는 R03에서 이 표와 따로 둔다.
 *
 * 에이전트는 표를 직접 읽지 않고 pdpRoute(단계)로 받는다(pdp-llm-subscription-backend). 지금 배치는 로컬 실행기 env로만 바뀐다 —
 * 운영 실행(Vercel·Railway 구독 작업자, enrichment-switch isHostedPdpEnv)이면 무시:
 * - NEXOPS_PDP_LLM_BACKEND=subscription: OpenAI 단계(지금은 copy/stage2)를 코덱스 구독(codex exec)으로 보낸다(API 비용 0).
 * - NEXOPS_PDP_MODEL_ARM=M: 모델 상향 비교 갈래(오너 시험 요청, 측정은 C) — Claude 단계는 claude-opus-5-5(thinking을 끌 수 없어
 *   disableThinking 대신 단계별 effort, thinking 몫만큼 상한 확대), GPT 단계는 gpt-6.1-sol(구독, effort high).
 * 둘 다 없으면 표 그대로다. 구독 백엔드가 등록되지 않았거나 한도가 소진되면 API로 넘어가지 않고 멈춘다.
 * 새 배치 구독(R13)은 env가 아니라 잡 표지(spec_sheet modelBackend 'subscription' — 잡 생성 때 정한다)로만 켜진다(subscriptionRoute).
 *
 * 모델 이름은 agents/llm/registry.ts에 등록된 것만 쓴다 — 시험(pdp-model-routes.test.ts)이 확인한다.
 */

// 공급자(SDK)를 끌어오지 않게 순수 표·타입만 가져온다
import { lookupLlmModel } from '@/lib/agents/llm/registry'
import type { LlmEffort, LlmRoute } from '@/lib/agents/llm/types'
import { isHostedPdpEnv } from './enrichment-switch'
import type { PdpModelBackend, PdpModelBatch } from './pdp-model-batch'
import { currentPdpBackend, currentPdpBatch, currentPdpSubscriptionStop } from './pdp-model-batch-context'
import type { NewStageRouteName } from './new-stages/common'

/**
 * maxTokensSteps: 파싱 실패·시간 초과 때 다음 상한으로 한 번 올린다(agents/registration/token-steps.ts, Vercel에서는 첫 값만).
 * callTimeoutMs·callMaxRetries: 새 배치 표만 둔다(R03) — 에이전트가 자기 시간 제한·재시도 대신 쓴다. 없으면 에이전트에 박힌 지금 값
 */
export type PdpModelRoute = LlmRoute & {
  maxTokensSteps?: readonly number[]
  callTimeoutMs?: number
  callMaxRetries?: number
}

const LOCAL_CODEX_STAGE_TIMEOUT_MS = 30 * 60_000

export const PDP_MODEL_ROUTES = {
  // 분석 — 원본 premium_analysis_model(Gemini) 대응, 구조화 추출은 Haiku로 충분(설계문서 결정 C). Haiku 5.5는 temperature를
  // 받지 않고(기본값이 아니면 400) adaptive thinking이 기본이라 끈다(effort 미지정 = 기본 medium, 끄기 조건 high 이하)
  // 600: 응답이 category·confidence·한국어 reasoning JSON이라 Haiku 5.5 smoke에서 출력 262토큰(이전 상한 300의 87%) — 잘리면
  // 'household' 폴백으로 섹션 구성·이미지 톤이 바뀐다(2026-10-29 smoke, 통합 결정). 상한은 쓴 만큼만 과금
  'analysis/category': { model: 'claude-haiku-5-5', maxTokens: 600, disableThinking: true },
  // 4096: 리뷰가 긴 상품에서 분석 JSON이 잘려 최소 필드 폴백으로 떨어지는 것 방지 — NEXFIT 51c8174
  analysis: { model: 'claude-haiku-5-5', maxTokens: 4096, disableThinking: true },
  // 경쟁사 리뷰 불만 유형(pdp-review-input) — 경쟁사 파일이 있는 잡만 본 분석과 따로 한 콜. 구조화 추출이라 분석과 같은 모델
  'analysis/competitor-reviews': { model: 'claude-haiku-5-5', maxTokens: 2000, disableThinking: true },
  // 레퍼런스 분석(기존 상세 캡처 띠·PDF, 분석 전용 — 업로드 때 1회) — 레이아웃 판독이라 Sonnet(통합 결정 2026-10-30).
  // 8000: 띠 8장 받아쓰기 + 구간 JSON
  'analysis/reference': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
  // 리서치 — 원본 Gemini 3 Pro 대응. 4.6~4.8k 출력에서 잘린 이력(2026-10-27 T5) → 8000, 실패 시 16000.
  // Sonnet 5.5 단계는 모두 thinking 끔(between_tools, effort 미지정 = 기본 high)·temperature 없음
  research: { model: 'claude-sonnet-5-5', maxTokens: 8000, maxTokensSteps: [8000, 16000], disableThinking: true },
  // 설계 콜 ① — 섹션 20개 스펙+폰트 스킴 JSON이 3000을 넘어 잘리던 실측(2026-08-10) → 8000
  'design/section-planning': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
  // 후기 속 실제 질문(reviewfaq 잡만) — 후기를 읽어 원문을 옮기는 구조화 추출이라 경쟁사 리뷰 콜과 같이 Haiku. 6건 × 3칸 → 1500
  'design/review-faq': { model: 'claude-haiku-5-5', maxTokens: 1500, disableThinking: true },
  // 템플릿 조합 라인(K, templatelib 잡만) — 목록에서 고르기만 하는 짧은 JSON. 설계 단계와 같은 모델이고 쓴 만큼만 과금된다.
  // 선택은 자리 22개 × 이유 한 문장이라 넉넉히 둔다
  'design/template-guideline': { model: 'claude-sonnet-5-5', maxTokens: 1500, disableThinking: true },
  'design/template-compose': { model: 'claude-sonnet-5-5', maxTokens: 2000, disableThinking: true },
  'design/template-select': { model: 'claude-sonnet-5-5', maxTokens: 4000, disableThinking: true },
  // 움직이는 칸 고르기(motionband 잡만, 움직이는 칸 자리 규칙 ②) — 후보 칸 목록에서 2칸까지 고르고 까닭 한 문장. 짧은 JSON이라 800
  'design/motion-pick': { model: 'claude-sonnet-5-5', maxTokens: 800, disableThinking: true },
  // K 색 조합 비전 고르기(palettepick 잡만, 결정 카드 c28·하네스 J26) — 원본 사진 + 견본 3장에서 하나와 이유 한 문장. 움직이는 칸 고르기와 같은 모델·설정
  // (비전도 지금 표는 Sonnet 5.5 생각 끔), 답이 짧은 JSON이라 400. 새 배치 덮기는 없다(지금 표 값 그대로)
  'design/palette-pick': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
  // 설계 콜 ② — 잘리지 않은 실 응답 8,948~9,192토큰(2026-10-27 P03) → 12000, 실패 시 16000(SDK 비스트리밍 한도 안)
  'design/prompt': {
    model: 'claude-sonnet-5-5',
    maxTokens: 12000,
    maxTokensSteps: [12000, 16000],
    disableThinking: true,
  },
  // 템플릿 조합 라인 슬롯 카피 — 22섹션의 칸을 한 번에 쓴다(계획 추정 약 $0.15). 카피 단계와 같은 모델, 문제 있는 섹션만 한 번 더 부른다
  'copy/template-slots': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
  // 카피 — premium 1콜과 pro Stage 1이 같은 구조 프롬프트·설정
  'copy/structural': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
  // Stage 2 — 교차 모델 강화(결정 C). 추론형이라 temperature 없음. 구조를 지키며 스토리텔링을 다듬는 단계라 깊은 추론보다 문장
  // 품질이 중요해 effort는 모델 기본값인 medium을 명시한다(M 갈래는 high). 출력 상한에는 추론 토큰도 들어 8192 → 16000
  // (Stage 1 JSON 약 4~5k 토큰 전체 재작성 + 추론 — 잘리면 파싱 실패 유료 재시도. 상한은 쓴 만큼만 과금)
  'copy/stage2': { model: 'gpt-6.1-sol', maxTokens: 16000, effort: 'medium' },
  'copy/stage3': { model: 'claude-sonnet-5-5', maxTokens: 8000, disableThinking: true },
  'copy/retry-pointcards': { model: 'claude-sonnet-5-5', maxTokens: 1000, disableThinking: true },
  // 편집기 카피 재생성(묶음 5, pdp-copy-regen-api) — 텍스트 한 칸에 후보 3개 JSON, 요청마다 1콜. 카피 단계와 같은 모델,
  // 폴백 없음. temperature 없음(400 이력)
  'copy/editor-regen': { model: 'claude-sonnet-5-5', maxTokens: 1000, disableThinking: true },
  // 생성 화면 자동 작성(PDP-W2W3 계약 v1 §2-2) — 잡 생성 전 화면 요청마다 1콜, 페르소나·보이스·컬러 JSON. 카피 계열 Sonnet 5.5,
  // thinking 끔(계약), 폴백 없음. 응답 글 상한 200+400자 + JSON — 1500은 여유(쓴 만큼만 과금)
  'copy/auto-fill': { model: 'claude-sonnet-5-5', maxTokens: 1500, disableThinking: true },
  // 이미지 단계 비전 — 식별 카드(잡당 1콜)·생성 컷 게이트(컷당)·강조 장식 위치(컷당). 식별 카드는 인쇄물 여러 장 카드(도안 최대 4개,
  // 120단어 + 인용 글자)가 잘리지 않게 400(한 장 카드는 50단어라 그대로 짧다 — 쓴 만큼만 과금)
  'images/identity': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
  'images/gate': { model: 'claude-sonnet-5-5', maxTokens: 500, disableThinking: true },
  // GIF 칸 3×3 프레임 모음 검사(motion/stage-deps judgeSheet) — 지금 배치는 게이트와 같은 값(요청 바이트 그대로). 새 배치에서 나뉜다(R03)
  'images/gif-gate': { model: 'claude-sonnet-5-5', maxTokens: 500, disableThinking: true },
  'images/annotation': { model: 'claude-sonnet-5-5', maxTokens: 400, disableThinking: true },
  // 원본 합성 자격 판정(묶음 4) — 원천 사진 1장, 잡당 1콜, 폴백 없음. NEXFIT은 Gemini였지만 PDP는 Claude·GPT만 쓴다(오너
  // 2026-10-29) → 다른 비전 단계(식별 카드·게이트·장식)와 같은 모델(공급처 글자·워터마크 판독).
  // 응답은 키 5개 + 사유 JSON(텍스트 파싱) — thinking을 꺼 상한을 출력에 다 쓴다
  'images/composite-eligibility': { model: 'claude-sonnet-5-5', maxTokens: 600, disableThinking: true },
} as const satisfies Record<string, PdpModelRoute>

export type PdpModelStage = keyof typeof PDP_MODEL_ROUTES

export const PDP_MODEL_STAGES = Object.keys(PDP_MODEL_ROUTES) as PdpModelStage[]

/**
 * 새 배치(R03) — 오너 2026-11-08 ② 모델 최종 선택 + ③ 운영 반영 1~2(게이트 4,000·식별 카드 2,000) + R06 5차 확정(오너 14:4x:
 * 카피 1단 Sol high → Opus medium 상한 12,000, 설계② Opus xhigh → Sol medium — ③ 3·4의 설계② 28,000·카피 1단 180초는 이 교체로
 * 새 배치에서 쓰지 않는다. 28,000 스트리밍 경로(R02 _base.ts)는 남는다).
 * 단계 모델·등급이 바뀌면 이 표 한 곳만 고친다. 여기 없는 단계는 지금 표 값 그대로다(오너 표 밖 — 분석·움직이는 칸
 * 고르기 같음, 재생성·장식·합성 자격·자동 작성 등은 그대로). 교차 판정은 두지 않는다.
 * 콜 시간 = 4·5차 실측 지연(B grade-table.json latencyS·C 5차 v5-results) + 여유: 리서치 Sol medium 100.6초 → 150초, 설계① Opus
 * high 47.5초 → 120초, 설계② Sol medium 5차 중간 92초(최대 96초) → 150초(설계 단계 280초 기한 안 — 설계①과 합쳐 270초), 카피 1단
 * Opus medium 5차 중간 83초(최대 98초) → 120초 + 재시도 1(재시도 수는 ③ 그대로),
 * K 계획 Opus medium 35.6초 → 90초, 식별 카드 Argon high 28.5초 → 90초. 나머지는 에이전트 지금 값 안이다(카피 2단 Opus low
 * 31.0초·3단 37.4초 / 120초, K 칸 카피 Sol low 13.2초 / 120초, 게이트 Argon high 19.5초 / 60초(R12e에서 90초 — 아래), GIF 검사 Opus xhigh 8.4초 /
 * 40초·재시도 0 그대로). 게이트·식별 카드·GIF 검사·카피 1단은 잘림 감지(R02 failOnTruncation) — GIF 검사 Opus xhigh 4차 출력 평균 831토큰
 * (생각 458)이라 지금 상한 500이면 잘린다 → 게이트와 같은 4,000
 */
export const PDP_NEW_BATCH_OVERRIDES = {
  research: {
    model: 'gpt-6.1-sol',
    maxTokens: 8000,
    maxTokensSteps: [8000, 16000],
    effort: 'medium',
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
  },
  'design/section-planning': { model: 'claude-opus-5-5', maxTokens: 8000, effort: 'high', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  // R06 5차(오너 14:4x) — Sol medium: 생각 포함 출력 최대 4,294토큰이라 지금 상한·단계 [12000, 16000] 그대로 안에 든다(스트리밍 불필요).
  // GPT 경로라 잘림 감지(failOnTruncation)는 두지 않는다(callLlm이 OpenAI 경로에서 막는다) — 잘리면 단계 목록으로 한 번 더 부른다
  'design/prompt': {
    model: 'gpt-6.1-sol',
    maxTokens: 12_000,
    maxTokensSteps: [12_000, 16_000],
    effort: 'medium',
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
  },
  // R06 5차(오너 14:4x) — Opus medium: 생각 포함 출력 최대 10,176토큰(상한 8,000이면 4콜 중 3콜 잘림) → 12,000, 잘림 감지(R02).
  // R11d(오너 2026-11-09 13:2x '16,000으로 올리기') — R11 P07 출력이 12,000의 86~100%(ff8b9c85 첫 시도 12,000/110초 잘림, 다시 11,384/103초)
  // → 16,000(비스트리밍 경계 21,333 안). 콜 시간은 그 실측 속도(초당 약 109토큰)면 16,000에 약 147초라 120초 → 165초(안 올리면 상한 전에
  // 시간 초과로 끝난다). 다시 부르기는 run 280초 기한 안에서만(남은 시간으로 줄어든다 — agents/deadline)
  // J34(오너 위임 I6-2, 통합 decide 15 ③ — c21 원문 카피 블라인드 판 Gemini argon 5승 1패 > Opus 4승 2패 > Sol 0승 6패) — 원문 카피 3단을
  // gemini-4-argon으로. 상한·등급·콜 시간·재시도는 c21 후보(model-compare-repro copyModelRoutes)와 같다. 다른 점은 1단 잘림 감지 하나 —
  // c21 후보는 셋 다 잘림 감지를 뺐고(흔적으로 잘림 의심만 남김) 여기는 1단에 그대로 둔다(Gemini API 경로가 본다, 요청 바이트는 같다).
  // c21 argon 출력 최대 1단 2,681·2단 2,255·3단 2,405토큰(상한 16,000·16,000·8,000), 잡당 0.112~0.139달러(12-01부터 단가 두 배).
  // 콜 시간(통합 decide 18): c21 argon 지연(ai_usage_log) 1단 40.9~65.3초·2단 31.8~110.8초·3단 30.3~78.8초 — 2단 110.8초가 에이전트 값 120초에
  // 가까워 2단·3단을 150초로 둔다(에이전트가 route callTimeoutMs를 읽는다, 재시도 수·run 280초 기한은 그대로 — 남은 시간이 짧으면 그만큼 준다).
  // c21 후보와 다른 점은 둘이다 — 1단 잘림 감지 유지, 2단·3단 콜 시간 150초(요청 바이트는 같다).
  // Gemini는 구독이 없어 구독 표지 잡도 API로 부른다(subscriptionRoute)
  'copy/structural': {
    model: 'gemini-4-argon',
    maxTokens: 16_000,
    effort: 'medium',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
  'copy/stage2': { model: 'gemini-4-argon', maxTokens: 16000, effort: 'low', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  'copy/stage3': { model: 'gemini-4-argon', maxTokens: 8000, effort: 'low', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  'design/template-guideline': { model: 'claude-opus-5-5', maxTokens: 1500, effort: 'medium', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  'design/template-compose': { model: 'claude-opus-5-5', maxTokens: 2000, effort: 'medium', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  'design/template-select': { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'medium', callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS },
  // J34b(오너 위임 I6-2, 통합 decide 25 — c21 칸 글 잡 입력 판 1c8a6658c5 Gemini argon 5승 1패 > Opus 3승 1무 2패 > Sol 0승 1무 5패,
  // 잘림·오류 0) — 칸 글 모델 gpt-6.1-sol low → gemini-4-argon low. 상한 8,000·등급·잘림 감지 없음은 c21 후보(hook-models-repro
  // HOOK_MODEL_ROUTES.argon)와 같다. c21 잡 입력 argon 칸 글 잡당 0.024~0.031달러(12-01부터 단가 두 배). Gemini는 구독이 없어 구독 표지 잡도 API다
  'copy/template-slots': { model: 'gemini-4-argon', maxTokens: 8000, effort: 'low' },
  'images/identity': {
    model: 'gemini-4-argon',
    maxTokens: 2000,
    effort: 'high',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
  },
  // R12e — 4차 중간 19.5초였지만 R13 운영 잡 96872abb에서 성공 콜이 18.5~58.8초, 28콜 중 3콜이 60초 시간 초과(시도 1)였다 → 콜 시간
  // 60초 → 90초(성공 최대의 1.5배), 재시도 2 → 1. 최악 소요 = 받기 25초 + 2시도 × 90초 + 백오프 1초 = 206초로 지금(25 + 3 × 60 + 3 = 208초)
  // 안이다. run 남은 시간이 모자라면 게이트가 시도 시간을 줄인다(pdp-image-stage judgeSection)
  'images/gate': {
    model: 'gemini-4-argon',
    maxTokens: 4000,
    effort: 'high',
    json: true,
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
  // GIF 검사는 부르는 쪽이 늘 40초·재시도 0을 준다(motion/stage-deps SHEET_GATE_LIMITS, 실측 8.4초) — R12e에서 그대로
  'images/gif-gate': { model: 'claude-opus-5-5', maxTokens: 4000, effort: 'xhigh', failOnTruncation: true },
} as const satisfies Partial<Record<PdpModelStage, PdpModelRoute>>

/** 새 배치 단계 표 — 지금 표 위에 새 배치 값을 덮는다(단계 이름은 같다) */
export const PDP_MODEL_ROUTES_NEW: Readonly<Record<PdpModelStage, PdpModelRoute>> = {
  ...PDP_MODEL_ROUTES,
  ...PDP_NEW_BATCH_OVERRIDES,
}

/** 설계·리서치 단계 기한(새 배치만) — run 300초 안에서 단계가 끝나게(PRD 2.1 설계 280초 기한, 리서치도 같은 run 상한) */
export const PDP_NEW_BATCH_STAGE_DEADLINE_MS = 30 * 60_000

/**
 * 새 단계 5개(R10, 새 배치 + newstages 기록 잡만 — pdp-new-stages-stage) — 지금 표에는 없다(지금 배치 잡은 부르지 않는다).
 * 모델·등급 = 하네스 R10 완료 조건(통합 11-08 판정표: 기획 Opus xhigh·사실 감사 Sonnet xhigh(R11d에서 Opus xhigh로 — 아래)·연출 감독 Opus low·
 * 첫 화면 심사 Opus low·최종 검수 Opus xhigh). R06(5차 확정)에서 바뀌면 이 표 한 곳만 고친다. Opus는 생각을 끌 수 없고 Sonnet xhigh는 생각 끄기와 함께 못 둔다.
 * 상한·콜 시간 = C 4차 실측(text-v4.md 출력 토큰·지연, 생각 포함) + 여유, 모두 SDK 비스트리밍 경계(21,333) 안:
 * 기획 12,830토큰·128초 → 20,000·240초(재시도 0 — 다시 부르면 run 300초를 넘는다), 사실 감사 7,547토큰·51초 → 16,000·150초(화면 글 줄 수에
 * 따라 는다), 연출 감독 3,988토큰·39초 → 8,000·120초, 최종 검수 3,185토큰·32초 → 8,000·150초. 첫 화면 심사(비전)는 파이프라인에 렌더러가
 * 없어 지금은 부르지 않는다(웹 '생략' 기록) — 값은 2차 블라인드 캡처 심사용 자리다. 모두 잘림 감지(failOnTruncation)
 * 긴 상품 점검(하네스 R11b, R11 P05 K10-NS 잡 fb4b19b4 — 20섹션·33컷): 사실 감사가 한 콜로 16,000에서 두 번 잘렸다(입력 11,785토큰, 콜당 약
 * 104초). 사실 감사는 화면 글을 40줄·1,500자 묶음으로 나눠 동시에 부르고(fact-audit FACT_AUDIT_LINES_PER_CALL — R11c: P07 7d9ee39a 한 콜 19,120/20,000)
 * 상한을 20,000(초당 약 148토큰이면 약 135초 — 콜 시간 150초 안)으로 올렸다. 최종 검수 5,267/8,000(47초, 여유 1.5배 — 가장 얇다)은
 * 12,000(초당 약 112토큰이면 약 107초 — 150초 안)으로 올렸다. 기획 11,357/20,000(106초/240초)·연출 감독 4,346/8,000(39초/120초)은
 * 여유 1.8배 안팎이라 그대로다. 잘린 답은 같은 상한·입력으로 다시 부르지 않는다(new-stages runNewStageCall retryTruncated false)
 * 사실 감사 모델(하네스 R11d, 오너 2026-11-09 13:2x '카피 감사는 OPUS 5.5 XHIGH로') — Sonnet 5.5 xhigh → Opus 5.5 xhigh(상한 20,000·40줄
 * 묶음 그대로). 카피 뒤 감사와 K 칸 카피 뒤 감사가 이 route 하나를 같이 쓴다. 콜 시간은 Opus xhigh 실측(fb4b19b4 기획 11,357토큰/106초 —
 * 초당 약 107토큰)이면 20,000에 약 187초라 150초 → 200초(+ 저장 여유 20초 = 220초 ≤ run 280초, newStageFits). 단가는 Sonnet의 2배다
 */
export const PDP_NEW_STAGE_ROUTES = {
  'research/page-plan': {
    model: 'claude-opus-5-5',
    maxTokens: 20_000,
    effort: 'xhigh',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 0,
  },
  'copy/fact-audit': {
    model: 'claude-opus-5-5',
    maxTokens: 20_000,
    effort: 'xhigh',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
  'images/director': {
    model: 'claude-opus-5-5',
    maxTokens: 8000,
    effort: 'low',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
  'compose/first-screen': {
    model: 'claude-opus-5-5',
    maxTokens: 2000,
    effort: 'low',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
  'compose/final-review': {
    model: 'claude-opus-5-5',
    maxTokens: 12_000,
    effort: 'xhigh',
    failOnTruncation: true,
    callTimeoutMs: LOCAL_CODEX_STAGE_TIMEOUT_MS,
    callMaxRetries: 1,
  },
} as const satisfies Record<NewStageRouteName, PdpModelRoute>

/**
 * 새 단계 route — 새 배치 잡만 부른다(지금 배치 잡에 새 단계 값이 없다 — 조용히 다른 표로 가지 않고 throw).
 * 로컬 env 갈래·구독 스위치와 섞이면 새 배치 단계와 같이 throw한다(newBatchRoute)
 */
export function pdpNewStageRoute(
  name: NewStageRouteName,
  env: PdpRouteEnv = process.env,
  batch: PdpModelBatch = currentPdpBatch(),
  backend: PdpModelBackend = currentPdpBackend(),
  subscriptionStop: boolean = currentPdpSubscriptionStop()
): PdpModelRoute {
  if (batch !== 'new') throw new Error(`새 단계 route는 새 배치 잡만 씁니다: ${name}(${batch} 배치)`)
  assertNewBatchEnv(env)
  return backend === 'subscription'
    ? subscriptionRoute(PDP_NEW_STAGE_ROUTES[name], subscriptionStop)
    : PDP_NEW_STAGE_ROUTES[name]
}

/** M 갈래 모델 — Claude·GPT 각 역할 최신 상위 모델(오너 지시 2026-10-29). claude-fable-5-1은 Opus보다 위 등급이라 선택지로만 둔다 */
export const M_ARM_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-6.1-sol' } as const

/**
 * M 갈래 Claude 단계 effort — Opus 5.5는 thinking을 끌 수 없어(기본 medium) 지금의 'thinking 끔'에 가장 가까운 low를 기본으로 두고,
 * 생성·설계 판단이 무거운 단계(리서치·섹션 설계·디자인 프롬프트·카피 구조·검수)만 medium. 측정(C)에서 조정한다
 */
const M_ARM_CLAUDE_EFFORT: Partial<Record<PdpModelStage, LlmEffort>> = {
  research: 'medium',
  'design/section-planning': 'medium',
  'design/prompt': 'medium',
  'copy/structural': 'medium',
  'copy/stage3': 'medium',
}
const M_ARM_DEFAULT_EFFORT: LlmEffort = 'low'
/** M 갈래 GPT 단계 — 교차 강화 단계라 추론을 넉넉히 */
const M_ARM_GPT_EFFORT: LlmEffort = 'high'
/** thinking 몫 상한 확대 — 1.5배와 +2000 중 큰 값, 비스트리밍 SDK 한계(약 21k) 안의 20000까지 */
const M_ARM_MAX_TOKENS_CAP = 20000
/**
 * M 갈래 Claude 단계 시간 제한 배율 — 에이전트마다 정한 시간 제한(디자인 프롬프트 90초 등)은 thinking을 끈 Sonnet 기준이라
 * (9,181토큰 약 69초) thinking이 켜진 Opus에는 짧다. 시간 초과 → 유료 재시도·기본값 폴백으로 비교가 오염되지 않게 늘린다(검수
 * 지적). 상한일 뿐이라 비용은 늘지 않는다. 실측(C)으로 조정한다
 */
export const M_ARM_TIMEOUT_SCALE = 3

export function mArmMaxTokens(maxTokens: number): number {
  return Math.min(M_ARM_MAX_TOKENS_CAP, Math.max(maxTokens + 2000, Math.ceil(maxTokens * 1.5)))
}

/** VERCEL·VERCEL_ENV·NEXOPS_PDP_HOSTED·NEXOPS_PDP_LLM_BACKEND·NEXOPS_PDP_MODEL_ARM만 읽는다(process.env 그대로 받는다) */
export type PdpRouteEnv = Record<string, string | undefined>

function mArmRoute(stage: PdpModelStage, base: PdpModelRoute): PdpModelRoute {
  const provider = lookupLlmModel(base.model)?.provider
  if (provider === 'openai') {
    return { model: M_ARM_MODELS.openai, maxTokens: base.maxTokens, effort: M_ARM_GPT_EFFORT, backend: 'subscription' }
  }
  if (provider !== 'anthropic') throw new Error(`M 갈래에 대응 모델이 없는 단계입니다: ${stage}(${base.model})`)
  return {
    model: M_ARM_MODELS.anthropic,
    maxTokens: mArmMaxTokens(base.maxTokens),
    ...(base.maxTokensSteps ? { maxTokensSteps: base.maxTokensSteps.map(mArmMaxTokens) } : {}),
    effort: M_ARM_CLAUDE_EFFORT[stage] ?? M_ARM_DEFAULT_EFFORT,
    timeoutScale: M_ARM_TIMEOUT_SCALE,
  }
}

/**
 * 구독 표지 잡(R13)의 단계 route — Claude·GPT 단계를 구독으로 부르고 막히면 같은 route를 API로 한 번 잇는다(오너 I4-1·I2-3,
 * subscriptionFallback 'api'). 구독으로 같은 설정을 지킬 수 없는 단계는 API 그대로다:
 * - Gemini(식별 카드·게이트·원문 카피 3단 Argon) — 구독이 없다(이미지 MS 2k도 API, 여기 밖)
 * - thinking 끄기(disableThinking — 분석 Haiku·지금 표 Sonnet 단계) — CLI는 생각을 끄지 못한다(C 4차 "CLI off≠끔", 같은 모델·같은 설정이 깨진다)
 * - GPT 단계의 잘림 감지(failOnTruncation) — 코덱스는 잘림을 알 수 없다(지금 새 배치 GPT 단계에는 없다)
 * - 공급자 JSON 강제(json) — CLI에 없다
 *
 * 구독 멈춤 표지 잡(AX-CT-29, subscriptionStop)은 잇기 표지(subscriptionFallback 'api') 대신 subscriptionHalt를 붙인다 — 구독이 막혀도
 * API로 잇지 않고 callLlm이 소프트 종료·프로세스 실패를 LlmSoftStopError로 던져 파이프라인이 멈춤으로 기록한다. 표지 없는 잡은 지금과 같다
 */
export function subscriptionRoute(route: PdpModelRoute, subscriptionStop = false): PdpModelRoute {
  const provider = lookupLlmModel(route.model)?.provider
  if (provider !== 'anthropic' && provider !== 'openai') return route
  if (route.disableThinking || route.json) return route
  if (provider === 'openai' && route.failOnTruncation) return route
  if (subscriptionStop) return { ...route, backend: 'subscription', subscriptionHalt: true }
  return { ...route, backend: 'subscription', subscriptionFallback: 'api' }
}

/**
 * 새 배치 단계 라우트 — 기본은 API(1차 블라인드·켜기 전부 API, 오너 I4-1). 구독은 잡 표지로만(R13 subscriptionRoute). 로컬 env의
 * 갈래·구독 스위치와 섞이면 조용히 넘어가지 않고 throw한다(운영 실행은 env를 보지 않는다)
 */
function assertNewBatchEnv(env: PdpRouteEnv): void {
  if (isHostedPdpEnv(env)) return
  if (env.NEXOPS_PDP_MODEL_ARM?.trim()) {
    throw new Error('새 배치 잡은 모델 갈래(NEXOPS_PDP_MODEL_ARM)와 함께 쓸 수 없습니다')
  }
  if (env.NEXOPS_PDP_LLM_BACKEND?.trim() === 'subscription') {
    throw new Error(
      '새 배치 잡은 구독 env 갈래(NEXOPS_PDP_LLM_BACKEND=subscription)와 함께 쓸 수 없습니다 — 새 배치 구독은 잡 표지(구독 작업자 R13)로만 켭니다'
    )
  }
}

function newBatchRoute(
  stage: PdpModelStage,
  env: PdpRouteEnv,
  backend: PdpModelBackend,
  subscriptionStop: boolean
): PdpModelRoute {
  assertNewBatchEnv(env)
  return backend === 'subscription'
    ? subscriptionRoute(PDP_MODEL_ROUTES_NEW[stage], subscriptionStop)
    : PDP_MODEL_ROUTES_NEW[stage]
}

/**
 * 단계 라우트 — 호출 때 env와 잡 배치·백엔드(pdp-model-batch, 기본 = 지금 실행 중인 잡의 값)를 읽는다. 새 배치면 새 표
 * (newBatchRoute — 구독 표지 잡이면 subscriptionRoute). 구독 표지는 새 배치에만 듣는다(지금 배치 잡은 표지가 있어도 지금처럼).
 * 지금 배치는 운영 실행이면(token-steps·enrichment-switch와 같은 판별 isHostedPdpEnv) env를 무시하고 표 그대로다.
 * 모르는 값·서로 어긋나는 조합(M 갈래 + api — M 갈래는 GPT 단계를 구독으로 돌리는 비교 조건이다)은 조용히 넘어가지 않고
 * throw한다(실험 갈래가 잘못 켜진 채 다른 모델·백엔드로 도는 일을 막는다).
 */
export function pdpRoute(
  stage: PdpModelStage,
  env: PdpRouteEnv = process.env,
  batch: PdpModelBatch = currentPdpBatch(),
  jobBackend: PdpModelBackend = currentPdpBackend(),
  subscriptionStop: boolean = currentPdpSubscriptionStop()
): PdpModelRoute {
  if (batch === 'new') return newBatchRoute(stage, env, jobBackend, subscriptionStop)
  const base: PdpModelRoute = PDP_MODEL_ROUTES[stage]
  if (isHostedPdpEnv(env)) return base
  const arm = env.NEXOPS_PDP_MODEL_ARM?.trim()
  const backend = env.NEXOPS_PDP_LLM_BACKEND?.trim()
  if (arm && arm !== 'M') throw new Error(`NEXOPS_PDP_MODEL_ARM은 M만 받습니다: ${arm}`)
  if (backend && backend !== 'subscription' && backend !== 'api') {
    throw new Error(`NEXOPS_PDP_LLM_BACKEND는 subscription|api만 받습니다: ${backend}`)
  }
  if (arm === 'M' && backend === 'api') {
    throw new Error('NEXOPS_PDP_MODEL_ARM=M은 GPT 단계를 구독으로만 부릅니다 — NEXOPS_PDP_LLM_BACKEND=api와 함께 쓸 수 없습니다')
  }
  if (arm === 'M') return mArmRoute(stage, base)
  if (backend === 'subscription' && lookupLlmModel(base.model)?.provider === 'openai') {
    return { ...base, backend: 'subscription' }
  }
  return base
}

/** 지금 env·배치로 해석한 단계 표 — 점수 JSON의 모델 기록(model-trace)이 지정값으로 쓴다 */
export function resolvePdpRoutes(
  env: PdpRouteEnv = process.env,
  batch: PdpModelBatch = currentPdpBatch(),
  backend: PdpModelBackend = currentPdpBackend(),
  subscriptionStop: boolean = currentPdpSubscriptionStop()
): Record<PdpModelStage, PdpModelRoute> {
  return Object.fromEntries(
    PDP_MODEL_STAGES.map((stage) => [stage, pdpRoute(stage, env, batch, backend, subscriptionStop)])
  ) as Record<
    PdpModelStage,
    PdpModelRoute
  >
}

/** 잡별 단계 모델 스냅숏 한 칸 — 노드·모델·등급·상한(R03, 배포 중 모델 섞임 대조) */
export interface PdpRouteSnapshotEntry {
  model: string
  maxTokens: number
  effort?: LlmEffort
}
export type PdpRouteSnapshot = Record<string, PdpRouteSnapshotEntry>

/** 배치의 단계 표 스냅숏 — 잡 생성 때 남긴다(env는 보지 않는다: 웹 잡 표 그대로) */
export function snapshotPdpRoutes(batch: PdpModelBatch): PdpRouteSnapshot {
  const table: Readonly<Record<PdpModelStage, PdpModelRoute>> = batch === 'new' ? PDP_MODEL_ROUTES_NEW : PDP_MODEL_ROUTES
  return Object.fromEntries(
    PDP_MODEL_STAGES.map((stage) => {
      const route = table[stage]
      return [stage, { model: route.model, maxTokens: route.maxTokens, ...(route.effort ? { effort: route.effort } : {}) }]
    })
  )
}

/** 잡 스냅숏과 지금 표가 다른 단계 — 잡 도중 배포로 모델이 바뀌었는지(빈 배열이면 같다) */
export function diffRouteSnapshot(saved: PdpRouteSnapshot, current: PdpRouteSnapshot): string[] {
  return PDP_MODEL_STAGES.filter((stage) => {
    const a = saved[stage]
    const b = current[stage]
    if (!a) return false // 스냅숏보다 뒤에 생긴 단계는 대조하지 않는다
    return !b || a.model !== b.model || a.maxTokens !== b.maxTokens || a.effort !== b.effort
  })
}
