/**
 * PDP 파이프라인 순수 함수 단위 테스트 — 상태 전이(resolveStepToRun)·이미지 태스크 목록 구성
 * (buildImageTasks)·팔레트 치환(bindPalettePlaceholders). LLM·DB 호출은 없다(전부 순수 함수) —
 * run() 오케스트레이션 자체(callAgent·Supabase 모킹)는 이 파일 범위 밖(§9.2 Phase 1 선례처럼
 * 실 API E2E가 담당할 영역).
 */

import { describe, it, expect } from 'vitest'
import { resolveStepToRun } from './pdp-pipeline'
import {
  buildImageTasks,
  bindPalettePlaceholders,
  allImageTasksFailed,
  isSectionSettled,
  isTextBearingJob,
  toGeneratedImagesMap,
} from './pdp-image-tasks'
import {
  applyTextPolicy,
  isTextBearingProduct,
  NO_TEXT_INSTRUCTION,
  PRINTED_DESIGN_PRESERVE_INSTRUCTION,
} from '@/lib/agents/registration/prompts/pdp-image-prompts'
import {
  decodeStepFailure,
  encodeStepFailure,
  isValidSourceImageCount,
  stripStepFailurePrefix,
  PDP_MAX_SOURCE_IMAGES,
  type AnalysisResult,
  type CopywritingResult,
  type DesignPrompts,
  type PdpJobRow,
  type PdpMode,
  type PdpSpecSheet,
  type ResearchResult,
  type SectionImage,
  type SectionPlan,
} from './pdp-state'

function baseJob(overrides: Partial<PdpJobRow> = {}): PdpJobRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    business_id: null,
    draft_id: null,
    spec_sheet: { productName: '테스트 상품' },
    source_images: ['https://src.test/a.png'],
    image_model: 'gpt-image-2',
    image_quality: 'medium',
    mode: 'premium',
    generation_track: 'standard',
    analysis: {},
    research_result: {},
    design_prompts: {},
    section_plan: {},
    copy_sections: {},
    section_images: [],
    final_html: null,
    current_step: 'pending',
    progress: 0,
    error: null,
    cost_usd: 0,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    ...overrides,
  }
}

const FILLED_ANALYSIS: AnalysisResult = { keywords: ['a'], detected_category: 'household' }
const FILLED_RESEARCH: ResearchResult = { pain_points: [{ insight: '불편함', support_count: 1, evidence: '' }] }
const FILLED_SECTION_PLAN: SectionPlan = { activated_sections: ['main_intro', 'cta'], section_order: ['main_intro', 'cta'] }
const FILLED_COPY: CopywritingResult = { mainIntro: { title: '제목' } }

describe('resolveStepToRun — 전이 순서', () => {
  it('빈 잡은 analysis부터 시작한다', () => {
    expect(resolveStepToRun(baseJob())).toBe('analysis')
  })

  it('analysis만 채워지면 research로 전진한다', () => {
    expect(resolveStepToRun(baseJob({ analysis: FILLED_ANALYSIS }))).toBe('research')
  })

  it('research까지 채워지면 design으로 전진한다', () => {
    expect(resolveStepToRun(baseJob({ analysis: FILLED_ANALYSIS, research_result: FILLED_RESEARCH }))).toBe('design')
  })

  it('section_plan.activated_sections까지 채워지면 copywriting으로 전진한다', () => {
    expect(
      resolveStepToRun(
        baseJob({ analysis: FILLED_ANALYSIS, research_result: FILLED_RESEARCH, section_plan: FILLED_SECTION_PLAN })
      )
    ).toBe('copywriting')
  })

  it('copy_sections.final까지 채워지면 images로 전진한다(태스크가 남아있는 한)', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
    })
    expect(resolveStepToRun(job)).toBe('images')
  })

  it('전 태스크의 section_images가 채워지면 compose로 전진한다', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
    })
    const tasks = buildImageTasks(job)
    const sectionImages: SectionImage[] = tasks.map((t) => ({ section: t.section, url: `https://cdn.test/${t.section}.png` }))
    expect(resolveStepToRun({ ...job, section_images: sectionImages })).toBe('compose')
  })

  it('final_html까지 채워지면 done', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
      final_html: '<html></html>',
    })
    const tasks = buildImageTasks(job)
    const sectionImages: SectionImage[] = tasks.map((t) => ({ section: t.section, url: `https://cdn.test/${t.section}.png` }))
    expect(resolveStepToRun({ ...job, section_images: sectionImages })).toBe('done')
  })
})

describe('resolveStepToRun — failed 잡 재개', () => {
  it('current_step=failed여도 실제로 완료된 산출물 다음 단계부터 재개한다(design까지 완료 후 카피 단계에서 실패)', () => {
    const job = baseJob({
      current_step: 'failed',
      error: 'Stage 1 카피 생성 실패: timeout',
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      // copy_sections.final 없음 — 카피 단계에서 멈췄다는 뜻
    })
    expect(resolveStepToRun(job)).toBe('copywriting')
  })

  it('분석 단계 자체가 실패한 잡은 analysis부터 재개한다', () => {
    const job = baseJob({ current_step: 'failed', error: '분석 실패', analysis: {} })
    expect(resolveStepToRun(job)).toBe('analysis')
  })
})

describe('resolveStepToRun — pendingRegen 이월 큐', () => {
  it('모든 태스크가 (url||error)를 가져도 pendingRegen 항목이 남아있으면 images로 되돌아간다', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
    })
    const tasks = buildImageTasks(job)
    const sectionImages: SectionImage[] = tasks.map((t, i) => ({
      section: t.section,
      url: `https://cdn.test/${t.section}.png`,
      // 첫 번째 태스크만 게이트 미달로 재생성 대기 상태로 이월됐다고 가정
      pendingRegen: i === 0,
    }))
    expect(resolveStepToRun({ ...job, section_images: sectionImages })).toBe('images')
  })

  it('시간이 모자라 판정하지 못한 게이트 대기(gatePending)가 남아도 images로 — 판정 전 컷으로 합성하지 않는다', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
    })
    const done: SectionImage[] = buildImageTasks(job).map((t) => ({ section: t.section, url: `https://cdn.test/${t.section}.png` }))
    expect(resolveStepToRun({ ...job, section_images: done })).toBe('compose')
    const waiting = done.map((e, i) => (i === done.length - 1 ? { ...e, gatePending: true } : e))
    expect(resolveStepToRun({ ...job, section_images: waiting })).toBe('images')
    // 지금 태스크에 없는 섹션의 예전 대기는 images를 부르지 않는다
    const stale = [...done, { section: 'plate:old', url: 'https://cdn.test/old.png', gatePending: true }]
    expect(resolveStepToRun({ ...job, section_images: stale })).toBe('compose')
  })
})

describe('단계별 연속 실패 카운트 (encodeStepFailure/decodeStepFailure)', () => {
  it('직전 error가 없으면 카운트 1로 시작한다', () => {
    const { error, count } = encodeStepFailure('copywriting', null, '타임아웃')
    expect(count).toBe(1)
    expect(error).toBe('[retry:copywriting:1] 타임아웃')
  })

  it('같은 단계에서 재실패하면 카운트가 누적된다', () => {
    const first = encodeStepFailure('copywriting', null, '타임아웃')
    const second = encodeStepFailure('copywriting', first.error, '타임아웃 2')
    expect(second.count).toBe(2)
    expect(decodeStepFailure(second.error)).toEqual({ step: 'copywriting', count: 2 })
  })

  it('다른 단계에서 실패하면 카운트가 1로 리셋된다', () => {
    const prior = encodeStepFailure('copywriting', null, '타임아웃')
    const other = encodeStepFailure('images', prior.error, '이미지 생성 실패')
    expect(other.count).toBe(1)
  })

  it('성공 이후(접두사 없는 error)에서 재실패하면 다시 1부터 센다', () => {
    const plainWarning = '경미한 경고 문구'
    const { count } = encodeStepFailure('research', plainWarning, '연구 실패')
    expect(count).toBe(1)
  })

  it('stripStepFailurePrefix는 재시도 접두사만 제거하고 원 메시지를 보존한다', () => {
    const { error } = encodeStepFailure('design', null, '섹션 설계 실패: quota')
    expect(stripStepFailurePrefix(error)).toBe('섹션 설계 실패: quota')
  })

  it('null error는 그대로 null을 반환한다', () => {
    expect(stripStepFailurePrefix(null)).toBeNull()
    expect(decodeStepFailure(null)).toBeNull()
  })
})

describe('isValidSourceImageCount — 참조 이미지 장수 SSOT', () => {
  it('0장은 무효(최소 1장)', () => {
    expect(isValidSourceImageCount(0)).toBe(false)
  })

  it('1~PDP_MAX_SOURCE_IMAGES장은 유효', () => {
    expect(isValidSourceImageCount(1)).toBe(true)
    expect(isValidSourceImageCount(PDP_MAX_SOURCE_IMAGES)).toBe(true)
  })

  it('상한 초과는 무효', () => {
    expect(isValidSourceImageCount(PDP_MAX_SOURCE_IMAGES + 1)).toBe(false)
  })
})

describe('allImageTasksFailed — 이미지 전량 실패 판정', () => {
  it('태스크가 없으면 실패 판정하지 않는다', () => {
    expect(allImageTasksFailed([], [])).toBe(false)
  })

  it('일부만 시도됐으면(아직 진행 중) 실패 판정하지 않는다', () => {
    const tasks = [
      { section: 'hero', prompt: 'p', aspectRatio: '3:4', effectOnly: false, skipGate: false },
      { section: 'problem', prompt: 'p', aspectRatio: '3:4', effectOnly: true, skipGate: false },
    ]
    const sectionImages: SectionImage[] = [{ section: 'hero', url: 'https://cdn.test/hero.png' }]
    expect(allImageTasksFailed(tasks, sectionImages)).toBe(false)
  })

  it('전 태스크가 시도됐고 전부 error뿐이면 true', () => {
    const tasks = [
      { section: 'hero', prompt: 'p', aspectRatio: '3:4', effectOnly: false, skipGate: false },
      { section: 'problem', prompt: 'p', aspectRatio: '3:4', effectOnly: true, skipGate: false },
    ]
    const sectionImages: SectionImage[] = [
      { section: 'hero', url: '', error: '생성 실패' },
      { section: 'problem', url: '', error: '생성 실패' },
    ]
    expect(allImageTasksFailed(tasks, sectionImages)).toBe(true)
  })

  it('전 태스크가 시도됐지만 하나라도 성공(url)이면 false', () => {
    const tasks = [
      { section: 'hero', prompt: 'p', aspectRatio: '3:4', effectOnly: false, skipGate: false },
      { section: 'problem', prompt: 'p', aspectRatio: '3:4', effectOnly: true, skipGate: false },
    ]
    const sectionImages: SectionImage[] = [
      { section: 'hero', url: 'https://cdn.test/hero.png' },
      { section: 'problem', url: '', error: '생성 실패' },
    ]
    expect(allImageTasksFailed(tasks, sectionImages)).toBe(false)
  })

  it('첫 실패(retryPending)가 남아 있으면 아직 실패 판정하지 않는다 — 재시도 1회가 먼저다', () => {
    const tasks = [
      { section: 'hero', prompt: 'p', aspectRatio: '3:4', effectOnly: false, skipGate: false },
      { section: 'problem', prompt: 'p', aspectRatio: '3:4', effectOnly: true, skipGate: false },
    ]
    const sectionImages: SectionImage[] = [
      { section: 'hero', url: '', error: '생성 실패', retryPending: true },
      { section: 'problem', url: '', error: '생성 실패' },
    ]
    expect(allImageTasksFailed(tasks, sectionImages)).toBe(false)
  })
})

describe('toGeneratedImagesMap — 번호 컷은 번호 자리에(실패한 번호를 당겨 붙이지 않는다)', () => {
  const ok = (section: string): SectionImage => ({ section, url: `https://cdn.test/${section.replace(':', '-')}.png` })
  const failed = (section: string): SectionImage => ({ section, url: '', error: `${section} 생성 실패` })

  it('features:4 실패·features:5 성공 — features[4]는 빈 칸, features[5]가 5번 컷(전에는 5번 컷이 4번 자리로 당겨졌다)', () => {
    const map = toGeneratedImagesMap([
      ...[0, 1, 2, 3].map((i) => ok(`features:${i}`)),
      failed('features:4'),
      ok('features:5'),
    ])
    expect(map.features).toHaveLength(6)
    expect(map.features?.[4]).toBe('')
    expect(map.features?.[5]).toBe('https://cdn.test/features-5.png')
    expect(map.features?.[3]).toBe('https://cdn.test/features-3.png')
  })

  it('사용법·아이콘 목록도 같다 — 항목이 없는 번호도 빈 칸, 순서가 섞여 들어와도 번호대로', () => {
    const map = toGeneratedImagesMap([ok('howto:2'), failed('howto:0'), ok('usp_icons:3'), ok('usp_icons:0')])
    expect(map.howToImages).toEqual(['', '', 'https://cdn.test/howto-2.png'])
    expect(map.usp_icons).toEqual(['https://cdn.test/usp_icons-0.png', '', '', 'https://cdn.test/usp_icons-3.png'])
  })

  it('마지막 성공 번호 뒤 실패는 싣지 않는다(끝 실패 잡의 목록 길이는 그대로)·성공이 없으면 키 없음·평평한 키는 그대로', () => {
    const map = toGeneratedImagesMap([ok('features:0'), ok('features:1'), failed('features:2'), failed('howto:0'), ok('hero')])
    expect(map.features).toEqual(['https://cdn.test/features-0.png', 'https://cdn.test/features-1.png'])
    expect(map.howToImages).toBeUndefined()
    expect(map.hero).toBe('https://cdn.test/hero.png')
    // JSON 왕복(편집기 응답)에도 빈 칸이 null이 아니라 ''로 남는다
    expect(JSON.parse(JSON.stringify(toGeneratedImagesMap([failed('features:0'), ok('features:1')]))).features).toEqual([
      '',
      'https://cdn.test/features-1.png',
    ])
  })
})

describe('isSectionSettled — 섹션 생성 종료 판정(실패 재시도 1회)', () => {
  it.each<[string, SectionImage | undefined, boolean]>([
    ['항목 없음', undefined, false],
    ['url 있음', { section: 'hero', url: 'https://cdn.test/hero.png' }, true],
    ['url + 게이트 미달 error', { section: 'hero', url: 'https://cdn.test/hero.png', error: '게이트 미달' }, true],
    ['첫 실패(retryPending)', { section: 'hero', url: '', error: '5xx', retryPending: true }, false],
    ['재시도까지 실패(표지 없음)', { section: 'hero', url: '', error: '5xx' }, true],
    ['표지 이전 잡의 실패(retried:false)', { section: 'hero', url: '', error: '5xx', retried: false }, true],
  ])('%s → %s', (_label, entry, settled) => {
    expect(isSectionSettled(entry)).toBe(settled)
  })

  it('첫 실패 컷이 남은 잡은 compose가 아니라 images로 되돌아가고, 표지 없는 실패는 그대로 compose', () => {
    const job = baseJob({
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: FILLED_COPY },
    })
    const tasks = buildImageTasks(job)
    const filled: SectionImage[] = tasks.map((t) => ({ section: t.section, url: `https://cdn.test/${t.section}.png` }))
    const pending = [{ section: tasks[1].section, url: '', error: '5xx', retryPending: true }, ...filled.filter((_, i) => i !== 1)]
    const final = [{ section: tasks[1].section, url: '', error: '5xx' }, ...filled.filter((_, i) => i !== 1)]
    expect(resolveStepToRun({ ...job, section_images: pending })).toBe('images')
    expect(resolveStepToRun({ ...job, section_images: final })).toBe('compose')
  })
})

describe('텍스트 보유 상품(NEXFIT b90f6c0 A-3) — 판정·이미지 프롬프트 분기', () => {
  it.each<[string | null, string, boolean]>([
    ['stationery', '아무 상품', true],
    ['STATIONERY ', '', true],
    ['household', '핸드메이드 감사 스티커 50매', true],
    ['household', '방수 라벨 프린터 용지', true],
    ['household', '크리스마스 엽서 세트', true],
    ['household', '생일 축하 카드 10매', true],
    ['household', '가죽 카드지갑', false],
    ['household', 'SD카드 128GB', false],
    ['household', '그래픽카드 브래킷', false],
    ['household', '생일 파티 꽃가루 폭죽 세트', false],
    ['packaging', '데이지 구디백 답례품 파우치', false],
    // AX-CT-33 — 인쇄가 본질이 아닌 포장 봉투·카드 보호 비닐은 인쇄물이 아니다(움직이는 칸이 0 이 되던 오탐)
    ['household', '페어넥스 구디백 포장봉투 선물 파우치 반투명', false],
    ['household', '구디백 포장 봉투 데이지', false],
    ['household', '투명 OPP봉투 100매', false],
    ['household', '지퍼봉투 대용량', false],
    ['household', '투명 카드슬리브 100매', false],
    // 카드 제외 낱말은 붙여 쓴 꼴만 — 띄어 쓴 진짜 인쇄 카드는 인쇄물로 남는다(#1437 검수 사례)
    ['household', '크리스마스카드 케이스 포함 10매', true],
    ['household', '감사카드 케이스 세트', true],
    ['household', '메시지카드 수납 박스 세트', true],
    ['household', '용돈카드 지갑형', true],
    ['household', '청첩장 카드 슬롯', true],
    // 진짜 인쇄물의 판정은 그대로다
    ['household', '전통 편지봉투 세트', true],
    ['household', '용돈 봉투 10매', true],
    ['household', '축하 돈봉투', true],
    ['household', '편지봉투 + 비닐봉투 묶음', true],
    ['household', '생일카드 + 카드지갑', true],
    ['household', '선물 포장지 롤', true],
    ['household', '캐릭터 스티커 포장봉투', true],
    [null, '', false],
  ])('카테고리 %s · "%s" → %s', (category, name, expected) => {
    expect(isTextBearingProduct(category, name)).toBe(expected)
  })

  function stickerJob(overrides: Partial<PdpJobRow> = {}): PdpJobRow {
    return baseJob({
      mode: 'pro',
      spec_sheet: { productName: '감사 스티커 50매' },
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      // 디자인 콜② 산출 — 텍스트 금지 문장은 디자인 단계 코드 강제(applyTextBearingPolicy)가 이미 걷어낸 상태
      design_prompts: {
        section_image_prompts: {
          hero: { positive: 'Sticker sheet hero on a linen surface.' },
          problem: { positive: 'A frustrated person wrapping a plain gift box.' },
        },
      },
      copy_sections: {
        final: {
          mainIntro: { title: '제목' },
          detailPoints: [{ claim: '선명한 인쇄' }],
          howTo: [{ step: '붙이기', description: '포장에 붙인다' }],
        },
      },
      ...overrides,
    })
  }

  it('잡 판정은 분석 카테고리와 상품명(스펙 이름 + 카피 제목)을 함께 본다', () => {
    expect(isTextBearingJob(stickerJob())).toBe(true)
    expect(isTextBearingJob(stickerJob({ spec_sheet: { productName: '머그컵' } }))).toBe(false)
    expect(
      isTextBearingJob(
        stickerJob({ spec_sheet: { productName: '선물 포장 세트' }, copy_sections: { final: { mainIntro: { title: '감사 엽서' } } } }),
      ),
    ).toBe(true)
    expect(isTextBearingJob(stickerJob({ spec_sheet: { productName: '선물' }, analysis: { detected_category: 'stationery' } }))).toBe(true)
  })

  it('텍스트 보유 상품은 제품 등장 컷의 NO_TEXT가 인쇄 보존 규칙으로 바뀐다 — 설계 프롬프트 problem 컷은 그대로 NO_TEXT', () => {
    const tasks = buildImageTasks(stickerJob())
    const byKey = (s: string) => tasks.find((t) => t.section === s)!.prompt
    for (const section of ['hero', 'solution', 'features:0', 'howto:0', 'premium_hero']) {
      expect(byKey(section), section).toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
      expect(byKey(section), section).not.toContain(NO_TEXT_INSTRUCTION)
      expect(byKey(section), section).not.toContain('No text, letters, or typography anywhere in the image.')
    }
    // NEXFIT image_generation_agent.py:1532-1537 — problem(제품 미등장) 설계 프롬프트는 NO_TEXT 유지
    expect(byKey('problem')).toContain(NO_TEXT_INSTRUCTION)
    expect(byKey('problem')).not.toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
  })

  it('일반 상품은 기존 NO_TEXT 그대로다', () => {
    const tasks = buildImageTasks(stickerJob({ spec_sheet: { productName: '머그컵' } }))
    for (const t of tasks.filter((x) => ['hero', 'solution', 'features:0', 'howto:0'].includes(x.section))) {
      expect(t.prompt, t.section).toContain(NO_TEXT_INSTRUCTION)
      expect(t.prompt, t.section).not.toContain(PRINTED_DESIGN_PRESERVE_INSTRUCTION)
    }
  })

  it('applyTextPolicy — 일반 상품은 그대로, 텍스트 상품은 금지 문장을 지우고 보존 규칙을 한 번만 붙인다', () => {
    const src = `Scene. ${NO_TEXT_INSTRUCTION} End. No text, letters, or typography anywhere in the image.`
    expect(applyTextPolicy(src, false)).toBe(src)
    const once = applyTextPolicy(src, true)
    expect(once).not.toContain(NO_TEXT_INSTRUCTION)
    expect(once.split(PRINTED_DESIGN_PRESERVE_INSTRUCTION)).toHaveLength(2)
    expect(applyTextPolicy(once, true)).toBe(once)
  })
})

describe('buildImageTasks — 모드별 구성', () => {
  function readyJob(mode: PdpMode, specOverrides: Partial<PdpSpecSheet> = {}, copyOverrides: Partial<CopywritingResult> = {}): PdpJobRow {
    return baseJob({
      mode,
      spec_sheet: { productName: '테스트 상품', ...specOverrides },
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: { mainIntro: { title: '제목' }, ...copyOverrides } },
    })
  }

  it('copy_sections.final이 없으면 빈 배열(카피 단계 미완료 방어)', () => {
    expect(buildImageTasks(baseJob())).toEqual([])
  })

  it('base 5종(hero 우선)은 premium/pro 공통으로 항상 포함된다', () => {
    const tasks = buildImageTasks(readyJob('premium'))
    const sections = tasks.map((t) => t.section)
    expect(sections.slice(0, 5)).toEqual(['hero', 'problem', 'solution', 'usage', 'cta'])
  })

  it('premium 모드는 pro 전용 10종을 포함하지 않는다', () => {
    const tasks = buildImageTasks(readyJob('premium'))
    expect(tasks.some((t) => t.section === 'premium_hero')).toBe(false)
    expect(tasks.some((t) => t.section === 'concept_mood')).toBe(false)
  })

  it('pro 모드는 pro 전용 10종(conversion_cta 제외)을 포함한다', () => {
    const tasks = buildImageTasks(readyJob('pro'))
    expect(tasks.some((t) => t.section === 'premium_hero')).toBe(true)
    expect(tasks.some((t) => t.section === 'concept_mood')).toBe(true)
    expect(tasks.some((t) => t.section === 'conversion_cta')).toBe(false)
  })

  it('problem은 EFFECT_ONLY라 참조·게이트 대상이 아니다', () => {
    const tasks = buildImageTasks(readyJob('premium'))
    const problem = tasks.find((t) => t.section === 'problem')
    expect(problem?.effectOnly).toBe(true)
  })
})

describe('buildImageTasks — 조건부 게이트', () => {
  function readyJob(specOverrides: Partial<PdpSpecSheet>): PdpJobRow {
    return baseJob({
      mode: 'pro',
      spec_sheet: { productName: '테스트 상품', ...specOverrides },
      analysis: FILLED_ANALYSIS,
      research_result: FILLED_RESEARCH,
      section_plan: FILLED_SECTION_PLAN,
      copy_sections: { final: { mainIntro: { title: '제목' } } },
    })
  }

  it('size 미지정이면 size_comparison 태스크가 없다', () => {
    const tasks = buildImageTasks(readyJob({}))
    expect(tasks.some((t) => t.section === 'size_comparison')).toBe(false)
  })

  it('size 지정 시 size_comparison 태스크가 생긴다', () => {
    const tasks = buildImageTasks(readyJob({ size: '가로20cm 세로10cm' }))
    expect(tasks.some((t) => t.section === 'size_comparison')).toBe(true)
  })

  it('soldOutCount=0이면 sold_out_banner가 없고, >0이면 생긴다', () => {
    expect(buildImageTasks(readyJob({ soldOutCount: 0 })).some((t) => t.section === 'sold_out_banner')).toBe(false)
    expect(buildImageTasks(readyJob({ soldOutCount: 3 })).some((t) => t.section === 'sold_out_banner')).toBe(true)
  })

  it('certificationInfo 없으면 certification_badge를 스킵한다(원본 API 비용 절감 규칙)', () => {
    const tasks = buildImageTasks(readyJob({}))
    expect(tasks.some((t) => t.section === 'certification_badge')).toBe(false)
  })

  it('certificationInfo가 있으면 certification_badge를 포함한다', () => {
    const tasks = buildImageTasks(readyJob({ certificationInfo: 'KC 인증' }))
    expect(tasks.some((t) => t.section === 'certification_badge')).toBe(true)
  })

  it('eventBannerInfo 없으면 event_banner를 스킵한다', () => {
    const tasks = buildImageTasks(readyJob({}))
    expect(tasks.some((t) => t.section === 'event_banner')).toBe(false)
  })
})

describe('bindPalettePlaceholders — 팔레트 치환', () => {
  it('토큰이 없으면 원문을 그대로 반환한다', () => {
    expect(bindPalettePlaceholders('plain text', { primary: '#111111' })).toBe('plain text')
  })

  it('{palette.primary}를 실제 팔레트 값으로 치환한다', () => {
    const out = bindPalettePlaceholders('bg: {palette.primary}', { primary: '#ff0000' })
    expect(out).toBe('bg: #ff0000')
  })

  it('팔레트가 없으면 원본 기본값(#4f46e5 등)으로 치환한다', () => {
    const out = bindPalettePlaceholders('bg: {palette.primary}', undefined)
    expect(out).toBe('bg: #4f46e5')
  })

  it('여러 토큰을 한 번에 치환한다', () => {
    const out = bindPalettePlaceholders(
      '{palette.primary} / {palette.bgMain} / {palette.textMain}',
      { primary: '#111', bgMain: '#222', textMain: '#333' }
    )
    expect(out).toBe('#111 / #222 / #333')
  })

  it('레거시 기본색(#4f46e5)이 토큰 없이 박혀 있어도 실제 팔레트로 안전망 치환한다', () => {
    const out = bindPalettePlaceholders('accent color #4f46e5 used here', { primary: '#00ff00' })
    expect(out).toBe('accent color #00ff00 used here')
  })
})

describe('DesignPrompts — style_charter/identity_card 확장 필드', () => {
  it('타입에 캐시 필드가 추가돼 있다(런타임 검증 없이 타입 단언만)', () => {
    const dp: DesignPrompts = { style_charter: 'GLOBAL STYLE CHARTER', identity_card: 'PRODUCT IDENTITY' }
    expect(dp.style_charter).toContain('GLOBAL')
    expect(dp.identity_card).toContain('PRODUCT')
  })
})
