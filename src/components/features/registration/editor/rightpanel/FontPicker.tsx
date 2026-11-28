'use client';

// ─── 글꼴 고르기 — 선택 상자 항목 + 미리보기 목록 ─────────────────────────────
// 선택 상자 항목에 글꼴을 입히면 상자를 처음 열 때 브라우저가 선택지 글꼴 파일을 한꺼번에 받는다(34개 약 22.6MB 중 편집기가 미리
// 받는 5개를 뺀 약 19MB — 자체 보관 원본이고 예약 이름 글꼴은 부분 세트를 만들지 않는다). 그래서 항목은 기본 글꼴로 두고, 미리보기는
// 따로 연 목록에서 화면에 보이는 줄에만 글꼴을 입힌다(IntersectionObserver — 스크롤해 보인 줄만 그 글꼴 파일을 받는다).

import { useEffect, useRef, useState } from 'react';
import { FONT_GROUPS, LEGACY_FONTS, fontKey, type FontOption } from '@/lib/registration/editor/constants/fonts';

/** 미리보기 줄의 견본 글 — 한글·라틴·숫자 */
export const FONT_PREVIEW_SAMPLE = '상세페이지 가나다 Aa 123';

/** 선택 상자 항목 — 예전 글꼴(LEGACY_FONTS)은 지금 값일 때만 비활성 항목으로. 항목에는 글꼴을 입히지 않는다 */
export function FontSelectOptions({ fontFamily, fontWeight }: { fontFamily: string; fontWeight: number }) {
  return (
    <>
      {LEGACY_FONTS.filter((f) => f.fontFamily === fontFamily).map((f) => (
        <option key={fontKey(f)} value={`${fontFamily}__${fontWeight}`} disabled>
          {f.label}
        </option>
      ))}
      {FONT_GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.fonts.map((f) => (
            <option key={fontKey(f)} value={fontKey(f)}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * 미리보기 목록 — 줄마다 글꼴 이름과 견본 글(누름 버튼, 지금 글꼴은 aria-pressed). 처음 그릴 때는 어느 줄에도 글꼴을 입히지 않고
 * (파일 요청 0), 열면 지금 글꼴 줄로 스크롤한 뒤 목록 상자 안에서 보이게 된 줄에만 입힌다(한 번 입힌 줄은 그대로). 줄을 누르면 그 글꼴로.
 */
export function FontPreviewList({ currentKey, onPick }: { currentKey: string; onPick: (font: FontOption) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const current = [...box.querySelectorAll<HTMLElement>('[data-font-key]')].find((row) => row.dataset.fontKey === currentKey);
    // 상자가 relative라 줄의 offsetTop은 상자 기준이다
    if (current) box.scrollTop = Math.max(0, current.offsetTop - 24);
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const keys = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.fontKey ?? '');
        if (keys.length === 0) return;
        setShown((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])));
        for (const e of entries) if (e.isIntersecting) observer.unobserve(e.target);
      },
      { root: box, rootMargin: '40px 0px' }
    );
    box.querySelectorAll<HTMLElement>('[data-font-key]').forEach((row) => observer.observe(row));
    return () => observer.disconnect();
    // 지금 글꼴 줄로는 열 때 한 번만 스크롤한다 — 고를 때마다 목록이 튀지 않게
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={boxRef}
      data-font-preview=""
      aria-label="글꼴 미리보기"
      className="relative max-h-60 overflow-y-auto rounded border border-[var(--border-default)] bg-[var(--surface-elevated)]"
    >
      {FONT_GROUPS.map((g) => (
        <div key={g.key}>
          <div className="sticky top-0 bg-[var(--surface-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{g.label}</div>
          {g.fonts.map((f) => {
            const key = fontKey(f);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === currentKey}
                data-font-key={key}
                onClick={() => onPick(f)}
                className={`block w-full px-2 py-1.5 text-left hover:bg-[var(--hover-overlay)] ${
                  key === currentKey ? 'bg-[var(--brand-primary-tint)]' : ''
                }`}
              >
                <span className="block text-[10px] text-[var(--text-secondary)]">{f.label}</span>
                <span
                  className="block truncate text-sm text-[var(--text-primary)]"
                  style={shown.has(key) ? { fontFamily: `'${f.fontFamily}', 'Pretendard Variable', sans-serif`, fontWeight: f.fontWeight } : undefined}
                >
                  {FONT_PREVIEW_SAMPLE}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
