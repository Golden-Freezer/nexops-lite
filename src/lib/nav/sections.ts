// 내비게이션 섹션 정의 — Header(섹션 탭)와 Sidebar(섹션별 메뉴)가 공유하는 단일 진실 소스.
// 활성 섹션은 상태 저장이 아니라 현재 pathname에서 파생한다 (직접 URL 진입·새로고침에도 올바른 탭).
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  BarChart3,
  ShoppingCart,
  PenTool,
  Package,
  Warehouse,
  Wallet,
  Search,
  Sparkles,
  Receipt,
  CreditCard,
  BadgeDollarSign,
  Megaphone,
  Upload,
  Building2,
  Bot,
  TrendingUp,
  Target,
  ClipboardList,
  Image as ImageIcon,
  FileText,
  History,
} from 'lucide-react'

export type SectionKey = 'research' | 'registration' | 'operations' | 'ads-insight' | 'ai-staff'

export interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  /** 모바일 하단 탭 라벨 — 지정된 항목만 MobileNav에 노출 (섹션당 최대 5개) */
  mobileLabel?: string
}

export interface NavSection {
  key: SectionKey
  /** 헤더 탭·사이드바 섹션 제목 공용 라벨 */
  label: string
  /** 모바일 헤더 탭용 압축 라벨 */
  shortLabel: string
  /** 오너 전용 섹션 여부 (Clerk publicMetadata role='owner' — 라우트 차단은 middleware.ts) */
  ownerOnly: boolean
  /** 탭 숨김 대기 (§6-Q1(c) — 노출 시 이 플래그만 제거) */
  hidden?: boolean
  /** 이 섹션에 속하는 라우트 프리픽스 (사이드바 미등재 라우트 포함 — 예: /keyword-discovery) */
  routes: string[]
  /** 사이드바에 노출할 메뉴 */
  items: NavItem[]
  /** 헤더 탭 클릭 시 이동할 섹션 첫 페이지 */
  firstHref: string
}

export const SECTIONS: NavSection[] = [
  {
    key: 'operations',
    label: '사업장 운영',
    shortLabel: '운영',
    ownerOnly: false,
    routes: ['/overview', '/', '/import', '/products', '/focus-products', '/inventory', '/purchases', '/expenses', '/settlement', '/settings'],
    items: [
      { href: '/', icon: LayoutDashboard, label: '대시보드', mobileLabel: '홈' },
      { href: '/import', icon: Upload, label: '파일 올리기', mobileLabel: '올리기' },
      { href: '/products', icon: Package, label: '상품 관리', mobileLabel: '상품' },
      { href: '/focus-products', icon: Target, label: '주력상품 관리' },
      { href: '/inventory', icon: Warehouse, label: '재고 관리', mobileLabel: '재고' },
      { href: '/purchases', icon: Receipt, label: '매입 관리' },
      { href: '/expenses', icon: CreditCard, label: '지출 관리' },
      { href: '/settlement', icon: Wallet, label: '정산', mobileLabel: '정산' },
      { href: '/overview', icon: Building2, label: '전체 현황' },
    ],
    firstHref: '/',
  },
  {
    // 상품등록: 대표이미지·상세페이지 만들기는 대표님 PC(npm run dev)에서 Codex CLI로, 히스토리·에디터는 어디서나.
    key: 'registration',
    label: '상품등록',
    shortLabel: '등록',
    ownerOnly: false,
    routes: ['/registration'],
    items: [
      { href: '/registration/thumbnail', icon: ImageIcon, label: '대표이미지 만들기', mobileLabel: '대표컷' },
      { href: '/registration/detail-page', icon: FileText, label: '상세페이지 만들기', mobileLabel: '상세' },
      { href: '/registration/history', icon: History, label: '만든 기록' },
    ],
    firstHref: '/registration/thumbnail',
  },
]

/** 라우트가 프리픽스에 속하는지 — '/'는 정확히 일치할 때만, 나머지는 세그먼트 경계 기준 */
function matchesRoute(pathname: string, route: string): boolean {
  if (route === '/') return pathname === '/'
  return pathname === route || pathname.startsWith(route + '/')
}

/** 현재 pathname이 속한 섹션. 매핑 밖 라우트(/extension-auth, /settings 등)는 operations로 fallback */
export function resolveSection(pathname: string): NavSection {
  const found = SECTIONS.find((section) => section.routes.some((route) => matchesRoute(pathname, route)))
  return found ?? SECTIONS.find((s) => s.key === 'operations')!
}
