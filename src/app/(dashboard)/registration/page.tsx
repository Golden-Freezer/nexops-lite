'use client'

// 상품등록 — 등록 대기(초안 목록). 행을 누르면 등록 준비 드로어가 열린다(RegistrationDraftList).
// 생성 도구는 위쪽 바로가기로 연다(메뉴에도 있음).

import Link from 'next/link'
import { Image as ImageIcon, FileText, History, PenLine } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { RegistrationDraftList } from '@/components/features/registration/RegistrationDraftList'
import { LocalCodexNotice } from '@/components/features/registration/LocalCodexNotice'

const SHORTCUTS = [
  { href: '/naming', icon: PenLine, title: '상품명 작명' },
  { href: '/registration/thumbnail', icon: ImageIcon, title: '대표이미지 스튜디오' },
  { href: '/registration/detail-page', icon: FileText, title: '상세페이지 생성' },
  { href: '/registration/history', icon: History, title: '생성 히스토리' },
]

export default function RegistrationPage() {
  return (
    <>
      <Header title="등록 대기" />
      <div className="max-w-5xl mx-auto px-4 lg:px-6 py-6 space-y-4">
        <LocalCodexNotice />
        <div className="flex items-center gap-1.5 flex-wrap">
          {SHORTCUTS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700"
            >
              <s.icon className="w-3.5 h-3.5 text-brand-500" />
              {s.title}
            </Link>
          ))}
        </div>
        <RegistrationDraftList />
      </div>
    </>
  )
}
