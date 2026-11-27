"use client";

import { useEffect, useState } from "react";

/**
 * 공용 확인 다이얼로그 (WO-2 Quick-win ③ — window.confirm() 대체).
 *
 * account 해지 모달 / admin GrantModal과 같은 오버레이 모달 계보를 따르는
 * Promise 기반 confirm. 루트 레이아웃에 <ConfirmHost />를 1회 마운트한다.
 *
 * 컴포넌트에서:   const confirm = useConfirm();
 *                 const ok = await confirm({ title: "삭제할까요?", danger: true });
 * 유틸에서:       import { confirmDialog } from "@/components/features/registration/editor/ui/ConfirmDialog";
 *                 const ok = await confirmDialog({ title: "...", message: "..." });
 *
 * ESC / 배경 클릭 = 취소(false).
 */

export interface ConfirmOptions {
  title: string;
  /** 본문(줄바꿈 \n 지원) */
  message?: string;
  /** 확인 버튼 라벨. 기본 "확인" */
  confirmLabel?: string;
  /** 취소 버튼 라벨. 기본 "취소" */
  cancelLabel?: string;
  /** 파괴적 액션이면 확인 버튼을 red 계열로 */
  danger?: boolean;
}

interface ActiveConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

type ConfirmListener = (active: ActiveConfirm) => void;

let listener: ConfirmListener | null = null;

/** 어디서든 import 가능한 명령형 API */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!listener) {
      // 호스트 미마운트 시 안전 폴백 (SSR 등) — 네이티브 confirm
      resolve(
        typeof window !== "undefined"
          ? window.confirm([options.title, options.message].filter(Boolean).join("\n\n"))
          : false,
      );
      return;
    }
    listener({ options, resolve });
  });
}

/** 컴포넌트용 훅 */
export function useConfirm() {
  return confirmDialog;
}

/** 루트 레이아웃에 1회 마운트하는 호스트 */
export function ConfirmHost() {
  const [active, setActive] = useState<ActiveConfirm | null>(null);

  useEffect(() => {
    listener = (next) => {
      setActive((prev) => {
        // 중첩 호출 방어: 기존 요청은 취소 처리
        if (prev) prev.resolve(false);
        return next;
      });
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const close = (ok: boolean) => {
    setActive((prev) => {
      if (prev) prev.resolve(ok);
      return null;
    });
  };

  if (!active) return null;

  const { title, message, confirmLabel = "확인", cancelLabel = "취소", danger = false } =
    active.options;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => close(false)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="mx-4 w-full max-w-sm rounded-2xl bg-white p-7 shadow-lg font-[Pretendard]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        {message && (
          <p className="mt-3 whitespace-pre-line break-keep text-sm leading-relaxed text-gray-500">
            {message}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => close(false)}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-medium text-white transition ${
              danger
                ? "bg-red-500 hover:bg-red-600"
                : "bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
