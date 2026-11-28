/**
 * 메인 카피 옵션 수 한 줄(specfixed, 결정 카드 c27·하네스 J23) — 등록 옵션 구조가 없는 잡에만 판매자 입력 옵션 수를 사실 블록 앞에 준다.
 * 꺼진 잡·등록 옵션 구조 잡은 사실 블록이 지금 그대로다. 카피 입력만 만든다(콜 0·DB 0).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { fixtureToJob, loadEnrichmentFixture } from './__golden__/golden-harness'
import { copyStepInputs } from './pdp-pipeline'
import type { PdpJobRow, PdpSpecSheet } from './pdp-state'

function jobOf(extraFeatures: string[], spec: Partial<PdpSpecSheet>): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  const features = [...(job.analysis.enrichment?.features ?? []), 'designcut', 'templatelib', ...extraFeatures]
  return {
    ...job,
    spec_sheet: { ...job.spec_sheet, ...spec },
    analysis: { ...job.analysis, enrichment: { version: 1, features } },
  } as PdpJobRow
}

const factsOf = (job: PdpJobRow) => (copyStepInputs(job, 'user-1', undefined).input as { factsBlock?: string }).factsBlock ?? ''
const OPTION_HEAD = '## [사실 값 — 옵션 수는 이 값만 쓴다]'

describe('copyStepInputs — specfixed 옵션 수 한 줄', () => {
  it('켠 잡이고 등록 옵션 구조가 없으면 판매자 입력 옵션 수 블록이 사실 블록 맨 앞에 붙는다', () => {
    const on = factsOf(jobOf(['specfixed'], { colorOptions: ['레드', '블루'] }))
    const off = factsOf(jobOf([], { colorOptions: ['레드', '블루'] }))
    expect(on.startsWith(`${OPTION_HEAD}\n- 옵션 2개: 레드/블루\n- 위 개수와 다른 옵션 수를 쓰지 않는다.`)).toBe(true)
    expect(off).not.toContain(OPTION_HEAD)
    // 나머지 블록은 같다
    expect(on.endsWith(off)).toBe(true)
  })

  it('켠 잡도 옵션 입력이 없으면 블록이 없다', () => {
    expect(factsOf(jobOf(['specfixed'], { colorOptions: [] }))).toBe(factsOf(jobOf([], { colorOptions: [] })))
  })

  it('등록 옵션 구조 잡은 지금의 사실 값 블록(등록 옵션 N개) 그대로다', () => {
    const optionSpec = {
      source: 'manual',
      axes: [{ kind: 'color', name: '색상', values: ['레드', '블루'] }],
      variants: [
        { label: '레드', values: { color: '레드' } },
        { label: '블루', values: { color: '블루' } },
      ],
    } as never
    const on = factsOf(jobOf(['specfixed'], { optionSpec }))
    expect(on).toBe(factsOf(jobOf([], { optionSpec })))
    expect(on).toContain('등록 옵션 2개')
    expect(on).not.toContain(OPTION_HEAD)
  })
})
