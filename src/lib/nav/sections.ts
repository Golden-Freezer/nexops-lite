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
    key: 'research',
    label: '소싱 리서치',
    shortLabel: '소싱',
    ownerOnly: true,
    routes: ['/research', '/wing-insight', '/ai-sourcing', '/margin-calc', '/sourcing', '/naming', '/keyword-discovery'],
    items: [
      { href: '/ai-sourcing', icon: Sparkles, label: 'AI 소싱기', mobileLabel: 'AI소싱' },
      { href: '/research', icon: Search, label: '키워드 리서치', mobileLabel: '리서치' },
      { href: '/wing-insight', icon: BarChart3, label: '시장 분석', mobileLabel: '시장' },
      { href: '/sourcing', icon: ShoppingCart, label: '소싱 리스트' },
      { href: '/margin-calc', icon: BarChart3, label: '마진계산기', mobileLabel: '마진' },
      { href: '/naming', icon: PenTool, label: '상품명 작명', mobileLabel: '작명' },
    ],
    firstHref: '/ai-sourcing',
  },
  {
    // 상품등록 — 소싱→등록 흐름 순서로 research 바로 오른쪽. 대표이미지·상세페이지 에셋 생산
    // (NEXFIT 생성기 이식, docs/plans/registration-tab). 라우트 차단은 middleware.ts.
    key: 'registration',
    label: '상품등록',
    shortLabel: '등록',
    ownerOnly: true,
    routes: ['/registration'],
    items: [
      { href: '/registration', icon: ClipboardList, label: '등록 대기', mobileLabel: '등록' },
      { href: '/registration/thumbnail', icon: ImageIcon, label: '대표이미지 스튜디오', mobileLabel: '대표컷' },
      { href: '/registration/detail-page', icon: FileText, label: '상세페이지 생성' },
      { href: '/registration/history', icon: History, label: '생성 히스토리' },
    ],
    firstHref: '/registration',
  },
  {
    key: 'operations',
    label: '사업장 운영',
    shortLabel: '운영',
    ownerOnly: false,
    routes: ['/overview', '/', '/import', '/products', '/focus-products', '/pricing-simulator', '/inventory', '/demand-forecast', '/purchases', '/expenses', '/ads', '/settlement'],
    items: [
      { href: '/overview', icon: Building2, label: '전체 현황' },
      { href: '/', icon: LayoutDashboard, label: '대시보드', mobileLabel: '홈' },
      { href: '/import', icon: Upload, label: '데이터 Import' },
      { href: '/products', icon: Package, label: '상품 관리', mobileLabel: '상품' },
      { href: '/focus-products', icon: Target, label: '주력상품 관리' },
      { href: '/pricing-simulator', icon: BadgeDollarSign, label: '판매가 시뮬레이터' },
      { href: '/inventory', icon: Warehouse, label: '재고 관리', mobileLabel: '재고' },
      { href: '/demand-forecast', icon: TrendingUp, label: '수요예측' },
      { href: '/purchases', icon: Receipt, label: '매입 관리', mobileLabel: '매입' },
      { href: '/expenses', icon: CreditCard, label: '지출 관리' },
      { href: '/ads', icon: Megaphone, label: '광고 관리' },
      { href: '/settlement', icon: Wallet, label: '정산', mobileLabel: '정산' },
    ],
    firstHref: '/overview',
  },
  {
    // NEXADS 이관·통합. /ads(광고 관리)는 운영 섹션 잔류 — 별개.
    // 2026-07-16 공유 개방: 초대 계정도 접근 가능 (데이터는 business_id 격리).
    key: 'ads-insight',
    label: '광고 분석',
    shortLabel: '광고',
    ownerOnly: false,
    routes: ['/ads-insight'],
    items: [
      { href: '/ads-insight', icon: LayoutDashboard, label: '상황실', mobileLabel: '상황실' },
      { href: '/ads-insight/campaigns', icon: Megaphone, label: '캠페인', mobileLabel: '캠페인' },
      { href: '/ads-insight/upload', icon: Upload, label: 'CSV 업로드', mobileLabel: '업로드' },
    ],
    firstHref: '/ads-insight',
  },
  {
    // AI 직원 근무 현황·보고함 (docs/plans/ai-staff/DESIGN.md §6) — 오너 전용.
    // 라우트 차단은 middleware.ts isOwnerOnlyRoute(/ai-staff)에서 강제.
    key: 'ai-staff',
    label: 'AI 직원',
    shortLabel: 'AI',
    ownerOnly: true,
    routes: ['/ai-staff'],
    items: [{ href: '/ai-staff', icon: Bot, label: '근무·보고함', mobileLabel: 'AI직원' }],
    firstHref: '/ai-staff',
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
