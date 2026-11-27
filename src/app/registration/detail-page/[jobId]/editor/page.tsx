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

// 캔버스 폰트 화이트리스트(constants/fonts.ts) 로드 — NEXFIT layout.tsx 이식.
// 정적 'Pretendard' 패밀리를 variable과 별도로 싣는 이유: 에디터 캔버스·내보내기가
// 참조하는 패밀리명이 'Pretendard'라 variable css만으로는 시스템 폰트로 폴백된다.
const FONT_LINKS = [
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700&family=Black+Han+Sans&family=Do+Hyeon&family=Jua&family=Gugi&family=IBM+Plex+Sans+KR:wght@400;700&family=Gothic+A1:wght@400;700;900&family=Noto+Serif+KR:wght@400;700&family=Gowun+Batang&family=Gowun+Dodum&family=Hahmlet:wght@400;700&family=Song+Myung&family=Nanum+Pen+Script&family=Gaegu&display=swap',
  'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.css',
  'https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/complete/WantedSansVariable.min.css',
  'https://cdn.jsdelivr.net/gh/fonts-archive/Cafe24Ssurround/Cafe24Ssurround.css',
  'https://cdn.jsdelivr.net/npm/@kfonts/line-seed-sans-kr/index.css',
]

export default async function EditorPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return (
    <div className="nexops-editor-root">
      {FONT_LINKS.map((href) => (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link key={href} rel="stylesheet" href={href} crossOrigin="anonymous" />
      ))}
      <ProEditorPage pdpId={jobId} />
      <Toaster />
      <ConfirmHost />
    </div>
  )
}
