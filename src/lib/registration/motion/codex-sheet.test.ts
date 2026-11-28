/**
 * 움직이는 칸 구독 시트 엔진(motion/codex-sheet.ts, AX-CT-35) — 칸 자르기 상자·시트 지시·가짜 시트 PNG를 잘라 9프레임·순서·크기,
 * 잡 기록으로 엔진 고르기(꺼진 잡은 gif-sheet). 구독·API 호출 0(가짜 deps).
 */

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { buildEnrichmentRecord } from '../enrichment-switch'
import { CODEX_SHEET_SIZES, codexSheetEngine, codexSheetPromptOf, sheetCellBoxes, sliceSheet } from './codex-sheet'
import { GIF_FRAME_SIZES, jobMotionEngineOf } from './engine'

/** 칸마다 다른 색(빨강 값 = 칸 번호 × 25)인 3×3 시트 PNG — 칸 경계는 sheetCellBoxes와 같은 반올림 */
async function gridPng(width: number, height: number): Promise<Buffer> {
  const xs = [0, 1, 2, 3].map((i) => Math.round((width * i) / 3))
  const ys = [0, 1, 2, 3].map((i) => Math.round((height * i) / 3))
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const row = ys.findIndex((edge, i) => y >= edge && y < ys[i + 1])
    for (let x = 0; x < width; x++) {
      const col = xs.findIndex((edge, i) => x >= edge && x < xs[i + 1])
      const at = (y * width + x) * 3
      raw[at] = (row * 3 + col) * 25
      raw[at + 1] = 100
      raw[at + 2] = 200
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

describe('sheetCellBoxes — 받은 크기에서 3×3 칸 상자', () => {
  it('3으로 안 나뉘는 1086×1448(11-19 실측 크기)도 칸 9개가 겹치지 않고, 칸 사이는 가장자리 2px씩만 비는다', () => {
    const boxes = sheetCellBoxes(1086, 1448)
    expect(boxes).toHaveLength(9)
    expect(boxes[0]).toEqual({ left: 2, top: 2, width: 358, height: 479 })
    // 세로 경계 483·965(482.67·965.33 반올림) — 가운데 줄만 1px 낮다
    expect(boxes[4]).toEqual({ left: 364, top: 485, width: 358, height: 478 })
    expect(boxes[8]).toEqual({ left: 726, top: 967, width: 358, height: 479 })
    for (const b of boxes) {
      expect(b.left + b.width).toBeLessThanOrEqual(1086)
      expect(b.top + b.height).toBeLessThanOrEqual(1448)
    }
    // 같은 줄 옆 칸과의 틈 = 앞 칸 오른쪽 2px + 뒤 칸 왼쪽 2px
    expect(boxes[1].left - (boxes[0].left + boxes[0].width)).toBe(4)
  })

  it('나뉘는 크기(2304²)·가로 시트(1448×1086)도 같은 규칙이고, 너무 작으면 던진다', () => {
    expect(sheetCellBoxes(2304, 2304)[8]).toEqual({ left: 1538, top: 1538, width: 764, height: 764 })
    expect(sheetCellBoxes(1448, 1086)[2]).toEqual({ left: 967, top: 2, width: 479, height: 358 })
    expect(() => sheetCellBoxes(12, 12)).toThrow('너무 작아')
    expect(() => sheetCellBoxes(0, 100)).toThrow('이상합니다')
  })
})

describe('codexSheetPromptOf — 한 장 = 3×3 격자 9프레임 약속', () => {
  it('받은 지시를 그대로 앞에 두고, 칸 수·읽는 순서·틈 없음·같은 화면을 뒤에 붙인다', () => {
    const p = codexSheetPromptOf('BASE\n\nANIMATION (do not render this text):\n- x')
    expect(p.startsWith('BASE\n\nANIMATION (do not render this text):\n- x\n\nSHEET LAYOUT (do not render this text):')).toBe(true)
    expect(p).toContain('3×3 grid of 9 equal panels')
    expect(p).toContain('left to right, then top to bottom')
    expect(p).toContain('no gaps, borders, grid lines')
  })

  it('요청 시트 크기는 비율마다 GIF 칸 크기의 3배다', () => {
    for (const [aspect, size] of Object.entries(GIF_FRAME_SIZES)) {
      const [w, h] = size.split('x').map(Number)
      expect(CODEX_SHEET_SIZES[aspect], aspect).toBe(`${w * 3}x${h * 3}`)
    }
  })
})

describe('sliceSheet·codexSheetEngine — 가짜 시트 PNG', () => {
  it('1086×1448 시트를 780×1040(3:4) 프레임 9장으로 자르고, 칸 순서(왼→오·위→아래)대로 색이 이어진다', async () => {
    const set = await sliceSheet(await gridPng(1086, 1448), 780, 1040)
    expect(set.frames).toHaveLength(9)
    expect(set).toMatchObject({ width: 780, height: 1040, delays: Array(9).fill(200) })
    for (const [i, frame] of set.frames.entries()) {
      expect(frame.length).toBe(780 * 1040 * 3)
      const mid = (520 * 780 + 390) * 3
      expect(Math.abs(frame[mid] - i * 25), `칸 ${i + 1}`).toBeLessThanOrEqual(2)
    }
  })

  it('엔진은 시트 지시와 비율 크기로 한 번 부르고, 1:1은 780² 프레임 9장·원본 기록 없음·비용 그대로다', async () => {
    const png = await gridPng(1254, 1254)
    const generateSheet = vi.fn(async () => ({ base64: png.toString('base64'), costUsd: 0 }))
    const out = await codexSheetEngine({ generateSheet }).make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '1:1', timeoutMs: 120_000 })
    expect(generateSheet).toHaveBeenCalledTimes(1)
    expect(generateSheet).toHaveBeenCalledWith(codexSheetPromptOf('P'), '2304x2304')
    expect(out?.frames.frames).toHaveLength(9)
    expect(out?.frames).toMatchObject({ width: 780, height: 780 })
    expect(out?.meta).toEqual({ engine: 'codex-sheet' })
    expect(out?.costUsd).toBe(0)
  })

  it('모르는 비율은 부르지 않고 null, 못 자르는 응답은 비용을 실어 던진다(부르는 쪽이 지금 실패 길로 내린다)', async () => {
    const generateSheet = vi.fn(async () => ({ base64: Buffer.from('not a png').toString('base64'), costUsd: 0 }))
    const engine = codexSheetEngine({ generateSheet })
    expect(await engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '16:9', timeoutMs: 90_000 })).toBeNull()
    expect(generateSheet).not.toHaveBeenCalled()
    const err = await engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '3:4', timeoutMs: 90_000 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.costUsd).toBe(0)
  })

  it('백엔드 오류(등록 없음·한도)는 그대로 던진다 — 다른 모델로 잇지 않는다', async () => {
    const engine = codexSheetEngine({ generateSheet: async () => Promise.reject(new Error('codex-image 로컬 백엔드가 등록돼 있지 않습니다')) })
    await expect(engine.make({ prompt: 'P', action: 'a', loop: 'back_and_forth', aspect: '1:1', timeoutMs: 90_000 })).rejects.toThrow('등록돼 있지 않습니다')
  })
})

describe('jobMotionEngineOf — 모델 고르는 자리', () => {
  it('motioncodex 기록이 있는 잡만 codex-sheet, 꺼진 잡·옛 잡·기록 없는 잡은 gif-sheet', () => {
    expect(jobMotionEngineOf({ enrichment: buildEnrichmentRecord(['templatelib', 'motionband', 'motioncodex']) })).toBe('codex-sheet')
    expect(jobMotionEngineOf({ enrichment: buildEnrichmentRecord(['templatelib', 'motionband']) })).toBe('gif-sheet')
    expect(jobMotionEngineOf({})).toBe('gif-sheet')
    expect(jobMotionEngineOf(null)).toBe('gif-sheet')
  })
})
