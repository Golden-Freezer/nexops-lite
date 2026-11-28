// sectionConverter/optionGallery.ts — 다옵션 상세페이지 옵션 섹션 본문 요소 (05_OPTIONS.md §4, T6a)
// 순수 함수: optionSpec → 축 종류별 카드·칩·표 요소. 섹션 헤더(제목·설명)는 호출부(petit_div)가 만든다.
// 모바일(390px 폰 = 캔버스 ×0.4535) 규칙: 글자 ≥ 28px(M1), 카드 사진 ≥ 360px·묶음 컷 ≥ 500px(M5),
// 2열 글자 요소 폭 ≥ 380px·열당 40자 이하(M6 — 검사기는 카드가 아니라 글자 요소 폭을 본다), 카드 최대 6개(M7). 문구는 옵션 값과 고정 템플릿만 쓴다(가격 금지).
// 사진 높이 규칙은 상자 기준 — 1열 contain에서 아주 넓은 사진(약 2:1 초과)은 실제로 더 낮게 보일 수 있다(R2 ⑦).

import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import { primaryFormAxis } from '@/lib/registration/options/option-spec';
import type { OptionAxis, OptionSpec } from '@/lib/registration/options/option-spec';
import { CANVAS_WIDTH, sanitizeImageUrl, hexToRgb } from './helpers';
import { makeTextEl, makeImageEl, makeShapeEl } from './elements';
import { measureTextBlock } from './measure';

export type OptionGalleryMode = 'design_cards' | 'color_cards' | 'size_table' | 'quantity_cards' | 'chips' | 'none';

export interface OptionGalleryInput {
  spec: OptionSpec;
  palette: DesignPalette;
  startY: number;
  /** 수량 묶음 연출 컷(생성 컷) — quantity_cards에서만 */
  bundleImageUrl?: string | null;
  /** 대표 사진 — size_table에서만 */
  representativeImageUrl?: string | null;
}

export interface OptionGalleryResult {
  elements: CanvasElement[];
  /** startY부터 마지막 요소 하단까지 */
  height: number;
  mode: OptionGalleryMode;
  /** 보여 준 카드·행·칩 수 */
  shownCount: number;
  /** "외 n종"으로 줄인 수 */
  omittedCount: number;
  warnings: string[];
}

export const OPTION_GALLERY_LIMITS = {
  maxCards: 6,
  columnWidth: 400,
  columnGap: 20,
  singleColumnWidth: 740,
  cardImageHeight: 390,
  singleColumnImageHeight: 480,
  /** 혼자인 사진 카드 — 정사각 상자(옵션 사진은 대개 정사각 대표 이미지) + contain으로 상품이 잘리지 않게(R2 ⑦) */
  loneImageHeight: 740,
  labelFontSize: 32,
  captionFontSize: 28,
  quantityFontSize: 45,
  chipHeight: 80,
  bundleImageHeight: 560,
  maxColumnTextChars: 40,
} as const;

const L = OPTION_GALLERY_LIMITS;
const TWO_COL_X = Math.floor((CANVAS_WIDTH - (L.columnWidth * 2 + L.columnGap)) / 2); // 20
const WIDE_X = Math.floor((CANVAS_WIDTH - L.singleColumnWidth) / 2); // 60
const CARD_PAD = 20;
const CARD_RADIUS = 24;
/** 2열 글자 요소 최소 폭(M6, mobileReadability twoColumnMinWidthPx와 같다) */
const COLUMN_TEXT_MIN_W = 380;
const ROW_GAP = 24;
const BLOCK_GAP = 40;
const LINE_HEIGHT = 1.4;

interface Grid { xs: number[]; width: number }
interface FormCard { label: string; caption?: string; image: string }

/**
 * 열당 글자 수가 40자를 넘는 칸이 하나라도 있으면 1열(M6). 항목이 하나뿐이어도 가운데 넓은 1열이다(R2-3 — 2열 왼쪽 칸에만
 * 놓이면 오른쪽 절반이 빈다: R1 P02 사진 카드 1장·칩 1개).
 */
function gridFor(texts: string[]): Grid {
  const tooLong = texts.some((t) => [...t].length > L.maxColumnTextChars);
  if (tooLong || texts.length === 1) return { xs: [WIDE_X], width: L.singleColumnWidth };
  return { xs: [TWO_COL_X, TWO_COL_X + L.columnWidth + L.columnGap], width: L.columnWidth };
}

/** 글자 요소의 좌우 여백 — 2열이면 글자 폭이 380px 이상 남도록 줄인다(400 열 → 10). 1열은 그대로 */
function textPad(grid: Grid, pad: number): number {
  return grid.xs.length > 1 ? Math.min(pad, Math.floor((grid.width - COLUMN_TEXT_MIN_W) / 2)) : pad;
}

/**
 * 행 안 칸의 x — 2열 격자 마지막 행에 혼자 남은 칸은 가운데에 둔다(R2 ② — 왼쪽 칸에만 놓이면 오른쪽이 빈다: P01 사진 5장).
 */
function columnX(grid: Grid, rowLength: number, col: number): number {
  return grid.xs.length > 1 && rowLength === 1 ? Math.floor((CANVAS_WIDTH - grid.width) / 2) : grid.xs[col];
}

function rowsOf<T>(items: T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}

function textH(text: string, fontSize: number, width: number): number {
  return measureTextBlock(text, fontSize, LINE_HEIGHT, width);
}

function createBuilder(palette: DesignPalette, startY: number) {
  const elements: CanvasElement[] = [];
  const rgb = hexToRgb(palette.primary);
  let y = startY;
  let index = 0;

  const boxStyle = (borderRadius: number) => ({
    fill: `rgba(${rgb}, 0.06)`,
    stroke: `rgba(${rgb}, 0.18)`,
    strokeWidth: 1.5,
    borderRadius,
  });
  const gapBefore = () => { if (elements.length > 0) y += BLOCK_GAP; };

  /** 사진 카드: 사진 + 라벨(+caption). 같은 행은 높이를 맞춘다 */
  function photoCards(cards: FormCard[]): void {
    if (cards.length === 0) return;
    gapBefore();
    const grid = gridFor(cards.map((c) => c.label + (c.caption ?? '')));
    // 1열 사진은 contain — 740×480 cover는 정사각 상품 사진의 위·아래를 잘랐다(R2 ⑦, P02 데이지 파우치 입구).
    // 혼자인 카드는 정사각 상자(740)로 사진을 꽉 채우고, 긴 이름 때문에 1열인 여러 장은 높이 480을 지켜 페이지가 길어지지 않게 한다
    const oneColumn = grid.xs.length === 1;
    const imageH = oneColumn ? (cards.length === 1 ? L.loneImageHeight : L.singleColumnImageHeight) : L.cardImageHeight;
    const fit = oneColumn ? 'contain' : 'cover';
    const pad = textPad(grid, CARD_PAD);
    const innerW = grid.width - pad * 2;
    for (const row of rowsOf(cards, grid.xs.length)) {
      const metrics = row.map((c) => ({
        labelH: textH(c.label, L.labelFontSize, innerW),
        captionH: c.caption ? textH(c.caption, L.captionFontSize, innerW) : 0,
      }));
      const rowTextH = Math.max(...metrics.map((m) => m.labelH + (m.captionH ? 8 + m.captionH : 0)));
      const cardH = imageH + CARD_PAD + rowTextH + CARD_PAD;
      row.forEach((card, col) => {
        const i = index++;
        const x = columnX(grid, row.length, col);
        const { labelH, captionH } = metrics[col];
        const img = makeImageEl(`option_card_img_${i}`, card.image, 'options', x, y, grid.width, imageH, 3, fit);
        // 사진 위 모서리를 카드 모서리에 맞춰 자른다 — 각진 사진 모서리가 둥근 카드 바탕 위로 드러났다(R3, P02 재렌더)
        img.imageProps!.borderRadii = [CARD_RADIUS, CARD_RADIUS, 0, 0];
        const labelY = y + imageH + CARD_PAD;
        const label = makeTextEl(
          `option_card_label_${i}`, card.label, 'caption', x + pad, labelY, innerW, palette.textMain, 'center', 3,
          { fontSize: L.labelFontSize, fontWeight: 600, lineHeight: LINE_HEIGHT, height: labelH },
        );
        const children = [img, label];
        if (card.caption) {
          children.push(makeTextEl(
            `option_card_caption_${i}`, card.caption, 'caption', x + pad, labelY + labelH + 8, innerW,
            palette.textMain, 'center', 3,
            { fontSize: L.captionFontSize, fontWeight: 400, lineHeight: LINE_HEIGHT, height: captionH },
          ));
        }
        const bg = makeShapeEl(`option_card_bg_${i}`, 'roundedRect', x, y, grid.width, cardH, boxStyle(CARD_RADIUS), 2);
        bg.containerOf = children.map((c) => c.id);
        elements.push(bg, ...children);
      });
      y += cardH + ROW_GAP;
    }
    y -= ROW_GAP;
  }

  /** 텍스트 상자 격자(칩·수량 카드·사이즈 행 공용) */
  function textBoxes(
    texts: string[],
    names: { bg: string; label: string },
    style: { fontSize: number; fontWeight: number; minHeight: number; pad: number; radius: number; wide?: boolean },
  ): void {
    if (texts.length === 0) return;
    gapBefore();
    const grid = style.wide ? { xs: [WIDE_X], width: L.singleColumnWidth } : gridFor(texts);
    const pad = textPad(grid, style.pad);
    const innerW = grid.width - pad * 2;
    const level = style.fontSize >= 45 ? 'body' : 'caption';
    for (const row of rowsOf(texts, grid.xs.length)) {
      const heights = row.map((t) => textH(t, style.fontSize, innerW));
      const boxH = Math.max(style.minHeight, Math.max(...heights) + style.pad * 2);
      row.forEach((text, col) => {
        const i = index++;
        const x = columnX(grid, row.length, col);
        const label = makeTextEl(
          `${names.label}_${i}`, text, level, x + pad, y + Math.floor((boxH - heights[col]) / 2), innerW,
          palette.textMain, 'center', 3,
          { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: LINE_HEIGHT, height: heights[col] },
        );
        const bg = makeShapeEl(`${names.bg}_${i}`, 'roundedRect', x, y, grid.width, boxH, boxStyle(style.radius), 2);
        bg.containerOf = [label.id];
        elements.push(bg, label);
      });
      y += boxH + ROW_GAP;
    }
    y -= ROW_GAP;
  }

  function line(name: string, text: string): void {
    gapBefore();
    const h = textH(text, L.labelFontSize, L.singleColumnWidth);
    elements.push(makeTextEl(
      name, text, 'caption', WIDE_X, y, L.singleColumnWidth, palette.textMain, 'center', 3,
      { fontSize: L.labelFontSize, fontWeight: 500, lineHeight: LINE_HEIGHT, height: h },
    ));
    y += h;
  }

  function wideImage(name: string, url: string): void {
    gapBefore();
    elements.push(makeImageEl(name, url, 'options', WIDE_X, y, L.singleColumnWidth, L.bundleImageHeight, 3, 'cover'));
    y += L.bundleImageHeight;
  }

  const chips = (texts: string[]) =>
    textBoxes(texts, { bg: 'option_chip_bg', label: 'option_chip_label' },
      { fontSize: L.labelFontSize, fontWeight: 600, minHeight: L.chipHeight, pad: 12, radius: L.chipHeight / 2 });

  return { elements, photoCards, textBoxes, chips, line, wideImage };
}

/** 형태 축 값별 카드 문구·사진 + 완전 교차일 때의 한 줄 안내 */
function formCards(spec: OptionSpec, primary: OptionAxis) {
  const secondary = spec.axes.find((a) => a.kind !== primary.kind) ?? null;
  const groups = primary.values.map((value) => ({
    value,
    variants: spec.variants.filter((v) => v.values[primary.kind] === value),
  }));
  const valuesIn = (variants: typeof spec.variants) =>
    secondary ? secondary.values.filter((sv) => variants.some((v) => v.values[secondary.kind] === sv)) : [];
  const complete = !!secondary && groups.every((g) => valuesIn(g.variants).length === secondary.values.length);
  const cards: FormCard[] = groups.map((g) => {
    const unique = g.variants.length === 1;
    const image = g.variants.map((v) => sanitizeImageUrl(v.sourceImage)).find(Boolean) ?? '';
    return {
      label: unique ? g.variants[0].label : g.value,
      ...(!unique && secondary && !complete ? { caption: valuesIn(g.variants).join('·') } : {}),
      image,
    };
  });
  let axisLine: string | null = null;
  if (secondary && complete) {
    const joined = secondary.values.join('·');
    axisLine = secondary.kind === 'quantity' ? `각 ${primary.name} ${joined} 구성` : `${secondary.name} ${joined}`;
  }
  return { cards, axisLine };
}

// 사진 없는 값은 이름 칩. 불완전 교차의 수량 caption은 칩에서 빼면 어떤 구성이 있는지 사라지므로 함께 붙인다
const chipText = (c: FormCard) => (c.caption ? `${c.label} · ${c.caption}` : c.label);

export function buildOptionGalleryElements(input: OptionGalleryInput): OptionGalleryResult {
  const { spec, palette, startY } = input;
  const result = (mode: OptionGalleryMode, elements: CanvasElement[], shown: number, omitted: number, warnings: string[]) => {
    const bottom = Math.max(startY, ...elements.map((e) => e.transform.y + e.transform.height));
    return { elements, height: bottom - startY, mode, shownCount: shown, omittedCount: omitted, warnings };
  };
  if (spec.variants.length < 2) return result('none', [], 0, 0, []);

  const b = createBuilder(palette, startY);
  const warnings: string[] = [];
  const primary = primaryFormAxis(spec);
  const quantityAxis = spec.axes.find((a) => a.kind === 'quantity');
  let mode: OptionGalleryMode;
  let shown: number;
  let omitted: number;
  let axisLine: string | null = null;

  if (primary && (primary.kind === 'design' || primary.kind === 'color')) {
    const built = formCards(spec, primary);
    const withPhoto = built.cards.filter((c) => c.image);
    const noPhoto = built.cards.filter((c) => !c.image);
    const visible = [...withPhoto, ...noPhoto].slice(0, L.maxCards);
    if (noPhoto.length > 0) warnings.push(`missing_variant_images:${noPhoto.length}`);
    mode = withPhoto.length === 0 ? 'chips' : primary.kind === 'design' ? 'design_cards' : 'color_cards';
    b.photoCards(visible.filter((c) => c.image));
    b.chips(visible.filter((c) => !c.image).map(chipText));
    shown = visible.length;
    omitted = built.cards.length - visible.length;
    axisLine = built.axisLine;
  } else if (primary && primary.kind === 'size') {
    const hasFacts = spec.variants.some((v) => (v.facts ?? []).length > 0);
    const built = formCards(spec, primary);
    const rows = hasFacts
      ? primary.values.map((value) => {
          const facts = spec.variants.find((v) => v.values.size === value && (v.facts ?? []).length > 0)?.facts ?? [];
          return facts.length > 0 ? `${value}  ${facts.join(' · ')}` : value;
        })
      : built.cards.map(chipText);
    const visible = rows.slice(0, L.maxCards);
    if (hasFacts) {
      mode = 'size_table';
      b.textBoxes(visible, { bg: 'option_size_row_bg', label: 'option_size_row_label' },
        { fontSize: L.labelFontSize, fontWeight: 600, minHeight: 96, pad: 24, radius: 20, wide: true });
    } else {
      mode = 'chips';
      warnings.push('size_facts_missing');
      b.chips(visible);
    }
    shown = visible.length;
    omitted = rows.length - visible.length;
    axisLine = built.axisLine;
  } else if (quantityAxis) {
    mode = 'quantity_cards';
    const visible = quantityAxis.values.slice(0, L.maxCards);
    b.textBoxes(visible.map((v) => `${v} 구성`), { bg: 'option_qty_bg', label: 'option_qty_label' },
      { fontSize: L.quantityFontSize, fontWeight: 700, minHeight: 120, pad: 28, radius: 24 });
    shown = visible.length;
    omitted = quantityAxis.values.length - visible.length;
  } else {
    // 변하는 축이 없는데 라벨만 다른 경우 — 등록 옵션명을 칩으로만 보여 준다
    mode = 'chips';
    const labels = spec.variants.map((v) => v.label);
    const visible = labels.slice(0, L.maxCards);
    b.chips(visible);
    shown = visible.length;
    omitted = labels.length - visible.length;
  }

  if (omitted > 0) b.line('option_more', `외 ${omitted}종`);
  if (axisLine) b.line('option_axis_line', axisLine);
  const bundle = sanitizeImageUrl(input.bundleImageUrl);
  if (mode === 'quantity_cards' && bundle) b.wideImage('option_bundle_img', bundle);
  const representative = sanitizeImageUrl(input.representativeImageUrl);
  if (mode === 'size_table' && representative) b.wideImage('option_representative_img', representative);

  return result(mode, b.elements, shown, omitted, warnings);
}
