/**
 * 화면이 줄여 보낸 띠 입력 읽기(13_REFERENCE_INPUT PR③) — FormData 'strips'(JPEG 파일 1~16장) + 'positions'(JSON [{start,end}]).
 * 띠마다 JPEG 머리·위치(0~100, 시작 ≤ 끝)를 확인하고 합계가 요청 상한(4MB) 안인지 본다. 틀리면 거절 문구(400)를 돌려준다.
 */

import type { ReferenceStrip } from './reference-strips'
import { REFERENCE_LIMITS } from './reference-types'

const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

function readPositions(raw: unknown, count: number): Array<{ start: number; end: number }> | null {
  if (typeof raw !== 'string') return null
  let list: unknown
  try {
    list = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(list) || list.length !== count) return null
  const out: Array<{ start: number; end: number }> = []
  for (const p of list) {
    const start = Number((p as { start?: unknown })?.start)
    const end = Number((p as { end?: unknown })?.end)
    if (![start, end].every((v) => Number.isFinite(v) && v >= 0 && v <= 100) || end < start) return null
    out.push({ start, end })
  }
  return out
}

/** 띠 입력이 있으면 검사한 띠, 없으면 null(파일 입력으로 처리), 틀리면 error */
export async function readStripUpload(form: FormData): Promise<{ strips: ReferenceStrip[] } | { error: string } | null> {
  const files = form.getAll('strips').filter((v): v is File => v instanceof File)
  if (files.length === 0) return null
  if (files.length > REFERENCE_LIMITS.maxStrips) return { error: `띠는 ${REFERENCE_LIMITS.maxStrips}장까지 받습니다.` }
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > REFERENCE_LIMITS.imageMaxBytes) {
    return { error: `띠 합계가 너무 큽니다(최대 ${REFERENCE_LIMITS.imageMaxBytes / (1024 * 1024)}MB — 서버 요청 상한).` }
  }
  const positions = readPositions(form.get('positions'), files.length)
  if (!positions) return { error: '띠 위치(positions)가 올바르지 않습니다.' }
  const strips: ReferenceStrip[] = []
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!isJpeg(bytes)) return { error: '띠는 JPEG만 받습니다.' }
    strips.push({ data: Buffer.from(bytes).toString('base64'), mediaType: 'image/jpeg', ...positions[i] })
  }
  return { strips }
}
