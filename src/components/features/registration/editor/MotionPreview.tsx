'use client';

/**
 * 편집기 미리보기의 움직이는 칸 재생(결정 카드 c30, 가정 B6).
 * 미리보기 세 곳(MobilePreview·MobileEditorViewer·PdpEditorPreview)만 이 공급자를 둔다. 값 = 사진 요소 id → 움직이는 WebP 주소이고,
 * 내보내기가 실제로 바꿔 넣는 칸만 든다(motionParts previewMotionSrcs). 기본은 포스터이고 전환 버튼으로 켠다.
 * 본 캔버스(Canvas.tsx의 data-canvas-content)에는 공급자가 없어 늘 포스터다 — 상세 이미지 굽기(bakeDetailImages)가 복제해 찍는 화면이 그대로다.
 * 미리보기 캔버스는 pointerEvents: none이라 전환 버튼은 캔버스 바깥에 둔다.
 */

import { createContext, useContext, useMemo, useState } from 'react';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { MotionClip } from '@/lib/registration/editor/types/editor';
import { previewMotionSrcs } from '@/lib/registration/editor/utils/exportUtils/motionParts';

type MotionSrcs = Readonly<Record<string, string>>;

const MotionPreviewContext = createContext<MotionSrcs | null>(null);

/** 미리보기 세 곳에서만 쓴다 — value가 null이면 포스터 그대로 */
export const MotionPreviewProvider = MotionPreviewContext.Provider;

/** 이 사진 요소를 미리보기에서 움직이는 WebP로 보일 주소. 공급자가 없거나(본 캔버스·굽기) 꺼져 있으면 null */
export function useMotionPreviewSrc(elementId: string): string | null {
  const srcs = useContext(MotionPreviewContext);
  return srcs && Object.hasOwn(srcs, elementId) ? srcs[elementId] : null;
}

/** 미리보기 재생 상태 — 기본 꺼짐. srcs는 켰을 때만 공급자 값으로 넘긴다 */
export function useMotionPreview(
  sections: readonly CanvasSection[],
  clips: Readonly<Record<string, MotionClip>> | null | undefined,
): { playing: boolean; count: number; srcs: MotionSrcs | null; toggle: () => void } {
  const [on, setOn] = useState(false);
  const all = useMemo(() => (clips ? previewMotionSrcs(sections, clips) : {}), [sections, clips]);
  const count = Object.keys(all).length;
  const playing = on && count > 0;
  return { playing, count, srcs: playing ? all : null, toggle: () => setOn((v) => !v) };
}

/** 포스터 ↔ 움직이는 칸 전환 버튼. 움직이는 칸이 없는 잡은 그리지 않는다 */
export function MotionPreviewToggle({
  playing,
  count,
  onToggle,
  className,
}: {
  playing: boolean;
  count: number;
  onToggle: () => void;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <button type="button" aria-pressed={playing} onClick={onToggle} className={className}>
      {playing ? '움직이는 칸 멈추기' : `움직이는 칸 보기 (${count})`}
    </button>
  );
}
