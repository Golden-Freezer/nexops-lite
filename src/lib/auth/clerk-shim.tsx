'use client'

/**
 * NEXOPS 화면 코드가 쓰던 Clerk 훅 자리를 Supabase Auth로 채운다.
 * 같은 주소(Vercel) 안에서는 로그인 쿠키가 자동으로 붙으므로 getToken은 null을 돌려준다.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type LiteUser = { id: string; email: string | null; publicMetadata: { role: 'owner' } }

export function useUser(): { user: LiteUser | null; isLoaded: boolean } {
  const [user, setUser] = useState<LiteUser | null>(null)
  const [isLoaded, setLoaded] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      setUser(u ? { id: u.id, email: u.email ?? null, publicMetadata: { role: 'owner' } } : null)
      setLoaded(true)
    })
  }, [])
  return { user, isLoaded }
}

export function useAuth(): { getToken: (opts?: unknown) => Promise<string | null> } {
  return { getToken: async () => null }
}

export function UserButton(_props: { appearance?: unknown }) {
  const router = useRouter()
  return (
    <button
      type="button"
      title="로그아웃"
      onClick={async () => {
        await createClient().auth.signOut()
        router.replace('/login')
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300"
    >
      <LogOut className="h-4 w-4" />
    </button>
  )
}
