'use client';

import { useEffect, type RefObject } from 'react';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { reflowMeasuredSections } from '@/lib/registration/editor/utils/viewerReflow';
import { useFontEpoch } from './useFontEpoch';

/**
 * 편집기 스토어 없이 그리는 보기 전용 화면의 마운트 리플로우. 실측은 화면의 글자 상자(CanvasElement data-el)에서 하고,
 * 결과는 그 화면의 로컬 상태에만 둔다 — 저장하지 않는다. 판단은 viewerReflow가 한다.
 * scrollHeight는 레이아웃 값이라 화면 축소(transform: scale)의 영향을 받지 않는다.
 */
export function useViewerMountReflow(
  rootRef: RefObject<HTMLElement | null>,
  sections: CanvasSection[] | null,
  setSections: (next: CanvasSection[]) => void,
): void {
  // 웹폰트 스왑 뒤 재측정 — 편집기 글자 실측과 같은 안전망
  const fontEpoch = useFontEpoch();

  // 글자 내용은 CanvasElement의 useEffect가 채운다. 부모 useEffect는 그 뒤에 돌아 내용이 찬 상자를 잰다
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !sections || sections.length === 0) return;
    // 폰트 로딩 중 측정은 폴백 폰트 오측정이 된다 — 끝나면 fontEpoch가 다시 부른다
    if (document.fonts?.status === 'loading') return;
    const heights = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('[data-section-id]').forEach((sec) => {
      sec.querySelectorAll<HTMLElement>('[data-el]').forEach((el) => {
        heights.set(`${sec.dataset.sectionId}/${el.dataset.el}`, el.scrollHeight);
      });
    });
    const next = reflowMeasuredSections(sections, (sectionId, elementId) => heights.get(`${sectionId}/${elementId}`) ?? null);
    if (next !== sections) setSections(next);
  }, [rootRef, sections, setSections, fontEpoch]);
}
