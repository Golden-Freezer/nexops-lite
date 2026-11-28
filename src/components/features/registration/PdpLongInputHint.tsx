/**
 * 긴 상세페이지 입력 안내(PDP-DR-PLAN §7) — 생성 화면의 사이즈·소재·사용처·추가 스펙이 긴 상세페이지 확장 섹션 근거라는 것을 알린다.
 * 확장 섹션은 '실측 내재화 β'(internalized) 생성에서만 판정하고(pdp-enrichment-stage), 입력 값만 그대로 옮기며 페이지에 이미 보이는
 * 값은 다시 싣지 않는다(long-sections). 관리 방법·구성은 쿠팡 상품 정보(고시정보·속성)에 거의 없어(0단계 측정 2026-10-31: 관리 0/23,
 * 수량은 옵션과 같은 값뿐) 오너가 적어야 표가 생긴다. 예시 항목명(구성·관리 방법)은 표 라벨 규칙(SIZE_LABEL·CARE_LABEL)에 맞는다
 */

import { LONG_SECTION_TITLE } from '@/lib/registration/long-sections'

const titles = [LONG_SECTION_TITLE.size, LONG_SECTION_TITLE.care, LONG_SECTION_TITLE.faq].map((t) => `'${t}'`).join('·')

export const LONG_INPUT_HINT =
  `'실측 내재화 β'로 생성하면 사이즈·소재·사용처와 추가 스펙의 구성·관리 방법 행(항목명 예: 구성, 관리 방법)이 ` +
  `긴 상세페이지 ${titles} 섹션의 근거가 됩니다. 적은 값만 쓰고 이미 보이는 값은 다시 싣지 않습니다. ` +
  '관리 방법·구성은 쿠팡 상품 정보에 거의 없어 직접 적어야 합니다.'

export function PdpLongInputHint() {
  return (
    <p role="note" className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
      <span className="font-semibold text-slate-700">긴 상세페이지 표에 쓰는 칸 · </span>
      {LONG_INPUT_HINT}
    </p>
  )
}
