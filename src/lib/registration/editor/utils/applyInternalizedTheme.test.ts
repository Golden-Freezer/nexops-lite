// 내재화 테마 에디터 적용(결정 T-5) 단위 테스트 — 배경+타이포만, typoLevel 분류·캡션 보호·
// 사용자 편집 키 보존·테마 없는 섹션 무접촉 계약을 고정한다.

import { describe, it, expect } from 'vitest';
import { applyInternalizedTheme } from './applyInternalizedTheme';
import { ProSectionType } from '@/lib/registration/editor/types/section';
import type { CanvasSection, CanvasElement } from '@/lib/registration/editor/types/canvas';

function textElement(id: string, fontSize: number, typoLevel?: 'display' | 'h1' | 'h2' | 'body' | 'caption', userStyledKeys?: string[]): CanvasElement {
  return {
    id,
    type: 'text',
    name: id,
    transform: { x: 0, y: 0, width: 400, height: 100, rotation: 0 },
    zIndex: 1,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    textProps: {
      content: '텍스트',
      fontFamily: 'Pretendard',
      fontSize,
      fontWeight: 400,
      fontStyle: 'normal',
      textDecoration: 'none',
      color: '#333333',
      textAlign: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      ...(typoLevel ? { typoLevel } : {}),
      ...(userStyledKeys ? { userStyledKeys } : {}),
    },
  };
}

function section(type: ProSectionType, elements: CanvasElement[]): CanvasSection {
  return {
    id: `sec-${type}`,
    sectionType: type,
    groupType: 'usp',
    order: 0,
    isVisible: true,
    layoutId: `${type}_layout_01`,
    canvas: { width: 860, height: 800, backgroundColor: '#FFFFFF' },
    elements,
  };
}

const THEME = {
  [ProSectionType.POINT_DIV]: {
    headlinePx: 46,
    bodyPx: 33,
    lineHeightRatio: 1.1,
    paddingPx: 63,
    gapPx: 38,
    backgroundHex: '#F5F5F5',
  },
};

describe('applyInternalizedTheme', () => {
  it('typoLevel 기준으로 헤드라인/본문 px와 행간을 적용하고 배경을 바꾼다', () => {
    const input = [section(ProSectionType.POINT_DIV, [textElement('h', 60, 'h1'), textElement('b', 45, 'body')])];
    const [out] = applyInternalizedTheme(input, THEME);
    expect(out.canvas.backgroundColor).toBe('#F5F5F5');
    expect(out.elements[0].textProps!.fontSize).toBe(46);
    expect(out.elements[1].textProps!.fontSize).toBe(33);
    expect(out.elements[0].textProps!.lineHeight).toBe(1.1);
  });

  it('caption·소형 텍스트(<30px)는 건드리지 않는다 — 확대 부작용 방지', () => {
    const input = [section(ProSectionType.POINT_DIV, [textElement('cap', 24, 'caption'), textElement('small', 22)])];
    const [out] = applyInternalizedTheme(input, THEME);
    expect(out.elements[0].textProps!.fontSize).toBe(24);
    expect(out.elements[1].textProps!.fontSize).toBe(22);
  });

  it('typoLevel 미기록 요소는 크기 폴백으로 분류한다(≥50 헤드라인 · 30~49 본문)', () => {
    const input = [section(ProSectionType.POINT_DIV, [textElement('big', 72), textElement('mid', 40)])];
    const [out] = applyInternalizedTheme(input, THEME);
    expect(out.elements[0].textProps!.fontSize).toBe(46);
    expect(out.elements[1].textProps!.fontSize).toBe(33);
  });

  it('사용자가 편집한 키(userStyledKeys)는 보존한다', () => {
    const input = [section(ProSectionType.POINT_DIV, [textElement('h', 60, 'h1', ['fontSize'])])];
    const [out] = applyInternalizedTheme(input, THEME);
    expect(out.elements[0].textProps!.fontSize).toBe(60);
  });

  it('테마 항목이 없는 섹션(cta 등)과 비텍스트 요소는 무접촉이다', () => {
    const untouched = section(ProSectionType.CTA, [textElement('h', 60, 'h1')]);
    const [out] = applyInternalizedTheme([untouched], THEME);
    expect(out).toBe(untouched);
  });
});

describe('applyInternalizedTheme — R4 tokenRhythm(persuasion 기록 잡, 디자인 컷 제외)', () => {
  const R4 = { tokenRhythm: true };
  const BIG = {
    [ProSectionType.POINT_DIV]: { ...THEME[ProSectionType.POINT_DIV], headlinePx: 64, bodyPx: 33 },
  };

  it('행간·바탕은 덮지 않고, 크기는 지금보다 클 때만 올린다', () => {
    const input = section(ProSectionType.POINT_DIV, [textElement('title', 60, 'h2'), textElement('desc', 45, 'body')]);
    const [out] = applyInternalizedTheme([input], BIG, R4);
    expect(out.canvas.backgroundColor).toBe('#FFFFFF');
    expect(out.elements[0].textProps!.fontSize).toBe(64);
    expect(out.elements[0].textProps!.lineHeight).toBe(1.4);
    expect(out.elements[1]).toBe(input.elements[1]); // 본문 33 < 45 — 내리지 않는다
  });

  it('display·h1·섹션 라벨 헤더(슬롯 이름 또는 68px)는 그대로 — 바뀐 글자가 없으면 같은 섹션 객체', () => {
    const huge = { [ProSectionType.POINT_DIV]: { ...THEME[ProSectionType.POINT_DIV], headlinePx: 90 } };
    const input = section(ProSectionType.POINT_DIV, [
      textElement('hero', 72, 'display'),
      textElement('headline', 72, 'h1'),
      textElement('chapter_title', 60, 'h2'),
      textElement('label', 68, 'h2'),
      textElement('caption', 28, 'caption'),
    ]);
    const [out] = applyInternalizedTheme([input], huge, R4);
    expect(out).toBe(input);
  });

  it('기록 없는 잡(기본)은 기존 그대로 — 행간 1.1·코퍼스 바탕·작은 크기로 덮는다', () => {
    const input = section(ProSectionType.POINT_DIV, [textElement('title', 60, 'h2')]);
    const [out] = applyInternalizedTheme([input], THEME);
    expect(out.canvas.backgroundColor).toBe('#F5F5F5');
    expect(out.elements[0].textProps).toMatchObject({ fontSize: 46, lineHeight: 1.1 });
  });
});
