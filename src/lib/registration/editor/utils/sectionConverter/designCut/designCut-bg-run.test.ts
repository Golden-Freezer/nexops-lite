/**
 * 같은 바탕 연속 상한(적용 D3 P5 T1-21, 통합 11-03 12:40) — 렌더 v2 막 바탕(assignActBackgrounds)에서 같은 바탕이 4개를 넘으면 구간 안의
 * 바꿀 수 있는 흰 섹션 하나를 밝은 스튜디오(N)로 바꾼다. 장면 섹션·짙은 면·kept·고정 바탕은 그대로다.
 * 꼴은 R17-L 저장 잡에서 잰 것이다: 첫머리 6연속(T1 장면·T2·흰 kept·T3a 장면 3), 끝 5연속(T3a·T4·T3a·T8 장면·T6).
 */

import { describe, expect, it } from 'vitest'
import { assignActBackgrounds, SAME_BG_RUN_MAX, type BgRow } from './layout2'

const row = (key: string, role: string | null, template: BgRow['template'], keptFill?: string): BgRow => ({ key, role, template, keptFill })
const longestRun = (bgs: ReadonlyArray<string | null>, surface: (bg: string | null, i: number) => string) => {
  let best = 0
  let run = 0
  bgs.forEach((bg, i) => {
    run = i > 0 && surface(bg, i) === surface(bgs[i - 1], i - 1) ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

/** 첫머리 — 장면 T1 뒤 T2(W), 흰 kept 해결 요약, 장면 POINT 3, 짙은 전환 면 T11, 마무리 장면 T8 */
const HEAD: BgRow[] = [
  row('hook_3step', 'hook', 'T1'),
  row('problem_raise', 'problem', 'T2'),
  row('solution_guide', null, null, '#FFFFFF'),
  row('point_div:0', 'usp_feature', 'T3a'),
  row('point_div:1', 'usp_feature', 'T3a'),
  row('point_div:2', 'usp_feature', 'T3a'),
  row('detail:more', 'usp_feature', 'T11'),
  row('cta', 'cta', 'T8'),
]

/** 끝 — 스튜디오 T7 뒤 장면 메시지·추천 T4·장면 메시지·장면 마무리·사이즈 T6, 맨 끝 상품 정보 T9(스튜디오) */
const TAIL: BgRow[] = [
  row('hidden_page', 'how_to_guide', 'T5'),
  row('petit_div', 'option_catalog', 'T7'),
  row('product_exposure:body', 'fill_message', 'T3a'),
  row('point_list_div', 'target_recommendation', 'T4'),
  row('direction_suggest:body', 'fill_message', 'T3a'),
  row('cta', 'cta', 'T8'),
  row('spec_table', 'size_spec', 'T6'),
  row('long:info', null, 'T9'),
]

describe('같은 바탕 연속 상한(D3 P5)', () => {
  it('상한은 4 — K 바탕 예산 W_MAX_RUN과 같은 값', () => {
    expect(SAME_BG_RUN_MAX).toBe(4)
  })

  it('첫머리 6연속은 T2 하나만 스튜디오로 — 장면 섹션·흰 kept·짙은 전환 면 자리는 그대로', () => {
    const bgs = assignActBackgrounds(HEAD, false, true)
    expect(bgs).toEqual(['W', 'N', null, 'W', 'W', 'W', 'D', 'W'])
    expect(longestRun(bgs, (bg, i) => bg ?? (HEAD[i].keptFill === '#FFFFFF' ? 'W' : `${i}`))).toBe(SAME_BG_RUN_MAX)
  })

  it('끝 5연속은 가운데 쪽 T4를 바꾸고 구간 끝 T6은 두어 뒤 스튜디오 T9와 붙지 않는다', () => {
    expect(assignActBackgrounds(TAIL, false, true)).toEqual(['W', 'N', 'W', 'N', 'W', 'W', 'W', 'N'])
  })

  it('바꿀 수 있는 섹션이 없으면(장면 섹션만) 그대로 둔다', () => {
    const rows = ['point_div:0', 'point_div:1', 'point_div:2', 'key_message:body', 'key_message:main'].map((key) => row(key, 'usp_feature', 'T3a'))
    expect(assignActBackgrounds(rows, false, true)).toEqual(['W', 'W', 'W', 'W', 'W'])
  })

  it('흰 사진 바탕(P)은 흰 면으로 센다 — 상품 컷 배경이 흰색일 때만 끊는다', () => {
    const rows = [row('main_cut', 'hook', 'T3c'), row('hidden_page', 'how_to_guide', 'T5'), ...HEAD.slice(3, 6)]
    expect(assignActBackgrounds(rows, true, true)).toEqual(['P', 'N', 'W', 'W', 'W'])
    expect(assignActBackgrounds(rows, false, true)).toEqual(['P', 'W', 'W', 'W', 'W'])
  })

  it('흰 kept는 흰 면으로 세고, 흰색이 아닌 kept는 연속을 끊는다(다시 칠하지 않음)', () => {
    const studio = HEAD.map((r) => (r.key === 'solution_guide' ? { ...r, keptFill: '#F4F4F4' } : r))
    expect(assignActBackgrounds(studio, false, true)).toEqual(['W', 'W', null, 'W', 'W', 'W', 'D', 'W'])
  })

  it('짙은 면 자리·수는 상한 전후로 같다(마무리는 장면 모드에서 흰 띠, 장면 모드 밖은 D)', () => {
    const scene = assignActBackgrounds(HEAD, false, true)
    expect(scene.flatMap((bg, i) => (bg === 'D' ? [i] : []))).toEqual([6])
    const v2 = assignActBackgrounds(HEAD, false)
    expect(v2.flatMap((bg, i) => (bg === 'D' ? [i] : []))).toEqual([3, 7])
  })
})
