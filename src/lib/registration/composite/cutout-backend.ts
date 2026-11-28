/**
 * 누끼 백엔드 레지스트리(묶음 4) — 등록·조회만 맡는다. onnxruntime·child_process를 들이지 않는다.
 *
 * isnet(onnxruntime-node + 모델 179MB)은 Vercel 함수 한도 밖이라 로컬 프로세스(실 테스트 하네스·장래 실행기)가 시작할 때
 * 등록한다(코덱스 이미지 `agents/image/local-backend.ts`와 같은 방식). 구현은 Next 번들 밖 `scripts/registration/cutout/`에 있다.
 * Vercel에는 등록이 없으므로 합성 하위 단계는 `no_backend`로 기록하고 지금처럼 생성한다.
 */

/** 누끼 입력 — 처리 크기(긴 변 CUTOUT_MAX_SIDE 이하) RGB 3채널 */
export interface CutoutInput {
  rgb: Uint8Array
  width: number
  height: number
}

/** isnet 마스크(알파, 길이 width×height)를 돌려준다. 실패는 throw */
export type LocalCutoutBackend = (input: CutoutInput) => Promise<Uint8Array>

// 하네스가 다른 경로로 같은 모듈을 다시 불러와도 등록이 하나로 유지되게 전역 심볼에 둔다
const REGISTRY_KEY = Symbol.for('nexops.registration.localCutoutBackend')

function store(): Record<symbol, LocalCutoutBackend | undefined> {
  return globalThis as unknown as Record<symbol, LocalCutoutBackend | undefined>
}

/** 등록하고 해제 함수를 돌려준다 */
export function registerLocalCutoutBackend(backend: LocalCutoutBackend): () => void {
  store()[REGISTRY_KEY] = backend
  return () => {
    if (store()[REGISTRY_KEY] === backend) delete store()[REGISTRY_KEY]
  }
}

export function getLocalCutoutBackend(): LocalCutoutBackend | null {
  return store()[REGISTRY_KEY] ?? null
}
