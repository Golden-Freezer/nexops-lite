import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOB_COST_CAP_USD,
  isFirstGeneration,
  jobCapCutError,
  jobCostCapReached,
  jobCostCapStop,
  jobCostCapUsd,
  jobCostHeadroomUsd,
} from './job-cost-cap'
import { cutFailureReason } from './cut-failures'
import type { SectionImage } from './pdp-state'

const cut = (section: string, extra: Partial<SectionImage> = {}): SectionImage => ({ section, url: `https://cdn.test/${section}.png`, ...extra })
/** 편집기 재생성 기록이 남은 컷 — 생성이 한 번 끝난 잡에서만 생긴다 */
const editorCut = cut('point_1', { editorRegen: { status: 'done', requestedAt: '2026-11-08T00:00:00.000Z' } })

describe('잡당 비용 상한(점검 고침 5·R04, 오너 I4-2)', () => {
  it('env 값 — 비었거나 숫자가 아니거나 0 이하이면 기본 $10', () => {
    expect(DEFAULT_JOB_COST_CAP_USD).toBe(10)
    expect(jobCostCapUsd({})).toBe(10)
    expect(jobCostCapUsd({ PDP_JOB_COST_CAP_USD: ' ' })).toBe(10)
    expect(jobCostCapUsd({ PDP_JOB_COST_CAP_USD: 'abc' })).toBe(10)
    expect(jobCostCapUsd({ PDP_JOB_COST_CAP_USD: '-1' })).toBe(10)
    expect(jobCostCapUsd({ PDP_JOB_COST_CAP_USD: '0' })).toBe(10)
    expect(jobCostCapUsd({ PDP_JOB_COST_CAP_USD: '9.5' })).toBe(9.5)
  })

  it('첫 생성 = 편집기 재생성 기록이 없는 잡 — 최종 HTML이 생긴 뒤 단계(첫 화면 심사·최종 검수)도 첫 생성이다', () => {
    expect(isFirstGeneration({ section_images: [] })).toBe(true)
    expect(isFirstGeneration({ section_images: [cut('hero'), cut('point_1')] })).toBe(true)
    expect(isFirstGeneration({ section_images: [cut('hero'), editorCut] })).toBe(false)
  })

  it('남은 몫 — 첫 생성만, 넘었으면 0, 편집기 재생성 잡은 상한 없음', () => {
    expect(jobCostHeadroomUsd({ section_images: [], cost_usd: 2 }, 10)).toBe(8)
    expect(jobCostHeadroomUsd({ section_images: [], cost_usd: 12 }, 10)).toBe(0)
    expect(jobCostHeadroomUsd({ section_images: [editorCut], cost_usd: 12 }, 10)).toBeUndefined()
  })

  it('기준은 실제 청구액(job.cost_usd) — 구독 호출은 0원으로 쌓여 상한을 쓰지 않는다', () => {
    // 같은 잡을 전부 API로 돌리면 $7.26(12월 뒤 평균), 구독 경로를 섞으면 실제 청구는 $5.41 — 둘 다 상한 아래
    expect(jobCostCapReached({ section_images: [], cost_usd: 7.26 }, 10)).toBeNull()
    expect(jobCostCapReached({ section_images: [], cost_usd: 5.41 }, 10)).toBeNull()
    expect(jobCostCapReached({ section_images: [], cost_usd: 10 }, 10)).toEqual({ capUsd: 10, spentUsd: 10 })
    expect(jobCostCapReached({ section_images: [editorCut], cost_usd: 30 }, 10)).toBeNull()
  })

  it('단계 시작 멈춤 — 상한을 넘은 첫 생성의 이미지 앞 단계만, 이 잡 지출을 적는다', () => {
    const over = { section_images: [], cost_usd: 10.2 }
    expect(jobCostCapStop(over, 'copywriting', 10)).toBe('잡 비용 상한 $10 도달 — 이 잡 지출 $10.20. 잡을 멈춥니다.')
    expect(jobCostCapStop(over, 'analysis', 10)).not.toBeNull()
    expect(jobCostCapStop(over, 'research', 10)).not.toBeNull()
    expect(jobCostCapStop(over, 'design', 10)).not.toBeNull()
    expect(jobCostCapStop(over, 'images', 10)).toBeNull()
    expect(jobCostCapStop(over, 'compose', 10)).toBeNull()
    expect(jobCostCapStop(over, 'done', 10)).toBeNull()
    expect(jobCostCapStop({ section_images: [], cost_usd: 9.99 }, 'copywriting', 10)).toBeNull()
    expect(jobCostCapStop({ section_images: [editorCut], cost_usd: 20 }, 'copywriting', 10)).toBeNull()
  })

  it('만들지 않은 컷의 글은 결과 화면 사유로 읽힌다 — 상품 불일치로 뺀 컷은 그 사유가 앞선다', () => {
    expect(jobCapCutError(10)).toBe('잡 비용 상한($10)으로 만들지 않음')
    expect(cutFailureReason(jobCapCutError(10))).toBe('잡 비용 상한으로 만들지 않음')
    expect(cutFailureReason(`${jobCapCutError(10)} — 앞 컷 유지(x) — 페이지에서 뺌(상품 불일치: y)`)).toBe('원본과 다른 상품이라 뺌')
  })
})
