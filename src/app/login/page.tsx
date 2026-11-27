'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'loading' | 'login' | 'signup' | 'unconfigured'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('loading')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((s: { hasUser: boolean; configured: boolean }) =>
        setMode(!s.configured ? 'unconfigured' : s.hasUser ? 'login' : 'signup'),
      )
      .catch(() => setMode('unconfigured'))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'signup') {
        const r = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || '가입 실패')
      }
      const { error } = await createClient().auth.signInWithPassword({ email, password })
      if (error) throw new Error('이메일이나 비밀번호가 맞지 않습니다.')
      router.replace('/')
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">NEXOPS 라이트</h1>
        <p className="mt-1 text-sm text-slate-500">사업장 운영 장부</p>
        {mode === 'loading' && <p className="mt-6 text-sm text-slate-500">확인 중…</p>}
        {mode === 'unconfigured' && (
          <p className="mt-6 text-sm text-red-600">
            Supabase 연결 값이 아직 없습니다. Vercel 환경 변수(NEXT_PUBLIC_SUPABASE_URL,
            NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)를 넣고 다시 배포해 주세요.
          </p>
        )}
        {(mode === 'login' || mode === 'signup') && (
          <form onSubmit={submit} className="mt-6 space-y-3">
            {mode === 'signup' && (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                처음 오셨네요. 대표님 이메일과 비밀번호로 가입하면 그 뒤로는 가입이 닫힙니다.
              </p>
            )}
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="비밀번호 (8자 이상)"
              value={password}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? '처리 중…' : mode === 'signup' ? '가입하고 시작' : '로그인'}
            </button>
            {message && <p className="text-sm text-red-600">{message}</p>}
          </form>
        )}
      </div>
    </main>
  )
}
