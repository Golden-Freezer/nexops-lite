/**
 * 디자인 컷 요소 생성기 — 08 §0.3 레이어 규약(bg → plate → cut → scrim → shape → text)을 z 순서로 쌓는다.
 * - 글자는 전부 편집기 텍스트 요소, 높이는 한글 줄바꿈 추정(measureTextBlock)으로 미리 잡는다(디자인 컷은 겹친 레이어라 마운트 reflow를 끈다)
 * - 편집기 캔버스는 도형 채우기를 backgroundColor로 그려 그라데이션이 보이지 않는다 → 도형은 단색·rgba만, 그라데이션은 섹션 바탕에만
 * - 제품 레이어(productAlpha 항상 false, 2026-10-28 개정): 카드·그림자·테두리·접지 타원 없이 사진을 contain(투명 여백)으로
 *   섹션 바탕(사진 배경색) 위에 얹는다 — 흰 카드 액자는 사진을 떠 보이게 했고 cover는 제품 위아래를 잘랐다.
 *   T4 장식은 rect·roundedRect 액자에만 붙으므로 장식이 필요한 T3a만 decor(roundedRect), 나머지는 plain
 */

import type { CanvasElement, ShapeType } from '@/lib/registration/editor/types/canvas'
import { makeTextEl } from '../elements'
import { keepCountUnits, uid } from '../helpers'
import { measureTextBlock } from '../measure'
import { accentPhraseOf, phraseIn, richWithAccent } from './accent'
import { CONTENT_W, TYPE, type TypeToken } from './tokens'

/** v2 강조 구절 입력 — 페이지 USP 낱말과 칠할 css('color:#…' 또는 'background-color:rgba(…)') */
export interface Accent {
  usp: readonly string[]
  css: string
  /** 모델이 고른 구절(적용 T1-17, 계획에서 acceptAccent로 검사했다) — 그릴 글에 있으면 먼저 쓰고, 없으면 지금 규칙(accentPhraseOf) */
  phrase?: string
}

/** 치수 이름 — 이름과 값이 다른 줄로 갈리지 않게 묶는다(R17 P07 T6 캡션이 '깊이'와 값 사이에서 갈렸다) */
const DIMENSION_NAME = '가로|세로|높이|깊이|폭|너비|지름|직경|길이|두께|둘레'
const DIMENSION_LABEL_RE = new RegExp(`(?<![가-힣])(${DIMENSION_NAME}) (?=\\d)`, 'g')
/** 값 하나 — 이름은 위에서 이미 줄바꿈 없는 공백으로 붙었다 */
const DIMENSION_VALUE = `(?:(?:${DIMENSION_NAME})\u00A0)?\\d[\\d.,]*(?:[ \u00A0]?(?:cm|mm|m))?`
/** 곱 표기 — '30 x 20cm'·'가로 30 x 세로 40cm'. 모의 렌더에서 'x' 뒤로 갈렸다 */
const DIMENSION_CROSS_RE = new RegExp(`${DIMENSION_VALUE}(?: ?[xX×*] ?${DIMENSION_VALUE})+`, 'g')
/** 이보다 긴 곱 표기는 묶지 않는다 — 좁은 칸에서 한 낱말로 넘친다 */
const DIMENSION_CROSS_MAX = 16

/** 칸 폭 — 주면 곱 표기를 묶은 덩어리가 칸에 드는지 본다 */
export interface UnitFit {
  size: number
  width: number
}

/**
 * 수량+단위에 치수 표기까지 한 줄에 묶는다(D·K 조립 전용). 옛 빌더(R)가 쓰는 keepCountUnits는 그대로 둔다.
 * 글자는 그대로이고 공백만 줄바꿈 없는 공백으로 바뀐다.
 * 칸 폭(fit)을 주면, 묶은 곱 표기에 공백 없이 붙은 글까지 한 덩어리(keep-all)로 재어 칸보다 넓을 때 묶지 않는다 —
 * K 좌우 표 값 칸(500)에서 '16.5cm x 20.7cm(데이지'가 한 덩어리로 오른쪽 여백 밖까지 나갔다(render-check 41406647460).
 */
export function keepFactUnits(text: string, fit?: UnitFit): string {
  return keepCountUnits(text)
    .replace(DIMENSION_LABEL_RE, '$1\u00A0')
    .replace(DIMENSION_CROSS_RE, (match: string, offset: number, whole: string) => {
      if (match.length > DIMENSION_CROSS_MAX) return match
      const bound = match.replace(/ /g, '\u00A0')
      if (!fit) return bound
      const before = /[^ \n]*$/.exec(whole.slice(0, offset))?.[0] ?? ''
      const after = /^[^ \n]*/.exec(whole.slice(offset + match.length))?.[0] ?? ''
      return approxTextWidth(before + bound + after, fit.size) <= fit.width ? bound : match
    })
}

/** 글 높이 추정 — 그릴 글과 같게 수량+단위·치수를 묶은 뒤 잰다(미리 재는 템플릿도 이 함수를 써서 상자 높이가 어긋나지 않게) */
export function measureCutText(text: string, size: number, lineHeight: number, width: number): number {
  return measureTextBlock(keepFactUnits(text, { size, width }), size, lineHeight, width)
}

/** 큰 제목을 줄여 볼 크기 — 84는 큰 제목을 키우기 전 값이라 그 아래로는 줄이지 않는다 */
export const HOOK_STEP_SIZES = [100, 96, 92, 88, 84]
/** 장면 모드 첫 화면(112부터) 줄임 단계 — 104에 들어가던 제목이 100으로 작아지지 않게 108·104를 더한다(K_HOOK_STEP_SIZES와 같은 값) */
export const SCENE_HOOK_STEP_SIZES = [108, 104, ...HOOK_STEP_SIZES]
const HOOK_MAX_LINES = 2

/** 추정 줄 수 */
export function cutTextLines(text: string, token: TypeToken, width: number): number {
  return Math.round((measureCutText(text, token.size, token.lineHeight, width) - 10) / (token.size * token.lineHeight))
}

/** 큰 제목이 2줄에 들어가는 가장 큰 크기 — 모두 넘치면 가장 작은 단계. 글자·줄 간격·글꼴은 그대로다 */
export function fitHookToken(token: TypeToken, text: string, width: number = CONTENT_W, stepSizes: readonly number[] = HOOK_STEP_SIZES): TypeToken {
  const steps = [token, ...stepSizes.filter((size) => size < token.size).map((size) => ({ ...token, size }))]
  return steps.find((t) => cutTextLines(text, t, width) <= HOOK_MAX_LINES) ?? steps[steps.length - 1]
}

/** SOFT 장식 액자(decor roundedRect)의 모서리 반경 — 편집기 roundedRect 프레임과 같은 16 */
export const DECOR_RADIUS = 16
/** 아치 틀 — 위 두 모서리만 둥글다. 반경이 폭보다 크면 브라우저가 폭의 절반으로 줄여 반원이 된다(eval/d-repeat-metrics가 틀 수를 셀 때 읽는다) */
export const ARCH_CLIP = 'inset(0 round 9999px 9999px 0 0)'

/** 대략 글자 폭(px) — 캡슐 폭 계산용(한글·CJK 1em, 영문 대문자·숫자 0.68em, 그 밖 0.56em) */
export function approxTextWidth(text: string, size: number): number {
  let w = 0
  for (const ch of text) {
    if (/\s/.test(ch)) w += 0.3
    else if (/[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch)) w += 1
    else if (/[A-Z0-9]/.test(ch)) w += 0.68
    else w += 0.56
  }
  return Math.ceil(w * size)
}

/**
 * 바탕 도형이 감싸는 글자(containerOf) — 편집 뒤 reflow에서 글자가 늘면 바탕도 함께 늘어 글자가 띠·말풍선 밖으로 나가지 않게 한다.
 * 디자인 컷은 마운트 reflow를 끄므로 최초 배치는 템플릿이 잰 높이 그대로다.
 */
export function contain(container: CanvasElement, children: Array<CanvasElement | null | undefined>): void {
  const ids = children.filter((c): c is CanvasElement => Boolean(c)).map((c) => c.id)
  if (ids.length > 0) container.containerOf = [...(container.containerOf ?? []), ...ids]
}

export class CutBuilder {
  readonly elements: CanvasElement[] = []
  private z = 1

  private next(): number {
    return this.z++
  }

  /**
   * 글자 상자 — 높이는 줄바꿈 추정. 반환값의 bottom으로 다음 줄 위치를 잡는다.
   * 수량+단위는 한 줄에(keepCountUnits — 빌더 POINT 제목과 같은 규칙): CTA '두 / 칸을 살펴보세요'처럼 갈리지 않게 줄바꿈 없는 공백으로 묶는다
   */
  text(
    name: string,
    content: string,
    token: TypeToken,
    x: number,
    y: number,
    width: number,
    color: string,
    align: 'left' | 'center' | 'right' = 'left',
    accent?: Accent | null
  ): { el: CanvasElement; bottom: number } {
    const shown = keepFactUnits(content, { size: token.size, width })
    const height = measureCutText(content, token.size, token.lineHeight, width)
    const el = makeTextEl(name, shown, token.level, x, y, width, color, align, this.next(), {
      fontSize: token.size,
      fontWeight: token.weight,
      lineHeight: token.lineHeight,
      height,
      ...(token.fontFamily ? { fontFamily: token.fontFamily } : {}),
    })
    // v2 강조 구절(C5) — 묶은 글(shown)에서 고른다. 글자·높이는 그대로이고 richContent로 색(형광 띠)만 입힌다.
    // 모델이 고른 구절(T1-17)이 이 글에 있으면 그것을, 없으면(옛 잡·다른 칸·고친 제목) 지금 규칙으로 고른다
    const phrase = accent ? (phraseIn(shown, accent.phrase) ?? accentPhraseOf(shown, accent.usp)) : null
    const rich = phrase && accent ? richWithAccent(shown, phrase, accent.css) : null
    if (rich && el.textProps) el.textProps.richContent = rich
    this.elements.push(el)
    return { el, bottom: y + height }
  }

  /** v2 머리 라벨(C5 — 캡슐은 POINT 장 번호에만): 캡슐 없이 작은 굵은 글자 한 줄. 반환값은 아래 끝 */
  label(name: string, label: string, x: number, y: number, width: number, color: string, align: 'left' | 'center' = 'left'): number {
    return this.text(name, label, TYPE.LABEL, x, y, width, color, align).bottom
  }

  shape(
    name: string,
    shapeType: ShapeType,
    x: number,
    y: number,
    width: number,
    height: number,
    props: {
      fill?: string
      stroke?: string
      strokeWidth?: number
      borderRadius?: number
      borderRadii?: [number, number, number, number]
    }
  ): CanvasElement {
    const el: CanvasElement = {
      id: uid('shp'),
      type: 'shape',
      name,
      transform: { x, y, width, height, rotation: 0 },
      zIndex: this.next(),
      isLocked: false,
      isVisible: true,
      opacity: 1,
      shapeProps: { shapeType, ...props },
    }
    this.elements.push(el)
    return el
  }

  svg(name: string, svgString: string, x: number, y: number, width: number, height: number): CanvasElement {
    const el: CanvasElement = {
      id: uid('svg'),
      type: 'svg',
      name,
      transform: { x, y, width, height, rotation: 0 },
      zIndex: this.next(),
      isLocked: false,
      isVisible: true,
      opacity: 1,
      svgProps: { svgString },
    }
    this.elements.push(el)
    return el
  }

  /**
   * 사진 — frame 'decor'는 T4 장식 대상(rect·roundedRect 액자), 'plain'은 clip-path 반경(장식 대상 아님).
   * 'circle'은 편집기·내보내기가 함께 아는 원 틀이고, 'arch'는 위가 둥근 틀이다(큰 반경은 브라우저가 폭의 절반으로 줄인다). 둘은 K 라인만 쓴다.
   * fit 'contain'은 사진 전체를 상자 안에 넣고 남는 자리는 투명(섹션 바탕이 비친다 — 내보내기 HTML도 bgColor를 칠하므로 투명으로 둔다).
   * crop은 원본 대비 퍼센트(cropRect) — 플레이트 크롭 창(§2.3)에 쓴다.
   */
  image(
    name: string,
    src: string,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: {
      frame: 'decor' | 'plain' | 'circle' | 'arch'
      /** decor 액자의 모서리 — SHARP 문법은 직각(rect), SOFT는 roundedRect(반경 16). 둘 다 장식 대상 */
      sharp?: boolean
      /**
       * plain은 clip-path 반경(없으면 0). decor 둥근 틀은 K 컨셉 사진 반경(T1-28)이고 cornerRadius 칸에도 남긴다 — 편집기·내보내기가 그 칸을 읽는다.
       * decor에 없으면 DECOR_RADIUS 16이고 cornerRadius 칸을 두지 않는다(D 요소 그대로)
       */
      radius?: number
      fit?: 'cover' | 'contain'
      crop?: { x: number; y: number; width: number; height: number }
      imageType?: string
    }
  ): CanvasElement {
    const decor = opts.frame === 'decor'
    const radius = opts.radius ?? 0
    const decorRadius = decor && !opts.sharp && opts.radius !== undefined ? opts.radius : null
    const contain = opts.fit === 'contain'
    const el: CanvasElement = {
      id: uid('frm'),
      type: 'framed-image',
      name,
      transform: { x, y, width, height, rotation: 0 },
      zIndex: this.next(),
      isLocked: false,
      isVisible: true,
      opacity: 1,
      framedImageProps: {
        src,
        alt: name,
        frameId: opts.frame === 'circle' ? 'circle' : decor ? (opts.sharp ? 'rect' : 'roundedRect') : 'designcut',
        clipPath:
          opts.frame === 'arch'
            ? ARCH_CLIP
            : decor
              ? opts.sharp
                ? 'none'
                : `inset(0 round ${decorRadius ?? DECOR_RADIUS}px)`
              : radius > 0
                ? `inset(0 round ${radius}px)`
                : 'none',
        viewBox: '0 0 100 100',
        bgColor: contain ? 'transparent' : '#FFFFFF',
        objectFit: contain ? 'contain' : 'cover',
        imageType: opts.imageType ?? 'designcut',
        isUserUploaded: false,
        ...(decorRadius !== null ? { cornerRadius: decorRadius } : {}),
        ...(opts.crop ? { cropRect: { ...opts.crop } } : {}),
      },
    }
    this.elements.push(el)
    return el
  }

  /** 캡슐 배지(LABEL) — 채움 또는 외곽선. 반환값은 캡슐 폭 */
  capsule(
    name: string,
    label: string,
    token: TypeToken,
    x: number,
    y: number,
    style: { fill?: string; stroke?: string; text: string; radius: number; height?: number }
  ): number {
    const height = style.height ?? 64
    const width = approxTextWidth(label, token.size) + 56
    const bg = this.shape(`${name}-bg`, 'roundedRect', x, y, width, height, {
      fill: style.fill ?? 'transparent',
      ...(style.stroke ? { stroke: style.stroke, strokeWidth: 2 } : {}),
      borderRadius: style.radius,
    })
    const textH = Math.ceil(token.size * token.lineHeight)
    const text = this.text(
      `${name}-text`,
      label,
      token,
      x,
      y + Math.round((height - textH) / 2),
      width,
      style.text,
      'center'
    )
    contain(bg, [text.el])
    return width
  }

  /** 제품 사진 — 카드·그림자 없이 contain(잘림 0). 바탕은 섹션이 사진 배경색으로 칠한다. decor면 T4 장식 대상 */
  product(
    src: string,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: { decor: boolean; sharp: boolean; crop?: { x: number; y: number; width: number; height: number } }
  ): CanvasElement {
    return this.image('designcut-product', src, x, y, width, height, {
      frame: opts.decor ? 'decor' : 'plain',
      sharp: opts.sharp,
      // 자르기 창은 상자와 비율이 같다 — 창이 상자를 꽉 채운다
      fit: opts.crop ? 'cover' : 'contain',
      ...(opts.crop ? { crop: opts.crop } : {}),
      imageType: 'designcut_product',
    })
  }
}
