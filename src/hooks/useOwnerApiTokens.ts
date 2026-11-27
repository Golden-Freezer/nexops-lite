"use client";

import { useCallback, useEffect, useState } from "react";

export interface OwnerApiTokenMetadata {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toMetadata(data: OwnerApiTokenMetadata): OwnerApiTokenMetadata {
  return {
    id: data.id,
    label: data.label,
    created_at: data.created_at,
    last_used_at: data.last_used_at,
    revoked_at: data.revoked_at,
  };
}

export function useOwnerApiTokens() {
  const [tokens, setTokens] = useState<OwnerApiTokenMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/api-tokens", {
        cache: "no-store",
      });
      const json = (await response.json()) as ApiEnvelope<{
        tokens: OwnerApiTokenMetadata[];
      }>;
      if (!response.ok) {
        throw new Error(json.error || "개인 API 토큰 조회 실패");
      }

      const nextTokens = json.data?.tokens;
      if (!Array.isArray(nextTokens)) {
        throw new Error("개인 API 토큰 응답 형식이 올바르지 않습니다.");
      }
      setTokens(nextTokens.map(toMetadata));
      return nextTokens;
    } catch (loadError) {
      setError(errorMessage(loadError, "개인 API 토큰 조회 실패"));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const issue = useCallback(async (label?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label === undefined ? {} : { label }),
      });
      const json = (await response.json()) as ApiEnvelope<
        OwnerApiTokenMetadata & { token: string }
      >;
      if (!response.ok) {
        throw new Error(json.error || "개인 API 토큰 발급 실패");
      }
      if (!json.data || typeof json.data.token !== "string") {
        throw new Error("발급된 개인 API 토큰이 응답에 없습니다.");
      }

      const metadata = toMetadata(json.data);
      setTokens((current) => [
        metadata,
        ...current.filter((item) => item.id !== metadata.id),
      ]);
      return json.data.token;
    } catch (issueError) {
      setError(errorMessage(issueError, "개인 API 토큰 발급 실패"));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const revoke = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/api-tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await response.json()) as ApiEnvelope<OwnerApiTokenMetadata>;
      if (!response.ok) {
        throw new Error(json.error || "개인 API 토큰 폐기 실패");
      }
      if (!json.data) {
        throw new Error("폐기된 개인 API 토큰 정보가 응답에 없습니다.");
      }

      const revokedToken = toMetadata(json.data);
      setTokens((current) =>
        current.map((item) =>
          item.id === revokedToken.id ? revokedToken : item,
        ),
      );
      return true;
    } catch (revokeError) {
      setError(errorMessage(revokeError, "개인 API 토큰 폐기 실패"));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { tokens, loading, error, list: reload, reload, issue, revoke };
}
