'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { fetchEditorData } from '@/lib/registration/editor/services/editorApi';
import { useViewerMountReflow } from '@/lib/registration/editor/hooks/useViewerMountReflow';
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument';
import { waitForEditorFonts, waitForDocumentFonts } from '@/lib/registration/editor/utils/fontReady';
import { MOBILE_CANVAS_WIDTH, layoutForMobile, visibleSectionsInOrder } from '@/lib/registration/editor/utils/mobileViewport';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { MotionClip } from '@/lib/registration/editor/types/editor';
import CanvasSectionComponent from './CanvasSection';
import { MotionPreviewProvider, MotionPreviewToggle, useMotionPreview } from './MotionPreview';

// ──────────────────────────────────────────────────────────────────────────────
// MobileEditorViewer — 폰(<1024px) 접속 시 읽기 전용 뷰어 (NEXFIT MobileEditorViewer 이식, 묶음 5 ①).
// 편집기 스토어를 쓰지 않는다 — 문서를 로컬 상태로만 들고 있어 자동 저장·선택 상태가 생기지 않는다(PdpEditorPreview와 같은 기법).
// 860px 원본을 화면 폭에 맞춰 줄이고 인터랙션은 전부 막는다. 저장본이 있으면 저장본, 없으면 최초 변환본이다(편집기 진입과 같다).
// 최초 변환본은 편집기처럼 마운트 리플로우를 로컬 상태에만 적용한다 — 추정 높이 상자 아래 빈 바탕이 남지 않게. 저장하지 않는다.
// ──────────────────────────────────────────────────────────────────────────────

interface MobileEditorViewerProps {
  pdpId: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

export default function MobileEditorViewer({ pdpId }: MobileEditorViewerProps) {
  const { getToken } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [sections, setSections] = useState<CanvasSection[]>([]);
  const [title, setTitle] = useState('');
  const [motionClips, setMotionClips] = useState<Record<string, MotionClip> | null>(null);
  const [viewportWidth, setViewportWidth] = useState(390);
  const contentRef = useRef<HTMLDivElement>(null);

  useViewerMountReflow(contentRef, sections, setSections);

  const loadViewer = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      // 편집기(MainCanvas)와 같은 순서 — 폰트가 준비된 뒤 그려야 글자 줄바꿈이 편집기와 같다
      const fontsReady = waitForEditorFonts();
      const token = (await getToken()) ?? '';
      const result = await fetchEditorData(pdpId, token);
      const doc = await buildEditorDocument(pdpId, result);
      await fontsReady;
      await waitForDocumentFonts(doc.sections);
      setSections(doc.sections);
      setMotionClips(doc.sourceData.motionClips ?? null);
      setTitle(doc.meta.productName);
      setLoadState('loaded');
    } catch (err) {
      const { safeErrorMessage } = await import('@/lib/registration/editor/utils/safeErrorMessage');
      setErrorMsg(safeErrorMessage(err, '상세페이지를 불러오지 못했습니다.'));
      setLoadState('error');
    }
  }, [pdpId, getToken]);

  useEffect(() => {
    loadViewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdpId]);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 860px를 넘겨 키우지 않는다
  const displayWidth = Math.min(viewportWidth, MOBILE_CANVAS_WIDTH);
  const visible = visibleSectionsInOrder(sections);
  const { scale, totalHeight } = layoutForMobile(visible, displayWidth);
  // 움직이는 칸 — 기본 포스터, 전환 버튼으로 재생(결정 카드 c30). 보기 전용 화면이라 굽기와 무관하다
  const motion = useMotionPreview(visible, motionClips);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--surface-canvas)]">
      {/* 상단 고정 바 */}
      <div className="flex items-center h-12 px-3 bg-[var(--surface-base)] border-b border-[var(--border-default)] gap-2 shrink-0">
        <Link
          href={`/registration/detail-page?jobId=${pdpId}`}
          className="flex items-center justify-center w-8 h-8 -ml-1 text-[var(--text-secondary)]"
          aria-label="생성 결과로 돌아가기"
        >
          <ArrowLeft size={18} />
        </Link>
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)] truncate">
          {title || '상세페이지 미리보기'}
        </span>
        <MotionPreviewToggle
          playing={motion.playing}
          count={motion.count}
          onToggle={motion.toggle}
          className={`text-[11px] px-2 py-1 rounded border whitespace-nowrap shrink-0 ${
            motion.playing
              ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
              : 'border-[var(--border-default)] text-[var(--text-secondary)]'
          }`}
        />
        <span className="text-[11px] text-[var(--text-disabled)] whitespace-nowrap shrink-0">보기 전용</span>
      </div>

      {/* 본문 — 세로 스크롤 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loadState === 'loading' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-[var(--brand-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-[var(--text-secondary)]">불러오는 중...</p>
            </div>
          </div>
        )}

        {loadState === 'error' && (
          <div className="flex items-center justify-center h-full px-6">
            <div className="text-center">
              <p className="text-sm text-[var(--brand-error)] mb-3">{errorMsg}</p>
              <button
                onClick={loadViewer}
                className="px-4 py-2 bg-[var(--brand-primary)] text-white text-sm rounded hover:bg-[var(--brand-primary-dark)] transition-colors"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}

        {loadState === 'loaded' && visible.length === 0 && (
          <div className="flex items-center justify-center h-full text-[var(--text-disabled)] text-sm">섹션 없음</div>
        )}

        {loadState === 'loaded' && visible.length > 0 && (
          <div className="mx-auto bg-white" style={{ width: displayWidth, height: totalHeight, position: 'relative', overflow: 'hidden' }}>
            <div
              ref={contentRef}
              style={{
                width: MOBILE_CANVAS_WIDTH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
                // 편집 인터랙션(선택·드래그·크기 조절) 전부 차단 — 읽기 전용
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              <MotionPreviewProvider value={motion.srcs}>
                {visible.map((section) => (
                  <CanvasSectionComponent key={section.id} section={section} />
                ))}
              </MotionPreviewProvider>
            </div>
          </div>
        )}
      </div>

      <p className="px-4 py-2 text-[13px] text-[var(--text-disabled)] text-center bg-[var(--surface-base)] border-t border-[var(--border-default)] shrink-0">
        편집은 PC 화면(1024px 이상)에서 할 수 있습니다
      </p>
    </div>
  );
}
