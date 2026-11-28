/**
 * GIF 칸 생성의 바깥 호출 묶음(세션 B ③ P3) — 이미지 단계(generateSection)가 run 값으로 만든다.
 *   generateGif: 2.6 참조 GIF(high, 상품 실물 사진 첨부 — 편집 엔드포인트), 호출 상한은 buildMotionCell이 run 남은 시간으로 정한다
 *   fetchPhoto:  실물 옵션 사진 받기(못 받으면 null)
 *   judgeSheet:  3×3 프레임 모음을 기존 비전 게이트(K 컷 판정)에 한 번 — 같은 상품이 아니거나 이상(뒤집힌·새 글자 포함)이면 탈락, 채점 실패는 null
 *   upload:      포스터 JPEG·움직이는 WebP·원본 GIF를 같은 버킷에(storage.ts uploadPdpImage — 확장자는 mime대로)
 * 이미지 단계 파일과 서로 읽지 않는다(그쪽이 이 파일을 읽는다).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/agents/image/generate'
import { maxReferencesOf, type ImageModel } from '@/lib/agents/image/types'
import { judgeImageGate } from '@/lib/agents/registration/pdp-image-agent'
import { fetchImageAsBase64, type VisionImage } from '@/lib/agents/registration/thumbnail-vision-agent'
import type { RunContext } from '@/lib/agents/types'
import { fitSourceRefs } from '../reference-limit'
import { uploadPdpImage } from '../storage'
import { codexSheetEngine } from './codex-sheet'
import { jobMotionEngineOf } from './engine'
import { MOTION_GIF, type MotionDeps } from './stage'

/** GIF 칸 모델·품질 — 오너 22:45 "GPT-IMAGE-2.6 높은 추론등급"(GIF는 2.6만 받는다, ANIMATION_MODELS) */
export const MOTION_MODEL: ImageModel = 'gpt-image-2.6-sunburst'
export const MOTION_QUALITY = 'high' as const
/** 구독 시트 엔진(codex-sheet, AX-CT-35 — 잡 기록 motioncodex 잡만)의 이미지 모델 — 구독 로컬 백엔드(비용 0, 등록이 없으면 호출 없이 오류) */
export const MOTION_SHEET_MODEL: ImageModel = 'codex-image'
/** 옵션 사진·프레임 모음 받기 상한 */
const PHOTO_FETCH_MS = 25_000
const SHEET_GATE_LIMITS = { timeoutMs: 40_000, maxRetries: 0 }

export interface MotionRunValues {
  db: SupabaseClient
  userId: string
  jobId: string
  /** section_images 키(K 컷 키) — 업로드 파일 이름에 kind를 붙인다 */
  section: string
  sourceRefs: readonly VisionImage[]
  runContext: RunContext
  runStart: number
  budgetMs: number
  agentName: string
  /** 대표 칸(움직이는 칸 자리 규칙 ①) — 정지 대표 컷을 맨 끝 참조로 붙인다(지시가 '맨 끝 = 대표 컷'으로 부른다). 그 밖의 칸은 없다(지금 그대로) */
  tailRefs?: readonly VisionImage[]
  /** 움직이는 칸 엔진 — 'codex-sheet'일 때만 값이 있다(motionEngineValuesOf). 없으면 엔진을 달지 않아 stage가 gif-sheet를 쓴다(지금 그대로) */
  engineId?: 'codex-sheet'
}

/** 이미지 단계가 motionDepsOf에 펼칠 엔진 값 — 잡 기록 motioncodex 잡만 { engineId }, 그 밖은 빈 객체(펼쳐도 값이 바이트 그대로) */
export const motionEngineValuesOf = (job: { analysis: unknown }): Pick<MotionRunValues, 'engineId'> =>
  jobMotionEngineOf(job.analysis) === 'codex-sheet' ? { engineId: 'codex-sheet' } : {}

/** 그 잡의 움직이는 칸 모델(참조 상한 셈용) — 꺼진 잡은 MOTION_MODEL(지금 그대로), motioncodex 잡은 MOTION_SHEET_MODEL */
export const motionRefModelOf = (job: { analysis: unknown }): ImageModel =>
  jobMotionEngineOf(job.analysis) === 'codex-sheet' ? MOTION_SHEET_MODEL : MOTION_MODEL

export function motionDepsOf(v: MotionRunValues): MotionDeps {
  const tail = v.tailRefs ?? []
  const refs = fitSourceRefs([...v.sourceRefs], tail.length, maxReferencesOf(MOTION_MODEL)).kept
  const attached = [...refs, ...tail]
  const deps = baseDepsOf(v, refs, attached)
  return v.engineId === 'codex-sheet' ? { ...deps, engine: codexSheetEngine({ generateSheet: sheetCallOf(v, tail) }) } : deps
}

/**
 * 구독 시트 한 장 — 상품 사진은 구독 이미지 도구 상한(5장)에 맞춰 줄이고 대표 칸 정지 컷(tail)은 맨 끝에 둔다. 비용 0.
 * 등록이 없거나(Vercel·이미지 길이 꺼진 작업자) 한도·시간 초과면 generateImage가 던진다 — API로 잇지 않는다
 */
function sheetCallOf(v: MotionRunValues, tail: readonly VisionImage[]) {
  const refs = fitSourceRefs([...v.sourceRefs], tail.length, maxReferencesOf(MOTION_SHEET_MODEL)).kept
  const attached = [...refs, ...tail]
  return async (prompt: string, size: string) => {
    const result = await generateImage({
      prompt,
      model: MOTION_SHEET_MODEL,
      size,
      referenceImages: attached.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
      agentName: v.agentName,
      runContext: { ...v.runContext, stage: `images/${v.section}/motion` },
    })
    return { base64: result.base64, costUsd: result.costUsd ?? 0 }
  }
}

function baseDepsOf(v: MotionRunValues, refs: VisionImage[], attached: VisionImage[]): MotionDeps {
  return {
    generateGif: async (prompt, timeoutMs, size) => {
      const result = await generateImage({
        prompt,
        model: MOTION_MODEL,
        quality: MOTION_QUALITY,
        // 1:1이 아닌 칸만 크기를 받는다(motion/engine GIF_FRAME_SIZES) — 없으면 지금 값
        size: size ?? MOTION_GIF.size,
        referenceImages: attached.map((r) => ({ base64: r.data, mimeType: r.mediaType })),
        animation: { frameCount: MOTION_GIF.frameCount, frameDurationMs: MOTION_GIF.frameDurationMs, totalMs: timeoutMs },
        agentName: v.agentName,
        runContext: { ...v.runContext, stage: `images/${v.section}/motion` },
      })
      return { base64: result.base64, costUsd: result.costUsd ?? 0 }
    },
    fetchPhoto: async (url) => {
      const image = await fetchImageAsBase64(url, PHOTO_FETCH_MS).catch(() => null)
      return image ? Buffer.from(image.data, 'base64') : null
    },
    judgeSheet: async (sheet, action) => {
      if (refs.length === 0) return null
      const sheetImage: VisionImage = { data: sheet.toString('base64'), mediaType: 'image/png' }
      // GIF 검사 route는 게이트와 나뉜다(R03 — 지금 배치는 같은 값, 새 배치는 Opus xhigh). 40초·재시도 0 그대로
      const { score, costUsd } = await judgeImageGate(
        refs,
        `motion frames 3x3 — ${action}`,
        sheetImage,
        { ...v.runContext, stage: `images/${v.section}/motion-gate` },
        SHEET_GATE_LIMITS,
        { lineCut: true },
        'images/gif-gate'
      )
      if (!score) return null
      const fail = score.same_product === false || score.has_artifact === true
      return { pass: !fail, reason: fail ? (score.artifact_reason || '상품 불일치').slice(0, 120) : '', costUsd }
    },
    upload: (kind, bytes, mimeType) => uploadPdpImage(v.db, v.userId, v.jobId, `${v.section}-${kind}`, bytes.toString('base64'), mimeType),
    elapsedMs: () => Date.now() - v.runStart,
    budgetMs: v.budgetMs,
  }
}
