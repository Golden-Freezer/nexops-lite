/**
 * Track I(internalized) 전용 프롬프트 블록 — DESIGN-INTERNALIZED-TRACK-20260811 결정 T-3.
 * §7 프롬프트 규약(인라인 금지, prompts/ 전용 파일) 준수 — 순수 문자열 조립만, LLM 호출 없음.
 *
 * 골격 잠금 계약: Track I의 design ①에서 activated_sections·section_order는 코드(buildSkeleton)가
 * 이미 확정했다. LLM에는 이 블록을 SECTION_PLANNING_PROMPT 말미에 append해 "골격 변경 금지 +
 * 세부만 설계"를 지시하고, 응답이 골격을 바꾸면 enforceSkeleton이 코드 레벨에서 복원한다(이중 방어).
 */

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
