// 실 테스트 상품 픽스처(T8) — docs/plans/pdp-enrichment/04_TEST_PROGRAM.md §1 P01~P10, P11(N 트랙 비교용 감사 스티커, 2026-10-29).
// 생성: scripts/pdp-eval/prepare-products.mjs(gather → fixtures). 이미지 바이트·고객 데이터·판매가는 넣지 않는다.
// 원천 사진 경로는 상품 소싱 폴더(NEXOPS_PDP_PRODUCT_ROOT, 리포 밖) 기준 상대경로다. 실 테스트 하네스(T5)가 읽어 오너 스토리지에 올린다.

import { join } from 'node:path'
import type { PdpSpecSheet } from '@/lib/registration/pdp-state'
import P01 from './P01.json'
import P02 from './P02.json'
import P03 from './P03.json'
import P04 from './P04.json'
import P05 from './P05.json'
import P06 from './P06.json'
import P07 from './P07.json'
import P08 from './P08.json'
import P09 from './P09.json'
import P10 from './P10.json'
import P11 from './P11.json'

export const PDP_TEST_PRODUCT_IDS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11'] as const
export type PdpTestProductId = (typeof PDP_TEST_PRODUCT_IDS)[number]

export const PDP_CATEGORY_KEYS = ['fashion', 'food', 'digital', 'beauty', 'stationery', 'packaging', 'household', 'pet'] as const

/**
 * 참조로 올리기 전 메모리에서만 하는 편집(photo-edits.ts). box = [x, y, 너비, 높이] 원본 픽셀.
 * inpaint는 상자 둘레에서 이어 채운다(티 나지 않는 채움). blur의 feather(px)는 흐림을 상자 가장자리로 갈수록 약하게 섞고(사각형 경계 없음),
 * keepWhite는 흰 무늬(데이지 꽃잎)를 흐리지 않는다(상품 무늬 보존)
 */
export interface PdpPhotoEdit {
  kind: 'fill' | 'blur' | 'inpaint'
  box: [number, number, number, number]
  note: string
  feather?: number
  keepWhite?: boolean
}

export interface PdpTestPhoto {
  /**
   * self_photo(자체 촬영) · supplier(공급처) · representative(대표이미지) · other · openapi(쿠팡 등록 이미지)
   * · design_render(실물 사진이 아니라 인쇄용 디자인 파일을 로컬에서 렌더한 그림 — programPath로만 둔다)
   */
  origin: 'self_photo' | 'supplier' | 'representative' | 'other' | 'openapi' | 'design_render'
  /** 상품 소싱 폴더(NEXOPS_PDP_PRODUCT_ROOT)/sourceFolder 기준 */
  path?: string
  /** 리포 밖 실 테스트 기록 폴더(NEXOPS_PDP_PROGRAM_DIR) 기준 — 렌더한 디자인 그림처럼 소싱 폴더에 없는 파일(소싱 폴더에는 쓰지 않는다) */
  programPath?: string
  url?: string
  note: string
  edits?: PdpPhotoEdit[]
}

export interface PdpTestProduct {
  schemaVersion: 1
  id: PdpTestProductId
  /** 상품 소싱 폴더 안의 상품 폴더 */
  sourceFolder: string
  categoryKey: (typeof PDP_CATEGORY_KEYS)[number]
  /** v2 코퍼스가 있는 카테고리면 'v2', 없으면 'pooled'(vocab 범용 근거) */
  evidencePath: 'v2' | 'pooled'
  sellerProductId: string
  specSheet: PdpSpecSheet
  /** specSheet 필드별 출처 */
  fieldSources: Record<string, string>
  /** 공식 데이터에 없어 비워 둔 필드(만들지 않는다) */
  emptyFields: string[]
  /** 사람이 직접 보고 고른 원천 사진 1~3장 */
  sourcePhotos: PdpTestPhoto[]
  /** 페어넥스 등록 옵션명(products.option_name) 그대로 */
  optionLabels: string[]
  /** 형태 축 값 → 실물 사진(디자인·색상 카드용) */
  optionImages?: Record<string, PdpTestPhoto>
  /** 현행 판매 상세페이지 파일 — 생성 입력 금지, L0 기준선 채점용 */
  currentPagePaths: string[]
  /** SEO·등록 검색어 — 하네스가 대조군이 아닌 군에만 spec_sheet.searchTags로 얹는다(parent-proxy 판정 입력, 프롬프트에는 안 들어간다) */
  searchTags: string[]
  /** 오너 확인이 필요한 항목. 비어 있지 않으면 실 테스트(T5)에서 이 상품을 돌리지 않는다 */
  ownerChecks: string[]
  /** 값은 입력 글 그대로 두되 오너가 미확인으로 표시한 값(시험을 막지 않는다) */
  unconfirmed?: Array<{ field: string; value: string; note: string }>
  /** 리뷰 파일(리포 밖 기록 폴더 기준) — 하네스가 실행 때 intakeReviewFile(앱 업로드와 같은 정화·표집)로 spec_sheet에 넣는다. 원문은 리포에 두지 않는다 */
  reviewFiles?: { kind: 'own' | 'competitor'; programPath: string; note: string }[]
  notes: string[]
}

function isEdit(value: unknown): value is PdpPhotoEdit {
  const e = value as PdpPhotoEdit
  return (
    !!e &&
    (e.kind === 'fill' || e.kind === 'blur' || e.kind === 'inpaint') &&
    (e.feather === undefined || (e.kind === 'blur' && Number.isInteger(e.feather) && e.feather > 0)) &&
    (e.keepWhite === undefined || (e.kind === 'blur' && typeof e.keepWhite === 'boolean')) &&
    Array.isArray(e.box) &&
    e.box.length === 4 &&
    e.box.every((n, i) => Number.isInteger(n) && (i < 2 ? n >= 0 : n > 0)) &&
    typeof e.note === 'string' &&
    e.note.length > 0
  )
}

function isPhoto(value: unknown): value is PdpTestPhoto {
  const p = value as PdpTestPhoto
  return (
    !!p &&
    typeof p.note === 'string' &&
    [p.path, p.url, p.programPath].filter((v) => typeof v === 'string').length === 1 &&
    // 렌더한 디자인 그림은 소싱 폴더가 아니라 기록 폴더에 둔다
    (p.origin === 'design_render') === (typeof p.programPath === 'string') &&
    (p.edits === undefined || (Array.isArray(p.edits) && p.edits.every(isEdit)))
  )
}

/** 리뷰 파일 — 종류·출처 메모 필수, 경로는 기록 폴더 안 상대 경로만(절대 경로·'..' 없음) */
function isReviewFile(value: unknown): boolean {
  const r = value as NonNullable<PdpTestProduct['reviewFiles']>[number]
  return (
    !!r &&
    (r.kind === 'own' || r.kind === 'competitor') &&
    typeof r.note === 'string' &&
    r.note.length > 0 &&
    typeof r.programPath === 'string' &&
    r.programPath.length > 0 &&
    !/^([a-zA-Z]:|[\\/])/.test(r.programPath) &&
    !r.programPath.split(/[\\/]/).includes('..')
  )
}

/** JSON → 타입 확인. 깨진 픽스처는 조용히 넘기지 않고 실패한다 */
export function toPdpTestProduct(raw: unknown): PdpTestProduct {
  const p = raw as PdpTestProduct
  const ok =
    !!p &&
    p.schemaVersion === 1 &&
    (PDP_TEST_PRODUCT_IDS as readonly string[]).includes(p.id) &&
    (PDP_CATEGORY_KEYS as readonly string[]).includes(p.categoryKey) &&
    (p.evidencePath === 'v2' || p.evidencePath === 'pooled') &&
    typeof p.specSheet?.productName === 'string' &&
    Array.isArray(p.sourcePhotos) &&
    p.sourcePhotos.length >= 1 &&
    p.sourcePhotos.length <= 3 &&
    p.sourcePhotos.every(isPhoto) &&
    Array.isArray(p.optionLabels) &&
    Array.isArray(p.ownerChecks) &&
    Object.values(p.optionImages ?? {}).every(isPhoto) &&
    (p.reviewFiles === undefined || (Array.isArray(p.reviewFiles) && p.reviewFiles.every(isReviewFile)))
  if (!ok) throw new Error(`pdp-products 픽스처 형식 오류: ${String((raw as { id?: unknown })?.id)}`)
  return p
}

const PRODUCTS: Record<PdpTestProductId, PdpTestProduct> = Object.fromEntries(
  [P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11].map((raw) => {
    const product = toPdpTestProduct(raw)
    return [product.id, product]
  }),
) as Record<PdpTestProductId, PdpTestProduct>

export function getPdpTestProduct(id: string): PdpTestProduct {
  const product = PRODUCTS[id as PdpTestProductId]
  if (!product) throw new Error(`알 수 없는 실 테스트 상품: ${id} (P01~P11)`)
  return product
}

export function listPdpTestProducts(): PdpTestProduct[] {
  return PDP_TEST_PRODUCT_IDS.map((id) => PRODUCTS[id])
}

/** 실 테스트에 바로 쓸 수 있는가 — 오너 확인 항목이 남아 있으면 false */
export function isReadyForLiveTest(product: Pick<PdpTestProduct, 'ownerChecks'>): boolean {
  return product.ownerChecks.length === 0
}

/** 원천 사진의 로컬 절대경로. 상품 소싱 폴더는 env로만 받는다(리포에 개인 경로를 두지 않는다) */
export function resolvePdpProductPath(
  product: Pick<PdpTestProduct, 'sourceFolder'>,
  relPath: string,
  root: string | undefined = process.env.NEXOPS_PDP_PRODUCT_ROOT,
): string {
  if (!root) throw new Error('NEXOPS_PDP_PRODUCT_ROOT(상품 소싱 폴더)가 필요합니다')
  return join(root, product.sourceFolder, relPath)
}

/** 사진 하나의 로컬 절대경로 — programPath는 기록 폴더, path는 상품 소싱 폴더 기준(url 사진은 로컬 파일이 없다) */
export function resolvePdpPhotoPath(
  product: Pick<PdpTestProduct, 'sourceFolder'>,
  photo: PdpTestPhoto,
  env: { productRoot?: string; programDir?: string } = {
    productRoot: process.env.NEXOPS_PDP_PRODUCT_ROOT,
    programDir: process.env.NEXOPS_PDP_PROGRAM_DIR,
  },
): string {
  if (photo.programPath) {
    if (!env.programDir) throw new Error('NEXOPS_PDP_PROGRAM_DIR(리포 밖 기록 폴더)가 필요합니다')
    return join(env.programDir, photo.programPath)
  }
  if (!photo.path) throw new Error('로컬 파일이 없는 사진입니다(url)')
  return resolvePdpProductPath(product, photo.path, env.productRoot)
}
