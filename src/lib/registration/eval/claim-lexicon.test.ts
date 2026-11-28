import { describe, expect, it } from 'vitest'
import {
  claimTermsIn,
  findClaims,
  isBodyEffectTerm,
  isClaimSupported,
  isClaimTermSupported,
  isDiseaseNameTerm,
  isFactClaimSafe,
  findRegulatedClaims,
  normalizeClaimText,
  quoteDiseaseTermsIn,
  regulatedClaimTermsIn,
} from './claim-lexicon'

const kindsOf = (text: string) => findClaims([{ section: 'point_div', text }]).map((c) => c.kind)

describe('findClaims — 근거 없는 주장 4종', () => {
  it.each([
    ['두피 혈액순환을 돕는 브러시', 'efficacy'],
    ['99.9% 살균 효과', 'efficacy'],
    ['효과 입증된 성분', 'efficacy'],
    ['탈모 방지에 좋은', 'efficacy'],
    ['무독성 소재라 걱정하지 않으셔도 돼요', 'safety'],
    ['인체에 무해한 잉크', 'safety'],
    ['유해물질 0%', 'safety'],
    ['피부 자극 없는 소재', 'safety'],
    ['KC 인증 완료 제품', 'certification'],
    ['특허 받은 구조', 'certification'],
    ['친환경적인 종이 소재', 'eco'],
    ['자연 분해되는 봉투', 'eco'],
    ['썩는 비닐로 만든', 'eco'],
    ['일반 비닐이 아닌 생분해 봉투', 'eco'],
    ['살균되어 세균이 남지 않습니다', 'efficacy'],
    ['친환경 소재라 걱정하지 마세요', 'eco'],
    ['Eco-friendly packaging', 'eco'],
  ])('%s → %s', (text, kind) => {
    expect(kindsOf(text)).toContain(kind)
  })

  it.each([
    '안전하게 보관하세요',
    '다양한 사용 환경에서',
    '피부에 닿는 부분은 부드럽게',
    '인증샷 남기기 좋은 디자인',
    '선물 포장 마감',
    // 고지·부정 문맥(verifier 재현 사례)
    '의료기기가 아니며 치료 목적으로 사용하지 마세요.',
    '의학적 효능을 표방하지 않습니다',
    '항균 효과를 주장하지 않습니다',
    '탈모 고민 있으신가요?',
    '사료가 썩는 걱정 없이 보관',
    '인증 제품 목록은 판매처에 문의하세요',
  ])('오탐 없음: %s', (text) => {
    expect(kindsOf(text)).toEqual([])
  })

  it('부정은 같은 문장 안에서만 본다 — 앞 문장의 고지가 다음 문장의 주장을 지우지 않는다', () => {
    expect(kindsOf('치료 목적이 아닙니다. 그래도 살균 99.9%')).toEqual(['efficacy'])
    expect(claimTermsIn('치료 목적이 아닙니다. 그래도 살균 99.9%').map((t) => t.term)).toEqual(['살균'])
  })

  it('같은 표현이 여러 섹션에 나오면 1건, 섹션은 모두 남긴다', () => {
    const claims = findClaims([
      { section: 'main_cut', text: '친환경 소재' },
      { section: 'cta', text: '친환경 포장으로 마무리' },
    ])
    expect(claims).toEqual([{ kind: 'eco', terms: ['친환경'], sections: ['main_cut', 'cta'] }])
  })

  it('한 문구 안 같은 종류 표현은 1건, 다른 문구의 다른 표현은 따로 센다', () => {
    expect(findClaims([{ section: 'a', text: '친환경 생분해 소재' }])).toHaveLength(1)
    expect(
      findClaims([
        { section: 'a', text: '친환경 소재' },
        { section: 'b', text: '생분해 봉투' },
      ])
    ).toHaveLength(2)
  })

  it('표현을 공유하는 묶음 둘이 한 문구에서 만나면 하나로 합친다', () => {
    const claims = findClaims([
      { section: 'a', text: '친환경 소재' },
      { section: 'b', text: '생분해 봉투' },
      { section: 'c', text: '친환경 생분해 패키지' },
    ])
    expect(claims).toHaveLength(1)
    expect(claims[0].terms.sort()).toEqual(['생분해', '친환경'])
    expect(claims[0].sections.sort()).toEqual(['a', 'b', 'c'])
  })

  it('종류가 다르면 같은 문구 안에서도 따로 센다', () => {
    expect(findClaims([{ section: 'a', text: '무독성 친환경 소재' }]).map((c) => c.kind).sort()).toEqual(['eco', 'safety'])
  })
})

describe('신체 효과 표현(R2) — 신체 부위와 결과가 함께 올 때만', () => {
  it.each([
    // R1 P03 두피 브러시 — 심사위원(Claude)만 잡았던 3건
    ['두피가 개운해지는 3분 샤워 습관', '두피가 개운해지'],
    ['실리콘 돌기가 손끝보다 넓게 두피를 자극해 개운한 세정감까지 끌어올려요', '두피를 자극해 개운한'],
    [
      '실리콘 돌기가 손가락보다 넓고 균일하게 압력을 전달해 샴푸하면서 마사지까지 끝나요',
      '압력을 전달해 샴푸하면서 마사지까지',
    ],
    // R0 P03 — 코덱스만 잡았던 1건
    ['하루 끝, 뻐근함을 덜어내는 시간', '뻐근함을 덜어'],
    // 쿠팡 아카이브 정탐 유형
    ['피부 진정에 도움을 주는 성분', '피부 진정'],
    ['단 1주 사용만으로 피부 장벽 개선', '피부 장벽 개선'],
    ['모근 강화 샴푸', '모근 강화'],
    ['혈행 개선이 필요하신 분', '혈행'],
    ['눈 피로 완화 렌즈', '눈 피로 완화'],
    ['하루의 피로 회복', '피로 회복'],
    ['어깨결림 해소', '결림 해소'],
    ['붓기가 빠지는 아침', '붓기가 빠지'],
    ['시원한 두피 마사지 효과', '마사지 효과'],
    // verifier 미탐 보강
    ['어깨 뭉침을 풀어줘요', '어깨 뭉침을 풀어'],
    ['뭉친 근육을 풀어주는', '뭉친 근육을 풀어'],
    ['통증이 사라지는', '통증이 사라'],
    ['부기가 가라앉는', '부기가 가라앉'],
    ['피로를 풀어주는', '피로를 풀어'],
    ['비듬 감소', '비듬 감소'],
    ['모공이 줄어드는', '모공이 줄어'],
    ['두피까지 개운', '두피까지 개운'],
    ['두피를 자극해 샴푸하면서 마사지까지', '자극해 샴푸하면서 마사지까지'],
  ])('%s → 효능(%s)', (text, term) => {
    const terms = claimTermsIn(text)
      .filter((t) => t.kind === 'efficacy')
      .map((t) => t.term)
    expect(terms).toEqual([term])
    expect(isBodyEffectTerm(term)).toBe(true)
  })

  it.each([
    // 같은 R0 P03 페이지에서 두 심사위원 모두 지적하지 않은 문장 — 자극·마사지 단독은 세지 않는다
    '두피 밀착형 돌기 배열로 샴푸할 때마다 두피 전체를 고르게 자극해요',
    '두피 전체를 고르게 자극하는 마사지 동작',
    '샴푸가 곧 두피 마사지',
    '말랑한 실리콘 재질로 두피 압박',
    '넓은 자극 면적',
    '샴푸하며 마사지, 한 번에 끝나요',
    '세정과 마사지를 동시에 수행하는 멀티펑셔널 구조',
    // 비교 표현은 효능이 아니다(별도 유형 후보 — 사전에 넣지 않음)
    '단순 브러쉬와는 구조부터 달라요',
    // 사용감·비유·다른 낱말 속 글자
    '청소시 손의 피로를 줄여줍니다',
    '사용시 피로감을 줄여줍니다',
    '스크롤 피로를 완화하는 구조',
    '품질 편차 우려를 사용감 카피로 해소',
    '피부에 닿는 부분을 개선한 디자인',
    '시원한 소재로 여름에도 산뜻하게',
    '개운한 세정감',
    '목적에 맞게 개선했어요',
    '몸통이 가벼워 들고 다니기 좋아요',
    // verifier 오탐 반례 — 뭉침은 신체 부위가 붙을 때만, 옷·물건의 부위 이름, '저자극·자극 없이', 다른 낱말·비유
    '털 뭉침을 풀어주는 슬리커 브러시',
    '빨래 뭉침을 줄여주는 세탁볼',
    '가루 뭉침을 없애주는 체망',
    '저자극 실리콘 돌기로 샴푸하며 마사지까지',
    '자극 없이 부드럽게 마사지까지',
    '피부에 닿아도 편안해지는 소재',
    '발바닥이 편안해지는 쿠션 슬리퍼',
    '얼굴이 편안해지는 마스크 스트랩',
    '어깨 강화 봉제',
    '허리 강화 고무줄',
    '압력밥솥으로 마사지까지 끝',
    '피부처럼 얇은 랩으로 개운하게 보관',
    // verifier 재검수 반례 — 부위 낱말 경계, 빗질 문맥, 옷 부위 개운, 띄어 쓴 비유, 손 피로
    '엉키고 뭉친 목걸이를 풀어',
    '뭉친 모발을 풀어주는 빗',
    '모발 뭉침을 풀어주는 디탱글러',
    '발바닥까지 개운한 통기성 슬리퍼',
    '허리까지 개운하게 감싸는 핏',
    '얼굴 크기만 한 냄비로 개운한 국물',
    '피부 같은 감촉으로 개운',
    '손목 피로를 풀어주는 마우스',
    '손의 피로를 풀어',
    // 고지문은 기존 규칙대로 세지 않는다
    '의료기기가 아니며 혈행 개선 효과를 표방하지 않습니다',
  ])('오탐 없음: %s', (text) => {
    expect(claimTermsIn(text).filter((t) => t.kind === 'efficacy')).toEqual([])
  })

  it('문장이 다르면 따로 센다(기존 합산 규칙 그대로) — 같은 문장이 여러 섹션에 나오면 1건', () => {
    const claims = findClaims([
      { section: 'hook_3step', text: '두피가 개운해지는 3분 샤워 습관' },
      { section: 'hook_3step', text: '손끝보다 넓게 두피를 자극해 개운한 세정감' },
      { section: 'cta', text: '두피가 개운해지는 3분 샤워 습관' },
    ])
    expect(claims.map((c) => [c.terms, c.sections])).toEqual([
      [['두피가 개운해지'], ['hook_3step', 'cta']],
      [['두피를 자극해 개운한'], ['hook_3step']],
    ])
  })

  it('기존 표현과 따로 찾는다 — 같은 문장의 기존 표현을 삼키지 않아 다른 섹션의 같은 표현과 1건으로 묶인다', () => {
    expect(claimTermsIn('모공 속 노폐물 제거로 개운한 세안').map((t) => t.term)).toEqual([
      '노폐물 제거',
      '모공 속 노폐물 제거로 개운한',
    ])
    const claims = findClaims([
      { section: 'a', text: '모공 속 노폐물 제거로 개운한 세안' },
      { section: 'b', text: '노폐물 제거' },
    ])
    expect(claims).toHaveLength(1)
    expect(claims[0].sections).toEqual(['a', 'b'])
  })

  it('기존 효능 표현의 빈틈 보강 — 혈액순환을 도와', () => {
    expect(claimTermsIn('두피 혈액순환을 도와요').map((t) => t.term)).toEqual(['혈액순환을 도와'])
  })

  it('보강 전 표현은 신체 효과 표현으로 보지 않는다', () => {
    for (const term of ['살균', '혈액 순환 개선', '탈모 방지', '저자극', '친환경'])
      expect(isBodyEffectTerm(term)).toBe(false)
  })
})

describe('isClaimTermSupported — 표현 단위 근거 면제', () => {
  const kc = 'KC 안전확인 신고 완료'

  it('인증 정보가 없으면 아무것도 면제하지 않는다', () => {
    expect(isClaimTermSupported('certification', 'KC 인증', undefined)).toBe(false)
    expect(isClaimTermSupported('certification', 'KC 인증', '  ')).toBe(false)
  })

  it('인증은 같은 인증 주체만 면제한다(KC 정보로 FDA·특허는 면제하지 않음)', () => {
    expect(isClaimTermSupported('certification', 'KC 인증', kc)).toBe(true)
    expect(isClaimTermSupported('certification', 'FDA 승인', kc)).toBe(false)
    expect(isClaimTermSupported('certification', '특허 받은', kc)).toBe(false)
    expect(isClaimTermSupported('certification', '특허 받은', '특허 제10-1234567호')).toBe(true)
    expect(isClaimTermSupported('certification', 'CE 인증', 'test certificate 첨부')).toBe(false)
    expect(isClaimTermSupported('certification', 'CE 인증', 'CE 적합성 선언')).toBe(true)
  })

  it('안전·효능은 같은 표현이 인증 정보에 있을 때만 면제한다', () => {
    expect(isClaimTermSupported('safety', '100% 안전', kc)).toBe(false)
    expect(isClaimTermSupported('safety', '무독성', kc)).toBe(false)
    expect(isClaimTermSupported('safety', '무독성', '무독성 시험 통과(KTR)')).toBe(true)
    expect(isClaimTermSupported('efficacy', '살균', kc)).toBe(false)
  })

  it('친환경은 친환경 인증 표현이 있을 때만 면제한다', () => {
    expect(isClaimTermSupported('eco', '친환경', kc)).toBe(false)
    expect(isClaimTermSupported('eco', '친환경', '환경표지 인증 제품')).toBe(true)
  })

  it('묶음은 표현이 모두 근거 있을 때만 면제, 표현이 없으면 면제하지 않는다', () => {
    expect(isClaimSupported('certification', ['KC 인증', 'FDA 승인'], kc)).toBe(false)
    expect(isClaimSupported('certification', ['KC 인증'], kc)).toBe(true)
    expect(isClaimSupported('certification', [], kc)).toBe(false)
  })
})

it('normalizeClaimText — 대소문자·공백·문장부호 무시', () => {
  expect(normalizeClaimText(' 친환경적인, 종이! ')).toBe('친환경적인종이')
  expect(normalizeClaimText('Eco-Friendly')).toBe('ecofriendly')
})

describe('규제 표현 사전(오너 지시 2026-10-30) — 인증·인허가·의학·기능성만, 사용 경험·체감 효익은 아님', () => {
  it('인증·인허가·시험 사칭, 살균·항균, 절대 안전·환경 표시는 certification', () => {
    const cases: Array<[string, string]> = [
      ['KC 인증 받은 제품', 'KC 인증'],
      ['식약처 허가 제품', '식약처 허가'],
      ['특허 받은 구조', '특허 받은'],
      ['임상 완료', '임상'],
      ['피부 자극 테스트 완료', '테스트 완료'],
      ['99.9% 살균', '99.9% 살균'],
      ['항균 도마', '항균'],
      ['무독성 소재', '무독성'],
      ['친환경 포장', '친환경'],
    ]
    for (const [text, term] of cases) expect(regulatedClaimTermsIn(text), text).toEqual([{ kind: 'certification', term }])
  })

  it('질병·치료·의학적 효능·전문가 추천 사칭·질병 예방·기능성 화장품 효능은 medical', () => {
    const cases: Array<[string, string]> = [
      ['아토피 완화', '아토피'],
      ['손목 통증', '통증'],
      ['혈액 순환 개선', '혈액 순환'],
      ['면역력 강화', '면역력'],
      ['미백 크림', '미백'],
      ['주름 개선', '주름 개선'],
      ['탈모 예방', '탈모 예방'],
      ['탈모 완화', '탈모 완화'],
      ['여드름 진정', '여드름 진정'],
      ['의사 추천', '의사 추천'],
      ['감기 예방', '감기 예방'],
      ['가려움증이 심할 때', '가려움증'],
      ['두피 가려움이 줄었어요', '가려움이 줄'],
      ['가려움 완화', '가려움 완화'],
      ['비듬이 개선돼요', '비듬이 개선'],
      ['비듬 감소', '비듬 감소'],
      ['모근까지 건강하게', '모근까지 건강'],
      ['모근 강화', '모근 강화'],
    ]
    for (const [text, term] of cases) expect(regulatedClaimTermsIn(text), text).toEqual([{ kind: 'medical', term }])
  })

  it('사용 경험·체감 효익·사용법·정도 표현은 세지 않는다(오너 예시 포함)', () => {
    for (const text of [
      '빗질해도 엉키지 않아요',
      '감고 나면 두피가 시원해요',
      '드라이가 빨라요',
      '노폐물이 쏙 빠지는 느낌',
      '쓰고 나면 개운해요',
      '끓는 물 소독도 가능',
      '식기세척기 변형 걱정 없음',
      '정리에 도움이 돼요',
      '보온 효과가 좋아요',
      '저자극 소재',
      '엉킴 예방에 좋아요',
      '냄새 제거가 잘 돼요',
      'service 등록이 쉬워요',
      '모근까지 시원해요',
      '가려울 때 긁기 좋아요',
      '비듬 같은 가루도 잘 털려요',
    ]) {
      expect(regulatedClaimTermsIn(text), text).toEqual([])
    }
  })

  it('J50 효능 문구 부활(오너 11-10 23:5x): 체감 효능은 통과, 의학·인증 효능은 그대로 막는다', () => {
    for (const text of [
      '모공 속 노폐물까지 흡착 배출',
      '묵은 각질 제거로 매끈한 피부결',
      '세정 효능이 뛰어나요',
      '두피가 개운해지는 샤워',
      '바디브러시 효능',
    ]) {
      expect(regulatedClaimTermsIn(text, { negation: true }), text).toEqual([])
      expect(isFactClaimSafe(text, null), text).toBe(true)
    }
    for (const [text, term] of [
      ['여드름 완화', '여드름 완화'],
      ['혈액순환 개선', '혈액순환'],
      ['미백 효과', '미백'],
      ['주름 개선', '주름 개선'],
      ['탈모 예방', '탈모 예방'],
      ['피부 트러블 진정', '트러블 진정'],
      ['모근 강화', '모근 강화'],
      ['림프 마사지', '림프'],
      ['임상 완료', '임상'],
      ['KC 인증 완료', 'KC 인증'],
      ['99.9% 살균', '99.9% 살균'],
      ['의학적 효능', '의학'],
    ] as const) {
      expect(regulatedClaimTermsIn(text, { negation: true }).map((t) => t.term), text).toContain(term)
      expect(isFactClaimSafe(text, null), text).toBe(false)
    }
  })

  it('negation이면 고지·부정 문맥을 뺀다(카피 검출·자동 작성), 기본은 센다(인용 후보)', () => {
    const text = '의료기기가 아니며 치료 목적이 아닙니다'
    expect(regulatedClaimTermsIn(text)).toEqual([
      { kind: 'medical', term: '의료기기' },
      { kind: 'medical', term: '치료' },
    ])
    expect(regulatedClaimTermsIn(text, { negation: true })).toEqual([])
  })

  it('findRegulatedClaims — findClaims와 같은 묶음 규칙(같은 표현은 한 묶음), exclude가 참인 표현은 뺀다', () => {
    const blocks = [
      { section: 'a', text: 'KC 인증 받은 항균 도마' },
      { section: 'b', text: '항균 소재' },
      { section: 'c', text: '두피가 시원해요' },
    ]
    expect(findRegulatedClaims(blocks)).toEqual([
      { kind: 'certification', terms: ['KC 인증', '항균'], sections: ['a', 'b'] },
    ])
    expect(findRegulatedClaims(blocks, (t) => t === '항균')).toEqual([
      { kind: 'certification', terms: ['KC 인증'], sections: ['a'] },
    ])
  })

  it('질병·증상명 단독은 인용·자동 작성(quoteDiseaseTermsIn — 비듬 포함)', () => {
    expect(quoteDiseaseTermsIn('강아지 턱드름 때문에 바꿨어요, 턱드름이 줄었어요')).toEqual(['턱드름'])
    expect(quoteDiseaseTermsIn('여드름 패치·탈모 고민·비듬')).toEqual(['여드름', '탈모', '비듬'])
    expect(quoteDiseaseTermsIn('고양이 외이염·결막염')).toEqual(['외이염', '결막염'])
    expect(quoteDiseaseTermsIn('아이 피부에 닿아도 부드러워요')).toEqual([])
    // 다른 뜻·다른 낱말 속 글자는 세지 않는다
    expect(quoteDiseaseTermsIn('늘어날 기미가 전혀 없어요')).toEqual([])
    expect(quoteDiseaseTermsIn('만두통에 담아도 좋아요통통 튼튼')).toEqual([])
    expect(quoteDiseaseTermsIn('개발진이 만든 구조')).toEqual([])
    expect(quoteDiseaseTermsIn('두통이 심할 때')).toEqual(['두통'])
  })

  it('질병·증상명 단독은 카피 검출·점수(medical)도 센다 — 반려동물·피부 질환(2026-10-31 R8 P07)', () => {
    const cases: Array<[string, string]> = [
      // R8 P07 후기 카드의 모양(이름 + 제품 선택)
      ['강아지 턱드름 때문에 식기를 다 바꿨는데, 진작 이걸로 살 걸 그랬어요', '턱드름'],
      ['여드름 패치', '여드름'],
      ['여드름 피부도 편하게', '여드름'],
      ['탈모 샴푸와 함께 쓰세요', '탈모'],
      ['모낭염이 생기던 자리', '모낭염'],
      ['지루성 두피에 맞춘 빗', '지루성'],
      ['강아지 외이염', '외이염'],
      ['고양이 피부병', '피부병'],
      ['눈물 많은 아이 결막염', '결막염'],
      ['슬개골 탈구가 걱정되는 노견', '슬개골 탈구'],
      ['요로 결석', '요로 결석'],
      ['고양이 구내염', '구내염'],
      ['강아지 장염', '장염'],
      ['밥 먹고 구토가 줄었어요', '구토가 줄'],
    ]
    for (const [text, term] of cases) expect(regulatedClaimTermsIn(text), text).toEqual([{ kind: 'medical', term }])
    // 이미 있던 이름은 그대로 medical(피부염·습진·아토피)
    for (const name of ['피부염', '습진', '아토피']) {
      expect(regulatedClaimTermsIn(`강아지 ${name} 때문에 바꿨어요`), name).toEqual([{ kind: 'medical', term: name }])
    }
    // 같은 자리의 긴 표현이 먼저 잡힌다(이름만 따로 세지 않는다)
    expect(regulatedClaimTermsIn('탈모 예방')).toEqual([{ kind: 'medical', term: '탈모 예방' }])
    expect(regulatedClaimTermsIn('여드름 진정')).toEqual([{ kind: 'medical', term: '여드름 진정' }])
    expect(findRegulatedClaims([{ section: 'review', text: '강아지 턱드름 때문에 식기를 바꿨어요' }])).toEqual([
      { kind: 'medical', terms: ['턱드름'], sections: ['review'] },
    ])
    // 고지·부정 문맥은 카피 검출에서 뺀다
    expect(regulatedClaimTermsIn('턱드름 치료용 제품이 아닙니다', { negation: true })).toEqual([])
  })

  it('질병·증상명 오탐 — 피부 접촉·사용 감각·다른 뜻 낱말은 세지 않는다', () => {
    for (const text of [
      '피부에 닿는 부분은 부드럽게',
      '피부에 닿아도 자극 없이 편안해요',
      '아이 피부처럼 얇고 부드러운 원단',
      '털 빠짐이 적은 빗질',
      '비듬 같은 가루도 잘 털려요',
      '빠지는 머리카락도 한 번에 정리',
      '늘어날 기미가 전혀 없어요',
      '만두통에 담아도 좋아요',
      '개발진이 직접 만든 구조',
      '수업 결석 없이 매일 써요',
      '구토 걱정 없이 천천히 먹게',
      '포장 염려 없이 튼튼하게',
      '목이 편한 높이',
    ]) {
      expect(regulatedClaimTermsIn(text), text).toEqual([])
      expect(findRegulatedClaims([{ section: 'a', text }]), text).toEqual([])
    }
    expect(isDiseaseNameTerm('턱드름')).toBe(true)
    expect(isDiseaseNameTerm('안구 건조증')).toBe(true)
    expect(isDiseaseNameTerm('탈모 예방')).toBe(false)
    expect(isDiseaseNameTerm('비듬')).toBe(false)
  })

  it('트러블 — 줄었다·없어졌다·돌본다는 말만 센다(R17 P03, 시험 문장은 지어낸 글)', () => {
    const cases: Array<[string, string]> = [
      ['쓰고 나서 피부트러블이 사라졌어요', '트러블이 사라'],
      ['피부 트러블 사라졌어요', '트러블 사라'],
      ['트러블이 많이 줄었어요', '트러블이 많이 줄었'],
      ['트러블도 덜하고 좋아요', '트러블도 덜하'],
      ['트러블이 덜 생겨요', '트러블이 덜 생'],
      ['트러블이 거의 없어졌어요', '트러블이 거의 없어졌'],
      ['트러블이 싹 없어짐', '트러블이 싹 없어짐'],
      ['피부 트러블 진정', '트러블 진정'],
      ['트러블 개선', '트러블 개선'],
      ['트러블 완화', '트러블 완화'],
      ['트러블 해소', '트러블 해소'],
      ['트러블 해결', '트러블 해결'],
      ['트러블 감소', '트러블 감소'],
      ['트러블 호전', '트러블 호전'],
      ['트러블 줄임', '트러블 줄임'],
      ['트러블이 나았어요', '트러블이 나았'],
      ['트러블이 가라앉았어요', '트러블이 가라앉'],
      ['트러블이 나아졌어요', '트러블이 나아졌'],
      ['트러블이 좋아졌어요', '트러블이 좋아졌'],
      ['트러블 잡아주는 브러쉬', '트러블 잡아'],
      ['두피 트러블 관리에 도움이 되나요?', '트러블 관리'],
      ['트러블 케어 앰플', '트러블 케어'],
      ['트러블에 좋아요', '트러블에 좋'],
    ]
    for (const [text, term] of cases) expect(regulatedClaimTermsIn(text), text).toEqual([{ kind: 'medical', term }])
    expect(isDiseaseNameTerm('트러블 사라')).toBe(false)
    expect(isFactClaimSafe('트러블 케어', '')).toBe(false)
  })

  it('트러블 오탐 — 생기지 않았다는 경험·다른 뜻·각질 세정은 세지 않는다(오너 규칙: 체감 효익은 살린다)', () => {
    for (const text of [
      '피부 트러블 없이 잘 썼어요',
      '트러블 없어요',
      '트러블 걱정 없이 매일 써요',
      '트러블이 안 생겨요',
      '트러블 난 적 없어요',
      '피부에 트러블을 줄 걱정이 없어요',
      '배송 트러블이 있었어요',
      '트러블 없이 쓰니 기분이 좋아졌어요',
      '트러블메이커 강아지도 잘 써요',
      '각질까지 싹 씻겨 내려가는 기분',
      '두피가 시원해요',
    ]) {
      expect(regulatedClaimTermsIn(text), text).toEqual([])
      expect(findRegulatedClaims([{ section: 'a', text }]), text).toEqual([])
    }
    expect(isFactClaimSafe('트러블 없이 쓰는 소재', '')).toBe(true)
  })

  it('점수 검사는 규제 묶음(findRegulatedClaims) — 옛 4종 사전(findClaims)과 달리 저자극은 세지 않는다', () => {
    expect(findClaims([{ section: 'a', text: '저자극 소재' }]).map((c) => c.kind)).toEqual(['safety'])
    expect(regulatedClaimTermsIn('저자극 소재')).toEqual([])
    expect(findRegulatedClaims([{ section: 'a', text: '저자극 소재' }])).toEqual([])
  })
})

describe('식품 규제 낱말(적용 T1-81, 추정 목록) — 효능·건강기능식품 오인만 막고 맛과 체감은 살린다', () => {
  const kinds = (text: string) => regulatedClaimTermsIn(text, { negation: true }).map((t) => t.kind)

  it.each([
    ['장 건강에 좋은 요거트', 'medical'],
    ['간 건강을 챙겨요', 'medical'],
    ['혈관 건강 지키는 습관', 'medical'],
    ['뼈 건강에 도움', 'medical'],
    ['숙취 해소 음료', 'medical'],
    ['항산화 성분 가득', 'medical'],
    ['항암 효과', 'medical'],
    ['노화 방지 차', 'medical'],
    ['콜레스테롤을 낮춰요', 'medical'],
    ['건강기능식품으로 만든', 'certification'],
    ['건기식 원료', 'certification'],
  ])('%s → %s', (text, kind) => {
    expect(kinds(text)).toContain(kind)
  })

  it.each([
    '건강한 한 끼',
    '속이 편해요',
    '소화가 잘 돼요',
    '간이 딱 맞아요',
    '장 보러 갈 때 챙겨요',
    '뼈 없는 순살',
    '눈이 편한 조명',
    '공장 건강 검진',
    '입맛 돋우는 신선한 맛',
    '바삭한 식감',
    '넉넉한 양',
    '콜레스테롤 0mg',
    '든든해요',
  ])('%s → 막지 않는다', (text) => {
    expect(kinds(text)).toEqual([])
  })

  it('고지 문맥은 세지 않고, 인증 정보에 같은 말이 있으면 건강기능식품을 실을 수 있다', () => {
    expect(kinds('건강기능식품이 아닙니다')).toEqual([])
    expect(isFactClaimSafe('건강기능식품', null)).toBe(false)
    expect(isFactClaimSafe('건강기능식품', '건강기능식품 품목신고')).toBe(true)
    expect(isFactClaimSafe('장 건강', '건강기능식품 품목신고')).toBe(false)
  })
})
