'use client'

/**
 * 굽기·저장 결과 칸의 Wing 용 HTML 단추(복사·내려받기)와 움직이는 칸 경고(AX-CT-30) — 표시만 한다.
 * 상태(저장된 주소·안내 글)와 동작은 CoupangImageSave 가 넘긴다. 저장(commit)까지 끝난 결과에서만 그린다.
 */

import { Copy, Download } from 'lucide-react'
import { WING_HTML_MOTION_WARNING } from '@/lib/registration/editor/utils/exportUtils/wingDetailHtml'

const buttonClass =
  'flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-default)] hover:bg-[var(--hover-overlay)]'

export function WingHtmlActions({
  motionCount,
  note,
  onCopy,
  onDownload,
}: {
  motionCount: number
  note: string | null
  onCopy: () => void
  onDownload: () => void
}) {
  return (
    <div className="pt-1 space-y-1">
      <div className="flex gap-2">
        <button type="button" onClick={onCopy} className={buttonClass}>
          <Copy size={12} /> Wing HTML 복사
        </button>
        <button type="button" onClick={onDownload} className={buttonClass}>
          <Download size={12} /> HTML 내려받기
        </button>
      </div>
      {motionCount > 0 && <div className="text-amber-700">{WING_HTML_MOTION_WARNING}</div>}
      {note && <div className="text-[var(--text-disabled)]">{note}</div>}
    </div>
  )
}
