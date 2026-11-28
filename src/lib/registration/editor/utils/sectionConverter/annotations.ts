// sectionConverter/annotations.ts — 강조 장식 렌더(pdp-enrichment T4, 00_DESIGN.md §4.5)
// 순수 함수: 서버가 이미지 URL 키로 내려준 장식(원본 이미지 좌표 0~1)을 편집기 문서에 얹는다. buildEditorDocument가
// 프리셋·내재화 테마·모바일 하한을 적용한 뒤에만 부른다(라벨·원형 확대가 프리셋 유실 가드 판정에 끼지 않게).
// 모바일 하한(§4.8 M5·M7): 라벨 글자 32px·한 줄, 번호 배지 72px, 지시선 4px, 원형 확대 280px, 폰 한 화면 장식 ≤ 3개.
// 보이는 영역(cover 크롭 투영) 밖이거나, 하한을 지킬 자리가 없거나, 글자와 겹치면 그 장식은 뺀다.
// 장식 1개 = 같은 groupId 요소 묶음(라벨(모서리면 + 지시선), 원형 확대 + 지시선, 번호 배지) — 함께 옮기고 지울 수 있다.
// 글 칩(B 배치 점검 ②, 2026-10-30): 같은 섹션 글자나 메인컷 USP 칩과 같은 문구면 그리지 않는다. 자리는 모서리 + 지시선을 먼저,
// 보이는 영역 가운데 50%는 쓰지 않는다(제품 본체를 가렸다). 사진 한 장에 글 칩은 1개까지.

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import type { EditorImageAnnotation } from '@/lib/registration/editor/services/editorApi';
import { ProSectionType } from '@/lib/registration/editor/types/section';
import { MOBILE_LIMITS, PHONE_SCREEN_CANVAS_PX, contrastRatio, isAnnotationElement, parseColor } from '../mobileReadability';
import { graphemeWidthPx, splitGraphemes } from './helpers';

export type ImageAnnotationMap = Record<
  string,
  { aspect: number | null; section?: string; items: EditorImageAnnotation[] }
>;

/** 같은 URL이 여러 섹션에 나올 때 장식을 다는 역할 소유 섹션(앞일수록 우선) — 없으면 문서 순서 첫 출현 */
const OWNER_SECTIONS: Record<string, string[]> = {
  features: [ProSectionType.POINT_DIV, ProSectionType.SUB_DIV, ProSectionType.POINT_LIST_DIV],
  howto: [ProSectionType.HIDDEN_PAGE],
  size_comparison: [ProSectionType.COMPARE_DIV],
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Point {
  x: number;
  y: number;
}

const LABEL_FONT = MOBILE_LIMITS.annotationLabelMinPx;
const LABEL_H = 64;
/** 배지 렌더의 좌우 안쪽 여백(htmlBuilders·CanvasElement padding 0 16px) + 여유 */
const LABEL_PAD_X = 20;
const NUMBER_D = 72;
const ZOOM_D = 280;
const LEADER_W = MOBILE_LIMITS.leaderMinStrokePx;
const DOT_R = 10;
/** 보이는 영역 안쪽 여백 */
const INSET = 20;
/** 앵커와 붙여 놓는 라벨 사이 */
const GAP = 24;
const CLEAR = 8;
const PER_IMAGE = 3;
/** 사진 한 장의 글 칩(label·leader) 상한 */
const TEXT_CHIPS_PER_IMAGE = 1;
/** 글 칩이 들어가면 안 되는 보이는 영역 가운데 비율(한 변) — 생성 컷은 제품이 가운데에 있다 */
const CENTER_SHARE = 0.5;
const INK = '#111111';
const PAPER = '#FFFFFF';
const SHADOW = { enabled: true, angle: 135, distance: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.25)' };

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const insideRect = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const containsPoint = (r: Rect, p: Point, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
/** 보이는 영역 가운데 CENTER_SHARE 사각형 */
const centerRect = (vis: Rect): Rect => {
  const m = (1 - CENTER_SHARE) / 2;
  return { x: vis.x + vis.w * m, y: vis.y + vis.h * m, w: vis.w * CENTER_SHARE, h: vis.h * CENTER_SHARE };
};
/** 같은 문구 비교용 — 소문자, 공백(줄바꿈 없는 공백 포함)·문장부호·기호 제거 */
const normText = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** 장식이 아닌 보이는 글자·배지의 문구(정규화) */
const shownTexts = (section: CanvasSection): string[] =>
  section.elements
    .filter((e) => e.isVisible !== false && (e.type === 'text' || e.type === 'badge') && !isAnnotationElement(e))
    .map((e) => normText(e.textProps?.content ?? ''))
    .filter(Boolean);

/**
 * 원본 이미지가 요소 안에 그려지는 사각형(요소 기준 px) — 내보내기 buildImgStyleCss·캔버스 렌더와 같은 규칙:
 * cropRect가 있으면 크롭 영역이 상자를 채우도록 키운 img 상자에 cover·가운데, 없으면 objectFit과 세로 정렬.
 * 원본 비율을 모르면 상자를 채운다고 본다.
 */
export function imageDrawRect(el: CanvasElement, aspect: number | null): Rect {
  const bw = el.transform.width;
  const bh = el.transform.height;
  const props = el.imageProps ?? el.framedImageProps;
  const crop = props?.cropRect;
  let box: Rect = { x: 0, y: 0, w: bw, h: bh };
  let fit = props?.objectFit ?? 'cover';
  let align = el.verticalAlign ?? 'middle';
  if (crop && crop.width > 0 && crop.height > 0) {
    box = {
      x: -(crop.x / crop.width) * bw,
      y: -(crop.y / crop.height) * bh,
      w: (100 / crop.width) * bw,
      h: (100 / crop.height) * bh,
    };
    fit = 'cover';
    align = 'middle';
  }
  if (fit === 'fill' || !aspect || aspect <= 0) return box;
  // cover는 넓은 쪽을 자르고(짧은 변 맞춤), contain은 긴 변 맞춤
  const fitHeight = (fit === 'cover') === aspect > box.w / box.h;
  const w = fitHeight ? box.h * aspect : box.w;
  const h = fitHeight ? box.h : box.w / aspect;
  const offY = align === 'top' ? 0 : align === 'bottom' ? box.h - h : (box.h - h) / 2;
  return { x: box.x + (box.w - w) / 2, y: box.y + offY, w, h };
}

/** 요소 상자 안에서 원본 이미지가 실제로 보이는 영역(섹션 기준 px) */
export function visibleImageRect(el: CanvasElement, aspect: number | null): Rect | null {
  const d = imageDrawRect(el, aspect);
  const x0 = Math.max(0, d.x);
  const y0 = Math.max(0, d.y);
  const x1 = Math.min(el.transform.width, d.x + d.w);
  const y1 = Math.min(el.transform.height, d.y + d.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: el.transform.x + x0, y: el.transform.y + y0, w: x1 - x0, h: y1 - y0 };
}

/** 원본 좌표(0~1) → 섹션 좌표(px). 보이는 영역 밖이면 null */
export function projectAnchor(el: CanvasElement, aspect: number | null, anchor: Point): Point | null {
  const d = imageDrawRect(el, aspect);
  const p = { x: el.transform.x + d.x + anchor.x * d.w, y: el.transform.y + d.y + anchor.y * d.h };
  const vis = visibleImageRect(el, aspect);
  return vis && containsPoint(vis, p) ? p : null;
}

/**
 * 원형 확대 크롭 — zoomRect를 원본 픽셀 기준 정사각으로 넓혀(중심 유지, 이미지 안으로 밀어 넣음) ×100 퍼센트.
 * 원형 프레임은 정사각이라 비율이 다른 영역을 그대로 쓰면 cover가 한쪽을 더 잘라 디테일이 가운데로 끌려간다.
 */
export function zoomCropRect(
  zr: NonNullable<EditorImageAnnotation['zoomRect']>,
  aspect: number | null,
): { x: number; y: number; width: number; height: number } {
  const a = aspect && aspect > 0 ? aspect : 1;
  // 세로 길이(H) 단위의 정사각 한 변 — 이미지 밖으로 넘치면 짧은 변에 맞춘다
  const side = Math.min(Math.max(zr.w * a, zr.h), a, 1);
  const w = side / a;
  const h = side;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x = clamp(zr.x + zr.w / 2 - w / 2, 1 - w);
  const y = clamp(zr.y + zr.h / 2 - h / 2, 1 - h);
  const pct = (v: number) => Math.round(v * 10000) / 100;
  return { x: pct(x), y: pct(y), width: pct(w), height: pct(h) };
}

function labelWidth(text: string): number {
  return Math.ceil(splitGraphemes(text).reduce((sum, g) => sum + graphemeWidthPx(g, LABEL_FONT), 0) + LABEL_PAD_X * 2);
}

/** K 첫 화면 — 사진 이름표도 1~3초 글 양에 든다(오너 지시 11-01). 같은 사진이 뒤 섹션에 나오면 거기에 단다 */
const K_HOOK_LAYOUT = 'designcut_k_hook_3step.';

function annotatableImage(el: CanvasElement): string | null {
  if (el.isVisible === false || el.transform.rotation || isAnnotationElement(el)) return null;
  if (el.type === 'image') return el.imageProps?.src || null;
  // 원·도형 클립 프레임은 보이는 영역을 사각형으로 셀 수 없어 제외한다
  if (el.type === 'framed-image' && ['rect', 'roundedRect'].includes(el.framedImageProps?.frameId ?? '')) {
    return el.framedImageProps?.src || null;
  }
  return null;
}

/** 4개 모서리 자리 — 앵커에 가까운 순 */
function cornerSlots(vis: Rect, w: number, h: number, anchor: Point | null): Rect[] {
  const xs = [vis.x + INSET, vis.x + vis.w - INSET - w];
  const ys = [vis.y + INSET, vis.y + vis.h - INSET - h];
  const slots = ys.flatMap((y) => xs.map((x) => ({ x, y, w, h })));
  if (!anchor) return slots;
  const dist = (r: Rect) => Math.hypot(center(r).x - anchor.x, center(r).y - anchor.y);
  return slots.sort((a, b) => dist(a) - dist(b));
}

/** 앵커 바로 옆 자리(오른쪽·왼쪽·위·아래) */
function besideSlots(p: Point, w: number, h: number): Rect[] {
  return [
    { x: p.x + GAP, y: p.y - h / 2, w, h },
    { x: p.x - GAP - w, y: p.y - h / 2, w, h },
    { x: p.x - w / 2, y: p.y - GAP - h, w, h },
    { x: p.x - w / 2, y: p.y + GAP, w, h },
  ];
}

function leaderSvg(id: string, from: Point, to: Point, z: number, groupId: string): CanvasElement | null {
  if (Math.hypot(to.x - from.x, to.y - from.y) < DOT_R) return null;
  const pad = DOT_R + LEADER_W;
  const box = round({
    x: Math.min(from.x, to.x) - pad,
    y: Math.min(from.y, to.y) - pad,
    w: Math.abs(to.x - from.x) + pad * 2,
    h: Math.abs(to.y - from.y) + pad * 2,
  });
  const [x1, y1, x2, y2] = [from.x - box.x, from.y - box.y, to.x - box.x, to.y - box.y].map((v) => Math.round(v));
  const line = (stroke: string, width: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const svgString =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${box.w} ${box.h}" preserveAspectRatio="none">` +
    line(PAPER, LEADER_W * 2) +
    line(INK, LEADER_W) +
    `<circle cx="${x2}" cy="${y2}" r="${DOT_R}" fill="${PAPER}" stroke="${INK}" stroke-width="${LEADER_W}"/></svg>`;
  return {
    id,
    type: 'svg',
    name: 'annotation-leader',
    transform: { x: box.x, y: box.y, width: box.w, height: box.h, rotation: 0 },
    zIndex: z,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    groupId,
    svgProps: { svgString },
  };
}

function badgeEl(
  id: string,
  name: string,
  rect: Rect,
  z: number,
  groupId: string,
  text: string,
  style: { fontSize: number; color: string; fill: string; shape: 'roundedRect' | 'circle' }
): CanvasElement {
  const r = round(rect);
  return {
    id,
    type: 'badge',
    name,
    transform: { x: r.x, y: r.y, width: r.w, height: r.h, rotation: 0 },
    zIndex: z,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    groupId,
    textProps: {
      content: text,
      fontFamily: 'Pretendard',
      fontSize: style.fontSize,
      fontWeight: 800,
      fontStyle: 'normal',
      textDecoration: 'none',
      color: style.color,
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      typoLevel: 'caption',
    },
    shapeProps: { shapeType: style.shape, fill: style.fill },
    shadow: SHADOW,
  };
}

/** 모서리에서 원/사각형 경계로 — 지시선 시작점 */
function edgeToward(rect: Rect, p: Point, circle: boolean): Point {
  if (circle) {
    const c = center(rect);
    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    return { x: c.x + ((p.x - c.x) * rect.w) / 2 / d, y: c.y + ((p.y - c.y) * rect.h) / 2 / d };
  }
  return {
    x: Math.min(Math.max(p.x, rect.x), rect.x + rect.w),
    y: Math.min(Math.max(p.y, rect.y), rect.y + rect.h),
  };
}

interface Decoration {
  elements: CanvasElement[];
  rect: Rect;
}

/** 장식 렌더 결과(품질 보고서 T4b) — 장식 항목 단위. 넘겼을 때만 센다 */
export interface AnnotationRenderStats {
  /** 문서에 그려진 장식 */
  placed: number;
  /** 편집기 보이는 영역(cover 크롭) 밖이라 뺀 장식 */
  outOfView: number;
  /** 하한을 지킬 자리가 없거나 글자·앞 장식·가리킨 지점과 겹쳐 뺀 장식 */
  noRoom: number;
  /** 폰 한 화면 3개 상한·사진당 글 칩 1개 상한으로 뺀 장식 */
  screenCap: number;
  /** 그 이미지가 문서에 없어(섹션 미배치·숨김) 그리지 못한 장식 */
  notShown: number;
  /** 같은 섹션 글자나 메인컷 USP 칩과 같은 문구라 뺀 글 칩(있을 때만 센다) */
  duplicate?: number;
}

interface Planned extends Decoration {
  sectionIndex: number;
  /** 문서 기준 맨 위(검사기 M7과 같은 위치) */
  top: number;
  /** 같은 이미지 안 순서 — 0이 Vision이 먼저 고른 장식 */
  round: number;
}

/** 폰 한 화면(1,860px) 창마다 장식 3개 이하 — 검사기 M7과 같은 창(각 장식 위치에서 시작) */
function fitsScreens(tops: number[], top: number): boolean {
  const all = [...tops, top];
  return all.every(
    (s) => all.filter((t) => t >= s && t < s + PHONE_SCREEN_CANVAS_PX).length <= MOBILE_LIMITS.maxAnnotationsPerScreen,
  );
}

/**
 * 이미지 1장의 장식 후보 — Vision 순서대로 자리를 잡는다(앞 장식·글자와 겹치지 않고, 이 컷이 가리키는 지점을 덮지 않게).
 * repeated = 같은 섹션 글자·메인컷 USP 칩 문구(정규화) — 이와 같은 글 칩은 그리지 않는다
 */
function planImage(
  section: CanvasSection,
  el: CanvasElement,
  src: string,
  entry: ImageAnnotationMap[string],
  numberFill: string,
  placedRects: Rect[],
  repeated: ReadonlySet<string>,
  nextId: () => string,
  nextZ: () => number,
  stats?: AnnotationRenderStats,
): Decoration[] {
  const drop = (reason: 'outOfView' | 'noRoom' | 'screenCap') => {
    if (stats) stats[reason]++;
  };
  let textChips = 0;
  const vis = visibleImageRect(el, entry.aspect);
  if (!vis) {
    entry.items.slice(0, PER_IMAGE).forEach(() => drop('outOfView'));
    return [];
  }
  const obstacles = section.elements
    .filter(
      (e) =>
        e.isVisible !== false &&
        (e.type === 'text' || e.type === 'badge') &&
        (e.textProps?.content ?? '').trim().length > 0 &&
        !isAnnotationElement(e),
    )
    .map((e) => ({ x: e.transform.x, y: e.transform.y, w: e.transform.width, h: e.transform.height }));
  const anchors = entry.items
    .filter((item) => item.kind !== 'number')
    .map((item) => projectAnchor(el, entry.aspect, item.anchor))
    .filter((p): p is Point => p !== null);
  const free = (r: Rect) =>
    insideRect(r, { x: vis.x + INSET, y: vis.y + INSET, w: vis.w - INSET * 2, h: vis.h - INSET * 2 }) &&
    !obstacles.some((o) => overlaps(r, o, CLEAR)) &&
    !anchors.some((a) => containsPoint(r, a, DOT_R + CLEAR)) &&
    !placedRects.some((o) => overlaps(r, o, CLEAR));
  const out: Decoration[] = [];
  const take = (d: Decoration) => {
    placedRects.push(d.rect);
    out.push(d);
  };

  for (const item of entry.items.slice(0, PER_IMAGE)) {
    const groupId = nextId();

    if (item.kind === 'number') {
      const slot = cornerSlots(vis, NUMBER_D, NUMBER_D, null).find(free);
      if (!slot || !item.text) {
        drop('noRoom');
        continue;
      }
      take({
        rect: slot,
        elements: [
          badgeEl(`${groupId}-number`, 'annotation-number', slot, nextZ(), groupId, item.text, {
            fontSize: 36,
            color: PAPER,
            fill: numberFill,
            shape: 'circle',
          }),
        ],
      });
      continue;
    }

    const p = projectAnchor(el, entry.aspect, item.anchor);
    if (!p) {
      drop('outOfView'); // 보이는 영역 밖 — 뺀다
      continue;
    }

    if (item.kind === 'zoom') {
      if (!item.zoomRect || vis.w < ZOOM_D + INSET * 2 || vis.h < ZOOM_D + INSET * 2) {
        drop('noRoom');
        continue;
      }
      const slot = cornerSlots(vis, ZOOM_D, ZOOM_D, p).find((r) => free(r) && !containsPoint(r, p, DOT_R));
      if (!slot) {
        drop('noRoom');
        continue;
      }
      const leader = leaderSvg(`${groupId}-leader`, edgeToward(slot, p, true), p, nextZ(), groupId);
      const r = round(slot);
      const zoom: CanvasElement = {
        id: `${groupId}-zoom`,
        type: 'framed-image',
        name: 'annotation-zoom',
        transform: { x: r.x, y: r.y, width: r.w, height: r.h, rotation: 0 },
        zIndex: nextZ(),
        isLocked: false,
        isVisible: true,
        opacity: 1,
        groupId,
        framedImageProps: {
          src,
          alt: item.text ?? '확대',
          frameId: 'circle',
          clipPath: 'circle(50% at 50% 50%)',
          viewBox: '0 0 100 100',
          bgColor: PAPER,
          objectFit: 'cover',
          imageType: 'annotation-zoom',
          isUserUploaded: false,
          cropRect: zoomCropRect(item.zoomRect, entry.aspect),
          borderWidth: 6,
          borderColor: PAPER,
          borderStyle: 'solid',
        },
        shadow: SHADOW,
      };
      take({ rect: slot, elements: leader ? [leader, zoom] : [zoom] });
      continue;
    }

    // 글 칩(label·leader)은 모서리에 두고 지시선으로 잇는다. 모서리에 자리가 없을 때만 label을 앵커 옆에 둔다(선 없음).
    // 어느 자리든 보이는 영역 가운데 50%와 겹치면 쓰지 않는다 — 앵커 옆이 먼저였을 때 칩이 제품 본체를 가렸다(B 배치 점검 ②)
    if (item.text && repeated.has(normText(item.text))) {
      if (stats) stats.duplicate = (stats.duplicate ?? 0) + 1;
      continue;
    }
    if (!item.text || /[\r\n]/.test(item.text) || [...item.text].length > MOBILE_LIMITS.annotationLabelMaxChars) {
      drop('noRoom');
      continue;
    }
    if (textChips >= TEXT_CHIPS_PER_IMAGE) {
      drop('screenCap');
      continue;
    }
    const w = labelWidth(item.text);
    const mid = centerRect(vis);
    const fits = (r: Rect) => free(r) && !containsPoint(r, p, DOT_R + CLEAR) && !overlaps(r, mid);
    const corner = cornerSlots(vis, w, LABEL_H, p).find(fits);
    const beside = !corner && item.kind === 'label' ? besideSlots(p, w, LABEL_H).find(fits) : undefined;
    const slot = corner ?? beside;
    if (!slot) {
      drop('noRoom');
      continue;
    }
    const leader = beside ? null : leaderSvg(`${groupId}-leader`, edgeToward(slot, p, false), p, nextZ(), groupId);
    const label = badgeEl(`${groupId}-label`, 'annotation-label', slot, nextZ(), groupId, item.text, {
      fontSize: LABEL_FONT,
      color: INK,
      fill: PAPER,
      shape: 'roundedRect',
    });
    take({ rect: slot, elements: leader ? [leader, label] : [label] });
    textChips++;
  }
  return out;
}

/**
 * 장식을 문서에 얹는다 — 같은 URL이 여러 섹션에 나오면 역할 소유 섹션 첫 출현에만. 폰 한 화면 3개 상한 안에서
 * 이미지마다 첫 장식을 먼저 고르고(장식 받는 컷을 넓게), 남는 자리에 두 번째·세 번째를 준다.
 * 장식이 없는 문서는 그대로 돌려준다.
 */
export function applyImageAnnotations(
  sections: CanvasSection[],
  annotations: ImageAnnotationMap | null | undefined,
  palette?: DesignPalette | null,
  stats?: AnnotationRenderStats,
): CanvasSection[] {
  if (!annotations || Object.keys(annotations).length === 0) return sections;
  const primary = parseColor(palette?.primary);
  const numberFill = primary && contrastRatio(primary, [255, 255, 255]) >= MOBILE_LIMITS.bodyContrast ? palette!.primary : INK;
  const planned: Planned[] = [];
  let docOffset = 0;

  // URL마다 장식을 달 이미지 — 역할 소유 섹션의 첫 출현, 소유 섹션에 없으면 문서 순서 첫 출현
  const hosts = new Map<string, { rank: number; el: CanvasElement }>();
  for (const section of sections) {
    if (section.isVisible === false || section.layoutId?.startsWith(K_HOOK_LAYOUT)) continue;
    for (const el of section.elements) {
      const src = annotatableImage(el);
      const entry = src ? annotations[src] : undefined;
      if (!src || !entry) continue;
      const owners = OWNER_SECTIONS[(entry.section ?? '').split(':')[0]] ?? [];
      const at = owners.indexOf(section.sectionType);
      const rank = at === -1 ? owners.length : at;
      const seen = hosts.get(src);
      if (!seen || rank < seen.rank) hosts.set(src, { rank, el });
    }
  }
  if (stats) {
    for (const [src, entry] of Object.entries(annotations))
      if (!hosts.has(src)) stats.notShown += entry.items.slice(0, PER_IMAGE).length;
  }
  // 메인컷 USP 칩 문구 — 사진 위 칩이 같은 말을 다시 하지 않게
  const mainTexts = sections
    .filter((s) => s.isVisible !== false && s.sectionType === ProSectionType.MAIN_CUT)
    .flatMap(shownTexts);

  sections.forEach((section, sectionIndex) => {
    const offset = docOffset;
    if (section.isVisible === false) return;
    docOffset += section.canvas.height;
    const placedRects: Rect[] = [];
    const repeated = new Set([...mainTexts, ...shownTexts(section)]);
    let z = Math.max(0, ...section.elements.map((e) => e.zIndex)) + 1;
    let serial = 0;
    for (const el of section.elements) {
      const src = annotatableImage(el);
      const entry = src ? annotations[src] : undefined;
      if (!src || !entry || hosts.get(src)?.el !== el) continue;
      const decorations = planImage(
        section,
        el,
        src,
        entry,
        numberFill,
        placedRects,
        repeated,
        () => `annotation-${section.id}-${serial++}`,
        () => z++,
        stats,
      );
      decorations.forEach((d, round) =>
        planned.push({ ...d, sectionIndex, round, top: offset + Math.min(...d.elements.map((e) => e.transform.y)) }),
      );
    }
  });
  if (planned.length === 0) return sections;

  const keptTops: number[] = [];
  const kept = new Set<Planned>();
  for (const d of [...planned].sort((a, b) => a.round - b.round || a.top - b.top)) {
    if (!fitsScreens(keptTops, d.top)) continue;
    keptTops.push(d.top);
    kept.add(d);
  }
  if (stats) {
    stats.placed += kept.size;
    stats.screenCap += planned.length - kept.size;
  }
  return sections.map((section, i) => {
    const added = planned.filter((d) => d.sectionIndex === i && kept.has(d)).flatMap((d) => d.elements);
    return added.length > 0 ? { ...section, elements: [...section.elements, ...added] } : section;
  });
}
