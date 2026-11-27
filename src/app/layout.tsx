import type { Metadata, Viewport } from 'next'
import { PwaRegister } from '@/components/pwa/PwaRegister'
import './globals.css'

export const metadata: Metadata = {
  title: 'NEXOPS 라이트 — 사업장 운영 장부',
  description: '쿠팡 로켓그로스 셀러를 위한 상품·재고·매입·지출·정산 장부',
  applicationName: 'NexOps',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NexOps',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icons/nexops-192.png',
    apple: '/icons/nexops-apple-180.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#22C55E',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
        <PwaRegister />
      </body>
    </html>
  )
}
