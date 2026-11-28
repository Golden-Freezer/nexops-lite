/**
 * 화면 쪽 레퍼런스 보내기(13_REFERENCE_INPUT PR③) — Vercel 함수 요청 본문 상한(약 4.5MB) 때문에 긴 캡처를 브라우저에서 줄여 보낸다.
 * 서버와 같은 띠 계획(reference-plan)으로 폭 860·1,400px 띠 JPEG를 만들고, 합계가 예산(3.8MB) 안이 될 때까지 품질을 낮춘다.
 * PDF는 4MB 이하만 그대로 보낸다. 원본 파일은 서버로 가지 않고, 서버도 띠를 저장하지 않는다(분석 결과만 돌려준다).
 */

import { planStrips, stripPercent } from './reference-plan'
import { REFERENCE_LIMITS, type ReferenceInput, type ReferenceKind } from './reference-types'

/** 한 요청 띠 합계 목표 — 요청 본문 상한 안, 폼 경계·위치 JSON 몫을 남긴다 */
export const BROWSER_STRIPS_BUDGET_BYTES = Math.floor(3.8 * 1024 * 1024)
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4]

export interface BrowserStrips {
  blobs: Blob[]
  positions: Array<{ start: number; end: number }>
  sampled: boolean
  quality: number
}

/** 품질 단계마다 띠를 다시 만들어 합계가 예산 안이 되는 첫 단계를 고른다(인코더를 받는 순수 흐름). 끝까지 넘치면 null */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Blob[]>,
  budget = BROWSER_STRIPS_BUDGET_BYTES
): Promise<{ blobs: Blob[]; quality: number } | null> {
  for (const quality of QUALITIES) {
    const blobs = await encode(quality)
    if (blobs.reduce((sum, b) => sum + b.size, 0) <= budget) return { blobs, quality }
  }
  return null
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG로 바꾸지 못했습니다.'))), 'image/jpeg', quality)
  )

/** 긴 캡처 → 띠 JPEG(브라우저 전용 — createImageBitmap·canvas). 폭 860으로 줄이고 키우지 않는다 */
export async function sliceImageInBrowser(file: Blob): Promise<BrowserStrips | { error: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { error: '이미지를 읽지 못했습니다.' }
  }
  try {
    if (bitmap.width < REFERENCE_LIMITS.imageMinWidth) {
      return { error: `캡처 폭이 너무 좁습니다(최소 ${REFERENCE_LIMITS.imageMinWidth}px).` }
    }
    const scale = Math.min(1, REFERENCE_LIMITS.stripWidth / bitmap.width)
    const width = Math.round(bitmap.width * scale)
    const pageHeight = Math.round(bitmap.height * scale)
    const plan = planStrips(pageHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    const ctx = canvas.getContext('2d')
    if (!ctx) return { error: '이 브라우저에서 캡처를 줄이지 못했습니다.' }
    const heights = plan.strips.map((s) => Math.min(s.height, pageHeight - s.top))
    const encode = async (quality: number) => {
      const blobs: Blob[] = []
      for (const [i, s] of plan.strips.entries()) {
        canvas.height = heights[i]
        // 투명 PNG는 JPEG에서 검게 나오므로 흰 바탕을 먼저 칠한다
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, heights[i])
        ctx.drawImage(bitmap, 0, s.top / scale, bitmap.width, heights[i] / scale, 0, 0, width, heights[i])
        blobs.push(await toJpeg(canvas, quality))
      }
      return blobs
    }
    const fitted = await encodeWithinBudget(encode)
    if (!fitted) return { error: '캡처를 4MB 안으로 줄이지 못했습니다. 더 짧게 잘라 올려 주세요.' }
    return {
      blobs: fitted.blobs,
      positions: plan.strips.map((s, i) => stripPercent(s.top, heights[i], pageHeight)),
      sampled: plan.sampled,
      quality: fitted.quality,
    }
  } finally {
    bitmap.close()
  }
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/**
 * 분석 요청 — PDF는 그대로(4MB 이하), 캡처는 브라우저에서 띠로 줄여 보낸다. 실패면 서버 문구로 throw.
 * deps는 시험용(띠 자르기·fetch 대체)
 */
export async function fetchReferenceAnalysis(
  kind: ReferenceKind,
  file: File,
  deps: { slice?: typeof sliceImageInBrowser; fetchImpl?: typeof fetch } = {}
): Promise<ReferenceInput> {
  const form = new FormData()
  form.append('kind', kind)
  form.append('fileName', file.name)
  if (isPdf(file)) {
    if (file.size > REFERENCE_LIMITS.pdfMaxBytes) throw new Error('PDF는 4MB 이하만 올릴 수 있습니다. 필요한 쪽만 남겨 주세요.')
    form.append('file', file)
  } else {
    const sliced = await (deps.slice ?? sliceImageInBrowser)(file)
    if ('error' in sliced) throw new Error(sliced.error)
    sliced.blobs.forEach((blob, i) => form.append('strips', blob, `strip-${i + 1}.jpg`))
    form.append('positions', JSON.stringify(sliced.positions))
    if (sliced.sampled) form.append('sampled', '1')
  }
  const res = await (deps.fetchImpl ?? fetch)('/api/registration/references', { method: 'POST', body: form })
  const json = (await res.json().catch(() => ({}))) as { reference?: ReferenceInput; error?: string }
  if (!res.ok || !json.reference) throw new Error(json.error || '레퍼런스를 분석하지 못했습니다.')
  return json.reference
}
