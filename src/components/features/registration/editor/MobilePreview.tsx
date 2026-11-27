'use client';

import { useState } from 'react';
import { useEditorStore, selectSections } from '@/lib/registration/editor/stores/editorStore';
import CanvasSectionComponent from './CanvasSection';

// ─────────────────────────────────────────────
// 상수 (명세서 4.4 — 860px 소스 → 375px 모바일)
// ─────────────────────────────────────────────
const CANVAS_WIDTH = 860;
const MOBILE_DISPLAY_WIDTH = 375;
const MOBILE_SCALE = MOBILE_DISPLAY_WIDTH / CANVAS_WIDTH; // ≈ 0.4360

const PHONE_VISIBLE_HEIGHT = 680; // 폰 스크린 가시 영역 (px)

// 소스 px 기준: 이 값 미만이면 모바일 가독성 경고 (≈ 모바일 14px 이하)
const READABILITY_THRESHOLD_PX = 32;

// ─────────────────────────────────────────────
// 경고 아이템 타입
// ─────────────────────────────────────────────
interface WarningItem {
  id: string;
  // 스케일된 좌표 (MOBILE_DISPLAY_WIDTH 기준)
  x: number;
  y: number;
  width: number;
  height: number;
  sourceSize: number;
  mobileSize: number;
}

// ─────────────────────────────────────────────
// MobilePreview 컴포넌트
// ─────────────────────────────────────────────
export default function MobilePreview() {
  const sections = useEditorStore(selectSections);
  const [activeWarningId, setActiveWarningId] = useState<string | null>(null);

  // divider·0높이 제외 — Canvas/내보내기와 동일 기준(미리보기가 실제 산출물과 어긋나지 않게)
  const sortedSections = [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0);

  // 섹션 y-오프셋 누적 + 가독성 경고 수집
  let cumulativeY = 0;
  const warnings: WarningItem[] = [];

  for (const section of sortedSections) {
    for (const el of section.elements) {
      if (el.type === 'text' && el.textProps && el.isVisible) {
        const srcSize = el.textProps.fontSize;
        if (srcSize < READABILITY_THRESHOLD_PX) {
          warnings.push({
            id: `${section.id}-${el.id}`,
            // 스케일된 좌표로 변환
            x: el.transform.x * MOBILE_SCALE,
            y: (cumulativeY + el.transform.y) * MOBILE_SCALE,
            width: Math.max(el.transform.width * MOBILE_SCALE, 16),
            height: Math.max(el.transform.height * MOBILE_SCALE, 12),
            sourceSize: srcSize,
            mobileSize: Math.round(srcSize * MOBILE_SCALE),
          });
        }
      }
    }
    cumulativeY += section.canvas.height;
  }

  const totalScaledHeight = cumulativeY * MOBILE_SCALE;

  return (
    <div className="flex-1 overflow-auto bg-[var(--surface-canvas)] flex flex-col items-center py-8 gap-4">

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
        style={{ padding: '52px 12px 28px', width: MOBILE_DISPLAY_WIDTH + 24 }}
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
            width: MOBILE_DISPLAY_WIDTH,
            height: PHONE_VISIBLE_HEIGHT,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
          onClick={() => setActiveWarningId(null)}
        >
          {/* 콘텐츠 래퍼 — 스케일된 높이 유지 */}
          <div
            style={{
              width: MOBILE_DISPLAY_WIDTH,
              height: totalScaledHeight,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* 860px 캔버스 → 375px 스케일 (에디터 인터랙션 비활성) */}
            <div
              style={{
                width: CANVAS_WIDTH,
                transform: `scale(${MOBILE_SCALE})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {sortedSections.map((section) => (
                <CanvasSectionComponent key={section.id} section={section} />
              ))}
            </div>

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
                    (권장: 14px 이상 / 소스: {w.sourceSize}px)
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
        860px 원본이 375px 모바일에서 ×{MOBILE_SCALE.toFixed(3)} 배율로 표시됩니다.
        <br />
        빨간 테두리 요소를 클릭하면 예상 크기를 확인할 수 있습니다.
      </p>
    </div>
  );
}
