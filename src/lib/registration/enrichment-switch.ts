/**
 * 상세페이지 개선(ENRICHMENT) 스위치와 잡 단위 기록 — docs/plans/pdp-enrichment/00_DESIGN.md §4.7.
 *
 * - 기능은 구현된 작업이 기본값을 켠다(T2: vocab·persuasion, T3: layouts·shots·mobile, T4: annotations, T6b: options,
 *   W5: lean — W5b 뒤 기본 on, 통합 결정 2026-10-30, W4-S: split — 오너 지시 2026-10-31 '섹션을 늘려 길게, 짧게는 완성본에서 줄인다').
 * - 로컬 실행(하네스·실행기)에서만 NEXOPS_PDP_ENRICHMENT=off로 전부 끌 수 있다(대조군). Vercel 환경 표지에서는 무시한다.
 * - analysis 단계가 켜진 기능을 analysis.enrichment = { version: 1, features }로 남기고(Track I이고 하나라도 켜졌을 때.
 *   Track S는 audience 판정이 켜진 잡만 audience 하나),
 *   이후 단계는 환경이 아니라 이 기록만 따른다 — 재개·배포 사이에도 한 잡 안에서 섞이지 않는다.
 *   기록이 없는 잡(구 잡·대조군·판정이 꺼진 Track S)은 기존 동작이다.
 * - designcut(D1, 디자인 컷 비교군)은 기본 off다. 로컬 실행에서 NEXOPS_PDP_ENRICHMENT_EXTRA=designcut(쉼표 목록)일 때만
 *   기본값에 더한다 — 운영 기본 경로는 그대로다. Vercel 환경 표지에서는 무시한다.
 * - audience(학부모 대리 구매형 parent_proxy 2단계)는 기본 on이다 — R7(P01·P02) 판정 뒤 통합 결정 2026-10-30. 판정이 켜진 상품만
 *   달라지고(analysis.enrichment.audience), 판정이 꺼진 상품은 기능만 기록되고 동작은 그대로다. Track S도 판정이 켜진 잡만 audience 하나를
 *   기록한다(통합 결정 2026-10-30 — 오너 요청인 학부모 페르소나가 운영 기본 생성에도 해당).
 * - long(긴 상세페이지 확장 섹션, long-sections.ts, PDP-DR-PLAN §7 ②)은 기본 on이다 — 오너 요청(2026-10-31 '섹션을 늘려 길게').
 *   근거 입력이 있는 확장 섹션만 더한다. 디자인 컷 잡에는 기록하지 않고, 짝 회차 대조군은 로컬 NEXOPS_PDP_ENRICHMENT=off로 끈다.
 *   long on/off 같은 커밋 짝은 로컬 NEXOPS_PDP_ENRICHMENT_SKIP=long(기본 on 기능만 빼기, 쉼표 목록, Vercel 무시)으로 돌린다.
 * - fullimage(통이미지 편집 가능 실험, PDP-FULLIMAGE-DESIGN.md)도 기본 off다 — R<n>-F 짝 회차로 잰다. 디자인 컷 잡에는 기록하지 않는다.
 * - references(레퍼런스 분석 산출을 리서치에 덧붙임, 13_REFERENCE_INPUT.md)도 기본 off다 — 자사 L0로 잰 뒤 기본값을 정한다.
 * - brief(이미지 브리프 정리 E4·지시 격리 P1-5, pdp-image-brief.ts)도 기본 off다 — R<n>-B 짝 회차로 잰다.
 * - designcut2(D2 이미지 묶음, PDP-DR-PLAN §2)는 디자인 컷 위의 하위 갈래다 — designcut과 함께 켜질 때만 기록한다(기본 off, R<n>-D2).
 * - light(R1 빛·색온도 정본, pdp-image-light.ts, PDP-DR-PLAN §3)도 기본 off다 — R9에서 R1~R3과 함께 잰다.
 * - scene(R2 세트 기술·장면 컷, scene-set.ts·pdp-image-scene.ts)도 기본 off다 — 하네스 V 갈래(R<n>-V)가 light와 함께 켠다.
 * - shotplan(R3 촬영 계획, internalized/shot-plan.ts)도 기본 off다 — V 갈래가 light·scene과 함께 켠다.
 * - designlayout(디자인 컷 렌더 v2, designCut/layout2.ts)도 기본 off다 — 렌더만 바뀌어 기존 D 잡을 다시 캡처해 잰다(이미지 생성 0).
 * - flow(카피 흐름 고치기 P1-1b, copy-flow-check.ts)도 기본 off다 — Stage 3 '고칠 곳'에 반복·답 없는 고민을 넣는다. 흐름 수 기록
 *   (copy_sections.copy_flow)은 이 스위치와 상관없이 모든 잡에 남는다(기준값).
 * - rhythm(카피 리듬 — 짧은 문장·의미 단위 줄바꿈·섹션마다 한 가지, copy-rhythm-check.ts, 오너 지시 2026-10-31)도 기본 off다 — Stage 2
 *   쓰기 지시와 Stage 3 '고칠 곳'을 붙인다(R10 켬/끔 짝). 리듬 수 기록(copy_sections.copy_rhythm)은 이 스위치와 상관없이 모든 잡에 남는다.
 * - designlong(디자인 컷 긴 페이지, internalized/designcut-long.ts)은 디자인 컷 위의 하위 갈래다 — designcut과 함께 켜질 때만
 *   기록한다(기본 off, R10에서 켬/끔으로 잰다). 사실 표 판정(section_plan.long)은 long과 같은 함수를 쓴다.
 * - shotdiv(컷 목적 다양화, internalized/shot-diversity.ts)는 디자인 컷 위의 하위 갈래다 — designcut과 함께 켜질 때만 기록한다(기본 off,
 *   R10-L에서 켬). 컷 목적 계획(section_plan.extra_shots)·구도 지문(dhash)·구도 중복 재생성은 이 스위치 잡에만 있다.
 * - palette2(D2 아트 디렉션 v2 — 대상별 팔레트·첫 화면 타이포, internalized/art-palette.ts)도 기본 off다 — designcut2·designlayout과
 *   함께 켜질 때만 기록한다(R10 켬/끔 짝).
 * - fontpair(글꼴 짝 — 상품 성격별 제목 글꼴 + 본문 Pretendard, internalized/art-fonts.ts)도 기본 off다 — palette2와 같은 범위
 *   (designcut2·designlayout과 함께)에서만 기록한다(R10 다음 회차 켬/끔).
 * - reviewfaq(후기 속 실제 질문, reviews/review-faq.ts)도 기본 off다 — designlong과 함께 켜질 때만 기록한다. 구매 전 질문 표의 앞줄이 된다.
 * - templatelib(템플릿 조합 라인 K, templatelib/ · 15_TEMPLATE_LINE.md)은 디자인 컷 위의 하위 갈래다 — designcut과 함께 켜질 때만 기록한다
 *   (기본 off, 로컬 EXTRA로만). 조립은 계획 섹션의 templateRef만 보므로 꺼진 잡은 결과가 바이트까지 같다.
 * - uspfacts(K 장점 후보를 사실로 세기, templatelib/selection-facts.ts)는 templatelib 위의 하위 갈래다 — templatelib과 함께 켜질 때만
 *   기록한다(기본 off, 로컬 EXTRA로만, K4 회차 실행 설정에서 켬). 꺼진 잡은 사실 목록·예산이 그대로다.
 * - uspaudit(K 장점 후보 근거 대조, templatelib/usp-audit.ts, 결정 카드 c11·하네스 J22)는 uspfacts 위의 하위 갈래다 — uspfacts와 함께일 때만
 *   기록한다(기본 off, 로컬 EXTRA로만). 카피 뒤 사실 감사가 '근거 없음'으로 본 주장과 겹치는 장점 후보를 사실 목록에서 뺀다. 꺼진 잡은 사실 목록이 그대로다.
 * - motionband(움직이는 칸 — 대표 칸·계획 AI가 고른 칸·motion_band, 움직이는 칸 자리 규칙 #872)도 templatelib 위의 하위 갈래다 — templatelib과
 *   함께 켜질 때만 기록한다. 오너 2026-11-06 23:2x 'GPT GIF로 사용 승인'으로 K4 운영 기본값에 넣는다(엔진은 gpt-image-2.6 GIF 시트 고정 —
 *   운영 경로는 엔진을 고르지 않고 gif-sheet만 쓴다, 영상 엔진은 등록하지 않았다). 꺼진 잡은 섹션·컷·내보내기가 바이트까지 같다.
 * - pageplan(K가 읽는 기획 1장, templatelib/page-plan-read.ts, 결정 카드 c10·하네스 J28)·copystory(K 칸 카피가 읽는 D 원문 카피, templatelib/copy-story.ts,
 *   J36)도 templatelib 위의 하위 갈래다 — designcut·templatelib과 함께일 때만 기록한다(기본 off, 로컬 EXTRA로만). 꺼진 잡은 구성·칸 카피 프롬프트가 그대로다.
 * - shotvary(K 컷 거리·높이·사람 박자, templatelib/shot-variety.ts)도 templatelib 위의 하위 갈래다 — templatelib과 함께 켜질 때만 기록한다
 *   (K6 뒤 K4 운영 기본값). 꺼진 잡은 K 계획 기록·컷 프롬프트가 바이트까지 같다.
 * - hookbeats(K 첫 화면 안 B 3박자, templatelib/hook-beats.ts, 결정 카드 c19·하네스 J24)도 templatelib 위의 하위 갈래다 — designcut·templatelib과
 *   함께일 때만 기록한다(기본 off, 로컬 EXTRA로만). 켠 잡만 근거 hook_beats로 안 B 첫 화면 템플릿(정원부터)을 연다. 꺼진 잡은 후보·선택·렌더가 그대로다.
 * - infocells(K 사진 아닌 정보 칸 — 사실 타일·사용 순서 도식 등, 세션 B infographic)도 templatelib 위의 하위 갈래다 — templatelib과 함께
 *   켜질 때만 기록한다(K6 뒤 K4 운영 기본값). 꺼진 잡은 템플릿 후보·선택·렌더가 바이트까지 같다.
 * - specfixed(K spec 정본 고정, templatelib/spec-fixed.ts, 결정 카드 c27·하네스 J23)도 templatelib 위의 하위 갈래다 — templatelib과 함께일 때만
 *   기록한다(기본 off, 로컬 EXTRA로만). K 옵션 칩 원천을 판매자 입력으로, 칸 카피에 크기·소재·옵션 수 고정 값 줄. 꺼진 잡은 칩·프롬프트가 그대로다.
 * - palettepick(K 색 조합을 비전 모델이 고르기, templatelib/palette-pick.ts, 결정 카드 c28·하네스 J26)도 templatelib 위의 하위 갈래다 — templatelib과
 *   함께일 때만 기록한다(기본 off, 로컬 EXTRA로만). 새 콜이 생기고 색이 바뀌므로 꺼진 잡은 색·K 계획 기록이 바이트까지 같다.
 * - K4 운영 전환(오너 2026-11-06 09:39 '전환 PR 준비 승인'): K4 회차 11잡의 기록 묶음과 같게 기능 14개를 기본 on으로 바꿨다 — designcut과
 *   그 위 D2·렌더 v2·카피 흐름·리듬·긴 페이지·컷 목적·팔레트·글꼴·후기 질문·부품 규칙·식별 카드·K 라인(templatelib)·장점 사실(uspfacts).
 *   K6 확인 판 뒤(오너 2026-11-06 20:46 '권장안 승인', K6 블라인드 3승 0패) 사진 다양화(shotvary)·정보 칸(infocells) 2개, 오너 2026-11-06
 *   23:2x 'GPT GIF로 사용 승인'으로 움직이는 칸(motionband) 1개를 더해 지금 K4_SWITCHED_ON은 17개다(14 + 2 + 1). 잡 기록
 *   (analysis.enrichment)에는 이 17개에 원래 기본 on인 기능(vocab·persuasion 등)이 더해져 그보다 많다.
 *   위 기능별 줄의 '기본 off'는 각 기능이 처음 들어올 때의 설명이다 — 지금 기본값의 정본은 ENRICHMENT_DEFAULTS 표와 K4_SWITCHED_ON이다.
 *   split·lean·long은 그대로 true지만 designcut 잡에서 빠진다(resolveEnabledFeatures). 되돌리기는 이 표를 되돌려 배포 — 이미 만든 잡은
 *   analysis.enrichment 기록대로 남는다. 로컬 R 대조군은 NEXOPS_PDP_ENRICHMENT_SKIP=K4_SWITCHED_ON 전부다(designcut 하나만 빼면
 *   flow·rhythm·designlayout·partsrule·idcardall이 남아 이전 R 묶음과 같지 않다).
 * - usefacts(쓰는 법 재료, 결정 카드 c02·J18)는 templatelib 위의 하위 갈래다 — 기본 off, 로컬 EXTRA로만. 켜기는 확인 판 뒤 오너 승인(I1-1).
 * - usegate(게이트 기대 쓰는 법·사용 미달 끝 처리, 결정 카드 c08·J19)도 templatelib 위의 하위 갈래다 — 기본 off, 로컬 EXTRA로만(I1-1).
 * - photoroles(원천 사진 역할, 결정 카드 c12·J20)는 기본 off, 로컬 EXTRA로만. 켜기는 확인 판 뒤 오너 승인(I1-1).
 * - demoshot(직접 해 보는 시연 칸, 하네스 J57·통합 decide 35·37)은 templatelib 위의 하위 갈래다 — 기본 off, 로컬 EXTRA로만(I1-1).
 * - regenslot(D 카피 재생성 걸린 섹션 1콜, 결정 카드 c14 L·J27)는 기본 off, 로컬 EXTRA로만. D·K 모두(카피 단계는 공통). 켜기는 확인 뒤(I1-1).
 * - effectshot(체감 결과 한 장면·효과 보이는 사용 움직임 먼저, 하네스 J53·통합 decide 32)는 templatelib 위의 하위 갈래다 — 처음엔 기본 off, J65로 기본 on
 *   (통합 decide 41·42 — 확인 판 J59 블라인드에서 자기 질문 둘을 모두 이김). 로컬 대조군은 SKIP에 이 이름을 적는다.
 * - problemobject(고민 실물 컷 — 상표 없는 낡은 일반 물건 근접, 하네스 J56·통합 decide 35)도 templatelib 위의 하위 갈래다 — 기본 off, 로컬 EXTRA로만(I1-1).
 * - showbeat(칸 글이 말한 동작·설계를 컷·움직이는 칸이 직접 보이기, 하네스 J63·통합 decide 42)도 templatelib 위의 하위 갈래다 — 처음엔 기본 off, J69로 기본 on
 *   (통합 decide 44 — J66 컷 확인 6짝 더 보임 1·같음 5·덜 보임 0·부작용 0). 로컬 대조군은 SKIP에 이 이름을 적는다.
 * - motioncodex(움직이는 칸을 GPT 구독 3×3 시트로, AX-CT-35·오너 X-189)는 motionband 위의 하위 갈래다 — 기본 off, 로컬 EXTRA로만. 운영은 켤 길이 없다.
 * 환경 변수는 호출 시점에 읽는다(모듈 로드 시점 고정 금지 — 골든 테스트의 대조군 stub이 먹어야 한다).
 */

import type { AudienceRecord } from './parent-proxy'
import type { PdpModelBatch } from './pdp-model-batch'

export const ENRICHMENT_FEATURES = [
  'vocab',
  'persuasion',
  'layouts',
  'shots',
  'annotations',
  'mobile',
  'options',
  'designcut',
  'composite',
  'split',
  'lean',
  'audience',
  'long',
  'fullimage',
  'references',
  'brief',
  'light',
  'scene',
  'designcut2',
  'shotplan',
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
  'herotype',
  'sizecut',
  'fillacts',
  'problemcut',
  'hookshort',
  'templatelib',
  'uspfacts',
  'uspaudit',
  'motionband',
  'pageplan',
  'copystory',
  'shotvary',
  'hookbeats',
  'infocells',
  'specfixed',
  'palettepick',
  'newstages',
  'skipdesign1',
  'rulepriority',
  'usefacts',
  'hookhero',
  'photoroles',
  'demoshot',
  'usegate',
  'partsbands',
  'regenslot',
  'effectshot',
  'problemobject',
  'showbeat',
  'motioncodex',
] as const
export type EnrichmentFeature = (typeof ENRICHMENT_FEATURES)[number]

/** 기능별 기본값 — 구현·검증이 끝난 기능만 켠다. */
export const ENRICHMENT_DEFAULTS: Readonly<Record<EnrichmentFeature, boolean>> = {
  vocab: true,
  persuasion: true,
  layouts: true,
  shots: true,
  annotations: true,
  mobile: true,
  // spec_sheet.optionSpec이 있는 잡만 달라진다(05_OPTIONS.md §3) — 없으면 기존 옵션 규칙 그대로
  options: true,
  // D1 디자인 컷 — 운영 기본 on(K4 운영 전환, 오너 2026-11-06 09:39 '전환 PR 준비 승인' — K4 11잡 묶음과 같게)
  designcut: true,
  // 묶음 4 원본 합성 — 고르기 문턱이 검증 전 가설이라 실험 갈래 전용(기본 off, 로컬 EXTRA로만, 통합 승인 조건)
  composite: false,
  // W4-S 섹션 나누기 — 특징·사용 단계를 하나씩 섹션으로 펼친다. 기본 on(운영 포함, 오너 지시 2026-10-31 — 상세페이지를 길게,
  // 짧게는 편집기에서 섹션을 지운다): R5-S − R5′ −0.16으로 점수가 같고 r4(반복)도 나빠지지 않았다. 디자인 컷 잡에는 기록하지 않는다
  split: true,
  // W5 안 쓰는 컷 생성 전 빼기 — 골격이 쓸 키만 만든다. 기본 on(운영 포함): 렌더 사진은 같고(R5 실잡 오프라인 시뮬레이션) 잡당 약 4컷을
  // 덜 만든다. 수동 추가 섹션 사진은 편집기 'AI로 이 섹션 사진 만들기'(W5b)로 만든다. 디자인 컷 잡은 자기 필터가 있어 기록에서 뺀다
  lean: true,
  // 학부모 대리 구매형(parent_proxy) — 판정이 켜진 잡에 기본 페르소나·카피/이미지 지시·산출 뒤 재작성. 기본 on(운영 포함, R7 판정 뒤):
  // 손해 없이 같은 방향(R7-P−R7 평균 +1.88, 위반·감점 0)이고 오너 요청 기능이다. 디자인 컷 잡에도 남는다(짝 treatment와 같은 조건)
  audience: true,
  // 긴 상세페이지 확장 섹션(L-1: 크기·구성·관리·보관·구매 전 질문) — 근거 입력이 있을 때만 더한다. 기본 on(오너 요청, 운영 포함 — Track S
  // 적용은 R9 뒤). 디자인 컷 잡에는 기록하지 않는다(디자인 컷 템플릿이 섹션 구성을 따로 정한다)
  long: true,
  // 통이미지(편집 가능) 실험 — 히어로·main_cut·cta를 통이미지 → 바탕 + 텍스트 요소로(기본 off, 로컬 EXTRA로만, F-2부터 동작)
  fullimage: false,
  // 레퍼런스(기존 상세 캡처·PDF 분석 전용) — spec_sheet.referenceInputs가 있는 잡의 리서치에 구조·흐름·소구 유형 블록을 덧붙인다
  // (기본 off, 로컬 EXTRA로만 — 자사 L0 측정 뒤 기본값을 정한다). 원문 가드는 이 스위치와 상관없이 레퍼런스가 있으면 걸린다
  references: false,
  // 이미지 브리프 정리(E4·P1-5) — 조립된 컷 프롬프트의 중복·충돌을 걷고, 글자 규칙을 한 곳에 모으고, 나머지를 '그리지 말 것' 지시로
  // 감싼다(기본 off, 로컬 EXTRA로만). 원문 상수와 꺼진 잡의 프롬프트는 그대로다
  brief: false,
  // R1 빛·색온도 정본 — 컷 본문의 광원·빛 방향·색온도를 스타일 헌장 한 곳으로 모으고 컷별로는 대비·밝기만 남긴다.
  // 설계 예시의 빛 문구도 같은 스위치로 바꾼다(기본 off, 로컬 EXTRA로만, Track I)
  light: false,
  // R2 세트 기술·장면 컷 — 헌장 setDesc를 결정론 세트(바닥·벽·창·소품)로 채우고, 장면 컷은 단색 바탕 대신 세트, 상품 없는 장면 컷은
  // 히어로를 빛·색 참조로 받는다. 피처 bgSub 바탕 줄은 뺀다(기본 off, 로컬 EXTRA로만, Track I)
  scene: false,
  // D2 이미지 묶음(아트 디렉션 기록·POINT 장 수=특징 수·빈 분위기 컷 빼기 …) — 디자인 컷 잡에서만 동작한다(K4 전 기본 off·
  // R<n>-D2 짝 회차로 잼 — 지금은 K4 운영 전환으로 기본 on, K4_SWITCHED_ON). designcut 없이 켜지면 기록하지 않는다
  designcut2: true,
  // R3 촬영 계획 — 역할 의도·금지 한 줄, 페이지 순서 거리·앵글 계획(같은 값 연속 금지), 잡 단위 출연(인물·옷 톤·반려동물·소품)을
  // 헌장 한 줄로 고정한다(기본 off, 로컬 EXTRA로만, Track I — 하네스 V 갈래가 light·scene과 함께 켠다). shots 연출 블록에 붙는다
  shotplan: false,
  // 디자인 컷 렌더 v2(D 렌더 묶음 C3 배경·C5 타이포·C6 상자, PDP-DR-PLAN §1) — designcut 잡의 계획에 layout 2를 남겨 편집기가 새 렌더로
  // 그린다(K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on). designcut이 꺼진 잡에는 아무 일도 하지 않는다. 기존 잡은 capture --designcut-layout 2로 잰다
  designlayout: true,
  // 카피 흐름 고치기(P1-1b) — pro Stage 2 산출의 섹션 사이 반복(문구·특징·수치·제목 되풀이·마지막 띠의 첫 화면 반복)과 답 없는 고민을
  // Stage 3 '고칠 곳' 한 블록으로 넘긴다(추가 콜 없음, 기존 반복 블록 자리). K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on. 수 기록은 스위치와 무관
  flow: true,
  // 카피 리듬(오너 지시 10-31) — 제목·후킹은 한 줄 12~16자 안팎의 짧은 문장, 두 줄이면 의미 단위 줄바꿈, 본문은 한 문장 한 정보·2~3문장,
  // 섹션마다 알려 줄 한 가지. pro Stage 2 쓰기 지시 + Stage 3 고칠 곳(추가 콜 없음). K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on. 수 기록은 스위치와 무관
  rhythm: true,
  // 디자인 컷 긴 페이지(오너 지시 2026-10-31 '긴 버전의 디자인 상세페이지로 승부') — 사진이 아니라 정보를 늘린다: 소재·원산지·크기·구성·
  // 관리·구매 전 질문 표(사실이 있을 때만)와 이미지 쪽이 고른 추가 컷(자세히 보기). K4 전 기본 off(R10) — 지금은 K4 운영 전환으로 기본 on. designcut 없이 켜지면 기록 안 함
  designlong: true,
  // 컷 목적 다양화(오너 지시 10-31 '비슷한 구도 반복') — POINT·추가 컷마다 다른 목적(밑면·질감·크기·손 동작·앵글), 추가 컷은 POINT가 안 쓴
  // 목적만 근거가 있을 때, 상품 컷 구도 지문(dHash)으로 거의 같은 구도면 다른 각도 1회. K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on, designcut 잡만
  shotdiv: true,
  // D2 아트 디렉션 v2(오너 지시 10-31, PALETTE2.md) — 아동·어린이집·답례 대상 잡은 밝은 고채도 팔레트(띠·배지·카드·강조만, 사진은 그대로)·
  // 둥근 제목·스티커 배지·짙은 전환 면 없음, 모든 palette2 잡은 첫 화면 제목을 키우고 줄 간격을 넓힌다. D2 아트 디렉션(designcut2)·
  // 렌더 v2(designlayout)와 함께만 기록한다(K4 전 기본 off·R10 켬/끔 짝 — 지금은 K4 운영 전환으로 기본 on)
  palette2: true,
  // 글꼴 짝(디자인 폰트 계획 ①) — 아동·답례는 둥근 주아, 뷰티·패션·선물세트는 명조 함렛, 그 밖은 굵은 고딕 SUIT를 디자인 컷 제목에,
  // 본문·표·캡션은 Pretendard. palette2와 같은 범위(designcut2·designlayout과 함께)에서만 기록한다(K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on)
  fontpair: true,
  // 후기 속 실제 질문 — 구매 전 질문 표(designlong)의 앞줄이라 designlong과 함께만 기록한다(K4 전 기본 off — 지금은 K4 운영 전환으로 기본 on)
  reviewfaq: true,
  // 상품 컷 부품 수 규칙(parts-rule.ts) — K4 전에는 끔·켬 측정 전이라 기본 off였고, 지금은 K4 운영 전환으로 기본 on
  partsrule: true,
  // 식별 카드 전 사진(buildIdentityCardAllPhotosPrompt) — 인쇄물이 아닌 상품도 원천 사진을 함께 읽는다. K4 전에는 시험 전이라 기본 off였고, 지금은 K4 운영 전환으로 기본 on
  idcardall: true,
  // 첫 화면 사진 유형(hero-kind.ts) — 실사용·착용·스튜디오를 상품에 맞게 고른다. 시험 전이라 기본 off, 로컬 EXTRA로만 켠다
  herotype: false,
  // 사이즈 단독 컷(size-cut.ts) — 제품 하나를 입력 비율대로 만들고 제품 경계에 치수선을 긋는다. 시험 전이라 기본 off, 로컬 EXTRA로만 켠다
  sizecut: false,
  // 채움 재설계(shot-diversity planFillActs) — 사진 막 2개 + 큰 POINT 사진 한 장씩. 20섹션 채움을 대신한다. 시험 전이라 기본 off, 로컬 EXTRA로만 켠다
  fillacts: false,
  // 고민 컷(designcut-plan problemcutEnabled) — T2에 고민 사진을 되살리고 해결 컷에서 얼굴·표정을 뺀다. 시험 전이라 기본 off, 로컬 EXTRA로만 켠다
  problemcut: false,
  // 첫 화면 글 줄이기(copy-hook-short.ts) — 큰 제목 2줄 + 보조 한 줄. 디자인 컷 D2 잡만, 시험 전이라 기본 off, 로컬 EXTRA로만 켠다
  hookshort: false,
  // 템플릿 조합 라인 K(15_TEMPLATE_LINE.md) — 미리 만든 섹션 템플릿을 고르고 조합한다. 디자인 컷과 함께일 때만 기록한다.
  // K4 전 기본 off — K4 운영 전환으로 운영 기본 on(K4_SWITCHED_ON)
  templatelib: true,
  // K 장점 후보를 사실로 세기(오너 11-05 'K4에서 켬') — 분석 장점 후보 가운데 규제 거름을 지난 것을 사실 목록에 더한다. templatelib과 함께일 때만
  // 기록한다. K4 운영 전환으로 운영 기본 on — 장점 후보는 분석 모델 추정값이라 오너 병합 전 확인 항목이다(PR 본문)
  uspfacts: true,
  // K 장점 후보 근거 대조(결정 카드 c11, 하네스 J22 — 가정 C3 'USP 근거는 사실 감사 결과') — 카피 뒤 사실 감사(새 배치 + newstages 잡)가 '근거 없음'으로 본
  // 주장과 글이 크게 겹치는 장점 후보를 K 사실 목록에서 빼고 뺀 수만 계획(templatelib.uspAudit)에 남긴다. uspfacts와 함께일 때만 기록한다.
  // 사실 목록·예산이 바뀌므로 기본 off(I1-1, 로컬은 EXTRA로만). 꺼진 잡은 사실 목록·계획이 바이트까지 같다
  uspaudit: false,
  // 움직이는 칸(오너 2026-11-05 22:45 GIF 칸, 11-06 21:57 '최상단 gif 1개 필수 + 담당 AI가 고른 자리'). K 라인 위의 하위 갈래다 — templatelib과 함께일 때만
  // 기록한다. 오너 2026-11-06 23:2x 'GPT GIF로 사용 승인'(엔진 블라인드 뒤)으로 K4 운영 기본값에 넣는다(K4_SWITCHED_ON). 엔진은 2.6 GIF 시트 고정.
  // 꺼진 잡은 섹션·컷·내보내기가 그대로다
  motionband: false,
  // K가 읽는 기획 1장(결정 카드 c10, 하네스 J28 — 오너 11-07 승인 카드 '리서치 → K 앞 기획 1장', 통합 11-10 decide 2) — 새 단계 기획(research_result.page_plan)이
  // 끝난 K 잡만 섹션 구성 콜에 설득 순서를, 칸 카피 콜에 약속·고객·첫 화면 약속과 섹션마다 할 말을 싣는다. designcut·templatelib과 함께일 때만 기록한다.
  // 구성·칸 글이 바뀌므로 기본 off(I1-1, 확인 판 J32 켬 갈래 뒤 켬 — 로컬은 EXTRA로만). 기획이 없는 잡·꺼진 잡은 프롬프트가 바이트까지 같다
  pageplan: false,
  // K 칸 카피가 읽는 D 원문 카피(하네스 J36 → J28, 통합 11-10 decide 3 — 오너 05:2x '칸 글이 너무 축약된 것은 아닌지') — 켜진 K 잡만 칸 카피 콜에 섹션마다
  // 원문 카피 줄(브랜드·후기 인용·비교·사실 근거·원산지 줄 뺌)을 싣고 이야기·말투를 칸 상한 안에서 옮기게 한다. designcut·templatelib과 함께일 때만 기록한다.
  // 칸 글이 바뀌므로 기본 off(I1-1, 확인 판 J32 켬 갈래 뒤 켬 — 로컬은 EXTRA로만). 꺼진 잡은 칸 카피 프롬프트가 바이트까지 같다
  copystory: false,
  // K 컷 거리·높이·사람 박자(오너 2026-11-06 ④ 블라인드 메모 — '비슷한 각도·비슷한 장면', '똑같은 얼굴 표정'). templatelib과 함께일 때만 기록한다.
  // 오너 2026-11-06 20:46 승인(K6 블라인드 3승 0패)으로 K4 운영 기본값에 넣는다(K4_SWITCHED_ON). 꺼진 잡은 계획·컷 프롬프트가 바이트까지 같다
  shotvary: true,
  // K 첫 화면 안 B '3박자'(결정 카드 c19, 하네스 J24 — 오너 11-07 승인 카드 원문, 인터뷰 I5-3 '정원부터 스위치로') — 켜진 K 잡만 근거 hook_beats를 세워
  // 약속 한 줄·움직이는 정사각 대표·증거 띠·해결 한 줄 첫 화면 템플릿(hook_3step.garden-beats)을 후보에 더한다. designcut·templatelib과 함께일 때만 기록한다.
  // 첫 화면이 바뀌므로 기본 off(I1-1, 확인 판 J32 뒤 켬 — 로컬은 EXTRA로만). 꺼진 잡은 후보·선택·칸 카피·렌더가 바이트까지 같다
  hookbeats: false,
  // K 사진 아닌 정보 칸(오너 2026-11-06 ④ P07 '차트·그래프·픽토그램') — 입력 근거가 있는 사실 타일·사용 순서 도식·구성 도식만 후보에 더한다.
  // templatelib과 함께일 때만 기록한다. 오너 2026-11-06 20:46 승인으로 K4 운영 기본값에 넣는다(K4_SWITCHED_ON). 꺼진 잡은 선택·컷·렌더가 바이트까지 같다
  infocells: true,
  // K spec 정본 고정(결정 카드 c27, 하네스 J23 — 가정 C5 'K 옵션 칩 원천 = spec 정본') — 켜진 K 잡은 등록 옵션 구조(변형 2개 이상)가 없을 때 옵션 칩을
  // 카피 칸 대신 판매자 입력(optionSpec 변형 이름 → colorOptions)에서 이름만으로 받고, 칸 카피에 크기·소재·옵션 수 고정 값 줄, 등록 옵션 구조가 없는
  // 잡의 메인 카피에 옵션 수 한 줄을 넣는다. K 옵션 칸 표시·선택이 바뀌므로 기본 off(I1-1, 로컬은 EXTRA로만). 꺼진 잡은 칩·프롬프트가 바이트까지 같다
  specfixed: false,
  // K 색 조합 비전 고르기(결정 카드 c28, 하네스 J26 — 가정 B5) — 규칙이 고른 컨셉의 사진 색 순서 앞 3개 조합 견본과 원본 사진을 비전 모델(design/palette-pick)에
  // 보여 하나를 고른다. 실패하면 지금 규칙 색이고, 고른 방식·후보·이유는 templatelib.palette.pick에 남는다. templatelib과 함께일 때만 기록한다.
  // 새 콜·색이 바뀌므로 기본 off(I1-1, 켜기는 블라인드 뒤 — 로컬은 EXTRA로만). 꺼진 잡은 콜 0·색·계획 기록이 바이트까지 같다
  palettepick: false,
  // 새 단계 5개(하네스 R10 — 기획·사실 감사·연출 감독·첫 화면 심사·최종 검수, pdp-new-stages-stage). 새 배치(model_batch 'new') 잡에서만
  // 돈다(새 단계 route는 새 배치 표에만 있다). 이 표는 off 그대로(로컬은 EXTRA로만) — 운영 새 배치 잡은 NEW_BATCH_HOSTED_DEFAULT_ON이 켠다
  // (오너 2026-11-09 13:2x, R11d). 꺼진 잡은 단계·프롬프트·기록이 바이트까지 같다
  newstages: false,
  // 설계 ① 건너뛰기(결정 카드 c10·c24, 하네스 J07 — 오너 I1-2·I2-1 '설계 ① 쓴 것과 안 쓴 것을 카피만 비교'). 켜진 잡은 섹션 설계 콜(planPdpSections)을
  // 부르지 않고 결정론 기본 계획을 쓴다 — 골격(applyDesignSkeleton)이 섹션·순서를 그대로 정한다. K 라인(templatelib) 잡에서만 기록한다.
  // 기본 off(I1-1 스위치 뒤 기본 꺼짐, 로컬은 EXTRA로만) — 꺼진 잡은 설계 콜·계획·기록이 바이트까지 같다
  // J08 블라인드(오너 2026-11-10 05:3x 정정, 설계 ① 있음 2승 1패) 결정 c24 = K 잡 설계 ① 유지 — 이 스위치는 켜지 않고 그대로 둔다(J28 기록)
  skipdesign1: false,
  // 이미지 지시 규칙 충돌 정리(점검 고침 4·결정 카드 c05, 하네스 J10, rule-priority.ts) — 위를 이긴다 블록을 순위 하나로, 닫힌 상태↔사용·상태 컷,
  // 글 없는 목적, 조명 한 갈래, 원형 틀 문구. 효과 측정 전이라 기본 off(I1-1 스위치 뒤 기본 꺼짐, 로컬은 EXTRA로만). 꺼진 잡은 컷 프롬프트가 바이트까지 같다
  rulepriority: false,
  // 쓰는 법 재료(결정 카드 c02, 하네스 J18 — 가정 A2). 켜진 잡은 식별 카드에 USE 줄(쥐는 곳·작동면·착용 위치)을 함께 묻고 카드와 따로
  // 둔다(design_prompts.identity_use). 손·착용·사용 컷의 Use 재료는 USE 줄·사용 순서 입력(없으면 카피 howTo)만 쓰고 카드 문장은 쓰지 않으며,
  // 사용·착용 대표 컷(과 대표 움직이는 칸)도 Use 줄을 받는다. 지금·새 배치 같이. K 라인(templatelib) 잡에서만 기록한다(useCut이 K 컷에만 있다).
  // J34 켜기(오너 위임 I6-2, 통합 decide 15·17 — 확인 판 J32 P06 켬이 거꾸로 쥔 사용 컷 3컷을 빼고 이김, usegate와 한 쌍) 기본 on.
  // 로컬 대조군은 SKIP에 이 이름을 적는다(K4_SWITCHED_ON)
  usefacts: true,
  // 후킹 약속 ↔ 대표 컷 한 묶음(결정 카드 c09, 하네스 J21) — 켜진 K 잡은 칸 카피 입력에 대표 컷 유형(lineHeroKindOf)을 넣어 첫 화면 글이 그 사진과 같은
  // 약속을 하게 하고, 첫 화면 headline을 계획(templatelib.hero.hook)에 남겨 대표 컷 지시에 '글로 그리지 않는 참고'로 넘긴다. K 라인 잡에서만 기록한다.
  // 대표 컷이 바뀌므로 기본 off(I1-1, 가정 C2 — 확인 판 뒤 켬, 로컬은 EXTRA로만). 꺼진 잡은 칸 카피 프롬프트·계획·컷 지시가 바이트까지 같다
  hookhero: false,
  // 원천 사진 역할(결정 카드 c12, 하네스 J20 — 가정 A4). 켜진 잡은 폼이 고른 사진 역할(spec_sheet.sourcePhotoRoles)을 읽는다 — 설명 그림은
  // 생성 원천에서 빼 기록만 하고, 옵션 사진은 식별 카드 콜에 역할 한 줄. 역할을 안 고른 잡은 켜져도 지금과 같다. D·K 모두(원천 사진은 공통).
  // 기본 off(I1-1, 로컬은 EXTRA로만) — 꺼진 잡은 역할이 있어도 원천·식별 카드 콜·기록이 바이트까지 같다
  photoroles: false,
  // 직접 해 보는 시연 칸(하네스 J57, 통합 decide 35·37 — 오너 11-11 00:5x '실제 시험 사진 칸' + 원문 "AI로 그려도 된다. 오히려 AI를 더 잘 활용해야 한다").
  // 켜진 K 잡은 근거 demo를 세워 비교 섹션을 구성에 넣고 시연 칸 하나를 그 섹션 후보로 둔다 — 판매자 시험 사진(원천 사진 역할 demo)이 있으면
  // 그 사진 주소 그대로(compare.demo-photo, 컷 0), 없으면 상품 사실로 그린 AI 시연 컷(compare.demo-try, 컷 목적 demo — 사진 속 숫자·그래프·인증·
  // '테스트 완료' 글 금지). 시험 사진은 생성 원천에서 뺀다. 칸 글은 J50 사전(claimRisk effect). templatelib과 함께일 때만 기록한다.
  // 구성·컷이 바뀌므로 기본 off(I1-1, 로컬은 EXTRA로만, 확인 판 뒤 켬). 꺼진 잡은 구성·후보·컷 지시·원천이 바이트까지 같다
  demoshot: false,
  // 게이트 기대 쓰는 법·사용 미달 끝 처리(결정 카드 c08, 하네스 J19 — 가정 A3). 켜진 K 잡의 사용 판정 컷(useGate — 사람·손 사용 구도와
  // 실사용 대표 컷)만: ① use_correct 기준에 'Expected use' 한 줄(식별 카드 USE 줄 design_prompts.identity_use — usefacts 잡에만 있다)
  // ② 재판정 뒤 나은 컷 순위에 사용 맞음 ③ 재생성 뒤 다시 판정(대표·착용 컷과 같게) ④ 끝까지 사용 미달이면 대표 아닌 컷은 빼고 대표 컷은 경고.
  // J34 켜기(오너 위임 I6-2, 통합 decide 15·17 — usefacts와 한 쌍, 뺀 컷 뒤 칸 정리 J44 #1088 병합 뒤, 재캡처 빈 칸 0) 기본 on.
  // 로컬 대조군은 SKIP에 이 이름을 적는다(K4_SWITCHED_ON)
  usegate: true,
  // 경쟁 장치 템플릿(하네스 J54, 통합 decide 32 — J52 대조표 ②-2·②-4: 쿠팡 경쟁 가위 01~06 구성 번호·골프티 옵션 이름 + 색 띠).
  // 켜진 K 잡은 ① 구성품 입력이 3개 이상이면 컨셉과 상관없이 번호 구성 템플릿(parts.items 목록 + 번호 원)을 그 섹션 후보 앞자리에 둔다.
  // 기본 off(I1-1, 로컬은 EXTRA로만). K 라인(templatelib) 잡에서만 기록한다. 꺼진 잡은 후보·선택·기록이 바이트까지 같다
  partsbands: false,
  // D 카피 재생성 걸린 섹션 1콜(결정 카드 c14 L, 하네스 J27 — I4-4). 켜진 잡은 카피 단계의 재생성 5곳(연령·학부모 시점·숫자·경쟁사 재현·코퍼스
  // 유사도)이 카피 전체(Stage 1~3, 3콜)를 다시 돌지 않고 걸린 최상위 섹션만 1콜로 다시 쓴다(copy-section-regen). 받기는 섹션마다 — 그 섹션의 대상
  // 위반이 줄고 연령·아이 사용·숫자 가드가 늘지 않을 때만 바꾸고, 걸리지 않은 섹션은 바이트 그대로다. D·K 모두(카피 단계는 공통).
  // 기본 off(I1-1, 로컬은 EXTRA로만) — 꺼진 잡은 재생성 콜·카피·기록이 바이트까지 같다
  regenslot: false,
  // 체감 결과 한 장면(하네스 J53, 통합 decide 32 — 오너 11-11 00:0x '이미지를 생성할 때도 이런 표현이 잘 반영되고'). 켜진 K 잡만 ① 기능·사용 컷(feature_proof·action)
  // 컷 지시 Purpose 줄 끝에 '칸 글이 체감 결과를 말하면 사용 직후 한 장면으로(숫자·분할 전후 없이)' 한 문장 ② 움직이는 칸 고르기 프롬프트의 use 설명에
  // 효과가 보이는 사용 동작 + use를 assemble·transform보다 먼저. templatelib과 함께일 때만 기록한다. 컷 지시·고르기가 바뀌므로 기본 off(I1-1, 로컬은
  // EXTRA로만, 확인 판 뒤 켬). 꺼진 잡은 컷 지시·고르기 프롬프트가 바이트까지 같다.
  // J65 켜기(통합 decide 41·42 — 확인 판 J59 블라인드에서 체감 장면·움직이는 칸 두 질문을 모두 이김, 샤워 nsfw는 J60 #1127로 운영 반영) 기본 on.
  // 로컬 대조군은 SKIP에 이 이름을 적는다(K4_SWITCHED_ON)
  effectshot: true,
  // 고민 실물 컷(하네스 J56, 통합 decide 35 — 오너 11-11 00:5x '고민 실물 컷 스위치 뒤로 만들어 확인'). 켜진 K 잡의 고민 섹션(problem_empathy·problem_raise)
  // problem 컷만 기본 고민 프롬프트의 얼굴 줄·SCENE FOCUS 가드를 빼고 컷 지시 Purpose를 상표 없는 낡은·닳은 일반 물건 근접 문장으로 바꾼다(우리 상품·
  // 실제 브랜드·고통 표정·혐오 금지, 색·형태 다르게). 비교 왼쪽 칸은 그대로, 게이트는 J49 상품 없는 컷 그대로(글자·브랜드만). templatelib과 함께일 때만
  // 기록한다. 컷이 바뀌므로 기본 off(I1-1, 로컬은 EXTRA로만, 확인 판 뒤 켬). 꺼진 잡은 컷 지시·프롬프트가 바이트까지 같다
  problemobject: false,
  // 보여 줄 동작·설계(하네스 J63, 통합 decide 42 — 오너 J59 메모 '"두피를 문지르는 모습", "적당한 탄성 마사지 설계" 같은 표현은 이미지나 움직이는 이미지로
  // 직접 보여 줘야 하는데 약하다'). 켜진 K 잡만 칸 글에서 낱말표로 동작·설계 하나를 고르고(상품 사실에 같은 줄기가 있을 때만, LLM 없음 — show-beat.ts)
  // ① 섹션마다 손·사용 컷 하나의 Purpose 끝에 그 장면 한 문장 + 그 컷 Person 단계를 쓰는 중으로 ② 움직이는 칸 동작을 그 문구로(보일 만한 크기 한 줄)
  // ③ 움직이는 칸 고르기 후보 줄에 보여 줄 동작. templatelib과 함께일 때만 기록한다. 컷 지시가 바뀌므로 기본 off(I1-1, 로컬은 EXTRA로만, 확인 판 뒤 켬).
  // 꺼진 잡은 컷 지시·움직이는 칸·고르기 프롬프트가 바이트까지 같다.
  // 사실 출처는 spec 칸 → 식별 카드 USE 줄 → 카피 howTo(J66 #1140). J69 켜기(통합 decide 44 — J66 컷 확인 6짝: 더 보임 1·같음 5·덜 보임 0·부작용 0,
  // MS 2k 길이 가드 있음) 기본 on. 로컬 대조군은 SKIP에 이 이름을 적는다(K4_SWITCHED_ON)
  showbeat: true,
  // 움직이는 칸을 GPT 구독 시트로(AX-CT-35, 오너 X-189 2026-11-20 '구독 길을 꺼진 채 만듦') — 켜진 잡만 움직이는 칸 엔진이 codex-sheet
  // (구독 이미지 3×3 시트 한 장 → 앱이 9칸으로 자름, motion/codex-sheet.ts)다. motionband와 함께일 때만 기록한다. 기본 off, 로컬 EXTRA로만
  // (운영 표지는 EXTRA를 무시해 운영에서 켤 길이 없다). 켜기는 같은 상품으로 API 판·구독 판을 나란히 보여 드린 뒤 따로 여쭌다.
  // 꺼진 잡은 움직이는 칸 호출·프레임이 바이트까지 같다(지금처럼 2.6 GIF)
  motioncodex: false,
}

/**
 * K4 운영 전환(14개)과 그 뒤 오너 승인(K6 뒤 shotvary·infocells, GIF 칸 motionband)·오너 위임(I6-2, J34 usefacts·usegate·J65 effectshot·J69 showbeat)으로 기본 on이 된 기능 21개(그 전 기본 off)
 * — 되돌리기 PR은 이 이름을 다시 false로 두면 되고, 로컬 R 대조군은
 * NEXOPS_PDP_ENRICHMENT_SKIP에 이 이름을 모두 적는다(Vercel은 SKIP을 무시한다). 시험이 기본값 표와 맞는지 본다
 */
export const K4_SWITCHED_ON: readonly EnrichmentFeature[] = [
  'designcut',
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
  // K6 확인 판 뒤 더함(오너 2026-11-06 20:46, K6 블라인드 3승 0패) — 사진 다양화·정보 칸
  'shotvary',
  'infocells',
  // 움직이는 칸(오너 2026-11-06 23:2x 'GPT GIF로 사용 승인') — 대표 칸 필수 + 계획 AI가 고른 칸(대표 포함 상한 3), 엔진 2.6 GIF 시트 고정
  // J34 켜기(오너 위임 I6-2, 통합 decide 15·17 — 확인 판 J32) — 쓰는 법 재료·사용 판정 끝 처리 한 쌍(K 라인 잡에서만 기록)
  'usefacts',
  'usegate',
  // J65 켜기(오너 위임 I6-2, 통합 decide 41·42 — 확인 판 J59) — 체감 결과 한 장면·효과 보이는 use 먼저(K 라인 잡에서만 기록)
  'effectshot',
  // J69 켜기(오너 위임 I6-2, 통합 decide 44 — J66 컷 확인 6짝) — 칸 글이 말한 동작·설계를 컷·움직이는 칸이 직접 보이기(K 라인 잡에서만 기록)
  'showbeat',
]

export interface EnrichmentRecord {
  version: 1
  features: EnrichmentFeature[]
  /** 학부모 대리 구매형 판정(parent-proxy, 켜진 잡만). readJobEnrichment는 features만 돌려주고 이 칸은 readJobAudience가 읽는다 */
  audience?: AudienceRecord
}

type EnvLike = Record<string, string | undefined>

/** Vercel 실행 환경 표지(좁은 판별) — PDP 동작 분기는 isHostedPdpEnv를 쓴다. */
export function isVercelEnv(env: EnvLike = process.env): boolean {
  return env.VERCEL === '1' || Boolean(env.VERCEL_ENV)
}

/** Railway 구독 작업자(R13, scripts/pdp-worker/worker.mts)가 켜는 표지 값 — NEXOPS_PDP_HOSTED */
export const PDP_HOSTED_WORKER = 'railway-worker'

/** K 구성·칸 카피가 앞 단계 글(기획 1장·원문 카피)을 읽는 기능 — K 라인(templatelib) 잡에서만 기록한다(J28) */
const K_COPY_READS: readonly EnrichmentFeature[] = ['pageplan', 'copystory']

/**
 * 운영 실행 표지 — Vercel 또는 Railway 구독 작업자(NEXOPS_PDP_HOSTED=railway-worker). 운영 실행은 로컬 대조군·실험 스위치(env)를
 * 무시하고 운영 값(단계 올리기 첫 값·run 기한·스위치 기본값·단계 표)을 쓴다 — 작업자와 웹은 백엔드만 다르다(R13 G6).
 */
export function isHostedPdpEnv(env: EnvLike = process.env): boolean {
  return isVercelEnv(env) || env.NEXOPS_PDP_HOSTED?.trim() === PDP_HOSTED_WORKER
}

/** 지금 실행에서 켜진 기능(환경 기준). analysis 단계만 이 값을 쓴다. */
export function resolveEnabledFeatures(env: EnvLike = process.env): EnrichmentFeature[] {
  if (env.NEXOPS_PDP_ENRICHMENT?.trim().toLowerCase() === 'off' && !isHostedPdpEnv(env)) return []
  // 기본 off 기능을 로컬에서만 더한다(비교군 arm) — 알 수 없는 이름은 무시
  const extra = isHostedPdpEnv(env)
    ? []
    : (env.NEXOPS_PDP_ENRICHMENT_EXTRA ?? '').split(',').map((s) => s.trim().toLowerCase())
  // 기본 on 기능을 로컬에서만 뺀다(같은 커밋 짝 회차 — 예: long on/off). Vercel은 무시한다
  const skip = isHostedPdpEnv(env)
    ? []
    : (env.NEXOPS_PDP_ENRICHMENT_SKIP ?? '').split(',').map((s) => s.trim().toLowerCase())
  const picked = ENRICHMENT_FEATURES.filter((f) => (ENRICHMENT_DEFAULTS[f] || extra.includes(f)) && !skip.includes(f))
  // 첫 화면 안 B(hookbeats)는 디자인 컷 위 K 라인(designcut·templatelib) 첫 화면 템플릿에서만 뜻이 있다
  const enabled = picked.includes('designcut') && picked.includes('templatelib') ? picked : picked.filter((f) => f !== 'hookbeats')
  // 섹션 나누기(split)는 디자인 컷과 함께 켜지지 않는다 — 디자인 컷 잡은 편집기가 펼치지 않아 플래너·측정만 바뀌게 된다.
  // 안 쓰는 컷 빼기(lean)도 디자인 컷 잡에는 기록하지 않는다 — 디자인 컷 계획이 자기 필터로 생성 범위를 정한다
  // 통이미지도 디자인 컷 잡에는 기록하지 않는다 — 디자인 컷 템플릿이 섹션 구성을 따로 정한다
  // 긴 상세페이지 확장 섹션도 디자인 컷 잡에는 기록하지 않는다
  // palette2는 D2 아트 디렉션 + 렌더 v2(편집기가 layout 2에서만 읽는다) 위에서만 동작한다 — designcut2·designlayout이 함께 켜질 때만 기록
  // 기획 1장·원문 카피를 K가 읽기(pageplan·copystory)는 K 구성·K 칸 카피에서만 뜻이 있다 — templatelib이 없으면 빠진다
  const byTrack: EnrichmentFeature[] = enabled.includes('designcut')
    ? enabled.filter((f) => f !== 'split' && f !== 'lean' && f !== 'fullimage' && f !== 'long' && (enabled.includes('templatelib') || !K_COPY_READS.includes(f)))
    : enabled.filter((f) => f !== 'designcut2' && f !== 'designlong' && f !== 'shotdiv' && f !== 'templatelib' && f !== 'hookshort' && !K_COPY_READS.includes(f))
  // 장점 후보를 사실로 세기는 K 라인 사실 예산에서만 뜻이 있다
  // GIF 칸(motionband)도 K 섹션(motion_band)에서만 뜻이 있다. K 컷 거리·사람 박자(shotvary)·정보 칸(infocells)도 K 계획에서만 뜻이 있다
  // 설계 ① 건너뛰기(skipdesign1)도 골격이 섹션을 정하는 K 라인에서만 뜻이 있다. 쓰는 법 재료(usefacts)도 Use 줄을 받는 K 컷에서만 뜻이 있다
  // 후킹 약속 ↔ 대표 컷(hookhero)도 K 칸 카피·K 대표 컷에서만 뜻이 있다. 사용 판정 끝 처리(usegate)도 사용 판정(useGate)이 붙는 K 컷에서만 뜻이 있다
  // 체감 결과 한 장면(effectshot)도 K 컷 지시·K 움직이는 칸 고르기에서만 뜻이 있다. 고민 실물 컷(problemobject)도 K 고민 컷 지시에서만 뜻이 있다
  // 보여 줄 동작·설계(showbeat)도 K 컷 지시·K 움직이는 칸에서만 뜻이 있다
  const kScoped = byTrack.includes('templatelib')
    ? byTrack
    : byTrack.filter(
        (f) =>
          f !== 'uspfacts' && f !== 'motionband' && f !== 'shotvary' && f !== 'infocells' && f !== 'skipdesign1' && f !== 'usefacts' && f !== 'hookhero' &&
          f !== 'usegate' && f !== 'effectshot' && f !== 'problemobject' && f !== 'showbeat'
      )
  const longScoped = kScoped.includes('designlong') ? kScoped : kScoped.filter((f) => f !== 'reviewfaq')
  // 색 조합 비전 고르기(palettepick)도 K 라인 색(select-line)에서만 뜻이 있다
  // 경쟁 장치 템플릿(partsbands, J54)도 K 선택·K 옵션 칸에서만 뜻이 있다
  const paletteScoped = longScoped.includes('templatelib') ? longScoped : longScoped.filter((f) => f !== 'palettepick' && f !== 'partsbands')
  // 첫 화면 글 줄이기는 D2 첫 화면(heroText)에서만 뜻이 있다. spec 정본 고정(specfixed)은 K 옵션 칩·K 칸 카피에서만 뜻이 있다
  // 시연 칸(demoshot, J57)도 K 구성·K 컷에서만 뜻이 있다
  const scoped = (paletteScoped.includes('designcut2') ? paletteScoped : paletteScoped.filter((f) => f !== 'hookshort')).filter(
    (f) => (f !== 'specfixed' && f !== 'demoshot') || longScoped.includes('templatelib')
  )
  // palette2·fontpair는 D2 아트 디렉션 + 렌더 v2 위에서만 동작한다
  const artScoped =
    scoped.includes('designcut2') && scoped.includes('designlayout') ? scoped : scoped.filter((f) => f !== 'palette2' && f !== 'fontpair')
  // 장점 후보 근거 대조(uspaudit)는 장점 후보를 사실로 세는 K 잡(uspfacts — templatelib과 함께일 때만 남는다)에서만 뜻이 있다
  const auditScoped = artScoped.includes('uspfacts') ? artScoped : artScoped.filter((f) => f !== 'uspaudit')
  // 구독 시트 엔진(motioncodex)은 움직이는 칸(motionband — templatelib과 함께일 때만 남는다)이 있을 때만 뜻이 있다
  return auditScoped.includes('motionband') ? auditScoped : auditScoped.filter((f) => f !== 'motioncodex')
}

/**
 * 운영 새 배치 잡에서만 기본 on인 기능(하네스 R11d — 오너 2026-11-09 13:2x '켜기 + P09 확인 재현 (권장)', R11 2차 블라인드 새 배치+새 단계
 * 3승 0패). 기본값 표(ENRICHMENT_DEFAULTS)는 그대로 off라 지금 배치 잡·로컬 하네스(K<n>-N은 env 없이 꺼짐, K<n>-NS는 EXTRA로 켬)는 바뀌지 않는다.
 * 끄는 길: 운영 env NEXOPS_PDP_NEWSTAGES_DEFAULT=off를 넣고 다시 배포(Vercel·작업자 둘 다) 하거나, 이 표를 비우는 되돌리기 PR. 이미 만든 잡은
 * analysis.enrichment 기록대로 남는다
 */
export const NEW_BATCH_HOSTED_DEFAULT_ON: readonly EnrichmentFeature[] = ['newstages']

/**
 * 분석 단계 기능 목록에 운영 새 배치 기본값을 더한다 — 운영 실행(isHostedPdpEnv)이고 잡이 새 배치(model_batch 'new')일 때만, 순서는
 * ENRICHMENT_FEATURES 순. 그 밖(지금 배치·배치 키 없는 잡·로컬 실행·off env)은 받은 목록을 그대로 돌려준다
 */
export function withNewBatchHostedDefaults(
  features: readonly EnrichmentFeature[],
  modelBatch: PdpModelBatch | undefined,
  env: EnvLike = process.env
): EnrichmentFeature[] {
  if (!isHostedPdpEnv(env) || modelBatch !== 'new') return [...features]
  if (env.NEXOPS_PDP_NEWSTAGES_DEFAULT?.trim().toLowerCase() === 'off') return [...features]
  return ENRICHMENT_FEATURES.filter((f) => features.includes(f) || NEW_BATCH_HOSTED_DEFAULT_ON.includes(f))
}

/** 잡에 남길 기록 — 켜진 기능이 없으면 null(기록하지 않음). */
export function buildEnrichmentRecord(features: readonly EnrichmentFeature[]): EnrichmentRecord | null {
  const valid = ENRICHMENT_FEATURES.filter((f) => features.includes(f))
  return valid.length > 0 ? { version: 1, features: valid } : null
}

/** analysis.enrichment 읽기 — 형식이 맞지 않으면 null(기존 동작). */
export function readJobEnrichment(analysis: unknown): EnrichmentRecord | null {
  if (!analysis || typeof analysis !== 'object') return null
  const raw = (analysis as { enrichment?: unknown }).enrichment
  if (!raw || typeof raw !== 'object') return null
  const { version, features } = raw as { version?: unknown; features?: unknown }
  if (version !== 1 || !Array.isArray(features)) return null
  const valid = ENRICHMENT_FEATURES.filter((f) => features.includes(f))
  return { version: 1, features: valid }
}

export function hasEnrichmentFeature(analysis: unknown, feature: EnrichmentFeature): boolean {
  return readJobEnrichment(analysis)?.features.includes(feature) ?? false
}

/**
 * research·copy·design 프롬프트 직렬화용 analysis — 잡 단위 기록(enrichment)과 경쟁사 불만 요약(competitor_pain_points,
 * 리서치 덧붙임 블록으로만 넘긴다 — pdp-review-input), 카테고리 판정 기록(category_check, J22 — 기록만) 키를 뺀다. 셋 다 없으면 같은 객체를 돌려준다.
 */
export function analysisForPrompt<T extends object>(analysis: T): T {
  if (!('enrichment' in analysis) && !('competitor_pain_points' in analysis) && !('category_check' in analysis)) return analysis
  const {
    enrichment: _enrichment,
    competitor_pain_points: _competitor,
    category_check: _categoryCheck,
    ...rest
  } = analysis as T & { enrichment?: unknown; competitor_pain_points?: unknown; category_check?: unknown }
  return rest as T
}
