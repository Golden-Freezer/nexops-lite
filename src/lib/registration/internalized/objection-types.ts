/**
 * 고객 고민(analysis.objection_priority) 유형 분류 — docs/plans/pdp-enrichment/00_DESIGN.md §4.2 "고민 → 응답 섹션".
 * 순수 함수·결정론. 규칙(정규식) 순서가 우선순위다 — 사실 주장 금지 유형(안전·소재)을 먼저 본다.
 * 분류하지 못한 고민은 other(미응답 기록 대상)로 둔다.
 */

export const OBJECTION_TYPES = [
  'safety_cert',
  'material_eco',
  'usage_care',
  'quality_durability',
  'quantity_size',
  'price_value',
  'environment_versatility',
  'other',
] as const
export type ObjectionType = (typeof OBJECTION_TYPES)[number]

const RULES: Array<[Exclude<ObjectionType, 'other'>, RegExp]> = [
  ['safety_cert', /안전|유해|무해|인증|KC|성분|자극|알레르기|위험|화상|부상|어린이|아이가|독성|피부/i],
  // '환경' 단독은 사용 환경과 겹친다 — 친환경·환경 영향 서술만 소재·환경으로 본다.
  [
    'material_eco',
    /친환경|환경\s*(우려|오염|부담|문제|영향|파괴|호르몬|친화)|일회용|재활용|재사용|플라스틱|PE\b|PVC|소재|재질|미세|분해|썩/i,
  ],
  [
    'usage_care',
    /뒷정리|정리|청소|세척|관리|사용법|사용 방법|어떻게 (쓰|사용)|조립|설치|보관|교체|번거|복잡|손질|세탁|씻/,
  ],
  ['quality_durability', /접착|내구|튼튼|약하|찢어|부러|고장|오래|품질|변색|벗겨|떨어지|흔들|견고|마감/],
  [
    'quantity_size',
    /수량|개수|\d+\s*(매|개|장|입|팩|ml|g|cm|mm)|충분|양이|크기|사이즈|용량|부피|작지|크지|맞을까|맞나/,
  ],
  ['price_value', /가격|단가|비싸|저렴|가성비|비용|경쟁력|가치|돈|할인/],
  [
    'environment_versatility',
    /실내|실외|야외|장소|상황|용도|활용|다양|어디서|공간|사용\s*환경|환경(에서|이|에)|계절|날씨/,
  ],
]

/** 고민 문자열 1건 → 유형. */
export function classifyObjection(text: string): ObjectionType {
  const value = text.trim()
  if (!value) return 'other'
  for (const [type, re] of RULES) if (re.test(value)) return type
  return 'other'
}

/** 사실 주장 금지 유형 — 근거가 없으면 응답 섹션 대신 미응답 기록(인증·친환경·무해 주장 금지). */
export const CLAIM_RESTRICTED_TYPES: ReadonlySet<ObjectionType> = new Set(['safety_cert', 'material_eco'])
