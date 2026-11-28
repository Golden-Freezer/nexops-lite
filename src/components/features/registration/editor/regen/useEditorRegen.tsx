'use client';

// editor/regen/useEditorRegen.tsx — 캔버스와 재생성 모달을 잇는다(묶음 5 ③).
// 잡의 section_images를 한 번 읽어 두고(컨텍스트 메뉴에 'AI 재생성'을 보일지 = 생성 컷인지), 결과가 오면 캔버스에 반영한다:
// 이 화면에서 요청한 섹션은 바로 바꾸고, 그 밖의 반영 안 된 결과(편집기를 닫았다 연 경우)는 안내 바로 묻는다.
// 바꾸는 것은 src뿐이다(imageSwap) — 위치·크기·글자는 그대로라 프리셋 배치가 흔들리지 않는다. 기록은 commitHistory 한 번.
// 사후 재생성(W5b): 사진 없는 섹션(수동 추가)은 왼쪽 패널 섹션 행에서 새 컷을 만든다(editorStore.regenTarget) — 결과는 그 섹션
// 끝에 사진 요소로 넣는다(appendedImage, 기록은 addElement 한 번). 어떤 섹션이 가능한지는 여기서 계산해 regenAddable에 둔다 —
// 잡을 읽은 뒤에만, 그 잡이 아는 키만(사전 조회 GET이 400이면 이 잡 태스크 밖 — 쓰기·비용 없음).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdpJobRow, SectionImage } from '@/lib/registration/pdp-state';
import { useEditorStore, selectSections, selectRegenTarget } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { regenApi, RegenApiError } from '@/lib/registration/editor/services/regenApi';
import { appendedImage, elementsWithSrc, imageSrcPatch } from '@/lib/registration/editor/utils/imageSwap';
import {
  addableImageKey,
  pendingAdds,
  pendingApplies,
  regenSectionForSrc,
  type RegenAdd,
  type RegenApply,
} from '@/lib/registration/editor/utils/regenTarget';
import RegenerateModal from './RegenerateModal';

/** 재생성 대상 — src가 있으면 그 컷 바꾸기, sectionId만 있으면 그 섹션에 새 컷 넣기 */
type Target = { section: string; src?: string; sectionId?: string };

/** 사진 원래 크기 — 못 읽으면 정사각으로 둔다 */
function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = url;
  });
}

const sameAddable = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

export function useEditorRegen(pdpId: string) {
  const sections = useEditorStore(selectSections);
  const updateElement = useEditorStore((s) => s.updateElement);
  const requested = useEditorStore(selectRegenTarget);
  const [sectionImages, setSectionImages] = useState<SectionImage[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 섹션 키 → 이 잡이 아는 키인가(사전 조회). 400이면 false, 다른 실패는 기록하지 않고 다시 묻지 않는다(버튼은 숨는다)
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const probedRef = useRef(new Set<string>());
  const [target, setTarget] = useState<Target | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // 넣는 중인 새 컷 — 진행 중 폴링이 같은 결과를 여러 번 줘도 한 번만 넣는다
  const addingRef = useRef(new Set<string>());

  useEffect(() => {
    if (!pdpId) return;
    let alive = true;
    regenApi
      .getJob(pdpId)
      .then((job) => {
        if (!alive) return;
        setSectionImages(job.section_images);
        setLoaded(true);
      })
      // 못 읽으면 재생성 메뉴·새 컷 버튼만 숨는다(편집은 그대로)
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pdpId]);

  // 사진 없는 섹션의 키를 이 잡이 아는지 묻는다(키마다 한 번)
  useEffect(() => {
    if (!loaded || !pdpId) return;
    for (const section of sections) {
      const key = addableImageKey(sectionImages, section);
      if (!key || probedRef.current.has(key)) continue;
      probedRef.current.add(key);
      regenApi
        .preview(pdpId, key)
        .then(() => setKnown((k) => ({ ...k, [key]: true })))
        .catch((e) => {
          if (e instanceof RegenApiError && e.status === 400) setKnown((k) => ({ ...k, [key]: false }));
        });
    }
  }, [loaded, pdpId, sectionImages, sections]);

  // 사진 없는 섹션 중 새 컷을 만들 수 있는 것 — 왼쪽 패널이 버튼을 보인다
  useEffect(() => {
    const addable: Record<string, string> = {};
    for (const section of loaded ? sections : []) {
      const key = addableImageKey(sectionImages, section);
      if (key && known[key]) addable[section.id] = key;
    }
    const store = useEditorStore.getState();
    if (!sameAddable(store.regenAddable, addable)) store.setRegenAddable(addable);
  }, [loaded, known, sectionImages, sections]);

  // 왼쪽 패널 섹션 행의 요청 → 모달
  useEffect(() => {
    if (!requested) return;
    const store = useEditorStore.getState();
    store.setRegenTarget(null);
    const key = store.regenAddable[requested.sectionId];
    if (key && !requested.elementId) setTarget({ section: key, sectionId: requested.sectionId });
  }, [requested]);

  const apply = useCallback(
    (list: RegenApply[]) => {
      const doc = useEditorStore.getState().document;
      if (!doc) return 0;
      let changed = 0;
      for (const item of list) {
        for (const t of item.targets) {
          const el = doc.sections.find((s) => s.id === t.sectionId)?.elements.find((e) => e.id === t.elementId);
          const patch = el ? imageSrcPatch(el, item.to, false) : null;
          if (!patch) continue;
          updateElement(t.sectionId, t.elementId, patch);
          changed++;
        }
      }
      const after = useEditorStore.getState().document?.sections;
      if (changed > 0 && after) useCanvasStore.getState().commitHistory('AI 재생성 반영', after);
      return changed;
    },
    [updateElement],
  );

  const add = useCallback(async (item: RegenAdd) => {
    if (addingRef.current.has(item.url)) return;
    addingRef.current.add(item.url);
    try {
      const size = await loadImageSize(item.url);
      const store = useEditorStore.getState();
      const docSections = store.document?.sections ?? [];
      const section = docSections.find((s) => s.id === item.sectionId);
      if (!section || elementsWithSrc(docSections, item.url).length > 0) return;
      const { element, height } = appendedImage(section, item.url, size, crypto.randomUUID(), item.section);
      // 높이 갱신은 기록하지 않고, 요소 추가가 둘을 함께 한 번 기록한다(H3 post 스냅샷)
      if (height !== section.canvas.height) store.updateSection(section.id, { ...section, canvas: { ...section.canvas, height } });
      store.addElement(section.id, element);
    } finally {
      // 넣은 뒤에는 문서 검사(elementsWithSrc)가 중복을 막는다 — 되돌린 뒤 '적용'으로 다시 넣을 수 있게 비운다
      addingRef.current.delete(item.url);
    }
  }, []);

  const handleJob = useCallback(
    (job: PdpJobRow) => {
      setSectionImages(job.section_images);
      setLoaded(true);
      if (!target) return;
      const docSections = useEditorStore.getState().document?.sections ?? [];
      if (target.sectionId) {
        const entry = job.section_images.find((e) => e.section === target.section);
        if (entry?.editorRegen?.status === 'done' && entry.url && elementsWithSrc(docSections, entry.url).length === 0) {
          void add({ section: target.section, url: entry.url, sectionId: target.sectionId });
        }
        return;
      }
      apply(pendingApplies(job.section_images, docSections).filter((a) => a.section === target.section));
    },
    [add, apply, target],
  );

  const leftover = useMemo(() => (target ? [] : pendingApplies(sectionImages, sections)), [sectionImages, sections, target]);
  const leftoverAdds = useMemo(() => (target ? [] : pendingAdds(sectionImages, sections)), [sectionImages, sections, target]);
  const leftoverCount = leftover.length + leftoverAdds.length;

  const sectionForSrc = useCallback((src: string | null | undefined) => regenSectionForSrc(sectionImages, src), [sectionImages]);
  const open = useCallback((section: string, src: string) => setTarget({ section, src }), []);

  const node = (
    <>
      {target && (
        <RegenerateModal jobId={pdpId} section={target.section} imageSrc={target.src} onClose={() => setTarget(null)} onJob={handleJob} />
      )}
      {!target && !dismissed && leftoverCount > 0 && (
        // 캔버스 오른쪽 아래 줌 컨트롤(bottom 16~48px)과 겹치지 않게 그 위에 띄운다
        <div
          role="status"
          className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg bg-[var(--surface-overlay)] border border-[var(--border-default)] text-xs text-[var(--text-primary)]"
        >
          <span>AI 재생성 결과 {leftoverCount}건이 캔버스에 아직 반영되지 않았습니다.</span>
          <button
            onClick={() => {
              apply(leftover);
              leftoverAdds.forEach((item) => void add(item));
            }}
            className="px-2 py-1 rounded text-white bg-[var(--editor-brand)] hover:opacity-90 cursor-pointer"
          >
            적용
          </button>
          <button onClick={() => setDismissed(true)} className="px-2 py-1 rounded hover:bg-[var(--hover-overlay)] cursor-pointer">
            닫기
          </button>
        </div>
      )}
    </>
  );

  return { sectionForSrc, open, node };
}
