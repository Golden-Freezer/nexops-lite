'use client'

// 전역 플로팅 어시스턴트는 데스크톱 위젯 "넥시"로 통일했다(오너 결정 2026-07-27).
// 임포트 건강 알림도 위젯이 이어받았다(desktop-assistant/src/state/useImportHealth.ts).

import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { BusinessProvider } from '@/components/layout/BusinessProvider'
import { ConnectivityBanner } from '@/components/pwa/ConnectivityBanner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <BusinessProvider>
      <div className="flex h-[100dvh] bg-slate-50">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ConnectivityBanner />
          <main className="flex-1 overflow-y-auto overscroll-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>
        <MobileNav />
      </div>
    </BusinessProvider>
  )
}
