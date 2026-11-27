'use client';

import { useSyncExternalStore } from 'react';

// ─── 폰트 로드 epoch ─────────────────────────────────────────────────────────
// document.fonts 'loadingdone' 발생 시마다 증가하는 카운터.
// 텍스트 실측 effect의 의존성에 넣으면, 웹폰트 스왑 이후 재측정이 보장된다
// (초기 게이팅(waitForEditorFonts)을 뚫고 지연 로드된 폰트에 대한 안전망).

let epoch = 0;
const listeners = new Set<() => void>();
let bound = false;

function bindOnce() {
  if (bound || typeof document === 'undefined' || !document.fonts?.addEventListener) return;
  bound = true;
  document.fonts.addEventListener('loadingdone', () => {
    epoch += 1;
    listeners.forEach((l) => l());
  });
}

function subscribe(cb: () => void) {
  bindOnce();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = () => epoch;
const getServerSnapshot = () => 0;

export function useFontEpoch(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
