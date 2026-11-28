/**
 * 후기 유래 규제 표현 검출(R6) — 최종 카피에서 인용 후보 차단과 같은 규제 사전(인증·인허가·의학·기능성)으로 찾아 칸과 함께 남긴다
 * (지우지 않는다). 사용 경험·체감 효익은 세지 않는다.
 */

import { describe, expect, it } from 'vitest'
import type { CopywritingResult } from '../pdp-state'
import { findCopyReviewClaims, REVIEW_CLAIM_RECORD_MAX } from './review-claims'

const copy = (fields: Record<string, unknown>) => fields as unknown as CopywritingResult

describe('findCopyReviewClaims — 후기 유래 규제 표현 검출(R6, 기록만)', () => {
  it('인증·인허가와 의학·기능성 표현을 칸(최상위 키)과 함께 찾는다 — 체감 효익(개운·도움)은 세지 않는다', () => {
    const claims = findCopyReviewClaims(
      copy({
        mainIntro: { hook: '두피 구석까지 개운해져요' },
        solution: { summary: 'KC 인증 받은 소재' },
        detailPoints: [{ title: '탈모 완화', benefit: '탈모 완화에 좋아요' }],
        summary: '정리에 도움이 되는 크기',
      })
    )
    expect(claims).toEqual([
      { kind: 'certification', terms: ['KC 인증'], sections: ['solution'] },
      { kind: 'medical', terms: ['탈모 완화'], sections: ['detailPoints'] },
    ])
  })

  it('고지·부정 문맥, 오너가 정한 글(options·최상위 title), 상품명·옵션 값에 든 표현은 세지 않는다', () => {
    const claims = findCopyReviewClaims(
      copy({
        title: '항균 도마',
        options: ['무독성 실리콘'],
        notice: '의료기기가 아니며 치료 목적이 아닙니다.',
        mainIntro: { hook: '항균 도마로 매일 손질해요' },
        solution: { summary: '부드러운 실리콘 손잡이' },
      }),
      '항균 도마 무독성 실리콘'
    )
    expect(claims).toEqual([])
  })

  it('안쪽 칸의 title은 카피 글이라 센다(최상위 title만 상품명)', () => {
    const claims = findCopyReviewClaims(copy({ pointCards: [{ title: '친환경 소재', description: '' }] }))
    expect(claims).toEqual([{ kind: 'certification', terms: ['친환경'], sections: ['pointCards'] }])
  })

  it(`${REVIEW_CLAIM_RECORD_MAX}건까지만 남긴다`, () => {
    // 서로 다른 규제 표현 40개(칸마다 하나) — 묶음 40개 중 30개만
    const terms = (
      '치료 완치 처방 의학 효능 약효 부작용 아토피 습진 피부염 건선 무좀 비염 천식 당뇨 고혈압 관절염 불면증 우울증 질환 ' +
      '질병 염증 항염 통증 진통 혈행 혈압 혈당 면역력 디톡스 해독 림프 경락 체지방 미백 발모 육모 의료기기 의약품 의약외품'
    ).split(' ')
    const cards = terms.map((t) => ({ title: `${t} 이야기` }))
    expect(findCopyReviewClaims(copy({ pointCards: cards }))).toHaveLength(REVIEW_CLAIM_RECORD_MAX)
  })
})

describe('후기 카드의 original(P1-6)', () => {
  it('화면에 그리지 않는 원문 대조 칸은 세지 않는다 — 보이는 요약만', () => {
    const claims = findCopyReviewClaims(
      copy({
        reviewHighlights: [
          { text: '거품이 잘 나서 편해요.', summary: true, original: '아토피가 나았어요. 거품이 잘 나서 편해요.' },
        ],
      })
    )
    expect(claims).toEqual([])
  })
})
