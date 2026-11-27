'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@/lib/auth/clerk-shim'
import { cn } from '@/lib/utils'
import { SECTIONS, resolveSection } from '@/lib/nav/sections'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const pathname = usePathname()
  // 오너 전용 섹션 탭 숨김 (라우트 차단은 middleware.ts)
  const { user } = useUser()
  const isOwner = user?.publicMetadata?.role === 'owner'

  const activeSection = resolveSection(pathname)
  const visibleSections = SECTIONS.filter(
    (section) => !section.hidden && (!section.ownerOnly || isOwner)
  )

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
        <h1 className="min-w-0 truncate text-base font-semibold text-slate-700">{title}</h1>


        {/* 데스크톱 섹션 탭 */}
        {visibleSections.length > 1 && (
          <nav className={cn(
            'hidden shrink-0 items-center gap-1 rounded-lg bg-slate-100 p-1 md:flex',
            'ml-auto'
          )}>
            {visibleSections.map((section) => (
              <Link
                key={section.key}
                href={section.firstHref}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  section.key === activeSection.key
                    ? 'bg-white text-brand-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                )}
              >
                {section.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* 모바일 섹션 탭 — 가로 스크롤로 작은 화면에서도 잘리지 않는다. */}
      {visibleSections.length > 1 && (
        <nav className="overflow-x-auto border-t border-slate-100 px-3 py-1.5 md:hidden">
          <div className="mx-auto flex min-w-max items-center gap-1 rounded-lg bg-slate-100 p-1">
            {visibleSections.map((section) => (
              <Link
                key={section.key}
                href={section.firstHref}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  section.key === activeSection.key
                    ? 'bg-white text-brand-700 shadow-sm'
                    : 'text-slate-500'
                )}
              >
                {section.shortLabel}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
