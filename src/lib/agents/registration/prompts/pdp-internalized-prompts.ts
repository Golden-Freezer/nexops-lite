/**
 * Track I(internalized) 전용 프롬프트 블록 — DESIGN-INTERNALIZED-TRACK-20260811 결정 T-3.
 * §7 프롬프트 규약(인라인 금지, prompts/ 전용 파일) 준수 — 순수 문자열 조립만, LLM 호출 없음.
 *
 * 골격 잠금 계약: Track I의 design ①에서 activated_sections·section_order는 코드(buildSkeleton)가
 * 이미 확정했다. LLM에는 이 블록을 SECTION_PLANNING_PROMPT 말미에 append해 "골격 변경 금지 +
 * 세부만 설계"를 지시하고, 응답이 골격을 바꾸면 enforceSkeleton이 코드 레벨에서 복원한다(이중 방어).
 */

import { OPTION_SPEC_CATALOG_REASON } from '@/lib/registration/options/option-spec'
import type { BridgeAnchor, SectionBridge } from '@/lib/registration/internalized/section-bridges'

/** design ① 골격 잠금 지시 — 섹션 목록·순서는 고정 입력, LLM은 섹션별 세부만 설계한다. */
export function buildSkeletonLockBlock(activatedSections: string[], sectionOrder: string[]): string {
  return [
    '## [골격 확정 — 변경 금지]',
    '이 잡은 실측 내재화 트랙이다. 아래 섹션 구성과 순서는 베스트셀러 실측 통계로 이미 확정되었다.',
    `- activated_sections (그대로 반환할 것): ${JSON.stringify(activatedSections)}`,
    `- section_order (그대로 반환할 것): ${JSON.stringify(sectionOrder)}`,
    '',
    '지시:',
    '1. activated_sections와 section_order는 위 목록을 한 글자도 바꾸지 말고 그대로 반환하라. 섹션을 추가·삭제·재배열하지 마라. "섹션 수 가이드(최소 18개)" 등 앞선 지시와 충돌하면 이 골격이 우선한다.',
    '2. 당신의 임무는 골격 안의 세부 설계뿐이다: hook_strategy, section_specs(섹션별 목적·핵심 메시지), layout_selections, font_scheme, design_direction, reasoning.',
    '3. section_specs·layout_selections는 위 activated_sections에 있는 섹션에 대해서만 작성하라.',
  ].join('\n')
}

const STAGE_LABELS: Record<string, string> = {
  ATTENTION: '주목',
  RELEVANCE: '공감',
  VALUE: '가치',
  PROOF: '증거',
  ASSURANCE: '불안 해소',
  ACTION: '행동',
}
const GRAMMAR_LABELS: Record<string, string> = {
  G1: '표준 설득형',
  G2: '증거 선행형',
  G3: '즉시 가치형',
  G4: '감성 맥락형',
}

/**
 * 설득 흐름 요약(설계 §4.2 카피 연결) — 단계별 섹션 순서와 고민별 응답 섹션만 전달하는 구조 지시다. 문구를 주지 않는다.
 * 응답 섹션이 없는 고민은 "주장하지 말 것"으로 명시한다(근거 없는 인증·친환경·안전·효능 주장 방지).
 */
export function buildPersuasionFlowBlock(persuasion: {
  grammar: string
  stages: Array<{ section: string; stage: string; reason?: string }>
  objectionCoverage: Array<{ objection: string; answeredBy: string | null; note?: string }>
}): string {
  const grouped: Array<{ stage: string; sections: string[] }> = []
  for (const { section, stage } of persuasion.stages) {
    const last = grouped[grouped.length - 1]
    if (last && last.stage === stage) last.sections.push(section)
    else grouped.push({ stage, sections: [section] })
  }
  const lines = [
    '## [설득 흐름 — 구조 지시, 문구 아님]',
    `문법: ${persuasion.grammar}(${GRAMMAR_LABELS[persuasion.grammar] ?? persuasion.grammar}). 섹션 카피는 아래 단계 역할을 지킨다.`,
    ...grouped.map((g) => `- ${STAGE_LABELS[g.stage] ?? g.stage}: ${g.sections.join(' → ')}`),
  ]
  if (persuasion.stages.some((s) => s.section === 'solution_guide')) {
    // R2(P03 효능 감점): 해결 칸은 기능·구성으로 답한다. J50(오너 11-10 '효능 문구 부활'): 체감 효능은 함께 쓰고 의학·기능성 효능·보장만 막는다
    lines.push('- solution_guide는 바로 앞 공감 섹션의 고민에 대한 해결 요약이다. 기능·구성(무엇이 어떻게 작동하는지)과 그때의 체감 효능으로 답하고, 의학·기능성 효능과 보장·단정은 쓰지 않는다.')
  }
  if (persuasion.stages.some((s) => s.section === 'petit_div' && s.reason === OPTION_SPEC_CATALOG_REASON)) {
    lines.push(
      '- petit_div는 등록 옵션 안내다. colorOptions에는 title·description만 새로 쓰고, options에는 상품 정보의 colorOptions(등록 옵션명)를 한 글자도 바꾸지 말고 그대로 넣는다. 가격·할인·단가·"인기 1위" 같은 순위 표현을 쓰지 않는다.'
    )
  }
  if (persuasion.objectionCoverage.length > 0) {
    lines.push('', '고객 고민과 응답 위치:')
    for (const o of persuasion.objectionCoverage) {
      lines.push(
        o.answeredBy
          ? `- "${o.objection}" → ${o.answeredBy}에서 답한다${o.note ? ` (${o.note})` : ''}`
          : `- "${o.objection}" → 응답하지 않는다. ${o.note ?? '근거 없음'} — 이 고민에 대한 주장을 만들지 마라(비교·차별성·효과 문장으로 돌려 답하는 것도 금지).`
      )
    }
  }
  return lines.join('\n')
}

/** Stage 3 원문(pdp-copy-pro-prompts, NEXFIT copywriting_prompts.py:1109)의 키워드 분리 줄과 그 예시 — 기록 잡만 치환한다 */
const STAGE3_KEYWORD_SPLIT_LINE =
  '- pointCards[].title과 detailPoints[].claim에 동일하거나 유사한 키워드를 사용하지 마세요.'
const STAGE3_KEYWORD_SPLIT_EXAMPLE =
  '- 예시: pointCards "가벼운 무게" ↔ detailPoints "얇은 판 구조라 한 손으로 들고 다녀요"\n'
const STAGE3_SAME_FEATURE_LINE =
  '- detailPoints 1~4번은 같은 번호 pointCards와 같은 특징을 다른 표현으로 쓴다: claim은 카드 제목의 핵심 낱말 1개만 함께 쓰고, 나머지는 근거·사용 장면으로 푼다.'
const STAGE3_PROOF_DEFINITION_LINE = '- detailPoints = "심층 증명" (주장 + 기술적 근거 + 체감 효익 + 이미지 장면)'
const STAGE3_FACT_DEFINITION_LINE = '- detailPoints = "심층 설명" (특징 + 보이는 근거 + 쓰임 장면·체감 효익 + 이미지 장면)'

/**
 * Stage 3 검수에 특징 배정을 잇는다(R4 pdp-r4-copy-flow) — 원문의 키워드 분리 지시는 Stage 1 특징 배정(번호 짝으로 문구·컷·라벨을
 * 맞춘다)과 반대다. 기록 잡만 그 줄을 '같은 특징·다른 표현'으로 바꾸고, 키워드 분리 예시는 빼고, detailPoints 정의의
 * '체감 효익'을 '쓰임 장면·체감 효익'으로 바꾸고(R4 copy-bridge — J50 오너 11-10 '효능 문구 부활'로 체감 효익은 되살림), 말미에 특징 배정 블록을 우선 블록으로 붙인다. 원문 프롬프트 파일은 그대로다.
 */
export function applyFeatureOwnershipToStage3(prompt: string, ownershipBlock: string): string {
  const replaced = prompt
    .replace(STAGE3_KEYWORD_SPLIT_LINE, STAGE3_SAME_FEATURE_LINE)
    .replace(STAGE3_KEYWORD_SPLIT_EXAMPLE, '')
    .replace(STAGE3_PROOF_DEFINITION_LINE, STAGE3_FACT_DEFINITION_LINE)
  return [
    replaced,
    '',
    '## [검수 때도 특징 배정을 지킨다 — 위 중복 금지 규칙보다 우선]',
    '검수는 아래 배정을 되돌리지 않는다. detailPoints 1~4번과 pointCards 1~4번의 번호 짝을 바꾸거나, claim에서 카드 제목의 핵심 낱말을 지우지 마라.',
    ownershipBlock,
  ].join('\n')
}

/**
 * 특징 배정(R2 — R1 심사 r4 흐름·중복 2점) — 같은 특징을 여러 섹션이 같은 말로 되풀이하지 않게 카피 필드별 관점을 정한다.
 * 편집기 중복 정리(sectionConverter/dedupe.ts)의 배정과 같은 규칙이다(요약 카드는 제목만, point_div는 특징별 detailPoint,
 * sub_div는 남은 특징·새 관점, CTA 제목 25자). 문구를 주지 않는 구조 지시다.
 * review(Stage 3 검수용): Stage 3에 없는 '핵심 메시지 반복' 지시를 들먹이지 않는다(R4 copy-bridge).
 */
export function buildFeatureOwnershipBlock(sections: readonly string[], options: { review?: boolean } = {}): string {
  const has = (section: string) => sections.includes(section)
  const precedence = options.review
    ? '위 "pointCards와 detailPoints 중복 금지 규칙"보다 이 배정이 우선한다.'
    : '앞선 "핵심 메시지 3회 이상 반복"·"pointCards와 detailPoints 키워드 분리" 지시보다 이 배정이 우선한다.'
  const lines = [
    '## [특징 배정 — 같은 특징을 같은 말로 되풀이하지 않는다]',
    `pointCards는 이 상품의 특징 목록이다. 특징 하나는 주 섹션 한 곳에서만 자세히 말하고, 다른 섹션은 다른 관점(근거·사용 장면·선택 기준)으로 쓴다. ${precedence}`,
    // 피처 컷 features:i는 detailPoints[i]로 만들고 장식 라벨은 pointCards[i] 제목이다 — 번호가 맞아야 문구·컷·라벨이 맞는다
    '- detailPoints 1~4번은 pointCards 1~4번과 같은 특징을 같은 순서로 다룬다(claim에 그 카드 제목의 핵심 낱말을 넣는다). 5번부터는 pointCards에 없는 새 관점(사용 장면·활용)이다.',
  ]
  if (has('point_div')) {
    lines.push(
      '- main_cut 요약 카드에는 pointCards 제목만 목차로 실린다. 제목은 2~8자 명사구로 쓴다.',
      '- point_div: pointCards 1~3번 특징마다 같은 번호의 detailPoint가 실린다. claim은 카드 제목을 그대로 되풀이하지 말고 문장으로 풀며, proof는 카드 설명을 되풀이하지 말고 보이는 근거(소재·구성·사용 장면)로 쓴다.'
    )
  }
  if (has('sub_div')) {
    lines.push(
      '- sub_div: pointCards 4번 특징(detailPoints 4번)과 새 관점 detailPoints만 실린다. 같은 특징을 detailPoints 두 개에 나눠 쓰지 마라.'
    )
  }
  if (has('product_exposure'))
    lines.push('- productExposure: 실물을 보여 주는 한 줄이다. 특징 이름·옵션명을 다시 늘어놓지 않는다.')
  if (has('solution_guide'))
    lines.push('- solution.summary: 바로 앞 고민의 해결 요약이다. 특징·옵션 목록을 미리 늘어놓지 않는다.')
  if (has('petit_div')) {
    lines.push(
      '- colorOptions.description: 선택 기준(어떤 상황에 어떤 옵션이 맞는지)이다. 앞 섹션 문장을 되풀이하지 않는다.'
    )
  }
  // R4 심사 r4(4잡 모두 2): 번호 짝 밖의 섹션이 같은 특징 낱말을 되풀이했다 — 추천 대상·핵심 메시지·배너·비교(pdp-copy-facts-r4)
  lines.push(
    '- recommendedTargets는 사람·상황(누가·언제 쓰는지)으로 쓴다. 특징 이름·옵션 개수·옵션명을 넣지 않는다.',
    '- keyMessageVariations·summary·closingCta·soldOutBanner·eventBundleCopy·compareItems는 pointCards 제목 낱말을 그대로 되풀이하지 않는다. 같은 특징이면 다른 말(쓰임·선택 기준)로 쓴다.'
  )
  lines.push(
    '- mainIntro.subBenefit·mainCutCopy·productExposure·keyMessageCopy는 서로 다른 낱말로 쓴다.',
    has('convert_div')
      ? '- closingCta.headline과 closingCta.subtext는 각각 25자 이내 완성 문장이다(subtext가 마지막 CTA 제목이 된다).'
      : '- closingCta.headline은 25자 이내 완성 문장이다(마지막 CTA 제목). 25자를 넘기면 화면에서 잘린다.',
    '- 치수·소재·무게·용량 같은 수치와 규격은 상품 정보(spec_sheet·등록 옵션)에 있는 값만 쓴다. 없으면 만들지 말고 옵션명(예: S/L)으로만 말한다.'
  )
  return lines.join('\n')
}

const BRIDGE_ANCHOR_LABELS: Record<BridgeAnchor, string> = {
  situation: '상황 낱말(누가·언제·어디서)',
  concern: '고민 낱말',
  function: '기능 낱말',
  feature: '특징 낱말(pointCards 제목 낱말)',
  hook: '핵심 낱말',
}

function bridgeLine(b: SectionBridge): string {
  const into = b.receiveFields.join('·')
  if (b.anchor === 'hook') return `- ${into} ← ${b.sendField}의 핵심 낱말 하나를 한 번 다시 쓴다`
  const ownership =
    b.anchor === 'function' && (b.to === 'main_cut' || b.to === 'point_div')
      ? ' — pointCards 1번 제목 낱말을 쓰면 특징 배정과 함께 지킨다'
      : ''
  return `- ${into} ← ${b.sendField}의 ${BRIDGE_ANCHOR_LABELS[b.anchor]} 하나${ownership}`
}

/**
 * 섹션 잇기(R4 copy-bridge, 09_SECTION_BRIDGES.md 권장안 A) — Stage 1. 뒤 섹션의 보이는 필드가 앞 섹션 낱말 하나를 이어받는다.
 * 문구가 아니라 어떤 낱말을 받을지만 준다. 잇기가 없으면 빈 문자열(블록 없음).
 */
export function buildSectionBridgeBlock(bridges: readonly SectionBridge[]): string {
  if (bridges.length === 0) return ''
  return [
    '## [섹션 잇기 — 받는 말, 문구 아님]',
    '섹션이 따로 읽히지 않게 뒤 섹션의 첫 문장이 앞 섹션의 낱말 하나를 이어받는다. 이어받는 것은 사실 낱말(상황·고민·기능·특징 이름) 하나뿐이다 — 결과·효과·감각 낱말은 이어받지 않는다. 받는 말 말고는 앞 문장의 낱말을 되풀이하지 않고, 글자 수 한도는 그대로 지킨다.',
    ...bridges.map(bridgeLine),
  ].join('\n')
}

/** 섹션 잇기 보존(Stage 2·3) — 다듬거나 검수할 때 이어받은 낱말을 지우지 않게. 잇기가 없으면 빈 문자열 */
export function buildSectionBridgeKeepBlock(bridges: readonly SectionBridge[]): string {
  if (bridges.length === 0) return ''
  return [
    '## [섹션 잇기 보존]',
    '아래 필드는 앞 섹션의 낱말 하나를 이어받아 섹션을 잇는다. 다듬거나 검수할 때 그 이어받은 낱말을 지우거나 다른 말로 바꾸지 마라(글자 수·완성도 교정은 그 낱말을 남긴 채로 한다). 단, 주장 범위에 어긋나는 낱말(결과·효과·감각)이면 주장 범위가 우선한다.',
    ...bridges.map(bridgeLine),
  ].join('\n')
}
