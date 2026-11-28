// 입력 칸 표본(적용 JOB C1) — 시험과 저장 컷 렌더 눈 확인 전용이다. 실제 상품 값이 아니고 고객 페이지·유료 잡에 넣지 않는다(오너 답 '화면 확인은 표본 값').
// 부품을 만드는 K1·K7·D1·D2는 이 값을 시험 상품 spec에 얹어 본다: withSampleInputSlots(product.specSheet). 위치 표는 docs/plans/pdp-enrichment/INPUT-SLOTS.md

import type { InputSlotFields } from '../input-slots'
import type { PdpSpecSheet } from '../pdp-state'

export const INPUT_SLOT_SAMPLE: Required<InputSlotFields> = {
  noticeItems: [
    { kind: 'caution', text: '표본 주의 문구입니다' },
    { kind: 'storage', text: '표본 보관 문구입니다' },
    { kind: 'care', text: '표본 관리 문구입니다' },
  ],
  productMetrics: [
    { name: '표본길이', value: '10', unit: 'cm' },
    { name: '표본무게', value: '200', unit: 'g' },
  ],
  usageSteps: [
    { title: '표본 첫째 단계', description: '표본 설명입니다' },
    { title: '표본 둘째 단계', description: '표본 설명입니다' },
    { title: '표본 셋째 단계' },
  ],
  sizeMatrix: {
    columns: ['어깨', '가슴'],
    rows: [
      { label: 'S', values: ['40', '90'] },
      { label: 'M', values: ['42', '95'] },
    ],
  },
  layers: [{ name: '표본 겉층', note: '표본 설명입니다' }, { name: '표본 속층' }],
  swatches: [
    { name: '표본 초록', hex: '#5A7D5A' },
    { name: '표본 베이지', hex: '#D9C7A7' },
  ],
  realPhotos: [{ kind: 'material', url: 'https://example.com/sample-material.jpg', caption: '표본 재료 사진' }],
  productColor: '#5A7D5A',
  // 비교 근거(C5 ②, 통합 11-04 05:2x 표본 (가)) — 두 행 모두 기존이 있는 사실 값이라 D 비교 줄이 열리고, K 비교 칸은 0(이름표 없는 side-rows는 닫음 — 통합 11-04 05:15).
  // 기존이 빈 행의 줄표·✓ 표(marks-table)·카드 한 쌍(vs-cards)은 시험으로만 본다(compare-input.test·designCut-compare-rows.test)
  compareBasis: [
    { label: '표본 용량', ours: '표본 500ml', other: '표본 350ml' },
    { label: '표본 무게', ours: '표본 210g', other: '표본 320g' },
  ],
  compareSource: '표본 출처입니다',
  schedule: [
    { label: '표본 사용', period: '표본 1일 1회' },
    { label: '표본 교체', period: '표본 3개월마다' },
    { label: '표본 세척', period: '표본 주 1회' },
  ],
}

/** 추가 스펙으로 들어오는 칸의 표본 — 구성품·원재료·관리 */
export const INPUT_SLOT_SAMPLE_EXTRA_SPECS = [
  { key: '구성품', value: '표본 본체, 표본 받침' },
  { key: '원재료', value: '표본 재료 가, 표본 재료 나' },
  { key: '관리 방법', value: '표본 관리 행입니다' },
]

/** 자사 리뷰 파일 집계 표본 — 별점 분포 */
export const INPUT_SLOT_SAMPLE_REVIEW_FILES = {
  own: { stats: { total_rows: 100, text_review_count: 60, rating_counts: { 5: 70, 4: 20, 3: 6, 2: 3, 1: 1 } } },
} as unknown as PdpSpecSheet['reviewFiles']

/** 상품 spec에 표본 칸을 모두 얹는다. 인증은 규제 판정이 달라져 넣지 않는다 — 인증 칸 시험은 따로 준다 */
export function withSampleInputSlots<T extends PdpSpecSheet>(spec: T): T {
  return {
    ...spec,
    ...INPUT_SLOT_SAMPLE,
    extraSpecs: [...(spec.extraSpecs ?? []), ...INPUT_SLOT_SAMPLE_EXTRA_SPECS],
    reviewFiles: INPUT_SLOT_SAMPLE_REVIEW_FILES,
  }
}
