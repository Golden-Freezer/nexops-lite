import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'NexOps — 이커머스 운영 자동화',
    short_name: 'NexOps',
    description: '쿠팡 셀러를 위한 소싱·마진·재고·정산 통합 운영 플랫폼',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#F8FAFC',
    theme_color: '#22C55E',
    lang: 'ko-KR',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/nexops-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/nexops-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/nexops-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
