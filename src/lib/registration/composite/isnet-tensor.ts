/**
 * isnet-general-use 전처리·후처리(묶음 4) — rembg DisSession(sessions/dis_general_use.py)과 같다(B 실험 isnet.ts에서 옮김).
 * 순수 계산이다. onnxruntime 세션·sharp 크기 조정은 로컬 백엔드(`scripts/registration/cutout/isnet-backend.ts`)가 한다.
 */

/** 모델 입력 크기(정사각, 늘림) */
export const ISNET_SIZE = 1024

/** 늘린 RGB(size×size×3) → 입력 텐서(CHW): 최댓값으로 나누고 평균 0.5를 뺀다(표준편차 1) */
export function isnetInputTensor(resized: Uint8Array, size = ISNET_SIZE): Float32Array {
  const plane = size * size
  if (resized.length < plane * 3) throw new Error(`isnet 입력 길이 ${resized.length} < ${size}x${size}x3`)
  let max = 1e-6
  for (let i = 0; i < plane * 3; i++) if (resized[i] > max) max = resized[i]
  const tensor = new Float32Array(3 * plane)
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) tensor[c * plane + p] = resized[p * 3 + c] / max - 0.5
  }
  return tensor
}

/** 출력 첫 채널 → 마스크(size×size): min-max로 0~1, 8비트는 반올림(rembg는 버림 — 차이 1/255 이하) */
export function isnetMask(pred: Float32Array, size = ISNET_SIZE): Uint8Array {
  const plane = size * size
  if (pred.length < plane) throw new Error(`isnet 출력 크기 ${pred.length} < ${size}x${size}`)
  let lo = Infinity
  let hi = -Infinity
  for (let p = 0; p < plane; p++) {
    if (pred[p] < lo) lo = pred[p]
    if (pred[p] > hi) hi = pred[p]
  }
  const span = hi - lo || 1
  const mask = new Uint8Array(plane)
  for (let p = 0; p < plane; p++) mask[p] = Math.round(((pred[p] - lo) / span) * 255)
  return mask
}
