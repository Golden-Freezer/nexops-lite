/**
 * 실행 중인 잡의 모델 배치·LLM 백엔드(R03·R13, 서버 전용) — 잡 실행 입구(pdp-pipeline runPdpStep·편집기 재생성)가 잡 배치로 감싸고,
 * pdpRoute(단계)가 읽는다. 에이전트 서명은 바꾸지 않는다. 감싸지 않은 호출(잡 밖 — 생성 화면 자동 작성·레퍼런스 업로드)은 'now'·API다.
 * 백엔드 'subscription'은 구독 표지 잡(pdp-model-batch MODEL_BACKEND_SPEC_KEY)만 — 새 배치 단계를 구독으로 부르고 막히면 API로 잇는다.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { PdpModelBackend, PdpModelBatch } from './pdp-model-batch'

const store = new AsyncLocalStorage<{ batch: PdpModelBatch; backend: PdpModelBackend; subscriptionStop: boolean }>()

/** fn 안의 pdpRoute가 이 배치(·백엔드)로 단계 route를 고른다 — 'now'·API면 지금과 같다 */
export function runWithPdpBatch<T>(
  batch: PdpModelBatch,
  fn: () => T,
  backend: PdpModelBackend = 'api',
  subscriptionStop = false
): T {
  return store.run({ batch, backend, subscriptionStop }, fn)
}

/** 지금 실행 중인 잡의 배치 — 감싸지 않았으면 'now' */
export function currentPdpBatch(): PdpModelBatch {
  return store.getStore()?.batch ?? 'now'
}

/** 지금 실행 중인 잡의 LLM 백엔드 — 감싸지 않았으면 'api' */
export function currentPdpBackend(): PdpModelBackend {
  return store.getStore()?.backend ?? 'api'
}

/** 지금 실행 중인 잡이 구독 멈춤 표지 잡인가(AX-CT-29 — 구독이 막혀도 API로 잇지 않고 멈춘다) — 감싸지 않았으면 false */
export function currentPdpSubscriptionStop(): boolean {
  return store.getStore()?.subscriptionStop ?? false
}
