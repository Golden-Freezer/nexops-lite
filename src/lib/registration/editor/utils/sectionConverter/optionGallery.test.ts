import { describe, expect, it } from 'vitest';
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import { parseOptionLabels, type OptionSpec, type OptionVariant } from '@/lib/registration/options/option-spec';
import { FAIRNEX_OPTION_LABELS } from '@/lib/registration/options/__fixtures__/fairnex-option-labels';
import { buildOptionGalleryElements, OPTION_GALLERY_LIMITS, type OptionGalleryResult } from './optionGallery';
import { exportRenderHtml } from '../exportUtils/htmlBuilders';

const palette: DesignPalette = {
  primary: '#7EB8C9', secondary: '#8B9E6B', bgMain: '#FFFFFF', bgSub: '#F5F5F5', textMain: '#1A1A1A', textHighlight: '#7EB8C9',
};
const START_Y = 300;

function specOf(labels: readonly string[], patch?: (v: OptionVariant) => Partial<OptionVariant>): OptionSpec {
  const { spec } = parseOptionLabels(labels);
  return patch ? { ...spec, variants: spec.variants.map((v) => ({ ...v, ...patch(v) })) } : spec;
}
const photo = (v: OptionVariant) => ({ sourceImage: `https://cdn.example.com/${encodeURIComponent(v.label)}.jpg` });
const build = (spec: OptionSpec, extra: { bundleImageUrl?: string; representativeImageUrl?: string } = {}) =>
  buildOptionGalleryElements({ spec, palette, startY: START_Y, ...extra });

const named = (r: OptionGalleryResult, prefix: string) => r.elements.filter((e) => e.name.startsWith(prefix));
const texts = (r: OptionGalleryResult, prefix: string) => named(r, prefix).map((e) => e.textProps?.content);
const BOX_PREFIXES = ['option_card_bg', 'option_chip_bg', 'option_qty_bg', 'option_size_row_bg'];

/** 모바일 판독 규칙 공통 단언(M1·M5·M6·M7) */
function expectMobileSafe(r: OptionGalleryResult): void {
  const boxes = r.elements.filter((e) => BOX_PREFIXES.some((p) => e.name.startsWith(p)));
  expect(boxes.length).toBeLessThanOrEqual(OPTION_GALLERY_LIMITS.maxCards);
  for (const e of r.elements) {
    expect(e.transform.x).toBeGreaterThanOrEqual(0);
    expect(e.transform.x + e.transform.width).toBeLessThanOrEqual(860);
    expect(e.transform.y).toBeGreaterThanOrEqual(START_Y);
    if (e.type === 'text') expect(e.textProps!.fontSize).toBeGreaterThanOrEqual(28);
  }
  for (const box of boxes) expect(box.transform.width).toBeGreaterThanOrEqual(380);
  for (const img of named(r, 'option_card_img')) expect(img.transform.height).toBeGreaterThanOrEqual(360);
  for (const img of [...named(r, 'option_bundle_img'), ...named(r, 'option_representative_img')]) {
    expect(img.transform.height).toBeGreaterThanOrEqual(500);
  }
  const twoColumnTexts = r.elements.filter(
    (e: CanvasElement) => e.type === 'text' && e.transform.width < OPTION_GALLERY_LIMITS.singleColumnWidth - 100,
  );
  for (const t of twoColumnTexts) expect([...(t.textProps!.content ?? '')].length).toBeLessThanOrEqual(40);
  const allText = r.elements.map((e) => e.textProps?.content ?? '').join('\n');
  for (const banned of ['원', '가격', '%', '할인', '인기']) expect(allText).not.toContain(banned);
  const bottom = Math.max(START_Y, ...r.elements.map((e) => e.transform.y + e.transform.height));
  expect(r.height).toBe(bottom - START_Y);
}

describe('buildOptionGalleryElements — 디자인 축', () => {
  it('P01 스티커: 디자인 6종 사진 카드 + 불완전 교차는 카드별 수량 caption', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P01, photo));
    expect(r.mode).toBe('design_cards');
    expect(named(r, 'option_card_bg')).toHaveLength(6);
    expect(texts(r, 'option_card_label')).toEqual([
      '생일답례-01', '생일답례-02', '생일답례-03', '생일답례-04', '생일답례-05', '생일답례-07',
    ]);
    expect(texts(r, 'option_card_caption')).toEqual([
      '20개·50개', '20개·50개', '20개·50개', '20개·30개·50개', '20개·50개', '20개·50개',
    ]);
    expect(named(r, 'option_axis_line')).toHaveLength(0);
    expect(r.shownCount).toBe(6);
    expect(r.omittedCount).toBe(0);
    expect(r.warnings).toEqual([]);
    expectMobileSafe(r);
  });

  it('완전 교차면 카드 아래 한 줄로 수량 구성 안내', () => {
    const r = build(specOf(['20개 꽃-01', '50개 꽃-01', '20개 꽃-02', '50개 꽃-02'], photo));
    expect(texts(r, 'option_card_label')).toEqual(['꽃-01', '꽃-02']);
    expect(named(r, 'option_card_caption')).toHaveLength(0);
    expect(texts(r, 'option_axis_line')).toEqual(['각 디자인 20개·50개 구성']);
    expectMobileSafe(r);
  });

  it('P02 구디백: 옵션 하나에 대응하는 카드는 등록 옵션명 그대로', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P02, photo));
    expect(r.mode).toBe('design_cards');
    expect(texts(r, 'option_card_label')).toEqual(['20개 데이지(S)', '20개 체리(L)']);
    expect(named(r, 'option_card_img').map((e) => e.imageProps?.src)).toEqual([
      `https://cdn.example.com/${encodeURIComponent('20개 데이지(S)')}.jpg`,
      `https://cdn.example.com/${encodeURIComponent('20개 체리(L)')}.jpg`,
    ]);
    expectMobileSafe(r);
  });

  it('디자인 8종: 앞 6개 + "외 2종"', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `20개 꽃-0${i + 1}`);
    const r = build(specOf(labels, photo));
    expect(named(r, 'option_card_bg')).toHaveLength(6);
    expect(texts(r, 'option_more')).toEqual(['외 2종']);
    expect(r.omittedCount).toBe(2);
    expectMobileSafe(r);
  });

  it('41자 이상 라벨은 1열(폭 740)', () => {
    const long = '아주긴디자인이름'.repeat(5);
    const r = build(specOf([`20개 ${long}-01`, `20개 ${long}-02`], photo));
    expect(named(r, 'option_card_bg').map((e) => e.transform.width)).toEqual([740, 740]);
    expectMobileSafe(r);
  });

  it('placeholder 사진은 없는 것으로 보고 칩만', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P02, () => ({ sourceImage: 'https://placehold.co/600x400' })));
    expect(r.mode).toBe('chips');
    expect(named(r, 'option_card_img')).toHaveLength(0);
    expect(texts(r, 'option_chip_label')).toEqual(['20개 데이지(S)', '20개 체리(L)']);
    expect(r.warnings).toEqual(['missing_variant_images:2']);
    expectMobileSafe(r);
  });
});

describe('buildOptionGalleryElements — 색상·사이즈·수량 축', () => {
  it('색상 2종 중 1종만 사진: 사진 카드 1 + 이름 칩 1(색을 생성하지 않는다)', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.neckWarmer, (v) => (v.values.color === '라이트 크림' ? photo(v) : {})));
    expect(r.mode).toBe('color_cards');
    expect(texts(r, 'option_card_label')).toEqual(['1개 라이트 크림']);
    expect(texts(r, 'option_chip_label')).toEqual(['1개 오가닉 블랙']);
    expect(r.warnings).toEqual(['missing_variant_images:1']);
    expectMobileSafe(r);
  });

  it('색상 사진이 하나도 없으면 chips', () => {
    expect(build(specOf(FAIRNEX_OPTION_LABELS.neckWarmer)).mode).toBe('chips');
  });

  it('사이즈만 변함 + 치수 사실 → 크기 표 + 대표 사진', () => {
    const facts: Record<string, string[]> = { S: ['가로 12cm'], M: ['가로 16cm'] };
    const spec = specOf(['1개 블랙 S', '1개 블랙 M', '1개 블랙 L'], (v) => (facts[v.values.size!] ? { facts: facts[v.values.size!] } : {}));
    const r = build(spec, { representativeImageUrl: 'https://cdn.example.com/rep.jpg' });
    expect(r.mode).toBe('size_table');
    expect(texts(r, 'option_size_row_label')).toEqual(['S  가로 12cm', 'M  가로 16cm', 'L']);
    expect(named(r, 'option_representative_img')[0].transform.height).toBe(560);
    expectMobileSafe(r);
  });

  it('사이즈 치수 사실이 없으면 표를 만들지 않는다', () => {
    const r = build(specOf(['1개 블랙 S', '1개 블랙 M']), { representativeImageUrl: 'https://cdn.example.com/rep.jpg' });
    expect(r.mode).toBe('chips');
    expect(r.warnings).toEqual(['size_facts_missing']);
    expect(named(r, 'option_size_row')).toHaveLength(0);
    expect(named(r, 'option_representative_img')).toHaveLength(0);
    expectMobileSafe(r);
  });

  it('P05 수량: 구성 카드 + 묶음 연출 컷', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P05), { bundleImageUrl: 'https://cdn.example.com/bundle.jpg' });
    expect(r.mode).toBe('quantity_cards');
    expect(texts(r, 'option_qty_label')).toEqual(['2개 구성', '4개 구성']);
    expect(named(r, 'option_bundle_img')[0].transform.height).toBe(560);
    expectMobileSafe(r);
  });

  it('P10 수량 6종 + 묶음 컷 없음', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P10));
    expect(texts(r, 'option_qty_label')).toEqual(['1개 구성', '2개 구성', '3개 구성', '4개 구성', '5개 구성', '6개 구성']);
    expect(named(r, 'option_bundle_img')).toHaveLength(0);
    expectMobileSafe(r);
  });

  it('보습양말: 수량 × 색상(완전 교차) → 색상 카드 + 수량 안내 줄', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.socks, photo));
    expect(r.mode).toBe('color_cards');
    expect(texts(r, 'option_card_label')).toEqual(['딥 블랙', '스킨 베이지']);
    expect(texts(r, 'option_axis_line')).toEqual(['각 색상 2개 2매입·4개 2매입 구성']);
    expectMobileSafe(r);
  });
});

describe('buildOptionGalleryElements — 검수 반영 경계', () => {
  it('사진 카드 + 칩 혼합 8종: 사진 우선으로 합계 6개 + "외 2종"', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `20개 꽃-0${i + 1}`);
    const r = build(specOf(labels, (v) => (['20개 꽃-02', '20개 꽃-05', '20개 꽃-07'].includes(v.label) ? photo(v) : {})));
    expect(texts(r, 'option_card_label')).toEqual(['20개 꽃-02', '20개 꽃-05', '20개 꽃-07']);
    expect(texts(r, 'option_chip_label')).toEqual(['20개 꽃-01', '20개 꽃-03', '20개 꽃-04']);
    expect(texts(r, 'option_more')).toEqual(['외 2종']);
    expect(r.warnings).toEqual(['missing_variant_images:5']);
    expectMobileSafe(r);
  });

  it('열당 40자는 2열, 41자는 1열(M6 경계)', () => {
    const labelsOf = (n: number) => [`20개 ${'가'.repeat(n)}-01`, `20개 ${'가'.repeat(n)}-02`];
    expect([...labelsOf(33)[0]].length).toBe(40);
    const two = build(specOf(labelsOf(33), photo));
    const one = build(specOf(labelsOf(34), photo));
    expect(named(two, 'option_card_bg').map((e) => e.transform.width)).toEqual([400, 400]);
    expect(named(one, 'option_card_bg').map((e) => e.transform.width)).toEqual([740, 740]);
    expectMobileSafe(two);
    expectMobileSafe(one);
  });

  it('변하는 축이 없는 서로 다른 라벨은 등록 옵션명 칩', () => {
    const r = build(specOf(['1개 검정 Free', '1개 Free 검정']));
    expect(r.mode).toBe('chips');
    expect(texts(r, 'option_chip_label')?.sort()).toEqual(['1개 Free 검정', '1개 검정 Free'].sort());
    expectMobileSafe(r);
  });
});

describe('buildOptionGalleryElements — 경계', () => {
  it('단일 옵션은 아무것도 만들지 않는다', () => {
    const r = build(specOf(['1개 세이지 그린'], photo));
    expect(r).toEqual({ elements: [], height: 0, mode: 'none', shownCount: 0, omittedCount: 0, warnings: [] });
  });

  it('카드 배경이 사진·라벨·caption을 컨테이너로 감싼다', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P01, photo));
    const bg = named(r, 'option_card_bg_3')[0];
    const childNames = r.elements.filter((e) => bg.containerOf?.includes(e.id)).map((e) => e.name);
    expect(childNames).toEqual(['option_card_img_3', 'option_card_label_3', 'option_card_caption_3']);
  });

  it('혼자인 사진 카드·칩은 가운데 넓은 1열(R2-3 — 2열 왼쪽 칸에만 놓지 않는다)', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P02, (v) => (v.values.design === '데이지' ? photo(v) : {})));
    expect(r.mode).toBe('design_cards');
    const [card] = named(r, 'option_card_bg');
    const [chip] = named(r, 'option_chip_bg');
    for (const box of [card, chip]) {
      expect(box.transform.width).toBe(OPTION_GALLERY_LIMITS.singleColumnWidth);
      expect(box.transform.x * 2 + box.transform.width).toBe(860);
    }
    // 혼자인 사진 카드는 정사각 상자 + contain — 상품이 잘리지 않는다(R2 ⑦)
    const [img] = named(r, 'option_card_img');
    expect(img.transform.height).toBe(OPTION_GALLERY_LIMITS.loneImageHeight);
    expect(img.imageProps?.objectFit).toBe('contain');
    expectMobileSafe(r);
  });

  it('1열 사진은 contain — 긴 이름 때문에 1열인 여러 장은 높이 480, 2열은 cover 그대로(R2 ⑦)', () => {
    const long = '아주긴디자인이름'.repeat(5);
    const oneCol = build(specOf([`20개 ${long}-01`, `20개 ${long}-02`], photo));
    for (const img of named(oneCol, 'option_card_img')) {
      expect(img.transform.height).toBe(OPTION_GALLERY_LIMITS.singleColumnImageHeight);
      expect(img.imageProps?.objectFit).toBe('contain');
    }
    const twoCol = build(specOf(FAIRNEX_OPTION_LABELS.P02, photo));
    for (const img of named(twoCol, 'option_card_img')) {
      expect(img.transform.height).toBe(OPTION_GALLERY_LIMITS.cardImageHeight);
      expect(img.imageProps?.objectFit).toBe('cover');
    }
  });

  it('2열 마지막 행에 혼자 남은 사진 카드는 가운데(R2 ② — P01 사진 5장)', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P01, photo));
    const cards = named(r, 'option_card_bg');
    expect(cards).toHaveLength(6);
    const xs = cards.map((e) => e.transform.x);
    expect(xs.slice(0, 6)).toEqual([20, 440, 20, 440, 20, 440]);
    const five = build(specOf(FAIRNEX_OPTION_LABELS.P01, (v) => (v.values.design?.endsWith('07') ? {} : photo(v))));
    const fiveCards = named(five, 'option_card_bg');
    expect(fiveCards).toHaveLength(5);
    const last = fiveCards[4];
    expect(last.transform.width).toBe(OPTION_GALLERY_LIMITS.columnWidth);
    expect(last.transform.x * 2 + last.transform.width).toBe(860);
    // 같은 행 짝이 있는 칸은 그대로
    expect(fiveCards.slice(0, 4).map((e) => e.transform.x)).toEqual([20, 440, 20, 440]);
    // 가운데로 옮긴 카드의 사진·라벨도 바탕과 같은 x(containerOf)
    for (const id of last.containerOf ?? []) {
      const child = five.elements.find((e) => e.id === id)!;
      expect(child.transform.x).toBeGreaterThanOrEqual(last.transform.x);
      expect(child.transform.x + child.transform.width).toBeLessThanOrEqual(last.transform.x + last.transform.width);
    }
    expect(last.containerOf?.length).toBeGreaterThanOrEqual(2);
    expectMobileSafe(five);
  });

  it('칩·수량 카드도 2열 마지막 행에 혼자 남으면 가운데(R2 ②)', () => {
    const centered = (e: CanvasElement) => e.transform.x * 2 + e.transform.width === 860;
    const chips = build(specOf(['20개 꽃-01', '20개 꽃-02', '20개 꽃-03']));
    expect(chips.mode).toBe('chips');
    const chipBoxes = named(chips, 'option_chip_bg');
    expect(chipBoxes.slice(0, 2).map((e) => e.transform.x)).toEqual([20, 440]);
    expect(centered(chipBoxes[2])).toBe(true);
    expectMobileSafe(chips);
    const qty = build(specOf(['1개 블랙', '2개 블랙', '3개 블랙']));
    expect(qty.mode).toBe('quantity_cards');
    const qtyBoxes = named(qty, 'option_qty_bg');
    expect(qtyBoxes.slice(0, 2).map((e) => e.transform.x)).toEqual([20, 440]);
    expect(centered(qtyBoxes[2])).toBe(true);
    expectMobileSafe(qty);
  });

  it('두 개 이상이면 기존 2열 그대로', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P02, photo));
    expect(named(r, 'option_card_bg').map((e) => [e.transform.x, e.transform.width])).toEqual([
      [20, 400],
      [440, 400],
    ]);
  });

  it('같은 행 카드는 높이가 같다', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P01, photo));
    const heights = named(r, 'option_card_bg').map((e) => e.transform.height);
    expect(heights[0]).toBe(heights[1]);
    expect(heights[2]).toBe(heights[3]);
  });
});

describe('buildOptionGalleryElements — 카드 사진 모서리(R3)', () => {
  it('사진 위 모서리를 카드 반경에 맞춰 자른다 — 2열·1열·혼자 카드 모두, 아래 모서리는 라벨 쪽이라 각지게', () => {
    for (const r of [
      build(specOf(FAIRNEX_OPTION_LABELS.P01, photo)),
      build(specOf(FAIRNEX_OPTION_LABELS.P02, (v) => (v.values.design === '데이지' ? photo(v) : {}))),
    ]) {
      const imgs = named(r, 'option_card_img');
      const bgs = named(r, 'option_card_bg');
      expect(imgs.length).toBeGreaterThan(0);
      imgs.forEach((img, i) => {
        const radius = bgs[i].shapeProps!.borderRadius!;
        expect(radius).toBe(24);
        expect(img.imageProps?.borderRadii).toEqual([radius, radius, 0, 0]);
        // 사진은 카드 위 끝·폭과 같다 — 모서리가 겹쳐야 반경이 맞는다
        expect([img.transform.x, img.transform.y, img.transform.width]).toEqual([
          bgs[i].transform.x,
          bgs[i].transform.y,
          bgs[i].transform.width,
        ]);
      });
    }
  });

  it('묶음·대표 사진(카드 밖 단독 사진)은 그대로 각진 모서리', () => {
    const bundle = build(specOf(FAIRNEX_OPTION_LABELS.P05), { bundleImageUrl: 'https://cdn.example.com/bundle.jpg' });
    expect(named(bundle, 'option_bundle_img')[0].imageProps?.borderRadii).toBeUndefined();
  });

  it('내보내기(렌더 캡처) HTML도 같은 반경 — 편집기 CanvasElement와 같은 값', () => {
    const r = build(specOf(FAIRNEX_OPTION_LABELS.P02, (v) => (v.values.design === '데이지' ? photo(v) : {})));
    const section = {
      id: 'opt', sectionType: 'petit_div', groupType: 'modules', order: 0, isVisible: true, layoutId: 'x',
      canvas: { width: 860, height: START_Y + r.height, backgroundColor: '#FFFFFF' }, elements: r.elements,
    } as CanvasSection;
    const html = exportRenderHtml([section], {});
    expect(html.match(/border-radius:24px 24px 0px 0px;/g)).toHaveLength(named(r, 'option_card_img').length);
    const square = r.elements.map((e) =>
      e.imageProps ? { ...e, imageProps: { ...e.imageProps, borderRadii: undefined } } : e,
    );
    const plain = exportRenderHtml([{ ...section, elements: square }], {});
    expect(plain).not.toContain('border-radius:24px 24px 0px 0px');
  });
});
