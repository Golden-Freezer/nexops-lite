// exportUtils/htmlBuilders.ts — D2 분할: 원본 exportUtils.ts 431~750행 순수 이동 (2026-07-04) — ★순수(결정적 해시 검증 대상)

import type { CanvasSection, CanvasElement } from '@/lib/registration/editor/types/canvas';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import { BALANCED_HEADING_MIN_FONT } from '@/lib/registration/editor/constants/designTokens';
import { PDP_FONT_CSS_URL } from '@/lib/registration/editor/constants/fonts';

// 글꼴 — 편집기와 같은 자체 보관 스타일시트(public/fonts/pdp/fonts.css) 하나를 싣는다. 단독 실행 HTML은 앱 출처가
// 없어 운영 출처의 절대 주소로 싣는다(next.config가 /fonts/pdp에 교차 출처 허용을 붙인다). 브라우저는 쓰인 글자가 있는
// @font-face의 파일만 받으므로 쓰인 글꼴을 따로 고르지 않는다. 미포함 시 제목·본문이 대체 글꼴로 그려져 캔버스와
// 줄바꿈/폭이 어긋난다. 평가 캡처(scripts/pdp-eval/capture.mjs)는 이 주소를 PR의 public/fonts/pdp 파일로 답한다.
const FONT_LINK = `<link href="${PDP_FONT_CSS_URL}" rel="stylesheet">`;

/** 요소 그림자(angle/distance/blur/spread) → CSS box-shadow 문자열 */
function elementShadowCss(el: CanvasElement): string {
  if (!el.shadow?.enabled || el.type === 'text') return '';
  const rad = (el.shadow.angle * Math.PI) / 180;
  const sx = Math.round(Math.sin(rad) * el.shadow.distance);
  const sy = Math.round(-Math.cos(rad) * el.shadow.distance);
  const color = el.shadow.color ?? 'rgba(0,0,0,0.3)';
  return `box-shadow:${sx}px ${sy}px ${el.shadow.blur}px ${el.shadow.spread}px ${color}`;
}

/**
 * CanvasSection[] 데이터를 정적 HTML 문자열로 변환한다.
 * - 인라인 CSS 포함, 외부 의존성 없이 독립 실행 가능
 * - 860px 고정 폭
 * - 이미지는 원본 URL 참조
 */
export function exportHtml(
  sections: CanvasSection[],
  palette: DesignPalette | null,
): string {
  const visible = sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .sort((a, b) => a.order - b.order);

  const sectionsHtml = visible.map((s) => renderSectionHtml(s)).join('\n');
  const bgColor = palette?.bgMain ?? '#ffffff';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=860">
  <title>NEXFIT PDP Export</title>
  ${FONT_LINK}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:860px;margin:0 auto;background:${escapeAttr(bgColor)};font-family:Pretendard,-apple-system,BlinkMacSystemFont,sans-serif}
  </style>
</head>
<body>
${sectionsHtml}
</body>
</html>`;
}

// ─────────────────────────────────────────────
// HTML 렌더 헬퍼
// ─────────────────────────────────────────────

function renderSectionHtml(section: CanvasSection): string {
  const elements = section.elements
    .filter((el) => el.isVisible)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((el) => renderElementHtml(el))
    .join('\n    ');

  return `  <div style="position:relative;width:860px;height:${section.canvas.height}px;background:${escapeAttr(section.canvas.backgroundColor)};overflow:hidden;">
    ${elements}
  </div>`;
}

function isValidImageSrc(src: string | undefined | null): boolean {
  if (!src || src.trim() === '') return false;
  if (src.includes('placehold.co')) return false;
  if (src.includes('placeholder')) return false;
  if (src.includes('Generation+Failed')) return false;
  if (src.includes('Generation Failed')) return false;
  if (src.includes('Image+Generation')) return false;
  return true;
}

/** markText: 평가 캡처의 글자 실측용 표시(data-el) — exportRenderHtml의 markTextElements에서만 켠다 */
function renderElementHtml(el: CanvasElement, markText = false): string {
  const { transform: t, opacity, zIndex } = el;

  const baseStyle = [
    'position:absolute',
    `left:${t.x}px`,
    `top:${t.y}px`,
    `width:${t.width}px`,
    `height:${t.height}px`,
    `z-index:${zIndex}`,
    `opacity:${opacity}`,
    t.rotation ? `transform:rotate(${t.rotation}deg)` : '',
    // B-2 export 패리티: 요소 그림자(리뷰카드 box-shadow 등) 반영
    elementShadowCss(el),
  ]
    .filter(Boolean)
    .join(';');

  if (el.type === 'text' && el.textProps) {
    const p = el.textProps;
    // B-2 export 패리티: 캔버스 렌더(CanvasElement)와 동일하게
    // text-shadow / 텍스트 외곽선을 내보내기 HTML에도 반영
    let textShadowCss = '';
    if (p.textShadowDistance || p.textShadowBlur) {
      const a = ((p.textShadowAngle ?? 135) * Math.PI) / 180;
      const d = p.textShadowDistance ?? 0;
      const shadowColor = p.textShadowColor ?? 'rgba(0,0,0,0.3)';
      textShadowCss = `text-shadow:${Math.round(Math.sin(a) * d)}px ${Math.round(-Math.cos(a) * d)}px ${p.textShadowBlur ?? 0}px ${escapeAttr(shadowColor)}`;
    }
    const strokeCss = p.strokeWidth
      ? `paint-order:stroke fill;-webkit-text-stroke:${p.strokeWidth}px ${escapeAttr(p.stroke || 'transparent')}`
      : '';
    const textStyle = [
      `font-family:${escapeAttr(p.fontFamily)},'Pretendard Variable',Pretendard,sans-serif`,
      `font-size:${p.fontSize}px`,
      `font-weight:${p.fontWeight}`,
      `font-style:${p.fontStyle}`,
      `text-decoration:${p.textDecoration}`,
      `color:${escapeAttr(p.color)}`,
      `text-align:${p.textAlign}`,
      `line-height:${p.lineHeight}`,
      `letter-spacing:${p.letterSpacing}px`,
      'word-break:keep-all',
      'overflow-wrap:break-word',
      'white-space:pre-wrap',
      // §4-3b 균형 줄바꿈: 캔버스(CanvasElement)와 동일 기준 — 헤딩(≥60px) 고아 줄 제거
      p.fontSize >= BALANCED_HEADING_MIN_FONT ? 'text-wrap:balance' : '',
      textShadowCss,
      strokeCss,
    ]
      .filter(Boolean)
      .join(';');

    // 캔버스 패리티: autoHeight가 아닌 텍스트는 flex 수직 정렬 (CanvasElement 동일)
    const vAlign = el.verticalAlign ?? 'middle';
    const justify = vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center';
    const vAlignCss = el.autoHeight === false
      ? `display:flex;flex-direction:column;justify-content:${justify};overflow:hidden`
      : '';

    const html = p.richContent
      ? p.richContent
      : escapeHtml(p.content).replace(/\n/g, '<br>');
    const mark = markText ? ` data-el="${escapeAttr(el.id)}"` : '';
    return `<div${mark} style="${baseStyle};${textStyle}${vAlignCss ? `;${vAlignCss}` : ''}">${html}</div>`;
  }

  if (el.type === 'image' && el.imageProps) {
    const { src, alt } = el.imageProps;
    if (!isValidImageSrc(src)) return '';
    const imgStyle = buildImgStyleCss(
      el.imageProps.cropRect,
      el.imageProps.objectFit,
      el.verticalAlign,
    );
    // 캔버스 패리티: 모서리 반경(옵션 카드 사진 — CanvasElement와 같은 값)
    const radii = el.imageProps.borderRadii;
    const radiusCss = radii ? `border-radius:${radii.map((r) => `${Number(r) || 0}px`).join(' ')};` : '';
    return `<div style="${baseStyle};overflow:hidden;${radiusCss}"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="${imgStyle}"></div>`;
  }

  if (el.type === 'shape' && el.shapeProps) {
    const sp = el.shapeProps;
    const borderStyle = sp.stroke ? `border:${sp.strokeWidth ?? 1}px solid ${escapeAttr(sp.stroke)};` : '';
    const fill = escapeAttr(sp.fill || 'transparent');
    const strokeAttr = escapeAttr(sp.stroke || 'none');
    const strokeW = sp.strokeWidth ?? 0;

    // 인라인 SVG 도형
    const svgShapeMap: Record<string, string> = {
      triangle: `<polygon points="50,5 95,95 5,95" fill="${fill}" stroke="${strokeAttr}" stroke-width="${strokeW}" stroke-linejoin="round"/>`,
      star: `<polygon points="50,5 61,38 96,38 68,59 79,93 50,72 21,93 32,59 4,38 39,38" fill="${fill}" stroke="${strokeAttr}" stroke-width="${strokeW}" stroke-linejoin="round"/>`,
      arrow: `<polygon points="0,35 60,35 60,15 100,50 60,85 60,65 0,65" fill="${fill}" stroke="${strokeAttr}" stroke-width="${strokeW}" stroke-linejoin="round"/>`,
      speechBubble: `<path d="M10,10 L90,10 Q95,10 95,15 L95,65 Q95,70 90,70 L45,70 L30,90 L33,70 L10,70 Q5,70 5,65 L5,15 Q5,10 10,10 Z" fill="${fill}" stroke="${strokeAttr}" stroke-width="${strokeW}" stroke-linejoin="round"/>`,
    };
    if (svgShapeMap[sp.shapeType]) {
      return `<div style="${baseStyle};"><svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="display:block;">${svgShapeMap[sp.shapeType]}</svg></div>`;
    }

    if (sp.shapeType === 'circle' || sp.shapeType === 'ellipse') {
      return `<div style="${baseStyle};border-radius:50%;background:${fill};${borderStyle}"></div>`;
    }
    if (sp.shapeType === 'diamond') {
      return `<div style="${baseStyle};background:${fill};${borderStyle}transform:rotate(45deg);"></div>`;
    }
    if (sp.shapeType === 'roundedRect') {
      const radiusCss = sp.borderRadii
        ? `${sp.borderRadii[0]}px ${sp.borderRadii[1]}px ${sp.borderRadii[2]}px ${sp.borderRadii[3]}px`
        : `${sp.borderRadius ?? 20}px`;
      return `<div style="${baseStyle};border-radius:${radiusCss};background:${escapeAttr(sp.fill || '#fff')};${borderStyle}"></div>`;
    }
    if (sp.shapeType === 'line') {
      return `<div style="${baseStyle};background:${escapeAttr(sp.stroke || sp.fill || '#000')};"></div>`;
    }
    // rect and others
    return `<div style="${baseStyle};background:${fill};${borderStyle}"></div>`;
  }

  if (el.type === 'svg' && el.svgProps) {
    return `<div style="${baseStyle};overflow:hidden;">${el.svgProps.svgString}</div>`;
  }

  if (el.type === 'framed-image' && el.framedImageProps) {
    const fp = el.framedImageProps;
    if (!isValidImageSrc(fp.src)) return '';
    const frameCss =
      fp.frameId === 'circle'
        ? 'border-radius:50%;'
        : fp.frameId === 'roundedRect'
        ? `border-radius:${typeof fp.cornerRadius === 'number' && Number.isFinite(fp.cornerRadius) && fp.cornerRadius >= 0 ? fp.cornerRadius : 16}px;`
        : fp.frameId === 'rect'
        ? ''
        : fp.clipPath && fp.clipPath !== 'none'
        ? `clip-path:${escapeAttr(fp.clipPath)};`
        : '';
    const usesClipPath =
      fp.frameId !== 'circle' && fp.frameId !== 'roundedRect' && fp.frameId !== 'rect';
    const borderCss =
      !usesClipPath && fp.borderWidth && fp.borderWidth > 0
        ? `border:${fp.borderWidth}px ${fp.borderStyle ?? 'solid'} ${escapeAttr(fp.borderColor ?? '#000000')};box-sizing:border-box;`
        : '';
    // 캔버스 패리티: objectFit 하드코딩(cover) 제거 — fp.objectFit + cropRect + vAlign 반영
    const framedImgStyle = buildImgStyleCss(fp.cropRect, fp.objectFit || 'cover', el.verticalAlign);
    return `<div style="${baseStyle};overflow:hidden;background:${escapeAttr(fp.bgColor)};${frameCss}${borderCss}"><img src="${escapeAttr(fp.src)}" alt="${escapeAttr(fp.alt)}" style="${framedImgStyle}"></div>`;
  }

  // ── 뱃지 (캔버스 패리티: 배경 pill + 텍스트) ──
  if (el.type === 'badge') {
    const tp = el.textProps;
    const badgeBg = el.shapeProps?.fill || '#ef4444';
    const badgeStyle = [
      `background-color:${escapeAttr(badgeBg)}`,
      `color:${escapeAttr(tp?.color || '#ffffff')}`,
      `font-family:${escapeAttr(tp?.fontFamily || 'Pretendard')},'Pretendard Variable',Pretendard,sans-serif`,
      `font-size:${tp?.fontSize ?? 24}px`,
      `font-weight:${tp?.fontWeight ?? 700}`,
      `text-align:${tp?.textAlign || 'center'}`,
      `letter-spacing:${tp?.letterSpacing ?? 0}px`,
      'border-radius:9999px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:0 16px',
      'white-space:nowrap',
    ].join(';');
    return `<div style="${baseStyle};${badgeStyle}">${escapeHtml(tp?.content || 'NEW')}</div>`;
  }

  // ── 카드 그룹 (캔버스 Stub 패리티: 컬럼 그리드 + 카드 타이틀) ──
  if (el.type === 'card_group' && el.cardGroupProps) {
    const cg = el.cardGroupProps;
    const cols = cg.columns ?? cg.cards.length ?? 2;
    const cardsHtml = cg.cards
      .map(
        (c) =>
          `<div style="background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:14px;min-height:80px;">${escapeHtml(c.title || 'Card')}</div>`,
      )
      .join('');
    return `<div style="${baseStyle};display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;padding:8px;">${cardsHtml}</div>`;
  }

  // 미지원 타입 — 빈 플레이스홀더
  return `<div style="${baseStyle};"></div>`;
}

/**
 * 이미지 <img> 인라인 스타일 — CanvasElement의 cropRect 확대 렌더 및
 * objectFit/objectPosition(vAlign) 로직과 동일하게 유지한다.
 */
function buildImgStyleCss(
  cropRect: { x: number; y: number; width: number; height: number } | undefined,
  objectFit: string,
  verticalAlign: 'top' | 'middle' | 'bottom' | undefined,
): string {
  if (cropRect && cropRect.width > 0 && cropRect.height > 0) {
    const w = (100 / cropRect.width) * 100;
    const h = (100 / cropRect.height) * 100;
    const left = -(cropRect.x / cropRect.width) * 100;
    const top = -(cropRect.y / cropRect.height) * 100;
    return `position:absolute;width:${w}%;height:${h}%;left:${left}%;top:${top}%;object-fit:cover;display:block;`;
  }
  const vAlign = verticalAlign ?? 'middle';
  const objectPosY = vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'center';
  return `width:100%;height:100%;object-fit:${objectFit};object-position:center ${objectPosY};display:block;`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// ─────────────────────────────────────────────
// T4.1: Review HTML / Render HTML 분리
// ─────────────────────────────────────────────

/**
 * 검수용 HTML — 사람이 읽고 수정하기 위한 시맨틱 HTML
 * - flex 레이아웃 (absolute position 아님)
 * - auto height (고정 높이 아님)
 * - 반응형 미리보기 가능
 * - Pretendard 폰트 로딩 포함
 */
export function exportReviewHtml(
  sections: CanvasSection[],
  palette: DesignPalette | null = null,
): string {
  const visible = sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .sort((a, b) => a.order - b.order);

  const bgColor = palette?.bgMain ?? '#ffffff';

  // 콘텐츠 요소 1개를 flow HTML로 렌더 (text/image만 — shape는 별도 처리)
  const renderFlowEl = (el: CanvasElement): string => {
    if (el.type === 'text' && el.textProps) {
      const p = el.textProps;
      const html = p.richContent
        ? p.richContent
        : escapeHtml(p.content).replace(/\n/g, '<br>');
      return `<div class="review-text" style="font-size:${p.fontSize}px;line-height:${p.lineHeight};font-weight:${p.fontWeight};font-style:${p.fontStyle};color:${escapeAttr(p.color)};text-align:${p.textAlign};letter-spacing:${p.letterSpacing}px;word-break:keep-all;overflow-wrap:break-word;white-space:pre-wrap;margin-bottom:8px;">${html}</div>`;
    }
    if ((el.type === 'image' && el.imageProps) || (el.type === 'framed-image' && el.framedImageProps)) {
      const src = el.type === 'image' ? el.imageProps!.src : el.framedImageProps!.src;
      const alt = el.type === 'image' ? el.imageProps!.alt : el.framedImageProps!.alt;
      if (!isValidImageSrc(src)) return '';
      return `<div class="review-image" style="width:100%;"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="width:100%;height:auto;object-fit:cover;display:block;"></div>`;
    }
    return '';
  };

  const sectionsHtml = visible.map((s) => {
    // Review HTML 카드 패리티: 기존 구현은 shape를 통째로 버려 리뷰카드
    // 테두리/라운드/구분선이 사라졌다. containerOf 메타를 가진 컨테이너 shape는
    // 자식들을 감싸는 실제 카드 박스(border/radius/배경)로 렌더하고,
    // 얇은 rect/line shape는 구분선으로 렌더한다. flow 순서는 y 기준.
    const els = s.elements.filter((el) => el.isVisible);
    const consumed = new Set<string>(
      els.flatMap((el) => el.containerOf ?? []),
    );
    const flowSorted = [...els].sort(
      (a, b) => a.transform.y - b.transform.y || a.zIndex - b.zIndex,
    );

    const elementsHtml = flowSorted
      .map((el) => {
        if (consumed.has(el.id)) return ''; // 컨테이너 내부에서 렌더됨

        // 컨테이너 shape → 카드 박스로 자식 포함 렌더
        if (el.containerOf?.length && el.type === 'shape' && el.shapeProps) {
          const sp = el.shapeProps;
          const kids = flowSorted.filter((k) => el.containerOf!.includes(k.id));
          const inner = kids.map(renderFlowEl).filter(Boolean).join('\n      ');
          if (!inner) return '';
          const border = sp.stroke
            ? `border:${sp.strokeWidth ?? 1}px solid ${escapeAttr(sp.stroke)};`
            : '';
          const radius = sp.borderRadius ? `border-radius:${sp.borderRadius}px;` : '';
          const bg = sp.fill && sp.fill !== 'transparent'
            ? `background:${escapeAttr(sp.fill)};`
            : '';
          return `<div class="review-card" style="${border}${radius}${bg}padding:16px;margin-bottom:12px;">\n      ${inner}\n    </div>`;
        }

        // 얇은 rect/line shape → 구분선
        if (
          el.type === 'shape' && el.shapeProps &&
          (el.shapeProps.shapeType === 'line' || el.shapeProps.shapeType === 'rect') &&
          el.transform.height <= 4
        ) {
          const color = el.shapeProps.fill || el.shapeProps.stroke || '#e5e7eb';
          return `<div class="review-divider" style="height:${Math.max(1, el.transform.height)}px;background:${escapeAttr(color)};margin:8px 0;"></div>`;
        }

        return renderFlowEl(el);
      })
      .filter(Boolean)
      .join('\n    ');

    const purpose = s.strategyMeta?.purpose ?? '';
    const sectionType = s.sectionType;

    return `<section class="review-section" data-type="${sectionType}" data-purpose="${escapeAttr(purpose)}" style="padding:24px;border-bottom:1px solid #e5e7eb;">
    ${elementsHtml || '<div style="color:#9ca3af;font-size:12px;">(빈 섹션)</div>'}
  </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NEXFIT PDP 검수용 HTML</title>
  ${FONT_LINK}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{max-width:860px;margin:0 auto;background:${escapeAttr(bgColor)};font-family:Pretendard,-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937}
    .review-section{background:#fff}
    .review-section:nth-child(even){background:#f9fafb}
    .review-section::before{content:attr(data-type)" · "attr(data-purpose);display:block;font-size:10px;color:#6b7280;margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em}
    .review-image{margin-bottom:8px}
  </style>
</head>
<body>
${sectionsHtml}
</body>
</html>`;
}

/**
 * 캡처용 HTML — dom-to-image-more 캡처 직전 확정본
 * - 860px 고정 폭
 * - measuredHeight 반영 (실측값으로 height 보정)
 * - absolute position (캡처 정확성 우선)
 * - 이미지 인라인 처리는 호출 측에서 별도 수행 (preloadAndInlineImages)
 * - markTextElements: 평가 캡처 높이 정합(eval/render-reflow.ts)이 글자를 실측할 때만 섹션·글자 요소에 id 표시를 붙인다
 *   (기본 꺼짐 — 내보내기 출력 불변)
 */
export function exportRenderHtml(
  sections: CanvasSection[],
  measuredHeights: Record<string, number>,
  palette: DesignPalette | null = null,
  options: { markTextElements?: boolean } = {},
): string {
  const mark = options.markTextElements === true;
  const visible = sections
    .filter((s) => s.isVisible && s.canvas.height >= 10)
    .sort((a, b) => a.order - b.order);

  const bgColor = palette?.bgMain ?? '#ffffff';

  // measuredHeight 반영: 섹션 높이를 실측값으로 대체
  const sectionsHtml = visible.map((s) => {
    const resolvedHeight = measuredHeights[s.id] ?? s.canvas.height;
    const elements = s.elements
      .filter((el) => el.isVisible)
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((el) => renderElementHtml(el, mark))
      .join('\n    ');

    return `  <div${mark ? ` data-sec="${escapeAttr(s.id)}"` : ''} style="position:relative;width:860px;height:${resolvedHeight}px;background:${escapeAttr(s.canvas.backgroundColor)};overflow:hidden;">
    ${elements}
  </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=860">
  <title>NEXFIT PDP Render HTML</title>
  ${FONT_LINK}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{margin:0;padding:0;width:860px;max-width:860px;overflow-x:hidden}
    body{background:${escapeAttr(bgColor)};font-family:Pretendard,-apple-system,BlinkMacSystemFont,sans-serif}
  </style>
</head>
<body>
${sectionsHtml}
</body>
</html>`;
}

