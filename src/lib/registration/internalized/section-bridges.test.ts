/**
 * 섹션 잇기(R4 pdp-r4-copy-bridge) — R1 실제 잡 3건(P02·P03·P07)의 섹션 순서와 저장 카피로 잇기 계획·측정·프롬프트 블록을 고정한다.
 * 순수 함수, 외부 호출 0.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CopywritingResult } from '../pdp-state'
import { measureSectionBridges, planSectionBridges } from './section-bridges'
import { repeatsShown } from '../editor/utils/sectionConverter/dedupe'
import {
  buildSectionBridgeBlock,
  buildSectionBridgeKeepBlock,
} from '@/lib/agents/registration/prompts/pdp-internalized-prompts'

const FIXTURES = resolve(__dirname, '../editor/utils/sectionConverter/__fixtures__')
function r1(name: string): { stages: Array<{ section: string }>; copy: CopywritingResult } {
  const fixture = JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf-8')) as {
    copy: CopywritingResult
    section_plan: { activated_sections: string[] }
  }
  return { stages: fixture.section_plan.activated_sections.map((section) => ({ section })), copy: fixture.copy }
}
const P02 = r1('r1-p02-d10ea762.json')
const P07 = r1('r1-p07-8e7006a3.json')

const summary = (stages: Array<{ section: string }>) =>
  planSectionBridges(stages).map((b) => `${b.from}>${b.to}:${b.anchor}:${b.receiveFields.join('+')}`)

describe('hookshort 잡 — hook이 첫 화면에 나오지 않는다', () => {
  const stages = [{ section: 'hook_3step' }, { section: 'problem_raise' }, { section: 'cta' }]

  it('켜면 첫 화면에서 보내는 칸이 보이는 제목이고, 끄면 지금 그대로 hook이다', () => {
    const fields = (opts?: { hookShort?: boolean }) => planSectionBridges(stages, opts).filter((b) => b.from === 'hook_3step').map((b) => b.sendField)
    expect(fields({ hookShort: true })).toEqual(['mainIntro.benefitHeadline', 'mainIntro.benefitHeadline'])
    expect(fields()).toEqual(['mainIntro.hook', 'mainIntro.hook'])
  })
})

describe('planSectionBridges — 받는 섹션은 정해진 종류의 앞 섹션에서 받는다', () => {
  it('P02(main_cut이 문제보다 앞) — 고민은 특징이 아니라 첫 화면 상황에서, 해결은 고민에서, CTA는 첫 화면에서. main_cut은 받지 않는다', () => {
    expect(summary(P02.stages)).toEqual([
      'hook_3step>problem_raise:situation:problem.question',
      'problem_raise>solution_guide:concern:solution.declaration+solution.summary',
      'solution_guide>point_div:function:detailPoints[0].claim',
      'sub_div>point_list_div:feature:recommendedTargets[0]',
      'hook_3step>cta:hook:closingCta.headline',
    ])
  })

  it('P07(문제·해결 없음) — CTA만. main_cut은 첫 화면 바로 뒤라 받지 않고, point_div는 특징 배정이 이미 잇는다', () => {
    expect(summary(P07.stages)).toEqual(['hook_3step>cta:hook:closingCta.headline'])
  })

  it('같은 필드는 한 번만(문제 섹션 둘), 받을 곳이 없으면 잇지 않는다(첫 화면 없는 잡)', () => {
    const two = summary([{ section: 'hook_3step' }, { section: 'problem_raise' }, { section: 'problem_empathy' }])
    expect(two).toEqual(['hook_3step>problem_raise:situation:problem.question'])
    expect(summary([{ section: 'main_cut' }, { section: 'cta' }])).toEqual([])
  })
})

describe('measureSectionBridges — 카피 기준 이음 측정', () => {
  it('P02 저장 카피: 다섯 쌍 모두 양쪽 글이 있고(배열 경로 포함), 고민은 첫 화면의 "선물"을 이었고 CTA는 잇지 않았다', () => {
    const report = measureSectionBridges(planSectionBridges(P02.stages), P02.copy)
    expect(report.pairs).toBe(5)
    expect(report.unlinked).not.toContain('problem_raise')
    expect(report.unlinked).toContain('cta')
    expect(report.linked + report.unlinked.length).toBe(report.pairs)
  })

  it('배열 경로(detailPoints[0]·howTo[0]·recommendedTargets[0])와 다른 꼴({title}·문자열 CTA)을 읽는다', () => {
    const stages = ['hook_3step', 'problem_raise', 'solution_guide', 'point_div', 'sub_div', 'hidden_page', 'cta'].map(
      (section) => ({ section })
    )
    const copy = {
      mainIntro: { hook: '아침 샤워 시간' },
      problem: { question: '샤워 때 두피가 답답한가요?' },
      solution: { declaration: '', summary: '실리콘 돌기로 두피를 감싸요' },
      pointCards: [{ title: '실리콘 돌기', description: '' }],
      detailPoints: [{ title: '실리콘 돌기가 넓어요' }],
      howTo: [{ step: '돌기를 적셔 문질러요', description: '' }],
      closingCta: '샤워 시간에 담아보세요',
    } as unknown as CopywritingResult
    expect(measureSectionBridges(planSectionBridges(stages), copy)).toEqual({ pairs: 5, linked: 5, unlinked: [] })
  })

  it('받는 쪽이 보내는 쪽 낱말을 쓰면 이어진 것 — 조사가 붙은 꼴도 같은 낱말(dedupe sameWord)', () => {
    const copy = {
      mainIntro: { hook: '선물 포장이 어려운 날' },
      problem: { question: '선물을 쌀 때마다 망설이나요?' },
      closingCta: { headline: '컬러를 고르고 담아보세요' },
    } as unknown as CopywritingResult
    const bridges = planSectionBridges([{ section: 'hook_3step' }, { section: 'problem_raise' }, { section: 'cta' }])
    expect(measureSectionBridges(bridges, copy)).toEqual({ pairs: 2, linked: 1, unlinked: ['cta'] })
  })
})

describe('받는 말 하나는 편집기 중복 정리에 걸리지 않는다(09 §2.3)', () => {
  it('앞 문장과 겹치는 낱말이 받는 말 하나면 되풀이가 아니고, 우연히 하나 더 겹치면 되풀이다', () => {
    expect(repeatsShown('손잡이가 미끄럽지 않은 실리콘 돌기', ['고무 손잡이 브러시'])).toBe(false)
    expect(repeatsShown('손잡이가 있는 두피 브러시', ['고무 손잡이 브러시'])).toBe(true)
  })
})

describe('섹션 잇기 프롬프트 블록', () => {
  it('Stage 1 블록은 받는 필드 ← 보내는 필드와 낱말 종류만 준다(문구 없음), 해결 → 가치 첫 제목은 카드 제목 낱말을 권한다', () => {
    const block = buildSectionBridgeBlock(planSectionBridges(P02.stages))
    expect(block).toContain('## [섹션 잇기 — 받는 말, 문구 아님]')
    expect(block).toContain('결과·효과·감각 낱말은 이어받지 않는다')
    expect(block).toContain('- problem.question ← mainIntro.hook의 상황 낱말(누가·언제·어디서) 하나')
    expect(block).toContain('- solution.declaration·solution.summary ← problem.question의 고민 낱말 하나')
    expect(block).toContain(
      '- detailPoints[0].claim ← solution.summary의 기능 낱말 하나 — pointCards 1번 제목 낱말을 쓰면 특징 배정과 함께 지킨다'
    )
    expect(block).toContain('- closingCta.headline ← mainIntro.hook의 핵심 낱말 하나를 한 번 다시 쓴다')
  })

  it('Stage 2·3 보존 블록은 이어받은 낱말을 지우지 말라고 한다. 잇기가 없으면 두 블록 모두 빈 문자열', () => {
    const keep = buildSectionBridgeKeepBlock(planSectionBridges(P07.stages))
    expect(keep).toContain('## [섹션 잇기 보존]')
    expect(keep).toContain('이어받은 낱말을 지우거나 다른 말로 바꾸지 마라')
    expect(buildSectionBridgeBlock([])).toBe('')
    expect(buildSectionBridgeKeepBlock([])).toBe('')
  })
})
