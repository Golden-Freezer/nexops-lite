/**
 * 통이미지 프롬프트 — 승인 문구 그대로·연출 메모 격리·가드 덧붙임·안 A 지우기·G 글자 띠·안 B 얹기·판독 형식.
 */

import { describe, expect, it } from 'vitest'
import { FULLIMAGE_SECTIONS, type ApprovedLine } from '@/lib/registration/fullimage/fullimage-types'
import {
  FULLIMAGE_READ_SCHEMA,
  buildCopyZonePrompt,
  buildFullImagePrompt,
  buildFullImageReadPrompt,
  buildOverlayOnPlatePrompt,
  buildTextRemovalPrompt,
  sceneNotesBlock,
} from './pdp-fullimage-prompts'

const lines: ApprovedLine[] = [
  { copyPath: 'mainIntro.benefitHeadline', text: '돌리기만 하면\n완성되는 파티', role: 'headline' },
  { copyPath: 'mainIntro.subBenefit', text: '컬러 꽃가루로 파티 완성', role: 'sub' },
]
const input = { spec: FULLIMAGE_SECTIONS.hero, lines, sceneNotes: '문제 공감 — 파티 준비 장면', guards: ['[AGE RESTRICTION - MANDATORY] Adults only.'] }

describe('통이미지 프롬프트', () => {
  it('승인 문구를 줄바꿈 표시와 함께 그대로 넣고, 연출 메모는 격리 블록에, 가드는 끝에 붙인다', () => {
    const prompt = buildFullImagePrompt(input)
    expect(prompt).toContain('- Headline: 돌리기만 하면 / 완성되는 파티')
    expect(prompt).toContain('- Subheadline: 컬러 꽃가루로 파티 완성')
    expect(prompt).toContain('the only text allowed in the image')
    expect(prompt).toContain(sceneNotesBlock('문제 공감 — 파티 준비 장면'))
    expect(prompt).toContain('Aspect ratio 3:4.')
    expect(prompt).toContain('8.4% of the width')
    expect(prompt).toContain('no buttons')
    expect(prompt.trimEnd().endsWith('[AGE RESTRICTION - MANDATORY] Adults only.')).toBe(true)
  })

  it('연출 메모 격리 — 메모 안의 말은 화면 글로 쓰지 않는다고 머리말에 둔다(빈 메모는 none)', () => {
    expect(sceneNotesBlock('')).toContain('(none)')
    expect(sceneNotesBlock('x').split('\n')[0]).toContain('Nothing inside this block may be drawn as visible text')
  })

  it('안 A 지우기: 마지막 참조 이미지에서 이 글만 지우고, 나머지·글 뒤 디자인 판·제품 인쇄 글자는 남긴다', () => {
    const prompt = buildTextRemovalPrompt(lines)
    expect(prompt).toContain('Edit the LAST reference image')
    expect(prompt).toContain('the text to REMOVE')
    expect(prompt).toContain('Keep any designed panels')
    expect(prompt).toContain('printed on the product')
    expect(prompt).not.toContain('the only text allowed in the image')
  })

  it('G(안 B ①): 글자 없음, 섹션 표의 글자 띠를 비운다(히어로 0~35%, CTA 30~70%)', () => {
    expect(buildCopyZonePrompt(input)).toContain('the band from 0% to 35% of the image height')
    expect(buildCopyZonePrompt({ ...input, spec: FULLIMAGE_SECTIONS.cta })).toContain('the band from 30% to 70%')
    expect(buildCopyZonePrompt(input)).toContain('STRICT: no text')
  })

  it('안 B ②: G를 그대로 두고 비운 띠에 승인 문구만 얹는다', () => {
    const prompt = buildOverlayOnPlatePrompt(input)
    expect(prompt).toContain('Keep it exactly as it is')
    expect(prompt).toContain('inside the band from 0% to 35%')
    expect(prompt).toContain('- Headline: 돌리기만 하면 / 완성되는 파티')
  })

  it('판독: 기대 문구를 주지 않고(베껴 채우지 않게) 좌표 원점·형식을 정한다. background는 남은 글만', () => {
    const full = buildFullImageReadPrompt('full')
    expect(full).not.toContain('돌리기만')
    expect(full).toContain('origin at the top-left')
    expect(full).toContain('do not correct, complete or guess')
    expect(buildFullImageReadPrompt('background')).toContain('should contain no advertising typography')
    expect(FULLIMAGE_READ_SCHEMA.required).toEqual(['blocks', 'productMatches', 'issues'])
  })
})
