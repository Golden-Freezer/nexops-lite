// /registration/detail-page/[jobId]/editor — Canvas 에디터 (전체화면, 대시보드 크롬 없음).
// (dashboard) 그룹 밖에 두는 이유: 에디터는 h-screen 3패널 전용 레이아웃이라 사이드바·헤더와
// 공존하지 않는다(NEXFIT도 /editor 독립 라우트). 오너 게이트는 middleware isOwnerOnlyRoute
// '/registration(.*)'가 URL 기준으로 그대로 적용된다.

import ProEditorPage from '@/components/features/registration/editor/ProEditorPage'
import { Toaster } from '@/components/features/registration/editor/ui/Toast'
import { ConfirmHost } from '@/components/features/registration/editor/ui/ConfirmDialog'
import './editor-theme.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '상세페이지 에디터 — NexOps' }

// 캔버스 폰트 화이트리스트(constants/fonts.ts)는 루트 layout이 싣는 자체 보관 스타일시트(public/fonts/pdp/fonts.css,
// 출처·라이선스는 NOTICE.md)에 있다 — 여기서 다시 실으면 같은 @font-face가 두 벌이 돼 이미지 굽기(fontEmbed)에 두 번 들어간다.

export default async function EditorPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return (
    <div className="nexops-editor-root">
      <ProEditorPage pdpId={jobId} />
      <Toaster />
      <ConfirmHost />
    </div>
  )
}
