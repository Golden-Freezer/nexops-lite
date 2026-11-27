import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 쿠팡 이미지 도메인 허용 (향후 상품 이미지 표시용)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.coupangcdn.com' },
      { protocol: 'https', hostname: 'nkpfjmiypnuerqbgxweh.supabase.co' },
    ],
  },
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
}

export default nextConfig
