'use client'

/**
 * 에디터 실렌더 미리보기(오너 요청 2026-08-12: "미리보기에 디자인이 빠져있다") — final_html 축약판
 * 대신 에디터와 동일한 문서 빌드(buildEditorDocument)·섹션 렌더러(CanvasSectionComponent)를 읽기
 * 전용으로 재사용한다. 레이아웃·프레임·배지·카드·테마(Track I)가 에디터에서 보이는 그대로 나온다.
 * 편집 인터랙션은 pointerEvents: none으로 차단(에디터 스토어 선택 상태 불변 — MobilePreview와 동일 기법).
 * 저장본이 있으면 저장본, 없으면 파이프라인 산출로 최초 변환본을 렌더한다(에디터 진입 시와 동일).
 */

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/clerk-shim'
import { Loader2 } from 'lucide-react'
import { fetchEditorData } from '@/lib/registration/editor/services/editorApi'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import CanvasSectionComponent from './editor/CanvasSection'
import './PdpEditorPreview.css'

const CANVAS_WIDTH = 860
const VIEWPORT_HEIGHT = 900

export function PdpEditorPreview({
  jobId,
  displayWidth,
  fallback,
}: {
  jobId: string
  /** 표시 폭(px) — 390=모바일 실배율, 860=캔버스 원배율 */
  displayWidth: number
  /** 에디터 데이터 로드 실패 시 대체 렌더(구 final_html iframe 등) */
  fallback?: React.ReactNode
}) {
  const { getToken } = useAuth()
  const [sections, setSections] = useState<CanvasSection[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const token = (await getToken()) ?? ''
        const res = await fetchEditorData(jobId, token)
        const doc = await buildEditorDocument(jobId, res)
        if (alive) setSections(doc.sections)
      } catch (e) {
        console.warn('[PdpEditorPreview] 에디터 렌더 로드 실패 — 폴백 표시:', e)
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [jobId, getToken])

  if (failed) {
    return (
      <>
        {fallback ?? null}
        <div className="text-[11px] text-warning-700 mt-1">에디터 렌더를 불러오지 못해 축약 미리보기로 표시 중입니다.</div>
      </>
    )
  }
  if (!sections) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 에디터 렌더 준비 중…
      </div>
    )
  }

  // Canvas/내보내기와 동일 기준(divider·0높이·비표시 제외) — MobilePreview와 동일
  const visible = [...sections]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.isVisible && s.sectionType !== 'divider' && s.canvas.height > 0)
  const totalHeight = visible.reduce((sum, s) => sum + s.canvas.height, 0)
  const scale = displayWidth / CANVAS_WIDTH

  return (
    <div
      className="mx-auto border border-slate-200 rounded bg-white overflow-y-auto overflow-x-hidden"
      style={{ width: displayWidth, height: Math.min(VIEWPORT_HEIGHT, Math.ceil(totalHeight * scale)) }}
    >
      <div style={{ width: displayWidth, height: Math.ceil(totalHeight * scale), position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            width: CANVAS_WIDTH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {visible.map((section) => (
            <CanvasSectionComponent key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  )
}
