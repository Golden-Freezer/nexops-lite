/**
 * K 라인 템플릿 형식 — 규격은 docs/plans/pdp-enrichment/15_TEMPLATE_LINE.md다. 정본 데이터는 templates/<section>.json이고,
 * 여기는 그 모양과 섹션 표만 둔다. 순수·결정론.
 */

/**
 * 섹션 29종과 목표 개수·편집기 섹션 종류(15_TEMPLATE_LINE §1). faq·ingredients(입력 재료 이름 목록)·notice(입력 주의·보관 줄)는 편집기 종류가 없어 표와 같이 그린다.
 * motion_band(GIF 칸, 움직이는 띠)는 풀폭 사진 띠라 편집기 종류가 sub2_div_page와 같다
 */
export const SECTION_TABLE = {
  hook_3step: { target: 15, proType: 'hook_3step' },
  main_cut: { target: 15, proType: 'main_cut' },
  problem_raise: { target: 15, proType: 'problem_raise' },
  point_div: { target: 15, proType: 'point_div' },
  sub_div: { target: 15, proType: 'sub_div' },
  review: { target: 15, proType: 'perf_reviews' },
  compare: { target: 15, proType: 'compare_div' },
  spec_table: { target: 15, proType: 'spec_table' },
  cta: { target: 15, proType: 'cta' },
  problem_empathy: { target: 12, proType: 'problem_empathy' },
  solution_guide: { target: 12, proType: 'solution_guide' },
  key_message: { target: 12, proType: 'key_message' },
  sub2_div_page: { target: 12, proType: 'sub2_div_page' },
  hidden_page: { target: 12, proType: 'hidden_page' },
  option_gallery: { target: 12, proType: 'event_option' },
  petit_div: { target: 12, proType: 'petit_div' },
  faq: { target: 12, proType: 'spec_table' },
  certification: { target: 10, proType: 'certification' },
  event_offer: { target: 10, proType: 'event_banner' },
  perf_metric: { target: 10, proType: 'perf_rating' },
  product_exposure: { target: 10, proType: 'product_exposure' },
  direction_suggest: { target: 10, proType: 'direction_suggest' },
  concept_desc: { target: 10, proType: 'concept_desc' },
  point_list_div: { target: 10, proType: 'point_list_div' },
  convert_div: { target: 10, proType: 'convert_div' },
  how_to: { target: 6, proType: 'hidden_page' },
  ingredients: { target: 3, proType: 'spec_table' },
  notice: { target: 3, proType: 'spec_table' },
  motion_band: { target: 2, proType: 'sub2_div_page' },
} as const

export type TemplateSectionId = keyof typeof SECTION_TABLE
export const TEMPLATE_SECTION_IDS = Object.keys(SECTION_TABLE) as TemplateSectionId[]

/** 근거 잠금 — 실제 자료가 없는 상품에는 고를 수 없다 */
export const EVIDENCE_LOCKED: readonly TemplateSectionId[] = ['certification', 'event_offer', 'perf_metric', 'review', 'faq', 'ingredients', 'notice', 'motion_band']

/**
 * 사진 목적 등록표 — 등록 밖 낱말은 전수 검사가 막는다. state는 쓰는 중·붙인·담은 상태, package는 포장·구성품, ingredient는 재료다.
 * 제조 사진(process)은 실제 사진 잠금이 생기기 전에 등록하지 않는다(제조·산지·인증·후기 사진 생성 금지, 오너 11-01).
 * demo는 직접 해 보는 시연 컷(J57, demoshot 잡의 compare.demo-try만 — 근거 demo 잠금)이다. 사진 속 숫자·인증·'테스트 완료' 글은 그리지 않는다.
 */
export const SHOT_PURPOSES: readonly string[] = ['hero', 'feature_proof', 'scene', 'action', 'underside', 'scale', 'texture', 'quantity', 'color', 'group', 'problem', 'state', 'package', 'ingredient', 'demo']
/** 입력에 이름이 적힌 재료만 소품으로 쓰는 목적(오너 11-01 22:52) — 재료 이름이 없는 상품은 못 고르므로 슬롯에 다른 목적을 함께 둔다 */
export const INPUT_NAMED_PURPOSES: readonly string[] = ['ingredient']

/** 첫 화면 글의 양 — 1~3초에 읽힌다(오너 지시 11-01, 근거는 15_TEMPLATE_LINE §6). 큰 제목 2줄 + 보조 한 줄까지 */
export const HOOK_TEXT = { titleChars: 12, titleLines: 2, subChars: 12, subLines: 1 }

/** 비교 근거 — 기존 제품 칸의 표식·이름표는 비교 주장으로 읽혀, 근거가 있는 상품에만 쓴다 */
export const COMPARE_BASIS = 'compare_basis'
/** 엑스가 비교가 아니라 고객 고민을 뜻하는 섹션 — 그 밖에서는 엑스를 쓰지 않고 기존 제품 칸은 중립 dash다(오너 지시 깎아내리기 금지) */
export const PAIN_MARK_SECTIONS: readonly string[] = ['problem_raise', 'problem_empathy']

/** capsule.label에 쓸 수 있는 고정 글자 — 효능·수치·상품 정보를 담지 않는다 */
/** 상품 정보 표 — 필수 7행(이 순서)은 공용 함수가 rows로, 그 밖은 special로 채운다. 템플릿에 행 내용을 쓰지 않는다 */
export const SPEC_ROWS_INPUT = 'spec.rows'
/** 옵션 사진 목록 — 사진이 입력값이라 컷을 만들지 않는다 */
export const OPTION_IMAGES_INPUT = 'option.images'
/** 옵션 사진 한 장의 이름 — 사진 목록 칸 안의 글 칸. 이름을 따로 줄로 모으면 어느 사진의 이름인지 안 보인다 */
export const OPTION_NAME_INPUT = 'option.name'
/**
 * 옵션 라인업(적용 K3 R-W6, 통합 11-03 05:38·08:1x) — 옵션 사진이 모두 실물(isRealOptionPhoto)이고 옵션 수가 칸 최소~상한일 때만 채우는 사진·이름 목록.
 * 항목 하나가 사진(입력값)과 option.name이다. 기존 option.images 격자의 상한 자르기는 그대로다. 실물 아닌 사진은 잡 입력을 읽을 때(lineInputsOf, 적용 K6 ①)
 * 모두 이름만으로 바뀌어 격자에도 실리지 않는다
 */
export const OPTION_LINEUP_INPUT = 'option.lineup'
/** 판매자 시험 사진(J57 compare.demo-photo, demoshot 잡만) — 원천 사진 역할 demo 주소 그대로. 컷을 만들지 않는다 */
export const DEMO_PHOTOS_INPUT = 'demo.photos'
/** 사진이 입력값인 목록 — 컷 계획(imageSlots)이 컷을 만들지 않는다 */
export const INPUT_PHOTO_LISTS: readonly string[] = [OPTION_IMAGES_INPUT, OPTION_LINEUP_INPUT, DEMO_PHOTOS_INPUT]
export const SPEC_SPECIAL_INPUT = 'spec.special'
/** 재료 이름 — 입력 원재료·성분 칸의 이름 그대로(적용 K3 R-W8). names는 이름표(tags) 목록, items는 줄 목록이고 칸 하나가 name이다 */
export const INGREDIENT_NAMES_INPUT = 'ingredient.names'
export const INGREDIENT_ITEMS_INPUT = 'ingredient.items'
export const INGREDIENT_NAME_INPUT = 'ingredient.name'
/**
 * 별점 분포(적용 K7-b T1-69·T2-19, 통합 11-03 14:5x) — 자사 리뷰 파일의 rating_counts 원본만(근거 없는 기본값 없음, #289). 항목 하나가 한 점수 줄이고
 * 칸은 star·count·share다. 리뷰 합계가 RATING_BARS_MIN_TOTAL 미만이면 목록이 비어 이 칸이 든 템플릿은 후보에서 빠진다
 */
export const RATING_BARS_INPUT = 'review.ratingBars'
/** 별점 분포 칸이 나오는 리뷰 합계 문턱 — 한두 건으로 100% 막대가 되는 것을 막는다 */
export const RATING_BARS_MIN_TOTAL = 5
/**
 * 입력 잠금 목록(적용 K7-c (나), 통합 11-04 00:4x) — 입력이 있을 때만 채우고 짓지 않는다. 칸 상한을 넘거나 하나라도 칸보다 길면 목록 전체를 비워
 * 그 칸이 든 템플릿은 후보에서 빠진다(일부만 실으면 그게 전부인 것처럼 읽힌다). 값은 inputSlotsOf(input-slots-read.ts)와 같은 정리·규제 표현 거르기를 지난다.
 * parts = 구성품 이름(칸 name), usage = 사용 순서(칸 title·note), option.sizeRows = 옵션 섹션의 사이즈 표 줄(칸 label·value — D 사이즈표 matrixRows와 같은 '열 값 · 열 값')
 */
export const PARTS_ITEMS_INPUT = 'parts.items'
export const PART_NAME_INPUT = 'part.name'
/**
 * 후기 질문 FAQ(K4 ②, 통합 11-05 11:39) — 설계 단계 후기 질문 콜(reviewfaq, reviews/review-faq.ts)의 검사 통과분이다. 답은 자사 후기 원문 그대로이고
 * 질문만 모델이 다듬은 짧은 물음이다. 페이지 후기 카드와 같은 인용은 FAQ에서 뺀다(한쪽만). 출처 칸은 '구매 고객 후기' 고정 글이다
 */
export const FAQ_REVIEWS_INPUT = 'faq.reviews'
export const FAQ_QUESTION_INPUT = 'faq.question'
export const FAQ_ANSWER_INPUT = 'faq.answer'
export const FAQ_SOURCE_INPUT = 'faq.source'
export const USAGE_STEPS_INPUT = 'usage.steps'
export const USAGE_STEP_TITLE_INPUT = 'usage.step.title'
export const USAGE_STEP_NOTE_INPUT = 'usage.step.note'
export const SIZE_ROWS_INPUT = 'option.sizeRows'
export const SIZE_ROW_LABEL_INPUT = 'size.row.label'
export const SIZE_ROW_VALUE_INPUT = 'size.row.value'
/**
 * 같은 축척 윤곽(적용 K7 4d T1-84·T2-32, 통합 11-04 04:0x ③·06:0x) — 옵션 사이즈 표(sizeMatrix)의 가로 열·세로 열 숫자를 한 축척으로 그린다(옵션끼리만, 다른 물건과의 비교는 짓지 않음).
 * 칸 label(행 이름)·width·height(입력 글 그대로, 열 이름 단위만 붙임). 그릴 수 없는 입력이면 목록이 비어 그 칸은 후보에서 빠진다(input-values scaleItems)
 */
export const SIZE_SCALE_INPUT = 'option.sizeScale'
export const SIZE_SCALE_LABEL_INPUT = 'size.scale.label'
export const SIZE_SCALE_WIDTH_INPUT = 'size.scale.width'
export const SIZE_SCALE_HEIGHT_INPUT = 'size.scale.height'
/** 같은 축척 윤곽 행 수·이름 글자 수·축마다 큰 값 ÷ 작은 값 상한(통합 06:0x ③) — 이름은 열마다 한 줄 이름표(5열 폭에 LABEL 36이 드는 글자 수) */
export const SCALE_SET_LIMITS = { min: 2, max: 5, labelMax: 3, ratioMax: 12 } as const
/** 사용·교체·배송 주기 줄(적용 C5 ④ R-D3) — scheduleOf(input-values, 효과 시간표 줄 뺌)와 같은 값. 칸 label·period */
export const SCHEDULE_ROWS_INPUT = 'schedule.rows'
export const SCHEDULE_LABEL_INPUT = 'schedule.label'
export const SCHEDULE_PERIOD_INPUT = 'schedule.period'
/**
 * 견본 색 칩(적용 C5 ③ T1-99) — 입력 견본(swatches)을 옵션 이름과 짝지은 값(pairedSwatches — 옵션이 있으면 이름 맞는 견본만, 2개 미만이면 없음).
 * 칸 name = 짝 옵션 이름(옵션 없으면 견본 이름), hex = 입력 #RRGGBB 그대로(choices hex — 글로 찍지 않고 mark color로만 칠한다). 사진에서 색을 뽑지 않는다
 */
export const OPTION_SWATCHES_INPUT = 'option.swatches'
export const OPTION_SWATCH_NAME_INPUT = 'option.swatch.name'
export const OPTION_SWATCH_HEX_INPUT = 'option.swatch.hex'
/**
 * 옵션 색 띠(J54 option_gallery.named-bands, partsbands 잡만) — 판매자 옵션 이름과 그 옵션 실물 사진에서 잰 색(section_plan.option_colors)을 짝지은 값.
 * 이름은 입력 그대로(별명 짓지 않음), 색은 사진 측정값이다. 모든 옵션이 사진 색을 가질 때만 채운다
 */
export const OPTION_BANDS_INPUT = 'option.bands'
export const OPTION_BAND_NAME_INPUT = 'option.band.name'
export const OPTION_BAND_HEX_INPUT = 'option.band.hex'
/**
 * 주의·보관(적용 K7-c (가) T1-39·T2-04~06, 통합 11-04 01:2x) — 입력 주의·보관 줄과 추가 스펙 관리 행(D T9와 같은 읽기)에서 상품 정보 표 특수 행이 이미 싣는 글을 뺀 줄.
 * kind = 줄 이름(주의·보관·관리), text = 입력 글 그대로, icon = 줄 종류 아이콘(보관 storage·관리 clean — 주의는 아이콘이 없어 그 칸을 고르지 않는다)
 */
export const NOTICE_ITEMS_INPUT = 'notice.items'
export const NOTICE_KIND_INPUT = 'notice.kind'
export const NOTICE_TEXT_INPUT = 'notice.text'
export const NOTICE_ICON_INPUT = 'notice.icon'
/**
 * 사실 타일(infocells 스위치 잡만, 세션 B — 오너 11-06 ④ P07) — 상품 정보 표 행 가운데 아이콘이 정해진 행의 이름·값 그대로(info-cells factTiles, 짓지 않는다).
 * 칸 icon(사실 아이콘 이름)·label·value. 칸 글자 상한을 넘는 행은 건너뛰고 칸 상한까지 싣는다(표가 늘 있어 요약이다)
 */
export const SPEC_FACTS_INPUT = 'spec.facts'
export const SPEC_FACT_ICON_INPUT = 'fact.icon'
export const SPEC_FACT_LABEL_INPUT = 'fact.label'
export const SPEC_FACT_VALUE_INPUT = 'fact.value'
/**
 * 비교 근거(적용 C5 ②, 통합 11-04 03:3x ②·04:5x) — 입력 비교 행(compare-basis-read pageCompareBasis — 깎아내리기·타사 표식·규제 표현을 거른 값)만 쓰고 짓지 않는다.
 * compare.rows 목록 — 항목(item)만 싣는 ✓ 우리·줄표 기존 표(열 머리 '우리 제품'·'기존 제품')는 모든 행의 기존이 빌 때만.
 * compare.one.* 글 칸 — 행이 정확히 1개이고 기존이 있을 때만(카드 한 쌍, 카드 이름표 '기존 제품'·'우리 제품'). 행 수·글자 상한을 넘으면 목록 전체를 비운다(자르지 않는다).
 * 비교 근거를 요구하는 템플릿(needs.evidence compare_basis)은 이 입력 칸이 하나라도 있고 모두 채워질 때만 고른다(입력 사실이 안 나오는 비교 칸은 닫는다).
 * 기존·우리를 글(고정 이름표나 열 머리)로 가르는 칸만 연다(통합 11-04 05:15) — 이름표 없는 기존 → 우리 줄(side-rows)은 닫혀 있다
 */
export const COMPARE_ROWS_INPUT = 'compare.rows'
export const COMPARE_ITEM_INPUT = 'compare.item'
export const COMPARE_ONE_BASE_INPUT = 'compare.one.base'
export const COMPARE_ONE_OURS_INPUT = 'compare.one.ours'
export const COMPARE_INPUT_PREFIX = 'compare.'
export const SPEC_ROWS_MAX = 7

/**
 * 긴 페이지 기준 — 섹션 18~22개(20개 내외). 페이지는 860 폭으로 짜고 재며, 내보낼 때 780 폭으로 그대로 줄인다(오너 11-02).
 * 합격점은 780 파일 세로 25,000px 이상이다(오너 11-02, 초과 무관). 860 값은 올림해 줄인 파일이 25,000 밑으로 내려가지 않게 한다.
 * 통과는 860 값 25,000 그대로다(오너 11-01 19:06, 11-02 답에 언급 없어 통합 해석). 계획 목표는 합격점이다.
 */
export const PAGE_SECTIONS = { min: 18, target: 20, max: 22 }
export const PAGE_DESIGN_WIDTH = 860
export const PAGE_EXPORT_WIDTH = 780
export const PAGE_EXPORT_MARK_HEIGHT = 25_000
export const PAGE_MIN_HEIGHT = Math.ceil((PAGE_EXPORT_MARK_HEIGHT * PAGE_DESIGN_WIDTH) / PAGE_EXPORT_WIDTH)
export const PAGE_PASS_HEIGHT = 25_000
/** 860 세로 → 780 파일 세로(표시용, 반올림) */
export const toExportHeight = (height: number): number => Math.round((height * PAGE_EXPORT_WIDTH) / PAGE_DESIGN_WIDTH)
export const D_SECTION_HEIGHT = 1900

/**
 * 큰 POINT 머리 구조(오너 지시 11-01 'POINT 1·2·3은 카피가 나오는 자리가 같아야') — point_div 템플릿은 headStyle로 머리 구조를 밝힌다.
 * 페이지 안의 point_div는 같은 headStyle을 쓰고 아래 사진·내용 배치만 다르다(선택 규칙은 C).
 * 값은 흐름 맨 앞 노드들의 모양이다: 종류:슬롯 또는 라벨:토큰, 가로 칸은 [ ]로 묶는다.
 * point-center(적용 K4 T1-31, 연구 A3 #12) — 가운데 작은 단추 → 번호 → 큰 제목 → 짧은 글. 진행 표시 탭은 캡슐 오른쪽에 붙어 가운데를 깨므로
 * 두지 않고 번호가 순번을 맡는다. 페이지마다 첫 POINT가 머리를 정하고 둘째·셋째는 같은 머리만 고른다(selection-order pointCandidates)
 */
export const POINT_HEAD_STYLES = {
  'point-standard': 'capsule:POINT|row[text:chapter:DISPLAY,text:headline:H1]|text:sub:BODY',
  'point-center': 'capsule:POINT|text:chapter:DISPLAY|text:headline:H1|text:sub:BODY',
} as const
export type PointHeadStyle = keyof typeof POINT_HEAD_STYLES

export const STRUCTURE_LABELS = ['POINT', 'Q', 'A', 'VS', 'BEST', 'TIP', 'CHECK', 'DETAIL', 'SPEC', 'REVIEW', 'FAQ'] as const

/** 비교 이름표 — 오너 지시(11-01): 상대는 '기존 제품'으로만 적어 타사 제품처럼 보이지 않게 한다. 모델이 쓰지 않는 고정 글자다 */
export const COMPARE_LABELS = ['우리 제품', '기존 제품'] as const
export const COMPARE_OTHER_LABEL: (typeof COMPARE_LABELS)[number] = '기존 제품'

/** TABLE = 표 값 글(K10, 오너 11-02 '스펙 표는 폰트 사이즈를 줄여 가능하면 1줄') — 본문보다 작고 폰 판독 하한(M1 본문 45)에 둔다 */
export type TokenName = 'HOOK' | 'H1' | 'H2' | 'H3' | 'BODY' | 'BODY_BOLD' | 'TABLE' | 'LABEL' | 'CAPTION' | 'DISPLAY'
/** 이름 있는 간격 — titleGap·photoGap은 템플릿 spacing 값, 나머지는 코드 토큰(K_SPACE) */
export type GapName = 'titleGap' | 'photoGap' | 'blockGap' | 'itemGap' | 'rowGap' | 'tightGap' | 'tableGap' | 'tableTight'
/** 섹션 바탕 */
export type SurfaceName = 'W' | 'N' | 'T' | 'D' | 'P'
/** 상자 바탕 — A는 강조색 면 */
/** 상자 색. C는 바탕에 따라 풀리는 카드 색이다 — 흰 바탕이면 T, 그 밖이면 W */
export type FillName = 'W' | 'N' | 'T' | 'D' | 'A' | 'C'
/**
 * 글자 색 역할 — 값은 색 조합과 현재 바탕에서 나온다.
 * onFill은 강조색 상자(fill A) 위 글자다 — 제목이어도 제목 색 규칙(headingOn)을 쓰지 않고 그 면의 글자색 그대로 쓴다(규격 3절, 적용 K4 T1-67)
 */
export type ColorRole = 'text' | 'heading' | 'accent' | 'onFill'
export const COLOR_ROLES: readonly ColorRole[] = ['text', 'heading', 'accent', 'onFill']
export type RadiusName = 'card' | 'bubble' | 'none'

interface NodeBase {
  gapAfter?: GapName
}
export interface TextNode extends NodeBase {
  kind: 'text'
  slot: string
  token: TokenName
  align?: 'left' | 'center' | 'right'
  color?: ColorRole
  /** USP 강조 구절 */
  emphasis?: boolean
  x?: number
  w?: number
  /** 두 자리 번호(1 → 01) */
  format?: 'two'
  /** 표 이름 — 장식 이름표(TABLE_NAME_ELEMENT)로 그려 값 옆 좁은 칸에 둔다. 값 첫 줄 높이에 맞춰 내린다(K2). 행 높이 맞춤(even) 표에서는 행 가운데다(K10) */
  nameTag?: boolean
}
export interface CapsuleNode extends NodeBase {
  kind: 'capsule'
  label?: (typeof STRUCTURE_LABELS)[number]
  slot?: string
  fill?: FillName
  outline?: boolean
  align?: 'left' | 'center'
  /** 캡슐 줄 오른쪽 끝의 진행 표시(적용 K1 R-W7) — 같은 줄이라 머리 높이가 그대로다. 값이 없으면 캡슐만 그린다 */
  steps?: CapsuleSteps
}
/**
 * POINT 진행 표시 칸 — slot은 페이지 POINT마다 항목 하나인 목록(입력 POINT_STEPS_INPUT, 항목 칸 name), current는 지금 순번 칸(chapter),
 * name은 이 섹션의 소구 이름 칸(모델 글)이다. 지금 칸 이름은 name 값이 먼저다
 */
export interface CapsuleSteps {
  slot: string
  current: string
  name: string
}
/** 페이지 POINT 진행 목록 — 코드가 순서 풀이 결과로 채운다(POINT마다 소구 이름 칸 글, 없으면 빈 항목). 항목 칸은 POINT_STEPS_NAME 하나다 */
export const POINT_STEPS_INPUT = 'point.steps'
export const POINT_STEPS_NAME = 'name'
/** POINT 소구 이름 칸(CapsuleSteps.name) — 카피 프롬프트가 이 이름의 칸에만 탭 이름 규칙을 붙인다 */
export const POINT_STEP_SLOT = 'step'
/** 반복 칸 안 진행 표시(적용 T2-52 옵션 전환 띠) — 그 반복 목록의 field 칸을 이름으로, 지금 항목을 지금 칸으로 그린다 */
export interface StepsNode extends NodeBase {
  kind: 'steps'
  field: string
}
/**
 * 사진 위 글 — 풀폭 사진에만 얹는다. 스크림(막)은 엔진이 색 조합에서 계산해 항상 깐다.
 * ink: light = 짙은 막(deep) + onDeep, dark = 밝은 막(base) + heading. 짙은 면이 없는 컨셉의 light는 옅은 막 + 어두운 글자가 된다.
 */
export interface ImageOverlay {
  anchor: 'top' | 'bottom'
  ink: 'dark' | 'light'
  nodes: TextNode[]
}
export interface ImageNode extends NodeBase {
  kind: 'image'
  slot: string
  x?: number
  w?: number
  /** 860 풀폭 */
  bleed?: boolean
  fit?: 'cover' | 'contain'
  /** circle은 정원, arch는 위가 둥근 세로 사진(K-FRAME.md). 값이 없으면 풀폭 plain, 그 밖은 decor */
  frame?: 'decor' | 'plain' | 'circle' | 'arch'
  /** 사진 뒤에 어긋나게 까는 옅은 강조색 판 */
  plate?: { dx: number; dy: number }
  overlay?: ImageOverlay
  /** 원형 배지(적용 K1 R-D1) — 사진 위쪽 모서리 안의 원. 칸은 배지 입력(medal.ts BADGE_INPUTS)만이고 값이 없으면 그리지 않는다 */
  badge?: ImageBadge
  /**
   * 반 띠(적용 K7-c 4a T2-42) — 섹션 위 48 아래부터 이 사진 높이 절반까지 풀폭 면을 맨 아래에 깐다(사진이 면 아래 경계에 걸친다).
   * 면 색은 D 큰 POINT half와 같은 식(halfPlaneOf). 흐름 맨 위 단계의 본문 폭 사진 하나에만 쓴다(린트)
   */
  half?: boolean
}
export interface ImageBadge {
  slot: string
  corner: 'tl' | 'tr'
}
export interface RowNode extends NodeBase {
  kind: 'row'
  gap?: number
  /** stretch = 칸 바로 아래 상자를 가장 긴 칸 높이로 맞춘다(타일) */
  valign?: 'top' | 'center' | 'stretch'
  /** 글만 있는 줄도 보이지 않는 상자로 묶는다 — 이름·값이 함께 줄어도 아래를 한 번만 민다(K2 좌우 표) */
  box?: boolean
  columns: Array<{ w: number; nodes: FlowNode[] }>
}
export interface PanelNode extends NodeBase {
  kind: 'panel'
  fill: FillName
  /** 풀폭 띠 — 안쪽 위아래 여백은 template.spacing의 top·bottom */
  bleed?: boolean
  /** 풀폭 띠의 안쪽 위아래 여백을 섹션 여백 대신 이 간격으로(머리 띠, 적용 K11 T2-27). 섹션 여백 120·48·88·120은 그대로다 */
  pad?: 'blockGap' | 'itemGap'
  x?: number
  w?: number
  radius?: RadiusName
  /** 말풍선 꼬리 모서리(적용 T1-66, 연구 A5 6.8) — 그 모서리만 작게 그린다. 사람 말 칸(고민·후기·질문)의 bubble 판에만 쓴다 */
  tail?: TailCorner
  /**
   * 곡선 경계(적용 K1 T1-33·T2-46) — 풀폭 띠의 한쪽 가장자리를 곡선·사선으로 깎는다(panel-edge.ts). 높이는 그대로다.
   * 그쪽에 같은 섹션의 간격이 있을 때만 그리고, 섹션 끝이면 곧은 가장자리다. wave는 라이브러리에서 POINT 아닌 칸 하나까지(페이지 한 번, 린트)
   */
  edge?: PanelEdge
  /** 윤곽선 카드(적용 T1-33) — 채움 없이 선만 긋는다. fill은 쓰지 않고 글색은 바깥 바탕을 따른다. 카드(풀폭 아님)에만 */
  outline?: boolean
  /**
   * 항목 색 띠(J54 option_gallery.named-bands) — 반복 칸 항목의 이 칸(hex 값)을 바탕 쪽으로 옅게 섞어 띠를 칠한다(itemBandSurface).
   * 글자색은 바탕 글자색 그대로이고 대비 4.5를 못 지키면 fill 토큰 면으로 돌아간다. 값이 없거나 색이 아니면 fill 그대로다
   */
  fillFrom?: string
  nodes: FlowNode[]
}
export interface PanelEdge {
  side: 'top' | 'bottom'
  shape: 'arc' | 'slant' | 'wave'
}
/** 꼬리 모서리 — 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래(편집기 borderRadii 순서) */
export type TailCorner = 'tl' | 'tr' | 'br' | 'bl'
export interface RepeatNode extends NodeBase {
  kind: 'repeat'
  slot: string
  columns?: 1 | 2 | 3
  gap?: GapName
  /** 항목 사이 구분선 */
  rule?: boolean
  /** 앞 목록과 잇는 선 — 바로 앞 구분선 있는 반복이 그려졌으면 그 끝과 이 목록 첫 줄 사이에도 같은 선·간격을 둔다. 이 목록이 비면 선도 없다(K8 표 rows·special) */
  joinRule?: boolean
  /**
   * 표 행 높이 맞춤(K10, 오너 11-02 '2줄이 되더라도 칸 높이는 가능한 동일하게') — 같은 표(이 목록과 뒤에 joinRule로 잇는 목록)의 행을
   * 가장 낮은 행보다 한 줄 높은 행까지 같은 높이로 세우고 글을 그 안 가운데에 둔다. 더 긴 행은 제 높이다. 행 글은 높이 고정이라 실측이 달라도
   * 행 높이가 그대로다. 항목이 글뿐이거나 글만 있는 가로 칸 하나일 때만 쓴다(린트)
   */
  even?: boolean
  /** 항목 사이 화살표 */
  connector?: 'arrow'
  /** 좌우 번갈아(적용 T1-33) — 둘째·넷째 항목은 가로 칸 순서를 뒤집는다(사진 왼쪽 → 오른쪽). 한 줄 반복의 2칸 가로 칸 항목에만(린트) */
  alternate?: boolean
  /**
   * 층 띠(적용 K1 T1-85) — 항목마다 칸 폭 띠를 깔고 위에서 아래로 같은 강조색을 옅음 → 짙음으로 쌓는다(layer-band.ts). 띠끼리 맞닿아 gap·rule·connector는 쓰지 않고
   * 안쪽 여백은 cardPad다. 한 줄 반복의 글 항목에만(린트)
   */
  layer?: boolean
  nodes: FlowNode[]
}
export interface DividerNode extends NodeBase {
  kind: 'divider'
  x?: number
  w?: number
}
/**
 * 구역 연결 표식(적용 R-W9) — 섹션 아래 여백 안 가운데 세로 점선 + 맨 아래 원 화살표. 값 없는 장식이라 높이·간격이 0이고(템플릿 높이·서명 그대로),
 * 최상위 흐름 맨 끝에만 둔다(린트). 풀폭으로 끝나 아래 여백이 없으면 그리지 않는다. 그리기는 zone-link.ts
 */
export interface LinkNode extends NodeBase {
  kind: 'link'
}
export const MARK_VALUES = ['index', 'check', 'cross', 'dash', 'warn'] as const
export type MarkValue = (typeof MARK_VALUES)[number]
export interface MarkNode extends NodeBase {
  kind: 'mark'
  /**
   * index = 항목 번호, check·cross·dash = 표시(dash는 기존 제품 칸의 중립 표식), warn = 경고 느낌표(주의 줄, 적용 K4 T1-67 — 연구 A5 #13, 쓰는 자리는 K7 notice T2-05).
   * slot이면 값이 check·cross·dash다
   */
  value?: MarkValue
  slot?: string
  /**
   * 견본 색(적용 C5 ③ T1-99) — 칸 이름(choices hex 글 칸)이면 그 값 #RRGGBB로 칠한 도형만 그린다(글자 없음, 옅은 테두리). value·slot과 함께 쓰지 않는다.
   * 값이 #RRGGBB가 아니면 그리지 않는다
   */
  color?: string
  align?: 'left' | 'center'
}
/** 아이콘 — 값은 사전(icons.ts)의 이름이고, 모르는 이름은 그리지 않는다. disc면 강조색 원 위에 그린다 */
export interface IconNode extends NodeBase {
  kind: 'icon'
  slot: string
  /** ICON_SIZES 중 하나 */
  size: number
  disc?: boolean
  align?: 'left' | 'center'
}
export interface TagsNode extends NodeBase {
  kind: 'tags'
  slot: string
  align?: 'left' | 'center'
  /** 늘 알약 모양 — 제목 아래 낱말 칩 줄(적용 K1 R-W10). 없으면 컨셉 모서리(radius.chip)를 따른다 */
  pill?: boolean
}
export interface RatingNode extends NodeBase {
  kind: 'rating'
  slot: string
  align?: 'left' | 'center'
  /** 별 옆에 평점 숫자를 함께 쓴다 — 4.9가 별 5개로만 보이지 않게 */
  value?: boolean
}
/**
 * 별점 분포 막대(적용 K7-b) — slot은 RATING_BARS_INPUT 목록. 항목마다 한 줄: 'N점' 라벨 + 칸 폭 트랙 + share 비율 채움 + 퍼센트 글.
 * 줄 높이가 고정이라 높이 추정이 결정론이다. 색은 컨셉 강조색(채움)·옅은 중립(트랙)만 쓴다
 */
export interface BarsNode extends NodeBase {
  kind: 'bars'
  slot: string
}
/**
 * 같은 축척 윤곽(적용 K7 4d) — slot은 SIZE_SCALE_INPUT 목록. 같은 폭 열마다 입력 가로·세로를 한 축척으로 줄인 사각형(바닥 맞춤) + 열 이름표 한 묶음,
 * 그 아래 전체 폭에 행마다 치수 줄('S  가로 20cm · 세로 30cm'). 축척은 입력 숫자에서만 나온다(제품 모양이 아니라 사각형 윤곽)
 */
export interface ScaleSetNode extends NodeBase {
  kind: 'scaleSet'
  slot: string
}
export interface DimensionNode extends NodeBase {
  kind: 'dimension'
  slot: string
  w?: number
  /** 사진을 반 칸에 놓고 치수 이름표는 옆 반 칸에 둔다(K2, 적용 K14). 옆 칸에 안 들어가면 사진 아래다 */
  side?: boolean
  widthSlot: string
  heightSlot: string
  /**
   * 깊이 칸(적용 K7-c 4c T1-41) — 입력 spec.size.depth 필수 칸. 값이 있으면 이름표로만 적는다(적용 K14 — 사진 위 선은 가로·세로뿐, 3축 그림 없음). 없으면 깊이 글이 없을 뿐 그대로다
   */
  depthSlot?: string
}

/** 고정 글자 이름표 — 슬롯이 없다. 장식 라벨 규칙(한 줄·32px 이상)을 따르므로 나란히 놓아도 본문 2열이 아니다 */
export interface LabelNode extends NodeBase {
  kind: 'label'
  label: (typeof COMPARE_LABELS)[number]
  token?: 'LABEL' | 'BODY_BOLD'
  align?: 'left' | 'center'
  color?: ColorRole
}

export type FlowNode =
  | TextNode
  | LabelNode
  | CapsuleNode
  | ImageNode
  | RowNode
  | PanelNode
  | RepeatNode
  | DividerNode
  | MarkNode
  | IconNode
  | TagsNode
  | RatingNode
  | BarsNode
  | ScaleSetNode
  | DimensionNode
  | StepsNode
  | LinkNode

export type ClaimRisk = 'none' | 'effect' | 'compare' | 'regulated'

export interface TextSlot {
  type: 'text'
  required: boolean
  source: 'copy' | 'input'
  /** source가 input일 때 입력 키(review.rating·chapter 등) */
  input?: string
  /** 값 하나가 소비하는 사실 수 */
  facts: number
  maxChars: number
  maxLines: number
  claimRisk: ClaimRisk
  /** icon이면 값은 아이콘 이름이다 — 모델은 사전의 이름만 고른다. hex면 값은 입력 #RRGGBB이고 mark color로만 칠한다(적용 C5 ③) */
  choices?: 'icon' | 'hex'
}
export interface ImageSlot {
  type: 'image'
  required: boolean
  purpose: string[]
  /** 구도 — 컷 계획이 페이지 안에서 다르게 배정한다 */
  composition: string[]
  aspect: Array<'3:4' | '4:3' | '1:1' | '2:3'>
  minHeight: number
}
export interface ListSlot {
  type: 'list'
  required: boolean
  /** 코드가 채우는 목록(상품 정보 표 등) — 없으면 카피 */
  source?: 'copy' | 'input'
  input?: string
  min: number
  max: number
  /**
   * 입력 목록이 실제로 받는 항목 수(없으면 max, K14) — 옵션이 많은 상품만 쓰는 여유다. max는 높이 표본(heightRange)에도 쓰여 늘리면
   * 옵션 1~2개 상품의 계산 높이와 페이지 고르기까지 바뀌므로 따로 둔다
   */
  inputMax?: number
  fields: Record<string, TextSlot | ImageSlot>
}
export type SlotDef = TextSlot | ImageSlot | ListSlot

export interface Signature {
  columns: 1 | 2 | 3
  photo: 'none' | 'bleed-top' | 'bleed-bottom' | 'inset' | 'offset' | 'side' | 'pair' | 'grid'
  align: 'left' | 'center'
  container: 'none' | 'plate' | 'card' | 'band' | 'table' | 'tile' | 'bubble' | 'overlay'
}

export interface Template {
  id: string
  section: TemplateSectionId
  name: string
  version: number
  surfaces: SurfaceName[]
  flow: FlowNode[]
  slots: Record<string, SlotDef>
  spacing: { top: number; titleGap: number; photoGap: number; bottom: number }
  signature: Signature
  needs: { photos: number; evidence: string[]; facts: { min: number; max: number } }
  /** 예상 높이(860 폭, px) — min은 필수 슬롯만, max는 모두 상한까지 */
  estimatedHeight: { min: number; max: number }
  /** 대표 높이 — min·max의 가운데. 순서 풀이가 페이지 높이 합을 낸다 */
  height: number
  /** 머리 구조 — point_div는 필수(POINT_HEAD_STYLES). 페이지 안 point_div끼리 같아야 한다 */
  headStyle?: PointHeadStyle
  /** 같은 모티프 계열을 묶는 값 — 페이지 family와 같으면 가점을 받는다. 공용 템플릿은 비운다 */
  family?: string
  fit: {
    concepts: string[]
    density: 'low' | 'mid' | 'high'
    personaTags: string[]
    categoryBlock: string[]
    /** 이 카테고리 상품에만 쓴다. 비면 공용이다 */
    categories?: string[]
    /** 이 제품군(product-family.ts) 상품에만 쓴다. 제품군 값이 없는 상품에는 쓰지 않는다 */
    productFamilies?: string[]
  }
  order: { zone: 'intro' | 'problem' | 'value' | 'trust' | 'decision'; notNextTo: string[] }
  tokens: { color: 'concept'; type: 'scene'; radius: 'concept' }
  check: { stress: 1.2; lint: 'ci'; avgScore: number | null; usedIn: number }
  preview: string
}

/** 슬롯 값 — 글자, 문자열 목록(tags), 항목 목록. 사진 슬롯 값은 이미지 키다. 빈 값·없는 칸은 그 요소를 만들지 않는다 */
export type SlotItem = Record<string, string | null | undefined>
export type SlotValue = string | string[] | SlotItem[] | null | undefined
export type SlotValues = Record<string, SlotValue>

/** 디자인 컷 계획 섹션에 남기는 선택 기록(15_TEMPLATE_LINE §10) */
export interface TemplateRef {
  id: string
  version: number
  slots: SlotValues
  /** 모델이 고른 제목 강조 구절(적용 T1-17) — 강조 칸 글의 부분 문자열로 검사한 값만. 없으면(옛 잡) 지금 규칙(USP 낱말·수량) */
  accent?: string
}
