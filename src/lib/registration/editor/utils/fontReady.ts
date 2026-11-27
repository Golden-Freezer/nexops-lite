// ─── 에디터 폰트 준비 대기 ────────────────────────────────────────────────────
// 캔버스 실측(scrollHeight)이 폴백 폰트 기준으로 이뤄지면 reflow가 저장 좌표를
// 밀어내고 그 표류가 다음 저장에 굳는다. 마운트 전에 폰트 로드를 보장한다.
//
// 주의: Google Fonts는 unicode-range subset이라 "패밀리 로드됨"이어도 한글/기호
// 블록은 해당 글리프가 실제 사용될 때 지연 로드된다 → 반드시 한글 샘플로 load().

import type { CanvasSection } from '@/lib/registration/editor/types/canvas';

/** 실측 정확도에 영향을 주는 핵심 폰트 스펙 (font shorthand) */
const CORE_FONT_SPECS = [
  '400 16px Pretendard',
  '500 16px Pretendard',
  '700 16px Pretendard',
  '900 16px Pretendard',
  '700 16px GmarketSansBold',
];

/** 한글·기호 글리프 포함 샘플 — subset 폰트가 해당 블록을 실제로 로드하도록 강제.
 *  ★(리뷰 별점)·✓·※·따옴표는 실측 대상 텍스트에 실제 등장하는 기호들 */
const KO_SAMPLE = '한글측정샘플Ag1★✓※“”';

async function loadSpecs(specs: Iterable<string>, timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const loads = Promise.all([
    ...Array.from(specs, (spec) => document.fonts.load(spec, KO_SAMPLE).catch(() => [])),
    document.fonts.ready.catch(() => undefined),
  ]).then(() => undefined);
  await Promise.race([loads, timeout]);
}

/**
 * 핵심 폰트 로드를 기다린다. 실패/미지원 환경에서도 에디터를 막지 않도록
 * timeoutMs 상한을 두고, 오류는 무시한다(폴백 렌더 허용).
 */
export async function waitForEditorFonts(timeoutMs = 3000): Promise<void> {
  await loadSpecs(CORE_FONT_SPECS, timeoutMs);
}

/**
 * 문서가 실제로 사용하는 모든 (fontFamily × fontWeight) 조합의 로드를 기다린다.
 * 핵심 5종만 기다리던 게이트의 빈틈: AI font_scheme이 고른 폰트(Noto Serif KR 등)의
 * 한글 subset이 마운트 후에 도착하면, 폴백 폰트 기준 오측정 → reflow가 저장 좌표를
 * 비가역적으로 표류시킨다 (Ctrl+Z로만 복구되던 재접속 배치 붕괴의 원인).
 */
export async function waitForDocumentFonts(
  sections: CanvasSection[],
  timeoutMs = 4000,
): Promise<void> {
  const specs = new Set<string>(CORE_FONT_SPECS);
  for (const section of sections) {
    for (const el of section.elements) {
      const tp = el.textProps;
      if (!tp?.fontFamily) continue;
      // font shorthand의 패밀리에 공백이 있으면 따옴표 필요
      const family = tp.fontFamily.includes(' ') ? `"${tp.fontFamily}"` : tp.fontFamily;
      specs.add(`${tp.fontWeight || 400} 16px ${family}`);
    }
  }
  await loadSpecs(specs, timeoutMs);
}
