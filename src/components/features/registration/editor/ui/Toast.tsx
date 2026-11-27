"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 공용 토스트 시스템 (WO-2 Quick-win ③ — alert() 대체).
 *
 * PatchNotesToast의 다크 글래스 스타일(rgba(15,15,15,0.95) + blur + radius)을 계승한
 * 경량 알림. 루트 레이아웃에 <Toaster />를 1회 마운트하면 어디서든 사용할 수 있다.
 *
 * 컴포넌트에서:   const toast = useToast(); toast.success("저장되었습니다");
 * 유틸/비컴포넌트: import { toast } from "@/components/features/registration/editor/ui/Toast"; toast.error("실패");
 *
 * 타입별 기본 노출 시간: success/info 3.5s, error 5s. 클릭 시 즉시 닫힘.
 */

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  /** 노출 시간(ms). 기본: error 5000, 그 외 3500 */
  duration?: number;
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

type ToastListener = (item: ToastItem) => void;

let seq = 0;
let listener: ToastListener | null = null;
// Toaster 마운트 전에 발생한 토스트 보관 (하이드레이션 직후 등 경계 케이스)
const pending: ToastItem[] = [];

function emit(type: ToastType, message: string, options?: ToastOptions) {
  const item: ToastItem = {
    id: ++seq,
    type,
    message,
    duration: options?.duration ?? (type === "error" ? 5000 : 3500),
  };
  if (listener) {
    listener(item);
  } else {
    pending.push(item);
  }
}

/** 어디서든 import 가능한 명령형 API (React 외부 유틸 포함) */
export const toast = {
  success: (message: string, options?: ToastOptions) => emit("success", message, options),
  error: (message: string, options?: ToastOptions) => emit("error", message, options),
  info: (message: string, options?: ToastOptions) => emit("info", message, options),
};

/** 컴포넌트용 훅 — 명령형 API와 동일 객체를 반환 */
export function useToast() {
  return toast;
}

const ACCENT: Record<ToastType, string> = {
  success: "var(--brand-success, #68B984)",
  error: "var(--brand-error, #E06B6B)",
  info: "var(--brand-primary, #7EB8C9)",
};

const ICON: Record<ToastType, string> = {
  success: "✓", // ✓
  error: "⚠",   // ⚠
  info: "ℹ",    // ℹ
};

/** 루트 레이아웃에 1회 마운트하는 호스트 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const push = (item: ToastItem) => {
      setItems((prev) => [...prev.slice(-4), item]); // 최대 5개 유지
      const t = setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        timers.delete(item.id);
      }, item.duration);
      timers.set(item.id, t);
    };
    listener = push;
    // 마운트 전 대기분 방출
    while (pending.length > 0) {
      const item = pending.shift();
      if (item) push(item);
    }
    return () => {
      listener = null;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        pointerEvents: "none",
        maxWidth: "min(480px, calc(100vw - 32px))",
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="status"
          onClick={() => dismiss(item.id)}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 16px",
            maxWidth: "100%",
            background: "rgba(15, 15, 15, 0.95)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderLeft: `3px solid ${ACCENT[item.type]}`,
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            color: "#f0f0f0",
            fontFamily: "'Pretendard Variable', Pretendard, sans-serif",
            fontSize: "13px",
            lineHeight: 1.5,
            textAlign: "left",
            cursor: "pointer",
            animation: "nexopsToastUp 0.3s ease-out",
          }}
        >
          <span
            aria-hidden
            style={{
              color: ACCENT[item.type],
              fontSize: "14px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {ICON[item.type]}
          </span>
          <span style={{ whiteSpace: "pre-line", wordBreak: "keep-all" }}>{item.message}</span>
        </button>
      ))}
      <style>{`
        @keyframes nexopsToastUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
