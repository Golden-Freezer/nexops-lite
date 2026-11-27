import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// 로그인 없이 열리는 주소. API는 각 라우트가 직접 401을 돌려준다(업로드 키 허용 때문).
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/sw.js', '/offline.html']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))
  if (!url || !anon) {
    // 환경 변수 전: 로그인 화면이 안내 문구를 보여 준다.
    if (isPublic || path.startsWith('/api/')) return response
    return NextResponse.redirect(new URL('/login', request.url))
  }
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { data } = await supabase.auth.getUser()
  if (!data.user && !isPublic && !path.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
}
