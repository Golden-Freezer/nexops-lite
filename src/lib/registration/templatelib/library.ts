/**
 * K 라인 템플릿 라이브러리 — 정본은 templates/<section>.json이다(15_TEMPLATE_LINE §2). 섹션 파일을 더하면 여기에 잇는다.
 * 계산 칸은 scripts/pdp-kline/fill-meta.ts가 채우고, 전수 검사(lint.ts)가 CI에서 대조한다. 순수·결정론.
 */

import certification from './templates/certification.json'
import compare from './templates/compare.json'
import conceptDesc from './templates/concept_desc.json'
import convertDiv from './templates/convert_div.json'
import cta from './templates/cta.json'
import directionSuggest from './templates/direction_suggest.json'
import eventOffer from './templates/event_offer.json'
import faq from './templates/faq.json'
import hiddenPage from './templates/hidden_page.json'
import hook3step from './templates/hook_3step.json'
import howTo from './templates/how_to.json'
import ingredients from './templates/ingredients.json'
import notice from './templates/notice.json'
import motionBand from './templates/motion_band.json'
import keyMessage from './templates/key_message.json'
import mainCut from './templates/main_cut.json'
import optionGallery from './templates/option_gallery.json'
import perfMetric from './templates/perf_metric.json'
import petitDiv from './templates/petit_div.json'
import pointDiv from './templates/point_div.json'
import pointListDiv from './templates/point_list_div.json'
import problemEmpathy from './templates/problem_empathy.json'
import problemRaise from './templates/problem_raise.json'
import productExposure from './templates/product_exposure.json'
import review from './templates/review.json'
import solutionGuide from './templates/solution_guide.json'
import specTable from './templates/spec_table.json'
import sub2DivPage from './templates/sub2_div_page.json'
import subDiv from './templates/sub_div.json'
import categoryBeauty from './templates/category/beauty.json'
import categoryDigital from './templates/category/digital.json'
import categoryFashion from './templates/category/fashion.json'
import categoryFood from './templates/category/food.json'
import categoryHousehold from './templates/category/household.json'
import categoryPackaging from './templates/category/packaging.json'
import categoryPet from './templates/category/pet.json'
import categoryStationery from './templates/category/stationery.json'
import type { Template, TemplateSectionId } from './template-types'

export const TEMPLATES: readonly Template[] = [
  hook3step,
  pointDiv,
  specTable,
  review,
  cta,
  sub2DivPage,
  productExposure,
  petitDiv,
  problemRaise,
  problemEmpathy,
  solutionGuide,
  directionSuggest,
  compare,
  subDiv,
  keyMessage,
  mainCut,
  hiddenPage,
  pointListDiv,
  optionGallery,
  conceptDesc,
  convertDiv,
  certification,
  eventOffer,
  perfMetric,
  faq,
  howTo,
  ingredients,
  notice,
  // GIF 칸(움직이는 띠) — motionband 스위치가 켜진 잡에만 근거 motion이 생겨 열린다. 꺼진 잡은 근거 잠금으로 후보가 0이다
  motionBand,
  // 카테고리 템플릿 — 키별 파일이라 세 세션이 겹치지 않는다(종합 3절, 15_TEMPLATE_LINE §2)
  categoryBeauty,
  categoryDigital,
  categoryFashion,
  categoryFood,
  categoryHousehold,
  categoryPackaging,
  categoryPet,
  categoryStationery,
].flat() as unknown as Template[]

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]))

/**
 * 옛 템플릿 id → 지금 id(별칭) — 이름이 바뀐 칸을 옛 저장 K 계획(templateRef.id·layoutId)이 그대로 쓰게 푼다. 목록(TEMPLATES)·전수 린트·선택에는 들지 않고,
 * 지금 id는 별칭보다 먼저다. 새 칸의 필수 슬롯이 옛 칸에 같은 형식으로 있는 짝만 둔다(옛 저장 값으로 그려진다). 슬롯이 달라 별칭을 둬도 못 그리는 4짝은 두지 않아
 * 지금처럼 대체 경로로 간다: spec_table.bleed-bottom → pair-top(#487, 사진 photo → left·right), main_cut.packaging-set-size-grid → packaging-set-pair-lead(#565, lead 사진),
 * perf_metric.plain-left → head-pair(#590, detail 사진), product_exposure.plate-offset → three-views(#590, headline·views). 지운 hook_3step.three-steps(758a92fd)는 짝이 없다.
 * 근거: capture d9f1c961 섹션 18 → 17(#594 option_gallery.lead-card가 lead-bleed로 바뀌어 template-fallback, 통합 11-02 23:5x).
 */
export const TEMPLATE_ALIASES: ReadonlyMap<string, string> = new Map([
  // #541 18e1945b 사진 위 글
  ['hook_3step.offset-right', 'hook_3step.overlay-bottom-left'],
  ['hook_3step.solo-center', 'hook_3step.overlay-top-center'],
  ['key_message.offset-plain', 'key_message.overlay-top-left'],
  // #590 e229eac4 같은 뼈대 바꿈(K11 #2)
  ['certification.names-center', 'certification.names-side'],
  ['convert_div.bleed-center', 'convert_div.arch-center'],
  ['perf_metric.score-photo', 'perf_metric.score-circle'],
  ['petit_div.offset-left', 'petit_div.circle-right'],
  ['point_div.offset-plate', 'point_div.arch-photo'],
  ['problem_raise.plate-note', 'problem_raise.circle-note'],
  ['spec_table.center-rows', 'spec_table.dimension-center'],
  ['spec_table.offset-left', 'spec_table.photo-card-rows'],
  ['spec_table.offset-center', 'spec_table.band-head-rows'],
  // #594 cf1854c4 사각 안 사진 옮김(K11 #3)
  ['main_cut.scale-solo', 'main_cut.scale-plate'],
  ['main_cut.card-center', 'main_cut.card-bleed'],
  ['option_gallery.lead-card', 'option_gallery.lead-bleed'],
  ['product_exposure.parts-card', 'product_exposure.parts-plate'],
  ['sub_div.center-inset', 'sub_div.center-arch'],
  // 적용 K13(오너 11-04 18:11 ①) 첫 화면에서 뺀 사진 나란히·공용과 모양이 겹치는 칸, 히어로 자격을 뺀 작은 사진 칸
  ['hook_3step.two-photos', 'hook_3step.scene-left'],
  ['hook_3step.pair-center', 'hook_3step.center-bleed'],
  ['hook_3step.three-colors', 'hook_3step.center-bleed'],
  ['hook_3step.plate-center', 'hook_3step.center-bleed'],
  ['main_cut.band-side', 'main_cut.band-left'],
  ['main_cut.side-note', 'main_cut.bottom-center'],
  ['main_cut.parts-grid', 'main_cut.card-grid'],
])

export const templateById = (id: string): Template | undefined => BY_ID.get(id) ?? BY_ID.get(TEMPLATE_ALIASES.get(id) ?? '')
export const templatesOf = (section: TemplateSectionId): Template[] => TEMPLATES.filter((t) => t.section === section)
