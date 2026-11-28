'use client';

// editor/rightpanel/MyImagesTab.tsx — '내 이미지' 보관함(묶음 5 ②, NEXFIT MyImagesTab 이식).
// DDL 없이 스토리지 목록을 읽는다: '이 상품' = 이 잡의 생성 컷·썸네일(재생성 전 판 포함), '내 업로드' = 편집기에서 올린 이미지.
// 이미지를 고른 채 누르면 src만 바꾸고(배치 그대로), 아니면 선택한 섹션에 새 이미지로 넣는다. 보관함에서 지우기는 두지 않는다.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { fetchLibraryImages, type LibraryImageItem } from '@/lib/registration/editor/services/editorApi';
import { useEditorStore, selectSelectedSectionId, selectSelectedElementId } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { imageSrcOf, imageSrcPatch } from '@/lib/registration/editor/utils/imageSwap';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import { EmptyState } from './primitives';

type Scope = 'job' | 'uploads';

const PAGE_SIZE = 30;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'job', label: '이 상품' },
  { id: 'uploads', label: '내 업로드' },
];
const KIND_LABEL: Record<LibraryImageItem['kind'], string> = {
  section: '생성 컷',
  thumbnail: '썸네일',
  upload: '업로드',
  other: '기타',
};

function MyImagesTab() {
  const { getToken } = useAuth();
  const pdpId = useEditorStore((s) => s.document?.pdpId ?? '');
  const selectedSectionId = useEditorStore(selectSelectedSectionId);
  const selectedElementId = useEditorStore(selectSelectedElementId);
  const selectedElement = useEditorStore((s) =>
    s.document?.sections.find((sec) => sec.id === s.selectedSectionId)?.elements.find((el) => el.id === s.selectedElementId),
  );
  const addElement = useEditorStore((s) => s.addElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const selectElement = useEditorStore((s) => s.selectElement);

  const [scope, setScope] = useState<Scope>('job');
  const [items, setItems] = useState<LibraryImageItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // 서버가 폴더·이미지 아닌 파일을 건너뛰며 읽으므로 다음 쪽 위치는 서버가 준 nextOffset을 그대로 쓴다
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError('');
      try {
        const token = await getToken();
        if (!token) throw new Error('로그인이 필요합니다.');
        const res = await fetchLibraryImages(token, { scope, jobId: scope === 'job' ? pdpId : undefined, offset, limit: PAGE_SIZE });
        setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
        setNextOffset(res.nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : '내 이미지를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    },
    [getToken, scope, pdpId],
  );

  useEffect(() => {
    if (scope === 'job' && !pdpId) return;
    setItems([]);
    void load(0);
  }, [load, scope, pdpId]);

  if (!selectedSectionId) {
    return <EmptyState icon="🖼️" message="섹션을 선택하면 내 이미지를 넣을 수 있습니다." />;
  }

  const canReplace = Boolean(selectedElement && imageSrcOf(selectedElement) !== null);

  const commit = (label: string) => {
    const sections = useEditorStore.getState().document?.sections;
    if (sections) useCanvasStore.getState().commitHistory(label, sections);
  };

  const replaceSelected = (url: string) => {
    if (!selectedElement || !selectedElementId) return;
    const patch = imageSrcPatch(selectedElement, url, true);
    if (!patch) return;
    updateElement(selectedSectionId, selectedElementId, patch);
    commit('내 이미지로 교체');
  };

  const insertImage = (item: LibraryImageItem) => {
    const id = crypto.randomUUID();
    const img = new window.Image();
    img.onload = () => {
      let w = img.naturalWidth || 400;
      let h = img.naturalHeight || 400;
      const maxW = 600;
      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }
      const el: CanvasElement = {
        id, type: 'image', name: '내 이미지',
        transform: { x: 100, y: 100, width: w, height: h, rotation: 0 },
        zIndex: 50, isLocked: false, isVisible: true, opacity: 1,
        imageProps: { src: item.url, alt: '내 이미지', objectFit: 'cover', imageType: 'library_reuse', isUserUploaded: true },
      };
      // 히스토리는 addElement 내부에서 post 스냅샷으로 기록 (H3 통일 모델)
      addElement(selectedSectionId, el);
      selectElement(id);
    };
    img.src = item.url;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={scope === s.id}
            onClick={() => setScope(s.id)}
            className={`px-2 py-1 rounded-md text-[11px] border transition-colors cursor-pointer ${
              scope === s.id
                ? 'border-[var(--editor-brand)] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--editor-brand)]'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(0)}
          disabled={loading}
          title="새로고침"
          aria-label="내 이미지 새로고침"
          className="ml-auto w-6 h-6 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--editor-brand)] disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <p className="text-[11px] text-[var(--text-disabled)] leading-relaxed px-0.5">
        {canReplace ? '누르면 선택한 이미지를 바꿉니다(위치·크기 그대로).' : '누르면 선택한 섹션에 새 이미지로 넣습니다.'}
      </p>

      {error && <p className="text-xs text-[var(--brand-error)] px-0.5">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon="📁"
          message={scope === 'job' ? '이 상품에서 만든 이미지가 아직 없습니다.' : '편집기에서 올린 이미지가 아직 없습니다.'}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            onClick={() => (canReplace ? replaceSelected(item.url) : insertImage(item))}
            title={`${KIND_LABEL[item.kind]} · ${item.name}`}
            className="relative aspect-square rounded-md overflow-hidden border border-[var(--border-default)] hover:border-[var(--editor-brand)] transition-colors cursor-pointer bg-[var(--surface-canvas)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
            <span className="absolute left-1 bottom-1 px-1 rounded bg-black/55 text-[9px] leading-[14px] text-white">
              {KIND_LABEL[item.kind]}
            </span>
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-[var(--text-disabled)] text-center py-2">불러오는 중...</p>}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => void load(nextOffset)}
          className="text-xs text-[var(--editor-brand)] hover:underline py-1 cursor-pointer"
        >
          더 보기
        </button>
      )}
    </div>
  );
}

export { MyImagesTab };
