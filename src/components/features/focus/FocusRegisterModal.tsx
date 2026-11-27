"use client";

import { useEffect, useState } from "react";
import { ListChecks, Loader2, Plus, X } from "lucide-react";
import { FocusCampaignPicker } from "@/components/features/focus/FocusCampaignPicker";
import {
  FocusProductCombobox,
  ProductGradeBadge,
} from "@/components/features/focus/FocusProductCombobox";
import { apiFetch } from "@/lib/api-client";
import type {
  CampaignCatalogCandidate,
  FocusProduct,
  ProductPickOption,
} from "@/types/focus";

interface FocusRegisterModalProps {
  open: boolean;
  onClose: () => void;
  onRegistered: (product: FocusProduct) => Promise<void>;
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function FocusRegisterModal({
  open,
  onClose,
  onRegistered,
}: FocusRegisterModalProps) {
  const [mode, setMode] = useState<"manual" | "campaigns">("manual");
  const [exposureId, setExposureId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [label, setLabel] = useState("");
  const [productId, setProductId] = useState("");
  const [manualExposure, setManualExposure] = useState(false);
  const [products, setProducts] = useState<ProductPickOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignCatalogCandidate[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setMode("manual");
    setExposureId("");
    setCampaignId("");
    setLabel("");
    setProductId("");
    setManualExposure(false);
    setProducts([]);
    setCampaigns([]);
    setError(null);
    setNotice(null);
    setCatalogLoading(true);
    setCatalogError(null);

    apiFetch("/api/focus/campaigns?onlyRegisterable=1", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await responseJson(response);
        if (!response.ok)
          throw new Error(
            String(json.error || "상품·캠페인 목록 조회에 실패했습니다."),
          );
        const nextProducts =
          (json.products as ProductPickOption[] | undefined) ?? [];
        setProducts(nextProducts);
        setCampaigns(
          (json.candidates as CampaignCatalogCandidate[] | undefined) ?? [],
        );
        if (nextProducts.length === 0) setManualExposure(true);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setCatalogError(
          reason instanceof Error
            ? reason.message
            : "상품·캠페인 목록 조회에 실패했습니다.",
        );
        setManualExposure(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => controller.abort();
  }, [open]);

  const selectedProduct =
    products.find((product) => product.product_id === productId) ?? null;
  const selectedCampaign =
    campaigns.find((campaign) => campaign.campaign_id === campaignId) ?? null;

  const selectProduct = (product: ProductPickOption | null) => {
    setProductId(product?.product_id ?? "");
    setExposureId(product?.coupang_exposure_id ?? "");
    setLabel(product?.product_name ?? "");
  };

  const enableManualExposure = () => {
    setManualExposure(true);
    setProductId("");
    setExposureId("");
    setLabel("");
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!exposureId.trim() || !campaignId.trim()) {
      setError("노출ID와 캠페인ID를 모두 지정해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch("/api/focus/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(productId ? { product_id: productId } : {}),
          coupang_exposure_id: exposureId.trim(),
          campaign_id: campaignId.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      });
      const json = await responseJson(response);
      if (!response.ok)
        throw new Error(String(json.error || "주력상품 등록에 실패했습니다."));

      await onRegistered(json.data as FocusProduct);
      if (response.status === 200) {
        setNotice("이미 등록된 주력상품입니다. 기존 항목을 선택했습니다.");
      } else {
        onClose();
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "주력상품 등록에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-register-title"
        className={`max-h-[85dvh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl ${mode === "campaigns" ? "max-w-4xl" : "max-w-lg"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="focus-register-title"
              className="text-base font-semibold text-slate-800"
            >
              주력상품 등록
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              상품과 판매 캠페인을 확인하고 직접 연결합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-md px-3 py-2 font-medium ${mode === "manual" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
          >
            직접 입력
          </button>
          <button
            type="button"
            onClick={() => setMode("campaigns")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-medium ${mode === "campaigns" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
          >
            <ListChecks className="h-4 w-4" /> 운영 중 캠페인에서
          </button>
        </div>

        {mode === "campaigns" ? (
          <FocusCampaignPicker onClose={onClose} onRegistered={onRegistered} />
        ) : (
          <>
            <div className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">
                    상품 <span className="text-red-500">*</span>
                  </label>
                  {!manualExposure && (
                    <button
                      type="button"
                      onClick={enableManualExposure}
                      className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
                    >
                      목록에 없음 · 노출ID 직접 입력
                    </button>
                  )}
                </div>

                {manualExposure ? (
                  <div className="mt-1">
                    <input
                      value={exposureId}
                      onChange={(event) => setExposureId(event.target.value)}
                      placeholder="쿠팡 노출ID"
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-emerald-400"
                    />
                    {products.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setManualExposure(false);
                          setExposureId("");
                        }}
                        className="mt-1 text-[11px] text-emerald-700 hover:underline"
                      >
                        상품 목록에서 다시 선택
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-1">
                    <FocusProductCombobox
                      options={products}
                      value={productId}
                      onChange={selectProduct}
                      disabled={catalogLoading}
                      placeholder={
                        catalogLoading
                          ? "상품 목록 불러오는 중..."
                          : "노출ID 또는 상품명 검색"
                      }
                    />
                    {selectedProduct && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        <span className="font-mono">
                          {selectedProduct.coupang_exposure_id}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {selectedProduct.product_name}
                        </span>
                        <ProductGradeBadge
                          grade={selectedProduct.product_grade}
                        />
                      </div>
                    )}
                  </div>
                )}
                {catalogError && (
                  <p className="mt-1 text-[11px] text-red-600">
                    {catalogError} 수동 입력은 계속할 수 있습니다.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">
                  캠페인 <span className="text-red-500">*</span>
                </label>
                {campaigns.length > 0 ? (
                  <>
                    <select
                      value={campaignId}
                      onChange={(event) => setCampaignId(event.target.value)}
                      disabled={catalogLoading}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400"
                    >
                      <option value="">캠페인ID · 캠페인명 선택</option>
                      {campaigns.map((campaign) => (
                        <option
                          key={campaign.campaign_id}
                          value={campaign.campaign_id}
                        >
                          {campaign.campaign_id} ·{" "}
                          {campaign.name || "(캠페인명 없음)"}
                        </option>
                      ))}
                    </select>
                    {selectedCampaign && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        <span className="font-mono">
                          ID {selectedCampaign.campaign_id}
                        </span>{" "}
                        · {selectedCampaign.name || "(캠페인명 없음)"}
                      </p>
                    )}
                  </>
                ) : (
                  <input
                    value={campaignId}
                    onChange={(event) => setCampaignId(event.target.value)}
                    placeholder={
                      catalogLoading
                        ? "캠페인 목록 불러오는 중..."
                        : "광고 캠페인ID"
                    }
                    disabled={catalogLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-emerald-400 disabled:bg-slate-50"
                  />
                )}
              </div>

              <label className="block text-xs font-medium text-slate-600">
                표시명{" "}
                <span className="font-normal text-slate-400">(선택)</span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="선택한 상품명이 자동 입력됩니다"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            {notice && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {notice}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {submitting ? "등록 중..." : "등록"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
