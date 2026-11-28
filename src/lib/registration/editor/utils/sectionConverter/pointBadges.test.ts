import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '../../types/canvas'
import type { DesignPalette } from '../../types/editor'
import { ProSectionType } from '../../types/section'
import { makeShapeEl, makeTextEl } from './elements'
import { keepCountUnits } from './helpers'
import { alignPointBadges, pointBadgeY } from './pointBadges'
import { createSectionElements } from './sections'

// 핵심 포인트 번호 원 — 제목 첫 줄 중심에 원의 중심(2026-10-30 오너 지시: 번호와 제목이 따로 놓이지 않게)

describe('keepCountUnits — 수량+단위는 한 줄에(B 배치 점검 #4)', () => {
  const NBSP = '\u00A0'
  it('수 낱말 뒤 단위 앞 띄어쓰기만 줄바꿈 없는 공백으로 바꾼다', () => {
    expect(keepCountUnits('봉투 겉면에 한 장 붙여보세요')).toBe(`봉투 겉면에 한${NBSP}장 붙여보세요`)
    expect(keepCountUnits('20 개 구성, 3 분이면 끝')).toBe(`20${NBSP}개 구성, 3${NBSP}분이면 끝`)
    expect(keepCountUnits('두 가지 크기 중 세 번째')).toBe(`두${NBSP}가지 크기 중 세${NBSP}번째`)
    expect(keepCountUnits('10 cm 넓이')).toBe(`10${NBSP}cm 넓이`)
  })

  it('수 낱말이 다른 낱말의 끝이거나 뒤가 단위가 아니면 그대로', () => {
    for (const text of ['정한 장소', '하나 둘', '20개 구성', '한 손에 쏙', '열 차단 소재', '미세모를 대고'])
      expect(keepCountUnits(text)).toBe(text)
  })
})

function pointSection(title: { fontSize: number; lineHeight: number; y: number }, badgeY: number): CanvasSection {
  return {
    id: 'p',
    sectionType: 'point_div',
    canvas: { width: 860, height: 1200, backgroundColor: '#FFFFFF' },
    elements: [
      makeShapeEl(
        'point_badge_0',
        'circle',
        60,
        badgeY,
        64,
        64,
        { fill: '#C2410C', cx: 92, cy: badgeY + 32, radius: 32 },
        3
      ),
      makeTextEl('point_num_0', '1', 'caption', 60, badgeY + 8, 64, '#FFFFFF', 'center', 4, {
        fontSize: 36,
        height: 47,
      }),
      makeTextEl('point_0_title', '미세모', 'h2', 144, title.y, 656, '#C2410C', 'left', 3, {
        fontSize: title.fontSize,
        lineHeight: title.lineHeight,
        height: 108,
      }),
      makeTextEl('point_0_desc', '설명', 'body', 144, title.y + 120, 656, '#262626', 'left', 3),
    ],
  } as unknown as CanvasSection
}

const el = (section: CanvasSection, name: string) => section.elements.find((e) => e.name === name)!

describe('pointBadgeY — 원의 중심 = 제목 첫 줄(글자 크기 × 행간)의 중심', () => {
  it('h2 60px·행간 1.8(줄 상자 108)이면 원(64)은 제목 위에서 22 아래', () => {
    const title = makeTextEl('point_0_title', '미세모', 'h2', 144, 100, 656, '#000', 'left', 3, { fontSize: 60 })
    expect(title.textProps!.lineHeight).toBe(1.8)
    expect(pointBadgeY(title, 64)).toBe(122)
  })
})

describe('alignPointBadges — 테마·하한이 제목을 바꾼 뒤 다시 붙인다', () => {
  it('원·숫자·원 중심(cy)을 같은 만큼 옮기고 제목·설명은 그대로', () => {
    // 테마가 제목을 64px·행간 1.4(줄 상자 89.6)로 바꾼 상태 — 원은 예전 위치(제목 위 22)
    const [out] = alignPointBadges([pointSection({ fontSize: 64, lineHeight: 1.4, y: 100 }, 122)])
    const badge = el(out, 'point_badge_0')
    expect(badge.transform.y).toBe(113)
    expect(badge.shapeProps!.cy).toBe(badge.transform.y + 32)
    expect(el(out, 'point_num_0').transform.y).toBe(badge.transform.y + 8)
    expect(el(out, 'point_0_title').transform.y).toBe(100)
    expect(el(out, 'point_0_desc').transform.y).toBe(220)
  })

  it('이미 맞거나 핵심 포인트가 아니면 섹션을 그대로 돌려준다', () => {
    const aligned = pointSection({ fontSize: 60, lineHeight: 1.8, y: 100 }, 122)
    const other = {
      ...pointSection({ fontSize: 64, lineHeight: 1.4, y: 100 }, 122),
      sectionType: 'sub_div',
    } as CanvasSection
    const [a, b] = alignPointBadges([aligned, other])
    expect(a).toBe(aligned)
    expect(b).toBe(other)
  })
})

describe('createSectionElements — 핵심 포인트·추가 특징 빌더', () => {
  const PALETTE = {
    primary: '#C2410C',
    secondary: '#BE185D',
    bgMain: '#FDF2F8',
    bgSub: '#FFF7ED',
    textMain: '#262626',
    textHighlight: '#D63384',
  } as unknown as DesignPalette
  const features = ['f0', 'f1', 'f2', 'f3'].map((k) => `https://img.test/${k}.png`)
  const named = (els: CanvasElement[], name: string) => els.find((e) => e.name === name)!

  it('나뉜 섹션(offset 3): 번호 4, 원은 제목 첫 줄 중심, 제목은 행간 1.3·수량 단위 붙임, 사진은 features[3]·4:5 칸', () => {
    const els = createSectionElements(
      ProSectionType.POINT_DIV,
      { points: [{ title: '봉투 겉면에 한 장 붙여보세요', description: '곰돌이 스티커' }] },
      null,
      PALETTE,
      { split: { first: false, offset: 3 }, allImages: { features } }
    )
    expect(els.some((e) => e.name.startsWith('chapter_title'))).toBe(false)
    const title = named(els, 'point_0_title')
    const badge = named(els, 'point_badge_0')
    expect(named(els, 'point_num_0').textProps!.content).toBe('4')
    expect(title.textProps!.content).toBe('봉투 겉면에 한\u00A0장 붙여보세요')
    expect(title.textProps!.lineHeight).toBe(1.3)
    expect(badge.transform.y + badge.transform.height / 2).toBe(title.transform.y + (60 * 1.3) / 2)
    // 두 줄 제목: 상자는 두 줄(60 × 1.3 × 2), 설명은 그 아래 12
    expect(title.transform.height).toBe(156)
    expect(named(els, 'point_0_desc').transform.y).toBe(title.transform.y + 156 + 12)
    const photo = named(els, 'point_0_img')
    expect(photo.imageProps!.src).toBe(features[3])
    expect(photo.transform).toMatchObject({ width: 860, height: 1075 })
  })

  it('모바일 한 열 추가 특징: 피처 컷은 4:5 칸, 1:1로 만드는 사용법 컷은 1:1 칸(원본 비율)', () => {
    const howTo = 'https://img.test/howto0.png'
    const els = createSectionElements(
      ProSectionType.SUB_DIV,
      {
        points: [
          { title: '첫째', description: '설명', image: features[3] },
          { title: '둘째', description: '설명', image: howTo },
        ],
      },
      null,
      PALETTE,
      { mobileFloor: true, dedupe: true, allImages: { features, howToImages: [howTo] } }
    )
    expect(named(els, 'sub_0_img').transform).toMatchObject({ width: 860, height: 1075 })
    expect(named(els, 'sub_1_img').transform).toMatchObject({ width: 860, height: 860 })
  })
})
