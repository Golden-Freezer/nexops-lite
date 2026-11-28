/**
 * 구독 멈춤 표지 잡의 단계 저장이 그사이 웹이 남긴 멈춤 기록을 지우지 않는다(AX-CT-29 결정 45 — updatePdpJob 한 곳).
 * - 표지 없는 잡·run 문맥 밖 저장: 조건·읽기를 더하지 않는다(호출 모양이 지금과 같다).
 * - 표지 잡 run 안에서 section_plan 을 쓰는 저장: '멈춤 기록 없음' 조건을 붙이고, 기록이 있으면(0행) 그 기록을 넣어 다시 쓴다.
 * Supabase 는 조건(eq·is)을 실제로 따지는 가짜 행 하나로 대신하고, 모든 호출을 기록한다(DB 0).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signalsFromRuns, type JobRunRow } from '@/lib/ops/incidents/signals'
import { updatePdpJob } from './pdp-jobs'
import { runWithPdpBatch } from './pdp-model-batch-context'
import type { SectionPlan } from './pdp-state'

const h = vi.hoisted(() => ({ runs: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ops/job-runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/ops/job-runs')>()),
  recordJobRun: async (_db: unknown, input: Record<string, unknown>) => (h.runs.push(input), { recorded: true }),
}))
beforeEach(() => {
  h.runs = []
})

const HALT = { at: '2026-11-12T05:00:00.000Z', stage: 'design', reason: 'worker_stale' as const, detail: '웹' }

function row(sectionPlan: Record<string, unknown>) {
  return {
    id: 'job-1',
    user_id: 'user-1',
    business_id: null,
    draft_id: null,
    spec_sheet: { productName: '컵', modelBatch: 'new', modelBackend: 'subscription', subscriptionStop: true },
    source_images: [],
    image_model: 'gpt-image',
    image_quality: 'high',
    mode: 'pro',
    generation_track: 'standard',
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: sectionPlan,
    copy_sections: {},
    section_images: [],
    final_html: null,
    current_step: 'design',
    progress: 30,
    error: null,
    cost_usd: 0,
    cost_pool: null,
    created_at: '2026-11-12T04:00:00.000Z',
    updated_at: '2026-11-12T04:50:00.000Z',
  } as Record<string, unknown>
}

/** 행 하나 — update(...).eq/is(...).select().single() 와 select(col).eq().eq().maybeSingle() 만. 호출을 순서대로 남긴다 */
function fakeDb(stored: Record<string, unknown>) {
  const calls: string[] = []
  const matches = (conds: Array<(r: Record<string, unknown>) => boolean>) => conds.every((c) => c(stored))
  const db = {
    from: (table: string) => {
      calls.push(`from:${table}`)
      const conds: Array<(r: Record<string, unknown>) => boolean> = []
      let fields: Record<string, unknown> | null = null
      const builder = {
        update(f: Record<string, unknown>) {
          calls.push(`update:${Object.keys(f).sort().join(',')}`)
          fields = f
          return builder
        },
        select(cols?: string) {
          calls.push(fields ? 'select' : `select:${cols}`)
          if (fields) {
            return {
              single: async () => {
                calls.push('single')
                if (!matches(conds)) return { data: null, error: { code: 'PGRST116', message: '0 rows' } }
                Object.assign(stored, fields)
                return { data: { ...stored }, error: null }
              },
            }
          }
          return builder
        },
        eq(column: string, value: unknown) {
          calls.push(`eq:${column}`)
          const path = /^section_plan->subscription_halt->>(\w+)$/.exec(column)
          if (path) {
            conds.push((r) => {
              const halt = (r.section_plan as Record<string, unknown>).subscription_halt as Record<string, unknown> | undefined
              return halt != null && typeof halt === 'object' && halt[path[1]] === value
            })
          } else conds.push((r) => r[column] === value)
          return builder
        },
        is(column: string, value: unknown) {
          calls.push(`is:${column}`)
          const key = column.replace(/^section_plan->>/, '')
          // ->> 는 글자로 꺼낸다 — 없거나 JSON null 일 때만 SQL null
          conds.push((r) => {
            const v = (r.section_plan as Record<string, unknown>)[key]
            return (v === undefined || v === null ? null : String(v)) === value
          })
          return builder
        },
        async maybeSingle() {
          calls.push('maybeSingle')
          return matches(conds) ? { data: { section_plan: stored.section_plan }, error: null } : { data: null, error: null }
        },
      }
      return builder
    },
  }
  return { db: db as never, calls, stored }
}

const stepSave = (plan: SectionPlan) => ({ sectionPlan: plan, currentStep: 'copywriting' as const, progress: 50, error: null })

describe('updatePdpJob — 구독 멈춤 기록 보존(결정 45)', () => {
  it('표지 없는 잡(run 문맥 밖·stop false 문맥): 조건·읽기 0 — 두 경우 호출 모양이 같고, 지금처럼 section_plan 을 통째로 쓴다', async () => {
    const outside = fakeDb(row({ subscription_halt: HALT }))
    await updatePdpJob(outside.db, 'user-1', 'job-1', stepSave({ reasoning: '새 계획' }))
    const inApiRun = fakeDb(row({ subscription_halt: HALT }))
    await runWithPdpBatch('new', () => updatePdpJob(inApiRun.db, 'user-1', 'job-1', stepSave({ reasoning: '새 계획' })), 'subscription', false)
    const expected = ['from:registration_pdp_jobs', 'update:current_step,error,progress,section_plan,updated_at', 'eq:user_id', 'eq:id', 'select', 'single']
    expect(outside.calls).toEqual(expected)
    expect(inApiRun.calls).toEqual(expected)
    expect(outside.stored.section_plan).toEqual({ reasoning: '새 계획' }) // 표지 없는 잡은 이 PR 전과 같은 저장
  })

  it('표지 잡 run 안에서도 section_plan 을 쓰지 않는 저장은 조건을 붙이지 않는다', async () => {
    const f = fakeDb(row({ subscription_halt: HALT }))
    await runWithPdpBatch('new', () => updatePdpJob(f.db, 'user-1', 'job-1', { error: 'x' }), 'subscription', true)
    expect(f.calls).not.toContain('is:section_plan->>subscription_halt')
    expect(f.calls.filter((c) => c === 'single')).toHaveLength(1)
  })

  it('표지 잡 run, 멈춤 기록 없음: 조건 한 번 붙여 한 번에 저장 — 추가 읽기 0', async () => {
    const f = fakeDb(row({ reasoning: '옛' }))
    const out = await runWithPdpBatch('new', () => updatePdpJob(f.db, 'user-1', 'job-1', stepSave({ reasoning: '새 계획' })), 'subscription', true)
    expect(f.calls).toEqual([
      'from:registration_pdp_jobs',
      'update:current_step,error,progress,section_plan,updated_at',
      'eq:user_id',
      'eq:id',
      'is:section_plan->>subscription_halt',
      'select',
      'single',
    ])
    expect(out.section_plan).toEqual({ reasoning: '새 계획' })
    expect(out.current_step).toBe('copywriting')
  })

  it('표지 잡 run, 그사이 웹이 멈춤을 기록: 0행 → 기록을 읽어 넣고 다시 써 단계 결과는 저장되고 멈춤 기록은 남는다', async () => {
    const f = fakeDb(row({ reasoning: '옛', subscription_halt: HALT }))
    const out = await runWithPdpBatch('new', () => updatePdpJob(f.db, 'user-1', 'job-1', stepSave({ reasoning: '새 계획', activated_sections: ['hook'] } as SectionPlan)), 'subscription', true)
    expect(out.section_plan).toEqual({ reasoning: '새 계획', activated_sections: ['hook'], subscription_halt: HALT })
    expect(out.current_step).toBe('copywriting')
    expect(f.calls.filter((c) => c === 'maybeSingle')).toHaveLength(1)
    expect(f.calls.filter((c) => c === 'single')).toHaveLength(2)
    // 다시 쓰는 저장은 기록을 담고 있어 조건을 다시 붙이지 않는다
    expect(f.calls.filter((c) => c === 'is:section_plan->>subscription_halt')).toHaveLength(1)
  })
})

/** 합성(stepCompose) 마지막 저장과 같은 꼴 — reviews 가 없으면 section_plan 을 싣지 않는다 */
const composeSave = (plan?: SectionPlan) => ({
  finalHtml: '<html/>',
  ...(plan ? { sectionPlan: plan, costUsd: 0.3 } : {}),
  currentStep: 'done' as const,
  progress: 100,
  error: null,
})
const inStopRun = <T>(fn: () => Promise<T>) => runWithPdpBatch('new', fn, 'subscription', true)

describe('updatePdpJob — 끝내는 저장과 멈춤 기록(결정 46)', () => {
  it('표지 없는 잡의 합성 저장은 그대로 — 조건·읽기·사건 줄 0, 호출 모양 같음', async () => {
    const f = fakeDb(row({ reasoning: '옛', subscription_halt: HALT }))
    await runWithPdpBatch('new', () => updatePdpJob(f.db, 'user-1', 'job-1', composeSave()), 'subscription', false)
    expect(f.calls).toEqual([
      'from:registration_pdp_jobs',
      'update:current_step,error,final_html,progress,updated_at',
      'eq:user_id',
      'eq:id',
      'select',
      'single',
    ])
    expect(h.runs).toHaveLength(0)
  })

  it('표지 잡 run, 멈춤 기록 없음: 조건 한 번 붙여 한 번에 끝냄 — 추가 읽기·사건 줄 0', async () => {
    const f = fakeDb(row({ reasoning: '옛' }))
    const out = await inStopRun(() => updatePdpJob(f.db, 'user-1', 'job-1', composeSave()))
    expect(out.current_step).toBe('done')
    expect(f.calls.filter((c) => c === 'is:section_plan->>subscription_halt')).toHaveLength(1)
    expect(f.calls).not.toContain('maybeSingle')
    expect(h.runs).toHaveLength(0)
  })

  it.each([
    ['reviews 없음(section_plan 안 실음)', undefined],
    ['reviews 있음(section_plan 실음)', { reasoning: '옛', first_screen: { ok: true } } as unknown as SectionPlan],
  ])('합성 저장 도중 웹 멈춤(%s) → 잡 done·멈춤 기록 없음·ok 줄 1개(같은 at) → signals 에서 그 사건이 닫힌다', async (_label, plan) => {
    const f = fakeDb(row({ reasoning: '옛', subscription_halt: HALT }))
    const out = await inStopRun(() => updatePdpJob(f.db, 'user-1', 'job-1', composeSave(plan)))
    expect(out.current_step).toBe('done')
    expect(out.error).toBeNull()
    expect(out.section_plan.subscription_halt).toBeUndefined()
    expect((f.stored.section_plan as Record<string, unknown>).subscription_halt).toBeUndefined()
    expect(out.section_plan.reasoning).toBe('옛')
    if (plan) expect((out.section_plan as Record<string, unknown>).first_screen).toEqual({ ok: true })
    expect(f.calls.filter((c) => c === 'eq:section_plan->subscription_halt->>at')).toHaveLength(1)
    expect(h.runs).toEqual([
      { jobKey: 'pdp-subscription-halt', status: 'ok', userId: 'user-1', detail: { job: 'job-1', stage: 'design', at: HALT.at, finished: true } },
    ])

    // 웹이 쓴 멈춤 줄(recordSubscriptionHaltRun 꼴) + 이 ok 줄 → 같은 사건이 열리고 닫힌다
    const { recordSubscriptionHaltRun } = await import('./pdp-subscription')
    await recordSubscriptionHaltRun({} as never, 'user-1', 'job-1', HALT)
    const rows: JobRunRow[] = [h.runs[1], h.runs[0]].map((r, i) => ({
      job_key: r.jobKey as string,
      status: r.status as JobRunRow['status'],
      user_id: r.userId as string,
      finished_at: `2026-11-12T05:0${i}:30.000Z`,
      detail: r.detail as Record<string, unknown>,
    }))
    const { failures, recoveries } = signalsFromRuns(rows)
    expect(failures).toHaveLength(1)
    expect(recoveries.map((r) => r.fingerprint)).toEqual([failures[0].fingerprint])
    expect(recoveries[0].note).toBe('상세페이지 잡 완료(잡 job-1)')
  })

  it('끝내는 저장은 메모리에 남은 멈춤 기록도 싣지 않는다', async () => {
    const f = fakeDb(row({ reasoning: '옛' }))
    const out = await inStopRun(() => updatePdpJob(f.db, 'user-1', 'job-1', composeSave({ reasoning: '새', subscription_halt: HALT } as SectionPlan)))
    expect(out.current_step).toBe('done')
    expect(out.section_plan).toEqual({ reasoning: '새' })
    expect(h.runs).toHaveLength(0)
  })
})

describe('updatePdpJob — 멈춤 기록 다시 쓰기 시도 한도(결정 46, 검수 지적 3)', () => {
  it('멈춤 기록이 거짓 값으로 저장돼 있으면(조건은 늘 0행, 읽은 기록은 없음) 한도에서 전과 같은 꼴로 던진다', async () => {
    const f = fakeDb(row({ reasoning: '옛', subscription_halt: false }))
    await expect(inStopRun(() => updatePdpJob(f.db, 'user-1', 'job-1', stepSave({ reasoning: '새 계획' })))).rejects.toThrow(/^PDP 잡 갱신 실패: /)
    expect(f.calls.filter((c) => c === 'single')).toHaveLength(3)
    expect(f.stored.section_plan).toEqual({ reasoning: '옛', subscription_halt: false })
  })

  it('끝내는 저장도 같은 한도 — 거짓 값 기록이면 던지고 사건 줄 0', async () => {
    const f = fakeDb(row({ reasoning: '옛', subscription_halt: false }))
    await expect(inStopRun(() => updatePdpJob(f.db, 'user-1', 'job-1', composeSave()))).rejects.toThrow(/^PDP 잡 갱신 실패: /)
    expect(f.calls.filter((c) => c === 'single')).toHaveLength(3)
    expect(h.runs).toHaveLength(0)
  })
})
