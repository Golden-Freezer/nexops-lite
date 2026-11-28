/**
 * 움직이는 칸 구독 시트 엔진 codex-sheet(AX-CT-35, 오너 X-189 2026-11-20 '구독 길을 꺼진 채 만듦') — 여러 장면을 한 번에 받는 약속.
 *   구독 이미지(codex-image, 정지 PNG 한 장)에 '3×3 격자 9칸 = 연속 9프레임'을 지시하고, 받은 PNG를 앱이 9칸으로 잘라 프레임 묶음을 만든다.
 *   크기는 못 고른다(11-19 실측: 2,448×3,264를 청해도 1086×1448) — 요청 크기는 비율 검사에만 쓰이고, 칸 경계는 받은 크기에서 센다.
 *   자른 뒤(고리 엮기·인코딩·검사·업로드)는 motion/stage.ts가 엔진과 관계없이 같은 규칙으로 한다.
 * 이 엔진은 잡 기록 motioncodex(기본 off, enrichment-switch)가 켜진 잡에서만 쓰인다 — 꺼진 잡은 gif-sheet 그대로다(stage-deps motionDepsOf).
 * 실패(백엔드 없음·한도·시간 초과·자르기 실패)는 던진다 — 부르는 쪽이 지금의 실패 길(옵션 밀기·정지 컷)로 내린다. API로 잇지 않는다(규칙 7).
 */

import type sharpModule from 'sharp'
import type { FrameSet } from './assemble'
import { frameHeightOf, type MotionEngine } from './engine'
import { MOTION_ENCODE } from './encode'

/** 격자 한 변의 칸 수(3×3 = 9프레임 — 2.6 GIF 프레임 수와 같다) */
export const CODEX_SHEET_GRID = 3
/** 칸마다 버리는 가장자리(px) — 칸 경계가 소수일 때 옆 칸 픽셀·격자 선 자국이 섞이지 않게 */
export const CODEX_SHEET_TRIM = 2
/** 프레임 길이(ms) — 2.6 GIF(MOTION_GIF.frameDurationMs)와 같은 값 */
export const CODEX_SHEET_FRAME_MS = 200

/** 비율별 요청 시트 크기 — GIF 칸 크기(engine GIF_FRAME_SIZES)의 3배. 구독 백엔드는 비율(±3%)만 맞춰 본다 */
export const CODEX_SHEET_SIZES: Readonly<Record<string, string>> = Object.freeze({ '1:1': '2304x2304', '3:4': '1968x2640', '4:3': '2640x1968' })

export const codexSheetSizeOf = (aspect: string): string | null => CODEX_SHEET_SIZES[aspect] ?? null

export interface SheetBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 받은 시트 크기 → 칸 9개의 자르기 상자(왼→오·위→아래). 3으로 안 나뉘면 경계를 소수로 셈해 반올림하고, 칸마다 가장자리 trim px를 버린다.
 * 칸이 trim을 버리고 남을 만큼 크지 않으면 던진다
 */
export function sheetCellBoxes(width: number, height: number, grid: number = CODEX_SHEET_GRID, trim: number = CODEX_SHEET_TRIM): SheetBox[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(`시트 크기가 이상합니다: ${width}×${height}`)
  const edges = (size: number) => Array.from({ length: grid + 1 }, (_, i) => Math.round((size * i) / grid))
  const xs = edges(width)
  const ys = edges(height)
  const boxes: SheetBox[] = []
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const left = xs[col] + trim
      const top = ys[row] + trim
      const w = xs[col + 1] - xs[col] - trim * 2
      const h = ys[row + 1] - ys[row] - trim * 2
      if (w <= 0 || h <= 0) throw new Error(`시트 ${width}×${height}가 너무 작아 ${grid}×${grid}칸으로 자르지 못합니다`)
      boxes.push({ left, top, width: w, height: h })
    }
  }
  return boxes
}

/** 시트 지시 — 받은 움직임 지시(stage gifPromptOf) 뒤에 '한 장 = 3×3 격자 9프레임' 약속을 붙인다(그리지 않는 참고 글) */
export function codexSheetPromptOf(prompt: string): string {
  return [
    prompt,
    '',
    'SHEET LAYOUT (do not render this text):',
    '- Output ONE image that is a 3×3 grid of 9 equal panels: 9 consecutive frames of this one short motion.',
    '- Read the panels left to right, then top to bottom. Panel 1 (top-left) is the first frame, panel 9 (bottom-right) is the last frame.',
    '- Panels touch edge to edge: no gaps, borders, grid lines, margins, numbers, labels or captions anywhere.',
    '- Every panel keeps the same camera, framing, background, light and product size and position; only the motion changes from panel to panel.',
  ].join('\n')
}

async function loadSharp(): Promise<typeof sharpModule> {
  const mod = await import('sharp')
  return (mod as unknown as { default?: typeof sharpModule }).default ?? (mod as unknown as typeof sharpModule)
}

/** 시트 PNG → 칸 9개를 width 폭·height 높이 RGB 프레임으로(가득 채움 cover·lanczos3·흰 바탕 — gif-sheet 디코드와 같은 꼴) */
export async function sliceSheet(bytes: Buffer, width: number, height: number): Promise<FrameSet> {
  const sharp = await loadSharp()
  const meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height) throw new Error('시트 크기를 읽지 못했습니다.')
  const frames: Buffer[] = []
  for (const box of sheetCellBoxes(meta.width, meta.height)) {
    frames.push(
      await sharp(bytes)
        .extract(box)
        .flatten({ background: '#ffffff' })
        .resize(width, height, { kernel: 'lanczos3', fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer()
    )
  }
  return { frames, delays: frames.map(() => CODEX_SHEET_FRAME_MS), width, height }
}

/** codex-sheet가 쓰는 바깥 호출 — 구독 이미지 한 장(시트 지시·요청 크기). 비용은 0으로 온다 */
export interface CodexSheetDeps {
  generateSheet: (prompt: string, size: string) => Promise<{ base64: string; costUsd: number }>
}

/** 구독 시트 엔진 — 지시에 시트 약속을 붙여 한 장 받고 9칸으로 자른다. 모르는 비율이면 null(만들 것 없음) */
export function codexSheetEngine(deps: CodexSheetDeps, slice: typeof sliceSheet = sliceSheet): MotionEngine {
  return {
    id: 'codex-sheet',
    async make(input) {
      const size = codexSheetSizeOf(input.aspect)
      const height = frameHeightOf(input.aspect, MOTION_ENCODE.width)
      if (!size || !height) return null
      const out = await deps.generateSheet(codexSheetPromptOf(input.prompt), size)
      let frames: FrameSet
      try {
        frames = await slice(Buffer.from(out.base64, 'base64'), MOTION_ENCODE.width, height)
      } catch (e) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { costUsd: out.costUsd })
      }
      // 원본은 PNG라 stage의 원본 GIF 기록(image/gif 업로드)에 싣지 않는다
      return { frames, costUsd: out.costUsd, meta: { engine: 'codex-sheet' } }
    },
  }
}
