'use client'

/**
 * 3컷 결과 + 게이트 판정 표시 + 컷 채택.
 * NEXFIT UI는 게이트를 숨기지만 NexOps는 오너 검수 도구이므로 판정·사유를 노출한다(설계문서 §4.2).
 */

import { Check, Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  THUMBNAIL_CUTS,
  THUMBNAIL_CUT_LABELS,
  type CutGateDetail,
  type ThumbnailCut,
  type ThumbnailJob,
} from '@/lib/registration/thumbnail-types'

function GateBadge({ gate }: { gate: CutGateDetail | undefined }) {
  if (!gate) return <span className="text-[10px] text-slate-400">게이트 미대상</span>
  if (gate.passed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-brand-600">
        <ShieldCheck className="w-3 h-3" /> 동일성 통과
        {gate.presentation.warning && (
          <span className="text-amber-600" title={gate.presentation.warning}>
            (경고)
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-flex items-start gap-1 text-[10px] text-danger-600" title={gate.message ?? undefined}>
      <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" />
      <span className="line-clamp-2">{gate.message ?? '미통과'}</span>
    </span>
  )
}

const CUT_HINTS: Record<ThumbnailCut, string> = {
  cutout: '대표이미지용 (흰 배경 규격컷)',
  studio: '추가이미지용 (임팩트 연출)',
  usage: '추가이미지용 (실사용 장면)',
}

export function ThumbnailResults({
  job,
  adopting,
  onAdopt,
}: {
  job: ThumbnailJob
  adopting: boolean
  onAdopt: (cut: ThumbnailCut) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {THUMBNAIL_CUTS.map((cut) => {
        const entry = job.cuts[cut]
        const selected = job.selectedCut === cut
        return (
          <div
            key={cut}
            className={`rounded-lg border p-2 space-y-1.5 bg-white ${selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {THUMBNAIL_CUT_LABELS[cut]}
                {entry?.retried && <span className="ml-1 text-[10px] text-amber-600">재생성</span>}
              </span>
              {selected && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-brand-600">
                  <Check className="w-3 h-3" /> 채택됨
                </span>
              )}
            </div>
            {entry?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.url} alt={THUMBNAIL_CUT_LABELS[cut]} className="w-full aspect-square object-cover rounded" />
            ) : (
              <div className="w-full aspect-square rounded bg-slate-50 flex items-center justify-center text-[11px] text-danger-600 p-2 text-center">
                {entry?.error ?? '생성되지 않음'}
              </div>
            )}
            <div className="text-[10px] text-slate-400">{CUT_HINTS[cut]}</div>
            {cut !== 'usage' && <GateBadge gate={entry?.gate} />}
            {entry?.url && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  onClick={() => onAdopt(cut)}
                  disabled={adopting || selected}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {selected ? '채택됨' : '대표이미지로 채택'}
                </button>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="inline-flex items-center gap-0.5 text-[11px] px-2 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <Download className="w-3 h-3" /> 원본
                </a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
