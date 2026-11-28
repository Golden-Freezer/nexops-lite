/**
 * 움직이는 칸 엔진 자리(세션 B 움직이는 칸 자리 규칙 ④, 오너 2026-11-06 21:57 DIRECTIVE) — 움직임 프레임을 만드는 길을 MotionEngine 하나로 둔다.
 *   gif-sheet:  지금의 2.6 참조 GIF(시트 한 장 → 프레임) 경로를 그대로 감싼다 — 호출·디코드·바이트가 전과 같다(engine.test.ts가 보인다)
 *   video-clip: 짧은 영상 → 프레임(Gemini Omni 등) 자리만 둔다. 구현은 A의 비교 하네스 결과 뒤 motion/engines/video-clip.ts(A 소유)가 붙인다
 *   codex-sheet: GPT 구독 이미지 3×3 시트 한 장 → 앱이 9칸으로 자름(motion/codex-sheet.ts, AX-CT-35). 잡 기록 motioncodex(기본 off)가 켜진 잡만 —
 *     stage-deps motionDepsOf가 이 엔진을 단다(jobMotionEngineOf). 꺼진 잡은 엔진을 달지 않아 gif-sheet 그대로다
 * 엔진 뒤의 검사·고리 엮기·인코딩·업로드는 motion/stage.ts가 엔진과 관계없이 같은 규칙으로 한다.
 * 엔진 고르기: 계획 기록 templatelib.motion.engine(기본 gif-sheet) → 로컬 실행기 env NEXOPS_PDP_MOTION_ENGINE(Vercel 무시).
 * 등록되지 않은 엔진을 고르면 gif-sheet로 돌아가고 까닭을 남긴다(잡을 막지 않는다).
 */

import type { VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import { hasEnrichmentFeature, isHostedPdpEnv } from '../enrichment-switch'
import type { FrameSet } from './assemble'
import { decodeGif } from './encode'
import type { MotionTask } from './task'

export const MOTION_ENGINE_IDS = ['gif-sheet', 'video-clip', 'codex-sheet'] as const
export type MotionEngineId = (typeof MOTION_ENGINE_IDS)[number]
export const DEFAULT_MOTION_ENGINE: MotionEngineId = 'gif-sheet'

export interface MotionEngineInput {
  /** 엔진에 보내는 지시(컷 프롬프트 + 움직임 줄, stage gifPromptOf) */
  prompt: string
  action: string
  loop: MotionTask['loop']
  /** 칸 비율('1:1'·'3:4'·'4:3') — 엔진이 이 비율로 만든다 */
  aspect: string
  /** 이 호출의 시간 상한(ms) — run 남은 시간으로 정한다(stage gifTimeoutOf) */
  timeoutMs: number
  /** 첫 프레임이 될 정지 컷(대표 칸) — 없으면 상품 사진만 */
  still?: VisionImage
  /** 상품 실물 사진 — gif-sheet는 deps가 이미 들고 있어 쓰지 않는다 */
  sourceRefs?: readonly VisionImage[]
}

export interface MotionEngineOutput {
  frames: FrameSet
  costUsd: number
  meta: {
    engine: MotionEngineId
    /** 엔진이 받은 원본(gif-sheet = 2.6 GIF 바이트) — 기록용 업로드에 쓴다 */
    source?: { bytes: Buffer; mimeType: string }
  }
}

export interface MotionEngine {
  id: MotionEngineId
  /** 프레임 하나 묶음 — 실패는 던진다(부르는 쪽이 옵션 밀기·포스터로 내린다). 만들 것이 없으면 null */
  make(input: MotionEngineInput): Promise<MotionEngineOutput | null>
}

/** gif-sheet가 쓰는 바깥 호출 — MotionDeps.generateGif 그대로(크기는 비율에서 정한다) */
export interface GifSheetDeps {
  generateGif: (prompt: string, timeoutMs: number, size?: string) => Promise<{ base64: string; costUsd: number }>
}

/**
 * 2.6 GIF 프레임 크기 — 1:1은 지금 값(768², 실측으로 된 시트 2,304²). 세로·가로 3:4는 같은 시트 한도 안의 16 배수(656×880 → 시트 1,968×2,640).
 * 3:4는 운영에서 받고 있다(읽기 전용 조회: 11-06 16:27 잡부터 대표 움직이는 칸 22개 모두 780×1040·ok, 대표 아닌 3:4 칸 9개·4:3 칸 12개도 ok).
 * 2:3은 받아 본 적이 없어 넣지 않는다(결정 카드 c20 — 오너 11-09 '더하지 않음'). 크기가 거절(400)되면 GIF 실패로 내려가 정지 컷이 남는다
 */
export const GIF_FRAME_SIZES: Readonly<Record<string, string>> = Object.freeze({ '1:1': '768x768', '3:4': '656x880', '4:3': '880x656' })

export const gifFrameSizeOf = (aspect: string): string | null => GIF_FRAME_SIZES[aspect] ?? null

/** 칸 비율 → 780 폭 프레임 높이(디코드 뒤 칸 비율에 딱 맞춘다 — 편집기 사진 자리와 비율이 같아야 내보내기가 바꿔 넣는다) */
export function frameHeightOf(aspect: string, width: number): number | null {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  return m ? Math.round((width * Number(m[2])) / Number(m[1])) : null
}

/**
 * gif-sheet 엔진 — generateGif → decodeGif. 1:1은 지금 경로와 같은 호출(크기 인자 없음)·같은 디코드라 바이트가 그대로다.
 * 다른 비율은 그 비율 크기로 부르고 780 폭·칸 비율 높이로 디코드한다
 */
export function gifSheetEngine(deps: GifSheetDeps, decode: typeof decodeGif = decodeGif): MotionEngine {
  return {
    id: 'gif-sheet',
    async make(input) {
      const size = gifFrameSizeOf(input.aspect)
      if (!size) return null
      const square = input.aspect === '1:1'
      const out = square ? await deps.generateGif(input.prompt, input.timeoutMs) : await deps.generateGif(input.prompt, input.timeoutMs, size)
      const bytes = Buffer.from(out.base64, 'base64')
      let frames: FrameSet
      try {
        frames = square ? await decode(bytes) : await decode(bytes, undefined, frameHeightOf(input.aspect, 780) ?? undefined)
      } catch (e) {
        // 받은 GIF를 못 읽어도 호출 비용은 이미 났다 — 같은 오류 글에 비용을 실어 부르는 쪽(stage)이 더한다
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { costUsd: out.costUsd })
      }
      return { frames, costUsd: out.costUsd, meta: { engine: 'gif-sheet', source: { bytes, mimeType: 'image/gif' } } }
    },
  }
}

export type MotionEngineFactory = (deps: GifSheetDeps) => MotionEngine

/** 등록된 엔진 — video-clip은 A가 motion/engines/video-clip.ts로 붙일 때 여기에 더한다 */
export const MOTION_ENGINES: Readonly<Partial<Record<MotionEngineId, MotionEngineFactory>>> = Object.freeze({ 'gif-sheet': (deps: GifSheetDeps) => gifSheetEngine(deps) })

const isEngineId = (v: unknown): v is MotionEngineId => typeof v === 'string' && (MOTION_ENGINE_IDS as readonly string[]).includes(v)

/** 고른 엔진 id — env(로컬만)가 계획 기록을 이긴다. 모르는 값은 버린다 */
export function motionEngineIdOf(recorded: unknown, env: Record<string, string | undefined> = process.env): MotionEngineId {
  const local = isHostedPdpEnv(env) ? undefined : env.NEXOPS_PDP_MOTION_ENGINE?.trim()
  if (isEngineId(local)) return local
  return isEngineId(recorded) ? recorded : DEFAULT_MOTION_ENGINE
}

/** 엔진 만들기 — 등록되지 않은 엔진이면 gif-sheet와 까닭 */
export function resolveMotionEngine(
  id: MotionEngineId,
  deps: GifSheetDeps,
  engines: Readonly<Partial<Record<MotionEngineId, MotionEngineFactory>>> = MOTION_ENGINES,
): { engine: MotionEngine; note: string | null } {
  const factory = engines[id]
  if (factory) return { engine: factory(deps), note: null }
  return { engine: gifSheetEngine(deps), note: `엔진 ${id} 없음 — gif-sheet로` }
}

/** 잡 기록으로 고른 움직이는 칸 엔진(모델 고르는 자리, AX-CT-35) — motioncodex가 기록된 잡만 codex-sheet, 그 밖(꺼진 잡·옛 잡)은 gif-sheet */
export const jobMotionEngineOf = (analysis: unknown): MotionEngineId => (hasEnrichmentFeature(analysis, 'motioncodex') ? 'codex-sheet' : DEFAULT_MOTION_ENGINE)
