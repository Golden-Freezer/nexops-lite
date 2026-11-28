'use client'

/**
 * 대표이미지 생성 패널 (WS-B) — 상품명 기반 4스타일 동시 생성 또는 직접 프롬프트 생성.
 * 모델 선택(GPT-Image 2.0 / Nano Banana Pro), 결과를 그리드로 보여주고 클릭해 대표이미지로 선택한다.
 * 선택된 이미지의 public URL이 등록 폼 대표이미지 슬롯에 반영된다(쿠팡이 http로 가져갈 수 있는 경로).
 */

import { useState } from 'react'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { IMAGE_MODELS, type ImageModel } from '@/lib/agents/image/types'
import { IMAGE_STYLES, buildStylePrompt } from '@/lib/agents/image/prompts'

interface GenResult {
  url: string
  label: string
}

export function RegistrationImageGen({
  defaultPrompt,
  onGenerated,
}: {
  defaultPrompt: string
  onGenerated: (url: string) => void
}) {
  const [model, setModel] = useState<ImageModel>(IMAGE_MODELS[0].id)
  const [customPrompt, setCustomPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<GenResult[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  async function callGenerate(prompt: string): Promise<string> {
    const res = await fetch('/api/sourcing/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || '생성 실패')
    return json.data.url as string
  }

  function select(url: string) {
    setSelected(url)
    onGenerated(url)
  }

  async function generateFourStyles() {
    setBusy(true)
    setError(null)
    setResults([])
    setSelected(null)
    const settled = await Promise.allSettled(
      IMAGE_STYLES.map((s) => callGenerate(buildStylePrompt(defaultPrompt, s.key)).then((url) => ({ url, label: s.label })))
    )
    const ok = settled.filter((r): r is PromiseFulfilledResult<GenResult> => r.status === 'fulfilled').map((r) => r.value)
    setResults(ok)
    if (ok.length > 0) select(ok[0].url)
    if (ok.length < IMAGE_STYLES.length) setError(`${IMAGE_STYLES.length - ok.length}개 스타일 생성 실패`)
    setBusy(false)
  }

  async function generateCustom() {
    setBusy(true)
    setError(null)
    try {
      const prompt = customPrompt.trim() || buildStylePrompt(defaultPrompt, 'white')
      const url = await callGenerate(prompt)
      setResults((prev) => [{ url, label: '직접' }, ...prev])
      select(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="w-3.5 h-3.5 text-brand-500" />
        <span className="text-xs font-semibold text-slate-600">대표이미지 생성</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ImageModel)}
          className="ml-auto border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={generateFourStyles}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          4스타일 생성
        </button>
        <span className="text-[10px] text-slate-400">순백·라이프스타일·스펙강조·프리미엄 4종을 한 번에</span>
      </div>

      {/* 결과 그리드 — 클릭해 대표이미지로 선택 */}
      {results.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {results.map((r) => (
            <button
              key={r.url}
              onClick={() => select(r.url)}
              className={`relative rounded border overflow-hidden ${selected === r.url ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'}`}
              title={r.label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={`대표이미지 ${r.label}`} className="w-full aspect-square object-cover" />
              {selected === r.url && (
                <span className="absolute top-0.5 right-0.5 bg-brand-500 text-white rounded-full p-0.5">
                  <Check className="w-2.5 h-2.5" />
                </span>
              )}
              <span className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-[9px] py-0.5">{r.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 직접 프롬프트 생성 */}
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">직접 프롬프트로 생성</summary>
        <div className="mt-2 space-y-1.5">
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            rows={2}
            placeholder={buildStylePrompt(defaultPrompt, 'white')}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
          />
          <button
            onClick={generateCustom}
            disabled={busy}
            className="text-xs px-3 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            생성
          </button>
        </div>
      </details>

      {error && <div className="text-[11px] text-danger-600">{error}</div>}
    </div>
  )
}
