'use client';

import { useState } from 'react';
import { useEditorStore, selectSections } from '@/lib/registration/editor/stores/editorStore';
import {
  DEFAULT_MOBILE_PREVIEW_WIDTH,
  MOBILE_CANVAS_WIDTH,
  MOBILE_PREVIEW_WIDTHS,
  layoutForMobile,
  visibleSectionsInOrder,
  type MobilePreviewWidth,
} from '@/lib/registration/editor/utils/mobileViewport';
import CanvasSectionComponent from './CanvasSection';
import { MotionPreviewProvider, MotionPreviewToggle, useMotionPreview } from './MotionPreview';

// ─────────────────────────────────────────────
// 상수 (명세서 4.4 — 860px 소스 → 모바일 폭. 기본 390 = 서버 모바일 검사기 기준, 375 = 예전 미리보기 폭)
// ─────────────────────────────────────────────
const PHONE_VISIBLE_HEIGHT = 680; // 폰 스크린 가시 영역 (px)

// ─────────────────────────────────────────────
// MobilePreview 컴포넌트
// ─────────────────────────────────────────────
export default function MobilePreview() {
  const sections = useEditorStore(selectSections);
  const [activeWarningId, setActiveWarningId] = useState<string | null>(null);
  const [displayWidth, setDisplayWidth] = useState<MobilePreviewWidth>(DEFAULT_MOBILE_PREVIEW_WIDTH);

  // divider·0높이 제외 — Canvas/내보내기와 동일 기준(미리보기가 실제 산출물과 어긋나지 않게)
  const sortedSections = visibleSectionsInOrder(sections);

  // 경고 기준 = 서버 모바일 검사기 M1(mobileReadability) — 위계별 하한(caption 28·body 45 등), 장식 라벨 32, footer 24.
  // 장식 라벨·번호 배지도 글자로 본다(검사기와 같다). R2-4: 예전 32px 일괄 기준은 검사기와 어긋났다
  const { scale, totalHeight: totalScaledHeight, firstScreenY, warnings } = layoutForMobile(sortedSections, displayWidth);
  // 움직이는 칸 — 기본 포스터, 전환 버튼으로 재생(결정 카드 c30). 이 화면은 본 캔버스 대신 그려져 굽기가 찍지 않는다
  const motionClips = useEditorStore((s) => s.document?.sourceData.motionClips);
  const motion = useMotionPreview(sortedSections, motionClips);

  return (
    <div className="flex-1 overflow-auto bg-[var(--surface-canvas)] flex flex-col items-center py-8 gap-4">

      {/* ── 표시 폭 선택 ── */}
      <div className="flex items-center gap-1 text-xs" role="group" aria-label="미리보기 폭">
        {MOBILE_PREVIEW_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={displayWidth === w}
            onClick={() => setDisplayWidth(w)}
            className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
              displayWidth === w
                ? 'border-[var(--editor-brand)] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--editor-brand)]'
            }`}
          >
            {w}px
          </button>
        ))}
        <MotionPreviewToggle
          playing={motion.playing}
          count={motion.count}
          onToggle={motion.toggle}
          className={`ml-2 px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
            motion.playing
              ? 'border-[var(--editor-brand)] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
              : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--editor-brand)]'
          }`}
        />
      </div>

      {/* ── 가독성 경고 배지 ── */}
      {warnings.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--brand-error-tint)] border border-[var(--brand-error)] rounded-lg text-sm text-[var(--brand-error-text)] shadow-sm">
          <span>⚠️</span>
          <span className="font-semibold">가독성 경고 {warnings.length}건</span>
          <span className="text-[var(--brand-error)] text-xs">— 모바일에서 너무 작게 표시되는 텍스트</span>
        </div>
      )}

      {/* ── 스마트폰 프레임 ── */}
      <div
        className="relative bg-gray-800 rounded-[44px] shadow-2xl flex-shrink-0"
        style={{ padding: '52px 12px 28px', width: displayWidth + 24 }}
      >
        {/* 노치 바 */}
        <div
          className="absolute bg-gray-900 rounded-full"
          style={{ top: 16, left: '50%', transform: 'translateX(-50%)', width: 120, height: 28, zIndex: 10 }}
        />

        {/* 사이드 버튼 */}
        <div className="absolute left-0 top-20 w-1 h-10 bg-gray-700 rounded-l-sm" />
        <div className="absolute left-0 top-36 w-1 h-8 bg-gray-700 rounded-l-sm" />
        <div className="absolute left-0 top-48 w-1 h-8 bg-gray-700 rounded-l-sm" />
        <div className="absolute right-0 top-28 w-1 h-14 bg-gray-700 rounded-r-sm" />

        {/* ── 스크린 ── */}
        <div
          className="rounded-3xl overflow-hidden bg-white relative"
          style={{
            width: displayWidth,
            height: PHONE_VISIBLE_HEIGHT,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
          onClick={() => setActiveWarningId(null)}
        >
          {/* 콘텐츠 래퍼 — 스케일된 높이 유지 */}
          <div
            style={{
              width: displayWidth,
              height: totalScaledHeight,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* 860px 캔버스 → 표시 폭 스케일 (에디터 인터랙션 비활성) */}
            <div
              style={{
                width: MOBILE_CANVAS_WIDTH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              <MotionPreviewProvider value={motion.srcs}>
                {sortedSections.map((section) => (
                  <CanvasSectionComponent key={section.id} section={section} />
                ))}
              </MotionPreviewProvider>
            </div>

            {/* ── 첫 화면 경계(검사기 폰 한 화면 = 캔버스 1,860px) ── */}
            {firstScreenY < totalScaledHeight && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  top: firstScreenY,
                  width: displayWidth,
                  borderTop: '1.5px dashed rgba(37, 99, 235, 0.8)',
                  zIndex: 90,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: 4,
                    top: 2,
                    fontSize: 9,
                    lineHeight: 1.4,
                    padding: '1px 4px',
                    borderRadius: 3,
                    backgroundColor: 'rgba(37, 99, 235, 0.85)',
                    color: '#ffffff',
                  }}
                >
                  첫 화면 끝
                </span>
              </div>
            )}

            {/* ── 가독성 경고 오버레이 ── */}
            {warnings.map((w) => (
              <div
                key={w.id}
                style={{
                  position: 'absolute',
                  left: w.x,
                  top: w.y,
                  width: w.width,
                  height: w.height,
                  border: '1.5px solid #ef4444',
                  borderRadius: 2,
                  cursor: 'pointer',
                  zIndex: 100,
                  boxSizing: 'border-box',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveWarningId(activeWarningId === w.id ? null : w.id);
                }}
              >
                {/* ⚠️ 뱃지 아이콘 */}
                <span
                  style={{
                    position: 'absolute',
                    top: -9,
                    right: -4,
                    fontSize: 10,
                    lineHeight: 1,
                    pointerEvents: 'none',
                  }}
                >
                  ⚠️
                </span>

                {/* 툴팁 */}
                {activeWarningId === w.id && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 4px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: '#111827',
                      color: '#f9fafb',
                      fontSize: 9,
                      lineHeight: 1.5,
                      padding: '4px 7px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      zIndex: 200,
                      pointerEvents: 'none',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    모바일에서 {w.mobileSize}px로 표시됩니다
                    <br />
                    (하한 {w.floor}px · 현재 {w.sourceSize}px — 860px 원본 기준)
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 빈 캔버스 메시지 */}
          {sortedSections.length === 0 && (
            <div className="flex items-center justify-center h-full text-[var(--text-disabled)] text-xs">
              섹션 없음
            </div>
          )}
        </div>
      </div>

      {/* ── 하단 안내 텍스트 ── */}
      <p className="text-xs text-[var(--text-disabled)] text-center max-w-xs leading-relaxed">
        860px 원본이 {displayWidth}px 모바일에서 ×{scale.toFixed(3)} 배율로 표시됩니다.
        <br />
        빨간 테두리 요소를 클릭하면 예상 크기를 확인할 수 있습니다. 파란 점선은 폰 첫 화면 끝입니다.
      </p>
    </div>
  );
}
