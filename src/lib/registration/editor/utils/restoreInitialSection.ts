import type {
  CanvasElement,
  CanvasSection,
  FramedImageElementProps,
  ImageElementProps,
} from '@/lib/registration/editor/types/canvas';
import { adaptCropRect, isContentBearing } from '@/lib/registration/editor/utils/applyLayoutPreset';

// 복원은 프리셋 재적용이 아니라 baseline→current 머지 — 매칭 비가역 때문.

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type ImageProps = ImageElementProps | FramedImageElementProps;

function getImageProps(element: CanvasElement): ImageProps | undefined {
  if (element.type === 'image') return element.imageProps;
  if (element.type === 'framed-image') return element.framedImageProps;
  return undefined;
}

function mergeImageContent<T extends ImageProps>(
  baselineProps: T,
  currentProps: ImageProps,
  currentElement: CanvasElement,
  baselineElement: CanvasElement,
): T {
  const sourceUnchanged = currentProps.src === baselineProps.src;
  const merged: T = {
    ...baselineProps,
    src: currentProps.src,
    alt: currentProps.alt,
    isUserUploaded: currentProps.isUserUploaded,
    imageType: currentProps.imageType,
  };

  if (currentProps.originalPrompt !== undefined) {
    merged.originalPrompt = currentProps.originalPrompt;
  } else {
    delete merged.originalPrompt;
  }

  if (!sourceUnchanged) {
    delete merged.cropRect;
    if (currentProps.cropRect) {
      merged.cropRect = adaptCropRect(
        currentProps.cropRect,
        currentElement.transform.width,
        currentElement.transform.height,
        baselineElement.transform.width,
        baselineElement.transform.height,
      );
    }
  }

  return merged;
}

function mergeCurrentContent(
  baselineElement: CanvasElement,
  currentElement: CanvasElement,
): CanvasElement {
  if (
    (baselineElement.type === 'text' || baselineElement.type === 'badge') &&
    baselineElement.textProps &&
    currentElement.textProps
  ) {
    baselineElement.textProps.content = currentElement.textProps.content;
    if (currentElement.textProps.richContent !== undefined) {
      baselineElement.textProps.richContent = currentElement.textProps.richContent;
    } else {
      delete baselineElement.textProps.richContent;
    }
  }

  if (baselineElement.type === 'image' && baselineElement.imageProps) {
    const currentProps = getImageProps(currentElement);
    if (currentProps) {
      baselineElement.imageProps = mergeImageContent(
        baselineElement.imageProps,
        currentProps,
        currentElement,
        baselineElement,
      );
    }
  }

  if (baselineElement.type === 'framed-image' && baselineElement.framedImageProps) {
    const currentProps = getImageProps(currentElement);
    if (currentProps) {
      baselineElement.framedImageProps = mergeImageContent(
        baselineElement.framedImageProps,
        currentProps,
        currentElement,
        baselineElement,
      );
    }
  }

  if (baselineElement.type === 'card_group' && currentElement.cardGroupProps) {
    baselineElement.cardGroupProps = currentElement.cardGroupProps;
  }

  return baselineElement;
}

export function restoreInitialSection(
  current: CanvasSection,
  baselineSection: CanvasSection,
): CanvasSection {
  const currentCopy = deepCopy(current);
  const baselineCopy = deepCopy(baselineSection);
  const usedCurrentIds = new Set<string>();

  const elements = baselineCopy.elements.flatMap((baselineElement) => {
    const exact = currentCopy.elements.find(
      (element) => element.id === baselineElement.id && !usedCurrentIds.has(element.id),
    );
    const namedCandidates = exact
      ? []
      : currentCopy.elements.filter(
          (element) =>
            !usedCurrentIds.has(element.id) &&
            element.type === baselineElement.type &&
            element.name === baselineElement.name,
        );
    const counterpart = exact ?? (namedCandidates.length === 1 ? namedCandidates[0] : undefined);

    if (!counterpart) {
      // 콘텐츠 삭제는 유지하되, 장식은 baseline 디자인이므로 그대로 복원한다.
      return isContentBearing(baselineElement) ? [] : [baselineElement];
    }

    usedCurrentIds.add(counterpart.id);
    return [mergeCurrentContent(baselineElement, counterpart)];
  });

  for (const currentElement of currentCopy.elements) {
    if (!usedCurrentIds.has(currentElement.id) && isContentBearing(currentElement)) {
      elements.push(currentElement);
    }
  }

  let maxBottom = 0;
  for (const element of elements) {
    maxBottom = Math.max(maxBottom, element.transform.y + element.transform.height);
  }

  return {
    ...baselineCopy,
    id: currentCopy.id,
    sectionType: currentCopy.sectionType,
    groupType: currentCopy.groupType,
    order: currentCopy.order,
    isVisible: currentCopy.isVisible,
    schemaVersion: currentCopy.schemaVersion,
    // 긴 상세페이지 확장 표지는 지금 섹션 것 — 같은 유형의 다른 표(baseline)에서 표지가 옮겨 오지 않게
    expansion: currentCopy.expansion,
    canvas: {
      ...baselineCopy.canvas,
      height: Math.max(baselineCopy.canvas.height, Math.ceil(maxBottom)),
    },
    elements,
  };
}
