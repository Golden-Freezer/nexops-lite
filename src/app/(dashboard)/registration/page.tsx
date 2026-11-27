'use client'

// 상품등록 — 등록 대기 목록 (Phase 2에서 드래프트 목록+에셋 배지로 확장, 지금은 진입 허브)

import Link from 'next/link'
import { Image as ImageIcon, FileText, History } from 'lucide-react'
import { Header } from '@/components/layout/Header'

const ENTRIES = [
  {
    href: '/registration/thumbnail',
    icon: ImageIcon,
    title: '대표이미지 스튜디오',
    desc: '상품 사진 1~3장으로 누끼·임팩트·실사용 3컷 세트를 생성하고 동일성 게이트로 검증합니다.',
    ready: true,
  },
  {
    href: '/registration/detail-page',
    icon: FileText,
    title: '상세페이지 생성',
    desc: 'Premium/Pro 6단계 파이프라인으로 상세페이지 카피·섹션 이미지를 생성합니다.',
    ready: true,
  },
  {
    href: '/registration/history',
    icon: History,
    title: '생성 히스토리',
    desc: '대표이미지 생성 잡 이력 — 재개·결과 확인.',
    ready: true,
  },
]

export default function RegistrationPage() {
  return (
    <>
      <Header title="상품등록" />
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ENTRIES.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className={`rounded-lg border border-slate-200 bg-white p-4 space-y-2 hover:border-brand-400 ${entry.ready ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <entry.icon className="w-4 h-4 text-brand-500" />
                {entry.title}
                {!entry.ready && (
                  <span className="text-[10px] font-normal text-slate-400 border border-slate-200 rounded-full px-1.5">
                    준비중
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{entry.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
