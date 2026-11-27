'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton, useUser } from '@/lib/auth/clerk-shim'
import {
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
  ChevronDown,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBusinessContext } from '@/hooks/useBusiness'
import { SECTIONS, resolveSection } from '@/lib/nav/sections'

const bottomItems = [
  { href: '/settings', icon: Settings, label: '설정' },
]

// 사업자 미등록 시에도 접근 가능한 운영 메뉴 (전체 현황·대시보드)
const ALWAYS_VISIBLE_OPERATION_HREFS = ['/overview', '/']

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [bizOpen, setBizOpen] = useState(false)
  const { businesses, currentBusiness, switchBusiness, loading: bizLoading } = useBusinessContext()
  // 소싱/리서치는 오너 전용 (Clerk publicMetadata role='owner' — 라우트 차단은 middleware.ts)
  const { user } = useUser()
  const isOwner = user?.publicMetadata?.role === 'owner'

  // 활성 섹션은 pathname에서 파생 — 해당 섹션 메뉴만 표시.
  // 비오너가 오너 전용 섹션 라우트에 있는 경우(미들웨어가 차단하지만 방어) 운영 메뉴로 fallback.
  const section = resolveSection(pathname)
  const activeSection = section.ownerOnly && !isOwner
    ? SECTIONS.find((s) => s.key === 'operations')!
    : section

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  // 메뉴 이동은 <Link> 클라이언트 내비 — 전체 새로고침은 사업장 전환 시에만(switchBusiness의 reload)
  const NavLink = ({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) => (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        isActive(href)
          ? 'bg-brand-50 text-brand-700'
          : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
      )}
    >
      <Icon className="w-4.5 h-4.5 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  )

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-screen bg-slate-100 border-r border-slate-200 transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* 로고 */}
      <div className="h-14 flex items-center px-4 border-b border-slate-200">
        <span className="text-lg font-bold text-brand-600">
          {collapsed ? 'N' : 'NexOps'}
        </span>
      </div>

      {/* 사업자 전환 */}
      {!collapsed && (
        <div className="px-2 pt-3 pb-1">
          <button
            onClick={() => setBizOpen(!bizOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm hover:bg-slate-50 transition-colors"
          >
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="flex-1 text-left truncate text-slate-700 font-medium">
              {bizLoading ? '...' : currentBusiness?.business_name || '사업자 선택'}
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', bizOpen && 'rotate-180')} />
          </button>

          {bizOpen && (
            <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50">
              {businesses.map((biz) => (
                <button
                  key={biz.id}
                  onClick={() => { switchBusiness(biz.id); setBizOpen(false); window.location.reload() }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50',
                    biz.id === currentBusiness?.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600'
                  )}
                >
                  <span className="flex-1 truncate">{biz.business_name}</span>
                  {biz.business_number && (
                    <span className="text-[10px] text-slate-400">{biz.business_number}</span>
                  )}
                </button>
              ))}
              <a
                href="/settings"
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 border-t border-slate-100"
              >
                <Plus className="w-3 h-3" /> 사업자 추가/관리
              </a>
            </div>
          )}
        </div>
      )}

      {/* 활성 섹션 메뉴 */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {!collapsed && (
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {activeSection.label}
            {activeSection.key === 'operations' && currentBusiness && (
              <span className="ml-1 text-brand-500 normal-case">{currentBusiness.business_name}</span>
            )}
          </div>
        )}

        {activeSection.key === 'operations' ? (
          <>
            {!collapsed && !currentBusiness && !bizLoading && (
              <div className="px-3 py-2 text-xs text-slate-400">
                사업자를 먼저 등록하세요
              </div>
            )}
            {/* 전체 현황·대시보드는 항상 표시 (사업자 미등록 시에도 접근 가능) */}
            {activeSection.items
              .filter((item) => ALWAYS_VISIBLE_OPERATION_HREFS.includes(item.href))
              .map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            {(currentBusiness || collapsed) && activeSection.items
              .filter((item) => !ALWAYS_VISIBLE_OPERATION_HREFS.includes(item.href))
              .map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
          </>
        ) : (
          activeSection.items.map((item) => (
            <NavLink key={item.href} {...item} />
          ))
        )}
      </nav>

      {/* 하단 메뉴 */}
      <div className="py-3 px-2 border-t border-slate-200 space-y-1">
        {bottomItems.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className={cn('flex items-center gap-3 px-3 py-2', collapsed ? 'justify-center' : '')}>
          <UserButton appearance={{ elements: { avatarBox: 'w-7 h-7' } }} />
          {!collapsed && <span className="text-sm text-slate-600 truncate">내 계정</span>}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-200 hover:text-slate-600 w-full transition-colors"
        >
          {collapsed ? <ChevronRight className="w-5 h-5 shrink-0" /> : (
            <><ChevronLeft className="w-5 h-5 shrink-0" /><span>접기</span></>
          )}
        </button>
      </div>
    </aside>
  )
}
