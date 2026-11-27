'use client';

import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * 데스크탑 뷰포트(≥1024px) 여부.
 * SSR/최초 클라이언트 프레임에서는 window가 없거나 아직 측정 전이므로
 * null(미결정)을 반환한다 — 호출부가 hydration-safe 분기를 책임진다.
 */
export function useIsDesktopViewport(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);

    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
