import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updatePdpJob } from './pdp-jobs'

const SAMPLE_ROW = {
  id: 'job-1',
  user_id: 'user-1',
  business_id: null,
  draft_id: null,
  spec_sheet: { productName: '테스트' },
  source_images: [],
  image_model: 'gpt-image-2',
  image_quality: 'medium',
  mode: 'pro',
  generation_track: 'standard',
  analysis: {},
  research_result: {},
  design_prompts: {},
  section_plan: {},
  copy_sections: {},
  section_images: [],
  final_html: null,
  current_step: 'images',
  progress: 70,
  error: null,
  cost_usd: 1,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
}

describe('updatePdpJob — spec 갱신', () => {
  const payloadOf = async (patch: Parameters<typeof updatePdpJob>[3]) => {
    const payloads: Array<Record<string, unknown>> = []
    const builder: Record<string, unknown> = {}
    builder.update = (payload: Record<string, unknown>) => {
      payloads.push(payload)
      return builder
    }
    builder.eq = () => builder
    builder.select = () => builder
    builder.single = () => Promise.resolve({ data: SAMPLE_ROW, error: null })
    await updatePdpJob({ from: () => builder } as unknown as SupabaseClient, 'user-1', 'job-1', patch)
    return payloads[0]
  }

  it('specSheet를 넘길 때만 spec_sheet 열을 쓴다', async () => {
    const specSheet = { productName: '소스', detectedCategory: 'food' }
    expect((await payloadOf({ specSheet })).spec_sheet).toEqual(specSheet)
    expect(await payloadOf({ currentStep: 'research' })).not.toHaveProperty('spec_sheet')
  })
})

describe('updatePdpJob corpus_version fail-safe', () => {
  it('신규 컬럼 UPDATE 실패를 경고로 흡수하고 본 잡 갱신 결과를 반환한다', async () => {
    const basePayloads: Array<Record<string, unknown>> = []
    const versionPayloads: Array<Record<string, unknown>> = []
    const versionFilters: Array<[string, string]> = []
    const baseBuilder: Record<string, unknown> = {}
    baseBuilder.update = (payload: Record<string, unknown>) => {
      basePayloads.push(payload)
      return baseBuilder
    }
    baseBuilder.eq = () => baseBuilder
    baseBuilder.select = () => baseBuilder
    baseBuilder.single = () => Promise.resolve({ data: SAMPLE_ROW, error: null })

    let versionEqCount = 0
    const versionBuilder = {
      update(payload: Record<string, unknown>) {
        versionPayloads.push(payload)
        return versionBuilder
      },
      eq(column: string, value: string) {
        versionFilters.push([column, value])
        versionEqCount += 1
        if (versionEqCount === 2) {
          return Promise.resolve({ error: { message: 'column corpus_version does not exist' } })
        }
        return versionBuilder
      },
    }

    const from = vi.fn()
      .mockReturnValueOnce(baseBuilder)
      .mockReturnValueOnce(versionBuilder)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await updatePdpJob(
      { from } as unknown as SupabaseClient,
      'user-1',
      'job-1',
      { currentStep: 'images', corpusVersion: 'v1:2026-08-20:legacy' }
    )

    expect(result.id).toBe('job-1')
    expect(basePayloads[0]).not.toHaveProperty('corpus_version')
    expect(versionPayloads).toEqual([{ corpus_version: 'v1:2026-08-20:legacy' }])
    expect(versionFilters).toEqual([
      ['user_id', 'user-1'],
      ['id', 'job-1'],
    ])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('잡 결과는 유지합니다'),
      expect.objectContaining({ jobId: 'job-1' })
    )
    warn.mockRestore()
  })
})
