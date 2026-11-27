'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@/lib/auth/clerk-shim'
import { MoreHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTIONS, resolveSection } from '@/lib/nav/sections'

// 하단 탭은 활성 섹션의 mobileLabel 지정 메뉴만 표시 (섹션 전환은 Header 섹션 탭).
export function MobileNav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const { user } = useUser()
  const isOwner = user?.publicMetadata?.role === 'owner'

  // 비오너가 오너 전용 섹션 라우트에 있는 경우(미들웨어가 차단하지만 방어) 운영 메뉴로 fallback
  const section = resolveSection(pathname)
  const activeSection = section.ownerOnly && !isOwner
    ? SECTIONS.find((s) => s.key === 'operations')!
    : section

  const labeledItems = activeSection.items.filter((item) => item.mobileLabel)
  const needsMoreMenu = activeSection.items.length > labeledItems.length || labeledItems.length > 5
  const tabs = needsMoreMenu ? labeledItems.slice(0, 4) : labeledItems

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="모바일 메뉴 닫기"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/20 md:hidden"
          />
          <section className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-2xl md:hidden">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">{activeSection.label} 전체 메뉴</h2>
              <button
                type="button"
                aria-label="전체 메뉴 닫기"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {activeSection.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm',
                    isActive(item.href)
                      ? 'border-brand-200 bg-brand-50 font-medium text-brand-700'
                      : 'border-slate-100 text-slate-600'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex h-14 items-center justify-around">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1.5 text-[11px]',
                isActive(tab.href)
                  ? 'text-brand-600 font-medium'
                  : 'text-slate-400'
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="max-w-full truncate">{tab.mobileLabel}</span>
            </Link>
          ))}
          {needsMoreMenu && (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1.5 text-[11px]',
                menuOpen || !tabs.some((tab) => isActive(tab.href))
                  ? 'font-medium text-brand-600'
                  : 'text-slate-400'
              )}
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>더보기</span>
            </button>
          )}
        </div>
      </nav>
    </>
  )
}
