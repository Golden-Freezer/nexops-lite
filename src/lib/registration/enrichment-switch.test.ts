import { describe, expect, it } from 'vitest'
import {
  ENRICHMENT_DEFAULTS,
  ENRICHMENT_FEATURES,
  K4_SWITCHED_ON,
  analysisForPrompt,
  buildEnrichmentRecord,
  hasEnrichmentFeature,
  readJobEnrichment,
  isHostedPdpEnv,
  isVercelEnv,
  resolveEnabledFeatures,
  type EnrichmentFeature,
} from './enrichment-switch'

const T6B_DEFAULTS = ['vocab', 'persuasion', 'layouts', 'shots', 'annotations', 'mobile', 'options']
/** 지금 기본값 — K4 운영 전환(오너 2026-11-06 09:39 '전환 PR 준비 승인'): K4 회차 11잡의 기록 묶음 22개(원장 runs.jsonl round K4)에
 * K6 뒤 사진 다양화·정보 칸을 더하고 라이트에서 움직이는 칸은 뺀 묶음에
 * J34 켜기(오너 위임 I6-2, 통합 decide 15·17) 쓰는 법 재료·사용 판정 끝 처리를 더한 27개에 J65 켜기(통합 decide 41·42) 체감 결과 한 장면을
 * 더한 28개에 J69 켜기(통합 decide 44) 보여 줄 동작·설계를 더한 29개, 기능 목록 순서 */
const K4: EnrichmentFeature[] = [
  ...(T6B_DEFAULTS as EnrichmentFeature[]),
  'designcut',
  'audience',
  'designcut2',
  'designlayout',
  'flow',
  'rhythm',
  'designlong',
  'shotdiv',
  'palette2',
  'fontpair',
  'reviewfaq',
  'partsrule',
  'idcardall',
  'templatelib',
  'uspfacts',
  'shotvary',
  'infocells',
  'usefacts',
  'usegate',
  'effectshot',
  'showbeat',
]
/** K4 전 기본값(R 라인) — T6b 전 기능 + split(W4-S) + lean(W5) + audience(R7) + long. 로컬 R 대조군이 이 값을 낸다 */
const R_DEFAULTS = [...T6B_DEFAULTS, 'split', 'lean', 'audience', 'long']
const R_SKIP = K4_SWITCHED_ON.join(',')
/** 로컬 R 대조군 — K4에서 켠 이름을 모두 뺀다(Vercel은 SKIP을 무시한다) */
const R = { NEXOPS_PDP_ENRICHMENT_SKIP: R_SKIP }

describe('ENRICHMENT 스위치', () => {
  it('기본값은 라이트 운영 묶음(motionband 제외) — 운영 표지도 같고 시험 전 기능은 꺼져 있다', () => {
    expect(resolveEnabledFeatures({})).toEqual(K4)
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ VERCEL_ENV: 'production' })).toEqual(K4)
    for (const f of K4) expect(ENRICHMENT_DEFAULTS[f], f).toBe(true)
    const off = ['composite', 'fullimage', 'references', 'brief', 'light', 'scene', 'shotplan', 'herotype', 'sizecut', 'fillacts', 'problemcut', 'hookshort', 'rulepriority', 'regenslot'] as const
    for (const f of off) expect(ENRICHMENT_DEFAULTS[f], f).toBe(false)
    // split·lean·long은 켜져 있지만 디자인 컷 잡에서는 기록하지 않는다
    for (const f of ['split', 'lean', 'long'] as const) expect(ENRICHMENT_DEFAULTS[f], f).toBe(true)
  })

  it('K4에서 켠 목록(K4_SWITCHED_ON)은 기본값 표와 맞고, 로컬 SKIP으로 모두 빼면 K4 전 기본값(R 라인)과 같다 — designcut 하나만 빼면 같지 않다', () => {
    for (const f of K4_SWITCHED_ON) expect(ENRICHMENT_DEFAULTS[f], f).toBe(true)
    expect(ENRICHMENT_FEATURES.filter((f) => ENRICHMENT_DEFAULTS[f] && !K4_SWITCHED_ON.includes(f))).toEqual([...T6B_DEFAULTS, 'split', 'lean', 'audience', 'long'])
    expect(resolveEnabledFeatures(R)).toEqual(R_DEFAULTS)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toEqual(R_DEFAULTS)
    expect(resolveEnabledFeatures({ ...R, VERCEL: '1' })).toEqual(K4)
  })

  it('로컬에서 NEXOPS_PDP_ENRICHMENT=off면 전부 끈다(대조군)', () => {
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: ' OFF ' })).toEqual([])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'on' })).toEqual(K4)
  })

  it('Vercel 환경 표지에서는 off·EXTRA·SKIP을 무시한다 — 운영 기능은 기본값 표뿐이다', () => {
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off', VERCEL_ENV: 'production' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motionband,fullimage', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut,templatelib', VERCEL: '1' })).toEqual(K4)
  })

  it('designcut(D1)은 기본 on(K4) — 디자인 컷 잡에는 split·lean·long·fullimage가 없고 audience는 남는다, 모르는 이름은 무시', () => {
    expect(ENRICHMENT_DEFAULTS.designcut).toBe(true)
    const on = resolveEnabledFeatures({})
    expect(on).toEqual(expect.arrayContaining(['designcut', 'audience']))
    for (const f of ['split', 'lean', 'long', 'fullimage']) expect(on, f).not.toContain(f)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: ' DesignCut , unknown' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'designcut', NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
  })

  it('split(W4-S 섹션 나누기)은 기본 on이지만 디자인 컷 잡(K4 기본·운영)에는 기록하지 않는다 — R 대조군에서는 켜진다', () => {
    expect(ENRICHMENT_DEFAULTS.split).toBe(true)
    expect(resolveEnabledFeatures({})).not.toContain('split')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).not.toContain('split')
    expect(resolveEnabledFeatures(R)).toContain('split')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('split')
    // 예전 로컬 EXTRA=split(R5-S 갈래)은 R 기본값과 같다(기록 그대로)
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'split' })).toEqual(R_DEFAULTS)
    expect(buildEnrichmentRecord(resolveEnabledFeatures(R))?.features.slice(-4)).toEqual(['split', 'lean', 'audience', 'long'])
  })

  it('split은 디자인 컷과 함께 켜지지 않는다(디자인 컷 잡은 편집기가 펼치지 않는다)', () => {
    const both = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'designcut,split' })
    expect(both).toContain('designcut')
    expect(both).not.toContain('split')
  })

  it('audience(학부모 대리 구매형)는 기본 on(R7 판정 뒤) — 운영(Vercel)에서도 켜지고, 대조군 off면 꺼지고, 디자인 컷 잡에도 남는다', () => {
    expect(ENRICHMENT_DEFAULTS.audience).toBe(true)
    expect(resolveEnabledFeatures({})).toContain('audience')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('audience')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('audience')
    expect(resolveEnabledFeatures(R)).toContain('audience')
    // 예전 로컬 EXTRA=audience(R7 P 갈래)는 R 기본값과 같다(기록 그대로)
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'audience' })).toEqual(R_DEFAULTS)
  })

  it('fullimage(통이미지)는 기본 off — R 대조군에서 로컬 EXTRA로만 더하고, Vercel은 무시, 디자인 컷 잡(K4 기본)에는 기록하지 않는다', () => {
    expect(ENRICHMENT_DEFAULTS.fullimage).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('fullimage')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'fullimage' })).toEqual([...R_DEFAULTS, 'fullimage'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'fullimage', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'fullimage' })).not.toContain('fullimage')
  })

  it('shotplan(R3 촬영 계획)은 기본 off — 로컬 EXTRA로만 더하고 Vercel·대조군 off에서는 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.shotplan).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('shotplan')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'light,scene,shotplan' })).toEqual([...R_DEFAULTS, 'light', 'scene', 'shotplan'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'shotplan', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'shotplan', NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
  })

  it('scene(R2 세트·장면 컷)은 기본 off — 로컬 EXTRA로만 더하고 Vercel·대조군 off에서는 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.scene).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('scene')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'light,scene' })).toEqual([...R_DEFAULTS, 'light', 'scene'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'scene', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'scene', NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
  })

  it('light(R1 빛·색온도 정본)는 기본 off — 로컬 EXTRA로만 더하고 Vercel·대조군 off에서는 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.light).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('light')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'light' })).toEqual([...R_DEFAULTS, 'light'])
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'brief,light' })).toEqual([...R_DEFAULTS, 'brief', 'light'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'light', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'light', NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
  })

  it('brief(이미지 브리프 정리)는 기본 off — 로컬 EXTRA로만 더하고 Vercel·대조군 off에서는 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.brief).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('brief')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'brief' })).toEqual([...R_DEFAULTS, 'brief'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'brief', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'brief', NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual([])
  })

  it('flow(카피 흐름 고치기 P1-1b)는 기본 on(K4) — 운영에서도 켜지고 디자인 컷 밖에서도 기록되며, 대조군 off·로컬 SKIP이면 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.flow).toBe(true)
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('flow')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).toContain('flow')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'flow' })).toEqual(K4.filter((f) => f !== 'flow'))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'flow', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('flow')
  })

  it('hookshort(첫 화면 글 줄이기)는 기본 off — D2 잡(K4 기본)에서 로컬 EXTRA로만 켜지고, D2가 아니거나 Vercel이면 기록하지 않는다', () => {
    expect(ENRICHMENT_DEFAULTS.hookshort).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('hookshort')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookshort' })).toContain('hookshort')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookshort', NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut2' })).not.toContain('hookshort')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookshort' })).not.toContain('hookshort')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookshort' })).not.toContain('hookshort')
  })

  it('skipdesign1(설계 ① 건너뛰기, J07)은 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로 K 잡에서만 기록하며 K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.skipdesign1).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('skipdesign1')
    expect(resolveEnabledFeatures({})).not.toContain('skipdesign1')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'skipdesign1' })).not.toContain('skipdesign1')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'skipdesign1' })).toContain('skipdesign1')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'skipdesign1', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('skipdesign1')
  })

  it('rulepriority(규칙 충돌 정리, 결정 카드 c05·J10)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고 로컬 EXTRA로만 기록한다', () => {
    expect(ENRICHMENT_DEFAULTS.rulepriority).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('rulepriority')
    expect(resolveEnabledFeatures({})).not.toContain('rulepriority')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'rulepriority' })).not.toContain('rulepriority')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'rulepriority' })).toContain('rulepriority')
  })

  it('regenslot(D 카피 재생성 걸린 섹션 1콜, 결정 카드 c14 L·J27)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고 로컬 EXTRA로만 기록한다(D·K 모두)', () => {
    expect(ENRICHMENT_DEFAULTS.regenslot).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('regenslot')
    expect(resolveEnabledFeatures({})).not.toContain('regenslot')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'regenslot' })).not.toContain('regenslot')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'regenslot' })).not.toContain('regenslot')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'regenslot' })
    expect(on.filter((f) => f !== 'regenslot')).toEqual(resolveEnabledFeatures({}))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'regenslot', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).toContain('regenslot')
  })

  it('usegate(게이트 기대 쓰는 법·사용 미달 끝 처리, J19)는 J34로 기본 on — 운영(Vercel·작업자)도 켜지고, K 잡에서만 기록하며 K가 아니면 빠지고, 로컬 SKIP으로 끈다', () => {
    expect(ENRICHMENT_DEFAULTS.usegate).toBe(true)
    expect(K4_SWITCHED_ON).toContain('usegate')
    expect(resolveEnabledFeatures({})).toContain('usegate')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('usegate')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toContain('usegate')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'usegate' })).toContain('usegate')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'usegate' })).not.toContain('usegate')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('usegate')
  })

  it('usefacts(쓰는 법 재료, J18)는 J34로 기본 on — 운영(Vercel·작업자)도 켜지고, K 잡에서만 기록하며 K가 아니면 빠지고, 로컬 SKIP으로 끈다', () => {
    expect(ENRICHMENT_DEFAULTS.usefacts).toBe(true)
    expect(K4_SWITCHED_ON).toContain('usefacts')
    expect(resolveEnabledFeatures({})).toContain('usefacts')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('usefacts')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toContain('usefacts')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'usefacts' })).toContain('usefacts')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'usefacts' })).not.toContain('usefacts')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('usefacts')
  })

  it('hookhero(후킹 약속 ↔ 대표 컷, c09·J21)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로 K 잡에서만 기록하며 K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.hookhero).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('hookhero')
    expect(resolveEnabledFeatures({})).not.toContain('hookhero')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookhero' })).not.toContain('hookhero')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookhero' })).toContain('hookhero')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'hookhero', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('hookhero')
  })

  it('photoroles(원천 사진 역할, J20)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로만 기록하며 D·K 모두 남는다', () => {
    expect(ENRICHMENT_DEFAULTS.photoroles).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('photoroles')
    expect(resolveEnabledFeatures({})).not.toContain('photoroles')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'photoroles' })).not.toContain('photoroles')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'photoroles' })).not.toContain('photoroles')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'photoroles' })).toContain('photoroles')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'photoroles', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).toContain('photoroles')
  })

  it('motionband(움직이는 칸)는 라이트 기본 off — 로컬 EXTRA에서만 K 잡에 기록하고 운영은 EXTRA를 무시한다', () => {
    expect(ENRICHMENT_DEFAULTS.motionband).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('motionband')
    expect(resolveEnabledFeatures({})).not.toContain('motionband')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).not.toContain('motionband')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motionband' })).toEqual([...K4.slice(0, K4.indexOf('shotvary')), 'motionband', ...K4.slice(K4.indexOf('shotvary'))])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('motionband')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'motionband' })).not.toContain('motionband')
    expect(resolveEnabledFeatures(R)).not.toContain('motionband')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'motionband' })).not.toContain('motionband')
  })

  it('shotvary(K 컷 거리·사람 박자)는 기본 on(K6 뒤 K4 운영, 오너 11-06 20:46) — templatelib과 함께일 때만 기록하고, K가 아니면 빠지고, 로컬 SKIP·R 대조군이면 꺼지고 Vercel은 SKIP을 무시한다', () => {
    expect(ENRICHMENT_DEFAULTS.shotvary).toBe(true)
    expect(K4_SWITCHED_ON).toContain('shotvary')
    expect(resolveEnabledFeatures({})).toEqual(expect.arrayContaining(['templatelib', 'shotvary']))
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(expect.arrayContaining(['templatelib', 'shotvary']))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('shotvary')
    const off = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'shotvary' })
    expect(off).toContain('templatelib')
    expect(off).not.toContain('shotvary')
    expect(resolveEnabledFeatures(R)).not.toContain('shotvary')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'shotvary' })).toContain('shotvary')
  })

  it('infocells(K 사진 아닌 정보 칸)는 기본 on(K6 뒤 K4 운영, 오너 11-06 20:46) — templatelib과 함께일 때만 기록하고, K가 아니면 빠지고, 로컬 SKIP·R 대조군이면 꺼지고 Vercel은 SKIP을 무시한다', () => {
    expect(ENRICHMENT_DEFAULTS.infocells).toBe(true)
    expect(K4_SWITCHED_ON).toContain('infocells')
    expect(resolveEnabledFeatures({})).toEqual(expect.arrayContaining(['templatelib', 'infocells']))
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(expect.arrayContaining(['templatelib', 'infocells']))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('infocells')
    const off = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'infocells' })
    expect(off).toContain('templatelib')
    expect(off).not.toContain('infocells')
    expect(resolveEnabledFeatures(R)).not.toContain('infocells')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_SKIP: 'infocells' })).toContain('infocells')
  })

  it('palettepick(K 색 조합 비전 고르기, J26)은 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로 K 잡에서만 기록하며 K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.palettepick).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('palettepick')
    expect(resolveEnabledFeatures({})).not.toContain('palettepick')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'palettepick' })).not.toContain('palettepick')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'palettepick' })).not.toContain('palettepick')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'palettepick' })
    expect(on).toEqual([...K4.slice(0, K4.indexOf('infocells') + 1), 'palettepick', ...K4.slice(K4.indexOf('infocells') + 1)])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'palettepick', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('palettepick')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'palettepick' })).not.toContain('palettepick')
  })

  it('specfixed(K spec 정본 고정, J23)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로 K 잡에서만 기록하며(infocells 바로 뒤) K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.specfixed).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('specfixed')
    expect(resolveEnabledFeatures({})).not.toContain('specfixed')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'specfixed' })).not.toContain('specfixed')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'specfixed' })).not.toContain('specfixed')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'specfixed' })
    expect(on.slice(on.indexOf('infocells'), on.indexOf('infocells') + 2)).toEqual(['infocells', 'specfixed'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'specfixed', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('specfixed')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'specfixed' })).not.toContain('specfixed')
    // 다른 기능 묶음은 그대로다(꺼진 잡과 켠 잡의 차이는 specfixed 하나)
    expect(on.filter((f) => f !== 'specfixed')).toEqual(resolveEnabledFeatures({}))
  })

  it('uspfacts(K 장점 후보를 사실로 세기)는 기본 on(K4) — templatelib과 함께일 때만 기록하고, K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.uspfacts).toBe(true)
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(expect.arrayContaining(['templatelib', 'uspfacts']))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('uspfacts')
    const noUsp = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'uspfacts' })
    expect(noUsp).toContain('templatelib')
    expect(noUsp).not.toContain('uspfacts')
    expect(resolveEnabledFeatures(R)).not.toContain('uspfacts')
  })

  it('uspaudit(K 장점 후보 근거 대조, J22)는 기본 off — 운영(Vercel·작업자)은 켜지지 않고, 로컬 EXTRA로 uspfacts 잡에서만 기록하며(uspfacts 바로 뒤) uspfacts·K가 아니면 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.uspaudit).toBe(false)
    expect(K4_SWITCHED_ON).not.toContain('uspaudit')
    expect(resolveEnabledFeatures({})).not.toContain('uspaudit')
    expect(resolveEnabledFeatures({ VERCEL: '1', NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit' })).not.toContain('uspaudit')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker', NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit' })).not.toContain('uspaudit')
    const on = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit' })
    expect(on.slice(on.indexOf('uspfacts'), on.indexOf('uspfacts') + 2)).toEqual(['uspfacts', 'uspaudit'])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit', NEXOPS_PDP_ENRICHMENT_SKIP: 'uspfacts' })).not.toContain('uspaudit')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit', NEXOPS_PDP_ENRICHMENT_SKIP: 'templatelib' })).not.toContain('uspaudit')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'uspaudit' })).not.toContain('uspaudit')
  })

  it('rhythm(카피 리듬)은 기본 on(K4) — 기록 순서는 flow 바로 뒤, 로컬 SKIP·대조군 off면 꺼지고 Vercel은 SKIP을 무시한다', () => {
    expect(ENRICHMENT_DEFAULTS.rhythm).toBe(true)
    const on = resolveEnabledFeatures({})
    expect(on.indexOf('rhythm')).toBe(on.indexOf('flow') + 1)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'rhythm' })).toEqual(K4.filter((f) => f !== 'rhythm'))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'rhythm', VERCEL: '1' })).toContain('rhythm')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('rhythm')
  })

  it('designlayout(디자인 컷 렌더 v2)은 기본 on(K4) — 운영에서도 켜지고, 로컬에서 빼면 그 위의 palette2·fontpair도 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.designlayout).toBe(true)
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(expect.arrayContaining(['designcut', 'designlayout']))
    const noLayout = resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designlayout' })
    for (const f of ['designlayout', 'palette2', 'fontpair']) expect(noLayout, f).not.toContain(f)
    expect(resolveEnabledFeatures(R)).not.toContain('designlayout')
  })

  it('lean(W5 안 쓰는 컷 빼기)은 기본 on이지만 디자인 컷 잡(K4 기본·운영)에는 기록하지 않는다 — R 대조군에서는 켜지고, 대조군 off면 꺼진다', () => {
    expect(ENRICHMENT_DEFAULTS.lean).toBe(true)
    expect(resolveEnabledFeatures({})).not.toContain('lean')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).not.toContain('lean')
    expect(resolveEnabledFeatures({ VERCEL_ENV: 'production' })).not.toContain('lean')
    expect(resolveEnabledFeatures(R)).toContain('lean')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('lean')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'designcut,composite,lean' })).not.toContain('lean')
    // 예전 로컬 EXTRA=lean은 R 기본값과 같다(기록 그대로)
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'lean' })).toEqual(R_DEFAULTS)
    const both = buildEnrichmentRecord(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'lean,split' }))!.features
    expect(both.slice(-4)).toEqual(['split', 'lean', 'audience', 'long'])
  })

  it('long(긴 상세페이지 확장 섹션)은 기본 on이지만 디자인 컷 잡(K4 기본·운영)과 대조군 off에서는 빠진다 — R 대조군에서는 켜진다', () => {
    expect(ENRICHMENT_DEFAULTS.long).toBe(true)
    expect(resolveEnabledFeatures({})).not.toContain('long')
    expect(resolveEnabledFeatures({ VERCEL: '1' })).not.toContain('long')
    expect(resolveEnabledFeatures(R)).toContain('long')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT: 'off' })).not.toContain('long')
    // long on/off 같은 커밋 짝 — 기본 on 기능만 로컬에서 뺀다(나머지 기본값은 그대로, Vercel은 무시)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: `${R_SKIP},long` })).toEqual(R_DEFAULTS.filter((f) => f !== 'long'))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: `${R_SKIP}, Long , unknown` })).toEqual(R_DEFAULTS.filter((f) => f !== 'long'))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: `${R_SKIP},long`, VERCEL: '1' })).toEqual(K4)
  })

  it('composite(묶음 4 원본 합성)도 기본 off — 실험 갈래 전용이라 로컬 EXTRA로만 켜지고 Vercel은 무시한다', () => {
    expect(ENRICHMENT_DEFAULTS.composite).toBe(false)
    expect(resolveEnabledFeatures({})).not.toContain('composite')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'designcut,composite' })).toEqual([...K4.slice(0, 8), 'composite', ...K4.slice(8)])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'composite', VERCEL_ENV: 'preview' })).toEqual(K4)
  })
})

describe('잡 단위 기록', () => {
  it('켜진 기능이 없으면 기록하지 않고, 기능 순서를 고정한다', () => {
    expect(buildEnrichmentRecord([])).toBeNull()
    expect(buildEnrichmentRecord(['persuasion', 'vocab'])).toEqual({ version: 1, features: ['vocab', 'persuasion'] })
    expect(buildEnrichmentRecord(['mobile', 'shots', 'vocab'])).toEqual({
      version: 1,
      features: ['vocab', 'shots', 'mobile'],
    })
  })

  it('형식이 맞지 않는 기록은 없는 것으로 본다(기존 동작)', () => {
    expect(readJobEnrichment({})).toBeNull()
    expect(readJobEnrichment(null)).toBeNull()
    expect(readJobEnrichment({ enrichment: { version: 2, features: ['vocab'] } })).toBeNull()
    expect(readJobEnrichment({ enrichment: { version: 1, features: 'vocab' } })).toBeNull()
    expect(readJobEnrichment({ enrichment: { version: 1, features: ['persuasion', 'unknown'] } })).toEqual({
      version: 1,
      features: ['persuasion'],
    })
  })

  it('hasEnrichmentFeature는 기록만 본다(환경 무관)', () => {
    const analysis = { enrichment: { version: 1, features: ['vocab', 'persuasion'] } }
    expect(hasEnrichmentFeature(analysis, 'persuasion')).toBe(true)
    expect(hasEnrichmentFeature(analysis, 'layouts')).toBe(false)
    expect(hasEnrichmentFeature({}, 'persuasion')).toBe(false)
  })
})

describe('analysisForPrompt — research·copy·design 직렬화', () => {
  it('enrichment 키가 없으면 같은 객체를 그대로 돌려준다(Track S 직렬화 불변)', () => {
    const analysis = { keywords: ['a'], detected_category: 'household' }
    expect(analysisForPrompt(analysis)).toBe(analysis)
  })

  it('enrichment 키만 빼고 나머지 키 순서는 보존한다', () => {
    const analysis = {
      keywords: ['a'],
      decision_profile: { giftability: 'high' },
      enrichment: { version: 1, features: ['vocab'] },
      raw_summary: 's',
    }
    const out = analysisForPrompt(analysis)
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({ keywords: ['a'], decision_profile: { giftability: 'high' }, raw_summary: 's' })
    )
    expect(analysis.enrichment).toBeDefined() // 원본 불변
  })

  it('카테고리 판정 기록(category_check, J22)도 뺀다 — 기록 칸이 생겨도 프롬프트 직렬화는 그 전과 바이트가 같다', () => {
    const before = { keywords: ['a'], detected_category: 'pet', raw_summary: 's' }
    const check = { source: 'llm', category: 'pet', confidence: 0.9, reasoning: '반려동물 식기', inList: true }
    const out = analysisForPrompt({ ...before, category_check: check })
    expect(JSON.stringify(out)).toBe(JSON.stringify(before))
    const all = analysisForPrompt({ ...before, enrichment: { version: 1, features: ['vocab'] }, category_check: check })
    expect(JSON.stringify(all)).toBe(JSON.stringify(before))
  })
})

describe('designcut2(D2 이미지 묶음)', () => {
  it('기본 on(K4) — designcut과 함께일 때만 기록하고, designcut을 빼면 함께 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.designcut2).toBe(true)
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toEqual(expect.arrayContaining(['designcut', 'designcut2']))
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('designcut2')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut2' })).toContain('designcut')
    expect(resolveEnabledFeatures(R)).not.toContain('designcut2')
  })
})

describe('shotdiv(컷 목적 다양화)', () => {
  it('기본 on(K4) — designcut과 함께일 때만 기록하고(designlong 뒤 순서), designcut을 빼면 함께 빠진다', () => {
    expect(ENRICHMENT_DEFAULTS.shotdiv).toBe(true)
    const on = resolveEnabledFeatures({})
    expect(on.slice(on.indexOf('rhythm'), on.indexOf('rhythm') + 3)).toEqual(['rhythm', 'designlong', 'shotdiv'])
    expect(resolveEnabledFeatures({ VERCEL: '1' })).toContain('shotdiv')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_SKIP: 'designcut' })).not.toContain('shotdiv')
  })
})

describe('isHostedPdpEnv — 운영 실행(Vercel·Railway 구독 작업자, R13)', () => {
  it('Vercel이나 작업자 표지면 운영 실행 — 작업자도 로컬 대조군·실험 스위치를 무시한다', () => {
    expect(isHostedPdpEnv({ VERCEL: '1' })).toBe(true)
    expect(isHostedPdpEnv({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(isHostedPdpEnv({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toBe(true)
    expect(isHostedPdpEnv({ NEXOPS_PDP_HOSTED: 'local' })).toBe(false)
    expect(isHostedPdpEnv({})).toBe(false)
    expect(isVercelEnv({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toBe(false)
    const worker = { NEXOPS_PDP_HOSTED: 'railway-worker' }
    expect(resolveEnabledFeatures({ ...worker, NEXOPS_PDP_ENRICHMENT: 'off' })).toEqual(resolveEnabledFeatures({ VERCEL: '1' }))
    expect(resolveEnabledFeatures({ ...worker, NEXOPS_PDP_ENRICHMENT_SKIP: 'long' })).toEqual(resolveEnabledFeatures({ VERCEL: '1' }))
  })
})

describe('motioncodex(움직이는 칸 구독 시트, AX-CT-35) — 꺼진 채 들어온다', () => {
  it('기본 off라 기본 기록(로컬·Vercel·작업자)이 지금과 같다', () => {
    expect(ENRICHMENT_DEFAULTS.motioncodex).toBe(false)
    expect(resolveEnabledFeatures({})).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_HOSTED: 'railway-worker' })).toEqual(K4)
  })

  it('운영 표지(Vercel·작업자)는 EXTRA=motioncodex를 무시한다 — 운영에서 켤 길이 없다', () => {
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motioncodex', VERCEL: '1' })).toEqual(K4)
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motioncodex', NEXOPS_PDP_HOSTED: 'railway-worker' })).toEqual(K4)
  })

  it('로컬 EXTRA로 motionband와 함께 켜지고, 움직이는 칸이 없는 잡에는 기록하지 않는다', () => {
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motionband,motioncodex' })).toEqual([
      ...K4.slice(0, K4.indexOf('shotvary')),
      'motionband',
      ...K4.slice(K4.indexOf('shotvary')),
      'motioncodex',
    ])
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motioncodex' })).not.toContain('motioncodex')
    expect(resolveEnabledFeatures({ NEXOPS_PDP_ENRICHMENT_EXTRA: 'motioncodex', NEXOPS_PDP_ENRICHMENT_SKIP: 'motionband' })).not.toContain('motioncodex')
    expect(resolveEnabledFeatures({ ...R, NEXOPS_PDP_ENRICHMENT_EXTRA: 'motioncodex' })).toEqual(R_DEFAULTS)
    expect(hasEnrichmentFeature({ enrichment: buildEnrichmentRecord(K4) }, 'motioncodex')).toBe(false)
  })
})
