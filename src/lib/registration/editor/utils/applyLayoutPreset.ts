import type { CanvasSection, CanvasElement, TextElementProps } from '@/lib/registration/editor/types/canvas';
import type { LayoutPreset, LayoutCategory, LayoutElementSlot } from '@/lib/registration/editor/types/layout';
import type { StrategyContract } from '@/lib/registration/editor/stores/editorStore';
import type { DesignPalette } from '@/lib/registration/editor/types/editor';
import {
  SECTION_FONT_SCHEME,
  SECTION_LABEL_HEADER_SLOTS,
  SECTION_HEADER_FONT_SIZE,
  SECTION_HEADER_ACCENT_W,
  SECTION_HEADER_ACCENT_H,
  SPACING,
  TYPOGRAPHY,
  type GroupFontPair,
} from '@/lib/registration/editor/constants/designTokens';
import { isAllowedEditorFont } from '@/lib/registration/editor/constants/fonts';
import { measureTextBlock } from '@/lib/registration/editor/utils/sectionConverter/measure';
import { isFullBleedClosure } from '@/lib/registration/editor/utils/sectionConverter';
import { isAnnotationElement, TABLE_NAME_ELEMENT } from '@/lib/registration/editor/utils/mobileReadability';

/**
 * 섹션에 새 레이아웃 프리셋을 적용한다.
 * full은 배치와 프리셋 스타일을 모두 적용하는 기존 모드다.
 * placement-only는 콘텐츠·기존 스타일·배경을 유지하고 배치와 오버플로 캐스케이드만 적용한다.
 *
 * 매칭 전략 (0~3단계):
 * 0. 기존 매칭: 직전 slotAssignments 우선 재사용
 * 1. 정확 매칭: slotId === element.name
 * 2. 퍼지 매칭: 타입(text/image) + 역할(headline/body/hero) 기반
 * 3. 순서 매칭: 같은 타입 내에서 순서대로 매칭
 *
 * 레이아웃 트랙 A — 디자인 안전성 보장:
 * - 사용자가 편집한 스타일(userStyledKeys)은 프리셋 값으로 덮어쓰지 않는다
 * - 텍스트는 동기 fit 패스로 슬롯에 맞춰 폰트 단계 축소 → 그래도 넘치면
 *   높이 성장 + 아래 요소 캐스케이드 (커밋 스냅샷이 정합 좌표를 갖도록)
 * - 이미지 슬롯 비율이 달라지면 cropRect를 pct 공간에서 보정하고 fill을 금지
 * - 매칭 안 된 기존 요소: 콘텐츠 보유 요소는 최하단에 스택, 이전 레이아웃의
 *   장식 요소(shape/svg/빈 요소)는 제거한다 (교체 직전 히스토리로 undo 가능)
 */
export type PresetApplyMode = 'full' | 'placement-only';

export interface ApplyPresetOptions {
  mode?: PresetApplyMode;
  /**
   * 최초 자동 적용(R4 렌더 리듬 잡) — 매칭 안 된 슬롯을 빈 글자·빈 사진 요소로 만들지 않는다. 내용 없는 칸이 짙은 띠 아래
   * 빈 영역을 만들었다(R4 심사 P02·P07 해결 섹션의 빈 body 슬롯). 편집기에서 고른 레이아웃은 그대로 빈 칸을 둔다(채워 넣을 자리).
   */
  omitEmptySlots?: boolean;
}

/** 옵션 갤러리(T6b, optionGallery.ts) 요소 이름 — 이벤트 옵션 섹션의 option_title·option_0·option_img와 기존 petit_div 알약(petit_opt_*)은 해당하지 않는다 */
const OPTION_GALLERY_ELEMENT = /^option_(?:card|chip|qty|size_row|bundle|representative|axis|more)(?:_|$)/;

/**
 * 옵션 카드 섹션인가(R4) — 프리셋은 요소를 슬롯에 하나씩 옮겨 카드 바탕·사진·라벨이 서로 다른 자리로 흩어진다(카드 배치가 깨진다).
 * 이 섹션에는 프리셋을 적용하지 않는다: 초기 자동 적용(applyLayoutPresetIfSafe → null)과 편집기 레이아웃 목록(LayoutLibrary) 모두.
 */
export function isOptionGallerySection(section: Pick<CanvasSection, 'elements'>): boolean {
  return section.elements.some((el) => OPTION_GALLERY_ELEMENT.test(el.name));
}

/**
 * 강조 장식(T4)은 프리셋 매칭·유실 가드에 넣지 않는다 — 레이아웃이 바뀌면 원본 투영 좌표가 맞지 않아 함께 걷어낸다.
 * 표 이름(TABLE_NAME_ELEMENT)은 장식 규칙만 따르는 내용이라 남긴다 — 걷어내면 표에 값만 남는다(K2).
 */
const isDecoration = (el: CanvasElement) => isAnnotationElement(el) && el.name !== TABLE_NAME_ELEMENT;
function withoutAnnotations(section: CanvasSection): CanvasSection {
  return section.elements.some(isDecoration)
    ? { ...section, elements: section.elements.filter((el) => !isDecoration(el)) }
    : section;
}

export function applyLayoutPreset(
  sectionIn: CanvasSection,
  preset: LayoutPreset,
  palette?: DesignPalette | null,
  options?: ApplyPresetOptions,
): CanvasSection {
  // 옵션 카드 섹션은 배치를 그대로 둔다(isOptionGallerySection) — 화면 경로가 막지만 호출부가 늘어도 카드가 깨지지 않게
  if (isOptionGallerySection(sectionIn)) return sectionIn;
  const section = withoutAnnotations(sectionIn);
  const mode = options?.mode ?? 'full';

  // 트랙 C-3: 배경값의 {{palette.*}} 토큰을 브랜드 팔레트로 해석
  const background = {
    ...preset.structure.background,
    value: resolvePaletteTokens(preset.structure.background.value, palette),
  };
  const categoryDefaults = getCategoryDefaults(preset.category, background);
  const groupFonts: GroupFontPair =
    SECTION_FONT_SCHEME[section.groupType] ?? SECTION_FONT_SCHEME.modules;

  // 섹션 라벨 헤더(핵심 포인트 등)를 프리셋 매핑 전에 id로 포착 — 매핑 후엔
  // name이 슬롯ID로 바뀌므로 id로만 추적 가능. 프리셋 적용 후 68px+accent 복원.
  const labelHeaderId = section.elements.find(
    (el) => el.type === 'text' && SECTION_LABEL_HEADER_SLOTS.has(el.name),
  )?.id;

  // 매칭 실행
  const { matched, unmatchedElements } = matchElementsToSlots(
    section.elements,
    preset.structure.elements,
    section.slotAssignments,
  );

  const newElements: CanvasElement[] = preset.structure.elements.map((slot, index) => {
    const existing = matched.get(slot.slotId);
    const height = typeof slot.position.height === 'number' ? slot.position.height : 100;

    if (existing) {
      // 콘텐츠 보존 + 위치/크기 + 스타일 적용
      const updated: CanvasElement = {
        ...existing,
        name: slot.slotId,  // 새 레이아웃의 slotId로 name 갱신
        transform: {
          ...existing.transform,
          x: slot.position.x,
          y: slot.position.y,
          width: slot.position.width,
          height,
        },
      };

      // 텍스트 스타일 머지 (content 보존, 사용자 편집 키는 프리셋보다 우선)
      if (mode === 'full' && updated.textProps) {
        const resolvedStyle = resolveTextStyle(slot, categoryDefaults, slot.slotId, groupFonts);
        if (resolvedStyle) {
          // P1-5(2026-07-11): typoLevel 보유 요소의 위계 크기 보호 —
          // 카테고리 기본 fontSize(bold/full_bleed 72, overlay 등 64)가 컨셉설명
          // h2(60)를 H1급으로 승격하거나 H1(90)을 72로 강등하는 것을 차단한다.
          // 슬롯이 fontSize를 직접 지정한 경우(프리셋 설계 의도, lint:presets 검증
          // 대상)만 반영하고, 카테고리 크기는 무시 — 정렬·색·굵기만 카테고리 적용.
          const elLevel = updated.textProps.typoLevel;
          const slotHasExplicitSize = slot.textStyle?.fontSize !== undefined;
          if (elLevel && !slotHasExplicitSize && resolvedStyle.fontSize !== undefined) {
            const finalLevel = resolvedStyle.typoLevel ?? elLevel;
            if (finalLevel !== elLevel) {
              // 슬롯이 위계 자체를 바꾸면(h2→h1 등) 새 위계의 정본 크기로
              resolvedStyle.fontSize = TYPOGRAPHY[finalLevel].fontSize;
            } else {
              delete resolvedStyle.fontSize;
            }
          }
          const preserved: Partial<TextElementProps> = {};
          for (const key of updated.textProps.userStyledKeys ?? []) {
            const value = updated.textProps[key as keyof TextElementProps];
            if (value !== undefined) {
              (preserved as Record<string, unknown>)[key] = value;
            }
          }
          updated.textProps = { ...updated.textProps, ...resolvedStyle, ...preserved };
        }
      }

      // 이미지 스타일 머지 (src/alt 보존) + 비율 변화 시 cropRect 보정
      applyImageSlotStyle(updated, existing, slot, height, mode === 'full');

      return updated;
    }

    // 매칭 실패 → 빈 요소 생성
    return createSlotElement(slot, section.id, index, categoryDefaults, groupFonts);
  });

  const slotAssignments: Record<string, string> = {};
  for (const [slotId, element] of matched) {
    slotAssignments[element.id] = slotId;
  }
  for (const element of newElements) {
    if (slotAssignments[element.id] === undefined) {
      slotAssignments[element.id] = element.name;
    }
  }

  // required slot 보강 (프리셋 필수 슬롯 누락 방지)
  const required = ensureRequiredSlots(newElements, preset, section.id, groupFonts);
  // R4: 최초 자동 적용은 내용 없이 새로 만든 슬롯 요소를 뺀다 — 유실 가드(applyLayoutPresetIfSafe)는 적용 전에 끝났고
  // 기존 요소는 하나도 빼지 않는다. 뺀 요소의 매칭 기록도 지운다
  const originalIds = new Set(section.elements.map((el) => el.id));
  const withRequired = options?.omitEmptySlots
    ? required.filter((el) => originalIds.has(el.id) || !isEmptySlotElement(el))
    : required;
  if (withRequired.length !== required.length) {
    const kept = new Set(withRequired.map((el) => el.id));
    for (const id of Object.keys(slotAssignments)) if (!kept.has(id)) delete slotAssignments[id];
  }

  // 섹션 라벨 헤더: fit 패스 '전에' 68px로 강제 + fontSize 잠금.
  // 잠금 시 fit이 축소하지 않고, 대신 높이 성장 + 아래 요소 캐스케이드로
  // 오버랩을 흡수한다 (프리셋 슬롯이 작아도 안전).
  if (mode === 'full' && labelHeaderId) {
    lockSectionLabelHeaderStyle(withRequired, labelHeaderId, palette, groupFonts);
  }

  // 매칭되지 않은 기존 요소 분류:
  // 콘텐츠 보유(텍스트 내용/이미지 src/카드) → 최하단 스택으로 보존,
  // 장식(shape/svg/빈 텍스트/빈 이미지) → 이전 레이아웃 소품이므로 제거
  const contentLeftovers = unmatchedElements.filter(isContentBearing);

  // 동기 텍스트 fit 패스 + 세로 캐스케이드 (오버플로/겹침 방지)
  const fitted = fitTextAndCascade(withRequired, { allowShrink: mode === 'full' });

  // 콘텐츠 잔여 요소 최하단 스택
  const stacked = stackLeftovers(fitted, contentLeftovers);

  // 섹션 라벨 헤더 accent 라인 — fit/캐스케이드 후 최종 헤더 위치 위에 삽입
  const allElements = labelHeaderId
    ? addSectionLabelHeaderAccent(stacked, labelHeaderId, palette)
    : stacked;

  // 배경 리듬 유지(2026-07-08): 프리셋 배경이 라이트/뉴트럴(순수 흰색·팔레트 베이스
  // 톤 포함)이면 무의견으로 보고 섹션의 팔레트 리듬 배경(convert.ts Step 6)을 유지한다.
  // 프리셋이 '다크 단색'이나 'gradient'를 의도했을 때만 그 배경을 적용한다.
  // (기존: 순수 흰색만 무의견 처리 → 라이트 팔레트틴트 프리셋이 리듬을 덮어 연속
  //  동일 배경이 발생하던 문제 수정)
  const bgColor =
    mode === 'placement-only'
      ? section.canvas.backgroundColor
      : background.type === 'gradient' && background.value.includes('gradient')
        ? background.value
        : background.type === 'solid' && isDarkColor(background.value)
          ? background.value
          : section.canvas.backgroundColor;

  // 섹션 높이: 프리셋 기준값과 실제 콘텐츠 하단 중 큰 쪽 (콘텐츠 잘림 방지)
  let maxBottom = 0;
  for (const el of allElements) {
    const bottom = el.transform.y + el.transform.height;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  // A-5(섹션 리듬): 풀블리드 마감 섹션은 변환(computeSectionHeight)과 동일 판정으로
  // 하단 패딩 0 — 프리셋 적용 왕복에서도 배너 밑 배경 띠가 되살아나지 않게 한다
  const bottomPad = isFullBleedClosure(allElements) ? 0 : SECTION_BOTTOM_PADDING;
  const sectionHeight = Math.max(
    preset.structure.estimatedHeight,
    Math.ceil(maxBottom) + bottomPad,
  );

  return {
    ...section,
    layoutId: preset.id,
    slotAssignments,
    canvas: {
      ...section.canvas,
      height: sectionHeight,
      backgroundColor: bgColor,
    },
    elements: allElements,
  };
}

// 섹션 하단 여백 — 정본 토큰(변환·리플로우와 동일 값) 참조
const SECTION_BOTTOM_PADDING = SPACING.sectionBottomPadding;

// ─────────────────────────────────────────────
// 섹션 라벨 헤더 통일 (2026-07-08)
// 빌더는 '핵심 포인트' 등에 68px + accent 라인을 부여하지만, 프리셋이 적용되면
// 헤더가 슬롯 스타일(예: 45px)로 축소되고 accent(장식 shape)가 제거된다.
// 프리셋 적용 섹션도 동일하게 68px + accent를 갖도록 헤더를 복원한다.
// (headerId는 매핑 전에 포착 — 매핑 후 name이 슬롯ID로 바뀌기 때문)
// ─────────────────────────────────────────────
/** 헤더 스타일을 섹션 라벨 규격(68px)으로 강제 + fontSize 잠금 (fit 전 호출). */
function lockSectionLabelHeaderStyle(
  elements: CanvasElement[],
  headerId: string,
  palette: DesignPalette | null | undefined,
  groupFonts: GroupFontPair,
): void {
  const h = elements.find((el) => el.id === headerId);
  if (!h?.textProps) return;
  h.textProps = {
    ...h.textProps,
    fontSize: SECTION_HEADER_FONT_SIZE,
    fontWeight: 800,
    fontFamily: groupFonts.heading,
    typoLevel: 'h2',
    color: palette?.primary ?? h.textProps.color,
    // fontSize 잠금 → fitTextAndCascade가 축소 대신 높이 성장+캐스케이드로 흡수
    userStyledKeys: Array.from(new Set([...(h.textProps.userStyledKeys ?? []), 'fontSize'])),
  };
}

/** fit/캐스케이드 후 최종 헤더 위치 위에 accent 라인을 삽입 (정렬 반영). */
function addSectionLabelHeaderAccent(
  elements: CanvasElement[],
  headerId: string,
  palette: DesignPalette | null | undefined,
): CanvasElement[] {
  const h = elements.find((el) => el.id === headerId);
  if (!h?.textProps) return elements;

  const primary = palette?.primary ?? h.textProps.color;
  const align = h.textProps.textAlign ?? 'center';
  let accentX: number;
  if (align === 'left') accentX = h.transform.x;
  else if (align === 'right') accentX = h.transform.x + h.transform.width - SECTION_HEADER_ACCENT_W;
  else accentX = h.transform.x + Math.floor((h.transform.width - SECTION_HEADER_ACCENT_W) / 2);
  const accentY = Math.max(0, h.transform.y - 20 - SECTION_HEADER_ACCENT_H);

  const accent: CanvasElement = {
    id: `${headerId}_accent`,
    type: 'shape',
    name: `${h.name}_accent`,
    transform: { x: accentX, y: accentY, width: SECTION_HEADER_ACCENT_W, height: SECTION_HEADER_ACCENT_H, rotation: 0 },
    zIndex: 2,
    isLocked: false,
    isVisible: true,
    opacity: 1,
    shapeProps: { shapeType: 'roundedRect', fill: primary, borderRadius: SECTION_HEADER_ACCENT_H / 2 },
  };

  const withoutOldAccent = elements.filter((el) => el.id !== `${headerId}_accent`);
  return [...withoutOldAccent, accent];
}

// ─────────────────────────────────────────────
// 트랙 B-2: 초기 변환 직후 AI 선택 프리셋 1회 적용 (안전 가드)
// ─────────────────────────────────────────────

/** 초기 변환 시 AI 선택 프리셋 적용 여부 — 문제 발생 시 false로 즉시 롤백 */
export const ENABLE_INITIAL_PRESET_APPLY = true;

/** 콘텐츠 보유 요소 중 슬롯 매칭에 실패해도 허용하는 최대 비율 */
const INITIAL_APPLY_MAX_UNMATCHED_RATIO = 0.3;

/**
 * 콘텐츠 유실 가드를 통과할 때만 프리셋을 적용한다.
 * 콘텐츠 보유 요소의 30% 초과가 새 프리셋 슬롯에 매칭되지 못하면
 * (복잡한 빌더 섹션에 단순 프리셋을 얹는 상황) null을 반환하고
 * 호출부는 기존 빌더 레이아웃을 유지한다.
 */
export function applyLayoutPresetIfSafe(
  sectionIn: CanvasSection,
  preset: LayoutPreset,
  palette?: DesignPalette | null,
  options?: ApplyPresetOptions,
): CanvasSection | null {
  if (isOptionGallerySection(sectionIn)) return null;
  const section = withoutAnnotations(sectionIn);
  const contentEls = section.elements.filter(isContentBearing);
  const { matched, unmatchedElements } = matchElementsToSlots(
    section.elements,
    preset.structure.elements,
    section.slotAssignments,
  );
  if (matched.size === 0) return null;
  if (contentEls.length > 0) {
    const unmatchedContent = unmatchedElements.filter(isContentBearing).length;
    if (unmatchedContent / contentEls.length > INITIAL_APPLY_MAX_UNMATCHED_RATIO) return null;
  }
  return applyLayoutPreset(section, preset, palette, options);
}

// ─────────────────────────────────────────────
// 트랙 C-3: 배경 팔레트 토큰 해석
// 프리셋 background.value에 {{palette.primary}} 등을 허용해
// 하드코딩 색상 대신 브랜드 팔레트와 연동한다.
// ─────────────────────────────────────────────

const PALETTE_TOKEN_DEFAULTS: DesignPalette = {
  primary: '#1A1A2E',
  secondary: '#E94560',
  bgMain: '#FFFFFF',
  bgSub: '#F7F7F7',
  textMain: '#333333',
  textHighlight: '#1A1A2E',
};

function resolvePaletteTokens(value: string, palette?: DesignPalette | null): string {
  if (!value.includes('{{')) return value;
  return value.replace(/\{\{\s*palette\.(\w+)\s*\}\}/g, (whole, key: string) => {
    const k = key as keyof DesignPalette;
    return palette?.[k] ?? PALETTE_TOKEN_DEFAULTS[k] ?? whole;
  });
}

// ─────────────────────────────────────────────
// 0~3단계 스마트 매칭
// ─────────────────────────────────────────────

/** 슬롯의 역할 분류 */
type SlotRole = 'headline' | 'subtext' | 'body' | 'label' | 'image_hero' | 'image_other' | 'card' | 'other';

function classifyRole(name: string, elementType: string): SlotRole {
  const n = name.toLowerCase();

  if (elementType === 'image' || elementType === 'framed-image') {
    if (n.includes('hero') || n.includes('main') || n === 'bg') return 'image_hero';
    return 'image_other';
  }
  if (elementType === 'card_group') return 'card';

  // text 역할 분류
  if (n.includes('headline') || n.includes('title') || n === 'question' || n === 'hook_text') return 'headline';
  if (n.includes('label') || n === 'cert_label' || n.includes('count')) return 'label';
  if (n.includes('sub') || n.includes('desc') || n.includes('caption')) return 'subtext';
  return 'body';
}

/** 요소 타입을 프리셋 슬롯 타입과 비교 가능하게 정규화 */
function normalizeType(elType: string): string {
  if (elType === 'framed-image') return 'image';
  return elType;
}

function matchElementsToSlots(
  elements: CanvasElement[],
  slots: LayoutElementSlot[],
  priorAssignments?: Record<string, string>,
): {
  matched: Map<string, CanvasElement>;  // slotId → element
  unmatchedElements: CanvasElement[];
} {
  const matched = new Map<string, CanvasElement>();
  const usedElements = new Set<string>();  // element.id
  const matchedSlots = new Set<string>();  // slotId

  // ── 0단계: 기존 assignment 우선 재사용 ──
  if (priorAssignments) {
    const elementsById = new Map(elements.map((element) => [element.id, element]));
    const slotsById = new Map(slots.map((slot) => [slot.slotId, slot]));

    // 현재 프리셋에 없는 과거 slotId는 조회되지 않아 자연히 무시된다.
    for (const [elementId, slotId] of Object.entries(priorAssignments)) {
      const element = elementsById.get(elementId);
      const slot = slotsById.get(slotId);
      if (
        element
        && slot
        && !usedElements.has(elementId)
        && !matchedSlots.has(slotId)
        && isTypeCompatible(normalizeType(element.type), slot.elementType)
      ) {
        matched.set(slotId, element);
        usedElements.add(elementId);
        matchedSlots.add(slotId);
      }
    }
  }

  // ── 1단계: 정확 매칭 (name === slotId) ──
  const byName = new Map(elements.map((el) => [el.name, el]));
  for (const slot of slots) {
    if (matchedSlots.has(slot.slotId)) continue;
    const exact = byName.get(slot.slotId);
    if (exact && !usedElements.has(exact.id)) {
      matched.set(slot.slotId, exact);
      usedElements.add(exact.id);
      matchedSlots.add(slot.slotId);
    }
  }

  // ── 2단계: 역할 기반 퍼지 매칭 ──
  const unmatchedSlots = slots.filter((s) => !matchedSlots.has(s.slotId));
  const availableElements = elements.filter((el) => !usedElements.has(el.id));

  // 역할별로 그룹핑
  const availableByRole = new Map<SlotRole, CanvasElement[]>();
  for (const el of availableElements) {
    const role = classifyRole(el.name, normalizeType(el.type));
    const list = availableByRole.get(role) ?? [];
    list.push(el);
    availableByRole.set(role, list);
  }

  for (const slot of unmatchedSlots) {
    const targetRole = classifyRole(slot.slotId, slot.elementType);
    const candidates = availableByRole.get(targetRole);

    if (candidates && candidates.length > 0) {
      const el = candidates.shift()!;
      matched.set(slot.slotId, el);
      usedElements.add(el.id);
      matchedSlots.add(slot.slotId);
      continue;
    }

    // 역할 정확 매칭 실패 → 같은 타입 그룹에서 fallback
    const slotBaseType = slot.elementType === 'card_group' ? 'card_group' : slot.elementType;
    const fallbackRole = getFallbackRoles(targetRole);
    let found = false;
    for (const fbRole of fallbackRole) {
      const fbCandidates = availableByRole.get(fbRole);
      if (fbCandidates && fbCandidates.length > 0) {
        const el = fbCandidates.shift()!;
        // 타입 호환 확인 (text↔text, image↔image)
        if (isTypeCompatible(normalizeType(el.type), slotBaseType)) {
          matched.set(slot.slotId, el);
          usedElements.add(el.id);
          matchedSlots.add(slot.slotId);
          found = true;
          break;
        } else {
          // 꺼냈지만 타입 불일치 → 다시 넣기
          fbCandidates.unshift(el);
        }
      }
    }

    // ── 3단계: 순서 매칭 (같은 타입 아무거나) ──
    if (!found) {
      const remaining = elements.filter(
        (el) => !usedElements.has(el.id) && isTypeCompatible(normalizeType(el.type), slotBaseType),
      );
      if (remaining.length > 0) {
        const el = remaining[0];
        matched.set(slot.slotId, el);
        usedElements.add(el.id);
        matchedSlots.add(slot.slotId);
      }
    }
  }

  const unmatchedElements = elements.filter((el) => !usedElements.has(el.id));
  return { matched, unmatchedElements };
}

/** 역할 fallback 순서 */
function getFallbackRoles(role: SlotRole): SlotRole[] {
  switch (role) {
    case 'headline': return ['body', 'subtext', 'label'];
    case 'subtext': return ['body', 'label', 'headline'];
    case 'body': return ['subtext', 'headline', 'label'];
    case 'label': return ['subtext', 'body', 'headline'];
    case 'image_hero': return ['image_other'];
    case 'image_other': return ['image_hero'];
    case 'card': return [];
    default: return [];
  }
}

/** 타입 호환성 (text↔text, image↔image) */
function isTypeCompatible(elType: string, slotType: string): boolean {
  if (elType === slotType) return true;
  // text 계열
  const textTypes = new Set(['text', 'badge']);
  if (textTypes.has(elType) && textTypes.has(slotType)) return true;
  // image 계열
  const imageTypes = new Set(['image', 'framed-image']);
  if (imageTypes.has(elType) && imageTypes.has(slotType)) return true;
  return false;
}

// ─────────────────────────────────────────────
// 트랙 A-3: 이미지 슬롯 스타일 — 비율 변화 시 cropRect 보정
// ─────────────────────────────────────────────

/** 슬롯 비율이 기존 대비 이만큼 이상 달라지면 크롭 상태를 신뢰하지 않는다 */
const ASPECT_RATIO_TOLERANCE = 0.1;

function aspectChanged(oldW: number, oldH: number, newW: number, newH: number): boolean {
  const oldRatio = oldW / Math.max(1, oldH);
  const newRatio = newW / Math.max(1, newH);
  return Math.abs(oldRatio - newRatio) / Math.max(oldRatio, newRatio) > ASPECT_RATIO_TOLERANCE;
}

/** crop은 pct-공간 비율 보정만으로 새 박스 비율에 무왜곡 적응 — 원본 픽셀 크기 불요, 확장 우선(사용자 선택 영역 보존). */
export function adaptCropRect(
  crop: { x: number; y: number; width: number; height: number },
  oldBoxW: number,
  oldBoxH: number,
  newBoxW: number,
  newBoxH: number,
): { x: number; y: number; width: number; height: number } {
  const oldAspect = Math.max(1, oldBoxW) / Math.max(1, oldBoxH);
  const newAspect = Math.max(1, newBoxW) / Math.max(1, newBoxH);
  const ratio = newAspect / oldAspect;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;

  let width = Math.max(1, Math.min(100, crop.width));
  let height = Math.max(1, Math.min(100, crop.height));
  if (ratio >= 1) {
    width *= ratio;
    if (width > 100) {
      height *= 100 / width;
      width = 100;
    }
  } else {
    height /= ratio;
    if (height > 100) {
      width *= 100 / height;
      height = 100;
    }
  }

  const roundToTwo = (value: number) => Math.round(value * 100) / 100;
  width = roundToTwo(Math.max(1, Math.min(100, width)));
  height = roundToTwo(Math.max(1, Math.min(100, height)));
  const x = roundToTwo(Math.max(0, Math.min(100 - width, centerX - width / 2)));
  const y = roundToTwo(Math.max(0, Math.min(100 - height, centerY - height / 2)));

  return { x, y, width, height };
}

function applyImageSlotStyle(
  updated: CanvasElement,
  existing: CanvasElement,
  slot: LayoutElementSlot,
  slotHeight: number,
  applySlotObjectFit: boolean,
): void {
  const changed = aspectChanged(
    existing.transform.width,
    existing.transform.height,
    slot.position.width,
    slotHeight,
  );

  if (updated.imageProps) {
    const nextFit = applySlotObjectFit
      ? slot.imageStyle?.objectFit ?? updated.imageProps.objectFit
      : updated.imageProps.objectFit;
    const nextProps = {
      ...updated.imageProps,
      // 비율이 달라진 슬롯에서 fill은 왜곡 → cover로 강제
      objectFit: changed && nextFit === 'fill' ? ('cover' as const) : nextFit,
    };
    if (changed && nextProps.cropRect) {
      nextProps.cropRect = adaptCropRect(
        nextProps.cropRect,
        existing.transform.width,
        existing.transform.height,
        slot.position.width,
        slotHeight,
      );
    }
    // 카드 사진 모서리(옵션 카드 — 카드 바탕 위 끝에 맞춘 반경)는 그 자리에서만 맞다. 슬롯으로 옮긴 사진은 각진 모서리로 되돌린다
    delete nextProps.borderRadii;
    updated.imageProps = nextProps;
  }

  if (updated.framedImageProps) {
    const nextFit = applySlotObjectFit
      ? slot.imageStyle?.objectFit ?? updated.framedImageProps.objectFit
      : updated.framedImageProps.objectFit;
    const nextProps = {
      ...updated.framedImageProps,
      objectFit: changed && nextFit === 'fill' ? ('cover' as const) : nextFit,
    };
    if (changed && nextProps.cropRect) {
      nextProps.cropRect = adaptCropRect(
        nextProps.cropRect,
        existing.transform.width,
        existing.transform.height,
        slot.position.width,
        slotHeight,
      );
    }
    updated.framedImageProps = nextProps;
  }
}

// ─────────────────────────────────────────────
// 트랙 A-2: 동기 텍스트 fit 패스 + 세로 캐스케이드
// 슬롯을 넘치는 텍스트는 폰트를 단계 축소(위계별 하한)하고,
// 그래도 넘치면 높이를 늘린 뒤 아래 요소를 밀어낸다.
// applyLayoutPreset 내부에서 동기 실행되므로 교체 직후의
// commitHistory 스냅샷이 이미 정합 좌표를 갖는다.
// ─────────────────────────────────────────────

/**
 * 타이포 위계별 폰트 하한(px) — 860px 소스 ×0.436 모바일 축소 기준.
 * 일괄상향(2026-07-08): 하한 밑으로는 축소하지 않는다 — 슬롯을 넘치면
 * 폰트를 더 줄이는 대신 높이 성장 + 캐스케이드로 흡수한다 (가독성 우선).
 */
const TEXT_FIT_MIN_FONT: Record<string, number> = {
  display: 60,
  h1: 60,
  h2: 52,
  body: 45,
  caption: 28,
};

function fitTextAndCascade(
  elements: CanvasElement[],
  options: { allowShrink: boolean },
): CanvasElement[] {
  const els = elements.map((el) => ({ ...el, transform: { ...el.transform } }));
  const sorted = [...els].sort((a, b) => a.transform.y - b.transform.y);

  for (const el of sorted) {
    if (el.type !== 'text') continue;
    const tp = el.textProps;
    if (!tp?.content?.trim()) continue;

    const slotH = el.transform.height;
    const width = el.transform.width;
    const fontLocked = tp.userStyledKeys?.includes('fontSize') ?? false;
    const floor = Math.min(tp.fontSize, TEXT_FIT_MIN_FONT[tp.typoLevel ?? 'body'] ?? 24);

    let fontSize = tp.fontSize;
    let estimated = measureTextBlock(tp.content, fontSize, tp.lineHeight, width);
    while (options.allowShrink && !fontLocked && estimated > slotH && fontSize - 2 >= floor) {
      fontSize -= 2;
      estimated = measureTextBlock(tp.content, fontSize, tp.lineHeight, width);
    }
    if (fontSize !== tp.fontSize) {
      el.textProps = { ...tp, fontSize };
    }

    // 하한까지 줄여도 넘치면 높이 성장 + 아래 요소 캐스케이드
    if (estimated > slotH) {
      const delta = estimated - slotH;
      const threshold = el.transform.y + slotH;
      el.transform.height = estimated;
      for (const other of els) {
        if (other.id === el.id) continue;
        if (other.transform.y >= threshold - 0.5) {
          other.transform.y += delta;
        }
      }
    }
  }

  return els;
}

// ─────────────────────────────────────────────
// 트랙 A-4: 매칭 안 된 요소 처리
// ─────────────────────────────────────────────

/** 콘텐츠(텍스트 내용/이미지/카드)를 실제로 보유한 요소인지 — 장식과 구분 */
/** 내용 없는 슬롯 요소 — 빈 글자 또는 src 없는 사진(createSlotElement·ensureRequiredSlots가 만든 자리) */
function isEmptySlotElement(el: CanvasElement): boolean {
  if (el.type === 'text') return !(el.textProps?.content ?? '').trim();
  if (el.type === 'image') return !el.imageProps?.src;
  return false;
}

export function isContentBearing(el: CanvasElement): boolean {
  switch (el.type) {
    case 'text':
      return !!(el.textProps?.content?.trim() || el.textProps?.richContent?.trim());
    case 'badge':
      return !!el.textProps?.content?.trim();
    case 'image':
      return !!el.imageProps?.src;
    case 'framed-image':
      return !!el.framedImageProps?.src;
    case 'card_group':
      return (el.cardGroupProps?.cards?.length ?? 0) > 0;
    default:
      // shape / svg — 이전 레이아웃의 장식 요소
      return false;
  }
}

const CANVAS_WIDTH = 860;
const LEFTOVER_GAP = 40;
const LEFTOVER_TOP_GAP = 80;

/**
 * 콘텐츠 잔여 요소를 배치된 요소들 아래에 세로 스택으로 재배치한다.
 * (기존: 원래 좌표 그대로 append → 새 레이아웃 위에 겹침)
 */
function stackLeftovers(placed: CanvasElement[], leftovers: CanvasElement[]): CanvasElement[] {
  if (leftovers.length === 0) return placed;

  let cursor = 0;
  for (const el of placed) {
    const bottom = el.transform.y + el.transform.height;
    if (bottom > cursor) cursor = bottom;
  }
  cursor += LEFTOVER_TOP_GAP;

  const stacked = leftovers.map((el, i) => {
    const width = Math.min(el.transform.width, CANVAS_WIDTH);
    const x = Math.max(0, Math.min(el.transform.x, CANVAS_WIDTH - width));
    const next: CanvasElement = {
      ...el,
      transform: { ...el.transform, x, y: cursor, width },
      zIndex: placed.length + i,
    };
    cursor += next.transform.height + LEFTOVER_GAP;
    return next;
  });

  return [...placed, ...stacked];
}

// ─────────────────────────────────────────────
// 슬롯 → 빈 요소 생성
// ─────────────────────────────────────────────

function createSlotElement(
  slot: LayoutElementSlot,
  sectionId: string,
  index: number,
  categoryDefaults: CategoryTextDefaults,
  groupFonts: GroupFontPair,
): CanvasElement {
  const height = typeof slot.position.height === 'number' ? slot.position.height : 100;

  const baseElement: CanvasElement = {
    id: `${sectionId}_${slot.slotId}_${Date.now()}_${index}`,
    type:
      slot.elementType === 'image'
        ? 'image'
        : slot.elementType === 'badge'
          ? 'badge'
          : slot.elementType === 'card_group'
            ? 'card_group'
            : 'text',
    name: slot.slotId,
    transform: {
      x: slot.position.x,
      y: slot.position.y,
      width: slot.position.width,
      height,
      rotation: 0,
    },
    zIndex: index,
    isLocked: false,
    isVisible: true,
    opacity: 1,
  };

  if (slot.elementType === 'text') {
    const headline = isHeadlineSlot(slot.slotId);
    const resolvedStyle = resolveTextStyle(slot, categoryDefaults, slot.slotId, groupFonts);
    baseElement.textProps = {
      content: '',
      // 트랙 E: 그룹 폰트 스킴 연동 (기존 Pretendard 하드코딩 → 헤딩 강등 방지)
      fontFamily: headline ? groupFonts.heading : groupFonts.body,
      fontSize: 45,
      fontWeight: headline ? 700 : 400,
      fontStyle: 'normal',
      textDecoration: 'none',
      color: '#333333',
      textAlign: 'left',
      lineHeight: 1.7,
      letterSpacing: 0,
      typoLevel: headline ? 'h2' : 'body',
      ...resolvedStyle,
    };
  } else if (slot.elementType === 'image') {
    baseElement.imageProps = {
      src: '',
      alt: slot.slotId,
      objectFit: slot.imageStyle?.objectFit ?? 'cover',
      imageType: slot.slotId,
      isUserUploaded: false,
    };
  }

  return baseElement;
}

// ─────────────────────────────────────────────
// 카테고리 기반 기본 스타일
// ─────────────────────────────────────────────

interface CategoryTextDefaults {
  headline: Partial<TextElementProps>;
  body: Partial<TextElementProps>;
}

function getCategoryDefaults(
  category: LayoutCategory,
  background: { type: string; value: string },
): CategoryTextDefaults {
  const isDark = background.type === 'solid' && isDarkColor(background.value);

  const base: CategoryTextDefaults = {
    headline: {
      textAlign: 'center',
      ...(isDark ? { color: '#FFFFFF' } : {}),
    },
    body: {
      ...(isDark ? { color: '#E5E7EB' } : {}),
    },
  };

  // 일괄상향(2026-07-08): 본문 45px(모바일 20px) / 헤드라인 최소 60px(모바일 26px)
  switch (category) {
    case 'bold':
      return {
        headline: { ...base.headline, fontSize: 72, fontWeight: 800, textAlign: 'center', letterSpacing: -1 },
        body: { ...base.body, fontSize: 45, fontWeight: 500, textAlign: 'center' },
      };
    case 'minimal':
      return {
        headline: { ...base.headline, fontSize: 60, fontWeight: 600, textAlign: 'left', letterSpacing: -0.5 },
        body: { ...base.body, fontSize: 45, fontWeight: 400, textAlign: 'left', lineHeight: 1.8 },
      };
    // 이미지 위 텍스트 전제 카테고리 — 밝은 이미지에서도 판독 확보
    case 'overlay':
      return {
        headline: { color: '#FFFFFF', fontSize: 64, fontWeight: 700, textAlign: 'center', textShadowAngle: 90, textShadowDistance: 2, textShadowBlur: 14, textShadowColor: 'rgba(0,0,0,0.55)' },
        body: { color: '#F3F4F6', fontSize: 45, fontWeight: 400, textAlign: 'center', textShadowAngle: 90, textShadowDistance: 2, textShadowBlur: 14, textShadowColor: 'rgba(0,0,0,0.55)' },
      };
    case 'gradient':
      return {
        headline: { ...base.headline, fontSize: 64, fontWeight: 700, textAlign: 'center' },
        body: { ...base.body, fontSize: 45, fontWeight: 400, textAlign: 'center' },
      };
    case 'split':
      return {
        headline: { ...base.headline, fontSize: 60, fontWeight: 700, textAlign: 'left' },
        body: { ...base.body, fontSize: 45, fontWeight: 400, textAlign: 'left' },
      };
    case 'stacked':
      return {
        headline: { ...base.headline, fontSize: 60, fontWeight: 700, textAlign: 'center' },
        body: { ...base.body, fontSize: 45, fontWeight: 400, textAlign: 'center', lineHeight: 1.8 },
      };
    case 'card':
      return {
        headline: { ...base.headline, fontSize: 60, fontWeight: 700, textAlign: 'center' },
        body: { ...base.body, fontSize: 45, fontWeight: 400, textAlign: 'center' },
      };
    case 'full_bleed':
      return {
        headline: { color: '#FFFFFF', fontSize: 72, fontWeight: 800, textAlign: 'center', textShadowAngle: 90, textShadowDistance: 2, textShadowBlur: 14, textShadowColor: 'rgba(0,0,0,0.55)' },
        body: { color: '#E5E7EB', fontSize: 45, fontWeight: 400, textAlign: 'center', textShadowAngle: 90, textShadowDistance: 2, textShadowBlur: 14, textShadowColor: 'rgba(0,0,0,0.55)' },
      };
    case 'dynamic':
      return {
        headline: { ...base.headline, fontSize: 64, fontWeight: 800, textAlign: 'left', letterSpacing: -1 },
        body: { ...base.body, fontSize: 45, fontWeight: 500, textAlign: 'left' },
      };
    case 'image_first':
    default:
      return base;
  }
}

const HEADLINE_SLOTS = new Set([
  'headline', 'label', 'title', 'concept_headline',
  'key_message', 'summary', 'cta_headline', 'main_title',
  'question', 'hook_text', 'solution_title', 'direction_title',
]);

function isHeadlineSlot(slotId: string): boolean {
  if (HEADLINE_SLOTS.has(slotId)) return true;
  if (slotId.includes('headline') || slotId.includes('title')) return true;
  return false;
}

const HEADING_TYPO_LEVELS = new Set(['display', 'h1', 'h2']);

function resolveTextStyle(
  slot: LayoutElementSlot,
  categoryDefaults: CategoryTextDefaults,
  slotId: string,
  groupFonts: GroupFontPair,
): Partial<TextElementProps> | null {
  const catStyle = isHeadlineSlot(slotId)
    ? categoryDefaults.headline
    : categoryDefaults.body;

  const slotStyle: Partial<TextElementProps> = { ...slot.textStyle };

  // 트랙 E: 프리셋 지정 fontFamily는 에디터 로드 가능 화이트리스트 통과 필수
  if (slotStyle.fontFamily && !isAllowedEditorFont(slotStyle.fontFamily)) {
    delete slotStyle.fontFamily;
  }

  // typoLevel 지정 슬롯: 그룹 폰트 스킴으로 폰트 결정 (직접 지정이 없을 때)
  if (slotStyle.typoLevel && !slotStyle.fontFamily) {
    slotStyle.fontFamily = HEADING_TYPO_LEVELS.has(slotStyle.typoLevel)
      ? groupFonts.heading
      : groupFonts.body;
  }

  if (Object.keys(slotStyle).length === 0 && Object.keys(catStyle).length === 0) return null;
  return { ...catStyle, ...slotStyle };
}

function isDarkColor(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

// ─────────────────────────────────────────────
// V4.3: 전략 호환성 검사
// ─────────────────────────────────────────────
export function checkStrategyCompatibility(
  preset: LayoutPreset,
  strategyContract: StrategyContract,
): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (preset.strategyTag && strategyContract.persuasion_axis) {
    const axis = strategyContract.persuasion_axis;
    const tag = preset.strategyTag;

    if (axis === 'emotion' && tag === 'proof') {
      warnings.push('감성형 상품에 증거 중심 레이아웃이 적용됩니다. 감성형 프리셋을 권장합니다.');
    }
    if (axis === 'function' && tag === 'emotion') {
      warnings.push('기능형 상품에 감성 중심 레이아웃이 적용됩니다. 기능형 프리셋을 권장합니다.');
    }
    if (axis === 'emotion' && tag === 'compare_heavy') {
      warnings.push('감성형 상품에 비교 중심 레이아웃이 적용됩니다. 스토리형 프리셋을 권장합니다.');
    }
  }

  return { compatible: warnings.length === 0, warnings };
}

// ─────────────────────────────────────────────
// V4.3: required slot 보강
// ─────────────────────────────────────────────
function ensureRequiredSlots(
  elements: CanvasElement[],
  preset: LayoutPreset,
  sectionId: string,
  groupFonts: GroupFontPair,
): CanvasElement[] {
  if (!preset.requiredSlots || preset.requiredSlots.length === 0) return elements;

  const existingNames = new Set(elements.map((el) => el.name));
  const result = [...elements];

  for (const requiredSlot of preset.requiredSlots) {
    if (!existingNames.has(requiredSlot)) {
      const isImage = requiredSlot.includes('image') || requiredSlot === 'hero' || requiredSlot === 'bg';
      const headline = isHeadlineSlot(requiredSlot);
      result.push({
        id: `${sectionId}_${requiredSlot}_fallback_${Date.now()}`,
        type: isImage ? 'image' : 'text',
        name: requiredSlot,
        transform: { x: 60, y: 60, width: 740, height: isImage ? 400 : 80, rotation: 0 },
        zIndex: result.length,
        isLocked: false,
        isVisible: true,
        opacity: 1,
        ...(isImage
          ? { imageProps: { src: '', alt: requiredSlot, objectFit: 'cover' as const, imageType: requiredSlot, isUserUploaded: false } }
          : {
              textProps: {
                content: '',
                fontFamily: headline ? groupFonts.heading : groupFonts.body,
                fontSize: 45,
                fontWeight: headline ? 700 : 400,
                fontStyle: 'normal' as const,
                textDecoration: 'none' as const,
                color: '#333333',
                textAlign: 'left' as const,
                lineHeight: 1.7,
                letterSpacing: 0,
                typoLevel: (headline ? 'h2' : 'body') as 'h2' | 'body',
              },
            }),
      });
    }
  }

  return result;
}
