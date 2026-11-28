'use client';

// editor/regen/useEditorCopyRegen.tsx — 글자 요소 'AI 카피 다시 쓰기'(묶음 5 카피). 캔버스와 CopyRegenerateModal을 잇는다.
// 고른 후보는 content만 바꾸고(copyTextPatch) 높이 재측정(requestStyleRemeasure)이 끝난 뒤 기록을 한 번 남긴다 — Ctrl+Z로 되돌린다.
// 저장은 편집기 자동 저장(PUT editor)이 그대로 한다. 서버는 카피 원본을 고치지 않는다.

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { copyRegenTargetOf, copyTextPatch, type CopyRegenTarget } from '@/lib/registration/editor/utils/copyRegenTarget';
import CopyRegenerateModal from './CopyRegenerateModal';

/** 재측정이 화면에 안 걸리는 경우(요소가 그려지지 않은 보기 등)에도 기록이 남게 하는 상한 */
const REMEASURE_WAIT_MS = 3000;

/** 고른 후보를 요소에 넣는다. 요소가 없어졌거나 잠겼으면 false(아무것도 안 바꾼다) */
export function applyCopyCandidate(target: CopyRegenTarget, text: string): boolean {
  const store = useEditorStore.getState();
  const el = store.document?.sections.find((s) => s.id === target.sectionId)?.elements.find((e) => e.id === target.elementId);
  if (!el || el.isLocked) return false;
  const patch = copyTextPatch(el, text);
  if (!patch) return false;
  store.updateElement(target.sectionId, target.elementId, patch);

  // 재측정(높이·아래 요소 리플로우)이 끝나면 styleRemeasure가 비워진다 — 그 뒤에 기록해야 Ctrl+Z가 높이까지 되돌린다
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    unsubscribe();
    clearTimeout(timer);
    const sections = useEditorStore.getState().document?.sections;
    if (sections) useCanvasStore.getState().commitHistory('AI 카피 다시 쓰기', sections);
  };
  const unsubscribe = useEditorStore.subscribe((s) => {
    if (!s.styleRemeasure) commit();
  });
  const timer = setTimeout(commit, REMEASURE_WAIT_MS);
  useEditorStore.getState().requestStyleRemeasure(target.sectionId, target.elementId);
  return true;
}

export function useEditorCopyRegen(pdpId: string) {
  const [target, setTarget] = useState<CopyRegenTarget | null>(null);

  /** 우클릭한 요소가 대상이면 메뉴 핸들러, 아니면 undefined(메뉴 항목을 숨긴다) */
  const handlerFor = useCallback(
    (sectionId: string | null | undefined, elementId: string | null | undefined) => {
      if (!pdpId) return undefined;
      const t = copyRegenTargetOf(useEditorStore.getState().document?.sections ?? [], sectionId, elementId);
      return t ? () => setTarget(t) : undefined;
    },
    [pdpId],
  );

  const node = target ? (
    <CopyRegenerateModal
      jobId={pdpId}
      target={target}
      onClose={() => setTarget(null)}
      onApply={(text) => applyCopyCandidate(target, text)}
    />
  ) : null;

  return { handlerFor, node };
}
