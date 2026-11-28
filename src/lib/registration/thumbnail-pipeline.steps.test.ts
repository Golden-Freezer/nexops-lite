/**
 * runThumbnailStep 상태기계 전이 테스트 — 에이전트·이미지·스토리지·DB 전부 모킹.
 * 검증 대상: 분석→생성(체이닝 순서)→게이트→완료, 생성 실패 재시도(예산), 게이트 재생성·재판정.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CutGateDetail, ThumbnailJob } from './thumbnail-types'

// ─── 인메모리 잡 스토어 목 ───
let jobState: ThumbnailJob

vi.mock('./jobs', () => ({
  getThumbnailJob: vi.fn(async () => jobState),
  updateThumbnailJob: vi.fn(async (_db, _userId, _id, patch: Record<string, unknown>) => {
    jobState = {
      ...jobState,
      ...(patch.visionAnalysis !== undefined ? { visionAnalysis: patch.visionAnalysis } : {}),
      ...(patch.cuts !== undefined ? { cuts: patch.cuts } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
    } as ThumbnailJob
    return jobState
  }),
}))

const generateImageMock = vi.fn()
vi.mock('@/lib/agents/image/generate', () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
}))

vi.mock('./storage', () => ({
  uploadThumbnailCut: vi.fn(async (_db, _u, jobId, cut) => `https://cdn.test/${jobId}/${cut}.png`),
}))

const scoreGateMock = vi.fn()
vi.mock('@/lib/agents/registration/thumbnail-gate-agent', () => ({
  scoreGate: (...args: unknown[]) => scoreGateMock(...args),
}))

vi.mock('@/lib/agents/registration/thumbnail-vision-agent', () => ({
  fetchImageAsBase64: vi.fn(async () => ({ data: 'aW1n', mediaType: 'image/png' })),
  analyzeProduct: vi.fn(async () => ({
    success: true,
    data: {
      category: 'household',
      product_summary: 'a test product',
      primary_colors: ['#FF6600'],
      has_label_or_logo: false,
      is_wearable: false,
      product_form: 'single_item',
      package_role: 'none',
      reference_index: 0,
      confidence: 0.9,
    },
    usage: { inputTokens: 10, outputTokens: 10, cost: 0.001 },
    duration: 1,
  })),
  planImpactConcept: vi.fn(async () => ({ concept: 'Test concept.', costUsd: 0.001 })),
}))

import { runThumbnailStep } from './thumbnail-pipeline'
import { fetchImageAsBase64 } from '@/lib/agents/registration/thumbnail-vision-agent'

const DB = {} as never

function freshJob(): ThumbnailJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    businessId: null,
    draftId: null,
    sourceImages: ['https://src.test/a.png'],
    productName: '테스트',
    categoryHint: null,
    imageModel: 'gpt-image-2',
    imageQuality: 'medium',
    visionAnalysis: null,
    cuts: {},
    selectedCut: null,
    status: 'pending',
    progress: 0,
    error: null,
    costUsd: 0,
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:00Z',
  }
}

function passGate(passed = true): { gate: { passed: boolean; message: string | null; cuts: { cutout: CutGateDetail; studio: CutGateDetail } }; costUsd: number } {
  const detail = (p: boolean): CutGateDetail => ({
    passed: p,
    message: p ? null : '미통과',
    identity: { passed: p, same_product: p, consistency: p ? 0.9 : 0.4, has_artifact: false, message: null },
    presentation: {
      passed: p,
      not_continuous_single_photo: false,
      rectangular_boundary: false,
      planar_source_remnant: false,
      flat_margin_band: false,
      tight_bbox_occupancy: 0.5,
      warning: null,
      message: null,
    },
  })
  return { gate: { passed, message: null, cuts: { cutout: detail(passed), studio: detail(true) } }, costUsd: 0.01 }
}

beforeEach(() => {
  jobState = freshJob()
  generateImageMock.mockReset()
  scoreGateMock.mockReset()
  generateImageMock.mockResolvedValue({ base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' })
  scoreGateMock.mockResolvedValue(passGate(true))
})

async function drive(maxSteps = 12): Promise<ThumbnailJob> {
  for (let i = 0; i < maxSteps; i++) {
    const job = await runThumbnailStep(DB, 'user-1', 'job-1')
    if (!job || job.status === 'done' || job.status === 'failed') return job as ThumbnailJob
  }
  return jobState
}

describe('runThumbnailStep 상태기계', () => {
  it('행복 경로: 분석→cutout→studio→usage→게이트→done, 게이트 1회·이미지 3회', async () => {
    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.studio?.url).toBeTruthy()
    expect(job.cuts.usage?.url).toBeTruthy()
    expect(job.cuts.cutout?.gate?.passed).toBe(true)
    expect(job.cuts.usage?.gate).toBeUndefined()
    expect(generateImageMock).toHaveBeenCalledTimes(3)
    expect(scoreGateMock).toHaveBeenCalledTimes(1)
    expect(job.costUsd).toBeGreaterThan(0)
    // cutout 체이닝: studio 생성 콜(2번째)의 참조는 소스 1장 + cutout 1장 = 2장
    const studioCall = generateImageMock.mock.calls[1][0] as { referenceImages: unknown[] }
    expect(studioCall.referenceImages).toHaveLength(2)
  })

  it('생성 실패 1회 → 다음 run이 같은 컷을 재시도해 성공한다 (예산 1 소비)', async () => {
    generateImageMock.mockRejectedValueOnce(new Error('content filter'))
    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.cutout?.retried).toBe(true)
    expect(generateImageMock).toHaveBeenCalledTimes(4) // cutout 실패+재시도, studio, usage
  })

  it('같은 컷 2회 실패(예산 내 재시도까지 실패) → 올-오어-낫싱으로 잡 실패', async () => {
    generateImageMock.mockImplementation(async (input: { prompt: string }) => {
      if (input.prompt.includes('pure white')) throw new Error('cutout always fails')
      return { base64: 'aW1n', mimeType: 'image/png', model: 'gpt-image-2' }
    })
    const job = await drive()
    expect(job.status).toBe('failed')
    expect(job.error).toContain('cutout')
    // cutout이 없으므로 게이트는 실행되지 않는다 (원본 S8 조건)
    expect(scoreGateMock).not.toHaveBeenCalled()
  })

  it('게이트 미달 컷은 예산 내 1회 재생성 후 재판정한다', async () => {
    scoreGateMock.mockResolvedValueOnce(passGate(false)) // 1차: cutout 미통과
    scoreGateMock.mockResolvedValueOnce(passGate(true)) // 재판정: 통과
    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.retried).toBe(true)
    expect(scoreGateMock).toHaveBeenCalledTimes(2)
    expect(generateImageMock).toHaveBeenCalledTimes(4) // 3컷 + cutout 재생성
  })

  it('재판정도 미달이면 재시도 없이 잡은 성공으로 내린다 (게이트는 신호)', async () => {
    scoreGateMock.mockResolvedValue(passGate(false))
    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.gate?.passed).toBe(false)
    expect(scoreGateMock).toHaveBeenCalledTimes(2)
  })

  it('비용 상한($2) 도달 시 잡을 실패로 중단한다', async () => {
    jobState.costUsd = 2.5
    const job = await runThumbnailStep(DB, 'user-1', 'job-1')
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('상한')
  })

  it('done 잡은 그대로 반환한다 (멱등)', async () => {
    jobState.status = 'done'
    const job = await runThumbnailStep(DB, 'user-1', 'job-1')
    expect(job?.status).toBe('done')
    expect(generateImageMock).not.toHaveBeenCalled()
  })
})

describe('참조 이미지 일시 로드 실패 — 잡 전체 실패 대신 컷 재시도로 흡수', () => {
  const IMG = { data: 'aW1n', mediaType: 'image/png' as const }

  beforeEach(() => {
    vi.mocked(fetchImageAsBase64).mockReset()
    vi.mocked(fetchImageAsBase64).mockImplementation(async () => IMG)
  })

  it('생성 run의 참조 로드 실패는 그 컷의 실패로 기록되고, 다음 run 재시도로 회복한다', async () => {
    // 1번째 = 분석 run의 소스 로드, 2번째 = cutout 생성 run의 참조 로드(일시 실패)
    vi.mocked(fetchImageAsBase64).mockResolvedValueOnce(IMG).mockResolvedValueOnce(null)
    await runThumbnailStep(DB, 'user-1', 'job-1') // 분석
    const afterFail = await runThumbnailStep(DB, 'user-1', 'job-1') // cutout — 참조 로드 실패
    expect(afterFail?.status).toBe('generating')
    expect(afterFail?.cuts.cutout?.error).toContain('참조 이미지 로드 실패')
    expect(generateImageMock).not.toHaveBeenCalled()

    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.cutout?.retried).toBe(true)
    expect(generateImageMock).toHaveBeenCalledTimes(3)
  })

  it('게이트 재생성 run의 참조 로드 실패는 기존 컷을 유지하고 잡을 실패로 뒤집지 않는다', async () => {
    scoreGateMock.mockResolvedValueOnce(passGate(false)) // 1차: cutout 미통과 → 재생성 예약
    vi.mocked(fetchImageAsBase64).mockImplementation(async () =>
      jobState.status === 'gating' && jobState.cuts.cutout?.regen ? null : IMG,
    )
    const job = await drive()
    expect(job.status).toBe('done')
    expect(job.cuts.cutout?.url).toBeTruthy()
    expect(job.cuts.cutout?.retried).toBe(true)
    expect(job.cuts.cutout?.error).toContain('cutout 재생성 실패')
    expect(generateImageMock).toHaveBeenCalledTimes(3) // 재생성 생성 콜은 참조가 없어 나가지 않았다
  })
})
