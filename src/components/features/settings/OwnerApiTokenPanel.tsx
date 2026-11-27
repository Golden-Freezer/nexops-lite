"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@/lib/auth/clerk-shim";
import {
  Check,
  Clipboard,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useOwnerApiTokens } from "@/hooks/useOwnerApiTokens";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function OwnerApiTokenPanel() {
  const { isLoaded, user } = useUser();
  const isOwner = user?.publicMetadata?.role === "owner";

  if (!isLoaded || !isOwner) return null;
  return <OwnerApiTokenPanelContent />;
}

function OwnerApiTokenPanelContent() {
  const { tokens, loading, error, reload, issue, revoke } =
    useOwnerApiTokens();
  const [label, setLabel] = useState("AI 장부 업데이트");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const activeCount = tokens.filter((token) => !token.revoked_at).length;
  const canIssue = label.trim().length >= 1 && label.trim().length <= 100;

  const handleIssue = async () => {
    setIssuedToken(null);
    setCopied(false);
    setCopyError(null);
    const token = await issue(label.trim());
    if (token) setIssuedToken(token);
  };

  const handleCopy = async () => {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      setCopied(true);
      setCopyError(null);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError("클립보드 복사에 실패했습니다. 브라우저 권한을 확인하세요.");
    }
  };

  const handleRevoke = async (id: string) => {
    if (revokeConfirmId !== id) {
      setRevokeConfirmId(id);
      return;
    }
    if (await revoke(id)) setRevokeConfirmId(null);
  };

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white shadow-card"
      role="region"
      aria-labelledby="owner-api-token-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <div>
            <h2
              id="owner-api-token-title"
              className="text-base font-semibold text-slate-700"
            >
              업로드 키 (AI 장부 업데이트용)
            </h2>
            <p className="text-xs text-slate-400">
              대표님 PC의 AI(Codex·Claude)가 Wing 파일을 이 장부에 올릴 때 쓰는 키입니다. 남에게 보여 주지 마세요.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            활성 {activeCount}
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
            aria-label="개인 API 토큰 목록 새로고침"
            title="목록 새로고침"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {(error || copyError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error || copyError}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label
            htmlFor="owner-api-token-label"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            토큰 라벨
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="owner-api-token-label"
              type="text"
              value={label}
              maxLength={100}
              onChange={(event) => setLabel(event.target.value)}
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              placeholder="Desktop Assistant"
            />
            <button
              type="button"
              onClick={() => void handleIssue()}
              disabled={loading || !canIssue}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              토큰 발급
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            라벨은 1~100자입니다. 서버에는 평문 대신 해시만 저장됩니다.
          </p>
        </div>

        {issuedToken && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2 text-amber-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-semibold">새 업로드 키</p>
                <p className="mt-0.5 text-xs">
                  이 키는 다시 볼 수 없습니다. 지금 복사해 내 PC의 장부받기설정.txt에
                  붙여 넣으세요.
                </p>
              </div>
            </div>
            <code className="mt-3 block break-all rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
              {issuedToken}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 focus:ring-2 focus:ring-brand-500/20"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Clipboard className="h-3.5 w-3.5" />
                )}
                {copied ? "복사됨 ✓" : "토큰 복사"}
              </button>
              <button
                type="button"
                onClick={() => setIssuedToken(null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 focus:ring-2 focus:ring-brand-500/20"
              >
                <EyeOff className="h-3.5 w-3.5" /> 화면에서 지우기
              </button>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            발급 이력
          </h3>
          {loading && tokens.length === 0 ? (
            <div className="flex justify-center rounded-lg bg-slate-50 py-6">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-xs text-slate-400">
              발급된 개인 API 토큰이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">라벨</th>
                    <th className="px-3 py-2 text-left font-medium">생성일</th>
                    <th className="px-3 py-2 text-left font-medium">
                      마지막 사용
                    </th>
                    <th className="px-3 py-2 text-left font-medium">상태</th>
                    <th className="px-3 py-2 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {token.label}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDateTime(token.created_at)}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDateTime(token.last_used_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${
                            token.revoked_at
                              ? "border-slate-200 bg-slate-100 text-slate-500"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {token.revoked_at ? "폐기됨" : "활성"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!token.revoked_at && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleRevoke(token.id)}
                              disabled={loading}
                              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium focus:ring-2 focus:ring-red-500/20 disabled:opacity-50 ${
                                revokeConfirmId === token.id
                                  ? "bg-red-600 text-white hover:bg-red-700"
                                  : "text-red-600 hover:bg-red-50"
                              }`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {revokeConfirmId === token.id
                                ? "폐기 확인"
                                : "폐기"}
                            </button>
                            {revokeConfirmId === token.id && (
                              <button
                                type="button"
                                onClick={() => setRevokeConfirmId(null)}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus:ring-2 focus:ring-brand-500/20"
                                aria-label={`${token.label} 토큰 폐기 취소`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
