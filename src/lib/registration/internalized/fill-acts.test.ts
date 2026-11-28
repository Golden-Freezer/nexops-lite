/**
 * 채움 재설계(fillacts) — 사진 막 2개(각 실사용 1·디테일 1) + 큰 POINT 사진 한 장씩. 끄면 지금 채움(20섹션) 그대로인지, 켜면 막 수·자리·컷 수가 약속대로인지 본다.
 * 실제 컷·높이는 재지 않는다(R15).
 */

import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import { checkMobileReadability } from '@/lib/registration/editor/utils/mobileReadability'
import { fixtureToJob, loadEnrichmentFixture } from '../__golden__/golden-harness'
import { applyDesignSkeleton, resolveDesignSkeleton } from '../pdp-enrichment-stage'
import { buildImageTasks } from '../pdp-image-tasks'
import type { PdpJobRow } from '../pdp-state'
import { mergeManualStrategy } from '../pdp-strategy-contract'
import { measurePage } from '../eval/page-measure'
import { buildDesigncutPlan } from './designcut-plan'
import { FILL_ANGLES, SHOT_ANGLES, fillactsEnabled, planExtraShotsForLength, pointCutsOf } from './shot-diversity'

const BASE = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'designcut2', 'shotdiv']
const FILL = [...BASE, 'fillacts']
const BEHIND = SHOT_ANGLES.length

function jobOf(features: string[], tags?: string[]): PdpJobRow {
  const job = fixtureToJob(loadEnrichmentFixture('A-track-i'))
  job.analysis = { ...job.analysis, enrichment: { version: 1, features } } as PdpJobRow['analysis']
  job.spec_sheet = { ...job.spec_sheet, material: 'PE' }
  if (tags) job.copy_sections = { ...job.copy_sections, final: { ...job.copy_sections.final!, usageSceneTags: tags } as never }
  const strategy = mergeManualStrategy(job.analysis.recommended_strategy_contract ?? {}, job.spec_sheet, [])
  job.section_plan = applyDesignSkeleton(job.section_plan, resolveDesignSkeleton(job, strategy))
  return job
}
const planFor = (job: PdpJobRow) => planExtraShotsForLength(job, pointCutsOf(job))!
const withShots = (job: PdpJobRow): PdpJobRow => ({ ...job, section_plan: { ...job.section_plan, extra_shots: planFor(job) } })
const keysOf = (shots: ReadonlyArray<{ key: string }>) => shots.map((s) => s.key)

describe('컷 계획', () => {
  it('막 2개 각 2장 + 큰 POINT 사진 3장 — 키가 겹치지 않고 POINT·자세히 보기 컷 번호 뒤다', () => {
    const job = jobOf(FILL, ['#아침 출근길', '#주말 나들이'])
    const plan = planFor(job)
    expect(plan.acts).toHaveLength(2)
    expect(plan.acts!.map((a) => a.keys.length)).toEqual([2, 2])
    expect(plan.shots.filter((s) => s.point !== undefined).map((s) => s.point)).toEqual([0, 1, 2])
    // 막 4장 + POINT 3장 + 메시지 컷(designcut-fill — 빈 섹션을 채우는 만큼)
    expect(plan.shots.filter((s) => !s.message)).toHaveLength(7)
    expect(new Set(keysOf(plan.shots)).size).toBe(plan.shots.length)
    const pointKeys = new Set(keysOf(plan.points))
    expect(keysOf(plan.shots).filter((k) => pointKeys.has(k))).toEqual([])
    // 막 컷은 모두 shots에 있다
    expect(plan.acts!.flatMap((a) => a.keys).every((k) => keysOf(plan.shots).includes(k))).toBe(true)
  })

  it('각 막은 실사용 1 + 디테일 1 — 장면 태그 둘이 막 제목이 된다', () => {
    const plan = planFor(jobOf(FILL, ['#아침 출근길', '#주말 나들이']))
    const purposeOf = (key: string) => plan.shots.find((s) => s.key === key)!.purpose
    expect(plan.acts!.map((a) => purposeOf(a.keys[0]))).toEqual(['scene', 'scene'])
    expect(plan.acts!.every((a) => purposeOf(a.keys[1]) !== 'scene')).toBe(true)
    expect(plan.acts!.map((a) => a.title)).toEqual(['아침 출근길', '주말 나들이'])
  })

  it('붙어 쓴 태그는 막 제목으로 쓰지 않는다 — 컷의 장면 지시로는 남는다', () => {
    const plan = planFor(jobOf(FILL, ['#출근길필수아이템추천', '#주말 나들이']))
    expect(plan.acts![0].title).toBe('구석구석 보면')
    expect(plan.acts![1].title).toBe('주말 나들이')
    expect(plan.shots.find((s) => s.key === plan.acts![0].keys[0])!.caption).toBe('출근길필수아이템추천')
  })

  it('다섯 음절이 붙은 태그도 막 제목으로 쓰지 않고, 네 음절과 띄어 쓴 태그는 쓴다(R17 C3)', () => {
    expect(planFor(jobOf(FILL, ['#거실밥자리', '#퇴근후샤워'])).acts!.map((a) => a.title)).toEqual(['구석구석 보면', '한 번 더 보면'])
    expect(planFor(jobOf(FILL, ['#식기교체', '#거실 밥자리'])).acts!.map((a) => a.title)).toEqual(['식기교체', '거실 밥자리'])
  })

  it('태그가 없으면 둘째 막 실사용 자리는 넓은 앵글 — 같은 컷을 되풀이하지 않고 뒤에서 본 컷은 쓰지 않는다', () => {
    const plan = planFor(jobOf(FILL, []))
    // 막 4장 + POINT 3장 + 메시지 컷(designcut-fill — 빈 섹션을 채우는 만큼)
    expect(plan.shots.filter((s) => !s.message)).toHaveLength(7)
    expect(new Set(keysOf(plan.shots)).size).toBe(plan.shots.length)
    expect(plan.acts!.map((a) => a.title)).toEqual(['구석구석 보면', '한 번 더 보면'])
    const second = plan.shots.find((s) => s.key === plan.acts![1].keys[0])!
    expect(second.purpose).toBe('angle')
    expect(FILL_ANGLES[second.angle! - BEHIND]).toContain('wider view')
  })

  it('어떤 입력에도 뒤에서 본 컷·20섹션 채움 컷이 없다', () => {
    for (const tags of [[], ['#한 곳'], ['#아침 출근길', '#주말 나들이', '#저녁 산책', '#카페 나들이']]) {
      const plan = planFor(jobOf(FILL, tags))
      expect(plan.shots.some((s) => s.angle === BEHIND)).toBe(false)
      expect(plan.shots.filter((s) => !s.message).length).toBe(7)
    }
  })

  it('POINT 사진은 첫 컷과 다른 목적이고 그 항목의 주제 글을 남긴다', () => {
    const plan = planFor(jobOf(FILL, []))
    plan.shots
      .filter((s) => s.point !== undefined)
      .forEach((s) => {
        const first = plan.points[s.point!]
        expect(s.purpose).not.toBe(first.purpose === 'angle' ? '' : first.purpose)
        expect(s.show).toBe(first.show)
      })
  })

  it('스위치 없음·D2 아님이면 지금 계획 그대로 — acts·point 칸이 없다', () => {
    const off = planFor(jobOf(BASE))
    expect(off.acts).toBeUndefined()
    expect(off.shots.some((s) => s.point !== undefined)).toBe(false)
    expect(fillactsEnabled(jobOf(BASE))).toBe(false)
    const notD2 = jobOf(['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options', 'designcut', 'shotdiv', 'fillacts'])
    expect(fillactsEnabled(notD2)).toBe(false)
    expect(planFor(notD2).acts).toBeUndefined()
  })
})

describe('디자인 컷 계획', () => {
  const sectionsOf = (job: PdpJobRow) => buildDesigncutPlan(withShots(job))!.sections

  it('사진 막은 2개뿐이고 자세히 보기 뒤·상품 정보 표 앞에 놓인다 — POINT 사이에 끼지 않는다', () => {
    const sections = sectionsOf(jobOf(FILL, ['#아침 출근길', '#주말 나들이']))
    const t10 = sections.filter((s) => s.template === 'T10')
    expect(t10.map((s) => s.key)).toEqual(['long:shot:0', 'long:shot:1'])
    const keys = sections.map((s) => s.key)
    const at = (key: string) => keys.indexOf(key)
    const lastPoint = Math.max(...sections.flatMap((s, i) => (s.template === 'T3a' && s.chapter !== null ? [i] : [])))
    expect(at('long:shot:0')).toBeGreaterThan(lastPoint)
    const table = sections.find((s) => s.key === 'long:info')
    if (table) expect(at('long:shot:1')).toBeLessThan(at('long:info'))
  })

  it('막은 제목 한 줄과 사진 둘 — 사진 캡션이 없다', () => {
    const t10 = sectionsOf(jobOf(FILL, ['#아침 출근길', '#주말 나들이'])).filter((s) => s.template === 'T10')
    expect(t10.map((s) => s.text.headline)).toEqual(['아침 출근길', '주말 나들이'])
    for (const s of t10) {
      const m10 = s.modules.find((m) => m.type === 'M10') as { data: { scenes: Array<{ caption: string }> } }
      expect(m10.data.scenes.map((x) => x.caption)).toEqual(['', ''])
    }
  })

  it('큰 POINT마다 사진 한 장이 붙는다', () => {
    const job = withShots(jobOf(FILL, []))
    const points = buildDesigncutPlan(job)!.sections.filter((s) => s.template === 'T3a')
    const photoOf = (s: (typeof points)[number]) => (s.modules.find((m) => m.type === 'M10') as { data: { scenes: Array<{ imageKey: string }> } } | undefined)?.data.scenes[0].imageKey
    const planned = job.section_plan.extra_shots!.shots.filter((s) => s.point !== undefined)
    expect(points.map(photoOf).filter(Boolean)).toEqual(keysOf(planned).slice(0, points.length))
  })

  it('사진만 있는 막은 채움 막이 7~8개였던 지금보다 적다', () => {
    const shotsOf = (features: string[]) => sectionsOf(jobOf(features, ['#아침 출근길', '#주말 나들이'])).filter((s) => s.template === 'T10').length
    expect(shotsOf(FILL)).toBeLessThan(shotsOf(BASE))
  })
})

describe('이미지 태스크', () => {
  it('계획의 컷을 모두 만들고 다른 추가 컷이 없다', () => {
    const job = withShots(jobOf(FILL, ['#아침 출근길', '#주말 나들이']))
    const tasks = buildImageTasks(job).map((t) => t.section)
    for (const key of keysOf(job.section_plan.extra_shots!.shots)) expect(tasks, key).toContain(key)
    expect(tasks.filter((s) => s.startsWith('long_scene:'))).toEqual(['long_scene:0', 'long_scene:1'])
  })
})

describe('편집기 문서', () => {
  const fullOf = (features: string[]): PdpJobRow => {
    const job = withShots(jobOf(features, ['#아침 출근길', '#주말 나들이']))
    const plan = { ...buildDesigncutPlan(job)!, layout: 2 as const }
    const hero = job.section_images.find((s) => s.section === 'hero')!
    const images = keysOf(job.section_plan.extra_shots!.shots).map((section) => ({ ...hero, section, url: `https://cdn.test/${section.replace(':', '_')}.png` }))
    return { ...job, section_images: [...job.section_images.filter((s) => !images.some((i) => i.section === s.section)), ...images], section_plan: { ...job.section_plan, designcut: plan } }
  }
  const docOf = async (features: string[]) => {
    const full = fullOf(features)
    return buildEditorDocument(full.id, assembleEditorDataResponse(full, null))
  }

  it('마무리 뒤에 사이즈·상품 정보가 와도 측정의 마무리 규칙(R5)이 통과하고, 섹션 수(R6)는 그 표까지 센다', async () => {
    const full = fullOf(FILL)
    const doc = await buildEditorDocument(full.id, assembleEditorDataResponse(full, null))
    const rules = (await measurePage(full, doc)).persuasion.rules
    expect(rules.find((r) => r.id === 'R5')?.pass).toBe(true)
    const r6 = rules.find((r) => r.id === 'R6')!
    expect(r6.detail ?? '').not.toContain(`섹션 ${doc.sections.length - 2}개`)
    // 끄면 지금 판정 그대로 — 표를 잘라 내지 않는다
    const off = fullOf(BASE)
    expect(off.section_plan.designcut?.factsLast).toBeUndefined()
  })

  it('큰 POINT 끝에 사진이 놓이고, 없는 POINT는 그대로다', async () => {
    const doc = await docOf(FILL)
    // 장 번호가 있는 큰 POINT만 — 메시지 섹션(designcut-fill)은 사진 한 장이고 POINT 사진이 붙지 않는다
    const t3a = doc.sections.filter((s) => s.layoutId === 'designcut_T3a')
    const isPoint = (s: (typeof t3a)[number]) => s.elements.some((e) => e.name.startsWith('designcut-chapter'))
    const points = t3a.filter(isPoint)
    expect(points.length).toBeGreaterThan(0)
    for (const sec of points) {
      const [photo, ...rest] = sec.elements.filter((e) => e.name === 'designcut-point-photo')
      expect(rest).toEqual([])
      expect(photo.framedImageProps?.objectFit).toBe('cover')
      expect(photo.transform.width).toBe(photo.transform.height)
      expect(photo.transform.y + photo.transform.height).toBeLessThanOrEqual(sec.canvas.height)
      expect(photo.zIndex).toBeGreaterThan(Math.min(...sec.elements.map((e) => e.zIndex)))
      // 앞 사진과 겹치지 않는다
      const others = sec.elements.filter((e) => e !== photo && (e.type === 'framed-image' || e.type === 'image'))
      for (const other of others) expect(other.transform.y + other.transform.height).toBeLessThanOrEqual(photo.transform.y)
    }
    const messages = t3a.filter((s) => !isPoint(s))
    for (const sec of messages) expect(sec.elements.some((e) => e.name === 'designcut-point-photo')).toBe(false)
    const off = await docOf(BASE)
    expect(off.sections.flatMap((s) => s.elements).some((e) => e.name === 'designcut-point-photo')).toBe(false)
  })

  it('메시지 섹션은 장 번호 없이 글과 자기 컷으로 그려지고 형태 변형이 돌아가도 모바일 위반이 없다', async () => {
    const job = withShots(jobOf(FILL, ['#아침 출근길', '#주말 나들이']))
    const count = job.section_plan.extra_shots!.shots.filter((s) => s.message).length
    const doc = await docOf(FILL)
    const messages = doc.sections.filter((s) => s.layoutId === 'designcut_T3a' && !s.elements.some((e) => e.name.startsWith('designcut-chapter')))
    expect(messages).toHaveLength(count)
    for (const sec of messages) {
      expect(sec.elements.filter((e) => e.type === 'framed-image' || e.type === 'image').length).toBeGreaterThan(0)
      expect(sec.elements.some((e) => e.type === 'text')).toBe(true)
    }
    // main_cut 유형을 더하지 않는다 — 규칙 R1·주석이 그 유형을 첫 화면으로 읽는다
    expect(messages.map((s) => String(s.sectionType))).not.toContain('main_cut')
    // 문서에서도 끝 두 자리는 사이즈 → 상품 정보이고 마무리는 그 앞이다(오너 지시 11-01)
    expect(doc.sections.slice(-2).map((s) => s.layoutId)).toEqual(['designcut_T6', 'designcut_T9'])
    expect(doc.sections.at(-3)?.layoutId).toBe('designcut_T8')
    const types = new Set(messages.map((s) => String(s.sectionType)))
    expect(checkMobileReadability(doc).violations.filter((v) => types.has(v.section) && v.rule === 'M2' && /사진 위/.test(v.detail))).toEqual([])
  })

  it('막은 사진 두 장으로 그려지고 캡션 글이 없다. 막·POINT 섹션에 모바일 위반이 없다', async () => {
    const doc = await docOf(FILL)
    const acts = doc.sections.filter((s) => s.layoutId === 'designcut_T10')
    expect(acts).toHaveLength(2)
    for (const sec of acts) {
      expect(sec.elements.filter((e) => e.name.startsWith('designcut-scene-') && e.type === 'framed-image')).toHaveLength(2)
      expect(sec.elements.filter((e) => e.name.startsWith('designcut-scene-caption'))).toEqual([])
    }
    const types = new Set([...acts, ...doc.sections.filter((s) => s.layoutId === 'designcut_T3a')].map((s) => String(s.sectionType)))
    expect(checkMobileReadability(doc).violations.filter((v) => types.has(v.section) && v.rule === 'M2' && /사진 위/.test(v.detail))).toEqual([])
  })
})
