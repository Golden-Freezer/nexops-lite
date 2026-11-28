import { describe, expect, it } from 'vitest'
import { PRO_IMAGE_PROMPTS } from '@/lib/agents/registration/prompts/pdp-image-pro-prompts'
import { cutFailureNotes, cutFailureReason, cutFailureSummary, cutLabel, gateWarningNotes } from './cut-failures'
import { OPTION_BUNDLE_SECTION } from './pdp-image-tasks'

describe('cutFailureSummary', () => {
  it('사진 없는 컷을 세고 hero를 표시한다', () => {
    expect(cutFailureSummary([{ section: 'hero', url: '' }, { section: 'cta', url: 'x' }])).toEqual({ cutsFailed: 1, cutsFailedSections: ['hero'], heroFailed: true })
    expect(cutFailureSummary([{ section: 'cta', url: 'x' }])).toEqual({ cutsFailed: 0, cutsFailedSections: [], heroFailed: false })
  })
})

describe('cutLabel', () => {
  it('아는 컷은 이름, 번호 컷은 1부터, 모르는 키는 그대로', () => {
    expect(cutLabel('hero')).toBe('첫 화면')
    expect(cutLabel('features:0')).toBe('특징 1')
    expect(cutLabel('howto:2')).toBe('사용법 3')
    expect(cutLabel('long_scene:1')).toBe('사용 장면 2')
    expect(cutLabel('mystery')).toBe('mystery')
  })

  it('플레이트는 섹션 이름에 배경을 붙이고, 모르는 섹션이어도 키를 보이지 않는다', () => {
    expect(cutLabel('plate:cta')).toBe('마무리 배경')
    expect(cutLabel('plate:features:1')).toBe('특징 2 배경')
    expect(cutLabel('plate:long:shot:0')).toBe('추가 컷 1 배경')
    expect(cutLabel('plate:mystery')).toBe('배경')
  })

  it('긴 페이지 추가 컷은 1부터 센다', () => {
    expect(cutLabel('long:shot:2')).toBe('추가 컷 3')
  })

  it('이미지 태스크가 만드는 키에 이름이 있다 — 화면에 키가 그대로 나오지 않는다', () => {
    const keys = ['hero', 'problem', 'solution', 'usage', 'cta', 'size_comparison', 'sold_out_banner', OPTION_BUNDLE_SECTION, ...Object.keys(PRO_IMAGE_PROMPTS)]
    for (const key of keys) expect(cutLabel(key), key).not.toBe(key)
  })
})

describe('cutFailureReason', () => {
  it('실제 기록된 사유를 나눈다(R8 API 잡)', () => {
    expect(cutFailureReason('usage 생성 실패: OpenAI 이미지 생성 실패(400): Your request was rejected by the safety system.')).toBe('안전 심사 거부')
    expect(cutFailureReason('howto:0 생성 실패: OpenAI 이미지 생성 시간 초과(100초, 1회 시도)')).toBe('시간 초과')
    expect(cutFailureReason('hero 생성 실패: codex-image 생성 실패(2회 시도): 종료코드 0 · 산출 파일 없음')).toBe('생성 실패')
    expect(cutFailureReason(undefined)).toBe('생성 실패')
  })
})

describe('cutFailureNotes', () => {
  it('사진 없는 컷만 이름·사유로 낸다', () => {
    expect(
      cutFailureNotes([
        { section: 'usage', url: '', error: 'rejected by the safety system' },
        { section: 'features:0', url: 'x', error: '재생성 실패' },
      ])
    ).toEqual([{ section: 'usage', label: '사용 장면', reason: '안전 심사 거부' }])
  })

  const images = [
    { section: 'usage', url: '', error: '시간 초과' },
    { section: 'features:5', url: '', error: '옛 계획의 컷' },
    { section: 'howto:0', url: 'x' },
  ]

  it('기록이 있으면 기록한 컷만 알린다 — 지금 계획에 없는 옛 항목은 세지 않는다', () => {
    expect(cutFailureNotes(images, { sections: ['usage'] }).map((n) => n.section)).toEqual(['usage'])
  })

  it('기록이 0건이면 알리지 않는다', () => {
    expect(cutFailureNotes(images, { sections: [] })).toEqual([])
  })

  it('기록 뒤 다시 만들어 사진이 생긴 컷은 뺀다', () => {
    expect(cutFailureNotes(images, { sections: ['usage', 'howto:0'] }).map((n) => n.section)).toEqual(['usage'])
  })

  it('기록이 없는 예전 잡은 전체를 본다', () => {
    expect(cutFailureNotes(images).map((n) => n.section)).toEqual(['usage', 'features:5'])
    expect(cutFailureNotes(images, null).map((n) => n.section)).toEqual(['usage', 'features:5'])
  })
})

describe('점검 고침 1 — 뺀 컷·확인이 필요한 컷', () => {
  it('상품 불일치로 뺀 컷은 사유가 따로 보이고, 사진이 있는 대표 컷 경고는 따로 모인다', () => {
    const images = [
      { section: 'hero', url: 'https://x/hero.png', gateWarning: '첫 화면 대표 컷이 재생성 뒤에도 원본과 달라 보임' },
      { section: 'k3_photo_0', url: '', error: '게이트 미달(재판정 뒤, structure, 새 컷을 씀) — 페이지에서 뺌(상품 불일치: braid)' },
      { section: 'k4_photo_0', url: 'https://x/k4.png' },
    ]
    expect(cutFailureNotes(images)).toEqual([{ section: 'k3_photo_0', label: 'k3_photo_0', reason: '원본과 다른 상품이라 뺌' }])
    expect(gateWarningNotes(images)).toEqual([{ section: 'hero', label: '첫 화면', warning: '첫 화면 대표 컷이 재생성 뒤에도 원본과 달라 보임' }])
    expect(gateWarningNotes([{ section: 'hero', url: '', gateWarning: 'x' }])).toEqual([])
  })
})
