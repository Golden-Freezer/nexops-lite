'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth/clerk-shim';
import Canvas from './Canvas';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';
import { fetchEditorData } from '@/lib/registration/editor/services/editorApi';
import { waitForEditorFonts, waitForDocumentFonts } from '@/lib/registration/editor/utils/fontReady';
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument';

// ──────────────────────────────────────────────────────────────────────────────
// MainCanvas — API 데이터 로드 후 Canvas 컴포넌트 렌더링
// ──────────────────────────────────────────────────────────────────────────────

interface MainCanvasProps {
  pdpId: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

export default function MainCanvas({ pdpId }: MainCanvasProps) {
  const { getToken } = useAuth();
  const initDocument = useEditorStore((s) => s.initDocument);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const loadEditor = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');

    try {
      // 폰트 로드와 데이터 페치를 병렬로 시작 — 캔버스 마운트 전 폰트가 준비되지
      // 않으면 폴백 폰트 기준 실측→reflow가 저장 좌표를 밀어낸다 (누적 표류의 근원)
      const fontsReady = waitForEditorFonts();
      const token = (await getToken()) ?? '';
      const result = await fetchEditorData(pdpId, token);
      const doc = await buildEditorDocument(pdpId, result);

      // 캔버스 마운트(=첫 실측) 전에 폰트 준비 완료를 보장.
      // 핵심 폰트(병렬 시작분)에 더해, 문서가 실제 사용하는 전체 폰트 조합의
      // 한글 subset까지 로드해야 폴백 오측정→reflow 표류가 원천 차단된다
      await fontsReady;
      await waitForDocumentFonts(doc.sections);

      initDocument(doc);
      setLoadState('loaded');
    } catch (err) {
      const { safeErrorMessage } = await import('@/lib/registration/editor/utils/safeErrorMessage');
      setErrorMsg(safeErrorMessage(err, '에디터 데이터를 불러오지 못했습니다.'));
      setLoadState('error');
    }
  }, [pdpId, initDocument, getToken]);

  useEffect(() => {
    loadEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdpId]);

  if (loadState === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--surface-canvas)]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--text-secondary)] animate-pulse">에디터 로딩 중...</p>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--surface-canvas)]">
        <div className="text-center">
          <p className="text-sm text-[var(--brand-error)] mb-3">{errorMsg}</p>
          <button
            onClick={loadEditor}
            className="px-4 py-2 bg-[var(--brand-primary)] text-white text-sm rounded hover:bg-[var(--brand-primary-dark)] transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return <Canvas />;
}
