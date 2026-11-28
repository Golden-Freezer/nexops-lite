'use client';

import { useEffect, useState } from 'react';
import ThinTopBar from './ThinTopBar';
import FloatingPill from './FloatingPill';
import LeftPanel from './LeftPanel';
import MainCanvas from './MainCanvas';
import RightPanel from './RightPanel';
import ZoomControl from './ZoomControl';
import ShortcutHelpModal from './ShortcutHelpModal';
import MobileEditorViewer from './MobileEditorViewer';
import { useEditorStore, selectDocument } from '@/lib/registration/editor/stores/editorStore';
import { useAutoSave } from '@/lib/registration/editor/hooks/useAutoSave';
import { useIsDesktopViewport } from '@/lib/registration/editor/hooks/useIsDesktopViewport';

interface ProEditorPageProps {
  pdpId: string;
}

/**
 * 캔버스 에디터는 3패널 데스크탑 전용 레이아웃 — 모바일(<1024px)에서는
 * 읽기 전용 뷰어(MobileEditorViewer, 묶음 5 ①)를 띄운다 — 편집기 스토어·자동 저장을 쓰지 않는다.
 * 데스크탑 셸(DesktopEditorShell)은 분리된 컴포넌트라야 useAutoSave 등
 * 편집 전용 훅이 모바일에서 조건부로 호출되는 일(훅 규칙 위반)이 없다.
 */
export default function ProEditorPage({ pdpId }: ProEditorPageProps) {
  const isDesktop = useIsDesktopViewport();

  if (isDesktop === false) {
    return <MobileEditorViewer pdpId={pdpId} />;
  }

  // isDesktop === null(SSR/최초 프레임, 미결정)에서도 빈 배경만 그려 서버 렌더와
  // hydration mismatch가 나지 않게 한다 — 결정되는 즉시 알맞은 셸로 전환된다
  if (isDesktop === null) {
    return <div className="h-screen gradient-bg-subtle" />;
  }

  return <DesktopEditorShell pdpId={pdpId} />;
}

function DesktopEditorShell({ pdpId }: ProEditorPageProps) {
  const clearDocument = useEditorStore((s) => s.clearDocument);
  const hydrateViewPrefs = useEditorStore((s) => s.hydrateViewPrefs);
  const doc = useEditorStore(selectDocument);

  // L16: hydration 완료 후 localStorage 저장값(zoom/showGrid) 반영
  useEffect(() => {
    hydrateViewPrefs();
  }, [hydrateViewPrefs]);

  // 이미지 전체 내보내기 상태 (ThinTopBar에서 사용)
  const [imageExporting, setImageExporting] = useState(false);

  // 자동 저장 (3초 디바운스 + Ctrl+S 즉시 저장)
  useAutoSave(pdpId);

  // 페이지 언마운트 시 스토어 초기화
  useEffect(() => {
    return () => {
      clearDocument();
    };
  }, [clearDocument]);

  const handleExportAllImages = async () => {
    if (!doc) return;
    const imageEntries: { filename: string; url: string }[] = [];
    for (const section of doc.sections) {
      for (const el of section.elements) {
        const src = el.imageProps?.src || el.framedImageProps?.src;
        if (!src) continue;
        const type = el.imageProps?.imageType || el.framedImageProps?.imageType || 'image';
        imageEntries.push({ filename: `${section.sectionType}_${type}.png`, url: src });
      }
    }
    if (imageEntries.length === 0) return;

    setImageExporting(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const folder = zip.folder('images')!;
      const usedNames = new Map<string, number>();
      for (const entry of imageEntries) {
        let name = entry.filename;
        const count = usedNames.get(name) ?? 0;
        if (count > 0) {
          const ext = name.lastIndexOf('.');
          name = `${name.slice(0, ext)}_${count}${name.slice(ext)}`;
        }
        usedNames.set(entry.filename, count + 1);
        try {
          const res = await fetch(entry.url);
          const blob = await res.blob();
          folder.file(name, blob);
        } catch { /* CORS 실패 시 스킵 */ }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = 'nexops_images.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } finally {
      setImageExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden gradient-bg-subtle">
      {/* 상단 32px 바 */}
      <ThinTopBar
        pdpId={pdpId}
        onExportAllImages={handleExportAllImages}
        imageExporting={imageExporting}
      />

      {/* 3-Panel 메인 영역 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측 패널 — 240px */}
        <LeftPanel />

        {/* 메인 캔버스 + FloatingPill + ZoomControl */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          <MainCanvas pdpId={pdpId} />
          <FloatingPill />
          <ZoomControl />
        </div>

        {/* 우측 — IconRail + ExpandablePanel */}
        <RightPanel />
      </div>

      <ShortcutHelpModal />
    </div>
  );
}
