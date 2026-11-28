/**
 * 편집기에서 오너가 섹션을 수동으로 추가할 때(createPlaceholderSection — 카피·컷 없음) 사진 칸이 빈 채로 깨지지 않고 글·안내로
 * 그려진다(W5 결정 i). lean 잡은 골격 밖 섹션의 컷을 만들지 않으므로 그 섹션의 사진은 섹션 행의 'AI로 이 섹션 사진 만들기'(W5b —
 * 재생성이 아는 섹션 키를 받는다, regenTarget addableImageKey)나 업로드·보관함으로 채운다. 이 시험은 수동 추가 경로 자체를 고정한다
 * (잡 이미지와 무관 — lean 여부와 상관없이 같다).
 */

import { describe, expect, it } from 'vitest'
import { ProSectionType } from '../../types/section'
import type { DesignPalette } from '../../types/editor'
import { createPlaceholderSection } from './labels'

const PALETTE = {
  primary: '#3366CC',
  secondary: '#88AADD',
  accent: '#FFAA00',
  bgMain: '#FFFFFF',
  bgSub: '#F5F5F5',
  textMain: '#1A1A1A',
  textSub: '#666666',
  textHighlight: '#3366CC',
} as unknown as DesignPalette

describe('수동 추가 섹션 — 컷이 없어도 빈 사진 칸이 없다', () => {
  it.each(Object.values(ProSectionType))('%s', (type) => {
    const section = createPlaceholderSection(type, PALETTE, 0)
    const images = section.elements.filter((el) => el.type === 'image' || el.type === 'framed-image')
    expect(images.filter((el) => !(el.imageProps?.src ?? el.framedImageProps?.src))).toEqual([])
    expect(section.canvas.height).toBeGreaterThan(0)
    // 글·안내가 하나 이상 — key_message는 빈 내용이면 도형 두 개만 그린다(기존 동작, 예외로 둔다)
    const texts = section.elements.filter((el) => el.textProps?.content)
    if (type === ProSectionType.KEY_MESSAGE) expect(section.elements.length).toBeGreaterThan(0)
    else expect(texts.length).toBeGreaterThan(0)
  })
})
