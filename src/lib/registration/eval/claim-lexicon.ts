/**
 * 근거 없는 주장 자동 검사 (T7b, docs/plans/pdp-enrichment/04_TEST_PROGRAM.md §3 감점) — 효능·안전·인증·친환경 4종.
 * 2026-10-30부터 점수 검사는 아래 규제 묶음(findRegulatedClaims)을 쓴다. 4종 사전(claimTermsIn)은 점수표의 근거 면제 대조(인증 주체·친환경 인증)에만 쓴다.
 *
 * 1건당 −10점이라 오탐이 비싸다. 그래서 단독으로도 주장이 되는 강한 표현만 넣는다('안전'·'피부'·'환경' 같은 낱말 단독은 넣지 않는다).
 * 같은 문장 안에서 표현 뒤에 부정·고지 표현('아닙니다', '않습니다', '하지 마세요' 등)이 오거나 앞에 고지형 연결('아니며')이 있으면 세지 않는다.
 * 기존 BANNED_EXPRESSIONS(pdp-copy-prompts — 과장 수식어·판매자 용어)는 이 감점 대상이 아니라서 함께 쓰지 않는다.
 * 같은 낱말이 여러 곳에 나오면 1건, 한 문구 안의 같은 종류 낱말도 1건으로 묶는다(심사위원이 문장 단위로 지적하는 것과 맞춘다).
 * 근거 면제는 표현 단위다: spec.certificationInfo에 그 표현(인증이면 인증 주체 KC·FDA 등)이 있을 때만 면제한다.
 */

export const CLAIM_KINDS = ['efficacy', 'safety', 'certification', 'eco'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

const CERT_BODY = 'kc|fda|ce|iso|ks|haccp|식약처'

/**
 * 신체 효과 표현(R2, 2026-10-28 — R1 P03 두피 브러시에서 심사위원만 잡은 효능 4건 중 3건, R0 P03 코덱스 1건).
 * '자극'·'마사지'·'시원'·'뭉침' 같은 일반어는 단독으로 세지 않는다 — 신체 부위와 결과가 함께 올 때만 센다.
 * 기존 효능 표현과 따로 찾는다(같은 문장의 '노폐물 제거'·'살균'을 삼키지 않게). 찾은 표현(문구 일부)이 묶음 단위다:
 * 문장이 다르면 따로 센다(기존 합산 규칙 그대로).
 */
/** 몸 자체 부위 — 상태 변화(진정·개선·강화)와 '~해지' 느낌 변화는 여기만 센다('어깨 강화 봉제'·'발바닥이 편안해지는 쿠션'은 옷·물건의 부위) */
const CORE_BODY = '두피|피부|모공|모근|머릿결|모발|얼굴|근육'
/** 불편 낱말이 바로 붙는 부위('어깨결림') — 불편 낱말 앞 경계(WORD_START)에 쓴다 */
const BODY = `${CORE_BODY}|어깨|목덜미|허리|종아리|발바닥|발목`
/** 뭉침·결림 같은 근육 불편과 함께 쓰는 부위 — 모발·머릿결은 뺀다('뭉친 모발을 풀어주는 빗'은 엉킴) */
const MUSCLE_BODY = '근육|어깨|목덜미|허리|종아리|발바닥|발목|두피|목|몸'
/** 부위 낱말 끝 — 띄어쓰기·조사·'뭉' 앞에서만 끝난 것으로 본다('목걸이'의 '목'은 부위가 아니다) */
const PART_END = '(?=\\s|을|를|이|가|의|도|은|는|뭉)'
/** 개운은 그 자체가 몸의 느낌이다 — 부위와 12자 안이면 센다("두피를 자극해 개운한") */
const REFRESHED = '개운(?:해지|해져|해요|하게|하다|한|함|해)?'
/** '~해지다' 느낌 변화 — 몸 자체 부위 바로 뒤(조사만)일 때만('시원한 소재'·'피부에 닿아도 편안해지는 소재'는 세지 않는다) */
const FEEL_CHANGE = '(?:시원|상쾌|가뿐|편안)해지|가벼워지'
/** 느낌 변화를 세는 부위 — 얼굴은 뺀다('얼굴이 편안해지는 마스크 스트랩'은 착용감) */
const FEEL_BODY = '두피|피부|모공|모근|머릿결|모발|근육'
const CLINICAL = '완화|개선|회복|진정|재생|활성화|강화|튼튼|축소|줄어'
const BODY_STATE = '환경|건강|컨디션|상태|톤|결|장벽'
const DISCOMFORT = '뻐근|결림|결리|붓기|부기|통증|쑤심|저림'
const RELIEF = '덜어|덜해|풀어|풀려|풀리|해소|완화|개선|감소|줄여|줄어|빠지|빠져|날려|녹여|없애|회복|사라|가라앉|제거'
const PARTICLE = '(?:을|를|이|가|도|은|는)?'
const ADVERB = '(?:싹|확|쫙|말끔히|깨끗이)?'
/** 불편 낱말 앞 — 다른 낱말의 일부가 아니거나('카피로'의 '피로' 같은 것), 신체 부위가 바로 붙은 경우('어깨결림') */
const WORD_START = `(?:(?<![가-힣])|(?<=${BODY}|눈|몸|목))`
const RELIEF_TAIL = `\\S{0,2}\\s*${PARTICLE}\\s*${ADVERB}\\s*`
const BODY_EFFECT = [
  // 개운: "두피가 개운해지는", "두피를 자극해 개운한 세정감", "두피까지 개운"
  // 부위 뒤 '처럼·같이·만 한·모양'은 비유다('피부처럼 얇은 랩', '얼굴만 한 냄비')
  `(?:${CORE_BODY})(?!\\s*(?:처럼|같이|같은|만\\s*한|크기|모양))[^.!?\\n]{0,12}?${REFRESHED}`,
  // "피부가 편안해지는", "두피가 시원해지는"
  `(?:${FEEL_BODY})\\s*${PARTICLE}\\s*(?:${FEEL_CHANGE})`,
  // "두피 진정", "피부 장벽 개선", "모근 강화", "두피의 건강 개선", "모공 축소"
  `(?:${CORE_BODY})(?:\\s*의)?(?:\\s*(?:${BODY_STATE}))?\\s*(?:을|를|이|가|의)?\\s*(?:${CLINICAL})`,
  // "뻐근함을 덜어내는", "붓기가 빠지는", "통증이 사라지는"
  `${WORD_START}(?:${DISCOMFORT})${RELIEF_TAIL}(?:${RELIEF})`,
  // 뭉침은 신체 부위가 붙을 때만("어깨 뭉침을 풀어") — '털·가루·빨래 뭉침'은 세지 않는다
  `(?:${MUSCLE_BODY})${PART_END}\\s*뭉침${RELIEF_TAIL}(?:${RELIEF})`,
  // 어순이 반대인 경우: "뭉친 근육을 풀어주는", "뻐근한 어깨를 풀어"
  `(?:뭉친|뻐근한|결리는|지친)\\s*(?:${MUSCLE_BODY})${PART_END}${RELIEF_TAIL}(?:${RELIEF})`,
  // 피로: 회복·해소·풀어·날려(몸의 피로 주장)이거나 눈·몸 등이 앞에 올 때만 — "손의 피로를 줄여"(손잡이 사용감)·"스크롤 피로"는 세지 않는다
  `(?<![가-힣])(?<!손\\s?|손의\\s|손목\\s?|손목의\\s)피로${RELIEF_TAIL}(?:회복|해소|풀어|풀려|풀리|날려|녹여)`,
  `(?:(?<![가-힣])(?:눈|몸|발)|근육|어깨|다리|목덜미|허리)\\s*(?:의\\s*)?피로${RELIEF_TAIL}(?:${RELIEF})`,
  // 두피·피부 고민의 결과: "비듬 감소", "두피 가려움 해소", "두피 각질 제거"
  `(?<![가-힣])(?:비듬|가려움|여드름)${RELIEF_TAIL}(?:${RELIEF})`,
  '두피\\s*각질\\s*(?:을|를|이|가|도)?\\s*(?:제거|감소|없애|줄여|줄어)',
  // 생리 용어는 단독으로도 주장이다
  '(?<![가-힣])(?:혈행|혈류|림프|경락|신진\\s*대사|자율\\s*신경|발모|육모)',
  // "마사지 효과", 압력·자극을 원인으로 든 마사지 결과("압력을 전달해 … 마사지까지") — '저자극'·'자극 없이'·'자극적'은 세지 않는다
  '(?:마사지|지압)\\s*효과',
  // 압력·자극 뒤에는 조사나 띄어쓰기가 와야 한다('압력밥솥'은 다른 낱말)
  '(?<![가-힣])(?:압력|지압|자극)(?!\\s*없|적)(?:(?:을|를|으로|이|해|하여|하며|하면서)(?=\\s)|(?=\\s))[^.!?\\n]{0,25}?마사지\\s*(?:까지|효과|해\\s*주|해줘)',
].join('|')
const BODY_EFFECT_RE = new RegExp(BODY_EFFECT, 'gi')
const BODY_EFFECT_TERM_RE = new RegExp(`^(?:${BODY_EFFECT})$`, 'i')

/** 찾은 표현이 신체 효과 표현(R2 보강분)인가 — 점수표가 심사 지적 묶음을 보강 전과 같게 유지할 때 쓴다(scorecard mergePenalties) */
export function isBodyEffectTerm(term: string): boolean {
  return BODY_EFFECT_TERM_RE.test(term.trim())
}

export const CLAIM_PATTERNS: Record<ClaimKind, RegExp> = {
  efficacy:
    /효과\s*(보장|입증|확인|검증)|임상|의학적|치료|완치|(99(\.9+)?|100)\s*%\s*(제거|살균|항균|차단)|살균|항균|탈모\s*(방지|예방|개선|완화|감소|케어)|혈액\s*순환\S{0,2}\s*(개선|촉진|도움|돕|도와|원활|좋)|노폐물\s*(제거|배출)|디톡스|면역력/gi,
  safety:
    /무독성|무해|인체에\s*(무해|안전)|유해\s*(물질|성분)\s*(없|0|제로|zero)|100\s*%\s*안전|완벽(하게|히)?\s*안전|안전\s*(보장|검증)|피부\s*자극\s*(없|0|제로)|저자극|non[-\s]?toxic|bpa\s*(free|프리)/gi,
  certification: new RegExp(
    `(${CERT_BODY})\\s*(인증|승인|통과)|인증\\s*(완료|획득|받은)|특허\\s*(받은|기술|출원|등록|획득)|시험\\s*성적서|공인\\s*(기관|시험)`,
    'gi'
  ),
  eco: /친환경|에코\s*프렌들리|eco[-\s]?friendly|생분해|자연\s*분해|썩는\s*(소재|비닐|봉투|포장|플라스틱)|땅에서\s*썩|지구를\s*(지키|살리)|환경을\s*(지키|생각)|탄소\s*중립|무공해/gi,
}

/**
 * 규제 표현 사전(2026-10-30 오너 지시, R6 후속) — 인증·인허가·시험을 사칭하거나 근거 없이 표시하는 말(certification — 살균·항균과
 * 법이 막는 절대 안전·환경 표시 포함, 심사 규칙과 같은 범위: C 합의)과, 의약품·의료기기로
 * 오인시키는 의학적 효능·질병 예방·기능성 화장품 효능(심사 필요 — 미백·주름 개선·탈모 완화·탈모 예방·여드름 완화)·질병·증상명(medical)만 막는다.
 * 사용 경험·체감 효익('엉키지 않아요'·'두피가 시원해요'·'드라이가 빨라요'·'노폐물'·'개운'·'소독도 가능'·'변형 걱정 없음'·'도움'·'효과'·'효능' —
 * 2026-11-10 오너 '효능 문구 부활': '모공 속 노폐물까지 흡착 배출'·'묵은 각질 제거'·'세정 효능')은
 * 상세페이지 설득에 필요하므로 막지 않는다. 인용 후보 차단(review-scrubber)·카피 후기 줄·최종 카피 검출(reviews/review-claims)·자동 작성
 * 필터(pdp-auto-fill)가 이 한 사전을 쓴다. 점수 검사(page-measure)도 심사 규칙 변경과 함께 findClaims에서 findRegulatedClaims로 바꿨다(이 묶음 그대로).
 */
export const REGULATED_KINDS = ['certification', 'medical'] as const
export type RegulatedKind = (typeof REGULATED_KINDS)[number]

/**
 * 질병·증상명 단독(2026-10-31 통합 결정, R8 P07 — 심사 규칙의 '질병명') — 후기·카피에 이름만 나와도('강아지 턱드름 때문에 식기를
 * 다 바꿨는데') 질병 효능을 암시한다. 처음(#289)에는 인용·자동 작성만 막았고, 이제 카피 검출·점수(medical)도 센다. 반려동물·피부 질환을
 * 더했다. 뜻이 여럿인 말('기미' — 징조, '결석' — 빠짐)은 넣지 않거나 붙는 말과 함께만 넣고, 다른 낱말 속에 흔한 이름(두통·요통·발진·장염)은
 * 낱말 첫머리일 때만 센다. 비듬은 넣지 않는다('비듬 같은 가루도 잘 털려요'는 사용 감각 — C 합의, 인용에서만 막는다).
 * 급체(2026-11-01 통합 결정, R12 P07 심사 — OpenAPI 속성 '급체방지용'이 표에 실렸다)도 질환 표현이다. '긴급체포'·'응급체계'에 들어 있어 첫머리만
 * 센다. '천천히 먹게 도와요' 같은 사용 경험은 막지 않는다
 */
const DISEASE_NAMES = [
  '턱드름|여드름|탈모|두드러기|땀띠|모낭염|지루성|피부병|외이염|결막염|각막염|다래끼|안구\\s*건조증',
  '구내염|치주염|치은염|충치|변비|방광염|요로\\s*결석|슬개골\\s*탈구|심장\\s*사상충|근육통|생리통|관절통|수족냉증',
  '(?<![가-힣])(?:두통|요통|발진|장염|급체)',
].join('|')
const DISEASE_NAME_TERM_RE = new RegExp(`^(?:${DISEASE_NAMES})$`)

/** 찾은 표현이 질병·증상명 하나인가 — 자동 작성이 고민 서술('탈모 고민이 있는 30대' — 오너 계약 예시)을 남길 때 쓴다(pdp-auto-fill) */
export function isDiseaseNameTerm(term: string): boolean {
  return DISEASE_NAME_TERM_RE.test(term.trim())
}

export const REGULATED_CLAIM_PATTERNS: Record<RegulatedKind, RegExp> = {
  // 인증·인허가·시험: KC·식약처·FDA·특허·'인증 받은'·'임상'·'테스트 완료', 살균·항균(살생물제 승인 대상 — 사용법 '소독할 수 있는'은 아님),
  // 법이 막는 절대 안전·환경 표시(무독성·무해·100% 안전·친환경·생분해 — 인증·시험 근거 없이 쓸 수 없다). '저자극'처럼 정도를 말하는 표현은 아님
  certification: new RegExp(
    [
      '(?<![a-z])(?:kc|fda|ce|iso|ks|haccp|gmp)\\s*(?:인증|승인|허가|등록|통과|인정|신고)',
      '(?:식약처|식품의약품안전처)\\s*(?:인증|승인|허가|등록|통과|인정|신고)',
      '인증\\s*(?:완료|획득|받은|받았|받아|제품|마크)',
      '(?:인증|검증|허가)된\\s*(?:제품|성분|효과|소재)',
      '특허\\s*(?:받은|받았|기술|출원|등록|획득|제품)',
      '시험\\s*성적서|공인\\s*(?:기관|시험)',
      '임상',
      '(?:테스트|시험)\\s*(?:완료|통과|거친|거쳤|받은|마친|마쳤)',
      '(?:더마|피부과)\\s*테스트',
      '(?:의료기기|의약외품)\\s*(?:인증|허가|등록|신고)',
      '(?:99(?:\\.9+)?|100)\\s*%\\s*(?:제거|살균|항균|차단)',
      '살균|멸균|항균|항바이러스',
      '무독성|무해|인체\\s*(?:에\\s*)?(?:무해|안전)|100\\s*%\\s*안전|완벽(?:하게|히)?\\s*안전|non[-\\s]?toxic|bpa\\s*(?:free|프리)',
      '친환경|에코\\s*프렌들리|eco[-\\s]?friendly|생분해|자연\\s*분해|무공해',
      // 건강기능식품 오인(연구 A6 §6, 추정 목록·법령 원문 미확인) — 인증 정보에 같은 말이 있으면 실을 수 있다
      '건강\\s*기능\\s*식품|건기식',
    ].join('|'),
    'gi'
  ),
  // 의학·기능성: 질병명·치료·처방·의학적 효능·전문가 추천 사칭·질병 예방·신체 생리 효능, 기능성 화장품 효능
  medical: new RegExp(
    [
      // '효능' 단독은 세지 않는다(J50 — 오너 11-10 '효능 문구 부활': '세정 효능' 같은 체감 효능). '의학적 효능'은 '의학'으로 잡힌다
      '치료|완치|처방|의학|약효|부작용',
      '(?:의사|약사|한의사|전문의)\\s*(?:가\\s*)?(?:추천|권장|처방)|병원\\s*(?:추천|에서\\s*(?:추천|쓰는))',
      '아토피|습진|피부염|건선|무좀|비염|천식|당뇨|고혈압|관절염|불면증|우울증|질환|질병|염증|항염|통증|진통',
      '(?:질병|질환|감염|염증|탈모|충치|치주|감기|독감|바이러스|세균)\\s*(?:을|를)?\\s*예방|예방\\s*접종',
      '혈액\\s*순환|혈행|혈압|혈당|면역력|면역\\s*(?:강화|증진|향상)|디톡스|해독|신진\\s*대사|자율\\s*신경|림프|경락',
      '다이어트\\s*(?:효과|에\\s*(?:좋|도움))|살이\\s*빠|체지방|지방\\s*분해',
      '미백|주름\\s*(?:이|을)?\\s*(?:개선|완화|감소|예방|제거|없애|펴)',
      '탈모\\s*(?:증상\\s*)?(?:방지|예방|개선|완화|감소|케어|치료)|발모|육모',
      '여드름\\s*(?:이|을)?\\s*(?:개선|완화|진정|치료|없애|사라|줄)',
      // 두피 고민의 해소·모근 효능(C 합의) — '모근까지 시원'·'가려울 때 긁기 좋은' 같은 사용 감각은 아님
      '가려움증|가려움\\s*(?:이|을|도)?\\s*(?:줄|완화|개선|해소|사라|없어)',
      '비듬\\s*(?:이|을|도)?\\s*(?:완화|개선|감소|줄)',
      '모근\\s*(?:까지\\s*)?(?:의\\s*)?(?:건강|강화|튼튼)',
      '의료기기|의약품|의약외품',
      // 반려동물 구토가 줄었다는 말(가려움과 같은 증상 해소) — '구토 걱정 없이'·'토하는'은 아님
      '구토\\s*(?:이|가|를|을|도)?\\s*(?:줄|완화|개선|감소|사라|없어)',
      // 피부·두피 트러블이 줄었다거나 돌본다는 말(2026-11-02, R17 P03 심사위원 둘 다 r8 1) — 트러블 자체는 질병명이 아니라 소실·개선·관리와 붙을 때만 센다.
      // '트러블 없이 잘 써요'·'트러블 없어요'·'트러블이 안 생겨요'·'트러블을 줄 걱정 없이'는 사용 경험이다
      '트러블\\s*(?:이|을|를|가|도|은|는)?\\s*(?:많이|확실히|거의|다|싹|확|쫙|좀|조금|완전히?|정말|진짜|눈에\\s*띄게)?\\s*(?:줄[어었여임]|덜\\s*(?:해|하|나|생)|완화|개선|해소|해결|진정|감소|호전|사라|없어[지졌져짐]|가라앉|나아[지졌져짐]|나았|좋아[지졌져짐]|잡[아혀히])',
      '트러블\\s*(?:관리|케어)|트러블\\s*에\\s*(?:좋|도움|효과)',
      // 식품 효능(연구 A6 §6, 추정 목록·법령 원문 미확인) — 부위 + 건강, 숙취 해소, 항산화·항암, 콜레스테롤 감소. '건강한 한 끼'·'속이 편해요'·'소화가 잘 돼요'·'간이 딱 맞아요'·'맛·식감·신선'은 막지 않는다
      '(?<![가-힣])(?:장|간|위|혈관|뼈|관절|눈)\\s*건강',
      '숙취\\s*(?:해소|제거|완화|개선)',
      '항산화|항암|항노화|노화\\s*(?:방지|예방)',
      '콜레스테롤\\s*(?:을|를|이|가)?\\s*(?:낮|줄|감소|개선|조절)',
      // 질병·증상명 단독은 맨 뒤 — 같은 자리의 '탈모 예방'·'여드름 진정' 같은 긴 표현이 먼저 잡힌다
      DISEASE_NAMES,
    ].join('|'),
    'gi'
  ),
}

/**
 * 고지·부정 문맥 — 같은 문장 안에서 표현 뒤 가까이에 주장을 거두는 고지가 오면 세지 않는다('치료 목적이 아닙니다', '효능을 표방하지 않습니다').
 * 일반 부정('남지 않습니다')·안심 문구('걱정하지 마세요')는 주장을 거두지 않으므로 넣지 않는다.
 */
const NEGATION_AFTER_RE = /아니|아닙|표방하지|주장하지|사용하지\s*마|말\s*것|금지|불가/
/** 표현 앞의 고지형 연결('의료기기가 아니며 치료…')만 본다 — 대조형 '비닐이 아닌 생분해 봉투'는 주장이므로 '아닌'은 넣지 않는다 */
const NEGATION_BEFORE_RE = /아니며|아니므로|아니라서|아닙니다|않으며|않습니다/
const NEGATION_WINDOW = 15
/** spec.certificationInfo에 이런 표현이 있으면 친환경 주장도 근거가 있다고 본다 */
const ECO_CERT_RE = /환경\s*표지|친환경\s*인증|생분해\s*인증|fsc|ok\s*compost|탄소\s*발자국/i

export interface TextBlock {
  section: string
  text: string
}

export interface AutoClaim<K extends string = ClaimKind> {
  kind: K
  /** 찾은 표현(원형, 중복 제거) */
  terms: string[]
  sections: string[]
}

/** 규제 표현 묶음(findRegulatedClaims) */
export type RegulatedClaim = AutoClaim<RegulatedKind>

/** 비교용 정규화 — 소문자, 공백·문장부호·기호 제거 */
export function normalizeClaimText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function isNegated(text: string, start: number, end: number): boolean {
  const marks = ['.', '!', '?', '\n', '。']
  const sentenceStart = Math.max(...marks.map((p) => text.lastIndexOf(p, start - 1))) + 1
  const ends = marks.map((p) => text.indexOf(p, end)).filter((i) => i !== -1)
  const sentenceEnd = ends.length ? Math.min(...ends) : text.length
  const before = text.slice(Math.max(sentenceStart, start - NEGATION_WINDOW), start)
  const after = text.slice(end, Math.min(sentenceEnd, end + NEGATION_WINDOW))
  return NEGATION_BEFORE_RE.test(before) || NEGATION_AFTER_RE.test(after)
}

type Term<K extends string> = { kind: K; term: string }

/** 효능은 기존 표현과 신체 효과 표현(R2)을 따로 찾는다 */
const strongPatterns = (kind: ClaimKind): RegExp[] => [CLAIM_PATTERNS[kind], ...(kind === 'efficacy' ? [BODY_EFFECT_RE] : [])]

function termsIn<K extends string>(
  text: string,
  kinds: readonly K[],
  patterns: (kind: K) => RegExp[],
  negation: boolean
): Array<Term<K>> {
  const kept = (pattern: RegExp) =>
    [...text.matchAll(pattern)].filter((m) => !negation || !isNegated(text, m.index ?? 0, (m.index ?? 0) + m[0].length))
  return kinds.flatMap((kind) => patterns(kind).flatMap(kept).map((m) => ({ kind, term: m[0].trim() })))
}

/** 문구 하나에서 종류별 주장 표현(고지문 제외) — 점수 검사용 */
export function claimTermsIn(text: string): Array<Term<ClaimKind>> {
  return termsIn(text, CLAIM_KINDS, strongPatterns, true)
}

/**
 * 문구 하나에서 규제 표현(REGULATED_CLAIM_PATTERNS). negation이면 점수 검사처럼 고지·부정 문맥('치료 목적이 아닙니다')을 뺀다(카피 검출·
 * 자동 작성). 기본은 모두 센다(인용 후보 — 후기의 '치료는 아니지만'도 의학 언급이다)
 */
export function regulatedClaimTermsIn(text: string, opts: { negation?: boolean } = {}): Array<Term<RegulatedKind>> {
  return termsIn(text, REGULATED_KINDS, (kind) => [REGULATED_CLAIM_PATTERNS[kind]], opts.negation === true)
}

/**
 * 인용·자동 작성의 질병·증상명(2026-10-30 통합 결정, R6b P07 심사 지적) — medical의 질병·증상명(DISEASE_NAMES)에 비듬을 더한다.
 * 인용 후보 차단(review-scrubber)과 자동 작성 필터(pdp-auto-fill)가 쓴다. 인용은 고민 서술도 막고, 자동 작성은 고민 서술을 남긴다
 */
const QUOTE_DISEASE_RE = new RegExp(`${DISEASE_NAMES}|비듬`, 'g')

/** 문구 하나의 인용·자동 작성 전용 질병·증상명(중복 제거) */
export function quoteDiseaseTermsIn(text: string): string[] {
  return [...new Set([...(text ?? '').matchAll(QUOTE_DISEASE_RE)].map((m) => m[0]))]
}

/** 문구 목록 → 종류별 주장 묶음. 같은 표현(정규화 기준)은 하나로, 한 문구 안 같은 종류 표현들도 하나로 묶는다. */
export function findClaims(blocks: readonly TextBlock[]): AutoClaim[] {
  return groupClaims(blocks, CLAIM_KINDS, claimTermsIn)
}

/**
 * 문구 목록 → 규제 표현 묶음(findClaims와 같은 묶음 규칙, 고지·부정 문맥 제외). exclude가 참인 표현은 뺀다(상품명·옵션 값에 든 용도
 * 이름 등). 카피 검출이 쓰고, 점수 검사도 심사 규칙과 함께 이 함수로 바꿨다
 */
export function findRegulatedClaims(
  blocks: readonly TextBlock[],
  exclude: (term: string) => boolean = () => false
): RegulatedClaim[] {
  return groupClaims(blocks, REGULATED_KINDS, (text) =>
    regulatedClaimTermsIn(text, { negation: true }).filter((t) => !exclude(t.term))
  )
}

function groupClaims<K extends string>(
  blocks: readonly TextBlock[],
  kinds: readonly K[],
  findTerms: (text: string) => Array<Term<K>>
): Array<AutoClaim<K>> {
  const groups: Array<{ kind: K; keys: Set<string>; terms: Set<string>; sections: Set<string> }> = []
  for (const block of blocks) {
    const found = findTerms(block.text)
    for (const kind of kinds) {
      const terms = found.filter((f) => f.kind === kind).map((f) => f.term)
      if (terms.length === 0) continue
      const keys = new Set(terms.map(normalizeClaimText))
      // 이미 있는 묶음과 표현을 공유하면 합친다(여러 묶음이 걸리면 모두 하나로)
      const hits = groups.filter((g) => g.kind === kind && [...keys].some((k) => g.keys.has(k)))
      const target = hits[0] ?? { kind, keys: new Set<string>(), terms: new Set<string>(), sections: new Set<string>() }
      if (!hits.length) groups.push(target)
      for (const other of hits.slice(1)) {
        other.keys.forEach((k) => target.keys.add(k))
        other.terms.forEach((t) => target.terms.add(t))
        other.sections.forEach((s) => target.sections.add(s))
        groups.splice(groups.indexOf(other), 1)
      }
      keys.forEach((k) => target.keys.add(k))
      terms.forEach((t) => target.terms.add(t))
      target.sections.add(block.section)
    }
  }
  return groups.map((g) => ({ kind: g.kind, terms: [...g.terms], sections: [...g.sections] }))
}

/**
 * 표현 하나가 스펙 근거(certificationInfo)로 뒷받침되는가. 인증 정보에 같은 표현이 있으면 근거 있음.
 * 인증은 인증 주체(KC→KC)·특허·성적서가 인증 정보에 있을 때, 친환경은 친환경 인증 표현이 있을 때도 근거 있음. 효능·안전은 같은 표현만.
 */
export function isClaimTermSupported(kind: ClaimKind, term: string, certificationInfo: string | null | undefined): boolean {
  const info = normalizeClaimText(certificationInfo ?? '')
  if (!info) return false
  if (info.includes(normalizeClaimText(term))) return true
  if (kind === 'certification') {
    const body = term.toLowerCase().match(new RegExp(`^(${CERT_BODY})`))?.[1]
    // 인증 주체는 낱말로 대조한다('certificate' 안의 ce는 CE가 아니다)
    if (body) return new RegExp(`(^|[^a-z])${body}([^a-z]|$)`, 'i').test(certificationInfo ?? '')
    if (term.includes('특허')) return info.includes('특허')
    if (term.includes('성적서')) return info.includes('성적서')
    return false
  }
  if (kind === 'eco') return ECO_CERT_RE.test(certificationInfo ?? '')
  return false
}

/**
 * 상품 사실 값을 페이지 표·캡션·카피 입력에 실어도 되는가(2026-11-01 통합 결정) — 입력·OpenAPI 속성 값이어도 페이지에 옮기면 우리 주장이다.
 * 규제 표현이 없거나, 인증 표현이 인증 정보로 뒷받침될 때만 참이다
 */
export function isFactClaimSafe(value: string, certificationInfo: string | null | undefined): boolean {
  return regulatedClaimTermsIn(value, { negation: true }).every(
    (t) => t.kind === 'certification' && isClaimTermSupported('certification', t.term, certificationInfo)
  )
}

/** 사실 행 가운데 실어도 되는 것만 — 이름과 값을 함께 본다('급체 방지: 있음'처럼 이름에만 든 표현도 뺀다) */
export function claimSafeFactRows<T extends { label: string; value: string }>(
  rows: readonly T[],
  certificationInfo: unknown
): T[] {
  const cert = typeof certificationInfo === 'string' ? certificationInfo : ''
  return rows.filter((r) => isFactClaimSafe(`${r.label} ${r.value}`, cert))
}

/** 묶음 전체가 근거 있는가 — 표현이 하나라도 있고 모두 근거가 있을 때만 */
export function isClaimSupported(kind: ClaimKind, terms: readonly string[], certificationInfo: string | null | undefined): boolean {
  return terms.length > 0 && terms.every((t) => isClaimTermSupported(kind, t, certificationInfo))
}
